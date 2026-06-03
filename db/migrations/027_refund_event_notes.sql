-- Refund event notes timeline for operator context, evidence, incidents, and
-- repair decisions. Context-only: this does not mutate refund accounting.

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school
  ON refund_events(id, school_id);

CREATE TABLE IF NOT EXISTS refund_event_notes (
  id                                  SERIAL PRIMARY KEY,
  school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  refund_event_id                     INTEGER NOT NULL,
  created_by                          INTEGER REFERENCES admin_users(id),
  note_type                           TEXT NOT NULL CHECK (
    note_type IN ('operator_note', 'evidence', 'incident', 'repair_decision')
  ),
  incident_status                     TEXT NOT NULL DEFAULT 'not_applicable' CHECK (
    incident_status IN ('open', 'watching', 'resolved', 'not_applicable')
  ),
  body                                TEXT NOT NULL,
  evidence_reference                  TEXT,
  metadata                            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT refund_event_notes_event_school_fk
    FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id),
  CHECK (note_type = 'incident' OR incident_status = 'not_applicable')
);

DO $$
BEGIN
  IF to_regclass('public.refund_event_notes') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid = 'public.refund_event_notes'::regclass
          AND conname = 'refund_event_notes_event_school_fk'
     ) THEN
    ALTER TABLE refund_event_notes
      ADD CONSTRAINT refund_event_notes_event_school_fk
      FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refund_event_notes_school
  ON refund_event_notes(school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refund_event_notes_event
  ON refund_event_notes(refund_event_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_refund_event_notes_incident
  ON refund_event_notes(school_id, incident_status, created_at DESC)
  WHERE note_type = 'incident';
