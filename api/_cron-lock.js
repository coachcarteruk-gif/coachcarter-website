// Cron overlap guard — lease-based advisory locking.
//
// Why this exists: every cron entry in vercel.json is invoked over HTTP by
// Vercel's scheduler. If two invocations overlap (slow run + scheduled run
// fires before the previous one finished, or a manual ?key= trigger while a
// scheduled run is in flight), they race. Concrete failure modes the codebase
// already had:
//
//   - api/reminders?action=send-due: SELECT due bookings → loop email send →
//     INSERT into sent_reminders. Two parallel runs both pass the NOT EXISTS
//     check, both send the email, then both INSERT (the second hits ON CONFLICT
//     so the dedup row is fine — but the learner got two reminders).
//   - api/setmore-sync, api/ical-sync: pick the oldest-synced instructor. Two
//     parallel runs pick the same row, fetch the same external feed twice, and
//     upsert the same events twice in quick succession (idempotent on key but
//     double the external API spend and double the per-row Neon writes).
//   - api/setmore-welcome: SELECT learners → send email → UPDATE
//     welcome_email_sent_at. Same gap, same double-email risk.
//
// Why not pg_advisory_lock: session-scoped, and the Neon HTTP driver opens a
// fresh connection per `sql\`...\`` call. The lock would auto-release before
// the next statement. A single transaction is no use either because crons span
// many independent statements (external HTTP fetches between them).
//
// What this gives us: a row in cron_locks with (lock_key, owner, expires_at).
// Acquire succeeds iff no row exists or the existing row's lease has expired.
// Self-releases via expires_at — a crashed cron stops blocking after the lease.
// withCronLock() also DELETEs on success/failure paths so the next run starts
// fresh (no waiting for the lease to time out under normal operation).
//
// Lease length: caller passes leaseSeconds. Choose 2-3× the cron's worst-case
// runtime. Too short → premature release lets a slow run race itself. Too long
// → a crashed cron blocks the next several scheduled runs.
//
// Usage:
//   const { withCronLock } = require('./_cron-lock');
//   await withCronLock(req, res, 'reminders.send-due', 600, async (sql) => {
//     // ... cron body, using sql ...
//     return { ok: true, sent: 5 };
//   });
//
// On overlap: returns 200 with { ok: true, skipped: 'lock_held', ... } — a 200
// is correct here because the work isn't actually pending (the other run is
// handling it). Vercel Cron treats non-200 as failure and re-fires; we don't
// want that.

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const { reportError } = require('./_error-alert');

// Try to acquire the lock. Returns the owner token if we got it, null otherwise.
//
// The INSERT … ON CONFLICT DO UPDATE WHERE expires_at < NOW() RETURNING owner
// pattern atomically claims the lock if free or if the prior lease has expired.
// RETURNING gives us back the owner that's now on the row — if it matches our
// nonce, we won the race.
async function acquireCronLock(sql, lockKey, leaseSeconds) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const lease = Math.max(30, Math.floor(leaseSeconds)); // floor at 30s
  try {
    const [row] = await sql`
      INSERT INTO cron_locks (lock_key, owner, acquired_at, expires_at)
      VALUES (${lockKey}, ${nonce}, NOW(), NOW() + (${lease} || ' seconds')::INTERVAL)
      ON CONFLICT (lock_key) DO UPDATE
        SET owner       = EXCLUDED.owner,
            acquired_at = EXCLUDED.acquired_at,
            expires_at  = EXCLUDED.expires_at
        WHERE cron_locks.expires_at < NOW()
      RETURNING owner
    `;
    if (!row) return null; // ON CONFLICT WHERE didn't match — existing lease still live
    return row.owner === nonce ? nonce : null;
  } catch (err) {
    // If the table doesn't exist yet (migration not run), fail-open — the
    // cron still runs, just without the overlap guard. Surface via console
    // so the operator notices.
    if (err.message?.includes('cron_locks') && err.message?.includes('does not exist')) {
      console.warn(`[cron-lock] cron_locks table missing — running ${lockKey} without overlap guard. Run /api/migrate.`);
      return 'fail-open';
    }
    throw err;
  }
}

// Release the lock if we still own it. Safe to call even after lease expiry
// (the WHERE clause drops the operation in that case).
async function releaseCronLock(sql, lockKey, owner) {
  if (!owner || owner === 'fail-open') return;
  try {
    await sql`DELETE FROM cron_locks WHERE lock_key = ${lockKey} AND owner = ${owner}`;
  } catch (err) {
    // Logged but not raised — releasing is best-effort; the lease will expire.
    console.warn(`[cron-lock] release failed for ${lockKey}:`, err.message);
  }
}

// Wrapper for cron entry points. Acquires lock, runs work, releases lock,
// writes the response. The callback receives the shared neon sql instance.
//
// Returns nothing — it always writes to res itself. The callback's return
// value becomes the JSON body on success.
async function withCronLock(req, res, lockKey, leaseSeconds, workFn) {
  const sql = neon(process.env.POSTGRES_URL);
  const owner = await acquireCronLock(sql, lockKey, leaseSeconds);

  if (owner === null) {
    // Another invocation is in flight. 200 so Vercel doesn't re-fire on a
    // false "failure" signal.
    return res.status(200).json({
      ok: true,
      skipped: 'lock_held',
      lock_key: lockKey,
      message: 'Another invocation is currently running this cron.'
    });
  }

  try {
    const result = await workFn(sql);
    // Caller may have already responded (some handlers stream / write early).
    // headersSent is the cheap check.
    if (!res.headersSent) {
      res.status(200).json(result == null ? { ok: true } : result);
    }
  } catch (err) {
    reportError(`/api${req.url?.split('?')[0] || ''} (cron-lock workFn)`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Cron failed', details: err.message });
    } else {
      // Response already sent — log and continue. release still runs below.
      console.error(`[cron-lock] ${lockKey} threw after response sent:`, err.message);
    }
  } finally {
    await releaseCronLock(sql, lockKey, owner);
  }
}

module.exports = { acquireCronLock, releaseCronLock, withCronLock };
