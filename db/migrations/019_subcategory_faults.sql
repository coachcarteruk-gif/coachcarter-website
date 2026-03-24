-- 019: Add sub_key column for DL25 subcategory fault detail
-- Nullable — when NULL the fault is against the parent skill only.
-- When set, identifies the specific DL25 subcategory (e.g. 'turning_left' under junctions_21).

ALTER TABLE mock_test_faults ADD COLUMN IF NOT EXISTS sub_key TEXT;
