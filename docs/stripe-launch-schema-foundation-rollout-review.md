# Stripe launch Slice 1 schema foundation rollout review

**Status: SCHEMA_APPLIED_INACTIVE**

Migration 039 was applied schema-only to the verified production database on
1 August 2026. The schema remains inactive: there are no launch configuration
rows, application writers, Stripe operations, or payout-engine transitions.

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
- Production preflight evidence:
  `db/rollouts/039-stripe-launch-schema-foundation.preflight.json`
- Neon recovery evidence:
  `db/rollouts/039-stripe-launch-schema-foundation.recovery.json`
- Atomic production apply evidence:
  `db/rollouts/039-stripe-launch-schema-foundation.apply.json`
- Production postflight evidence:
  `db/rollouts/039-stripe-launch-schema-foundation.postflight.json`
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

## Operational authority explicitly not granted

The completed schema apply does not grant authority to seed or backfill data;
activate a school, launch configuration, agreement, or payout engine; change
`payout_engine_version`; create or modify any Stripe account or object; issue a
refund; calculate or execute a payout or transfer; connect a cron; add an
application mutation route; or implement any later launch slice.

## Current evidence

The reviewed migration checksum was applied to Neon project
`neon-green-elephant`, branch `main`, in one transaction with a 10-second lock
timeout and 10-minute statement timeout. Fresh preflight had zero blockers.
Transactional and post-commit postflight both confirmed 26 tables, zero launch
rows, 13 critical indexes, 25 functions, 68 triggers, 10 nullable bridge
columns, unchanged historic fingerprints, and one school still on payout
engine v1. No Stripe API call or operational activation occurred. The valid
status is **SCHEMA_APPLIED_INACTIVE**.
