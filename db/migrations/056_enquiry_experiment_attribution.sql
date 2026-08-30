BEGIN;

ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS experiment_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS experiment_variant VARCHAR(50),
  ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_enquiries_school_experiment
  ON enquiries (school_id, experiment_key, experiment_variant, submitted_at DESC)
  WHERE experiment_key IS NOT NULL;

COMMIT;
