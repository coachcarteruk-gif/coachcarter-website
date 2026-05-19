-- PR-G post-migration verification
--
-- Run AFTER hitting /api/migrate?secret=... to confirm both UNIQUE
-- indexes landed. Should return exactly two rows.

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('uq_credit_tx_session', 'uq_slot_reservation_slot')
ORDER BY indexname;
