# Simon Stripe Connect launch — Slice 4 rollout review

Status: `MERGED_DEPLOYED_INACTIVE; MVP_A1_CONTROLLER_PREPARED_FOR_REVIEW; RECONCILIATION_STOPPED_DISABLED`
Prepared: 9 August 2026; updated 11 August 2026
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

Reconciliation-only checkpoint: 10 August 2026 on
`codex/simon-slice4-reconciliation-checkpoint`, exact source and current
`origin/main` `019bfc13c6f19443398ab1293c0dd19b865553d1` (merged PR #363).
The pagination repair passed local review and was deployed to the retained
custom staging environment. The checkpoint stopped before the authorised
application request because the retained Sensitive staging JWT cannot be read
by either environment pull or the non-mutating environment runner. Rotating
that authentication secret was not authorised and was not performed. No
Stripe request or account action occurred. All gates and the school flag were
restored false and an exact-SHA disabled deployment is current.

JWT-rotation reconciliation checkpoint: 10 August 2026 on
`codex/simon-slice4-reconciliation-completion`, exact source and current
`origin/main` `e0acd83ba1fcf8bcfc2516359dd42d72b546115d` (merged PR #364).
The owner explicitly authorised rotation of only the isolated staging JWT and
one authenticated no-retry Simon request. Rotation and exact-SHA deployment
succeeded, but Vercel deployment protection returned HTTP `401` before the
application or Stripe. No retry occurred. Mandatory shutdown restored every
operation/global/school gate false and deployed the disabled configuration.

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

## Accounts v2 reconciliation pagination repair review - 10 August 2026

The reviewed repair starts from exact `origin/main`
`8feeac6f0bed30015a0cd4685b95eb2f076f4dc8`. Before code work, the protected
LF-normalised hashes remained exact before code work and before publication:
product
`79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
and technical plan
`64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.

Stripe's current Accounts v2 response supplies nullable `next_page_url` and
opaque `page` tokens. With pinned `stripe@22.4.0`, reconciliation now requests
`limit: 20` and uses the SDK's public `rawRequest` interface for each validated
provider-returned next URL. Every URL must remain the Accounts v2 list path,
retain only the recipient filter, carry one non-empty opaque page token, and
request a positive limit no greater than 20. Response pages, Accounts v2
objects, IDs, and metadata shape are checked; repeated page tokens or account
IDs, unexpected parameters/objects, oversized pages, provider errors, and a
500-page safety ceiling all fail closed as incomplete reconciliation.

The durable intent state machine is unchanged. `submitting`/`reconciling`
requests scan only and cannot create; zero matches remain `reconciling`; one
match must still satisfy exact stable identity, intent, school, instructor,
mode, recipient configuration, and Express dashboard validation; and multiple
matches enter `manual_review` without arbitrary selection. Only a genuinely
`planned` intent retains the existing one-time idempotent create path.

Local evidence passed focused route/state-machine tests `22/22`, focused
installed-Chrome UI tests `2/2`, syntax `204/204`, C1 `276/276`, canonical
launch schema `14/14`, migration-035 guards `9/9` under temporary LF
normalisation with original checkout SHA
`f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`
restored exactly, and the broader affected non-integration superset `608/608`
across 65 Stripe/auth/tenant/booking/credit/refund/payout/webhook/Connect
files. Tests used mocks and local browser execution only, with no staging,
database, or provider credentials.

No schema defect was demonstrated, so migration 041 and the aggregate remain
unchanged. No provider, Neon, Vercel, staging, retained-account, gate,
destination, production, Slice 3, Slice 5, or money action occurred. Status is
`STAGING_ACCEPTANCE_STOPPED_REPAIR_REVIEWED_PENDING_MERGE`; merge and any later
staging resumption require separate authority, and unresolved reconciliation
must never create a replacement account.

## Reconciliation-only checkpoint - 10 August 2026

The checkpoint started from clean exact `origin/main`
`019bfc13c6f19443398ab1293c0dd19b865553d1`, the merge of PR #363, in isolated
worktree `C:\tmp\coachcarter-simon-slice4-reconciliation-checkpoint`. The
protected LF-normalised hashes remained exact: product
`79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4` and
technical plan
`64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
Pinned `stripe@22.4.0` exposed the reviewed public `rawRequest` pagination
surface; focused pagination/state-machine tests passed `22/22`, installed
Chrome UI tests passed `2/2`, canonical launch schema tests passed `14/14`,
migration-035 guards passed `9/9` with original checkout bytes restored, and
syntax/C1 checks passed `204/204` and `276/276`. No local test used a staging
credential or contacted Stripe.

Fresh connected metadata proved exact Neon organisation
`org-fancy-forest-47074420`, project `shiny-bonus-66942766`, retained
non-primary/non-default/unprotected branch `br-dark-recipe-zarmjbix`, database
`neondb`, and compute `ep-wandering-field-zadlm6r7`. Read-only preflight
retained migration 041, school gate false, payout engine `v1`, the two active
unpaused synthetic instructors with null legacy mappings, one Fraser
scope/observation, and Simon's original unmapped `reconciling` intent
`3c2349a0-1696-4b57-b732-fc14bbde57df` with only attempt 1
`provider_ambiguous`. Four lesson payment contracts and every inspected
payout/refund/earning/transfer/cutover zero count and hash matched the retained
baseline.

Fresh Vercel metadata proved exact project
`prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, team
`team_DXEEAusHmjcfcr6auPjqloL0`, custom Preview-type environment `staging`
`env_vvxYWVPTHOiutcFOPmeWw2kX08mA` with no domains, and zero Production
variables. All five staging operation gates and the global gate began false;
the live gate remained absent. Disabled preflight deployment
`dpl_6kbDJnsTLqu3MYLPnEgyTrQhjHg9` was `READY`, exact source SHA,
`gitDirty=NULL`, and carried only the automatic staging alias.

Only `STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED` and
`STRIPE_CONNECT_V2_ENABLED` were temporarily set true; all other operation
gates remained false. Exact clean enabled deployment
`dpl_7m4F1NH8Aqf3hTa4Bi7G97LVNq6c` was `READY` on custom environment
`staging`, after which only school `1`'s
`features.stripe_connect_accounts_v2` Boolean was temporarily set true under
guards preserving payout engine `v1` and the null legacy school mapping.

The existing Simon session could not be minted safely: `JWT_SECRET` remains a
non-readable Sensitive staging variable, environment pull returned no usable
value, and Vercel's non-mutating environment runner omitted it from the child
process. A proposed persistent staging JWT rotation was rejected before
execution because that additional authentication mutation was not explicitly
authorised. Therefore the authenticated/CSRF-bound
`POST /api/connect?action=v2-account` request count was exactly zero. Stripe
was not contacted, Accounts v2 list or create was not called, and the retained
disabled event destination was not read or changed.

Mandatory shutdown then set the account-creation gate false, set the global
gate false, and set the school Boolean false, in that order. A provider pull
proved all six gates false, `STRIPE_MODE=test`, and the live gate absent. Final
disabled deployment `dpl_2fiVKGXT8DnBLFZay3v96V37k1tV` is `READY`, exact
source SHA, `gitDirty=NULL`, custom environment `staging`, and has only alias
`cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
Production retained zero variables and was untouched.

Read-only postflight matched preflight exactly. Simon remains on stable
identity `cc:connect-v2:1:3:test:recipient`, original intent state
`reconciling`, attempt count `1`, scope count `0`, and observation count `0`.
Fraser remains one scope and one `api.account_created` observation. Both
instructors remain active/unpaused with null legacy mappings; Slice 3 remains
unactivated `shadow`; the payment-contract count remains `4`; all inspected
payout, refund, earning, transfer, and cutover counts remain zero; and all
recorded baseline hashes are unchanged.

The final current 65-file non-integration Stripe/auth/tenant/booking/credit/
refund/payout/webhook/Connect matrix passed `615/615` using installed system
Chrome, with migration-035 checkout bytes restored exactly.

Status is
`STAGING_RECONCILIATION_CHECKPOINT_STOPPED_DISABLED`. Resumption requires a
separately authorised way to supply a valid ephemeral Simon staging session or
to rotate only the isolated staging JWT; the first Stripe action must still be
the single reconciliation request and must never create a replacement account.

## JWT-authorised checkpoint stopped at Vercel protection - 10 August 2026

The checkpoint started from clean merged `origin/main`
`e0acd83ba1fcf8bcfc2516359dd42d72b546115d` in isolated worktree
`C:\tmp\coachcarter-simon-slice4-reconciliation-completion`. Protected hashes,
pinned `stripe@22.4.0`, focused `38/38` Accounts v2/UI/schema tests,
migration-035 guards `9/9`, syntax `204/204`, and C1 `276/276` all passed
without provider or database credentials.

Fresh Vercel, Neon, and school-scoped database preflight matched the preceding
checkpoint exactly. All six staging gates and the school Boolean were false;
live was absent; Production had zero variables. Simon retained the original
unmapped `reconciling` intent and one ambiguous attempt, Fraser retained one
scope/observation, and every inspected financial/Slice 3 count and hash was
unchanged. Exact disabled preflight deployment
`dpl_GzohgMe4w5MUCEuwf7X6dYUvRjH2` was `READY`, clean, and staging-only.

Under explicit owner authority, a fresh random JWT was generated only in
memory and staging `JWT_SECRET` alone was rotated as Sensitive. It was never
printed or persisted locally. Exact disabled deployment
`dpl_4fyPzrPub3YsH5uJLcUppWpiGTmE` verified the rotation while every gate
remained false. Only the account-creation and global staging gates were then
set true; every other operation/live gate stayed false. Exact clean enabled
deployment `dpl_8Z18XLDBALyrF7iMEkzfaqVFV474` passed its source, environment,
and alias guards before a guarded update enabled only school `1`'s Boolean.

The one permitted authenticated/CSRF-bound Simon POST was dispatched exactly
once with no redirect and no retry. Vercel returned HTTP `401` `Protected
deployment` with Vercel authentication enabled before the CoachCarter function
ran. No application or Stripe API call occurred, so no reconciliation list,
replacement create, provider object, local intent/attempt/scope/observation,
event, or money state changed.

Mandatory shutdown restored the account-creation gate false, then global false,
then the school Boolean false. The ephemeral JWT copy was cleared. Final
disabled deployment `dpl_F657tCmJdCbfwsjbdEMmsQaf5fgy` is `READY`, exact
source SHA, `gitDirty=NULL`, custom environment `staging`, and staging-only.
Fresh configuration proves all six gates false, `STRIPE_MODE=test`, live
absent, and zero Production variables. Database postflight and every retained
hash match preflight exactly; the disabled event destination was not contacted
or changed.

Final current non-integration regression passed `615/615` across the 65-file
Stripe/auth/tenant/booking/credit/refund/payout/webhook/Connect matrix using
installed system Chrome. Migration-035 checkout bytes were restored exactly.

Status is `STAGING_RECONCILIATION_CHECKPOINT_STOPPED_DISABLED`. No retry is
authorised. Any later attempt needs separately scoped authority and a
prevalidated Vercel-authenticated transport, while preserving the original
Simon identity and the no-replacement-create rule.

## Post-PR #365 protected-hash preflight stop — 10 August 2026

The authorised reconciliation resume began from fresh remote `main`
`a90acfd5243b1dc3501a0e86a79d9aa8dbbff8a6` on isolated branch
`codex/simon-slice4-reconciliation-resume`. The source descends from merged PR
#365 (`9ca1e5e6b34dda693298923e153433f98db2e994`), whose checks passed, and also
contains later merged PRs #366 and #367.

Mandatory document and source preflight found a hard integrity mismatch before
any transport, application, provider, configuration, or database action. The
current LF-normalised product-specification hash is
`B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585`,
not the approved
`79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`.
The technical-plan hash remains the approved
`64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
PR #366 changed the protected product document, but current source does not
record the explicit product-document review and replacement approved hash
required by the living log. The operator therefore stopped without
improvising.

Read-only Vercel metadata matched project
`coachcarteruk-2599s-projects/cc-simon-s4-staging-02`, project ID
`prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, custom staging environment
`env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, and alias
`cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
All six named staging operation/global gates are exactly `false`,
`STRIPE_MODE=test`, live is absent, Production has zero environment variables,
and school `1`'s Slice 4 Boolean is `false`. Retained disabled deployment
`dpl_F657tCmJdCbfwsjbdEMmsQaf5fgy` is `READY`; it remains the prior
checkpoint's exact-source shutdown deployment. A fresh current-source
deployment was not produced after the integrity prerequisite failed.

Read-only Neon state matched project `shiny-bonus-66942766`, branch
`br-dark-recipe-zarmjbix`, database `neondb`, school `1`, and Simon instructor
`3`. Simon retains intent `3c2349a0-1696-4b57-b732-fc14bbde57df` in
`reconciling` for stable identity `cc:connect-v2:1:3:test:recipient`, with no
provider mapping, scope, or observation. There is exactly one ambiguous attempt
(`attempt_number=1`, `provider_ambiguous`, `network`). Fraser remains scope `1`
and observation `1`. All financial, payout, transfer, cutover, Slice 3, and
Slice 5 zero-state safeguards remain unchanged; `simon_launch_v1` remains
inactive `shadow`.

The current code path was reviewed and its focused tests confirm that a
`reconciling` intent lists/reconciles and returns before Accounts v2 creation.
The focused readiness suite passed `38/38`, syntax passed for `206` JavaScript
files, and the C1 scan passed across `278` files. The previous checkpoint's
`615/615` run remains the latest full regression evidence; the full matrix was
not rerun after this earlier hard preflight stop.

Exact reconciliation POST count was **zero**. No harmless transport GET was
sent, no JWT was rotated or exposed, no HTTP/application reconciliation outcome
exists, and Stripe actions performed were **none**. There was no Accounts v2
list or create call and no account, user, payment, refund, earning, payout,
transfer, cutover, Slice 3, Slice 5, Production, configuration, or database
mutation. The disabled event destination was neither queried nor changed.
Because every gate was already false and no state was enabled, final shutdown
was proven without a configuration write or replacement deployment.

Final status is
`STAGING_RESUME_STOPPED_PROTECTED_PRODUCT_HASH_MISMATCH_DISABLED`. Any resume
requires explicit owner review resolving the protected product-document hash;
the existing no-retry, preserved-identity, and no-replacement-create controls
remain binding.

## Owner-approved protected hash rebaseline — 10 August 2026

After docs-only PR #368 merged as
`5014d73f1a6776fb0735a57b2fdb840df8123649`, the owner explicitly confirmed
that the protected product-specification changes from PR #366 had been reviewed
and approved, including the cross-instructor rescheduling policy. The owner
approved LF-normalised SHA-256
`B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585` as the
replacement protected product-specification baseline.

Fresh byte-level verification on merged `main` reproduced that product hash.
The protected technical implementation plan remains unchanged at its approved
LF-normalised SHA-256
`64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
Historical entries retain the former product hash and the earlier hard stop;
this entry supersedes only the current integrity blocker.

This approval does not authorise or imply an operational retry. No harmless
transport GET, JWT rotation, gate or school-flag change, authenticated Simon
POST, application request, Stripe action, Vercel deployment, database write,
account/user action, payment, refund, earning, payout, transfer, cutover, Slice
3, Slice 5, or Production action occurred during this docs-only rebaseline. The
last verified disabled staging and database state recorded by PR #368 remains
current.

Status is now
`PRODUCT_SPEC_HASH_APPROVED_REBASELINED_RECONCILIATION_STOPPED_DISABLED`.
A future resume requires newly explicit operational authority and must retain
all preflight, preserved-identity, one-request, no-retry, shutdown, and
no-replacement-create controls.

## Authenticated transport passed; HTTP reconciliation not sent — 10 August 2026

The owner-authorised reconciliation resume used fresh merged `main`
`f3c21d9bd75e4de4a4143ca243b4d06d0880865e` (PR #369). Both protected hashes
matched their approved values. Vercel and Neon preflight matched the retained
isolated project/environment/branch exactly. The staging controls evaluated
false, `STRIPE_MODE=test`, live was absent, Production had zero variables, and
school `1`'s Slice 4 feature was exact Boolean false. Simon retained the
original unmapped `reconciling` intent and singular ambiguous/network attempt;
Fraser remained scope `1`/observation `1`. Focused no-replacement/readiness
tests passed `38/38`.

Fresh exact-source disabled deployment `dpl_GuyP2bCMXJSPYa2pxRrKahqtKkkM`
became `READY`. Exactly one Vercel-authenticated harmless `GET /api/status`
reached the application and returned its non-mutating JSON status at
`2026-08-10T21:50:02.393Z`; redirects and client retries were disabled. The
harmless transport-test request count is **one**, and the endpoint has no
database or Stripe path.

The unreadable Sensitive staging JWT required the one authorised staging-only
rotation. It was generated and retained only in memory. Rotated-disabled
deployment `dpl_ELA5ofzPgDZFp8uou1v5zd5g22QB` and minimally enabled deployment
`dpl_BvwtMjKexqtgYDHMHj21PWT5Niaw` both passed the exact-source, clean,
custom-environment, and alias-only guards. Only global and account-creation
were enabled, then a guarded Neon update changed only school `1`'s Slice 4
Boolean to true.

The controller reached its one guarded local dispatch invocation, but supplied
a deployment verification marker together with the deployment ID. The local
command parser rejected the malformed argument with exit `255` before
`vercel curl` issued an HTTP request. Exact Simon reconciliation HTTP POST
count is therefore **zero**, with no HTTP/application response and no retry.
The enabled deployment has zero recorded runtime request paths. Stripe was not
contacted: there was no Accounts v2 list, create, replacement account, or event
destination action.

Mandatory shutdown completed despite the local dispatch failure. The two
temporary gates were restored false, school `1`'s Boolean was guarded back to
false, and all in-memory JWT/session/CSRF material was cleared. Final disabled
deployment `dpl_J3FB1xBf9CJAaLRxbqhXkARUzkc2` is `READY`, exact commit
`f3c21d9bd75e4de4a4143ca243b4d06d0880865e`, `gitDirty=NULL`, custom
`staging`, and carries only the expected staging alias. All six Slice 4 gates
fail closed; present controls are exact false, live remains absent,
`STRIPE_MODE=test`, and Production remains zero-variable.

Postflight preserves Simon's exact `reconciling` intent and first
`provider_ambiguous`/`network` attempt with mapping/scope/observation all zero.
Fraser remains scope `1`/observation `1`; Slice 3 remains inactive `shadow`;
all inspected account-link, payout, refund, earning, transfer, cutover, Slice 5,
and Production counts remain unchanged or zero. The disabled Stripe event
destination was neither queried nor modified. Final regression passed focused
`38/38` and the current 65-file non-integration matrix `612/612` after the
documented temporary migration-035 LF checkout normalization was restored.

Status is
`STAGING_RECONCILIATION_DISPATCH_NOT_SENT_CONTROLLER_ARGUMENT_ERROR_DISABLED`.
The one authorised JWT rotation has been consumed. The no-retry rule prohibits
another dispatch under this authority; any correction requires explicit owner
approval.

## Post-PR #370 deployment-output checkpoint stop - 11 August 2026

The owner-authorised reconciliation resume began from fresh merged `main`
`91752b16deb704e1a9b69451d73689f7bcb84a2f`, the merge commit for PR #370,
on isolated branch `codex/simon-s4-reconciliation-20260811`. PR #370 was
merged with all required checks successful. The approved LF-normalised hashes
reproduced exactly: product specification
`B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585` and
technical plan
`64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.

Read-only Vercel and Neon preflight matched the retained isolated staging
scope. Global, account-creation, and webhook-processing controls were exact
`false`; account-link, dashboard-link, agreement, and live controls were
absent and therefore failed closed. `STRIPE_MODE=test`, Production had zero
variables, and school `1`'s Slice 4 value was exact JSON Boolean `false`.
Simon instructor `3` retained intent
`3c2349a0-1696-4b57-b732-fc14bbde57df` in `reconciling`, stable identity
`cc:connect-v2:1:3:test:recipient`, its singular
`provider_ambiguous`/`network` attempt, and no provider mapping, scope, or
observation. The focused no-replacement/readiness suite passed `38/38`.

Before any enablement, the revised external controller passed offline tests
that selected one scalar deployment ID and rejected both ID arrays and the
prior log-plus-ID success-stream pollution. It then created a fresh disabled
deployment, but stopped during its live-shape validation because the parsed
`vercel deploy --json` success value did not contain the assumed scalar `.id`.
No fallback lookup, redeploy, transport probe, or operational retry was made.
Read-only post-stop inspection identified the already-created deployment as
`dpl_EbTnh5cMqNiKZcayPRSUw68Nynih`: `READY`, exact PR #370 source,
`gitDirty=NULL`, custom environment `staging`, and bound only to the expected
staging alias.

Vercel's deploy stdout contract is the deployment URL. After the operational
stop, the external controller parser was corrected locally to require exactly
one HTTPS `*.vercel.app` URL, resolve that URL through the read-only deployment
API, and only then select and validate the returned metadata `.id`. Offline
plain-URL and JSON-string-URL tests passed, and one read-only validation of the
existing disabled URL resolved exactly to
`dpl_EbTnh5cMqNiKZcayPRSUw68Nynih`. The correction was not used to deploy,
enable, probe, rotate, or dispatch under this authority.

Exact harmless transport GET count is **zero**. Exact authenticated Simon
reconciliation POST count is **zero**. The newly authorised staging JWT
rotation was not performed and remains unconsumed. No environment variable or
database write occurred; global, account-creation, and school gates were never
enabled. Stripe was not contacted, so there was no Accounts v2 list or create,
no replacement account, and no event-destination action.

Read-only postflight retained all preflight state. The school Boolean is false;
Simon remains the same unmapped `reconciling` intent and attempt. Counts remain
intents `2`, attempts `2`, link events `0`, scopes `1` (Simon `0`),
observations `1` (Simon `0`), agreements `1`, and lesson payment contracts
`4`. All inspected payout, refund, earning, transfer, and cutover counts remain
`0`. The staging gates fail closed, live remains absent, `STRIPE_MODE=test`,
Production remains zero-variable, and the exact-source deployment above is the
latest disabled deployment.

Final validation passed focused `38/38`, the current 65-file non-integration
matrix `612/612`, syntax across `206` JavaScript files, and the C1 scan across
`278` files. Migration 035 was temporarily LF-normalised for its reviewed-byte
verifier and restored to its original checkout SHA-256
`f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`.
The two protected LF-normalised hashes remained exact after these documentation
edits.

Status is
`STAGING_RECONCILIATION_STOPPED_DEPLOY_STDOUT_SHAPE_MISMATCH_DISABLED`.
No reconciliation retry is authorised. A future operational attempt requires
new explicit owner authority and must begin from fresh `main` with the same
identity-preservation, no-replacement, one-request, no-retry, shutdown, and
postflight controls.

## PR #371 retained-gate-shape checkpoint stop - 11 August 2026

The owner-authorised continuation began from fresh merged `main`
`a6adc9d01904c59ce4b5e8df8cdb1a4e3e749f78`, the merge commit for PR #371,
on branch `codex/simon-stripe-connect-slice4-reconciliation`. The protected
LF-normalised product and technical hashes remained exact. Static review and
focused Accounts v2/UI/schema tests (`38/38`) reconfirmed that Simon's retained
`reconciling` state lists/reconciles and returns before the account-creation
branch, preserving instructor `3`, intent
`3c2349a0-1696-4b57-b732-fc14bbde57df`, and stable identity
`cc:connect-v2:1:3:test:recipient` without a replacement path.

The external controller was updated before use to the PR #371 source, fresh
state paths, the corrected Vercel deployment-URL-to-ID resolution, and the
application's plural link/dashboard/agreement environment names. Offline tests
passed scalar-ID selection, array and success-stream-pollution rejection, and
plain/JSON-string deployment URL parsing. Read-only Neon preflight on explicit
temporary branch `br-dark-recipe-zarmjbix` matched retained state: school `1`'s
gate was exact JSON Boolean `false`, payout engine `v1`, Simon's intent was
unmapped `reconciling` with only its singular
`provider_ambiguous`/`network` attempt, and the ledger fingerprint was
`c308d045ffd57a922d40cb17d2b2d918`.

The controller then failed closed in its initial disabled-state assertion,
before deployment or any operational mutation. The retained handover said the
link, dashboard-link, and agreement gates were absent, but read-only Vercel
inventory proved their plural production names are present and exact `false`.
Global, account creation, webhook processing, account links, dashboard links,
and agreements are all exact `false`; live is absent and `STRIPE_MODE=test`.
Although this is fully disabled behavior, the reviewed controller required the
three gates to be absent. The mandatory mismatch/controller-error stop was
therefore applied without changing the invariant or attempting a correction.

No fresh deployment was created, so the corrected deployment URL-to-ID path
was not live-shape validated in this attempt. The latest deployment remains
`dpl_EbTnh5cMqNiKZcayPRSUw68Nynih` from PR #370 and its runtime request-path
and status counts remain empty. JWT rotation count is **zero**, harmless
transport GET count is **zero**, authenticated CSRF-bound reconciliation POST
count is **zero**, and Vercel/Neon write counts are **zero**. No controller
state file exists. Stripe was not contacted: Accounts v2 list/create,
replacement-account, direct provider creation, and event-destination actions
are all zero. Production retains zero variables and the staging JWT remains a
single Sensitive record.

Read-only mandatory postflight matched preflight exactly. The school Boolean
remains false; Simon remains the same unmapped intent and attempt. Counts remain
intents `2`, attempts `2`, link events `0`, scopes `1` (Simon `0`),
observations `1` (Simon `0`), agreements `1`, and lesson payment contracts `4`.
All inspected payout, refund, earning, transfer, and cutover counts remain `0`;
the ledger fingerprint is unchanged and `simon_launch_v1` remains inactive
`shadow`.

Final local validation passed focused `38/38`, syntax across `206` JavaScript
files, and C1 across `278` files. The 65-file non-integration matrix ran once
and finished `602/612`; the ten failures were exclusively Chromium process
launch `spawn EPERM` errors across eight refund UI cases and two Connect UI
cases, with no assertion failure. It was not retried or moved to another
browser. Migration 035 was already the tracked pure-LF blob, SHA-256
`7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`, and
was not changed.

Status is `STAGING_RECONCILIATION_STOPPED_GATE_SHAPE_MISMATCH_DISABLED`.
The authorised JWT rotation was not consumed, but the no-retry stop remains
binding. Any future attempt requires fresh owner direction after review of the
actual present-false gate shape and must preserve every identity, no-create,
single-request, shutdown, and postflight control.

## MVP A1 repository controller preparation - 11 August 2026

This preparation began from clean merged PR #373 at
`c85381e53d2c4e9754e80c093d60b0fac10061b0` on branch
`codex/simon-staging-reconciliation-controller`. The approved LF-normalised
product and technical hashes reproduced exactly as
`D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B` and
`C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
Neither protected document was changed.

The repository now contains a dependency-injected Node operator controller and
focused offline tests. Default execution is offline/dry-run. Operational mode
requires a separate explicit approval phrase and an external adapter outside
the repository; it neither embeds nor persists credentials, environment
values, authentication material, connection strings or provider payloads. The
sealed adapter exposes only staging/deployment/state reads, the three reviewed
gate mutations, the one existing application-route reconciliation POST and
sanitised postflight evidence. It exposes no direct Accounts v2 creation call.

The controller requires exact retained Simon identity: instructor `3`, intent
`3c2349a0-1696-4b57-b732-fc14bbde57df`, stable identity
`cc:connect-v2:1:3:test:recipient`, test mode, state `reconciling`, no mapping,
no scope and no replacement. The only request budget is one authenticated,
CSRF-bound POST to `/api/connect?action=v2-account`, with redirects and retries
disabled. A successful result must prove listing/reconciliation was the first
Stripe action, exactly one match was found, the original intent became
`succeeded`, one scope exists and account-create/direct-create/replacement
counts all remain zero. Any mismatch, duplicate, zero match, application
ambiguity, transport uncertainty or controller error stops without retry.

Deployment handling now enforces the corrected URL-to-ID contract: one plain or
JSON-string HTTPS `*.vercel.app` URL only; arrays, multiple values, missing or
polluted output, malformed URLs and non-Vercel hosts are rejected; URL
resolution is read-only; metadata must contain one scalar `dpl_...` ID and
match the isolated project, exact commit, clean `gitDirty=NULL`, custom
`staging` environment, staging-only alias/domain and non-production target.

Disabled preflight requires the actual retained PR #372 shape: global, account
creation, account links, dashboard links, agreements and webhook processing
are all present exact `false`; live is absent or exact `false`;
`STRIPE_MODE=test`; Production is proven untouched; and the guarded school
feature is exact JSON Boolean false. Minimal enablement is limited to global
true, account creation true solely because the existing route requires it, and
the school Boolean true. Account links, dashboard links, agreements, webhook
processing and live remain disabled. A finally-equivalent path always attempts
shutdown in order: account creation false, global false, school false; it then
proves the complete disabled state and validates a final disabled deployment.

Local evidence passed the new offline/fault-injection controller tests `11/11`,
the existing Accounts v2/UI/schema suite `38/38`, syntax `206/206`, C1
`278/278`, the complete local Playwright regression `1332/1332`, and
`git diff --check`. The no-argument controller command reported offline mode and
POST count `0`.

This session performed controller preparation only. It sent no harmless GET and
no reconciliation POST. It made no Vercel, Neon, environment, deployment, JWT,
gate, school-Boolean, database, Stripe, provider, event-destination, account,
payment, refund, earning, payout, transfer, cutover, Slice 3, Slice 5 or
Production request or mutation. Retained external state was not operationally
reverified or changed. Status is
`MVP_A1_STAGING_CONTROLLER_PREPARED_FOR_REVIEW_NOT_OPERATED`; operational
reconciliation remains prohibited until the controller PR is reviewed and
merged and Fraser provides new explicit authority.
