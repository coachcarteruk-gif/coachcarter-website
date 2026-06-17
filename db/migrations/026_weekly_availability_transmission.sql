-- 026: Transmission type for recurring weekly instructor availability.
-- Lets dual-car instructors mark normal weekly windows as manual, automatic,
-- or usable for either transmission.

ALTER TABLE instructor_availability
  ADD COLUMN IF NOT EXISTS transmission_type TEXT;

UPDATE instructor_availability ia
   SET transmission_type = CASE
     WHEN COALESCE(i.transmission_type, 'manual') IN ('automatic', 'both')
       THEN COALESCE(i.transmission_type, 'manual')
     ELSE 'manual'
   END
  FROM instructors i
 WHERE i.id = ia.instructor_id
   AND i.school_id = ia.school_id
   AND (ia.transmission_type IS NULL OR ia.transmission_type NOT IN ('manual','automatic','both'));

UPDATE instructor_availability
   SET transmission_type = 'manual'
 WHERE transmission_type IS NULL
    OR transmission_type NOT IN ('manual','automatic','both');

ALTER TABLE instructor_availability
  ALTER COLUMN transmission_type SET DEFAULT 'both';

ALTER TABLE instructor_availability
  ALTER COLUMN transmission_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_instructor_availability_transmission_type'
       AND conrelid = 'instructor_availability'::regclass
  ) THEN
    ALTER TABLE instructor_availability
      ADD CONSTRAINT chk_instructor_availability_transmission_type
      CHECK (transmission_type IN ('manual','automatic','both'));
  END IF;
END $$;
