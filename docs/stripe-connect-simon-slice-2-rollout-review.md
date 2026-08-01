# Stripe Connect Simon launch — Slice 2 rollout review

Status: **PREPARED — NOT APPROVED — NOT DEPLOYED**

This packet covers Slice 2 only: immutable payment candidate metadata, exact
Stripe payment/fee/availability evidence, one-payment-to-one-active-lesson
contracts, webhook replay handling, pending-evidence reconciliation, and
explicit isolation from the legacy payout planner and transfer executor.

No production command in this packet is authorised. It does not authorise a
migration application, config/agreement row, historic backfill, Stripe API mutation,
Connect onboarding, payout, transfer, refund, payout-engine switch, or money
movement. The two untracked Simon product/technical plan documents remain
reference material and are not rollout artifacts.

## Prepared behaviour

- Without one school-scoped `simon_launch_v1` config in exact mode `shadow`,
  checkout metadata and webhook contract writes are inert.
- With that future, separately approved test/shadow configuration, only direct
  slot, practical test-date direct, one-off offer, and captured request
  payments receive a UUID candidate and origin.
- Flexible/repeating offers, credit purchases, and other legacy shapes create
  no Slice 2 source or contract.
- Webhook materialization revalidates the school, learner, instructor, booking,
  booking-credit source, amount, fee, PaymentIntent, Charge, balance
  transaction, Stripe creation time, funds-available time, origin, agreement,
  and the exactly-one-active-booking mapping.
- Missing evidence fails retryably and creates no guessed financial row.
  Contradictory evidence is terminal/manual-review and cannot become complete.
- Stripe payment creation time, not webhook arrival or lesson date, determines
  pre/post-cutover regime. Pre-cutover payments are ineligible.
- Pending funds can only progress through the read-only Stripe evidence
  reconciler while the school remains in `shadow`.
- The existing payout planner and transfer executor exclude every funding
  source tagged `launch_accounting_version=simon_launch_v1`.
- Migration 040 is a forward-only correction to the Slice 1 payout-source
  fill-once guard. It permits only the intended first NULL-to-value evidence
  link and retains rejection of replacements, historic-field changes, deletes,
  and terminal evidence reclassification.
- Slice 2 creates no earning, refund, transfer, onboarding, or Connect resource.

## Failure and rollback rules

- Webhook replay uses the existing Stripe receipt lease plus database unique
  payment/candidate/source identities. A contradictory replay never overwrites
  immutable facts.
- If evidence is incomplete or local booking attribution is not ready, the
  webhook fails so the same signed Stripe delivery can be retried.
- If the application rollout causes unexpected failures, redeploy the prior
  application build and leave every existing school configuration unchanged.
- Do not delete or rewrite contract, source, receipt, booking-credit, refund, or accounting rows.
- Do not backfill the resulting gap, change a cutover timestamp, or issue a
  Stripe request without a new, explicit approval and reviewed repair plan.

## Proposed production rollout — not authorised

1. Obtain fresh approval for the reviewed Slice 2 corrective migration and
   application deployment. Do not reuse Slice 0 or Slice 1 approval.
2. Re-run syntax, focused tests, the rollback-only integration suite against a
   production-shaped non-production database, and
   `npm run review:stripe-launch-slice-2`.
3. Run `db/diagnostics/stripe-launch-slice-2-preflight.sql` read-only against
   production. Require Slice 1 schema present, no unexpected launch bridge
   data, and zero unapproved launch earnings/transfers/refunds. Record whether
   the fill-once correction is already present.
4. In a separately controlled migration step, apply only
   `db/migrations/040_stripe_launch_payout_source_fill_once_fix.sql`. It replaces
   one trigger function and writes no table rows. Do not create or change a
   launch config/agreement row.
5. Verify the corrected function definition, then deploy the application code
   with all schools still unconfigured/disabled for Simon launch behaviour.
6. Run `db/diagnostics/stripe-launch-slice-2-postflight.sql` read-only. With no
   approved shadow config, expect no new Slice 2 contract/source rows.
7. Observe webhook success/retry/error metrics and current v1 payment paths.
   Roll back the application if unexplained failures appear.
8. A later test/staging shadow activation requires its own named approval,
   exact school/config/agreement evidence, and Stripe test-mode exercises for
   all four origins. Production shadow activation is a still later decision.
9. Stop after evidence review. Payouts, refunds, transfers, onboarding,
   production data seeding/backfill, and live/approval modes remain out of scope.

## Verification commands

```text
npm run check:syntax
npm run review:stripe-launch-slice-2
CC_TEST_BASE_URL=http://127.0.0.1:9 npm test -- \
  tests/stripe-launch-payment-contracts.spec.js \
  tests/stripe-launch-slice-2-rollout-review.spec.js --workers=1
```

The database suite is triple-gated and rollback-only:

```text
CC_TEST_DB=1 CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1 \
CC_TEST_BASE_URL=http://127.0.0.1:9 npm test -- \
  tests/stripe-launch-payment-contracts.integration.spec.js --workers=1
```

It refuses a test URL equal to `POSTGRES_URL`, skips when the target lacks the
production-shaped base schema, applies migration 040 inside its outer test
transaction, and rolls the migration and every fixture row back at suite end.
