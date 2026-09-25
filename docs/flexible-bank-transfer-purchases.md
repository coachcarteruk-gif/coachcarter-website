# Flexible Hours paid by bank transfer

Implemented 25 September 2026; migration 072 and deployment pending. No live
receipt, learner balance, school gate, Stripe resource or payout changed.

## Admin workflow

Open **Admin → Learner Packages → Flexible Hours → Record bank-transfer purchase**.
Choose the verified learner and current package. Enter the amount received, date,
bank's unique transaction reference, consent evidence reference and audit reason.
Confirm cleared funds and the learner's existing adult declaration, acceptance of
the displayed terms and express immediate-access request. Keep statements and
consent evidence in operator records; enter references rather than account details
or copied correspondence. Use the bank transaction identity, not a reusable payer
narrative such as "driving lessons".

The received amount must match the current immutable catalogue price. Partial
payments, discounts and historical-price overrides are unsupported. A changed
version requires reloading. A 15-hour purchase adds 30 units / 900 minutes of real
school-wide Flexible Hours at the purchased value. A separate already-received
transfer may add another FIFO source even if hours remain. An unresolved online
checkout must be resolved first. No learner message is sent.

## Authority and accounting

`bank-purchase-options` (GET) and `record-bank-purchase` (POST) on
`/api/flexible-packages` use existing admin authentication, CSRF and school scope.
The existing exact School 1 live purchasing gate is required; nothing enables it.
Price, units and terms are read server-side from the current active visible version.

Receipt, purchase, source, state event and required audit write commit atomically.
A UUID binds the request payload; a unique school-scoped hash of the normalised
bank reference prevents duplicates after reload or across admins/learners. Exact
replays return the original result; changed details conflict. A unique-constraint
race retries once after full rollback. Bank recording and online attempt insertion
lock the same learner; online Checkout rechecks the balance under that lock before
creating a Stripe session. Valid late Stripe success retains its own fulfilment.

Bank purchases have `payment_provider='bank_transfer'`, a receipt link and no
Stripe Checkout/PaymentIntent/attempt identities. A database CHECK preserves the
required identities for Stripe purchases. Bank sources record zero Stripe fee
with explicit non-Stripe evidence. Payment date does not backdate source availability.
Normal package bookings, extensions, returns and reschedules use the existing ledger.
Ordinary instructor credit balances are untouched.

Bank purchases create no earnings or payouts and no Stripe cash. Existing payout
checks still require an audited manual funding basis for non-Stripe-funded lessons.
Use the existing audited funding review before instructor settlement; never insert
synthetic Stripe evidence to clear a blocker.

The Stripe refund form is hidden for bank purchases, and the existing API rejects
sources without a PaymentIntent. A bank-package cash-refund/reduction recorder is
outside this slice. Handle required refunds as operator cases; do not adjust ordinary
credit or fabricate a Stripe refund ID to reduce these hours.

## Privacy and verification

Learner export includes receipt amount/date, references, reason and declarations.
Shared GDPR deletion detaches the learner and clears the bank reference, consent
reference and reason. Financial facts, actor identity, opaque duplicate-protection
hashes and purchase links remain for seven-year financial retention. The append-only
trigger allows only this exact anonymisation. Audit/state events store receipt IDs
and financial facts, without copying the free-text evidence.

Local PostgreSQL tests (PGlite) execute the real package schema and migration,
checking values, duplicate/conflicting submissions, tenancy, gates, verification,
rollback, pending Checkout, spending/returns, privacy, constraints and auth/CSRF.
Browser tests cover desktop/mobile submission, stable retries and bank-origin history.
Existing package webhook, extension and discount suites remain required. Local tests
do not prove production runtime grants or multi-connection concurrency.

## Rollout

Rehearse 072 on a disposable production-derived database and verify runtime role
SELECT/INSERT access plus the GDPR anonymisation path. Follow manifest order with
the governed runner; do not skip other pending numbered migrations. Apply 072 before
deploying because the admin overview reads the new schema. Migration execution and
deployment require the separate approval specified in the Flexible Hours runbook.
Do not record Amelie's real purchase as a smoke test.

To roll back, restore the prior app deployment and retain the append-only schema
and rows. Existing balance reads and booking allocations still work. Never delete
a receipt or historical source to undo a purchase.
