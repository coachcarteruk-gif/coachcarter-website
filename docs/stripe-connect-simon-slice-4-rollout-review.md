# Simon Stripe Connect launch — Slice 4 rollout review

Status: `MERGED_DEPLOYED_INACTIVE; STAGING_ATTEMPT_3_STOPPED_RECONCILIATION_LIST_LIMIT_DISABLED`
Prepared: 9 August 2026; updated 10 August 2026
Branch: `codex/simon-slice4-accounts-v2-readiness`
Source: `origin/main` at `502e675dc338cf2d232045e09289fdc1fb5387c5` (PR #357 merge)

Staging acceptance attempt: 9 August 2026 on
`codex/simon-slice4-staging-acceptance`, exact source and then-current
`origin/main` `ccafbfc483937f2005f99f334134c92d46c8f28b` (includes merged PR
#359). The attempt stopped before Accounts v2 provider use because Vercel
classified the isolated project's first deployment as a `production` target.

Staging acceptance attempt 2: 9 August 2026 on
`codex/simon-slice4-staging-acceptance-2`, exact source and then-current
`origin/main` `90183a9889458581718fb3438403e703f36b8b9a` (merged PR #360).
This attempt also stopped before configuration or Accounts v2 provider use:
Vercel classified an explicitly requested `--target preview` first deployment
as `production` and assigned project aliases.

Staging acceptance attempt 3: 10 August 2026 on
`codex/simon-slice4-staging-acceptance-3`, exact source and then-current
`origin/main` `7bea1fbc3cd05b0fabadfed28956c7c83dbf2bbb` (merged PR #361).
The custom Vercel environment was proven Preview and enabled a partial real
Stripe test exercise. Fraser creation succeeded singularly; Simon's injected
ambiguous result produced one singular account, but merged reconciliation
failed because it requests `limit: 100` while Stripe permits at most `20`.
All staging gates and the school flag are false, the destination is disabled,
and no remaining acceptance case is approved until that code defect is fixed
and the original Simon identity is reconciled without replacement.

## Authority and non-actions

This slice implements only the Accounts v2 onboarding and agreement-readiness
foundation. It does not activate or replace legacy Connect, either payout
engine, Slice 3 retirement, earnings, transfers, refunds, or cutover.

During the original implementation/review session, no Stripe account, Account Link, onboarding session, login link, event
destination, payment, refund, payout, transfer, or other provider resource was
created or changed. No test/live Stripe mutation was submitted. No database
migration or SQL write was applied to staging or production. No Vercel project,
deployment, alias, domain, secret, key, environment variable, school feature,
or webhook was changed. The Stripe plugin was neither installed nor used.
Nothing was deployed or merged in that implementation session. The later,
partially executed staging attempt and its hard stop are recorded below.

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

## Test/staging runbook — original plan; partial stopped attempt recorded below

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

At the original implementation review, migration 041 and the provider contract
were unexecuted. The stopped staging attempt below later applied migration 041
only to its disposable branch, but it did not execute any Stripe provider
contract. The exact create payload, test event-context representation, hosted
flow, and Accounts v2 recipient compatibility with the existing Express
login-link call therefore remain staging holds. Reconciliation scans recipient
pages because no metadata filter is available. Evidence older than 15 minutes
deliberately blocks. CoachCarter production gates, secrets, destinations,
flags, accounts, agreements, and migrations remain unchanged and unapproved.
Slice 5 and all money activation remain outside scope.

## Slice 4 staging acceptance attempt - stopped 9 August 2026

This attempt used a fresh worktree at
`C:\tmp\coachcarter-simon-slice4-staging-acceptance` and branch
`codex/simon-slice4-staging-acceptance`. Before any provider or database write,
`git ls-remote origin refs/heads/main` and the local fetched ref both resolved
to exact commit `ccafbfc483937f2005f99f334134c92d46c8f28b`. The protected
LF-normalised SHA-256 values were reverified as
`79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
and `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
Every pre-existing worktree and user change remained untouched.

The disposable database resource was Neon project
`shiny-bonus-66942766` in isolated organisation
`org-fancy-forest-47074420`, branch `br-dark-recipe-zarmjbix`, name
`cc-simon-s4-acceptance-01-20260809`, database `neondb`. Neon reports branch
creation at `2026-08-09T18:02:22Z`, parent
`br-empty-cell-za5kh6nr`, `primary=false`, `default=false`, and
`protected=false`. Read-only preflight proved the public schema and all actual
prerequisite tables, migration 041 absent, zero duplicate instructor-owner
mappings, zero duplicate school-owner mappings, no existing connected-account
scope, the school v2 flag absent, payout engine `v1`, and the inherited Slice 3
config still `shadow` and unactivated.

The exact repository file
`db/migrations/041_connect_v2_onboarding_readiness.sql` was applied as one
transaction only to `br-dark-recipe-zarmjbix`. Postflight proved all three
tables present and empty, the six reviewed indexes present, all three Slice 4
append-only triggers present, and the existing
`payout_agreements_write_guard` still calling the replaced
`stripe_launch_guard_agreement_write` function. Migration 041 was not rolled
back. Synthetic staging identities were instructor `2` (`Slice 4 Synthetic
Fraser`), instructor `3` (`Slice 4 Synthetic Simon`), and superadmin `2`; all
belong to school `1`, use `.invalid` email identities, and contain no real
identity or bank data. A distinct random bcrypt value was used for the
superadmin; existing authentication material was not copied.

The isolated Vercel project is `prj_JfBT8mm5ob4CWwseF8Ym62fJ4wSk`, name
`cc-simon-s4-staging-01`, team `team_DXEEAusHmjcfcr6auPjqloL0`, created
`2026-08-09T18:12:11.593Z`. It initially had `live=false`, no deployment, and
no domains. Only Preview variables were configured: disposable `POSTGRES_URL`,
a local `sk_test_...` fallback because no retrievable least-privilege Accounts
v2 restricted key was available, a staging-only JWT secret, staging
`BASE_URL`, `STRIPE_MODE=test`, and the six reviewed operation/global gates.
`STRIPE_CONNECT_V2_LIVE_ENABLED` was never added. No Production environment
variable was added. No Stripe API call occurred, so the broader test key was
never exercised.

The exact command `npx.cmd --yes vercel@latest deploy --yes --scope
coachcarteruk-2599s-projects` deliberately omitted `--prod`. Because this was
the isolated project's first deployment, Vercel nevertheless returned target
`production`, created deployment `dpl_2dvLLths8Xe4rPaTtLoyHLyWaQaW`, and
assigned aliases `cc-simon-s4-staging-01.vercel.app` and
`cc-simon-s4-staging-01-coachcarteruk-2599s-projects.vercel.app`. The deployment
was created `2026-08-09T18:23:18.683Z`, became `READY` at
`2026-08-09T18:24:06.466Z`, and reports Git SHA
`ccafbfc483937f2005f99f334134c92d46c8f28b`. It also reports `gitDirty=1`
because `vercel link` had temporarily appended one redundant `.env*` line to
`.gitignore`; that line was removed immediately and the file's working hash is
byte-identical to `HEAD`. This production-target classification was the hard
stop condition. The deployment was inert because its Production environment
has exactly zero variables, including no database, Stripe, JWT, mode, or Slice
4 gate values. No CoachCarter production project, deployment, alias, domain,
environment, or database was touched.

Cleanup was limited to fail-closed state preservation. Preview operation gates
were overwritten to `false` in order at `2026-08-09T18:24:38.946Z`,
`18:24:42.646Z`, `18:24:46.349Z`, `18:24:50.105Z`, and
`18:24:53.975Z`; the Preview global gate was overwritten to `false` at
`18:24:57.703Z`. The live gate remains absent. School `1`'s JSON Boolean was
set to `false` at `2026-08-09T18:25:08.282Z`. No Accounts v2 event destination
existed, so there was no destination to disable. The deployment, branch,
migration, and synthetic rows were retained as non-destructive evidence.

Final database evidence shows zero creation intents, attempts, onboarding-link
events, connected-account scopes, payout runs, refund intents/events, launch
earnings, transfer intents, and payout transfers. Both synthetic instructors
retain `stripe_account_id=NULL` and `payouts_paused=false`. Before/after hashes
match exactly for legacy Connect state
`7b1a79ae40ffd98871758eda5f46a220`, Slice 3 config
`d7edd0928fd680cb66f3b155be666b09`, and lesson payment contracts
`b6ec3337d53441f01ec5b39e780d029a`; every empty money ledger retained MD5
`d41d8cd98f00b204e9800998ecf8427e`.

Therefore the requested provider acceptance remains unexecuted: no Accounts v2
account or stable identity was submitted, no ambiguous-result reconciliation,
hosted onboarding, link-state rejection matrix, thin-event destination or
delivery, agreement lifecycle, current-state retrieval, or post-exercise full
regression matrix was performed. Slice 3 was not activated and Slice 5 was not
started. Resumption requires a new isolated Vercel project that is proven able
to accept a first deployment on a non-production target before source upload,
or an explicitly approved alternative that cannot be auto-promoted.

## Slice 4 staging acceptance attempt 2 - stopped 9 August 2026

Attempt 2 used a fresh worktree
`C:\tmp\coachcarter-simon-slice4-staging-acceptance-2` and branch
`codex/simon-slice4-staging-acceptance-2`. Before action, remote
`origin/main`, fetched `origin/main`, and worktree `HEAD` all resolved to
`90183a9889458581718fb3438403e703f36b8b9a`. The protected LF-normalised
SHA-256 values again matched exactly:
`79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
and `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
No protected document or existing worktree was changed.

Read-only Neon revalidation named only retained disposable branch
`br-dark-recipe-zarmjbix`, database `neondb`, project
`shiny-bonus-66942766`. It remained non-default and unprotected with migration
041 intact; the school gate was `false`; owner-mapping duplicate counts were
zero; synthetic instructors `2` and `3` remained active, unpaused, and without
legacy Stripe mappings; and Accounts v2 intents, attempts, links, scopes,
observations, and synthetic agreements all remained zero. Payout engine `v1`,
the inactive Slice 3 `shadow` config, and all zero payout/refund/earning/
transfer counts were unchanged. No SQL write was submitted in attempt 2.

Created replacement isolated Vercel project
`prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, name `cc-simon-s4-staging-02`, team
`team_DXEEAusHmjcfcr6auPjqloL0`, at `2026-08-09T20:01:24.142Z`. Initial
provider state was `live=false`, with no deployment or domain. Before source
upload, exact dry-run command `vercel deploy --dry --target preview
--skip-domain` failed because Vercel permits `--skip-domain` only for
production deployments. The operator explicitly approved the safer supported
form with `--target preview` and required target/alias verification before any
configuration.

After cleaning Vercel's local link artefacts, `.gitignore` hashed byte-for-byte
to `HEAD` and the worktree was clean. Exact command
`npx.cmd --yes vercel@latest deploy --target preview --yes --scope
coachcarteruk-2599s-projects --json` uploaded exact source commit
`90183a9889458581718fb3438403e703f36b8b9a` with zero project environment
variables. Vercel nevertheless returned target `production`, created
deployment `dpl_53R1HXZHMgYu7QpBSV2kNEVZzrFv`, and assigned aliases
`cc-simon-s4-staging-02.vercel.app` and
`cc-simon-s4-staging-02-coachcarteruk-2599s-projects.vercel.app`. The
deployment was created at `2026-08-09T20:05:43.527Z`, started building at
`20:05:44.465Z`, and became `READY` at `20:06:40.153Z`. Independent provider
retrieval confirms `target=production`, exact Git SHA, and no dirty-source
marker.

That provider identity triggered the mandatory immediate stop. Final project
metadata proves exactly zero total, Production, Preview, and
`STRIPE_CONNECT_V2*` environment variables. Therefore the deployment has no
Neon URL, Stripe key, JWT secret, Stripe mode, global/operation gate, live
gate, webhook secret, or school authority and is inert. No staging alias was
manually created or repointed; only Vercel's automatic first-deployment aliases
exist. No Stripe API call, account, Account Link, dashboard link, event
destination, event delivery, agreement action, payment, refund, earning,
payout, transfer, or Slice 3 action occurred. No cleanup gate or destination
mutation was necessary because none was configured or created. The replacement
project and deployment were retained as non-destructive evidence.

The full Slice 4 staging acceptance and regression postflight remain
unexecuted. A third attempt must not rely on Vercel CLI first-deployment target
selection. It requires either a provider-side project/environment setup that
can be read-only proven Preview before source upload, or a different explicitly
approved isolated non-production host. Production, Slice 3 activation, and
Slice 5 remain outside authority.

## Slice 4 staging acceptance attempt 3 - stopped 10 August 2026

Attempt 3 used fresh worktree
`C:\tmp\coachcarter-simon-slice4-staging-acceptance-3` and branch
`codex/simon-slice4-staging-acceptance-3`. Fetched `origin/main`, worktree
`HEAD`, and the requested source all resolved to
`7bea1fbc3cd05b0fabadfed28956c7c83dbf2bbb` before action. The protected
LF-normalised SHA-256 values were reverified as
`79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
and `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.

Read-only Neon preflight at `2026-08-10T05:38:20.250Z` proved retained branch
`br-dark-recipe-zarmjbix` belongs to project `shiny-bonus-66942766`, database
`neondb`, compute `ep-wandering-field-zadlm6r7`; it is non-primary,
non-default, unprotected, and migration 041 was already present. Public-schema
prerequisites and zero conflicting owner mappings passed. Synthetic Fraser
instructor `2`, Simon instructor `3`, and superadmin `2` were the only exercise
identities. Both instructors were active, unpaused, and had no legacy Connect
mapping. School `1` had the Slice 4 gate false and payout engine `v1`; Slice 3
was unactivated `shadow`; all inspected payout, refund, earning, transfer, and
cutover ledgers were empty. Migration 041 was neither reapplied nor rolled
back.

The isolated Vercel resource was project
`prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, name `cc-simon-s4-staging-02`, team
`team_DXEEAusHmjcfcr6auPjqloL0`. Custom environment `staging`, ID
`env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, was provider-proven type `preview` with no
domains. Vercel does not accept `--skip-domain` with preview/custom targets;
the approved supported command was `npx.cmd --yes vercel@latest deploy
--target staging --yes --scope coachcarteruk-2599s-projects --json`. Only the
automatic staging alias
`cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`
was used. Production retained zero variables, the live gate stayed absent,
and no production alias or domain was used.

Configuration was limited to the disposable Neon URL, a staging JWT secret,
`STRIPE_MODE=test`, staging base URL, the six reviewed Slice 4 gates, a test
webhook secret, and the approved `sk_test_...` fallback because no restricted
test key was available. The first generated JWT value was detected as an
unavailable placeholder and replaced before any deployment. A later exact
capture briefly made the replacement non-sensitive and immediately restored
it to Sensitive before deployment; it was never printed. The final clean
provider-action deployment was `dpl_BroKjPNuJCCNss4fAiZ1MB9BBvyS`, `READY`,
exact source SHA, `gitDirty=NULL`, custom environment `staging`. Retained
deployment `dpl_7Jfin7m2FxdRbGcezyrwALYu8hfU` contains an untracked,
non-routed, secret-free harness and has a dirty source marker; no provider
account or event action occurred until the harness was removed and the clean
deployment was ready.

Dedicated Stripe test thin-event destination
`ed_test_61VCA8bFOvczEINoS16TV2QrP1E9xyoubgu5pnVoOD8a`, name
`cc-simon-s4-acceptance-3-20260810`, was created at
`2026-08-10T05:55:25.006Z`, `livemode=false`, `events_from=["@self"]`, with
only the reviewed eight Accounts v2 event types and the staging webhook URL.
It received no exercised delivery before the hard stop. It was disabled, not
deleted, at `2026-08-10T06:05:04.127Z`; final retrieval preserved its exact
test-mode event contract.

Fraser's one authenticated creation produced durable intent
`6a617fd1-e59e-461b-94cc-61428454cbad`, stable identity
`cc:connect-v2:1:2:test:recipient`, and exactly one test account
`acct_1U2mEuEzBBwP0X12`. Attempt 1 was provider-succeeded under request
`req_v2OdAMYJPICVTmYnh` at `2026-08-10T05:59:17.869Z`. Scope `1` and the
single `api.account_created` observation were persisted. Provider retrieval
proved Accounts v2 recipient, Express dashboard, GB identity, application
fee/loss responsibility, `livemode=false`, and transfer capability restricted
pending onboarding.

Simon's ambiguity harness proved zero prior matches, submitted Accounts v2
creation exactly once, retained provider account `acct_1U2mHvIGQey1BnGx`,
then injected a timeout after provider success. Intent
`3c2349a0-1696-4b57-b732-fc14bbde57df`, stable identity
`cc:connect-v2:1:3:test:recipient`, remains `reconciling`; attempt 1 is
`provider_ambiguous`, code `ETIMEDOUT`, request
`req_v2jEH4nkzkb9KTgyP`, at `2026-08-10T06:02:24.197Z`. The next handler call
used a create method that could only count and throw and recorded zero
replacement-create calls. Reconciliation then failed before a second attempt
or scope because merged `findReconciliationMatches` requests
`accounts.list({limit:100})`; direct read-only reproduction returned `Limit
cannot be greater than 20`. Final provider listing proves exactly one Simon
stable-identity account. The mandatory hard stop fired: no retry, workaround,
manual mapping, onboarding, agreement, event delivery, or money action
followed.

Shutdown set all five staging operation gates false, then the staging global
gate false; set school `1`'s gate false at `2026-08-10T06:04:46.720Z`; and
disabled the dedicated destination. Final clean disabled deployment
`dpl_7GtYzEowSXzUVNddpf5VbMPEwJpu` is `READY`, exact source SHA,
`gitDirty=NULL`, environment `staging`, and only the staging alias. Pulled
configuration proved every reviewed gate literally false and the live gate
absent. Authenticated runtime status returned `global_gate_inactive` and
`school_gate_inactive`.

Database postflight at `2026-08-10T06:08:03.657Z` proved zero duplicate
owners, one Fraser scope/observation, no onboarding links or synthetic
agreements, and Simon's singular unmapped reconciling identity. Instructors
remain active, unpaused, and without legacy mappings. Payout engine `v1`,
Slice 3 unactivated `shadow`, four lesson payment contracts, and all inspected
zero money/cutover counts match preflight. Syntax passed `204/204`, C1
`276/276`, focused Slice 4 passed `15/15`, canonical schema passed `14/14`,
migration-035 guards passed `9/9` with checkout bytes restored exactly, and
the broader current affected superset passed `570/570` across 62 files. No
test used staging provider or database credentials.

Attempt 3 status is
`STAGING_ACCEPTANCE_STOPPED_RECONCILIATION_LIST_LIMIT_DISABLED`. Hosted
onboarding/link rejection, Express dashboard, signed-event delivery and
ordering/regression/current-state, and agreement lifecycle/readiness cases
remain unexecuted. Resume requires a separately reviewed code fix for supported
Accounts v2 list pagination. Its first provider action must reconcile the
preserved Simon intent and `acct_1U2mHvIGQey1BnGx`; it must never create a
replacement. Production was not touched, Slice 3 was not activated, and Slice
5 was not started.

Final local cleanup removed only the two external, secret-free harness files,
the exact staging environment export, and the worktree `.env.local`; all were
verified absent and no provider/database evidence was deleted. Protected
LF-normalised hashes remained exact. A read-only status pass found 25
registered worktrees: this attempt contained only the two documentation edits,
the pre-existing `C:\Users\Fraser\.codex\worktrees\cc5f\coachcarter-website-main`
retained 14 existing status entries, and every other worktree was clean.
