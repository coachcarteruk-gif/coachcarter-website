# Stage 6 Pay by Bank And Klarna Decision Record

Date: 2026-06-09

Scope: Stage 6 of `docs/pricing-booking-roadmap.md`

## Summary

Stage 6 should add the bank-funded path for Reserved Weekly Slot blocks and remove Klarna from the Stripe integration.

Current product decisions:

- Klarna should be removed completely from CoachCarter checkout surfaces.
- Pay by Bank should be used only for Reserved Weekly Slot blocks, not ordinary Pay As You Go bookings.
- Pay As You Go should keep immediate-confirmation payment methods only, with no pending-payment or provisional-hold state.
- Reserved Weekly Slot bank payment is whole-block upfront only.
- Reserved Weekly Slot bank payment v1 excludes card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment.
- Paid-In-Full Reward discounting is deferred from v1.
- Bank-payment checkout holds should start with a 10-minute window.
- If an eligible 48h+ cancellation happens on a bank-paid reserved block, the simplest v1 policy is to return value as same-instructor Lesson Credit.

## Stripe Pay By Bank Facts To Verify

Stripe documentation says Pay by Bank is a single-use payment method where the customer authenticates with their bank app or web portal, then returns to the site.

Compatibility notes to verify against the live CoachCarter account before implementation:

- supported business location includes Great Britain / United Kingdom
- supported presentment currency includes GBP
- Checkout payment mode is supported
- subscription/setup mode is not supported
- one-time line items are required
- test mode can simulate both successful authorization and failed authentication from the Checkout page
- refunds and partial refunds are supported
- dispute support is not available
- Stripe says Connect support is available, but CoachCarter should still test against its own account/platform setup

## Local Test Status

Pay by Bank was not tested from this workspace on 2026-06-09 because local `.env.local` contains a live-mode `STRIPE_SECRET_KEY`. No live Stripe API call was made.

Safe local test requirement:

- use a test-mode key only, preferably a restricted test key with permission to create Checkout Sessions
- do not print the key in terminal output
- create a GBP `mode='payment'` Checkout Session with one-time line items
- include Pay by Bank through the chosen product-scoped method configuration, or through a temporary isolated manual test outside production code
- open the returned test Checkout URL
- select Pay by Bank
- run both Stripe test outcomes:
  - authorize test payment
  - fail test payment
- confirm the resulting Checkout Session / PaymentIntent statuses and webhook event sequence

Do not test Pay by Bank with the live key, and do not add a test key to git.

## Current Checkout Surface Audit

Live Checkout Session creators:

- `api/slots.js?action=checkout-slot` for authenticated Pay As You Go single-slot checkout
- `api/slots.js?action=checkout-slot-guest` for guest Pay As You Go single-slot checkout
- `api/offers.js` for instructor-created lesson offers

Dormant or compatibility payment surfaces:

- `api/credits.js?action=checkout` is behind the retired Lesson Credit purchase guard
- `api/credits.js?action=create-payment-intent` is behind the retired Lesson Credit purchase guard
- webhook compatibility code still handles already-created historical credit purchase sessions and PaymentIntents

Current code observations:

- live Checkout creation currently omits `payment_method_types`
- payment method visibility is therefore mainly controlled by Stripe dynamic payment methods / Dashboard settings unless Stage 6 adds product-scoped configuration
- removing Klarna from production likely requires Stripe Dashboard/payment-method configuration changes, plus local stale copy/comment cleanup
- the webhook guard that ignores unpaid Checkout completion events should stay, but its comment should become async-payment-method generic rather than Klarna-specific

## Implementation Direction

Stage 6 should be split into small slices.

### Stage 6A: Klarna Removal And Pay By Bank Test Harness

- Remove or disable Klarna in Stripe Dashboard / payment-method configuration.
- Remove learner-facing Klarna copy from retired/read-only surfaces.
- Rename stale Klarna-specific webhook comments to generic async payment language.
- Add a safe test-mode Pay by Bank probe path or script that refuses live keys.
- Run the Pay by Bank Checkout success and failure paths with a test key.

### Stage 6B: Reserved Block Bank Checkout

- Add a reserved-block-specific bank checkout action.
- Require same-school authenticated learner scope.
- Rebuild selected recurring block preview server-side.
- Require whole-block payment.
- Create `pending_payment` block and `held` items with a 10-minute expiry.
- Block selected slots from availability during the hold.
- Create Stripe Checkout only for the held block.
- Store Stripe session/payment identifiers on the block.
- Do not create normal `lesson_bookings` rows until payment success.

### Stage 6C: Payment Success, Failure, And Expiry

- On Stripe payment success, convert held items into confirmed bookings.
- Copy BCS attribution consistently with credit-funded recurring blocks.
- On payment failure or checkout expiry, release held items and mark the block failed/expired.
- Add idempotent handling so webhook retries cannot double-book or double-release.
- Add learner-facing success, failure, expired, and lost-availability messages.
- Decide whether an opportunistic cleanup is enough for 10-minute expiry or whether a scheduled job is needed.

### Stage 6D: Cancellation Value For Bank-Paid Blocks

- For eligible 48h+ cancellation of a bank-paid reserved occurrence, return Lesson Credit to the learner/instructor balance by default.
- Keep cash refunds as an admin/operator exception workflow, not automatic learner self-serve in v1.
- Do not broaden Stripe refund execution or refund ledgers without a separate explicit implementation slice.

## Non-Goals

Stage 6 does not approve:

- card, Apple Pay, or Klarna payment for Reserved Weekly Slot blocks
- partial Lesson Credit plus bank payment
- Paid-In-Full Reward discounting
- Pay by Bank for ordinary Pay As You Go bookings
- long-running reservation holds
- new booking statuses outside the existing three-state booking lifecycle
- automatic Stripe refunds for bank-paid cancellations
- payout eligibility changes
- BCS refund execution broadening
- dual-confirmation or "did the lesson happen?" prompts
