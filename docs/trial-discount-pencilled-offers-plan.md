# Trial window, post-trial discount and pencilled offers

Status: implementation planning, 16 September 2026. No deployment, production
migration or live configuration change is authorised by this work.

## Confirmed scope

- Free-trial self-service availability and booking: 28 days, respecting a shorter
  instructor booking window. Ordinary paid windows remain unchanged.
- Post-trial discount: account-bound, repeatable purchases during the 48 hours
  anchored to the trial's actual scheduled end; initial percentage 10. Percentage
  and duration must be admin-editable.
- Packages are included. The owner approved proportionally discounted purchase
  cash allocations/refund caps, with exact penny conservation. Existing product
  availability, immutable historical records and test/live gates remain intact.
- Optional pencilled manual offers: fixed lesson, existing learner account,
  84-day platform ceiling, unpaid slot reservation, payment due 48 hours before
  start, cancellation by either party while unpaid. Payment creates an ordinary
  booking subject to the existing cancellation policy.

## Decisions pending

1. Completion evidence: scheduled end plus existing cancellation/not-delivered
   exceptions, or affirmative delivery evidence. The existing hourly cron and
   `free_trial_completed_at` alone do not prove attendance. Unreported absence
   cannot be detected automatically.
2. Whether 10% stacks on existing discounts and negotiated offers.
3. Whether reduced payment reduces instructor earnings or CoachCarter funds a
   separately recorded subsidy.
4. Whether a short checkout price lock survives discount expiry or payment must
   succeed strictly before expiry. Manual-capture request authorisation and
   delayed settlement must follow the same explicit rule.

## Shared implementation contracts

- Resolve account and school from authenticated context. A client-entered email
  or learner ID is not proof of eligibility.
- Compute eligibility and final price server-side. Record trial source, trial-end
  instant, percentage, eligibility expiry, pre-discount and final pence, pricing
  policy, and payment attempt identity. Later fulfilment uses the recorded price,
  never current configuration or a browser-submitted amount.
- Use school operational timezone (Europe/London fallback) to turn scheduled
  dates/times into instants. Duration cutoffs are elapsed hours, including DST.
- A pending pencilled offer is a hold, never a booking, credit purchase, earning
  or payout source. Use interval conflict checks and transactional serialisation
  for creation, cancellation and fulfilment.
- At the pencilled deadline, unpaid holds expire. Delayed webhooks must distinguish
  payment time from receipt time. Cancellation/expiry races must yield at most
  one fulfilled booking or one retained compensation outcome.
- Keep ordinary offer behaviour and all product retirement/pilot gates intact.

Concurrency review: existing unique indexes protect exact start times, not
cross-table overlapping intervals. Proposed integration uses a narrowly scoped
database guard with a shared school/instructor/day transaction lock for bookings,
requests, reservations, offers and recurring holds. It rejects conflicts involving
active pencilled offers while leaving ordinary-versus-ordinary behaviour unchanged.
Pencilled fulfilment transitions its hold and inserts its paid booking in one
transaction, with rollback restoring the hold on failure. This design still needs
real concurrent-transaction tests before it is considered verified.

## Purchase coverage discovered in current code

| Flow | Entry point | Existing financial basis |
|---|---|---|
| Direct authenticated/guest lesson and test-date booking | `api/slots.js` | Effective hourly price; ordinary lessons optionally have filming discount |
| Card-backed lesson request | `api/slots.js`, `api/_lesson-requests.js` | Authorise first, capture after instructor acceptance |
| Available Lesson Credit Checkout/PaymentIntent | `api/credits.js` | Instructor-scoped effective rate and opted-in bulk tier |
| Manual/broadcast/supported historical offers | `api/offers.js` | Stored negotiated offer price; retirement guards remain |
| Paid extension | `api/offers.js`, `api/webhook.js` | Additional payment/source on existing booking |
| Flexible Hours | `api/flexible-packages.js` | Dedicated live gate; immutable source and exact unit allocations |
| Full Curriculum | `api/packages.js` | Restricted test pilot; immutable contract/refund valuation |

Spending existing credit or package entitlement is not a new purchase. Free
products remain free. Disabled or retired products do not become purchasable.

## Delivery and review

Independent work completed: trial-window implementation, including learner trial
rescheduling, has 22 passing focused tests (mocked API and browser coverage).
The isolated pencilled-offer policy helper has six passing tests for shape, DST,
84-day and 48-hour boundaries; it is not yet integrated into production routes.
Repository syntax validation passed. Pricing and full pencilled-offer integration
remain pending the commercial decisions above.

Implementation and focused tests are assigned to GPT-5.6 Sol; GPT-6 Astra owns
contracts, coordination and final review. Exclusive file ownership prevents
concurrent edits to shared checkout/fulfilment files. Verify price rounding,
time boundaries, tenant/account isolation, unpaid state, duplicate payment and
cancellation races. Run browser journeys with safe fixtures and state explicitly
which database/provider checks require separate rollout rehearsal.
