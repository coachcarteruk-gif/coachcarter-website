# Flexible Hours weekly rollout — 28 September 2026

Fraser authorised rehearsal, production migration and deployment after reviewing
the implementation summary. This release adds package-funded 2–4 consecutive
weekly lessons and preserves the retired legacy products and existing money policy.

## Database rehearsal

- Project: `falling-firefly-48751671` (`neon-green-elephant`).
- Production parent: protected/default `br-summer-silence-abcpp6vw` (`main`).
- Disposable child: `br-shiny-violet-ab3k96e3`, named
  `codex-flexible-weekly-074-20260928`, database `neondb`.
- Child endpoint: `ep-long-sunset-abievyri`, non-primary/non-default/unprotected,
  0.25–1 CU, automatic suspension after 300 seconds of inactivity.
- Governed ledger preflight: 73 successful receipts, only 074 pending.
- Migration 074 applied successfully in 324 ms using a direct connection.

Twelve real multi-connection PostgreSQL checks passed against the cloned production
schema and constraints. Fixtures used synthetic `example.test` learners and
instructors, synthetic package bank receipts, and no notification calls, entirely
on the disposable child. No production lesson or financial test data was created.

1. Hold the weekly transaction after validation while an ordinary booking attempts
   an overlapping insert at a different start time. Observe its connection waiting
   on a database lock; commit weekly; the competing writer receives `23P01`.
2. Repeat for checkout reservation, pending offer, pending lesson request and
   recurring-block hold writers: all four wait and then receive `23P01`.
3. Reverse the ordering for all five writers: commit their held transaction while
   weekly waits. Weekly returns `SLOTS_UNAVAILABLE`, with zero package allocations.
4. Submit identical batch identities simultaneously: return identical booking IDs,
   exactly one result marked reused, and only one batch created.
5. Submit two different eight-hour batches against the same 15-hour balance:
   exactly one succeeds, the other reports insufficient units, and 420 minutes remain.

This supplements 123 passing focused local tests (PGlite SQL and Playwright browser
flows), syntax validation and migration-manifest checks. The twelve races comprise
five weekly-first, five competing-writer-first, one retry and one balance test.

## Production migration

- Direct target matches the existing runtime endpoint/database and recorded
  production identity: `ep-wispy-river-abygunjy`, database `neondb`.
- Target fingerprint:
  `32c8e09a13fff240b0e1af6bb4c063bce1ca02ec09b801242e9232c824123008`.
- Recovery snapshot: `snap-rough-heart-abh43tmr`, created 08:24:29 UTC from the
  exact protected production branch before applying the migration.
- Used the repository's `validateLedger` and `executeMigration` governance helpers,
  authoritative migration advisory lock, and a guard requiring only 074 pending.
- Receipt: succeeded at `2026-09-28T08:24:41.278Z`, duration 786 ms.
- Canonical SHA-256:
  `3e1b8f55867f7a37006501f5c5c8831d96f7a69811b5a3d2275893e69cb1f1b1`.
- Postflight: 74 successful receipts, no pending migrations, both indexes valid,
  five overlap triggers and the deferred replacement trigger enabled.

The migration adds metadata/indexes/triggers; it does not rewrite historical
financial rows, spend balances, alter school configuration or call Stripe.

## Application deployment

Pending completion. The previous READY production deployment is
`coachcarter-website-700pjh3fd-coachcarteruk-2599s-projects.vercel.app`.
Application rollback can return to that deployment while retaining the additive
migration and any already-created bookings. Do not remove financial evidence or
restore the whole database over newer live activity as a routine app rollback.
