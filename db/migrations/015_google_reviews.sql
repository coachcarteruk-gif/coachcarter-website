-- Google Reviews cache: stores reviews fetched from Google Places API
CREATE TABLE IF NOT EXISTS google_reviews (
  id                SERIAL PRIMARY KEY,
  review_id         TEXT UNIQUE NOT NULL,
  author_name       TEXT NOT NULL,
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text              TEXT,
  relative_time     TEXT,
  publish_time      TIMESTAMPTZ,
  profile_photo_url TEXT,
  cached_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_cached_at ON google_reviews(cached_at DESC);

-- Metadata: tracks when we last fetched and aggregate stats
CREATE TABLE IF NOT EXISTS google_reviews_meta (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  last_fetched_at TIMESTAMPTZ,
  place_id        TEXT,
  place_name      TEXT,
  overall_rating  NUMERIC(2,1),
  total_reviews   INTEGER
);
