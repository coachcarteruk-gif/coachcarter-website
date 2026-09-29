# Documentation reading map

Start with [AGENTS.md](../AGENTS.md). Read the rows relevant to the task and the linked contract sections they require. This index is not a request to load every document. Feature implementation, deployment, activation and permission to operate are separate facts; dated plans do not prove present production state.

## Product and engineering

| Task | Required context for that area |
|---|---|
| Navigation, page layout, missing/removed surfaces | [Navigation and intentional removals](navigation.md); [design reference](../DESIGN-REVIEW.md) for design work |
| API/page conventions, architecture, new dependencies | [Development conventions](development-conventions.md); [native portability plan](../MIGRATION-PLAN.md) when affected |
| Schema or migration changes | [Migration governance](migration-governance.md), including manifest/check requirements |
| Auth, sessions, support access, middleware | [Security](security.md) |
| School context, public endpoints, branding | [Multi-tenancy](multi-tenancy.md) |
| Personal data, consent, processors, retention | [GDPR](gdpr.md) |
| Bookings, availability, requests, holds, offers, extensions | [Booking contracts](booking-contracts.md), [statuses](booking-statuses.md), [availability policy](instructor-availability-policy.md); [travel](travel-time.md) if affected |
| Completed lesson length | [Delivered-duration corrections](delivered-duration-corrections.md) and the affected funding contract |
| Trial intake and qualification | [Qualifying trial funnel](qualifying-trial-funnel.md) |
| Post-trial discounts or pencilled offers | [Trial discount and offer contract](trial-discount-pencilled-offers-plan.md) |
| Setmore sync, imports or imported booking edits | [Setmore](setmore-sync.md); preserve keys and edit protection |
| Admin learner broadcasts | [Learner broadcasts](learner-broadcasts.md); slot-offer broadcasts use [booking contracts](booking-contracts.md#broadcast-offers) |

## Money and products

| Task | Required context for that area |
|---|---|
| Lesson Credit purchases/retirement, deductions, returns, adjustments, reconciliation, balance meaning | [Per-instructor credit audit](per-instructor-credits-audit.md); current-state tables plus the affected path's evidence. Preserve historical/in-flight settlement. |
| Pricing or discounts | [Pricing contracts](pricing-contracts.md) plus the affected product contract; direct checkout and offers do not inherit bulk-credit discounts |
| Package catalogue or Full Curriculum | [Package contracts](package-contracts.md), [product decisions](learner-packages-product-decision-record.md), [test-purchasing runbook](learner-packages-test-purchasing-runbook.md); [consumer rights](full-curriculum-consumer-rights-refund-spec.md) and [owner certification](full-curriculum-owner-self-certification-v1.md) for purchase/refund/fulfilment changes |
| Flexible Hours purchase, allocation, booking or returns | [Flexible Hours runbook](flexible-hours-packages-runbook.md), [booking contracts](booking-contracts.md); [bank receipts](flexible-bank-transfer-purchases.md) or [weekly rollout](flexible-weekly-rollout.md) when affected |
| Legacy balance conversion | [Legacy school-wide hours](legacy-schoolwide-hours.md); [grandfathering evidence](credits-grandfather.md) when applicable |
| Platform balance or refund exposure | [Credit audit](per-instructor-credits-audit.md), [exposure valuation](refund-exposure-valuation-audit.md), [Stripe Connect](stripe-connect.md) |

## Refunds and payouts

| Task | Required context for that area |
|---|---|
| Refund behavior or execution | [Booking statuses](booking-statuses.md), [Stripe Connect](stripe-connect.md), [refund operator runbook](refund-operator-runbook.md), [credit audit](per-instructor-credits-audit.md), plus the affected product's refund contract. Read [exposure valuation](refund-exposure-valuation-audit.md) when valuation/reserves are affected. |
| Payout eligibility, claims, transfers or engines | [Payout contracts](payout-contracts.md), [booking statuses](booking-statuses.md), [Stripe Connect](stripe-connect.md). Also read credit/refund/exposure contracts if changing funding, refund interaction or protected balances. |
| Simon launch, payout rollout or shadow exercise | [Payout handover](payout-handover.md), then protected product/technical specifications and the relevant dated log/evidence for the proposed operation |
| Payout summary image calculation or rendering | [Summary specification](payout/PAYOUT-SUMMARY-SPEC.md#calculation-and-rendering-maintenance-contract); its arithmetic must not be generalised to other payout engines |

## Reference and business plans

- [PROJECT.md](../PROJECT.md): API, tables, flows and environment reference. Search the relevant section instead of loading the entire file.
- [Development roadmap](../DEVELOPMENT-ROADMAP.md): delivery history and planned work; dated entries are historical evidence.
- [InstructorBook strategy](../INSTRUCTORBOOK-PLAN.md): positioning, proposed commercial model and national launch planning.
- [Franchise model](../FRANCHISE-MODEL-PLAN.md), [instructor experience](../INSTRUCTOR-EXPERIENCE-PLAN.md) and [franchise benefits](franchise-benefits.md): read for franchise/onboarding policy or automation triggers, not every routine credit edit.
- [Per-instructor credits plan](../PER-INSTRUCTOR-CREDITS-PLAN.md) and [learner/instructor selection plan](../LEARNER-INSTRUCTOR-SELECTION-PLAN.md): historical sequencing/design context; verify completion against current contracts and code.
- [Marketing sequence](30-day-email-sequence-reference.md): lead magnets, messaging and campaign strategy.

## Maintaining these documents

Keep one maintained contract per topic and link to it. Move unique rules before removing them from another document. Correct current summaries while preserving dated evidence and protected specifications. Do not prepend each new rollout to the agent entry files. Follow [documentation conventions](development-conventions.md#documentation-maintenance).
