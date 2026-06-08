# Pricing And Booking Roadmap

Status: implementation in progress
Last updated: 2026-06-08

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

Stage Progress - 2026-06-05:

- Implemented on branch `codex/stage-2-remove-learner-credit-purchases`.
- `/api/credits?action=checkout` now returns `410 CREDIT_PURCHASE_RETIRED` before pricing, SQL, or Stripe checkout work runs.
- `/api/credits?action=create-payment-intent` now returns `410 CREDIT_PURCHASE_RETIRED` before pricing, SQL, or Stripe PaymentIntent work runs.
- Existing Lesson Credit remains preserved. `learner_credit_balances` stays the spendable credit source, and the existing spend path in booking remains available for eligible bookings.
- Historical credit compatibility remains preserved. Existing webhook and verify handling for already-created or already-paid `credit_purchase` sessions/PaymentIntents was intentionally left in place.
- Ledger behaviour was intentionally left untouched. `booking_credit_sources`, `credit_source_adjustments`, refund/cancellation/payout lifecycles, BCS refund execution, and booking status semantics were not changed.
- `/learner/buy-credits.html` was converted into a read-only existing Lesson Credit balance page for old bookmarks. It loads balances through `/api/credits?action=balance`, supports selected-instructor balance context, and no longer posts to credit checkout.
- Learner-facing buy/top-up entry points were removed or redirected from the booking modal, learner sidebar, learner dashboard balance tile, demo bottom navigation, public lessons package funnel, public/homepage copy, and marketing editor defaults.
- The public `/lessons.html` package section now routes learners toward booking/pay-and-book instead of creating credit checkout sessions.
- The AI Lesson Advisor no longer has a Stripe checkout tool, no longer creates credit checkout links, and no longer quotes fixed package pricing.
- Copy was updated in `PROJECT.md`, `docs/navigation.md`, `public/config.json`, `public/index.html`, `public/terms.html`, `api/magic-link.js`, `api/slots.js`, `api/webhook.js`, `api/enquiries.js`, and admin/dashboard/editor surfaces to describe existing Lesson Credit rather than new self-serve bulk purchases.
- Tests updated or added for retired credit purchase APIs, read-only learner credit UI, removed learner navigation entry points, public marketing pricing copy, one-hour lesson opt-in expectations, dynamic payment method coverage, and the reschedule-credit integration fixture date window.

Validation recorded for Stage 2:

- `npm.cmd test -- tests/learner-credit-ui.spec.js tests/credits-instructor-api.spec.js tests/marketing-pricing-copy.spec.js tests/one-hour-lesson-opt-in.spec.js tests/stripe-dynamic-payment-methods.spec.js` - 31 passed.
- `npm.cmd run check:syntax` - OK 158 files.
- `npm.cmd test -- tests/slots-credit-bcs.integration.spec.js tests/cancel-bcs-refund.integration.spec.js tests/reschedule-credit-returned.integration.spec.js` - 27 passed. The run printed outbound test email/SMS delivery errors after assertions, but exited successfully.
- After final stale-copy cleanup, `npm.cmd test -- tests/marketing-pricing-copy.spec.js` - 3 passed.
- After final stale-copy cleanup, `npm.cmd run check:syntax` - OK 158 files.

Stage 2 intentionally left untouched:

- No Stripe/Klarna configuration changes.
- No Reserved Weekly Slot implementation.
- No Paid-In-Full Reward implementation.
- No Pay by Bank implementation.
- No database migrations.
- No hardcoded commercial numbers.
- No refund, cancellation, payout, booking lifecycle, or BCS refund behaviour changes.
- No mutation of historical financial ledger rows.

Stage 2 remaining risks and follow-up notes:

- The old `/learner/buy-credits.html` route remains as a read-only balance page for compatibility rather than being removed or redirected. Keep monitoring for stale external links or cached copy that still implies new top-ups.
- `api/credits.js` still contains dormant checkout/PaymentIntent implementation behind the retired guard so historical metadata and possible operator recovery paths remain understandable. A later cleanup can decide whether to remove this dead path once no in-flight sessions depend on it.
- `bulk-pricing` remains read-only for compatibility/admin or legacy display use. It should not be treated as approval to reintroduce learner-facing self-serve credit packages.
- Some historical audit/runbook language still references prior credit purchase architecture. Update those docs only when that area is being worked on, so this Stage 2 PR stays scoped.
- No new Stage 2 product decision is open before merge. Later stages still need the Pay by Bank, provisional hold, timeout/failure, and Reserved Weekly Slot policy decisions listed in Open Decisions.

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

Stage Progress - 2026-06-05:

- Implemented as a read-only audit, documentation, and guardrail-test stage on branch `codex/stage-3-payment-method-guardrails`.
- Current Stripe Checkout creators were identified:
  - `api/slots.js?action=checkout-slot` for authenticated direct Pay As You Go booking.
  - `api/slots.js?action=checkout-slot-guest` for guest direct Pay As You Go booking.
  - `api/offers.js` for instructor-created lesson offers.
  - dormant `api/credits.js?action=checkout` code retained behind the retired Lesson Credit purchase guard for historical compatibility/operator recovery context.
- Current PaymentIntent creation was identified only in dormant `api/credits.js?action=create-payment-intent` code behind the retired Lesson Credit purchase guard.
- Direct Pay As You Go and offer Checkout Sessions currently rely on Stripe dynamic payment methods. Klarna is not hardcoded in production checkout creation; payment method availability is controlled by Stripe eligibility/Dashboard configuration unless a future product-specific payment method configuration is deliberately introduced.
- Existing webhook handling already preserves async payment method safety by ignoring unpaid `checkout.session.completed` events and waiting for `checkout.session.async_payment_succeeded` before booking/granting supported paid flows.
- Stage 3 did not change production Stripe/Klarna configuration because Reserved Weekly Slot and Paid-In-Full Reward do not exist yet, and the agreed scope excludes implementing them in this stage.
- Guardrail tests now document the expected current Checkout surface count, prevent current Checkout payloads from pinning `payment_method_types`, confirm retired Lesson Credit checkout/PaymentIntent paths stop before SQL/Stripe work, and pin direct booking Checkout to server-calculated `pricePence` rather than client-submitted payment data.

Stage 3 intentionally left untouched:

- No Stripe Dashboard or Klarna production configuration changes.
- No Reserved Weekly Slot implementation.
- No Paid-In-Full Reward implementation.
- No Pay by Bank implementation.
- No database migrations.
- No refund, cancellation, payout, booking lifecycle, BCS refund execution, or financial ledger changes.
- No changes to existing Lesson Credit, `learner_credit_balances`, `booking_credit_sources`, or `credit_source_adjustments`.

Stage 3 remaining risks and follow-up notes:

- The roadmap rule "limit Klarna to reserved weekly slot blocks" cannot be safely enforced until the reserved weekly block product and its payment surface exist.
- Future implementation needs a deliberate product-scoped payment method configuration mechanism, not an ad hoc change to today's direct Pay As You Go checkout.
- Pay by Bank eligibility, settlement timing, refund behaviour, Connect support, and pricing remain open for Stage 6.

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

Stage Progress - 2026-06-05:

- Audited the current recurring surfaces on branch `codex/stage-4-reserved-weekly-slot-ux`.
- Existing instructor-created offers already support slot-pinned weekly repeat blocks through `lesson_offers.max_repeat_weeks` and the accept-offer repeat picker. The instructor sets a 1..18 week ceiling, the learner chooses the count on the accept page, Stripe charges per-lesson price x quantity, and `api/offers.js::bookOfferSeries()` fans out the weekly series after payment or free-offer acceptance.
- Existing offer repeat fan-out is intentionally not the full future Reserved Weekly Slot product. It skips clashed later weeks and rolls to later same-day/time candidates up to the 18-week search window; partial paid repeats depend on refund/accounting paths that should not be broadened in Stage 4.
- Existing learner self-serve repeat booking is available only to logged-in learners with enough same-instructor Lesson Credit. It posts `repeat_weeks` to `/api/slots?action=book`, is capped inside the 28-day self-serve booking window, and creates a `series_id` across the selected weekly bookings. Guest and Pay As You Go Stripe checkout paths remain single-slot only.
- Stage 4 first implementation decision: use a post-booking visibility prompt only. Do not add a new modal booking option, new API action, new Stripe surface, new reserved-offer mutation, or new policy enforcement until representation/payment decisions are resolved.
- Added a compact Reserved Weekly Slot prompt in `/learner/book.html` after successful in-page single bookings, plus a matching post-Stripe-return prompt for `?paid=1` Pay As You Go bookings. Copy asks learners to request a Reserved Weekly Slot offer for the same instructor, day, and time for 4, 6, or 10 weeks.
- The prompt is intentionally hidden after an existing in-page weekly repeat booking, because the learner has already booked a series.

Stage 4 intentionally left untouched:

- No Payment Method Guardrail enforcement beyond Stage 3.
- No Stripe/Klarna production config changes.
- No Paid-In-Full Reward or Pay by Bank implementation.
- No database migrations.
- No refund, cancellation, payout, booking lifecycle, BCS refund execution, or financial ledger changes.
- No changes to Lesson Credit, `learner_credit_balances`, `booking_credit_sources`, or `credit_source_adjustments`.

Stage 4 remaining risks and follow-up notes:

- The current code change still creates visibility only. It does not implement the recurring weekly block flow, new API routes, payment holds, migrations, credit mutation changes, or calendar read-model changes.
- The future product representation decision is now captured in the Stage 4 recurring block decision record.
- Existing instructor-created repeat offers still need a later alignment pass if the platform standardises all repeat behaviour around future weekly lesson count rather than calendar weeks.

Stage 4 follow-up decisions after product review:

- The future implementation contract is captured in `docs/pricing-booking-stage-4-recurring-block-decision-record.md`.
- The agreed product shape is a post-booking recurring weekly block upsell, not a pre-payment change to ordinary single-slot checkout.
- Recurring weekly blocks are future-only, 4-12 lessons, capped by matching availability inside the next 12 calendar weeks.
- Recurring blocks should use a dedicated hold model, support full same-instructor Lesson Credit or bank transfer / Pay by Bank, exclude partial credit and Klarna in v1, and create real bookings only after credit confirmation or bank-payment confirmation.

Stage 4 implementation foundation - 2026-06-07:

- Added dedicated `recurring_slot_blocks` and `recurring_slot_block_items` tables to `db/migration.sql`.
- Added `GET /api/slots?action=recurring-block-preview` as a read-only authenticated learner preview for an anchor booking. It returns the next 12 matching weekly candidates, skipped/unavailable reasons, server-side direct pricing, and same-instructor Lesson Credit sufficiency without holding slots or mutating credit.
- Added `POST /api/slots?action=recurring-block-commit` for the first credit-funded slice only. It rebuilds the preview server-side, requires all selected future slots to remain available, requires full same-instructor Lesson Credit, then atomically creates the confirmed recurring block, booked item rows, future bookings, BCS rows, and LCB decrement through the existing credit-funded booking transaction.
- Pending `held` recurring block items now block the availability feed, but this slice does not create bank-payment holds yet.
- Still untouched: Pay by Bank, Stripe/Klarna/card recurring block payment, partial credit, expiry cron, admin release, calendar hold display, and notification templates.

Stage 4 learner UI wiring - 2026-06-07:

- Turned the post-booking Reserved Weekly Slot prompt into a preview action for successful single Lesson Credit bookings.
- Added a compact recurring block preview modal on `/learner/book.html` that lets the learner choose 4-12 future weekly lessons, renders selected weeks and skipped/unavailable weeks from `recurring-block-preview`, and explains that unavailable weeks are skipped rather than stored.
- Wired `Confirm with Lesson Credit` to `recurring-block-commit` only when the authenticated preview says `can_commit` and the same-instructor Lesson Credit is sufficient.
- Paid-return prompts remain visible after `?paid=1`, but route learners to login/My Lessons because the return URL does not carry a reliable anchor booking ID in v1.
- Still untouched: Pay by Bank, Stripe/Klarna/card recurring block payment, partial credit, guest auto-login/claim, bank-payment holds, refunds, payouts, cancellation policy, and notification templates.

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

Stage 5 first slice - 2026-06-07:

- Added `docs/pricing-booking-stage-5-reserved-slot-policy-decision-record.md`.
- Confirmed representation: reserved weekly lessons stay ordinary `lesson_bookings` rows in the existing three-state lifecycle, identified by a same-school/same-instructor `recurring_slot_block_items.status='booked'` link to a confirmed `recurring_slot_blocks` parent.
- Chose policy visibility/admin handling for the 6-day move rule in v1, not automatic backend enforcement.
- Added reserved-slot read fields to `/api/slots?action=my-bookings`: `is_reserved_weekly_slot`, linked block/item IDs, move notice days, move request deadline, policy-open boolean, and `reserved_move_policy_mode='policy_visible_admin_override'`.
- Added My Lessons copy for confirmed reserved weekly slots so learners can see the 6-day move policy while cancellation credit returns still reference the existing 48-hour rule.
- Added contract tests for representation, movement policy visibility, cancellation timing non-regression, school scope, and instructor scope.
- Left cancellation, learner reschedule, refund, payout, Stripe, Pay by Bank, Klarna/card, BCS refund execution, credit-ledger mutation, and notification behaviour unchanged.

Stage 5 admin-goodwill move slice - 2026-06-07:

- Added `docs/pricing-booking-stage-5-admin-goodwill-move-decision-record.md`.
- Clarified that the 6-day move rule belongs to the Reserved Weekly Slot product, not to Pay by Bank itself.
- Clarified that ordinary one-off Pay As You Go checkout bookings keep the existing 48-hour cancellation rule only.
- Chose a real admin-only goodwill move mutation for under-6-day reserved weekly occurrences.
- Added `POST /api/admin?action=reserved-goodwill-move` for same-school, same-learner, same-instructor, same-lesson-type, same-duration goodwill moves.
- The admin action marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the original `recurring_slot_block_items` row, creates a replacement booked item, and copies BCS attribution when present.
- The admin action does not mutate learner-credit balances, Stripe refunds, refund ledgers, payout rows, Pay by Bank, Klarna/card payment flows, or notifications.

Stage 5 admin portal goodwill UI slice - 2026-06-08:

- Added confirmed Reserved Weekly Slot read metadata to `/api/admin?action=all-bookings` for admin display, including linked block/item IDs, 6-day move policy state, and under-6-day goodwill eligibility.
- The admin bookings list labels confirmed reserved weekly occurrences.
- Ordinary scheduled bookings keep the `Reschedule lesson` operator action. In that admin UI slice, reserved 6+ day occurrences showed disabled `Move reserved lesson` copy until the learner policy move slice landed.
- Under-6-day reserved occurrences expose an admin-only `Goodwill move` action and a small modal for replacement date, replacement start time, and audit-log reason.
- The modal posts only `{ booking_id, new_date, new_start_time, reason }` to `POST /api/admin?action=reserved-goodwill-move` and refreshes bookings after success.
- Left learner self-serve enforcement, refund, payment, payout, Stripe, BCS refund execution, learner-credit balance, and notification behaviour unchanged.

Stage 5 learner policy move slice - 2026-06-08:

- Added reserved-slot-specific `POST /api/slots?action=reserved-policy-move` for learner-authenticated 6+ day Reserved Weekly Slot occurrence moves.
- Kept ordinary one-off learner reschedules on the existing `POST /api/slots?action=reschedule` path.
- The generic learner reschedule path now refuses confirmed Reserved Weekly Slot occurrences so the 6-day rule cannot be bypassed through the old endpoint.
- Learner policy moves require same school, learner, instructor, lesson type, and duration, and require the replacement slot to be available.
- The learner action marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the old recurring item, creates a replacement `booked` recurring item, and copies BCS attribution.
- Under-6-day learner attempts return `RESERVED_MOVE_NOTICE_TOO_SHORT`.
- Learner My Lessons now labels ordinary bookings `Reschedule lesson`, eligible reserved 6+ day bookings `Move reserved lesson`, and reserved under-6-day bookings with policy/admin-goodwill copy and no self-serve move action.
- Left learner-credit balances, Stripe refunds, refund ledgers, payout rows, payment flows, Pay by Bank, Klarna/card recurring payments, and notifications unchanged.

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
2. What exact mechanism should scope payment method availability by product once Reserved Weekly Slot exists: Stripe Dashboard-only dynamic payment methods, Stripe `payment_method_configurations`, `excluded_payment_method_types`, or another configuration path?
3. Should Paid-In-Full Reward remain a separate later product once recurring weekly blocks support Lesson Credit and bank transfer / Pay by Bank, and what reward threshold/config should apply if it does?

Answered in `docs/pricing-booking-stage-4-recurring-block-decision-record.md`:

- Recurring weekly blocks should use a dedicated hold model, not ordinary `lesson_bookings`, 10-minute `slot_reservations`, or `lesson_offers`.
- Bank-payment recurring block holds expire after 48 hours; payment success confirms bookings, payment failure/expiry releases holds, and learner SMS/WhatsApp confirms success or failure.
- Recurring weekly blocks are post-booking future-only upsells using 4-12 future weekly lessons capped by matching availability inside the next 12 calendar weeks.
- Recurring weekly block v1 excludes Klarna and partial credit.

## Current Remaining Work

Last updated: 2026-06-08 after Stage 5 learner policy move.

### Next Recommended Slice

Stage 5's core policy loop is now closed for admin under-6-day goodwill moves and learner 6+ day policy moves. Before touching Stage 6 payments, do a short review pass only if operator/instructor notification copy is required for reserved-slot moves.

### Later Stage 5 Work

Still deferred:

- instructor approval workflow for goodwill moves, if needed
- notification copy for reserved-slot moves

### Stage 6 Work Not Started

Paid-In-Full Reward remains unimplemented.

Before implementation, verify and document:

- Stripe Pay by Bank availability for the account
- settlement timing
- Connect support
- original-method refund behaviour
- account-specific pricing
- the product-scoped payment-method configuration mechanism
- the configured reward threshold, if Paid-In-Full Reward remains separate from ordinary bank-funded recurring blocks

Do not add Pay by Bank, Klarna/card recurring block payment, payment holds, expiry cron, or payment notifications until those decisions are settled.

### Stage 7 Work Not Started

Tactical Offers remain unimplemented.

Before implementation, define offer types, scope them by school/instructor where relevant, snapshot discounted effective rates, and keep them separate from normal Lesson Credit.
