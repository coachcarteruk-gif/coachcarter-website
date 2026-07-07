# Test Date Lesson Booking Plan

## Goal

Give learners a special way to book their practical driving test date lesson beyond the normal 28-day self-serve booking window.

This booking is for the warm-up plus the practical test itself. It must reserve the instructor/car for 1.5 hours.

## Product Rule

- A test date lesson is always 90 minutes.
- It is allowed to bypass the normal 28-day learner booking cap.
- The learner chooses a start time on a normal quarter-hour boundary:
  - `:00`
  - `:15`
  - `:30`
  - `:45`
- The start time should be close to 45 minutes before the saved practical test start time.
- The UI should recommend the closest quarter-hour start time to `test_time - 45 minutes`.
- The learner may choose nearby quarter-hour options if they suit the test timing better.

Example:

If the learner's practical test starts at `10:14`, the ideal warm-up start is `09:29`.

The UI can offer quarter-hour starts around that:

- `09:15-10:45`
- `09:30-11:00` recommended closest
- `09:45-11:15`

The booking remains a fixed 90-minute booking.

## Existing Constraints To Preserve

- Do not loosen the ordinary self-serve booking cap.
- `MAX_DAYS_AHEAD = 28` in `api/slots.js` should remain the normal booking limit.
- `FEED_MAX_DAYS = 28` in `public/learner/book.js` should remain the normal booking feed limit.
- Normal learner bookings, guest bookings, reschedules, free trials, and ordinary checkout should still obey the 28-day cap.
- This must be a narrow, named exception for practical test date lessons only.

Relevant docs/rules:

- `CLAUDE.md` "Advance Booking Window"
- `docs/navigation.md` learner booking page structure
- `docs/per-instructor-credits-audit.md` before touching credit-funded booking behaviour
- `docs/booking-statuses.md` before touching booking lifecycle/status behaviour

## Existing Data To Use

Learner profile already stores:

- `learner_users.test_date`
- `learner_users.test_time`
- `learner_users.test_centre`
- `learner_users.test_instructor_booked`

These are already exposed through learner/admin/profile flows.

## Recommended Implementation Shape

Add a dedicated test-date booking path rather than quietly extending existing booking paths.

Suggested API actions:

- `GET /api/slots?action=test-date-availability`
- `POST /api/slots?action=book-test-date`
- Optional Stripe path if direct pay is needed:
  - `POST /api/slots?action=checkout-test-date`

The dedicated action makes the 28-day exception explicit and easier to test.

## Server-Side Rules

The server should:

1. Require learner auth.
2. Resolve `school_id` from auth and scope every query by school.
3. Read the learner's saved `test_date`, `test_time`, and `test_centre`.
4. Reject if the learner has no saved practical test date/time.
5. Require a same-school active instructor.
6. Force the booking duration to 90 minutes.
7. Resolve the active same-school 90-minute lesson type server-side.
8. Reject any client-submitted duration or non-90-minute lesson type.
9. Allow the date to exceed the normal 28-day cap only for this action.
10. Keep a separate upper bound, for example 12 months ahead, to prevent nonsense far-future bookings.
11. Require selected start time to be on a quarter-hour boundary.
12. Require selected start time to be one of the generated allowed quarter-hour options for that learner's saved test time.
13. Ensure the 90-minute booking covers the practical test start time.
14. Run the normal slot checks:
    - instructor availability
    - existing lesson conflicts
    - blackout/busy blocks
    - reservations
    - travel/buffer checks where applicable
    - offered lesson type rules
15. Preserve per-instructor credit scoping.
16. Never trust client-submitted price, duration, discount, or instructor scope.

## Allowed Start-Time Generation

Use the saved `test_time`.

1. Compute the ideal start:

```text
ideal_start = test_time - 45 minutes
```

2. Generate nearby quarter-hour start times around that ideal.

Recommended initial set:

```text
nearest quarter-hour to ideal_start
one quarter-hour before
one quarter-hour after
```

3. Filter out options that:

- are not on `:00`, `:15`, `:30`, or `:45`
- do not fit instructor availability
- clash with another blocking booking/reservation
- fail travel/buffer checks
- do not cover the practical test start time

Example for a `10:14` test:

```text
ideal_start = 09:29
nearest = 09:30
options = 09:15, 09:30, 09:45
```

## Booking Metadata / Schema

Recommended DB additions to `lesson_bookings`:

- `booking_purpose TEXT DEFAULT 'lesson'`
- `test_start_time TEXT NULL`
- `test_centre TEXT NULL`

For test date bookings:

- `booking_purpose = 'test_date'`
- `test_start_time = learner_users.test_time`
- `test_centre = learner_users.test_centre`

After a successful booking, set:

```text
learner_users.test_instructor_booked = TRUE
```

Keep normal booking statuses unchanged:

- `scheduled`
- `chargeable`
- `refunded`

Do not add a new booking status for test date lessons.

## Learner UI

Add a focused panel on `/learner/book.html`.

Show it when the learner is signed in and has saved test details.

Suggested content:

- "Book your test date lesson"
- saved test date
- saved test time
- saved test centre
- "This is a 1.5 hour booking for your warm-up and practical test."
- "Choose a quarter-hour start time close to 45 minutes before your test."

The recommended start time should be preselected or labelled as recommended.

If the learner has no saved test details:

- show a soft prompt to add practical test date/time/centre in profile
- do not allow the special booking path

This should not replace the normal 28-day booking calendar/feed.

## Instructor/Admin UI

Bookings with `booking_purpose = 'test_date'` should display clearly as:

```text
Test date lesson
```

Useful places:

- instructor calendar/dashboard cards
- learner upcoming lessons
- admin booking views
- booking confirmation emails
- calendar/iCal description

Admin learner controls already include test date/time/centre and `test_instructor_booked`; successful booking should update that flag.

## Payment / Credit Behaviour

Support both:

- credit-funded booking, if the learner has at least 90 minutes with that instructor
- direct pay-and-book, if they do not have enough credit

Credit-funded booking must use:

- `learner_credit_balances(learner_id, instructor_id, school_id, balance_minutes)`
- existing booking credit source ledger behaviour

Direct payment must price server-side using the existing direct lesson pricing rules.

Stripe metadata should include:

- `booking_purpose=test_date`
- `test_date`
- `test_time`
- `test_centre`
- `duration_minutes=90`
- `instructor_id`
- `school_id`

Webhook booking creation must preserve the purpose/test metadata.

## Tests To Add

Add focused tests that prove:

1. Normal booking paths still reject dates beyond 28 days.
2. Test date booking can exceed 28 days.
3. Test date booking requires learner auth.
4. Test date booking requires saved `test_date` and `test_time`.
5. Test date booking rejects cross-school or inactive instructors.
6. Test date booking always uses 90 minutes.
7. Test date booking rejects non-quarter-hour starts.
8. Test date booking rejects starts not in the generated allowed option list.
9. Test date booking rejects slots that do not cover the practical test start time.
10. Test date booking rejects clashing slots/reservations/blackouts.
11. Successful credit-funded booking deducts 90 minutes from the selected instructor balance.
12. Successful direct-pay checkout/webhook creates a `booking_purpose='test_date'` booking.
13. Successful booking sets `learner_users.test_instructor_booked = TRUE`.

Update `tests/advance-cap.spec.js` comments/coverage so the new exception is documented and does not look like an accidental cap bypass.

## Important Non-Goals

- Do not create arbitrary far-future learner booking.
- Do not add a second calendar mode or old-style calendar views.
- Do not reintroduce removed booking UI patterns.
- Do not add new booking statuses.
- Do not let the browser choose duration, price, or exception eligibility.
- Do not make this available to guests unless a separate verified-profile flow is designed later.

