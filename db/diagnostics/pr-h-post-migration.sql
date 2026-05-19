-- PR-H post-migration verification
--
-- Run AFTER hitting /api/migrate?secret=... .

-- 1. Confirm the table + index landed.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('uq_school_payout_booking', 'idx_school_payout_lines_payout')
ORDER BY indexname;
-- Expect: 2 rows.

-- 2. Confirm the backfill matched what diagnostic 2 predicted.
SELECT
  (SELECT COUNT(*) FROM school_payout_line_items)                 AS line_items_actual,
  (SELECT COUNT(*) FROM school_payouts sp,
                        unnest(sp.booking_ids) AS b_id
     WHERE sp.status = 'completed'
       AND array_length(sp.booking_ids, 1) > 0)                   AS source_count_expected;
-- Expect: line_items_actual == source_count_expected.

-- 3. Confirm no orphan 'processing' rows remain (they should have been
-- cleared by the migration UPDATE).
SELECT id, school_id, period_start, period_end
FROM school_payouts
WHERE status = 'processing';
-- Expect: 0 rows.
