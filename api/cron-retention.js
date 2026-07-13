// GDPR Data Retention Cron — runs weekly (Sunday 03:00 UTC)
//
// GET /api/cron-retention
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//   or ?key=${CRON_SECRET} for manual trigger
//
// 1. Soft-deletes learners inactive >3 years
// 2. Hard-deletes learners archived >90 days (with cascading data removal)
// 3. Archives enquiries >2 years, hard-deletes after 30 days
// 4. Cleans up completed deletion requests >90 days
// 5. Purges anonymized credit_transactions >7 years

const { verifyCronAuth } = require('./_auth');
const { withCronLock } = require('./_cron-lock');
const { deleteLearnerCascade } = require('./_gdpr');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 600s — weekly cron, iterates over learners scheduled for hard
  // delete (up to ~20 cascading DELETEs each). Real-world runs <30s but the
  // floor matters if it ever falls behind on backlog.
  return withCronLock(req, res, 'cron-retention', 600, async (sql) => {
    const results = { soft_archived: 0, hard_deleted: 0, enquiries_archived: 0, enquiries_deleted: 0, requests_cleaned: 0, transactions_purged: 0, bookings_purged: 0, notifications_purged: 0 };

    // 1. Refresh last_activity_at from most recent activity
    await sql`
      UPDATE learner_users lu SET last_activity_at = GREATEST(
        COALESCE(lu.last_activity_at, lu.created_at),
        COALESCE((SELECT MAX(created_at) FROM lesson_bookings WHERE learner_id = lu.id), lu.created_at),
        COALESCE((SELECT MAX(created_at) FROM driving_sessions WHERE user_id = lu.id), lu.created_at)
      )
      WHERE lu.archived_at IS NULL`;

    // 2. Soft-delete inactive learners (>3 years since last activity)
    const softArchived = await sql`
      UPDATE learner_users SET archived_at = NOW()
      WHERE last_activity_at < NOW() - INTERVAL '3 years'
        AND archived_at IS NULL
      RETURNING id`;
    results.soft_archived = softArchived.length;

    // 3. Hard-delete learners archived >90 days
    const toDelete = await sql`
      SELECT id, email FROM learner_users
      WHERE archived_at IS NOT NULL
        AND archived_at < NOW() - INTERVAL '90 days'`;

    for (const learner of toDelete) {
      try {
        await deleteLearnerCascade(sql, learner.id, { email: learner.email });
        results.hard_deleted++;
      } catch (e) {
        console.error(`retention: failed to delete learner ${learner.id}:`, e.message);
      }
    }

    // 4. Archive old enquiries (>2 years)
    const archivedEnquiries = await sql`
      UPDATE enquiries SET archived_at = NOW()
      WHERE submitted_at < NOW() - INTERVAL '2 years'
        AND archived_at IS NULL
      RETURNING id`;
    results.enquiries_archived = archivedEnquiries.length;

    // 5. Hard-delete enquiries archived >30 days
    const deletedEnquiries = await sql`
      DELETE FROM enquiries
      WHERE archived_at IS NOT NULL
        AND archived_at < NOW() - INTERVAL '30 days'
      RETURNING id`;
    results.enquiries_deleted = deletedEnquiries.length;

    // 6. Clean up completed deletion requests >90 days
    const cleanedRequests = await sql`
      DELETE FROM deletion_requests
      WHERE status = 'completed'
        AND completed_at < NOW() - INTERVAL '90 days'
      RETURNING id`;
    results.requests_cleaned = cleanedRequests.length;

    // 7. Purge anonymized credit_transactions >7 years
    const purgedTx = await sql`
      DELETE FROM credit_transactions
      WHERE anonymized = true
        AND created_at < NOW() - INTERVAL '7 years'
      RETURNING id`;
    results.transactions_purged = purgedTx.length;

    // 7b. Purge anonymised lesson_bookings >7 years (PR-K, May 2026).
    //     Mirror credit_transactions retention — financial record, same legal
    //     basis. After this delete, the payout-line-items / school-payout-line
    //     items rows that reference these bookings via RESTRICT FK will block
    //     the delete; in practice payouts older than 7 years would already
    //     have been archived, but if any block we want the error visible.
    const purgedBookings = await sql`
      DELETE FROM lesson_bookings
      WHERE learner_anonymized = TRUE
        AND scheduled_date < NOW() - INTERVAL '7 years'
      RETURNING id`;
    results.bookings_purged = purgedBookings.length;

    // 8. Clean up old cookie consent records >2 years
    await sql`DELETE FROM cookie_consents WHERE consented_at < NOW() - INTERVAL '2 years'`;

    // 9. Clean up old rate-limit entries using a fixed conservative horizon.
    //    This must stay independent of individual endpoint windows so cleanup
    //    cannot reset an otherwise valid longer-lived limit.
    await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '7 days'`;

    // 10. Purge notification_log entries >90 days (PR-N, May 2026).
    //     Operational log for support triage, not a GDPR record. 90 days is
    //     well past the window where "did I get the email?" support tickets
    //     could plausibly land, and keeps the table from growing unboundedly.
    const purgedNotifications = await sql`
      DELETE FROM notification_log
      WHERE created_at < NOW() - INTERVAL '90 days'
      RETURNING id`;
    results.notifications_purged = purgedNotifications.length;

    // 11. Purge decided lesson requests >12 months (LESSON-REQUEST-PLAN.md).
    //     Once decided, the money facts live on the booking / credit ledger;
    //     the request row only documents the ask (incl. guest PII). Pending
    //     rows are never purged — the expire cron owns those, and their holds.
    try {
      const purgedRequests = await sql`
        DELETE FROM lesson_requests
        WHERE status <> 'pending'
          AND created_at < NOW() - INTERVAL '12 months'
        RETURNING id`;
      results.lesson_requests_purged = purgedRequests.length;
    } catch (e) { /* table may not exist yet */ }

    console.log('retention cron results:', results);
    return { ok: true, results };
  });
};
