-- Meta Pixel is advertising technology and must not inherit analytics consent.
-- Store the visitor's explicit marketing choice alongside the existing audit row.
ALTER TABLE cookie_consents
  ADD COLUMN IF NOT EXISTS marketing BOOLEAN NOT NULL DEFAULT FALSE;
