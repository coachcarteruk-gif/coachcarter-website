# Simon Stripe Connect launch — Slice 4 rollout review

Status: `IMPLEMENTED_INACTIVE_NOT_DEPLOYED`
Prepared: 9 August 2026
Branch: `codex/simon-slice4-accounts-v2-readiness`
Source: `origin/main` at `502e675dc338cf2d232045e09289fdc1fb5387c5` (PR #357 merge)

## Authority and non-actions

This slice implements only the Accounts v2 onboarding and agreement-readiness
foundation. It does not activate or replace legacy Connect, either payout
engine, Slice 3 retirement, earnings, transfers, refunds, or cutover.

No Stripe account, Account Link, onboarding session, login link, event
destination, payment, refund, payout, transfer, or other provider resource was
created or changed. No test/live Stripe mutation was submitted. No database
migration or SQL write was applied to staging or production. No Vercel project,
deployment, alias, domain, secret, key, environment variable, school feature,
or webhook was changed. The Stripe plugin was neither installed nor used.
Nothing was deployed or merged.

The protected LF-normalised hashes were exact before implementation:

- product specification:
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`;
- technical plan:
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.

## Official Stripe contract

The repository remains pinned to `stripe@22.4.0` and API
`2026-07-29.dahlia`. The installed SDK exposes Accounts v2 create/list/
retrieve, Accounts v2 Account Link creation, thin-event parsing, and
context-aware related-object retrieval. No upgrade was required.

Reviewed official sources: [Accounts v2](https://docs.stripe.com/api/v2/core/accounts),
[account creation](https://docs.stripe.com/api/v2/core/accounts/create),
[connected-account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration),
[Account Links](https://docs.stripe.com/api/v2/core/account-links/create),
[event destinations](https://docs.stripe.com/event-destinations), and
[Accounts v2 event types](https://docs.stripe.com/api/v2/core/events/event-types).

## Schema and route boundary

Additive migration `041_connect_v2_onboarding_readiness.sql` is inert and
unexecuted. It adds:

| Object | Purpose | Rule |
|---|---|---|
| `connect_v2_account_creation_intents` | One durable identity per school/instructor/mode/recipient | Immutable request/identity, constrained state machine, no delete |
| `connect_v2_account_creation_attempts` | Submission/reconciliation evidence | Append-only |
| `connect_v2_account_link_events` | Link/validated refresh/return evidence without URLs or tokens | Append-only |
| partial owner indexes | One instructor and one school Connect scope | Database-enforced |
| hardened agreement trigger | Freeze accepted drafts before approval | Accepted/active facts immutable; overlap/delete guards retained |

Existing `connect_account_state_events` and
`instructor_payout_agreement_versions` remain the state/agreement ledgers. No
Slice 4 table creates a payout, earning, transfer, refund, payment contract,
cutover event, or retirement activation.

Legacy actions stay unchanged. New actions routed through `api/connect.js` are:

| Action | Method/role | Boundary |
|---|---|---|
| `v2-account` | POST, same-school instructor | Create once, retrieve mapping, or reconcile uncertain creation |
| `v2-onboarding-link` | POST, instructor | Recipient hosted-onboarding link after all gates |
| `v2-onboarding-refresh` / `v2-onboarding-return` | GET, instructor + signed state | Exact scope validation; return retrieves current state and is not completion proof |
| `v2-status` | GET, instructor | Database-only readiness; diagnostic while mutation gates are off |
| `v2-dashboard-link` | POST, instructor | Separately gated Express login link |
| `v2-agreements` / `v2-agreement-accept` | GET/POST, instructor | Read and accept one exact fingerprint |
| `v2-admin-readiness` | GET, school admin | Sanitized school-scoped diagnostics |
| `v2-admin-agreement-draft` | POST, school admin | Append a server-validated draft |
| `v2-admin-agreement-activate` | POST, superadmin | Activate an accepted version only with current ready account evidence |

Mutations use existing cookie authentication, CSRF, school derivation, and
fail-closed audit helpers. Every business lookup includes `school_id`.
Responses expose stable codes and sanitized facts, never raw Stripe errors,
tokens, credentials, full payloads, or unnecessary PII.

`api/webhook-connect-v2.js` has a dedicated secret. Signature and thin-event
envelope validation precede ownership processing. Supported events are the
reviewed account, recipient capability/configuration, requirements, future
requirements, defaults, and identity types; the platform payment and connected
payout webhook trust boundaries are not reused.

## Strict inactive controls

No mutation has an implicit default. All applicable conditions must be exact:

1. `STRIPE_MODE` is `test` or `live`;
2. `STRIPE_CONNECT_V2_ENABLED=true`;
3. `schools.config.features.stripe_connect_accounts_v2` is JSON Boolean `true`
   for the authenticated school;
4. the relevant `STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED`,
   `STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED`, or
   `STRIPE_CONNECT_V2_DASHBOARD_LINKS_ENABLED` is `true`; agreement mutations
   require `STRIPE_CONNECT_V2_AGREEMENTS_ENABLED=true`, and event processing
   requires `STRIPE_CONNECT_V2_WEBHOOK_PROCESSING_ENABLED=true`; and
5. live mode additionally has `STRIPE_CONNECT_V2_LIVE_ENABLED=true`.

Missing/malformed/string values, wrong mode, and another school's value fail
closed. Gates precede mutation-client creation/provider calls. While inactive,
the webhook may verify its local signature but performs no Stripe object
retrieval and returns `202 processed=false`.

## Identity and ambiguous creation

The durable identity is
`cc:connect-v2:<school_id>:<instructor_id>:<test|live>:recipient`. A UUID intent,
stable Stripe idempotency key, request fingerprint, school, instructor, mode,
recipient configuration, and Express dashboard choice are stored before the
create request.

The reviewed payload requests a recipient configuration, Stripe-balance
transfers capability, Express access, UK individual shell, GBP/`en-GB`, and
platform fee/loss responsibility (`application`). A response must match the
Accounts v2 object, mode, configuration, dashboard, and exact ownership/intent
metadata before mapping. Provider identity is fill-once.

Network/timeout/rate-limit/API uncertainty moves the intent to `reconciling`;
create is never called again. The next command scans Accounts v2 recipient
pages for the exact stable metadata identity: zero matches remains reconciling,
one exact match is mapped, and multiple matches or incomplete evidence requires
manual review. Stripe's reviewed list API has no metadata filter, so this scan
exists only on the exceptional uncertain path and never selects approximately.

## Readiness truth table

`ready=true` requires every row. Missing, malformed, stale, contradictory,
incomplete, unknown, or mismatched evidence is not ready.

| Evidence | Ready only when |
|---|---|
| Ownership | Scope, observation, agreement, school, and instructor all match |
| Identity/mode | One immutable account mapping and current object match the expected test/live mode |
| Configuration | Mapping and current object are applied `recipient` |
| Dashboard | Mapping and current object are both `express` |
| Controller/identity | Fee/loss collectors are both `application`; country is `gb`; durable creation-intent metadata matches |
| Capability | Current recipient Stripe-balance transfers status is `active` |
| Requirements | No current/past-due or user-action requirement remains |
| Freshness | Latest observation is valid, at most 15 minutes old, and not future-dated |
| Consistency | Equal-time observations do not disagree |
| Agreement | Same-school/instructor/scope recipient version is accepted, approved, active, and effective |

The greatest `observed_at` always wins. An older ready row cannot override a
later pending/restricted/requirements-due row. Equal-time different
fingerprints are contradictory and fail closed.

Thin events are notifications rather than snapshots. After signature, ID,
type, account, mode, context, and scope checks, the handler retrieves
provider-current state and stores retrieval time as `observed_at`. Late event
delivery therefore cannot reapply historic payload. Replay succeeds only when
the stored envelope fingerprint, account, type, and context agree; reuse of an
event ID with different evidence conflicts.

## Agreement and UI rules

Commercial terms are validated admin-managed values, not Simon/Fraser
constants. Each change is a new version/fingerprint. Acceptance is conditional
on exact draft ID/fingerprint; accepted facts freeze before approval. Only a
superadmin may activate, after current account readiness. Existing exclusion
logic rejects overlapping active/paused periods, so supersession uses a new,
non-overlapping version. No agreement route changes `payouts_paused`, engine
version, first approval, earnings, transfers, refunds, cutover, or Slice 3.

The instructor earnings page retains legacy Connect and adds a separate future
readiness card with bounded human blockers and exact-version acceptance. Its
provider buttons appear only when the server reports active. The admin Payouts
page adds a read-only readiness table and explicitly says it cannot activate
money behavior.

## Test/staging runbook — not executed

This procedure requires separate staging/provider/migration authority. Stop if
any prerequisite is absent.

1. Reverify commit and protected hashes. Record an isolated non-production
   Vercel project/database/operator without printing secrets.
2. Rehearse migration 041 on a disposable clone. Confirm migrations 039/040,
   no duplicate owner scopes, zero new intent/attempt/link rows, and unchanged
   payout/refund/earning counts. Review and apply 041 to staging only.
3. Configure a least-privilege Stripe test Accounts v2 key, dedicated test
   event-secret/destination, `STRIPE_MODE=test`, staging `BASE_URL`, named
   gates, and JSON Boolean school flag. Keep the live gate absent/false and
   prove another school remains inactive.
4. Register only `_connect-v2.js` supported thin types at
   `/api/webhook-connect-v2`; never reuse platform payment/payout secrets.
5. As a same-school test instructor, record initial not-ready `v2-status`, call
   `v2-account` once, and verify the intent preceded the call, exactly one
   account mapped, and mode/config/dashboard/metadata are exact.
6. Repeat with an injected timeout after submission. Confirm `reconciling` and
   that the next command performs list/retrieval with zero create calls. Test
   zero, one, and multiple matches; multiple must stop for manual review.
7. Create an onboarding link, manually use hosted test onboarding, and exercise
   expiry refresh/return. Tampered state or wrong cookie/school/instructor/
   scope/account/mode must fail before access. Return alone is not ready.
8. Deliver signed test events normally, duplicated, and reversed. Confirm
   replay, contradiction, context/account/mode rejection, alerting, and that a
   current restriction or due requirement immediately defeats historic ready.
9. Append an admin draft, accept as the exact instructor, prove editing and
   overlap fail, then activate as scoped superadmin only after readiness. Prove
   supersession requires a new version.
10. Query minimum fields proving zero changes to payout engine,
    `payouts_paused`, Slice 3, legacy account mappings, and all money ledgers.
    Run the complete local/regression/browser verification matrix.
11. Disable all operation/global gates and the school Boolean. Confirm provider
    calls fail before access while retained evidence remains readable.

Never execute this runbook in production under this task. Do not substitute a
live key, production project/database, Simon/Fraser identity, or real bank data.

## Disable/rollback

Set operation gates then global gate false/absent; set the school JSON feature
Boolean false under separate authority; disable any event destination under
separate provider authority. Preserve/reconcile any submitted intent using its
original identity—never create a replacement. Return UI use to unchanged legacy
Connect. Retain schema, provider accounts, mappings, intents, attempts,
observations, agreements, link events, and audit rows. Rollback means stop use,
not destructive down-migration.

## Verification evidence and limitations

Current local evidence (no Stripe/production access): syntax passed for 204
JavaScript files; C1 passed for 276 files; focused mocked/browser Slice 4 tests
passed 15/15 using installed system Chrome; all 14 canonical Stripe launch
schema-foundation checks passed; broader Stripe/auth/tenant/booking/
credit/refund/payout/webhook/launch regressions passed 250/250; and migration
035's nine raw-byte rollout guards passed under temporary LF normalization with
the exact original Windows checkout bytes restored afterward. Final syntax and
C1 reruns remained green, `git diff --check` passed, and both protected
LF-normalised hashes remained exact. The primary workspace and every registered
worktree were re-inspected; only the pre-existing detached `cc5f` worktree was
dirty, and it remained untouched.

Migration 041 and the provider contract are unexecuted. The exact create
payload, test event-context representation, hosted flow, and Accounts v2
recipient compatibility with the existing Express login-link call remain
staging holds. Reconciliation scans recipient pages because no metadata filter
is available. Evidence older than 15 minutes deliberately blocks. Production
gates/secrets/destinations/flags/accounts/agreements/migrations remain unchanged
and unapproved. Slice 5 and all money, activation, deployment, and merge work
remain outside scope.
