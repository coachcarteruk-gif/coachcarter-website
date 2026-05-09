# Franchise Model — Plan (lean version)

Architecture plan for onboarding additional instructors onto CoachCarter under a franchise model. **Lean version, May 2026** — heavily reduced after a Council critique flagged most of the original plan as speculative work for problems that didn't yet exist.

> **Companion document**: [INSTRUCTOR-EXPERIENCE-PLAN.md](INSTRUCTOR-EXPERIENCE-PLAN.md) — the non-software plan for instructor #2's first 90 days. Lead allocation, human-relationship design, signing-day conversation. This document covers schema and code only.

> **Source**: Council deliberation + critical-thinking review + clarifications + lean-down + configurability reframe (May 2026). Full prior history preserved in git.

---

## Plan focus: infrastructure, not numbers

**The numbers (£195, £70, £55, 12 months, 2.5%/5%/7.5%, 12hr/24hr/36hr) are placeholders.** They will tweak before the first instructor joins and will definitely change as more instructors join.

The MVP isn't "ship the right numbers" — it's **"ship the right configurability."** Every commercially-meaningful number should live in admin-editable config (DB column, JSONB blob, or admin-managed table), not be hardcoded in code. Every change to a number should be an admin action, not a deploy.

**The goal**: Fraser can change tier prices, add new tiers, change bulk discounts, change hourly rates, change contract terms, all from the admin portal. Code only changes when the *shape* of a feature changes, not when a *value* changes.

**Discipline**: don't add a config column or admin-managed table unless something actually reads from it in the active code path. Latent-flexibility columns ("we might want this later") get deferred until the day they're actually used.

---

## The business in one sentence

> "A learner pays CoachCarter for a lesson with a chosen instructor. The money goes to CoachCarter's bank account. At the end of the week, CoachCarter pays the instructor for any lessons they delivered."

**Everything in this plan is automation of that one sentence.** If a phase doesn't make that sentence work better for instructor #2 in their first 90 days, it doesn't go in the active plan.

---

## Configurability audit

What exists today, what's missing, what the MVP must add.

### Already configurable (admin can change without code deploy)

| Setting | Where it lives | How admin changes it |
|---|---|---|
| School-wide hourly rate (default for all instructors) | `schools.config.pricing.bulk_hourly_pence` (JSONB) | Admin portal → school config |
| Bulk discount tiers (set, percentages, thresholds) | `schools.config.pricing.bulk_discount_tiers` (JSONB array of `{min_hours, discount_pct}`) | Admin portal → school config |
| Per-instructor weekly franchise fee | `instructors.weekly_franchise_fee_pence` | Admin portal → "Update instructor" form |
| Per-instructor commission rate (alternative to franchise fee) | `instructors.commission_rate` | Admin portal → "Update instructor" form |
| Lesson types and prices | `lesson_types` table | Admin portal → lesson types |
| Per-instructor-per-learner custom rate (most-specific override) | `instructor_learner_notes.custom_hourly_rate_pence` | Admin/instructor UI |
| Maximum hours per purchase | `MAX_HOURS_PER_PURCHASE = 36` (constant in `_pricing-helpers.js`) | Code change (acceptable — rarely changes) |

### Missing — MVP must add

| Setting | Why missing | What MVP adds |
|---|---|---|
| Franchise tiers as a concept | `instructors.weekly_franchise_fee_pence` is a raw number, not associated with a tier definition | New `franchise_tiers` table, `instructors.franchise_tier_id` FK |
| Tier inclusions ("car, decals, dual control") | Lives only in the franchise agreement PDF; nothing renders to admin UI or learner-facing pages | `franchise_tiers.inclusions` JSONB array |
| Per-instructor bulk-tier opt-in | Bulk tiers are school-wide; can't opt Sarah out | `instructors.bulk_tiers_enabled BOOLEAN` |
| Per-instructor hourly rate override | Senior instructors charge more, new instructors charge less. Currently no way to set this. | `instructors.hourly_rate_pence INTEGER NULL` + admin UI in instructor edit form |
| Contract start date per instructor | No record of when contracts began | `instructors.contract_start_date` |

### Pricing precedence (most-specific wins)

When a lesson is priced (or credits are bought against an instructor):

1. **Per-learner custom rate** — `instructor_learner_notes.custom_hourly_rate_pence` (if set for this learner-instructor pair)
2. **Per-instructor rate** — `instructors.hourly_rate_pence` (if set, NULL means inherit school)
3. **School default** — `schools.config.pricing.bulk_hourly_pence`

Bulk-tier discount percentages always apply to the **effective** rate from the precedence above. So a 5% bulk discount on Sarah at £60/hr = £3/hr off; on Fraser at £55/hr = £2.75/hr off. Each instructor absorbs the discount on their own rate.

### Deferred — admin uses crude workarounds until pain shows up

| Setting | Workaround until built |
|---|---|
| Contract end date / renewal tracking | Spreadsheet + signed PDF on file. Builds when ≥3 active contracts make spreadsheet painful. |
| Per-week franchise fee override (sickness, goodwill) | Admin updates `instructors.weekly_franchise_fee_pence` directly for one week, sets it back. Crude but works. |
| Fee/rate change history / audit | Not tracked. Admin notes file. Build when needed for instructor disputes. |
| Per-instructor custom bulk tiers (their own % at their own thresholds) | The MVP only supports school-wide bulk-tier *definitions* — instructors opt in or out wholesale. Custom bulk tiers per instructor: deferred. |
| Time-bound campaign promos ("spring sale 10% off") | Deferred. When the first one is wanted, build then. |

### The principle

**Add a config primitive only when the active code path reads from it.** Latent-flexibility columns get deferred. This is what kept the schema lean — earlier drafts had 7 columns and 5 tables, this version has 3 columns and 2 tables.

---

## Numbers as of May 2026 (placeholders, change freely)

These are the values the franchise tiers and pricing would launch with **if onboarding instructor #2 today**. They'll likely change before the first instructor joins and will definitely change as more join. They live in admin-editable config — no code deploy needed.

- **Hourly rate**: £55. Set in `schools.config.pricing.bulk_hourly_pence` = 5500.
- **Bulk tiers**: 12hr at 2.5% off, 24hr at 5% off, 36hr at 7.5% off. Set in `schools.config.pricing.bulk_discount_tiers`.
- **Full Franchise**: £195/week. Includes car, decals, dual control. 12-month contract. Will be a `franchise_tiers` row.
- **Part Franchise**: £70/week. Includes decals, dual control (instructor sources own kit). 12-month contract. Will be a `franchise_tiers` row.
- **Lesson durations**: 1.5h, 2h, 2.5h, 3h. Already configured in `lesson_types`.

**Sanity-check note**: Full Franchise is on the edge of CoachCarter's margin if real car costs land at the higher end. Verify lease + insurance quotes for a specific car before locking. Numbers will shift; what matters is that changing them is admin-editable, not a deploy.

---

## Locked-in decisions

| # | Decision |
|---|---|
| 1 | CoachCarter is merchant of record. Money sits on CoachCarter Stripe balance until lesson delivered. **No `on_behalf_of`** on charges. |
| 2 | Instructors are self-employed franchisees, not employees. (See `LEGAL-STATUS-RESEARCH` section below for stress-test of this assumption.) |
| 3 | Fee structure: pure franchise fee. **Tiers are admin-managed** via `franchise_tiers` table — not hardcoded as enums. Launch with two tiers seeded ("Full" and "Part") but adding/removing/editing tiers is an admin action. No commission layered on top. |
| 4 | Stripe payment-processing fees absorbed by CoachCarter, baked into franchise fee pricing. |
| 5 | **Hourly rate has a school default (in `schools.config.pricing.bulk_hourly_pence`) AND a per-instructor override (`instructors.hourly_rate_pence`).** Override is NULL by default → use school rate. Admin can set per-instructor rates from instructor edit form. Senior instructors can charge more, new instructors can charge less. Each rate is set at onboarding by mutual agreement — strengthens contractor-status framing. Three-level fallback for any specific lesson: per-learner custom rate (`instructor_learner_notes.custom_hourly_rate_pence`) → per-instructor rate (`instructors.hourly_rate_pence`) → school rate (`schools.config.pricing.bulk_hourly_pence`). |
| 6 | **Bulk-tier discounts (12h/24h/36h at 2.5%/5%/7.5% off) are per-instructor opt-in. Instructor absorbs the discount.** Their payout reflects the effective rate the credits were bought at, not the £55 default. New instructors default opted-out; Fraser is grandfathered in. This is structural list pricing, not a campaign promo. |
| 6b | **Time-bound campaign promos** (e.g. "spring sale", "first lesson £20") remain deferred to the alternatives appendix. When CoachCarter eventually runs one, the design is per-instructor opt-in too — and the instructor decides whether they absorb that discount or not at the time. |
| 7 | Lesson credits scoped to a specific instructor at purchase time. |
| 8 | Payout cron pays instructor the snapshotted `lesson_bookings.list_price_pence` revenue of completed lessons − franchise fee. List price snapshotted at booking time from the credit's effective rate × duration. |
| 9 | If lesson revenue doesn't cover franchise fee in a given week, the shortfall is **invoiced manually by Fraser** in year one. Automated invoicing is deferred. |
| 10 | Refunds: full original price returned to learner from CoachCarter balance. No clawback from instructor. |
| 11 | Marketing all runs through CoachCarter / business website. Instructors don't run independent marketing. **Tier inclusions (decals, dual control, etc.) are admin-editable** via `franchise_tiers.inclusions` — making any inclusion optional or required is an admin action. |
| 12 | No automatic debt cap. Franchise fees are contractually owed for the contract duration. `payouts_paused` remains a manual admin action. |
| 13 | Per-instructor-per-learner custom rates (existing `instructor_learner_notes.custom_hourly_rate_pence`) override the default. When credits are bought against a custom-rate relationship, `effective_rate_pence_per_minute` reflects the custom rate. |

---

## What this plan deliberately is NOT

- A multi-phase roadmap committing to seven phases of speculative work.
- A schema design for "what we'll need at five instructors."
- A replacement for the human relationship at small scale.

The deferred phases are recorded as a directional reference in the **Alternatives Appendix** at the bottom. They are *not* commitments. They will only be built if and when the trigger conditions in [INSTRUCTOR-EXPERIENCE-PLAN.md](INSTRUCTOR-EXPERIENCE-PLAN.md) are met.

---

## MVP scope

The minimum to onboard instructor #2.

### Phase –1 — Legal & contract gate (BLOCKING)

- [ ] Draft franchise agreement covering: pure franchise fee, 12-month contract duration, fees accrue regardless of work delivered, CoachCarter's recourse if instructor leaves with debt, no exclusivity, the £55/hour default and bulk-tier opt-in mechanics, instructor absorbs bulk discount, late-cancellation refund policy.
- [x] ~~Resolve tier prices~~ — **resolved**:
  - **Full Franchise**: £195/week. Includes car, decals, dual control. 12-month contract.
  - **Part Franchise**: £70/week. Includes decals, dual control (instructor's own car). 12-month contract.
- [ ] **Verify Full Franchise economics** before locking £195. Get 3 lease quotes for the actual car you'd buy (Hyundai i10, Corsa, Yaris hybrid or similar) + 1 driving-school insurance quote with dual control + £25/week buffer for servicing/MOT/tyres/breakdown. Target: real cost ≤ £150/week to leave £45 margin for CoachCarter platform overhead. If real cost lands at £160+, raise tier price to £210-220.
- [x] ~~Decide pricing band and default rate~~ — **resolved**: £55/hour default for all instructors.
- [ ] Clarify in franchise agreement: who provides the dual-control kit on Part Franchise? Reading the £70/week pricing, the instructor sources and installs their own (CoachCarter doesn't provide hardware on this tier — only fits decals to the instructor's car). Confirm this is the intent.
- [ ] When you next see a UK accountant for any reason: ask about VAT trajectory (lesson revenue + franchise revenue both count toward £90k threshold). Low priority — Fraser is nowhere near today.

### Phase 1 — Schema groundwork (no behavioural change)

```sql
-- Tier definitions (admin-editable, not hardcoded)
CREATE TABLE franchise_tiers (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  name TEXT NOT NULL,                    -- "Full Franchise", "Part Franchise"
  slug TEXT NOT NULL,                    -- "full", "part"
  weekly_fee_pence INTEGER NOT NULL,     -- standard fee for new contracts at this tier
  inclusions JSONB DEFAULT '[]'::jsonb,  -- ["Car", "Decals", "Dual Control", ...]
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, slug)
);

-- Per-instructor tier assignment + opt-ins + rate override
ALTER TABLE instructors
  ADD COLUMN franchise_tier_id INTEGER REFERENCES franchise_tiers(id);
ALTER TABLE instructors
  ADD COLUMN contract_start_date DATE;
ALTER TABLE instructors
  ADD COLUMN bulk_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instructors
  ADD COLUMN hourly_rate_pence INTEGER;  -- NULL = inherit school default

-- Per-instructor credit scoping
ALTER TABLE credit_transactions
  ADD COLUMN instructor_id INTEGER REFERENCES instructors(id);
ALTER TABLE credit_transactions
  ADD COLUMN effective_rate_pence_per_minute INTEGER;

ALTER TABLE lesson_bookings
  ADD COLUMN list_price_pence INTEGER;

CREATE TABLE learner_credit_balances (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  balance_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (learner_id, instructor_id)
);
CREATE INDEX idx_lcb_learner ON learner_credit_balances(learner_id);
CREATE INDEX idx_lcb_instructor ON learner_credit_balances(instructor_id);
CREATE INDEX idx_credit_tx_instructor ON credit_transactions(instructor_id);
CREATE INDEX idx_franchise_tiers_school ON franchise_tiers(school_id) WHERE active = TRUE;
```

**Why this shape:**
- `franchise_tiers` defines tiers (admin-managed). Adding a third tier ("Premium") is an admin action.
- `instructors.franchise_tier_id` assigns an instructor to a tier. Switching an instructor's tier is an admin action.
- `instructors.weekly_franchise_fee_pence` (already exists) is the *individual* instructor's fee, which defaults to their tier's standard fee but can be overridden per-instructor (custom deal, mid-contract change). This stays.
- `instructors.hourly_rate_pence` is the per-instructor lesson rate override. NULL means inherit school default. Senior instructors can be set higher, new instructors lower. Not a tier-level setting because rate is a per-instructor commercial decision, separate from tier.

**No `marketing_promos`, `instructor_promo_optins`, `franchise_fee_debts`, `franchise_fee_overrides`** — deferred (Alternatives Appendix).

**Seeds (data-only, change freely later):**
```sql
INSERT INTO franchise_tiers (school_id, name, slug, weekly_fee_pence, inclusions, sort_order)
VALUES
  (1, 'Full Franchise', 'full', 19500,
   '["Car", "Decals", "Dual Control", "12-month contract"]'::jsonb, 1),
  (1, 'Part Franchise', 'part', 7000,
   '["Decals", "Dual Control (your own car)", "12-month contract"]'::jsonb, 2);
```

These are seeds. Edit any time via admin UI without a deploy.

**Backfill:**
- `learner_users.balance_minutes` → `learner_credit_balances` rows allocated to most-recent instructor (Fraser for everyone in practice today).
- `instructors.contract_start_date` set for Fraser (date of CoachCarter's launch as a record).
- `instructors.franchise_tier_id` left NULL for Fraser — he's the school owner, not a franchisee. New instructors get assigned a tier at onboarding.
- `instructors.bulk_tiers_enabled = TRUE` for Fraser only (he already offers them — grandfather rule).
- `instructors.hourly_rate_pence` left NULL for everyone — Fraser inherits school default; new instructors get their rate set at onboarding.
- `credit_transactions.effective_rate_pence_per_minute = ROUND(amount_pence / NULLIF(minutes, 0))` for existing rows. Legacy rows where minutes = 0 stay NULL (already redeemed in practice).
- `lesson_bookings.list_price_pence` backfilled from existing pricing logic (custom-rate-aware: COALESCE of `instructor_learner_notes.custom_hourly_rate_pence` × duration / 60, or `lesson_types.price_pence`, or 8250 default).

**Acceptance criteria:**
- All migrations apply cleanly via `GET /api/migrate?secret=...`.
- Full Playwright suite passes.
- `franchise_tiers` table seeded with two rows; admin portal shows them and allows editing inclusions/fees.
- For 20 sampled learners: SUM of `learner_credit_balances` rows = old `learner_users.balance_minutes`.
- For 20 sampled `credit_transactions` with non-zero minutes: `effective_rate_pence_per_minute × minutes ≈ amount_pence` (within rounding tolerance).
- Every `lesson_bookings` row has `list_price_pence` set.
- Fraser's `bulk_tiers_enabled = TRUE`.
- No user-visible change.

### Phase 2 — Behavioural change: per-instructor credits, bulk-tier opt-in, tier admin UI

This phase has three threads that ship together:

**Thread A — Per-instructor credit scoping.**
- [ ] `api/credits.js`: checkout requires `instructor_id`; metadata includes `instructor_id` and computed `effective_rate_pence_per_minute`.
- [ ] `api/webhook.js` `handleCreditPurchase`: inserts `credit_transactions` row with `instructor_id` and `effective_rate_pence_per_minute`. Upserts `learner_credit_balances` for `(learner_id, instructor_id)`.
- [ ] `api/webhook.js` `handleSlotBooking`: same per-instructor scoping. Calculates `effective_rate_pence_per_minute` from slot price and snapshots `lesson_bookings.list_price_pence`.
- [ ] `api/slots.js`: booking deduction from `learner_credit_balances` for chosen instructor; refuses if insufficient. Sets `lesson_bookings.list_price_pence`. Cancellation returns to same row.
- [ ] `api/_payout-helpers.js`: switch payout sum from live `lesson_types.price_pence` lookup to snapshotted `lesson_bookings.list_price_pence`.
- [ ] `api/credits.js` balance endpoint: returns per-instructor balances.
- [ ] `public/learner/book.js` + `buy-credits.html`: purchase anchored to chosen instructor.
- [ ] `public/learner/profile.html`: shows per-instructor balances.
- [ ] **Grandfather rule**: legacy `learner_users.balance_minutes` is read-only. Consumed first when booking with originally-allocated instructor (Fraser).
- [ ] Touch and verify: free-trial flow, referral-rewards flow, admin manual-credit-adjustment flow.

**Thread B — Bulk-tier opt-in + per-instructor hourly rate.**
- [ ] `api/_pricing-helpers.js`: introduce `getEffectiveHourlyPence(sql, schoolId, instructorId)` that implements three-level fallback (per-learner-pair → per-instructor → school). Falls back to existing `getBulkPricing()` for the school-level lookup.
- [ ] `api/_pricing-helpers.js`: refactor `calcBulkTotal()` to take `instructor_id`. Uses effective hourly rate via the new helper. If `instructors.bulk_tiers_enabled = TRUE`, applies school-wide bulk discount percentages from `schools.config.pricing.bulk_discount_tiers` to the effective rate. If FALSE, no discount.
- [ ] `api/instructor.js`: endpoint `?action=set-bulk-tiers` to toggle own `bulk_tiers_enabled` flag.
- [ ] `public/instructor/profile.html`: "Bulk packages" toggle with clear messaging. Read-only display of own hourly rate ("£55/hour — set by admin"). Instructors don't self-edit their rate; admin does.
- [ ] `public/learner/buy-credits.html`: bulk-tier UI shown only if chosen instructor has them enabled. Pricing reflects chosen instructor's effective rate.

**Thread C — Tier admin UI + per-instructor hourly rate UI (the configurability piece).**
- [ ] `api/admin.js`: CRUD endpoints for `franchise_tiers` (list, create, update, soft-delete via `active = FALSE`).
- [ ] `api/admin.js`: extend `update-instructor` endpoint to accept `franchise_tier_id` and `hourly_rate_pence` (nullable). When `franchise_tier_id` set, copies tier's `weekly_fee_pence` into instructor's `weekly_franchise_fee_pence` (default behaviour; admin can override per-instructor afterwards). `hourly_rate_pence` accepts NULL or an integer in pence.
- [ ] `public/admin/portal.html` + `portal.js`: new "Franchise tiers" admin section. List of tiers, edit form for name/fee/inclusions, ability to add new tier or soft-delete an existing one. Inclusions edited as a tag-style list ("add inclusion", "remove inclusion").
- [ ] `public/admin/portal.html`: in instructor edit form, replace the raw "weekly franchise fee" input with a tier picker (dropdown of active tiers, plus a "custom fee override" optional field).
- [ ] `public/admin/portal.html`: in instructor edit form, add an "Hourly rate (optional override)" field. Empty/blank = use school default. Placeholder shows current school default (e.g. "£55.00 — school default"). Has a "Reset to school default" button that clears the field.
- [ ] `public/instructor/profile.html`: read-only display of "Your tier: Full Franchise (£195/week — Car, Decals, Dual Control)" sourcing from the joined tier row. Plus "Your hourly rate: £55/hour" (read-only — admin sets this).

**Acceptance criteria — Thread A (per-instructor credits):**
- New credit purchase shows up in `credit_transactions` with non-null `instructor_id` and `effective_rate_pence_per_minute`.
- `learner_credit_balances` incremented for `(learner_id, instructor_id)`.
- Booking with chosen instructor decrements right row and snapshots `list_price_pence`.
- Attempt to book Instructor B with Instructor A's credits → clear error.
- 48-hour cancellation returns minutes to same `(learner_id, instructor_id)` row.
- Existing learner with legacy balance can still book original instructor; legacy decrements until zero.
- Guest-checkout slot booking lands in right per-instructor balance with rate snapshot.
- Payout cron uses `lesson_bookings.list_price_pence`. Verify with one bulk-purchased lesson and one ad-hoc lesson.
- Playwright: buy → book → cancel → re-book scoped to one instructor passes.
- Playwright: refused cross-instructor booking passes.

**Acceptance criteria — Thread B (bulk-tier opt-in + per-instructor rate):**
- Learner browsing an instructor with `bulk_tiers_enabled = FALSE` sees only standard hourly rate (no bulk pricing).
- Learner browsing an instructor with `bulk_tiers_enabled = TRUE` sees full bulk-tier ladder.
- Toggling the flag updates the learner-facing pricing immediately.
- A 24-hour bulk purchase scoped to Fraser at default config stores `effective_rate_pence_per_minute = ROUND((5500 × 24 × 0.95) / 1440) = 87`. Lesson booked from those credits stores `list_price_pence = 87 × 90 = 7830`.
- **Per-instructor rate test**: Admin sets Sarah's `hourly_rate_pence = 6000` (£60). Sarah's `bulk_tiers_enabled = FALSE`. Learner buys 1.5 hours of credits scoped to Sarah → checkout total = £90 (not £82.50). `effective_rate_pence_per_minute` stored as 100. Lesson delivered → instructor pay reflects £90 list price minus franchise fee.
- **Bulk discount applies to instructor's effective rate**: Sarah's `hourly_rate_pence = 6000`, `bulk_tiers_enabled = TRUE`. 24-hour purchase stores `effective_rate_pence_per_minute = ROUND((6000 × 24 × 0.95) / 1440) = 95`. Sarah absorbs the 5% on her own £60 rate, not on the school £55 rate.
- **Three-level fallback test**: a learner with a custom rate of £52 (in `instructor_learner_notes`) booking with Sarah whose `hourly_rate_pence = 6000` → custom rate wins. `list_price_pence` reflects £52, not £60 or £55.

**Acceptance criteria — Thread C (tier admin UI + per-instructor rate UI):**
- Admin can create a new franchise tier via portal. Saves to `franchise_tiers`. Renders correctly in tier list.
- Admin can edit an existing tier's name, weekly fee, inclusions. Changes do NOT retroactively change existing instructor's `weekly_franchise_fee_pence` — only future tier assignments.
- Admin can soft-delete a tier (`active = FALSE`). Soft-deleted tiers don't appear in instructor edit form's tier picker, but existing instructors on that tier are unaffected.
- Admin can assign an instructor to a tier from the instructor edit form. The tier's `weekly_fee_pence` populates the instructor's fee field (which admin can then override).
- Adding a hypothetical "Premium Franchise" tier (£250/week, "Car, Decals, Dual Control, iPad, Branded merchandise") is a 30-second admin task. No code change.
- **Per-instructor hourly rate**: admin can set/clear an instructor's `hourly_rate_pence` from the instructor edit form. Empty field saves as NULL. Setting £60 saves as 6000. "Reset to school default" button clears the field. Saving an instructor with NULL rate makes them inherit school default; learners booking with them see school-default pricing.
- **Senior + new instructor scenario**: admin sets one instructor at £60 (senior), one at £52 (new), one at NULL (school default £55). Each instructor's profile and booking flow shows their respective rate. Each instructor's payouts reflect their own rate.
- Instructor profile shows their assigned tier with inclusions list, plus their hourly rate (read-only).

### Effort estimate

| Phase | Time est. | What's included |
|---|---|---|
| Phase –1 (legal) | A few weekends + paid solicitor review when closer to onboarding | Franchise agreement draft, tier inclusions documented, dual-control sourcing clarified, per-instructor pricing acknowledged in agreement |
| Phase 1 (schema + seeds) | 4–6 hours | `franchise_tiers` table, instructor columns (incl. `hourly_rate_pence`), credit/booking columns, backfill, tier seeds |
| Phase 2A (per-instructor credit scoping) | 8–14 hours | `credits.js`, `webhook.js`, `slots.js`, `_payout-helpers.js`, learner UI |
| Phase 2B (bulk-tier opt-in + per-instructor rate logic) | 3–5 hours | `_pricing-helpers.js` three-level fallback refactor, `getEffectiveHourlyPence()`, instructor toggle endpoint + UI, learner UI conditional rendering |
| Phase 2C (tier admin UI + per-instructor rate UI) | 6–10 hours | Admin CRUD endpoints, tier admin portal section, instructor edit form tier picker + hourly rate field |

**Total: 21–35 hours of code + legal lead time.**

Threads can ship in either order within Phase 2. Thread C is the most cleanly independent — could ship before Threads A/B if you want to be able to define tiers and assign Fraser to one before doing the credit-scoping work.

---

## What's manually handled until pain shows up

These are the operations that will happen but don't have automation in the lean MVP:

| Need | Manual workaround |
|---|---|
| Instructor has negative-payout week | Fraser personally invoices via Stripe Payment Link or bank-transfer details. Logs it in a notes file. |
| Promos | Don't run them for instructor #2 in their first 90 days. Fraser's existing bulk tiers keep working via current `_pricing-helpers.js` school-config flow. |
| Per-week franchise fee adjustment (sickness, holiday, goodwill) | Admin updates `instructors.weekly_franchise_fee_pence` directly for one week, sets it back. Crude but works. |
| Vehicle/fleet management (tier full) | Spreadsheet. |
| Contract tracking | Date in spreadsheet + signed PDF on file. |
| Debt tracking | Spreadsheet. |

**Trigger to revisit**: at end of instructor #2's first 90 days, review which of these manual processes were friction points and which were fine. Build automation only for the ones that hurt.

---

## Legal status research — directional only

> **Not legal advice.** Self-contained reasoning for direction-setting. Treat as input to a future solicitor conversation, not as a substitute.

### The concern

Self-employed contractor relationships in the UK can be reclassified by tribunals based on substance, not contract wording. If CoachCarter provides everything (brand, leads, system, marketing, car, MOT) and instructor provides only their time, that resembles employment. Cases like Pimlico Plumbers and Uber show courts will pierce contractor labels.

### Tests applied to CoachCarter franchise model

| Test | Score | Reasoning |
|---|---|---|
| Mutuality of obligation | Strong-self-employed | No guaranteed work either way. |
| Personal service / substitution | Weak-self-employed | ADI licence is personal. Unavoidable in industry. |
| Control | Mixed | Hours/availability instructor's; pricing/booking/branding CoachCarter's. |
| Integration into business | Mixed | Liveried and presented as CoachCarter; can leave to compete. |
| Financial risk and reward | **Strong-self-employed** | Pays £200/week regardless of work. Real risk. |
| Equipment provision | Mixed for tier "full"; strong-self-employed for tier "lite" | Tier "lite" instructor brings own car. |
| Right to refuse work | Strong-self-employed | Can refuse bookings, take holidays. |

### Strongest defensive points

1. **Real financial risk via the franchise fee.** Pimlico didn't pay weekly fees. Uber drivers didn't pay £200/week to access the platform. Paying CoachCarter regardless of work delivered demonstrates independent business risk — the most distinctive feature of the franchise model.
2. **No mutuality** — CoachCarter doesn't guarantee learners.
3. **Right to refuse** — instructors can say no to bookings.
4. **Tier "lite" is materially safer than tier "full"** for status purposes.

### Weakest points

1. **Personal service** — no substitution. (Industry-wide, less weight in licensed professions.)
2. **CoachCarter sets list prices uniformly** — all instructors charge £55. Mitigated partly by: (a) per-instructor `hourly_rate_pence` column gives latent flexibility, (b) bulk-tier opt-in is a real per-instructor commercial decision (Sarah and Fraser can have different commercial offers), (c) `instructor_learner_notes.custom_hourly_rate_pence` already lets instructors charge specific learners different rates.
3. **Tier "full" car provision** — instructor doesn't bear equipment risk.
4. **Branding/livery** — they're presented as CoachCarter to customers. Tier "lite" decals now optional to soften this.
5. **All-marketing-through-CoachCarter** — no independent customer relationships.

### Industry context

The UK driving school industry has run this model for 40+ years (BSM, AA, Red, others). No major tribunal precedent has reclassified driving instructor franchisees as workers. Reasons: most franchised instructors do show genuine self-employment characteristics, ADI licensing positions them as independent professionals, and contested cases (Uber etc.) have been with companies where the worker received *no* payment in slow weeks — the gig economy model. A franchise fee inverts that.

But this isn't proof of safety — it's proof that no instructor has yet brought a sufficiently strong case through to tribunal ruling. Risk is dormant, not eliminated.

### Decisions taken to reduce status risk

1. **Per-instructor `hourly_rate_pence` column** with latent flexibility. All charge £55 today; the column makes future per-instructor pricing trivial. ✅ Now in MVP schema.
2. **Per-instructor bulk-tier opt-in**. Each instructor makes their own commercial decision about whether to offer bulk discounts. Independent-business behaviour. ✅ Now in MVP.
3. **Tier "lite" decals optional**. ✅ Now in Decision 11.
4. **No exclusivity clause** in franchise agreement. ✅ Phase –1 contract item.
5. **Tier "lite" priced substantially lower** to reflect equipment risk. ✅ Phase –1 pricing item.

### When to revisit

Switch to PAYE employment if any of these are true:

- 5+ active franchised instructors (the cost of a single tribunal claim against multiple instructors becomes existential).
- Any UK driving school has a tribunal precedent that reclassifies franchisees as workers.
- An instructor on the platform threatens or initiates a status claim.
- A solicitor reviewing the franchise agreement (Phase –1) advises that PAYE is materially safer.

PAYE costs an extra ~£9k/year per instructor (employer NI, pension, holiday accrual, sick pay reserve) versus the franchise model. Survivable at small scale; meaningful at scale.

---

## Alternatives Appendix — explored options, deferred

These are the deferred phases from the previous plan. Recorded as directional reference for if/when trigger conditions are met. **Not commitments.**

### Time-bound campaign promos

Bulk-tier opt-in is in MVP (it's structural list pricing). Campaign promos — limited-time offers like "spring sale 10% off" or "first lesson £20" — are deferred until needed.

- New tables: `marketing_promos` (with `starts_at`/`ends_at`), `instructor_promo_optins`.
- New column on `credit_transactions`: `promo_id` (nullable). The existing `effective_rate_pence_per_minute` column from MVP is enough to track the discounted price; `promo_id` adds the campaign attribution.
- Reuse the per-instructor pricing helper from MVP — campaign promos slot in alongside bulk tiers as another opt-in discount source.

**Trigger to build**: you want to run a time-bound CoachCarter marketing campaign that any non-Fraser instructor opts into.

### Franchise-fee debt tracking + automated invoicing

- New table: `franchise_fee_debts`.
- New cron logic to write debts when payout < fee.
- New `instructors.stripe_customer_id`.
- Bacs DD mandate setup at instructor onboarding.
- Auto-invoicing via `stripe.invoices.create` with `charge_automatically`.

**Trigger**: ≥3 manual debt invoices in a quarter, OR ≥3 active franchised instructors.

### Per-week franchise-fee override

- New table: `franchise_fee_overrides` (`instructor_id`, `period_start`, `override_fee_pence`, `reason`, `created_by_admin_id`).
- Payout cron checks for overrides before applying standard fee.
- Admin UI for setting per-week overrides.

**Trigger**: ≥1 active franchised instructor AND admin is manually adjusting `weekly_franchise_fee_pence` more than once a quarter.

### Holiday allowance system (rejected approach)

- Replaced by per-week override (above) which subsumes its function.

### Vehicle/fleet management

- New `vehicles` table; tracking servicing, MOT, mileage, instructor assignment.

**Trigger**: ≥2 tier-"full" instructors with CoachCarter-provided cars.

### Contract dates beyond `contract_start_date`

- `contract_end_date`, `contract_term_months`, contract document storage.

**Trigger**: ≥3 active contracts, where remembering renewal dates becomes a real burden.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Instructor #2 onboards with no learners and accumulates debt | See [INSTRUCTOR-EXPERIENCE-PLAN.md](INSTRUCTOR-EXPERIENCE-PLAN.md) — lead-allocation mechanism is required before instructor #2 starts paying. |
| Manual debt-invoicing scales badly | Trigger condition flagged. Build automation (deferred phase) when threshold hit. |
| Status reclassification by tribunal | Decisions 5, 11 revised to soften status-risk profile. Plan a real solicitor review of franchise agreement before signing. |
| Backfill mis-allocates credits | Phase 1 backfill in transaction with dry-run report; verify 20 sampled learners; rollback script ready. |
| Instructor in negative-payout week feels billed at by software | Year-one shortfall invoicing is manual. Fraser handles personally. |
| Per-instructor pricing creates UX confusion at launch | Not a launch risk — all instructors charge £55/hour. The column exists for latent flexibility but nothing surfaces differently to learners today. |
| Instructor opts into bulk tiers, then later wants to opt out — what happens to in-flight credits? | In-flight credits keep their snapshotted `effective_rate_pence_per_minute`. Already purchased = locked deal. Opt-out only affects future purchases. Documented in the franchise agreement and in the toggle UI. |
| Instructor doesn't realise opting into bulk tiers means absorbing the discount | Toggle UI must be explicit: "If enabled, you absorb a 2.5%/5%/7.5% discount on bulk packages in exchange for the conversion uplift bulk packages typically deliver." Mentioned in pre-signing conversation. |
| Sarah opted out of bulk tiers; Fraser opted in. Two learners ask Sarah for "the same deal Fraser offers" | Frame in onboarding conversation: each instructor decides their own commercial offer. Learner can switch to Fraser if they want bulk pricing. This is exactly the kind of independent-business decision that strengthens contractor status. |
| Sunk-cost bias keeps deferred phases as "manual forever" | Trigger conditions written. Revisit at end of instructor #2's first 90 days. |

---

## What's next

1. **Read [INSTRUCTOR-EXPERIENCE-PLAN.md](INSTRUCTOR-EXPERIENCE-PLAN.md)** — the non-software plan that makes this software plan succeed.
2. Resolve Phase –1 items (tier prices, pricing band, draft agreement).
3. Schedule a real solicitor review of the franchise agreement before signing instructor #2.
4. Then ship Phase 1 + Phase 2.
