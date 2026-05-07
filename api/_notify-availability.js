// Availability-based cancellation notifications.
//
// When a booking is cancelled, this module finds learners whose
// `learner_availability` window covers the freed slot and pings them via
// WhatsApp + email so they can rebook it.
//
// Replaces the old waitlist-driven flow (May 2026). Weekly availability is now
// the single primitive — no separate waitlist signup required.

const { neon } = require('@neondatabase/serverless');
const { sendWhatsApp } = require('./_whatsapp');
const { createTransporter } = require('./_auth-helpers');

function formatDateDisplay(str) {
  const iso = str instanceof Date ? str.toISOString().slice(0, 10) : String(str).slice(0, 10);
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

function formatTime12(t) {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

async function notifyAvailableLearners({
  instructor_id,
  instructor_name,
  scheduled_date,
  start_time,
  end_time,
  school_id
}) {
  const sql = neon(process.env.POSTGRES_URL);
  const schoolId = school_id || 1;

  const isoSchedDate = scheduled_date instanceof Date
    ? scheduled_date.toISOString().slice(0, 10)
    : String(scheduled_date).slice(0, 10);
  const dayOfWeek = new Date(isoSchedDate + 'T00:00:00Z').getUTCDay();
  const slotStart = String(start_time).slice(0, 5);
  const slotEnd   = String(end_time).slice(0, 5);

  // Find every learner with an active availability window covering the slot,
  // scoped to this school.
  const matches = await sql`
    SELECT DISTINCT lu.id AS learner_id, lu.name, lu.email, lu.phone
    FROM learner_availability la
    JOIN learner_users lu ON lu.id = la.learner_id
    WHERE la.active = true
      AND la.school_id = ${schoolId}
      AND lu.school_id = ${schoolId}
      AND la.day_of_week = ${dayOfWeek}
      AND la.start_time <= ${slotStart}::time
      AND la.end_time   >= ${slotEnd}::time
  `;

  if (matches.length === 0) return { notified: 0 };

  const dateStr = formatDateDisplay(scheduled_date);
  const timeStr = formatTime12(slotStart);
  const bookLink = `https://coachcarter.uk/learner/book.html`;
  const message = `A slot just opened!\n\n📅 ${dateStr} at ${timeStr}\n👨‍🏫 ${instructor_name}\n\nBook now: ${bookLink}`;

  const mailer = createTransporter();

  for (const m of matches) {
    if (m.phone) {
      sendWhatsApp(m.phone, message)
        .catch(err => console.warn('availability WA failed:', err.message));
    }
    if (m.email) {
      mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      m.email,
        subject: `A slot opened — ${dateStr} at ${timeStr}`,
        html: `
          <h2>A lesson slot just opened!</h2>
          <p>This slot matches your weekly availability:</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Date</td><td>${dateStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Time</td><td>${timeStr}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Instructor</td><td>${instructor_name}</td></tr>
          </table>
          <p>First to book gets it.</p>
          <p style="margin:24px 0">
            <a href="${bookLink}"
               style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem">
              Book this slot →
            </a>
          </p>
          <p style="font-size:0.85rem;color:#888">You received this because you set weekly availability covering this time. Update your availability anytime on your profile.</p>
        `
      }).catch(err => console.warn('availability email failed:', err.message));
    }
  }

  return { notified: matches.length };
}

module.exports = { notifyAvailableLearners };
