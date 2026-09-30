# Instructor availability policy

21 September 2026 — implemented on `codex/enforce-instructor-availability`, pending deployment.

## Booking rules

Without an explicitly confirmed exception below, the complete lesson must fit
one recurring or date-specific available window.
A lesson cannot span a gap between windows. Explicit date-specific availability
may open a blackout date, matching the existing learner booking policy. Connected
calendar events remain blocking. Busy blocks require explicit review below.

30 September 2026 — prepared on `codex/instructor-availability-override`, pending
migration and deployment. New instructor-created cash, credit, free and Flexible
Hours bookings, fixed offers (including pencilled offers) and manual broadcasts
may override normal hours and busy blocks after explicit confirmation. The server
returns `409 SCHEDULE_OVERRIDE_REQUIRED`, warnings with the busy-block times and
`schedule_override_token`. The client shows the date/time and conflict, and asks
whether to book or send anyway. Cancel leaves everything unsaved and sends no
notifications. The exact proposal is retried only after confirmation.

The token binds the authenticated school/instructor, action, recipients, date,
full time range, lesson type and relevant payment/price/transmission options,
plus the exact conflicting busy-block identities and times. Changed details or
blocks require fresh review. Normal availability and busy blocks remain intact.
Blackouts, connected-calendar events, existing lessons, pending requests/offers,
checkout reservations and recurring holds remain blocking. Broadcast siblings
may share the same full slot, preserving their first-to-accept contract.
Legacy `availability_override` and `force` never grant an override.

Credit and Flexible Hours transactions recheck busy-block snapshots before
funding. Pencilled offers persist those snapshots in
`lesson_offers.busy_block_overrides`; their creation transaction, database guard
and payment fulfilment honour only the exact acknowledged blocks. New or changed
blocks remain blocking. Migration `075_instructor_busy_block_overrides.sql` is
required before deploying this application change. It adds an empty-default JSON
snapshot and replaces the existing pencilled guard without changing its other
conflict rules. Historical offers are not granted an exception. No production
migration or deployment was performed by this task. The separately developed
booking-pilot migration also uses 075 locally; reconcile migration numbering and
guard changes if these independent branches are combined.

Instructor time edits and upcoming admin time edits retain their existing
`409 SCHEDULE_UNAVAILABLE` policy. Historical corrections are unchanged.

Lesson extension requests retain their normal-hours-only warning and confirmation
(`NORMAL_HOURS_OVERRIDE_REQUIRED` and `normal_hours_override_token`) for
exceptions, including paid, free and Flexible Hours extensions. The acknowledgement
binds the original booking, date, old/new finish, added minutes, funding method and
explicit price to the authenticated school/instructor. Real clashes are checked
before offering confirmation and again on retry. Cancelling sends no request.
The learner must still accept the extension; Flexible Hours acceptance honours the
instructor-agreed hours while rechecking busy blocks, blackouts, external events
and occupied time. Funding, pricing and payment settlement are unchanged.

For exceptions outside the new-booking and fixed-offer paths, the instructor
first adjusts availability or the conflicting block.

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

The new pencilled busy-block snapshot requires migration 075. Existing bookings, in-flight payment settlement,
credit minutes, FIFO attribution, refunds and payouts retain their contracts.
This change governs new instructor scheduling actions, not retrospective
revalidation or cancellation of already agreed lessons/offers.

## Verification

30 September 2026: 117 focused checks passed across booking/offer routes,
confirmation and cancellation in Chromium, pricing, pencilled Checkout retries,
signed webhook routing and fulfilment, and availability rules. The new embedded
PostgreSQL test executes migration 075 twice, the real creation guard and
payment-time conflict SQL. It covers exact busy-block snapshots, changed/new
blocks, school isolation and non-overridable occupied time. It is a
single-connection test, not a concurrency certification. Syntax, encoding and
migration-manifest checks passed. No live bookings, messages or payments were
created. The booking-pilot checkout and server were left untouched.

Historical 21 September verification:

64 focused Playwright tests passed across availability enforcement, one-off
availability, schedule checks, weekly transmission, busy blocks, payment links
and extension contracts (including browser rendering of extension pages).
New route tests cover all payment types, old override fields, valid one-off
bookings, blocking events, instructor/admin edits, offer creation, extensions,
audit failure rollback, creator persistence and conflict-review tokens.
Database calls in the new route tests are mocked; no live learner booking or
payment is created by this verification.
