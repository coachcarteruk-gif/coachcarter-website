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

CoachCarter should move toward two clear purchasing and booking products, one lesson-credit account mechanism, and one reserved-block bank payment layer.

### 1. Pay As You Go

Pay As You Go is the default low-commitment option.

- Sold at the learner's normal hourly rate.
- Payment methods should be immediate-confirmation methods only.
- No pending-payment or provisional-hold states.
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
- Learner chooses 4 to 12 future weekly lessons, capped by matching availability inside the next 12 calendar weeks.
- This should be more visible than it is today.
- The booking UI should prompt learners after a booking:
  - "Reserve this slot weekly"
  - "Keep this time weekly"
- Reserved slots should have clearer move/cancellation rules than ordinary flexible bookings.

Commercial role:

- Improves instructor diary stability.
- Helps learners form a consistent learning habit.
- Makes the real customer benefit clearer than "buy credits".
- Protects future instructor availability from casual speculative booking.

### 4. Bank-Funded Reserved Blocks

Bank-funded Reserved Weekly Slot blocks are the upfront payment path for learners who want a recurring weekly slot but do not have enough same-instructor Lesson Credit.

- Stripe Pay by Bank is the preferred route to investigate for v1.
- Pay by Bank should be available only for Reserved Weekly Slot blocks, not ordinary Pay As You Go bookings.
- The learner pays for the whole selected block upfront.
- No partial Lesson Credit plus bank payment in v1.
- No card, Apple Pay, or Klarna for Reserved Weekly Slot block payment in v1.
- No Paid-In-Full Reward discount in v1.
- The first version should aim to be self-serve from day one.
- A short 10-minute checkout hold may protect selected future slots while the learner completes bank payment.
- Any pending state exists only because the bank payment has not confirmed yet; it is not a long-running reservation feature.

Commercial role:

- Supports cashflow for marketing.
- Protects margin.
- Keeps the recurring-slot commitment clear without subsidising expensive payment methods.

Paid-In-Full Reward is deferred. If it returns later, the reward percentage must be configured rather than hardcoded, and it should be justified by measured payment cost and commercial benefit.

## Payment Framing

Avoid customer-facing wording like:

> Card fees cost us more, so you cannot use card here.

Prefer wording like:

> Reserve your weekly block with Lesson Credit or pay for the block upfront by bank payment.

This preserves the professional feel of online payments while keeping the product rule simple.

## Proposed Rules

### Standard Rate Rule

All Pay As You Go bookings and standard credit top-ups should use the learner's normal hourly rate.

The system should not trust client-submitted prices, discounts, payment method fees, or instructor scope.

### No Default Bulk Discount Rule

Buying more credit should not automatically create a discount.

Bulk value should be available only through explicit products or campaigns, such as:

- future paid-in-full reward, if deliberately reintroduced
- reserved weekly slot offer
- limited quiet-period offer
- admin-created special offer

### Payment Method Rule

Klarna should be removed from every checkout surface.

Pay As You Go should use payment methods that result in immediate payment confirmation, with no pending holds or async reservation states.

Reserved Weekly Slot blocks should use:

- full same-instructor Lesson Credit, where sufficient
- Pay by Bank for the whole selected block, where credit is insufficient

Reserved Weekly Slot block v1 should not offer card, Apple Pay, Klarna, or partial-credit split payment.

The implementation needs a deliberate product-scoped payment method configuration mechanism rather than an ad hoc change to every Stripe Checkout call.

### Booking Window Rule

Ordinary self-serve lesson purchases stay within the existing self-serve booking window.

Proposed starting policy:

- direct Pay As You Go lessons are purchased inside the ordinary self-serve booking window
- learner-facing credit purchases are removed from the preferred future customer model
- reserved weekly slot blocks are the intended path for learners who want to secure future slots beyond ordinary short-range booking

This avoids using credits as an open-ended claim on far-future diary capacity.

### Reserved Slot Move Rule

Reserved weekly slots should use the same clean notice window as ordinary learner cancellation and reschedule behaviour.

Starting policy:

- 48 or more hours notice: learner can move the reserved lesson, subject to availability
- under 48 hours notice: booking remains committed unless the instructor or admin offers a goodwill move
- Stage 5 now enforces this through reserved-slot-specific learner/admin move paths

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
- "I want this weekly slot and can pay for the block upfront" -> Reserved Weekly Slot by bank payment

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
- bank payment is for upfront reserved weekly blocks
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
  - Bank-Funded Reserved Blocks
- Draft customer-facing copy for each product.
- Draft admin/instructor explanation copy.
- Decide whether the first implementation will hide, disable, or reprice existing discounted credit packages.
- Confirm Lesson Credit as account value only, with self-serve learner credit purchases removed from the preferred future model.
- Confirm Paid-In-Full Reward as deferred from v1.

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
- Keep Pay As You Go on immediate-confirmation payment methods only.
- Remove Klarna from every checkout surface.
- Ensure future Reserved Weekly Slot block payment is product-scoped to Pay by Bank only, with no card/Klarna fallback in v1.
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

- Klarna removal still needs a focused implementation pass across all live Stripe checkout surfaces and any Stripe Dashboard/payment-method configuration that can expose Klarna.
- Future implementation needs a deliberate product-scoped payment method configuration mechanism, not an ad hoc change to today's direct Pay As You Go checkout.
- Pay by Bank eligibility, settlement timing, refund behaviour, platform-account support, and account-specific pricing remain open for Stage 6.

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
- Recurring blocks should use a dedicated hold model, support full same-instructor Lesson Credit or Pay by Bank, exclude partial credit, card, Apple Pay, and Klarna in v1, and create real bookings only after credit confirmation or bank-payment confirmation.
- Bank-payment holds should be short checkout holds, starting at 10 minutes, not a long-running reservation feature.

Stage 4 implementation foundation - 2026-06-07:

- Added dedicated `recurring_slot_blocks` and `recurring_slot_block_items` tables to `db/migration.sql`.
- Added `GET /api/slots?action=recurring-block-preview` as a read-only authenticated learner preview for an anchor booking. It returns the next 12 matching weekly candidates, skipped/unavailable reasons, server-side direct pricing, and same-instructor Lesson Credit sufficiency without holding slots or mutating credit.
- Added `POST /api/slots?action=recurring-block-commit` for the first credit-funded slice only. It rebuilds the preview server-side, requires all selected future slots to remain available, requires full same-instructor Lesson Credit, then atomically creates the confirmed recurring block, booked item rows, future bookings, BCS rows, and LCB decrement through the existing credit-funded booking transaction.
- Pending `held` recurring block items now block the availability feed, but this slice does not create bank-payment holds yet.
- Still untouched: Pay by Bank recurring block payment, Klarna removal, partial credit, 10-minute expiry/release handling, admin release, calendar hold display, and notification templates.

Stage 4 learner UI wiring - 2026-06-07:

- Turned the post-booking Reserved Weekly Slot prompt into a preview action for successful single Lesson Credit bookings.
- Added a compact recurring block preview modal on `/learner/book.html` that lets the learner choose 4-12 future weekly lessons, renders selected weeks and skipped/unavailable weeks from `recurring-block-preview`, and explains that unavailable weeks are skipped rather than stored.
- Wired `Confirm with Lesson Credit` to `recurring-block-commit` only when the authenticated preview says `can_commit` and the same-instructor Lesson Credit is sufficient.
- Paid-return prompts remain visible after `?paid=1`, but route learners to login/My Lessons because the return URL does not carry a reliable anchor booking ID in v1.
- Still untouched: Pay by Bank recurring block payment, Klarna removal, partial credit, guest auto-login/claim, 10-minute bank-payment holds, refunds, payouts, cancellation policy, and notification templates.

### Stage 5: Reserved Slot Policy Enforcement

Goal: protect instructor calendars when learners reserve future weekly slots.

Tasks:

- Define how reserved weekly slots are represented in the existing booking model.
- Decide whether the reserved move rule is enforced automatically, shown as policy, or handled by admin override in the first version.
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
- Chose policy visibility/admin handling for the reserved move rule in v1, not automatic backend enforcement.
- Added reserved-slot read fields to `/api/slots?action=my-bookings`: `is_reserved_weekly_slot`, linked block/item IDs, 48-hour move notice metadata, move request deadline, policy-open boolean, and `reserved_move_policy_mode='policy_visible_admin_override'`.
- Added My Lessons copy for confirmed reserved weekly slots so learners can see the move policy while cancellation credit returns still reference the existing 48-hour rule.
- Added contract tests for representation, movement policy visibility, cancellation timing non-regression, school scope, and instructor scope.
- Left cancellation, learner reschedule, refund, payout, Stripe, Pay by Bank, Klarna/card, BCS refund execution, credit-ledger mutation, and notification behaviour unchanged.

Stage 5 admin-goodwill move slice - 2026-06-07:

- Added `docs/pricing-booking-stage-5-admin-goodwill-move-decision-record.md`.
- Clarified that the move rule belongs to the Reserved Weekly Slot product, not to Pay by Bank itself.
- Clarified that ordinary one-off Pay As You Go checkout bookings keep the existing 48-hour cancellation rule only.
- Chose a real admin-only goodwill move mutation for under-48-hour reserved weekly occurrences.
- Added `POST /api/admin?action=reserved-goodwill-move` for same-school, same-learner, same-instructor, same-lesson-type, same-duration goodwill moves.
- The admin action marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the original `recurring_slot_block_items` row, creates a replacement booked item, and copies BCS attribution when present.
- The admin action does not mutate learner-credit balances, Stripe refunds, refund ledgers, payout rows, Pay by Bank, Klarna/card payment flows, or notifications.

Stage 5 admin portal goodwill UI slice - 2026-06-08:

- Added confirmed Reserved Weekly Slot read metadata to `/api/admin?action=all-bookings` for admin display, including linked block/item IDs, 48-hour move policy state, and under-48-hour goodwill eligibility.
- The admin bookings list labels confirmed reserved weekly occurrences.
- Ordinary scheduled bookings keep the `Reschedule lesson` operator action. In that admin UI slice, reserved 48+ hour occurrences showed disabled `Move reserved lesson` copy until the learner policy move slice landed.
- Under-48-hour reserved occurrences expose an admin-only `Goodwill move` action and a small modal for replacement date, replacement start time, and audit-log reason.
- The modal posts only `{ booking_id, new_date, new_start_time, reason }` to `POST /api/admin?action=reserved-goodwill-move` and refreshes bookings after success.
- Left learner self-serve enforcement, refund, payment, payout, Stripe, BCS refund execution, learner-credit balance, and notification behaviour unchanged.

Stage 5 learner policy move slice - 2026-06-08:

- Added reserved-slot-specific `POST /api/slots?action=reserved-policy-move` for learner-authenticated 48+ hour Reserved Weekly Slot occurrence moves.
- Kept ordinary one-off learner reschedules on the existing `POST /api/slots?action=reschedule` path.
- The generic learner reschedule path now refuses confirmed Reserved Weekly Slot occurrences so reserved moves stay on the reserved-slot-specific endpoint.
- Learner policy moves require same school, learner, instructor, lesson type, and duration, and require the replacement slot to be available.
- The learner action marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the old recurring item, creates a replacement `booked` recurring item, and copies BCS attribution.
- Under-48-hour learner attempts return `RESERVED_MOVE_NOTICE_TOO_SHORT`.
- Learner My Lessons now labels ordinary bookings `Reschedule lesson`, eligible reserved 48+ hour bookings `Move reserved lesson`, and reserved under-48-hour bookings with policy/admin-goodwill copy and no self-serve move action.
- Left learner-credit balances, Stripe refunds, refund ledgers, payout rows, payment flows, Pay by Bank, Klarna/card recurring payments, and notifications unchanged.

### Stage 6: Bank-Funded Reserved Blocks And Klarna Removal

Goal: add the self-serve bank-payment path for Reserved Weekly Slot blocks while removing Klarna and avoiding new pending states on ordinary Pay As You Go bookings.

Tasks:

- Remove Klarna from every checkout surface and any Stripe configuration that can expose Klarna to CoachCarter learners.
- Keep ordinary Pay As You Go bookings on immediate-confirmation payment methods only.
- Verify Stripe Pay by Bank account availability, settlement timing, refund behaviour, platform-account support, and account-specific pricing.
- Define the product-scoped Stripe configuration mechanism for Reserved Weekly Slot Pay by Bank checkout.
- Implement Pay by Bank only for Reserved Weekly Slot blocks where same-instructor Lesson Credit is insufficient.
- Require the learner to pay for the whole selected block upfront.
- Exclude card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment in v1.
- Create a 10-minute pending recurring-block hold when bank checkout starts, and block those selected slots from availability during the hold.
- Confirm the block only after Stripe reports successful payment.
- Release holds and show the correct learner-facing message when checkout expires, payment fails, or the selected slots are no longer available.
- Decide whether eligible 48h+ cancellation value for bank-paid blocks returns as Lesson Credit by default, becomes an operator cash-refund workflow, or uses a hybrid policy.
- Ensure audit logging for admin release/failure/recovery mutations.
- Ensure financial records remain consistent and tenant-scoped.
- Leave Paid-In-Full Reward discounting out of v1.

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

1. What is the verified Stripe Pay by Bank settlement timing, refund behaviour, platform-account availability, and account-specific pricing?
2. What exact mechanism should scope payment method availability by product once Reserved Weekly Slot Pay by Bank exists: Stripe Dashboard-only dynamic payment methods, Stripe `payment_method_configurations`, `excluded_payment_method_types`, or another configuration path?
3. What is the minimum v1 notification/copy set for bank-payment success, failure, and expiry?

Answered in `docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md`:

- Klarna should be removed completely from CoachCarter checkout surfaces.
- Stripe Pay by Bank test-mode Checkout success/failure probes passed on 2026-06-09.
- Pay by Bank belongs only to Reserved Weekly Slot blocks, not ordinary Pay As You Go.
- Pay As You Go should keep immediate-confirmation payment methods only, with no pending-payment or provisional-hold state.
- Reserved Weekly Slot bank payment is whole-block upfront only.
- Reserved Weekly Slot bank payment v1 excludes card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment.
- Paid-In-Full Reward discounting is deferred from v1.
- Bank-payment checkout holds should start with a 10-minute window.
- Eligible 48h+ cancellation value for bank-paid reserved blocks should return as same-instructor Lesson Credit by default.

Answered in `docs/pricing-booking-stage-4-recurring-block-decision-record.md`:

- Recurring weekly blocks should use a dedicated hold model, not ordinary `lesson_bookings`, 10-minute `slot_reservations`, or `lesson_offers`.
- Bank-payment recurring block holds should start with a 10-minute checkout window; payment success confirms bookings, payment failure/expiry releases holds, and the learner sees the correct success/failure/expiry message.
- Recurring weekly blocks are post-booking future-only upsells using 4-12 future weekly lessons capped by matching availability inside the next 12 calendar weeks.
- Recurring weekly block v1 excludes Klarna, card, Apple Pay, and partial credit.
- Paid-In-Full Reward is deferred from v1.
- Pay by Bank belongs only to Reserved Weekly Slot blocks, not ordinary Pay As You Go.
- Pending payment state is due only to bank payment confirmation, not a reservation feature.

## Current Remaining Work

Last updated: 2026-06-09 after Stage 6B learner bank checkout UI wiring.

### Next Recommended Slice

Stage 5's core policy loop is closed for admin under-48-hour goodwill moves and learner 48+ hour policy moves.

Stage 6's bank-funded Reserved Weekly Slot path now has the backend hold, webhook conversion/release, learner return status, stale-hold cleanup, and learner checkout UI wiring. Klarna has been removed from Stripe payment-method configuration outside code.

Stage 6 decision record now exists. Earlier implementation slices covered:

- Stage 6A: Stripe configuration changed outside code so Klarna is no longer offered.
- Stage 6B: reserved-block bank checkout, webhook conversion/release, learner return status, stale-hold cleanup, and learner checkout UI wiring.

Stage 6B1 implementation foundation - 2026-06-09:

- Added `POST /api/slots?action=recurring-block-bank-checkout`.
- Requires learner auth and same-school scope.
- Rebuilds the recurring-block preview server-side and requires selected future slots to remain available.
- Rejects bank checkout when same-instructor Lesson Credit is sufficient.
- Creates a `pending_payment` recurring block and `held` block items with a 10-minute expiry.
- Creates whole-block Stripe Checkout using `STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION`.
- Stores Stripe refs on the block where available.
- Left webhook conversion/release, notifications, eligible 48h+ bank-paid cancellation-to-credit policy, and expiry cron for later slices.

Stage 6B2 webhook conversion/release - 2026-06-09:

- `api/webhook.js` now recognises `metadata.payment_type = 'recurring_block_bank_checkout'`.
- Paid Checkout/PaymentIntent success converts a `pending_payment` bank block into `confirmed`, converts held items into booked items, and creates `scheduled` `lesson_bookings`.
- The conversion is idempotent for webhook retries and does not mutate `learner_credit_balances`, write BCS rows, or create credit purchase rows.
- Payment failure and Checkout expiry release held items only while the block is still `pending_payment`; failure after success does not release confirmed bookings.
- If a paid block cannot be converted because selected slots are no longer available, the hold is released with manual-review metadata and no automatic Stripe refund is attempted.

Stage 6B3 learner-facing bank status and stale-hold cleanup - 2026-06-09:

- Added `GET /api/slots?action=recurring-block-status&block_id=...` for learner-authenticated Reserved Weekly Slot bank checkout returns.
- The endpoint scopes by authenticated `learner_id` and `school_id`, returns block status/funding method/selected lesson count/expiry/safe Stripe refs, and returns confirmed booking IDs/dates alongside item dates for confirmed blocks.
- The endpoint opportunistically expires stale `pending_payment` bank blocks where `expires_at <= NOW()` and releases their held items idempotently before returning status.
- `/learner/book.html` now handles `?reserved_bank_checkout=1&block_id=...` and `?reserved_bank_cancelled=1&block_id=...`, sending logged-out learners through existing learner login redirect and showing compact confirmed/pending/failed/expired/released copy in the weekly-block modal.
- This slice does not mutate `learner_credit_balances`, write BCS rows, create credit purchase rows, create bookings during cleanup, trigger Stripe refunds, broaden payout/refund semantics, or add notifications.

Stage 6B4 learner bank checkout UI wiring - 2026-06-09:

- The recurring block preview modal now starts `POST /api/slots?action=recurring-block-bank-checkout` when the selected weekly block is available but same-instructor Lesson Credit is insufficient.
- The existing `Confirm with Lesson Credit` button remains for sufficient-credit blocks; insufficient-credit blocks switch the action to upfront bank checkout and rely on the server to revalidate availability, price, learner scope, school scope, and credit insufficiency before creating a hold.
- The modal redirects to Stripe Checkout only after the API returns a Checkout URL. Slot holds, conversion, failure release, return status, and stale-hold cleanup remain server-side.
- Klarna was removed from Stripe payment-method configuration by the operator on 2026-06-09; learner-facing booking copy should not present Klarna as available.

### Later Stage 5 Work

Still deferred:

- instructor approval workflow for goodwill moves, if needed
- notification copy for reserved-slot moves

### Stage 6 Remaining Work

Bank-funded Reserved Weekly Slot checkout, webhook conversion, learner return status, stale-hold cleanup, and learner checkout UI wiring are implemented. Remaining Stage 6 work:

- Stripe Pay by Bank production configuration, account-specific pricing, and refund behaviour
- original-method refund behaviour
- account-specific pricing
- whether expiry/release needs a cron or whether webhook/opportunistic cleanup is enough
- the learner-facing messages for expiry, payment failure, and lost availability

Do not add expiry cron, payment notifications, automatic Stripe refunds, payout changes, or bank-paid cancellation-to-credit policy until those decisions are settled.

Paid-In-Full Reward remains deferred from v1. Card, Apple Pay, Klarna, and partial-credit split payment remain excluded from Reserved Weekly Slot block payment v1.

### Stage 7 Work Not Started

Tactical Offers remain unimplemented.

Before implementation, define offer types, scope them by school/instructor where relevant, snapshot discounted effective rates, and keep them separate from normal Lesson Credit.
