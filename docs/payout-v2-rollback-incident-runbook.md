# Payout v2 rollback and incident runbook

**Current status:** inactive future-use contract. It does not authorise a
migration, engine change, payout, transfer, withdrawal, refund, or production
write.

## Non-negotiable rollback meaning

Once a Stripe transfer might exist, rollback means **freeze, preserve, and
reconcile**. It never means:

- deleting payout-v2 ledger, evidence, attempt, claim, or event rows;
- releasing a claim with an ambiguous Stripe outcome;
- changing an idempotency key to force a retry;
- marking a Connect transfer as bank-paid without exact payout evidence;
- reversing historical financial rows in place;
- re-enabling v1 mutation for the school while v2 claims or transfers exist.

Corrections use append-only adjustments/reversals with reviewed evidence.

## Incident triggers

Open an incident immediately for:

- a `submitting`/`reconciling` or otherwise ambiguous transfer;
- Stripe success with a failed/missing local write;
- local/Stripe identity, amount, destination, source, metadata, or planner
  fingerprint mismatch;
- any duplicate or cross-route booking claim;
- any v1 mutation attempt after engine v2;
- positive payable legacy contribution;
- unresolved external/cash/manual-review evidence entering a plan;
- negative protected free cash or unexplained Stripe balance movement;
- connected-bank payout failure or contradictory terminal webhook evidence;
- cross-school evidence or authority failure.

## Immediate control

1. Record who declared the incident, exact `school_id`, time, reason, affected
   plan/batch/transfer IDs, and non-PII fingerprints.
2. Persist an append-only `incident_opened` or `rollback_started` event.
3. Freeze creation/submission of new v2 batches for the school.
4. Keep signed webhooks, event receipts, and reconciliation running.
5. Keep all claims and immutable rows in place.
6. Prevent v1 mutation from taking over the same school.
7. Preserve Stripe request IDs, transfer IDs, balance transactions, connected
   account, idempotency identity, and raw signed-event receipt references.
8. Notify the platform owner. Do not expose raw SQL/Stripe errors or learner PII
   in alerts.

## Ambiguous transfer investigation

Use the existing same-day reconciler with the original deterministic identity.
Compare exact school, destination, amount, currency, transfer group, source
charge, metadata, plan fingerprint, and idempotency key.

- Exact Stripe match: attach/preserve success evidence; do not submit again.
- Authoritative same-day not-found result satisfying the executor contract:
  only the existing same key may become retryable after review.
- Multiple/partial/mismatched candidates or unavailable evidence: remain
  `reconciling`/operator review.

Never infer success or failure from an HTTP timeout alone.

## Connected-bank failure

A failed connected-account bank payout does not undo a successful platform
transfer and does not release the underlying lesson claims. Preserve the
Connect-transferred state, record the bank failure separately, and follow
Stripe account remediation/retry evidence. Approximate date/amount correlation
is forbidden; use exact balance-transaction source identities.

## Protected-cash incident

Recompute the authoritative Slice 6 calculation with fresh Stripe available and
pending evidence. Pending cash remains separate. Confirm unused source-attributed
learner exposure, earned/untransferred obligations, in-flight transfer
obligations, latest approved/unexecuted refunds, and the configured reserve are
disjoint and complete. Stop all new payout/withdrawal mutations until the
calculation is complete, fingerprinted, and non-negative.

## Resolution evidence

An incident may be marked resolved only when:

- all affected transfers have an exact local/Stripe classification;
- no ambiguous attempt or cross-route/v1 overlap remains;
- source and earning conservation diagnostics are clean;
- protected free cash is non-negative with a current fingerprint;
- any correction is append-only and reviewed;
- connected-bank wording reflects its actual state;
- the defect has focused regression/failure-injection coverage;
- the owner accepts the resolution and automation-restart criteria.

Record `incident_resolved` or `rollback_completed` as a new event. Do not edit
the opening event.

## Restart criteria

Restarting v2 requires a fresh readiness snapshot and exact owner/operator
approval. Re-enabling v1 is a separate future migration decision and is not a
rollback shortcut. If v2 rows or possible Stripe transfers exist, v1 must remain
unable to claim the same bookings.
