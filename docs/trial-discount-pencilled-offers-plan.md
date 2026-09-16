# Trial window, post-trial discount and pencilled offers

Status: implemented and locally verified, 16 September 2026. No deployment, production
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

## Commercial decisions approved

1. Completion evidence: scheduled end plus existing cancellation/not-delivered
   exceptions. The existing hourly cron and
   `free_trial_completed_at` alone do not prove attendance. Unreported absence
   cannot be detected automatically.
2. Apply the extra 10% after existing discounts and negotiated offer prices.
3. Reduced payment reduces instructor earnings under existing revenue accounting;
   there is no separate CoachCarter subsidy.
4. A checkout started while eligible keeps its price for up to 30 minutes (or a
   shorter existing hold). This grace can extend beyond the eligibility end.
   A new checkout after eligibility ends has no discount. Manual-capture request
   authorisation and delayed settlement preserve the price when payment was
   initiated in the valid checkout window. Pencilled offers still require payment
   success strictly before their separate start-minus-48-hours deadline.
5. Where Stripe promotion-code entry already exists, apply that code last:
   a £100 price becomes £90 after the automatic discount, then £80 with a £10
   Stripe code. Flows which already disable promotion codes keep that restriction.

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
cross-table overlapping intervals. The integration uses a narrowly scoped
database guard with a shared school/instructor/day transaction lock for bookings,
requests, reservations, offers and recurring holds. It rejects conflicts involving
active pencilled offers while leaving ordinary-versus-ordinary behaviour unchanged.
Pencilled fulfilment transitions its hold and inserts its paid booking in one
transaction, with rollback restoring the hold on failure.

## Purchase coverage discovered in current code

| Flow | Entry point | Existing financial basis |
|---|---|---|
| Direct authenticated/guest lesson and test-date booking | `api/slots.js` | Effective hourly price; ordinary lessons optionally have filming discount |
| Card-backed lesson request | `api/slots.js`, `api/_lesson-requests.js` | Authorise first, capture after instructor acceptance |
| Retired Lesson Credit Checkout/PaymentIntent | `api/credits.js` | Instructor-scoped effective rate and opted-in bulk tier; existing disabled gate remains |
| Manual/broadcast/supported historical offers | `api/offers.js` | Stored negotiated offer price; retirement guards remain |
| Paid extension | `api/offers.js`, `api/webhook.js` | Additional payment/source on existing booking |
| Conditional Reserved Weekly Slot bank checkout | `api/slots.js`, `api/webhook.js` | Whole-block price with exact cash allocation; retirement and payment-method gates remain |
| Flexible Hours | `api/flexible-packages.js` | Dedicated live gate; immutable source and exact unit allocations |
| Full Curriculum | `api/packages.js` | Restricted test pilot; immutable contract/refund valuation |

Spending existing credit or package entitlement is not a new purchase. Free
products remain free. Disabled or retired products do not become purchasable.

## Delivery and review

Implementation includes the trial window, immutable discount quotes, admin
configuration and account banners, package cash snapshots, and pencilled-offer
creation, account listing, cancellation and paid fulfilment. Focused tests cover
pricing and time boundaries, tenancy, payment events, browser fixtures and a
disposable local PostgreSQL ledger. Final verification results and rollout steps
are recorded below.

Implementation and focused tests are assigned to GPT-5.6 Sol; GPT-6 Astra owns
contracts, coordination and final review. Exclusive file ownership prevents
concurrent edits to shared checkout/fulfilment files. Verify price rounding,
time boundaries, tenant/account isolation, unpaid state, duplicate payment and
cancellation races. Run browser journeys with safe fixtures and state explicitly
which database/provider checks require separate rollout rehearsal.

## Accounting and expiry operations

Discount quotes retain the trial source, original/final cash, percentage, eligibility
and checkout expiry, provider identity and first signed initiation evidence. They
are reusable across purchases only by creating a separate quote for each payment;
there is no single-use coupon. GDPR deletion anonymises the learner binding while
retaining financial evidence. Browser prices are advisory.

Flexible Hours keeps its existing positive-balance and unresolved-checkout gates.
New discounted sources allocate cash from the remaining cash/units ratio; consuming
the final units takes the remaining pennies. Returns restore the original frozen
contribution. Full Curriculum scales monetary caps and deductions proportionally,
without changing service entitlements or pilot/test restrictions. Historical
purchase snapshots are not rewritten.

Stripe session creation is not evidence that payment began in time. Signed
completion/processing/authorisation events establish initiation; later settlement
uses that stored timestamp. Out-of-order settlement must retry until the earlier
event arrives. A quote may expire before Stripe can close a short session because
Stripe's minimum session expiry is 30 minutes. Server-side validation still applies.
Discounted package provider links are capped at approximately 31 minutes to stay
above Stripe's minimum; the 30-minute server quote still controls qualification.
Invalid paid attempts retain a compensation outcome and alert operators. Pencilled
offer compensation uses its narrow idempotent refund path, never creates earnings
for the unpaid hold, and never confirms a late or cancelled offer.

Pencilled Checkout attempts retain their exact provider payload and quote before
creation. Concurrent clicks cannot create separate payable sessions; a retry after
provider creation/local persistence failure reuses the same idempotency key and
payload. Open sessions with expired quotes are closed and confirmed expired before
rotation; completed, processing or unknown provider states are not rotated. The
same quote-recovery rule covers discounted extensions. Retained contact details in
the payload participate in GDPR export/anonymisation.

## Final verification (17 September 2026)

- Combined focused regression run: **201 passed, 2 skipped** across trial windows,
  offers/extensions, discount pricing/timing, package gates/accounting, API mocks,
  browser journeys and local database integration. The two skipped tests are the
  existing Reserved Weekly Slot Neon-only smoke tests; their external test-branch
  gate was deliberately disabled. Its cash allocator is covered locally.
- Real local PostgreSQL tests exercise two-client overlap locking, both commit
  orders, duplicate pencil fulfilment, cancellation, tenant boundaries and schema
  checks. Package ledger conservation includes non-last returns, reductions,
  rescheduling and final drain: 901p active allocations + 100p reduction = 1001p.
- Handler-level fake Stripe tests reproduce concurrent Checkout clicks and a
  successful provider creation followed by a failed local session save. Recovery
  retains one quote, identical provider parameters and the original session even
  when the retry submits different contact details.
- Root reviewed rendered instructor, learner, offer-payment and package screens.
  Browser network responses are fixtures; no real Stripe charge was made.
- All 252 JavaScript files pass the repository syntax check. `git diff --check`
  and `npm run migrations:check` pass (69 manifest entries). Migrations 066–068
  were applied together twice to a disposable local schema; agents also tested
  individual migrations. Historical numbered SQL and baseline receipts are intact.

Implementation and focused testing used GPT-5.6 Sol; GPT-6 Astra coordinated,
reviewed integration, checked rendered output and ran combined verification.

## Rollout packet (not executed)

1. Review and rehearse numbered migrations 066, 067 and 068 in order on a disposable
   database with the current schema. Run `npm run migrations:check`; use the
   migration governance runner and its normal target/approval gates. Do not use
   the legacy aggregate endpoint as authority or modify historical receipts.
2. Apply the reviewed migrations before code rollout. 066 adds pencil state and
   overlap guards; 067 stores retained discount quotes; 068 adds package purchase
   snapshots and exact cash valuation. No production migration was run here.
3. Rehearse signed Stripe test-mode events, including reordered bank settlement,
   manual capture, cancellation/payment races and duplicate events. Browser tests
   use local fixtures and do not prove a live provider or account journey.
   Confirm the relevant webhook subscriptions include Checkout completion/async
   outcomes and PaymentIntent processing, capturable-updated and success events.
4. Verify the intended admin settings (`pricing.post_trial_discount_pct`, default
   10; `pricing.post_trial_discount_hours`, default 48). Existing school settings
   and product availability are not changed by this branch. The defaults become
   effective when the code is rolled out; 0 percent disables new discount quotes.
5. Monitor retained `invalid_requires_compensation` quote outcomes and existing
   error alerts. Resolve paid-but-unfulfilled attempts through the existing
   operator refund review, preserving source/receipt evidence and idempotency.
