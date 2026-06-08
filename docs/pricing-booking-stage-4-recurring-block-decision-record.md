# Recurring Weekly Block Decision Record

Date: 2026-06-06

Scope: Stage 4 follow-up decisions for `docs/pricing-booking-roadmap.md`

This record captures the product and engineering contract for the recurring weekly slot flow discussed after the Stage 4 visibility prompt. It is a decision record, not an implementation plan. Future implementation should still follow the high-risk production guardrails in `CLAUDE.md`, `PROJECT.md`, `docs/booking-statuses.md`, and `docs/per-instructor-credits-audit.md` before touching booking, payment, refund, credit, or payout paths.

## Summary

Single lessons stay simple. A learner first books one ordinary lesson through the existing single-slot flow. After a successful one-off booking, the product offers a recurring weekly block upsell using the same instructor, day, time, lesson type, and duration as the anchor slot.

The recurring block is future-only. It does not include the already-booked one-off lesson. The learner chooses 4 to 12 future weekly lessons, capped by matching availability inside the next 12 calendar weeks.

Recurring blocks can be confirmed in two ways:

- If the learner has enough same-instructor Lesson Credit for the full selected block, the block is booked immediately and credit is deducted immediately.
- If the learner does not have enough same-instructor Lesson Credit, the selected future slots are held for a short checkout window, starting at 10 minutes, while Pay by Bank payment starts and confirms.

No partial credit is supported in v1. No Klarna, card, or Apple Pay checkout is supported for recurring blocks in v1.

## Naming

Use learner-facing language around weekly lesson blocks rather than calendar-week blocks.

Preferred copy:

- "weekly lesson block"
- "4 weekly lessons"
- "Reserve this same weekly slot"
- "Same instructor, same day, same time"

Avoid copy that implies a fixed calendar span when skipped unavailable weeks may appear:

- "6-week block"
- "book the next 6 weeks"

## Entry Points

The recurring block upsell should appear after any successful one-off booking:

- logged-in card / Apple Pay single-slot checkout return
- guest single-slot checkout return
- logged-in Lesson Credit single-booking success

Existing repeat or multi-week booking flows should not show the upsell after success because the learner has already chosen a recurring pattern.

## Guest Learners

Guest checkout already creates or reuses a `learner_users` row before Stripe checkout and stores `learner_id` in Stripe metadata. However, the returning guest browser is not automatically authenticated after payment.

For v1:

- Guests may see the recurring block upsell after successful one-off checkout.
- Guests must sign in or set a password before reserving a recurring block.
- Use the existing learner login / check-account / set-password path.
- Do not add a new post-Stripe auto-login or session-claim flow in v1.

## Block Size And Availability Window

Recurring blocks are future-only and limited to the next 12 calendar weeks.

Rules:

- The learner may choose 4 to 12 future weekly lessons.
- The actual maximum purchasable count is capped by matching available slots inside the 12-week window.
- The anchor one-off lesson provides the pattern but is not counted in the recurring block.
- The first candidate future date is the next matching week after the anchor lesson.
- Unavailable weeks are shown in preview as skipped/unavailable.
- Skipped unavailable weeks are not stored as block items because they are already unavailable for another reason.

Example:

If a learner chooses 5 future weekly lessons but every other matching week is unavailable, the 5 lessons may stretch across about 10 calendar weeks. The preview must show the skipped weeks clearly before the learner commits.

## Preview And Commit Behaviour

Preview is read-only.

The system must not hold future recurring slots merely because the learner opened the preview or changed the selected count. Holds/bookings are created only when the learner commits.

At commit time, the server revalidates all selected available future slots.

Commit behaviour is all-or-nothing for the selected available slots:

- If every selected slot is still available, book or hold all selected slots.
- If any selected slot is no longer available, book or hold none.
- The learner should see a refreshed preview and choose again.

## Payment And Credit

Recurring blocks support two payment outcomes.

### Lesson Credit

If the learner has enough same-instructor Lesson Credit to cover the full selected recurring block:

- create the recurring block record
- create all selected bookings immediately
- deduct the full required same-instructor Lesson Credit immediately
- do not create a bank-payment checkout hold

Credit must be all-or-nothing in v1. Do not support partial credit plus bank payment.

Credit is same-instructor only. Aggregate/display `learner_users.balance_minutes` must not be treated as spendable recurring-block credit.

### Bank Payment

If the learner does not have enough same-instructor Lesson Credit:

- create the recurring block record
- create held item rows for each selected future slot
- block those slots from availability
- start Pay by Bank payment
- hold slots for a 10-minute checkout window while payment starts and confirms

Outcomes:

- Payment confirms before expiry: convert held items into confirmed bookings.
- Payment fails: release holds.
- Payment remains unconfirmed at checkout expiry: expire the block and release holds.

No Klarna, card, or Apple Pay for recurring blocks in v1.

## Pricing

Recurring block pricing should follow the same server-side pricing fallback as direct single-slot checkout:

1. learner/instructor custom hourly rate from `instructor_learner_notes.custom_hourly_rate_pence`
2. instructor hourly rate from `instructors.hourly_rate_pence`
3. school default from `schools.config.pricing.bulk_hourly_pence`
4. existing hard fallback only if no school/default lesson-type pricing exists

The recurring block must snapshot the server-side per-lesson price at block creation / payment start. The client must never submit or control prices.

Because the recurring block uses the same instructor, lesson type, duration, and pattern as the anchor one-off booking, the price should normally match the one-off lesson price the learner just paid. If the anchor booking has a reliable `list_price_pence`, implementation may use it as the pricing snapshot source; otherwise recalculate via the existing server-side direct pricing helper.

## Dedicated Data Model

Recurring weekly blocks should use a dedicated data model, separate from:

- ordinary `lesson_bookings`
- existing 10-minute `slot_reservations`
- instructor-created `lesson_offers`

Reason: pending recurring-block holds have their own lifecycle and should not be treated as paid bookings, ordinary single-slot checkout reservations, or instructor-created offers.

Recommended shape:

- `recurring_slot_blocks`
- `recurring_slot_block_items`

The block row stores the learner, instructor, school, lesson type, status, price snapshot, payment references, expiry, and metadata.

The item rows store only the future slots being held or booked.

Do not store skipped unavailable weeks as item rows.

## Statuses

Recommended block statuses:

- `pending_payment`
- `confirmed`
- `payment_failed`
- `expired`
- `released`

Recommended item statuses:

- `held`
- `booked`
- `released`

Bookings should be created only when:

- credit-funded recurring block confirms immediately, or
- bank-funded recurring block payment confirms.

Pending bank-payment holds must block availability but must not be normal `lesson_bookings` rows.

## Calendar Display

Pending bank-payment holds should appear in instructor and admin calendar/schedule views as visually distinct holds, not normal bookings.

They should:

- block availability
- show the learner name
- show a label such as "Pending weekly block"
- show the hold expiry time
- be visibly different from confirmed bookings

Admin may manually release pending holds. Instructors may see pending holds but must not manually release them in v1.

## Notifications

Stage 6 should confirm the minimum v1 notification and on-screen copy set before implementation. The notes below are the earlier product expectation, not approval to add payment notifications without that decision pass.

### Hold Start

When a bank-payment recurring block starts:

- show an on-screen confirmation that selected future slots are held during the 10-minute checkout window
- do not send SMS
- do not send email

### Confirmed Recurring Block

For both credit-funded and bank-funded confirmed recurring blocks:

- send learner SMS / WhatsApp success confirmation
- send learner block-level confirmation email listing all confirmed dates
- send instructor block-level confirmation email listing all confirmed dates

Do not send one email per lesson in the block.

### Payment Failure Or Expiry

For bank-payment failure or checkout expiry:

- release holds
- send learner SMS / WhatsApp failure or expiry confirmation
- do not send email in v1

## Implementation Status

Foundation slice added 2026-06-07:

- `recurring_slot_blocks` and `recurring_slot_block_items` are now defined in `db/migration.sql`.
- `GET /api/slots?action=recurring-block-preview` is a read-only authenticated learner endpoint for anchor-booking previews. It stores no rows and holds no slots.
- `POST /api/slots?action=recurring-block-commit` implements only the full same-instructor Lesson Credit path. It revalidates selected slots, rejects insufficient credit without partial-credit fallback, and uses the existing credit-funded booking transaction so block creation, future bookings, BCS attribution, and LCB decrement succeed or roll back together.
- `held` recurring block items are treated as availability blockers, preparing for a later bank-payment hold slice.

Not implemented yet: Pay by Bank, Klarna removal, partial credit, expiry/failure release, admin manual release, calendar hold display, and block-level notification templates.

## Open Follow-Up Questions

The decisions above settle the core v1 product contract. Follow-up implementation still needs to specify:

- exact database schema, constraints, and indexes
- exact Stripe/Pay by Bank implementation surface and webhook events
- exact cron, scheduled job, or opportunistic cleanup that expires 10-minute checkout holds
- exact admin release endpoint and audit log event
- exact calendar read-model changes for pending holds
- exact notification templates
- focused tests around school scope, instructor scope, credit sufficiency, all-or-nothing commit, expiry, payment success, payment failure, and admin release

Payment Method Guardrail, Paid-In-Full Reward, Klarna removal, and Pay by Bank commercial configuration remain outside this Stage 4 decision record unless explicitly pulled into a later implementation stage.
