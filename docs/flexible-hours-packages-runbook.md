# Flexible Hours packages runbook

## Status and hard boundary

The repository contains the production-shaped Flexible Hours implementation, but it is inert by default. This runbook does not authorise a production migration, live Stripe configuration, gate activation, Checkout creation, deployment or merge. Each requires a later explicit approval.

Full Curriculum remains test-only and isolated. Do not reuse its restricted key, Payment Method Configuration, webhook secret, endpoint or purchasing gate. Do not reuse Reserved Weekly Slot payment identities.

## Product contract

| Product | Price | Entitlement | Frozen unit rate |
|---|---:|---:|---:|
| 15-hour Flexible Hours | £810 | 30 × 30 minutes | £27.00 |
| 30-hour Flexible Hours | £1,590 | 60 × 30 minutes | £26.50 |

Hours are school-wide, do not expire and cannot transfer to another learner. FIFO allocation preserves the immutable source. A booking carries its delivering instructor and frozen allocated value into the normal scheduled/chargeable/refunded payout lifecycle. Purchase alone creates no earning or payout.

At 48+ hours, learner cancellation returns each exact allocation once. Under 48 hours/no-show consumes it and leaves the booking payable. Durations not divisible by 30 minutes fail closed. Unused source units are refunded at their frozen rate; CoachCarter absorbs the original Stripe fee.

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

1. Review migration 050 and the money-flow diff.
2. Apply and verify it only on the confirmed disposable Neon branch.
3. Run syntax, focused unit/contract tests and the gated fresh-schema integration suite.
4. Configure and inspect the three dedicated live Stripe resources while the school gate remains false.
5. Confirm current immutable versions, School 1 scope, signature rejection, replay, late success, failure/expiry and return-page non-fulfilment.
6. Confirm a purchase creates exactly one purchase/source and no earning/payout row.
7. Confirm a same-school instructor booking consumes FIFO units, stores frozen `list_price_pence`, and rejects another school/inactive instructor and incompatible duration.
8. Confirm 48+ cancellation returns exact allocations once and under-48 cancellation remains scheduled/payable.
9. Confirm admin reconciliation, GDPR export/anonymisation and manual original-method refund evidence.
10. Only after separate explicit approval, set exact Boolean School 1 feature `learner_flexible_package_purchasing_live_enabled` to `true` through a controlled configuration change. There is intentionally no admin-page setter.

## Refund operation

The application never calls `stripe.refunds.create` for Flexible Hours. An operator previews unused source value, issues each refund manually to that source's original PaymentIntent/payment method, then records its `re_...` identity, units, evidence reference and reason. The recorder rejects more units than remain and writes the source reduction, state event and audit row atomically. Never deduct the original Stripe fee from the learner.

## Monitoring and incident response

Monitor pending/review attempts, signed-event failures, duplicate delivery counts, entitlement/source counts, raw source reconciliation and exception events. Paid must never regress; valid late success may promote expired/failed/review to paid. On contradiction, grant nothing manually and investigate school, learner, product/version, amount, currency, Checkout, PaymentIntent and Payment Method Configuration identities.

To stop new purchases, set the School 1 live gate to exact Boolean `false`. Do not delete evidence or disable webhook processing for in-flight payments: a later signed success must still fulfil idempotently. Existing hours and bookings remain valid while purchasing is off.
