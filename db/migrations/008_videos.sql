-- ============================================================
-- Migration 008 — Video library
-- Moves video management from a static JSON file to the database.
-- Supports categories, ordering, thumbnails, and visibility.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

-- Video categories (groups)
CREATE TABLE IF NOT EXISTS video_categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT    UNIQUE NOT NULL,      -- e.g. 'roundabouts'
  label       TEXT    NOT NULL,             -- e.g. 'Roundabouts'
  sort_order  INTEGER NOT NULL DEFAULT 0,   -- lower = shown first
  color       TEXT,                         -- CSS color for tag, e.g. 'rgba(245,131,33,0.25)'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default categories
INSERT INTO video_categories (slug, label, sort_order, color) VALUES
  ('roundabouts',  'Roundabouts',            1, 'rgba(245,131,33,0.25)'),
  ('manoeuvres',   'Manoeuvres',             2, 'rgba(99,179,237,0.25)'),
  ('lesson-vibes', 'Lesson Vibes',           3, 'rgba(154,117,245,0.25)'),
  ('course',       'Learn to Drive Course',  4, 'rgba(52,211,153,0.25)')
ON CONFLICT (slug) DO NOTHING;

-- Videos
CREATE TABLE IF NOT EXISTS videos (
  id            SERIAL PRIMARY KEY,
  cloudflare_uid TEXT    NOT NULL,             -- Cloudflare Stream video UID
  title         TEXT    NOT NULL,
  description   TEXT,
  category_slug TEXT    NOT NULL REFERENCES video_categories(slug),
  thumbnail_url TEXT,                          -- poster image URL (optional, CF Stream can generate)
  sort_order    INTEGER NOT NULL DEFAULT 0,    -- within category, lower = shown first
  published     BOOLEAN NOT NULL DEFAULT TRUE, -- hide without deleting
  learner_only  BOOLEAN NOT NULL DEFAULT FALSE,-- if true, only shown in learner portal
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category_slug);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published);

-- Migrate existing videos from JSON (run once manually if needed):
-- INSERT INTO videos (cloudflare_uid, title, description, category_slug)
-- SELECT uid, title, description, "group" FROM json_to_recordset($JSON$) AS x(uid text, title text, description text, "group" text);
