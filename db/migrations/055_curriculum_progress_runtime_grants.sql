-- Grant the existing application runtime role access to the curriculum tables.
--
-- Production uses a restricted login role rather than the migration owner. Find
-- that role by its existing access to the three application anchor tables so no
-- environment-specific role name is stored in source control.

DO $$
DECLARE
  runtime_role RECORD;
BEGIN
  FOR runtime_role IN
    SELECT DISTINCT r.rolname
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
       AND n.nspname = 'public'
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE c.relname = 'lesson_bookings'
       AND a.grantee <> c.relowner
       AND a.privilege_type = 'SELECT'
       AND r.rolcanlogin
       AND has_table_privilege(r.rolname, 'public.schools', 'SELECT')
       AND has_table_privilege(r.rolname, 'public.driving_sessions', 'SELECT')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.curriculum_review_submissions TO %I',
      runtime_role.rolname
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, DELETE ON TABLE public.curriculum_rating_events TO %I',
      runtime_role.rolname
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, DELETE ON TABLE public.curriculum_completion_events TO %I',
      runtime_role.rolname
    );
    EXECUTE format(
      'GRANT SELECT, USAGE ON SEQUENCE public.curriculum_review_submissions_id_seq TO %I',
      runtime_role.rolname
    );
    EXECUTE format(
      'GRANT SELECT, USAGE ON SEQUENCE public.curriculum_rating_events_id_seq TO %I',
      runtime_role.rolname
    );
    EXECUTE format(
      'GRANT SELECT, USAGE ON SEQUENCE public.curriculum_completion_events_id_seq TO %I',
      runtime_role.rolname
    );
  END LOOP;
END $$;
