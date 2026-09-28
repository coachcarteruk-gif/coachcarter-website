# Flexible Hours weekly booking investigation

Date: 28 September 2026. The initial investigation below describes main before the fix. Following approval, the dedicated Flexible Hours weekly path was implemented on `codex/flexible-weekly-bookings`. The subsequent authorised rollout and verification are recorded in [rollout evidence](flexible-weekly-rollout.md). Source line references below refer to the investigated revision.

Implementation and rollout: [Flexible Hours weekly booking](flexible-hours-packages-runbook.md#weekly-booking-28-september-2026).

The learner's reported limitation is supported by the code. Flexible Hours work for single lessons, but neither learner weekly-booking flow consumes the Flexible Hours ledger. This is a missing integration, not evidence that the learner's package balance has disappeared. The specific learner, deployed revision, live balance and school's retirement flag were not inspected.

## Current weekly mechanisms

| Flow | Entry and dates | Funding and persistence |
| --- | --- | --- |
| Repeat while booking | Booking modal; currently exposes 2, 3 or 4 lessons, including the selected lesson. API accepts up to 8. Same weekday/time, instructor and duration; consecutive weeks, without skipping conflicts. Instructor booking window and platform 84-day ceiling apply. | `POST /api/slots?action=book`, `repeat_weeks`; ordinary Lesson Credit creates separate bookings with a common `series_id`, source attribution and one atomic balance deduction. Free-booking mode is a separate existing branch. Flexible Hours are explicitly refused. |
| Reserve this same weekly slot | Upsell after a successful single booking. Uses that booking as an anchor; chooses 4–12 additional lessons, excluding the anchor. Scans the next 12 weekly dates after the anchor and skips unavailable weeks. | `recurring-block-preview`, `recurring-block-commit`, or `recurring-block-bank-checkout`. Uses `recurring_slot_blocks` plus items linked to ordinary lesson bookings. Full same-instructor Lesson Credit, or a new whole-block bank payment. No partial funding. |
| Instructor repeating offer | An instructor can historically offer a fixed slot with a repeat ceiling; learner acceptance fans out the series. | Separate `api/offers.js` flow. It is not a package-hours booking mechanism or a recommended workaround. Creation is also subject to product retirement. |

The first two learner flows are finite batches booked now, not subscriptions or an engine that automatically adds another lesson each week.

The reserved-block preview is read-only. It checks existing bookings, checkout reservations, offers, lesson requests, recurring holds, busy blocks and active availability. Confirmation rebuilds the preview and the credit transaction checks conflicts again before creating the full block. Insufficient credit or a detected conflict prevents the transaction from completing.

Bank confirmation instead creates a pending block and held items with a ten-minute expiry, then starts dedicated bank Checkout. The webhook creates scheduled bookings after verified payment. Failure/expiry releases pending holds; a payment success that cannot safely book is routed to review. The return page reads status and does not fulfil payment. This branch asks for a new payment; it does not spend an existing package.

Relevant code: `public/learner/book.js` (`getRepeatWeeks`, `maxRepeatLessonsForPendingSlot`, `updateRepeatDates`, recurring preview/commit functions); `api/slots.js` (`handleBook`, `buildRecurringBlockPreview`, `handleRecurringBlockCommit`, bank hold/status/checkout handlers); `api/webhook.js` (reserved-block settlement).

## Exact reasons Flexible Hours do not work

1. `public/learner/book.js:2516` only treats Flexible Hours as eligible when `weeks === 1`. Selecting repeats therefore removes package funding eligibility even when enough hours exist; ordinary credit may be selected instead or the pay path shown.
2. `api/slots.js:4146` rejects Flexible Hours plus repeats with HTTP 400, `FLEXIBLE_PACKAGE_SINGLE_BOOKING_ONLY`, before any balance query.
3. `buildRecurringBlockPreview` reads only `learner_credit_balances` for the anchor instructor. Its `credit` result contains no package balance. `handleRecurringBlockCommit` requires that ordinary credit and ignores a submitted `funding_method`. Sending `flexible_package` cannot enable it.
4. Reserved-block UI (`public/learner/book.js:3164`) chooses Lesson Credit or bank payment solely from that credit result.
5. The reserved-block schema (`db/migration.sql:2601`) permits only `lesson_credit` and `bank_payment` funding. Supporting packages there would require more than changing a button or removing a guard.
6. The package writer, `bookFlexiblePackageSlotTransaction` in `api/_flexible-package-ledger.js`, handles one booking and one booking-specific retry identity. Calling it in a loop would make independently committed bookings, violating the expected all-or-nothing result for a weekly selection.

## Product boundary that the fix must preserve

When the exact Boolean `schools.config.features.retire_incompatible_products` is true, the older repeats and Reserved Weekly Slot creation surfaces are deliberately hidden/refused. Existing lessons remain manageable. This flag is independent of a learner owning a Flexible Hours package; its live value was not checked here.

`CLAUDE.md` and `docs/learner-packages-product-decision-record.md` require the package family to remain separate from ordinary Lesson Credit and Reserved Weekly Slot payment infrastructure. The product decision record explicitly says new product endpoints need their own authority and identities rather than disabling or bypassing retirement.

Recommendation: add an explicitly defined Flexible Hours weekly batch operation with its own preview/commit contract. Preserve the retirement guards on the legacy creation routes. This gives package holders weekly scheduling without reviving the older credit/bank product or changing its financial meaning.

## Recommended implementation contract

### Learner experience

- Select instructor, first date/time and lesson duration as today, then choose weekly lessons using Flexible Hours. Start with the existing 2–4 lesson choice, including the selected lesson; increasing this limit is a separate product choice.
- Show all exact dates, total hours required and hours remaining. Four 90-minute lessons consume six package hours in total.
- Use consecutive weeks for this flow. A conflicting week should be visible and prevent confirmation; do not silently skip or substitute dates. A future-only, skip-unavailable upsell can later use the same package batch service with an explicitly shown date set.
- Keep the selected funding method explicit. If Flexible Hours are insufficient, offer fewer lessons or return to the existing purchase flow; never silently consume ordinary Lesson Credit or start bank Checkout.
- Restrict the first implementation to instant-booking instructors and supported 30-minute duration multiples. Existing request-to-book instructors have a separate approval/hold lifecycle and do not currently support Flexible Hours through this modal.
- Do not apply social-video discounts to Flexible Hours. The package's paid source already determines its value.

### Server and ledger

1. Authenticate the learner and school; validate the same-school active instructor, lesson type, transmission, duration, start/end times and pickup details. Generate/validate dates server-side. Enforce the instructor window, 84-day ceiling, minimum notice, availability, blackouts, external-calendar busy times and travel constraints for every date.
2. Preview without creating bookings or holds. Return the exact selected dates and authoritative school-wide available package minutes. Confirmation must bind to the reviewed dates and fail with a refreshed preview if they change.
3. Add a batch-level idempotency identity scoped by school and learner, bound to a canonical request fingerprint. A retry returns the original booking IDs; reusing the identity for different dates/details returns a conflict. The current single-booking request UUID cannot be reused on every row because its database index is unique. Resolve a completed retry before rejecting on the now-reduced balance or newly occupied slots.
4. In one database transaction, lock the learner and package sources using a consistent order, recheck the whole balance and all selected slots, and allocate FIFO units across every lesson. Use overlap checks, not just equal start times; review locking against other booking writers so competing learners cannot create overlaps. Roll back all bookings and allocations on any failure.
5. Extract/reuse allocation logic inside that transaction rather than invoking the existing transaction-owning single-booking function repeatedly. Carry residual units **and residual pence** forward as each booking consumes a source, preserving rounding and mixed-source history.
6. Every booking has `payment_method='flexible_package'`, actual duration in `minutes_deducted`, its delivering instructor, source allocation rows and `list_price_pence` equal to the sum of those immutable source contributions. Preserve `list_price_source='flexible_package_frozen_rate'` and the existing package fee attribution contract. Do not reprice at today's hourly rate.
7. Store batch identity/results durably in package-specific metadata/schema with uniqueness enforcement. If adding a table, include tenant scope, appropriate indexes and GDPR export/anonymisation handling. No rows are required in the legacy reserved-block tables. No LCB/BCS writes and no additional Stripe payment occur.
8. Await required post-commit activity and notification work before responding. Deliver one clear batch success result with all booking IDs/dates and the actual remaining package balance; make retries avoid duplicate notifications.

### Cancellation, rescheduling and earnings

Single Flexible Hours cancellation already appends exact source returns once at 48+ hours; late cancellation retains the booking's payable status and returns no units. Single rescheduling atomically transfers exact allocations/value, and can change to another active same-school instructor. Preserve these behaviours per occurrence.

There is an additional integration trap: `public/learner/lessons.js` exposes “cancel series” whenever a `series_id` exists, but `api/slots.js` explicitly refuses series cancellation containing Flexible Hours. Either keep initial batch bookings individually manageable without that legacy series action, or implement a dedicated package batch cancellation with per-occurrence notice calculations and exact returns. Do not simply attach a `series_id` and leave the existing action exposed. Cancellation copy must describe returned Flexible Hours, not instructor Lesson Credit.

The reserved-specific learner/admin move routes already contain package-allocation transfer branches. That does not establish support for creating new package-funded reserved blocks, nor is it a reason to route ordinary package batches into reserved policy.

No payout or refund policy change is needed for batch scheduling. Each occurrence should look financially identical to a correctly funded single Flexible Hours lesson. Retain frozen source value and original purchase-fee allocation, normal scheduled/chargeable/refunded eligibility, and existing funding-evidence requirements. Do not infer that a zero per-booking Stripe fee means the original package was fee-free, or grant automated payout eligibility solely because the lessons were grouped.

## Existing weaknesses not to copy

- The reserved preview scans 12 weeks **after the anchor** and explicitly passes `enforceBookingWindow: false`. It can therefore propose dates beyond the normal instructor window or 84 days from today. The new package path must enforce the ordinary learner window on every date.
- Reserved preview uses overlap conflicts, but the ordinary credit transaction recheck mostly uses equal start times. The single package transaction also checks equal-start booked lessons internally. Previews alone cannot provide adequate concurrency protection for a new batch writer.
- Reserved preview prefers lesson-type duration over the anchor's actual start/end duration. For an extended or edited anchor, a new package flow must validate actual selected duration and units rather than blindly inheriting this calculation.
- Older decision records describe some bank/status features as unimplemented; current code and current tests show they now exist. Use the code as the implementation reference.

## Verification and acceptance criteria

Investigation verification:

- 59 existing focused tests passed: recurring block, bank checkout/status, reserved policy, recurring credit response, Flexible Hours and product retirement suites. These are local unit/contract tests, not a production browser or live database exercise.
- Local handler reproduction with synthetic authentication: Flexible Hours plus four repeats returned HTTP 400 `FLEXIBLE_PACKAGE_SINGLE_BOOKING_ONLY` before database access.
- Local reserved-commit reproduction with injected preview: explicit package funding and a synthetic sufficient package balance still returned HTTP 402 `INSUFFICIENT_CREDIT` when ordinary credit was zero. No mutation ran.

Required tests for the implementation:

- Exact and insufficient package balance; unrelated LCB untouched; package and Lesson Credit both available without silent switching.
- Multiple package sources/rates, boundary splitting, residual-pence conservation and allocation duration/value matching each booking.
- Failure on the last date rolls back the entire batch; overlapping slots with different start times, concurrent claims and competing use of the same learner balance.
- Duplicate clicks, response loss, replay after cancellation/rescheduling and changed-payload retry identities do not create more bookings or consume more units.
- School/learner/instructor isolation, inactive instructor, unsupported duration, request-to-book refusal, retired legacy routes still refused.
- Actual date list, instructor/platform windows, minimum notice and DST maintaining the same local lesson time.
- One occurrence cancelled/rescheduled without affecting others; exactly-once 48-hour source returns; late cancellation stays payable; appropriate batch cancellation UI.
- Source-based earnings and purchase-fee allocation remain identical to equivalent individual lessons, including supported off-platform package sources under their existing payout restrictions.
- Browser exercise with only Flexible Hours, only Lesson Credit, both balances and insufficient hours; confirmation and My Lessons show the correct dates, funding and remaining balance.

Until the fix is deployed, the supported workaround is to book each weekly date individually using Flexible Hours, subject to balance and availability.

## Implementation verification

The approved separate preview/commit path implements 2–4 consecutive weekly lessons, including the selected date. It uses one transaction and the existing FIFO source ledger, with a durable batch retry receipt. It leaves legacy retirement checks intact and creates individually manageable bookings without a legacy `series_id`.

123 focused tests pass, including real SQL/migration execution in PGlite, mocked-HTTP browser flows at desktop/mobile sizes, exact and insufficient balances, mixed-rate sources, last-insert rollback, retry after response loss, later competing booking/hold rejection, individual cancellation and overlapping rescheduling. Existing package, credit, retirement, location and reserved-slot contract suites also pass. Syntax and migration-manifest checks pass.

The initial local tests were followed by 12 successful multi-session PostgreSQL races on a disposable production-derived Neon branch; see the linked rollout evidence. Notification failure after commit is logged; it does not undo confirmed lessons, and receipt replay does not resend notifications.
