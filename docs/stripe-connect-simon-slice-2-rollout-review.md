# Stripe Connect Simon launch — Slice 2 rollout review

Status: **STEP 16 FINAL EVIDENCE PACKAGE COMPLETE — SLICE 2 NOT FORMALLY
ACCEPTED — STEP 17 NOT STARTED — NO SLICE 3**

This packet covers Slice 2 only: immutable payment candidate metadata, exact
Stripe payment/fee/availability evidence, one-payment-to-one-active-lesson
contracts, webhook replay handling, pending-evidence reconciliation, and
explicit isolation from the legacy payout planner and transfer executor.

No production command in this packet is authorised. It does not authorise a
migration application, config/agreement row, historic backfill, Stripe API mutation,
Connect onboarding, payout, transfer, refund, payout-engine switch, or money
movement. The two untracked Simon product/technical plan documents remain
reference material and are not rollout artifacts.

The production rollout status remains
**PREPARED — NOT APPROVED — NOT DEPLOYED**. Completing this evidence package is
not the formal Slice 2 decision
and grants no authority for Step 17, Slice 3, or a provider, database, Stripe,
payment, refund, payout, transfer, or production mutation.

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

## Step 16 final Slice 2 evidence package — 8 August 2026

**Outcome:** Step 16 is complete. Every required retained count matched fresh
read-only inspection and every prohibited-effect count remained zero. Slice 2
is still not formally accepted. Step 17 and Slice 3 have not begun.

### Provenance and immutable identities

Evidence was collected on 8 August 2026 from local Git objects and files,
GitHub metadata and Actions, connected read-only Vercel and Neon control-plane
views, explicitly school-scoped read-only Neon SQL, and the authenticated
Stripe Dashboard. No secret, connection string, raw IP, request header, or
sensitive payload is retained here.

| Boundary | Exact retained evidence |
|---|---|
| Repository | PR [#353](https://github.com/coachcarteruk-gif/coachcarter-website/pull/353) is merged. Source `fe75c7a70f565fe73a6dd41d62ef08df4959b0e1` on `codex/simon-shadow05-step15-prohibited-effects-postflight`; squash merge and current `origin/main` `b9aee19d71598364c4d6ff33d9ad4f4631535890`. Previous Step 15 baseline `ec648a578949fe8e585fee13f125df74311743b2` is an ancestor. PR #353 changed only `docs/stripe-connect-simon-launch-project-log.md`. |
| GitHub Actions | Exact merge-commit push run [31227210226](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31227210226), workflow `ci`, branch `main`, completed `success`; created `2026-08-07T23:28:01Z`, completed/updated `2026-08-07T23:29:43Z`. |
| Vercel | Project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, name `cc-simon-s2-shadow-05`; deployment `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`, target `production`, state `READY`; alias `cc-simon-s2-shadow-05.vercel.app`; deployed application Git SHA `07871219afc9fc66084f2f8bc1bf609b23802dfd`. |
| Neon | Project `shiny-bonus-66942766`; default/primary branch `br-empty-cell-za5kh6nr` named `production`, state `ready`; database `neondb`; every tenant-table query below explicitly used `school_id=1`. |
| Stripe | Sandbox/Test account `acct_1QUSsNIqhTSdZedS`. Dedicated active destination `we_1U0qdyIqhTSdZedS2h8O3RxW`, name `cc-simon-s2-shadow-05`, exact endpoint `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`, API version `2024-11-20.acacia`, listening to exactly eight events. The separate live destination view has no shadow-05 binding. |
| Protected product specification | LF-normalised SHA-256 `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`. |
| Protected technical plan | LF-normalised SHA-256 `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`. |

The webhook event set is exactly `account.updated`, `charge.failed`,
`checkout.session.async_payment_failed`,
`checkout.session.async_payment_succeeded`, `checkout.session.completed`,
`checkout.session.expired`, `payment_intent.payment_failed`, and
`payment_intent.succeeded`.

### Four-origin and terminal-state matrix

Fresh read-only Neon evidence for exact `school_id=1` produced:

| Origin | Complete contracts | Complete launch sources | Pending | Contradictory | Ineligible |
|---|---:|---:|---:|---:|---:|
| `direct_slot` | 1 | 1 | 0 | 0 | 0 |
| `test_date_direct` | 1 | 1 | 0 | 0 | 0 |
| `one_off_offer` | 1 | 1 | 0 | 0 | 0 |
| `captured_request` | 1 | 1 | 0 | 0 | 0 |

Across the school, pending contracts, contradictory contracts, ineligible
post-cutover contracts, unsupported origins, and unmaterialized origins are
each exactly `0`. The single launch config remains accounting version
`simon_launch_v1`, mode `shadow`, cutover
`2026-08-04T21:19:37.270Z`, with no activation or pause.

### Protected direct-slot contract and source

Contract `4af03473-9cfd-4051-9606-654245e1b6ab` is singular and complete for
`school_id=1`, origin/regime `direct_slot`/`launch`. It retains gross `8250`,
Stripe fee `288`, currency `gbp`, split `9000` bps, PaymentIntent
`pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
`ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
`txn_3U0qsPIqhTSdZedS2gWKkLmQ`, payment creation
`2026-08-04T22:32:01.000Z`, funds availability
`2026-08-07T00:00:00.000Z`, exactly one active scheduled/chargeable booking,
and null ineligibility and contradiction codes.

Its singular source `1` is `stripe_backed`, `available`, and complete. It
retains gross `8250`, fee `288`, payable pool `7962`, refundable pool `7962`,
currency `gbp`, the exact same origin/contract/Stripe identities and times, and
a null contradiction code. The Stripe Sandbox payment view independently
reconfirmed succeeded GBP `82.50`, fee GBP `2.88`, net GBP `79.62`, exact
PaymentIntent and charge, and funds available on 7 August.

### Audit, receipts, and prohibited effects

- Audit evidence is exactly one
  `stripe-launch-shadow-reconcile-payments-started` row and exactly one
  `stripe-launch-shadow-reconcile-payments` row. Both retain operation
  `reconcile_payments` and Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`. Completion is exactly `checked=1`,
  `completed=1`, `pending=0`, `contradictory=0`, and `failed=0`.
- Stripe receipt counts are exactly `total=4`, `test-mode=4`, `processed=4`,
  `live=0`, `failed=0`, `processing=0`, and `duplicate IDs=0`; `received=0`
  and `manual_review=0` also remain zero.
- The complete school-1 prohibited-effect matrix is exactly zero:
  `stripe_launch_booking_earnings`, `payout_runs`,
  `instructor_payout_batches`, `stripe_launch_transfer_intents`,
  `stripe_launch_transfer_attempts`, `refund_intents`, `refund_attempts`,
  `connect_account_state_events`, `payout_statements`,
  `payout_statement_delivery_attempts`, `payment_disputes`,
  `payment_dispute_events`, `instructor_payout_obligations`,
  `instructor_payout_obligation_applications`, and
  `payout_batch_earning_dispositions` are all `0`.

### Step 14 cross-cutting evidence and Step 16 validation

The committed Step 14 evidence records passing delayed-evidence recovery,
webhook/reconciliation replay idempotency, exact-fee handling, known fee,
amount, currency, and Stripe-link contradiction rejection, one-payment-to-many-
lessons rejection, pre-cutover ineligibility, reschedule continuity,
cross-school isolation, shadow-auth fail-closed paths, required audit start and
completion, audit-write fail-closed behaviour, webhook post-commit reliability,
and absence of prohibited money/Connect writers.

Step 16 freshly reproduced the local non-database matrix: syntax `199` files,
C1 controls `271` files, all `14/14` Slice 2 static rollout checks with zero
failures and status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, and the same focused
Playwright selection `80/80`. `git diff --check`, protected hashes, and the
authorised two-document diff are publication gates and must remain green at
commit time.

### Explicit limitations

- Step 16 did not invoke reconciliation, request expiry, a webhook, Checkout,
  PaymentIntent, payment, or any mutation. It did not change a provider,
  environment variable, deployment, credential, database row, schema, or
  production resource. The Stripe plugin was neither installed nor used.
- Step 14's triple-gated rollback-only PostgreSQL integration result (`8/8`,
  zero skips, disposable confirmed non-production loopback PostgreSQL 17.7) is
  retained from the merged, committed handover and was not rerun in Step 16:
  no disposable database was provisioned for this documentation/read-only
  task. Its current source-level contracts were covered by the fresh `80/80`
  selection and current `main` CI, but the historical database execution itself
  is not independently reproduced by this package.
- Historical request/response timing and the action-time owner confirmation for
  the single Step 14 reconciliation are retained from the committed Step 14/15
  handovers. Step 16 independently reverified the resulting exact database,
  audit, receipt, Stripe, Vercel, Neon, repository, and CI state read-only; it
  intentionally did not replay the operation.
- This package establishes evidence completeness for Step 16 only. A separate,
  explicitly authorised Step 17 review must make any formal `SLICE 2 ACCEPTED`
  or rejection decision. No such decision is made here.

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
