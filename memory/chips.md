# Chips — pending work queue

Each chip is a small, well-defined unit of work. Goal · why · risks · files · success.

> When you start a chip, move it to the bottom and mark it `IN PROGRESS — <date>`. When it ships, delete the entry and add a one-liner to `current-state.md`.

---

## Plan B2 — remove hardcoded `instructor_id = 1` fallbacks + DELETE seed instructor

- **Goal:** Convert the four `instructor_id = 1` fallbacks to errors, then `DELETE FROM instructors WHERE id = 1` behind a `migration_markers` gate.
- **Why:** CLAUDE.md rule "don't add fallbacks for scenarios that can't happen". Seed instructor 1 has zero FK refs after Plan B1 (verified 2026-05-21); the fallback is dead code that can silently mask future tenancy bugs.
- **Known risks:**
  - File line numbers below are from memory dated 2026-05-21 — re-verify before editing.
  - Make sure no live test fixture seeds `instructor_id = 1`.
- **Likely files:** `api/_credit-grant.js` (around lines 351, 716, 1019), `api/admin.js` (around line 1110), `db/migration.sql` (DELETE behind marker), tests under `tests/credit-grant.*`.
- **Success criteria:**
  - All four fallbacks throw or surface a typed error.
  - Marker `plan_b2_seed_instructor_removed` written.
  - `SELECT FROM instructors WHERE id = 1` returns zero rows on prod.
  - Divergence cron unchanged.

---

## Forward-progress — Step 5 (BCS + FIFO)

- **Goal:** Wire FIFO per-source attribution and cross-source allocation logic per `PER-INSTRUCTOR-CREDITS-PLAN.md`.
- **Why:** Closes the credit-pack-funded booking gap for Step 4f / 4g (Stripe-fee pass-through is currently inert for the majority of bookings). Also unblocks honest per-booking net math for instructor #2 onboarding.
- **Known risks:**
  - Largest single piece of work in the plan (~10–15h of the 38–50h total).
  - Step 0 has shipped; remaining gates: 4th-round GPT critique on the plan + checking longest historical Stripe Checkout-session-to-payment-intent gap.
  - `trg_sync_pooled_balance` prerequisite shipped on prod 2026-05-21; re-verify `pg_trigger` and divergence before starting Step 5.
- **Already present on current `main` / prod:** `booking_credit_sources`, `credit_source_adjustments`, BCS indexes, `UNIQUE (booking_id, credit_transaction_id)`, explicit BCS `school_id` (prod `/api/migrate` after PR #194 verified NOT NULL/default 1/FK/index/null rows 0/mismatch `[]`), read-only path-aware missing active BCS coverage detection in `api/cron-credit-reconcile.js`, and focused tests for `api/_pence-allocator.js`. PR #211, PR #212, PR #213, PR #214, PR #216, PR #217, and PR #218 are merged; latest prod read-only reconcile after #218 returned clean (operator report 2026-05-26).
- **Read-model slice shipped in PR #213:** `api/_payout-helpers.js::getEligibleBookings()` is cut over to prefer `lesson_bookings.list_price_pence`, use active BCS Stripe-fee sums when present, and exclude any active BCS row with `absorbed_by='instructor'`. This keeps `processPayoutForInstructor()` and `simulatePayoutForInstructor()` aligned through the same query, but does not implement Step 5.5 money-moving admin endpoints.
- **Preview confidence hardening shipped in PR #214:** focused read-only coverage proves snapshotted BCS-attributed `list_price_pence` and active BCS `stripe_fee_pence` flow through `computePlatformBalance()` / `simulatePayoutForInstructor()` into the admin Next Payout Preview totals. No UI, endpoint, prod write, payout, migration, backfill, Neon integration test, or Stripe mutation.
- **Step 5.5 state:** PR #216 shipped `credit-goodwill` via `api/_admin-credit-goodwill.js` + `lockBalanceAndMutate` with admin auth, school-scoped learner/instructor checks, reason validation, zero-value goodwill CT shape, LCB upsert/reconcile through the shared path, and audit action `admin.credit_goodwill_grant`. PR #217 added the Learners admin UI form for that endpoint. PR #218 shipped the backend-only `credit-reconciliation` writer behind `POST /api/admin?action=credit-reconciliation`: dry-run/inspection stays non-mutating (`inspection_only: true`, `credit_granted: false`), mutating mode requires a non-empty reason, gates on inspection + `buildReconciliationGrantInput()`, writes through the shared serialized LCB credit mutation path, and audit-logs `admin.credit_reconciliation`. Blocker fixes in pushed commit `48ebc07` reject refunded latest/resolved Stripe Charges via `charge.amount_refunded > 0` while keeping the PaymentIntent-level guard, and verify learner/instructor school scope before `lockBalanceAndMutate()`. The admin UI remains inspection-only with no apply/grant button. Full local `npm.cmd test` after fixes passed: 193 passed / 169 skipped.
- **Post-PR-#218 prod verification:** PR #218 merged and deployed on 2026-05-26. Manual read-only `cron-credit-reconcile` trigger at 2026-05-26T09:47:19.119Z returned `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=30`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, `missing_bcs_summary=[]`, `drift_summary=[]`, `missing_bcs_truncated=false`, and `drift_truncated=false`. No real-payment reconciliation grants, goodwill grants, UI apply/grant path, migrations, payout crons, Neon/prod integration tests, live Stripe calls, or Stripe mutations were run.
- **Accepted decisions (2026-05-21):** add `booking_credit_sources.school_id`; reschedules refund old BCS rows and create fresh replacement rows; mixed-source `list_price_pence` sums payable active BCS contribution excluding instructor-absorbed portions only; direct paid slot purchases create BCS rows against `slot_purchase` CTs; `contribution_pence` is exact payable pence from source `amount_pence` net of CSA `pence_adjusted`, while `rate_pence_per_minute` is rounded audit/display only.
- **Likely files:** `api/_credit-grant.js` (writer wiring), `api/slots.js` / `api/webhook.js` / `api/offers.js` (allocation at booking time), `api/admin.js` + `api/_admin-credit-contracts.js` + `api/_admin-credit-goodwill.js` + `api/_admin-credit-reconciliation*.js` (Step 5.5 admin grant/reconciliation paths), `public/admin/portal.js` (goodwill UI + reconciliation inspection-only UI), `api/_payout-helpers.js` (cron + preview read per-source), `tests/booking-credit-sources.*`, `tests/admin-credit-contract.spec.js`, `tests/admin-goodwill-ui.spec.js`, `tests/admin-credit-reconciliation-*.spec.js`.
- **Success criteria:**
  - `booking_credit_sources` rows created for every new booking after cutover.
  - FIFO order `(created_at ASC, id ASC)` verified in integration tests.
  - Pence-exact fee and contribution allocation with last-draw-takes-remainder (source-level over-allocation and equality-on-exhaustion invariants, with CSA pence counted for contribution conservation).
  - `processPayoutForInstructor` and `simulatePayoutForInstructor` remain in lockstep for any payout math change.
  - Divergence cron continues to return `drift_count = 0` post-cutover, with `missing_bcs_count = 0` confirming active post-writer credit bookings have active BCS attribution.

---

## Watchlist (not yet chips)

- **Trigger B threshold recalibration** — needs 2–3 weeks of post-2026-05-22 outflow data. Revisit then.
- **Pre-existing `tests/cookie-consent.spec.js` flake** — two real test races, both pass on retry. Worth a small fixup PR if it flakes a third time.
- **`payouts_start_date` floor on `getEligibleSchoolBookings`** — instructor-side floor exists; school-side asymmetry deferred. Pick up before instructor #3.
- **Pre-payout Stripe balance check (Tier 3 #3.10)** — matters once instructor #3 onboards.
