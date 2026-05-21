# Chips — pending work queue

Each chip is a small, well-defined unit of work. Goal · why · risks · files · success.

> When you start a chip, move it to the bottom and mark it `IN PROGRESS — <date>`. When it ships, delete the entry and add a one-liner to `current-state.md`.

---

## Chip #4 — install `trg_sync_pooled_balance` trigger

- **Goal:** POST `/api/migrate-step-4` so the trigger exists on prod.
- **Why:** Currently latent — pooled `learner_users.balance_minutes` happens to equal `SUM(learner_credit_balances)` by Step 2c coincidence and because Plan B3 didn't write LCB rows. Once Step 5 (BCS + FIFO) starts writing LCB actively, `learner_users.balance_minutes` will drift from the per-instructor truth unless the trigger keeps them in sync.
- **Known risks:**
  - If any live reader of `learner_users.balance_minutes` is intolerant of staleness today, installing the trigger doesn't help retroactively — re-audit before deferring further. Known reader: `api/instructor.js:1468` (verify line number; the memory note is from 2026-05-21).
  - Trigger semantics on Neon HTTP driver: confirm the trigger fires inside the same statement, not in a separate connection.
- **Likely files:** `db/migration.sql` (definition), `api/migrate-step-4.js` (apply endpoint), `api/instructor.js` (read-site audit), `api/_credit-grant.js` (writer-paths it monitors).
- **Success criteria:**
  - Trigger present on prod (`SELECT … FROM pg_trigger WHERE tgname = 'trg_sync_pooled_balance'` returns one row).
  - A forced LCB UPDATE in an integration test moves `learner_users.balance_minutes` by the same delta.
  - Divergence cron continues to return `drift_count = 0`.

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

## Plan-blocker — PII leak on `api/instructors?action=list`

- **Goal:** Whitelist response fields on the public instructor list endpoint so email + phone are no longer returned.
- **Why:** Both the credits plan and the learner-UX plan expand the public instructor API surface. Must merge before either plan ships.
- **Known risks:**
  - Status is `assumption` (memory dated 2026-05-19). Re-verify it's still present before opening a branch.
  - Need to grep frontend for any code that reads the leaked fields and refactor first.
- **Likely files:** `api/instructors.js`, frontend callers under `public/`.
- **Success criteria:**
  - `curl https://www.coachcarter.uk/api/instructors?action=list` returns no `email` or `phone` fields.
  - No frontend regression in the instructor profile UI.
  - Spec test added asserting the response shape.

---

## Forward-progress — Step 5 (BCS + FIFO)

- **Goal:** Implement `booking_credit_sources` table + FIFO per-source attribution + cross-source allocation logic per `PER-INSTRUCTOR-CREDITS-PLAN.md`.
- **Why:** Closes the credit-pack-funded booking gap for Step 4f / 4g (Stripe-fee pass-through is currently inert for the majority of bookings). Also unblocks honest per-booking net math for instructor #2 onboarding.
- **Known risks:**
  - Largest single piece of work in the plan (~10–15h of the 38–50h total).
  - Step 0 has shipped; remaining gates: 4th-round GPT critique on the plan + checking longest historical Stripe Checkout-session-to-payment-intent gap.
  - Triggers the install of `trg_sync_pooled_balance` (chip #4) as a prerequisite.
- **Likely files:** `db/migration.sql` (new table + indexes), `api/_credit-grant.js` (writer wiring), `api/webhook.js` (allocation at booking time), `api/_payout-helpers.js` (cron reads per-source), `tests/booking-credit-sources.*`.
- **Success criteria:**
  - `booking_credit_sources` rows created for every new booking after cutover.
  - FIFO order `(created_at ASC, id ASC)` verified in integration tests.
  - Pence-exact allocation with last-draw-takes-remainder (two invariants: over-allocation ≤; equality-on-exhaustion when source is 0).
  - Divergence cron continues to return `drift_count = 0` post-cutover.

---

## Watchlist (not yet chips)

- **Trigger B threshold recalibration** — needs 2–3 weeks of post-2026-05-22 outflow data. Revisit then.
- **Pre-existing `tests/cookie-consent.spec.js` flake** — two real test races, both pass on retry. Worth a small fixup PR if it flakes a third time.
- **`payouts_start_date` floor on `getEligibleSchoolBookings`** — instructor-side floor exists; school-side asymmetry deferred. Pick up before instructor #3.
- **Pre-payout Stripe balance check (Tier 3 #3.10)** — matters once instructor #3 onboards.
