# Stripe launch Slice 1 schema foundation rollout review

**Status: PREPARED — NOT APPROVED — NOT DEPLOYED**

This packet reviews migration 039 as an additive, inactive schema foundation.
It is not an approval or an execution instruction. No database is identified as
an approved target and no evidence in this packet claims that the migration has
been applied.

## Scope

Migration 039 creates the Section 4 launch configuration, agreement, lesson
contract/outcome, issue, refund, account observation, payout run/batch/earning,
obligation, transfer, statement, dispute, and job-occurrence structures. It adds
only nullable bridge/evidence columns to `lesson_bookings` and
`payout_funding_sources`.

The schema deliberately contains no configuration or agreement seed, historic
classification, backfill, application writer, scheduled job, Stripe call,
engine switch, refund execution, transfer execution, or UI.

## Review artifacts

- Forward-only migration:
  `db/migrations/039_stripe_launch_schema_foundation.sql`
- Canonical bootstrap mirror: `db/migration.sql`
- Read-only preflight:
  `db/diagnostics/stripe-launch-schema-foundation-pre-migration.sql`
- Read-only postflight:
  `db/diagnostics/stripe-launch-schema-foundation-post-migration.sql`
- Machine-readable manifest:
  `db/rollouts/039-stripe-launch-schema-foundation.manifest.json`
- Static rehearsal record:
  `db/rollouts/039-stripe-launch-schema-foundation.rehearsal.json`
- Local verifier: `scripts/stripe-launch-schema-foundation-review.js`

## Required review sequence

1. Run the local verifier and focused tests. A failure blocks review.
2. Review the preflight SQL before any database access. It is SELECT/CTE only.
3. If a future operator receives separate, explicit authority, execute the
   preflight against the precisely approved target and retain its full output.
4. Confirm no Slice 1 relation collision, no tenant mismatch, no duplicate
   existing Stripe identity, and that every school remains on payout engine v1.
5. Stop. This packet does not authorize applying migration 039. A separate
   approval must identify the database target, operator, maintenance window,
   reviewed migration checksum, and recovery plan.
6. Only after that separate approval, migration 039 must run by itself in an
   atomic transaction with fail-on-error and reviewed lock/statement timeouts.
   The broad `api/migrate.js` runner and `db/migration.sql` are prohibited.
7. Run the read-only postflight and compare historic counts/fingerprints with
   preflight. All 26 launch tables must exist and contain zero rows; every school
   must still be v1. Any mismatch blocks completion and requires investigation.

## Hard stop conditions

Stop if the checksum differs, a migration-number collision exists, a preflight
check fails, historic fingerprints change, any launch row exists, a school is
not v1, expected tenant constraints/guards are absent, or the target cannot be
positively identified as the separately approved environment.

## Authority explicitly not granted

This packet does not grant authority to execute a production migration; seed or
backfill data; activate a school, launch configuration, agreement, or payout
engine; change `payout_engine_version`; create or modify any Stripe account or
object; issue a refund; calculate or execute a payout or transfer; connect a
cron; add an application mutation route; or implement any later launch slice.

## Current evidence

The repository artifact is statically prepared and has been rehearsed against
an explicitly named isolated non-production database. The rehearsal JSON
records 10 passing database tests, an outer transaction rollback, and no
persisted launch schema or data. No schema was deployed. Until separate
production approval and target-specific evidence exist, the only valid status
is **PREPARED — NOT APPROVED — NOT DEPLOYED**.
