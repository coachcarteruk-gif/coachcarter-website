# Stage 5 Reserved Slot Policy Decision Record

Date: 2026-06-07

Scope: Stage 5 of `docs/pricing-booking-roadmap.md`

## Summary

Reserved weekly slots are represented as ordinary confirmed lesson bookings plus a recurring-block read-model link:

- `lesson_bookings.status = 'scheduled'`
- `recurring_slot_block_items.status = 'booked'`
- `recurring_slot_block_items.lesson_booking_id -> lesson_bookings.id`
- parent `recurring_slot_blocks.status = 'confirmed'`

This keeps the booking lifecycle at the existing three states only: `scheduled`, `chargeable`, and `refunded`.

Stage 5 started with policy visibility and read-model flags. The learner self-serve policy-move slice now enforces the 6-day rule through a reserved-slot-specific endpoint.

The follow-up admin-goodwill move decision and backend action are captured in `docs/pricing-booking-stage-5-admin-goodwill-move-decision-record.md`.

## First Slice Decision

The first safe implementation slice is:

- expose reserved-slot metadata on `/api/slots?action=my-bookings`
- show learner-facing policy visibility on My Lessons
- document that 6-day movement is policy/admin handling in v1
- leave cancellation, reschedule, refund, payout, Stripe, BCS refund execution, and credit-ledger mutation paths unchanged

This avoids accidentally weakening the load-bearing booking rule: instructors are paid for lessons on their calendar unless the learner gave 48h+ notice.

## Booking Representation

A booking is a reserved weekly slot when all of these are true:

- the booking belongs to the authenticated learner and school
- the booking is linked by a `recurring_slot_block_items.lesson_booking_id`
- the item is school-scoped and instructor-scoped to the same booking
- the item status is `booked`
- the parent block belongs to the same learner, instructor, and school
- the parent block status is `confirmed`

The linked booking remains a normal `lesson_bookings` row for availability, cancellation, reschedule, cron auto-complete, and payout read models.

## Move Policy

Starting policy:

- 6 or more days before the reserved lesson: learner may request a move, subject to availability
- under 6 days: the reserved lesson remains committed unless instructor/admin grants a goodwill move

First implementation mode:

- policy is visible through read-model fields and learner copy
- learner self-serve policy moves use `POST /api/slots?action=reserved-policy-move`
- the generic learner `reschedule` action refuses Reserved Weekly Slot occurrences so the 6-day rule cannot be bypassed
- under-6-day learner attempts return `RESERVED_MOVE_NOTICE_TOO_SHORT`
- no new booking status is introduced

The read model returns:

- `is_reserved_weekly_slot`
- `recurring_slot_block_id`
- `recurring_slot_block_item_id`
- `reserved_move_notice_days`
- `reserved_move_request_deadline`
- `reserved_move_policy_open`
- `reserved_move_policy_mode = 'policy_visible_admin_override'`

## Cancellation Policy

Reserved weekly slot cancellation still uses the existing learner cancellation rule:

- 48 or more hours before the lesson: booking becomes `refunded`, eligible Lesson Credit is returned, and BCS rows are marked refunded
- under 48 hours: booking stays `scheduled`, `credit_forfeited = TRUE`, and the hourly cron later flips it to `chargeable`

Stage 5 does not broaden automatic refunds and does not add new BCS refund execution.

## Non-Goals

The first Stage 5 slice did not implement:

- Pay by Bank
- Stripe, card, Apple Pay, or Klarna recurring block payment
- partial credit
- automatic 6-day move-rule enforcement
- admin release or admin move override tooling
- payout eligibility changes
- automatic Stripe refunds
- BCS refund execution broadening
- new booking statuses
- dual-confirmation or "did the lesson happen?" prompts

## Future Slices

The admin-goodwill backend slice answered the admin override design questions:

- under-6-day reserved moves are admin-only goodwill moves
- the admin action is reserved-slot-specific, not a generic edit label
- scope stays same school, learner, instructor, lesson type, and duration
- the original block item is marked `released`
- a replacement `booked` item is created for the moved occurrence
- BCS attribution is copied to the replacement booking when present
- Stripe, refunds, payout rows, learner-credit balances, and historical financial ledgers are not mutated

The learner policy-move slice answered the self-serve design questions:

- policy-compliant learner moves use a reserved-slot-specific action, not the generic reschedule mutation
- the replacement stays same school, learner, instructor, lesson type, and duration
- the old booking is marked `refunded` with `credit_returned = TRUE`
- the old recurring item is marked `released`
- a replacement recurring item is created as `booked`
- BCS attribution is copied to the replacement booking
- learner-credit balances, Stripe refunds, refund ledgers, payout rows, payment flows, and notifications are not mutated

Still deferred after learner policy moves:

- whether instructor goodwill approval tooling should exist
- how calendar and notification copy should distinguish a policy move from a normal reschedule

Any enforcement slice must use `api/_booking-status.js` constants in backend control flow and must include focused tests for school scope, instructor scope, cancellation timing, and payout/refund non-regression.
