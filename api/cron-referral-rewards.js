// Referral rewards cron — runs daily (04:00 UTC)
//
// GET /api/cron-referral-rewards
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//   or ?key=${CRON_SECRET} for manual trigger
//
// Recurring per-lesson rewards. For every completed paid lesson by a referred
// learner that finished more than 7 days ago and has not yet been rewarded,
// credit floor(duration_minutes / 3) minutes to the referrer.
//
// Idempotent: lesson_bookings.referral_rewarded_at acts as the per-booking
// idempotency key. The 7-day grace window protects against retroactive
// cancellations / disputes — see Phase 1a plan for the trade-off.
//
// Single-tier only: rewards flow once, from referee's lesson to direct
// referrer. parent_referral_id chains are not followed.

const { CHARGEABLE } = require('./_booking-status');
const { verifyCronAuth } = require('./_auth');
const { withCronLock } = require('./_cron-lock');
const { lockBalanceAndMutate } = require('./_credit-grant');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 300s — daily cron, candidate set is small; stamp-then-credit
  // is per-row idempotent already, lock is belt-and-braces.
  return withCronLock(req, res, 'cron-referral-rewards', 300, async (sql) => {
    const results = { scanned: 0, rewarded: 0, skipped_disabled: 0, skipped_no_referrer: 0, errors: 0 };

    // Pull every candidate booking in one query. Joins:
    //   - referee (the learner who took the lesson) must have referred_by set
    //   - referrer must exist and share school with the referee + booking
    //   - booking must be completed, paid (not free trial), past the grace window,
    //     and not already rewarded
    //
    // duration_minutes is computed from start/end times because booking rows
    // do not store duration directly.
    const candidates = await sql`
      SELECT
        lb.id                                                        AS booking_id,
        lb.school_id                                                 AS booking_school_id,
        lb.learner_id                                                AS referee_id,
        referee.referred_by                                          AS referrer_id,
        referee.school_id                                            AS referee_school_id,
        referrer.school_id                                           AS referrer_school_id,
        EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60       AS duration_minutes
      FROM lesson_bookings lb
      JOIN learner_users referee  ON referee.id  = lb.learner_id
      JOIN learner_users referrer ON referrer.id = referee.referred_by
      WHERE lb.status              = ${CHARGEABLE}
        AND lb.payment_method     <> 'free'
        AND lb.referral_rewarded_at IS NULL
        AND (lb.scheduled_date + lb.end_time) < NOW() - INTERVAL '7 days'
        AND referee.referred_by IS NOT NULL
    `;

    results.scanned = candidates.length;

    // Cache per-school referral config so we don't re-query inside the loop.
    const schoolConfigCache = new Map();
    async function getSchoolConfig(schoolId) {
      if (schoolConfigCache.has(schoolId)) return schoolConfigCache.get(schoolId);
      const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
      const config = school?.config || {};
      schoolConfigCache.set(schoolId, config);
      return config;
    }

    for (const c of candidates) {
      try {
        // School alignment guard. All three must match. Belt-and-braces — the
        // JOIN already ensures referrer exists, but in a multi-tenant world
        // a learner row could in theory be reassigned. Refuse cross-school.
        if (c.booking_school_id !== c.referee_school_id ||
            c.booking_school_id !== c.referrer_school_id) {
          results.errors++;
          continue;
        }

        // Per-school enable flag. Lets a school turn the whole feature off
        // without us having to drop rows from the system.
        const config = await getSchoolConfig(c.booking_school_id);
        if (!config.referral_enabled) {
          // Stamp the booking so it's not re-scanned next run. The reward is
          // permanently void if the school had it disabled at the moment the
          // grace window expired — by design.
          await sql`
            UPDATE lesson_bookings
               SET referral_rewarded_at = NOW()
             WHERE id = ${c.booking_id}
               AND referral_rewarded_at IS NULL
          `;
          results.skipped_disabled++;
          continue;
        }

        const rewardMinutes = Math.floor((c.duration_minutes || 0) / 3);
        if (rewardMinutes <= 0) {
          // Zero-duration or malformed booking — stamp and skip so we don't
          // keep re-scanning it forever.
          await sql`
            UPDATE lesson_bookings
               SET referral_rewarded_at = NOW()
             WHERE id = ${c.booking_id}
               AND referral_rewarded_at IS NULL
          `;
          continue;
        }

        // Atomic stamp-then-credit. The UPDATE...WHERE referral_rewarded_at IS NULL
        // is the idempotency guard — if two cron invocations race, only one
        // will succeed at flipping the column. RETURNING tells us whether we
        // were the winner; if not, skip the credit.
        const stamped = await sql`
          UPDATE lesson_bookings
             SET referral_rewarded_at = NOW()
           WHERE id = ${c.booking_id}
             AND referral_rewarded_at IS NULL
          RETURNING id
        `;
        if (stamped.length === 0) continue; // lost the race, another run paid this one

        // Step 4 cutover: balance + ledger written atomically inside one
        // CTE. The stamp-then-credit idempotency above guarantees only one
        // cron invocation reaches here per booking, so the LCB lock here
        // is racing against learner-side writers (purchases, cancellations)
        // rather than against itself.
        //
        // instructor_id grandfathers to 1 (Fraser) until a second instructor
        // is onboarded — per project_per_instructor_credits_plan.md, the
        // referral reward is platform-funded and isn't scoped to a specific
        // instructor today.
        await lockBalanceAndMutate(sql, {
          learnerId: c.referrer_id,
          schoolId: c.booking_school_id,
          instructorId: 1,
          delta: rewardMinutes,
          ledgerType: 'referral_reward',
          reason: 'referral',
          source: 'goodwill',
          absorbedBy: 'platform',
          allowOverdraft: true,
        });

        results.rewarded++;
      } catch (innerErr) {
        results.errors++;
        // Don't reportError per-row — that would spam on a sustained outage.
        // The outer catch handles total failures; per-row failures are
        // surfaced in the response counter for the manual triggerer to inspect.
        console.warn('referral reward row failed', { booking_id: c.booking_id, err: innerErr.message });
      }
    }

    return { ok: true, ...results };
  });
};
