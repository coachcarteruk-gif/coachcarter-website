-- Local implementation only. No campaign/sender activation or existing data deletion.
CREATE TABLE giveaway_marketing_suppressions (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, channel, subject_hash)
);
