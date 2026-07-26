# Payout v2 Manual Stripe Dashboard Withdrawal Runbook

Status: inactive Slice 6 operator contract. No application withdrawal endpoint
or Stripe payout mutation is connected.

## Authority and access

Only a named platform superadmin or a separately configured, tightly scoped
platform-withdrawal operator may perform a manual Dashboard withdrawal. An
ordinary school admin may not perform or approve a global withdrawal.

Use the minimum practical Stripe Dashboard role that can view platform balance
and create the required platform payout without granting unrelated developer,
Connect-account, refund, or team-management permissions. Review the assigned
role whenever Stripe changes its Dashboard permission model. Require a passkey
or authenticator-app 2FA; do not rely on SMS where a stronger method is
available. Remove access immediately when a person changes role or leaves.

## Before a withdrawal

1. Confirm the platform Stripe payout schedule remains manual.
2. Run the same-day read-only protected-balance diagnostic with explicit global
   scope. Record its calculation version, input time, every component, blocker
   list, and calculation fingerprint.
3. If the diagnostic reports missing Slice 6 tables, missing reserve
   configuration, stale Stripe evidence, source/refund mismatch, manual-review
   evidence, a reconciling transfer, or any other blocker, stop. There is no
   fallback estimate.
4. Enter the proposed withdrawal in integer pence and run the withdrawal
   preflight. The preflight must use the server calculation, not a
   client-entered balance.
5. Confirm the projected protected free cash is non-negative and `allowed` is
   true.
6. A second authorised person reviews the amount, scope, component evidence,
   blocker list, reason, operator identity, deterministic idempotency identity,
   and calculation fingerprint. Both people record approval outside Stripe.
7. Immediately before opening the Stripe payout control, rerun the calculation.
   The fingerprint must still match the approved preflight. Any change requires
   a new preflight and second-person review.

## Dashboard action and evidence

Create only the reviewed platform-bank payout amount. Do not combine it with an
instructor Connect transfer, refund, dispute action, or unrelated balance
movement.

Immediately afterward record, through the future reviewed evidence writer:

- Stripe Dashboard payout identity;
- exact amount and currency;
- Stripe balance evidence time;
- operator and second reviewer;
- reason and confirmation fingerprint;
- preflight and calculation fingerprints;
- before/after protected balance;
- Dashboard action time and evidence reference.

The Stripe payout identity is globally unique. A replay is a no-op only when
the amount, scope, calculation fingerprint, and evidence are identical.

## Reconciliation

Rerun the read-only protected-balance diagnostic and the Payout v2 transfer and
bank-visibility diagnostics. Confirm:

- the Stripe available-balance movement matches the recorded Dashboard payout;
- no instructor transfer became ambiguous;
- approved refund and learner-source obligations remain unchanged;
- the resulting protected free cash matches the preflight projection;
- the recorded payout identity has one operator-evidence row;
- no alert or snapshot fingerprint disagreement exists.

## Negative protected balance

If protected free cash is negative:

1. Stop all discretionary platform withdrawals.
2. Do not release instructor claims or invent a new transfer idempotency key.
3. Preserve the calculation, Stripe balance evidence, alerts, payout identity,
   and access logs.
4. Classify the event as ordinary liability growth, observed external/manual
   Dashboard withdrawal, stale/missing Stripe evidence, or unexplained balance
   movement.
5. Resolve exact source, refund, transfer, dispute, and scope blockers without
   assumptions.
6. Escalate immediately to the platform owner and financial incident reviewer.
7. Revoke or suspend unnecessary Dashboard payout access while an unexplained
   movement is investigated.
8. Reconcile again before any payout, refund, or withdrawal is authorised.

## Technical limitation

Application code cannot prevent a Stripe Dashboard user with sufficient
permission from moving platform cash outside the application. The controls are
therefore layered: least-privilege Dashboard access, strong 2FA, a server-owned
preflight, second-person review, immutable evidence, same-day reconciliation,
and alerts for negative or unexplained positions.

The application must not claim that the preflight is a technical lock on the
Stripe Dashboard. It is an operator control and audit contract.
