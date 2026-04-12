// iCal Feed Sync — cron job
//
// GET /api/ical-sync  (CRON_SECRET auth)
//
// Processes one instructor per invocation (round-robin by oldest sync).
// Fetches their external iCal feed, parses events, and upserts into
// instructor_external_events. Slot generation checks this table to
// block slots that conflict with the instructor's personal calendar.

const { neon } = require('@neondatabase/serverless');
const crypto   = require('crypto');
const { reportError } = require('./_error-alert');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const provided = req.query.key || req.headers['authorization']?.replace('Bearer ', '');
  return provided === secret;
}

function setCors(res) {
}

// Convert a JS Date to Europe/London local date + time strings
function toLondonDatetime(d) {
  const s = d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  // s = "DD/MM/YYYY, HH:MM:SS"
  const [datePart, timePart] = s.split(', ');
  const [dd, mm, yyyy] = datePart.split('/');
  return { date: `${yyyy}-${mm}-${dd}`, time: timePart };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);

  try {
    // Pick the instructor whose feed was synced least recently
    const [instructor] = await sql`
      SELECT id, ical_feed_url
      FROM instructors
      WHERE ical_feed_url IS NOT NULL
        AND active = true
        AND (ical_last_synced_at IS NULL OR ical_last_synced_at < NOW() - INTERVAL '10 minutes')
      ORDER BY ical_last_synced_at ASC NULLS FIRST
      LIMIT 1
    `;

    if (!instructor) {
      return res.json({ ok: true, message: 'No feeds to sync' });
    }

    // Fetch the iCal feed
    let text;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch(instructor.ical_feed_url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CoachCarter-CalSync/1.0' }
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        await setSyncError(sql, instructor.id, `Feed returned HTTP ${resp.status}`);
        return res.json({ ok: false, error: `HTTP ${resp.status}` });
      }

      text = await resp.text();
      if (text.length > 2 * 1024 * 1024) {
        await setSyncError(sql, instructor.id, 'Feed too large (>2MB)');
        return res.json({ ok: false, error: 'Feed too large' });
      }
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Feed timed out' : `Fetch failed: ${err.message}`;
      await setSyncError(sql, instructor.id, msg);
      return res.json({ ok: false, error: msg });
    }

    // Parse the iCal feed
    if (!text.includes('BEGIN:VCALENDAR')) {
      await setSyncError(sql, instructor.id, 'Response is not a valid iCal feed');
      return res.json({ ok: false, error: 'Not iCal' });
    }

    const ical = require('node-ical');
    let parsed;
    try {
      parsed = ical.sync.parseICS(text);
    } catch (err) {
      await setSyncError(sql, instructor.id, 'Failed to parse iCal data');
      return res.json({ ok: false, error: 'Parse failed' });
    }

    // Expand events into individual occurrences within 90-day window
    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rangeEnd = new Date(rangeStart.getTime() + 90 * 24 * 60 * 60 * 1000);

    const rows = [];
    const seenHashes = new Set();

    for (const [key, event] of Object.entries(parsed)) {
      if (event.type !== 'VEVENT') continue;
      // Skip cancelled or transparent (free) events
      if (event.status && event.status.toUpperCase() === 'CANCELLED') continue;
      if (event.transparency && event.transparency.toUpperCase() === 'TRANSPARENT') continue;

      const occurrences = [];

      if (event.rrule) {
        // Expand recurring event
        try {
          const dates = event.rrule.between(rangeStart, rangeEnd, true);
          for (const d of dates) {
            // rrule returns dates without time — combine with original time
            const start = new Date(d);
            if (event.start) {
              start.setHours(event.start.getHours(), event.start.getMinutes(), 0, 0);
            }
            const durationMs = event.end && event.start
              ? event.end.getTime() - event.start.getTime()
              : 60 * 60 * 1000; // default 1 hour
            const end = new Date(start.getTime() + durationMs);

            // Check EXDATE exclusions
            if (event.exdate) {
              const exdates = Array.isArray(event.exdate)
                ? event.exdate
                : Object.values(event.exdate || {});
              const startStr = start.toISOString().slice(0, 10);
              const isExcluded = exdates.some(ex => {
                const exDate = ex instanceof Date ? ex : new Date(ex);
                return exDate.toISOString().slice(0, 10) === startStr;
              });
              if (isExcluded) continue;
            }

            occurrences.push({
              start, end,
              uid: `${event.uid || key}__${start.toISOString()}`,
              isAllDay: !!(event.datetype === 'date')
            });
          }
        } catch {
          // RRULE expansion failed — skip this event
          continue;
        }
      } else {
        // Single event
        if (!event.start) continue;
        const start = event.start instanceof Date ? event.start : new Date(event.start);
        const end = event.end
          ? (event.end instanceof Date ? event.end : new Date(event.end))
          : new Date(start.getTime() + 60 * 60 * 1000);

        // Skip events entirely outside our range
        if (end < rangeStart || start > rangeEnd) continue;

        occurrences.push({
          start, end,
          uid: event.uid || key,
          isAllDay: !!(event.datetype === 'date')
        });
      }

      for (const occ of occurrences) {
        const hash = crypto.createHash('sha256')
          .update(`${occ.uid}`)
          .digest('hex')
          .slice(0, 32);

        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        const london = toLondonDatetime(occ.start);
        const londonEnd = toLondonDatetime(occ.end);

        rows.push({
          event_date: london.date,
          start_time: london.time,
          end_time: londonEnd.time,
          is_all_day: occ.isAllDay,
          uid_hash: hash
        });
      }
    }

    // Delete past events
    await sql`
      DELETE FROM instructor_external_events
      WHERE instructor_id = ${instructor.id}
        AND event_date < CURRENT_DATE
    `;

    // Upsert current events
    if (rows.length > 0) {
      // Batch upsert in chunks of 50
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        for (const r of chunk) {
          await sql`
            INSERT INTO instructor_external_events
              (instructor_id, event_date, start_time, end_time, is_all_day, uid_hash, synced_at)
            VALUES
              (${instructor.id}, ${r.event_date}, ${r.start_time}, ${r.end_time}, ${r.is_all_day}, ${r.uid_hash}, NOW())
            ON CONFLICT (instructor_id, uid_hash)
            DO UPDATE SET
              event_date = EXCLUDED.event_date,
              start_time = EXCLUDED.start_time,
              end_time   = EXCLUDED.end_time,
              is_all_day = EXCLUDED.is_all_day,
              synced_at  = NOW()
          `;
        }
      }
    }

    // Delete stale events (removed from the source calendar)
    if (rows.length > 0) {
      const currentHashes = rows.map(r => r.uid_hash);
      await sql`
        DELETE FROM instructor_external_events
        WHERE instructor_id = ${instructor.id}
          AND event_date >= CURRENT_DATE
          AND uid_hash != ALL(${currentHashes})
      `;
    } else {
      // Feed has no future events — clear all
      await sql`
        DELETE FROM instructor_external_events
        WHERE instructor_id = ${instructor.id}
          AND event_date >= CURRENT_DATE
      `;
    }

    // Mark sync success
    await sql`
      UPDATE instructors
      SET ical_last_synced_at = NOW(), ical_sync_error = NULL
      WHERE id = ${instructor.id}
    `;

    return res.json({ ok: true, instructor_id: instructor.id, events_synced: rows.length });

  } catch (err) {
    // Retry once on transient Neon errors (cold start at 3am, control plane blips)
    if (err.name === 'NeonDbError' && !req._icalSyncRetried) {
      req._icalSyncRetried = true;
      console.warn('[ical-sync] Neon transient error, retrying once…', err.message);
      await new Promise(r => setTimeout(r, 1000));
      try {
        return await module.exports(req, res);
      } catch (retryErr) {
        reportError('/api/ical-sync', retryErr);
        return res.status(500).json({ error: 'Sync failed after retry' });
      }
    }
    console.error('ical-sync error:', err);
    reportError('/api/ical-sync', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
};

async function setSyncError(sql, instructorId, message) {
  try {
    await sql`
      UPDATE instructors
      SET ical_sync_error = ${message}, ical_last_synced_at = NOW()
      WHERE id = ${instructorId}
    `;
  } catch { /* best effort */ }
}
