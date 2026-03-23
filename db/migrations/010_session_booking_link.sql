-- 009: Link driving sessions to completed bookings
-- Adds booking_id to driving_sessions so session logs can be tied to specific lessons.

ALTER TABLE driving_sessions
  ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES lesson_bookings(id);

-- One session log per booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_driving_sessions_booking
  ON driving_sessions (booking_id)
  WHERE booking_id IS NOT NULL;
