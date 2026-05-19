-- PR-H pre-migration diagnostics
--
-- Run against PROD before deploying PR-H.
--
-- Zero rows from both queries means the new school_payout_line_items table
-- can be backfilled cleanly. Non-zero rows from query 1 means historical
-- school_payouts.booking_ids arrays contain the same booking_id across two
-- or more 'completed' rows — the uq_school_payout_booking constraint would
-- reject the backfill. That would mean a real prior double-pay; investigate
-- before proceeding.

-- ──────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC 1 — duplicate booking_id across completed school_payouts
-- ──────────────────────────────────────────────────────────────────────────
-- Each returned row is one booking_id that appears in more than one
-- 'completed' school_payouts.booking_ids array.

SELECT b_id AS booking_id,
       COUNT(*) AS payout_count,
       array_agg(sp.id ORDER BY sp.id) AS school_payout_ids
FROM school_payouts sp,
     unnest(sp.booking_ids) AS b_id
WHERE sp.status = 'completed'
GROUP BY b_id
HAVING COUNT(*) > 1;

-- ──────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC 2 — count of bookings about to be backfilled
-- ──────────────────────────────────────────────────────────────────────────
-- Sanity check. Should match the total of unnested booking_ids from
-- 'completed' payouts. If zero, this PR doesn't change anything yet
-- (no historical payouts to backfill).

SELECT COUNT(*) AS expected_line_items
FROM school_payouts sp,
     unnest(sp.booking_ids) AS b_id
WHERE sp.status = 'completed'
  AND array_length(sp.booking_ids, 1) > 0;
