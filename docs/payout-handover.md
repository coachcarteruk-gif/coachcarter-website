# Payout handover

Documentation consolidation: 29 September 2026, repository baseline `91902d2`. This is an entry point to recorded evidence, not a new live-state verification or permission to operate.

## What the records establish

- The protected 13 August direction is human-controlled interim v1 for Simon; Accounts v2/payout v2 work remains deferred. Preserve the account identity, pause, funding, audit, preview and approval controls in [payout contracts](payout-contracts.md).
- The [launch log](stripe-connect-simon-launch-project-log.md) contains valuable append-only evidence, but its original August summary predates later manual payments. “Not paid” in that summary must not be interpreted as an unpaid balance today.
- The [12 September supersession](simon-payout-2026-09-11-reconciliation-plan.md#12-september-2026-owner-authoritative-supersession) records the owner's manual payment for the period ending 11 September, and explicitly forbids transferring its superseded target again.
- The [13 September reconciliation](fraser-simon-stripe-balance-reconciliation-2026-09-13.md) records six manual payments and corrections to earlier conclusions. These are dated financial records, not today's cash balance or current payout permission.
- This cleanup has not checked current provider accounts, pause flags, balances, deployment status or production settlement coverage. Establish those from the applicable authorised preflight before operations. Never infer readiness from an old “implemented” or “pending” label.

## Read for a proposed operation

1. Read [payout contracts](payout-contracts.md), [Stripe Connect](stripe-connect.md), the protected [product specification](stripe-connect-simon-launch-product-spec.md) and [technical plan](stripe-connect-simon-launch-technical-implementation-plan.md). Their operational boundaries remain intact.
2. Use the [launch log's source hierarchy](stripe-connect-simon-launch-project-log.md#3-source-of-truth-documents), then read the dated entries, acceptance scenarios and rollout records for the operation or identity being resumed. Read the full relevant history if the current state cannot be established; the short handover is not a substitute for required evidence.
3. For a payment period, reconcile later manual-settlement evidence and immutable coverage claims before proposing another payout. An old preview amount is not authority to pay.
4. Verify the repository baseline and required current-state evidence. Onboarding, first payout, unattended later payouts, migrations and activation retain their separate authority requirements. V2 cutover and rollback use their dedicated runbooks.

Keep future current-state summaries here, with dated evidence links and explicit unverified facts. Append operational evidence to the log; never delete failed attempts or rewrite protected historical records.
