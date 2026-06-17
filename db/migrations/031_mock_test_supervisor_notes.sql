-- Persist supervisor mock-test hints and notes entered during private practice.
ALTER TABLE mock_tests
  ADD COLUMN IF NOT EXISTS supervisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb;
