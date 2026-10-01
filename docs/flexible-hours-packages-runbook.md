# Flexible Hours packages runbook

## Status and hard boundary

The repository contains the production-shaped Flexible Hours implementation, but it is inert by default. This runbook does not authorise a production migration, live Stripe configuration, gate activation, Checkout creation, deployment or merge. Each requires a later explicit approval.

Full Curriculum remains test-only and isolated. Do not reuse its restricted key, Payment Method Configuration, webhook secret, endpoint or purchasing gate. Do not reuse Reserved Weekly Slot payment identities.

## Product contract

25 September 2026 implementation (pending migration 072 and deployment): admins can
record an actual off-platform bank transfer as a separate audited purchase/source.
This is a second entitlement authority, distinct from signed Stripe fulfilment;
it never invents Stripe identities. See [bank-transfer workflow and rollout](flexible-bank-transfer-purchases.md).

| Product | Price | Entitlement | Frozen unit rate |
|---|---:|---:|---:|
| 10-hour Flexible Hours | £550 | 20 × 30 minutes | £27.50 |
| 15-hour Flexible Hours | £810 | 30 × 30 minutes | £27.00 |
| 30-hour Flexible Hours | £1,590 | 60 × 30 minutes | £26.50 |

Hours are school-wide, do not expire and cannot transfer to another learner. The 10-hour option is a payment-convenience package for learners who prefer one payment over 10 separate payments when booking; at £55 per hour, it is not presented as a discount. Learners must use their spendable balance before starting another package Checkout. FIFO allocation still preserves every immutable source if historical returns or late payment success make sources coexist. A booking carries its delivering instructor and frozen allocated value into the normal scheduled/chargeable/refunded payout lifecycle. Purchase alone creates no earning or payout.

Each booking uses Flexible Hours, Lesson Credit or Pay As You Go, never a blend. At 48+ hours, learner cancellation returns each exact allocation once. A 48+ hour reschedule atomically moves the exact allocation and frozen value to the replacement lesson, including a different active same-school instructor. Under 48 hours/no-show consumes it and leaves the booking payable. Durations not divisible by 30 minutes fail closed. Unused source units are refunded at their frozen rate; CoachCarter absorbs the original Stripe fee.

Every learner receives access as soon as signed payment confirmation creates the entitlement. The checkout page presents the immediate-access request inside the single combined terms acceptance and records `terms_accepted = TRUE` plus `immediate_access_requested = TRUE`. The checkbox may use a concise customer-facing label only while the approved acknowledgement and immediate-access wording remain unchanged in the adjacent checkout disclosure and are programmatically associated with that checkbox; do not remove that wording or evidence when simplifying the UI.

### Lesson extensions (21 September 2026, pending deployment)

For a lesson already funded by Flexible Hours, **Request extension** sends an
offer for 30–180 additional minutes. The learner sees the cost in package minutes
and selects **Accept with Flexible Hours**. The server verifies availability and
the original booking's allocation evidence, then atomically appends FIFO units,
updates the existing booking's end time/minutes/frozen value and accepts the offer.
Insufficient hours leave the lesson unchanged. A retry cannot consume units twice.
Custom cash prices, cash top-ups and mixed Lesson Credit funding are not supported
for these extensions. Existing duration editors still require cancellation and
rebooking. The existing cancellation/rescheduling rules apply to every allocation,
including the added time. No new schema or Stripe configuration is required;
migration 063 must already be installed.

### Weekly booking (28 September 2026)

Rollout authorised by Fraser on 28 September. Migration 074 and the application
are live, with authenticated read-only production verification complete.
See [rollout evidence](flexible-weekly-rollout.md).

Learners with Flexible Hours can select **2–4 consecutive weekly lessons**, including
the selected first lesson, with an instant-booking instructor. The preview lists
every date, the total package hours required and the remaining balance. The same
local start time is retained across daylight-saving changes. Every date must fit
the instructor's learner booking window, the 84-day platform ceiling, availability,
notice, overlap and pickup-travel rules. An unavailable week blocks confirmation;
the system does not silently skip it. Request-to-book instructors are excluded.

This uses dedicated authenticated POST actions on `/api/slots`:
`flexible-weekly-preview` and `flexible-weekly-commit`. It is independent of the
retired Lesson Credit repeats and Reserved Weekly Slot products; their retirement
guards remain in force. It does not require new Stripe configuration or a new
payment. Insufficient package hours require fewer lessons or more hours; the
selection never automatically switches to Lesson Credit or Checkout.

Confirmation locks the learner, instructor scheduling scope and package sources,
revalidates all dates and spends FIFO units in one transaction. All lessons are
created or none are. Each lesson retains its exact frozen source value and actual
duration. A school/learner-scoped UUID and request fingerprint in the existing
append-only package events provide a durable retry receipt. A completed retry
returns the original booking IDs before checking the now-consumed balance or slots;
changing the payload with the same identity is refused. No Lesson Credit balances
or legacy reserved-block rows are written.

Each occurrence is cancelled or rescheduled individually under the existing
Flexible Hours rules; there is no legacy cancel-series action. Eligible cancellation
returns exact source units once, and rescheduling transfers the exact allocations.
Migration 074 carries overlap protection to replacements and checks at transaction
commit that the old booking is inactive. Payment, refund and payout policy is
unchanged. Batch summary notifications are awaited after commit; a delivery failure
is logged without undoing bookings, and retrying a completed request does not resend.

Rollout sequence:

1. Rehearse `db/migrations/074_flexible_weekly_bookings.sql` on a disposable Neon
   branch with the existing package and scheduling migrations. Inspect its triggers
   on bookings, checkout reservations, offers, requests and reserved-block holds.
2. Exercise simultaneous competing booking/hold writes and same-learner spending
   using separate PostgreSQL connections. Local tests exercise the actual SQL via
   PGlite but do not establish multi-session concurrency behaviour.
3. Apply migration 074 through the normal migration process, then deploy the API
   and learner UI. The balance endpoint exposes `weekly_booking_enabled` only when
   the new column and retry index exist; the control stays hidden without them.
4. Verify a package-only learner can book a batch, sees each lesson and the correct
   remaining hours, and can cancel/reschedule one occurrence. Verify insufficient
   hours, a conflicting date and a repeated request cannot create partial or extra
   bookings. Confirm the retired legacy routes remain unavailable where configured.

Verification: 123 focused tests passed, including browser flow and mobile layout
checks, plus syntax and migration-manifest validation. All 12 additional
multi-connection races passed on a disposable production-derived Neon branch.
Migration 074 then succeeded in production, with both indexes valid and all six
triggers enabled. No learner balances or school configuration were changed.

## Separate live Stripe prerequisites

Create and verify, without enabling the application gate:

1. A dedicated live restricted key with only the minimum Checkout/PaymentIntent/webhook permissions needed by this flow.
2. A dedicated live Payment Method Configuration with Pay by Bank enabled and every other method disabled.
3. A dedicated live webhook endpoint targeting `/api/flexible-package-webhook` for Checkout completed, asynchronous success/failure and expiry events.
4. Separate environment values:
   - `STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY`
   - `STRIPE_FLEXIBLE_PACKAGES_LIVE_PAYMENT_METHOD_CONFIGURATION`
   - `STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET`

The code rejects absent identities and known shared/test identities. It omits `payment_method_types`; the dedicated Payment Method Configuration is the Pay-by-Bank-only authority.

## Approved rollout order

1. Review migrations 050, 051 and 053 and the money-flow diff.
2. Apply and verify them only on the confirmed disposable Neon branch.
3. Run syntax, focused unit/contract tests and the gated fresh-schema integration suite.
4. Configure and inspect the three dedicated live Stripe resources while the school gate remains false.
5. Confirm current immutable versions, School 1 scope, signature rejection, replay, late success, failure/expiry and return-page non-fulfilment.
6. Confirm a purchase creates exactly one purchase/source and no earning/payout row.
7. Confirm a same-school instructor booking consumes FIFO units, stores frozen `list_price_pence`, and rejects another school/inactive instructor and incompatible duration.
8. Confirm 48+ cancellation returns exact allocations once and under-48 cancellation remains scheduled/payable.
9. Confirm a 48+ reschedule moves the exact allocation to the replacement booking, including a same-school instructor switch, and refuses mixed Lesson Credit funding.
10. Confirm a positive spendable balance blocks another Checkout while the learner can still open the booking calendar.
11. Confirm admin reconciliation, GDPR export/anonymisation and manual original-method refund evidence.
12. Only after separate explicit approval, set exact Boolean School 1 feature `learner_flexible_package_purchasing_live_enabled` to `true` through a controlled configuration change. There is intentionally no admin-page setter.

## Refund operation

The application never calls `stripe.refunds.create` for Flexible Hours. Preview unused source value first, then initiate each refund manually against that source's original PaymentIntent/payment method. Never deduct the original Stripe fee from the learner.

1 October 2026 implementation, pending deployment: **Admin → Learner Packages → Flexible Hours → Record original-method refund** accepts **Pending — bank processing** or **Succeeded**. Enter the actual Stripe `re_...` refund ID, 30-minute units, evidence reference and reason immediately after initiating the refund. Do not wait for the receiving bank: either status removes those units from the spendable balance in the same transaction as the immutable source reduction, state event and audit record. This commits hours to an initiated refund; it is not proof the bank has paid the learner. The separate provider status preserves that distinction. Amounts use remaining immutable source value; original processing fees remain absorbed.

The existing learner/source locks serialize recording with booking. Identical retries reuse the reduction; a reused provider ID with different source/units is refused. Already allocated lesson hours cannot be removed through this recorder. Resolve eligible cancellations separately and refresh the unused balance first. Record each source against its own original payment.

**Recorded refunds** remains visible when no hours are left. For a pending record, use **Record refund status** once Stripe shows Succeeded, Failed or Canceled. This appends audited evidence without another deduction or Stripe call. Failed/canceled outcomes stay unavailable for booking and require an operator review of repayment or a separately reviewed restoration; no automatic restoration or new refund is performed. Terminal outcome corrections require review. Provider status is manually recorded from Stripe, not polled or verified by this endpoint.

No migration or feature activation is required. Existing completed records without status metadata retain their historical succeeded interpretation. Existing bank-transfer purchase restrictions remain: this recorder requires the original Stripe payment identity. New status events contain only refund identity/status and reuse the existing learner export, anonymisation and financial retention paths; do not enter personal bank details in evidence references.


## Monitoring and incident response

### Payment authorisation failure history

The Flexible Hours webhook accepts signed live `payment_intent.payment_failed`
events. It retrieves the attempt's saved Checkout using the dedicated restricted
key and validates the Checkout/PaymentIntent association, school, learner,
immutable product metadata, amount, currency and payment configuration before
recording evidence. The restricted key needs Checkout Session read permission.

Each Stripe event creates at most one `payment_authorisation_failed` state event
and one payment-event record. Only provider time, event/payment IDs and bounded
error/decline codes are retained; raw error messages, billing details and client
secrets are not copied. Existing Flexible Hours GDPR export and anonymisation
cover these state events. Repeated delivery increments the delivery count.

The admin Packages page shows the latest 200 failures, newest provider timestamp
first, with learner, package, amount, failure count per checkout, current checkout
status and a Stripe payment link. Previously failed checkouts that later succeed
are labelled "Subsequently paid". A failure does not terminate an open Checkout,
change its status, grant hours or run post-trial discount settlement processing.

Rollout: deploy the handler and admin changes, then add
`payment_intent.payment_failed` to the existing dedicated live endpoint's enabled
events, preserving its URL, signing secret and all existing Checkout subscriptions.
Verify a signed failure is recorded once and a replay adds no duplicate history.
No migration is needed. Historical failures do not appear automatically; after
activation an operator can resend the relevant Stripe events to this endpoint.
Do not create synthetic events or manually modify balances to backfill history.
If activation must be rolled back, remove only the new event subscription; keep
Checkout fulfilment subscriptions active. Retained diagnostics remain available.

Monitor pending/review attempts, signed-event failures, duplicate delivery counts, entitlement/source counts, raw source reconciliation and exception events. Paid must never regress; valid late success may promote expired/failed/review to paid. On contradiction, grant nothing manually and investigate school, learner, product/version, amount, currency, Checkout, PaymentIntent and Payment Method Configuration identities.

To stop new purchases, set the School 1 live gate to exact Boolean `false`. Do not delete evidence or disable webhook processing for in-flight payments: a later signed success must still fulfil idempotently. Existing hours and bookings remain valid while purchasing is off.
