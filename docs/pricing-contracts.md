# Pricing and franchise maintenance contracts

Server-side amounts, tenant/instructor scope, immutable purchase snapshots and payment idempotency remain authoritative. Read [the credit audit](per-instructor-credits-audit.md) for Lesson Credit behavior and [the Flexible Hours runbook](flexible-hours-packages-runbook.md) for that separate product.

> Full plans: [`FRANCHISE-MODEL-PLAN.md`](../FRANCHISE-MODEL-PLAN.md), [`INSTRUCTOR-EXPERIENCE-PLAN.md`](../INSTRUCTOR-EXPERIENCE-PLAN.md)

Read the franchise plans for changes to franchise terms, onboarding or deferred automation. Routine booking/price calculations use the contract here and the relevant funding document; they do not require the full business-onboarding narrative.

Hard rules:

1. **Numbers live in admin-editable config, never hardcoded.** £55/hour, £195/£70 franchise tier fees, 2.5%/5%/7.5% bulk discounts, 12-month contracts, tier inclusions — all live in DB columns or JSONB. Adding a tier or changing a fee is an admin action, not a deploy. The pricing infrastructure is `schools.config.pricing.bulk_hourly_pence`, `schools.config.pricing.bulk_discount_tiers`, `franchise_tiers` table (planned), `instructors.weekly_franchise_fee_pence`, `instructors.hourly_rate_pence`.
2. **Per-instructor credit scoping is required for new credit work.** Ordinary Lesson Credit is held in `learner_credit_balances(learner_id, instructor_id, school_id, balance_minutes)`. `learner_users.balance_minutes` is only an aggregate/display shadow. Self-serve Lesson Credit Checkout and PaymentIntent creation are retired; preserve historical settlement, spending and returns. Flexible Hours uses separate school-wide sources and allocations.
3. **Three-level pricing fallback** (most-specific wins): per-learner-pair custom rate (`instructor_learner_notes.custom_hourly_rate_pence`) → per-instructor rate (`instructors.hourly_rate_pence`) → school default (`schools.config.pricing.bulk_hourly_pence`). Bulk discount percentages always apply to the *effective* rate from this fallback.
4. **Bulk-tier discounts are per-instructor opt-in. The instructor absorbs the discount.** `instructors.bulk_tiers_enabled` is implemented. These historical bulk-credit rules do not enable retired purchases or apply to direct single-slot checkout, instructor offers or the separate Flexible Hours product pricing. Their payout uses the snapshotted effective rate from `lesson_bookings.list_price_pence`, not the school list rate.
5. **Don't re-add deferred phases without checking trigger conditions.** `franchise_fee_debts`, `franchise_fee_overrides`, `marketing_promos`, `instructor_promo_optins`, automated Bacs DD invoicing, vehicle/fleet management — all deliberately deferred. Trigger conditions for each are in the plan's Alternatives Appendix. Until then: manual workarounds (Fraser personally invoices, spreadsheet for debts, admin tweaks `weekly_franchise_fee_pence` for one-week overrides).
6. **Year-one franchise relationships are human, not automated.** Negative-payout weeks are personally handled by Fraser, not auto-invoiced via Bacs DD. This is deliberate.
7. **Configurability discipline**: don't add columns "for future flexibility" if no active code path reads them. Exception is justified only when the user has a specific commercial reason to set the value at onboarding.

## Original-rate legacy conversion

An explicitly approved offline legacy balance may move to Flexible Hours through migration 058's preview/fingerprint-bound operator function. Never relabel historical Stripe/CT/BCS facts or grant the original purchased hours again. Preserve exact remaining minutes and confirmed purchase rate. Ordinary Lesson Credit remains instructor-scoped. See `docs/legacy-schoolwide-hours.md`.
