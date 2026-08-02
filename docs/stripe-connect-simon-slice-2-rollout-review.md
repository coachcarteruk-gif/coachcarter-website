# Stripe Connect Simon launch — Slice 2 rollout review

Status: **SHADOW-01 FAILED; REPAIR PREPARED — NOT APPROVED — NOT DEPLOYED**

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
- Missing balance-transaction evidence leaves the already durable booking,
  slot-purchase transaction, BCS attribution, and immutable Stripe candidate
  metadata as a retryable origin. The webhook succeeds without creating a
  guessed source or contract.
- Reconciliation processes both pending contracts and eligible local Slice 2
  origins with no contract. It retrieves only their exact Checkout Session or
  PaymentIntent identity and re-enters the same idempotent materializer.
- A legacy `credit_transactions.stripe_fee_pence=NULL` plus provisional BCS
  fee `0` is treated as unknown, not evidence of a zero-fee charge. Any known
  local fee that differs from exact Stripe balance-transaction evidence remains
  terminal/manual-review and cannot become complete.
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
- Incomplete Stripe evidence does not fail an otherwise successful booking
  webhook. Reconciliation retries the durable payment origin. Missing or
  contradictory candidate identity and local booking attribution still fail
  closed.
- If the application rollout causes unexpected failures, redeploy the prior
  application build and leave every existing school configuration unchanged.
- Do not delete or rewrite contract, source, receipt, booking-credit, refund, or accounting rows.
- Do not backfill the resulting gap, change a cutover timestamp, or issue a
  Stripe request without a new, explicit approval and reviewed repair plan.

## Exact prerequisites and pass gates for `cc-simon-s2-shadow-02`

Creating or exercising shadow-02 remains unauthorised until every prerequisite
below is independently reviewed:

1. Create a fresh isolated Vercel project and fresh database branch named for
   `cc-simon-s2-shadow-02`; do not clone, repair, query, or reuse shadow-01.
2. Deploy this repair only after its branch/PR is approved. Apply the already
   reviewed Slice 1/2 schema migrations to shadow-02 only; do not apply a new
   migration for this repair (none is required).
3. Configure test-only application credentials and require
   `STRIPE_MODE=test`. Use a restricted Stripe test key with the existing
   reconciliation read permissions only; do not broaden it or use a live key.
4. Bind shadow operations with all of the following exact environment values:
   `STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED=true`,
   `STRIPE_LAUNCH_SHADOW_PROJECT_ID=<shadow-02 Vercel project id>`,
   `STRIPE_LAUNCH_SHADOW_SCHOOL_ID=<exercise school id>`, and a unique random
   `STRIPE_LAUNCH_SHADOW_CRON_SECRET` of at least 32 characters. The runtime
   `VERCEL_PROJECT_ID` must exactly match the configured project ID. Do not
   configure or use the global `CRON_SECRET` for the manual shadow exercise.
5. Seed one exercise school through supported application/admin paths. Create
   or update the instructor through the authenticated admin instructor route
   (which writes an audit event), then sign in using the real emailed
   instructor code at `/instructor/login.html?school_id=<exercise school id>`
   (which now writes an audit event). Never read a login code, password, token,
   or secret from the database.
6. Create exactly one active `simon_launch_v1`/`shadow` launch config and one
   active, payment-time-valid instructor payout agreement for that school.
   Confirm all other schools have no launch config.
7. Invoke only these shadow endpoints with the shadow bearer secret and exact
   `school_id`: `GET /api/cron-reconcile-payments?school_id=...` and
   `GET /api/requests?action=expire-requests&school_id=...`. Require an audit
   start row before work and a completion row for each invocation; an audit
   write failure must stop before work. The shadow credential must receive 401 for a wrong
   project, non-test mode, wrong/missing school, wrong secret, disabled flag,
   or any unsupported operation.
8. Before the exercise, require syntax and focused/unit suites green plus the
   rollback-only database suite green against a separately confirmed
   production-shaped non-production test database that is neither production
   nor shadow-01.

The exercise passes only if all four origins complete exactly once; a deliberately
delayed balance transaction first leaves no guessed source/contract and later
reconciles to one complete contract; duplicate webhook/reconciliation attempts
create no duplicate booking, BCS, source, or contract; the exact Stripe fee is
accepted from balance-transaction evidence; an injected known fee mismatch is
terminal contradictory; cross-school candidates are untouched; both shadow
operations are authenticated and audited; and there are zero launch earnings,
refund intents, transfer intents, transfers, payouts, or production/live Stripe
effects. Any failed receipt, missing origin, contradiction outside the injected
mismatch, unaudited operation, auth bypass, tenant leak, or money-movement row is
an immediate FAIL and stop condition. Instructor sign-in must likewise issue no
session if its required audit row cannot be persisted.

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
