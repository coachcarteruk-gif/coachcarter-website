# Instructor Payout v2 — Source-Backed Ledger and Controlled Cutover Plan

**Status:** Migration 035 was applied schema-only on 26 July 2026 and remains inactive. The source-ingestion application rollout is prepared for review but is not approved or deployed. Slice 0/1, inactive Slice 2A/2B, the inactive full-offset recovery foundation, inactive Slice 3 shadow earning/materialisation, inactive Slice 4 durable transfer execution/reconciliation, inactive Slice 5 signed webhook ingestion/bank-payout visibility, and inactive Slice 6 protected-balance/operator controls remain disconnected from payout execution; no historical import, opening recovery, real Stripe mutation, payout, or platform withdrawal has occurred, no transfer/cutover cron or mutation route is connected, and `payout_engine_version` remains `v1`
**Prepared:** 25 July 2026
**Scope:** instructor and school payouts, source funding, Stripe Connect transfers, reconciliation, platform liquidity, legacy-credit cutover, and operator visibility
**Primary objective:** make an incorrect, duplicate, cross-tenant, unfunded, or ambiguous instructor payout structurally difficult and operationally visible

---

## 1. Executive decision

CoachCarter should replace the current payout engine with a versioned,
source-backed ledger built alongside the existing system.

This is a controlled restart, not a history wipe:

- Preserve Stripe charges, refunds, transfers, connected accounts, bank payouts,
  bookings, credit transactions, booking credit sources, and existing payout
  rows as immutable financial history.
- Treat the current payout engine and its tables as `v1`.
- Build new `v2` earning, batch, transfer, adjustment, webhook, and
  reconciliation records without rewriting historical financial rows.
- Stop deriving instructor pay from a live lesson type or current learner rate.
- Require every payable penny to trace to an explicit funding source or an
  explicit platform-funded adjustment.
- Run v2 in shadow mode before it is allowed to transfer money.
- Permanently disable all v1 payout mutation routes after the controlled cutover.

The chosen Stripe model remains **separate charges and transfers**. Learners can
pay before a lesson is delivered, while the instructor earns the money only
after the booking becomes `chargeable`. Each later transfer component should be
linked to its underlying Stripe charge with `source_transaction` wherever the
source is Stripe-backed. Stripe documents that a transfer can be tied to the
underlying charge, can wait for that charge to become available, and is limited
by the amount of that charge:

- <https://docs.stripe.com/connect/separate-charges-and-transfers?locale=en-GB>

Do not change to destination charges as part of this work. Destination charges
would move funds at purchase time, before the CoachCarter booking lifecycle says
the instructor has earned them.

---

## 2. Read this context before implementation

The next implementation session must read:

1. `AGENTS.md`
2. `CLAUDE.md`, especially booking status, multi-instructor, pricing, credit,
   tenancy, and money-path rules
3. `PROJECT.md`, especially the current data model and admin endpoints
4. `docs/booking-statuses.md`
5. `docs/stripe-connect.md`
6. `docs/per-instructor-credits-audit.md`
7. `docs/refund-operator-runbook.md`
8. `docs/refund-exposure-valuation-audit.md`
9. `docs/credits-grandfather.md`
10. This plan

Also inspect the implementation as it exists at that time. At preparation time,
the main payout code was:

- `api/_payout-helpers.js`
- `api/cron-payouts.js`
- `api/_platform-balance.js`
- `api/cron-balance-snapshot.js`
- `api/admin.js` payout overview, history, pause, preview, and manual trigger
- `api/instructor.js` earnings and pre-payout `mark-not-delivered` behaviour
- `api/connect.js`
- `api/webhook.js`
- `api/_booking-status.js`
- `db/migration.sql`

The branch was clean on `main` when this document was prepared. Begin
implementation from the latest `main` on a fresh `codex/` branch. Do not assume
the line numbers or repository state are unchanged.

---

## 3. Non-negotiable business rules

### 3.1 Booking lifecycle

`lesson_bookings.status` has exactly three states:

- `scheduled`
- `chargeable`
- `refunded`

The load-bearing product rule remains:

> An instructor is paid for a lesson on their calendar unless the learner gave
> at least 48 hours' notice that it would not happen.

In practice:

- Only a `chargeable` booking can create a positive instructor earning.
- `scheduled` means not yet earned.
- `refunded` means no new earning.
- A late learner cancellation under 48 hours remains scheduled and later becomes
  chargeable.
- Do not restore dual confirmation, “did the lesson happen?” prompts, or old
  booking statuses.
- Use constants and predicates from `api/_booking-status.js`; do not inline new
  status logic.

### 3.2 Legacy pre-Connect credit

The owner has confirmed this accounting policy:

> Legacy credit was collected and paid into Fraser's bank before the Connect
> payout system existed. Spending that legacy credit must never create another
> automated instructor payment.

Therefore:

- `legacy_grandfather` and any equivalent verified pre-Connect source have a
  payout contribution of exactly `0`.
- A legacy credit's remaining minutes can be real learner entitlement while its
  monetary contribution to Payout v2 remains zero.
- Do not value a legacy booking from `lesson_types.price_pence`, a current custom
  learner rate, an instructor rate, a school default, or
  `lesson_bookings.list_price_pence`.
- Do not change historical synthetic legacy transactions from
  `amount_pence = 0`.
- Do not silently backfill a positive payout contribution for a source whose
  money was already settled outside Connect.
- If a non-Fraser instructor is ever expected to deliver against old legacy
  credit, that is not permission to reinterpret the legacy source. An admin must
  deliberately create a **platform-funded adjustment** or first convert the
  learner entitlement through a separately reviewed workflow.

### 3.3 Pricing and instructor economics

- New credit purchases are instructor-scoped.
- Server pricing precedence is:
  1. learner/instructor custom rate;
  2. instructor hourly rate;
  3. school default.
- Bulk discounts apply only where the instructor opted in.
- The instructor absorbs an opted-in bulk discount.
- Direct pay-and-book single lessons do not receive bulk-package discounts.
- Payout uses immutable purchase/booking/source snapshots, never current rates.
- Commercial settings remain admin-editable; do not hardcode new rates or fees.

### 3.4 Tenancy

Every v2 row and every query must carry and enforce `school_id`.

- Never default missing payout scope to school `1`.
- Authentication-derived school scope is authoritative.
- Caller-supplied school, instructor, learner, booking, source, amount, Stripe
  identity, or rate is never trusted.
- Cross-school joins must include matching `school_id`, not only matching IDs.
- A school must have one active payout route for a booking:
  `instructor_direct` or `school`, never both.

### 3.5 Historical records

Financial history is append-only:

- Do not delete or silently modify historical Stripe records.
- Do not delete or silently modify completed v1 payout rows or line items.
- Do not rewrite historical `booking_credit_sources`,
  `credit_source_adjustments`, `refund_events`, or `refund_event_lines`.
- Corrections use explicit v2 adjustment or reversal records with reason,
  evidence, operator, timestamps, and links to the affected rows.

---

## 4. Audit findings that motivated the rebuild

These facts are a **25 July 2026 snapshot** and must be rechecked before any
production cutover.

### 4.1 Stripe and database reconciliation

- All six payout transfers recorded by CoachCarter were found in Stripe.
- Five had reached the relevant connected bank accounts.
- The most recent was still in transit on the audit date.
- No unmatched local transfer or unexplained Stripe transfer was found during
  that inspection.
- This means the current ledger was not visibly corrupt at that point, but the
  implementation still had unsafe failure paths capable of creating corruption.

### 4.2 Confirmed legacy duplicate payment

Five pre-attribution legacy bookings were assigned positive live/list prices
during historical backfill and then entered a Connect payout.

- Confirmed duplicate Connect payment: **£414.00**
- Transfer date: **19 June 2026**
- Root policy violation: the original legacy funds had already been paid to
  Fraser's bank before Connect, so those bookings had no remaining Connect
  payout value.

The £414 must not be erased from history. On 25 July 2026, Fraser chose to
recover it from his future instructor payouts using a full-available-offset
policy:

- deduct up to the whole otherwise-payable instructor amount from each future
  payout;
- never make the transfer negative;
- carry any unrecovered balance into later payout batches; and
- leave payout `7`, its line items, and its Stripe transfer unchanged.

This decision authorises the inactive recovery contract. It does not authorise
creating the opening adjustment in production, activating Payout v2, or
executing a payout.

The audit found no currently eligible, non-zero legacy payout remaining. The
remaining attributed legacy scheduled/chargeable bookings had zero list-price
or zero source contribution. Historical unattributed bookings were additionally
protected by `instructors.payouts_start_date`. Revalidate all of those facts at
cutover.

### 4.3 Why the Stripe balance became insufficient

The platform's bank payout activity removed money before the weekly instructor
transfers:

- Automatic platform bank payouts on 12, 14, and 15 May removed **£2,624.80**.
- 22 May payout attempt: required £412.50; Stripe available £81.06; pending
  £80.73.
- 29 May payout attempt: required £163.53; available £79.29; pending £53.97.
- 5 June payout attempt: required £465.90; available £263.86; pending £107.94.
- 12 June payout attempt: required £679.30; available £316.80; pending £266.13.
- 19 June payout attempt: required £1,042.53; available £1,162.46 and succeeded.

The problem was not merely Stripe settlement timing. Platform withdrawals
removed cash that the application still treated as available for instructor
payouts, while the application had no source-backed reserve enforcement.

### 4.4 Balance-widget weakness

At the audit snapshot:

- Stripe available: **£261.12**
- Stripe pending: **£429.27**
- Next payout preview: **£190.54**
- Available after previewed payout: **£70.58**
- Exact unused-credit exposure: **£245.64**

The widget showed green because it asked only whether the next payout fitted
inside the current available balance. It did not answer whether the platform
could make that payout while retaining enough for unused credit/refund exposure.

These are historical snapshot values, not constants or expected current values.

### 4.5 Unsafe implementation behaviours

The current v1 code had the following structural holes:

1. Stripe transfer creation did not provide an idempotency key.
2. A broad catch block marked a payout failed and deleted its booking claims.
   If Stripe succeeded but the response or later database write failed, the
   booking could be retried and paid twice.
3. Parent payout creation and line-item creation were not one database
   transaction.
4. Direct instructor payouts and school payouts had separate uniqueness
   constraints, allowing the same booking to be claimed once by each route.
5. Direct payout inserts omitted explicit `school_id`; historical schema
   defaults could route rows to school `1`.
6. A Stripe transfer was labelled `completed`, even though this only meant the
   money reached the connected Stripe balance—not that Stripe paid the connected
   bank account.
7. There was no payout-webhook state machine for `payout.paid` and
   `payout.failed`.
8. Failed Friday transfers did not have a safe same-day reconciliation/retry
   mechanism.
9. The expected Stripe fee reconciler was not fully shipped.
10. Preview/read-model logic duplicated simplified payout calculations instead
    of consuming one authoritative planner.
11. Payout mutation authority was too broad; an ordinary admin path could invoke
    global processing under some conditions.
12. School payouts recomputed prices from live data.
13. Missing or pre-attribution funding evidence could fall back to a positive
    price instead of blocking or contributing zero.
14. Happy-path tests passed, but there was no failure injection across the
    Stripe-success/database-failure boundary.

### 4.6 What existing tests established

The focused payout-related test run completed 32/32 successfully during the
audit, and syntax checks covered 168 JavaScript files. This established that the
current tested contracts passed; it did **not** establish exactly-once money
movement under ambiguous failures.

### 4.7 Refreshed Slice 0 forensic — 25 July 2026

Slice 0 was rerun read-only from branch
`codex/payout-v2-ledger-foundation` after synchronising with current `main`.
The reusable evidence command is:

```text
npm run audit:payout-v2
```

It performs database `SELECT`s and Stripe list requests only. It does not apply
a migration or call a Stripe mutation.

Refreshed findings:

- There are 24 `legacy_grandfather` credit sources representing 15,300
  minutes. Their total `amount_pence` is zero and there are zero positive
  source-amount violations.
- Those sources have 43 booking-credit allocations representing 3,566 drawn
  minutes. Total `contribution_pence` and `stripe_fee_pence` are both zero,
  with zero positive-contribution violations.
- 27 chargeable and 3 scheduled legacy-funded bookings remain. Their total
  source contribution and source Stripe fee are zero. Payout v2 must record
  their instructor contribution as zero even if a current lesson price exists.
- The 19 June local payout remains payout `7`: £1,042.53 across 33 lines,
  transfer `tr_1TjyIRIqhTSdZedS4ElxveFp`. The known £414 duplicate legacy
  component remains preserved in that history. The owner has since selected
  full recovery from future Fraser payouts; no production adjustment has been
  created.
- Six successful local transfer IDs now exist. All six were found in Stripe,
  with no unexplained Stripe transfer to the known destination and no duplicate
  local transfer ID. Five connected-account bank payouts are `paid`; the
  £310.25 payout created 25 July is `in_transit` with estimated arrival 27 July.
  No local row is stuck in `processing`, and no `completed` local row is
  missing its Stripe transfer ID.
- School `1` is currently configured for the direct-instructor route: the
  school Connect account is not ready and one instructor Connect account is
  ready. No school currently has simultaneous direct and school route
  capability.
- No booking appears in both current v1 payout line-item families.
- The focused tenant diagnostic found zero mismatches across bookings,
  learners, instructors, credit transactions, booking-credit sources, direct
  payout parents/lines, and school payout parent-to-booking scope.
- Three chargeable bookings are labelled cash and 19 chargeable bookings are
  Setmore/external-shaped. Another 13 Setmore-shaped rows are refunded. Their
  snapshotted list value is zero and none is currently eligible under the v1
  payout query, but the labels do not prove who collected the money or whether
  the instructor was already settled. They remain manual-review cohorts for
  migration.
- The free cohort contains 22 chargeable, 9 refunded, and 4 scheduled rows,
  all with zero snapshotted list value. Payout v2 classifies free funding as
  zero-payable.

Repository discrepancies discovered during the refresh:

1. `school_payout_line_items` has no `school_id`; tenant scope can only be
   derived through `school_payouts`. Payout v2 does not repeat this shape:
   every new table has an explicit, non-defaulted `school_id`, and financial
   foreign keys enforce same-school parent/child relationships.
2. The direct v1 eligibility query still falls back from missing snapshots to a
   current custom rate, lesson-type price, or 8,250 pence. Its booking-credit
   fee aggregation and several joins are also not explicitly school-scoped.
3. The school v1 eligibility query recomputes live prices and has a separate
   booking uniqueness domain from the direct route.
4. v1 parent and claim insertion is non-transactional; Stripe transfer creation
   has no idempotency key/source charge; ambiguous errors delete claims; and
   transfer creation is labelled `completed` before bank payout.
5. `api/instructor.js` calculates outstanding payout shortfall with
   `instructor_payouts.status = 'chargeable'`. That value is a booking status
   and is excluded by the payout status constraint, so the read model always
   reports zero outstanding shortfall. This is recorded for a focused v1
   read-model correction and is not silently mixed into Slice 1.
6. Older multi-tenancy documentation says new tables default to school `1`.
   That is intentionally superseded for Payout v2 by the no-default invariant
   in this plan.

Slice 1 is implemented locally but deliberately inactive:

- ten append-only/financial-history-preserving v2 tables;
- one inactive `schools.payout_engine_version` switch defaulting to `v1`;
- cross-route booking earning and batch-claim uniqueness;
- closed funding-class and zero-legacy database checks;
- same-school composite foreign keys and no v2 `school_id` defaults;
- calculation-version and SHA-256 fingerprint contracts;
- deterministic transfer identity/idempotency uniqueness;
- deferred allocation conservation and source-cap guards;
- pre/post-migration diagnostics, static tests, pure tests, and rollback-only
  Neon database contract tests.

No production migration, source ingestion, Payout v2 activation, financial-data
mutation, payout execution, deployment, or Stripe mutation was performed.

---

## 5. Target invariants

Payout v2 is complete only when these invariants are enforced in both design and
tests.

### Funding invariants

1. Every positive instructor earning has one or more explicit funding
   allocations.
2. Every allocation has an immutable funding class.
3. `legacy_pre_connect_settled`, `instructor_goodwill`, and `free` have a payout
   contribution of zero.
4. An ambiguous source blocks automatic payout; it never falls back to a live
   price.
5. Total allocated/transferred value cannot exceed a source's payable pool.
6. Stripe-funded positive transfers retain their Stripe charge or balance
   transaction provenance.

### Booking invariants

1. Only `chargeable` bookings earn.
2. One booking can be claimed by only one payout route across the whole
   platform.
3. Creating the same earning twice is rejected by a database constraint.
4. A refunded booking cannot create a new earning.
5. A post-payout refund or goodwill decision creates an adjustment/reversal; it
   does not mutate the paid line.

### Transfer invariants

1. Every Stripe POST has a stable, deterministic idempotency key.
2. An ambiguous Stripe result enters `reconciling`, not `failed`.
3. Claims are never deleted merely because a request threw.
4. A retry with the same logical transfer reuses the same idempotency key.
5. The local transfer row exists before the Stripe call.
6. Stripe transfer success and connected-bank payout success are distinct
   states.

### Tenancy and authority invariants

1. Every payout row has explicit `school_id`.
2. Every query is school-scoped.
3. No school ID defaults are permitted on new v2 tables.
4. Only cron authentication, a superadmin, or a tightly scoped authorised
   operator can mutate payouts.
5. A school admin cannot trigger another school's payout.
6. Every manual mutation requires explicit operator confirmation, idempotency,
   reason, and audit log.

### Liquidity invariants

1. “Can transfer the next payout” is not equivalent to “safe to withdraw.”
2. Platform withdrawable cash excludes learner/refund exposure, earned unpaid
   instructor money, transfers in flight, and the configured risk reserve.
3. A negative protected free-cash position blocks an application-driven platform
   withdrawal and raises an alert.
4. Dashboard/manual Stripe withdrawals are governed by an operator runbook and
   access controls because application code cannot technically prevent a Stripe
   Dashboard user with sufficient permission from moving money.

---

## 6. Funding classification

Use a closed, documented set of funding classes. Suggested names are below; the
implementation session may refine names but must preserve the distinctions.

| Funding class | Meaning | Automatic payout contribution |
|---|---|---:|
| `stripe_backed` | CoachCarter Stripe charge collected for this source | Positive, limited to source allocation |
| `legacy_pre_connect_settled` | Money was settled to Fraser before Connect | £0 |
| `platform_goodwill` | CoachCarter deliberately funds the learner entitlement | Positive only after explicit funded adjustment |
| `instructor_goodwill` | Instructor supplied the entitlement at their cost | £0 |
| `external_cash_payable` | Money collected outside platform but still owed through the configured payout route | Explicit positive value only |
| `external_cash_settled` | Money and instructor obligation were settled outside Payout v2 | £0 |
| `free` | Trial/free entitlement | £0 |
| `manual_review` | Source cannot yet be classified safely | Blocked |

Do not infer `external_cash_payable` from `payment_method = 'cash'`. Existing
retrospective cash bookings need an explicit migration policy because “cash”
does not reveal who collected it or whether the instructor was already paid.

For new records, the funding class must be assigned at source creation, not on
Friday morning.

---

## 7. Proposed Payout v2 data model

Names are proposed. Before migration work, compare them with the current schema
and choose names that avoid collision. New tables must use `BIGSERIAL` or the
project's agreed ID convention, timestamps with time zone, pence integers, and
explicit foreign keys where retention rules allow them.

### 7.1 `payout_funding_sources`

One immutable accounting envelope per collected or deliberately created source.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `learner_id` nullable only where retention/anonymisation requires it
- `instructor_id NOT NULL`
- `funding_class NOT NULL`
- `credit_transaction_id`
- `stripe_checkout_session_id`
- `stripe_payment_intent_id`
- `stripe_charge_id`
- `stripe_balance_transaction_id`
- `currency NOT NULL DEFAULT 'gbp'`
- `gross_collected_pence NOT NULL`
- `stripe_fee_pence NOT NULL`
- `payable_pool_pence NOT NULL`
- `refundable_pool_pence NOT NULL`
- `source_status` such as `pending`, `available`, `refunded`, `disputed`,
  `exhausted`, `manual_review`
- `occurred_at`
- `created_at`
- `metadata JSONB`

Required properties:

- An immutable identity/fingerprint unique to the originating source.
- Stripe-backed positive sources require a Stripe identity.
- Legacy and zero-funded sources require `payable_pool_pence = 0`.
- Do not assume the full gross charge belongs to an instructor. The payable pool
  is the source-backed budget used by earning allocations after the applicable
  commercial rules.
- Do not mutate source totals after a refund or dispute; record adjustments.

### 7.2 `booking_earnings`

One immutable earning record per booking, plus explicit source allocations if a
booking draws from multiple sources.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `booking_id NOT NULL`
- `instructor_id NOT NULL`
- `payout_route NOT NULL`
- `gross_price_snapshot_pence NOT NULL`
- `stripe_fee_snapshot_pence NOT NULL`
- `instructor_earning_pence NOT NULL`
- `platform_fee_pence NOT NULL`
- `franchise_fee_allocation_pence NOT NULL DEFAULT 0`
- `commission_rate_snapshot`
- `earning_status` such as `earned`, `claimed`, `transferring`, `transferred`,
  `adjusted`, `blocked`
- `earned_at NOT NULL`
- `blocked_reason`
- `calculation_version NOT NULL`
- `calculation_json JSONB NOT NULL`
- `created_at`

Required uniqueness:

- `UNIQUE (school_id, booking_id)` for the single logical earning.
- Do not create separate uniqueness domains for direct and school payouts.
- If zero-value bookings need to be evidenced, retain a zero earning row rather
  than simply omitting all trace, but ensure it never generates a Stripe
  amount-zero request.

### 7.3 `booking_earning_sources`

Joins one booking earning to one or more funding sources.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `booking_earning_id NOT NULL`
- `funding_source_id NOT NULL`
- `booking_credit_source_id`
- `gross_contribution_pence NOT NULL`
- `stripe_fee_contribution_pence NOT NULL`
- `payable_contribution_pence NOT NULL`
- `instructor_earning_contribution_pence NOT NULL`
- `created_at`

Required constraints:

- Unique source allocation fingerprint.
- Non-negative pence checks.
- Sum of allocations for an earning equals the earning totals exactly.
- Sum of active allocations and transfers for a source cannot exceed the
  source's payable pool.
- Legacy/instructor-goodwill/free sources require all instructor earning
  contributions to be zero.

### 7.4 `payout_batches`

The weekly statement and operator-facing grouping. A single batch may need
multiple Stripe transfers because its earnings can come from multiple underlying
charges.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `instructor_id` or `destination_school_id`, according to route
- `payout_route NOT NULL`
- `period_start NOT NULL`
- `period_end NOT NULL`
- `currency NOT NULL`
- `gross_pence NOT NULL`
- `stripe_fees_pence NOT NULL`
- `platform_fee_pence NOT NULL`
- `instructor_amount_pence NOT NULL`
- `shortfall_pence NOT NULL DEFAULT 0`
- `deposit_deducted_pence NOT NULL DEFAULT 0`
- `state NOT NULL`
- `calculation_version NOT NULL`
- `plan_fingerprint NOT NULL`
- `created_by_type`
- `created_by_id`
- `created_at`
- `submitted_at`
- `settled_at`
- `failure_reason`

Suggested states:

```text
planned
  -> claimed
  -> submitting
  -> reconciling
  -> transferred
  -> bank_paid

planned/claimed -> blocked
submitting/reconciling -> failed_confirmed
transferred -> bank_payout_failed
```

Do not use `completed` for both “Connect transfer created” and “bank paid.”

### 7.5 `payout_batch_earnings`

Claims earnings transactionally for one batch.

Suggested fields:

- `school_id`
- `payout_batch_id`
- `booking_earning_id`
- `created_at`

Required uniqueness:

- `UNIQUE (school_id, booking_earning_id)`

Never delete a claim following an ambiguous Stripe result. Release/requeue is a
separate, evidenced state transition after reconciliation proves no money moved.

### 7.6 `payout_transfers`

One Stripe transfer attempt/logical transfer per destination and source charge
group.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `payout_batch_id NOT NULL`
- `instructor_id` or destination school
- `stripe_destination_account_id NOT NULL`
- `stripe_source_charge_id`
- `amount_pence NOT NULL`
- `currency NOT NULL`
- `idempotency_key NOT NULL`
- `transfer_group NOT NULL`
- `plan_fingerprint NOT NULL`
- `stripe_transfer_id`
- `state NOT NULL`
- `request_created_at`
- `stripe_created_at`
- `reconciled_at`
- `last_error_code`
- `last_error_message`
- `metadata JSONB`

Required uniqueness:

- `UNIQUE (idempotency_key)`
- `UNIQUE (stripe_transfer_id)` where non-null
- A unique logical-transfer fingerprint independent of a transient attempt.

Use one deterministic idempotency key for the same logical transfer, for
example:

```text
cc:payout-v2:<environment>:<school_id>:<batch_id>:<source_charge_id-or-group>:<plan_hash>
```

Keep the key below Stripe's length limit and never include PII. Stripe retains
idempotent POST results and recommends idempotency keys for safe retries:

- <https://docs.stripe.com/api/idempotent_requests>

### 7.7 `payout_adjustments`

Append-only corrections and explicit platform-funded/manual accounting.

Suggested fields:

- `id`
- `school_id NOT NULL`
- `instructor_id NOT NULL`
- `booking_id`
- `payout_batch_id`
- `payout_transfer_id`
- `funding_source_id`
- `parent_adjustment_id`
- `adjustment_type NOT NULL`
- `amount_pence NOT NULL` (signed)
- `currency NOT NULL`
- `reason NOT NULL`
- `evidence_reference`
- `operator_id`
- `status`
- `adjustment_fingerprint NOT NULL`
- `created_at`
- `applied_at`
- `metadata JSONB`

Use this for:

- the known £414 opening correction;
- post-payout goodwill/refund consequences;
- dispute/chargeback deductions;
- transfer reversals;
- owner-approved recovery or write-off;
- explicit platform funding;
- external cash corrections.

Do not use adjustments to conceal migration mismatches.

The chosen £414 recovery is represented without updating existing financial
rows:

- one negative, pending `recovery` obligation records the reviewed v1 payout,
  Stripe transfer, legacy booking IDs, operator, and evidence;
- each future payout deduction is a positive, applied
  `recovery_application` child tied to both the obligation and its v2 batch;
- the batch records the same `recovery_deducted_pence`, and a deferred
  constraint requires exact conservation with its child applications;
- applications may never exceed the original obligation, and all parent,
  batch, instructor, currency, conflict targets, and joins are school-scoped;
- outstanding recovery is derived as the original absolute obligation less
  append-only applications. The parent row is not updated when partly or fully
  recovered.

### 7.8 `stripe_event_receipts`

Deduplicates webhook processing.

Suggested fields:

- `stripe_event_id PRIMARY KEY`
- `event_type`
- `livemode`
- `object_id`
- `school_id`
- `connected_account_id`
- `processing_status`
- `received_at`
- `processed_at`
- `last_error`

Webhook handlers must verify Stripe signatures using the raw request body and
the endpoint signing secret:

- <https://docs.stripe.com/webhooks/signature>

### 7.9 Connected-bank payout tracking

Stripe transfer and connected-account bank payout are different objects. Either
add a dedicated `connected_bank_payouts` table or an equivalent normalised
event/read model that tracks:

- connected account;
- Stripe payout ID;
- arrival estimate;
- amount and currency;
- `payout.created`;
- `payout.updated`;
- `payout.paid`;
- `payout.failed`;
- failure code/message;
- related CoachCarter batches/transfers where determinable.

Listen for the relevant connected-account events:

- <https://docs.stripe.com/connect/payouts-connected-accounts?locale=en-GB>

Do not claim a specific CoachCarter batch is bank-paid unless the mapping is
supported by Stripe evidence. A connected bank payout can aggregate funds.

---

## 8. Authoritative earning calculation

There must be one pure planner used by:

- the weekly cron;
- an authorised manual preview;
- the admin widget;
- the balance snapshot;
- shadow mode;
- tests;
- the executor's final server-side revalidation.

Do not maintain simplified duplicate calculations.

### 8.1 Source inputs

For credit-funded bookings:

- `booking_credit_sources` is the attribution bridge.
- Source purchase amount, amount contribution, Stripe fee attribution,
  `absorbed_by`, adjustments, and funding classification determine payable
  value.
- A synthetic `legacy_grandfather` credit transaction with `amount_pence = 0`
  produces zero payout contribution.
- Multiple source rows must sum exactly to the booking allocation.

For direct Stripe bookings:

- Use the immutable charged amount and fee evidence tied to the booking's Stripe
  payment.
- `lesson_bookings.list_price_pence` can be supporting snapshot evidence but
  cannot substitute for missing payment provenance.

For free, instructor-goodwill, settled cash, or pre-Connect sources:

- Create a zero earning with classification evidence or block for review.
- Never infer positive value from lesson duration or current price.

For platform goodwill or explicitly payable external cash:

- Require an append-only funded adjustment/source with operator evidence.

### 8.2 Calculation order

The planner must preserve current commercial policy while using source-backed
inputs:

1. Gather eligible `chargeable` bookings inside one school.
2. Reject test-account and non-payable/free cases according to existing rules.
3. Resolve immutable funding allocations.
4. Block any missing, conflicting, cross-school, over-allocated, or ambiguous
   source.
5. Sum actual source-backed gross and Stripe fee allocations.
6. Apply the snapshotted commission or franchise model.
7. Apply prior-shortfall policy. Vehicle deposits are handled entirely
   off-system by owner decision and must always remain zero in Payout v2.
8. Allocate rounding differences deterministically so line totals equal the
   batch total exactly.
9. Fingerprint the entire plan.
10. Persist the earning/plan before external mutation.

All monetary arithmetic is integer pence. No floating-point money totals are
allowed. If a rate requires decimal math, use integer basis points or a decimal
library and a single documented rounding rule.

### 8.3 Planning result

Each previewed booking must show:

- booking and instructor;
- funding class;
- source transaction/charge identity where applicable;
- actual gross contribution;
- Stripe fee evidence and allocation;
- platform/commission/franchise calculation;
- instructor earning;
- block/warning reason;
- whether the source is legacy, goodwill, cash, free, or Stripe-backed;
- calculation version.

The executor must rerun the planner and require the same fingerprint before
submitting. A changed result returns a conflict and requires a new review.

---

## 9. Transaction and Stripe execution protocol

Stripe and Postgres cannot share one atomic transaction. The design must use a
durable state machine and reconciliation.

### Phase A — plan and claim in Postgres

Inside one database transaction:

1. Acquire an advisory lock scoped to the school and payout route.
2. Select unclaimed earned rows with locking appropriate for concurrency.
3. Revalidate source caps, tenant scope, destination health, and protected
   balance.
4. Create the batch.
5. Create all batch/earning claims.
6. Create the logical `payout_transfers` rows with deterministic idempotency
   keys and state `submitting`.
7. Commit.

If this transaction fails, no Stripe call occurs.

### Phase B — submit to Stripe

For each logical transfer:

1. Load the already-persisted transfer row.
2. Call `stripe.transfers.create` with:
   - amount;
   - GBP currency;
   - destination connected account;
   - `source_transaction` for Stripe-backed source groups;
   - a stable `transfer_group`;
   - non-PII metadata linking school, batch, transfer, and calculation version;
   - the persisted idempotency key in Stripe request options.
3. On a definite Stripe success, store the transfer ID and transition to
   `transferred`.
4. On a definite Stripe rejection where Stripe confirms no transfer was
   created, transition to `failed_confirmed`.
5. On a timeout, connection reset, database write failure after the Stripe call,
   process death, or any uncertain result, transition or leave the row in
   `reconciling`.
6. Never delete earning claims in the catch block.

### Phase C — reconcile

A recurring reconciler must:

1. Find `submitting` or `reconciling` transfers older than a short threshold.
2. Search local Stripe IDs, idempotent request evidence, metadata, transfer
   group, destination, amount, and creation window.
3. If Stripe created the transfer, attach the Stripe ID and mark transferred.
4. If Stripe definitively did not create it, safely resubmit with the same
   idempotency key or mark `failed_confirmed`.
5. If evidence remains ambiguous, leave it blocked and alert an operator.
6. Never invent a new idempotency key to bypass ambiguity.

The Friday cron may initiate batches, but reconciliation should run frequently
enough to resolve transient failures the same day.

### Phase D — connected bank payout events

Process signed connected-account webhook events and update bank-payout
visibility. Do not reverse CoachCarter earnings merely because a connected bank
payout fails; the money may still be in the connected Stripe balance. Surface
the failure and direct the instructor through Stripe remediation.

---

## 10. Refunds, disputes, and reversals

Refunds and Connect transfers are separate money movements. Stripe does not
automatically reverse an associated transfer when a platform charge is refunded
under separate charges and transfers.

Payout v2 must therefore:

- Preserve the existing tightly gated refund planner/executor.
- Keep already-paid-out direct booking refunds blocked from automatic execution
  unless a separately reviewed design safely coordinates refund and transfer
  reversal.
- Listen for charge refunds, disputes, and chargebacks relevant to funding
  sources.
- Reduce remaining source capacity through append-only adjustments.
- If instructor money has already transferred, create an explicit recovery,
  reversal, or future-payout adjustment according to an owner-approved policy.
- Never mutate historical earning or transfer totals to make the current balance
  appear correct.
- Never broaden automatic refund execution as a side effect of Payout v2.

Add an explicit incident state for:

```text
Stripe transfer succeeded
local transfer record incomplete
source later refunded/disputed
connected account or bank payout failed
transfer reversal required but not yet approved
```

---

## 11. Platform liquidity and withdrawal guard

The system needs two different numbers:

### 11.1 Transfer readiness

```text
stripe_available_pence - transfers_ready_now_pence
```

This answers whether Stripe can submit the currently planned transfers.

### 11.2 Protected free cash

At minimum:

```text
Stripe available cash
- unused/refundable learner source exposure
- earned but untransferred instructor money
- submitted/reconciling transfers
- approved but unexecuted refund obligations
- configured dispute/refund reserve
= protected free cash
```

Pending Stripe cash can be displayed separately but must not be treated as
currently withdrawable.

The precise exposure model must reuse the exact, source-attributed work in
`api/_platform-balance.js` and
`docs/refund-exposure-valuation-audit.md`. Do not revert to the legacy aggregate
learner balance multiplied by a current school rate.

Required operator behaviour:

- Keep the platform Stripe payout schedule manual during this architecture.
- Do not reintroduce an automatic platform sweep cron.
- Before any platform bank withdrawal, show the proposed withdrawal and the
  resulting protected free-cash position.
- Refuse an application-driven withdrawal that would make protected free cash
  negative.
- Alert if an out-of-application Stripe Dashboard payout causes the protected
  position to become negative.
- Restrict Stripe Dashboard payout permissions to the minimum practical set of
  people and use strong 2FA.

This is partly an operational control: no application can prevent a sufficiently
privileged Dashboard user from manually moving funds outside the application's
workflow.

Do not depend on Stripe funds segregation for launch; it is not a generally
available foundation for this implementation.

---

## 12. Connect account and security decisions

- Existing connected accounts do not need to be deleted.
- Migrate existing account configuration incrementally where appropriate.
- For new Connect accounts, use Stripe Accounts v2 and explicit responsibility,
  dashboard, and configuration settings rather than adding new legacy account
  type assumptions:
  - <https://docs.stripe.com/connect/accounts-v2>
  - <https://docs.stripe.com/connect/migrate-to-controller-properties>
- Do not change connected-account liability or merchant-of-record decisions
  without a separate commercial/legal review.
- Use Stripe-hosted onboarding.
- Use the current Stripe API version and SDK at implementation time after
  checking compatibility.
- Prefer a restricted API key with only the permissions required by the payout
  service; use separate test and live credentials:
  - <https://docs.stripe.com/keys/restricted-api-keys>
- Never log keys, webhook secrets, full request headers, or raw environment
  variables.
- Verify webhook signatures before processing.
- Retain Stripe event IDs for deduplication.
- Do not include learner PII in Stripe metadata or idempotency keys.
- Audit all manual payout, adjustment, recovery, retry, and refusal actions.

---

## 13. V1 freeze and compatibility rules

Until cutover:

- Existing v1 tables remain readable.
- Existing instructor earnings/history pages may continue reading v1 history.
- V2 views should present v1 and v2 entries clearly labelled by accounting
  version.
- V1 mutation paths must not run concurrently with a live v2 route for the same
  school.
- Add a school-level payout-engine version/feature flag, not an inferred date.
- Do not use `payouts_start_date` as the sole v1/v2 switch.
- `payouts_start_date` remains a historical safety floor during migration.

At cutover:

- Disable the v1 cron mutation path.
- Disable or convert the v1 admin `process-payouts` mutation route.
- Disable the v1 school payout mutation route for the cut-over school.
- Keep read-only v1 history and reconciliation tools.
- Add a hard runtime refusal if a v1 mutation is called for a v2-enabled school.

The v2 database constraint on `(school_id, booking_id)` must prevent both direct
and school routes from paying the same booking. During the transition, the v2
planner must also exclude any booking already present in either completed or
ambiguous v1 payout claims.

---

## 14. Opening-balance and legacy cutover

Create read-only diagnostics before any migration endpoint.

### 14.1 Required source cohorts

Classify every relevant historical or still-spendable source:

1. Stripe-backed credit purchase with complete source identity.
2. Stripe-backed direct booking.
3. Pre-Connect/legacy grandfather credit.
4. Platform goodwill.
5. Instructor goodwill.
6. External/private Stripe or Setmore payment.
7. Cash/manual settlement.
8. Free trial/free offer.
9. Missing or contradictory evidence.

The migration must never silently decide cohort 6, 7, or 9.

### 14.2 Legacy rules

- Import legacy credit sources with `payable_pool_pence = 0`.
- Preserve remaining learner minutes and source attribution.
- Import existing zero-value BCS contribution as zero.
- Report any legacy-labelled row with positive amount/contribution as a hard
  discrepancy.
- Report any chargeable legacy-funded booking proposed above zero as a hard
  discrepancy.
- Keep `payouts_start_date` protection until v2 shadow comparison is complete.

### 14.3 Historical payouts

- Import v1 payout history only into a read model or version-labelled history;
  do not recreate Stripe transfers.
- Map all known v1 Stripe transfer IDs.
- Reconcile totals against Stripe before activation.
- Preserve failed and processing evidence.
- After migration and explicit operator review, add the £414 as one
  idempotent, pending opening recovery adjustment using the reviewed payout `7`
  line evidence. Do not create it as part of schema deployment or historical
  source ingestion.
- Apply it only through future v2 direct-instructor batches using
  full-available-offset: transfer floor zero and carry any remainder forward.

### 14.4 Migration execution pattern

Follow the repository's safe money-migration pattern:

1. Pre-migration SQL diagnostic.
2. Read-only authenticated dry-run endpoint or local operator script.
3. Human review of counts and pence totals.
4. Explicit operator confirmation for mutation.
5. One atomic database transaction.
6. Migration marker and audit log.
7. Post-migration SQL diagnostic.
8. Rerun refusal/idempotent no-op.
9. Documented PITR/rollback boundaries.

Do not let a migration endpoint call Stripe.

---

## 15. Implementation slices

Keep each pull request focused. Do not ship this as one large money-path change.

### Slice 0 — decision record and refreshed forensic

**Goal:** revalidate the 25 July snapshot and lock remaining policy decisions.

Deliverables:

- Read-only diagnostics covering all funding cohorts and v1/v2 route overlap.
- Refreshed Stripe-versus-database transfer reconciliation.
- Confirmation that legacy sources and remaining legacy-funded bookings are
  zero-contribution.
- Explicit decision for the £414 opening adjustment.
- Explicit policy for retrospective/external cash bookings.
- Explicit payout route for each current school.
- Updated risk register if repository behaviour changed.

No production financial mutation.

### Slice 1 — schema and pure contracts

**Goal:** introduce v2 tables, constraints, enums/checks, and pure calculation
types without changing live payout behaviour.

Deliverables:

- Append-only v2 schema.
- No `school_id` defaults.
- Cross-route unique earning constraint.
- Funding-class checks.
- Transfer/idempotency uniqueness.
- Calculation version/fingerprint helper.
- Schema and pure unit tests.
- Pre/post migration diagnostics.

### Slice 2A — inactive source ingestion and reconciliation foundation

**Goal:** create immutable funding sources from new Stripe success events and
existing credit/direct booking paths.

Deliverables:

- Idempotent source writer.
- Stripe charge and fee reconciliation.
- Legacy source writer with forced zero payable pool.
- Manual-review classification for missing evidence.
- Webhook signature and event-deduplication tests.
- No payout transfer creation.

Prefer dual-writing new accounting evidence rather than altering existing credit
mutation semantics in the first slice.

**Local implementation status (25 July 2026): complete and inactive.**

- `api/_payout-v2-source-writer.js` is the single school-scoped writer for
  `payout_funding_sources`. It keys deterministic ingestion fingerprints by
  school, credit transaction, and source kind, and treats an idempotent replay
  with contradictory immutable facts as an error.
- Positive `stripe_backed` sources require the PaymentIntent, charge, balance
  transaction, collected amount/currency, and balance-transaction fee. Missing
  or contradictory evidence creates a `manual_review` source with zero payable
  and refundable value. No current lesson price, custom rate, instructor rate,
  list price, or school default is an input to classification.
- `legacy_grandfather` ingestion always writes
  `legacy_pre_connect_settled`, zero fee, and zero payable/refundable pools,
  including when a deliberately injected test fixture has a positive historical
  amount. Existing legacy financial rows are not changed.
- New successful `credit_purchase` and `slot_booking` webhook paths dual-write
  source evidence after their existing credit transaction exists. The writer is
  additive and retains a narrow pre-schema compatibility path only for the v2
  source/receipt relations; other writer failures return `500` so Stripe can
  retry. Migration 035 is now installed, so the compatibility path is a rollback
  safeguard rather than the expected production state.
- Signed Stripe events for those two payment types use
  `stripe_event_receipts`. The webhook signature is verified first. Receipts
  have a school-scoped conflict target plus a global immutable Stripe-event
  guard, immutable event/object/account facts, retryable failed/stale-processing
  states, and processed-event no-op behaviour.
- Before receipt claim, current producers must prove the explicit school-scoped
  learner, instructor, and payment relationship from canonical database rows.
  A wrong-scope event fails retryably without binding its global event ID to the
  wrong tenant. Failed/stale receipt retries establish a fresh lease so two
  workers cannot concurrently reclaim the same old failed delivery.
- Positive Stripe evidence now verifies the succeeded PaymentIntent, paid and
  captured Charge, PaymentIntent-to-Charge link, Charge-to-balance-transaction
  link, matching GBP amount, and exact balance-transaction fee. Missing or
  contradictory relationship evidence remains immutable zero-value
  `manual_review`.
- Payout v2 receipt/source ingestion requires an explicit valid
  `metadata.school_id`. Older events without it continue through the existing v1
  tenant-resolution path but do not silently default a v2 row to school `1`;
  they remain reconciliation candidates.
- `api/_stripe-fee.js` now returns the immutable PaymentIntent, charge, balance
  transaction, collected amount/currency, and fee provenance while retaining
  its fee-only compatibility wrapper.
- `scripts/payout-v2-source-preview.js` and
  `db/diagnostics/payout-v2-source-ingestion-reconciliation.sql` are read-only.
  The preview requires `PAYOUT_V2_SCHOOL_ID` and has no tenant default. No
  production source backfill has been executed.
- Pure/static tests and rollback-only Neon tests cover idempotency,
  cross-tenant lookup rejection, duplicate and contradictory events, missing
  evidence, positive legacy history, immutable replay conflict, and retry after
  a partial failure.

Implementation discoveries:

- Checkout and PaymentIntent success deliveries have distinct Stripe event IDs
  but can describe the same accounting source. Event receipts deduplicate each
  delivery; the school/credit-transaction/source fingerprint deduplicates the
  funding source across deliveries.
- Existing webhook idempotency rows are the safest join point. Source ingestion
  loads the persisted `credit_transactions` row in the same school rather than
  trusting webhook amounts, instructor scope, or live pricing.
- The test Neon branch enforces the existing multi-tenant school-creation guard
  and currently has only one school. Cross-tenant source lookup therefore uses
  an out-of-scope school ID; the optional two-real-school event reassignment
  assertion is skipped there, while the global event-ID database constraint
  remains installed and statically asserted.
- The refreshed read-only school-1 production preview, run before the schema-only
  deployment, confirmed the v2 source table was not yet deployed and found 85
  historical candidates: 24 forced-zero
  legacy sources and 61 direct-booking transactions. Stripe read reconciliation
  found complete positive evidence for 41 direct-booking candidates; 20 remain
  zero-value `manual_review` because a valid immutable `ch_` Charge identity was
  not established even though other Stripe amount/fee evidence was available.
  No source rows were written and no backfill was run.

### Slice 2A.1 — inactive future-payout recovery foundation

**Local implementation status (25 July 2026): complete and inactive.**

- `api/_payout-v2-recovery.js` implements the owner-approved
  `full_available_offset` policy as a pure, versioned planner. It applies
  recoveries oldest first, deducts no more than the otherwise-payable
  instructor amount, floors the transfer at zero, carries the balance forward,
  and fingerprints the result.
- The opening-adjustment writer is idempotent and explicitly school-scoped. It
  refuses to create an obligation unless the requested amount and unique legacy
  booking IDs exactly reconcile to a completed same-school v1 payout, every
  selected booking has a same-school `legacy_grandfather` funding source, and
  the payout retains its Stripe transfer evidence. The amount is an input
  verified against history; production code does not hardcode £414 or payout
  `7`.
- `payout_adjustments` now models the negative recovery obligation and
  append-only positive applications. A school-scoped parent relationship,
  fingerprint uniqueness, application cap, instructor/currency/batch checks,
  and deferred batch conservation prevent cross-tenant, duplicate, excessive,
  or partially recorded deductions.
- `payout_batches.recovery_deducted_pence` makes the withheld value explicit in
  the batch equation. The future batch materializer must create the batch and
  every recovery application in the same transaction.
- `db/diagnostics/payout-v2-recovery-reconciliation.sql` reports original,
  applied, and remaining recovery value and returns discrepancy cohorts for
  batch imbalance, contradictory scope, or missing source evidence.
- Pure tests cover full recovery, partial carry-forward, FIFO ordering, zero
  available entitlement, history preservation, and application records.
  Rollback-only Neon tests cover writer idempotency, evidence mismatch,
  cross-tenant refusal, partial recovery, over-recovery refusal, and incomplete
  batch/application transactions.

Nothing in this foundation reads or changes the v1 payout path. At that
implementation checkpoint no adjustment, migration, or transfer had occurred.
Migration 035 has since been applied schema-only; no adjustment or transfer has
been created, and `schools.payout_engine_version` remains `v1`. Integration
into the shadow batch planner belongs to Slice 3.

### Slice 2B — reviewed historical ingestion and remaining producer coverage

**Local implementation status (25 July 2026): complete and inactive.**

- `scripts/payout-v2-historical-source-import.js` is an explicitly
  school-scoped operator tool with dry-run as its default. Apply and
  test-rollback modes require an independent environment gate, an exact
  mode-specific confirmation phrase, expected candidate count and monetary
  totals, and the exact reviewed SHA-256 plan fingerprint.
- `api/_payout-v2-historical-import.js` loads one deterministic full candidate
  cohort from immutable `credit_transactions`, verifies same-school instructor
  and learner relationships, reconciles Stripe candidates through read APIs,
  and rechecks the candidate snapshot inside the import transaction.
- The import uses the same immutable source writer as live producers. Verified
  Stripe value retains PaymentIntent, Charge, balance-transaction, amount,
  currency, and fee evidence. Missing or contradictory evidence remains
  zero-payable `manual_review`; `legacy_grandfather` is forced to zero.
  Cash/Setmore/external bookings and live prices are not inferred.
- `payout_source_import_runs` is append-only and records the reviewed
  fingerprint, row-count conservation, totals, operator identity, evidence
  reference, and created/existing counts. Sources, the import marker, and its
  audit log are one transaction. A marker whose reviewed sources are missing
  fails closed instead of silently repairing history.
- Paid lesson-offer Checkout success and captured request-to-book
  PaymentIntent success now enter the inactive source-ingestion path.
  Request checkout copies its explicit tenant/payment metadata to the
  underlying PaymentIntent. Request capture waits for the accepted,
  same-school booking/credit transaction and fails its Stripe event receipt
  retryably when local state is not ready.
- Offer retries can repair only the narrow boundary where the immutable
  `credit_transactions` row exists but its payout source does not. Once the
  source exists, the prior pending-offer failure remains blocked for operator
  review because later learner-balance or booking mutations may have started.
- Offer producer lookups no longer default to school `1`; offer, instructor,
  lesson type, availability, blackout, booking, and request joins retain
  explicit same-school scope.
- Rollback-only tests cover deterministic plans, plan drift, interrupted
  import/resume, no-op source reruns, source conflicts, schema immutability,
  and cross-school/source evidence boundaries. Static and regression tests
  cover producer ordering and retry behaviour.

The 25 July 2026 read-only school-1 dry-run saw 85 candidates: 41 verified
Stripe-backed, 24 forced-zero legacy, and 20 zero-payable `manual_review`.
The reviewed preview totalled 401,725 pence gross evidence, 7,325 pence Stripe
fees, and 255,819 pence payable/refundable pool. Its fingerprint was
`sha256:33ac224077140be2aa24321657d5002cf19a82bbd46d66bb81596b3af218a531`
for operator `codex-local-review` and evidence reference
`read-only-preview:2026-07-25`. Candidate counts and fingerprints are
time- and evidence-sensitive, so a later operator must produce and review a
fresh dry-run rather than reusing these values blindly.

No historical import, schema deployment, booking earning, payout batch,
transfer, Stripe mutation, production financial write, or activation change
was performed.

The Slice 2B handoff was the source-backed, zero-transfer Slice 3 planner and
shadow statement work recorded below.

### Slice 3 — earning planner in shadow mode

**Goal:** produce v2 booking earnings and weekly statements without moving money.

**Local implementation status (25 July 2026): complete and inactive.**

- `api/_payout-v2-earning-planner.js` is the single pure, versioned
  (`payout-v2-earning-planner-v1`) authority. It accepts immutable booking and
  source snapshots, orders inputs deterministically, uses integer-pence
  largest-remainder allocation, fingerprints both input and plan, and enforces
  exact batch and per-earning conservation.
- Only the shared three-state `chargeable` status can create a positive
  earning. `scheduled` and `refunded` remain zero; test accounts, existing v1
  claims, existing v2 earnings, mixed direct-instructor scope, cross-school or
  cross-instructor sources, missing sources, unavailable sources, and
  `manual_review` all fail closed.
- Funding-class behaviour is closed and source-backed. Legacy, instructor
  goodwill, external-cash-settled, and free sources remain zero-payable.
  Platform goodwill and external-cash-payable require explicit positive
  evidence. Source allocations cannot exceed the remaining immutable payable
  pool.
- Commission, franchise fee, prior shortfall, and full-offset recovery are
  separate conserved lines. Recovery applies oldest first, produces
  append-only child applications, floors the shadow transfer at zero, and
  carries the remainder. By owner decision on 25 July 2026, vehicle deposits
  are handled entirely off-system: the v2 planner fingerprints that policy,
  always records/deducts zero, and rejects any positive deposit input.
- `api/_payout-v2-shadow.js` loads explicitly school/route/period-scoped
  immutable inputs. `GET /api/admin?action=payout-v2-shadow-statement` and
  `npm run shadow:payout-v2` expose read-only plans, source blockers, a
  comparison-only v1 preview, and deliberate-versus-unexplained differences.
  The v1 query deliberately mirrors current live fallback behaviour only for
  comparison; none of those prices enter the v2 planner.
- `api/_payout-v2-materializer.js` re-locks booking/source/recovery inputs,
  replans inside one transaction, requires exact input and plan fingerprints,
  and idempotently writes only `booking_earnings`,
  `booking_earning_sources`, planned `payout_batches`,
  `payout_batch_earnings`, and recovery-application adjustments. It creates no
  `payout_transfers`, calls no Stripe API, changes no v1 payout row, and does
  not expose an admin materialisation endpoint.
- `db/diagnostics/payout-v2-earning-shadow-reconciliation.sql` is read-only and
  requires an explicit school variable. It checks earning/allocation/batch
  conservation, source caps, route exclusivity, planned-only state, zero
  transfer rows, and the unchanged v1 activation switch.

Verification evidence:

- 72 Payout v2 pure/static/schema/source/admin-shadow tests passed.
- 16 rollback-only Neon schema contracts passed.
- 13 rollback-only Neon source-ingestion contracts passed; one optional
  two-real-school reassignment test was skipped because the guarded test branch
  has one school.
- 6 rollback-only Neon Slice 3 contracts passed: atomic materialisation and
  comparison isolation, retry/serialized replay, drift and cross-school
  refusal, injected partial-write rollback, and full-offset recovery
  application with zero transfer, plus execution of the read-only
  reconciliation diagnostic with no blockers.
- 90 focused booking-status, v1 payout read-model, credit, refund, offer, slot,
  and request-path regressions passed, including all 8 Neon request-to-book
  credit-hold lifecycle tests and all 6 cancellation/BCS refund tests. The
  isolated test branch is missing `lesson_bookings.social_video_age_confirmed`,
  so the credit-booking BCS integration file stopped on its first test and 12
  later cases did not run; no schema change was applied to hide that
  environment drift. Syntax validation passed for 176 files.

Read-only production evidence refreshed on 25 July 2026:

- The database forensic found no tenant-scope violations, no cross-route
  claims, no unresolved local transfer identities, and confirmed all 24 legacy
  source rows / 43 legacy allocations remain zero-contribution.
- The database-only school-1 source preview was run before the schema-only
  deployment and confirmed the v2 source table was then absent. It found 85
  candidates: 24 forced-zero legacy and 61
  direct-booking candidates that correctly remain `manual_review` without
  Stripe read evidence. This database-only classification is deliberately more
  conservative than the earlier database-and-Stripe preview; no source was
  written.

Open Slice 3 blockers and recorded decisions:

- Production cannot generate a v2 shadow statement until migration 035 is
  reviewed/deployed and a separately reviewed historical source import exists.
  Neither action was performed here.
- Owner decision, 25 July 2026: vehicle deposits are handled off-system.
  Payout v2 therefore never deducts or tracks a positive deposit. The
  comparison-only v1 preview still reports the current v1 £195/£250 heuristic
  as a deliberate policy difference; the live v1 path was not changed here.
- The 61 database-only direct candidates are not evidence of 61 bad payments;
  they are the expected fail-closed result when Stripe reads are disabled.
  A fresh Stripe-read preview is required before any import review.
- The rollback suite verifies serialized same-transaction replay. True
  two-connection contention remains a pre-activation test after the schema is
  available on an isolated branch without transactional DDL.

At the Slice 3 checkpoint no migration, historical import, opening recovery,
production financial write, Stripe mutation, payout, or activation change was
performed. Migration 035 has since been applied schema-only; the remaining
exclusions still hold.

**Recommended exact next implementation slice:** Slice 4, limited to an
inactive durable transfer-executor/reconciler behind explicit feature gates and
test client injection. Keep it unreachable from cron/admin production routes
until migration/import review and accepted shadow comparisons are complete.

### Slice 4 — durable transfer executor and reconciler

**Goal:** safely create source-linked Stripe transfers.

**Local implementation status (25 July 2026): complete and inactive.**

- Materialized batches now retain the exact reviewed `plan_json`. The executor
  requires explicit `school_id`, batch ID, and expected plan fingerprint, locks
  the batch, and recomputes the fingerprint before accepting it.
- It revalidates immutable batch totals and zero-deposit policy; direct/school
  route shape; calculation version; exact claimed earning set; each earning
  calculation fingerprint/body; each source allocation; recovery application
  total; destination availability; v1 route overlap; source status/class; and
  allocated/payable source caps. It never reads lesson types, live prices, bulk
  rates, custom rates, or v1 calculation helpers.
- Net transfer pence already present in each immutable earning snapshot are
  allocated deterministically across that earning's source-backed instructor
  contributions. This is transfer-source attribution only, not a new earning
  calculation. Every logical transfer and its source rows conserve exact pence.
- Stripe-backed sources group by immutable charge and pass that charge as
  `source_transaction`. Positive platform-goodwill or external-cash-payable
  sources require both their existing funding evidence and an immutable
  documented `transfer_source_group`; settled, legacy, free, instructor
  goodwill, manual-review, pending, refunded, disputed, exhausted, unknown, or
  cross-school sources fail closed.
- Each destination/source group receives one logical SHA-256 fingerprint and
  one deterministic Stripe idempotency key derived from school, batch,
  destination, source group, amount, currency, and reviewed plan. Keys contain
  no learner/instructor PII and are reused unchanged after confirmed failure.
  Database uniqueness protects logical fingerprints, idempotency keys, and
  Stripe transfer IDs.
- Transfer intent and exact source allocations are committed before the
  injected Stripe client's `transfers.create` call. A second worker observing
  `submitting` cannot submit again and is directed to reconciliation.
- State decisions are explicit: `planned` → `claimed` → `submitting`;
  successful Connect creation becomes `transferred`; evidence proving no
  object exists becomes `failed_confirmed`; timeout, connection loss, response
  ambiguity, Stripe-success/local-write failure, identity conflict, or
  non-authoritative lookup becomes `reconciling`. Claims, earnings, batches,
  intents, and source allocations are never deleted or released.
- `payout_transfer_attempts` is append-only evidence for submission and
  reconciliation. Stored Stripe success evidence is restricted to immutable
  non-PII identity/amount/currency/destination/source/group/metadata fields.
- Confirmed failures, ambiguous submissions, reconciliation identity conflicts,
  and Stripe-success/local-write failures emit structured non-PII events
  through an optional injected alert callback. No production alert transport is
  wired while the executor remains inactive.
- Reconciliation retrieves a known Stripe ID or lists the deterministic
  transfer group and requires the logical fingerprint, idempotency metadata,
  destination, amount, currency, source transaction, transfer group, and Stripe
  identity to agree. Lost successes attach safely; repeated delivery is a
  no-op. An authoritative empty same-day lookup inside the idempotency retention
  window becomes `not_found_safe_retry`; an old or non-authoritative absence
  remains operator review.
- `reconcilePayoutV2SameDay` is suitable for a future cron but is not connected
  to `vercel.json`, a cron, an admin action, a public route, or the live v1
  payout path. The module constructs no Stripe client and requires dependency
  injection. A zero final amount creates no transfer intent and makes no Stripe
  call.
- Connect transfer creation remains distinct from connected-bank settlement.
  Slice 4 does not process webhooks and does not set `bank_paid` or
  `bank_payout_failed`; those remain Slice 5.

Verification evidence:

- 84 Payout v2 pure/static tests passed in total, including 12 focused Slice 4
  tests for deterministic fingerprints and
  keys, same-logical retry identity, source-charge grouping, multi-group and
  per-transfer pence conservation, direct/school destination separation,
  cross-school/source blocking, documented non-Stripe grouping, exact Stripe
  request/identity matching, and proof of no live-price/v1/activation/route or
  real-client fallback.
- 9 rollback-only Neon Slice 4 tests passed: durable intent/source persistence
  and direct-route success, school-route destination handling, serialized
  duplicate submission, ambiguous timeout with retained
  claim and same-day lost-response reconciliation, confirmed failure with
  same-key retry, authoritative not-found safe retry, Stripe success followed
  by injected local-write failure and recovery, zero-transfer/no-Stripe, and
  cross-school/fingerprint/partial-transaction rollback refusal. The read-only
  Slice 4 transfer diagnostic parsed and ran inside the success case.
- The rollback-only Payout v2 schema/source/materializer/transfer suites passed
  44 tests after updating the schema fixtures for immutable `plan_json`; one optional
  two-real-school source-ingestion reassignment remains skipped because the test
  branch has one school.
- Focused booking-status, v1 payout read-model, BCS/credit, offer, and refund
  static regressions passed except for one unrelated existing offer UI mojibake
  assertion (`×` rendering). Request-to-book, cancellation/refund, and
  instructor-created BCS rollback suites passed 18/18.
- The learner slot-credit rollback suite remains externally blocked because the
  configured test database lacks
  `lesson_bookings.social_video_age_confirmed`; its first case failed and 12
  later cases did not run. No database change was applied to hide the drift.
- The database-only read-only v2 forensic was refreshed on 25 July 2026. It
  again found 24 legacy sources / 43 legacy allocations with zero positive
  contribution violations, zero tenant-scope violations, zero cross-route
  claims, and zero unresolved/duplicate local transfer identities. Stripe reads
  were deliberately skipped.

At the Slice 4 checkpoint no migration, historical import, opening recovery,
production financial write, real Stripe mutation, payout execution, deployment,
cron connection, or activation change was performed. Migration 035 has since
been applied schema-only; the remaining exclusions still hold.

**Slice 5 implementation status:** implemented locally and inactive. Slice 4
and Slice 5 remain disconnected from every production API, cron, admin action,
and native/client surface.

### Slice 5 — webhook and bank-payout visibility

**Goal:** distinguish platform-to-Connect transfer from connected-bank payout.

Deliverables:

- Signed webhook handling and receipt deduplication.
- Connected-account event scope.
- Transfer reversal/refund/dispute visibility as designed.
- `bank_paid` and `bank_payout_failed` read states.
- Instructor/admin copy that accurately distinguishes these stages.

Implemented contract:

- `_payout-v2-webhook.js` accepts raw request bytes, the Stripe signature, the
  configured endpoint secret, and injected signature/Stripe-read adapters.
  Signature construction is the first external action. Missing or invalid
  signatures fail before any database or Stripe read, and the module has no
  real Stripe-client fallback.
- The event allow-list is deliberately closed to
  `transfer.created|updated|reversed`, `payout.created|updated|paid|failed`,
  `charge.refunded`, and
  `charge.dispute.created|updated|closed`. Unsupported signed events are
  durably acknowledged without broadening accounting behaviour.
- `stripe_event_receipts` is the durable event claim. One worker owns a
  school/event pair; completed replay is a no-op; failed partial processing is
  explicitly retryable; and processing completion is committed with the
  business transaction.
- Connected-account scope comes from the immutable
  `payout_v2_connected_account_scopes` registry. The account id is globally
  unique, its one global lookup derives the tenant, and the handler immediately
  rechecks the same row under explicit `school_id` before every tenant-scoped
  business join. Unknown, disabled, or contradictory account/school metadata
  is rejected before a receipt claim.
- Transfer evidence is attached only after exact identity checks across the
  known transfer id, logical fingerprint, Stripe idempotency metadata,
  transfer group, destination account, source transaction, amount/currency,
  batch, school, and plan fingerprint. A signed transfer event can safely
  attach to an existing local intent before the local Slice 4 success write.
- Raw payloads are not retained. Append-only
  `payout_v2_stripe_evidence_events` and
  `payout_v2_stripe_evidence_transfer_links` retain only minimised
  non-PII identity, state, amount, reason, and timestamp evidence. Reversals,
  charge refunds, and disputes are visibility evidence only: they never
  rewrite earnings, funding sources, transfer amounts, or historical rows.
- `connected_bank_payouts` stores the connected-account payout state and exact
  amount/currency/arrival/failure evidence. State application is monotonic:
  out-of-order and contradictory terminal events are retained and surfaced for
  review rather than allowed to regress or silently overwrite terminal state.
- Exact bank correlation uses the connected payout's balance transactions and
  retrieves their transfer sources. The many-to-many
  `connected_bank_payout_transfer_links` table records the exact
  payout/balance-transaction/transfer chain. Amount/date approximation is
  forbidden. One payout may cover multiple transfers and one transfer may be
  paid through multiple bank payouts.
- A transfer remains `transferred` until all of its exact downstream bank links
  prove paid. A batch becomes `bank_paid` only when every transfer is fully
  linked to paid connected payouts. A failed bank payout exposes
  `bank_payout_failed` without pretending that the earlier Connect transfer
  failed or deleting the transfer.
- `_payout-v2-bank-visibility.js` and
  `db/diagnostics/payout-v2-bank-payout-visibility.sql` provide the inactive
  school-scoped read model. Their copy distinguishes “sent to Stripe Connect”
  from “paid to bank”, “bank payout failed”, and “operator review required”.
  Blockers include missing downstream links, unmatched/duplicate identities,
  contradictory or out-of-order evidence, failed/stuck receipts, and explicit
  operator-review states.

Slice 5 verification:

- 96 payout-v2 pure/static tests passed.
- 52 combined rollback-only Slice 1-5 integration tests passed; one optional
  two-real-school source-ingestion case was skipped because the configured test
  database contains only one school. The Slice 5 signed-fixture suite contributed
  eight passing cases covering invalid signatures, replay/concurrency, event
  ordering, multi-transfer payouts, failed payouts, evidence-only reversals,
  exact-correlation failure, receipt retry, tenant rejection, and read-only
  diagnostics.
- 156 focused booking/payout/credit/refund static regressions passed; two
  auth-environment cases were skipped. One unrelated existing offer-copy test
  still fails because its expected multiplication symbol is mojibake.
- The database booking regression selection passed 18 cases before two cases
  exposed pre-existing test-database drift: the external database lacks
  `lesson_bookings.social_video_age_confirmed`; 23 later cases did not run.
  No schema change was applied to hide that drift.
- Project syntax checking passed for 179 JavaScript files.
- The read-only production-safe payout audit completed with zero positive
  contribution, tenant-scope, cross-route, unresolved-transfer,
  duplicate-transfer, or unexplained-transfer violations. The Slice 5 SQL
  diagnostic was exercised only inside rollback because its additive tables
  have not been deployed.

At the Slice 5 checkpoint no migration, historical import, opening recovery,
production financial write, real Stripe read or mutation from the new handler,
payout execution, deployment, webhook/cron/admin connection, or activation
change was performed. Migration 035 has since been applied schema-only; the
connected-bank handler remains unconnected.

**Recommended exact next implementation slice:** Slice 6 only: protected
balance and operator controls, built against the exact source exposure and
bank-payout evidence now available. Keep all v2 mutation modules inactive,
deploy nothing, and do not start cutover until the Slice 6 calculations,
authority restrictions, alerts, and audit logging have their own reviewed
rollback test boundary.

### Slice 6 — protected balance and operator controls

**Goal:** prevent another withdrawal-driven shortfall.

Deliverables:

- Protected free-cash calculation using exact source exposure.
- One authoritative calculation used by widget and snapshot.
- Withdrawal preflight/read model.
- Negative-protected-balance alerts.
- Restricted payout mutation authority.
- Audit logging.
- Documented Stripe Dashboard manual-withdrawal runbook.

**Local implementation status (25 July 2026): complete and inactive.**

- `_payout-v2-protected-balance.js` is the single versioned authority:

  ```text
  Stripe available cash
  - exact unused/refundable learner source exposure
  - earned but untransferred instructor obligations
  - submitted/reconciling obligations not proven removed from available cash
  - latest approved but unexecuted refund obligations
  - configured dispute/refund risk reserve
  = protected free cash
  ```

  Pending Stripe cash is display-only. Negative results are preserved, never
  clamped. Transfer readiness remains the separate calculation
  `Stripe available cash - transfers ready to submit now`.
- Exact learner exposure reuses `_platform-balance.js`
  `computeExactRefundExposure`. Any LCB/source warning, unknown absorber,
  legacy-unpriced source, or unattributed minute blocks withdrawal use. There
  is no aggregate-minute/current-rate or live lesson-price fallback.
- Double counting is prevented with disjoint cohorts: unclaimed earnings have
  no batch claim; ready batches have no transfer intent; the in-flight bucket
  includes only intents without a Stripe transfer ID or succeeded/found
  attempt; and only the latest approved refund-obligation event counts.
  Executed/voided refunds and transfers proven removed from Stripe available
  cash are excluded. Reconciling remains a blocker.
- Global calculations aggregate explicitly school-scoped components. A school
  calculation cannot use the undivided global platform balance as school free
  cash and returns `SCHOOL_CASH_NOT_SEGREGATED` /
  `STRIPE_BALANCE_SCOPE_MISMATCH`. Platform withdrawal preflight requires
  explicit global scope.
- `_payout-v2-platform-balance-contract.js` is the inactive future widget and
  snapshot wiring point. Both consume the same protected calculation and exact
  fingerprint; snapshots persist the calculation evidence rather than
  recomputing a simplified formula. Migration 035 is now installed schema-only,
  but the live v1 widget and daily cron remain unwired from these inactive
  modules.
- Withdrawal preflight validates positive integer pence, calculates the
  projected position, refuses blockers/negative projection/stale evidence/
  scope mismatch, and requires an unchanged reviewed fingerprint on attempted
  use. Replay is valid only for the same identity, amount, scope, and
  fingerprint. No Stripe payout API is called or exposed.
- `_payout-v2-authority.js` permits only verified cron with an operation
  allow-list, a superadmin, or a present, explicitly configured scoped
  operator. It rejects ordinary school admins, missing operator config,
  cross-school/global escalation, missing reason/confirmation, invalid
  deterministic idempotency, and changed fingerprints with structured non-PII
  codes. V1 authority is unchanged.
- Negative-position alerts distinguish ordinary liability growth, an observed
  external/manual Dashboard withdrawal, stale or missing Stripe balance
  evidence, and unexplained movement while retaining exact blocker codes.
  Transport and persistence are injected and awaited. Position-based
  deduplication prevents repeated snapshot alert storms.
- Migration 035 adds append-only reserve-config versions, refund-obligation
  events, protected snapshots, operator evidence, and alert evidence with
  logical/external uniqueness guards. Global rows require explicit global
  scope; every tenant row requires `school_id`. No reserve is defaulted:
  missing configuration blocks, while an explicitly reviewed value may be
  zero.
- `scripts/payout-v2-protected-balance-diagnostic.js` and
  `db/diagnostics/payout-v2-protected-balance.sql` are read-only. The manual
  Dashboard procedure is documented in
  `docs/payout-v2-manual-withdrawal-runbook.md`.

Slice 6 verification:

- 36 focused protected-balance, authority, route-isolation, schema, and
  migration-mirroring tests passed.
- 6 rollback-only Neon Slice 6 tests passed, including exact global/school
  scoping, disjoint liability cohorts, immutable evidence, duplicate
  protection, transaction rollback, and execution of the read-only SQL
  diagnostic's result sets without a retained write.
- The combined rollback-only Slice 1-5 suites still passed 52 tests; one
  optional two-real-school reassignment case was skipped because the
  configured test database contains one school.
- 213 focused booking, payout, source, refund, webhook, and admin-balance
  static regressions passed. The separate recurring-offer UI suite passed 5
  cases, skipped 2 auth-environment cases, and retained its known unrelated
  multiplication-symbol mojibake failure.
- The selected booking/BCS/refund/request rollback suites passed 14 cases
  before the external test database's pre-existing missing
  `lesson_bookings.social_video_age_confirmed` column stopped one case and
  prevented 12 later cases from running. No schema change was applied to hide
  that environment drift.
- Project syntax checking passed for 182 JavaScript files, migration 035
  exactly matches the aggregate migration suffix, and `git diff --check`
  reported no whitespace error.
- The established production-safe forensic completed in explicit
  `--database-only` mode: zero tenant-scope violations, zero cross-route
  claims, zero unresolved or duplicate local transfers, zero positive-value
  legacy violations, and no currently v1-eligible ambiguous external/cash
  cohort. Stripe API reads were deliberately skipped.

Slice 6 remains absent from live public, admin, webhook, and cron routes. No
migration, import, opening recovery adjustment, activation, deployment, Stripe
mutation, payout, withdrawal, production alert connection, or production
financial write occurred.

**Slice 7 preparation implementation status (26 July 2026): complete locally
and inactive; operational cutover remains unstarted.** The controlled-cutover
contracts, additive evidence schema, read-only diagnostic, v1 engine guard,
pure/static tests, rollback-only Neon tests, and cutover/incident runbooks now
exist. No live route imports the cutover module. No configuration, shadow
acceptance, readiness snapshot, dry-run event, engine-transition event, or
incident record has been written outside rollback-only tests.

Do not reapply or alter migration 035. Do not deploy the prepared source-
ingestion application without a new explicit approval, import sources, apply
the £414 opening recovery, switch an engine version, execute a capped live
batch, connect a transfer Stripe client, or widen any payout authority. The
route, Fraser-first, £10 cap, Fraser-only
operator, block-unless-proven external-source rule, and two-cycle observation
decisions are now owner-approved, but their production evidence is not
recorded. The retain-all-residual-cash policy is approved; its exact
snapshot-derived reserve pence and fingerprint remain unrecorded and therefore
blocking.

### Slice 7 — controlled cutover

**Goal:** activate v2 for the first school and retire v1 mutation.

Deliverables:

- Two accepted shadow Friday comparisons.
- Owner-approved capped live batch.
- Immediate local/Stripe reconciliation.
- School payout-engine version switched to v2.
- V1 cron/admin/school mutation refusal for that school.
- Monitoring and incident runbook.
- Version-labelled combined history view.

**Preparation delivered locally (no activation):**

- `api/_payout-v2-cutover.js` defines the versioned readiness vocabulary,
  deterministic config/shadow/readiness/dry-run/reconciliation/rollback
  fingerprints, exact blocker codes, hard-cap/no-truncation rule, ordinary
  school-admin refusal, named-operator matching, and the future transaction
  primitive.
- A future engine transition is school-scoped and atomic: lock the school;
  require current engine `v1`; recheck the immutable ready snapshot, config,
  two distinct accepted shadow cycles, named authority, exact confirmation,
  idempotency, and active incidents; insert the immutable event; then update
  that school to `v2` in the same transaction.
- Per-school readiness references an explicit current **global** Slice 6
  protected-balance and reserve fingerprint because the Stripe platform cash
  balance is undivided. It never presents that global cash as school-owned
  free cash, and the transition rechecks both immutable records in-transaction.
- `api/_payout-engine-version.js` is the only Slice 7 dependency added to the
  live v1 helper. It does not change any current v1 school. After a future
  successful cutover transaction, instructor-direct and school-route v1
  mutation for that school refuses before eligibility reads, claims, writes,
  or Stripe calls. Missing school scope also refuses.
- `payout_v2_cutover_config_versions`,
  `payout_v2_shadow_cycle_evidence`,
  `payout_v2_cutover_readiness_snapshots`, and
  `payout_v2_cutover_events` are additive, school-scoped, append-only evidence
  tables installed by inactive migration 035. They do not create scheduling or
  execution authority.
- The first-live cap is an absolute plan ceiling. A plan over cap blocks; it is
  never truncated, split, or used to partially release claims. Dry-run evidence
  retains the exact config, readiness, plan, school, route, instructor, amount,
  and cap fingerprints and has no mutation/Stripe authority.
- Immediate post-batch evidence requires exact local/Stripe ID, amount,
  idempotency, plan, v1-overlap, ambiguity, and protected-cash checks.
  Connect-transferred remains distinct from connected-bank-paid.
- Rollback means freeze new v2 batches, retain claims and immutable rows, keep
  webhooks/reconciliation running, and use append-only corrections. It never
  blindly re-enables v1 or releases an ambiguous claim.
- The explicit school diagnostic is
  `db/diagnostics/payout-v2-cutover-readiness.sql`; the procedures are
  `docs/payout-v2-cutover-runbook.md` and
  `docs/payout-v2-rollback-incident-runbook.md`.

**Readiness status vocabulary:**

- `blocked`: one or more structured blocker codes; no cutover or batch
  authority.
- `ready`: all local evidence checks passed for one exact fingerprint; still no
  mutation authority without the separate operator confirmation/transaction.
- `recorded`: immutable dry-run, transition, or reconciliation evidence exists.
- `open` / `resolved`: incident lifecycle events; history is never edited.
- `transferred`: exact platform-to-Connect transfer evidence.
- `bank_paid`: exact connected-bank payout evidence. Never inferred from
  `transferred`.

**Pre-cutover blockers include:** engine not `v1`; missing/mismatched config or
explicit global protected/reserve fingerprint; fewer than two distinct accepted shadows; any unexplained
difference or ambiguous source; incomplete external/cash/Setmore/route/reserve
evidence; missing owner/named-operator/cap/rollback decisions; tenant or
cross-route violations; positive legacy contribution; unresolved transfer;
active incident; v1 payout in flight; or insufficient protected transfer
readiness.

**Tests added:** pure/static coverage for readiness, two-cycle evidence,
fingerprints, hard cap, cross-school/route/instructor drift, bank-state wording,
safe rollback, v1 refusal before I/O, schema mirroring, diagnostic read-only
scope, and live-route isolation; rollback-only Neon coverage for tenant foreign
keys, shadow constraints, append-only records, named authority, atomic engine
transition, idempotent replay, and the diagnostic.

**Owner decisions recorded 26 July 2026:**

- Long-term route: `instructor_direct` through Stripe Connect to each
  instructor's connected account.
- First-live instructor: Fraser.
- First-live hard cap: **£10 / 1,000 pence**. This is a ceiling, not a target or
  permission to truncate a larger plan.
- Named mutation operator: Fraser only.
- External cash/Setmore/private-payment evidence: block unless positively
  proven.
- Observation period before any cap widening: two complete successful payout
  cycles.
- Cash-retention/reserve policy: retain all residual platform cash in Stripe
  during the first-live cutover and two-cycle observation period; make no
  discretionary platform withdrawal. The exact versioned reserve pence is
  calculated from the fresh global protected-balance snapshot rather than
  guessed or assumed to require a separate injection. Readiness remains blocked
  until that exact pence value and fingerprint are recorded.

**Still open and intentionally blocking:** the calculated reserve amount and
fingerprinted evidence, two real accepted shadow Friday records, production
protected-balance evidence, production migration/import/recovery review, exact
first-live Fraser plan, production deployment/activation authority, immediate
live reconciliation, history-view work, and any cap widening after the
two-cycle observation.

### Slice 8 — cleanup after a stable observation period

**Goal:** remove dead v1 mutation code only after v2 has demonstrated stability.

Deliverables:

- Delete unreachable v1 mutation paths.
- Preserve v1 read/history support.
- Remove duplicated preview math.
- Update `PROJECT.md`, `CLAUDE.md`, `docs/stripe-connect.md`, this plan, and
  operational runbooks.
- Document observed production outcomes.

---

## 16. Test strategy

Money correctness requires database-backed integration tests and fault injection,
not only mocked happy paths.

### 16.1 Pure calculation tests

- Legacy source always produces zero contribution.
- Instructor goodwill and free sources produce zero.
- Stripe-backed source respects actual discounted purchase contribution.
- Mixed-source booking allocations sum exactly.
- Commission calculation and fee allocation.
- Franchise fee, off-system zero-deposit policy, shortfall, and recovery.
- Penny rounding is deterministic.
- Current rate changes do not affect an existing earning.
- Missing fee/source evidence blocks.
- Source over-allocation blocks.
- Test accounts and instructor-absorbed rows follow existing policy.

### 16.2 Database constraint tests

- Same booking cannot create two earnings.
- Direct and school route cannot claim the same booking.
- Same logical transfer cannot receive two idempotency keys.
- Duplicate Stripe event is a no-op.
- Cross-school source/booking/instructor combination is rejected.
- Legacy source cannot have a positive payable pool.
- Transfer allocations cannot exceed source capacity.
- Concurrent planners claim each earning once.

### 16.3 Failure-injection tests

At minimum:

1. Database fails before Stripe call — no transfer.
2. Stripe definitely rejects — confirmed failure, claims retained for reviewed
   recovery.
3. Stripe succeeds but client times out — `reconciling`, no new key.
4. Stripe succeeds but DB update fails — reconciler finds and attaches transfer.
5. Process dies after persisting `submitting` but before Stripe call — reconciler
   safely submits with existing key.
6. Cron and manual trigger run concurrently — one logical batch/claim.
7. Two serverless instances run the same cron — one logical batch/claim.
8. Source charge is pending — source-linked transfer waits/blocks correctly.
9. Platform balance is insufficient — no unlinked unfunded transfer attempt.
10. Refund/dispute arrives before earning.
11. Refund/dispute arrives after transfer.
12. Connected bank payout fails after Connect transfer.
13. Webhook is delivered twice and out of order.
14. Webhook signature is invalid.
15. V1 and v2 paths are invoked for the same school — one hard refusal.
16. A school admin attempts a global or cross-school payout.

### 16.4 Migration tests

- Dry run is read-only.
- Legacy classification count and pence totals match diagnostics.
- Positive legacy contribution aborts migration.
- Ambiguous external cash/private Stripe rows remain manual review.
- Rerun is refused or a proven no-op.
- Migration marker and audit rows are written.
- No Stripe API is called.
- No historical BCS/refund/payout rows are mutated.

### 16.5 Production smoke criteria

For the capped first live batch:

- Shadow plan approved by owner.
- Protected free cash remains non-negative.
- Every earning has source evidence.
- Stripe transfer IDs reconcile to local transfer rows.
- No duplicate metadata/idempotency/amount combination.
- V1 created no overlapping payout.
- Instructor sees accurate transferred status.
- Connected-bank status is not overstated.
- Reconciler returns zero unresolved ambiguous transfers.

---

## 17. Observability and alerts

Create structured, non-PII logs and metrics for:

- eligible, earned, blocked, claimed, submitted, reconciled, transferred, and
  bank-paid pence;
- blocked funding classifications;
- legacy positive-contribution violations;
- source over-allocation attempts;
- plan fingerprint changes between preview and execute;
- transfers stuck in `submitting` or `reconciling`;
- webhook lag and webhook failures;
- local transfers missing in Stripe;
- Stripe transfers missing locally;
- protected free cash;
- dashboard/manual platform withdrawal effects;
- payout route overlap attempts;
- cross-school refusals.

Alert immediately for:

- any ambiguous transfer;
- any legacy source with positive payout contribution;
- any negative protected free-cash position;
- any duplicate or cross-route booking claim attempt;
- any Stripe-success/local-write failure;
- any unexplained Stripe transfer;
- any v1 mutation attempt after v2 cutover;
- any connected-bank payout failure.

Daily/weekly reports must distinguish:

- learner funds/refund exposure;
- earned unpaid instructor obligations;
- transfers in progress;
- connected account funds awaiting bank payout;
- true platform free cash;
- platform revenue;
- adjustments and unresolved incidents.

---

## 18. Operator runbook for cutover

### Before shadow mode

- Confirm latest production backup/PITR window.
- Confirm no payout migration or cron is currently running.
- Disable or pause v1 automatic payout mutation for the target school.
- Leave booking and learner payment collection live unless a diagnostic shows a
  source-ingestion problem.
- Reconcile Stripe charges, refunds, disputes, transfers, and local records.
- Resolve or block every manual-review source.
- Confirm current connected accounts are healthy.
- Confirm platform Stripe payout schedule and Dashboard access controls.

### Shadow Friday 1

- Generate v1 preview and v2 statement without transfers.
- Compare every booking, funding class, gross, fee, platform deduction, and
  instructor amount.
- Expect deliberate differences caused by removing unfunded/legacy positive
  fallbacks.
- Investigate every other difference.
- Preserve report and operator sign-off.

### Shadow Friday 2

- Repeat with newly created payments and bookings included.
- Confirm source ingestion worked throughout the week.
- Require zero unexplained differences and zero ambiguous sources.
- Run the full failure-injection suite against the test database.

### Capped live batch

- Select one instructor and a deliberately low maximum transfer.
- Generate and approve the final planner fingerprint.
- Confirm protected free cash.
- Submit using the v2 executor.
- Reconcile immediately to Stripe.
- Confirm the reconciler is clean.
- Verify instructor-facing wording.
- Do not widen the cap until the observation period is accepted.

### Full activation

- Switch the target school's engine version to v2.
- Confirm v1 mutation routes hard-refuse.
- Keep frequent reconciliation active.
- Review alerts and protected cash daily through at least two payout cycles.

### Rollback

After Stripe money may have moved, rollback never means deleting v2 rows or
re-enabling v1 blindly.

- Disable creation of new v2 batches.
- Keep webhooks and reconciliation running.
- Reconcile all `submitting` and `reconciling` transfers.
- Record any correction through adjustments/reversals.
- Use reviewed/manual statements for new obligations while the defect is fixed.
- Re-enable automation only after the affected plan and tests are corrected.

---

## 19. Explicit non-goals

This project must not:

- delete existing Stripe connected accounts;
- erase or rewrite v1 financial history;
- automatically cash-refund ordinary 48+ hour cancellations;
- broaden the current refund executor;
- restore dual lesson confirmation;
- change the three booking statuses;
- automate year-one franchise debt collection beyond current authorised policy;
- reintroduce an automatic platform bank sweep;
- treat the legacy pooled learner balance as spendable or payout-authoritative;
- change pricing policy;
- redesign all checkout flows;
- add speculative franchise features;
- make accounting or tax decisions for the owner;
- treat funds segregation private preview as a production dependency.

---

## 20. Decisions required before live mutation

The next implementation session may build read-only diagnostics, schema, and
tests without resolving every commercial choice. The £414 treatment is
resolved: recover it from future Fraser payouts using full-available-offset,
with a zero transfer floor and remainder carry-forward. It must not enable live
payout mutation until Fraser decides:

1. **External/cash bookings:** classify the 3 chargeable cash-labelled and 19
   chargeable Setmore/external-shaped rows as payable, already settled, or
   blocked, and define the evidence mandatory for any positive import.
2. **School payout route:** confirm school `1` remains
   `instructor_direct`. That is the only route currently Connect-ready; the
   confirmation locks migration policy rather than inferring future intent from
   today's configuration.
3. **Risk reserve:** what additional dispute/refund buffer sits above exact
   unused-credit exposure?
4. **First live cap:** maximum amount and selected instructor for the controlled
   first batch.
5. **Operator authority:** which role may approve/execute a live manual payout or
   adjustment?

Do not resolve missing answers by defaulting to school `1`, zero reserve, a
current list price, or an arbitrary accounting treatment.

---

## 21. Definition of done

Payout v2 is not done merely because a Stripe transfer succeeds.

It is done when:

- every instructor earning is source-backed or explicitly platform-funded;
- legacy pre-Connect credit can never create an automatic positive payout;
- no live price fallback exists in payout calculation;
- one booking cannot be paid by both direct and school routes;
- all v2 queries and rows are explicitly school-scoped;
- batch/claim creation is transactional;
- every transfer uses deterministic Stripe idempotency;
- ambiguous results reconcile instead of releasing claims;
- refunds/disputes create append-only adjustments;
- transfer and bank-payout states are distinct;
- protected free cash is visible and withdrawal-guarded;
- v1 mutation is disabled for v2 schools;
- the failure-injection suite passes;
- two shadow cycles have no unexplained differences;
- the capped live batch reconciles exactly;
- operator and incident runbooks are current;
- `PROJECT.md`, `CLAUDE.md`, and relevant docs describe the shipped system.

---

## 22. Suggested prompt for the next implementation chat

> Read `AGENTS.md` and `docs/payout-v2-implementation-plan.md`, then load every
> repository document listed in section 2 of the plan. Inspect the current
> payout, credit-source, refund, booking-status, tenancy, Stripe webhook, and
> migration implementations before changing anything. Review the completed
> inactive Slice 3 planner, shadow comparison, materializer, tests, diagnostics,
> and the owner-approved off-system vehicle-deposit policy. Continue with
> Slice 4 only: build an inactive,
> source-linked transfer executor and reconciler with deterministic Stripe
> idempotency, test-client injection, explicit school scope, and
> failure-injection coverage. Do not deploy a migration, apply a historical
> source import, change `payout_engine_version`, expose the executor to live
> cron/admin routes, call a live Stripe mutation, execute a payout, or write
> production financial data. Stop before webhook/bank-payout visibility.

---

## 23. Stripe reference links

- Separate charges and transfers:
  <https://docs.stripe.com/connect/separate-charges-and-transfers?locale=en-GB>
- Idempotent requests:
  <https://docs.stripe.com/api/idempotent_requests>
- Connected-account payouts and events:
  <https://docs.stripe.com/connect/payouts-connected-accounts?locale=en-GB>
- Accounts v2:
  <https://docs.stripe.com/connect/accounts-v2>
- Connected account configuration:
  <https://docs.stripe.com/connect/accounts-v2/connected-account-configuration>
- Migrating to controller properties:
  <https://docs.stripe.com/connect/migrate-to-controller-properties>
- Webhook signature verification:
  <https://docs.stripe.com/webhooks/signature>
- Restricted API keys:
  <https://docs.stripe.com/keys/restricted-api-keys>
