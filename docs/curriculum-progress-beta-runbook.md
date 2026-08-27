# Curriculum progress live-beta runbook

The implementation is repository-ready but not deployed, migrated or enabled by this change.

## Safe deployment order

1. Review migration `db/migrations/054_curriculum_progress_beta.sql` and the matching aggregate block in `db/migration.sql` against a disposable/test database.
2. Apply migration 054 before deploying the API/UI code. Do not use the production migration endpoint until explicitly approved.
3. Deploy the code while `curriculum_progress_beta` remains absent/false. Verify authenticated `GET /api/curriculum-progress?action=feature-state` returns `{ enabled: false }` for learners and instructors and no beta surface appears.
4. In a test or preview school only, set an exact JSON Boolean and smoke-test one past booking end to end.
5. After approval, enable School 1 only with a reviewed, school-scoped update:

```sql
UPDATE schools
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{features}',
  (CASE
     WHEN jsonb_typeof(config->'features') = 'object' THEN config->'features'
     ELSE '{}'::jsonb
   END) || jsonb_build_object('curriculum_progress_beta', true),
  true
)
WHERE id = 1;
```

Read the row back with:

```sql
SELECT id, name,
       config->'features'->'curriculum_progress_beta' AS curriculum_progress_beta,
       jsonb_typeof(config->'features'->'curriculum_progress_beta') AS value_type
FROM schools
WHERE id = 1;
```

Verify the row is CoachCarter, `value_type` is `boolean`, and the value is `true`. Do not run an unscoped `UPDATE schools`.

## Disable / rollback

Disable surfaces and mutations first by setting the same School 1 path to JSON `false` (or removing the key). Existing history stays intact. Code rollback does not require dropping tables. Migration 054 is additive; do not drop it during an incident unless a separate destructive-change review approves data loss.

## Smoke checks

- Instructor sees only their own eligible past bookings in Reviews due.
- Refunded, future and `credit_forfeited` bookings are absent/rejected.
- Review submit, exact retry with the same request id, edit with a new request id, learner prompt/reflection, and both progress views work.
- Learner cannot request another learner's booking and instructor cannot request another instructor's booking.
- Completion rows never accept a score; practical rows never accept completion-only writes.
- Progress shows separate latest signals plus history, notes, dates and Not assessed states.
- Existing booking status, credit, refund, payout and Stripe regression tests remain green.

## Current beta limits

No off-system/private-practice entries, readiness percentage, mastery automation, email/SMS, mock-test link, admin-editable curriculum or advanced reporting. Completion checks are irreversible in the beta UI; correction would require an audited support process before broader rollout.
