-- 022: Inbound iCal feed sync for instructors
-- Allows instructors to paste their personal calendar's iCal URL
-- so personal events auto-block booking slots.

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_feed_url TEXT;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_last_synced_at TIMESTAMPTZ;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS ical_sync_error TEXT;

CREATE TABLE IF NOT EXISTS instructor_external_events (
  id              SERIAL PRIMARY KEY,
  instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  event_date      DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  is_all_day      BOOLEAN NOT NULL DEFAULT FALSE,
  uid_hash        TEXT NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_events_instructor_date
  ON instructor_external_events(instructor_id, event_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_events_dedup
  ON instructor_external_events(instructor_id, uid_hash);
