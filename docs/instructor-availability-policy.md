# Instructor availability policy

21 September 2026 — implemented on `codex/enforce-instructor-availability`, pending deployment.

## Booking rules

The complete lesson must fit one recurring or date-specific available window.
A lesson cannot span a gap between windows. Explicit date-specific availability
may open a blackout date, matching the existing learner booking policy. Busy
blocks and connected-calendar events still block that time.

Instructor-created cash, credit and free bookings, fixed offers,
broadcast offers, instructor edits and newly requested extensions return
`409 SCHEDULE_UNAVAILABLE` for schedule conflicts. Legacy `availability_override`
and `force` inputs do not bypass these checks. Upcoming admin time edits use the
same guard; retrospective corrections retain their existing policy.

Instructor-created Flexible Hours bookings have one exception (23 September
2026): an outside-normal-hours warning returns `409 NORMAL_HOURS_OVERRIDE_REQUIRED`
and a `normal_hours_override_token`. The booking screen explains the exception
and asks the instructor to confirm. Cancel leaves the lesson unbooked; confirm
resubmits the same lesson with that token. The token binds the school, instructor,
learner, date, full time range, lesson type and transmission. A changed proposal
requires fresh confirmation. All schedule checks run again on the retry; busy
blocks, blackouts and external events cannot be bypassed. Normal availability is
not edited, and package funding still uses the existing transaction.

For other intentional exceptions, the instructor first adds one-off availability
from their calendar or changes weekly hours. A conflicting busy block must be
removed or adjusted separately.

## Existing lessons and availability changes

Reducing weekly hours, adding blackout dates, or removing a one-off window checks
future bookings in the authenticated instructor's school. Only lessons newly
uncovered by the change require review; an unrelated pre-existing exception does
not prevent adding more hours. One-off coverage and transmission are considered.

The server returns `AVAILABILITY_BOOKING_CONFLICTS`, the affected lessons and an
`availability_conflict_token`. The client lists dates, times and learner names
and explains that lessons stay booked. Confirmation resubmits the proposal with
that token. A changed proposal or conflict list requires another review. Declining
leaves the proposed edits unsaved. No lesson is automatically moved or cancelled.

Weekly/blackout replacement and the associated audit entry commit together;
an insertion or audit failure rolls back the replacement. Removing a one-off
window is also audited atomically. The token is an acknowledgement fingerprint,
not an authentication credential; normal cookie authentication and school scoping
remain mandatory.

## Evidence and payment boundaries

Instructor time edits store the old/new date, start/end, lesson type and
transmission together with instructor identity and any admin impersonation.
The booking update and audit entry commit together. Flexible Hours creation
explicitly records `created_by='instructor'` on the instructor route; the learner
route retains `learner`. Existing creator labels and historic override audits
are not rewritten.

No schema migration is required. Existing bookings, in-flight payment settlement,
credit minutes, FIFO attribution, refunds and payouts retain their contracts.
This change governs new instructor scheduling actions, not retrospective
revalidation or cancellation of already agreed lessons/offers.

## Verification

64 focused Playwright tests passed across availability enforcement, one-off
availability, schedule checks, weekly transmission, busy blocks, payment links
and extension contracts (including browser rendering of extension pages).
New route tests cover all payment types, old override fields, valid one-off
bookings, blocking events, instructor/admin edits, offer creation, extensions,
audit failure rollback, creator persistence and conflict-review tokens.
Database calls in the new route tests are mocked; no live learner booking or
payment is created by this verification.
