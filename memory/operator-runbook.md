# Operator runbook

> **Prod writes require explicit Fraser confirmation.** Codex must not POST to a prod migration endpoint, run a payout, mutate `credit_transactions`, or change Stripe configuration without (a) showing dry-run output and (b) waiting for Fraser to say "go".

## Universal pre-flight (every task)

1. `git checkout main && git pull origin main`. Never continue an old feature branch.
2. Read `CLAUDE.md` for the relevant area and the named plan doc (`PER-INSTRUCTOR-CREDITS-PLAN.md`, `FRANCHISE-MODEL-PLAN.md`, etc.).
3. Skim `memory/current-state.md` and `memory/prod-facts.md`.
4. Audit live code, not only plan text — `grep` for the writer paths you depend on. The plan can lie; the code can't.
5. State the exact prod-touching command you intend to run, in full, before running it.

## Migrations

### Standard migration via `/api/migrate`

```bash
curl "https://www.coachcarter.uk/api/migrate?secret=$MIGRATION_SECRET"
```

- Idempotent by design.
- Does **not** halt on per-statement errors. So you cannot trust the HTTP response alone — verify against prod with a post-migration diagnostic SQL file at `db/diagnostics/<pr-slug>-post-migration.sql`.
- Every migration that can fail on existing data must ship with `db/diagnostics/<pr-slug>-{pre,post}-migration.sql` companion files.

### Targeted credit migrations (Step 2c / Plan A / B1 / B3 / retro-fixes)

These are single-purpose endpoints (e.g. `/api/migrate-step-2c-no-lcb-backfill`, `/api/migrate-credit-returned-retro-fix`). All follow the same pattern:

1. **Dry-run first.** Endpoint accepts `?dry_run=1` (or equivalent). Output lists candidates with full per-row math.
2. **Compare to prediction.** You should have predicted, before the dry-run, exactly which rows and which totals are expected. If the actual output differs in any row, **halt**.
3. **Halt if:**
   - Dry-run row count ≠ predicted row count.
   - Any row's predicted `expected_drift` ≠ actual.
   - Any row falls outside the documented allowlist (for retro-fixes that use explicit IDs, not predicates).
   - The dry-run includes any booking on a grandfathered learner that's not already in the absorption plan (see `prod-facts.md` "deliberately left in refund-without-credit-return shape").
4. **Show Fraser** the dry-run before POST. Wait for "go".
5. **POST** with the exact same payload, no parameter drift.
6. **Verify:** post-apply, query the `migration_markers` table for the new marker, fetch the divergence cron output, and confirm `drift_count` moved in the predicted direction.

### Money-correctness backfills

Anything that flips `credit_returned`, mutates `credit_transactions`, or modifies `learner_credit_balances` requires the protocol above **plus**:

- An integration test on a Neon test branch (see `reference_integration_test_pattern` in legacy memory; `POSTGRES_URL_TEST` + `CC_TEST_DB=1` gate).
- A direct assertion against cron output, not just parallel SQL (see `decision-log.md` → "assert against production output, not parallel SQL").
- Lockstep check: if you touch `processPayoutForInstructor`, you also touch `simulatePayoutForInstructor` in the same PR.

## Cron checks

### Daily — `cron-credit-reconcile`

Schedule: 08:30 UTC. Expected steady-state output: `{ drift_count: 0, drift_summary: [], alert_sent: false }`.

Manual trigger (use sparingly):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.coachcarter.uk/api/cron-credit-reconcile
```

**Halt if:**
- `drift_count > 0` and `drift_summary` contains a learner/instructor pair not previously diagnosed.
- `alert_sent = true` for two consecutive runs (means SMTP succeeded but the underlying drift wasn't cleared).

If new drift appears, run the timing-forensic SQL probe **first** (BEFORE/AFTER a recent migration marker) before auditing writer paths — see `decision-log.md` references.

### Daily — `cron-balance-snapshot`

Schedule: 08:00 UTC. Writes one row to `platform_balance_snapshots`.

Trigger B (aggregate bias) fires if `trailing_30d_payout_outflow_pence - trailing_30d_stripe_inflow_pence > 10000` (£100).

**Halt if:**
- Trigger B fires unexpectedly. Don't raise the threshold — investigate.
- A `status='green'` snapshot is followed by a payout failure: Trigger A will email "Payout #N failed despite green widget". That's the cue to compare `simulatePayoutForInstructor` vs `processPayoutForInstructor` for drift.

### Weekly — Friday payout cron

Pre-flight before the first run after any change to `_payout-helpers.js`:

1. Open the Next Payout Preview widget on the admin Payouts page. Confirm widget status = green and per-instructor breakdown looks sane.
2. Check `instructors.payouts_start_date` floor exists for every active instructor (belt + braces with `payouts_paused`).
3. Confirm `simulatePayoutForInstructor` and `processPayoutForInstructor` were touched in the same PR if math changed.

## Stripe & money flow

- Webhook URL is `https://www.coachcarter.uk/api/webhook` (never apex). If a new front-door domain is added, test for 307 redirects before pointing Stripe at it.
- Don't add per-file CORS headers. CORS lives in `middleware.js`.
- Don't catch `INSERT INTO credit_transactions` errors silently. If the CHECK constraint rejects, surface it.
- `lesson_bookings.stripe_fee_pence = NULL` on a credit-funded booking is **correct, not missing data** (see `decision-log.md`).

## Rollback thinking

There is **no automated rollback** for credit-plan migrations. The chosen rollback model is:

1. Stop deploys.
2. Restore from Neon PITR snapshot to the time just before the migration marker.
3. Re-deploy with the offending migration disabled.

Implications:

- A bidirectional dual-write trigger is explicitly NOT shipped. Don't propose one as "rollback insurance" — it adds risk, doesn't reduce it.
- Forward-only trigger work is staged (Phase A no trigger, Phase B writers cut over + trigger created, Phase C cleanup) with a nightly divergence check.
- PITR drill record + procedure lives in `docs/credits-grandfather.md`. Re-read it before any migration that creates a new marker.

## Decision lines that mean "stop and ask Fraser"

Codex must halt and ask Fraser explicitly before doing any of these:

- POSTing to any `/api/migrate*` endpoint (including idempotent ones).
- Mutating `credit_transactions`, `learner_credit_balances`, `lesson_bookings.credit_returned`, `lesson_bookings.credit_forfeited`, or any `*_pence` column on a money table.
- Adding or modifying a CHECK constraint on `credit_transactions`, `lesson_bookings`, or `instructor_payouts`.
- Changing Stripe Dashboard settings (schedule, webhook URL, connected accounts).
- Force-pushing or hard-resetting `main`.
- Running a payout-triggering script or transferring funds.
- Disabling or modifying any cron alert threshold.
- Deleting rows from any table that anonymises rather than hard-deletes (`learner_users`, `credit_transactions`, `lesson_bookings`).

For everything else (read-only investigation, local tests, frontend changes, doc edits, prep PRs), proceed normally and confirm at PR-open time.
