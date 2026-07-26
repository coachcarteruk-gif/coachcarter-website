# Payout v2 source-ingestion application rollout review

Status: **PREPARED — NOT APPROVED — NOT DEPLOYED**

This packet covers only the application rollout that will begin dual-writing
immutable Payout v2 funding-source evidence for new successful payment
deliveries. Migration 035 is already applied in production and remains
inactive. The only school remains on `payout_engine_version = 'v1'`.

This packet does not approve deployment. It does not approve a historical
source import, the £414 opening recovery adjustment, a payout-engine switch, a
Payout v2 batch, a Connect transfer, a Stripe refund, a platform withdrawal, or
any other Stripe mutation.

## Production state relied upon

- Migration: `db/migrations/035_payout_v2_ledger_foundation.sql`
- Reviewed SHA-256:
  `7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`
- Applied at: `2026-07-26T16:50:34.210Z`
- Schema evidence:
  `db/rollouts/035-payout-v2-schema-only.*`
- Postflight at schema deployment: 25 empty v2 tables, 39 guard triggers, all
  schools on v1
- No historical source import, recovery adjustment, activation, payout, or
  Stripe mutation has occurred

The schema-only approval is exhausted. It cannot be reused as application
deployment approval.

## Exact application artifacts

The machine-verifiable artifact list, byte counts, and SHA-256 values are in:

`db/rollouts/payout-v2-source-ingestion-application.manifest.json`

The application files in the reviewed packet are:

| File | Rollout responsibility |
|---|---|
| `api/_payout-v2-contracts.js` | Versioned deterministic source fingerprints |
| `api/_payout-v2-source-writer.js` | Single immutable, school-scoped source writer and zero-value legacy/manual-review classification |
| `api/_stripe-event-receipts.js` | Durable Stripe event claim, processed replay no-op, failed/stale retry lease, and immutable receipt conflict |
| `api/_stripe-fee.js` | Read-only PaymentIntent → Charge → balance-transaction and fee evidence |
| `api/webhook.js` | Signature-first event dispatch, canonical tenant relationship check, v1 processing, and additive source write |
| `api/offers.js` | Same-school paid-offer Checkout producer and offer relationship hardening |
| `api/slots.js` | Direct-slot producers and explicit request metadata copied to the manual-capture PaymentIntent |

`api/credits.js`, `api/instructor.js`, and `api/_lesson-requests.js` remain part
of the existing payment lifecycle but do not gain a new Payout v2 mutation
entry point in this rollout. Retired credit-purchase creation routes remain
retired; only already-created/in-flight successful credit payments can reach
the compatibility webhook.

## Production routes and signed events affected

The only route that writes a Payout v2 row is:

- `POST /api/webhook`

Existing producer routes whose successful Stripe payments can later reach that
webhook are:

- `POST /api/slots?action=checkout-slot`
- `POST /api/slots?action=checkout-slot-guest`
- `POST /api/slots?action=checkout-test-date`
- `POST /api/offers?action=accept-offer`
- `POST /api/slots?action=checkout-request`
- `POST /api/instructor?action=accept-request` (existing capture action)

The webhook accepts source-ingestion work only for these signed success
deliveries:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.succeeded`

The covered `payment_type` values are:

- `credit_purchase`
- `slot_booking`
- `lesson_offer`
- `lesson_request_hold` after capture

Credit-purchase `checkout` and `create-payment-intent` application routes still
return their existing retired response. This rollout does not reopen them.

## Behaviour before and after

### Before

Successful payment handlers create the current v1 credit transaction, learner
credit mutation, booking, booking-credit-source attribution, offer state, or
request state. Stripe fee snapshots are best-effort v1 fields. No
`payout_funding_sources` or source-ingestion `stripe_event_receipts` evidence is
required for the existing payment to complete.

### After the future application deployment

1. Stripe signature verification still happens first, using the raw request.
2. A supported event with explicit `metadata.school_id` must prove its
   school-scoped learner, instructor, and payment relationship before a v2
   receipt is claimed.
3. The existing v1 payment path runs with its existing idempotency and booking,
   credit, refund, and payout semantics.
4. Once the existing `credit_transactions` row exists, the webhook inserts or
   idempotently replays one immutable `payout_funding_sources` row.
5. Positive `stripe_backed` value requires all of:
   - a succeeded PaymentIntent;
   - a paid and captured Charge linked to that PaymentIntent;
   - a balance transaction linked to that Charge;
   - matching GBP amount evidence;
   - the exact balance-transaction fee.
6. Missing or contradictory payment evidence produces
   `funding_class='manual_review'`, `source_status='manual_review'`,
   `payable_pool_pence=0`, and `refundable_pool_pence=0`.
7. A captured request-to-book event does not create source evidence until the
   accepted, same-school request has both a booking and its `slot_purchase`
   credit transaction. If local state is not ready, the receipt fails and the
   webhook returns 500 so Stripe can retry.
8. A processed event replay returns a no-op. A failed or genuinely stale
   processing receipt can be reclaimed; a fresh retry lease prevents a second
   concurrent worker from reclaiming the same old failed receipt.

No current lesson type, custom rate, instructor rate, school price, live list
price, or bulk-price fallback is consulted to classify source value.

Older signed events that lack explicit `school_id` continue through the
existing v1 compatibility resolver but do not create a v2 receipt or source.
Every current producer in scope writes explicit school metadata. This exception
exists only to avoid changing historical v1 replay behaviour; it is not a
permitted shape for new Payout v2 evidence.

## Proof that v1 remains authoritative

- The school engine value is not changed by any reviewed artifact.
- `api/_payout-helpers.js` remains the live Friday payout implementation for a
  v1 school.
- Source ingestion writes only `payout_funding_sources` and operational
  `stripe_event_receipts`.
- No reviewed source-ingestion file creates `booking_earnings`,
  `payout_batches`, `payout_transfers`, `payout_adjustments`, cutover evidence,
  or protected-balance configuration.
- No live API, admin, webhook, or cron route imports
  `_payout-v2-transfer-executor.js`, `_payout-v2-cutover.js`,
  `_payout-v2-materializer.js`, `_payout-v2-historical-import.js`,
  `_payout-v2-recovery.js`, `_payout-v2-authority.js`,
  `_payout-v2-protected-balance.js`, or `_payout-v2-webhook.js`.
- The source-ingestion helper uses Stripe reads only. It adds no Stripe POST or
  mutation.
- Existing booking states, credit balances, BCS rows, refund ledgers, v1 payout
  parents/lines, and Connect transfer execution remain unchanged.

The application dual-write is “inactive” in the payout-authority sense: it
collects evidence, but no v2 planner, batch, transfer, cutover, cron, or admin
mutation becomes reachable.

## Failure behaviour

| Failure | Result |
|---|---|
| Invalid Stripe signature | 400 before database or Stripe read work |
| Missing explicit school ID on an old delivery | Existing v1 compatibility handling only; no v2 receipt/source |
| Cross-school or contradictory learner/instructor/payment relationship | 500 before receipt claim and before that delivery’s v1 mutation; Stripe retry remains available |
| PaymentIntent/Charge/balance-transaction/fee evidence missing or contradictory | Existing v1 path completes; immutable v2 source is zero-value `manual_review` |
| Captured request local booking/source not ready | Receipt marked failed, 500 returned, Stripe retries |
| Source insert/database failure after an existing v1 write | Receipt marked failed, 500 returned; retry reuses existing v1 idempotency rows and attempts the missing v2 source |
| Immutable source replay contradiction | Existing row is not changed; webhook fails retryably for operator investigation |
| Processed event replay | 200 duplicate no-op |
| Stripe read outage | No positive source is inferred. Current helper records zero-value manual review rather than inventing fee/value evidence |

The application continues to await source and receipt writes before returning
success. Vercel cannot terminate the dual-write after an early `res.json()`.

## Rollback

Application rollback is a redeploy of the previously reviewed application
version. It must not:

- delete or update `payout_funding_sources`;
- delete or rewrite `stripe_event_receipts`;
- drop migration 035 tables or triggers;
- run a historical import to “fill the gap” without separate review;
- change `payout_engine_version`;
- enable v2 execution;
- retry any ambiguous money action with a new idempotency key.

Because v1 remains authoritative throughout, application rollback does not
switch payout engines or alter the Friday payout route. Any sources legitimately
created before rollback remain immutable evidence. A source-ingestion gap during
the rollback window becomes a reconciliation item for a later, separately
reviewed import or repair process.

If the rollout creates an unexpected level of retrying webhook failures:

1. redeploy the prior application version;
2. keep the school on v1;
3. leave all v2 rows intact;
4. retain affected Stripe event IDs and local error evidence;
5. run read-only reconciliation;
6. stop before any source backfill, recovery, activation, or Stripe mutation.

## Focused verification

Unit/static/webhook contract selection:

```text
CC_TEST_BASE_URL=http://127.0.0.1:9 npx playwright test \
  tests/payout-v2-source-ingestion.spec.js \
  tests/payout-v2-historical-import.spec.js \
  tests/payout-v2-source-ingestion-rollout-review.spec.js \
  tests/payout-v2-schema-rollout-review.spec.js \
  tests/webhook-slot-booking.spec.js \
  tests/webhook-offer-bcs.spec.js \
  --workers=1
```

Rollback-only database selection:

```text
CC_TEST_DB=1 CC_TEST_BASE_URL=http://127.0.0.1:9 \
  npx playwright test tests/payout-v2-source-ingestion.integration.spec.js \
  --workers=1
```

The database suite refuses to run when `POSTGRES_URL_TEST` equals
`POSTGRES_URL`, starts a transaction, reapplies the idempotent schema contract
inside that test transaction, and always rolls back.

Machine review:

```text
npm run review:payout-v2-source-ingestion
```

The verifier checks the exact application hashes, the applied migration hash,
signature/scope/receipt ordering, the four source types, zero-value
manual-review and legacy rules, absence of live-price evidence, request retry
ordering, read-only Stripe evidence calls, live-route isolation, v1 authority,
and this packet’s terminal status.

## Future production preflight checklist

This checklist is for a later separately approved deployment window. Running it
is not authorised by this packet.

- [ ] Re-run `npm run review:payout-v2-schema`; require
      `SCHEMA_APPLIED_INACTIVE`.
- [ ] Re-run `npm run review:payout-v2-source-ingestion`; require
      `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- [ ] Confirm every application artifact hash matches the source-ingestion
      manifest.
- [ ] Confirm the reviewed migration hash is still
      `7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`.
- [ ] Confirm every school is still `payout_engine_version='v1'`.
- [ ] Confirm no v2 transfer/cutover/admin mutation route or cron is reachable.
- [ ] Confirm no payout, refund, migration, financial repair, or incident
      response is running.
- [ ] Confirm current webhook signing secret configuration and raw-body
      signature verification.
- [ ] Confirm current Checkout/PaymentIntent producers include explicit
      `school_id`, `learner_id`, `instructor_id`, and `payment_type`.
- [ ] Run the focused unit/static/webhook selection.
- [ ] Run the rollback-only database suite against the isolated test database.
- [ ] Capture deployment commit, artifact manifest, reviewer, operator, target
      environment, and maintenance window.
- [ ] Obtain a new explicit application deployment approval. Schema approval is
      not sufficient.

## Future production postflight checklist

This checklist is read-only. It does not authorise repair or backfill.

- [ ] Confirm the deployed commit/artifact hashes match the reviewed manifest.
- [ ] Confirm every school remains on v1.
- [ ] Confirm v1 checkout, booking, offer, request capture, credit, refund, and
      payout behaviour is unchanged.
- [ ] Exercise one approved test-mode event per source type; do not create a
      live payment solely for postflight.
- [ ] Confirm processed event replay is a no-op.
- [ ] Confirm a newly created positive source has matching school, learner,
      instructor, credit transaction, PaymentIntent, Charge, balance
      transaction, GBP amount, and fee identities.
- [ ] Confirm any missing-evidence fixture is zero-value `manual_review`.
- [ ] Run
      `db/diagnostics/payout-v2-source-ingestion-reconciliation.sql` read-only
      for the explicit school.
- [ ] Confirm no positive legacy source, cross-school source, duplicate Stripe
      identity, stuck receipt, or unexplained source conflict.
- [ ] Confirm all v2 earning, batch, transfer, adjustment, cutover, and
      protected-balance evidence tables remain empty unless separately
      authorised work predates this rollout.
- [ ] Retain sanitized postflight counts, blocker codes, deployment identity,
      and reviewer sign-off.

Any postflight discrepancy means stop. Do not fix it with production SQL,
historical import, source-row updates, an engine switch, a payout, or a Stripe
mutation.

## Explicit exclusions

This rollout excludes:

- application deployment;
- historical source preview/apply against production;
- any historical source row creation;
- the £414 recovery adjustment;
- `payout_engine_version` changes;
- shadow-cycle acceptance;
- reserve calculation/configuration;
- protected-balance snapshot creation;
- v2 earning materialisation;
- payout batch creation;
- transfer execution or reconciliation cron wiring;
- connected-bank webhook wiring;
- admin, public, native, or cron payout-v2 mutation routes;
- live Stripe reads performed solely for rollout review;
- all live Stripe mutations;
- payout execution;
- platform withdrawal;
- refund-executor broadening;
- booking, credit, BCS, refund, or v1 payout policy changes.

## Decisions still outstanding

No recorded owner decision needs to be reopened for this application review.
The direct-instructor route, Fraser-first rollout, £10 cap, Fraser-only mutation
operator, block-unless-proven external/cash/Setmore policy, two-cycle
observation period, and retain-all-residual-cash policy are preserved.

Two future approvals/evidence items remain intentionally absent:

1. explicit approval to deploy this exact application artifact set; and
2. much later, before any activation or money movement, a fresh global
   protected-balance calculation that produces the exact reserve pence and
   fingerprint. It must never be guessed or defaulted to zero.

Neither item is needed to review the inactive evidence-ingestion code. Both
remain blocking at their respective future mutation boundary.

Final status: **PREPARED — NOT APPROVED — NOT DEPLOYED**
