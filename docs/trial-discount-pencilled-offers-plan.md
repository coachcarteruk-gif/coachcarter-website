# Trial window, post-trial discount and pencilled offers

Status: reconciled with current main for the owner-requested restoration on
19 September 2026. Fraser explicitly requested restoring pencilled offers to
the site and including the trial-window and post-trial-discount changes.
Migrations 066-068 are already installed and match the production ledger;
this restoration requires no production migration or financial data repair.

## Eligibility verification — 21 September 2026 (fix pending deployment)

Picker follow-up (21 September, pending deployment): length choices and the
booking modal display server-calculated discounted prices before checkout,
including the original price and saving. The signed-in learner's identity and
school determine both their effective rate and discount; browser/query learner
IDs are not price authority. Responses are private/no-store and reads create no
discount quote. Filming is applied before the trial discount with the same penny
rounding as checkout; request-to-book excludes filming. Existing-credit spending
still uses the full lesson duration. The status banner polls every minute while
visible and refreshes on focus, updating the picker on eligibility changes.
Browser fixtures and real handler tests cover these contracts; no real payment
was made for this display change.

Read-only production inspection confirmed the discount table exists and School 1
uses the default 10% / 48-hour settings. No discount quotes had been created at
inspection. Two existing booking shapes incorrectly failed eligibility:
rescheduled free trials whose replacement defaults to `payment_method='credit'`,
and free trials with paid extensions that add deducted minutes and list value.
Their original zero-value free-trial source remains attached in both cases.

Eligibility and quote settlement now also accept an active BCS row linked to a
zero-value `free_trial` credit transaction for the same school and learner.
The booking must still be a trial lesson, ended, neither cancelled nor forfeited,
and scheduled/chargeable. Its current scheduled end anchors the window, including
any accepted extension. Ordinary paid lessons cannot qualify from the lesson-type
label alone. Historical booking, BCS and transaction rows are not rewritten.

The new real PostgreSQL regressions cover both affected shapes, before/end/exact
48-hour expiry, both UK clock changes, repeat purchase quotes, source ownership,
retired source rows, cancellation/forfeiture, and successful quote validation.
All fixture writes run in rolled-back transactions on a disposable loopback
database. Production checks used read-only transactions; no real Stripe payment
was made. The affected live records pass the corrected eligibility read without
any data repair.

## Restoration verification — 19 September 2026

- Integrated the existing feature branch into fresh main, retaining migration
  069, payout summaries, fee backfill, deployment guard and security hardening.
- Fixed the merged trial calendar's missing date-formatting helper and retained
  the newer date-grid UX. Boundary tests now assert the visible day-28 slot.
- Unknown Stripe fees remain NULL in pencilled booking/funding attribution;
  real zero fees remain zero. Regression tests cover unknown, zero and known
  fees, including the booking's evidence-source field.
- Pencilled mode resets when reopening the offer dialog, is available only for
  a specific existing learner, and disables flexible/repeating offers. Learner
  cancellation updates the upcoming count.
- Full local verification: 1,537 passed, 310 skipped. This includes the real
  loopback PostgreSQL concurrency and package penny-conservation tests that
  the 17 September review could not run. A subsequent focused run passed all
  nine signed-dispatcher and real quote-ledger checks, including invalid
  signature rejection, tenant/learner isolation and trial revocation timing.
- The aggregate schema bootstrapped successfully in a disposable local
  PostgreSQL database (with the historical neondb_owner role created locally).
  Numbered 066-068 then repeat-applied successfully. No production SQL ran.
- GitHub CI and Vercel preview passed for the integrated application revision.
  The deployed preview's trial-window API returned the correct school-local
  28-day range. Final test/documentation changes also require CI before merge.
- Provider-side checkout, refund and asynchronous-settlement outcomes are
  tested with controlled provider fixtures; webhook signatures are verified by
  the real Stripe SDK. No real Stripe payment or provider-delivered test payment
  was made during this restoration. Do not describe these tests as such.

The sections below retain the original design and September 16-17 evidence.
Their earlier rollout restrictions and pending-schema descriptions are
historical; the current scope and migration receipts above take precedence.

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

## Review remediation (17 September 2026)

- Delayed paid pencils now reacquire the shared school/instructor/day lock and
  recheck bookings, requests, reservations, recurring holds, busy blocks and other
  active pencils before fulfilment. An occupied slot retains one idempotent refund
  outcome instead of creating a double booking. Migration 066 also protects an
  ordinary calendar writer that waited behind fulfilment, including after the
  accepted booking is moved to another instructor/day, without adding a general
  booking-versus-booking exclusion.
- Paid pencils with expired, revoked or contradictory discount evidence now pass
  through canonical offer, school, learner and retained Checkout validation before
  the narrow compensation path. Refund failures retain `manual_review`, fail the
  webhook receipt so Stripe can retry, and reuse the same refund idempotency key.
  Unpaid/processing callbacks and unrelated products keep their prior behavior.
- Credit-funded Reserved Weekly Slot commits now return the preview's credit
  pricing after a successful mutation; they no longer reference variables owned by
  the separate bank-checkout discount path.
- Pencilled-offer and discounted-extension retries repair quote binding against the
  saved Checkout session and frozen payload. A bind rejection clears that identity
  only after expiry of the exact session is confirmed; ambiguous expiry preserves
  it, so a retry cannot create a second payable Checkout.
- The public trial picker obtains a host-resolved school window from `api/slots.js`.
  Trial availability, booking, rescheduling and minimum-notice checks use the
  school's operational timezone and the shorter instructor horizon. Ordinary paid
  booking windows retain their existing behavior.

## Final verification (review remediation, 17 September 2026)

- A fresh combined behavioral run completed **95 passed, 1 skipped** across the
  actual webhook dispatcher, fulfilment and refund retries, lock-order contracts,
  quote-binding recovery, recurring-credit commit, payout-v2 regressions, trial API
  and browser behavior, BST/DST boundaries, exact day 28/day 29 and shorter
  instructor windows. The skip is the real PostgreSQL concurrency scenario: this
  workstation has no loopback PostgreSQL server or container runtime and
  `PENCILLED_TEST_DATABASE_URL` was intentionally unset. No remote Neon database
  was substituted.
- A separate adjacent-regression run completed **91 passed, 3 skipped** across
  booking extensions, ordinary slot webhooks, recurring/existing-learner offers,
  pencilled UI and migration governance. The skips are existing environment- or
  fixture-gated integration/auth cases; there were no failures. The governance
  contract now covers numbered migrations 061–068 and all 69 manifest entries.
- Handler-level fake Stripe tests cover payment-before-deadline/webhook-after-
  deadline, different-start overlaps, adjacency, duplicate deliveries,
  cancellation/payment races, compensation failure/retry, malformed advisory
  metadata, session persistence before quote binding, and ambiguous provider
  expiry. These are signed-event/provider mocks; no Stripe test-mode event or real
  payment was sent.
- Trial regressions cover London after-midnight BST, both UK DST transitions,
  non-default tenant resolution, a timezone west of UTC, shorter instructor
  horizons and timezone-correct minimum notice. A successful credit-funded
  recurring mutation returns HTTP 201 with its non-purchase pricing response.
- All **252** JavaScript files pass `npm run check:syntax`.
  `npm run migrations:check` passes all **69** manifest entries, migration 066 and
  its aggregate mirror are byte-for-byte aligned, and `git diff --check` passes.
  Migration 066's final manifest SHA-256 is
  `df194ea75f0fbfbaf49b823425decdf93633681f7c5888c49898348ad43b2a2a`.
- Because no disposable loopback PostgreSQL instance was available, migrations
  066–068 were not applied or repeat-applied during this remediation pass. Signed
  Stripe test-mode and staging rehearsals also remain unperformed. No deployment,
  production migration, live configuration change or real payment was made.

Implementation and focused testing were delegated with exclusive file ownership
to GPT-5.6 Sol. GPT-6 Astra coordinated, ran the combined verification and completed
an independent integration review. The branch is suitable for a draft PR; staging
rehearsal remains required before merge or rollout.

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
