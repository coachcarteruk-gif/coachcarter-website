# Franchise Commitment Register

Comprehensive register of every concrete commitment in the franchise plan + agreement that has implications for the website / database / admin operation. Built May 2026 from `FRANCHISE-MODEL-PLAN.md` + `FRANCHISE-AGREEMENT-DRAFT.md` + `INSTRUCTOR-EXPERIENCE-PLAN.md` + `CLAUDE.md` (Multi-instructor franchise model section).

**Purpose**: input to a future audit that compares the actual state of the website/DB/admin against these commitments.

**Status legend** (filled in during audit, not now):
- ✅ Implemented
- 🟡 Partially implemented (gap described)
- ❌ Missing
- ⚠️ Contradicts plan/agreement
- 🟦 Deferred (trigger condition not met — out of scope for gaps)
- 🔵 Process (not platform — admin / Fraser handles manually)
- 📄 Content (page/policy/document, not code)

**Source legend**:
- `PLAN` = `FRANCHISE-MODEL-PLAN.md`
- `AGT` = `FRANCHISE-AGREEMENT-DRAFT.md`
- `EXP` = `INSTRUCTOR-EXPERIENCE-PLAN.md`
- `CC` = `CLAUDE.md` Multi-instructor franchise model section

---

## How to use this register during audit

1. Walk top to bottom. For each commitment, mark Status.
2. For 🟡 / ❌ / ⚠️, add a one-line gap description and the file/clause where the drift exists.
3. Output a separate `FRANCHISE-AUDIT-<date>.md` summarising the results — don't mutate this register.
4. Items marked 🟦 deferred should still be checked: if anyone added the deferred table / column / behaviour anyway, that's a contradiction worth flagging.
5. At the end, group findings into: pre-signing-day blockers, Phase 1 work, Phase 2 work, deferred-but-built-anyway drift.

---

## Section 1 — Schema commitments

Active schema items the MVP must add, plus deferred ones to check for accidental drift.

### S1.1 — `franchise_tiers` table exists
- **Source**: PLAN Phase 1, CC hard rule
- **Schema**: `id, school_id, name, slug, weekly_fee_pence, inclusions JSONB, active, sort_order, created_at, updated_at`. Unique (school_id, slug). Index on (school_id) where active.
- **Active reader**: admin instructor edit form; instructor profile page
- **Phase**: 1
- **Status**: TBD

### S1.2 — `franchise_tiers` seeded with two tiers
- **Source**: PLAN Phase 1
- **What**: rows for "Full Franchise" (£195/week, inclusions car/decals/dual-control) and "Part Franchise" (£70/week, inclusions decals/dual-control). N.b. inclusions text must reflect post-interview correction: dual-control fitted by CCL on **both** tiers.
- **Phase**: 1
- **Status**: TBD

### S1.3 — `instructors.franchise_tier_id INTEGER NULL REFERENCES franchise_tiers(id)`
- **Source**: PLAN Phase 1
- **Phase**: 1
- **Status**: TBD

### S1.4 — `instructors.contract_start_date DATE`
- **Source**: PLAN Phase 1, AGT 5.1
- **Phase**: 1
- **Status**: TBD

### S1.5 — `instructors.bulk_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- **Source**: PLAN Phase 1, AGT 4.8
- **Backfill**: Fraser's row = TRUE (grandfather). All others = FALSE (default).
- **Phase**: 1
- **Status**: TBD

### S1.6 — `instructors.hourly_rate_pence INTEGER NULL`
- **Source**: PLAN Phase 1, AGT 4.7
- **Semantics**: NULL = inherit school default. Integer = per-instructor override.
- **Phase**: 1
- **Status**: TBD

### S1.7 — `instructors.weekly_franchise_fee_pence` exists (already)
- **Source**: PLAN Configurability audit
- **Note**: pre-existing column. Confirm still present and editable from admin form.
- **Status**: TBD

### S1.8 — `instructors.commission_rate` exists (already, alternative to franchise fee)
- **Source**: PLAN Configurability audit
- **Note**: pre-existing column. Used for commission-based payout instead of franchise. Confirm still present.
- **Status**: TBD

### S1.9 — `credit_transactions.instructor_id INTEGER REFERENCES instructors(id)`
- **Source**: PLAN Phase 1, CC hard rule "per-instructor credit scoping"
- **Phase**: 1
- **Status**: TBD

### S1.10 — `credit_transactions.effective_rate_pence_per_minute INTEGER`
- **Source**: PLAN Phase 1, AGT 4.10 (forfeited lessons need this snapshot)
- **Backfill**: `ROUND(amount_pence / NULLIF(minutes, 0))` for existing rows; NULL where minutes = 0.
- **Phase**: 1
- **Status**: TBD

### S1.11 — `lesson_bookings.list_price_pence INTEGER`
- **Source**: PLAN Phase 1 + Decision 8, CC hard rule
- **Backfill**: from existing pricing logic, custom-rate-aware.
- **Phase**: 1
- **Status**: TBD

### S1.12 — `learner_credit_balances` table exists
- **Source**: PLAN Phase 1
- **Schema**: `id, learner_id, instructor_id, school_id, balance_minutes, updated_at`. Unique (learner_id, instructor_id). Indexes on learner_id, instructor_id.
- **Phase**: 1
- **Status**: TBD

### S1.13 — `learner_credit_balances` backfilled from `learner_users.balance_minutes`
- **Source**: PLAN Phase 1 backfill
- **What**: each learner's pooled balance allocated to most-recent-instructor (Fraser in practice today).
- **Phase**: 1
- **Status**: TBD

### S1.14 — `learner_users.balance_minutes` column kept as read-only legacy (grandfather)
- **Source**: PLAN Phase 2 Thread A grandfather rule, CC hard rule
- **What**: legacy column NOT removed. Read-only. Consumed first when booking with originally-allocated instructor.
- **Status**: TBD

### S1.15 — Indexes on new FK columns
- **Source**: CC security rule "Index all new FK columns"
- **What**: `idx_lcb_learner`, `idx_lcb_instructor`, `idx_credit_tx_instructor`, `idx_franchise_tiers_school` (partial WHERE active=TRUE). Plus FK indexes on `instructors.franchise_tier_id`, `credit_transactions.instructor_id`.
- **Status**: TBD

### S1.16 — `school_id` filter on every new tenant-scoped query
- **Source**: CC multi-tenancy rule, PLAN
- **What**: any new SQL touching the new tables must filter by `school_id`.
- **Status**: TBD (audit at code-review time, not schema-time)

### S1.17 — DEFERRED: `instructor_lead_floor_periods` table
- **Source**: PLAN Decision 14
- **Schema (when built)**: `instructor_id, period_start, period_end, leads_required, leads_delivered, reduction_per_week_pence`
- **Trigger**: when manual quarterly Lead Floor tracking becomes painful (probably 2nd quarter for instructor #2).
- **Status**: 🟦 (until built)

### S1.18 — DEFERRED: `instructors.lead_floor_per_week NUMERIC`, `instructors.lead_floor_max_reduction_pence INTEGER`
- **Source**: PLAN Decision 14
- **Trigger**: same as S1.17
- **Status**: 🟦

### S1.19 — DEFERRED: `lesson_bookings.is_payout_eligible BOOLEAN DEFAULT TRUE`
- **Source**: PLAN deferred-phases ("Per-lesson payout-eligibility flag (insurance gating)"), AGT 7.3.2
- **Trigger**: first instructor-#2 insurance lapse where Fraser needs to actually exclude lessons from a payout. Until then, manual SQL fix is fine.
- **Note**: PLAN says column may as well be added in Phase 1 if there's a migration coming up regardless.
- **Status**: 🟦 (until built)

### S1.20 — DEFERRED: `franchise_fee_debts` table
- **Source**: PLAN Alternatives Appendix
- **Trigger**: ≥3 manual debt invoices in a quarter, OR ≥3 active franchised instructors.
- **Status**: 🟦. Audit: confirm this table does NOT exist (would be drift if it did).

### S1.21 — DEFERRED: `franchise_fee_overrides` table
- **Source**: PLAN Alternatives Appendix
- **Trigger**: ≥1 active franchised instructor AND admin manually adjusting `weekly_franchise_fee_pence` more than once a quarter.
- **Status**: 🟦. Audit: confirm absent.

### S1.22 — DEFERRED: `marketing_promos`, `instructor_promo_optins` tables
- **Source**: PLAN Alternatives Appendix
- **Trigger**: time-bound campaign promo wanted with instructor opt-in.
- **Status**: 🟦. Audit: confirm absent.

### S1.23 — DEFERRED: `vehicles` table
- **Source**: PLAN Alternatives Appendix
- **Trigger**: ≥2 tier-"full" instructors with CCL-provided cars.
- **Status**: 🟦. Audit: confirm absent.

### S1.24 — DEFERRED: contract end / term-months columns
- **Source**: PLAN Alternatives Appendix
- **Trigger**: ≥3 active contracts where renewal-date tracking becomes a burden.
- **Status**: 🟦. Audit: confirm absent (only `contract_start_date` should exist).

---

## Section 2 — Pricing-behaviour commitments

How prices are computed at every relevant point.

### P2.1 — Three-level pricing fallback (most-specific wins)
- **Source**: CC hard rule, PLAN Decision 5, AGT 4.7 + 4.9
- **Order**: per-learner-pair `instructor_learner_notes.custom_hourly_rate_pence` → per-instructor `instructors.hourly_rate_pence` → school default `schools.config.pricing.bulk_hourly_pence`.
- **Active reader**: `api/_pricing-helpers.js::getEffectiveHourlyPence(sql, schoolId, instructorId, learnerId?)` (Phase 2B refactor target)
- **Phase**: 2B
- **Status**: TBD

### P2.2 — `getEffectiveHourlyPence()` helper exists
- **Source**: PLAN Phase 2 Thread B
- **What**: shared helper implementing the three-level fallback. Used by checkout, booking, payout.
- **Phase**: 2B
- **Status**: TBD

### P2.3 — Bulk discount applies to *effective* rate, not school default
- **Source**: CC hard rule, PLAN Decision 6
- **What**: when an instructor opts in, the discount % comes off *their* effective rate (school default OR per-instructor override OR per-learner). Sarah on £60 opted-in, 5% bulk → effective £57.
- **Phase**: 2B
- **Status**: TBD

### P2.4 — Bulk-tier UI shown only if chosen instructor has them enabled
- **Source**: PLAN Phase 2 Thread B acceptance criteria
- **What**: `public/learner/buy-credits.html` shows bulk-tier ladder only if `bulk_tiers_enabled = TRUE` for the chosen instructor.
- **Phase**: 2B
- **Status**: TBD

### P2.5 — Bulk-tier opt-out doesn't affect in-flight credits
- **Source**: PLAN Decision 6, AGT 4.8
- **What**: already-purchased credits keep their snapshotted `effective_rate_pence_per_minute`. Opt-out only affects future purchases.
- **Phase**: 2B
- **Status**: TBD

### P2.6 — Bulk-tier percentages live in `schools.config.pricing.bulk_discount_tiers`
- **Source**: PLAN Configurability audit
- **What**: `[{min_hours, discount_pct}]` JSONB array. NOT hardcoded.
- **Status**: TBD (probably already true)

### P2.7 — School default rate lives in `schools.config.pricing.bulk_hourly_pence`
- **Source**: PLAN Configurability audit
- **What**: 5500 (£55) at May 2026. JSONB, admin-editable.
- **Status**: TBD (probably already true)

### P2.8 — `MAX_HOURS_PER_PURCHASE` constant
- **Source**: PLAN Configurability audit
- **What**: =36 in `_pricing-helpers.js`. Acceptable as code constant (rarely changes).
- **Status**: TBD (acceptable)

### P2.9 — `effective_rate_pence_per_minute` snapshotted at credit purchase time
- **Source**: PLAN Phase 2 Thread A, Decision 7
- **What**: when Stripe webhook handles credit purchase, write the row with `effective_rate_pence_per_minute` set to `(effective_hourly_pence × hours_purchased − any_bulk_discount) / minutes`.
- **Phase**: 2A
- **Status**: TBD

### P2.10 — `lesson_bookings.list_price_pence` snapshotted at booking time
- **Source**: CC hard rule, PLAN Decision 8
- **What**: at the moment a slot is booked, write `list_price_pence = effective_rate_pence_per_minute × duration_minutes`. Used at payout.
- **Phase**: 2A
- **Status**: TBD

### P2.11 — Late-cancellation lesson pays out at original credit's effective rate
- **Source**: AGT 4.10
- **What**: a lesson cancelled within 48 hours pays out using the same `effective_rate_pence_per_minute` as the credit that was redeemed for it. So a bulk-discounted credit pays out at the discounted rate, NOT the school default.
- **Status**: TBD. Likely a new behaviour not yet implemented.

### P2.12 — Late-cancellation Stripe fees deducted in same proportion as delivered lesson
- **Source**: AGT 4.10
- **What**: the proportion of the original Stripe fee that would have been allocated to that lesson is deducted from the forfeited-lesson payout.
- **Phase**: depends on Stripe-fee-pass-through implementation (see B3.5).
- **Status**: TBD

### P2.13 — Per-learner custom rate (`instructor_learner_notes.custom_hourly_rate_pence`) takes precedence
- **Source**: PLAN Decision 13, AGT 4.9
- **What**: if a learner-instructor pair has a custom rate, that's the rate used for credit purchase + booking + late-cancellation. Stored in `effective_rate_pence_per_minute`.
- **Status**: TBD (column likely exists; check it's wired into `getEffectiveHourlyPence`).

---

## Section 3 — Payout-behaviour commitments

How weekly payouts are calculated and paid.

### B3.1 — Payout cron runs every Friday between 14:00 and 16:00
- **Source**: AGT 4.3
- **Status**: TBD. Existing payout cron timing should be checked.

### B3.2 — Payout window covers lessons completed in 7 days preceding 12:00 Friday cut-off
- **Source**: AGT 4.3
- **What**: rolling 7-day window, not calendar week.
- **Status**: TBD.

### B3.3 — Payout sum uses `lesson_bookings.list_price_pence` snapshot
- **Source**: CC hard rule, PLAN Decision 8, Phase 2A
- **What**: `api/_payout-helpers.js::processPayoutForInstructor` switches from live `lesson_types.price_pence` lookup to snapshotted `list_price_pence`.
- **Phase**: 2A
- **Status**: TBD

### B3.4 — Stripe fees passed through to instructor at cost (not absorbed by CCL)
- **Source**: PLAN Decision 4 (revised May 2026), AGT 4.6
- **What**: payout = lesson revenue − Weekly Fee − Stripe processing fees. CCL retains zero margin on Stripe fees.
- **Status**: TBD. **Not yet implemented**. New behaviour from interview.

### B3.5 — Stripe fees itemised on weekly payout statement
- **Source**: AGT 4.6
- **What**: instructor's payout email/UI must show Stripe fees as a separate line.
- **Status**: TBD. New behaviour, almost certainly not built.

### B3.6 — Negative-payout shortfall rolls forward into next week
- **Source**: AGT 4.2
- **What**: if payout < 0, the negative balance carries to next week's calculation. Continues rolling until cleared.
- **Status**: TBD.

### B3.7 — Year-one shortfall handling is informal (no auto-DD, no auto-invoice)
- **Source**: PLAN Decision 9, AGT 4.2, EXP "Moment 2"
- **What**: Fraser personally handles via bank transfer or Stripe Payment Link. NOT contractualised, NOT automated.
- **Status**: 🔵 Process. Audit: confirm no Bacs DD / auto-invoice infrastructure has been built.

### B3.8 — Post-termination shortfall settlement: 30 days, deposit then payout, <£100 written off
- **Source**: AGT 4.2 settlement clause
- **Order**: deposit credited first; final positive payout credited second; remaining residual is ordinary debt; if <£100 residual, written off as de minimis.
- **Status**: 🔵 Process for now. May need code support if instructor #2 actually leaves.

### B3.9 — Lesson only payout-eligible if tuition vehicle insurance valid for delivery date
- **Source**: AGT 7.3.2
- **What**: any lesson delivered while tuition insurance lapsed pays out £0. Manual exclusion until S1.19 ships.
- **Status**: 🔵 Manual SQL until automated.

### B3.10 — Weekly Fee accrues during insurance-lapse-related suspension
- **Source**: AGT 7.3.2 + 7.3.3
- **What**: even when no payouts going out, weekly fee still adds to instructor's running total / shortfall.
- **Status**: 🔵 — depends on how shortfall is tracked. Likely an ad-hoc admin action today.

### B3.11 — Payouts forfeited during precautionary suspension (5.3)
- **Source**: AGT 5.3 precautionary-suspension paragraph
- **What**: any lesson delivered after suspension date → no payout (and instructor shouldn't be teaching anyway). Weekly Fee still accrues.
- **Status**: 🔵 Manual.

### B3.12 — Lead Floor reduction applied to following quarter's Weekly Fee
- **Source**: AGT 4.4, PLAN Decision 14
- **Formula**: `reduction_per_week = ceil_to_50p(max_reduction × leads_short / leads_owed)`. Default max_reduction = £15. Default leads_owed = 7 per 13-week period.
- **Implementation**: manually compute & adjust `weekly_franchise_fee_pence` until S1.17/S1.18 ship.
- **Status**: 🔵 Manual until automated.

### B3.13 — Lead Floor pauses during precautionary suspension
- **Source**: AGT 5.3 precautionary-suspension paragraph
- **What**: leads CCL fails to route during suspension don't count toward the shortfall calculation.
- **Status**: 🔵 Manual.

### B3.14 — £250 vehicle deposit deducted from week-1 payout calc regardless of sign
- **Source**: AGT 5.5
- **What**: week 1 = `(lesson_revenue - weekly_fee - stripe_fees - 250)`. Always. Adds to shortfall if needed.
- **Status**: TBD. Likely not built (no Full-Franchise instructor onboarded yet).

### B3.15 — £250 deposit returned within 14 days of vehicle return
- **Source**: AGT 5.5
- **What**: minus damage deductions, itemised in writing.
- **Status**: 🔵 Process.

---

## Section 4 — Lifecycle / state-machine commitments

Things that change the operational state of an instructor.

### L4.1 — Start Date for PDI = first Monday at least 6 clear days after pink licence arrival
- **Source**: AGT 5.1
- **Status**: 🔵 Process. Stored in `instructors.contract_start_date` (S1.4).

### L4.2 — Start Date for fully-qualified ADI = mutually agreed
- **Source**: AGT 5.1
- **Status**: 🔵 Process.

### L4.3 — Start Date cannot occur before insurance certificates approved
- **Source**: AGT 7.3.1
- **What**: admin must verify and approve all three insurance certs before setting Start Date.
- **Status**: 🔵 Process. Could be enforced in admin UI but probably overkill at scale of 1.

### L4.4 — 12-month Initial Term, auto-renews 12 months unless 30 days written notice
- **Source**: AGT 5.2
- **Status**: 🔵 Process. Tracking is `contract_start_date` + spreadsheet until S1.24.

### L4.5 — Fee-change-late-proposal protection (instructor's notice deadline auto-extends)
- **Source**: AGT 4.5
- **What**: if CCL proposes fee change <60 days before end-of-Term, instructor's deadline becomes 30 days after proposal. Term holds at original fee until that revised deadline.
- **Status**: 🔵 Process. Manual/email/spreadsheet.

### L4.6 — Material breach grounds → immediate termination on written notice
- **Source**: AGT 5.3
- **List**: lost ADI/PDI registration, insurance lapse >14 days, DBS fail, drink/drug teaching, learner relationship, criminal conduct, unpaid shortfall >30 days from demand, insolvency.
- **Status**: 🔵 Process. No automation expected.

### L4.7 — Other breach grounds → written warning + 14-day cure; second instance terminates
- **Source**: AGT 5.3
- **List**: DBS expiry without renewal, DVSA Code non-compliance (non-Material), punctuality/presentation, social-media reputational, any-other.
- **Status**: 🔵 Process. Could be helped by an `instructor_warnings` table later but not needed now.

### L4.8 — Precautionary suspension on credible safeguarding/brand-harm allegation
- **Source**: AGT 5.3
- **What**: CCL can suspend (not terminate) on arrest/charge/credible allegation. Instructor must not teach. Payouts forfeited. Weekly Fee accrues. Lead Floor pauses. Resolves to either lift-suspension or convert-to-termination.
- **Status**: 🔵 Process today; needs admin-side state for "is_suspended" if it ever happens.

### L4.9 — Instructor 3-month notice; fees accrue, lessons continue, Lead Floor continues
- **Source**: AGT 5.4
- **Status**: 🔵 Process.

### L4.10 — Vehicle returned within 7 days of termination (Full only)
- **Source**: AGT 5.5
- **Status**: 🔵 Process.

### L4.11 — Tier elected on signing applies for entire Term
- **Source**: AGT 3.4
- **What**: no mid-Term tier switching. Renewal-time switching allowed.
- **Status**: 🔵 Process. Admin shouldn't allow tier change mid-Term — but no enforcement needed at scale of 1.

### L4.12 — Insurance renewal cert must arrive within 7 days of policy renewal
- **Source**: AGT 7.3.1
- **Status**: 🔵 Process. Could be an admin reminder later.

### L4.13 — PL/PI insurance lapse: 7-day cure period from written notice
- **Source**: AGT 7.3.3
- **Status**: 🔵 Process.

### L4.14 — Tuition vehicle insurance lapse: no cure period, payout-eligibility gating only
- **Source**: AGT 7.3.2
- **Status**: 🔵 Process + B3.9.

---

## Section 5 — Admin actions / admin-UI commitments

What the admin portal must allow Fraser to do without a code deploy.

### A5.1 — Admin can CRUD `franchise_tiers`
- **Source**: PLAN Phase 2 Thread C
- **What**: list, create, update, soft-delete (active=FALSE). Edit name/fee/inclusions. Inclusions edited as tag-style list.
- **Phase**: 2C
- **Files**: `api/admin.js`, `public/admin/portal.html` + `portal.js`
- **Status**: TBD

### A5.2 — Admin can assign instructor to tier from instructor edit form
- **Source**: PLAN Phase 2 Thread C
- **What**: tier dropdown. Selecting a tier copies its `weekly_fee_pence` into instructor's `weekly_franchise_fee_pence` (overridable).
- **Phase**: 2C
- **Status**: TBD

### A5.3 — Admin can set/clear instructor's `hourly_rate_pence`
- **Source**: PLAN Phase 2 Thread C, AGT 4.7
- **What**: empty = NULL = inherit school default. Placeholder shows current school default. "Reset to school default" button clears.
- **Phase**: 2C
- **Status**: TBD

### A5.4 — Admin can override instructor's `weekly_franchise_fee_pence` independently of tier default
- **Source**: PLAN Phase 1 (existing column)
- **What**: tier default is starting point; admin can override.
- **Status**: TBD (probably already works for existing column)

### A5.5 — All admin mutations audit-logged via `api/_audit.js`
- **Source**: CC GDPR rule
- **What**: any admin action that creates/modifies/deletes user data must call `logAudit()`.
- **Status**: TBD (audit at code-review time)

### A5.6 — Admin can verify/approve insurance certificates
- **Source**: AGT 7.3.1
- **What**: ideally a small admin UI: per-instructor list of required insurance, per-cert "approved by [admin] on [date], expires [date]". Until built: email + spreadsheet.
- **Phase**: nice-to-have. Manual until then.
- **Status**: TBD / 🔵.

### A5.7 — Admin can record vehicle assignment + dual-control + decals
- **Source**: AGT Schedule Part C
- **What**: Schedule fields capture this on paper. May want a simple `vehicles` mini-table eventually but not yet (S1.23 deferred).
- **Status**: 🔵 Process.

### A5.8 — Admin can issue manual credit adjustment (existing flow still works post-Phase 2A)
- **Source**: PLAN Phase 2 Thread A "touch and verify"
- **What**: Phase 2A migration must not break existing manual credit adjustment flow.
- **Status**: TBD

### A5.9 — Admin can record Lead Floor delivery counts per quarter (manual)
- **Source**: AGT 4.4 + PLAN Decision 14
- **What**: spreadsheet for now. S1.17 + S1.18 + an admin UI when it's painful.
- **Status**: 🔵 Process.

### A5.10 — Admin manual SQL for insurance-gap payout exclusion
- **Source**: AGT 7.3.2 + PLAN deferred
- **What**: until S1.19, Fraser hand-flags affected lessons or excludes them in payout calc.
- **Status**: 🔵 Process.

---

## Section 6 — Instructor-facing UI commitments

What the instructor sees on `public/instructor/*` pages.

### I6.1 — Instructor profile shows assigned tier with inclusions list (read-only)
- **Source**: PLAN Phase 2 Thread C
- **Where**: `public/instructor/profile.html`
- **What**: "Your tier: Full Franchise (£195/week — Car, Decals, Dual Control)" sourced from joined tier row.
- **Phase**: 2C
- **Status**: TBD

### I6.2 — Instructor profile shows hourly rate (read-only — admin sets)
- **Source**: PLAN Phase 2 Thread C, AGT 4.7
- **Where**: `public/instructor/profile.html`
- **Phase**: 2C
- **Status**: TBD

### I6.3 — Instructor profile has "Bulk packages" toggle
- **Source**: PLAN Phase 2 Thread B
- **Where**: `public/instructor/profile.html`
- **What**: explicit messaging: "If enabled, you absorb a 2.5%/5%/7.5% discount on bulk packages in exchange for the conversion uplift bulk packages typically deliver."
- **Phase**: 2B
- **Status**: TBD

### I6.4 — `?action=set-bulk-tiers` endpoint
- **Source**: PLAN Phase 2 Thread B
- **Where**: `api/instructor.js`
- **What**: toggles own `bulk_tiers_enabled` flag.
- **Phase**: 2B
- **Status**: TBD

### I6.5 — Instructor weekly payout statement itemises Stripe fees
- **Source**: AGT 4.6
- **Where**: TBD — instructor dashboard / payout email / both.
- **Status**: TBD. Likely not yet built.

### I6.6 — Instructor sees per-learner balances they're owed lessons against
- **Source**: PLAN Phase 2 Thread A acceptance criteria
- **Where**: instructor calendar / dashboard.
- **Phase**: 2A
- **Status**: TBD

### I6.7 — Instructor cannot self-edit their own hourly rate
- **Source**: AGT 4.7 — admin sets, instructor sees read-only.
- **Status**: TBD (likely already true since the column doesn't exist yet)

---

## Section 7 — Learner-facing UI commitments

What the learner sees on `public/learner/*` and `book.html`.

### L7.1 — Learner can buy credits anchored to a chosen instructor
- **Source**: PLAN Phase 2 Thread A
- **Where**: `public/learner/buy-credits.html` + `book.js`
- **What**: checkout flow requires `instructor_id` parameter; bulk-tier UI conditional on instructor's `bulk_tiers_enabled`.
- **Phase**: 2A + 2B
- **Status**: TBD

### L7.2 — Learner profile shows per-instructor balances
- **Source**: PLAN Phase 2 Thread A acceptance criteria
- **Where**: `public/learner/profile.html`
- **Phase**: 2A
- **Status**: TBD

### L7.3 — Booking with chosen instructor decrements right balance row
- **Source**: PLAN Phase 2 Thread A
- **Where**: `api/slots.js` booking path
- **What**: deducts from `learner_credit_balances(learner_id, instructor_id)`. Refuses if insufficient.
- **Phase**: 2A
- **Status**: TBD

### L7.4 — Cross-instructor booking refused with clear error
- **Source**: PLAN Phase 2 Thread A acceptance criteria
- **What**: Sarah's credits cannot pay for a lesson with Fraser. Clear error message.
- **Phase**: 2A
- **Status**: TBD

### L7.5 — Learner browsing an instructor without bulk tiers sees only standard hourly rate
- **Source**: PLAN Phase 2 Thread B acceptance criteria
- **Where**: `public/learner/buy-credits.html`
- **Phase**: 2B
- **Status**: TBD

### L7.6 — Pricing reflects chosen instructor's effective rate
- **Source**: PLAN Phase 2 Thread B acceptance criteria
- **Where**: `book.js`, `buy-credits.html`
- **Phase**: 2B
- **Status**: TBD

### L7.7 — 48-hour cancellation returns minutes to same `(learner_id, instructor_id)` row
- **Source**: PLAN Phase 2 Thread A acceptance criteria
- **Where**: `api/slots.js` cancellation path
- **Phase**: 2A
- **Status**: TBD

### L7.8 — Existing learner with legacy balance can still book original instructor
- **Source**: PLAN Phase 2 Thread A grandfather rule
- **What**: legacy `learner_users.balance_minutes` consumed first when booking with originally-allocated instructor. Stops at zero.
- **Phase**: 2A
- **Status**: TBD

### L7.9 — Free-trial completion counts toward Lead Floor
- **Source**: AGT 2 Qualifying Lead definition
- **What**: a learner who completes a free trial with the routed instructor counts as a Qualifying Lead for that quarter's Lead Floor calc.
- **Status**: 🔵 Process — needs a manual count from `lesson_bookings` joined to free-trial completions until S1.17 ships.

### L7.10 — Guest-checkout slot booking lands in right per-instructor balance with rate snapshot
- **Source**: PLAN Phase 2 Thread A acceptance criteria
- **Where**: `api/webhook.js handleSlotBooking`
- **Phase**: 2A
- **Status**: TBD

### L7.11 — Learner can see which instructor a credit is scoped to before booking
- **Source**: PLAN Phase 2 Thread A
- **Where**: `public/learner/profile.html`, `book.js`
- **Phase**: 2A
- **Status**: TBD

---

## Section 8 — Touch-and-verify commitments (Phase 2A migration)

Existing flows that must NOT break when per-instructor credit scoping ships.

### T8.1 — Free-trial flow still works
- **Source**: PLAN Phase 2 Thread A
- **Status**: TBD

### T8.2 — Referral-rewards flow still works
- **Source**: PLAN Phase 2 Thread A
- **Status**: TBD

### T8.3 — Admin manual-credit-adjustment flow still works
- **Source**: PLAN Phase 2 Thread A (also A5.8 above)
- **Status**: TBD

### T8.4 — Cancellation refund flow still works
- **Source**: PLAN Phase 2 Thread A
- **Status**: TBD

### T8.5 — Stripe webhook `handleCreditPurchase` writes per-instructor row
- **Source**: PLAN Phase 2 Thread A
- **Status**: TBD

### T8.6 — Stripe webhook `handleSlotBooking` writes per-instructor row + snapshots `list_price_pence`
- **Source**: PLAN Phase 2 Thread A
- **Status**: TBD

### T8.7 — Existing 20-sample backfill verification passes
- **Source**: PLAN Phase 1 acceptance criteria
- **What**: sum of `learner_credit_balances` rows for 20 sampled learners = old `learner_users.balance_minutes`.
- **Phase**: 1 acceptance test
- **Status**: TBD (run as part of audit)

### T8.8 — Existing `effective_rate × minutes ≈ amount_pence` for 20-sample backfilled `credit_transactions`
- **Source**: PLAN Phase 1 acceptance criteria
- **Phase**: 1 acceptance test
- **Status**: TBD

### T8.9 — Every existing `lesson_bookings` row has `list_price_pence` populated
- **Source**: PLAN Phase 1 acceptance criteria
- **Status**: TBD

### T8.10 — Fraser's `bulk_tiers_enabled = TRUE` (grandfather)
- **Source**: PLAN Phase 1 + Decision 6
- **Status**: TBD

### T8.11 — Full Playwright suite passes against migrated state
- **Source**: PLAN Phase 1 + Phase 2 acceptance criteria
- **Status**: TBD

---

## Section 9 — Process / human-side commitments

Things Fraser does manually, not platform behaviour. Audit confirms there's no software trying to automate them prematurely.

### H9.1 — Fraser handles negative-payout shortfall conversations personally
- **Source**: PLAN Decision 9, AGT 4.2, EXP "Moment 2"
- **Status**: 🔵 Process. Audit confirms no Bacs DD / auto-invoice infrastructure exists.

### H9.2 — Fraser blocks one half-day per week as "instructor support time"
- **Source**: EXP "Fraser's role"
- **Status**: 🔵 Process — calendar / personal discipline.

### H9.3 — Servicing/MOT days double as relationship-maintenance check-ins
- **Source**: EXP "Use servicing/MOT days as scheduled relationship-maintenance time"
- **Status**: 🔵 Process.

### H9.4 — Lead-allocation: Fraser's-overflow routing built before instructor #2 starts paying
- **Source**: EXP "Cold-start problem", section A
- **What**: when instructor's slot feed has 0 slots in next 7 days, surface other active instructor slots. NOT auto-redirect.
- **Where**: `book.html` modification
- **Status**: ❌ likely not built. **Pre-signing-day blocker**.

### H9.5 — New-instructor highlight on `/free-trial.html`
- **Source**: EXP section B
- **Status**: ❌ likely not built. Post-signing nice-to-have.

### H9.6 — Postcode-default routing
- **Source**: EXP section C
- **Status**: ❌ not built. Post-signing nice-to-have. Needs `instructors.coverage_postcodes`.

### H9.7 — Manual referral-by-Fraser
- **Source**: EXP section D
- **Status**: 🔵 Process — already possible via verbal/email referral.

### H9.8 — Weekly check-in metrics tracked in spreadsheet (lessons / revenue / fee / net / qualitative log)
- **Source**: EXP "What to track during the 90 days"
- **Status**: 🔵 Process.

### H9.9 — Decision-point triggers at week 4 / 8 / 12 pre-rehearsed
- **Source**: EXP "Decision points during the 90 days"
- **Status**: 🔵 Process.

### H9.10 — Fraser does NOT onboard instructor #3 until instructor #2's 90-day post-mortem complete
- **Source**: EXP
- **Status**: 🔵 Process discipline.

---

## Section 10 — Content / external artefact commitments

Things that aren't code but are referenced by the agreement.

### C10.1 — Final Franchise Agreement (post solicitor review)
- **Source**: AGT, PLAN Phase –1
- **Status**: 📄 In progress. Heads-of-terms drafted. Solicitor review pending.

### C10.2 — Solicitor review of agreement
- **Source**: PLAN Phase –1, AGT solicitor checklist
- **Status**: 📄 Pending.

### C10.3 — Tier-price economics verification (Full Franchise £195 sense-check vs real costs)
- **Source**: PLAN Phase –1 unticked items
- **What**: real lease/insurance/servicing costs landed at ≤£150/week leaves £45 margin. If real cost ≥£160, raise to £210-220.
- **Status**: 📄 Pending. **Pre-signing-day blocker**.

### C10.4 — Decal-removal early-exit fee figure
- **Source**: AGT 3.3
- **What**: clause has `[FIGURE]` placeholder. Set based on actual fitter quotes.
- **Status**: ✅ Resolved 2026-05-10. Set to £200. Clause 3.3 updated; solicitor checklist item 2 marked resolved.

### C10.5 — Learner Vehicle Standards policy
- **Source**: AGT 6.5.2 footnote
- **What**: separate policy document published on coachcarter.uk that learners can reference for what to expect. Gives them complaint avenue.
- **Status**: 📄 Not yet drafted. Post-agreement task.

### C10.6 — Schedule template (per-instructor terms sheet)
- **Source**: AGT Schedule
- **What**: the parts A/B/C/D template needs to be a printable PDF + signing process.
- **Status**: 📄 Embedded in draft. Final formatting + DocuSign-equivalent: post solicitor.

### C10.7 — Sample week-by-week earnings projection (12 weeks, best/expected/worst, Full vs Part, bulk-tier yes/no)
- **Source**: EXP "Moment 1"
- **What**: for the pre-signing conversation. Not in the agreement; a separate document.
- **Status**: 📄 Not yet drafted.

### C10.8 — Pre-signing conversation script / checklist
- **Source**: EXP "Moment 1"
- **What**: walk through tier choice, break-even, fees-accrue, what CCL does, hourly rate, bulk-tier opt-in, late cancellations.
- **Status**: 📄 Implicit in EXP doc; could be formalised.

### C10.9 — Privacy policy updated for franchise model (multi-instructor data flow)
- **Source**: CC GDPR rule
- **What**: if any new third-party processes personal data (Stripe Connect, etc.) for multi-instructor flow, update `public/privacy.html`.
- **Status**: TBD.

---

## Section 11 — Cross-cutting documentation commitments

Things that update other docs when this work ships.

### D11.1 — `PROJECT.md` updated with new APIs / tables / flows
- **Source**: CC working practices
- **Status**: TBD per phase.

### D11.2 — `DEVELOPMENT-ROADMAP.md` entry for shipped franchise work
- **Source**: CC working practices
- **Status**: TBD per phase.

### D11.3 — `MIGRATION-PLAN.md` updated with new tables / API routes / shared modules
- **Source**: CC working practices, React Native migration principles
- **Status**: TBD per phase.

### D11.4 — `CLAUDE.md` updated if new conventions / env vars / design decisions introduced
- **Source**: CC working practices
- **Status**: Mostly already done — May 2026 franchise-model section is current.

### D11.5 — `docs/stripe-connect.md` updated if payout mechanics change
- **Source**: CC area docs
- **Status**: TBD when B3.3 / B3.4 / B3.5 ship.

---

## Section 12 — Hard rules from CLAUDE.md (cross-references)

These are policed across all the above; calling them out here so the audit can confirm none are violated by any new code.

### CC1 — All commercially-meaningful numbers in admin-editable config
- **Sources**: CC franchise hard rule 1
- **Audit**: grep for hardcoded `5500`, `19500`, `7000`, `15000` (pence values for £55, £195, £70, £15) in `api/`, `public/`. Should not appear except (a) as defaults at column-creation in migrations, (b) as test fixtures, (c) as the seed values in `franchise_tiers`.
- **Status**: TBD.

### CC2 — Per-instructor credit scoping required for new credit work
- **Sources**: CC franchise hard rule 2
- **Audit**: grep for new code touching `learner_users.balance_minutes`. Should NOT exist post-Phase 2.
- **Status**: TBD.

### CC3 — Three-level pricing fallback honoured wherever a rate is computed
- **Sources**: CC franchise hard rule 3
- **Audit**: grep for `bulk_hourly_pence` direct reads — should all go through `getEffectiveHourlyPence()` or equivalent.
- **Status**: TBD.

### CC4 — Bulk-tier discounts per-instructor opt-in; instructor absorbs discount
- **Sources**: CC franchise hard rule 4
- **Audit**: confirm code path doesn't apply discount to instructor with `bulk_tiers_enabled = FALSE`.
- **Status**: TBD.

### CC5 — Don't re-add deferred phases without trigger condition
- **Sources**: CC franchise hard rule 5
- **Audit**: confirm S1.20 / S1.21 / S1.22 / S1.23 / S1.24 do NOT exist in schema or code.
- **Status**: TBD.

### CC6 — Year-one franchise relationships are human, not automated
- **Sources**: CC franchise hard rule 6, EXP
- **Audit**: confirm no Bacs DD setup, no `stripe.invoices.create` for franchise fees, no auto-debt-tracking infrastructure.
- **Status**: TBD.

### CC7 — Configurability discipline: no flexibility-only columns
- **Sources**: CC franchise hard rule 7
- **Audit**: every column in `franchise_tiers` and the new instructor columns should be read by active code by end of Phase 2.
- **Status**: TBD.

---

## Audit-day checklist

When running the audit:

1. ☐ Read `db/migration.sql` — match Section 1 schema commitments.
2. ☐ Run `\d franchise_tiers`, `\d instructors`, `\d credit_transactions`, `\d lesson_bookings`, `\d learner_credit_balances` — confirm columns/indexes exist.
3. ☐ Check `franchise_tiers` rows — confirm S1.2 seed data + post-interview corrections.
4. ☐ Read `api/_pricing-helpers.js` — match Section 2 behaviour.
5. ☐ Read `api/credits.js`, `api/webhook.js`, `api/slots.js` — match Section 2 + Section 3 + Section 7.
6. ☐ Read `api/_payout-helpers.js` — match Section 3.
7. ☐ Read `api/admin.js` — match Section 5.
8. ☐ Read `api/instructor.js` — match Section 6.
9. ☐ Read `public/instructor/profile.html` — match Section 6.
10. ☐ Read `public/learner/buy-credits.html`, `book.js`, `book.html`, `profile.html` — match Section 7.
11. ☐ Read `public/admin/portal.html` + `portal.js` — match Section 5.
12. ☐ Grep for hardcoded numbers (CC1) and deferred-phase tables (CC5).
13. ☐ Sample 20 learners — verify backfill (T8.7, T8.8, T8.9).
14. ☐ Run Playwright suite — match T8.11.
15. ☐ Confirm process commitments (Section 9) by absence of related infrastructure (Bacs DD, auto-invoice, etc.).
16. ☐ List content artefacts (Section 10) by their existence/non-existence in repo + website.

## Output of audit

Write to `FRANCHISE-AUDIT-<YYYY-MM-DD>.md` with:

- Pre-signing-day blockers (must ship before instructor #2 onboards).
- Phase 1 work (schema groundwork already in plan).
- Phase 2A / 2B / 2C work (behavioural change in plan).
- Drift findings (deferred-phase tables / columns that exist when they shouldn't).
- Content artefacts pending (legal / policy / earnings projection / Vehicle Standards).
- Quick wins (commitments that are 90% there and could be closed in <1 hour).
- Cross-cutting risks (anything that touches multiple sections).

---

## Section 13 — Content-licensing arrangement (added 2026-05-09)

Instructor #2 has verbally agreed to a content-facilitation arrangement: £35/wk fee netted against franchise fee (instructor receives £35/wk for facilitating dashcam-footage social-media content). Learners with active social-media consent receive 5% off lessons (CCL absorbs, not instructor). Two consents are legally distinct: dashcam recording = legitimate interests (no consent needed but disclosure + LIA required); social-media publication = explicit opt-in, specific, informed, withdrawable. Adults-only at launch. Sourced from May 2026 conversation with Fraser; binding once Schedule E lands in agreement.

### M13.1 — Content-licensing schedule in franchise agreement (Schedule E)
- **Source**: 2026-05-09 verbal agreement
- **What**: New schedule covering scope of footage use, instructor's £35/wk facilitation fee netted against franchise fee, separately terminable on 1 month's notice on either side, IP ownership (CCL owns; instructor licenses appearance; learner licenses via consent flow), takedown obligations, what happens to existing published clips on termination.
- **Phase**: Pre-signing (plan item 1.8)
- **Status**: ✅ Drafted 2026-05-09. Schedule E (E.1–E.9) added to `FRANCHISE-AGREEMENT-DRAFT.md`; cross-referenced from clause 4.11; solicitor-checklist item 7 raised. Awaiting solicitor review (C10.2).

### M13.2 — Legitimate Interests Assessment (LIA) for dashcam recording
- **Source**: ICO guidance, 2026-05-09 decision
- **What**: ~1-page internal document recording legitimate-interests basis for compulsory dashcam: purpose (safety/quality/coaching/insurance), necessity, balancing test against learner privacy. Stored at `docs/compliance/dashcam-LIA.md`. Reviewed annually.
- **Phase**: Pre-signing (plan item 1.9), required before dashcam goes live
- **Status**: ✅ Written 2026-05-09. Stored at `docs/compliance/dashcam-LIA.md`. Three sections (purpose / necessity / balancing). Interior + forward-facing scope. 30d/12mo retention. Right-to-object resolves to cancel-tuition. Next review: 2027-05-09.

### M13.3 — DoB column on `learner_users` + inline collection in consent UI
- **Source**: 2026-05-09 — required to age-gate consent UI; confirmed no learner currently has age info captured anywhere
- **What**: `learner_users.date_of_birth DATE` (nullable, added in Phase 1 migration). New signups ask DoB on signup form. Existing learners: DoB asked *only* at the moment they engage with consent UI in 2.6 — inline "before you can opt in, please confirm your date of birth" prompt. NOT a booking gate. NOT a standalone profile prompt. The DoB field exists primarily to gate the consent UI; nothing else reads it. This puts the friction at the point where it's actually justified — only learners who *want* the consent feature pay the DoB cost.
- **Phase**: 2 (column ships in 2.5; UX ships in 2.6)
- **Status**: TBD

### M13.4 — Privacy policy dashcam disclosure
- **Source**: ICO guidance, 2026-05-09 decision
- **What**: `public/privacy.html` updated to disclose dashcam processing under legitimate interests, retention period (30 days default), learner rights (SAR, deletion, objection), separate social-media-consent process.
- **Phase**: 2 (plan item 2.5)
- **Status**: TBD

### M13.5 — Physical dashcam-disclosure stickers in vehicles
- **Source**: ICO guidance — visible disclosure
- **What**: "This vehicle is fitted with a recording device — footage may be used for safety, quality and training purposes. See coachcarter.uk/privacy for details." Fitted at vehicle prep; one month before instructor #2's Start Date.
- **Phase**: 2 (plan item 2.5)
- **Status**: 🔵 Process. Not code.

### M13.6 — `learner_content_consents` table
- **Source**: 2026-05-09 — social-media consent infrastructure
- **What**: New table with `consent_type` discriminator (future-proofed for other consent types beyond `'social_media_publication'`). Records granted_at, withdrawn_at, scope JSONB (platforms, editing rights, retention horizon).
- **Phase**: 2 (plan item 2.6)
- **Status**: TBD

### M13.7 — Learner-facing social-media consent UI (with inline DoB capture)
- **Source**: 2026-05-09 decision
- **What**: Profile toggle "Help us tell your story — get 5% off" with full informed-consent UI: platforms listed individually as checkboxes, editing scope explained, "withdraw any time, takedown within 14 days reasonable efforts" reassurance. **Adults-only at launch.** DoB-known + ≥18 sees full consent UI. DoB-known + <18 doesn't see the toggle at all. **DoB-unknown clicks toggle → inline "confirm your date of birth" prompt → on submit, server checks age. ≥18 reveals consent UI; <18 shows "feature is for 18+ only" and DoB is saved for future.** Withdrawal endpoint creates admin takedown task.
- **Phase**: 2 (plan item 2.6)
- **Status**: TBD

### M13.8 — Consent-discount pricing (`lesson_bookings.amount_paid_pence`)
- **Source**: 2026-05-09 — 5% lesson discount when consent active, CCL absorbs
- **What**: New column added to Phase 1 migration. Pricing flow checks active consent; if active applies 5% off effective rate (computed via three-level fallback). Snapshots `list_price_pence` (for instructor payout, un-discounted) and `amount_paid_pence` (Stripe charge). Difference = CCL absorption.
- **Phase**: 2 (plan item 2.7), bundles into 2.1 migration
- **Status**: TBD

### ~~M13.9 — Footage triage admin UI (Flow A)~~ — REMOVED 2026-05-09
- **Status**: not built. Home-PC storage decision (M13.18 revised) means triage happens on Fraser's home PC by reviewing files. The platform's role is consent state only — Fraser's offline workflow consumes that state. Tier 4 trigger if reinstated: clip volume ≥10/wk consistently or Fraser hands off content ops.

### M13.10 (revised) — Published-clips spreadsheet
- **Source**: GDPR withdrawal obligation; 2026-05-09 home-PC storage decision
- **What**: Spreadsheet at `docs/operations/published-clips.xlsx` (private, not committed). Columns: clip_filename, date_published, tiktok/instagram/youtube/other URLs, source_lesson_id, source_lesson_date, appearing_learner_names + IDs, takedown_status (live | partially_taken_down | fully_taken_down | n/a). Updated by Fraser at publication and on takedown. Cross-referenced manually when a withdrawal email lands.
- **Phase**: 2 (plan item 2.9 revised)
- **Status**: TBD — 5-minute setup task before first publication.

### M13.11 — 14-day takedown SLA on consent withdrawal
- **Source**: 2026-05-09 — defensible "reasonable efforts" under GDPR
- **What**: When learner withdraws social-media consent, all published clips featuring them must be taken down from CCL-controlled platforms within 14 days. Reshares by third parties: reasonable-efforts only, disclosed in consent UI.
- **Status**: 🔵 Process backed by 2.9 admin tooling.

### M13.12 (revised) — Dashcam retention discipline (manual, home-PC)
- **Source**: ICO retention discipline; 2026-05-09 home-PC storage decision
- **What**: 30-day ceiling enforced by Fraser's manual deletion habit. Fraser's stated preference is aggressive clearance — most footage deleted within days of clip selection. LIA documents the policy + ceiling. No cron job.
- **Phase**: 🔵 Process. Tier 4 trigger if reinstated as code: footage volume grows past Fraser's manual habit.
- **Status**: 🔵 Process.

### M13.13 (revised) — Dashcam SAR fulfilment (manual)
- **Source**: GDPR Subject Access Request rights; 2026-05-09 home-PC storage decision
- **What**: Manual process. Learner requests footage; Fraser uses existing `handleExportData()` to retrieve learner's lesson dates as an index, searches home PC for matching clip files, sends. 30-day SAR deadline generous at low volume. Tier 4 trigger if reinstated as code: ≥3 SARs in 6 months OR first SAR Fraser can't fulfil within 30 days.
- **Status**: 🔵 Process.

### M13.14 — Adults-only social-media consent at launch
- **Source**: 2026-05-09 decision
- **What**: Under-18 learners do not see consent UI at go-live. Parental-consent flow deferred to Tier 4 (trigger: content strategy demonstrably wants under-18 footage AND adults-only volume insufficient).
- **Phase**: 2 (enforced by 2.6 UI conditional)
- **Status**: TBD

### M13.15 — DEFERRED: Parental-consent flow for under-18 social-media
- **Source**: 2026-05-09 deferred
- **Trigger**: Content strategy wants under-18 footage AND adults-only volume insufficient. Revisit at month 6 or after 50 published clips.
- **Status**: 🟦 (until built)

### M13.16 — DEFERRED: Automatic dashcam-to-pipeline ingest
- **Source**: 2026-05-09 deferred — manual upload model in 2.8 chosen for v1
- **Trigger**: Manual-upload becomes friction (instructor uploads >5 clips/week consistently).
- **Status**: 🟦

### M13.17 — DEFERRED: Per-clip instructor approval rights
- **Source**: 2026-05-09 deferred — Schedule E grants flag-during-triage rights only
- **Trigger**: Instructor objects to a clip CCL approved; recurring conflict.
- **Status**: 🟦

### M13.18 (revised) — Storage decision: home-PC only (locked 2026-05-09)
- **Source**: 2026-05-09 — Fraser confirmed editing happens on home computer; prefers ephemerality
- **What**: Dashcam footage flows from SD card → home PC → social media → deletion. Never uploaded to CCL platform infrastructure. Never uploaded to third-party cloud (no R2, no S3, no Stream). £0/mo storage cost. No upload/transcoding/storage code on the platform. Aggressive deletion is Fraser's preferred discipline (avoids clutter). 30-day ICO ceiling becomes a personal/LIA rule, not enforced by code.
- **Status**: ✅ Locked. Cloud-storage path (R2 + triage UI + retention cron + SAR automation, previously M13.9 + M13.12 + M13.13) parked as a single Tier 4 entry with explicit triggers. R2 / Stream choice will be revisited at that point if triggered.
- **Eyes-open risks** (Fraser accepted 2026-05-09): no automatic backup; SARs become slow; takedown lookup is manual via spreadsheet (M13.10).

### M13.19 — Economics line item on content arrangement
- **Source**: 2026-05-09 — separate from £195 base
- **What**: £35/wk × 52 = £1,820/yr facilitation fee paid to instructor + ~£1,000–1,500/yr learner discount absorbed (assumes 30–50% consent uptake at 20 lessons/wk × £55 × 5%). Total annual CCL cost £3,000–5,000/yr per instructor in cash + build cost (~6 sessions) + ongoing admin time. Track separately from franchise fee maths so the cost isn't lost when instructor #3 onboards without the deal.
- **Status**: ✅ Recorded.
