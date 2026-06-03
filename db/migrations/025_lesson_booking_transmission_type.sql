-- 025: Persist the actual transmission used for each lesson booking.
-- Instructor profiles can be 'both', but an individual lesson is either
-- manual or automatic so calendars and edits have a concrete value.

ALTER TABLE lesson_bookings
  ADD COLUMN IF NOT EXISTS transmission_type TEXT;

UPDATE lesson_bookings lb
   SET transmission_type = CASE
     WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic'
     ELSE 'manual'
   END
  FROM instructors i
 WHERE i.id = lb.instructor_id
   AND (lb.transmission_type IS NULL OR lb.transmission_type NOT IN ('manual','automatic'));

UPDATE lesson_bookings
   SET transmission_type = 'manual'
 WHERE transmission_type IS NULL
    OR transmission_type NOT IN ('manual','automatic');

ALTER TABLE lesson_bookings
  ALTER COLUMN transmission_type SET DEFAULT 'manual';

ALTER TABLE lesson_bookings
  ALTER COLUMN transmission_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_lesson_bookings_transmission_type'
  ) THEN
    ALTER TABLE lesson_bookings
      ADD CONSTRAINT chk_lesson_bookings_transmission_type
      CHECK (transmission_type IN ('manual','automatic'));
  END IF;
END $$;
