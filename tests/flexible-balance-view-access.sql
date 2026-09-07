-- Disposable clone only. Replace RESTORE_MIGRATION_HERE with the contents of
-- migration 059 before execution. The inner subtransaction rolls all ACL changes
-- back after testing both the NOLOGIN grant role and its active login member.
DO $permission_test$
BEGIN
  BEGIN
    REVOKE SELECT ON public.flexible_package_balances, public.flexible_package_source_remaining FROM cc_prod_runtime_20260816;
    IF has_table_privilege('cc_prod_runtime_20260830','public.flexible_package_balances','SELECT') THEN
      RAISE EXCEPTION 'Fixture does not reproduce the lost balance permission';
    END IF;
    -- RESTORE_MIGRATION_HERE
    IF NOT has_table_privilege('cc_prod_runtime_20260816','public.flexible_package_balances','SELECT')
       OR NOT has_table_privilege('cc_prod_runtime_20260830','public.flexible_package_balances','SELECT')
       OR NOT has_table_privilege('cc_prod_runtime_20260830','public.flexible_package_source_remaining','SELECT') THEN
      RAISE EXCEPTION 'Restricted inherited runtime role cannot read restored balances';
    END IF;
    IF has_table_privilege('cc_prod_runtime_20260830','public.flexible_package_balances','UPDATE') THEN
      RAISE EXCEPTION 'Repair granted unnecessary write permission';
    END IF;
    RAISE EXCEPTION USING ERRCODE='Z0002', MESSAGE='rollback successful permission regression test';
  EXCEPTION WHEN SQLSTATE 'Z0002' THEN NULL;
  END;
END;
$permission_test$;
