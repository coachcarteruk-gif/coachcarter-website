# Delivered lesson duration corrections

Implementation: 27 September 2026. Migration 073 applied to production at
21:51:15 UTC; application rollout follows the feature PR merge.

Recovery snapshot: `snap-wispy-flower-aboq9lsq` on production branch
`br-summer-silence-abcpp6vw`. The authoritative runner recorded checksum
`e6cdd933d4f6fae4e29b5884e69d8a2d13eb9eea7eb6ea950ad28dda0b3daef0`.
Postflight confirmed the validated return-reason constraint and no pending
numbered migrations. No lesson, credit balance or payment was changed by rollout.

Admins use the existing **Edit lesson / Edit details** lesson-type selector to
record a different delivered length. A 90-minute credit/package lesson corrected
to 60 minutes remains the same booking and returns 30 minutes to the learner's
original funding. It does not cancel/rebook the lesson or issue a cash refund.

## Eligibility

- Authenticated admin and booking in the selected school, or the authenticated
  instructor correcting their own same-school lesson.
- Both original and corrected lesson ends are in the past, using the school
  timezone. Past `scheduled` bookings awaiting the completion cron are eligible;
  their status is preserved.
- Lesson Credit or Flexible Hours funding reconciles exactly to the original
  booked duration and frozen value. Flexible lengths use whole 30-minute units.
- No cancellation, forfeiture or previously returned credit.
- No payout line, school payout line, manual settlement, booking earning or
  launch earning claim. Paid-out changes require a separate settlement process.
- Longer lessons need available credit for the same instructor, or available
  school-wide Flexible Hours. Another instructor's credit cannot be spent.
- Free extensions where elapsed duration differs from funded minutes, and
  historical funding mismatches, require separate review. This flow must not
  silently turn free time into chargeable time.

## Accounting

The correction uses one interactive transaction. It takes the instructor and
booking advisory locks used by controlled payout/settlement operations, locks
the learner and booking, rechecks the submitted/original duration and current
booking snapshot, then locks the affected balance/sources. Claimed bookings are
rejected before funding writes. Existing overlap protections remain applicable.

For Lesson Credit, active BCS values are retained oldest-first when shortening.
Only the final retained source is split, using the shared integer-pence allocator
for its contribution and processing fee. Lengthening draws additional minutes
with the existing FIFO planner. The original BCS rows are retired with
`refunded_at`; replacement rows preserve the source, rate, fee and absorber.
LCB changes by the duration difference. No `edit_adjustment` credit transaction
is inserted: returning the original source already restores the entitlement.
The aggregate learner shadow continues to follow the existing LCB trigger.

Flexible Hours returns each original allocation exactly once and appends the
retained/replacement allocations with the original source/rate/value. Increases
draw only the extra units. No ordinary Lesson Credit table is changed. The
source-balance view accounts for the append-only returns and new allocations.

Booking duration, lesson type, frozen value, other submitted details, extension
offer cancellation and `admin.correct_delivered_duration` audit commit together.
The audit records before/after details and retired/replacement allocation IDs.
Any error rolls the transaction back. Pending extension Checkout sessions are
expired after commit using the existing awaited helper. Past corrections send
no lesson-moved notification.

## Rollout and validation

Apply migration 073 before deploying the app. It adds one Flexible allocation
return reason and does not edit any booking, credit balance or payment record.
Existing migrations 063, 064 and 068 provide allocation history, active BCS
uniqueness and exact remaining-value accounting.

Tests use isolated PGlite PostgreSQL with the real Flexible allocation/return
triggers and replacement-history migrations. They cover shorter/longer lessons,
source/fee conservation, both funding models, tenant/instructor isolation,
insufficient credit, stale retries, school-timezone boundaries, payout claims,
mixed funding, and full rollback on audit failure. A route test exercises the
actual admin edit handler; a browser test exercises the actual editor functions
and modal markup. The combined focused suite passed 87 tests. Production changes
are limited to migration 073; no production financial or Stripe mutation was
performed during verification.

## Instructor access (28 September 2026)

The instructor calendar's completed lesson details now offer **Edit lesson
length** for Lesson Credit and Flexible Hours bookings before payout. The
editor keeps the date, start time and transmission fixed, shows the hours to
return/use, and submits the original elapsed duration for stale-edit protection.
Past scheduled lessons awaiting the completion cron can use the same control.

`POST /api/instructor?action=correct-delivered-duration` requires the normal
cookie/CSRF instructor authentication and a positive integer `booking_id`,
`lesson_type_id` and `expected_duration_minutes`. School and instructor scope
come exclusively from authentication. Ownership is checked both when loading
the booking and inside the shared correction transaction. The endpoint ignores
client date, time, identity and override fields; corrections cannot bypass
overlaps or move a lesson. All funding and payout guards above still apply.

The required `instructor.correct_delivered_duration` audit records the instructor
and any admin support impersonation. Ordinary instructor IDs are never written
as admin IDs. No lesson-moved notification is sent for this historical change.
Upcoming edits retain the existing editor and availability rules. Cash/free
and other unsupported funding remain outside this source-backed correction flow.
No additional migration is needed beyond the existing correction prerequisites.
