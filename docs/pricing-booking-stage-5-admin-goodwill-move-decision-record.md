# Stage 5 Admin Goodwill Move Decision Record

Date: 2026-06-07

Scope: Stage 5 of `docs/pricing-booking-roadmap.md`, after the reserved-slot policy read model in PR #276.

## Summary

Reserved weekly slot movement now uses the same notice window as cancellation:

- `48 hours` is the Reserved Weekly Slot move-permission rule.
- `48 hours` is also the existing booking cancellation, credit-return, and instructor-payment rule.

The move rule belongs to the Reserved Weekly Slot product, not to a payment method. It applies to confirmed bookings created from a reserved weekly block, whether the block was funded by Lesson Credit in the current implementation or by future Pay by Bank / bank-payment flows.

Ordinary Pay As You Go and other one-off self-serve checkout bookings keep the existing 48-hour cancellation/reschedule rule. They do not use the reserved-slot-specific move endpoint.

## Policy Decisions

### Learner Policy Move

If a confirmed reserved weekly lesson is 6 or more days away, the learner can move that occurrence to another available slot:

- same school
- same learner
- same instructor
- same lesson type
- same duration
- subject to availability

This encourages early movement because the original protected slot is released with enough time for another learner to book it.

Learner self-serve enforcement now uses `POST /api/slots?action=reserved-policy-move` for policy-compliant 48+ hour Reserved Weekly Slot moves. The generic learner reschedule action refuses reserved weekly occurrences so ordinary one-off reschedules keep their existing behaviour without becoming a reserved-slot policy bypass.

### Admin Goodwill Move

If a confirmed reserved weekly lesson is under 48 hours away, the booking remains committed unless an admin grants a goodwill move.

In v1, a goodwill move means:

- admin-only action
- same school, learner, instructor, lesson type, and duration
- one reserved weekly occurrence is moved to a replacement future slot
- the original booking row is terminated like a reschedule, using `status = refunded` and `credit_returned = TRUE`
- the replacement booking remains a normal `lesson_bookings.status = scheduled` row
- the original `recurring_slot_block_items` row is marked `released`
- a replacement `recurring_slot_block_items.status = booked` row is created for the moved lesson
- BCS attribution is copied from the old booking to the new booking when present
- no learner-credit balance mutation occurs
- no Stripe refund, BCS refund execution, refund-event ledger, or payout mutation occurs

This is a diary move, not a refund workflow.

### Why Replacement Item Rows

When one reserved occurrence moves, the original weekly protected slot has been given up. Keeping the original item pointed at the moved booking would make the block look as if the original weekly slot was still protected.

The chosen model is:

- old item: `status = released`, still tied to the original slot and old booking history
- new item: `status = booked`, tied to the replacement booking

This gives operators and future read models a clearer audit trail.

## UI And API Labels

Use these labels:

- Ordinary learner reschedule: `Reschedule lesson`
- Policy-compliant reserved move: `Move reserved lesson`
- Under-48-hour admin exception: `Goodwill move`

Use these machine/audit labels:

- `ordinary_reschedule`
- `reserved_policy_move`
- `reserved_goodwill_admin_move`

The first admin mutation endpoint is:

- `POST /api/admin?action=reserved-goodwill-move`

Request body:

- `booking_id`
- `new_date`
- `new_start_time`
- `reason`

The endpoint is intentionally reserved-slot-specific rather than a generic admin edit. That gives the audit log a clear operator intent and avoids making ordinary booking edits carry reserved-product policy meaning.

## Scope Preservation

The action must derive scope from authenticated admin context and existing rows:

- `school_id` comes from the admin JWT / superadmin scoped request
- `learner_id` comes from the original booking and confirmed block
- `instructor_id` comes from the original booking and confirmed block
- caller-supplied learner, instructor, school, price, credit, payment, refund, or payout fields are not trusted

The replacement booking must use the same instructor as the original reserved occurrence. Cross-instructor, cross-school, different-duration, and different-lesson-type moves are deferred.

## 48-Hour Rule

The 48-hour rule decides cancellation value and instructor payment:

- cancel 48 or more hours before the lesson: booking becomes `refunded`, eligible Lesson Credit returns, instructor is not paid for that booking
- cancel under 48 hours: booking stays `scheduled`, `credit_forfeited = TRUE`, cron later flips it to `chargeable`, instructor remains payable

The same 48-hour rule decides whether a reserved weekly occurrence can be moved through normal learner self-serve:

- 48 or more hours before the reserved lesson: learner policy move is allowed, subject to availability
- under 48 hours: no ordinary self-serve move; admin goodwill move only

This keeps the customer policy simple: move or cancel with at least 48 hours notice; under 48 hours, the lesson remains committed unless admin grants goodwill.

## Deferred

Deferred after automatic 48-hour learner enforcement:

- instructor-side goodwill approval tooling
- full learner request and approval workflow
- notification templates for reserved move request, approval, decline, and completion
- Pay by Bank, card, Klarna, and payment-method-specific recurring block behaviour
- payout eligibility changes
- automatic Stripe refunds
- BCS refund execution broadening
- cross-instructor, cross-school, different-duration, or different-lesson-type moves
- any dual-confirmation or "did the lesson happen?" prompts
