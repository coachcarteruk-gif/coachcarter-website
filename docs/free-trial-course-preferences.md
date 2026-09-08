# Free trial course preferences

The free-trial form offers two optional, initially unticked requests: the “30 Days to Pass Your Test” email course and intensive course information by email. Intensive interest reveals a multi-select of the current London calendar month plus the following eleven months, with explicit years. Months are optional for undecided learners. Unticking intensive interest clears them.

The booking endpoint validates Boolean choices and the month window before booking. A successful trial with either request creates a `free-trial-courses` enquiry in the same SQL statement as the booking, so a storage failure cannot leave a booked trial with a silently lost request. Existing clients omitting preferences remain supported.

Admin dashboard → Enquiries → View shows both answers and ISO year-month selections. The enquiry message records the v1 contact scope; `submitted_at` records when it was requested. Blanket `marketing_consent` remains false: a course-specific request does not subscribe someone to general marketing.

No schema migration or new email service is required. This captures requests for manual follow-up; it does not deliver an automated 30-day email sequence or forward these entries to n8n. That delivery workflow requires separate implementation.

These enquiries follow existing enquiry retention (archive after two years, delete thirty days later). Learner data export includes matching same-school entries, and learner deletion removes them by same-school email match.

Validation: `tests/trial-course-preferences.spec.js` covers the dynamic selection/submission and strict server-side preference parsing. Existing free-trial journey and scheduling safeguard suites cover regressions. Database persistence should also be exercised in staging before release; local browser tests mock the booking API.
