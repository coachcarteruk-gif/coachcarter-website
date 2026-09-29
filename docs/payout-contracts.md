# Payout maintenance contracts

Read this for payout eligibility, claims, transfers or engine changes, together with [booking statuses](booking-statuses.md) and [Stripe Connect](stripe-connect.md). For Simon rollout or shadow work, start with [the current handover](payout-handover.md). These are preserved controls, not new production authority.

## Simon interim v1 boundary

Simon does **not** need Accounts v2 or payout v2 before initial onboarding/payment. CoachCarter remains school-wide on v1 while a focused, human-controlled Express/v1 path is hardened: durable ambiguity-safe account creation, exact tenant/audit scope, deliberate `payouts_start_date`, `payouts_paused=true`, exact approved CoachCarter Stripe funding in addition to `chargeable`, an itemised Fraser preview, and explicit first-run approval. The weekly fee comes from `weekly_franchise_fee_pence`; negative/insufficient weeks stay human-handled. Do not add routine lesson-outcome confirmation—the three-state/48-hour calendar rule and `mark-not-delivered` exception remain authoritative. Preserve all Accounts v2 test/A8 evidence as inactive long-term work; never reuse it as the Production v1 identity. Onboarding, first payout and unattended later payouts require separate authority.

## Inactive v2 cutover and rollback controls

The preserved 26 July 2026 record says migration 035 was applied schema-only, with the v2 engine inactive.
Its deployment evidence is under `db/rollouts/035-payout-v2-schema-only.*`;
postflight confirmed all 25 v2 tables were empty, all 39 guard triggers were
present, and every school remained payout engine `v1`. The historical source-ingestion application record is a prepared review, not production authority. Re-verify current rollout evidence before an operational change.
Do not import
`_payout-v2-cutover.js` into a live route, switch an engine, apply an import or
opening recovery, or execute a batch without a future explicit production
authorization and the evidence in `docs/payout-v2-cutover-runbook.md`.

Cutover is per school, fingerprint-bound, and owner-approved. It requires two
distinct accepted shadow Fridays, exact route/reserve/protected/external-cash/
Setmore evidence, one named superadmin or scoped operator, and a hard first-live
cap. An over-cap plan blocks; never truncate or split it. Ordinary school admins
cannot cut over or perform global payout operations. After a future school
transition to v2, all v1 mutation for that school must refuse before claims,
writes, or Stripe calls.
The cash authority must be an explicit current global protected-balance/reserve
fingerprint; a per-school readiness record must not relabel undivided platform
Stripe cash as school-owned free cash.

After any possible Stripe movement, rollback means freeze new batches, preserve
claims and append-only evidence, and continue webhooks/reconciliation. Never
release ambiguous claims, invent a new idempotency key, delete financial rows,
or blindly re-enable v1. A Connect transfer is not connected-bank settlement.
See `docs/payout-v2-rollback-incident-runbook.md`.

## Payout summary images

The image generator has its own [calculation and rendering contract](payout/PAYOUT-SUMMARY-SPEC.md#calculation-and-rendering-maintenance-contract). Do not apply its truncation rules to other payout engines whose approved contracts use different rounding.
