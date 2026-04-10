// Setmore → CoachCarter Booking Sync — cron job
//
// GET /api/setmore-sync  (CRON_SECRET auth)
//
// Processes one instructor per invocation (round-robin by oldest sync).
// Fetches their Setmore appointments, matches/creates learner accounts,
// and imports bookings into lesson_bookings. Idempotent via setmore_key.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');

// ── Setmore service → real lesson duration (minus built-in buffer) ───────────

const SERVICE_MAP = {
  '2ed2b2e6-37a5-45d1-ae00-5a9d1f1ab98e': { realMinutes: 90,  slug: 'standard' }, // 1.5hr Lesson
  '7617c797-c105-435c-b228-55fc7407b29c': { realMinutes: 90,  slug: 'standard' }, // 1.5 Pre-Paid Lesson
  '35805e49-94e7-40d5-bfb4-fd7329a5d3e0': { realMinutes: 120, slug: '2hr' },      // 2hr Lesson
  '5b966cec-ad96-4897-afd3-020ac089a571': { realMinutes: 165, slug: '3hr' },      // 3hr Lesson
  '3bc98ee4-5efa-4935-b8c5-7be4496e2225': { realMinutes: 60,  slug: '1hr' },      // Reading Test + 1hr
  'f92268da-e2cc-4661-8cdd-82afa1b767a0': { realMinutes: 60,  slug: 'trial' },    // Free Trial
};

function setCors(res) {
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Swap Setmore refresh token for a short-lived access token */
async function getAccessToken() {
  const refreshToken = process.env.SETMORE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('SETMORE_REFRESH_TOKEN not configured');

  const resp = await fetch(
    `https://developer.setmore.com/api/v1/o/oauth2/token?refreshToken=${encodeURIComponent(refreshToken)}`
  );
  if (!resp.ok) throw new Error(`Token swap failed: HTTP ${resp.status}`);

  const json = await resp.json();
  if (!json.response) throw new Error(`Token swap rejected: ${json.msg || 'unknown'}`);
  return json.data.token.access_token;
}

/** Call a Setmore API endpoint */
async function setmoreGet(token, path) {
  const resp = await fetch(`https://developer.setmore.com/api/v1/bookingapi${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Setmore API ${path}: HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.response) throw new Error(`Setmore API ${path}: ${json.msg || json.error || 'failed'}`);
  return json.data;
}

/** Format date as dd-MM-yyyy for Setmore API */
function toSetmoreDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Convert a UTC ISO timestamp to Europe/London local date + time */
function toLondon(isoStr) {
  const d = new Date(isoStr);
  const s = d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const [datePart, timePart] = s.split(', ');
  const [dd, mm, yyyy] = datePart.split('/');
  return { date: `${yyyy}-${mm}-${dd}`, time: timePart };
}

/** Add minutes to a time string (HH:MM:SS) and return HH:MM:SS */
function addMinutesToTime(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:00`;
}

/** Normalize a phone number to UK 07xxx format */
function normalizePhone(phone, countryCode) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  // Strip leading country code
  if (p.startsWith('44')) p = p.slice(2);
  if (p.startsWith('0')) return p; // already UK format
  return `0${p}`; // prepend 0 for UK mobile
}

/** Update sync error on instructor */
async function setSyncError(sql, instructorId, message) {
  try {
    await sql`
      UPDATE instructors
      SET setmore_sync_error = ${message}, setmore_last_synced_at = NOW()
      WHERE id = ${instructorId}
    `;
  } catch { /* best effort */ }
}

// ── Fallback duration logic ─────────────────────────────────────────────────
// Setmore adds a 30-min buffer to every service. When we don't recognise a
// service_key we subtract the buffer and infer the lesson type from the result.
const DURATION_TO_SLUG = { 60: '1hr', 90: 'standard', 120: '2hr', 165: '3hr' };
const SETMORE_BUFFER_MINUTES = 30;

function inferFromDuration(rawDuration) {
  const real = rawDuration - SETMORE_BUFFER_MINUTES;
  const slug = DURATION_TO_SLUG[real] || 'standard';
  return { realMinutes: real > 0 ? real : rawDuration, slug };
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  setCors(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);

  try {
    // 1. Pick the instructor whose Setmore feed was synced least recently
    const [instructor] = await sql`
      SELECT id, setmore_staff_key
      FROM instructors
      WHERE setmore_staff_key IS NOT NULL
        AND active = true
        AND (setmore_last_synced_at IS NULL OR setmore_last_synced_at < NOW() - INTERVAL '10 minutes')
      ORDER BY setmore_last_synced_at ASC NULLS FIRST
      LIMIT 1
    `;

    if (!instructor) {
      return res.json({ ok: true, message: 'No Setmore feeds to sync' });
    }

    // 2. Get Setmore access token
    let token;
    try {
      token = await getAccessToken();
    } catch (err) {
      await setSyncError(sql, instructor.id, `Token error: ${err.message}`);
      return res.json({ ok: false, error: err.message });
    }

    // 3. Fetch appointments for the next 90 days
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const startDate = toSetmoreDate(now);
    const endDate = toSetmoreDate(rangeEnd);

    let appointments;
    try {
      const data = await setmoreGet(token,
        `/appointments?staffKey=${instructor.setmore_staff_key}&startDate=${startDate}&endDate=${endDate}`
      );
      appointments = data.appointments || [];
    } catch (err) {
      await setSyncError(sql, instructor.id, `Fetch failed: ${err.message}`);
      return res.json({ ok: false, error: err.message });
    }

    // 4. Load lesson types for slug → id mapping
    const lessonTypes = await sql`SELECT id, slug FROM lesson_types`;
    const typeBySlug = {};
    for (const lt of lessonTypes) typeBySlug[lt.slug] = lt.id;

    // 4b. Load all instructor setmore_staff_key → id mapping
    const allInstructors = await sql`
      SELECT id, setmore_staff_key FROM instructors WHERE setmore_staff_key IS NOT NULL
    `;
    const instructorByStaffKey = {};
    for (const inst of allInstructors) instructorByStaffKey[inst.setmore_staff_key] = inst.id;

    // 5. Process each appointment
    let imported = 0;
    let skipped = 0;
    let cancelled = 0;

    // Build a set of active Setmore appointment keys for cancellation detection
    const activeSetmoreKeys = new Set();

    // Cache customer addresses to avoid duplicate API calls per customer_key
    const customerAddressCache = {};

    for (const appt of appointments) {
      // Track which keys are still active in Setmore (non-cancelled)
      if (appt.status !== 'Cancelled' && appt.status !== 'canceled') {
        activeSetmoreKeys.add(appt.key);
      }

      // Handle cancelled appointments — mark existing bookings as cancelled
      if (appt.status === 'Cancelled' || appt.status === 'canceled') {
        const [existing] = await sql`
          SELECT id, status FROM lesson_bookings
          WHERE setmore_key = ${appt.key} AND status = 'confirmed'
        `;
        if (existing) {
          await sql`
            UPDATE lesson_bookings
            SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Cancelled in Setmore'
            WHERE id = ${existing.id}
          `;
          cancelled++;
        }
        continue;
      }

      // Skip if already imported (but backfill pickup_address if missing)
      const [existing] = await sql`
        SELECT id, pickup_address, edited_at FROM lesson_bookings WHERE setmore_key = ${appt.key}
      `;
      if (existing) {
        // Never overwrite manually edited bookings
        if (existing.edited_at) { skipped++; continue; }
        // Backfill pickup_address for previously imported bookings that lack one
        if (!existing.pickup_address && appt.customer_key) {
          let addr = customerAddressCache[appt.customer_key];
          if (addr === undefined) {
            try {
              const data = await setmoreGet(token, `/customer/${appt.customer_key}`);
              addr = buildCustomerAddress(data.customer);
              customerAddressCache[appt.customer_key] = addr;
            } catch { addr = null; customerAddressCache[appt.customer_key] = null; }
          }
          if (addr) {
            await sql`UPDATE lesson_bookings SET pickup_address = ${addr} WHERE id = ${existing.id}`;
          }
        }
        skipped++;
        continue;
      }

      // Resolve the correct instructor from the appointment's staff_key
      const resolvedInstructorId = instructorByStaffKey[appt.staff_key] || instructor.id;

      // Map service to real duration
      const serviceInfo = SERVICE_MAP[appt.service_key];
      let realMinutes, slug;
      if (serviceInfo) {
        realMinutes = serviceInfo.realMinutes;
        slug = serviceInfo.slug;
      } else {
        // Unrecognised service key — subtract Setmore buffer and infer type
        const inferred = inferFromDuration(appt.duration);
        realMinutes = inferred.realMinutes;
        slug = inferred.slug;
        console.warn(`[setmore-sync] Unrecognised service_key: ${appt.service_key} (duration=${appt.duration}min → inferred ${realMinutes}min/${slug})`);
      }
      const lessonTypeId = typeBySlug[slug] || typeBySlug['standard'];

      // Convert UTC times to London
      const start = toLondon(appt.start_time);
      const realEndTime = addMinutesToTime(start.time, realMinutes);

      // Skip past appointments
      const apptDate = new Date(start.date + 'T' + start.time);
      if (apptDate < now) { skipped++; continue; }

      // 5a. Find or create learner (also returns customer address from Setmore profile)
      let learnerId, pickupAddress;
      try {
        const learnerResult = await findOrCreateLearner(sql, token, appt.customer_key, customerAddressCache);
        learnerId = learnerResult.id;
        pickupAddress = learnerResult.address;
      } catch (err) {
        // Skip this appointment if learner resolution fails
        skipped++;
        continue;
      }

      try {
        await sql`
          INSERT INTO lesson_bookings
            (learner_id, instructor_id, scheduled_date, start_time, end_time,
             status, lesson_type_id, minutes_deducted, setmore_key, created_by,
             pickup_address)
          VALUES
            (${learnerId}, ${resolvedInstructorId}, ${start.date}, ${start.time}, ${realEndTime},
             'confirmed', ${lessonTypeId}, 0, ${appt.key}, 'setmore_sync',
             ${pickupAddress})
        `;
        imported++;
      } catch (err) {
        // Likely a conflict (slot already booked) — skip
        skipped++;
      }
    }

    // 5c. Detect bookings removed from Setmore (no longer in API response)
    // Only check future bookings for the instructor we just synced
    const confirmedSetmoreBookings = await sql`
      SELECT id, setmore_key FROM lesson_bookings
      WHERE instructor_id = ${instructor.id}
        AND setmore_key IS NOT NULL
        AND status = 'confirmed'
        AND scheduled_date >= CURRENT_DATE
    `;

    for (const booking of confirmedSetmoreBookings) {
      if (!activeSetmoreKeys.has(booking.setmore_key)) {
        await sql`
          UPDATE lesson_bookings
          SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Removed from Setmore'
          WHERE id = ${booking.id}
        `;
        cancelled++;
      }
    }

    // 5d. Backfill learner_users.pickup_address from their most recent booking
    // Only updates learners whose profile address is currently empty
    await sql`
      UPDATE learner_users lu
      SET pickup_address = sub.pickup_address
      FROM (
        SELECT DISTINCT ON (learner_id) learner_id, pickup_address
        FROM lesson_bookings
        WHERE pickup_address IS NOT NULL AND pickup_address != ''
          AND instructor_id = ${instructor.id}
        ORDER BY learner_id, scheduled_date DESC
      ) sub
      WHERE lu.id = sub.learner_id
        AND (lu.pickup_address IS NULL OR lu.pickup_address = '')
    `;

    // 6. Mark sync success
    await sql`
      UPDATE instructors
      SET setmore_last_synced_at = NOW(), setmore_sync_error = NULL
      WHERE id = ${instructor.id}
    `;

    return res.json({
      ok: true,
      instructor_id: instructor.id,
      appointments_found: appointments.length,
      imported,
      skipped,
      cancelled
    });

  } catch (err) {
    reportError('/api/setmore-sync', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
};

// ── Learner resolution ───────────────────────────────────────────────────────

/** Build a pickup address string from Setmore customer fields */
function buildCustomerAddress(customer) {
  const parts = [customer.address, customer.city, customer.postal_code].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Find an existing learner or create one from Setmore customer data.
 *  Returns { id, address } where address is built from customer profile fields. */
async function findOrCreateLearner(sql, setmoreToken, customerKey, addressCache) {
  if (!customerKey) throw new Error('No customer key');

  // 1. Check by setmore_customer_key
  const [byKey] = await sql`
    SELECT id FROM learner_users WHERE setmore_customer_key = ${customerKey}
  `;

  // 2. Fetch customer from Setmore (or cache) to get address
  let address = addressCache[customerKey];
  if (address === undefined) {
    try {
      const data = await setmoreGet(setmoreToken, `/customer/${customerKey}`);
      address = buildCustomerAddress(data.customer);
      addressCache[customerKey] = address;
    } catch {
      address = null;
      addressCache[customerKey] = null;
    }
  }

  if (byKey) return { id: byKey.id, address };

  // 3. Fetch customer details for learner creation (reuse cached fetch if available)
  let customer;
  try {
    const data = await setmoreGet(setmoreToken, `/customer/${customerKey}`);
    customer = data.customer;
  } catch {
    throw new Error(`Cannot fetch customer ${customerKey}`);
  }
  if (!customer) throw new Error(`Customer ${customerKey} not found`);

  const phone = normalizePhone(customer.cell_phone, customer.country_code);
  const email = customer.email_id || null;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || 'Setmore Customer';

  // 4. Check by phone match
  if (phone) {
    const [byPhone] = await sql`
      SELECT id FROM learner_users WHERE phone = ${phone}
    `;
    if (byPhone) {
      await sql`UPDATE learner_users SET setmore_customer_key = ${customerKey} WHERE id = ${byPhone.id}`;
      return { id: byPhone.id, address };
    }
  }

  // 5. Check by email match
  if (email) {
    const [byEmail] = await sql`
      SELECT id FROM learner_users WHERE email = ${email}
    `;
    if (byEmail) {
      await sql`UPDATE learner_users SET setmore_customer_key = ${customerKey} WHERE id = ${byEmail.id}`;
      return { id: byEmail.id, address };
    }
  }

  // 6. Auto-create new learner
  const [newLearner] = await sql`
    INSERT INTO learner_users (name, email, phone, setmore_customer_key, balance_minutes)
    VALUES (${name}, ${email}, ${phone}, ${customerKey}, 0)
    RETURNING id
  `;
  return { id: newLearner.id, address };
}
