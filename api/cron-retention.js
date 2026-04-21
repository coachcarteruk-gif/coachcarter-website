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

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  const results = { soft_archived: 0, hard_deleted: 0, enquiries_archived: 0, enquiries_deleted: 0, requests_cleaned: 0, transactions_purged: 0 };

  try {
    const sql = neon(process.env.POSTGRES_URL);

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
        // Anonymize credit_transactions
        await sql`UPDATE credit_transactions SET learner_id = NULL, anonymized = true WHERE learner_id = ${learner.id}`;

        // Delete related records using parameterized queries (no dynamic identifiers)
        const lid = learner.id;
        try { await sql`DELETE FROM skill_ratings WHERE user_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM driving_sessions WHERE user_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM quiz_results WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM mock_test_faults WHERE mock_test_id IN (SELECT id FROM mock_tests WHERE learner_id = ${lid})`; } catch (e) {}
        try { await sql`DELETE FROM mock_tests WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM focused_practice_sessions WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM sent_reminders WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${lid})`; } catch (e) {}
        try { await sql`DELETE FROM slot_reservations WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM lesson_confirmations WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${lid})`; } catch (e) {}
        try { await sql`DELETE FROM lesson_bookings WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM learner_onboarding WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM waitlist WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM instructor_learner_notes WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM learner_availability WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM deletion_requests WHERE learner_id = ${lid}`; } catch (e) {}
        try { await sql`UPDATE learner_users SET referred_by = NULL WHERE referred_by = ${lid}`; } catch (e) {}
        try { await sql`DELETE FROM referrals WHERE learner_id = ${lid}`; } catch (e) {}
        await sql`UPDATE cookie_consents SET learner_id = NULL WHERE learner_id = ${learner.id}`;
        if (learner.email) {
          try { await sql`DELETE FROM magic_link_tokens WHERE email = ${learner.email}`; } catch (e) {}
        }
        await sql`DELETE FROM learner_users WHERE id = ${learner.id}`;
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

    // 8. Clean up old cookie consent records >2 years
    await sql`DELETE FROM cookie_consents WHERE consented_at < NOW() - INTERVAL '2 years'`;

    // 9. Clean up expired rate limit entries
    await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 hours'`;

    console.log('retention cron results:', results);
    return res.json({ ok: true, results });
  } catch (err) {
    console.error('cron-retention error:', err);
    reportError('/api/cron-retention', err);
    return res.status(500).json({ error: 'Retention cron failed', details: 'Internal server error' });
  }
};
