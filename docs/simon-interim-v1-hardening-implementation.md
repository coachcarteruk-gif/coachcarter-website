# Simon interim v1 hardening — implementation handover

**Implementation baseline:** `origin/main` `f29e67d945a559fd00c7ff08e1f34c96514e01f1` (merged PR #388)

**Branch:** `codex/simon-interim-v1-hardening`
**State:** implemented locally for review; not migrated, deployed, configured or operated

This milestone hardens the existing Stripe Connect Express/Accounts-v1 path for one deliberately controlled instructor without changing the school's payout engine from v1. It does not activate Simon, create a real account, send an invitation, query Production candidates or move money. Accounts v2 and payout v2 remain preserved, inactive long-term work.

## Safety model

Migration 043 is additive and inert. An instructor enters the interim boundary only after a superadmin invokes the explicit preparation command with a real `payouts_start_date`. That transaction creates the durable account intent and immutable control row and sets `payouts_paused=true` before any provider create call. No Simon ID or commercial amount is seeded or hardcoded.

The presence of `interim_v1_instructor_controls` has two permanent effects:

1. generic Friday cron and generic admin bulk payout selection exclude that instructor; and
2. the generic pause control cannot unpause them.

The dedicated flow never sets `payouts_paused=false`. Completion of the reviewed first transfer also blocks a second approval under this milestone.

## Durable account preparation

`api/_connect-v1-interim.js` adds superadmin-only actions:

| Action | Effect | Exact confirmation |
|---|---|---|
| `interim-v1-status` | Database-only status | none |
| `interim-v1-account` | Persist start/pause/identity, then create or reconcile exactly one live Express account | `CREATE_INTERIM_V1_ACCOUNT_CONFIRMED` |
| `interim-v1-invite` | Create a hosted onboarding link and send the invitation only after exact mapping/start/pause checks | `SEND_INTERIM_V1_INVITE_CONFIRMED` |

Account identity is `cc:connect-v1:<school_id>:<instructor_id>:live:express`; the provider idempotency key is derived once from the immutable intent UUID. A timeout or malformed success enters `reconciling`. Reconciliation scans a bounded account listing for exact metadata. Zero matches wait, one exact live match maps, and multiple matches stop for manual review. No ambiguous state can create a replacement account.

The older instructor/admin account-create and invitation routes now refuse new or unprepared instructor identities. Existing mapped instructor self-service links remain available.

## Exact funding boundary

For a controlled instructor, the direct-slot webhook records an immutable `interim_v1_funding_evidence` row only after the booking, `slot_purchase` credit transaction and one active booking-credit-source row exist. Evidence is `pending` unless it contains all of:

- live provider mode;
- Checkout Session, PaymentIntent, Charge and balance-transaction IDs;
- Stripe payment creation and funds-availability timestamps;
- exact positive GBP gross and exact non-null Stripe fee.

The payout classifier independently rechecks the school, learner, instructor, booking, credit transaction and BCS relationship. Positive eligibility requires `chargeable`, non-test learner, booking and payment on/after the deliberate start, available funds, direct-slot origin, exactly one active BCS, matching identities/amounts/fees and no existing payout claim. Cash, external/Setmore, credit, offer, test-date, pre-start, pending, contradictory, refunded, multi-source and test-mode shapes receive stable exclusion reason codes and £0/manual treatment. Missing fees never become zero.

## Preview, approval and first transfer

`api/_interim-v1-payout.js` exposes superadmin-only admin actions:

| Action | Boundary |
|---|---|
| `interim-v1-payout-preview` | Read-only itemised included/excluded lines and exact canonical fingerprint |
| `interim-v1-approve-first-run` | Stores an immutable owner approval for the recomputed fingerprint and amount; no Stripe call |
| `interim-v1-process-approved-payout` | Rechecks live Connect readiness, recomputes under a lock, persists payout/claims/transfer intent, then submits once with stable idempotency |
| `interim-v1-reconcile-transfer` | Bounded exact-metadata lookup for an ambiguous transfer; never submits a replacement |

The preview shows exact source identities, gross, Stripe fee, configured `weekly_franchise_fee_pence`, exclusions and proposed transfer. It uses the same classifier/calculation as materialisation. The fixed fee is loaded from the instructor row; £90 and Simon's database ID do not appear in production code. If gross net of exact fees cannot cover the configured weekly fee, the transfer is £0 and blocked for human handling; no debt, deposit or shortfall automation is created.

Approval requires `APPROVE_INTERIM_V1_FIRST_RUN_CONFIRMED`, a reason, independent evidence reference, exact fingerprint and exact amount. Movement separately requires `PROCESS_INTERIM_V1_APPROVED_PAYOUT_CONFIRMED`. A stale fingerprint stops before claims or Stripe. Provider ambiguity retains the payout lines and durable intent in reconciliation; definite failure also retains claims for operator review. Successful reconciliation or submission completes the payout but leaves the instructor paused.

## Schema and deployment ordering

1. Review and apply `db/migrations/043_simon_interim_v1_hardening.sql` before application code. It creates no operational rows.
2. Deploy the application code only after the migration is verified.
3. Do not create a control row, account, invitation or approval without a later authority naming that exact operation.
4. Do not unpause the instructor. A later reviewed milestone is required for ongoing payouts.

Rollback before any control row is application rollback plus leaving the additive empty tables in place. After a control/intent/evidence/approval/transfer row exists, preserve it as financial audit evidence; do not delete, rewrite, release ambiguous claims or fall back to the generic v1 path.

## Verification

`tests/simon-interim-v1-hardening.spec.js` covers stable identity/idempotency, exact reconciliation, tenant/mode rejection, funding-origin truth table, the known pre-start £55/£1.03 shape, configurable-fee conservation, missing-fee handling, generic-path isolation, distinct authority, transfer identity and protected-document hashes. Relevant existing payout and Accounts-v2 suites remain part of regression verification.

No operator controller, A8 or A9 command is part of this implementation.
