-- Migration 058 recreated these views and thereby removed their ACLs.
-- Restore SELECT only for roles already entitled to read every underlying
-- ledger. Include NOLOGIN group roles: production login rotation uses inherited
-- grants, so filtering to rolcanlogin would silently miss the runtime role.
DO $restore_flexible_read_access$
DECLARE reader RECORD;
BEGIN
  FOR reader IN
    SELECT DISTINCT r.rolname
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE c.oid = 'public.flexible_package_sources'::regclass
       AND a.grantee <> c.relowner
       AND a.privilege_type = 'SELECT'
       AND has_table_privilege(r.oid, 'public.flexible_package_booking_allocations', 'SELECT')
       AND has_table_privilege(r.oid, 'public.flexible_package_allocation_returns', 'SELECT')
       AND has_table_privilege(r.oid, 'public.flexible_package_source_reductions', 'SELECT')
  LOOP
    EXECUTE format('GRANT SELECT ON public.flexible_package_balances, public.flexible_package_source_remaining TO %I', reader.rolname);
  END LOOP;
END;
$restore_flexible_read_access$;
