# Per-Instructor Credits — Revised Delivery Plan

**Status:** drafted 2026-05-19, supersedes the sequencing in `INSTRUCTOR-PAYMENTS-PLAN.md` Steps 3–4g.
**Scope:** moving from pooled `learner_users.balance_minutes` to instructor-scoped credits, with FIFO per-source attribution and snapshotted list pricing.
**Owner:** Fraser.
**Prerequisite reading:** `FRANCHISE-MODEL-PLAN.md` (Phase 1/2 schema, risk callouts), `INSTRUCTOR-PAYMENTS-PLAN.md` (the original Step 3/4/4f/4g specs — still the canonical schema reference), `CLAUDE.md` "Multi-instructor franchise model" + GDPR + security sections, `docs/booking-statuses.md`.

This plan replaces the *sequencing* in those docs but inherits their schemas, principles, and decided rules. Don't re-litigate the three-level pricing fallback, the bulk-tier-instructor-absorbs rule, the year-one-is-human rule, or the Alternatives-Appendix deferrals.

---

## Why this revision exists

GPT-5.5 review on 2026-05-19 surfaced 17 flaws in the original sequencing. Three are blockers, ten are serious, four are worth-considering. The blockers are:

1. **Phase 2A snapshots an effective rate that Phase 2B hasn't built yet** — so credit purchases between Steps 4 and 6 would snapshot the wrong rate. Fix: pricing fallback ships *before* Phase 2A.
2. **`handleCreditPurchase` inserts the transaction row then updates balance in a separate statement.** If the second statement fails, Stripe retries hit the unique index and skip the row entirely — paid transaction, no credited minutes. Already a latent prod bug; Step 4g makes it three writes instead of two. Fix: transactional refactor with `SELECT ... FOR UPDATE` and resumable retries, before Phase 2A.
3. **`?action=book` checks balance then later decrements in a separate statement.** Two concurrent bookings can both see the same source rows as available. Fix: same transactional refactor, applied to slot booking.

The remaining serious flaws are addressed inline in the steps below.

---

## Load-bearing principles (carried forward from FRANCHISE-MODEL-PLAN.md)

1. **Configurability not numbers.** All commercially-meaningful values stay in admin-editable config.
2. **Add config primitives only when actively read.**
3. **Defer until pain shows up.** Trigger conditions in the Alternatives Appendix gate when deferred phases earn their keep.
4. **Three-level pricing fallback** (most-specific wins): per-learner-pair → per-instructor → school default.
5. **Year-one franchise relationships are human, not automated.**

Two new principles surfaced by this revision:

6. **Money mutations are transactional.** Any path that touches `credit_transactions`, `learner_credit_balances`, `booking_credit_sources`, or `lesson_bookings.minutes_deducted` must wrap the writes in a DB transaction with row locks on the source rows. Stripe retries must resume incomplete rows, not skip them on unique-index hits.
7. **Backfill must be honest about what it knows.** When historical price reconstruction is uncertain, snapshot a `list_price_source` tag (`'stripe_metadata' | 'live_compute' | 'unknown'`) and surface `'unknown'` rows in the operator widget rather than silently fabricate a price.

---

## Revised sequencing

| # | Step | Effort | Ships before |
|---|------|--------|--------------|
| 0 | **Webhook transactional refactor + shared `grantCredits()` helper** | 3–4h | Anything else |
| 0.5 | **Shared pence-allocation helper** | 1h | Step 4g fee math |
| 1a | `list_price_pence` + `list_price_source` schema, deployed alone | 1h | 1b |
| 1b | Writer code in every booking INSERT path | 4h | 1c |
| 1c | Backfill with source tagging | 2h | Step 2 |
| 2 | Phase 1 schema: `learner_credit_balances`, `credit_transactions.instructor_id` + `effective_rate_pence_per_minute`, `booking_credit_sources` (nullable + refundable from day one) | 5–7h | Step 3 |
| 3 | Three-level pricing fallback helper (`_pricing-helpers.js getEffectiveHourlyPence()`) | 2–3h | Step 4 |
| 4 | Phase 2A — switch reads/writes to per-instructor | 8–12h | Step 5 |
| 5 | Step 4g — FIFO attribution with `SELECT ... FOR UPDATE` + refunded-row fee invariant + reconciliation cron | 5–7h | Step 6 |
| 6 | Grandfather conversion SQL recipe documented at `docs/credits-grandfather.md` | 1h | — |
| 7 | Phase 2B leftovers — `bulk_tiers_enabled` toggle + learner UI | 2h | — |
| 8 | Phase 2C — admin UI for tiers + per-instructor rates | 6–10h | **DEFERRED** until instructor #2 timing is weeks-not-months AND May revenue trend continues |

**Total to "scoped, attributed, atomic": ~30–40h** across Steps 0–6. Up from the earlier 16–24h estimate because the atomicity refactor and in-flight-checkout legacy branch were missing.

---

## Step 0 — Webhook transactional refactor + shared `grantCredits()`

**Why first.** Three downstream steps (2, 4, 5) compound the existing partial-success bug if it isn't fixed. The refactor is also valuable on its own merits — it closes a real money-movement risk in current prod.

### What changes

- New shared helper `api/_credit-grant.js` exporting `grantCredits({ sql, learnerId, instructorId, schoolId, minutes, amountPence, stripeFeePence, sessionId, effectiveRatePencePerMinute, source })`.
  - Wraps insert into `credit_transactions` + balance mutation in a single transaction.
  - On unique-index hit (Stripe retry), reads the existing row and **resumes** any uncompleted side effects (balance not yet updated, source rows not yet inserted) instead of returning early.
  - Returns `{ transactionId, alreadyProcessed, completed }` so callers can short-circuit notifications when `alreadyProcessed = true`.
- `api/webhook.js handleCreditPurchase` delegates to `grantCredits()`.
- `api/credits.js?action=verify-session` delegates to the same `grantCredits()`. Eliminates the verify-vs-webhook race.
- `api/slots.js?action=book` balance decrement wrapped in a transaction with `SELECT ... FOR UPDATE` on the relevant `learner_users` row (pre-Phase-2A) or `learner_credit_balances` rows (post-Phase-2A).

### Files touched

- New: `api/_credit-grant.js`
- Modified: `api/webhook.js` (handleCreditPurchase, handleSlotBooking), `api/credits.js` (verify-session), `api/slots.js` (action=book deduct path), `api/offers.js` (handleOfferBooking / bookOfferSeries).

### Acceptance criteria

- Manually-injected webhook failure between insert and balance update → next retry completes the credit, no double-credit, no missing minutes.
- Concurrent verify-session + webhook for the same session → one wins, the other returns `alreadyProcessed: true`, balance is correct.
- Two concurrent slot-book requests against the same learner with just-enough credit → one succeeds, one returns `insufficient_credit` cleanly; balance never goes negative.

### Risks

- Refactoring webhook handlers without behavioural change is the kind of work where a subtle regression goes unnoticed for days. Mitigation: add Playwright coverage for the three acceptance scenarios above before merging.

---

## Step 0.5 — Shared pence-allocation helper

**Why.** `api/offers.js` line ~155 uses `Math.floor(totalFee / repeatWeeks)` with the remainder added to the last booked lesson. Step 4g's plan uses banker's rounding. Two different rounding rules in the same pipeline will not reconcile pence-exactly when cross-source FIFO refunds get involved.

### What changes

- New helper `api/_pence-allocator.js` exporting `allocate(totalPence, weights)` returning an integer array that sums exactly to `totalPence`.
- Replace the inline `Math.floor` + remainder logic in `api/offers.js`.
- Will be the sole call site for fee allocation in Step 4g.

### Acceptance criteria

- `allocate(100, [1, 1, 1])` → `[33, 33, 34]` or `[34, 33, 33]` (deterministic, documented).
- `allocate(100, [2, 1])` → `[67, 33]`.
- Sum always equals input.

---

## Step 1 — `list_price_pence` keystone column

Split into 1a / 1b / 1c to avoid the "Vercel ran new code before migration finished" failure mode.

### 1a — Schema (deployed alone, no writer code yet)

```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_pence INTEGER;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_source TEXT
  CHECK (list_price_source IS NULL OR list_price_source IN ('stripe_metadata', 'live_compute', 'unknown'));
```

Both nullable. Migration runs via `GET /api/migrate?secret=...`. **Confirm in prod before merging 1b.**

### 1b — Writer code in every booking INSERT path

Snapshot `list_price_pence` and tag `list_price_source = 'live_compute'` at booking creation, in:

- `api/webhook.js handleSlotBooking`
- `api/offers.js bookOfferSeries` (called from `api/webhook.js handleOfferBooking` and `handleFreeOffer`) — **snapshot per-booked-lesson price from the accepted offer metadata, not later `lesson_types` lookup.** Closes GPT-flaw #9.
- `api/slots.js handleReschedule`
- `api/slots.js ?action=book`
- `api/slots.js bookingDates` loop (~L1010)
- `api/slots.js` free-trial path (~L1898) — **force `list_price_pence = 0` when `payment_method = 'free'` or `minutes_deducted = 0`.** Closes GPT-flaw #8.

Population formula matches the live compute in `api/_payout-helpers.js getEligibleBookings`:

```js
const listPricePence = paymentMethod === 'free' || minutesDeducted === 0
  ? 0
  : await computeListPrice(sql, { schoolId, instructorId, learnerId, lessonTypeId, durationMinutes });
// computeListPrice = COALESCE(custom_hourly × duration / 60, lesson_types.price_pence, 8250)
```

### 1c — Backfill with source tagging

One-shot SQL UPDATE over historical `lesson_bookings`:

- For free-trial / zero-minute rows → `list_price_pence = 0, list_price_source = 'live_compute'`.
- For rows where `lesson_bookings.learner_id IS NOT NULL` and a matching `credit_transactions` row with `stripe_metadata.list_price_pence` exists → use that, tag `'stripe_metadata'`.
- For remaining rows where the live-compute formula can run (learner not anonymised, lesson type still exists) → use it, tag `'live_compute'`.
- For everything else (anonymised learners without payment-record reconstructability, deleted lesson types) → leave `list_price_pence = NULL, list_price_source = 'unknown'`.

**Closes GPT-flaws #6 and #7.** The operator widget already added in PR #149 (alert layer) gains a tile for `list_price_source = 'unknown'` row count; payout cron treats `'unknown'` rows as needing review, not silently paid.

### Cross-cutting writes that also change in Step 1b

- `api/_payout-helpers.js getEligibleBookings` prefers `COALESCE(lb.list_price_pence, <existing live-compute>)`.
- **`getEligibleSchoolBookings` updated in the same PR** — must not ship out of sync with `getEligibleBookings`. Closes GPT-flaw #17.

---

## Step 2 — Phase 1 schema

Schema-only, no behavioural change. Same two-deploy split as Step 1 (schema migration first, then writer code in Step 4).

```sql
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id),
  ADD COLUMN IF NOT EXISTS effective_rate_pence_per_minute INTEGER;

CREATE TABLE IF NOT EXISTS learner_credit_balances (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  balance_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (learner_id, instructor_id)
);
CREATE INDEX IF NOT EXISTS idx_lcb_learner ON learner_credit_balances(learner_id);
CREATE INDEX IF NOT EXISTS idx_lcb_instructor ON learner_credit_balances(instructor_id);

-- Step 4g schema in the SAME migration. Nullable credit_transaction_id and
-- refunded_at from day one — no second migration to fix it later. Closes flaw #11.
CREATE TABLE IF NOT EXISTS booking_credit_sources (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  credit_transaction_id INTEGER REFERENCES credit_transactions(id),  -- NULL for free-trial / admin grant / referral
  minutes_drawn INTEGER NOT NULL CHECK (minutes_drawn > 0),
  rate_pence_per_minute INTEGER NOT NULL,
  contribution_pence INTEGER NOT NULL,
  stripe_fee_pence INTEGER NOT NULL DEFAULT 0,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bcs_booking ON booking_credit_sources(booking_id);
CREATE INDEX IF NOT EXISTS idx_bcs_credit_tx ON booking_credit_sources(credit_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bcs_active ON booking_credit_sources(credit_transaction_id) WHERE refunded_at IS NULL;
```

### Sync trigger — forward-only, not bidirectional

A `BEFORE INSERT OR UPDATE` trigger on `learner_credit_balances` that updates `learner_users.balance_minutes` to the sum of scoped rows for that learner. **One direction only.** Old code writing to `learner_users.balance_minutes` directly is removed in Step 4; until then, the legacy code path remains intact and the trigger keeps pooled view consistent for any read that hasn't migrated yet.

This is deliberately not bidirectional — GPT-flaw #15. A bidirectional trigger that summed scoped → pooled would let Sarah-credits spend with Fraser on a panic rollback. If rollback is needed, the procedure is "stop deploys, restore from snapshot, accept the data-loss window," not "let pooled reads silently mis-route credits."

### Backfill (Step 2 migration, after trigger is live)

```sql
INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
SELECT id, 1 /* Fraser */, school_id, COALESCE(balance_minutes, 0)
FROM learner_users
WHERE balance_minutes > 0
ON CONFLICT (learner_id, instructor_id) DO NOTHING;
```

Hardcoded `instructor_id = 1` is acceptable here because at backfill time Fraser is the only active instructor. Documented as the grandfather rule.

### GDPR additions

Update `api/_gdpr.js deleteLearnerCascade()` to delete `learner_credit_balances` rows. `booking_credit_sources` cascades via `lesson_bookings.learner_id` anonymisation (FK is `ON DELETE CASCADE` from the schema above; the 7-year financial retention applies via the parent `lesson_bookings` row staying with `learner_id = NULL, learner_anonymized = true`). Update `api/learner.js handleExportData()` to include scoped balances and source rows. Closes GPT-flaw #16 and CLAUDE.md GDPR rules #3–#4.

---

## Step 3 — Three-level pricing fallback helper

Moved ahead of Phase 2A so that effective-rate snapshotting in Step 4 has correct numbers. Closes GPT-flaw #1.

### What changes

- New: `api/_pricing-helpers.js` exporting:
  - `getEffectiveHourlyPence(sql, { schoolId, instructorId, learnerId })` → integer pence/hour
  - `getEffectiveRatePencePerMinute(sql, { schoolId, instructorId, learnerId })` → integer pence/minute (banker's-rounded)
  - `calcBulkTotal(sql, schoolId, hours, instructorId)` — refactor existing call site to take optional `instructorId`, fall through to instructor + per-pair rates.
- Precedence (most-specific wins):
  1. `instructor_learner_notes.custom_hourly_rate_pence` (per-learner-pair custom rate)
  2. `instructors.hourly_rate_pence` (per-instructor — NULL means "inherit school")
  3. `schools.config.pricing.bulk_hourly_pence` (school default)
- Bulk discount percentages always apply to the *effective* rate from step 3 — instructor absorbs their own discount. Per CLAUDE.md rule.

### Note on missing columns

`instructors.hourly_rate_pence` doesn't exist in current schema. Add it nullable in this step's migration. The fallback's "NULL means inherit school" rule means no behavioural change for Fraser (whose rate today is the school default) until an admin sets the column explicitly.

---

## Step 4 — Phase 2A: switch reads/writes to per-instructor

### Checkout (`api/credits.js?action=checkout`)

- Required body field: `instructor_id`. Reject `400` if missing once the cutover date is reached (see legacy-session branch below).
- Calls `getEffectiveRatePencePerMinute(sql, { schoolId, instructorId, learnerId })`.
- Stripe `metadata` includes `instructor_id` and `effective_rate_pence_per_minute`.

### Webhook + verify-session

Both routes call `grantCredits()` (from Step 0). `grantCredits()` upserts into `learner_credit_balances(learner_id, instructor_id)` instead of `learner_users.balance_minutes`. Writes `instructor_id` and `effective_rate_pence_per_minute` onto the new `credit_transactions` row.

### Legacy in-flight Stripe sessions

Closes GPT-flaw #2. `grantCredits()` checks for `metadata.instructor_id`:
- Present → route to scoped balance.
- Missing → log a `legacy_pre_cutover` flag, route to **Fraser-scoped balance (instructor_id = 1)**. Bookkeeping audit-logs the routing decision.
- A cutover date is recorded in `docs/credits-grandfather.md`; thirty days later the legacy branch is removed and any still-missing metadata becomes a 500 error (not silently misrouted).

### Booking (`api/slots.js?action=book` and friends)

- Transactional path (Step 0 refactor) now:
  1. `SELECT ... FOR UPDATE` on the appropriate `learner_credit_balances` row.
  2. Verify sufficient minutes.
  3. Decrement.
  4. Insert booking with snapshotted `list_price_pence` (Step 1b).
  5. Insert `booking_credit_sources` rows (Step 5, but the transaction shape is established here).
- **Cross-instructor booking refusal.** If the booking is for instructor B but the learner only has credits for instructor A, return `insufficient_credit_for_instructor` with copy that names instructor B and surfaces the learner's other-instructor balances honestly. Closes GPT-flaw #10.
- **Legacy pooled minutes are modelled as Fraser-scoped.** After Step 2's backfill, `learner_users.balance_minutes` is read-only and any remaining pooled minutes exist only as `learner_credit_balances(learner_id, instructor_id=1)`. There is no separate "legacy pool" — by construction, legacy minutes can only drain for Fraser bookings. The "FIFO drains the wrong pool" risk GPT raised in flaw #10 is structurally impossible after Step 2.

### Learner UI

- `public/learner/profile.html` shows one balance card per instructor with credits.
- "Buy more credit" CTA on instructor profile pages passes `instructor_id` into checkout.

### Acceptance criteria

- A learner with Fraser-scoped 60 mins and instructor-2-scoped 90 mins sees two balance rows on profile.
- Booking a 60-min lesson with Fraser drains Fraser balance, leaves instructor 2 untouched.
- Booking a 60-min lesson with instructor 2 when only Fraser balance exists → polite refusal with honest copy.
- Stripe checkout retried twice (simulate webhook retry) → exactly one balance increment.

---

## Step 5 — Step 4g: FIFO attribution + invariants

### What changes

- Booking creation (inside the Step 0 transaction) inserts one or more `booking_credit_sources` rows after the `learner_credit_balances` decrement.
- FIFO selection: order eligible `credit_transactions` rows by `created_at ASC`, draw `minutes_drawn` from each until the booking's minutes are covered.
- Each `booking_credit_sources` row snapshots `rate_pence_per_minute` from the source `credit_transactions.effective_rate_pence_per_minute`, and a proportional share of `stripe_fee_pence` calculated via `_pence-allocator.js` (Step 0.5).

### Refund semantics

- Cancel ≥48h before lesson start: `booking_credit_sources.refunded_at = NOW()` on all rows for the booking; minutes return to `learner_credit_balances` at original instructor.
- Cancel <48h: `booking_credit_sources` rows stay with `refunded_at = NULL`. `lesson_bookings.credit_forfeited = TRUE`. Booking flips to `chargeable` via cron. Instructor paid `list_price_pence`.

### Fee invariant (closes GPT-flaw #12)

Hard rule: **active (non-refunded) `booking_credit_sources` rows must not sum to more `stripe_fee_pence` than the source `credit_transactions.stripe_fee_pence`.**

- Refunded BCS rows are *excluded* from fee sums.
- If lesson 2 is refunded with ≥48h notice and the minutes are later rebooked, the new BCS row pulls its proportional fee from what remains *unallocated to active rows*, not from the refunded row's snapshot.
- Daily reconciliation cron `api/cron-credit-reconcile.js` (new): asserts the invariant per `credit_transactions` row and emails on breach.

### Concurrency (closes GPT-flaw #14)

`SELECT ... FOR UPDATE` on selected `credit_transactions` rows inside the booking transaction. The transaction shape from Step 0 already wraps this.

---

## Step 6 — Grandfather conversion SQL recipe

One-hour doc-only task: write `docs/credits-grandfather.md` covering:

- The four scenarios GPT-flaw #18 raises: Fraser inactive, Fraser leaves platform, learner switches primary instructor, learner asks to convert credit to a different instructor.
- For each: the SQL recipe an admin runs (two `credit_transactions` rows — zero out the source, grant on the destination — leaving `booking_credit_sources` history untouched).
- The conversion is **manual** for instructor #2. Trigger condition for building admin UI: ≥3 conversion requests in a quarter, OR ≥3 active franchised instructors. Same shape as the other "defer until pain" rules in `FRANCHISE-MODEL-PLAN.md`.

This costs an hour and removes the "stranded learner" risk without building admin UI before it's needed.

---

## Step 7 — Phase 2B leftovers

Small. Ships after credit scoping is live.

- `instructors.bulk_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE` column.
- Bulk-discount tier UI on `public/learner/buy-credits.html` only renders for instructors with `bulk_tiers_enabled = TRUE`.
- Default value FALSE means no behavioural change for Fraser at launch; flip to TRUE when ready.

---

## Step 8 — Phase 2C: admin UI (DEFERRED)

Per the Contrarian caveat in `project_next_session_priority.md`: defer until BOTH (a) instructor #2 timing tightens to weeks-not-months AND (b) May 2026 revenue trend continues into June. Until then, admin SQL is the operating mode.

Trigger conditions to revisit:
- Instructor #2 confirms a start date within 8 weeks, OR
- ≥3 admin SQL conversions/edits in a single month (signal that the manual workaround is real friction).

---

## Things we explicitly chose NOT to do

- **Bidirectional dual-write trigger.** Forward-only only. Rollback = manual reconciliation, not silent re-pooling.
- **Auto-DD invoicing for negative payout weeks.** Stays manual per FRANCHISE-MODEL-PLAN.md, until ≥3 manual debt invoices/quarter or ≥3 active franchised instructors.
- **Refund-a-purchase (cash refund of unused credits) endpoint.** Out of scope, admin SQL until first real request.
- **Backfill fabricating prices for anonymised bookings with no payment record.** Mark `list_price_source = 'unknown'` and surface in operator widget.
- **A rollback flag in `schools.config` that toggles back to pooled reads.** Costs ~1 day to build properly; instructor #2 is a single onboarding and the forward-only trigger + snapshot restore covers the realistic failure mode. Revisit before instructor #3.

---

## Open questions to resolve before starting Step 0

1. **Cutover date for the legacy-session branch in Step 4.** Propose: branch lives for 30 days after Phase 2A merges, then is removed. Want Fraser to sign off on the duration based on typical credit-purchase-to-completion times.
2. **`credit_transactions.remaining_minutes` denormalised column.** Plan recommends denormalised + trigger for read performance; alternative is a view. Pick at coding time based on real read frequency once Step 5 is implemented.
3. **Operator widget tile for `list_price_source = 'unknown'`.** Confirms with Fraser whether it lives on the existing alert-layer widget (shipped 2026-05-17, branch `feat/widget-alert-layer`) or its own card.

---

## How this maps to existing plan docs

- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 3 schema → Step 2 here, with `booking_credit_sources` nullable+refundable from day one.
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4 keystone column → Step 1 here, split into 1a/1b/1c.
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4f Stripe-fee pass-through → already shipped (PRs #134/#135/#136, 2026-05-16).
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4g FIFO → Step 5 here, with explicit fee invariant and reconciliation cron.
- `FRANCHISE-MODEL-PLAN.md` Phase 2A (per-instructor credit scoping) → Step 4 here, with pricing-helper dependency hoisted to Step 3.
- `FRANCHISE-MODEL-PLAN.md` Phase 2B (bulk-tier opt-in + per-instructor rate) → split: pricing helper to Step 3, `bulk_tiers_enabled` toggle to Step 7.
- `FRANCHISE-MODEL-PLAN.md` Phase 2C (admin UI) → Step 8, deferred.
