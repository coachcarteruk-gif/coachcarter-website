# Production facts

> Only facts that have been observed against prod. Each row is tagged `verified` (and how) or `assumption` (carried from memory; re-check before relying on it for a money-touching change).

## Identities & Stripe wiring

| Fact | Status | How verified |
|---|---|---|
| Stripe webhook URL: `https://www.coachcarter.uk/api/webhook` (never apex) | verified | 2026-05-10 incident, ratified across two follow-up sessions |
| Platform Stripe account: `acct_1QUssNIqhTSdZedS`, schedule = Manual | verified | Stripe Dashboard, 2026-05-15 (PR #132) |
| Fraser's instructor Connect account: `acct_1THXFyIAf6hvFTx9` | verified | Neon SELECT on `instructors id=4`, 2026-05-15 |
| `instructors id=4` (Fraser): `commission_rate = 1.000`, `payouts_paused = FALSE`, `payouts_start_date = 2026-05-15`, `stripe_onboarding_complete = TRUE` | verified | Neon SELECT, 2026-05-15 |
| Stripe Checkout UK domestic card fee: `1.5% + 20p` per successful charge | verified | Agent research + observed `144p` on £82.50 charge, 2026-05-16 |
| Stripe Connect transfer (platform → connected): free | verified | Stripe docs research, 2026-05-15 |
| Stripe Connect Express standard payout fee: `0.25% + 10p` | verified | Stripe docs research, 2026-05-15 (corrected from earlier `+2p` figure) |
| `controller.fees.payer = 'application'` is the setting that lets the platform absorb payout fees | verified | Stripe docs |
| `school_id = 1` is CoachCarter (the default school) | verified | DEFAULT on every tenant-scoped table |

## Schema invariants

| Fact | Status | How verified |
|---|---|---|
| `lesson_bookings.status` CHECK enforces `'scheduled' | 'chargeable' | 'refunded'` only | verified | `db/migration.sql`, PR #125 |
| `uq_instructor_slot` partial-index predicate: `WHERE status <> 'refunded'` | verified | Post-hotfix prod SELECT, 2026-05-15 |
| `lesson_bookings.learner_id` is nullable, FK is `ON DELETE SET NULL`, `learner_anonymized BOOLEAN DEFAULT FALSE` exists | verified | Prod diagnostics, PR #157, 2026-05-19 |
| `credit_transactions.learner_id` nullable + `anonymized = TRUE` semantics for GDPR | verified | Inherited from April 2026, used by `_gdpr.js` |
| `credit_transactions_type_check` permits widened set incl. `slot_purchase` / `admin_add` / `admin_remove` / `legacy_grandfather` | verified | Commit 853f31c, 2026-05-10 |
| Stripe session idempotency: `uq_credit_tx_session`, `uq_slot_reservation_slot` exist | verified | Prod SELECT post-PR-#153, 2026-05-19 |
| `school_payout_line_items` table + `uq_school_payout_booking` exist (zero rows in prod) | verified | Prod SELECT post-PR-#154, 2026-05-19 |
| `notification_log` table + 4 indexes + 2 CHECK constraints + 3 FKs exist | verified | Prod diagnostics post-PR-#160, 2026-05-19 |
| `platform_balance_snapshots` table exists with the listed columns | assumption | Created on `feat/widget-alert-layer` 2026-05-17; re-verify against `db/migration.sql` and a prod SELECT before relying on schema details |
| `calendar_token_rotated_at TIMESTAMPTZ` columns exist on both `learner_users` and `instructors` | verified | Prod post-PR-#158, 2026-05-19 |
| `learner_users` has no `anonymized` column — soft-delete is `archived_at IS NULL` | verified | Memory `feedback_learner_soft_delete_column.md` |
| `migration_markers` table is the gating mechanism for credit-plan migrations | verified | Step 2 DDL refuses to run until Step 1c backfill marker exists |
| `trg_sync_pooled_balance` exists on `learner_credit_balances` and calls `sync_pooled_balance()` after INSERT or UPDATE | verified | Prod SELECT from `pg_trigger` / `pg_proc`, 2026-05-21 20:51 UTC |
| `booking_credit_sources.school_id` exists, is `NOT NULL`, default `1`, with FK `booking_credit_sources_school_id_fkey` and index `idx_bcs_school` | verified | Prod post-migration diagnostic after PR #194 `/api/migrate`, 2026-05-21 |

## BCS school_id migration state (as of 2026-05-21)

| Check | Result | Status |
|---|---|---|
| `/api/migrate` after PR #194 | Run once | verified |
| PowerShell `curl` alias response | Did not return body (`Invoke-WebRequest` null-reference error); no retry performed | verified |
| Post-diagnostic completion proof | `booking_credit_sources.school_id` exists | verified |
| Nullability/default | `is_nullable = NO`, `column_default = 1` | verified |
| FK | `booking_credit_sources_school_id_fkey` exists | verified |
| Index | `idx_bcs_school` exists | verified |
| Null `school_id` rows | `0` | verified |
| School mismatch query | `[]` | verified |

### Live `migration_markers` rows (last known)

| Marker | When | Source |
|---|---|---|
| `per_instructor_credits_step_2c_no_lcb_backfill` | 2026-05-21 12:19:08 UTC | Plan B3 |
| `credits_credit_returned_retro_fix` | 2026-05-21 12:45:25 UTC | Chip #3 |
| `per_instructor_credits_step_4` | 2026-05-21 20:51:29 UTC | Chip #4 (`trg_sync_pooled_balance`) |

Earlier markers exist for Steps 1c / 2 / 2.5 / Plan A / Plan B1 — re-query before relying on exact timestamps.

## Pooled balance trigger state (as of 2026-05-21 20:51 UTC)

| Check | Result | Status |
|---|---|---|
| `sync_pooled_balance()` | Exists in `public` schema | verified |
| `trg_sync_pooled_balance` | Exists on `learner_credit_balances` | verified |
| Trigger timing | `AFTER INSERT OR UPDATE ON learner_credit_balances FOR EACH ROW` | verified |
| Trigger effect | Recomputes `learner_users.balance_minutes` from `SUM(learner_credit_balances.balance_minutes)` for `NEW.learner_id` | verified from function definition |
| Pooled-vs-LCB divergence sample | `[]` | verified |

## Cron entrypoints

| Cron | Schedule | Purpose | Lock helper |
|---|---|---|---|
| `cron-credit-reconcile` | 08:30 UTC daily | Credit divergence guardrail. Returns `drift_count` / `drift_summary`. | `withCronLock` |
| `cron-balance-snapshot` | 08:00 UTC daily | Writes `platform_balance_snapshots`, fires Trigger B if outflow − inflow > £100. | `withCronLock` |
| `cron-auto-complete` | hourly | `scheduled` → `chargeable` flip with 1-hour buffer past `end_time`. | `withCronLock` |
| `cron-reconcile-payments` | (existing) | Safety net for missing Stripe → credit_transactions writes. | `withCronLock` |
| `cron-retention` | (existing) | Purges anonymised rows past 7 years; notification_log past 90 days. | `withCronLock` |
| Weekly payout cron | Friday | `processPayoutForInstructor` per eligible instructor. | `withCronLock` |
| `reminders.send-due`, `reminders.daily-schedule`, `referral-rewards`, `ical-sync`, `setmore-sync`, `setmore-welcome`, `offers.expire` | (existing schedules) | Various | `withCronLock` |

12 cron entrypoints total, all wrapped in `withCronLock` (PR #155).

## Drift state (as of 2026-05-26 09:47:19 UTC)

| Field | Value | Status |
|---|---|---|
| `drift_count` | 0 | verified |
| `missing_bcs_count` | 0 | verified |
| `pairs_scanned` | 30 | verified |
| `drift_summary` | `[]` | verified |
| `missing_bcs_summary` | `[]` | verified |
| `alert_sent` | `false` | verified |

Latest manual read-only `cron-credit-reconcile` trigger was run post-PR-#218 deploy at 2026-05-26T09:47:19.119Z. It returned full schema mode with BCS/CSA/grandfathering columns present: `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `grandfathered_count=0`, `missing_bcs_truncated=false`, and `drift_truncated=false`. No prod writes, migrations, payout crons, Neon/prod integration tests, live Stripe calls, Stripe mutations, goodwill grants, reconciliation grants, or UI apply/grant path were run.

## Bookings deliberately left in refund-without-credit-return shape

These four are absorbed by Plan B1's synthetic CT math. Flipping `credit_returned = TRUE` on any of them would manufacture opposite-sign drift. Operationally necessary to record because a future predicate sweep on `(status=refunded, credit_returned=FALSE, credit_forfeited=FALSE, minutes_deducted=90)` would otherwise re-hit them.

| Booking | Learner | Instructor | Date | rescheduled_from |
|---|---|---|---|---|
| #111 | 52 (Test Learner) | 4 (Fraser) | 2026-04-07 | NULL (but rescheduled TO #118) |
| #113 | 24 (Fraser) | 4 (Fraser) | 2026-04-06 | NULL |
| #165 | 15 (Fraser test) | 4 (Fraser) | 2026-04-17 | NULL |
| #194 | 15 (Fraser test) | 4 (Fraser) | 2026-05-01 | NULL |

All four were flipped to `refunded` via learner-created credit bookings, not Setmore (`setmore_key IS NULL`), instructor cancel, or reschedule. #111 and #165 match the pre-2026-04-13 learner-cancel 48h date-parsing bug; #194 is explicitly named in commit 46f59df as the Neon DATE-object parsing bug. #113 has `cancelled_at=NULL`, so the exact writer is not provable from retained row metadata, but it is ruled out as Setmore/reschedule/instructor cancel. Absorption remains clean; do not mutate them.

## Known assumption that needs re-checking

- "Branch protection on `main` is off." assumption, verified 2026-05-19 — re-check `gh api repos/.../branches/main/protection` before relying on it.
