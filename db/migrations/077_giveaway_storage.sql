-- Additive, no campaign seed, no activation. Governed runner supplies transaction.
CREATE TABLE giveaway_campaigns (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  campaign_key TEXT NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  retain_until TIMESTAMPTZ NOT NULL CHECK (retain_until > closes_at),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (school_id, campaign_key)
);
CREATE TABLE giveaway_nominations (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  id UUID NOT NULL,
  campaign_key TEXT NOT NULL,
  submission_key UUID NOT NULL,
  pair_hash TEXT NOT NULL,
  token_hash TEXT,
  nomination JSONB NOT NULL,
  application JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  erasure_requested_at TIMESTAMPTZ,
  crm_state JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (school_id, id),
  UNIQUE (school_id, campaign_key, submission_key),
  UNIQUE (school_id, campaign_key, pair_hash),
  UNIQUE (school_id, token_hash),
  FOREIGN KEY (school_id, campaign_key) REFERENCES giveaway_campaigns(school_id, campaign_key),
  CHECK (jsonb_typeof(nomination) = 'object'),
  CHECK (application IS NULL OR jsonb_typeof(application) = 'object'),
  CHECK ((application IS NULL) = (submitted_at IS NULL))
);
CREATE INDEX idx_giveaway_nomination_campaign ON giveaway_nominations(school_id, campaign_key, created_at);
CREATE TABLE giveaway_consents (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  nomination_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  granted BOOLEAN NOT NULL,
  wording TEXT NOT NULL,
  version TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  PRIMARY KEY (school_id, nomination_id, channel),
  FOREIGN KEY (school_id, nomination_id) REFERENCES giveaway_nominations(school_id, id) ON DELETE CASCADE
);
CREATE TABLE giveaway_jobs (
  school_id INTEGER NOT NULL REFERENCES schools(id),
  id UUID NOT NULL,
  nomination_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invitation','crm','suppression')),
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','dispatching','succeeded','uncertain','cancelled')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  claim_token UUID,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (school_id, id),
  UNIQUE (school_id, nomination_id, kind, event_key),
  FOREIGN KEY (school_id, nomination_id) REFERENCES giveaway_nominations(school_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_giveaway_job_nomination ON giveaway_jobs(school_id, nomination_id);
CREATE INDEX idx_giveaway_job_claim ON giveaway_jobs(school_id, kind, state, available_at);
CREATE INDEX idx_giveaway_job_lease ON giveaway_jobs(school_id, state, lease_until);
