# Current state

> Snapshot date: **2026-05-26**. Re-verify any claim against `git log` and prod before acting on it. Items below are tagged `verified` (checked against prod or live code in the named session) or `assumption` (carried forward from memory, not re-checked here).

## Headline

- **Credits divergence cron returns `drift_count = 0`; latest post-PR-#217 read-only output also has `missing_bcs_count = 0`.** verified by operator report 2026-05-26
- **Reschedule stale-BCS drift incident for learner_id=61 / instructor_id=4 is resolved as of 2026-05-26 08:45 UTC.** verified by post-repair read-only prod recompute: LCB 1170, ledger 1170, drift 0; stale refunded-booking BCS dry-run rows = 0.
- **Per-instructor credits plan Steps 0–2.5 + 3a/3b + 4 (Phase 2A) + 4.5 are merged on `main`.** verified via `git log` 2026-05-21.
- **Chip #4 `trg_sync_pooled_balance` is installed on prod as of 2026-05-21 20:51 UTC.** verified by prod `migration_markers`, `pg_proc`, `pg_trigger`, and pooled-vs-LCB divergence SELECTs.
- **Step 5 (BCS + FIFO) is in sliced rollout.** BCS/CSA schema substrate is present, and `booking_credit_sources.school_id` was applied on prod after PR #194. PR #211, PR #212, PR #213, PR #214, PR #216, and PR #217 are merged. PR #216 shipped Step 5.5 `credit-goodwill`; PR #217 added the admin Learners UI affordance for granting goodwill credit. Current branch implements the backend-only `credit-reconciliation` writer behind the existing admin endpoint; dry-run remains non-mutating and the UI remains inspection-only. Remaining Step 5 scope is FIFO writer wiring and merge/deploy/prod verification of the reconciliation writer.
- **No in-flight feature branches expected on `main`** — last 25 commits are merged squash-merges. verified.

## What is currently shipped (production-relevant)

| Area | State | Source |
|---|---|---|
| 3-state booking model (`scheduled` / `chargeable` / `refunded`) | LIVE since 2026-05-15 (PR #125 + hotfix #126) | `db/migration.sql`, `api/_booking-status.js` |
| Dual-confirmation lesson flow | DELETED. Do not re-add. | CLAUDE.md "load-bearing principle" |
| Platform Stripe schedule | **Manual** (since 2026-05-15, PR #132) | Stripe Dashboard, `docs/stripe-connect.md` |
| Fraser as normal instructor on Friday cron | LIVE (`instructors id=4`, `payouts_start_date=2026-05-15`) | PR #132 |
| Stripe-fee pass-through (Step 4f.a/b/c/d) | LIVE (PRs #134 / #135 / #136) | `api/_stripe-fee.js`, `api/webhook.js`, `_payout-helpers.js` |
| Weekly payout summary email | LIVE (PR #137/#138) | cron |
| Next Payout Preview widget v3 + `simulatePayoutForInstructor` | LIVE (PR #143) | `api/admin.js`, `api/_payout-helpers.js` |
| Daily `platform_balance_snapshots` cron + Trigger A/B alerts | LIVE | `api/cron-balance-snapshot.js`, `api/_platform-balance.js` |
| Notification log (`notification_log` table + helper-layer wrappers) | LIVE (PR #160) | `api/_notification-log.js`, `api/_whatsapp.js`, `api/_auth-helpers.js` |
| GDPR cascade unification (`deleteLearnerCascade`) + `lesson_bookings.learner_anonymized` | LIVE (PR #157) | `api/_gdpr.js` |
| Calendar token rotation endpoints + `*_rotated_at` columns | LIVE (PR #158) | `api/calendar.js` |
| Cron overlap guards via `withCronLock` (12 cron entrypoints) | LIVE (PR #155) | `api/_cron-lock.js` |
| Stripe session idempotency unique indexes (`uq_credit_tx_session`, `uq_slot_reservation_slot`) | LIVE (PR #153) | `db/migration.sql` |
| Inline `<script>` extraction across 6 public pages (CSP) | LIVE (PR #162) | `public/**/*.js` |
| Service worker auth-path carve-out + cache bump cc-v4 → cc-v5 | LIVE (PR #161) | `public/sw.js` |
| Reschedule paths set `credit_returned = TRUE` on old booking (chip #3) | LIVE (PR #187, 2026-05-21 12:45 UTC) | `api/instructor.js handleRescheduleBooking`, `api/slots.js handleReschedule` |
| Slot-booking webhook confirmation balance fix (chip #5) | LIVE (PR #188, 2026-05-21) | `api/webhook.js handleSlotBooking`, `tests/webhook-slot-booking.spec.js` |
| Pooled balance sync trigger (chip #4) | LIVE (prod POST 2026-05-21 20:51 UTC) | `api/migrate-step-4.js`, prod `trg_sync_pooled_balance` |
| BCS `school_id` schema groundwork | LIVE (PR #194 + prod `/api/migrate`, 2026-05-21) | `booking_credit_sources.school_id`, FK, `idx_bcs_school`; post-diagnostic verified |
| Four absorbed refund-without-credit-return bookings origin | INVESTIGATED (2026-05-21) | Historical learner-cancel parser bugs/manual-status era; see `decision-log.md` |

## Current migration / credits state

| Step | Status | Notes |
|---|---|---|
| Step 0 — atomic `grantCredits()` + LCB-lock invariant | SHIPPED PR #166 | Closes a real latent partial-success bug in `handleCreditPurchase`. |
| Step 1a — `lesson_bookings.list_price_pence` column | SHIPPED PR #167 | Schema only. |
| Step 1b — list_price_pence writer wiring on every INSERT | SHIPPED PR #170 | |
| Step 1c — historical backfill + `migration_markers` | SHIPPED PR #171 | `stripe_metadata` historical pass deliberately skipped; see `project_step_1c_pass2_skipped` in decision log. |
| Step 2 (a/b/c) — additive schema Phase 1 | SHIPPED PR #172 | |
| Step 2.5 — free-trial writer + CHECK widening | SHIPPED PR #173 | |
| Step 3a — `instructors.hourly_rate_pence` column | SHIPPED PR #168 | Schema only. |
| Step 3b — `getEffectiveHourlyPence` + per-minute helper | SHIPPED PR #169 | |
| Step 4 — Phase 2A behavioural cutover (per-instructor credits) | SHIPPED via PR #176 + hotfix PR #177 | First attempt PR #174 was reverted by #175 (emergency flip). Q1 audit verified zero customer impact. `PHASE_2A_IMPLEMENTED=true` on prod. |
| Step 4.5 — daily credit-divergence cron + Plans A / B1 / B3 + chip #3 | SHIPPED PRs #179 / #180 / #182 / #183 / #184 / #186 / #187 | Drift trajectory: 34 → 13 → 4 → 3 → 0. |
| Step 5 — BCS + FIFO | SLICED ROLLOUT | Current `main` already has `booking_credit_sources`, `credit_source_adjustments`, BCS indexes, `UNIQUE (booking_id, credit_transaction_id)`, pence allocator tests, and read-only path-aware missing active BCS coverage detection in `api/cron-credit-reconcile.js`. Fraser accepted `booking_credit_sources.school_id` plus three writer-policy decisions on 2026-05-21. PR #194's BCS `school_id` migration was applied once on prod and post-diagnostic verified `school_id` exists/NOT NULL/default 1, FK + `idx_bcs_school` exist, null rows = 0, mismatch query = `[]`. PR #211, PR #212, PR #213, PR #214, PR #216, and PR #217 are merged. PR #213 deployed the payout read model cutover to shared `getEligibleBookings`: prefer `lesson_bookings.list_price_pence`, use active BCS Stripe-fee sums when present, and exclude active instructor-absorbed BCS rows. PR #214 added focused read-only Next Payout Preview coverage proving those snapshotted gross and active BCS fee values flow through `computePlatformBalance()` / `simulatePayoutForInstructor()` preview totals. PR #216 shipped Step 5.5 `credit-goodwill`; PR #217 added the Learners admin UI form for the shipped endpoint. Current branch implements the backend-only `credit-reconciliation` writer: dry-run/inspection returns `inspection_only: true` and `credit_granted: false`; mutating mode requires a non-empty reason, gates on inspection + `buildReconciliationGrantInput()`, writes through the shared serialized LCB credit mutation path, and audit-logs `admin.credit_reconciliation`. The UI remains inspection-only with no admin apply/grant button. No prod writes, migrations, live Stripe calls, Stripe mutations, goodwill grants, or reconciliation grants have been run from this branch. Remaining scope is FIFO writer wiring plus merge/deploy/prod verification of this writer. |

Post-PR-#213 production verification: PR #213 merged and deployed. Manual read-only `cron-credit-reconcile` trigger at 2026-05-25T22:15:04.183Z returned `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=29`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, `missing_bcs_truncated=false`, `drift_truncated=false`, `missing_bcs_summary=[]`, and `drift_summary=[]`. No prod writes, migrations, backfills, payout crons, Neon integration tests, or Stripe mutations were run.

Post-PR-#216 production verification: PR #216 merged and deployed. Manual read-only `cron-credit-reconcile` trigger at 2026-05-26T06:13:57.369Z returned `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=29`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, `missing_bcs_truncated=false`, `drift_truncated=false`, `missing_bcs_summary=[]`, and `drift_summary=[]`. No prod writes, migrations, backfills, payout crons, Neon integration tests, live Stripe calls, or Stripe mutations were run.

Post-PR-#217 production verification: PR #217 merged and deployed, adding the admin goodwill credit UI to the learner detail panel. Manual read-only `cron-credit-reconcile` trigger at 2026-05-26T07:26:01.680Z returned `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=29`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, `missing_bcs_truncated=false`, `drift_truncated=false`, `missing_bcs_summary=[]`, and `drift_summary=[]`. No prod writes, migrations, backfills, payout crons, Neon integration tests, live Stripe calls, Stripe mutations, or goodwill grants were run.

Current-branch Step 5.5 reconciliation writer note (not yet prod-verified): backend writer for `POST /api/admin?action=credit-reconciliation` is implemented behind the existing admin endpoint. Dry-run/inspection remains non-mutating (`inspection_only: true`, `credit_granted: false`). Mutating mode requires a non-empty `reason`, uses the inspection orchestrator plus `buildReconciliationGrantInput()` before mutation, writes through `lockBalanceAndMutate()` / the serialized LCB path, and audit-logs `admin.credit_reconciliation`. The admin UI remains inspection-only; no apply/grant button has shipped. No prod writes, migrations, live Stripe calls, Stripe mutations, goodwill grants, or reconciliation grants were run.

### Cron drift watch

- Daily 08:30 UTC cron `api/cron-credit-reconcile.js`. Returns JSON with `drift_count`, `drift_summary`, `alert_sent`, plus separate read-only path-aware BCS attribution coverage fields `missing_bcs_count`, `missing_bcs_summary`, and `missing_bcs_truncated`. The primary missing count is actionable post-writer coverage, not rollout-window historical gaps.
- Last observed post-PR-#217 read-only output at 2026-05-26T07:26:01.680Z (operator report): `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=29`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, `missing_bcs_truncated=false`, `drift_truncated=false`, `missing_bcs_summary=[]`, `drift_summary=[]`. No prod writes/migrations/backfills/payout crons/Neon integration tests/live Stripe calls/Stripe mutations/goodwill grants were run. verified
- Post-PR #205 stale-BCS repair watch: learner_id=61 / instructor_id=4 recomputed cleanly after the 2026-05-26 08:30 UTC reconcile window (`actual_lcb=1170`, `computed=1170`, `drift=0`). The stale BCS diagnostic for refunded `credit_returned=TRUE` bookings returned 0 rows after repairing `bcs_id=4 / booking_id=235`. verified by read-only prod SELECT, 2026-05-26 08:45 UTC.
- Email alert recipient: `ERROR_ALERT_EMAIL` (= `coachcarteruk@gmail.com` in prod).

### Known-but-deliberately-untouched data (do NOT auto-fix)

Four bookings on grandfathered learners share the refund-without-credit-return shape (`status=refunded, credit_returned=FALSE, minutes_deducted=90`):

| Booking | Learner | Instructor | Why left alone |
|---|---|---|---|
| #111 | 52 (Test Learner) | 4 (Fraser) | Already absorbed by Plan B1 synthetic CT |
| #113 | 24 (Fraser) | 4 (Fraser) | Already absorbed by Plan B1 synthetic CT |
| #165 | 15 (Fraser test) | 4 (Fraser) | Already absorbed by Plan B1 synthetic CT |
| #194 | 15 (Fraser test) | 4 (Fraser) | Already absorbed by Plan B1 synthetic CT |

Flipping `credit_returned = TRUE` on any of these would manufacture **opposite-sign drift** (−90 min per booking) because the matching synthetic CT row is structurally fixed. See `decision-log.md` "B1 / B3 absorption rule".

## Must-check-before-prod-writes

Run through this list before any prod-affecting POST or migration.

1. Are you on `main` and up to date? `git checkout main && git pull origin main` — never continue a stale feature branch.
2. Has the relevant `PER-INSTRUCTOR-CREDITS-PLAN.md` section actually been merged? Confirm via `git log main -- <files>`.
3. Is there an active `migration_markers` row for the step you're about to apply, or an explicit gate (e.g. Step 2 DDL refuses to run until Step 1c backfill marker exists)?
4. Did the writer paths you depend on actually ship? Audit live code with `grep`, not just plan docs (see `feedback_audit_writer_paths_for_reconciles` lesson).
5. For any reconcile/backfill migration: dry-run output **must match prediction row-for-row** before POST. If it diverges, halt and investigate per row (`decision-log.md` → "Dry-run is a safety check, not a progress bar").
6. **Prod writes require explicit Fraser confirmation.** Codex must paste the dry-run, predicted vs actual deltas, and the exact `curl` it intends to fire, and wait.

## Watched in-flight work (off-keyboard)

- Solicitor review of franchise agreement (C10.1, C10.2). Not platform work.
- Stripe Connect for instructor #2 — pending real onboarding date.
- 4th-round external GPT review on `PER-INSTRUCTOR-CREDITS-PLAN.md` (Step 0 of plan is paused until verdict). assumption — last noted 2026-05-19.
- 1st-round external GPT review on `LEARNER-INSTRUCTOR-SELECTION-PLAN.md`. assumption.
- PII leak fix on `api/instructors?action=list` was superseded by PR #190 / commit `976a857`. Current `main` returns only public-safe instructor fields; see `memory/decision-log.md`.
