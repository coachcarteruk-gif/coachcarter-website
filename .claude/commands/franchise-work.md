---
description: Start a session for multi-instructor franchise model work (schema, credits, payouts, tier admin)
argument-hint: [short description of the franchise change]
---

I'm working on the multi-instructor franchise model: **$ARGUMENTS**

Before writing any code, read these documents in order — they contain seven Council deliberations and a critical-thinking review's worth of resolved decisions. Don't re-litigate.

1. `FRANCHISE-MODEL-PLAN.md` — schema, code, configurability, MVP scope, legal-status research, deferred phases with trigger conditions
2. `INSTRUCTOR-EXPERIENCE-PLAN.md` — non-software companion: cold-start lead allocation, three crunch moments, signing-day conversation, 90-day success criteria
3. `CLAUDE.md` — section "Multi-instructor franchise model" for hard rules
4. `docs/stripe-connect.md` — payout mechanics

Then confirm you understand these load-bearing principles:

1. **Configurability not numbers.** All commercially-meaningful numbers (£55/hr, £195/£70 tier fees, 2.5%/5%/7.5% bulk discounts, 12-month contracts, tier inclusions) live in admin-editable config. Never hardcode. Adding a tier or changing a fee is an admin action, not a deploy.

2. **Add config primitives only when actively read.** Don't add columns "for future flexibility" without an active reader. Latent-flexibility columns get deferred until something reads them.

3. **Defer until pain shows up.** Many phases are deliberately deferred (`franchise_fee_debts`, `franchise_fee_overrides`, `marketing_promos`, `instructor_promo_optins`, automated Bacs DD invoicing, vehicle/fleet management). Don't suggest building them earlier than the trigger conditions in the plan's Alternatives Appendix.

4. **Three-level pricing fallback** (most-specific wins): per-learner-pair custom rate (`instructor_learner_notes.custom_hourly_rate_pence`) → per-instructor rate (`instructors.hourly_rate_pence`) → school default (`schools.config.pricing.bulk_hourly_pence`). Bulk discounts always apply to the *effective* rate.

5. **Year-one franchise relationships are human, not automated.** Negative-payout weeks are personally handled by Fraser, not auto-invoiced via Bacs DD. This is deliberate.

**Current MVP scope (Phases –1, 1, 2):**
- Phase –1: legal/agreement (BLOCKING). Franchise agreement draft, tier prices verified, dual-control sourcing clarified.
- Phase 1: schema groundwork. `franchise_tiers` table, instructor columns (`franchise_tier_id`, `contract_start_date`, `bulk_tiers_enabled`, `hourly_rate_pence`), credit/booking columns (`instructor_id`, `effective_rate_pence_per_minute`, `list_price_pence`), `learner_credit_balances` table.
- Phase 2: behavioural change in three threads. (A) per-instructor credit scoping. (B) bulk-tier opt-in + per-instructor rate logic. (C) tier admin UI + per-instructor rate UI.

**Files likely relevant:**
- `api/credits.js` — checkout, balance, verify
- `api/webhook.js` — `handleCreditPurchase`, `handleSlotBooking`
- `api/slots.js` — booking deduction, cancellation refund
- `api/_pricing-helpers.js` — `calcBulkTotal`, `getBulkPricing` (refactor target)
- `api/_payout-helpers.js` — `processPayoutForInstructor` (will switch to `lesson_bookings.list_price_pence`)
- `api/admin.js` — instructor edit form, future tier CRUD
- `api/instructor.js` — bulk-tier opt-in toggle
- `db/migration.sql` — schema additions
- `public/learner/buy-credits.html` + `book.js` — instructor-anchored pricing
- `public/admin/portal.html` + `portal.js` — tier admin section, instructor edit form
- `public/instructor/profile.html` — bulk-tier toggle, read-only rate display

**Before committing, verify:**
- [ ] No hardcoded numbers added (all values live in DB / JSONB config)
- [ ] No deferred-phase tables created without a trigger condition being met
- [ ] Per-instructor credit scoping respected (no new code touching pooled `learner_users.balance_minutes`)
- [ ] Three-level pricing fallback honoured wherever a rate is computed
- [ ] Bulk discount applied to instructor's effective rate, not the school default
- [ ] `lesson_bookings.list_price_pence` snapshotted at booking time
- [ ] `school_id` filter on every new SQL query against tenant-scoped tables
- [ ] Admin mutations audit-logged via `api/_audit.js`
- [ ] `FRANCHISE-MODEL-PLAN.md` updated if scope of any phase changed
- [ ] `DEVELOPMENT-ROADMAP.md` entry added for shipped work
- [ ] `MIGRATION-PLAN.md` updated if new tables / API routes / shared modules

Now read the two plan documents and the cited source files, then summarise your plan before writing any code.
