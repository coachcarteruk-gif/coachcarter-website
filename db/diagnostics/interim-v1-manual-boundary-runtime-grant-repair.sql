-- Interim v1 manual-boundary Production runtime permission repair.
--
-- Read-only catalogue verification on 10 September 2026 proved that the
-- active Production login inherits interim-v1 access from this NOLOGIN grant
-- role. Migration 057 skipped it because that migration filtered on
-- rolcanlogin. Match the role's existing SELECT and INSERT control-table
-- privileges without adding UPDATE, DELETE, or TRUNCATE.
GRANT SELECT, INSERT
ON TABLE public.interim_v1_manual_settlement_boundaries
TO cc_prod_runtime_20260816;
