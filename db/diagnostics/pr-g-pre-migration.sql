-- PR-G pre-migration diagnostics
--
-- Run this against PROD before deploying PR-G.
--
-- Both queries return zero rows if the new UNIQUE constraints would apply
-- cleanly. Non-zero rows mean duplicates exist and the constraint creation
-- will fail (the migrate runner records the error but continues, so the
-- constraint silently stays unapplied if you don't read the response).
--
-- If either query returns rows, run the cleanup blocks at the bottom (read
-- before running — they delete rows) before re-attempting the migration.

-- ──────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC 1 — credit_transactions duplicate stripe_session_id
-- ──────────────────────────────────────────────────────────────────────────
-- Each row returned is one stripe_session_id that has more than one row.
-- `dupe_count` is how many rows share that session_id. `row_ids` lists them.

SELECT
  stripe_session_id,
  COUNT(*)                       AS dupe_count,
  array_agg(id ORDER BY id)      AS row_ids,
  array_agg(type ORDER BY id)    AS types,
  array_agg(created_at ORDER BY id) AS created_at_list
FROM credit_transactions
WHERE stripe_session_id IS NOT NULL
GROUP BY stripe_session_id
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;

-- ──────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC 2 — slot_reservations duplicate slot tuples
-- ──────────────────────────────────────────────────────────────────────────
-- Includes both active and expired reservations because the new UNIQUE index
-- is unconditional. The migration assumes the DELETE-expired step at the
-- top of slots.js's checkout-slot handler keeps the table mostly clean.

SELECT
  instructor_id,
  scheduled_date,
  start_time,
  COUNT(*)                          AS dupe_count,
  array_agg(id ORDER BY id)         AS row_ids,
  array_agg(learner_id ORDER BY id) AS learner_ids,
  array_agg(expires_at ORDER BY id) AS expires_at_list
FROM slot_reservations
GROUP BY instructor_id, scheduled_date, start_time
HAVING COUNT(*) > 1
ORDER BY MAX(expires_at) DESC;

-- ──────────────────────────────────────────────────────────────────────────
-- (Read before running) CLEANUP — credit_transactions
-- ──────────────────────────────────────────────────────────────────────────
-- Keeps the OLDEST row for each duplicated stripe_session_id. Rationale:
-- the first webhook (or first verify-session) is the one that initiated
-- the credit grant on learner_users; later duplicates re-incremented the
-- balance. Deleting later rows aligns the credit_transactions ledger with
-- the actual money received from Stripe (one charge → one row).
--
-- IMPORTANT: this does NOT undo the duplicate credit increments on
-- learner_users.credit_balance / balance_minutes. If diagnostic 1 returns
-- rows, you need to follow up by manually reconciling those balances
-- (the dupe_count - 1 extra credits/minutes per session_id need subtracting).
-- The dollar value is recorded in amount_pence; sum it before deleting if
-- you want a full audit trail.

-- BEGIN;
-- WITH dupes AS (
--   SELECT id,
--          ROW_NUMBER() OVER (PARTITION BY stripe_session_id ORDER BY id ASC) AS rn
--   FROM credit_transactions
--   WHERE stripe_session_id IS NOT NULL
-- )
-- DELETE FROM credit_transactions
-- WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
-- -- Inspect deleted count, then COMMIT or ROLLBACK.

-- ──────────────────────────────────────────────────────────────────────────
-- (Read before running) CLEANUP — slot_reservations
-- ──────────────────────────────────────────────────────────────────────────
-- Keeps the row with the LATEST expires_at for each duplicated slot tuple,
-- since that's the most recently created reservation. Older duplicates are
-- almost certainly expired and harmless, but the unique index doesn't care
-- about expires_at — only existence.

-- BEGIN;
-- WITH dupes AS (
--   SELECT id,
--          ROW_NUMBER() OVER (
--            PARTITION BY instructor_id, scheduled_date, start_time
--            ORDER BY expires_at DESC, id DESC
--          ) AS rn
--   FROM slot_reservations
-- )
-- DELETE FROM slot_reservations
-- WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
-- -- Inspect deleted count, then COMMIT or ROLLBACK.
