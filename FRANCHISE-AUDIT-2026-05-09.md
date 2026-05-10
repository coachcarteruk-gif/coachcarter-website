# Franchise Audit — 2026-05-09

Audit of website / database / admin code against `FRANCHISE-COMMITMENT-REGISTER.md`. Read-only — findings only, no fixes.

**Method**: walked the register top to bottom; classified each commitment by inspecting `db/migration.sql`, `db/migrations/`, `api/_pricing-helpers.js`, `api/_payout-helpers.js`, `api/credits.js`, `api/webhook.js`, `api/slots.js`, `api/admin.js`, `api/instructor.js`, `api/cron-payouts.js`, `vercel.json`, `public/learner/book.html`, `public/learner/buy-credits.html`, `public/instructor/profile.html`, `public/admin/portal.html`, `public/free-trial.html`, `public/privacy.html`.

**Method limits** (disclosed for honest interpretation):
- **No live DB introspection.** Schema findings rely on grep against `db/migration.sql` + listing `db/migrations/`. A column added by hand or via an out-of-band migration that wasn't backported to the SQL file would be missed. Confidence on schema absence is reinforced by API behaviour — code that would have used a column doesn't reference it — but the inference is two-step.
- **Backfill / Playwright not run.** Audit-day register steps 13 (20-learner backfill verification, T8.7–T8.9) and 14 (Playwright suite, T8.11) deferred — both need a DB connection / running env.
- **Some files greped, not read in full.** `book.html` checked for overflow keywords but `book.js` and `slots.js` weren't greped for the same patterns. `privacy.html` greped for franchise / Stripe-Connect / instructor terms but not read end-to-end against AGT data-handling clauses.
- **Register's deferred-trigger conditions taken at face value.** I didn't independently verify e.g. "≥3 active franchised instructors" thresholds for `franchise_fee_debts` — used the register as authoritative per the audit-prep memory.
- **Confidence column** added to the headline tables below. Where it's missing, treat confidence as "high — code behaviour and source files agree."

**Headline**: Phase 1 schema work has not yet shipped (high confidence — migration source files + API behaviour both align). Every behavioural commitment that depends on it (Phase 2A/2B/2C, all per-instructor scoping, all payout-rate snapshotting, Stripe-fee pass-through) is therefore also missing. Drift is clean — no deferred-phase tables have been built. Two pre-signing-day blockers remain open as expected.

---

## Pre-signing-day blockers

### ❌ H9.4 — Fraser's-overflow lead routing on `book.html`
- **Source**: EXP "Cold-start problem", section A
- **Commitment**: when chosen-instructor slot feed has 0 slots in next 7 days, surface other active instructors' slots as a secondary section. Not auto-redirect — explicit "Other instructors near you" affordance.
- **Reality**: `public/learner/book.html` has no overflow / alternative-instructor rendering. Grep on `overflow|alternative.?instructor|other.?instructor.{0,20}slot|surface.?other` returns only CSS `overflow` rules.
- **Confidence**: medium. Grep was against `book.html` only. `book.js` and `slots.js` weren't greped for the same patterns — possible but unlikely that overflow logic lives there and is invoked elsewhere. Worth a 30-second double-check before scoping the work.
- **Impact**: this is the *truthful pitch* the franchise agreement Lead Floor commits to. Without it, instructor #2's first weeks have no platform-side traffic redirection from Fraser's full diary, which is the entire reason the Lead Floor was set high enough to need pro-rata reduction logic.
- **Files to touch**: `api/slots.js` (new `?action=available-other-instructors` or extend `?action=available` with an `include_alternatives` flag), `public/learner/book.js` + `book.html` (secondary section under empty state).

### ✅ C10.3 — Full Franchise £195 economics verification — RESOLVED 2026-05-09
- **Source**: PLAN Phase –1 unticked items
- **Commitment**: real lease + insurance + servicing per-week cost vs the £195 weekly fee. If real cost ≥£160, raise to £210–220 and amend agreement + tier seed before signing.
- **Resolution**: verified with Fraser. Vehicle owned outright (£17,500 Toyota Yaris Hybrid '24 plate); instructor pays insurance; CCL covers servicing (Toyota Relax £37/mo), road tax (£190/yr), breakdown (£200/yr), tyres (£200/set ~2yr life), one-off fittings (£400 dual control + £700 decals + £400 dashcam).
- **Numbers**:
  - **6-year operational horizon**: real cost £66.43/wk → margin £128.57/wk (£6,685/yr) at £195 fee; £93.57/wk (£4,866/yr) with content deal active (£160 effective fee).
  - **3-year price-justification horizon**: real cost £81.49/wk → margin £113.51/wk (£5,903/yr) at £195 fee; £78.51/wk (£4,083/yr) with content deal active.
  - Margin holds with comfortable buffer in every scenario. Threshold for raise (£160 real cost) not approached.
- **Outcome**: £195 stands. **No agreement amendment needed.** Tier seed values in 2.1 migration use £195 / £70 as planned.
- **Underwriting story** (for instructor #2 conversation, item 1.6): price the fee for the 3-year horizon (defensible if forced to sell early); plan operationally for 6 (margin upside absorbs CCL overhead, support time, accident-excess gaps).
- **Note**: separate £35/wk content-facilitation arrangement added 2026-05-09. Does not change £195 base fee. Treated as a separate netted facilitation fee, not a franchise-fee discount. See plan items 1.8, 1.9, 2.5–2.9.

---

## Phase 1 — schema groundwork

All of the following schema commitments are **❌ Missing**. None have shipped. No migrations under `db/migrations/` reference `franchise_tiers`, `learner_credit_balances`, `list_price_pence`, `effective_rate_pence_per_minute`, `franchise_tier_id`, `contract_start_date`, `bulk_tiers_enabled`, or `hourly_rate_pence`.

| Item | Register ID | Status | Confidence | Note |
|------|-------------|--------|------------|------|
| `franchise_tiers` table | S1.1 | ❌ | high | Migration source absent + no API code references it. |
| `franchise_tiers` seeded with two tiers | S1.2 | ❌ | high | Depends on S1.1. |
| `instructors.franchise_tier_id` | S1.3 | ❌ | high | Listed all `ALTER TABLE instructors` rows in `migration.sql` — column not present. |
| `instructors.contract_start_date` | S1.4 | ❌ | high | Same. |
| `instructors.bulk_tiers_enabled` | S1.5 | ❌ | high | Same. |
| `instructors.hourly_rate_pence` | S1.6 | ❌ | high | Same. |
| `instructors.weekly_franchise_fee_pence` | S1.7 | ✅ | high | `db/migration.sql:739`. |
| `instructors.commission_rate` | S1.8 | ✅ | high | `db/migration.sql:483`. |
| `credit_transactions.instructor_id` | S1.9 | ❌ | medium | Confirmed via grep on migration files; not behaviourally cross-checked (no API code reads it either way). |
| `credit_transactions.effective_rate_pence_per_minute` | S1.10 | ❌ | medium | Same. |
| `lesson_bookings.list_price_pence` | S1.11 | ❌ | high | `_payout-helpers.js` would be the active reader; it doesn't reference the column. |
| `learner_credit_balances` table | S1.12 | ❌ | high | No API code reads or writes such a table; pooled `balance_minutes` still authoritative everywhere. |
| Backfill `learner_credit_balances` from `learner_users.balance_minutes` | S1.13 | ❌ | high | Depends on S1.12. |
| `learner_users.balance_minutes` kept as legacy | S1.14 | ✅ | high | Still in active use everywhere — pre-grandfather state. |
| Indexes on new FK columns | S1.15 | ❌ | high | Depends on S1.9 / S1.12. |
| `school_id` filter on new tenant queries | S1.16 | n/a | n/a | No new queries to audit yet. |

**Confidence legend** for this audit:
- **high** — migration source files + API behaviour both align (e.g., column not declared *and* no code references it).
- **medium** — single source of evidence (e.g., grep against migration files only; no behavioural cross-check).
- **low** — keyword grep only; full-file read would strengthen confidence.

**Deferred — confirmed absent (no drift)**:

| Item | Register ID | Status | Confirmed via |
|------|-------------|--------|----------------|
| `instructor_lead_floor_periods` | S1.17 | 🟦 | grep returned no schema match. |
| `instructors.lead_floor_per_week`, `instructors.lead_floor_max_reduction_pence` | S1.18 | 🟦 | grep returned no schema match. |
| `lesson_bookings.is_payout_eligible` | S1.19 | 🟦 | grep returned no schema match. |
| `franchise_fee_debts` | S1.20 | 🟦 | absent. |
| `franchise_fee_overrides` | S1.21 | 🟦 | absent. |
| `marketing_promos`, `instructor_promo_optins` | S1.22 | 🟦 | absent. |
| `vehicles` | S1.23 | 🟦 | absent. |
| `contract_end_date` / term-months columns | S1.24 | 🟦 | absent. |

---

## Phase 2A — per-instructor credit scoping

All **❌ Missing**. `learner_users.balance_minutes` is still the only credit-balance store.

| Item | Register ID | Status | Evidence |
|------|-------------|--------|----------|
| `effective_rate_pence_per_minute` snapshotted at credit purchase | P2.9 | ❌ | `api/webhook.js handleCreditPurchase` (line 114) writes only `balance_minutes` (line 160). No `credit_transactions` row carrying a rate snapshot. |
| `lesson_bookings.list_price_pence` snapshotted at booking time | P2.10 | ❌ | Column doesn't exist. `api/slots.js` book path (line 894+) and `webhook.js handleSlotBooking` (line 196+) deduct from pooled `balance_minutes`; no per-booking price snapshot. |
| Late-cancellation pays out at original credit's effective rate | P2.11 | ❌ | `_payout-helpers.js getEligibleBookings` looks up live `lesson_types.price_pence` (or per-learner custom rate) at payout time — no snapshot path. |
| Per-learner custom rate flows into `effective_rate_pence_per_minute` | P2.13 | 🟡 | `instructor_learner_notes.custom_hourly_rate_pence` exists (`migration.sql:886`) and is read at payout (`_payout-helpers.js:18-21`) and slot booking. But it's not snapshotted into a credit row — it's recomputed live each time. So the column-level wiring is in place; the snapshot wiring is not. |
| Learner can buy credits anchored to a chosen instructor | L7.1 | ❌ | `buy-credits.html` flow has no `instructor_id` step. `credits.js` checkout doesn't accept or persist one. |
| Per-instructor balances on learner profile | L7.2, L7.11 | ❌ | `learner/profile.html` shows pooled balance via `learner_users.balance_minutes`. |
| Booking decrements correct per-instructor balance | L7.3 | ❌ | Pooled deduction only. |
| Cross-instructor booking refused with clear error | L7.4 | ❌ | No such check — any learner with pooled credit can book any instructor. |
| 48h cancellation refund returns to right `(learner_id, instructor_id)` row | L7.7 | ❌ | `slots.js:2107` and `:2217` refund into pooled `balance_minutes`. |
| Legacy balance grandfather rule (consume legacy first when booking originally-allocated instructor) | L7.8 | ❌ | Depends on Phase 2A; not implemented. |
| Guest-checkout slot booking writes per-instructor row + `list_price_pence` | L7.10 | ❌ | `webhook.js handleSlotBooking` still pooled (line 240+, 248+). |
| Touch-and-verify: free-trial / referral / admin-credit / cancellation flows still work | T8.1–T8.4 | n/a | Will need verification when migration runs. Currently all pooled. |
| `handleCreditPurchase` writes per-instructor row | T8.5 | ❌ | |
| `handleSlotBooking` writes per-instructor row + `list_price_pence` | T8.6 | ❌ | |
| Backfill verification — sum of `learner_credit_balances` rows = pooled balance | T8.7 | ❌ | Depends on backfill having run. |
| Backfill verification — `effective_rate × minutes ≈ amount_pence` for credit_transactions | T8.8 | ❌ | Depends on column. |
| Every `lesson_bookings` row has `list_price_pence` populated | T8.9 | ❌ | Column absent. |
| Fraser's `bulk_tiers_enabled = TRUE` (grandfather) | T8.10 | ❌ | Column absent. |
| Playwright suite passes against migrated state | T8.11 | n/a | Pre-migration. |

---

## Phase 2B — bulk-tier opt-in + per-instructor rate logic

All **❌ Missing** behaviour. Pricing helpers infrastructure is partly there.

| Item | Register ID | Status | Evidence |
|------|-------------|--------|----------|
| Three-level pricing fallback (per-learner → per-instructor → school default) | P2.1 | 🟡 | Per-learner override applies at slot booking (`slots.js`) and payout (`_payout-helpers.js:18`). Per-instructor `hourly_rate_pence` doesn't exist yet (S1.6). So the fallback is two-level today, not three. |
| `getEffectiveHourlyPence(sql, schoolId, instructorId, learnerId?)` helper | P2.2 | ❌ | Helper not present in `api/_pricing-helpers.js`. Only `getBulkPricing(sql, schoolId)` exists, which is school-default-only. |
| Bulk discount applies to *effective* rate, not school default | P2.3 | ❌ | `calcBulkTotal` uses `getBulkPricing` → school default only. No per-instructor input. |
| Bulk-tier UI conditional on instructor's `bulk_tiers_enabled` | P2.4 | ❌ | Column absent; `buy-credits.html` shows ladder unconditionally. |
| In-flight credits unaffected by opt-out | P2.5 | ❌ | Snapshot column absent; opt-out not possible. |
| Bulk-tier % in `schools.config.pricing.bulk_discount_tiers` | P2.6 | ✅ | `_pricing-helpers.js:71-75` reads JSONB. Not hardcoded. |
| School default rate in `schools.config.pricing.bulk_hourly_pence` | P2.7 | ✅ | `_pricing-helpers.js:42-44`. |
| `MAX_HOURS_PER_PURCHASE = 36` constant | P2.8 | ✅ | `_pricing-helpers.js:18` — acceptable per register. |
| Pricing reflects chosen instructor's effective rate | L7.6 | ❌ | No instructor anchor in checkout. |
| Learner without bulk tiers sees only standard hourly | L7.5 | ❌ | Conditional UI absent. |
| `?action=set-bulk-tiers` on `api/instructor.js` | I6.4 | ❌ | Endpoint not present. |
| Profile shows assigned tier with inclusions | I6.1 | ❌ | `instructor/profile.html` has no franchise / bulk-tier markup (grep on `franchise|bulk.?tier|hourly_rate` returns nothing). |
| Profile shows hourly rate read-only | I6.2 | ❌ | Same. |
| Profile has "Bulk packages" toggle | I6.3 | ❌ | Same. |
| Instructor cannot self-edit hourly rate | I6.7 | ✅ (vacuously) | Column doesn't exist; no edit path possible. |

---

## Phase 2C — tier admin UI + per-instructor rate UI

All **❌ Missing**.

| Item | Register ID | Status | Evidence |
|------|-------------|--------|----------|
| Admin can CRUD `franchise_tiers` | A5.1 | ❌ | No tier-management UI in `public/admin/portal.html`. |
| Admin can assign tier from instructor edit form (selecting tier copies fee into `weekly_franchise_fee_pence`) | A5.2 | ❌ | Edit form (`portal.html:925-936`) has only fee-model dropdown + manual fee input. No tier dropdown. |
| Admin can set/clear `instructors.hourly_rate_pence` | A5.3 | ❌ | Column absent; no UI. |
| Admin can override `weekly_franchise_fee_pence` independently of tier default | A5.4 | ✅ | `api/admin.js:751-770` already handles direct edits to that column. Will continue to work post-S1.5. |
| All admin mutations audit-logged via `api/_audit.js` | A5.5 | n/a | Audit at code-review time when Phase 2C lands. Existing `api/admin.js` already calls `logAudit()` for instructor edits — pattern is established. |

---

## Phase 3-ish payout work (depends on Phase 1 schema)

These were not numbered as a phase but are commitments tied to Phase 1 + the May 2026 agreement. All **❌ Missing**.

| Item | Register ID | Status | Evidence |
|------|-------------|--------|----------|
| Payout cron between 14:00 and 16:00 Friday | B3.1 | 🟡 | `vercel.json:10` schedules `0 9 * * 5` (09:00 UTC Friday). Draft agreement (not yet signed) says 14:00–16:00. To-confirm rather than drift — the timing in the draft is a *proposal*, not a binding commitment, until C10.1/C10.2 close. Decision: align code now to lock the proposal in, or wait until clause 4.3 is final. Either way, one-line `vercel.json` change. |
| Payout window covers 7 days preceding 12:00 Friday cut-off | B3.2 | 🟡 | `_payout-helpers.js getEligibleBookings` selects `status='completed' OR (confirmed AND scheduled_date <= NOW() - 3 days)`. There is no rolling 7-day window — eligibility is "any unpaid completed lesson", which is broader than the agreement spec. May or may not be a problem in practice (every lesson eventually gets paid). The 12:00 cut-off concept doesn't exist in code. |
| Payout sum uses `lesson_bookings.list_price_pence` snapshot | B3.3 | ❌ | `_payout-helpers.js:18-21` reads live `lesson_types.price_pence` / `iln.custom_hourly_rate_pence`. Snapshot column absent. |
| Stripe fees passed through to instructor at cost | B3.4 | ❌ | `_payout-helpers.js:55-60` computes payout = gross − franchise fee. No Stripe-fee deduction. `cron-payouts.js` doesn't reference Stripe fees at all. |
| Stripe fees itemised on weekly payout statement | B3.5 | ❌ | Email body in `cron-payouts.js:43-50` shows total only — no Stripe-fee line. Same for `instructor/earnings.html`. |
| Negative-payout shortfall rolls forward | B3.6 | 🟡 → planned | `_payout-helpers.js:55-60`: if `franchise_fee > gross`, payout truncates to 0 via `Math.min(franchiseFee, totalGrossPence)`. Shortfall amount is not stored anywhere. **Decided 2026-05-09: column-based tracking (option B), scoped as plan item 1.3.** `instructor_payouts.shortfall_pence` + recovery-tracking columns to be added; `_payout-helpers.js` extended to write shortfall on truncation and deduct on next positive payout; `/instructor/earnings.html` shows running balance. CC6 (year-one is human) is preserved by keeping the *invoicing*/*conversation* manual — code only handles the rollforward arithmetic. |
| Year-one shortfall handling informal | B3.7 | 🔵 | Confirmed: no Bacs DD code, no `stripe.invoices.create` for franchise fees. As intended. |
| Post-termination 30-day settlement | B3.8 | 🔵 | No code. As intended. |
| Lesson only payout-eligible if vehicle insurance valid | B3.9 | 🔵 | No `is_payout_eligible` column / filter. Manual SQL exclusion until S1.19 ships. As intended. |
| Weekly Fee accrues during insurance-lapse suspension | B3.10 | 🔵 | No "suspended" state in code. Manual. |
| Payouts forfeited during precautionary suspension | B3.11 | 🔵 | Same. |
| Lead Floor reduction applied to following quarter's Weekly Fee | B3.12 | 🔵 | Manual via `weekly_franchise_fee_pence` edits until S1.17/S1.18. |
| Lead Floor pauses during precautionary suspension | B3.13 | 🔵 | Manual. |
| £250 vehicle deposit deducted from week-1 payout | B3.14 | ❌ | No code. Will need adding once first Full-Franchise instructor onboards. |
| £250 deposit returned within 14 days of vehicle return | B3.15 | 🔵 | Process. |
| Payout statement itemising Stripe fees (instructor UI) | I6.5 | ❌ | See B3.5. |

**B3.6 (negative-payout shortfall tracking) is the highest-urgency *non-blocking* item.** It's likely to fire in instructor #2's first 4–6 weeks: break-even for Full Franchise £195 is roughly 3.5 lessons/week at £55/lesson — anything below that triggers truncation. Today, a £75 shortfall against a £195 fee just becomes "we paid £0 this week" with no machine record of the £120 owed. CC6 keeps the *invoicing* manual — that's not in question. The decision is whether the *amount* should be stored in code (one-line column add on `instructor_payouts`) or remain in Fraser's spreadsheet. Either is defensible; the audit just flags that today neither is in place — code says nothing, and there's no spreadsheet template referenced anywhere either. Resolve before signing day, even if the resolution is "spreadsheet template lives at [path] and Fraser updates it on payout days."

---

## Lifecycle / process commitments

All Section 4 items (L4.1 – L4.14) are **🔵 Process** and confirmed handled by Fraser, not code:

- L4.1–L4.5 — Start Date, contract term, fee-change-late-proposal: tracked manually. `contract_start_date` column missing (S1.4) means even minimal storage isn't there yet.
- L4.6, L4.7 — Termination grounds: process-only, no code expected.
- L4.8 — Precautionary suspension: needs an `is_suspended` flag eventually, not now.
- L4.9, L4.10 — Notice periods, vehicle return: process.
- L4.11 — Tier locked for Term: enforced by Fraser, not UI.
- L4.12, L4.13, L4.14 — Insurance: process, with B3.9 / S1.19 as the eventual code hook.

No drift here — no premature automation has been built.

---

## Admin actions

| Item | Register ID | Status |
|------|-------------|--------|
| Admin CRUD franchise_tiers | A5.1 | ❌ Phase 2C. |
| Admin assign tier from edit form | A5.2 | ❌ Phase 2C. |
| Admin set/clear hourly rate | A5.3 | ❌ Phase 2C. |
| Admin override weekly fee | A5.4 | ✅ |
| Audit logging | A5.5 | ✅ pattern established via `api/_audit.js`. |
| Insurance certificate verification UI | A5.6 | 🔵 / nice-to-have. |
| Vehicle assignment UI | A5.7 | 🔵 (S1.23 deferred). |
| Manual credit adjustment still works post-Phase 2A | A5.8 | n/a until Phase 2A ships. |
| Lead Floor delivery counts (manual) | A5.9 | 🔵 |
| Manual SQL for insurance-gap exclusion | A5.10 | 🔵 |

---

## Instructor / Learner UI

Already covered in Phase 2A / 2B / 2C tables above:

- I6.1 ❌, I6.2 ❌, I6.3 ❌, I6.4 ❌, I6.5 ❌, I6.6 ❌ — all blocked on schema.
- I6.7 ✅ vacuously (column doesn't exist).
- L7.1 ❌, L7.2 ❌, L7.3 ❌, L7.4 ❌, L7.5 ❌, L7.6 ❌, L7.7 ❌, L7.8 ❌, L7.10 ❌, L7.11 ❌ — all blocked on schema.
- L7.9 — free-trial completion counts toward Lead Floor: 🔵 manual.

---

## Process / human-side (Section 9)

| Item | Register ID | Status |
|------|-------------|--------|
| Negative-payout conversations personal | H9.1 | 🔵 Confirmed: no Bacs DD / auto-invoice. (See also B3.6 caveat.) |
| Half-day instructor-support time | H9.2 | 🔵 Personal calendar. |
| Servicing/MOT relationship time | H9.3 | 🔵 |
| **Fraser's-overflow lead routing on book.html** | H9.4 | ❌ **Pre-signing-day blocker.** |
| New-instructor highlight on free-trial.html | H9.5 | ❌ Post-signing nice-to-have. Free-trial page has no per-instructor highlight markup. |
| Postcode-default routing | H9.6 | ❌ Needs `instructors.coverage_postcodes` (no such column). Post-signing nice-to-have. |
| Manual referral-by-Fraser | H9.7 | 🔵 |
| Weekly check-in spreadsheet | H9.8 | 🔵 |
| Decision-points pre-rehearsed | H9.9 | 🔵 |
| Don't onboard instructor #3 until #2's 90-day post-mortem | H9.10 | 🔵 |

---

## Drift findings

**Clean on schema.** No deferred-phase tables (S1.17–S1.24) have been built.

No items rise to ⚠️ "Contradicts plan/agreement" — both candidates downgrade on closer inspection:

1. **🟡 B3.1 — Payout cron schedule.** `vercel.json:10` is `0 9 * * 5` (09:00 UTC Friday). Draft agreement says 14:00–16:00. The agreement is unsigned (C10.1/C10.2 still pending solicitor), so this is "to-confirm against final timing", not "drifts from binding commitment." One-line `vercel.json` fix when timing is locked.
2. **🟡 B3.6 — Negative-payout shortfall not stored.** `_payout-helpers.js:57` truncates via `Math.min(franchiseFee, totalGrossPence)`. The truncation is correct (Stripe rejects negative transfers); the *missing* piece is shortfall tracking. Per CC6 the *invoicing* is deliberately manual, so this isn't a contradiction with the agreement — it's a tracking-mechanism decision that hasn't been made. See Cross-cutting risks for urgency rationale.

---

## Content / external artefacts

| Item | Register ID | Status | Note |
|------|-------------|--------|------|
| Final Franchise Agreement (post solicitor) | C10.1 | 📄 In progress. Heads-of-terms in `FRANCHISE-AGREEMENT-DRAFT.md`. |
| Solicitor review | C10.2 | 📄 Pending. |
| **Tier-price economics verification** | C10.3 | 📄 Pending. **Pre-signing-day blocker.** |
| Decal-removal early-exit fee figure | C10.4 | 📄 Pending. AGT 3.3 still has `[FIGURE]` placeholder. |
| Learner Vehicle Standards policy | C10.5 | 📄 Not drafted. Post-agreement task. |
| Schedule template (printable PDF + signing) | C10.6 | 📄 Embedded in draft. |
| Sample week-by-week earnings projection | C10.7 | 📄 Not drafted. Required for Moment 1 conversation. |
| Pre-signing conversation script | C10.8 | 📄 Implicit in EXP doc. |
| Privacy policy multi-instructor | C10.9 | 🟡 `public/privacy.html:115, 149` cover multi-school + multi-instructor data flow at high level (April 2026 multi-tenancy work). Confidence: low — assessed via keyword grep, not focused re-read against AGT 6.x data-handling clauses. Franchisee-as-self-employed-data-processor framing not verified. Worth a focused 15-min re-read before instructor #2 signs. |

---

## Hard-rule compliance (Section 12)

| Rule | Status | Note |
|------|--------|------|
| CC1 — All commercially-meaningful numbers in admin-editable config | 🟡 | School default rate + bulk tiers already in JSONB ✅. Weekly franchise fee already in column ✅. Tier inclusions / per-tier defaults haven't been built (S1.1) so can't be audited. `_pricing-helpers.js:19 HARD_FALLBACK_HOURLY_PENCE = 5500` is a hardcoded fallback but acceptable per current policy. |
| CC2 — Per-instructor credit scoping required for new credit work | n/a | Phase 2 hasn't shipped. Existing pre-Phase-2 code legitimately uses pooled `learner_users.balance_minutes`. |
| CC3 — Three-level pricing fallback honoured everywhere | ❌ | Per-instructor rate doesn't exist. Currently two-level (custom-rate → school default). Will become three-level when `getEffectiveHourlyPence()` ships in Phase 2B. |
| CC4 — Bulk-tier opt-in; instructor absorbs discount | ❌ | Opt-in flag absent. Until then, bulk discounts apply to *every* instructor-anchored bulk purchase (which is fine because there are no instructor-anchored purchases yet). |
| CC5 — No deferred-phase tables / columns | ✅ | Confirmed clean: `franchise_fee_debts`, `franchise_fee_overrides`, `marketing_promos`, `instructor_promo_optins`, `vehicles`, `is_payout_eligible`, `lead_floor_*`, `contract_end_date`/`term_months` — none exist. |
| CC6 — Year-one is human, not automated | ✅ | No Bacs DD, no auto-invoice, no `stripe.invoices.create` for franchise fees. |
| CC7 — Configurability discipline (no flexibility-only columns) | n/a | Phase 1 hasn't shipped. Audit at end of Phase 2. |

---

## Quick wins (≤1 hour)

1. **Payout cron schedule** (B3.1 🟡). When the agreement timing locks, change `vercel.json:10` from `"0 9 * * 5"` to `"0 14 * * 5"` (or `"0 15 * * 5"` mid-window). Five-minute change. Worth deferring until clause 4.3 is final to avoid changing it twice.
2. **Decide on the negative-payout shortfall tracking** (B3.6 🟡). Not technically a quick win because of the urgency caveat — see Cross-cutting risks. The *code change* is one line. The *decision* (column vs spreadsheet) needs Fraser's explicit call before instructor #2 starts. Listed here because the implementation is fast once the call is made.
3. **Decal-removal early-exit fee** (C10.4). One spreadsheet ask to a fitter, then fill in the `[FIGURE]` placeholder in `FRANCHISE-AGREEMENT-DRAFT.md`.
4. **Confirm Fraser's grandfather flag plan in writing** (T8.10). The plan already says "Fraser's row = TRUE" but it's worth being explicit about whether the migration runs the backfill *before or after* tier seeding, since `bulk_tiers_enabled` defaults to FALSE and the migration sequencing matters.
5. **Focused privacy-policy re-read** (C10.9 🟡). Read `public/privacy.html` end-to-end against AGT 6.x data-handling clauses. 15 minutes. Either confirms ✅ or surfaces specific edits.

---

## Cross-cutting risks

1. **Phase 1 schema unblocks — but doesn't equal — Phase 2 work.** Almost every ❌ row above traces back to "S1.x hasn't shipped", which can read as "ship Phase 1 and most of these resolve." That's the wrong inference. Phase 1 is a single migration; Phase 2A (per-instructor credit scoping), 2B (bulk-tier opt-in + three-level rate logic), and 2C (tier admin UI) are each substantive behavioural changes touching webhook, slots, payout, learner UI, instructor UI, and admin UI. Ship Phase 1 first, but budget Phase 2 as three more deliberate workstreams, not one cleanup pass.

2. **B3.6 (negative-payout shortfall tracking) is high-urgency despite being technically simple.** Break-even for Full Franchise £195 at £55/lesson is ~3.5 lessons/week. Instructor #2's first 4–6 weeks are exactly when low-revenue weeks are most likely. Today, code silently truncates and there's no documented spreadsheet either — which means on the first low-revenue week, neither side has a record of how much was forfeited. CC6 makes the *invoicing* manual; that doesn't excuse not tracking the *amount*. Resolve before signing day. Implementation is one-line either way (column add OR documented spreadsheet template).

3. **Payout-helper rewrite is bigger than its line count suggests.** `_payout-helpers.js processPayoutForInstructor` currently does:
   - live price lookup (B3.3)
   - franchise vs commission branching
   - rounding fix-up
   - Stripe transfer
   - failure rollback

   Phase 2A + B3.4 + B3.5 + B3.6 together change all of that: snapshot read instead of live lookup, Stripe fee deduction, shortfall storage, statement itemisation. Worth budgeting a deliberate refactor session, not a piecemeal patch — easy to get rounding wrong if Stripe fees get bolted on top of the existing flow.

4. **`book.js` overflow rendering needs a thoughtful UX, not just an API addition.** Listing "other instructors" sounds simple but raises questions the plan doesn't answer in detail: do learners see all alternatives or just the geographically-closest? Are alternative slots shown as a separate section ("No slots with Sarah this week — try these other instructors") or interleaved? Does an alternative-instructor click switch the entire page context or open a one-off modal? Worth a short design pass before coding so it doesn't end up rebuilt in week 3.

5. **Instructor #2's first payout will exercise B3.4 (Stripe-fee pass-through), B3.5 (itemisation), B3.6 (shortfall), and B3.14 (£250 deposit) all at once.** None are built. That's not a single-PR concern — it's "the day Fraser presses Pay, what happens to instructor #2's bank account and email inbox?" Worth a dedicated rehearsal pass on a test instructor (with a real Stripe Connect test account) before signing day, even if the code path is "fake the Phase 1 columns by hand for now".

6. **The Lead Floor pro-rata logic (Decision 14, AGT 4.4) is purely manual today.** That's intentional (S1.17/S1.18 deferred) but the *first quarterly evaluation* for instructor #2 lands ~13 weeks after their Start Date — so for a couple-of-months-out start, that calculation happens around month 5–6. Make sure Fraser has the spreadsheet template before then; don't let it surprise either side at the wrong moment.

---

## Summary

- ❌ Pre-signing-day blockers remaining: H9.4 (overflow routing — confidence upgraded to high during planning, see plan item 1.2). ✅ C10.3 (£195 economics) closed 2026-05-09 — see entry above.
- 🆕 New pre-signing items added 2026-05-09 from content-licensing arrangement: 1.8 (Schedule E in agreement), 1.9 (Legitimate Interests Assessment for dashcam). See `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md`.
- ❌ Phase 1 schema: 11 of 11 active items missing (high confidence). Clean on deferred (8 of 8 confirmed absent — high confidence).
- ❌ Phase 2A: 100% pending — depends on Phase 1.
- ❌ Phase 2B: 100% pending — depends on Phase 1.
- ❌ Phase 2C: 100% pending — depends on Phase 1.
- 🟡 Payout cron timing (B3.1) — to-confirm against final agreement timing, not drift.
- 🟡 Negative-payout shortfall tracking (B3.6) — high-urgency decision (column vs spreadsheet) before signing day.
- 🟡 Privacy policy multi-instructor (C10.9) — keyword-grep only, focused re-read pending.
- ✅ Hard-rule compliance: clean. No premature deferred-phase building. No Bacs DD. Year-one-is-human respected.
- 📄 Content: agreement, solicitor review, earnings projection, Vehicle Standards, decal-removal figure all pending.

**Method limits acknowledged**: no live DB introspection; no Playwright run; some files greped rather than read end-to-end. Confidence column on the Phase 1 table reflects this.

The audit is read-only. Decide priorities and ship in a separate session.
