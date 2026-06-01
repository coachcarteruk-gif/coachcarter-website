-- 024: Transmission type for one-off instructor availability slots
-- Lets instructors mark a date-specific available slot as manual, automatic,
-- or usable for either transmission.

ALTER TABLE instructor_availability_overrides
  ADD COLUMN IF NOT EXISTS transmission_type TEXT;

UPDATE instructor_availability_overrides
   SET transmission_type = 'both'
 WHERE transmission_type IS NULL
    OR transmission_type NOT IN ('manual','automatic','both');

ALTER TABLE instructor_availability_overrides
  ALTER COLUMN transmission_type SET DEFAULT 'both';

ALTER TABLE instructor_availability_overrides
  ALTER COLUMN transmission_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_instructor_availability_overrides_transmission_type'
       AND conrelid = 'instructor_availability_overrides'::regclass
  ) THEN
    ALTER TABLE instructor_availability_overrides
      ADD CONSTRAINT chk_instructor_availability_overrides_transmission_type
      CHECK (transmission_type IN ('manual','automatic','both'));
  END IF;
END $$;
