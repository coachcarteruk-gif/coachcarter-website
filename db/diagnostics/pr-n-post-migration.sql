-- PR-N post-migration diagnostics
-- Run AFTER triggering /api/migrate?secret=… to confirm the migration applied.

-- ── 1. Table exists with the expected columns ─────────────────────────────────
-- Expect: id (integer), channel (text), purpose (text), recipient (text),
-- learner_id (integer, nullable), instructor_id (integer, nullable),
-- payload_summary (text, nullable), delivery_status (text), error_message
-- (text, nullable), school_id (integer, NOT NULL, default 1), created_at
-- (timestamp with time zone, default now()).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'notification_log'
ORDER BY ordinal_position;

-- ── 2. CHECK constraints applied ──────────────────────────────────────────────
-- Expect two CHECK constraints: channel ∈ {email,sms,whatsapp},
-- delivery_status ∈ {sent,failed,skipped}.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'notification_log'::regclass AND contype = 'c'
ORDER BY conname;

-- ── 3. Foreign keys present and pointing the right way ────────────────────────
-- Expect three FKs: learner_id → learner_users(id), instructor_id →
-- instructors(id), school_id → schools(id). The first two ON DELETE SET NULL,
-- the school FK NO ACTION (default).
SELECT conname,
       pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'notification_log'::regclass AND contype = 'f'
ORDER BY conname;

-- ── 4. Indexes created ────────────────────────────────────────────────────────
-- Expect four: idx_notif_log_school, idx_notif_log_learner (partial),
-- idx_notif_log_recipient, idx_notif_log_failed (partial).
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'notification_log'
ORDER BY indexname;

-- ── 5. Row count — should be zero immediately after migration ─────────────────
SELECT COUNT(*) AS notification_log_rows FROM notification_log;
