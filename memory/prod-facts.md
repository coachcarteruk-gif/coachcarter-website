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

### Live `migration_markers` rows (last known)

| Marker | When | Source |
|---|---|---|
| `per_instructor_credits_step_2c_no_lcb_backfill` | 2026-05-21 12:19:08 UTC | Plan B3 |
| `credits_credit_returned_retro_fix` | 2026-05-21 12:45:25 UTC | Chip #3 |

Earlier markers exist for Steps 1c / 2 / 2.5 / Plan A / Plan B1 — re-query before relying on exact timestamps.

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

## Drift state (as of 2026-05-21 12:45:40 UTC)

| Field | Value | Status |
|---|---|---|
| `drift_count` | 0 | verified |
| `drift_summary` | `[]` | verified |
| `alert_sent` | `false` | verified |

## Bookings deliberately left in refund-without-credit-return shape

These four are absorbed by Plan B1's synthetic CT math. Flipping `credit_returned = TRUE` on any of them would manufacture opposite-sign drift. Operationally necessary to record because a future predicate sweep on `(status=refunded, credit_returned=FALSE, credit_forfeited=FALSE, minutes_deducted=90)` would otherwise re-hit them.

| Booking | Learner | Instructor | Date | rescheduled_from |
|---|---|---|---|---|
| #111 | 52 (Test Learner) | 4 (Fraser) | 2026-04-07 | NULL (but rescheduled TO #118) |
| #113 | 24 (Fraser) | 4 (Fraser) | 2026-04-06 | NULL |
| #165 | 15 (Fraser test) | 4 (Fraser) | 2026-04-17 | NULL |
| #194 | 15 (Fraser test) | 4 (Fraser) | 2026-05-01 | NULL |

All four were flipped to `refunded` via plain cancel/refund (not the reschedule path chip #3 fixed). Originating writer-path is unidentified; not urgent because the absorption is clean.

## Known assumption that needs re-checking

- "PII leak in `api/instructors?action=list` returns email and phone publicly." Memory entry dated 2026-05-19; treat as **assumption** until re-verified against current `api/instructors.js`. If it has been fixed, move to decision-log under "Superseded".
- "Branch protection on `main` is off." assumption, verified 2026-05-19 — re-check `gh api repos/.../branches/main/protection` before relying on it.
