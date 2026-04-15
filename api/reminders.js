// Lesson Reminder Notifications (Feature 1)
//
// Cron actions (CRON_SECRET auth):
//   POST ?action=send-due        — hourly, sends email + WhatsApp reminders to learners
//   POST ?action=daily-schedule   — 7pm, sends next-day schedule to instructors
//
// Instructor actions (JWT auth):
//   GET  ?action=settings         — returns reminder preferences
//   POST ?action=update-settings  — updates reminder preferences

const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const twilio   = require('twilio');
const { createTransporter } = require('./_auth-helpers');
const { reportError }       = require('./_error-alert');
const { resolveConfirmations } = require('./_confirmation-resolver');
const { verifyCronAuth, requireAuth } = require('./_auth');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendWhatsApp(to, message) {
  const sid  = process.env.TWILIO_SID;
  const auth = process.env.TWILIO_AUTH;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from || !to) return Promise.resolve();
  let phone = to.replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1);
  else if (!phone.startsWith('+')) phone = '+' + phone;
  const client = twilio(sid, auth);
  return client.messages.create({
    from: `whatsapp:${from}`,
    to:   `whatsapp:${phone}`,
    body: message
  }).catch(err => { console.warn('WhatsApp failed:', err.message); });
}

function verifyInstructorAuth(req) {
  return requireAuth(req, { roles: ['instructor'] });
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTime12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function formatDateDisplay(dateStr) {
  const iso = dateStr instanceof Date ? dateStr.toISOString().slice(0, 10) : String(dateStr).slice(0, 10);
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'send-due')        return handleSendDue(req, res);
  if (action === 'daily-schedule')  return handleDailySchedule(req, res);
  if (action === 'settings')        return handleSettings(req, res);
  if (action === 'update-settings') return handleUpdateSettings(req, res);
  if (action === 'prompt-confirmations') return handlePromptConfirmations(req, res);
  if (action === 'auto-confirm')         return handleAutoConfirm(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── POST ?action=send-due ────────────────────────────────────────────────────
// Hourly cron. Finds bookings within each instructor's reminder window and
// sends email + WhatsApp to learners. Tracks in sent_reminders to avoid dupes.

async function handleSendDue(req, res) {
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Find confirmed bookings whose lesson time is within the instructor's
    // reminder_hours from now AND haven't already been reminded.
    //
    // NOTE on tenant isolation: this is a cross-school cron that processes
    // every school's bookings in one pass. Tenant isolation is enforced by
    // the JOIN conditions (lu.school_id = lb.school_id, i.school_id = lb.school_id)
    // which guarantee each booking is joined only to its own school's learner
    // and instructor. A learner from school A can never be emailed about a
    // school B booking because the join would drop the row. This satisfies
    // the intent of the CLAUDE.md "every query filters by school_id" rule
    // even though it isn't a top-level WHERE clause.
    const dueBookings = await sql`
      SELECT
        lb.id AS booking_id,
        lb.scheduled_date,
        lb.start_time,
        lb.end_time,
        lb.school_id,
        lu.name  AS learner_name,
        lu.email AS learner_email,
        lu.phone AS learner_phone,
        i.name   AS instructor_name,
        i.phone  AS instructor_phone,
        COALESCE(i.reminder_hours, 24) AS reminder_hours,
        COALESCE(lt.name, 'Lesson') AS lesson_type_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
        AND lu.school_id = lb.school_id
      JOIN instructors i    ON i.id  = lb.instructor_id
        AND i.school_id = lb.school_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.status = 'confirmed'
        AND (lb.scheduled_date + lb.start_time)
            BETWEEN NOW()
            AND NOW() + (COALESCE(i.reminder_hours, 24) || ' hours')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM sent_reminders sr
          WHERE sr.booking_id = lb.id AND sr.reminder_type = 'learner_reminder'
        )
      ORDER BY lb.scheduled_date, lb.start_time
    `;

    if (dueBookings.length === 0) {
      return res.json({ ok: true, sent: 0, reason: 'No reminders due' });
    }

    const mailer = createTransporter();
    let sentCount = 0;

    for (const b of dueBookings) {
      const dateStr = formatDateDisplay(b.scheduled_date);
      const timeStr = formatTime12h(b.start_time);
      const firstName = (b.learner_name || 'there').split(' ')[0];

      // Email
      if (b.learner_email) {
        try {
          await mailer.sendMail({
            from: 'CoachCarter <bookings@coachcarter.uk>',
            to: b.learner_email,
            subject: `Reminder: ${b.lesson_type_name} tomorrow with ${b.instructor_name}`,
            html: `
              <h2>Hi ${escHtml(firstName)},</h2>
              <p>Just a reminder about your upcoming lesson:</p>
              <table style="border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td style="padding:6px 0">${escHtml(dateStr)}</td></tr>
                <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td style="padding:6px 0">${escHtml(timeStr)}</td></tr>
                <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Type</td><td style="padding:6px 0">${escHtml(b.lesson_type_name)}</td></tr>
                <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Instructor</td><td style="padding:6px 0">${escHtml(b.instructor_name)}</td></tr>
              </table>
              <p>Need to cancel or reschedule? Do so at least 48 hours before your lesson.</p>
              <p style="margin:28px 0">
                <a href="https://coachcarter.uk/learner/"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  View my bookings
                </a>
              </p>
              <p style="color:#888;font-size:0.85rem;">
                CoachCarter Driving School
              </p>
            `
          });
        } catch (err) {
          console.error(`Reminder email failed for booking ${b.booking_id}:`, err.message);
        }
      }

      // WhatsApp
      if (b.learner_phone) {
        await sendWhatsApp(b.learner_phone,
          `Hey ${firstName}! Just a reminder about your driving lesson:\n\n` +
          `\u{1F4C5} ${dateStr}\n\u23F0 ${timeStr}\n\u{1F697} ${b.lesson_type_name} with ${b.instructor_name}\n\n` +
          `Need to change anything? Head to https://coachcarter.uk/learner/`
        );
      }

      // Record reminder sent
      try {
        await sql`
          INSERT INTO sent_reminders (booking_id, reminder_type, channel)
          VALUES (${b.booking_id}, 'learner_reminder', 'email+whatsapp')
          ON CONFLICT (booking_id, reminder_type) DO NOTHING
        `;
      } catch (err) {
        console.warn(`Failed to record reminder for booking ${b.booking_id}:`, err.message);
      }

      sentCount++;
    }

    return res.json({ ok: true, sent: sentCount });

  } catch (err) {
    // Retry once on transient Neon errors (cold start at 3am, control plane blips)
    if (err.name === 'NeonDbError' && !req._remindersSendRetried) {
      req._remindersSendRetried = true;
      console.warn('[reminders] Neon transient error, retrying once…', err.message);
      await new Promise(r => setTimeout(r, 1000));
      try {
        return await handleSendDue(req, res);
      } catch (retryErr) {
        reportError('/api/reminders?action=send-due', retryErr);
        return res.status(500).json({ error: 'Failed to send reminders after retry' });
      }
    }
    console.error('reminders send-due error:', err);
    reportError('/api/reminders?action=send-due', err);
    return res.status(500).json({ error: 'Failed to send reminders' });
  }
}

// ── POST ?action=daily-schedule ──────────────────────────────────────────────
// 7pm cron. Sends each instructor their next-day schedule via email.

async function handleDailySchedule(req, res) {
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Tomorrow's date in UTC
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Get instructors who want daily schedule emails (with school info)
    const instructors = await sql`
      SELECT i.id, i.name, i.email, i.school_id, s.name AS school_name
      FROM instructors i
      JOIN schools s ON s.id = i.school_id
      WHERE i.active = TRUE
        AND COALESCE(i.daily_schedule_email, true) = true
        AND i.email IS NOT NULL
    `;

    if (instructors.length === 0) {
      return res.json({ ok: true, sent: 0, reason: 'No instructors opted in' });
    }

    const mailer = createTransporter();
    let sentCount = 0;

    for (const inst of instructors) {
      // Get tomorrow's bookings for this instructor.
      // Explicit school_id filter enforces tenant scope per CLAUDE.md convention
      // (defence-in-depth — instructor.id is globally unique so a leak is
      // already structurally impossible, but the explicit WHERE matches the rule).
      const bookings = await sql`
        SELECT
          lb.start_time,
          lb.end_time,
          lb.status,
          lu.name  AS learner_name,
          lu.phone AS learner_phone,
          lu.pickup_address,
          COALESCE(lb.pickup_address, lu.pickup_address) AS pickup,
          lb.dropoff_address AS dropoff,
          COALESCE(lt.name, 'Lesson') AS lesson_type_name,
          COALESCE(lt.colour, '#3b82f6') AS lesson_colour
        FROM lesson_bookings lb
        JOIN learner_users lu ON lu.id = lb.learner_id
          AND lu.school_id = lb.school_id
        LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
        WHERE lb.instructor_id = ${inst.id}
          AND lb.school_id = ${inst.school_id}
          AND lb.scheduled_date = ${tomorrowStr}
          AND lb.status = 'confirmed'
        ORDER BY lb.start_time
      `;

      const firstName = inst.name.split(' ')[0] || 'there';
      const dateDisplay = formatDateDisplay(tomorrowStr);

      if (bookings.length === 0) {
        // Send a "no lessons" email so they know they're free
        try {
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: inst.email,
            subject: `Tomorrow's schedule: No lessons booked`,
            html: `
              <h2>Hi ${escHtml(firstName)},</h2>
              <p>You have <strong>no lessons</strong> booked for <strong>${escHtml(dateDisplay)}</strong>.</p>
              <p style="color:#888;font-size:0.85rem;">
                This is your daily schedule summary from CoachCarter.
              </p>
            `
          });
          sentCount++;
        } catch (err) {
          console.error(`Daily schedule email failed for ${inst.email}:`, err.message);
        }
        continue;
      }

      // Build schedule table
      const rows = bookings.map(b => {
        const time = `${formatTime12h(b.start_time)} - ${formatTime12h(b.end_time)}`;
        const pickup = b.pickup ? escHtml(b.pickup) : '<span style="color:#aaa">Not set</span>';
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #eee">${escHtml(time)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${b.lesson_colour};margin-right:6px;vertical-align:middle"></span>
              ${escHtml(b.lesson_type_name)}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee"><strong>${escHtml(b.learner_name)}</strong></td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee">${pickup}</td>
          </tr>
        `;
      }).join('');

      try {
        await mailer.sendMail({
          from: 'CoachCarter <system@coachcarter.uk>',
          to: inst.email,
          subject: `Tomorrow's schedule: ${bookings.length} lesson${bookings.length > 1 ? 's' : ''}`,
          html: `
            <h2>Hi ${escHtml(firstName)},</h2>
            <p>Here's your schedule for <strong>${escHtml(dateDisplay)}</strong>:</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:0.9rem">
              <thead>
                <tr style="background:#f9f9f9">
                  <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Time</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Type</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Learner</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Pickup</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="margin:28px 0">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                View full calendar
              </a>
            </p>
            <p style="color:#888;font-size:0.85rem;">
              This is your daily schedule summary from CoachCarter.
              You can turn this off in your profile settings.
            </p>
          `
        });
        sentCount++;
      } catch (err) {
        console.error(`Daily schedule email failed for ${inst.email}:`, err.message);
      }
    }

    return res.json({ ok: true, sent: sentCount });

  } catch (err) {
    console.error('reminders daily-schedule error:', err);
    reportError('/api/reminders?action=daily-schedule', err);
    return res.status(500).json({ error: 'Failed to send daily schedules' });
  }
}

// ── GET ?action=settings ─────────────────────────────────────────────────────
// Returns the instructor's reminder preferences.

async function handleSettings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [row] = await sql`
      SELECT
        COALESCE(reminder_hours, 24)          AS reminder_hours,
        COALESCE(daily_schedule_email, true)   AS daily_schedule_email
      FROM instructors
      WHERE id = ${instructor.id}
    `;

    if (!row) return res.status(404).json({ error: 'Instructor not found' });

    return res.json({ ok: true, ...row });

  } catch (err) {
    console.error('reminders settings error:', err);
    reportError('/api/reminders?action=settings', err);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
}

// ── POST ?action=update-settings ─────────────────────────────────────────────
// Updates reminder_hours and/or daily_schedule_email.

async function handleUpdateSettings(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const instructor = verifyInstructorAuth(req);
  if (!instructor) return res.status(401).json({ error: 'Unauthorised' });

  const { reminder_hours, daily_schedule_email } = req.body;

  // Validate
  if (reminder_hours !== undefined) {
    const rh = parseInt(reminder_hours);
    if (isNaN(rh) || rh < 1 || rh > 72)
      return res.status(400).json({ error: 'Reminder hours must be between 1 and 72' });
  }
  if (daily_schedule_email !== undefined && typeof daily_schedule_email !== 'boolean') {
    return res.status(400).json({ error: 'daily_schedule_email must be true or false' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const rhVal = reminder_hours !== undefined ? parseInt(reminder_hours) : null;
    const dseVal = daily_schedule_email !== undefined ? daily_schedule_email : null;

    const [updated] = await sql`
      UPDATE instructors SET
        reminder_hours       = COALESCE(${rhVal}, reminder_hours),
        daily_schedule_email = COALESCE(${dseVal}, daily_schedule_email)
      WHERE id = ${instructor.id}
      RETURNING
        COALESCE(reminder_hours, 24)        AS reminder_hours,
        COALESCE(daily_schedule_email, true) AS daily_schedule_email
    `;

    return res.json({ ok: true, ...updated });

  } catch (err) {
    console.error('reminders update-settings error:', err);
    reportError('/api/reminders?action=update-settings', err);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
}

// ── POST ?action=prompt-confirmations ────────────────────────────────────────
// Hourly cron. Finds past lessons still 'confirmed', transitions them to
// 'awaiting_confirmation', and sends confirmation prompt emails to both parties.
async function handlePromptConfirmations(req, res) {
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';

    // Find past confirmed bookings not yet prompted.
    // Cross-school cron — tenant isolation enforced by JOIN fences
    // (lu.school_id = lb.school_id, i.school_id = lb.school_id) rather than
    // a top-level WHERE. See handleSendDue comment for rationale.
    const bookings = await sql`
      SELECT lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             lb.school_id,
             lu.name AS learner_name, lu.email AS learner_email, lu.phone AS learner_phone,
             i.name AS instructor_name, i.email AS instructor_email, i.phone AS instructor_phone
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
        AND lu.school_id = lb.school_id
      JOIN instructors i ON i.id = lb.instructor_id
        AND i.school_id = lb.school_id
      LEFT JOIN sent_reminders sr ON sr.booking_id = lb.id AND sr.reminder_type = 'confirmation_prompt'
      WHERE lb.status = 'confirmed'
        AND (lb.scheduled_date + lb.end_time) < NOW()
        AND sr.id IS NULL
        AND i.email != 'demo@coachcarter.uk'
      ORDER BY lb.scheduled_date ASC
      LIMIT 50
    `;

    let prompted = 0;
    const mailer = bookings.length > 0 ? createTransporter() : null;

    for (const b of bookings) {
      try {
        // Transition status
        await sql`
          UPDATE lesson_bookings SET status = 'awaiting_confirmation'
          WHERE id = ${b.id} AND status = 'confirmed'
        `;

        const dateStr = formatDateDisplay(b.scheduled_date);
        const timeStr = formatTime12h(b.start_time);

        // Email learner
        if (b.learner_email) {
          const firstName = (b.learner_name || '').split(' ')[0] || 'there';
          const confirmUrl = `${baseUrl}/learner/confirm-lesson.html?booking_id=${b.id}`;
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: b.learner_email,
            subject: 'How did your lesson go? Please confirm',
            html: `
              <h2>Hey ${escHtml(firstName)}!</h2>
              <p>Your lesson on <strong>${dateStr}</strong> at ${timeStr} with ${escHtml(b.instructor_name)} has ended.</p>
              <p>Please take a moment to confirm how it went.</p>
              <p style="margin:28px 0">
                <a href="${confirmUrl}"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  Confirm my lesson →
                </a>
              </p>
            `
          }).catch(e => console.warn('Learner confirmation email failed:', e.message));
        }

        // Email instructor
        if (b.instructor_email) {
          const instFirstName = (b.instructor_name || '').split(' ')[0] || 'there';
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: b.instructor_email,
            subject: `Please confirm your lesson with ${b.learner_name}`,
            html: `
              <h2>Hi ${escHtml(instFirstName)},</h2>
              <p>Your lesson on <strong>${dateStr}</strong> at ${timeStr} with ${escHtml(b.learner_name)} has ended.</p>
              <p>Please confirm the lesson from your instructor portal.</p>
              <p style="margin:28px 0">
                <a href="${baseUrl}/instructor/"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  Open Instructor Portal →
                </a>
              </p>
            `
          }).catch(e => console.warn('Instructor confirmation email failed:', e.message));
        }

        // Record in sent_reminders to prevent re-prompting
        await sql`
          INSERT INTO sent_reminders (booking_id, reminder_type, channel)
          VALUES (${b.id}, 'confirmation_prompt', 'email')
          ON CONFLICT (booking_id, reminder_type) DO NOTHING
        `;

        prompted++;
      } catch (bookingErr) {
        console.error(`Failed to prompt confirmation for booking #${b.id}:`, bookingErr);
      }
    }

    return res.json({ ok: true, prompted, total_found: bookings.length });
  } catch (err) {
    console.error('prompt-confirmations error:', err);
    reportError('/api/reminders?action=prompt-confirmations', err);
    return res.status(500).json({ error: 'Failed to prompt confirmations' });
  }
}

// ── POST ?action=auto-confirm ────────────────────────────────────────────────
// Hourly cron (offset 30min from prompt). Finds 'awaiting_confirmation' bookings
// older than 48 hours and auto-confirms the missing party.
async function handleAutoConfirm(req, res) {
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Find bookings awaiting confirmation for over 48 hours
    const bookings = await sql`
      SELECT lb.id
      FROM lesson_bookings lb
      WHERE lb.status = 'awaiting_confirmation'
        AND (lb.scheduled_date + lb.end_time) < (NOW() - INTERVAL '48 hours')
      LIMIT 50
    `;

    let resolved = 0;

    for (const b of bookings) {
      try {
        // Check which confirmations exist
        const existing = await sql`
          SELECT confirmed_by_role, lesson_happened
          FROM lesson_confirmations
          WHERE booking_id = ${b.id}
        `;

        const hasInstructor = existing.some(c => c.confirmed_by_role === 'instructor');
        const hasLearner    = existing.some(c => c.confirmed_by_role === 'learner');

        if (hasInstructor && hasLearner) {
          // Both exist — just resolve (shouldn't happen, but safety net)
          await resolveConfirmations(sql, b.id);
          resolved++;
          continue;
        }

        if (!hasInstructor && !hasLearner) {
          // Neither confirmed — auto-confirm both as happened (benefit of the doubt)
          await sql`
            INSERT INTO lesson_confirmations (booking_id, confirmed_by_role, lesson_happened, auto_confirmed)
            VALUES (${b.id}, 'instructor', true, true)
            ON CONFLICT (booking_id, confirmed_by_role) DO NOTHING
          `;
          await sql`
            INSERT INTO lesson_confirmations (booking_id, confirmed_by_role, lesson_happened, auto_confirmed)
            VALUES (${b.id}, 'learner', true, true)
            ON CONFLICT (booking_id, confirmed_by_role) DO NOTHING
          `;
        } else {
          // One party confirmed — auto-confirm the missing one, copying lesson_happened
          const existingConf = existing[0];
          const missingRole = hasInstructor ? 'learner' : 'instructor';
          await sql`
            INSERT INTO lesson_confirmations (booking_id, confirmed_by_role, lesson_happened, auto_confirmed)
            VALUES (${b.id}, ${missingRole}, ${existingConf.lesson_happened}, true)
            ON CONFLICT (booking_id, confirmed_by_role) DO NOTHING
          `;
        }

        // Now resolve
        await resolveConfirmations(sql, b.id);
        resolved++;
      } catch (bookingErr) {
        console.error(`Failed to auto-confirm booking #${b.id}:`, bookingErr);
      }
    }

    return res.json({ ok: true, resolved, total_found: bookings.length });
  } catch (err) {
    console.error('auto-confirm error:', err);
    reportError('/api/reminders?action=auto-confirm', err);
    return res.status(500).json({ error: 'Failed to auto-confirm' });
  }
}
