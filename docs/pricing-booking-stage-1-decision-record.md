# Pricing And Booking Model Decision Record

Status: accepted for planning
Date: 2026-06-05
Scope: Stage 1 of `docs/pricing-booking-roadmap.md`

Superseded note, 2026-06-09: later Stage 6 decisions removed Klarna from the future checkout model, deferred Paid-In-Full Reward from v1, and chose whole-block Pay by Bank only for bank-funded Reserved Weekly Slot blocks. Historical Klarna and Paid-In-Full Reward references below describe the Stage 1 planning position, not the current implementation direction.

## Context

CoachCarter needs a clearer lesson purchasing model before any payment, booking, credit, refund, or payout code changes are made.

The current commercial risk is that discounted credit packages, card payments, and Klarna can combine in ways that make the most attractive customer offer one of the weakest margin outcomes. The intended direction is to keep purchasing flexible while making discounts deliberate, justified, and easy to explain.

This decision record does not approve production implementation. It creates the business rules and customer-facing language needed before engineering begins.

## Decision

CoachCarter will organise lesson purchasing around two customer-facing purchasing/booking products, one lesson-credit mechanism, and one payment reward layer:

- Pay As You Go
- Reserved Weekly Slot
- Lesson Credit
- Paid-In-Full Reward

Pay As You Go and Reserved Weekly Slot describe what the learner is buying or reserving. Lesson Credit describes lesson value already held on the learner account. Paid-In-Full Reward describes how the learner pays and why they may receive the best-value offer.

CoachCarter will not offer self-serve learner credit purchases as the preferred future model. Learners purchase lessons directly inside the ordinary self-serve booking window. Existing purchased credit remains honoured and usable through the current credit balance and ledger system. Future lesson credit may also come from reschedules, eligible cancellations, instructor cancellations, goodwill, and admin adjustments.

Credits will be positioned as account value, not a self-serve purchasing product or default discount mechanism. Pay As You Go and Reserved Weekly Slot purchases will use the learner's normal rate unless an explicit configured reward or offer applies. The normal rate must be calculated server-side from the existing pricing fallback: learner/instructor custom rate, then instructor hourly rate, then school default rate.

Discounts or rewards should only appear where the learner gives the business something commercially valuable in return, such as upfront cleared payment, predictable weekly attendance, reduced diary uncertainty, or a deliberate campaign response.

Card and Klarna can remain standard-rate convenience payment options. The best-value offer will be framed as a reward for paid-in-full commitment, not as a surcharge or penalty for using flexible online payment methods.

## Non-Implementation Guardrails

Stage 1 does not change:

- production payment logic
- Stripe or Klarna configuration
- credit ledger behaviour
- booking, refund, cancellation, or payout behaviour
- database migrations
- commercial numbers in code

Future implementation must preserve the existing per-instructor credit model. Spendable learner credit is the learner/instructor/school scoped balance, not the legacy aggregate display balance.

Future implementation must also preserve the current booking and cancellation principles, including the rule that instructors are paid for lessons on their calendar unless the learner gave 48h+ notice.

## Customer-Facing Names And Short Descriptions

| Name | Type | Canonical short description |
|---|---|---|
| Pay As You Go | Booking/payment product | Book one lesson at your standard rate, with no upfront commitment. |
| Reserved Weekly Slot | Booking product | Keep the same instructor, day, and time for a block of weekly lessons. |
| Lesson Credit | Account mechanism | Lesson value already on your account from previous purchases, eligible changes, cancellations, or adjustments. |
| Paid-In-Full Reward | Payment reward layer | Get the best value when you commit upfront and pay in full. |

## Customer-Facing Copy

### Pay As You Go

Pay As You Go is the simplest way to book a lesson when you want flexibility.

Book the slot that suits you, pay your standard lesson rate, and choose from the available payment options at checkout. There is no bulk commitment and no need to top up credit first.

Use this when:

- you want one lesson at a time
- your schedule changes week to week
- you are trying CoachCarter for the first time

Suggested button labels:

- Book a lesson
- Pay as you go

### Lesson Credit

Lesson Credit is lesson value already held on the learner account.

Existing purchased lesson credit remains available to use as normal. Future lesson credit may appear when a lesson is rescheduled, cancelled with eligible notice, cancelled by the instructor, or adjusted by the team.

Use this when:

- you already have lesson credit on your account
- a lesson change creates eligible lesson credit
- the team adds goodwill or an admin adjustment

Suggested button labels:

- Use lesson credit
- View lesson credit

### Reserved Weekly Slot

Reserved Weekly Slot is for learners who want consistency.

Choose the same instructor, day, and time for a block of weekly lessons, subject to availability. It helps you build a steady learning rhythm and gives your instructor a clearer diary.

Recommended reschedule policy prompt:

> Need to move your next reserved lesson? Your next booking is {slot_details}. You can request a move until {last_move_day_and_time}. After that, this slot is committed, but your instructor may still offer a goodwill move if they can.

Policy-page wording:

> Reserved weekly lessons can be moved with at least 48 hours notice, subject to instructor availability. Inside 48 hours, the booking is committed unless your instructor or admin offers a goodwill move.

Use this when:

- you want the same weekly lesson time
- you are learning regularly
- you want to protect a good slot before it is booked by someone else

Suggested button labels:

- Reserve weekly slot
- Keep this time weekly

### Paid-In-Full Reward

Paid-In-Full Reward is the best-value payment option for learners who are ready to commit upfront.

Pay in full for an agreed lesson plan or reserved weekly block and receive the available paid-in-full reward. Flexible card and Klarna options can remain available at the standard rate for eligible weekly blocks, while the best value is reserved for upfront commitment.

Recommended starting reward: 3% off the full standard price of the reserved weekly block when the learner pays upfront through the approved lower-cost route. The Klarna/card comparison price remains the learner's normal hourly rate multiplied by the number and duration of weekly lessons in the block. The 3% reward must be configuration, not a hardcoded production constant.

Use this when:

- you know you are ready to commit
- you want the best available value
- you are happy to arrange payment upfront

Suggested button labels:

- Ask about paid-in-full
- Choose best value

## Admin And Instructor Explanation Copy

### One-Line Explanation

Standard lessons are standard price; lesson credit is honoured value already held on the account; reserved weekly slots protect a regular time; paid-in-full is the reward layer for learners who pay upfront.

### Admin Explanation

The model separates convenience from discounting.

Pay As You Go is the standard flexible route inside the ordinary self-serve booking window. Lesson Credit is not a new self-serve purchase product; it is value already held on the learner account from previous purchases, eligible lesson changes, cancellations, goodwill, or admin adjustments. Reserved Weekly Slot is the main booking commitment product because it gives the learner a routine and gives the instructor a more predictable diary. Paid-In-Full Reward is the best-value payment layer because the learner gives the business upfront commitment and lower payment uncertainty.

Avoid explaining the model as a card or Klarna fee issue. Use positive framing:

> Pay flexibly at the standard rate, or choose the paid-in-full option for the best value.

### Instructor Explanation

This model protects the instructor diary and avoids hidden discounting.

Learners can still book flexibly and pay online. Lesson Credit becomes an account mechanism for existing purchased balances, rescheduling, cancellation returns, instructor cancellations, goodwill, and admin adjustments. Discounts and rewards should be attached to meaningful commitment, such as paying in full or reserving a recurring weekly slot.

Credits remain tied to the learner, instructor, and school. A learner's credit with one instructor should not become a hidden claim on another instructor's time.

Reserved weekly slots should be presented as the serious-learner route because they reduce speculative long-range booking and make the instructor's future calendar more reliable.

## Recommendation: Existing Discounted Credit Packages

Recommendation: hide existing discounted credit packages from new learner-facing purchase journeys when Stage 2 begins, while leaving existing purchased credit balances and historical ledger rows unchanged.

Rationale:

- Hidden is safer than repricing because it avoids changing amounts before the server-side implementation and tests are ready.
- Hidden is cleaner than disabled because learners are not shown an attractive option they cannot complete.
- Hidden is safer than leaving packages unchanged because continuing to promote discounted credit packages keeps reinforcing the model this roadmap is trying to replace.
- Existing purchased credit must remain honoured according to current ledger and booking rules.

Implementation note for later stages: hiding the learner-facing packages should not delete package configuration, mutate historical `credit_transactions`, mutate `learner_credit_balances`, or alter `booking_credit_sources` / `credit_source_adjustments`.

Operational transition copy:

> Existing lesson credit remains available to use as normal. New lessons are purchased directly when you book. Lesson credit may still appear when lessons are rescheduled, cancelled with eligible notice, cancelled by your instructor, or adjusted by the team.

## Recommendation: Paid-In-Full Reward Launch Mode

Recommendation: launch Paid-In-Full Reward as self-serve from day one, provided Pay by Bank confirmation, provisional booking holds, and customer/instructor notifications can be implemented safely.

Rationale:

- The product is clearer if the learner can choose Reserved Weekly Slot, compare standard flexible payment with Paid-In-Full Reward, and complete the journey without admin negotiation.
- Pay by Bank should provide an in-system confirmation path for paid-in-full purchases.
- The instructor's existing booking buffer means a short payment-pending window should not create ordinary same-day operational surprise.
- A self-serve launch still needs careful guardrails: provisional holds, follow-up confirmation messaging, expiry/failure handling, and no accidental change to refund, cancellation, payout, or credit ledger behaviour.

First-version customer copy:

> Want the best value? Choose Pay by Bank and get the paid-in-full reward. Your weekly lessons will be provisionally booked while payment is pending, then confirmed as soon as payment is complete.

First-version admin/instructor process wording:

> Paid-In-Full Reward should be self-serve when Pay by Bank confirmation is reliable. Admins and instructors should see the reserved weekly block as provisionally booked until payment succeeds. If payment fails or times out, the provisional block should expire or require admin follow-up.

Preferred payment route for later implementation: Stripe Pay by Bank, if available and commercially suitable on the connected account. Stripe documentation describes Pay by Bank as a customer-initiated, single-use bank payment method for UK and European customers. It supports Checkout, Connect, and full or partial refunds, but does not support recurring payments. Stripe's UK local payment method pricing lists Pay by Bank at 0.5% + 20p per successful charge, capped at 5 GBP, with additional fees possible for international transactions or currency conversion. Account-specific pricing and availability must still be verified in Stripe before implementation.

Paid-in-full confirmation model:

> When a learner chooses Paid-In-Full Reward by Pay by Bank, the weekly block should be pencilled in while payment is pending. Customer-facing copy should describe this as "payment pending". The block should only become confirmed once Stripe reports the Pay by Bank payment as successful. If payment fails or times out, the pending hold should expire or require admin follow-up.

Provisional notification copy:

Learner SMS:

> Your weekly lessons are provisionally booked for {slot_summary}. Payment is pending. We will text again when your booking is confirmed.

Instructor SMS:

> Provisional weekly booking: {learner_name}, {slot_summary}. Payment is pending. We will text again when payment is confirmed.

Confirmation SMS:

> Payment confirmed. Your weekly lessons are now booked for {slot_summary}.

Implementation note for later stages: the "pencilled in" state should be designed carefully so it does not accidentally broaden booking, refund, cancellation, payout, or `lesson_bookings.status` semantics. It may need a separate reservation/hold model or metadata rather than a new booking lifecycle status.

## Implementation-Ready Rules For Future Stages

- Pay As You Go uses the learner's normal rate and no automatic discount.
- Self-serve learner bookings stay within the existing 4-week self-serve booking window unless an explicitly approved route already allows otherwise.
- Self-serve learner credit purchases should be removed from the preferred future customer model.
- Existing purchased credits must remain honoured and usable through the current credit balance and ledger system.
- Future Lesson Credit is for existing balances, reschedules, eligible cancellation returns, instructor cancellations, goodwill, and admin adjustments.
- Reserved Weekly Slot is the primary commitment journey.
- Reserved Weekly Slot should require upfront payment for the repeated weekly block.
- Reserved Weekly Slot movement should require at least 48 hours notice as visible policy first, matching the existing cancellation and value-return rule.
- Stage 5 now enforces the 48-hour Reserved Weekly Slot move rule through the reserved-slot-specific learner move endpoint. Instructors and admins can choose to offer goodwill rescheduling inside the 48-hour window.
- Paid-In-Full Reward is the primary best-value payment layer, not a separate booking type.
- Paid-In-Full Reward should start as a configurable 3% reward against the full standard price of the reserved weekly block.
- Card and Klarna language should describe standard flexible payment, not a penalty.
- Klarna should be limited to Reserved Weekly Slot blocks that go beyond the ordinary self-serve booking window, subject to later Stripe configuration review.
- Paid-In-Full Reward should be offered as a better-margin alternative to Klarna where the customer pays upfront in a lower-cost route.
- Paid-In-Full Reward by Pay by Bank should use a payment-pending hold before confirmation. Customer-facing status can say "payment pending"; internal implementation must avoid changing the existing three-state booking lifecycle without explicit later scope.
- Commercial numbers belong in admin-editable config, DB columns, JSONB, or admin-managed tables, not hardcoded production constants.
- Old discounted credit packages should be hidden from new learner-facing purchase journeys during the transition, while existing credit and ledgers remain unchanged.
- The first Paid-In-Full Reward version should aim to be self-serve from day one, with provisional booking/payment-pending handling.

## Stage 1 Review Decisions

The following decisions were added after reviewing the first decision record draft:

- Standard self-serve lesson purchases should stay inside the existing 4-week booking window.
- CoachCarter should remove self-serve learner credit purchases from the preferred future customer model. Lessons inside the 4-week window are bought directly, and Lesson Credit is used for existing purchased balances, rescheduling, eligible cancellations, instructor cancellations, goodwill, and admin adjustments.
- Reserved Weekly Slot should require upfront payment for the repeated weekly block.
- Reserved Weekly Slot movement should require at least 48 hours notice. Stage 5 now enforces this through the reserved-slot-specific learner move endpoint, while instructors and admins can choose to offer goodwill rescheduling inside the 48-hour window.
- Klarna should be available only for regular weekly reserved slot purchases that stretch beyond the ordinary self-serve booking window, not every standard-rate purchase type. This is the eligibility rule unless later implementation discovers a Stripe/product constraint that requires a narrower rule.
- Paid-In-Full Reward should sit beside Reserved Weekly Slot as the best-value upfront alternative. The recommended starting reward is 3% off the full standard block price, configured rather than hardcoded, so the customer benefits and CoachCarter keeps better margin than a Klarna-funded block.
- Tactical offers should be configured per school, with instructor-level opt-in.
- Stripe Pay by Bank is the preferred lower-cost in-system payment route to investigate for Paid-In-Full Reward. It should be used if it can be set up so paid-in-full payments are reliably tracked in Stripe and reconciled in CoachCarter. Public Stripe UK pricing lists Pay by Bank at 0.5% + 20p per successful charge, capped at 5 GBP, but account-specific pricing, settlement timing, refund behaviour, and Connect/account availability must be verified before implementation.
- Paid-In-Full Reward should aim to be self-serve from day one. Purchases should be shown to the customer as "payment pending" until Pay by Bank succeeds. The reserved weekly slots can be provisionally booked during that pending period, with learner and instructor SMS explaining that a follow-up confirmation will be sent once payment is confirmed.

## Remaining Open Decisions

The following decisions are intentionally left for later implementation stages:

1. What is the verified Stripe Pay by Bank settlement timing, refund behaviour, and Connect/account availability for CoachCarter's actual account?
2. What exact reservation or hold model should represent "provisionally booked / payment pending" without changing booking, refund, cancellation, or payout semantics?
3. What timeout or follow-up rule should apply if a Pay by Bank payment remains pending or fails after the weekly block has been provisionally booked?
