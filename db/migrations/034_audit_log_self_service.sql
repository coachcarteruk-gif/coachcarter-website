-- Allow learner/instructor self-service audit events that do not have an admin actor.
ALTER TABLE audit_log
  ALTER COLUMN admin_id DROP NOT NULL;
