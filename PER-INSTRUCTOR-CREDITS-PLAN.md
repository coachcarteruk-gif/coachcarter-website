# Per-Instructor Credits — Revised Delivery Plan

**Status:** drafted 2026-05-19, revised three times the same day: (1) `/scientific-critical-thinking` review, (2) admin-grant walkthrough with Fraser, (3) second external GPT-5.5 review that found 14 further flaws (2 blockers re-categorised after re-review, 5 additional blockers, more serious findings). Supersedes the sequencing in `INSTRUCTOR-PAYMENTS-PLAN.md` Steps 3–4g.
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

A subsequent critical-thinking review (same session) surfaced four additional gaps that this revision also closes:

- **`'unknown'` payout-cron behaviour was unspecified.** Now: pay everything else, queue `'unknown'` rows for manual sign-off via operator widget. → Step 1c.
- **`'live_compute'` was doing double duty.** Insert-time snapshots and backfill reconstructions had the same tag despite different epistemic statuses. Split into `'live_compute_insert'` and `'live_compute_backfill'`. → Step 1 schema.
- **Fee-rebooking formula was hand-waved.** Now: per-minute method, stateless and idempotent, with worked example. → Step 5.
- **No falsifiability section.** Now: six concrete invariants asserted by daily reconciliation cron. → "How we'd know this plan failed" section.

A subsequent walkthrough of admin-grant scenarios with Fraser added Step 5.5 (admin reconciliation + goodwill endpoints) and changed `booking_credit_sources.credit_transaction_id` from nullable to NOT NULL — every BCS row points to a real source row, free trials and goodwill grants get their own zero-value `credit_transactions` rows.

A third round of external GPT-5.5 review (16:42 same day) returned 14 further flaws. The fixes are integrated throughout this revision; the headline changes are:

- **Step 3 (pricing helper) moved BEFORE Step 1b** so insert-time snapshots use the three-level fallback from the first row written. Eliminates the "live_compute_insert is misleading before Step 3" window.
- **Reconciliation looks up by all three Stripe identities** (session_id, payment_intent_id, charge_id) with explicit reject conditions for partial refunds, disputes, amount mismatches, missing metadata. Closes the "double-grant if original row lacks payment_intent_id" blocker.
- **Step 2 is split into 2a/2b/2c sub-phases** with backfill of `stripe_payment_intent_id` on existing rows BEFORE the unique index is created. Closes the migration race.
- **Goodwill absorption is now a property of `credit_transactions`** (copied to `booking_credit_sources.absorbed_by` at draw time). Closes the "absorbed status doesn't survive refund/rebook" blocker.
- **`list_price_pence = 0` for instructor-absorbed bookings**, with proportional handling for mixed-source bookings. Closes "goodwill writer may snapshot nonzero list_price_pence."
- **Per-minute fee allocation switches to last-draw-takes-remainder** for pence-exact allocation. Closes the "penny leak" and "invariant too weak" flaws.
- **Cash refunds use a new `credit_source_adjustments` table** (immutable source totals + additive history). Closes the "ledger semantics are contradictory" blocker.
- **Free-trial wiring lives in Step 1b** (not deferred to Step 5.5). Closes the "free trial NOT NULL source" blocker.
- **Forward-only trigger has explicit 3-phase sequencing** (A: no trigger, B: writers cut over + trigger created, C: cleanup) with a nightly pooled-vs-scoped divergence check. Closes "transition inconsistency."
- **Step 1c writes a backfill-complete marker; Step 2 DDL refuses to run without it.** Closes the migration ordering race.
- **Reconciliation has explicit reject conditions** (amount_received mismatch, amount_refunded>0, dispute, missing metadata keys, no Checkout Session). Closes "Stripe live-state mismatch."

Business decisions resolved with Fraser during this round:

- **Goodwill franchise-fee semantics:** instructor-absorbed goodwill excludes lesson REVENUE only. Weekly franchise fee accrues normally.
- **Cash-refund model:** separate `credit_source_adjustments` table (not adjustment columns on `credit_transactions`). Aligns with "never hard-delete financial records" and supports admin corrections / dispute clawbacks generally.

---

## Load-bearing principles (carried forward from FRANCHISE-MODEL-PLAN.md)

1. **Configurability not numbers.** All commercially-meaningful values stay in admin-editable config.
2. **Add config primitives only when actively read.**
3. **Defer until pain shows up.** Trigger conditions in the Alternatives Appendix gate when deferred phases earn their keep.
4. **Three-level pricing fallback** (most-specific wins): per-learner-pair → per-instructor → school default.
5. **Year-one franchise relationships are human, not automated.**

Two new principles surfaced by this revision:

6. **Money mutations are transactional.** Any path that touches `credit_transactions`, `learner_credit_balances`, `booking_credit_sources`, or `lesson_bookings.minutes_deducted` must wrap the writes in a DB transaction with row locks on the source rows. Stripe retries must resume incomplete rows, not skip them on unique-index hits.
7. **Backfill must be honest about what it knows.** When historical price reconstruction is uncertain, snapshot a `list_price_source` tag (`'stripe_metadata' | 'live_compute_insert' | 'live_compute_backfill' | 'unknown'`) and surface `'unknown'` rows in the operator widget rather than silently fabricate a price. The `_insert` vs `_backfill` distinction matters: insert-time snapshots are trustworthy (pricing inputs are live at the moment of booking); backfill snapshots are best-effort reconstruction (inputs may have changed since the booking).

---

## Revised sequencing

| # | Step | Effort | Ships before |
|---|------|--------|--------------|
| 0 | **Webhook transactional refactor + shared `grantCredits()` helper** | 3–4h | Anything else |
| 0.5 | **Shared pence-allocation helper** | 1h | Step 4g fee math |
| 1a | `list_price_pence` + `list_price_source` schema, deployed alone | 1h | 3 |
| 3 | **Three-level pricing fallback helper** (`_pricing-helpers.js getEffectiveHourlyPence()`) — **MOVED before Step 1b** so insert-time snapshots use correct rates from day one. Closes 3rd-round flaw "live_compute_insert is misleading before Step 3 ships." | 2–3h | 1b |
| 1b | Writer code in every booking INSERT path (uses Step 3 helper). Also wires free-trial path to create a zero-value `credit_transactions` row with `source = 'free_trial'`. Closes 3rd-round flaw "Free trial NOT NULL source." | 4–5h | 1c |
| 1c | Backfill with source tagging + write `backfill_complete = TRUE` marker row | 2h | Step 2 |
| 2 | Phase 1 schema: `learner_credit_balances`, `credit_transactions` columns, `booking_credit_sources` (with natural-key unique constraint for resumability), `credit_source_adjustments` table. **Gated on Step 1c backfill-complete marker.** | 6–8h | Step 4 |
| 4 | Phase 2A — switch reads/writes to per-instructor + forward-only trigger sequencing | 8–12h | Step 5 |
| 5 | Step 4g — FIFO attribution + per-minute fee with last-draw-takes-remainder + equality-on-exhaustion invariant + cash-refund via `credit_source_adjustments` | 6–8h | Step 5.5 |
| 5.5 | Admin grant endpoints — `credit-reconciliation` (lookup by session+PI+charge, explicit reject conditions) + `credit-goodwill` (absorption on `credit_transactions`, propagates to BCS) | 5–6h | Step 6 |
| 6 | Grandfather conversion SQL recipe at `docs/credits-grandfather.md` | 1h | — |
| 7 | Phase 2B leftovers — `bulk_tiers_enabled` toggle + learner UI | 2h | — |
| 8 | Phase 2C — admin UI for tiers + per-instructor rates | 6–10h | **DEFERRED** until instructor #2 timing is weeks-not-months AND May revenue trend continues |

**Total to "scoped, attributed, atomic": ~38–50h** across Steps 0–6. Up from the earlier 34–45h estimate after 3rd-round critique added: free-trial credit_transactions row wiring (Step 1b), BCS natural-key unique constraint (Step 0/2), `credit_source_adjustments` table (Step 2), tighter reconciliation reject conditions (Step 5.5), goodwill propagation through refund/rebook (Step 5.5). Effort ranges are point estimates — assume planning-fallacy tax of ~30% on top.

---

## Step 0 — Webhook transactional refactor + shared `grantCredits()`

**Why first.** Three downstream steps (2, 4, 5) compound the existing partial-success bug if it isn't fixed. The refactor is also valuable on its own merits — it closes a real money-movement risk in current prod.

### What changes

- New shared helper `api/_credit-grant.js` exporting `grantCredits({ sql, learnerId, instructorId, schoolId, minutes, amountPence, stripeFeePence, sessionId, paymentIntentId, effectiveRatePencePerMinute, source })`.
  - Wraps insert into `credit_transactions` + balance mutation in a single transaction.
  - On unique-index hit (Stripe retry on `stripe_session_id` or `stripe_payment_intent_id`), reads the existing row and **resumes** any uncompleted side effects (balance not yet updated, source rows not yet inserted) instead of returning early.
  - Resumability is enforced by unique constraints on every resumable side effect, not by a state machine. Specifically:
    - `credit_transactions.stripe_session_id` (existing) — prevents double credit-transaction insert
    - `credit_transactions.stripe_payment_intent_id` (new in Step 2) — secondary identity
    - `booking_credit_sources` natural-key unique on `(booking_id, credit_transaction_id)` (new in Step 2) — prevents double BCS insert during retry. **Note:** if a single booking can legitimately draw from the same source twice (e.g. a booking expanded after partial refund), this needs to widen to `(booking_id, credit_transaction_id, sequence_no)`. Default plan assumes one draw per (booking, source) pair; revisit if Step 5 surfaces a real case.
    - Balance upserts are naturally idempotent (`INSERT ... ON CONFLICT ... DO UPDATE SET balance_minutes = EXCLUDED.balance_minutes` with running totals derived inside the transaction from BCS rows).
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
  CHECK (list_price_source IS NULL OR list_price_source IN ('stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown'));
```

Both nullable. Migration runs via `GET /api/migrate?secret=...`. **Confirm in prod before merging 1b.**

### 1b — Writer code in every booking INSERT path

Snapshot `list_price_pence` and tag `list_price_source = 'live_compute_insert'` at booking creation, in:

- `api/webhook.js handleSlotBooking`
- `api/offers.js bookOfferSeries` (called from `api/webhook.js handleOfferBooking` and `handleFreeOffer`) — **snapshot per-booked-lesson price from the accepted offer metadata, not later `lesson_types` lookup.** Closes GPT-flaw #9.
- `api/slots.js handleReschedule`
- `api/slots.js ?action=book`
- `api/slots.js bookingDates` loop (~L1010)
- `api/slots.js` free-trial path (~L1898) — see "Free-trial wiring" below. Closes GPT-flaw #8 + 3rd-round flaw "Free trial NOT NULL source."

Population formula uses the Step 3 helper `getEffectiveRatePencePerMinute`:

```js
const listPricePence = paymentMethod === 'free' || minutesDeducted === 0
  ? 0
  : Math.round(durationMinutes * await getEffectiveRatePencePerMinute(sql, { schoolId, instructorId, learnerId }));
```

Because Step 3 ships before Step 1b in the revised sequencing, insert-time snapshots are always computed via the three-level fallback (per-pair → per-instructor → school default). No risk of an intermediate window where `'live_compute_insert'` snapshots used the legacy school-only path.

### Free-trial wiring (NEW in 3rd revision)

`booking_credit_sources.credit_transaction_id` is NOT NULL, so free-trial bookings (which today don't write to `credit_transactions` at all) must create a zero-value source row. In Step 1b, the `?action=book-free-trial` path is updated to:

1. Inside the booking transaction (Step 0's `grantCredits()` shape applies here too):
2. Insert a `credit_transactions` row:
   - `source = 'free_trial'`
   - `amount_pence = 0`
   - `stripe_fee_pence = 0`
   - `minutes = <trial duration>`
   - `absorbed_by = 'platform'`
   - `effective_rate_pence_per_minute` = school default (so payout cron has a non-NULL value)
   - `instructor_id` = the trial's instructor
3. Insert the `lesson_bookings` row with `list_price_pence = 0, list_price_source = 'live_compute_insert'`, `payment_method = 'free'`.
4. Insert the `booking_credit_sources` row linking the booking to the new source.
5. Skip the `learner_credit_balances` upsert (no minutes were granted to "spend later" — the free trial is a one-shot).

**Cancellation/rebook semantics for free trials:** if cancelled ≥48h, the BCS row's `refunded_at` is set but the `credit_transactions` source row stays. A free trial can't be "rebooked from balance" because no balance was created — re-booking a free trial requires a new free-trial action and creates a new source row.

### 1c — Backfill with source tagging

One-shot SQL UPDATE over historical `lesson_bookings`:

- For free-trial / zero-minute rows → `list_price_pence = 0, list_price_source = 'live_compute_backfill'`.
- For rows where `lesson_bookings.learner_id IS NOT NULL` and a matching `credit_transactions` row with `stripe_metadata.list_price_pence` exists → use that, tag `'stripe_metadata'`.
- For remaining rows where the live-compute formula can run (learner not anonymised, lesson type still exists) → use it, tag `'live_compute_backfill'`.
- For everything else (anonymised learners without payment-record reconstructability, deleted lesson types) → leave `list_price_pence = NULL, list_price_source = 'unknown'`.

**Closes GPT-flaws #6 and #7.** The operator widget (alert layer shipped 2026-05-17) gains a tile for `list_price_source = 'unknown'` row count.

### Backfill-complete marker (NEW in 3rd revision)

After the UPDATE finishes, insert a marker row into a new `migration_markers` table:

```sql
CREATE TABLE IF NOT EXISTS migration_markers (
  key TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

INSERT INTO migration_markers (key, notes)
VALUES ('per_instructor_credits_step_1c_backfill', 'list_price_pence + list_price_source backfilled')
ON CONFLICT (key) DO NOTHING;
```

**Step 2's DDL and trigger creation MUST check this marker exists** before running. The migration script wraps the Step 2 statements in:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migration_markers WHERE key = 'per_instructor_credits_step_1c_backfill') THEN
    RAISE EXCEPTION 'Step 2 cannot run until Step 1c backfill completes. Run /api/migrate?action=run-step-1c first.';
  END IF;
  -- Step 2 DDL here
END $$;
```

Closes 3rd-round flaw "Migration ordering around Step 2 trigger can run against incomplete derived data."

### Payout cron behaviour for each tag

| Tag | Cron behaviour |
|---|---|
| `'stripe_metadata'` | Pay normally. Highest trust. |
| `'live_compute_insert'` | Pay normally. High trust (pricing inputs were live at booking time). |
| `'live_compute_backfill'` | Pay normally. Lower trust but acceptable — flagged in widget as informational. |
| `'unknown'` | **Pay everything else; queue these for manual sign-off.** Surface in operator widget with a 'Review & approve' button. No payout blocked by default — the cron continues for trustworthy rows. |

This is operational, not aspirational: the `getEligibleBookings` query excludes `list_price_source = 'unknown'` rows; a sibling `getReviewBookings` query returns them for the widget.

### Cross-cutting writes that also change in Step 1b

- `api/_payout-helpers.js getEligibleBookings` prefers `COALESCE(lb.list_price_pence, <existing live-compute>)`.
- **`getEligibleSchoolBookings` updated in the same PR** — must not ship out of sync with `getEligibleBookings`. Closes GPT-flaw #17.

---

## Step 2 — Phase 1 schema

Schema-only, no behavioural change. Same two-deploy split as Step 1 (schema migration first, then writer code in Step 4).

Step 2 must run in three sub-phases to avoid the "in-flight write hits a missing column or premature unique constraint" failure mode:

**Sub-phase 2a — add columns (nullable, no constraints).**

```sql
-- credit_transactions: add scoping, rate snapshot, source tagging, absorption flag, Stripe linkage,
-- and cash-refund tracking.
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id),
  ADD COLUMN IF NOT EXISTS effective_rate_pence_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe'
    CHECK (source IS NULL OR source IN ('stripe', 'free_trial', 'reconciliation', 'goodwill')),
  ADD COLUMN IF NOT EXISTS absorbed_by TEXT
    CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor')),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;
```

**Sub-phase 2b — backfill historical rows.**

Closes 3rd-round blocker "reconciliation can double-grant if existing webhook row lacks `stripe_payment_intent_id`."

```sql
-- Pull payment_intent_id from existing Stripe metadata stored on credit_transactions
-- (the webhook handler stores it in stripe_metadata JSONB).
UPDATE credit_transactions
SET stripe_payment_intent_id = stripe_metadata->>'payment_intent_id'
WHERE stripe_payment_intent_id IS NULL
  AND stripe_metadata->>'payment_intent_id' IS NOT NULL;

-- Same for charge_id where available.
UPDATE credit_transactions
SET stripe_charge_id = stripe_metadata->>'charge_id'
WHERE stripe_charge_id IS NULL
  AND stripe_metadata->>'charge_id' IS NOT NULL;

-- For rows where stripe_metadata doesn't carry these IDs (older rows), they stay NULL.
-- Reconciliation in Step 5.5 handles NULL gracefully by also looking up via stripe_session_id.

-- Existing rows default to source = 'stripe' (set by DEFAULT in 2a).
-- Set source = NOT NULL only after backfill confirms all existing rows tagged.
UPDATE credit_transactions SET source = 'stripe' WHERE source IS NULL;
ALTER TABLE credit_transactions ALTER COLUMN source SET NOT NULL;
```

**Sub-phase 2c — add unique constraints and remaining tables.**

```sql
-- Reconciliation idempotency: prevent re-granting the same Stripe payment twice.
-- This runs AFTER backfill so existing rows already have payment_intent_id populated where available.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_payment_intent
  ON credit_transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_charge
  ON credit_transactions(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

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

-- Step 4g schema. credit_transaction_id is NOT NULL because every BCS row points to a real
-- credit_transactions row — free-trial / goodwill / referral grants all create their own
-- credit_transactions row (with amount_pence = 0 where applicable). This keeps FIFO ordering
-- trivial and eliminates the "NULL source" special case.
CREATE TABLE IF NOT EXISTS booking_credit_sources (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
  minutes_drawn INTEGER NOT NULL CHECK (minutes_drawn > 0),
  rate_pence_per_minute INTEGER NOT NULL,
  contribution_pence INTEGER NOT NULL,
  stripe_fee_pence INTEGER NOT NULL DEFAULT 0,
  absorbed_by TEXT CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor')),  -- copied from source at draw time
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Natural-key uniqueness for resumability (Step 0). If a booking legitimately draws from the
  -- same source twice (e.g. expansion after partial refund), widen to include a sequence_no.
  UNIQUE (booking_id, credit_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_bcs_booking ON booking_credit_sources(booking_id);
CREATE INDEX IF NOT EXISTS idx_bcs_credit_tx ON booking_credit_sources(credit_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bcs_active ON booking_credit_sources(credit_transaction_id) WHERE refunded_at IS NULL;

-- Cash-refund ledger (NEW in 3rd revision). Immutable source totals + additive adjustments.
-- Never mutate credit_transactions.minutes or amount_pence — BCS snapshots depend on those
-- historical facts. Closes 3rd-round blocker "Cash-refund ledger semantics are contradictory."
CREATE TABLE IF NOT EXISTS credit_source_adjustments (
  id SERIAL PRIMARY KEY,
  credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
  kind TEXT NOT NULL CHECK (kind IN ('cash_refund', 'admin_correction', 'dispute_clawback')),
  minutes_adjusted INTEGER NOT NULL,  -- positive value, "subtract this many minutes from available"
  pence_adjusted INTEGER NOT NULL,    -- positive value, "this many pence were refunded/clawed back"
  reason TEXT NOT NULL,
  stripe_refund_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by INTEGER REFERENCES admin_users(id),
  UNIQUE (stripe_refund_id)  -- idempotency: same Stripe refund cannot apply twice
);
CREATE INDEX IF NOT EXISTS idx_csa_credit_tx ON credit_source_adjustments(credit_transaction_id);
```

### `credit_transactions.source` semantics

Four possible values. Every credit_transactions row has exactly one source.

| Source | Created when | `amount_pence` | `stripe_fee_pence` | `absorbed_by` | Instructor paid? |
|---|---|---|---|---|---|
| `'stripe'` | Normal credit purchase via Stripe Checkout webhook | real | real | NULL | Yes, normal payout |
| `'free_trial'` | Free-trial booking path in `api/slots.js` | 0 | 0 | `'platform'` | Yes, platform absorbs `list_price_pence` |
| `'reconciliation'` | Admin action `admin.credit_reconciliation` for a real Stripe payment whose webhook failed | real (from Stripe API) | real (from Stripe API) | NULL | Yes, normal payout |
| `'goodwill'` | Admin action `admin.credit_goodwill_grant` | 0 | 0 | `'platform'` or `'instructor'` (admin picks) | Depends on `absorbed_by` |

**Payout cron rule:** for a BCS row whose source has `absorbed_by = 'instructor'`, the parent booking is **excluded** from the instructor's payout entirely. For all other cases the booking is paid normally at `list_price_pence`.

### Sync trigger — forward-only, with strict transition sequencing

An `AFTER INSERT OR UPDATE` trigger on `learner_credit_balances` that updates `learner_users.balance_minutes` to the sum of scoped rows for that learner. **One direction only** (LCB → pooled), never the reverse.

**The trigger is enabled in three precisely-ordered phases to close 3rd-round flaw "Forward-only trigger leaves transition inconsistency":**

**Phase A (during Step 2 deploy):** Trigger DOES NOT exist yet. Legacy code in `api/credits.js`, `api/webhook.js`, `api/slots.js` still writes `learner_users.balance_minutes` directly. LCB rows are populated by the Step 2 backfill but no writes are routed there yet.

**Phase B (Step 4 deploy):** All writers in `api/credits.js`, `api/webhook.js`, `api/slots.js`, and `api/offers.js` are switched to write LCB rows instead of `learner_users.balance_minutes`. At deploy time, the trigger is created:

```sql
CREATE OR REPLACE FUNCTION sync_pooled_balance() RETURNS TRIGGER AS $$
BEGIN
  -- GDPR DELETE no-op: if the learner is being deleted, skip the update.
  IF TG_OP = 'DELETE' OR NEW.learner_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE learner_users
  SET balance_minutes = COALESCE(
    (SELECT SUM(balance_minutes) FROM learner_credit_balances WHERE learner_id = NEW.learner_id),
    0
  )
  WHERE id = NEW.learner_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_pooled_balance
  AFTER INSERT OR UPDATE ON learner_credit_balances
  FOR EACH ROW EXECUTE FUNCTION sync_pooled_balance();
```

`learner_users.balance_minutes` is now read-only from application code (no DIRECT writes); the trigger maintains it as a denormalised mirror for any legacy reader that hasn't yet been migrated. Any code path that still writes directly to `learner_users.balance_minutes` after Phase B is a bug — flagged by the divergence check below.

**Phase C (post-Step-4 cleanup, ~2 weeks after Phase B):** Once we've confirmed no divergence in production for two weeks, mark `learner_users.balance_minutes` deprecated in code (DB column stays for now to support PITR rollback). Final removal of the column is deferred until ≥3 months of clean production data.

### Divergence check (runs nightly during Phases B and C)

```sql
SELECT u.id AS learner_id,
       u.balance_minutes AS pooled,
       COALESCE(SUM(lcb.balance_minutes), 0) AS scoped_sum
FROM learner_users u
LEFT JOIN learner_credit_balances lcb ON lcb.learner_id = u.id
GROUP BY u.id, u.balance_minutes
HAVING u.balance_minutes IS DISTINCT FROM COALESCE(SUM(lcb.balance_minutes), 0);
```

Any non-empty result emails the operator: either a legacy writer is still firing (bug) or the trigger has missed an event (worse bug). Investigate before next Friday payout.

This is deliberately not bidirectional. A bidirectional trigger that summed scoped → pooled would let Sarah-credits spend with Fraser on a panic rollback. If rollback is needed, the procedure is "stop deploys, restore from PITR snapshot, accept the data-loss window."

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

Update `api/_gdpr.js deleteLearnerCascade()`:
- DELETE `learner_credit_balances` rows for the learner BEFORE deleting the parent `learner_users` row (avoids the trigger firing against a learner row that's mid-deletion).
- The trigger's GDPR no-op (above) is a belt-and-braces second defence: if for any reason the LCB rows are deleted after the parent learner row, the trigger returns silently rather than attempting a doomed UPDATE.

`booking_credit_sources` and `credit_source_adjustments` are financial records — they stay attached to the anonymised `lesson_bookings` (learner_id = NULL) and `credit_transactions` rows respectively, under CLAUDE.md GDPR rule #7's 7-year retention. **Do not delete BCS or adjustment rows on learner deletion.**

Update `api/learner.js handleExportData()` to include:
- `learner_credit_balances` (per-instructor balance snapshot at export time)
- `credit_transactions` (full history including source, absorbed_by, fee snapshots)
- `booking_credit_sources` (joined via the learner's bookings)
- `credit_source_adjustments` (joined via the learner's `credit_transactions` rows)

Closes GPT-flaw #16, 3rd-round flaw "DELETE trigger/GDPR behavior is under-specified," and CLAUDE.md GDPR rules #3–#4.

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
- FIFO selection: order eligible `credit_transactions` rows by `created_at ASC, id ASC` (id is the deterministic tie-breaker for identical timestamps).
- Each `booking_credit_sources` row snapshots its own `rate_pence_per_minute` and `stripe_fee_pence` from the source row at draw time. Once snapshotted, these values never change.

### Fee snapshot formula — per-minute with last-draw-takes-remainder

Closes 3rd-round flaws "per-minute Stripe-fee allocation leaks pennies" and "the fee invariant is too weak."

For each BCS row at insert time:

```js
// Compute remaining minutes on the source AFTER this draw.
const minutesAfterDraw = source.minutes
  - (sum of minutes_drawn across non-refunded BCS for this source)
  - (sum of minutes_adjusted across credit_source_adjustments for this source)
  - minutes_drawn;  // this draw

const isFinalDraw = minutesAfterDraw === 0;

let stripeFeePence;
if (isFinalDraw) {
  // Last draw takes whatever pence remain unallocated. Guarantees pence-exact allocation.
  const allocatedSoFar = (sum of stripe_fee_pence across non-refunded BCS for this source);
  stripeFeePence = source.stripe_fee_pence - allocatedSoFar;
} else {
  // Normal rounded share.
  stripeFeePence = Math.round(minutes_drawn * (source.stripe_fee_pence / source.minutes));
}
```

**Properties:**
- **Pence-exact when a source is fully consumed:** once the source has 0 minutes remaining, sum of active BCS fees equals `source.stripe_fee_pence` exactly.
- **Stateless for non-final draws:** the only state-dependent branch is "am I the final draw?" — a one-line `SUM` query inside the same transaction as the BCS insert.
- **Loud failures (two invariants, both falsifiable):**
  1. Over-allocation: `SUM(active BCS fees) ≤ source.stripe_fee_pence` (always).
  2. Equality-on-exhaustion (NEW in 3rd revision): when a source has 0 available minutes remaining, `SUM(active BCS fees) = source.stripe_fee_pence` exactly. Catches under-allocation pennies.

### Hostile-case worked examples (closes 3rd-round flaws)

**Case 1: 1-pence source, five 120-minute draws.**
Source: `minutes = 600, stripe_fee_pence = 1`.
- Draws 1–4 (non-final): `round(120 × 1/600) = 0p` each. ✓
- Draw 5 (final, `minutesAfterDraw = 0`): `1 - (0+0+0+0) = 1p`. ✓
- Sum of active BCS fees: 1p. Equals source fee. Invariant 2 holds.

**Case 2: 850p fee, 600 mins, three 200-min draws.**
- Draws 1 & 2 (non-final): `round(200 × 850/600) = 283p` each.
- Draw 3 (final): `850 - (283+283) = 284p`.
- Sum: 850p. ✓ Banker's-rounding penny no longer "lost."

**Case 3: 1100p fee, 1200 mins, two 600-min draws.**
- Draw 1 (non-final, `minutesAfterDraw = 600`): `round(600 × 1100/1200) = 550p`.
- Draw 2 (final): `1100 - 550 = 550p`.
- Sum: 1100p. ✓

### FIFO worked example

A learner buys two bulk packs at different rates:

| `credit_transactions` row | Purchased | Minutes | Rate (`effective_rate_pence_per_minute`) | Stripe fee (pence) | Fee per minute |
|---|---|---|---|---|---|
| 1001 | 2026-06-01 | 600 | 137.50 (£82.50/hr) | 600 | 1.0p |
| 1002 | 2026-07-15 | 1200 | 125.00 (£75.00/hr, bulk discount) | 1100 | 0.917p |

After both purchases, learner's `learner_credit_balances(learner_id, instructor_id=1)` shows **1800 minutes available with Fraser.**

**Booking A — 120 mins, 2026-07-20:**

FIFO picks row 1001 (oldest). BCS row created:

| field | value | how computed |
|---|---|---|
| `credit_transaction_id` | 1001 | FIFO pick |
| `minutes_drawn` | 120 | full booking |
| `rate_pence_per_minute` | 137.50 | from source row |
| `contribution_pence` | 16500 | 120 × 137.50 |
| `stripe_fee_pence` | 120 | round(120 × 1.0) |
| `refunded_at` | NULL | active |

Row 1001 still has 480 minutes available (600 − 120). Row 1002 untouched.

**Booking B — 120 mins later, straddles the two source rows:**

By the time we get to booking B, row 1001 has only 60 minutes left. The booking needs 120. FIFO draws 60 from row 1001, then 60 from row 1002:

| BCS row | source | minutes | rate | contribution | fee |
|---|---|---|---|---|---|
| B-1 | 1001 | 60 | 137.50 | 8250 | 60 |
| B-2 | 1002 | 60 | 125.00 | 7500 | 55 |

**One booking, two BCS rows.** This is the most complex case — and the per-minute method handles it without any "remaining unallocated" bookkeeping.

### Refund semantics — three distinct cases

The plan distinguishes three things that learners sometimes call "refunds." They have different effects on BCS rows.

**Case 1: Lesson cancelled ≥48h before start (the common case).**
- BCS row(s) for the booking: `refunded_at = NOW()`. The fee snapshot is **frozen** on the refunded row — it stays for audit but is excluded from "active fee" sums.
- Minutes return to `learner_credit_balances` at the **original instructor** (the source row's `instructor_id`). 1 credit returned = 1 credit available.
- When the returned minutes are later rebooked, a **new** BCS row is created using the same per-minute formula — the original refunded row is not reactivated.
- Learner-facing: just sees "1 credit refunded." Fee bookkeeping is invisible.

**Case 2: Lesson cancelled <48h before start (late cancel).**
- BCS row(s) stay active (`refunded_at = NULL`). No minutes returned.
- `lesson_bookings.credit_forfeited = TRUE`. Cron flips status to `chargeable`. Instructor paid `list_price_pence` from the snapshotted credit. No re-allocation needed.

**Case 3: Cash refund of unused credits (learner asks for money back). NOW IN SCOPE via `credit_source_adjustments`.**

Closes 3rd-round blocker "cash-refund ledger semantics are contradictory."

The cash-refund flow operates entirely on `credit_source_adjustments`. `credit_transactions.minutes` and `credit_transactions.amount_pence` are **never mutated** — BCS rows snapshotted their fee using the original totals and must remain consistent with them.

**Flow when admin processes a cash refund:**

1. Admin issues the Stripe refund manually via Stripe Dashboard (or via a future `?action=cash-refund` endpoint when trigger condition met).
2. Inside a single DB transaction:
   ```sql
   -- Compute the learner's currently-available minutes on this source row.
   SELECT
     ct.minutes
     - COALESCE((SELECT SUM(minutes_drawn) FROM booking_credit_sources WHERE credit_transaction_id = ct.id AND refunded_at IS NULL), 0)
     - COALESCE((SELECT SUM(minutes_adjusted) FROM credit_source_adjustments WHERE credit_transaction_id = ct.id), 0)
     AS available_minutes
   FROM credit_transactions ct
   WHERE ct.id = $sourceId
   FOR UPDATE;
   ```
3. Validate that `minutes_adjusted` requested ≤ `available_minutes`. Reject otherwise.
4. INSERT into `credit_source_adjustments` with `kind = 'cash_refund'`, the `stripe_refund_id` (unique constraint enforces idempotency), `minutes_adjusted`, `pence_adjusted`, and `reason`.
5. UPDATE `learner_credit_balances` to subtract `minutes_adjusted` from the relevant `(learner_id, instructor_id)` row.
6. Audit-log as `admin.credit_cash_refund`.

**"How much credit does this learner have?" query becomes:**

```sql
SELECT
  lcb.balance_minutes
FROM learner_credit_balances lcb
WHERE lcb.learner_id = $learnerId AND lcb.instructor_id = $instructorId;
```

(LCB is authoritative; the adjustments table doesn't need to be re-summed at read time because step 5 of the flow above keeps LCB in sync.)

**Audit/sanity query** (used in nightly reconciliation):

```sql
SELECT ct.id, lcb.balance_minutes,
       ct.minutes
       - COALESCE(SUM(bcs.minutes_drawn) FILTER (WHERE bcs.refunded_at IS NULL), 0)
       - COALESCE((SELECT SUM(minutes_adjusted) FROM credit_source_adjustments WHERE credit_transaction_id = ct.id), 0) AS computed_available
FROM credit_transactions ct
LEFT JOIN booking_credit_sources bcs ON bcs.credit_transaction_id = ct.id
LEFT JOIN learner_credit_balances lcb ON lcb.learner_id = ct.learner_id AND lcb.instructor_id = ct.instructor_id
GROUP BY ct.id, lcb.balance_minutes, ct.minutes
HAVING lcb.balance_minutes IS DISTINCT FROM computed_available;
```

Non-empty result = LCB has drifted from source-of-truth.

Trigger condition for building a self-serve `?action=cash-refund` endpoint: ≥3 cash-refund requests in a quarter. Until then: admin SQL recipe in `docs/credits-grandfather.md`.

### Fee invariant (closes GPT-flaw #12)

Hard rule: **for any `credit_transactions` row, the sum of `stripe_fee_pence` across non-refunded BCS rows ≤ that row's `stripe_fee_pence`.**

Daily reconciliation cron `api/cron-credit-reconcile.js` (new) asserts:

```sql
SELECT ct.id, ct.stripe_fee_pence,
       COALESCE(SUM(bcs.stripe_fee_pence) FILTER (WHERE bcs.refunded_at IS NULL), 0) AS active_fee_sum
FROM credit_transactions ct
LEFT JOIN booking_credit_sources bcs ON bcs.credit_transaction_id = ct.id
GROUP BY ct.id
HAVING COALESCE(SUM(bcs.stripe_fee_pence) FILTER (WHERE bcs.refunded_at IS NULL), 0) > ct.stripe_fee_pence;
```

Any rows returned trigger an alert email. The query runs as part of the existing alert-layer cron (shipped 2026-05-17).

### Concurrency (closes GPT-flaw #14)

`SELECT ... FOR UPDATE` on selected `credit_transactions` rows inside the booking transaction. The transaction shape from Step 0 already wraps this. Two concurrent bookings against the same source row serialise correctly.

---

## Step 5.5 — Admin grant endpoints (reconciliation + goodwill)

Two new admin endpoints, both audit-logged. They create real `credit_transactions` rows with the appropriate `source` value, so FIFO and BCS attribution work uniformly across all credit types.

### `?action=credit-reconciliation` — admin reconciles a failed webhook

Use case: a learner paid via Stripe but the webhook failed silently. Admin needs to re-grant the credits at the **original** rate and fee, not today's.

Closes 3rd-round blockers "reconciliation can still double-grant if the original webhook row lacks `stripe_payment_intent_id`" and "reconciliation source-of-truth is underspecified when Stripe state has changed."

**Lookup-before-insert (all three Stripe identities checked):**

Before inserting any new row, the endpoint MUST look up an existing `credit_transactions` row by every available Stripe identity. If found, return a no-op (already reconciled or already processed by webhook):

```sql
SELECT id, source, created_at FROM credit_transactions
WHERE stripe_session_id = $1
   OR stripe_payment_intent_id = $2
   OR stripe_charge_id = $3
LIMIT 1;
```

Admin pastes the Stripe `payment_intent_id`. Server fetches the Stripe PaymentIntent with `expand: ['charges.data.balance_transaction', 'latest_charge']` to derive all three IDs. Then runs the lookup. If a row exists:
- Same `payment_intent_id` → return "already reconciled on $created_at, transaction id $id" (200, no-op).
- Same `session_id` but different `payment_intent_id` → unusual, return 409 for manual review (shouldn't happen with normal Stripe behaviour).

**Explicit reject conditions (refuse to reconcile):**

Reject with a clear operator-facing error if any of these hold against the live Stripe object:

| Reject condition | Why |
|---|---|
| `amount_received` ≠ original `amount` | Partial payment scenario; needs manual interpretation. |
| `amount_refunded > 0` | The payment has been partially or fully refunded — granting credits would revive refunded money. |
| `latest_charge.disputed = true` | Active dispute; admin must resolve dispute first. |
| `metadata` missing required keys (`learner_id`, `instructor_id`, `minutes`, `effective_rate_pence_per_minute`) | The original checkout didn't tag these — admin can't reconstruct the original grant. |
| No matching Stripe Checkout Session for the PaymentIntent | Not a credit purchase (could be a direct charge, refund, dispute fee). |
| `metadata.payment_type` ≠ `'credit_purchase'` | Different product type — don't reconcile blindly. |

When any of these fire: surface the specific reason in the admin UI with copy explaining the manual investigation needed. **Do not** create a `credit_transactions` row.

**Happy-path flow** (all rejects pass, no existing row found):

Inside a single DB transaction:
1. Create `credit_transactions` row mirroring Stripe values:
   - `source = 'reconciliation'`
   - `stripe_session_id`, `stripe_payment_intent_id`, `stripe_charge_id` all populated
   - `absorbed_by = NULL`
   - `instructor_id`, `effective_rate_pence_per_minute`, `minutes`, `amount_pence`, `stripe_fee_pence` all from Stripe API
2. Upsert `learner_credit_balances(learner_id, instructor_id)` with the minutes.
3. Audit-log as `admin.credit_reconciliation` with the payment intent ID and the operator's reasoning.

The `uq_credit_tx_payment_intent` and `uq_credit_tx_charge` unique indexes are the safety net — if two admins click the button simultaneously, one INSERT wins and the other fails with a clear conflict.

### `?action=credit-goodwill` — admin grants free credits

Use case: compensation for a bad experience, referral reward, promotional grant.

**Flow:**
1. Admin form fields:
   - Learner (search/select)
   - Instructor (search/select — defaults to Fraser)
   - Minutes
   - Reason (free text, stored in audit log)
   - **Absorbed by:** radio buttons `[Platform]` / `[Instructor]`
2. Server creates `credit_transactions` row:
   - `source = 'goodwill'`
   - `amount_pence = 0`
   - `stripe_fee_pence = 0`
   - `absorbed_by = 'platform'` or `'instructor'` per the admin's choice
   - `effective_rate_pence_per_minute` = school default (so payouts can compute `list_price_pence`-equivalent value where needed)
3. Upserts `learner_credit_balances`.
4. Audit-logs as `admin.credit_goodwill_grant` with reason + absorbed_by.

**Payout consequences:**
- `absorbed_by = 'platform'` → instructor gets paid `list_price_pence` normally; cost shows up on the operator widget as "Goodwill spend (this month)."
- `absorbed_by = 'instructor'` → the booking funded by this row is **excluded** from the instructor's payout in `getEligibleBookings`. The instructor delivers the lesson but isn't paid for it. Use sparingly — appropriate when the instructor is the source of the bad experience and has agreed to absorb the cost.

**Goodwill absorption is a property of the source, not the booking** (closes 3rd-round blocker "Goodwill absorption may not survive refund/rebook"):

- `credit_transactions.absorbed_by` is the source of truth.
- At BCS row creation time, `absorbed_by` is **copied from the source `credit_transactions` row** onto the new `booking_credit_sources.absorbed_by` column. This makes payout queries fast (no JOIN needed at cron time) AND makes refund-rebook safe: when minutes are returned to the source and later drawn into a new booking, the new BCS row inherits the same `absorbed_by` from the same source.
- The payout cron's `getEligibleBookings` filter:
  ```sql
  WHERE NOT EXISTS (
    SELECT 1 FROM booking_credit_sources bcs
    WHERE bcs.booking_id = lb.id
      AND bcs.refunded_at IS NULL
      AND bcs.absorbed_by = 'instructor'
  )
  ```
  (A booking is excluded from the instructor's payout if ANY active BCS row on it is instructor-absorbed.)

**`list_price_pence` for instructor-absorbed bookings:**

Closes 3rd-round blocker "Goodwill writer path may snapshot nonzero `list_price_pence`."

When a booking's BCS rows are all `absorbed_by = 'instructor'`, the writer in Step 1b sets `list_price_pence = 0` and tags `list_price_source = 'live_compute_insert'`. This ensures downstream queries (school payout, Stripe-fee pass-through math, gross-revenue reports) treat the lesson as zero-value to the platform AND to the instructor.

When BCS rows are mixed (one instructor-absorbed, one platform-absorbed — rare but possible when a booking straddles two source rows of different absorption): the writer sets `list_price_pence` proportionally, taking the platform-absorbed minutes' value only. The exact formula is in the writer code, and the equality-on-exhaustion invariant catches arithmetic errors.

**Franchise fee semantics for instructor-absorbed goodwill (BUSINESS DECISION, 2026-05-19 session):**

> When goodwill credits are granted with `absorbed_by = 'instructor'`, the weekly franchise fee accrues normally. Instructor-absorbed goodwill excludes lesson REVENUE from the payout but does not waive the franchise FEE. If a week's instructor-absorbed lessons leave the instructor with insufficient revenue to cover the fee, normal shortfall mechanics apply (`instructor_payouts.shortfall_pence`).

Documented here so future-readers can see this was an explicit choice, not an oversight. The alternative (proportional waiver) was rejected to avoid creating an incentive to game absorption.

### Free trials (no admin action, just policy)

The existing free-trial flow in `api/slots.js` (~L1898) gets a small change in Step 1b: instead of skipping the credit ledger entirely, it creates a `credit_transactions` row with:
- `source = 'free_trial'`
- `amount_pence = 0`
- `stripe_fee_pence = 0`
- `absorbed_by = 'platform'` (always)
- `effective_rate_pence_per_minute` = school default

This makes free trials uniform with other credit sources: same FIFO, same BCS attribution, instructor paid normally from platform.

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

## Operator widget additions

Two new tiles on the existing alert-layer widget (shipped 2026-05-17, `feat/widget-alert-layer`). Both queries run as part of the existing daily snapshot cron, no new infrastructure.

| Tile | Query | Action |
|---|---|---|
| **Unknown-price bookings** | `COUNT(*)` from `lesson_bookings` where `list_price_source = 'unknown'` AND status IN ('scheduled', 'chargeable') | Click → list view with "Review & approve" button per row. Approving sets `list_price_source = 'live_compute_backfill'` and unblocks payout. |
| **Goodwill spend (this month)** | `SUM(lb.list_price_pence)` from `lesson_bookings lb JOIN booking_credit_sources bcs ON bcs.booking_id = lb.id JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id` where `ct.source = 'goodwill' AND ct.absorbed_by = 'platform' AND lb.lesson_date >= date_trunc('month', CURRENT_DATE)` | Informational. Shows the real cost of platform-absorbed generosity each month. |

---

## How we'd know this plan failed

Concrete observations that would force a revision. The reconciliation cron (`api/cron-credit-reconcile.js`, new in Step 5) asserts these as queries and emails on breach. **These are the falsifiers — if any return non-empty results in steady state, the plan has a real defect that needs investigation, not a tweak.**

| Invariant | Query shape | What a breach means |
|---|---|---|
| **No orphan pooled minutes** | `SELECT id FROM learner_users WHERE balance_minutes > 0 AND id NOT IN (SELECT learner_id FROM learner_credit_balances WHERE instructor_id = 1)` | Step 2 backfill missed a learner, or post-Step-4 code wrote to pooled balance directly. The "structurally impossible cross-pool leakage" claim is wrong. |
| **Fee over-allocation** | `SELECT ct.id FROM credit_transactions ct LEFT JOIN booking_credit_sources bcs ON bcs.credit_transaction_id = ct.id GROUP BY ct.id HAVING COALESCE(SUM(bcs.stripe_fee_pence) FILTER (WHERE bcs.refunded_at IS NULL), 0) > ct.stripe_fee_pence` | Per-minute fee math is wrong somewhere, or a refund-rebook race created duplicate active rows. |
| **Fee under-allocation (equality-on-exhaustion)** | For every source row with 0 available minutes remaining (consumed + adjusted = total): `SUM(active BCS stripe_fee_pence) = source.stripe_fee_pence` exactly. NEW in 3rd revision. | Last-draw-takes-remainder logic failed, or a refunded BCS row was incorrectly counted as active. |
| **Contribution math** | `SELECT id FROM booking_credit_sources WHERE contribution_pence <> minutes_drawn * rate_pence_per_minute` | A BCS row's contribution doesn't match its own snapshot. Data corruption event — investigate immediately. |
| **Balance vs sources (LCB divergence)** | `SELECT lcb.learner_id, lcb.instructor_id FROM learner_credit_balances lcb WHERE lcb.balance_minutes <> (minutes - active_BCS_minutes - adjustments_minutes for this learner/instructor's sources)` | The denormalised balance has drifted from the source-of-truth. Updated in 3rd revision to include `credit_source_adjustments` in the computed-available. |
| **Pooled-vs-scoped divergence** (during transition, Phases B & C) | `learner_users.balance_minutes ≠ SUM(LCB.balance_minutes per learner)` | Legacy writer still firing OR trigger has missed an event. NEW in 3rd revision. |
| **No double-reconciliation** | `SELECT stripe_payment_intent_id, COUNT(*) FROM credit_transactions WHERE stripe_payment_intent_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1` UNION the same for `stripe_session_id` and `stripe_charge_id`. | The unique indexes have been bypassed somehow, or a Stripe identity got reused. |
| **Goodwill audit trail** | Every `credit_transactions` row with `source = 'goodwill'` has a matching `audit_logs` entry with action `admin.credit_goodwill_grant` | Ungoverned grants are appearing — possible bug or unauthorised access. |
| **Absorbed-by propagation** | `SELECT bcs.id FROM booking_credit_sources bcs JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id WHERE bcs.absorbed_by IS DISTINCT FROM ct.absorbed_by` | A BCS row's `absorbed_by` doesn't match its source. Goodwill absorption not propagating correctly through refund-rebook. NEW in 3rd revision. |
| **Cash-refund idempotency** | `SELECT stripe_refund_id, COUNT(*) FROM credit_source_adjustments WHERE stripe_refund_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1` | Same Stripe refund applied twice. NEW in 3rd revision. |

All ten queries run nightly. Any non-empty result emails the operator and is surfaced on the alert-layer widget.

---

## Things we explicitly chose NOT to do

- **Bidirectional dual-write trigger.** Forward-only only. Rollback = manual reconciliation, not silent re-pooling.
- **Auto-DD invoicing for negative payout weeks.** Stays manual per FRANCHISE-MODEL-PLAN.md, until ≥3 manual debt invoices/quarter or ≥3 active franchised instructors.
- **Refund-a-purchase (cash refund of unused credits) endpoint.** Out of scope, admin SQL until first real request.
- **Backfill fabricating prices for anonymised bookings with no payment record.** Mark `list_price_source = 'unknown'` and surface in operator widget.
- **A rollback flag in `schools.config` that toggles back to pooled reads.** Costs ~1 day to build properly; instructor #2 is a single onboarding and the forward-only trigger + snapshot restore covers the realistic failure mode. Revisit before instructor #3.

---

## Decisions made during plan revision (2026-05-19 session)

All resolved with Fraser. Recording here so future-readers can see what was decided and why.

1. **Unknown-price cron behaviour:** pay everything else, queue `'unknown'` rows for manual sign-off via operator widget. No payout blocked by default. → Step 1c table.
2. **Fee allocation method:** per-minute. Stateless, idempotent, recomputable, easy to test. Rejected proportional-to-remaining because its self-balancing property hides bugs. → Step 5 formula.
3. **Cutover date for legacy Stripe-session branch:** **TBD — query prod first.** Before merging Step 4, query Stripe API for the longest observed checkout-session-to-payment-intent gap in the last 12 months. Set window = 2× the tail. Recorded in `docs/credits-grandfather.md` at cutover time.
4. **Legacy cross-instructor UX:** polite refusal + "Buy credit for instructor #2" CTA. No in-flow admin conversion. Matches "year-one is human" principle. → Step 4.
5. **Operator widget tile placement:** add to existing alert-layer widget. → Operator widget additions section.
6. **Free trials and admin grants:** every BCS row points to a real `credit_transactions` row. `credit_transaction_id` is NOT NULL. Free trials and goodwill grants create their own zero-value source rows with `source = 'free_trial'` or `source = 'goodwill'`. → Step 2 schema.
7. **Reconciliation rate source:** auto-fetch from Stripe API by `payment_intent_id`. Idempotent via `uq_credit_tx_payment_intent`. → Step 5.5.
8. **Goodwill payout absorption:** admin picks at grant time — `absorbed_by = 'platform'` (instructor paid normally, platform absorbs cost) or `absorbed_by = 'instructor'` (instructor delivers but isn't paid). → Step 5.5.
9. **FIFO tie-breaker:** `ORDER BY created_at ASC, id ASC`. Deterministic for the rare case of identical timestamps. → Step 5.
10. **`credit_transactions.remaining_minutes`:** decide at coding time based on real read frequency once Step 5 ships. Either denormalised column with trigger, or a view. Not blocking.

---

## How this maps to existing plan docs

- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 3 schema → Step 2 here, with `booking_credit_sources` nullable+refundable from day one.
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4 keystone column → Step 1 here, split into 1a/1b/1c.
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4f Stripe-fee pass-through → already shipped (PRs #134/#135/#136, 2026-05-16).
- `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4g FIFO → Step 5 here, with explicit fee invariant and reconciliation cron.
- `FRANCHISE-MODEL-PLAN.md` Phase 2A (per-instructor credit scoping) → Step 4 here, with pricing-helper dependency hoisted to Step 3.
- `FRANCHISE-MODEL-PLAN.md` Phase 2B (bulk-tier opt-in + per-instructor rate) → split: pricing helper to Step 3, `bulk_tiers_enabled` toggle to Step 7.
- `FRANCHISE-MODEL-PLAN.md` Phase 2C (admin UI) → Step 8, deferred.
