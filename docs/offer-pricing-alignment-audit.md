# Offer Pricing Alignment Audit

Last updated: 2026-05-28

## Purpose

Track how instructor-created offer pricing should align with the multi-instructor franchise pricing model.

## Desired Pricing Rule

For new paid instructor-created offers:

1. Explicit `offer_price_pence` wins when the instructor/admin intentionally sets one.
2. Otherwise use the effective hourly fallback:
   - `instructor_learner_notes.custom_hourly_rate_pence`
   - `instructors.hourly_rate_pence`
   - `schools.config.pricing.bulk_hourly_pence`
3. `discount_pct`, when present, applies to that effective base price.
4. `instructors.bulk_tiers_enabled` does not affect offers. Bulk tiers are only for prepaid credit packages.
5. Repeat offers multiply the snapshotted per-lesson offer price by repeat count.
6. Free offers remain free.

## Current Findings

- Manual offers are created in `api/instructor.js::handleCreateOffer`.
- Implementation landed in this slice: new manual and broadcast offers now snapshot the final per-lesson price into `lesson_offers.offer_price_pence`.
- Manual offers use `api/_pricing-helpers.js::calcOfferLessonPrice()`: explicit `offer_price_pence` wins, otherwise custom learner rate -> instructor hourly rate -> school default, with `discount_pct` applied to that effective base.
- Broadcast offers in `api/instructor.js::handleCreateBroadcastOffer` and cancellation-triggered broadcasts in `api/_notify-availability.js` compute per-recipient prices with known learner ids, so custom learner rates can apply per row.
- Link-only/flexible offers with no known learner id skip the custom learner tier and snapshot instructor -> school fallback pricing.
- Flexible offers grant scoped instructor credit after payment in `api/webhook.js::handleOfferBooking`.
- Slot-pinned offers create bookings after payment.
- Repeat offers are charged in Stripe as `unit_amount = per_lesson_price`, `quantity = repeat_weeks`.
- `public/accept-offer.js` displays the server-returned price and repeat total; it does not independently recompute base pricing.
- `api/webhook.js::handleOfferBooking` trusts Stripe metadata rather than recalculating live prices, which is good once checkout metadata is correct.
- `effective_rate_pence_per_minute` for offer transactions is derived from accepted offer checkout price.
- `lesson_bookings.list_price_pence` for accepted paid offers is ultimately based on Stripe metadata / BCS attribution.
- Partial repeat refunds depend on offer metadata price, so incorrect offer pricing propagates to refund amounts.
- Existing pending offers with `offer_price_pence IS NULL` are intentionally left legacy-priced and may continue to display/checkout using lesson-type fallback unless migrated separately.

## Product Decisions

- Link-only/flexible offers with no known learner id use instructor rate -> school default. They should not reprice later when the learner enters an email.
- Reuse existing `lesson_offers.offer_price_pence` as the final frozen price for newly computed paid offers.
- Do not add base/source audit columns in the first implementation slice.
- Existing pending offers remain legacy-priced unless a separate migration/backfill is explicitly requested.
- Display should prefer truth over "was/now" polish. If old "was" display is misleading, hide it or keep it clearly legacy rather than expanding the PR.

## Proposed Narrow Implementation Slice

- [x] Add `calcOfferLessonPrice()` in `api/_pricing-helpers.js`.
- Manual offers:
  - [x] explicit `offer_price_pence` wins
  - [x] otherwise compute effective base price and apply `discount_pct` if supplied
  - [x] store the final per-lesson price in `lesson_offers.offer_price_pence`
- Broadcast/cancellation offers:
  - [x] compute from effective base price
  - [x] apply configured broadcast discount
  - [x] store final price in `offer_price_pence`
- Accept-offer and webhook:
  - [x] continue trusting stored offer price / Stripe metadata
  - [x] do not recalculate live pricing after offer creation
- Tests:
  - [x] explicit price wins
  - [x] instructor hourly override applies
  - [x] custom learner rate wins when learner is known
  - [x] link-only/no learner uses instructor -> school fallback
  - [x] discount applies to effective base
  - [x] bulk-tier opt-in does not affect offers
  - [x] repeat offers multiply stored per-lesson price
  - [x] webhook/list-price behavior remains metadata/snapshot based

## Non-Goals

- No refund formula changes.
- No payout formula changes.
- No bulk-tier package discounts for offers.
- No migration of existing pending offers.
- No new audit/source columns in the first implementation slice.
- No broad accept-offer redesign.

## Follow-Ups

- Optional `base_price_pence` / `price_source` columns if audit or "was/now" display becomes important.
- Optional cleanup/backfill for pending legacy offers.
- Optional offer display polish after the pricing behavior is correct.
