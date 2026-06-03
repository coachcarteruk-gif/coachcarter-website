-- Public tenant resolution foundation.
-- Adds host-based school lookup and blocks creating non-default schools until
-- legacy public endpoints have been swept away from silent school_id=1 defaults.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_host TEXT;

UPDATE schools
   SET primary_host = 'www.coachcarter.uk'
 WHERE id = 1
   AND (primary_host IS NULL OR TRIM(primary_host) = '');

CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_primary_host_lower
  ON schools (LOWER(primary_host))
  WHERE primary_host IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_public_endpoints_tenant_resolved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> 1 AND NOT EXISTS (
    SELECT 1 FROM migration_markers
     WHERE key = 'public_endpoints_tenant_resolved'
  ) THEN
    RAISE EXCEPTION 'Cannot create school id=% - public endpoints still have legacy school_id=1 defaults. Sweep public tenant resolution and insert migration marker public_endpoints_tenant_resolved first.', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schools_require_tenant_resolution ON schools;
CREATE TRIGGER trg_schools_require_tenant_resolution
  BEFORE INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION assert_public_endpoints_tenant_resolved();
