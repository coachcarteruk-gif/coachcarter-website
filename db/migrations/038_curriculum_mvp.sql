-- Curriculum MVP: school-scoped topic graph and named conversations.
-- Safe to re-run. Nothing in this migration deletes curriculum history.

CREATE TABLE IF NOT EXISTS curriculum_topics (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  name                  TEXT NOT NULL,
  name_normalized       TEXT NOT NULL,
  description           TEXT,
  parent_topic_id       BIGINT,
  created_by_type       TEXT NOT NULL CHECK (created_by_type IN ('instructor', 'admin')),
  created_by_id         BIGINT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at           TIMESTAMPTZ,
  archived_by_admin_id  BIGINT,
  merged_into_topic_id  BIGINT,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR char_length(description) <= 1200),
  CHECK (parent_topic_id IS NULL OR parent_topic_id <> id),
  CHECK (merged_into_topic_id IS NULL OR merged_into_topic_id <> id),
  FOREIGN KEY (parent_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (merged_into_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_topics_active_name
  ON curriculum_topics(school_id, name_normalized)
  WHERE archived_at IS NULL AND merged_into_topic_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_curriculum_topics_school_parent
  ON curriculum_topics(school_id, parent_topic_id, name_normalized);

CREATE INDEX IF NOT EXISTS idx_curriculum_topics_school_activity
  ON curriculum_topics(school_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_curriculum_topics_merged
  ON curriculum_topics(merged_into_topic_id, school_id)
  WHERE merged_into_topic_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS curriculum_topic_connections (
  id               BIGSERIAL PRIMARY KEY,
  school_id        INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  left_topic_id    BIGINT NOT NULL,
  right_topic_id   BIGINT NOT NULL,
  label            TEXT,
  created_by_type  TEXT NOT NULL CHECK (created_by_type IN ('instructor', 'admin')),
  created_by_id    BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (left_topic_id < right_topic_id),
  CHECK (label IS NULL OR char_length(label) <= 180),
  FOREIGN KEY (left_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (right_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  UNIQUE (school_id, left_topic_id, right_topic_id)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_connections_left
  ON curriculum_topic_connections(school_id, left_topic_id);

CREATE INDEX IF NOT EXISTS idx_curriculum_connections_right
  ON curriculum_topic_connections(school_id, right_topic_id);

CREATE TABLE IF NOT EXISTS curriculum_contributions (
  id                      BIGSERIAL PRIMARY KEY,
  school_id               INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  topic_id                 BIGINT NOT NULL,
  prompt_key               TEXT NOT NULL CHECK (prompt_key IN (
    'understand',
    'demonstrate',
    'mistakes',
    'approaches',
    'prerequisites',
    'ready',
    'thoughts'
  )),
  parent_contribution_id   BIGINT,
  response_type            TEXT CHECK (response_type IS NULL OR response_type IN (
    'build_on',
    'alternative',
    'example',
    'question',
    'connect_topic'
  )),
  linked_topic_id          BIGINT,
  author_type              TEXT NOT NULL CHECK (author_type IN ('instructor', 'admin')),
  author_id                BIGINT NOT NULL,
  body                     TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at                TIMESTAMPTZ,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 5000),
  CHECK (
    (parent_contribution_id IS NULL AND response_type IS NULL)
    OR parent_contribution_id IS NOT NULL
  ),
  CONSTRAINT curriculum_contribution_link_contract CHECK (
    (response_type = 'connect_topic' AND linked_topic_id IS NOT NULL)
    OR (response_type IS DISTINCT FROM 'connect_topic' AND linked_topic_id IS NULL)
  ),
  FOREIGN KEY (topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id),
  FOREIGN KEY (parent_contribution_id, school_id)
    REFERENCES curriculum_contributions(id, school_id),
  FOREIGN KEY (linked_topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);

DO $$ BEGIN
  ALTER TABLE curriculum_contributions
    ADD CONSTRAINT curriculum_contribution_link_contract CHECK (
      (response_type = 'connect_topic' AND linked_topic_id IS NOT NULL)
      OR (response_type IS DISTINCT FROM 'connect_topic' AND linked_topic_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_topic_prompt
  ON curriculum_contributions(school_id, topic_id, prompt_key, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_parent
  ON curriculum_contributions(parent_contribution_id, school_id)
  WHERE parent_contribution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_curriculum_contributions_author
  ON curriculum_contributions(school_id, author_type, author_id);

CREATE TABLE IF NOT EXISTS curriculum_structural_suggestions (
  id                    BIGSERIAL PRIMARY KEY,
  school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  topic_id               BIGINT NOT NULL,
  suggestion_type       TEXT NOT NULL CHECK (suggestion_type IN (
    'rename',
    'move',
    'archive',
    'merge',
    'connection',
    'other'
  )),
  details                TEXT NOT NULL,
  suggested_by_type      TEXT NOT NULL CHECK (suggested_by_type IN ('instructor', 'admin')),
  suggested_by_id        BIGINT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at            TIMESTAMPTZ,
  reviewed_by_admin_id   BIGINT,
  review_note            TEXT,
  UNIQUE (id, school_id),
  CHECK (char_length(BTRIM(details)) BETWEEN 1 AND 2000),
  CHECK (review_note IS NULL OR char_length(review_note) <= 1200),
  FOREIGN KEY (topic_id, school_id)
    REFERENCES curriculum_topics(id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_suggestions_school_status
  ON curriculum_structural_suggestions(school_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_curriculum_suggestions_topic
  ON curriculum_structural_suggestions(school_id, topic_id, created_at DESC);

INSERT INTO curriculum_topics (
  school_id,
  name,
  name_normalized,
  description,
  created_by_type,
  created_by_id
)
SELECT
  s.id,
  seed.name,
  LOWER(seed.name),
  seed.description,
  'admin',
  0
FROM schools s
CROSS JOIN (
  VALUES
    ('Controls', 'Explore how learners understand and use the vehicle controls.'),
    ('Junctions', 'Explore observation, judgement, positioning, and decision-making at junctions.'),
    ('Manoeuvres', 'Explore the skills, teaching approaches, and judgement involved in manoeuvres.')
) AS seed(name, description)
ON CONFLICT (school_id, name_normalized)
  WHERE archived_at IS NULL AND merged_into_topic_id IS NULL
DO NOTHING;
