# Pricing And Booking Roadmap

Status: planning
Last updated: 2026-06-05

## Purpose

CoachCarter needs a clearer commercial model for lesson purchasing and booking. The current mix of bulk credit discounts, Stripe card fees, and Klarna fees risks turning the most attractive customer purchase into one of the weakest margin outcomes.

This roadmap defines the intended direction before implementation begins. It is deliberately written as product and commercial policy first, with technical phases afterwards.

## Core Direction

Credits should become lesson value held on account, not the main purchasing or discount mechanism.

Discounts should only be used where the learner gives the business something valuable in return:

- cleared upfront cash
- predictable weekly attendance
- commitment to a recurring slot
- reduced admin
- reduced diary uncertainty
- ability to fill quiet or underused periods

The platform should keep lesson purchasing frictionless, but it should stop combining the deepest discounts with the most expensive payment methods.

## Product Architecture

CoachCarter should move toward two clear purchasing and booking products, one lesson-credit account mechanism, and one payment reward layer.

### 1. Pay As You Go

Pay As You Go is the default low-commitment option.

- Sold at the learner's normal hourly rate.
- Payment methods can include card and Klarna.
- No discount.
- Uses standard booking availability.
- Uses the standard cancellation policy unless changed elsewhere.

Commercial role:

- Lowest commitment.
- Highest flexibility.
- Cleanest option for new or occasional learners.
- Margin protected by standard pricing.

### 2. Lesson Credit

Lesson Credit should remain as account value, not as a future self-serve learner purchase product.

- Existing purchased credit remains honoured.
- Spendable credit remains scoped by learner, instructor, and school.
- Future lesson credit may come from:
  - existing purchased balances
  - eligible cancellation returns
  - instructor cancellations
  - rescheduling flows
  - goodwill
  - admin adjustments
- New self-serve learner credit purchases should be removed from the preferred future customer model.
- Ordinary lessons inside the self-serve booking window should be purchased directly at booking.

Commercial role:

- Honours previously purchased lesson value.
- Keeps the existing credit ledger useful.
- Supports cancellation, rescheduling, goodwill, and admin adjustment flows.
- Prevents hidden margin damage from permanent self-serve bulk discounts.

### 3. Reserved Weekly Slot

Reserved Weekly Slot should become the main "serious learner" journey.

- Learner reserves the same instructor, day, and time for a block of future weeks.
- Suggested options:
  - 4 weeks
  - 6 weeks
  - 10 weeks
- This should be more visible than it is today.
- The booking UI should prompt learners after a booking:
  - "Reserve this slot weekly"
  - "Keep this time for the next 4, 6, or 10 weeks"
- Reserved slots should have clearer move/cancellation rules than ordinary flexible bookings.

Commercial role:

- Improves instructor diary stability.
- Helps learners form a consistent learning habit.
- Makes the real customer benefit clearer than "buy credits".
- Protects future instructor availability from casual speculative booking.

### 4. Paid-In-Full Reward

Paid-In-Full Reward is the best-value payment layer for learners who commit upfront.

- Offered only where payment is genuinely upfront and low-cost enough to justify the reward.
- Stripe Pay by Bank is the preferred route to investigate.
- Recommended starting reward: 3% off the full standard price of the reserved weekly block, configured rather than hardcoded.
- Card/Klarna can remain available at the standard rate for eligible reserved weekly blocks, but should not receive the deepest reward.
- The language should frame this as a reward for upfront commitment, not a penalty for using card or Klarna.
- The first version should aim to be self-serve from day one.
- Reserved weekly slots paid by Pay by Bank may be provisionally booked while payment is pending, then confirmed after Stripe reports successful payment.

Commercial role:

- Supports cashflow for marketing.
- Protects margin.
- Keeps professional payment options available without subsidising expensive payment methods.

## Payment Framing

Avoid customer-facing wording like:

> Klarna costs us more, so you pay more.

Prefer wording like:

> Pay flexibly at the standard rate, or choose the paid-in-full option for the best value.

This preserves the professional feel of online payments while allowing a clear upfront-payment reward.

## Proposed Rules

### Standard Rate Rule

All Pay As You Go bookings and standard credit top-ups should use the learner's normal hourly rate.

The system should not trust client-submitted prices, discounts, payment method fees, or instructor scope.

### No Default Bulk Discount Rule

Buying more credit should not automatically create a discount.

Bulk value should be available only through explicit products or campaigns, such as:

- paid-in-full reward
- reserved weekly slot offer
- limited quiet-period offer
- admin-created special offer

### Payment Method Rule

Klarna and card payments can be kept for convenience at standard pricing where the product journey allows them.

Klarna should be limited to reserved weekly slot blocks that go beyond the ordinary self-serve booking window. The best-value paid-in-full reward should sit beside Klarna as the lower-cost upfront alternative.

### Booking Window Rule

Ordinary self-serve lesson purchases stay within the existing self-serve booking window.

Proposed starting policy:

- direct Pay As You Go lessons are purchased inside the ordinary self-serve booking window
- learner-facing credit purchases are removed from the preferred future customer model
- reserved weekly slot blocks are the intended path for learners who want to secure future slots beyond ordinary short-range booking

This avoids using credits as an open-ended claim on far-future diary capacity.

### Reserved Slot Move Rule

Reserved weekly slots should be moveable with enough notice for the instructor to refill or reorganise the diary.

Starting policy:

- 6 or more days notice: learner can request to move the reserved lesson, subject to availability
- under 6 days notice: booking remains committed unless the instructor or admin offers a goodwill move
- first implementation should introduce this as visible policy/admin handling, not automatic hard enforcement

This is separate from the existing late-cancellation payout rule. Implementation must avoid accidentally reintroducing old dual-confirmation or "did the lesson happen?" flows.

### Tactical Offer Rule

CoachCarter can still run limited-time offers.

These should be explicit, narrow, and measurable:

- discounted Pay As You Go slots for quiet periods
- short promotional campaigns for new learners
- instructor-specific offers
- school-specific offers

They should not silently change the core credit model.

## Customer Experience Goals

The learner should quickly understand the difference between:

- "I want one lesson" -> Pay As You Go
- "I have lesson value on my account" -> Lesson Credit
- "I want this same weekly slot" -> Reserved Weekly Slot
- "I want the best value and can pay upfront" -> Paid-In-Full Reward

The booking flow should make the recurring slot option visible at the right time, especially immediately after a learner books a desirable slot.

## Instructor Experience Goals

The instructor should see fewer speculative long-range bookings and more committed recurring lessons.

The rules should protect instructor income and diary planning:

- no hidden cross-instructor credit spend
- no broadening of automatic refunds
- no weakening of late-cancellation payout protection
- no unclear payment expectations

## Admin Experience Goals

Admins should be able to explain the model simply:

- standard lessons are standard price
- lesson credit is honoured account value
- recurring slots protect a weekly time
- best-value pricing is for paid-in-full commitment
- special offers are deliberate campaigns

Over time, commercial numbers should live in admin-editable configuration, DB columns, JSONB, or admin-managed tables rather than hardcoded constants.

## Implementation Roadmap

### Stage 1: Decision Record And Copy

Goal: lock the business rules and customer-facing language before touching money logic.

Tasks:

- Add a formal decision record for the new pricing and booking model.
- Define canonical customer-facing labels:
  - Pay As You Go
  - Lesson Credit
  - Reserved Weekly Slot
  - Paid-In-Full Reward
- Draft customer-facing copy for each product.
- Draft admin/instructor explanation copy.
- Decide whether the first implementation will hide, disable, or reprice existing discounted credit packages.
- Confirm Lesson Credit as account value only, with self-serve learner credit purchases removed from the preferred future model.
- Confirm Paid-In-Full Reward as self-serve from day one, if Pay by Bank confirmation and provisional booking holds can be implemented safely.

Deliverable:

- Product wording and rules ready to implement.

### Stage 2: Remove Self-Serve Credit Purchases And Preserve Lesson Credit

Goal: remove learner-facing credit purchases while preserving existing Lesson Credit, per-instructor balances, and credit ledger behaviour.

Tasks:

- Audit current credit purchase flows.
- Hide/remove learner-facing self-serve credit purchase entry points.
- Hide/remove old discounted bulk package purchase UI from new learner-facing journeys.
- Preserve existing purchased Lesson Credit for learners who already have balances.
- Preserve `learner_credit_balances` as the spendable credit source.
- Preserve accounting ledgers, including `booking_credit_sources` and `credit_source_adjustments`.
- Preserve eligible cancellation returns, instructor cancellation returns, rescheduling credit, goodwill, and admin adjustment behaviour.
- Add focused tests for school scope, instructor scope, existing-balance spend, cancellation returns, and ledger effects.

Docs to load before implementation:

- `docs/per-instructor-credits-audit.md`
- `PROJECT.md`
- `CLAUDE.md`

### Stage 3: Payment Method Guardrails

Goal: stop pairing the best-value reward with expensive payment methods while preserving standard flexible payment where intended.

Tasks:

- Identify where Stripe Checkout, PaymentIntent, Klarna, and credit package payment methods are configured.
- Limit Klarna to reserved weekly slot blocks that go beyond the ordinary self-serve booking window, subject to Stripe configuration feasibility.
- Ensure card/Klarna standard-price purchases remain possible where intended for eligible reserved weekly blocks.
- Ensure paid-in-full reward is not presented as a payment-method surcharge.
- Preserve Stripe idempotency and metadata contracts.
- Add focused tests around payment method availability and server-side amount calculation.

Docs to load before implementation:

- `docs/stripe-connect.md`
- `docs/per-instructor-credits-audit.md`
- `PROJECT.md`
- `CLAUDE.md`

### Stage 4: Reserved Weekly Slot UX

Goal: make recurring same-slot booking prominent and understandable.

Tasks:

- Audit the existing recurring booking feature.
- Identify where learners currently book lessons and where the recurring option should appear.
- Add a post-booking prompt for reserving the same weekly slot.
- Offer clear options such as 4, 6, and 10 weeks.
- Make the recurring slot path visible without creating a marketing landing page.
- Keep the copy concise and action-focused.
- Verify the UI on mobile and desktop.

Docs to load before implementation:

- `docs/navigation.md`
- `docs/booking-statuses.md`
- `PROJECT.md`
- `CLAUDE.md`

### Stage 5: Reserved Slot Policy Enforcement

Goal: protect instructor calendars when learners reserve future weekly slots.

Tasks:

- Define how reserved weekly slots are represented in the existing booking model.
- Decide whether the 6-day move rule is enforced automatically, shown as policy, or handled by admin override in the first version.
- Avoid broadening automatic refund behaviour.
- Preserve the three-state booking lifecycle:
  - `scheduled`
  - `chargeable`
  - `refunded`
- Use `api/_booking-status.js` constants and predicates in backend control flow.
- Add tests for reserved-slot movement, cancellation timing, school scope, and instructor scope.

Docs to load before implementation:

- `docs/booking-statuses.md`
- `docs/refund-operator-runbook.md`
- `docs/refund-exposure-valuation-audit.md`
- `docs/per-instructor-credits-audit.md`
- `CLAUDE.md`

### Stage 6: Paid-In-Full Reward

Goal: introduce the self-serve best-value upfront option without turning payment method costs into customer-facing surcharges.

Tasks:

- Implement Paid-In-Full Reward as self-serve from day one if Pay by Bank confirmation, provisional booking holds, and notifications can be implemented safely.
- Define the 3% starting reward as configuration, not a hardcoded constant.
- Verify Stripe Pay by Bank account availability, settlement timing, Connect support, refund behaviour, and account-specific pricing.
- Define how Pay by Bank is shown.
- Define how payment confirmation is recorded.
- Define how reserved weekly slots are provisionally booked while payment is pending.
- Send learner and instructor provisional booking SMS while payment is pending.
- Send follow-up confirmation SMS after Stripe confirms payment.
- Decide whether paid-in-full reward creates confirmed reserved bookings directly, or uses a separate hold/reservation model before confirmation.
- Ensure audit logging for admin mutations.
- Ensure financial records remain consistent and tenant-scoped.

Docs to load before implementation:

- `docs/per-instructor-credits-audit.md`
- `docs/stripe-connect.md`
- `docs/security.md`
- `docs/gdpr.md`
- `PROJECT.md`
- `CLAUDE.md`

### Stage 7: Tactical Offers

Goal: preserve the ability to run targeted promotions without weakening the core model.

Tasks:

- Define the offer types the platform should support.
- Keep offers scoped by school and, where relevant, instructor.
- Ensure offers do not silently mutate historical financial records.
- Ensure discounted offers snapshot their effective rate.
- Keep offers separate from normal credit top-up pricing.

Docs to load before implementation:

- `docs/offer-pricing-alignment-audit.md`
- `docs/per-instructor-credits-audit.md`
- `PROJECT.md`
- `CLAUDE.md`

## Non-Goals

This roadmap does not approve:

- reintroducing dual-confirmation lesson completion prompts
- broadening automatic Stripe refunds
- broadening BCS refund execution
- changing payout eligibility without explicit scope
- using `learner_users.balance_minutes` as the source of spendable credit
- trusting client-submitted prices or discounts
- silently mutating historical accounting ledger rows
- adding hardcoded commercial numbers into production code

## Open Decisions

These should be answered before the relevant implementation stage begins.

1. What is the verified Stripe Pay by Bank settlement timing, refund behaviour, Connect/account availability, and account-specific pricing?
2. What exact reservation or hold model should represent "provisionally booked / payment pending" without changing booking, refund, cancellation, or payout semantics?
3. What timeout or follow-up rule should apply if a Pay by Bank payment remains pending or fails after the weekly block has been provisionally booked?

## Suggested First Implementation Prompt

Start with Stage 1 only.

The first implementation chat should not change payment amounts, Stripe configuration, refund behaviour, cancellation behaviour, or credit ledgers. It should produce the decision record and copy needed to make the next engineering stage safe and unambiguous.

Stage 1 decision output is now captured in `docs/pricing-booking-stage-1-decision-record.md`.
