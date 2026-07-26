# Payout v2 schema-only rollout review

Status: **SCHEMA APPLIED — INACTIVE — ENGINE V1**

This packet records the completed migration 035 schema-only rollout. It does
not authorise source ingestion, the £414 recovery entry, an engine switch, a
payout, or any Stripe API call.

The final production read-only preflight completed at
`2026-07-26T16:50:20.686Z`.
The sanitized evidence is recorded in
`db/rollouts/035-payout-v2-schema-only.preflight.json`. All six schema rollout
blocker counts were zero.

Migration 035 committed atomically at `2026-07-26T16:50:34.210Z`. The
independent read-only postflight completed at `2026-07-26T16:51:20.708Z` and
confirmed all 25 new tables are empty, all 39 guard triggers are present, and
the school remains on payout engine `v1`. Recovery, rehearsal, apply, and
postflight evidence are stored beside the manifest under `db/rollouts/`.

## Completed authorization

Fraser approved the review packet, production preflight, and exact schema-only
transaction in separate steps. Those approvals are exhausted. They cannot be
interpreted as approval for any later payout-v2 data or money action.

The exact reviewed artifact is:

- File: `db/migrations/035_payout_v2_ledger_foundation.sql`
- SHA-256: `7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`
- Size: 69,957 bytes
- Lines: 1,553
- Machine-readable manifest:
  `db/rollouts/035-payout-v2-schema-only.manifest.json`

Run `npm run review:payout-v2-schema` before approval and again immediately
before execution. Any checksum or verifier mismatch voids the review.

## What the migration changes

The migration performs DDL only:

- adds `schools.payout_engine_version` with the fail-safe default `v1`;
- creates 25 inactive payout-v2 evidence and ledger tables;
- creates 66 indexes, including tenant-equality and idempotency guards;
- creates 9 validation/immutability functions and 39 triggers;
- adds no v2 ledger rows and changes no school to `v2`.

The five indexes created on existing business tables are composite
`(id, school_id)` indexes needed for tenant-safe foreign keys. The remaining
indexes, functions, and triggers support the new inactive schema.

## Explicitly outside this rollout

This rollout does **not**:

- backfill or import historical payment data;
- create the £414 future-payout recovery obligation;
- classify cash, Setmore, or other external payments;
- create cutover configuration or two-cycle shadow evidence;
- calculate or store the live reserve/protected-balance position;
- enable a route, cron, API, UI, payout engine, transfer, or bank payout;
- call Stripe or require any Stripe secret;
- deploy application code.

All schools must remain on engine `v1`, so the current payout paths continue to
own production behaviour.

## Required preflight

The operator must stop before connecting if the reviewed hash does not match.
After approval, use a restricted database role and a verified production target;
never paste a database URL or secret into the task, logs, manifest, or command
history.

Before applying the DDL:

1. Confirm Neon point-in-time recovery/backup coverage and record its reference.
2. Confirm no payout, refund, migration, or financial repair is running.
3. Run
   `db/diagnostics/payout-v2-ledger-foundation-pre-migration.sql` read-only.
4. Stop on any tenant violation, cross-route duplicate, unresolved transfer,
   positive legacy payable value, or unexplained pre-existing v2 relation.
5. Re-run `npm run review:payout-v2-schema`; require every check to pass.
6. Record reviewer, operator, target database identity, Git commit, checksum,
   diagnostic evidence, and proposed maintenance window.

## Approved execution shape

Execution must use only the numbered migration file, in one database transaction,
with stop-on-error and a short lock timeout. A database operator may use a
reviewed `psql`/Neon SQL transaction or an equivalent controlled migration job.
The transaction must have this shape:

```text
BEGIN
SET LOCAL lock_timeout = '10s'
SET LOCAL statement_timeout = '10min'
execute the exact reviewed bytes of migration 035
COMMIT only if every statement succeeds
```

Do **not** use `/api/migrate` or `db/migration.sql` for this rollout. The API
runner executes the entire aggregate file statement-by-statement, continues
after individual errors, and does not wrap the aggregate in one atomic
transaction. That is unsuitable for this bounded financial-schema change.

Schedule a low-traffic window. Adding the school column/constraint and building
the five indexes on existing tables can briefly take PostgreSQL locks. If the
10-second lock timeout fires, allow the transaction to roll back and reschedule;
do not increase it live without a new review.

## Required postflight

Before ending the maintenance window:

1. Run
   `db/diagnostics/payout-v2-ledger-foundation-post-migration.sql` read-only.
2. Confirm all 25 expected tables exist.
3. Confirm all 25 new tables contain zero rows.
4. Confirm every school reports `payout_engine_version = 'v1'`.
5. Confirm required tenant keys, unique indexes, and append-only triggers exist.
6. Re-run the preflight diagnostic and confirm no new violation.
7. Record the completed transaction reference and postflight output.

No source preview/import, reserve snapshot, cutover evidence, recovery entry, or
Stripe reconciliation belongs in this maintenance window.

## Abort and rollback

Before commit, any SQL error, timeout, lost connection, unexpected object, or
postcondition failure means `ROLLBACK`.

After a successful commit, the new schema is dormant. For an application issue,
leave all schools on `v1` and leave the additive empty schema in place while the
incident is investigated. Do not casually drop financial tables or triggers.
Use Neon point-in-time recovery only if the schema itself caused a material
database incident and the incident lead explicitly approves restoration.

If any v2 table has acquired a row, destructive schema rollback is forbidden
until that evidence is reconciled and separately authorised.

## Review checklist

- [ ] The manifest and migration hash match.
- [ ] The DDL-only scope is acceptable.
- [ ] The lock/maintenance-window risk is acceptable.
- [ ] Backup/PITR evidence will be captured before execution.
- [ ] The numbered migration—not the aggregate runner—will be used atomically.
- [ ] Preflight and postflight evidence will be retained.
- [ ] It is understood that this approves no data import, activation, or money movement.

The schema-only step is complete. No data import, recovery creation, payout-v2
activation, or Stripe activity is authorised. Each later phase requires its own
review and explicit instruction.
