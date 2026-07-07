-- Migration 033: lesson booking test-date metadata
-- Keeps paid/test-date booking writers in sync with production databases that
-- apply numbered migrations rather than the monolithic db/migration.sql file.

ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS booking_purpose TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS test_start_time TEXT;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS test_centre TEXT;

ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS chk_lesson_bookings_booking_purpose;
ALTER TABLE lesson_bookings ADD CONSTRAINT chk_lesson_bookings_booking_purpose
  CHECK (booking_purpose IN ('lesson', 'test_date'));

CREATE INDEX IF NOT EXISTS idx_lesson_bookings_test_date_purpose
  ON lesson_bookings(school_id, booking_purpose, scheduled_date)
  WHERE booking_purpose = 'test_date';
