// Lesson request lifecycle cron (LESSON-REQUEST-PLAN.md)
//
// Routes:
//   GET /api/requests?action=expire-requests  (CRON_SECRET auth, hourly)
//     → 1. expire stale pending requests (release hold + notify learner)
//       2. retry hold releases that crashed mid-decision (released_at IS NULL)
//       3. close out accepts that crashed between claim and booking
//
// Learner-facing request actions live in api/slots.js (request-slot,
// my-requests, withdraw-request); instructor decisions live in
// api/instructor.js (list-requests, accept-request, decline-request).

const { reportError } = require('./_error-alert');
const { withCronLock } = require('./_cron-lock');
const { verifyCronAuth } = require('./_auth');
const {
  expirePendingRequest,
  releaseRequestHold,
  refundCapturedRequest,
  withLearnerContact,
  notifyLearnerRequestClosed,
} = require('./_lesson-requests');

module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'expire-requests') return handleExpireRequests(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

async function handleExpireRequests(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // 300s lease — unlike offers, expiry here does per-row work (hold release,
  // Stripe cancel, notifications), so give it headroom.
  return withCronLock(req, res, 'requests.expire', 300, async (sql) => {
    const summary = { expired: 0, releases_retried: 0, crashed_accepts_closed: 0, errors: 0 };

    // 1. Expire stale pending requests.
    let stale = [];
    try {
      stale = await sql`
        SELECT * FROM lesson_requests
        WHERE status = 'pending' AND expires_at <= NOW()
        ORDER BY expires_at ASC
        LIMIT 100
      `;
    } catch (e) {
      // Table missing mid-deploy — nothing to do.
      return { ok: true, ...summary, note: 'lesson_requests table not found' };
    }
    for (const row of stale) {
      try {
        const result = await expirePendingRequest(sql, row);
        if (!result.skipped) summary.expired++;
      } catch (err) {
        summary.errors++;
        console.error('[requests cron] expire failed', { requestId: row.id, err: err.message });
        reportError('/api/requests?action=expire-requests:expire', err);
      }
    }

    // 2. Retry hold releases that crashed between decision and release.
    //    (Decline/expire/withdraw already notified the learner — no re-send.)
    const unreleased = await sql`
      SELECT * FROM lesson_requests
      WHERE status IN ('declined', 'expired', 'withdrawn')
        AND released_at IS NULL
        AND decided_at < NOW() - INTERVAL '10 minutes'
      ORDER BY decided_at ASC
      LIMIT 50
    `;
    for (const row of unreleased) {
      try {
        const release = await releaseRequestHold(sql, row);
        if (release.ok) summary.releases_retried++;
        else summary.errors++;
      } catch (err) {
        summary.errors++;
        console.error('[requests cron] release retry failed', { requestId: row.id, err: err.message });
        reportError('/api/requests?action=expire-requests:release-retry', err);
      }
    }

    // 3. Accepts that crashed between claim and booking creation. Close them
    //    out in the learner's favour and alert — an accepted request should
    //    always have a booking within seconds.
    const crashedAccepts = await sql`
      SELECT * FROM lesson_requests
      WHERE status = 'accepted'
        AND booking_id IS NULL
        AND decided_at < NOW() - INTERVAL '15 minutes'
      ORDER BY decided_at ASC
      LIMIT 20
    `;
    for (const row of crashedAccepts) {
      try {
        await sql`
          UPDATE lesson_requests
             SET status = 'declined',
                 decline_reason = 'System: accept did not complete — payment returned'
           WHERE id = ${row.id} AND school_id = ${row.school_id} AND status = 'accepted'
        `;
        if (row.payment_method === 'card_hold' && row.released_at) {
          // released_at on a card accept means the PI was captured — the
          // money was taken, so refund it.
          await refundCapturedRequest(row);
        } else {
          // Credit hold not yet refunded, or card PI not yet captured —
          // releaseRequestHold handles both (refund CT / PI cancel).
          await releaseRequestHold(sql, row);
        }
        const withContact = await withLearnerContact(sql, row);
        await notifyLearnerRequestClosed(withContact, 'accept_failed');
        reportError(
          '/api/requests?action=expire-requests:crashed-accept',
          new Error(`Request ${row.id} was accepted but never booked; closed out and payment returned`)
        );
        summary.crashed_accepts_closed++;
      } catch (err) {
        summary.errors++;
        console.error('[requests cron] crashed-accept close failed', { requestId: row.id, err: err.message });
        reportError('/api/requests?action=expire-requests:crashed-accept-close', err);
      }
    }

    return { ok: true, ...summary };
  });
}
