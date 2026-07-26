# Payout v2 controlled-cutover runbook

**Current status (26 July 2026): preparation only, inactive and prohibited from
activation.** Migration 035 is installed schema-only and inactive. No source
import or £414 opening recovery adjustment has been applied, every school
remains on payout engine `v1`, and no live route imports the cutover module.
The source-ingestion application rollout is prepared for review but is not
approved or deployed. This runbook is a future operator contract, not
permission to cut over or pay anyone.

Read `docs/payout-v2-implementation-plan.md`,
`docs/payout-v2-manual-withdrawal-runbook.md`, and
`docs/payout-v2-rollback-incident-runbook.md` before using this procedure.

## Vocabulary

- **Shadow cycle:** one Friday-period v1 preview and v2 statement comparison.
  It creates no claim, transfer, payout, or engine change.
- **Accepted shadow cycle:** immutable owner-signed evidence with zero
  unexplained differences and zero ambiguous sources. Exactly two distinct
  periods and statement fingerprints are required.
- **Protected calculation fingerprint:** the authoritative Slice 6 calculation
  identity. UI text, an old screenshot, and a free-cash number alone are not
  authority.
- **Transfer readiness:** cash available for source-backed Connect transfers
  now. It is not permission for a platform withdrawal.
- **Connect-transferred:** Stripe accepted a platform-to-connected-account
  transfer and local evidence reconciles. It does not mean the connected bank
  has been paid.
- **Cutover:** the transaction that writes an immutable engine-transition event
  and changes exactly one `schools.payout_engine_version` from `v1` to `v2`.
- **Rollback control:** a freeze-and-reconcile response. It never means deleting
  v2 evidence, releasing ambiguous claims, or blindly re-enabling v1.

## Authority

Only the platform owner can approve the target school, route, first-live
instructor, hard cap, reserve evidence, and named mutation operator. The named
operator must be a superadmin or an explicitly configured scoped operator with
the exact target school and operations. An ordinary school admin cannot approve
or execute cutover. Global scope is never inferred from a missing school ID.

The production operator must be different from or reviewed by the owner where
practical. Use a restricted Stripe key appropriate to the exact future
operation; never paste a live key into a command, document, test, or evidence
row.

## Required immutable records

All values are explicit; there are no commercial or safety defaults.

1. One latest owner-approved `payout_v2_cutover_config_versions` row containing:
   target `school_id`, `instructor_direct` route, first-live instructor, positive
   hard cap in pence, named operator and allowed operations, risk-reserve config
   fingerprint, explicit global protected-calculation scope/fingerprint, route evidence, completed
   external/cash classification, Setmore classification or explicit
   not-applicable evidence, owner sign-off, and rollback criteria.
2. Exactly two `payout_v2_shadow_cycle_evidence` records for distinct Friday
   periods and distinct v2 statement fingerprints.
3. One freshly computed `payout_v2_cutover_readiness_snapshots` row whose status
   is `ready` and blocker array is empty.
4. One capped first-batch dry-run event bound to the readiness, config, and exact
   planner fingerprints.

These rows are append-only. A changed decision creates a new config version or
new evidence event; it never edits history.

## Pre-cutover diagnostic

Run the read-only `db/diagnostics/payout-v2-cutover-readiness.sql` for one
explicit school. The operator must reconcile its result with the application
readiness snapshot and separately preserve current Stripe evidence. Stop if any
of these is non-zero or incomplete:

- cross-school or cross-route claim violations;
- positive-payable legacy funding;
- unresolved external/cash/manual-review sources;
- submitting/reconciling transfers;
- active payout-v2 incidents;
- v1 `pending` or `processing` payouts;
- global protected-balance blockers, stale evidence, or insufficient transfer
  readiness;
- missing owner/operator/route/reserve/Setmore evidence.

Read-only diagnostics do not approve cutover. Never reconstruct funding from a
current lesson price, `learner_users.balance_minutes`, or another aggregate.
Ambiguous Stripe evidence remains blocked.

## Shadow Friday 1

1. Confirm no payout/import/migration job is running for the school.
2. Generate a school-scoped v1 preview and v2 statement without mutation.
3. Compare every booking, route, immutable funding source, gross snapshot,
   Stripe fee, platform/franchise/recovery deduction, and instructor amount.
4. Label the known off-system vehicle-deposit difference explicitly: v2 deposit
   deduction is always zero.
5. Resolve or block every other difference and every ambiguous source.
6. Preserve the exact reports, fingerprints, evidence reference, and owner
   decision. Rejected cycles remain rejected; do not overwrite them.

## Shadow Friday 2

Repeat against a distinct period containing newly created payments/bookings.
Require zero unexplained differences, zero ambiguous sources, and a clean full
test/failure-injection run. Preserve the second immutable acceptance record.

## Capped first-batch dry-run

The approved cap is a hard ceiling, not a truncation target. The dry-run must
match the configured school, `instructor_direct` route, first-live instructor,
readiness fingerprint, config fingerprint, and reviewed plan fingerprint. The
entire `net_shadow_transfer_pence` must be positive and no more than the cap.

If the plan exceeds the cap, stop and produce a newly scoped/reviewed plan.
Never split claims, shave the amount, alter planner JSON, or reuse approval for
a different fingerprint. The Slice 7 dry-run returns
`stripe_call_allowed=false`; it cannot execute the batch.

## Future authorised cutover window

This section remains prohibited until the owner supplies every open decision,
migration 035 is separately reviewed/deployed, historical evidence is imported
under its own gate, and a production change is explicitly authorised.

1. Freeze new payout-v2 batch creation and confirm no v1 payout is in flight.
2. Re-run source, earning, transfer, protected-balance, and cutover diagnostics.
3. Recompute and persist a fresh ready snapshot. Any fingerprint change voids
   the prior confirmation.
4. Call the server-only transaction primitive with the exact confirmation,
   named operator, school scope, deterministic idempotency identity, and
   readiness fingerprint. The transaction requires the exact current global
   protected snapshot and global reserve record; it never relabels global
   platform cash as school cash.
5. The transaction locks the school, rechecks `v1`, immutable config, two
   accepted shadows, named operator, and active incidents; then it writes the
   engine-transition event and changes that school to `v2` atomically.
6. Verify every v1 cron/admin/school mutation for that school hard-refuses
   before a booking claim, database mutation, or Stripe call.
7. Only then may a separately authorised executor submit the exact capped plan.
   No live executor is wired by Slice 7 preparation.

## Immediate post-batch reconciliation

Before widening any cap or processing another instructor:

- match local transfer ID, Stripe transfer ID, amount, currency, destination,
  metadata, source groups, plan fingerprint, and idempotency identity;
- require zero unresolved/ambiguous attempts and zero v1 overlap;
- recompute protected free cash and require it to remain non-negative;
- record the connected-bank state separately (`pending`, `paid`, `failed`, or
  `operator_review`);
- persist a post-batch reconciliation event or open an incident;
- observe at least the owner-approved period before any cap change.

Stripe transfer success is not bank settlement. Never present `transferred` as
`bank_paid`.

## Stop conditions

Stop before money movement for any blocker or fingerprint drift. After a Stripe
request may have been accepted, treat timeouts and lost responses as ambiguous:
retain claims, use the same identity, reconcile, and follow the rollback/incident
runbook. Never release a claim merely because a request threw an error.

## Owner decisions

Recorded 26 July 2026:

- Long-term school 1 route: direct to each instructor through Stripe Connect
  (`instructor_direct`).
- First-live instructor: Fraser.
- First-live hard cap: £10 / 1,000 pence.
- Named mutation operator: Fraser only.
- Cash, Setmore, and other external/private payment sources: block unless
  positively proven.
- Minimum observation before cap widening: two complete successful payout
  cycles.

The owner has approved retaining all residual platform cash in Stripe during
the first-live cutover and two-cycle observation period, with no discretionary
platform withdrawal. The exact reserve is still recorded in pence from a fresh
global protected-balance snapshot; it is not guessed and missing evidence never
silently means zero. This does not automatically require a separate cash
injection. If existing available cash cannot protect all exact obligations,
record the calculated reserve, and support the £10 batch, cutover remains
blocked unless cash arrives or the owner later authorises an injection.

Still required are the evidence records supporting these decisions, two real
accepted shadow Fridays, the exact Fraser plan, protected-balance evidence, and
separate production deployment/activation authority.
