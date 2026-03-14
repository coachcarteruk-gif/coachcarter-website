// Slot generation engine
//
// Converts instructor weekly availability windows into bookable 1.5-hour slots,
// removing any slots that are already confirmed/completed bookings.
//
// Routes:
//   GET /api/slots?action=available&from=YYYY-MM-DD&to=YYYY-MM-DD[&instructor_id=X]
//     → returns all available slots in date range, grouped by date
//
// Constraints enforced here:
//   - "from" may not be in the past
//   - "to" may not exceed 90 days from today (3-month advance booking window)
//   - Max 31 days per request (for performance)

const { neon } = require('@neondatabase/serverless');

const SLOT_MINUTES   = 90;  // 1.5 hours
const MAX_DAYS_AHEAD = 90;  // booking window
const MAX_RANGE_DAYS = 31;  // max days per API request

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'available') return handleAvailable(req, res);

  return res.status(400).json({ error: 'Unknown action. Use ?action=available' });
};

// ── GET /api/slots?action=available ──────────────────────────────────────────
async function handleAvailable(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to, instructor_id } = req.query;

  // Validate dates
  if (!from || !to)
    return res.status(400).json({ error: '"from" and "to" query params are required (YYYY-MM-DD)' });

  const fromDate = parseDate(from);
  const toDate   = parseDate(to);

  if (!fromDate || !toDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);

  if (fromDate < today)
    return res.status(400).json({ error: '"from" date cannot be in the past' });

  if (toDate > maxAhead)
    return res.status(400).json({
      error: `"to" date cannot be more than ${MAX_DAYS_AHEAD} days from today`
    });

  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS)
    return res.status(400).json({
      error: `Date range cannot exceed ${MAX_RANGE_DAYS} days per request`
    });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Load availability windows (optionally filtered to one instructor)
    const windows = instructor_id
      ? await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.instructor_id = ${instructor_id}
            AND ia.active = true
            AND i.active  = true
          ORDER BY ia.day_of_week, ia.start_time
        `
      : await sql`
          SELECT ia.instructor_id, ia.day_of_week,
                 ia.start_time::text AS start_time,
                 ia.end_time::text   AS end_time,
                 i.name AS instructor_name,
                 i.photo_url, i.bio
          FROM instructor_availability ia
          JOIN instructors i ON i.id = ia.instructor_id
          WHERE ia.active = true
            AND i.active  = true
          ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
        `;

    // 2. Load all confirmed/completed bookings in the date range
    const bookings = await sql`
      SELECT instructor_id,
             scheduled_date::text AS scheduled_date,
             start_time::text     AS start_time,
             end_time::text       AS end_time
      FROM lesson_bookings
      WHERE scheduled_date BETWEEN ${from} AND ${to}
        AND status IN ('confirmed', 'completed')
        ${instructor_id ? sql`AND instructor_id = ${instructor_id}` : sql``}
    `;

    // Index bookings by "instructorId|date" for fast lookup
    const bookedIndex = {};
    for (const b of bookings) {
      const key = `${b.instructor_id}|${b.scheduled_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) });
    }

    // 3. Group windows by instructor
    const byInstructor = {};
    for (const w of windows) {
      if (!byInstructor[w.instructor_id]) {
        byInstructor[w.instructor_id] = {
          id:       w.instructor_id,
          name:     w.instructor_name,
          photo_url: w.photo_url,
          bio:      w.bio,
          windows:  []
        };
      }
      byInstructor[w.instructor_id].windows.push({
        day_of_week: w.day_of_week,
        start: timeToMinutes(w.start_time),
        end:   timeToMinutes(w.end_time)
      });
    }

    // 4. Walk every date in range and generate slots
    const result = {}; // { "YYYY-MM-DD": [ slot, ... ] }

    let cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const dateStr    = formatDate(cursor);
      const dayOfWeek  = cursor.getDay(); // 0=Sun … 6=Sat
      const daySlots   = [];

      for (const instructor of Object.values(byInstructor)) {
        const matchingWindows = instructor.windows.filter(w => w.day_of_week === dayOfWeek);
        const bookedSlots     = bookedIndex[`${instructor.id}|${dateStr}`] || [];

        for (const window of matchingWindows) {
          let slotStart = window.start;

          while (slotStart + SLOT_MINUTES <= window.end) {
            const slotEnd = slotStart + SLOT_MINUTES;

            // Check if this slot overlaps any booked slot
            const isBooked = bookedSlots.some(
              b => slotStart < b.end && slotEnd > b.start
            );

            if (!isBooked) {
              daySlots.push({
                instructor_id:   instructor.id,
                instructor_name: instructor.name,
                instructor_photo: instructor.photo_url,
                date:            dateStr,
                start_time:      minutesToTime(slotStart),
                end_time:        minutesToTime(slotEnd)
              });
            }

            slotStart += SLOT_MINUTES;
          }
        }
      }

      // Only include dates that have at least one slot
      if (daySlots.length > 0) {
        // Sort by start time, then instructor name
        daySlots.sort((a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          a.instructor_name.localeCompare(b.instructor_name)
        );
        result[dateStr] = daySlots;
      }

      cursor = addDays(cursor, 1);
    }

    return res.json({
      from,
      to,
      instructor_id: instructor_id || null,
      days_with_slots: Object.keys(result).length,
      slots: result
    });

  } catch (err) {
    console.error('slots available error:', err);
    return res.status(500).json({ error: 'Failed to generate slots', details: err.message });
  }
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

// "09:30" or "09:30:00" → minutes from midnight
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 570 → "09:30"
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "2026-03-15" → Date (UTC midnight)
function parseDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

// Date → "YYYY-MM-DD"
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}
