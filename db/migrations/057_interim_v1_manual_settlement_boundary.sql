+-- Interim v1 manual-settlement handoff boundary.
--
-- Additive and inert: this migration creates no boundary row, payout, approval,
-- transfer, or Stripe operation. A row can be created only by the separately
-- confirmed superadmin route after the controlled instructor remains paused.

CREATE TABLE IF NOT EXISTS interim_v1_manual_settlement_boundaries (
  id UUID PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  instructor_id INTEGER NOT NULL,
  settled_before_at TIMESTAMPTZ NOT NULL,
  first_system_period_end_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'Europe/London',
  reason TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  created_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, instructor_id),
  FOREIGN KEY (instructor_id, school_id)
    REFERENCES instructors(id, school_id),
  CHECK (time_zone = 'Europe/London'),
  CHECK (first_system_period_end_at > settled_before_at),
  CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(evidence_reference), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_interim_v1_manual_boundary_scope
  ON interim_v1_manual_settlement_boundaries(
    school_id, instructor_id, settled_before_at
  );
CREATE INDEX IF NOT EXISTS idx_interim_v1_manual_boundary_admin
  ON interim_v1_manual_settlement_boundaries(created_by_admin_id);

DROP TRIGGER IF EXISTS interim_v1_manual_boundaries_append_only
  ON interim_v1_manual_settlement_boundaries;
CREATE TRIGGER interim_v1_manual_boundaries_append_only
  BEFORE UPDATE OR DELETE ON interim_v1_manual_settlement_boundaries
  FOR EACH ROW EXECUTE FUNCTION interim_v1_forbid_append_only_change();

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
     WHERE c.relname = 'interim_v1_instructor_controls'
       AND a.grantee <> c.relowner
       AND a.privilege_type = 'SELECT'
       AND r.rolcanlogin
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE public.interim_v1_manual_settlement_boundaries TO %I',
      runtime_role.rolname
    );
  END LOOP;
END $$;
