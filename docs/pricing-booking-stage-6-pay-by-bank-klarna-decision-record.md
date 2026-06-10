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
- If an eligible 48h+ cancellation happens on a bank-paid reserved block, v1 returns value as same-instructor Lesson Credit by default.
- Cash or original-payment-method refunds remain admin/operator exceptions, not learner self-serve or automatic Stripe refunds.
- If a Stripe original-method refund fails, cannot be funded from the Stripe balance, cannot return to the original method, or is otherwise blocked, the approved refund is handled manually by bank transfer as the last resort and recorded through `POST /api/admin?action=record-manual-bank-refund` with evidence/reference and operator notes.

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
- production Pay by Bank payment-method configuration is confirmed for the real CoachCarter Stripe account as of 2026-06-10
- original-payment-method refund behaviour is confirmed from the real CoachCarter Stripe Dashboard as of 2026-06-10

## Live Stripe Dashboard Confirmation

Confirmed in the CoachCarter live Stripe Dashboard on 2026-06-10:

- Pay by Bank is enabled on the account.
- Pay by Bank payment confirmation is immediate.
- Pay by Bank recurring payments are not supported.
- Pay by Bank refund support is enabled.
- Pay by Bank dispute support is not available.
- Pay by Bank transaction amounts are GBP 0.50 to GBP 10,000.
- Pay by Bank presentment currencies shown are EUR and GBP.
- The default Payment Method Configuration keeps Pay by Bank disabled, so ordinary Pay As You Go Checkout should not inherit Pay by Bank from the default config.
- The default Payment Method Configuration has Klarna disabled.
- The reserved product configuration is named `Reserved Weekly Slot`.
- The reserved product configuration ID is `pmc_1TggYZIqhTSdZedSRi8AgRVd`.
- The `Reserved Weekly Slot` configuration has Pay by Bank enabled.
- The `Reserved Weekly Slot` configuration has Cards, Apple Pay, Google Pay, PayPal, Klarna, and all other payment methods disabled.
- Pay by Bank pricing is shown as 0.5% + 20p per successful charge, capped at GBP 5.00, with +1.5% for international transactions and +2% if currency conversion is required.
- Stripe Dashboard says partial refunds can return part of a payment to the customer.
- Stripe Dashboard says refunds normally take 5-10 days to appear on the customer's account.
- Stripe Dashboard says Stripe's processing fees from the original transaction are not returned.
- Stripe Dashboard says up to 30 partial refunds can be created for each payment.
- Stripe Dashboard says refunds go back to the original payment method only, not to a different card or bank account.

Remaining Stripe production facts:

- None before launch. The remaining work is real-world monitoring after launch.

## Local Test Status

Pay by Bank was tested from this workspace on 2026-06-09 after local `.env.local` was switched to a test-mode `STRIPE_SECRET_KEY`.

No live Stripe API call was made.

The isolated probe created two GBP `mode='payment'` Checkout Sessions with one-time line items and `payment_method_types=['pay_by_bank']`. This was a manual test-mode probe only; the production CoachCarter Checkout creators still rely on dynamic payment methods until Stage 6 implementation chooses the product-scoped configuration mechanism.

Success probe:

- Checkout Session: `cs_test_a1IvzJAiS2pfmumW6PemFUL3AgiaW9cRJQ7x0obwNzdkhMlTZVZlpjXcZ5`
- Checkout Session status: `complete`
- Checkout Session payment status: `paid`
- PaymentIntent: `pi_3TgJNCIqhTSdZedS06SwcQS0`
- PaymentIntent status: `succeeded`
- Payment method type: `pay_by_bank`
- Charge status: `succeeded`

Observed success events:

- `payment_intent.created`
- `payment_intent.requires_action`
- `payment_intent.succeeded`
- `charge.succeeded`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Failure probe:

- Checkout Session: `cs_test_a1ToQ8MtaHDJFa0gExCPQoSTtR1DRcOgRmgCKH5zKbrDlovU1U8k5MT4lA`
- Checkout Session status: `open`
- Checkout Session payment status: `unpaid`
- PaymentIntent: `pi_3TgJOQIqhTSdZedS2Wnms6pf`
- PaymentIntent status: `requires_payment_method`
- Payment method type: `pay_by_bank`
- Charge status: `failed`

Observed failure events:

- `payment_intent.created`
- `payment_intent.requires_action`
- `payment_intent.payment_failed`
- `charge.failed`

Implementation implications:

- Treat `checkout.session.completed` with `payment_status='paid'` and `checkout.session.async_payment_succeeded` as idempotent success signals for bank-funded reserved blocks.
- Treat `payment_intent.payment_failed` / `charge.failed` as failure signals that should release held recurring-block items and mark the block failed when the event can be tied to a reserved block.
- Keep the existing unpaid-session guard; rename its stale Klarna-specific comment to generic async-payment language during implementation.

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

## Current Checkout Surface Audit And Config Contract

Live Checkout Session creators after the Stage 6B implementation:

- `api/slots.js?action=checkout-slot` for authenticated Pay As You Go single-slot checkout
- `api/slots.js?action=checkout-slot-guest` for guest Pay As You Go single-slot checkout
- `api/slots.js?action=recurring-block-bank-checkout` for Reserved Weekly Slot whole-block Pay by Bank checkout
- `api/offers.js` for instructor-created lesson offers

Dormant or compatibility payment surfaces:

- `api/credits.js?action=checkout` is behind the retired Lesson Credit purchase guard
- `api/credits.js?action=create-payment-intent` is behind the retired Lesson Credit purchase guard
- webhook compatibility code still handles already-created historical credit purchase sessions and PaymentIntents

Current code observations:

- live Checkout creation omits `payment_method_types`
- Pay As You Go and offer Checkout Sessions stay on the shared dynamic-payment-method path with `excluded_payment_method_types` limited to Klarna
- Reserved Weekly Slot bank checkout is the only path that calls `getReservedBlockBankCheckoutPaymentOptions()` and reads `STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION`
- `STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION` is a product-scoped contract: the referenced Stripe Payment Method Configuration must be Pay by Bank-only for this product
- Pay As You Go Checkout and offer Checkout must not use the reserved-block bank payment-method configuration
- card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment remain excluded from Reserved Weekly Slot bank checkout v1
- the current code excludes Klarna locally, and card/Apple Pay/wallet exclusion for the reserved bank product is enforced by the confirmed live `Reserved Weekly Slot` Payment Method Configuration
- the webhook guard that ignores unpaid Checkout completion events should stay async-payment-method generic, not Klarna-specific

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

## Bank-Paid Cancellation And Refund Policy

Confirmed bank-funded Reserved Weekly Slot occurrences are normal `lesson_bookings` rows with `payment_method='bank_payment'`, `created_by='recurring_block_bank_checkout'`, and `minutes_deducted` set to the lesson duration. The existing learner cancellation rule therefore applies:

- 48 or more hours' notice marks the booking `refunded`, sets `credit_returned = TRUE`, and returns the lesson duration to `learner_credit_balances` for the same learner, instructor, and school.
- Under 48 hours' notice leaves the booking payable through the existing `scheduled` -> `chargeable` lifecycle and sets `credit_forfeited = TRUE`.

This is the v1 product policy for bank-paid Reserved Weekly Slot cancellation value. The learner gets same-instructor Lesson Credit by default, so they can rebook with the same instructor without creating an automatic cash movement.

Cash or original-payment-method refunds are exceptions for the admin/operator refund workflow. They should use the existing refund-preview/execute/manual-bank-recording guardrails where applicable, including original-method return where possible and payment-provider fee treatment. The preferred cash path is an approved original-method Stripe refund when the preview/execution guardrails allow it. If Stripe refund execution fails, cannot be funded from the Stripe balance, cannot return to the original payment method, or is otherwise blocked, the operator completes the approved refund manually by bank transfer as the last resort and records it through `POST /api/admin?action=record-manual-bank-refund`.

Manual bank recording must preserve the bank reference, supporting evidence/reference, and concise operator notes. It remains a ledger-only operator path after the bank transfer has been completed outside Stripe; it does not call Stripe, does not mutate booking status, does not edit payout rows, does not create credit-source adjustments, and does not mutate learner credit balances.

This Stage 6 slice does not approve a learner self-serve cash refund, automatic Stripe refund on cancellation, BCS refund execution broadening, payout reversal, or platform-balance semantic change.

All Stripe production facts needed before launch are now documented. The remaining production work is real-world monitoring of learner return/status states and refund-operations outcomes after launch.

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
