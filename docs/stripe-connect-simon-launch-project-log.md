# Stripe Connect Simon Launch Project Log

**Purpose:** Durable handover and journey log for the Simon Stripe Connect,
payment-contract, refund, and instructor-payout launch.

**Current status:** **SIMON INTERIM V1 HARDENING IMPLEMENTED LOCALLY FOR REVIEW
ON PR #388 BASELINE — NOT MERGED, MIGRATED, DEPLOYED OR OPERATED — SIMON NOT
ONBOARDED OR PAID — ACCOUNTS V2/A8 EVIDENCE PRESERVED AND DEFERRED —
PRODUCTION ACTION NOT APPROVED**

**Last updated:** 13 August 2026

**Verified source baseline:** frozen remote `main` at
`f29e67d945a559fd00c7ff08e1f34c96514e01f1` (PR #388 merge)

**Current hold:** Do not apply migration 043, deploy, configure or operate the
interim v1 account/invite/approval/payout routes until this implementation is
reviewed and merged and the exact later operation is separately authorized. Do not resume A8,
A9, Slice 4 reconciliation or Accounts v2 onboarding as the immediate launch
path. Simon must remain without a new Production account/invite and must remain
paused until later, separate operational authority. The A8 retry-01 retained
test-mode shell, stable identity, intents, attempts and one-match/HTTP-409
evidence remain immutable historical records; they are deferred, not resolved,
and must not be deleted, replaced, mapped to Production or reused as the v1
identity.

## 1. Title and purpose

This is the durable project record for taking the Simon Stripe Connect launch
from protected product policy through safe Slice 2 shadow acceptance and,
eventually, the later payout/refund/Connect slices. It records both successful
work and failed attempts so a future session can resume without reconstructing
the journey from chat history or provider dashboards.

## 2. How future sessions must use this document

1. Read this document before any Simon launch, Stripe Connect payout rollout,
   or Simon shadow-exercise work.
2. Then read the protected product specification and technical plan listed
   below. Do not infer product policy from this log when either protected
   document answers the question.
3. Verify remote `main`, the current branch/commit, and worktree cleanliness
   before relying on the baseline recorded here.
4. Treat facts marked **Repository-verified** as reproducible from committed
   artifacts. Treat facts marked **Operator-reported** as historical exercise
   evidence that was supplied in the handover but is not preserved in this
   repository. Treat **Assumption** as unproven and never as an acceptance fact.
5. Update the mutable status, blocker, unfinished-scenario, and next-step
   sections when evidence changes. Add a dated entry to the append-only session
   log; do not erase failed attempts or rewrite old evidence.
6. Never place credentials, keys, secrets, connection strings, login codes,
   tokens, webhook secrets, or raw sensitive provider payloads in this file.

## 3. Source-of-truth documents

The source hierarchy is:

1. [`stripe-connect-simon-launch-product-spec.md`](stripe-connect-simon-launch-product-spec.md)
   — owner-agreed interim-v1 launch boundary dated 13 August 2026, with the
   Accounts v2/payout-v2 target preserved as deferred long-term work.
2. [`stripe-connect-simon-launch-technical-implementation-plan.md`](stripe-connect-simon-launch-technical-implementation-plan.md)
   — implementation sequence, slice gates, tests, and acceptance criteria.
3. `AGENTS.md` and `CLAUDE.md` — repository, tenancy, auth, money, and safety
   rules.
4. [`stripe-connect-simon-slice-3-rollout-review.md`](stripe-connect-simon-slice-3-rollout-review.md)
   — exact Slice 3 merge, CI/deployment, production-inactive evidence, preserved
   contracts, and the prepared but unexecuted activation/rollback runbook.
5. [`stripe-connect-simon-slice-2-rollout-review.md`](stripe-connect-simon-slice-2-rollout-review.md)
   — committed Slice 2 controls and pass gates. Its `shadow-01`/`shadow-02`
   narrative predates shadow-04 and is historical, not the current resume point.
6. [`stripe-launch-schema-foundation-rollout-review.md`](stripe-launch-schema-foundation-rollout-review.md)
   — verified Slice 1 production schema evidence.
7. [`stripe-connect.md`](stripe-connect.md) and
   [`payout-v2-source-ingestion-rollout-review.md`](payout-v2-source-ingestion-rollout-review.md)
   — current v1 and older inactive Payout v2 context. Where they conflict with
   the protected Simon documents, the protected Simon product specification
   governs the future launch.
8. Committed code, migrations, tests, rollout manifests, Git history, and
   reviewed PR evidence.
9. This log — the current journey/handover record, not a replacement for
   product authority or executable tests.

### Protected-document integrity

The protected documents are verified using UTF-8 bytes after normalising CRLF
and lone CR line endings to LF. The table preserves the 11 August 2026 baseline
and records the owner-authorised 13 August 2026 interim-v1 rebaseline:

| Protected document | Prior LF-normalised SHA-256 | 13 August 2026 LF-normalised SHA-256 |
|---|---|---|
| Product specification | `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B` | `5D2E956C94A88D496265DCBDDBC85BC2E5F92FFCE262463C978081805302BED3` |
| Technical implementation plan | `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58` | `C1C76E9DB3450D22C83B0CE3D9D47D835244CF9F51A73B120B3E3E7344851A2A` |

Reason for the owner-authorised rebaseline: Simon's account onboarding had
become incorrectly coupled to replacing the entire payout architecture. The
immediate direction is now a hardened, human-controlled v1 route, while the
Accounts v2/payout-v2 target and all historical evidence remain preserved and
inactive.

Do not modify either protected document during repair or operational work
without explicit owner authority. The 13 August 2026 owner direction supplied
that authority for this docs-only rebaseline; later hash changes still require
a new explicit product-document review.

## 4. Safety and scope boundaries

- Slice 2 records exact payment evidence and one-payment/one-lesson contracts
  in an explicitly scoped test/shadow school. It must not create an earning,
  refund intent, payout, transfer, Connect resource, or live-mode Stripe effect.
- Every database read/write and identity must be scoped by `school_id`.
- Test and live Stripe configuration must fail closed. Separate restricted test
  keys by purpose; do not broaden permissions as a convenience.
- Shadow credentials may invoke only the documented reconciliation and request
  expiry operations, for the exact shadow project and school, with audit start
  and completion rows.
- Never read an instructor login code from the database. Use the supported
  email-code UI or audited admin impersonation route.
- Do not backfill historic payments, edit historical financial ledgers, move a
  cutover timestamp, release ambiguous claims, or invent a new Stripe identity.
- No production retirement activation, payout, transfer, refund, Connect
  onboarding, live payment, payout-engine transition, or Slice 4 operation is
  authorised by this log.
- The interim-v1 decision does not authorise the existing v1 account/invite or
  payout code to be operated unchanged. Account/onboarding and first-payout
  authority are separate future decisions after hardening is reviewed/merged.
- Slice 3 is merged and deployed inactive. Do not activate it until a separate
  approved change satisfies the runbook and stop conditions in the Slice 3
  rollout review.

## 5. Current status at a glance

| Area | Status | Evidence |
|---|---|---|
| Latest baseline | Verified | MVP A1 began from clean `origin/main` at merged PR #373, `c85381e53d2c4e9754e80c093d60b0fac10061b0`; PR #373 was independently confirmed merged before branching. |
| Slice 0: Stripe client boundary | Merged | PR #333, merge `5a59db1…`; Stripe `22.4.0`, API `2026-07-29.dahlia`, central client boundary. |
| Slice 1: inert schema | Applied, inactive | PRs #334–#335; migration 039 applied schema-only; production school remained on payout engine v1. |
| Slice 2: payment contracts | Formally accepted for completed shadow evidence | PRs #336–#337 prepared and repaired shadow-gated payment evidence/contracts. Step 17 independently accepted the complete shadow-05 Slice 2 record on 8 August 2026. Production rollout remains `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. |
| Fresh-schema bootstrap | Repair merged | PR #340 mirrors migration 013 and extends the rollback-only aggregate test for the Boolean/default contract plus real admin support access, tenancy, audit, password, and login-code boundaries. All three fresh-schema tests and all eight rollback/payment-contract tests passed against a disposable, confirmed non-production loopback database with the three gates enabled. |
| Deployment/database identity | Step 17 reverified read-only | Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` reports READY production-target deployment `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`, exact Git SHA `07871219afc9fc66084f2f8bc1bf609b23802dfd`, and alias `cc-simon-s2-shadow-05.vercel.app`. Neon remained exact project `shiny-bonus-66942766`, default/primary branch `br-empty-cell-za5kh6nr`, database `neondb`, school `1`. Stripe remained Sandbox/Test account `acct_1QUSsNIqhTSdZedS` with exact active eight-event webhook `we_1U0qdyIqhTSdZedS2h8O3RxW` and no live shadow-05 binding. |
| Shadow Checkout return URLs | Merged; accepted shadow evidence | PR #342 merged fail-closed URL binding for all approved producers. All four approved shadow-05 origins are singular and complete; Step 17 accepted the Slice 2 evidence. |
| Shadow-04 | Failed evidence; preserve | Aggregate applied once to an empty schema and a direct-slot payment was attempted. The environment has known binding/return-URL contamination and the `is_admin` defect. Never reuse it as clean acceptance evidence. |
| Money movement | Not performed | The 13 August rebaseline and local hardening implementation performed no Vercel, Neon, Stripe, environment, database, account, payment, refund, earning, payout, transfer, cutover or production operation. |
| Final Slice 2 evidence | Step 17 accepted | Fresh school-1 read-only evidence confirms one complete contract/source for each of the four origins, zero terminal discrepancies, exact audit/receipt counts, and the complete prohibited-effect matrix at zero. Independent repository, CI, Vercel, Neon, Stripe, protected-hash, and local validation review found no unresolved acceptance defect. |
| Slice 3: retired new products | Merged, deployed, production inactive verified | PR #356 merged as `ea3a65cb…`; exact CI and four Vercel deployments are successful/READY. A serializable read-only production query proved school `1` is CoachCarter and the nested retirement value/type are absent. Supported one-off and grandfathered contracts remain; activation is a separate approval. |
| Current implementation | Simon interim v1 hardening implemented locally for review | Durable Express/v1 identity and ambiguity recovery, tenant/audit scope, deliberate `payouts_start_date`, paused-by-default onboarding, exact approved Stripe-funded eligibility, the itemised Fraser preview and first-run authority boundary are present on the isolated branch. Review/merge is next; deployment and every operation remain separately unauthorized. Accounts v2/A8/A9 stay deferred and unoperated. |

## 6. Chronological project journey

### Before the Simon-specific slices

- **26 July 2026 — Repository-verified:** migration 035 installed the older
  Payout v2 ledger foundation schema-only. It remained inactive and every
  school remained on payout engine v1.
- **1 August 2026 — Repository-verified:** the protected Simon product
  specification fixed the target rules: one supported Stripe payment per
  lesson, exact Stripe fee evidence, instructor outcome gating, Friday noon
  lock, Friday 14:00 transfer, percentage split plus weekly franchise fee, and
  no automated value for pre-cutover or legacy credit.

### Implemented slices and reviews

- **1 August — PR #333, Slice 0:** added the pinned Stripe client/API boundary
  without schema, route-contract, or Stripe-resource changes.
- **1 August — PR #334, Slice 1:** added migration 039's inert, school-scoped
  launch schema, diagnostics, integrity guards, and rollback-isolated tests.
- **1 August — PR #335:** recorded the authorised production schema-only apply.
  Reviewed evidence reported 26/26 launch tables, zero launch rows, 13 critical
  indexes, 25 functions, 68 triggers, 10 nullable bridges, unchanged historic
  fingerprints, and the single school still on v1.
- **1 August — PR #336, Slice 2:** prepared shadow-gated payment candidates,
  exact evidence, one-payment/one-lesson contracts, reconciliation, origin
  whitelisting, and migration 040's narrow fill-once trigger correction.
- **2 August — PR #337:** repaired durable origins and incomplete-evidence
  reconciliation across all four origins; added strict shadow-operation and
  instructor-login auditing controls. No production activation was approved.
- **3 August — PR #338:** fixed an empty-schema bootstrap failure where
  `instructor_busy_blocks` referenced `schools` before `schools` existed. It
  added a triple-gated rollback-only fresh-schema test. PR #338 explicitly left
  a separate full-second-apply idempotency failure out of scope.
- **3 August — PR #340:** repaired the aggregate's missing
  `instructors.is_admin` column and added rollback-only coverage for the exact
  column contract plus real school-scoped, audited admin instructor access. CI
  passed and the repair merged as `26b6cdfd…`.
- **3 August — PR #342:** added the independently verified Vercel/Neon identity
  preflight and fail-closed shadow return URLs for all approved Slice 2 origins.
  Syntax, Playwright, and connected Vercel checks passed; the PR merged as
  `0c496b0…`. No shadow-05 resource or provider identity pass was created by the
  PR.

## 7. Completed implementation slices and relevant PRs

| PR | Merge commit | What is trustworthy from it | What it does not prove |
|---|---|---|---|
| [#333](https://github.com/coachcarteruk-gif/coachcarter-website/pull/333) | `5a59db1155bdc54934f5b4768fa3a61f24145808` | Pinned Stripe SDK/API and central, fail-closed client boundary. | Accounts v2, restricted-key rollout, or a payment-contract exercise. |
| [#334](https://github.com/coachcarteruk-gif/coachcarter-website/pull/334) | `cbb820867c038293d90a2cad4f2b7af447718cee` | Inert Slice 1 schema and integrity controls. | Production application or Slice 2 acceptance. |
| [#335](https://github.com/coachcarteruk-gif/coachcarter-website/pull/335) | `12c5a5a2c7d203656ab054183451240f88381df7` | Production migration 039 evidence and `SCHEMA_APPLIED_INACTIVE`. | Any launch config, agreement, writer, or money action. |
| [#336](https://github.com/coachcarteruk-gif/coachcarter-website/pull/336) | `307864b0a7ed43242e5f720270f62f7baf060409` | Initial Slice 2 implementation and migration 040 correction. | Deployment, shadow activation, or a complete live exercise. |
| [#337](https://github.com/coachcarteruk-gif/coachcarter-website/pull/337) | `8e71267ad3ff50c17285f32e1b5de619a2cb1b46` | Four-origin repair, retryable evidence, strict shadow/audit gates, protected-document hashes. | Fresh aggregate completeness or shadow acceptance. |
| [#338](https://github.com/coachcarteruk-gif/coachcarter-website/pull/338) | `3710c9b0f5ac9b095297950c999393ae5577ffbe` | Empty-schema `schools` ordering repair and two rollback-only bootstrap tests. | `instructors.is_admin`, a real `access-instructor-account` call, or full aggregate reapply idempotency. |
| [#339](https://github.com/coachcarteruk-gif/coachcarter-website/pull/339) | `5a462837cafa9a7c83f5594b553f341ac6e857ad` | Preserved this living log and the Simon-specific worker rule. | Any migration repair, shadow acceptance, or money operation. |
| [#340](https://github.com/coachcarteruk-gif/coachcarter-website/pull/340) | `26b6cdfd7d96f86ffc6988c58c4a46633fc6df38` | Minimal aggregate repair for migration 013 plus three-test fresh-schema and real-route admin-access coverage. | Deployment/database identity binding, correct shadow return URLs, or Slice 2 acceptance. |
| [#341](https://github.com/coachcarteruk-gif/coachcarter-website/pull/341) | `dc0e17a5c6b4a7837a4b633f61f172b87bd6ea7a` | Fixed instructor sign-in code verification; intermediate prerequisite-branch baseline. | Any Simon identity/return-URL prerequisite or Slice 2 acceptance. |
| [#342](https://github.com/coachcarteruk-gif/coachcarter-website/pull/342) | `0c496b0baafc71afbda444afeefafd4eead59a29` | Protected read-only Vercel/Neon identity preflight, independent control-plane verifier, and fail-closed return URLs for all approved Slice 2 Checkout producers; CI green. | A real shadow-05 identity pass, any resource configuration, schema apply, seed, Checkout, or Slice 2 acceptance. |
| [#343](https://github.com/coachcarteruk-gif/coachcarter-website/pull/343) | `a8f9f2afb1b9c311720047ce921e17e439ab0a9a` | Runtime `VERCEL_URL` bootstrap for the deployed application only when no custom host exists; exact operator/application/Vercel deployment-host comparison retained. | Step 10 resume, deployment, provider configuration, schema, seed, Stripe activity, or Slice 2 acceptance. |
| [#344](https://github.com/coachcarteruk-gif/coachcarter-website/pull/344) | `6635b8f786730f04c8b981d0e437dcff81231220` | Minimal acceptance of Neon's optional positive-integer provider cell label, with current direct/pooled host coverage and fail-closed malformed-host regressions. | A real identity preflight pass, schema, seed, Stripe activity, or Slice 2 acceptance. |
| [#345](https://github.com/coachcarteruk-gif/coachcarter-website/pull/345) | `d911c89868eebe86a08a757b22ed6e3524cd5fe8` | Derives the pooled Neon hostname from the exact endpoint ID plus direct provider host even when deprecated `pooler_enabled` is false; includes a provider-shaped regression and endpoint-ID mismatch rejection. All GitHub and Vercel checks passed. | A real identity preflight pass, schema, seed, Stripe activity, Step 11, or Slice 2 acceptance. |

## 8. Shadow-exercise history

### Shadow-04 exercise

The following sequence is **Operator-reported** unless a line explicitly says
otherwise:

1. A fresh isolated Vercel project and fresh Neon resource were created under
   the approximate environment label `cc-simon-s2-shadow-04`.
2. The aggregate `db/migration.sql` was applied exactly once to a database that
   initially contained zero public tables.
3. Direct schema verification found approximately 26 tables, 61 indexes, 25
   functions, 52 triggers, and 12 constraints for the Slice 2 exercise scope.
4. Stripe was test-mode and fail-closed. Restricted test keys were separated
   by purpose, Connect permissions were disabled, and the test webhook listened
   only for `checkout.session.completed` and `payment_intent.succeeded`.
5. The first supported seeding attempt exposed a serious binding mismatch: the
   deployed Vercel application's `POSTGRES_URL` did not appear to point to the
   same fresh Neon database inspected by the direct verifier. Routes reported
   success while direct inspection still found zero seeded administrators and
   instructors.
6. The binding was replaced and the deployment repeated. Supported seeding then
   produced one administrator, one active instructor, one
   `create-instructor` audit action, seven availability windows, exactly one
   active `simon_launch_v1` shadow config, exactly one active agreement valid at
   payment time, and no launch config for any other school.
7. Instructor email-code login was attempted through the supported UI.
   Notification logging reported successful sends, but Gmail did not expose a
   new usable code. No code was read from the database.
8. One direct-slot Stripe test payment for a lesson on 10 August completed. The
   webhook processed it in test mode and created exactly one scheduled lesson
   booking with the expected direct-booking/credit ledger purpose. No linked
   launch payment contract was created. Therefore `direct_slot` was attempted,
   but it did **not** satisfy Slice 2 acceptance.
9. The temporary API harness omitted the `Origin` header. Checkout fell back to
   a legacy production return URL. Browser security stopped navigation before
   the production page loaded, and the operator returned manually to the shadow
   deployment. No production API or production mutation was intentionally
   invoked. Because the earlier database binding was unknown, the exercise
   cannot unconditionally certify zero non-financial production side effects.
10. Admin support access was then attempted so the exercise could continue
    without reading a login code. `POST /api/admin?action=access-instructor-account`
    failed with `column "is_admin" does not exist`.
11. Strict stop-on-defect rules ended the exercise. The three other payment
    origins and the cross-cutting delayed/replay/mismatch/tenant checks were not
    completed.

## 9. Verified evidence

### Repository-verified on 3 August 2026

- Remote/local `main` resolve to PR #342 merge
  `0c496b0baafc71afbda444afeefafd4eead59a29`. The current documentation-only
  handover branch was created from that exact clean commit; the exercise
  baseline remains the earlier `3710c9b0…` commit recorded in the failed
  shadow-04 history.
- The worktree was clean before
  `codex/simon-fresh-schema-is-admin-repair` was created from remote `main`.
- PR #338 is merged and its GitHub merge metadata matches that commit.
- PR #339 preserved this living log and the Simon-specific `AGENTS.md` rule on
  remote `main` before the repair branch was created.
- PR #340 merged the focused three-file repair after its syntax and Playwright
  CI checks completed successfully. Its merge commit is `26b6cdfd…`.
- PR #342 merged the identity/return-URL prerequisite commit after syntax/
  encoding, Playwright, and connected Vercel checks completed successfully.
  Its merge commit is `0c496b0…`; the merge does not prove a shadow-05 provider
  identity because those resources do not yet exist.
- The two protected LF-normalised hashes match exactly and the documents were
  not changed by this task.
- `api/admin.js` selects `COALESCE(is_admin, FALSE) AS is_admin` in
  `handleAccessInstructorAccount()`.
- `db/migrations/013_instructor_is_admin.sql` adds
  `instructors.is_admin BOOLEAN DEFAULT FALSE`.
- PR #340 adds exactly one aggregate DDL statement equivalent to migration 013
  and no unrelated migration cleanup.
- `tests/migration-fresh-schema.integration.spec.js` now asserts the column's
  Boolean/default contract and invokes the real admin route against the same
  freshly bootstrapped transaction. It covers same-school success, cross-school
  rejection, the required audit event, unchanged password state, an unused
  login-code row, no sensitive response fields, and captured route SQL that
  never references password or login-code storage.
- `tests/admin-instructor-access.spec.js` is a source-contract test; it does not
  run the route against a freshly bootstrapped database.
- The PR #342 implementation record reports 198 syntax files, 16/16 identity
  tests, 12/12 return-URL tests, 12/12 existing shadow-operation tests, 19/19
  payment-contract/reviewer tests, and a broader 77/77 focused selection.
- `npm run review:stripe-launch-slice-2` currently reports all 14 checks true,
  with terminal status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- The protected LF-normalised hashes still match exactly and neither protected
  document has a worktree diff.

### Initial verification blockage and local-only resolution on 3 August 2026

- Both the fresh-schema suite and the eight-test rollback/payment-contract
  suite were invoked with all three database gates against the configured
  non-production test target.
- The database rejected authentication before either suite could begin its
  transaction. The fresh-schema run recorded one setup failure and two tests
  not run; the payment-contract run recorded one setup failure and seven tests
  not run. These are infrastructure failures, not passing repair evidence.
- No database schema, fixture, production data, shadow resource, or external
  payment state was changed by the failed connection attempts.
- Verification was then completed against a disposable PostgreSQL instance
  bound only to loopback, with a test-only database identity that was neither
  production nor a shadow environment. No connection string or credential is
  retained in this log.
- All three gates were enabled for both suites. The fresh-schema suite passed
  3/3 with zero skips and the rollback/payment-contract suite passed 8/8 with
  zero skips. Both suites used transactions and rolled back their test work.

### Historical validation evidence

The pre-shadow record supplied by the operator states:

- syntax check: 195 files passed;
- focused Stripe launch selection: 76 tests passed;
- Slice 2 review: 14/14 checks passed;
- Slice 2 rollout review test passed;
- rollback/payment-contract integration selection: 8 tests passed;
- fresh-schema migration integration: 2 tests passed.

The 195-file syntax result and 14-check reviewer were reproduced on 3 August.
PR #338 independently records the 2 fresh-schema and 8 rollback-only passes.
The exact 76-test command/output was not committed, so that combined count
remains operator-reported rather than independently reproduced here.

### Shadow-04 zero-money evidence

The operator reported zero rows after the stopped exercise in:

- `stripe_launch_booking_earnings`
- `payout_runs`
- `instructor_payout_batches`
- `stripe_launch_transfer_intents`
- `stripe_launch_transfer_attempts`
- `refund_intents`
- `refund_attempts`
- `refund_events`
- `refund_event_lines`
- `instructor_payouts`
- `payout_line_items`

No payout, transfer, refund, Connect onboarding, live-mode Stripe operation, or
Slice 3 operation was performed. These shadow facts are not backed by committed
query output and must not be promoted to independently verified evidence.

## 10. Known defects and blockers

### Repair verified: aggregate omitted migration 013

**Observed failure:** `POST /api/admin?action=access-instructor-account` returned
an error caused by `column "is_admin" does not exist`.

**Repository-confirmed root cause:** the route queries `is_admin`; individual
migration 013 adds it; the aggregate migration did not. PR #338's empty-schema
test never checked the column or exercised this route.

**Why it blocks Slice 2:** the supported instructor email-code path did not
yield a usable new code, and admin impersonation is the approved fallback. The
fresh schema cannot run that fallback. Strict stop-on-defect rules also prohibit
continuing in a partially known environment.

**Merged repair:** PR #340 mirrors migration 013 in `db/migration.sql`, asserts
the column contract on a genuinely empty aggregate schema, and adds focused
database-backed same-school/cross-school admin-access coverage. The three-test
fresh-schema suite and eight-test rollback/payment-contract suite both passed
with all three database gates against a disposable confirmed non-production
loopback database. The repair blocker is closed; Slice 2 acceptance remains
separately blocked by fresh shadow-05 resource authority, a passing identity
preflight, and the clean shadow-05 rerun. The prerequisite code itself merged
in PR #342.

### Closed historical blocker: Step 12 writer was not deployed

At this point in the journey, the minimum config/agreement writer was committed
on `codex/simon-shadow05-fixture-writer` as draft PR #346 but could not yet be
treated as a supported route. Later dated entries record its reviewed merge,
deployment, supported shadow-05 fixture, and completion of Steps 12–16. This is
historical context, not the current blocker.

### Closed blocker: required sensitive verifier inputs could not be recovered

**Observed failure:** after owner-assisted login, the fresh Vercel bearer
returned HTTP 200 and the exact isolated project/deployment remained verified.
Vercel lists one Production `POSTGRES_URL` and one Production
`STRIPE_LAUNCH_SHADOW_CRON_SECRET`, but both are sensitive records. The official
list endpoint, documented per-variable decrypt endpoint, and isolated
`vercel env run` probe returned no decrypted values. The repository's existing
local env file does not contain the complete shadow verifier set.

**Repository-confirmed repair already complete:** PR #345 removed reliance on
Neon's deprecated `pooler_enabled` field. Exact merge `d911c898…` derives the
pooled candidate only from an exact endpoint-ID/direct-host-label match and is
READY as clean isolated deployment `dpl_D2UDrPkiKN6sTuKZSaLVQGc2Zyu2`.

**Additional safety event:** a diagnostic PowerShell formatting error rendered
the stale default CLI access and refresh credentials in private tool output.
They are not retained here. The CLI session was immediately logged out and its
exact auth file removed. The one unused Neon verifier key was revoked, and
zero matching Neon keys plus zero Vercel bypasses remain.

**Why it blocked Step 10:** the exact verifier required the active pooled direct
database URL and the same bearer used by the deployed application route. Those
values cannot be reconstructed, guessed, or weakened. Rotating the existing
Neon database role credential and replacing the isolated Vercel Production
database URL and shadow bearer are configuration changes outside the supplied
authority. No verifier run, identity pass, or fingerprint may be claimed.
Obtain fresh narrowly scoped rotation authority before creating another
temporary Neon key or attempting the one-shot gate.

### Historical observations and current disposition

- Shadow-04's attempted `direct_slot` payment created a scheduled booking but no
  linked launch contract. Shadow-05 later recovered the protected direct-slot
  candidate through the reviewed, singular reconciliation; Step 16 confirms the
  contract/source complete with exact evidence. Shadow-04 remains failed.
- Shadow-04's original deployment/database mismatch prevents a clean assertion
  about all non-financial side effects before rebinding.
- The missing `Origin` header demonstrated a production-return-URL fallback in
  the temporary harness. The local prerequisite repair now ignores client
  origin/forwarded-host evidence for launch candidates and binds both return
  URLs to the identity-verified Vercel deployment. That repair merged in PR
  #342 and was exercised across the shadow-05 origins; shadow-04 remains failed
  evidence.
- PR #338 records a separate pre-existing full-second-aggregate-apply failure at
  `learner_users_phone_unique`. Slice 2 requires exactly one apply to a fresh
  schema, so this is not the current blocker, but it remains known technical
  debt and must not be misreported as aggregate-wide idempotency.

## 11. Pitfalls and lessons learned

1. **A fresh Vercel project and a fresh Neon resource do not prove they are
   bound together.** Before seeding or payment, compare the exact Vercel
   project/environment and the sanitised Neon project, branch, endpoint host,
   and database identity from both the deployed application and direct verifier.
2. **A route reporting seed success is not database identity evidence.** Confirm
   the expected rows through both the application and the independently bound
   verifier before continuing.
3. **Never use a contaminated shadow as a clean rerun.** Preserve shadow-04 as
   failed evidence and create shadow-05 from entirely new resources.
4. **Aggregate migrations must be tested as the actual bootstrap authority.**
   Individual migrations can contain required historical changes that the
   aggregate silently omitted.
5. **Static route tests are insufficient for schema-dependent auth paths.** The
   admin impersonation test asserted source strings but did not execute SQL
   against a fresh schema.
6. **Return URLs are part of the environment safety boundary.** A missing
   `Origin` must not silently select production during a shadow exercise.
7. **Notification “sent” does not prove the operator received a usable login
   code.** Continue to forbid reading codes from the database; repair and test
   the supported admin impersonation fallback.
8. **A processed Stripe webhook and one booking are not Slice 2 acceptance.**
   The exact source, contract, evidence, idempotency, and zero-side-effect
   predicates must all pass.
9. **Approximate counts are diagnostic only.** Final acceptance needs retained,
   sanitised query evidence tied to exact resource and deployment identities.

## 12. Environment and resource inventory

Names and non-secret identifiers only:

| Environment/resource | Recorded name | Status |
|---|---|---|
| Production Neon project | `neon-green-elephant` | Migration 039 applied schema-only; inactive. |
| Production Neon branch | `main` | Recorded by the Slice 1 rollout evidence. |
| Failed Slice 2 shadow | Approximately `cc-simon-s2-shadow-04` | Preserve; never reuse as clean acceptance. Exact Vercel project, Neon project, branch, host, and database names were not retained in repository evidence. |
| Shadow-05 Neon organisation | `cc-simon-shadow-isolated` | Fresh independent Free organisation `org-fancy-forest-47074420`; zero pre-existing projects before creation. |
| Required fresh rerun | `cc-simon-s2-shadow-05` | Exercise completed; Step 16 evidence complete but Slice 2 not formally accepted. Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`; current READY production-target deployment `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`; alias `cc-simon-s2-shadow-05.vercel.app`; app SHA `07871219afc9fc66084f2f8bc1bf609b23802dfd`. Neon project `shiny-bonus-66942766`, default/primary branch `br-empty-cell-za5kh6nr`, database `neondb`, school `1`. |
| Shadow Stripe mode | `test` | Exact Sandbox/Test account `acct_1QUSsNIqhTSdZedS`; separate live destination view has no shadow-05 binding. |
| Shadow webhook events | Eight exact approved events | Active destination `we_1U0qdyIqhTSdZedS2h8O3RxW` at `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`: `account.updated`, `charge.failed`, both Checkout async outcomes, Checkout completed/expired, and PaymentIntent failed/succeeded. |

Do not add resource URLs containing credentials or any secret values to this
inventory. Store secrets only in the relevant provider secret store.

### Shadow-05 identity-preflight contract

The deployed application must bind the expected provider identifiers in the
`STRIPE_LAUNCH_SHADOW_*` environment variables and independently match them to
Vercel's `VERCEL_PROJECT_ID`, `VERCEL_ENV`, and `VERCEL_URL`, the configured
Neon project/branch identifiers, the active `POSTGRES_URL` endpoint host, and
`SELECT current_database()`. The operator verifier must additionally match the
same sanitised identity to the Vercel deployment API, Neon branch/endpoint/
database APIs, and a separate read-only direct database connection.

After PR #343, the deployed application does not require a pre-deployment
`STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST`: when that variable is absent it binds
the host from provider runtime `VERCEL_URL`. If the variable is present, it
remains authoritative and a mismatch fails closed. After deployment, the
independent operator verifier must set the exact provider-derived deployment
host in `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST`; it compares that host with the
application identity/fingerprint and Vercel deployment control-plane evidence.
A project alias, operator label, or previous deployment URL is not a substitute.

The operator-only `VERCEL_TOKEN`, `NEON_API_KEY`,
`STRIPE_LAUNCH_SHADOW_DIRECT_DATABASE_URL`, shadow bearer credential, and any
deployment-protection bypass credential are inputs only. They must never appear
in diagnostic output, fingerprints, logs, or retained evidence. A pass reports
only the school ID, provider IDs/names/hosts, a SHA-256 identity fingerprint,
and explicit false values for resource and Checkout approval. Run with
`npm run preflight:stripe-launch-shadow-identity` only after fresh shadow-05
resources exist under separate authority; the command is read-only and never
grants resource creation or payment authority.

## 13. Slice 2 acceptance evidence status

### Four approved payment origins

| Exact origin | Shadow-05 Step 16 retained result | Required acceptance contract |
|---|---|---|
| `direct_slot` | Exactly one complete contract and one complete source; protected contract/source and active booking link match. | One supported direct-slot payment must create exactly one booking, one correct BCS/slot-purchase attribution, one source, and one complete contract with exact amount, currency, fee, Stripe creation time, availability time, school, learner, and instructor evidence. |
| `test_date_direct` | Exactly one complete contract and one complete source. | One payment must map to exactly one 90-minute lesson with `booking_purpose='test_date'`, preserve test-date evidence, and pass every normal payment/fee/cutover/tenancy predicate. |
| `one_off_offer` | Exactly one complete contract and one complete source. | One paid, slot-pinned, single-lesson offer must produce one booking/source/contract. Flexible, repeating, or multi-booking offer shapes must produce no Slice 2 contract. |
| `captured_request` | Exactly one complete contract and one complete source. | A captured request must have the accepted same-school request, booking, and `slot_purchase` credit transaction before materialisation. If local state is not ready, receipt processing remains retryable; it must never guess a source or create duplicates. |

All four origin rows and all Step 14 cross-cutting scenarios have retained
passing evidence. Step 16 has assembled and reverified the evidence package;
formal acceptance or rejection remains exclusively Step 17.

### Cross-cutting scenarios required by the plan and tests

- **Delayed balance-transaction evidence:** first pass leaves the durable origin
  with no guessed source/contract; later read-only reconciliation creates
  exactly one complete contract.
- **Replay and idempotency:** duplicate webhook and reconciliation attempts
  create no duplicate booking, BCS row, source, contract, or receipt effect.
- **Exact fee evidence:** balance-transaction fee is accepted; legacy NULL plus
  provisional zero remains unknown rather than a real zero fee.
- **Known fee mismatch:** injected known local fee contradiction becomes
  terminal/manual-review and can never become complete.
- **Amount/currency/Stripe-link mismatch:** contradictory evidence never becomes
  a complete contract and never overwrites immutable facts.
- **One-to-many mapping:** one payment cannot map to multiple active lessons.
- **Pre-cutover classification:** Stripe payment creation time controls; a
  pre-cutover payment stays permanently ineligible despite later webhook,
  lesson, or reschedule time.
- **Reschedule continuity:** replacement links only when it is the sole active
  same-instructor lesson; old and replacement cannot both earn.
- **Cross-school isolation:** adversarial or mismatched candidates/rows remain
  untouched and no cross-tenant contract is created.
- **Shadow auth negative paths:** wrong project, non-test mode, wrong/missing
  school, wrong secret, disabled flag, or unsupported operation returns 401 and
  performs no work.
- **Audited shadow operations:** only reconciliation and request expiry are
  invoked; each has audit start and completion evidence, and audit failure stops
  before work.
- **Audited instructor sign-in:** login issues no session if its required audit
  row cannot be persisted. No login code is read from the database.
- **Zero prohibited effects:** no launch earning, payout, transfer, refund,
  Connect resource/onboarding, live Stripe effect, historic backfill, other
  school config, or Slice 3 operation exists unless a future explicitly scoped
  acceptance case says otherwise.

Any failed receipt, missing origin, unexpected contradiction, unaudited
operation, auth bypass, tenant leak, uncertain environment binding, or
money-movement row is an immediate fail-and-stop condition.

## 14. Detailed path to completion

### 1. Preserve shadow-04

- **Status:** Completed as a decision; preservation is ongoing.
- **Preconditions:** None.
- **Evidence required:** Resource names and retained sanitised logs/counts marked
  as failed; no deletion or relabelling as acceptance.
- **Stop conditions:** Any proposal to repair/reuse it as a clean environment.
- **Expected output:** Shadow-04 remains failed historical evidence only.
- **Relevant artifacts:** This log, provider resource inventories.
- **Production/money risk:** None if left untouched.

### 2. Create a tightly scoped repair branch from latest main

- **Status:** Completed on `codex/simon-fresh-schema-is-admin-repair` from
  `5a462837…`.
- **Preconditions:** Reverify remote `main`, clean worktree, read this log and
  protected documents.
- **Evidence required:** Branch base commit and clean pre-change status.
- **Stop conditions:** Main advanced with conflicting migration/auth work, or
  unrelated local changes overlap.
- **Expected output:** Fresh `codex/` repair branch containing only migration and
  focused regression changes.
- **Relevant artifacts:** `AGENTS.md`, `db/migration.sql`, migration 013, tests.
- **Production/money risk:** None from branch creation.

### 3. Mirror migration 013 into the aggregate

- **Status:** Implemented and verified.
- **Preconditions:** Repair branch; confirm the column is still absent.
- **Evidence required:** Minimal idempotent aggregate change equivalent to
  `ALTER TABLE instructors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`.
- **Stop conditions:** Any unrelated DDL, changed financial rows, or need to
  weaken existing constraints.
- **Expected output:** Fresh aggregate schemas include `instructors.is_admin`
  with the historical default/nullable contract.
- **Relevant artifacts:** `db/migration.sql`,
  `db/migrations/013_instructor_is_admin.sql`.
- **Production/money risk:** No money movement; high-care schema code. Existing
  production already has the individual migration's column and must not be
  directly mutated by this step.

### 4. Add the fresh-schema column regression

- **Status:** Implemented and verified; 3/3 fresh-schema tests pass with zero
  skips.
- **Preconditions:** Step 3.
- **Evidence required:** Triple-gated rollback-only test applies the full
  aggregate to an empty schema and queries column name, type, and default.
- **Stop conditions:** Test can target production, skips the aggregate, or does
  not roll back.
- **Expected output:** Regression fails without the repair and passes with it.
- **Relevant artifacts:** `tests/migration-fresh-schema.integration.spec.js`.
- **Production/money risk:** None when run only against the confirmed
  non-production test database.

### 5. Add fresh-schema admin-access coverage

- **Status:** Implemented and verified against the real route and freshly
  bootstrapped aggregate schema.
- **Preconditions:** Steps 3–4; safe JWT/admin/instructor fixtures inside the
  rollback-only fresh schema.
- **Evidence required:** A focused database-backed test executes the real
  `access-instructor-account` path or its database boundary, proves same-school
  success and audit creation, and includes a cross-school rejection.
- **Stop conditions:** Password exposure/reset, database login-code reads,
  unscoped fixtures, mocked-away SQL, or missing rollback.
- **Expected output:** Admin support access works on an aggregate-bootstrapped
  schema and remains school-scoped/audited.
- **Relevant artifacts:** `api/admin.js`, `tests/admin-instructor-access.spec.js`,
  fresh-schema integration test or a new narrowly named integration test.
- **Production/money risk:** None in rollback-only non-production tests.

### 6. Run repair validation

- **Status:** Complete. Syntax, focused launch/auth, rollout review, all 14
  machine checks, both mandatory database suites, protected hashes, and diff
  checks pass.
- **Preconditions:** Steps 3–5 complete.
- **Evidence required:** 195-file-or-current syntax pass; focused admin-access
  tests; focused Stripe launch selection; Slice 2 rollout-review test; all 14
  machine checks; 8-test-or-current rollback/payment-contract integration; and
  fresh-schema integration passes. Record exact commands and counts.
- **Stop conditions:** Any failure/skip that removes required coverage, protected
  hash change, production DB equality, or unexplained schema drift.
- **Expected output:** Reproducible green repair evidence with no external money
  operation.
- **Relevant artifacts:** `package.json`, `scripts/check-syntax.js`,
  `scripts/stripe-launch-slice-2-rollout-review.js`, relevant Playwright suites.
- **Production/money risk:** None when database gates are correct.

### 7. Open and merge a focused repair PR

- **Status:** Completed. PR #340 merged to `main` as `26b6cdfd…` with green
  syntax and Playwright CI checks.
- **Preconditions:** Step 6; clean diff limited to aggregate/test repair.
- **Evidence required:** PR explains root cause, test gap, safety, exact validation,
  and protected-document hashes; review/CI green.
- **Stop conditions:** Unrelated changes, deployment/resource actions, protected
  document edits, or unresolved review findings.
- **Expected output:** Focused merged repair commit on `main`.
- **Relevant artifacts:** Repair diff and CI/PR evidence.
- **Production/money risk:** No money movement. Normal application deployment
  may occur on merge, but the aggregate change does not apply itself to the
  existing production database.

### 8. Add a deployment/database identity preflight

- **Status:** Completed as an implementation prerequisite. PR #342 merged as
  `0c496b0…` with green CI. The one-shot shadow-05 identity preflight later
  passed, and Steps 14–16 independently reverified the exact provider/database
  identities read-only.
- **Preconditions:** Repair merged; define a sanitised, non-secret identity
  format.
- **Evidence required:** Before seeding/payment, both the deployed application
  and direct verifier independently report and match the exact Vercel project
  and environment plus Neon project, branch, endpoint host, and database name.
  Retain a sanitised fingerprint and names, never the connection string.
- **Stop conditions:** Any value is unknown, derived only from an operator label,
  differs between sides, or exposes credentials.
- **Expected output:** A documented/read-only preflight that cannot report pass
  for the shadow-04 binding failure.
- **Relevant artifacts:** Shadow runbook/review, protected admin diagnostic or
  deployment metadata helper, `api/_stripe-launch-shadow-identity.js`,
  `api/stripe-launch-shadow-identity.js`,
  `scripts/stripe-launch-shadow-identity-preflight.js`, and
  `tests/stripe-launch-shadow-identity.spec.js`.
- **Production/money risk:** Read-only; do not expose the diagnostic publicly.

### 9. Make shadow return URLs fail closed

- **Status:** Completed as an implementation prerequisite. PR #342 merged as
  `0c496b0…` with green CI for all four approved origins. The shadow-05 exercise
  later completed all four origins without a production return-URL fallback.
- **Preconditions:** Identify every Slice 2 Checkout producer and trusted shadow
  base-URL source.
- **Evidence required:** Tests prove a shadow request cannot fall back to
  `https://coachcarter.uk` when `Origin` is missing/invalid; accepted shadow
  URLs resolve only to the bound shadow deployment.
- **Stop conditions:** Client-controlled arbitrary redirect, production fallback
  in shadow, or broad change to live payment semantics without separate review.
- **Expected output:** Correct direct-slot, test-date, offer, and request return
  URLs in shadow, including the temporary harness path.
- **Relevant artifacts:** `api/slots.js`, `api/offers.js`,
  `api/_stripe-launch-shadow-return-urls.js`, and
  `tests/stripe-launch-shadow-return-urls.spec.js`.
- **Production/money risk:** Payment-flow code; potentially production-affecting
  and therefore requires focused regression/review, but no money operation is
  needed to implement it.

### 10. Create `cc-simon-s2-shadow-05`

- **Status:** Completed on 4 August 2026. PR #345 endpoint-payload repair is
  merged as `d911c898…`; clean exact deployment
  `dpl_ELTwjwU1yvbuiTHonJjZomjivaWN` is READY on the isolated Production target
  with provider host
  `cc-simon-s2-shadow-05-n6pepjew7-coachcarteruk-2599s-projects.vercel.app`
  and no dirty marker. The exact one-shot identity preflight returned `PASSED`
  with fingerprint
  `sha256:c94c4cc0c3ceaaf24f8401dd8a23e55ba3c26343bda0b3e3ab4a688162aa3127`
  and `transaction_read_only:true`. Temporary Neon and Vercel verifier access
  was revoked and both final inventories are zero. The database remains
  unseeded; no schema, Stripe resource, Checkout, payment, refund, payout,
  transfer, Connect account, or webhook action was performed.
- **Preconditions:** Steps 7–9 merged; explicit authority to create test
  resources; resource identity plan ready.
- **Evidence required:** Entirely fresh Vercel project and Neon project/branch/
  database names, Stripe test-mode configuration, restricted permissions, and
  identity-preflight pass.
- **Stop conditions:** Any resource reuse, live key/mode, Connect permission,
  identity mismatch, or secret exposure.
- **Expected output:** Clean isolated shadow-05 inventory.
- **Relevant artifacts:** Provider inventories and shadow runbook.
- **Production/money risk:** Creates non-production resources only; no real
  money movement.

The step-10 session must stop immediately after retaining a sanitised exact
resource inventory and a passing
`npm run preflight:stripe-launch-shadow-identity` result. It must not apply
`db/migration.sql`, seed a school/user/instructor, create a webhook-driven test
payment, create a Checkout Session, or begin steps 11–18. Existing shadow-01,
shadow-03, and failed shadow-04 resources must not be inspected, reused,
rebound, or treated as acceptance evidence during this step.

### 11. Apply the aggregate once to a genuinely empty schema

- **Status:** Completed on 4 August 2026. The existing Neon Console SQL Editor
  independently proved zero public tables, accepted the complete LF-normalized
  reviewed aggregate in one Run, and completed all 956 parsed statements with
  no error state. Read-only postflight retained sanitised schema counts and the
  exact `instructors.is_admin` contract.
- **Preconditions:** Verified shadow-05 binding and zero-table proof.
- **Evidence required:** Before count zero; one successful aggregate apply;
  retained sanitised schema counts; explicit `instructors.is_admin` proof.
- **Stop conditions:** Non-empty schema, wrong identity, second apply attempt,
  DDL error, or count/column mismatch.
- **Expected output:** Fresh Slice 2-capable schema created exactly once.
- **Relevant artifacts:** `db/migration.sql`, fresh-schema verifier.
- **Production/money risk:** Shadow database DDL only; never production.

### 12. Rerun Slice 2 setup from the beginning

- **Status:** Completed on 4 August 2026 through the supported, reviewed
  shadow-05 application path. The exact school, active instructor, audit,
  availability, single `simon_launch_v1`/`shadow` config, and active agreement
  preconditions were retained and subsequently reverified.
- **Preconditions:** Step 11; supported seeding routes only.
- **Evidence required:** One admin, one active instructor, create audit, seven
  availability windows, one active shadow config, one active payment-time-valid
  agreement, no other school config, identity still matching after deployment.
- **Stop conditions:** Route/direct-verifier disagreement, audit failure,
  unexpected rows/config, or unsupported direct SQL seeding.
- **Expected output:** Clean, auditable exercise fixture.
- **Relevant artifacts:** Supported admin/instructor routes, seed verification.
- **Production/money risk:** Shadow-only data; no money movement.

### 13. Exercise all four approved payment origins

- **Status:** Completed by 6 August 2026 and reverified read-only in Step 16.
  `direct_slot`, `test_date_direct`, `one_off_offer`, and `captured_request`
  each remain exactly one complete contract and one complete launch source.
- **Preconditions:** Step 12; supported instructor session; correct return URLs.
- **Evidence required:** `direct_slot`, `test_date_direct`, `one_off_offer`, and
  `captured_request` each satisfy the exact acceptance table in section 11.
- **Stop conditions:** Missing/duplicate booking, BCS, source, or contract;
  unsupported origin; failed receipt; unexpected contradiction; production URL.
- **Expected output:** Exactly one complete contract per approved origin and no
  contract for prohibited shapes.
- **Relevant artifacts:** Protected plan Slice 2; payment-contract unit and
  integration suites; rollout review.
- **Production/money risk:** Stripe test-mode payments/authorisations only; no
  live money and no Connect action.

### 14. Run delayed, replay, mismatch, isolation, and negative paths

- **Status:** Completed on 7 August 2026; see the append-only Step 14 entry.
- **Preconditions:** At least one clean origin fixture and controlled test
  adapters/events.
- **Evidence required:** Every cross-cutting scenario in section 11 passes,
  including both audited shadow operations and auth fail-closed cases.
- **Stop conditions:** Duplicate effects, guessed evidence, tenant access,
  unaudited work, new identity after ambiguity, or unexpected money row.
- **Expected output:** Complete sanitised evidence matrix tied to shadow-05.
- **Relevant artifacts:** `tests/stripe-launch-payment-contracts.spec.js`,
  integration suite, shadow auth/login tests, rollout review.
- **Production/money risk:** Test mode/read-only reconciliation only.

### 15. Reconfirm prohibited tables and operations remain untouched

- **Status:** Completed on 8 August 2026 and freshly reconfirmed in Step 16.
  Every table in the complete school-1 prohibited-effect matrix is exactly
  zero; Stripe remains Sandbox/Test and has no live shadow-05 webhook binding.
- **Preconditions:** Steps 13–14 complete.
- **Evidence required:** Sanitised zero-row queries for all tables listed in
  section 7, plus zero Connect/onboarding/live effects and no config outside the
  exercise school.
- **Stop conditions:** Any unexplained money-mutation row or prohibited resource.
- **Expected output:** Final zero-side-effect evidence.
- **Relevant artifacts:** Read-only postflight diagnostics and provider logs.
- **Production/money risk:** Read-only verification.

### 16. Collect final evidence and update the Slice 2 review

- **Status:** Completed on 8 August 2026. The rollout review and this living log
  contain the exact repository/CI/provider/database/webhook identities,
  protected hashes, four-origin matrix, protected contract/source, audit and
  receipt counts, complete prohibited-effect matrix, Step 14 cross-cutting
  evidence, fresh local validation, provenance, and explicit limitations.
- **Preconditions:** All prior exercise checks green.
- **Evidence required:** Exact commit/deployment/resource names, identity
  fingerprint, commands/counts, four-origin matrix, negative paths, zero-effect
  checks, reviewer/operator, dates, and protected hashes.
- **Stop conditions:** Missing provenance, approximate resource identity,
  unredacted secret, or unresolved discrepancy.
- **Expected output:** Updated rollout review and this project log with concise,
  reproducible evidence.
- **Relevant artifacts:** Slice 2 rollout review, this log, PR/CI evidence.
- **Production/money risk:** Documentation/read-only.

### 17. Formally accept or reject Slice 2

- **Status:** Completed on 8 August 2026: `SLICE 2 ACCEPTED` after independent
  review of the exact merged Step 16 package plus fresh read-only repository,
  CI, Vercel, Neon, Stripe, school-scoped database, protected-hash, and local
  validation evidence.
- **Preconditions:** Step 16 complete and independently reviewed.
- **Evidence required:** Every required origin and cross-cutting check passes,
  environment identity is proven, and no defect or prohibited effect remains.
- **Stop conditions:** Any unresolved defect, assumption, unprovable binding,
  or acceptance criterion not run.
- **Expected output:** Explicit dated `SLICE 2 ACCEPTED` decision or another
  preserved failed attempt with a new blocker.
- **Relevant artifacts:** Protected plan, rollout review, this log.
- **Production/money risk:** Decision only; it grants no live money authority.

### 18. Hold Slice 3

- **Status:** Hold lifted only for the separately scoped 8 August 2026 Slice 3
  implementation task. The implementation is prepared inactive; production
  deployment/activation remains held.
- **Preconditions:** Formal step 17 acceptance plus a separately scoped Slice 3
  task/approval.
- **Evidence required:** Accepted Slice 2 record and fresh latest-main review.
- **Stop conditions:** Slice 2 is failed, incomplete, or merely “prepared.”
- **Expected output:** Inactive, school-scoped implementation with focused
  preservation and direct-bypass tests; no production activation.
- **Relevant artifacts:** Protected implementation sequence.
- **Production/money risk:** Prevents premature product/payment changes.

## 15. Next session starts here

Slice 3 implementation started from exact reviewed `origin/main`
`7be7920e07c75767e8eb923d3f122d62947f1899` after PR #355 and exact CI run
`31248540845` were verified. The implementation is inactive unless an exact
school config Boolean is separately enabled. Read
[`stripe-connect-simon-slice-3-rollout-review.md`](stripe-connect-simon-slice-3-rollout-review.md)
before review, deployment, or activation.

Do not infer production activation from the Slice 3 code or Slice 2 shadow
acceptance. No school flag has been changed. Slice 4 remains on hold. Do not
rerun reconciliation or expiry, replay a webhook, change Stripe/Vercel/Neon
state, mutate production data, or perform a money operation under this
handover.

## 16. Update protocol

For every future session:

1. Verify latest remote `main`, branch, HEAD, and worktree; record the exact
   commit used.
2. Reverify protected LF-normalised hashes before any implementation or shadow
   exercise that depends on them.
3. Update “Current status,” “Known defects,” “Unfinished scenarios,” “Detailed
   path,” and “Next session starts here” to reflect new evidence.
4. Preserve failed environment/resource names and the reason they are not
   reusable.
5. Cite PRs/commits, exact test commands/counts, and dated sanitised evidence.
6. Mark each fact Repository-verified, Operator-reported, or Assumption when its
   provenance is not otherwise obvious.
7. Never paste large command output or any secret. Summarise and point to the
   committed artifact or provider evidence location.
8. Append one dated session-log entry. Existing entries are append-only; add a
   correction entry rather than silently editing historical claims.

## 17. Dated append-only session log

### 3 August 2026 — Living log created

- Verified remote/local `main` at `3710c9b0…` and reviewed PRs #333–#338.
- Reverified both protected LF-normalised document hashes.
- Confirmed the aggregate has zero `is_admin` references while migration 013
  and the admin support route require the column.
- Confirmed the fresh-schema and static admin-access tests leave a real
  integration coverage gap.
- Reproduced the current 195-file syntax pass and 14/14 Slice 2 static review.
- Recorded shadow-04 as operator-reported failed evidence, separated verified
  facts from uncommitted historical details, and defined shadow-05's required
  clean rerun.
- Made documentation changes only; no migration repair, deployment, database
  mutation, payment, refund, payout, transfer, Connect, or resource action.

### 3 August 2026 — Fresh-schema repair implemented; DB verification blocked

- Fast-forwarded clean local `main` to remote `5a462837…`, confirming PR #339
  had preserved this log and the Simon `AGENTS.md` rule before branching.
- Created `codex/simon-fresh-schema-is-admin-repair` from that exact commit.
- Confirmed the root cause from PRs #337/#338 and repository source: migration
  013 supplies `instructors.is_admin`, the aggregate omitted it, the admin route
  selects it, and PR #338 tested neither the column nor the real route.
- Added only the idempotent historical `is_admin BOOLEAN DEFAULT FALSE` DDL to
  the aggregate and extended the rollback-only fresh-schema suite with the
  Boolean/default and database-backed admin-access contracts.
- Verified `node --check` for the changed test, 195-file syntax, four standalone
  static admin-access tests, 43 focused launch/auth tests, one Slice 2 rollout
  review test, and all 14 required machine-review checks.
- Reverified the protected product and technical-plan LF-normalised hashes
  exactly; neither protected document changed.
- Attempted both mandatory triple-gated database suites. The configured
  confirmed non-production target rejected authentication before a transaction
  began, so no database assertion passed and no database write occurred.
- No commit, push, PR, deployment, production/shadow access, Stripe operation,
  shadow-05 resource, or Slice 3 work was performed.

### 3 August 2026 — Fresh-schema repair database verification completed

- Preserved the rejected-credential attempts above as failed infrastructure
  evidence rather than rewriting them as a successful run.
- Downloaded and used a disposable PostgreSQL distribution locally, bound the
  temporary server only to loopback, and created a test-only database that was
  neither production nor any shadow environment.
- Applied the complete aggregate once to the disposable public test schema only
  to provide the production-shaped base required by the payment-contract suite.
  Added fake local-only instructor, learner, and admin fixtures; no application
  migration, production data, or cloud resource was touched.
- Ran the fresh-schema suite with all three gates. It applied the complete
  aggregate to its own genuinely empty schema inside a transaction and passed
  3/3 with zero skips, including the Boolean/default and real-route admin-access
  contracts.
- Ran the rollback/payment-contract integration suite with all three gates; it
  passed 8/8 with zero skips and rolled back its test transaction.
- The fresh-schema admin fixture inserts the existing tenant-resolution marker
  only inside the rolled-back test transaction so it can create a second school
  without weakening the aggregate's school-creation guard.
- No commit, push, PR, deployment, production/shadow access, Stripe operation,
  shadow-05 resource, or Slice 3 work was performed.

### 3 August 2026 — PR #340 merged; identity and return-URL handover prepared

- Verified PR #340 merged to `main` as `26b6cdfd…` after the syntax and
  Playwright CI checks completed successfully.
- Confirmed the fresh-schema repair is no longer a blocker. Slice 2 remains not
  accepted, and shadow-04 remains failed evidence that must not be reused.
- Preserved an unrelated clean instructor-sign-in branch, switched to current
  `main`, and created `codex/simon-shadow05-identity-return-url` from the exact
  PR #340 merge commit.
- Updated the mutable status, PR inventory, detailed path, and next-session
  handover so steps 8 and 9 are the only authorised implementation scope.
- No implementation code, commit, push, PR, deployment, production/shadow
  access, database mutation, Stripe operation, shadow-05 resource, or Slice 3
  work was performed.

### 3 August 2026 — Identity and return-URL prerequisites implemented

- Fast-forwarded the prerequisite branch from PR #340 merge `26b6cdfd…` to
  remote `main` at PR #341 merge `dc0e17a…`. The intervening instructor sign-in
  change touched only `api/magic-link.js`, `db/migration.sql`, and
  `tests/instructor-email-code-login.spec.js`; it did not overlap this scope.
- Added a protected, school-scoped GET identity diagnostic and a read-only
  operator verifier. They require exact agreement across the configured
  binding, Vercel runtime/control-plane evidence, Neon project/branch/endpoint/
  database evidence, the active connection target, and `current_database()`.
  Output contains sanitised identifiers and a fingerprint only.
- Added fail-closed shadow Checkout return-URL resolution before Stripe session
  creation for `direct_slot` (authenticated and guest), `test_date_direct`,
  `one_off_offer`, and `captured_request`. Both success and cancel URLs use only
  the identity-verified shadow deployment; client origin/forwarded-host input
  cannot choose them. The non-shadow URL contract remains unchanged.
- `npm run check:syntax` passed all 198 files.
- `npm test -- tests/stripe-launch-shadow-identity.spec.js --workers=1` passed
  16/16; `npm test -- tests/stripe-launch-shadow-return-urls.spec.js
  --workers=1` passed 12/12; and `npm test --
  tests/stripe-launch-shadow-operations.spec.js --workers=1` passed 12/12.
- `npm test -- tests/stripe-launch-payment-contracts.spec.js
  tests/stripe-launch-slice-2-rollout-review.spec.js --workers=1` passed 19/19.
- `npm test -- tests/stripe-launch-shadow-operations.spec.js
  tests/stripe-launch-payment-contracts.spec.js
  tests/stripe-launch-slice-2-rollout-review.spec.js
  tests/payout-v2-source-ingestion.spec.js
  tests/stripe-dynamic-payment-methods.spec.js
  tests/test-date-lesson-booking.spec.js tests/offer-effective-pricing.spec.js
  tests/social-video-booking-discount.spec.js
  tests/learner-booking-locations.spec.js --workers=1` passed 77/77.
- `npm run review:stripe-launch-slice-2` passed all 14/14 machine checks and
  remained `PREPARED_NOT_APPROVED_NOT_DEPLOYED`; `git diff --check` passed.
- Reverified the protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Running `npm run preflight:stripe-launch-shadow-identity` without shadow-05
  configuration correctly returned `BLOCKED`, reported only missing identity
  field names, and set both resource and Checkout approval to false. It did not
  contact a provider or database and is not a preflight pass.
- No database/schema code changed, so no database-backed suite or database
  connection was needed or run. No commit, push, PR, deployment, production/
  shadow access, database mutation, Stripe operation, shadow-05 resource, or
  Slice 3 work was performed.

### 3 August 2026 — PR #342 merged; shadow-05 resource handover prepared

- Verified PR #342 merged to `main` as
  `0c496b0baafc71afbda444afeefafd4eead59a29` at 16:34:01 UTC.
- Verified GitHub syntax/encoding and Playwright CI completed successfully. All
  connected Vercel status checks reported success; these deployment statuses do
  not constitute a shadow-05 identity pass or Slice 2 acceptance.
- Fast-forwarded local `main` to the exact merge and created the documentation-
  only `codex/simon-shadow05-resource-handover` branch from it.
- Reverified both protected LF-normalised SHA-256 values exactly; neither
  protected document changed.
- Updated the mutable status, evidence, PR inventory, known blocker, detailed
  path, and next-session handover. Steps 8 and 9 are now recorded as merged
  implementation prerequisites; step 10 is the only next scope.
- No shadow-05 resource was created, no provider/database preflight was run,
  and no production data, schema, seed, Stripe operation/resource, payout,
  refund, transfer, Connect action, Slice 3 work, commit, push, or PR was
  performed in this documentation handover.

### 3 August 2026 — Step 10 provider creation blocked before resources

- Re-read `AGENTS.md`, `CLAUDE.md`, this complete log, both protected Simon
  documents, and the relevant Stripe Connect, shadow-auth, identity-preflight,
  return-URL, and focused test artifacts before provider work.
- Independently verified remote `main`, local `main`, the handover branch, and
  PR #342 merge at `0c496b0baafc71afbda444afeefafd4eead59a29`.
- Reverified the protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Preserved this uncommitted log update on
  `codex/simon-shadow05-resource-handover` and produced the required secret-safe
  resource/configuration plan before any create attempt.
- Installed and used the Vercel and Neon Postgres plugins. Exact-name checks
  found no existing `cc-simon-s2-shadow-05` project in either provider.
- The connected Neon organisation is managed by Vercel. Two provider-mediated
  Neon project-create attempts were rejected before creation with the sanitised
  restriction `action restricted; organization is managed by Vercel`; a fresh
  exact-name inventory check still returned zero projects.
- The installed Vercel plugin exposes deployment and read-only project tooling,
  but not Marketplace/Storage provisioning or project environment-variable
  mutation. No raw Vercel/Neon API, CLI, older-shadow lookup, or other unsafe
  workaround was attempted. No Vercel project was created to avoid an orphan.
- No identity preflight was run because the required provider identities do not
  exist. Therefore no fingerprint exists, and both resource and Checkout
  approvals remain false by contract.
- No deployment, database connection/query/mutation, schema apply, seed,
  production access/configuration, Stripe operation/resource, Slice 3 work,
  commit, push, or PR was performed.

### 3 August 2026 — Step 10 resumed through Vercel Marketplace

- The owner explicitly authorised the Vercel CLI and Vercel Marketplace for
  Step 10 only, including creation of the fresh Vercel-managed Neon resource
  and project environment configuration.
- Used ephemeral pinned Vercel CLI `58.4.4`; authentication resolved to the
  expected CoachCarter Vercel account/team. Marketplace category and storage
  discovery confirmed the explicitly requested Neon integration.
- Reverified remote/local baseline
  `0c496b0baafc71afbda444afeefafd4eead59a29`, both protected LF-normalised
  hashes, the preserved uncommitted handover log, and zero pre-existing exact
  Vercel project matches.
- Created fresh isolated Vercel project `cc-simon-s2-shadow-05` with provider
  ID `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`.
- Created a detached temporary worktree at the exact reviewed merge. Vercel
  linking generated a temporary local environment file and `.gitignore` edit;
  the environment file was deleted without being read or printed, and the
  worktree was restored clean at the exact commit before any deployment.
- Requested a fresh Neon Free resource in London, production-scoped only to
  the isolated project, with Neon Auth disabled and local environment pulling
  disabled. On the owner browser page, the provider warned that proceeding
  would upgrade the plan at installation level and then displayed a creation
  error. No retry or plan change was attempted because that shared-installation
  effect is outside Step 10 authority and could cross the production boundary.
  An exact post-attempt integration inventory found zero
  `cc-simon-s2-shadow-05` Neon resources.
- No deployment, database connection/query/mutation, schema apply, seed,
  production access/configuration, Stripe operation/resource, identity
  fingerprint, Slice 3 work, commit, push, or PR was performed. Both resource
  and Checkout approvals remain false.

### 3 August 2026 — isolated Neon boundary created; deployment stopped

- The owner explicitly authorised creation of the separate Neon organisation.
  Created independent organisation `cc-simon-shadow-isolated` with provider ID
  `org-fancy-forest-47074420` on the Free plan. It contained zero projects and
  was separate from the Vercel-managed organisation.
- Created exactly one fresh Neon project `cc-simon-s2-shadow-05`, provider ID
  `shiny-bonus-66942766`, in provider region `aws-eu-west-2` (London), Postgres
  18, with Neon Auth disabled. Provider control-plane evidence identified
  default branch `br-empty-cell-za5kh6nr`, read-write endpoint
  `ep-frosty-truth-zatfdzrb`, provider-generated pooled endpoint host
  `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, and database
  `neondb`. No credential or raw provider payload was retained.
- Stopped before Vercel configuration or deployment because the exact baseline
  requires `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST` to equal runtime `VERCEL_URL`
  and the Vercel deployment API URL. Vercel's official system-variable
  documentation defines `VERCEL_URL` as the generated deployment URL, while
  its environment-variable documentation states that changes apply only to new
  deployments. The repository contains no reviewed same-deployment bootstrap
  for that circular dependency. A project alias, label, or prior deployment
  host would violate the explicit identity stop condition.
- No Vercel environment variable or secret was configured; no Vercel deployment,
  database query/mutation, schema apply, seed, production access/configuration,
  Stripe operation/resource, API key, identity fingerprint, Slice 3 work,
  commit, push, or PR was performed. The identity preflight was not run because
  the required exact deployment identity was not available.
- `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remain the only safe post-stop approval
  state; the completed fresh-resource creation authority does not imply any
  schema, seed, payment, or later-step authority.

### 3 August 2026 — PR #343 deployment-host repair merged

- Repository/GitHub-verified PR #343 merged to `main` at 18:44:07 UTC as
  `a8f9f2afb1b9c311720047ce921e17e439ab0a9a`; refreshed remote `main` resolves
  to that exact commit. Local `main` and this preserved handover branch remain
  at `0c496b0…` with this project log as their only uncommitted change.
- The merged repair lets the deployed application use runtime `VERCEL_URL` only
  when no custom deployment host is configured. A present custom host remains
  authoritative and mismatches fail closed. The operator verifier still
  requires the exact provider-derived post-deployment host and independently
  compares application, Vercel, Neon, active connection, and direct read-only
  database evidence.
- The PR record reports 198 syntax files, 32/32 identity/return-URL tests,
  31/31 focused shadow/payment/rollout regressions, and 14/14 executable Slice 2
  checks with terminal status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- This log update records the merge only. Step 10 was not resumed: no Vercel or
  Neon configuration, deployment, credential/API-key creation, database query
  or mutation, schema apply, seed, production access/configuration, Stripe
  operation/resource, identity fingerprint, Step 11–18, or Slice 3 action was
  performed. Separate explicit Step 10 resume authority is still required.

### 3 August 2026 — Step 10 identity revalidation; credential create deferred

- The owner explicitly authorised resuming Step 10 only against the existing
  fresh `cc-simon-s2-shadow-05` Vercel and Neon resources using exact merge
  `a8f9f2afb1b9c311720047ce921e17e439ab0a9a`. The authority excluded additional
  resources, schema, seeding, Stripe activity, production access, Steps 11–18,
  commits, pushes, and PRs.
- Created a clean detached deployment worktree at the exact authorised merge
  and confirmed refreshed remote `main` resolves to the same commit. Both
  protected LF-normalised SHA-256 values matched exactly:
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  The original `codex/simon-shadow05-resource-handover` worktree remains at
  `0c496b0…` with this project log as its only uncommitted change.
- Independently reverified existing Vercel team
  `team_DXEEAusHmjcfcr6auPjqloL0`, project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, and project name
  `cc-simon-s2-shadow-05`. The project still had zero deployment hosts.
- Independently reverified isolated Neon organisation
  `org-fancy-forest-47074420`, project `shiny-bonus-66942766`, default branch
  `br-empty-cell-za5kh6nr`, read-write endpoint `ep-frosty-truth-zatfdzrb`,
  control-plane host
  `ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech`, pooled active
  connection host
  `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, and database
  `neondb`. The active connection target contained provider credentials, but
  they were not printed, retained in the log, or exposed in tool output.
- Produced the secret-safe configuration plan before mutation: production
  scope on the isolated Vercel project only; shadow operations enabled;
  Vercel/Neon/school `1` identity fields exact; `STRIPE_MODE=test`; existing
  database credential and a fresh shadow preflight bearer secret treated as
  secrets; and no Vercel-side
  `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST`, so the reviewed runtime bootstrap can
  use provider `VERCEL_URL`. The independent verifier must receive the exact
  provider-derived deployment host after deployment.
- Linked the detached exact-baseline worktree to the existing Vercel project.
  The CLI generated a local `.env.local` credential file and appended an ignore
  rule; the credential file was deleted without being read or printed, the
  ignore file was restored byte-equivalent to the commit, and the detached
  worktree was reverified clean at the exact merge.
- Reached the Neon account-settings form for a verifier-only personal API key
  named `cc-simon-s2-shadow-05-identity-preflight` and stopped before the final
  **Create** action for action-time confirmation. The owner chose to defer the
  create and the rest of Step 10 to a new chat session. No API key was created;
  the next session must reinspect current provider state and ask for fresh
  confirmation immediately before creating it.
- No Vercel environment variable or secret was configured; no deployment,
  application request, database query or mutation, identity preflight, schema
  apply, seed, production access/configuration, Stripe operation/resource,
  Step 11–18, Slice 3 action, commit, push, or PR was performed.
  `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remain in force. No identity fingerprint
  exists yet.

### 3 August 2026 — Step 10 exact deployment; identity preflight blocked

- Reverified remote `main` and the detached deployment worktree at exact merge
  `a8f9f2afb1b9c311720047ce921e17e439ab0a9a`, the correct linked Vercel
  project/team IDs, absence of `.env.local`, both protected LF-normalised
  hashes, the original `0c496b0…` handover baseline, and the fresh provider
  inventory recorded above.
- The Neon personal-key form offered no scoped or read-only control. After the
  owner accepted that limitation and supplied action-time confirmations, two
  unusable same-named capture attempts were revoked. A final single active
  personal API key named `cc-simon-s2-shadow-05-identity-preflight` was then
  created and held only as an operator input. No key value was printed or
  retained in the repository or this log. Do not create another verifier key.
- Configured only the isolated Vercel project's Production environment with the
  approved shadow-operation, exact Vercel/Neon/school identity, `STRIPE_MODE`,
  active database-connection, and fresh bearer-secret variables. The database
  URL and bearer secret were stored as sensitive values. No Vercel-side
  `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST` was configured, and no CoachCarter
  production project or configuration was accessed.
- Deployed only the clean detached exact-merge worktree with pinned Vercel CLI
  `58.4.4`. Vercel independently reports exactly one deployment:
  `dpl_6oUNe2Niuuf5HmvDq8QRpxnKCjVz`, READY, target `production`, project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, provider host
  `cc-simon-s2-shadow-05-9h8txzygx-coachcarteruk-2599s-projects.vercel.app`,
  and Git SHA `a8f9f2afb1b9c311720047ce921e17e439ab0a9a`.
- The first local command launch stopped before verifier code because the clean
  worktree had no installed packages. Installed only lockfile-pinned local
  dependencies, then reran the exact command
  `npm run preflight:stripe-launch-shadow-identity` with its built-in
  `--read-only` argument.
- The verifier returned `STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING` for
  `neon.endpoint_host` before any application request, Vercel or Neon
  control-plane request, separate database connection, transaction, or
  `SELECT current_database()`. Repository inspection confirmed the exact merge
  accepts only one label before `.aws.neon.tech`, while the required provider
  host contains `.c-2.eu-west-2.aws.neon.tech`. No fingerprint or identity pass
  exists.
- During Vercel secret configuration, the existing shadow database credential
  was unintentionally rendered in private tool output. Its value is not
  repeated or retained here. Treat it as exposed and rotate it before future
  use. This and the malformed-host stop condition end the authorised session;
  no validator repair, different-source deployment, credential rotation, or
  preflight retry was authorised.
- No schema, migration, seed, school/admin/learner/instructor/configuration/
  availability/agreement data, Stripe API/resource, Checkout, payment, refund,
  payout, transfer, Connect account, webhook, Steps 11–18, Slice 3, commit,
  push, or PR action was performed. `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remain in force.

### 3 August 2026 — next-chat repair authority handover prepared

- The owner requested a durable project-log update and a copy-ready next-chat
  prompt carrying explicit authority for the narrowly scoped Step 10 repair.
- Updated the next-session section to require rotation of only the exposed
  shadow-05 database credential, replacement of the cleared shadow bearer
  secret, a minimal current-Neon-hostname validator repair with focused
  fail-closed tests, an exact reviewed repair commit, isolated shadow-05
  deployment, reuse of the existing verifier key, and the independent
  read-only identity preflight.
- The prepared authority also permits revocation of the one-time verifier key
  after the first exact pass. It does not authorise another API key or provider
  resource, schema, seed, CoachCarter production access/configuration, Stripe
  action/resource, Step 11–18, Slice 3, or unrelated code change.
- This handover update is documentation-only. No provider, credential, code,
  deployment, database, Stripe, commit, push, PR, or merge action was performed
  in this session. Both approval flags remain false and no identity fingerprint
  exists.

### 3 August 2026 — Step 10 hostname repair implemented and locally verified

- Preserved the complete uncommitted handover, fast-forwarded local `main` to
  exact remote merge `a8f9f2afb1b9c311720047ce921e17e439ab0a9a`, and created
  `codex/simon-shadow05-neon-host-repair` from that exact commit. The protected
  LF-normalised product-specification and technical-plan hashes still match.
- Independently reverified the expected repository remote and ancestry. The
  current Vercel control plane reports the exact existing team/project, one
  READY production-target deployment from `a8f9f2a…`, and no second deployment.
  The Neon control plane reports the exact isolated organisation, one expected
  project, and the expected default branch. The Neon account UI shows exactly
  one personal verifier key named
  `cc-simon-s2-shadow-05-identity-preflight`.
- Made one validator change: an optional `c-<positive integer>` provider cell
  label may appear before the existing region and `aws|azure.neon.tech`
  suffix. No Vercel, database, tenant, provider-comparison, or authentication
  check changed.
- Added focused acceptance for the current direct and pooled AWS hosts plus the
  existing direct/pooled AWS and direct Azure formats. Added rejection coverage
  for invalid cell labels, wrong cloud/domain, suffix injection, whitespace,
  credentials, ports, paths, and unrelated hosts.
- `npm run check:syntax` passed all 198 files. Identity/return-URL tests passed
  47/47; shadow-operation/payment-contract/rollout-review regressions passed
  31/31; and `npm run review:stripe-launch-slice-2` kept all 14/14 checks true
  with terminal status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- No credential, Vercel configuration, deployment, database query/mutation,
  schema, seed, Stripe operation/resource, Step 11–18, or Slice 3 action was
  performed. The exposed shadow database credential still requires rotation,
  no identity fingerprint exists, and both approval flags remain false.

### 3 August 2026 — Step 10 repair merged and exact deployment READY

- Committed the narrowly scoped repair as
  `b0bbdfa35aa0ae806c75acaa4159502c0780560f`, pushed
  `codex/simon-shadow05-neon-host-repair`, opened PR #344, and verified the
  exact three-file diff and all required GitHub and Vercel checks. PR #344 was
  marked ready and merged as
  `6635b8f786730f04c8b981d0e437dcff81231220`; refreshed `origin/main`
  reports that exact merge with authorised ancestor `a8f9f2a…`.
- Rotated only the existing shadow-05 Neon database role credential. The first
  reset's one-time result was not securely captured and was immediately
  invalidated by a second reset of the same role; only the second credential is
  current. No credential or connection string was printed or retained.
- Updated only the isolated Vercel project's Production `POSTGRES_URL` with the
  final rotated credential and replaced only its Production
  `STRIPE_LAUNCH_SHADOW_CRON_SECRET` with a fresh strong secret. Confirmed that
  `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST` remains absent. No CoachCarter
  production project or configuration was accessed.
- Deployed a clean detached worktree at exact reviewed merge `6635b8f…` with
  pinned Vercel CLI `58.4.4`. Vercel control-plane evidence reports project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, deployment
  `dpl_CTmfmHhBbjDrNFwNmnrnuq73D3cX`, READY, target `production` inside the
  isolated shadow project, provider host
  `cc-simon-s2-shadow-05-dr75zu1wu-coachcarteruk-2599s-projects.vercel.app`,
  and exact Git SHA `6635b8f786730f04c8b981d0e437dcff81231220`.
- Reverified exactly one active personal verifier key named
  `cc-simon-s2-shadow-05-identity-preflight`; its provider record reports it has
  never been used. The one-time key value from the prior operator session is
  not available in the current secure session. Neon exposes only **Revoke key**
  for the existing record, with no reveal or regenerate action. Creating or
  replacing a key is outside authority, so the exact preflight was not run and
  the existing key was not revoked.
- This is an action-input blocker only: no identity mismatch, further secret
  exposure, application request, Neon/Vercel verifier request, separate direct
  database query, identity fingerprint, schema, migration, seed, Stripe API or
  resource operation, Step 11–18, or Slice 3 action occurred. Both
  `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remain in force.

### 3 August 2026 — replacement verifier created; launcher stopped before preflight

- The owner explicitly authorised revocation of the unavailable existing Neon
  verifier key and creation of exactly one replacement. Revoked the old
  `cc-simon-s2-shadow-05-identity-preflight` record, confirmed it was absent,
  created one same-named replacement, and confirmed exactly one active matching
  record. The new value was captured only in ephemeral browser memory; it was
  not rendered, printed, written to disk, or retained in this log. The browser
  clipboard was cleared.
- The first command launcher stopped before provider or database preflight work
  because the browser's protected clipboard did not cross into the shell. It
  did not invoke `npm run preflight:stripe-launch-shadow-identity`.
- Used a single-use loopback-only in-memory handoff for the replacement key. The
  listener accepted one local connection, never wrote the key to disk, and
  cleared its variables and environment before closing. The browser-side key
  variable was cleared immediately after successful delivery.
- The launcher refreshed the authenticated Vercel session and found exactly one
  Production `POSTGRES_URL` record and exactly one Production
  `STRIPE_LAUNCH_SHADOW_CRON_SECRET` record on the isolated project. Before the
  verifier command, its secret-safe target guard found that the retrieved
  values did not reproduce the required pooled database host/path plus minimum
  bearer-secret contract. The guard returned only the sanitised blocker
  `Isolated Production verifier input identity mismatch` and stopped.
- Per the explicit stop condition, no retry, further provider request, value
  inspection, configuration mutation, or key lifecycle action followed. The
  exact npm preflight was not invoked; there was no application identity
  request, Neon/Vercel verifier request, separate database connection or query,
  fingerprint, schema, seed, Stripe operation/resource, Step 11–18, or Slice 3
  action. The single replacement key remains active but its one-time value is
  no longer retained. Both approval flags remain false.

### 3 August 2026 — exact preflight reached providers; stopped on Neon endpoint mismatch

- The owner supplied fresh authority to diagnose and repair only the isolated
  shadow-05 Step 10 verifier inputs and replace unrecoverable verifier keys. No
  authority was extended to CoachCarter production, schema, seed, Stripe
  operations/resources, Step 11–18, or Slice 3.
- Diagnosed the earlier launcher guard without printing values. The default
  Vercel CLI OAuth refresh credential had rotated and become unusable. Created
  a separate temporary official pinned-CLI OAuth store, verified its token was
  current, used it only for this verifier, and securely deleted the exact
  temporary directory after the stop.
- Rotated only the existing `neondb_owner` role as required to keep the active
  direct verifier input known without retrieving stored secrets. Replaced only
  the isolated Vercel project's Production `POSTGRES_URL` and shadow bearer
  secret, then redeployed the reviewed merge through Vercel's exact-deployment
  redeploy control. Intermediate one-time credentials and uncaptured verifier
  keys were invalidated; no secret was rendered, printed, written into the
  repository, or retained in this log.
- Vercel independently reports final deployment
  `dpl_AGqHtPx4guea8czTijnvgymLyBVE`, READY, target `production` inside project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, provider host
  `cc-simon-s2-shadow-05-ecezvj7dx-coachcarteruk-2599s-projects.vercel.app`,
  source `redeploy`, original deployment
  `dpl_DwezuSnBujaGV5VhjTURy4cutrBr`, and exact Git SHA
  `6635b8f786730f04c8b981d0e437dcff81231220`.
- The first two exact npm verifier runs against the final deployment failed
  closed with `STRIPE_LAUNCH_SHADOW_IDENTITY_PROVIDER_REJECTED`. Status-only
  Node diagnostics isolated the rejection to the application route: Node
  received 401, while the Vercel deployment API and all three Neon control-plane
  endpoints returned 200. The cause was Vercel Deployment Protection intercepting
  the provider-generated deployment URL before the shadow bearer reached the
  route.
- Confirmed the isolated project initially had zero protection-bypass entries.
  A first generate request using a disallowed special-character shape was
  rejected before creation. Created exactly one corrected 32-character
  temporary automation bypass with note
  `cc-simon-s2-shadow-05-identity-preflight`; Node then received 200 from the
  protected application identity route using the verifier's already-reviewed
  `x-vercel-protection-bypass` header support.
- Ran the exact command
  `npm run preflight:stripe-launch-shadow-identity`. With the temporary bypass,
  it reached application runtime evidence, Vercel control-plane evidence, Neon
  control-plane evidence, the active pooled connection target, and the separate
  database-enforced read-only connection. It then failed closed with
  `STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH` for exactly
  `provider.neon.endpoint_host`. No identity pass or fingerprint exists.
- Stopped on that exact identity mismatch without diagnosis or retry. Revoked
  the temporary Vercel automation bypass and verified zero bypass entries
  remained. Revoked the one Neon verifier key and verified it was absent. Cleared
  all browser, process, environment, clipboard, and loopback-held credential
  material and removed the temporary OAuth store.
- No schema, migration, seed, school/admin/instructor/learner/configuration/
  availability/agreement data, Stripe API/resource, Checkout, payment, refund,
  payout, transfer, Connect account, webhook, Step 11–18, or Slice 3 action was
  performed. `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remain in force.

### 4 August 2026 — endpoint repair exact deployment READY; Vercel OAuth blocked preflight

- Verified PR #345 merged as squash commit
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8` from reviewed head
  `4c303c7bff6313709e05a1a99664de2982907df3` and base
  `6635b8f786730f04c8b981d0e437dcff81231220`. The merge tree is identical to
  the reviewed head, only the verifier and its focused test differ from base,
  and every reported GitHub/Vercel check passed.
- The root cause was the verifier treating Neon's deprecated
  `pooler_enabled:false` response field as proof that no pooled hostname exists.
  Current provider evidence supplies the direct endpoint host plus endpoint ID,
  while pooling is selected by inserting `-pooler` in that exact host label.
  The repair derives a pooled candidate only when the exact endpoint ID equals
  the direct host's first label, retaining fail-closed project/branch/host
  equality. The provider-shaped false-flag regression passes and a mismatched
  endpoint ID still fails on `provider.neon.endpoint_host`.
- Focused verification passed: 48 identity/return-URL tests, 31 shadow-operation/
  payment-contract/rollout tests, syntax checks for all 198 files, and all 14
  Slice 2 static review checks with terminal status
  `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. Protected-document hashes remained
  unchanged.
- Deployed a detached exact-merge worktree with pinned Vercel CLI `58.4.4`.
  Discarded the first build as acceptance evidence because Vercel recorded a
  dirty marker caused only by temporary `.gitignore` line endings. Final clean
  deployment `dpl_D2UDrPkiKN6sTuKZSaLVQGc2Zyu2` is READY on the isolated
  Production target at provider host
  `cc-simon-s2-shadow-05-50txkjluh-coachcarteruk-2599s-projects.vercel.app`,
  with exact Git SHA `d911c898…` and no dirty marker.
- Confirmed all required isolated Production environment records exist as
  encrypted values, the current Neon compute still maps direct host
  `ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech` to pooled host
  `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, and both
  temporary inventories initially contained zero matching entries.
- Created one same-named temporary Neon verifier key and captured its one-time
  value only in browser memory. A loopback-only launcher received it, but the
  default Vercel CLI bearer was rejected with HTTP 403 before bypass creation
  or npm invocation. The key was immediately revoked and both inventories were
  reverified at zero.
- While diagnosing that stale bearer, a PowerShell formatting mistake rendered
  the default Vercel CLI access and refresh credentials in private tool output.
  They are not reproduced here. The session was immediately logged out, and
  the exact local auth file was removed so the rendered material is neither
  active nor retained on disk.
- Attempted a fresh official pinned-CLI OAuth session in an isolated temporary
  store. The signed-in Vercel device page showed the correct CLI request but
  kept `Allow` disabled, including after one state-preserving reload. Stopped
  without forcing the control or creating a broader personal API token, killed
  the login process, and removed the exact temporary OAuth directory.
- The exact `npm run preflight:stripe-launch-shadow-identity` command was not
  invoked in this session, so there is no new terminal verifier status or
  fingerprint. No temporary Neon key or Vercel bypass remains. No database
  query/mutation, schema, migration, seed, Stripe API/resource, Checkout,
  payment, refund, payout, transfer, Connect account, webhook, Step 11–18, or
  Slice 3 action was performed. Both approval flags remain false.

### 4 August 2026 — owner-assisted Vercel login restored; sensitive inputs remain blocked

- The owner completed a fresh Vercel CLI device login. Status-only checks
  confirmed user `coachcarteruk-2599`, exact isolated project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, zero existing protection bypasses, and a
  fresh direct bearer response of HTTP 200. Final clean deployment
  `dpl_D2UDrPkiKN6sTuKZSaLVQGc2Zyu2` remained READY with exact Git SHA
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8` and no dirty marker.
- Created one replacement Neon verifier key only after confirming zero matching
  records. Its value remained in browser/process memory and the clipboard was
  cleared. The guarded launcher created exactly one 32-character Vercel
  automation bypass, but Vercel's `env run` completed only its environment
  loading phase and did not execute the child npm command. The key still
  reported `Last used: never`, proving no Neon control-plane call occurred.
  The bypass was revoked in the launcher's `finally` block and verified at
  zero; the unused key was then revoked and verified absent. This was not a
  terminal verifier result and was not treated as a retry.
- A clean isolated `env run` probe then proved that required sensitive
  Production variables were not injected. The official Vercel v10 environment
  list reported one Production `POSTGRES_URL` record with type `sensitive`,
  `decrypted:false`, and no returned value. `decrypt=true` on the list and the
  documented v1 per-variable decrypt endpoint also returned no decrypted value.
  The repository's pre-existing `.env.local` contains `POSTGRES_URL` but none
  of the shadow identity variables or shadow bearer; it was read only for key
  presence and was not modified.
- Stopped because the exact verifier needs both the active pooled direct
  database URL and the deployed route's shadow bearer. Reconstructing or
  guessing either value is prohibited. Rotating the existing shadow Neon role
  and replacing the isolated project's two Production sensitive variables are
  outside the supplied provider authority. The exact npm preflight was not
  invoked, no fingerprint exists, and no temporary Neon key or Vercel bypass
  remains.
- Removed the temporary non-secret runner. No database query/mutation, schema,
  migration, seed, Stripe API/resource, Checkout, payment, refund, payout,
  transfer, Connect account, webhook, Step 11–18, or Slice 3 action was
  performed. Both approval flags remain false.

### 4 August 2026 - shadow-05 identity preflight passed; temporary access revoked

- The owner explicitly authorized resetting only shadow-05's existing Neon
  database-role credential, replacing only the isolated Vercel project's
  Production `POSTGRES_URL` and `STRIPE_LAUNCH_SHADOW_CRON_SECRET`, deploying
  exact merge `d911c89868eebe86a08a757b22ed6e3524cd5fe8`, running the identity
  preflight once, revoking temporary access, and stopping. No Step 11 or Stripe
  resource authority was supplied.
- Reconfirmed the exact boundaries before mutation: Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, Neon project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, role
  `neondb_owner`, pooled endpoint
  `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, database
  `neondb`, one sensitive Production record for each authorized variable, and
  zero initial Vercel protection bypasses and matching Neon verifier keys.
- Reset only `neondb_owner`. The first reset succeeded but its one-time
  credential was lost when a local guarded-launcher error formatter failed
  before either Vercel variable changed. A subsequent UI reset credential and
  an initial temporary Neon key were rendered in private automation traces;
  each was treated as exposed and invalidated immediately. The final same-role
  reset credential and replacement verifier key were captured only in memory,
  with the clipboard cleared. No other Neon role, branch, database, endpoint,
  schema, or data was changed.
- Replaced the existing sensitive Production `POSTGRES_URL` and
  `STRIPE_LAUNCH_SHADOW_CRON_SECRET` records only. Provider metadata confirms
  exactly one sensitive Production record remains for each key, updated at
  `1785823251725` and `1785823345242` respectively. No value is recorded here.
- Deployed the clean detached merge with pinned Vercel CLI `58.4.4`. Independent
  Vercel evidence reports deployment `dpl_ELTwjwU1yvbuiTHonJjZomjivaWN`, READY,
  target `production`, project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, provider
  host
  `cc-simon-s2-shadow-05-n6pepjew7-coachcarteruk-2599s-projects.vercel.app`,
  exact Git SHA `d911c89868eebe86a08a757b22ed6e3524cd5fe8`, and no dirty marker.
- Created exactly one temporary 32-character Vercel automation bypass with note
  `cc-simon-s2-shadow-05-identity-preflight`, then invoked the exact command
  `npm run preflight:stripe-launch-shadow-identity` once. It returned `PASSED`
  for school `1`, exact Vercel and Neon identities, database-enforced
  `transaction_read_only:true`, and identity fingerprint
  `sha256:c94c4cc0c3ceaaf24f8401dd8a23e55ba3c26343bda0b3e3ab4a688162aa3127`.
  Both `approved_to_create_resources:false` and
  `approved_to_create_checkout:false` remained false.
- The launcher's first bypass cleanup request omitted Vercel's required
  `regenerate:false` field and therefore did not revoke the entry. The official
  current request contract was loaded, the same single matching entry was
  revoked with `regenerate:false`, and the final project inventory was verified
  at zero. The final Neon verifier key was revoked and verified absent; browser
  memory, process environment, loopback payloads, and clipboard-held credential
  material were cleared.
- Stopped after the first identity PASS. No schema, migration, seed,
  school/admin/instructor/learner/configuration/availability/agreement data,
  Stripe API/resource, Checkout, payment, refund, payout, transfer, Connect
  account, webhook, Step 11-18, or Slice 3 action was performed.

### 4 August 2026 - Step 11 fresh-task handoff prepared

- Updated the mutable status table, completed Step 10 record, current blocker,
  and next-session section to reflect the accepted shadow-05 identity evidence
  and the transition to Step 11.
- Recorded a copy-ready, schema-only authority prompt for a fresh task. It
  authorises zero-table proof, one exact aggregate apply, sanitised schema
  counts, and explicit `instructors.is_admin` verification only. It requires a
  stop before any retry, credential lifecycle action, Vercel change, provider
  resource creation, seeding, Stripe call, Step 12, later step, or Slice 3.
- This handoff-preparation session performed no provider query or mutation,
  schema apply, seed, credential action, Stripe operation/resource, Checkout,
  payment, webhook, refund, payout, transfer, Connect account, Step 11, Step 12,
  later step, or Slice 3 action.

### 4 August 2026 - Step 11 blocked at connected prepared-statement boundary

- Re-read the complete required worker rules, protected Simon product
  specification and technical plan, Stripe Connect reference, and this living
  log. Reverified the protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Proved exact source merge
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8`, identical reviewed/merge tree
  `d0ef8bf30df3bc0a875113e84cc6bdbf0a6bbeec`, and exact aggregate Git blob
  `18ba0b92450931e3af8f3803ebcab019b73b9709` (430434 bytes; SHA-256
  `9fe0ab57f495930c6a08982f8fecc89af9dbe7dbf9df21211bb9beb5b759cf77`).
- Independently reconfirmed Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, accepted READY Production deployment
  `dpl_ELTwjwU1yvbuiTHonJjZomjivaWN`, provider host
  `cc-simon-s2-shadow-05-n6pepjew7-coachcarteruk-2599s-projects.vercel.app`,
  and exact Git SHA `d911c898…`. Reconfirmed Neon project
  `shiny-bonus-66942766`, default branch `br-empty-cell-za5kh6nr`, read-write
  endpoint `ep-frosty-truth-zatfdzrb`, pooled host
  `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, and database
  `neondb` through the existing OAuth-connected Neon access.
- Before any apply submission, both a direct catalog count and Neon's table
  inventory proved zero public base tables; `public.instructors` was absent.
  The retained Step 10 evidence still records zero final Neon verifier keys and
  Vercel bypasses. No verifier credential was present in the process
  environment, and no temporary access or provider resource was created.
- The connected transaction executor rejected the exact aggregate because it
  cannot insert multiple commands into one prepared statement. A second
  statement-array transaction, used only after an independent zero-table proof
  established the first rejection was a definite no-op, was rejected at the
  same prepared-statement boundary. No DDL committed in either transaction.
- Stopped without another apply route. Final independent catalog and provider
  table-list reads still report zero public base tables, no
  `public.instructors`, and an empty table inventory. Therefore no sanitised
  post-schema counts or `instructors.is_admin` contract can be claimed and Step
  11 remains blocked rather than completed.
- No credential was reset, revealed, written, or retained; no Vercel
  configuration or provider resource changed; no temporary local artifact was
  created; and no school/admin/instructor/learner/availability/config/agreement
  seed, Stripe call/resource, Checkout, payment, webhook, refund, payout,
  transfer, Connect account, Step 12, later step, Slice 3, production access,
  staging, commit, push, or PR action occurred.

### 4 August 2026 - Step 11 aggregate applied once through Neon Console

- The owner separately authorized the existing Neon Console SQL Editor path
  for Step 11 only. The authenticated console independently showed project
  `shiny-bonus-66942766` (`cc-simon-s2-shadow-05`), organisation
  `org-fancy-forest-47074420`, production branch
  `br-empty-cell-za5kh6nr`, endpoint `ep-frosty-truth-zatfdzrb`, and database
  `neondb`. No credential, API key, bypass, connection string, or provider
  resource was created or exposed.
- Before the one Run action, the Console SQL Editor returned database `neondb`,
  zero public base tables, and `public.instructors` absent. This independently
  reconfirmed that the earlier connected prepared-statement rejections were
  definite no-ops and the target remained genuinely empty.
- Reverified the exact reviewed aggregate as Git blob
  `18ba0b92450931e3af8f3803ebcab019b73b9709`, 430434 source bytes, SHA-256
  `9fe0ab57f495930c6a08982f8fecc89af9dbe7dbf9df21211bb9beb5b759cf77`.
  The browser editor normalized only CRLF line endings to LF; a full editor
  select/copy comparison matched the derived 423039-byte LF-normalized source
  exactly with SHA-256
  `6e4964ee1324f156539486941c9bf28e846d536907c0fca71f0f581fba54bf7a`.
  The temporary browser clipboard content was cleared before execution.
- Invoked **Run** exactly once. Neon parsed 956 statements, completed with zero
  progress/incomplete tabs, all 956 result tabs enabled, no error alert/result,
  and the editor returned to the Run-ready state. No second Run or retry was
  performed.
- Read-only postflight retained only sanitised schema counts: 120 public base
  tables, 0 views, 0 materialized views, 89 sequences, 580 indexes, 37 public
  functions, 108 non-internal public triggers, 2191 public constraints, and
  1612 public columns. Core sentinels `schools`, `instructors`,
  `payout_funding_sources`, `lesson_payment_contracts`, `payout_runs`, and
  `instructor_payout_batches` are present, as is final aggregate function
  `stripe_launch_guard_payout_source_update()`.
- Explicit `instructors.is_admin` proof passed: exactly one column, PostgreSQL
  `data_type='boolean'`, `udt_name='bool'`, `column_default='false'`, and
  `is_nullable='YES'`, matching the reviewed historical
  `BOOLEAN DEFAULT FALSE` contract.
- Step 11 is complete and Step 12 remains unauthorized. No separate seed,
  school/admin/instructor/learner/availability/config/agreement fixture,
  application route, credential/configuration change, Stripe call/resource,
  Checkout, payment, webhook, refund, payout, transfer, Connect account, later
  step, Slice 3, CoachCarter production access, staging, commit, push, or PR
  action occurred.

### 4 August 2026 - Step 12 preflight passed; fixture blocked before mutation

- The owner explicitly authorized Step 12 only: minimum school-1 fixture setup
  through existing supported application routes, independent read-only database
  verification, living-log update, cleanup, and stop. Direct SQL writes,
  unsupported scripts, credential exposure, Stripe activity, and later steps
  remained prohibited.
- Re-read `AGENTS.md`, `CLAUDE.md`, both complete protected Simon documents,
  `docs/stripe-connect.md`, and this complete living log. Reverified the
  protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Reconfirmed Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, READY
  Production deployment `dpl_ELTwjwU1yvbuiTHonJjZomjivaWN`, provider host
  `cc-simon-s2-shadow-05-n6pepjew7-coachcarteruk-2599s-projects.vercel.app`,
  and exact deployed Git SHA
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8`. Reconfirmed Neon project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, read-write endpoint
  `ep-frosty-truth-zatfdzrb`, direct and pooled provider hosts, region
  `aws-eu-west-2`, and database `neondb`. The retained accepted identity
  fingerprint remains
  `sha256:c94c4cc0c3ceaaf24f8401dd8a23e55ba3c26343bda0b3e3ab4a688162aa3127`;
  the one-shot preflight was not rerun.
- A single sanitised read-only database preflight reproduced the exact Step 11
  evidence: 120 public base tables, 0 views, 0 materialized views, 89 sequences,
  580 indexes, 37 public functions, 108 non-internal public triggers, 2191
  public constraints, and 1612 public columns. `instructors.is_admin` remains
  exactly one `boolean`/`bool` column with default `false` and nullable `YES`.
- The fixture-absence gate passed: school ID 1 is the only school and exists
  exactly once; administrators, instructors, active instructors, availability
  windows, `create-instructor` audit actions, launch configs, other-school
  launch configs, agreements, and active payment-time-valid agreements all
  count zero.
- Route inspection proved supported writers exist for admin creation,
  authenticated instructor creation with its required audit action, audited
  admin impersonation, and instructor availability. The exact deployed source
  contains no application INSERT/UPDATE writer for
  `stripe_connect_launch_configs` or
  `instructor_payout_agreement_versions`. A second read-only database check
  found no instructor trigger and no stored function that inserts either row.
- Stopped before the first fixture mutation because creating the available
  admin/instructor/availability subset would leave Step 12 partially completed,
  while completing the config/agreement subset would require a prohibited
  direct SQL or unsupported path. No application mutation route was invoked and
  no fixture, audit, credential, local temporary artifact, provider setting,
  Stripe object/call, Checkout, payment, webhook, refund, payout, transfer,
  Connect account, later step, Slice 3, commit, push, or PR action occurred.

### 4 August 2026 - Step 12 writer implemented and verified locally only

- The owner authorized the next implementation task after the Step 12 blocker
  was reported. Work started from exact `d911c89868eebe86a08a757b22ed6e3524cd5fe8`
  on local branch `codex/simon-shadow05-fixture-writer`; `HEAD` and
  `origin/main` both resolve to that SHA. The pre-existing uncommitted living-log
  changes were preserved.
- Reverified both protected LF-normalised hashes exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Added the shadow-only authenticated admin action
  `configure-stripe-launch-shadow-fixture`. Its school is auth-derived and must
  exactly match the configured shadow school, test Stripe mode, and exact
  Vercel project. The route requires an explicit confirmation and bounded
  agreement inputs; it makes no Stripe request.
- The transaction locks the operation, verifies one active same-school school,
  admin, and instructor, rejects any existing/partial state or other-school
  launch config, and inserts exactly one `simon_launch_v1` shadow config plus
  one active payment-time-valid agreement. A required audit write occurs in the
  same transaction; audit failure rolls back both rows. Exact command replay is
  idempotent only when the stored actor, instructor, row IDs, fingerprints, and
  agreement terms all match.
- Added focused tests for strict input and runtime gates, exact creation,
  replay, changed-command conflict, partial/other-school state, cross-school
  instructor rejection, audit rollback, and dispatcher safety. Updated the
  explicit Slice 1 schema-consumer allowlist for this reviewed writer.
- Verification passed: 66/66 focused and adjacent Playwright tests, the Slice 2
  rollout review with 14/14 checks and status
  `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, the 199-file syntax scan, the 271-file
  C1 scan, and `git diff --check`.
- This is local implementation evidence only. Nothing was staged, committed,
  pushed, reviewed, deployed, or configured; no shadow-05 route or database was
  accessed; no fixture row, provider setting, credential, Stripe object/call,
  payment, refund, payout, transfer, Connect account, later step, or Slice 3
  action occurred. Step 12 remains blocked before mutation.

### 4 August 2026 - Step 12 writer independently reviewed and hardened

- Re-read the complete required worker rules, protected Simon product
  specification and technical implementation plan, Stripe Connect reference,
  and this complete living log before review. Reverified the protected
  LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Refreshed `origin/main` and proved branch
  `codex/simon-shadow05-fixture-writer`, `HEAD`, `origin/main`, and merge-base
  all resolve to exact authorised baseline
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8`. The complete worktree inventory
  contained only the five authorised paths.
- Reviewed every tracked and untracked line, including the complete pre-existing
  living-log diff. Narrow repairs make the target school come only from the
  authenticated JWT, compare the configured and runtime Vercel environments in
  addition to the exact project/test/shadow gates, verify every stored
  payment-time config/agreement/audit fact on replay, prove rollback when either
  insert or the required audit fails, and prevent raw unexpected errors from
  reaching the client or error alert.
- Fresh verification passed exactly: the required five-file Playwright command
  passed 69/69 with one worker; `npm.cmd run check:syntax` passed 199 files;
  `npm.cmd run check:c1` passed 271 files; and
  `npm.cmd run review:stripe-launch-slice-2` passed all 14/14 checks with status
  `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. `git diff --check` is required again at
  the final publication gate.
- Independent review found no remaining security, tenancy, idempotency,
  atomicity, audit, schema-contract, protected-document, Stripe-call, or
  sensitive-payload blocker within this exact writer scope.
- Staged only the five authorised files, committed them as
  `bfa02f916e933436b51cb78653c2af3d60a8d5c5` with exact parent
  `d911c89868eebe86a08a757b22ed6e3524cd5fe8`, pushed branch
  `codex/simon-shadow05-fixture-writer`, and opened
  [draft PR #346](https://github.com/coachcarteruk-gif/coachcarter-website/pull/346)
  targeting `main`. The PR body records the safety boundaries and the exact
  verification evidence and explicitly grants no deployment or fixture
  authority.
- No deployment, Vercel or Neon configuration, shadow-05 access or mutation,
  fixture row, Stripe client/API call, Checkout, payment, webhook, refund,
  payout, transfer, Connect object, Step 12 execution, Step 13, later step, or
  Slice 3 action was authorised or performed. Step 12 and deployment remain
  explicitly unauthorised.

### 4 August 2026 - Step 12 merged writer deployed; authentication blocker stopped fixture mutation

- Refreshed clean local `main` from `origin/main`, confirmed PR #346 merged as
  `2fde59383dd98432cc8f7cef2f589322cadae260`, and created fresh branch
  `codex/simon-shadow05-step12-fixture`. Before modification, `HEAD`,
  `origin/main`, and merge-base all resolved to that exact merge; staged,
  unstaged, untracked, and branch-diff inventories were empty.
- Re-read the complete required worker rules, protected Simon product
  specification and technical implementation plan, Stripe Connect reference,
  complete updated living log, and merged writer. Reverified the protected
  LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- The exact required command
  `npm.cmd test -- tests/stripe-launch-shadow-fixture.spec.js tests/stripe-launch-shadow-operations.spec.js tests/admin-instructor-access.spec.js tests/stripe-launch-schema-foundation.spec.js tests/stripe-launch-payment-contracts.spec.js --workers=1`
  passed 69/69 tests with one worker. `npm.cmd run check:syntax` passed 199
  files; `npm.cmd run check:c1` passed 271 files; and
  `npm.cmd run review:stripe-launch-slice-2` passed 14/14 checks with terminal
  status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. `git diff --check` passed with
  no diagnostics.
- Deployed only a clean detached worktree at exact merged commit
  `2fde59383dd98432cc8f7cef2f589322cadae260` to existing isolated Vercel
  project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` (`cc-simon-s2-shadow-05`) using
  pinned Vercel CLI `58.4.4`. Sanitised control-plane evidence reports
  deployment `dpl_wMkXMwRFx4S3EWkKfYT3W71vLvFu`, READY, target `production`
  inside the isolated project, provider host
  `cc-simon-s2-shadow-05-8h7d43yra-coachcarteruk-2599s-projects.vercel.app`,
  source `cli`, exact Git SHA `2fde59383dd98432cc8f7cef2f589322cadae260`,
  commit message `Add shadow launch fixture writer (#346)`, and no dirty
  metadata marker. No Vercel or Neon environment, secret, permission, project
  binding, database schema, or migration changed.
- Post-deployment sanitised identity checks reconfirmed Neon project
  `shiny-bonus-66942766` (`cc-simon-s2-shadow-05`), default/primary ready branch
  `br-empty-cell-za5kh6nr`, and database `neondb`. Required isolated Production
  shadow/database gate variable records remain present. A read-only public
  application request to the exact deployment returned an empty school-1
  instructor list, consistent with the independently queried database. The
  one-shot identity preflight was not rerun.
- The first protected-deployment read used `vercel curl`, whose CLI
  automatically generated one automation bypass despite the intended
  read-only scope. It was identified by its exact new timestamp and scope,
  revoked immediately with `regenerate:false`, and the isolated project's
  final protection-bypass inventory was verified at zero. It was not used for
  a fixture mutation and no secret value was printed or retained.
- Step 12 stopped before the first application mutation because the isolated
  project has no `ADMIN_SECRET` or `JWT_SECRET` environment record while the
  shadow database contains zero administrators. Therefore the supported
  first-admin bootstrap cannot authenticate, no admin session can be minted,
  and the required authenticated
  `configure-stripe-launch-shadow-fixture` route cannot be invoked without an
  unauthorised Vercel configuration change or unsupported writer. The route was
  called zero times; its required once-only confirmation and agreement terms
  were not submitted.
- Final sanitised read-only verification proves exactly one active school row
  for school 1, but zero school-1 admins, zero instructors, zero active
  instructors, zero availability windows, zero `create-instructor` audits,
  zero `stripe-launch-shadow-fixture.create` audits, zero school-1 launch
  configs, zero other-school launch configs, zero agreements, and zero active
  payment-time-valid agreements. It also proves zero launch earnings, payout
  runs, instructor payout batches, transfer intents/attempts, refund
  intents/attempts/events/event lines, legacy instructor payouts, and payout
  line items. No partial fixture or prohibited money state exists.
- Step 12 is **blocked before fixture mutation**, not complete. Because the
  success condition was not met, no log commit, push, or draft PR was created.
  Step 13, all later steps, Slice 3, production deployment/access, live money
  activity, Checkout, payment, webhook, refund, payout, transfer, and Stripe
  Connect actions remain unauthorised and were not performed.

### 4 August 2026 - Step 12 authentication repair resumed; availability route blocked partial fixture

- Resumed only the explicitly authorised Step 12 continuation on existing
  branch `codex/simon-shadow05-step12-fixture`. After refreshing `origin/main`,
  `HEAD`, `origin/main`, and merge-base all resolved to exact required commit
  `2fde59383dd98432cc8f7cef2f589322cadae260`. The complete initial worktree
  inventory contained only the preserved append-only living-log modification;
  no untracked or other modified path existed.
- Reverified the protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed.
- The exact required five-file command passed 69/69 tests with one worker:
  `npm.cmd test -- tests/stripe-launch-shadow-fixture.spec.js tests/stripe-launch-shadow-operations.spec.js tests/admin-instructor-access.spec.js tests/stripe-launch-schema-foundation.spec.js tests/stripe-launch-payment-contracts.spec.js --workers=1`.
  `npm.cmd run check:syntax` passed 199 files; `npm.cmd run check:c1` passed
  271 files; `npm.cmd run review:stripe-launch-slice-2` passed 14/14 checks
  with terminal status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`; and
  `git diff --check` passed with no diagnostic.
- Initial read-only identity and zero-state verification reconfirmed isolated
  Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, prior exact deployment
  `dpl_wMkXMwRFx4S3EWkKfYT3W71vLvFu`, Neon project
  `shiny-bonus-66942766`, default/primary ready branch
  `br-empty-cell-za5kh6nr`, database `neondb`, one active school-1 row, and
  zero admins, instructors, availability, fixture audits, configs, agreements,
  and prohibited-money rows. The one-shot identity preflight and aggregate
  migration were not rerun.
- Generated a new shadow-only `JWT_SECRET` and temporary `ADMIN_SECRET` only in
  process memory, added both to the isolated Production environment without
  exposing their values, and deployed clean exact commit `2fde593...` as
  `dpl_g5fwQnttzSDWm963BjHT8x3c9ym3` (READY, Production target, provider host
  `cc-simon-s2-shadow-05-jvuquil2k-coachcarteruk-2599s-projects.vercel.app`).
  Independent pre-bootstrap checks reconfirmed the exact deployment commit,
  both auth-variable names present, the approved Neon identity, and the full
  database zero state.
- Created exactly one temporary project-scoped Vercel automation bypass and
  submitted one bootstrap request to the provider deployment URL. Vercel
  protection returned a definite HTTP 401 before the application route; no
  database mutation occurred. The bypass was revoked with `regenerate:false`
  and verified at zero. Cleanup removed that temporary `ADMIN_SECRET`; the
  new `JWT_SECRET` remained. No second bypass was created.
- Sanitised project evidence then proved SSO protection mode
  `all_except_custom_domains`; a read-only request to the project Production
  alias reached the application and returned its own expected unauthorised
  response. A fresh in-memory temporary `ADMIN_SECRET` was therefore added for
  the supported bootstrap route, without another bypass. Clean exact commit
  `2fde593...` was deployed as bootstrap deployment
  `dpl_CdEsb4Af2WvWDpAujs4q636HjQd6` (READY, Production target, provider host
  `cc-simon-s2-shadow-05-p03pdpq1j-coachcarteruk-2599s-projects.vercel.app`).
  Independent checks again proved both auth-variable names, exact provider
  identity, zero bypasses, and the complete zero fixture/money state before
  mutation.
- The supported `create-admin` route created exactly one active school-1
  synthetic admin. `ADMIN_SECRET` was removed immediately afterward and the
  final exact-commit deployment was made as
  `dpl_2Z3eBaqXs4TBrtREs8MhUhLWqc7G` (READY, Production target, provider host
  `cc-simon-s2-shadow-05-gg6nyoex4-coachcarteruk-2599s-projects.vercel.app`,
  exact Git SHA `2fde59383dd98432cc8f7cef2f589322cadae260`). Final Vercel
  inventory proves `JWT_SECRET` present, `ADMIN_SECRET` absent, and zero
  protection bypasses.
- Authentication through the supported admin login route succeeded. The
  supported admin route then created exactly one same-school active synthetic
  instructor and exactly one required `create-instructor` audit. Supported
  admin instructor access also succeeded and created one
  `admin.instructor_access_start` audit. The subsequent supported
  `set-availability` request returned a definite HTTP 500 and left exactly zero
  availability windows. No retry was made.
- The in-memory bootstrap password, cookies, JWT material, temporary admin
  secret, and bypass secret were destroyed when the guarded process stopped.
  The existing single admin therefore cannot be reauthenticated in this task
  without a new Vercel authentication repair, supported password-recovery
  channel, or prohibited direct database mutation. Creating a second admin
  would violate the exact-one final fixture. This is the new exact Step 12
  blocker and requires fresh explicit authority; it was not worked around.
- Final sanitised Neon counts are: active school-1 rows `1`; school-1 admins
  `1` (`1` active); school-1 instructors `1` (`1` active); availability
  windows `0`; `create-instructor` audits `1`; instructor-access audits `1`;
  fixture-writer audits `0`; school-1 launch configs `0`; other-school launch
  configs `0`; school-1 agreements `0`; active payment-time-valid agreements
  `0`. The fixture writer call count is exactly `0` and its confirmation or
  bounded terms were never submitted.
- Final prohibited-money counts are all zero: booking earnings, payout runs,
  instructor payout batches, transfer intents, transfer attempts, refund
  intents, refund attempts, refund events, refund-event lines, instructor
  payouts, and payout line items. No Stripe client/API call, Checkout, payment,
  webhook, refund, payout, transfer, Connect object, schema/migration change,
  provider binding change, production access, Step 13, later step, or Slice 3
  action occurred.
- Step 12 remains **blocked with a partial non-financial fixture**, not
  complete. Per the supplied success gate, this living-log update remains the
  only worktree modification and must not be committed, pushed, or opened as a
  PR in this session. Step 13, all later steps, Slice 3, production deployment,
  live money activity, Checkout, payments, refunds, webhooks, payouts,
  transfers, and Stripe Connect actions remain unauthorised.

### 4 August 2026 - Step 12 completed after supported shadow admin recovery

- Resumed only Step 12 on `codex/simon-shadow05-step12-fixture` after fresh
  explicit authority for isolated shadow authentication recovery. Refreshed
  `origin/main` and reconfirmed `HEAD`, `origin/main`, and merge-base as exact
  required commit `2fde59383dd98432cc8f7cef2f589322cadae260`; the preserved
  append-only living log was the sole worktree modification and no untracked
  path existed.
- Reverified the protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  for the product specification and
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`
  for the technical plan. Neither protected document changed.
- Reran the exact required five-file command
  `npm.cmd test -- tests/stripe-launch-shadow-fixture.spec.js tests/stripe-launch-shadow-operations.spec.js tests/admin-instructor-access.spec.js tests/stripe-launch-schema-foundation.spec.js tests/stripe-launch-payment-contracts.spec.js --workers=1`;
  it passed 69/69 tests with one worker. `npm.cmd run check:syntax` passed 199
  files, `npm.cmd run check:c1` passed 271 files, and
  `npm.cmd run review:stripe-launch-slice-2` passed 14/14 checks with terminal
  status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. `git diff --check` passed.
- Sanitised runtime evidence identified the earlier availability HTTP 500 as
  an import-time `STRIPE_CREDENTIAL_MISSING` failure in `/api/instructor`: its
  `_lesson-requests.js` dependency eagerly created a payments-purpose Stripe
  client even though shadow-05 deliberately has no Stripe credential. No
  availability SQL had executed. No credential was added and no Stripe client
  or API call was made. The continuation instead used the existing supported,
  school-scoped admin route `/api/instructors?action=set-availability`, which
  does not import the Stripe-dependent instructor module.
- Reconfirmed before recovery that isolated Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` and Neon project
  `shiny-bonus-66942766`, default/primary ready branch
  `br-empty-cell-za5kh6nr`, database `neondb`, and school 1 remained exact.
  Counts were one active admin and one active instructor, with zero
  availability windows, launch configs, agreements, fixture audits, and all
  prohibited-money rows.
- Recovered only the existing synthetic school-1 admin through the supported
  `request-reset`, `reset-password`, and admin `login` application routes; no
  second admin was created. The expiring six-digit reset code alone crossed an
  explicitly approved temporary workspace file. The guarded process read and
  deleted that file before sending the password-reset request; final filesystem
  verification proved it absent. The generated password, session cookies,
  CSRF value, and all other authentication material remained process-memory
  only and were destroyed when the process exited. The reset and login routes
  each returned HTTP 200, session verification succeeded, exactly one
  `admin.password_reset` audit exists, and no active unused reset token remains.
- The supported admin availability route returned HTTP 200 and created exactly
  seven active windows for instructor 1, one for every distinct day of week.
  Read-only verification proved exactly seven rows before the fixture writer
  was invoked.
- Called `configure-stripe-launch-shadow-fixture` exactly once with the exact
  confirmation `CREATE_STRIPE_LAUNCH_SHADOW_FIXTURE_CONFIRMED`, command
  `shadow-05-step-12-config-v1`, instructor 1, split `9000` bps, weekly
  franchise fee `9000` minor units, currency `gbp`, and document version
  `simon-shadow-agreement-v1`. The single call returned HTTP 201,
  `idempotent_replay: false`, accounting version `simon_launch_v1`, and mode
  `shadow`. It was not retried or replayed.
- No additional deployment was needed. Sanitised provider evidence reconfirmed
  the authorised bootstrap same-commit deployment
  `dpl_CdEsb4Af2WvWDpAujs4q636HjQd6` and final same-commit deployment
  `dpl_2Z3eBaqXs4TBrtREs8MhUhLWqc7G`; the latter remains the isolated project's
  latest READY Production-target deployment at exact Git SHA
  `2fde59383dd98432cc8f7cef2f589322cadae260`. Final Production environment
  inventory proves `JWT_SECRET` present and `ADMIN_SECRET` absent, without
  exposing values. SSO protection remains `all_except_custom_domains` and the
  project protection-bypass count is zero.
- Final sanitised Neon counts are: active school-1 rows `1`; school-1 admins
  `1` (`1` active); school-1 instructors `1` (`1` active); active availability
  windows `7` across `7` distinct days; `create-instructor` audits `1`;
  instructor-access audits `1`; password-reset audits `1`; exact-command
  fixture-writer audits `1`; school-1 `simon_launch_v1` shadow configs `1`;
  other-school launch configs `0`; active payment-time-valid agreements with
  the exact authorised bounded terms `1`; and active unused admin reset tokens
  `0`. No unexpected partial fixture state remains.
- Final prohibited-money counts are all zero: booking earnings, payout runs,
  instructor payout batches, transfer intents, transfer attempts, refund
  intents, refund attempts, refund events, refund-event lines, instructor
  payouts, and payout line items. No Stripe client/API call, Checkout, payment,
  webhook, refund, payout, transfer, Connect object, schema/migration change,
  provider binding change, production-system access, Step 13, later step, or
  Slice 3 action occurred.
- Step 12 is **complete**. This append-only living log remains the only modified
  file. Step 13, all later steps, Slice 3, production deployment, live money
  activity, Checkout, payments, refunds, webhooks, payouts, transfers, and
  Stripe Connect actions remain unauthorised.

### 4 August 2026 - Step 13 stopped before Checkout: required Stripe credentials absent

- The owner authorised Project Log Step 13 only: exercise the four approved
  Stripe test-mode origins in order on isolated `shadow-05`, stop on the first
  failure, append the evidence here, and publish only if all four origins
  completed. Adding, copying, rotating, or changing Stripe/Vercel credentials
  or environment variables was explicitly outside scope.
- Refreshed clean local `main` to
  `6b24cf784b77eae78d29744245b6876e740adfd3`, with `HEAD`, `origin/main`, and
  merge-base identical, then created fresh branch
  `codex/simon-shadow05-step13-payment-origins`. Step 12 evidence commit
  `d34a135d7e33faeb019c4a3c09b61ff375def675` is a PR-head commit and therefore
  is not an ancestor of the squash merge on `main`; its tree and the
  `6b24cf7...` tree are exactly identical, so the required Step 12 content is
  present without ambiguity. Initial staged, unstaged, untracked, and branch
  diff inventories were empty.
- Re-read the complete worker rules, `CLAUDE.md`, protected Simon product
  specification and technical implementation plan, living project log, Slice
  2 rollout review, Stripe Connect reference, and all four origin producers,
  webhook/materialiser, exact source writer, and reconciler. Reverified the
  protected LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed. The aggregate migration and one-shot
  identity preflight were not rerun.
- The exact required five-file command
  `npm.cmd test -- tests/stripe-launch-shadow-fixture.spec.js tests/stripe-launch-shadow-operations.spec.js tests/admin-instructor-access.spec.js tests/stripe-launch-schema-foundation.spec.js tests/stripe-launch-payment-contracts.spec.js --workers=1`
  passed 69/69 tests. The additional four-origin command
  `npm.cmd test -- tests/stripe-launch-shadow-return-urls.spec.js tests/webhook-slot-booking.spec.js tests/webhook-offer-bcs.spec.js tests/test-date-lesson-booking.spec.js tests/payout-v2-source-ingestion.spec.js tests/stripe-dynamic-payment-methods.spec.js tests/stripe-launch-payment-contracts.spec.js --workers=1`
  passed 77/77 tests. `npm.cmd run check:syntax` passed 199 files,
  `npm.cmd run check:c1` passed 271 files,
  `npm.cmd run review:stripe-launch-slice-2` passed 14/14 checks with terminal
  status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, and `git diff --check` passed.
- Read-only provider revalidation proved exact isolated Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` (`cc-simon-s2-shadow-05`), latest READY
  Production-target deployment `dpl_2Z3eBaqXs4TBrtREs8MhUhLWqc7G`, provider
  host `cc-simon-s2-shadow-05-gg6nyoex4-coachcarteruk-2599s-projects.vercel.app`,
  exact deployed Git SHA `2fde59383dd98432cc8f7cef2f589322cadae260`, SSO protection
  `all_except_custom_domains`, and zero protection-bypass entries. Read-only
  Neon revalidation proved exact project `shiny-bonus-66942766`, default/primary
  ready branch `br-empty-cell-za5kh6nr`, and database `neondb`.
- Sanitised fixture revalidation proved one active school-1 row, one active
  school-1 admin, one active school-1 instructor, seven active availability
  windows across seven distinct days, one exact-command fixture audit, one
  school-1 `simon_launch_v1` shadow config, zero other-school configs, one
  active payment-time-valid instructor-1 agreement with split `9000` bps,
  weekly fee `9000` minor units, currency `gbp`, and document version
  `simon-shadow-agreement-v1`, plus zero active unused admin reset tokens.
- The mandatory pre-Stripe credential-name gate classified `STRIPE_MODE` as
  `test` and inspected no Stripe credential value. Production inventory found
  zero `STRIPE_PAYMENTS_RESTRICTED_KEY`, zero
  `STRIPE_RECONCILIATION_RESTRICTED_KEY`, zero
  `STRIPE_PLATFORM_RESTRICTED_KEY`, zero `STRIPE_SECRET_KEY`, and zero
  `STRIPE_WEBHOOK_SECRET` records. Therefore neither the supported payments
  client nor reconciliation client can authenticate, and the deployed webhook
  cannot verify Stripe signatures. The exact blocker is **required Stripe test
  payment/reconciliation credentials and webhook secret are absent from the
  isolated shadow-05 Production environment, while this step has no authority
  to add or change them**.
- Stopped before the first `direct_slot` attempt and before creating any Stripe
  Checkout Session, PaymentIntent, Charge, webhook event, application booking,
  `booking_credit_sources` row, funding source, or payment contract.
  `direct_slot`, `test_date_direct`, `one_off_offer`, and `captured_request`
  attempted-origin counts are all zero; no unsupported origin was attempted.
- Final read-only counts remain zero for school-1 lesson payment contracts,
  payout funding sources, launch booking earnings, payout runs, instructor
  payout batches, transfer intents, transfer attempts, refund intents, refund
  attempts, refund events, refund-event lines, legacy instructor payouts, and
  all school payout line items. No credential/configuration change, deployment,
  schema/migration change, Stripe API call/object, test or live payment,
  webhook delivery, refund, payout, transfer, Connect action, production-system
  access, Step 14, later step, or Slice 3 action occurred.
- Step 13 is **blocked before origin exercise and is not complete**. Per the
  supplied stop gate, this append-only living-log update is the only worktree
  modification and must not be staged, committed, pushed, or opened as a PR in
  this session.

### 4 August 2026 - Step 13 resumed; stopped after direct-slot evidence remained pending

- After the preceding credential blocker was recorded, the owner gave fresh
  explicit authority to source only the already-isolated shadow-04 test-mode
  restricted credentials, register a dedicated shadow-05 test webhook, add
  only those three test values to shadow-05, redeploy the approved application
  commit, and resume Step 13. Live credentials and every other project remained
  excluded.
- In the Stripe Dashboard's visible Sandbox context, identified the shadow-04
  payments-purpose and reconciliation-purpose `rk_test_...` keys without
  logging their values. Sanitised permission probes proved the payments key can
  read/create Checkout and PaymentIntent objects but cannot administer webhook
  endpoints, while the reconciliation key can read Checkout Sessions,
  PaymentIntents, Charges, and balance transactions. No live key was used.
- Created exactly one dedicated test webhook destination
  `cc-simon-s2-shadow-05`, ID `we_1U0qdyIqhTSdZedS2h8O3RxW`, bound to
  `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`. It subscribes only to
  `account.updated`, `charge.failed`, `checkout.session.async_payment_failed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.completed`,
  `checkout.session.expired`, `payment_intent.payment_failed`, and
  `payment_intent.succeeded`. Its signing secret was transferred only through
  guarded process memory and was not logged, copied to the clipboard, or
  written to disk.
- Added only `STRIPE_PAYMENTS_RESTRICTED_KEY`,
  `STRIPE_RECONCILIATION_RESTRICTED_KEY`, and `STRIPE_WEBHOOK_SECRET` as
  sensitive Production variables in exact isolated Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` (`cc-simon-s2-shadow-05`). Redeployed the
  previously approved deployment without source changes. The resulting exact
  deployment is `dpl_2Y8REiAomzHXGmqx5m9hvRDzA7fd`, READY on the Production
  target, provider host
  `cc-simon-s2-shadow-05-a31gc7khb-coachcarteruk-2599s-projects.vercel.app`,
  exact Git SHA `2fde59383dd98432cc8f7cef2f589322cadae260`, and custom alias
  `cc-simon-s2-shadow-05.vercel.app`. `STRIPE_MODE` remains exactly `test`;
  `JWT_SECRET` remains present; `ADMIN_SECRET` remains absent; and protection
  bypass count remains zero.
- Post-deploy read-only verification reconfirmed exact Neon project
  `shiny-bonus-66942766`, ready default/primary branch
  `br-empty-cell-za5kh6nr`, database `neondb`, one active school-1 row, one
  active admin, one active instructor, seven active availability windows across
  seven days, one exact `shadow-05-step-12-config-v1` fixture audit, one
  `simon_launch_v1` shadow config, zero other-school configs, and the one active
  instructor-1 agreement with split `9000` bps, weekly fee `9000` minor units,
  currency `gbp`, and document version `simon-shadow-agreement-v1`. All payment
  and prohibited-operation counts were still zero before Checkout.
- Recovered only the existing synthetic admin through the supported
  `request-reset`, `reset-password`, and login UI, creating no second admin.
  The single-use code was observed read-only and submitted through the normal
  application form; the generated password and session material remained in
  process memory. There are now exactly two historical
  `admin.password_reset` audits, and active unused admin reset tokens remain
  zero.
- Began origin 1, `direct_slot`, only after the clean pre-state. Used the normal
  supported guest `checkout-slot-guest` route once for a unique synthetic
  school-1 learner and the existing instructor/agreement. Stripe Checkout
  visibly identified the transaction as Sandbox, charged only official test
  card details, displayed the exact GBP 82.50 amount, and returned to the exact
  shadow-05 provider host. Its cancel URL was also bound to that exact
  shadow-05 provider host; neither URL fell back to `coachcarter.uk`. No
  ambiguous Checkout retry or second identity was used.
- The signed webhook produced exactly one scheduled 90-minute booking, ID `1`,
  for learner `1`, instructor `1`, school `1`, on 10 August 2026 at 10:00,
  booking purpose `lesson`, and exact list price `8250` pence. Exactly one
  `slot_purchase` credit transaction, ID `1`, amount `8250`, exactly one BCS
  attribution, exactly one funding source, ID `1`, exactly one immutable
  contract `4af03473-9cfd-4051-9606-654245e1b6ab`, and exactly one learner
  confirmation attempt exist. No duplicate booking, source, BCS row, contract,
  or receipt attempt exists.
- Exact sanitised Stripe evidence is Checkout Session
  `cs_test_b18JfmifnTWZRDMTtnq6sQWSkHLvO1i0lKsi6a9ZEHdj9KpEb7SV7bur3v`,
  PaymentIntent `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, Charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, and balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`. The source and contract agree on origin
  `direct_slot`, accounting version `simon_launch_v1`, launch regime, gross
  `8250` GBP minor units, exact Stripe fee `288`, fee source
  `balance_transaction`, split `9000` bps, payment creation time
  `2026-08-04T22:32:01.000Z`, and funds-availability time
  `2026-08-07T00:00:00.000Z`. Neither source nor contract has an ineligibility
  or contradiction code.
- The mandatory origin success gate nevertheless failed: Stripe reports the
  exact balance transaction status as `pending` until 7 August 2026, so the
  funding source evidence completeness and immutable contract evidence status
  are both correctly `pending`, not the required `complete`. This is genuine
  delayed Stripe availability evidence. It was not manufactured, overridden,
  or manually changed, and the reconciliation writer was not invoked early.
- Stopped immediately on that first-origin failure. `test_date_direct`,
  `one_off_offer`, and `captured_request` were not attempted. Final school-1
  counts are one booking, one `slot_purchase`, one BCS row, one funding source,
  and one `direct_slot` contract; all other approved-origin contract counts are
  zero. Launch booking earnings, legacy booking earnings, payout runs, payout
  batches, transfer intents, transfer attempts, refund intents, refund
  attempts, refund events, refund-event lines, instructor payouts, payout line
  items, school Connect accounts, and instructor Connect accounts all remain
  exactly zero.
- Step 13 is **not complete**. The exact blocker is: the single supported
  `direct_slot` test payment has correct, non-contradictory exact evidence, but
  Stripe funds are not available until 7 August 2026 and therefore its contract
  cannot yet be complete. Per the stop gate, this append-only living log remains
  the only worktree modification and must not be staged, committed, pushed, or
  opened as a PR. No live-mode, production-system, Connect/onboarding, earnings,
  payout, transfer, refund, dispute, schema/migration, Step 14, later-step, or
  Slice 3 action occurred. Step 14, Slice 3, and all later work remain
  unauthorised.

### 5 August 2026 - Step 13 webhook isolation and post-commit reliability repair prepared

- The owner authorised a repair-only continuation: attribute and recoverably
  disable the obsolete duplicate webhook if conclusive, inspect only shadow-05
  SMTP variable names/classification, repair the post-commit notification
  boundary, test and publish a draft PR, then deploy only the exact repair SHA
  to isolated shadow-05. Resuming any payment origin, replaying the Stripe event,
  creating another Checkout or payment, running reconciliation before the
  pending contract's natural availability time, or beginning Step 14/Slice 3
  remained explicitly prohibited.
- Started fresh branch
  `codex/simon-shadow05-webhook-reliability-repair` from exact clean source
  `6b24cf784b77eae78d29744245b6876e740adfd3`, with `HEAD`, `origin/main`, and
  merge-base identical, while carrying forward only this append-only project-log
  diff. Reconfirmed the LF-normalised protected hashes exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`;
  neither protected document changed.
- Read-only Vercel evidence reconfirmed isolated project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` (`cc-simon-s2-shadow-05`) and current
  READY Production-target deployment `dpl_2Y8REiAomzHXGmqx5m9hvRDzA7fd`,
  provider host
  `cc-simon-s2-shadow-05-a31gc7khb-coachcarteruk-2599s-projects.vercel.app`,
  alias `cc-simon-s2-shadow-05.vercel.app`, and exact deployed Git SHA
  `2fde59383dd98432cc8f7cef2f589322cadae260`. Exact deployment-scoped runtime
  logs show the first `checkout.session.completed` delivery returned 500 after
  `handleSlotBooking` raised `ESOCKET` / `ECONNREFUSED` at `127.0.0.1:587`,
  followed by the idempotent 200 delivery; they contain no
  `uq_instructor_slot` failure for shadow-05.
- Stripe Dashboard read-only delivery evidence conclusively attributed the
  misleading duplicate-slot owner alert to obsolete test destination
  `cc-simon-s2-shadow-04`, ID `we_1U0HBfIqhTSdZedSgka7EVQ6`, endpoint
  `https://cc-simon-s2-shadow-04.vercel.app/api/webhook`. That destination
  received exact event `evt_1U0qsRIqhTSdZedSIyzFDydP` and exact Checkout
  Session
  `cs_test_b18JfmifnTWZRDMTtnq6sQWSkHLvO1i0lKsi6a9ZEHdj9KpEb7SV7bur3v`
  at 4 August 2026 23:32:08 BST and returned HTTP 200. The request itself
  contained the shadow-05 provider return URLs and the same direct-slot
  identity. This matches the owner alert at `2026-08-04T22:32:07.132Z` and the
  already-contaminated shadow-04 slot. With attribution conclusive, disabled
  this one destination recoverably on 5 August; it now shows `Disabled` and was
  not deleted. Dedicated shadow-05 destination `we_1U0qdyIqhTSdZedS2h8O3RxW`
  and all live destinations were untouched.
- A names/classification-only Vercel Production environment inventory for
  exact shadow-05 proved `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`
  are all absent. Repository evidence identifies no existing isolated test-only
  SMTP sink. No SMTP variable was added, copied, revealed, or changed; using
  live credentials or improvising a relay remained prohibited. Isolated SMTP
  configuration is therefore a recorded environment blocker, not a reason to
  make the paid-booking webhook retry after its core state is committed.
- Prepared a narrow `slot_booking` repair in `api/webhook.js`: core booking,
  BCS, funding-source, and immutable payment-contract writes remain inside the
  existing retryable handler boundary, while the subsequent learner and
  instructor confirmation sends are individually awaited and caught. Both
  attempts still pass through `createTransporter()` and its existing
  `notification_log` audit wrapper; a synchronous transport-construction failure
  is explicitly audit-logged. Failure reporting emits only bounded recipient
  role, purpose, error name, and error code, and its owner alert is best-effort.
  Signature verification, event receipts, payment idempotency, the genuine
  booking-insert refund/alert/apology path, and all money/Connect behaviour are
  unchanged.
- Added `tests/webhook-slot-booking-reliability.spec.js`. Its three executed
  webhook tests prove: learner SMTP failure after exact singular core writes
  returns 200 and marks the receipt processed; the instructor attempt still
  runs and the failed notification is recorded; replay returns the duplicate
  200 path without another booking, `slot_purchase`, BCS row, funding source,
  contract, or notification; a launch-contract write failure still marks the
  receipt failed and returns 500; and a genuine booking-insert failure restores
  the credit while retaining the owner alert and learner apology path. The
  focused file passed 3/3 twice. The required command
  `npm.cmd test -- tests/webhook-slot-booking.spec.js tests/stripe-launch-payment-contracts.spec.js tests/payout-v2-source-ingestion.spec.js --workers=1`
  passed 40/40. `npm.cmd run check:syntax` passed 199 files,
  `npm.cmd run check:c1` passed 271 files, the Slice 2 rollout review passed all
  14 checks with status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, and
  `git diff --check` passed.
- At this append point no repair commit, push, PR, or deployment existed yet;
  shadow-05 still ran exact app SHA `2fde593...`. The existing direct-slot
  payment/booking evidence was not replayed or mutated. Its immutable contract
  remains naturally pending until `2026-08-07T00:00:00Z`; Step 13 remains
  incomplete and paused after this repair. No new Checkout, payment, manual
  booking/refund, reconciliation, earnings, payout, transfer, refund, dispute,
  Connect/onboarding, live-mode, production-system, Step 14, later-step, or
  Slice 3 action occurred.
- Published the focused repair as commit
  `c84a37ed58701f4711fe5de6d189fc2423620bb6` on
  `codex/simon-shadow05-webhook-reliability-repair` and opened draft PR
  [#348](https://github.com/coachcarteruk-gif/coachcarter-website/pull/348)
  against `main`. The PR remains draft and was not merged.
- Deployed only that exact repair commit to isolated Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`. Deployment
  `dpl_2EjhdwJRmzHNmxiNumyovjpRrMPC` is READY on the Production target at
  provider host
  `cc-simon-s2-shadow-05-6tg3durim-coachcarteruk-2599s-projects.vercel.app`,
  with alias `cc-simon-s2-shadow-05.vercel.app` and Vercel-reported Git SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`. The temporary ignored local
  project binding used for this exact deployment was immediately restored to
  its pre-task shadow-04 value; the tracked worktree remained clean.
- Secret-safe post-deploy Vercel API verification proved exactly one encrypted
  Production `STRIPE_MODE` record and confirmed its decrypted value equals
  `test` without revealing it; `JWT_SECRET` is present; `ADMIN_SECRET` is
  absent; all four SMTP records remain absent; SSO protection remains
  `all_except_custom_domains`; and the protection-bypass inventory is zero.
  No environment variable or protection setting changed during or after the
  deployment.
- Stripe Dashboard read-only verification reconfirmed exact dedicated test
  destination `we_1U0qdyIqhTSdZedS2h8O3RxW` is Active at
  `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`, in visible Sandbox /
  Test mode, with the same eight event subscriptions. The conclusively obsolete
  shadow-04 destination remains Disabled. No event was resent and no test event
  was generated.
- Final read-only Neon verification reconfirmed exact project
  `shiny-bonus-66942766`, ready default/primary branch
  `br-empty-cell-za5kh6nr`, and database `neondb`. The exact existing evidence
  remains one booking, one `slot_purchase`, one BCS attribution, one funding
  source, one `direct_slot` contract, one processed receipt for
  `evt_1U0qsRIqhTSdZedSIyzFDydP`, and one failed learner confirmation attempt.
  Contract `4af03473-9cfd-4051-9606-654245e1b6ab` remains `pending` with exact
  funds-availability time `2026-08-07T00:00:00Z`. Booking earnings, payout runs,
  instructor payout batches, payout transfers, transfer attempts, refund
  intents, refund attempts, refund events, refund-event lines, dispute evidence,
  school Connect accounts, and instructor Connect accounts all remain exactly
  zero.
- Step 13 remains **incomplete and paused after the reliability repair**. The
  payment-origin exercise was not resumed. No Checkout, payment, card entry,
  event replay, early reconciliation, manual booking/refund, money movement,
  live-mode, production-system, Step 14, later-step, or Slice 3 action occurred.

### 5 August 2026 - One-time Step 13 sequencing amendment stopped before Checkout

- The owner explicitly authorised a one-time Step 13 sequencing amendment:
  preserve the existing pending `direct_slot` payment unchanged; exercise
  `test_date_direct`, `one_off_offer`, and `captured_request` in that strict
  order with Stripe's official bypass-pending international test card; require
  each new origin to be complete before starting the next; and stop on the
  first failure. Early `direct_slot` reconciliation, Step 14, Slice 3, live
  mode, payouts, transfers, refunds, disputes, and Connect onboarding remained
  expressly prohibited.
- The preflight worktree was clean on
  `codex/simon-shadow05-webhook-reliability-repair` at exact HEAD
  `6de370f2f2ba0469f6076e94d5d9658ab1ceb6ff`. Reconfirmed the protected
  LF-normalised SHA-256 values exactly as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`;
  neither protected document changed.
- Read-only Vercel identity verification reconfirmed isolated project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, exact READY Production-target deployment
  `dpl_2EjhdwJRmzHNmxiNumyovjpRrMPC`, provider host
  `cc-simon-s2-shadow-05-6tg3durim-coachcarteruk-2599s-projects.vercel.app`,
  alias `cc-simon-s2-shadow-05.vercel.app`, and deployed Git SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`. Read-only Neon verification
  reconfirmed exact project `shiny-bonus-66942766`, ready default/primary branch
  `br-empty-cell-za5kh6nr`, and database `neondb`.
- The exact pre-origin database snapshot remained one scheduled booking, one
  `slot_purchase`, one BCS attribution, one funding source, one processed
  receipt, and one `direct_slot` contract. Contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remained `pending`, with gross `8250`
  GBP minor units, fee `288`, no ineligibility or contradiction code, and exact
  funds-availability time `2026-08-07T00:00:00Z`. Counts for
  `test_date_direct`, `one_off_offer`, and `captured_request` contracts were all
  zero. The existing booking remained 10 August 2026, 10:00-11:30, with
  purpose `lesson`; the seven instructor availability windows remained active
  from 09:00 to 17:00 on all seven days.
- Every prohibited-operation preflight remained zero: live-mode receipts,
  launch and legacy booking earnings, payout runs, instructor payout batches,
  transfer intents and attempts, refund intents and attempts, refund events and
  lines, payment disputes and dispute events, and connected-account scopes.
- Before creating the first `test_date_direct` Checkout, the normal shadow-05
  learner sign-in UI was used for the existing synthetic learner. The UI
  returned `Failed to send code`. Exact deployment-scoped runtime evidence at
  `2026-08-05T08:10:41Z` shows `POST /api/magic-link` returned HTTP 500 because
  the email-code send raised `ESOCKET` / `ECONNREFUSED` at `127.0.0.1:587`,
  consistent with the already-recorded absence of an isolated SMTP sink.
- No authentication code was retrieved from Neon or any browser credential
  store, and no workaround, password mutation, environment/configuration
  change, or direct database mutation was attempted. The safety gate rejected
  reading the live email authentication code from the database after normal
  delivery failed, so the exercise stopped at that boundary.
- `test_date_direct`, `one_off_offer`, and `captured_request` were not attempted.
  No Checkout Session, PaymentIntent, Charge, card entry, webhook delivery,
  booking, credit transaction, BCS row, funding source, or payment contract was
  created in this continuation. The existing `direct_slot` payment and contract
  were not reconciled, replayed, or changed. No live-mode, payout, transfer,
  refund, dispute, Connect/onboarding, Step 14, later-step, or Slice 3 action
  occurred. Step 13 remains incomplete and paused before the first newly
  authorised origin.
- Two subsequent Stripe test-mode webhook warning emails were attributed
  read-only to legacy destinations receiving automatic retries for the original
  `direct_slot` event, not to a new payment. Destination
  `rehearsal-1-7-test`, ID `we_1TVRRbIqhTSdZedS5mdOHWWB`, is still Active at
  `https://coachcarter.uk/api/webhook`, is described in Stripe as
  `Rehearsal for plan 1.7 — delete after May 13`, and showed 57/57 failed
  deliveries for the displayed week. Its retry of exact PaymentIntent event
  `evt_3U0qsPIqhTSdZedS21dZLaz8` returned HTTP 307 with redirect target
  `https://www.coachcarter.uk/api/webhook`; Stripe therefore classified the
  delivery as failed.
- Legacy destination `CoachCarter production`, ID
  `we_1T3B9jIqhTSdZedSZjCfwjxX`, is still Active at
  `https://booking-system-production-55a5.up.railway.app/webhook`, listens only
  to `checkout.session.completed`, and showed 30/30 failed deliveries for the
  displayed week. Its automatic retries of exact original event
  `evt_1U0qsRIqhTSdZedSIyzFDydP` and Checkout Session
  `cs_test_b18JfmifnTWZRDMTtnq6sQWSkHLvO1i0lKsi6a9ZEHdj9KpEb7SV7bur3v`
  returned HTTP 404 with `Application not found`.
- The dedicated shadow-05 test destination remained Active. Neither legacy
  destination was disabled, deleted, edited, or resent during this read-only
  attribution, and no Stripe object or application financial row was created
  or changed.
- The owner then explicitly authorised recoverably disabling only those two
  conclusively attributed legacy test destinations. In Stripe's visible
  Sandbox context, disabled `rehearsal-1-7-test`
  (`we_1TVRRbIqhTSdZedS5mdOHWWB`) and `CoachCarter production`
  (`we_1T3B9jIqhTSdZedSZjCfwjxX`) through each destination's supported
  `Disable destination` control. Neither destination was deleted, edited,
  resent, or had its signing secret rolled.
- Post-action Stripe Dashboard verification showed both exact legacy rows as
  `Disabled` and retained their original URLs and subscription counts. The
  dedicated shadow-05 destination remained `Active` at
  `https://cc-simon-s2-shadow-05.vercel.app/api/webhook` with eight subscribed
  events. No shadow destination other than the two explicitly authorised
  legacy endpoints was changed, and no live-mode destination was accessed or
  changed.

### 5 August 2026 - Authorised shadow-05 authentication bypass stopped before Checkout

- Re-read `AGENTS.md` and this complete living log before resuming. Preserved
  the existing append-only uncommitted log changes. Local branch remained
  `codex/simon-shadow05-webhook-reliability-repair` at exact HEAD
  `6de370f2f2ba0469f6076e94d5d9658ab1ceb6ff`; no file other than this living
  log was modified, and nothing was staged, committed, or pushed.
- Reconfirmed the two protected-document LF-normalised SHA-256 values as
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed.
- Read-only Vercel verification reconfirmed isolated project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, exact READY Production-target deployment
  `dpl_2EjhdwJRmzHNmxiNumyovjpRrMPC`, alias
  `cc-simon-s2-shadow-05.vercel.app`, and deployed Git SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`. Read-only Neon verification
  reconfirmed exact project `shiny-bonus-66942766`, ready default/primary branch
  `br-empty-cell-za5kh6nr`, and database `neondb`.
- In Stripe Dashboard visible Sandbox / Test mode, reconfirmed dedicated
  destination `we_1U0qdyIqhTSdZedS2h8O3RxW` is `Active` at the exact
  shadow-05 webhook URL with its eight subscriptions. The two conclusively
  obsolete destinations `we_1TVRRbIqhTSdZedS5mdOHWWB` and
  `we_1T3B9jIqhTSdZedSZjCfwjxX` remained `Disabled`. No destination was
  edited, resent, rotated, enabled, disabled, or deleted.
- The read-only pre-authentication database gate reconfirmed school `1`, the
  exact synthetic learner and instructor identities, and exactly one existing
  lesson booking, one `slot_purchase` credit transaction, one booking-credit
  attribution, one payout funding source, and one processed test-mode Stripe
  receipt. Live-mode receipts remained zero. Contract counts remained
  `direct_slot=1`, `test_date_direct=0`, `one_off_offer=0`, and
  `captured_request=0`.
- Existing `direct_slot` contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remained exactly `pending` with
  PaymentIntent `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`, gross `8250`, Stripe fee `288`, exact
  availability `2026-08-07T00:00:00Z`, and null ineligibility and contradiction
  codes. It was not reconciled, replayed, or otherwise changed.
- Every prohibited-operation ledger checked in the preflight was zero,
  including launch and legacy booking earnings and sources, payout batches,
  payout runs and source-import runs, instructor payout batches and payouts,
  all transfer intents/transfers/sources/attempts, school payouts and line
  items, payout adjustments, refund intents/attempts/events/lines/notes,
  disputes/evidence/notifications, connected-account scopes and state events,
  connected-bank payouts and links, payout obligations/applications, and
  statements/delivery attempts.
- Under the owner's isolated shadow-05 authentication authority, the normal
  learner sign-in UI generated exactly one fresh login-code record for the
  existing synthetic learner. Normal delivery failed as expected. Exact
  deployment-scoped runtime evidence contains only the `08:49:27Z`
  `POST /api/magic-link` HTTP 500, caused by `ESOCKET` / `ECONNREFUSED` at
  `127.0.0.1:587`. A narrowly scoped Neon read proved exactly one newly
  generated, then-current code record; no other authentication row was read,
  and the code value was never printed, persisted, or added to this log.
- The official verification endpoint was not reached. The local execution
  safety gate rejected passing the current code in a command because command
  arguments could be logged. The in-app browser's security policy separately
  rejected same-origin script execution, and its supported automation surface
  could not reach the verification form that remains hidden after the SMTP 500.
  Those blocked attempts caused no application request: Vercel logs through
  `09:05:08Z` contain no verification call, and the exact code record remained
  `used=false` until it expired naturally at `2026-08-05T09:04:28.037Z`.
  No cookie, session, browser credential store, password, token, or unrelated
  authentication record was inspected or changed. No direct database mutation
  was made.
- Stopped at that authentication boundary. No instructor code was requested,
  no synthetic learner or instructor session was established, and
  `test_date_direct`, `one_off_offer`, and `captured_request` were not begun.
  No Checkout Session, PaymentIntent, charge, balance transaction, card entry,
  webhook delivery, booking, credit transaction, BCS attribution, funding
  source, or new payment contract was created.
- Final read-only Neon verification remained identical: origin counts
  `direct_slot=1`, `test_date_direct=0`, `one_off_offer=0`, and
  `captured_request=0`; core counts remained one booking, one `slot_purchase`,
  one booking-credit source, one payout funding source, and one processed
  receipt; live receipts remained zero; the preserved direct contract remained
  exactly pending with its original immutable evidence; and the combined total
  across every checked prohibited-operation ledger remained exactly zero.
  Step 13 therefore remains **incomplete and paused before
  `test_date_direct`**. No live-mode, payout, transfer, refund, dispute,
  Connect/onboarding, Step 14, later-step, or Slice 3 action occurred.

### 5 August 2026 - Temporary client recovery prepared; deployment approval blocked

- Re-read `AGENTS.md`, `CLAUDE.md`, both complete protected Simon documents,
  the complete living log, the Stripe Connect/payment/security references, the
  per-instructor credit audit, and the booking-status contract. Reconfirmed the
  main workspace still had this append-only log as its only modification.
- Created the explicitly authorised isolated detached worktree
  `C:\tmp\cc-simon-shadow05-auth-recovery-c84a37e` at exact application SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`. No commit, branch, push, or PR
  was created.
- Added only gated client-side recovery code to
  `public/learner/login.js` and `public/instructor/login.js`. It activates only
  when the exact hostname is `cc-simon-s2-shadow-05.vercel.app`, the query
  parameter `shadow_auth_recovery=1` is present, and the normal
  `send-email-code` request returns HTTP 500. It then exposes the existing
  verification-code screen while retaining the login email, role, purpose,
  and school-1 context. No server authentication, verification, cookie, JWT,
  database, schema, migration, environment, SMTP, Stripe, webhook, or secret
  code changed.
- Both changed scripts passed `node --check`; `git diff --check` passed. The
  temporary source diff contains exactly those two client files, with 41
  insertions and 3 replacements. The local Vercel binding contains only the
  non-secret exact team/project identifiers.
- The attempted pinned Vercel CLI Production-target deployment was rejected
  before execution by the local action safety reviewer, which required a more
  explicit user confirmation for deploying uncommitted authentication-client
  changes even to the isolated shadow-05 project. No Vercel deployment request
  was made, so the alias remains on the clean exact `c84a37...` application.
- Stopped at that approval boundary. No login code was generated or read, no
  learner or instructor session was established, and no Checkout, payment,
  webhook delivery, booking, credit transaction, BCS attribution, funding
  source, contract, reconciliation, refund, payout, transfer, dispute, Connect
  action, Step 14, later step, or Slice 3 operation occurred. Existing
  `direct_slot` evidence was not replayed, reconciled, or changed; the remaining
  origins were not begun.

### 5 August 2026 - Temporary recovery deployed; OTP value read blocked

- After the owner explicitly confirmed the security-sensitive deployment at
  action time, deployed the uncommitted two-file client recovery artifact from
  exact base SHA `c84a37ed58701f4711fe5de6d189fc2423620bb6` only to isolated
  Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`. Deployment
  `dpl_7iZWTE6pNa8turwjMmqgLW3eMSeA` is READY on that project's Production
  target, reports exact Git SHA `c84a37...` with the expected dirty marker,
  and owns alias `cc-simon-s2-shadow-05.vercel.app`. No environment variable,
  provider setting, database, webhook, or Stripe resource changed.
- Independent Vercel evidence proved the exact isolated project and deployment.
  The read-only pre-authentication Neon gate then reconfirmed database `neondb`,
  one exact school-1 synthetic learner and instructor, origin counts
  `direct_slot=1`, `test_date_direct=0`, `one_off_offer=0`, and
  `captured_request=0`, and one booking, `slot_purchase`, BCS attribution,
  payout funding source, and processed test receipt. Live receipts remained
  zero and every checked prohibited-operation ledger remained zero.
- Preserved direct contract `4af03473-9cfd-4051-9606-654245e1b6ab` remained
  exactly `pending` with its original PaymentIntent, charge, balance
  transaction, gross `8250`, fee `288`, availability
  `2026-08-07T00:00:00Z`, and null ineligibility/contradiction codes.
- The visible supported learner login flow generated exactly one fresh current
  unused school-1 learner login-code record, and the expected SMTP HTTP 500
  exposed the existing verification form through the gated client recovery.
  A metadata-only Neon query proved the record singular, current, unused,
  purpose `login`, role `learner`, and attributable to that request.
- The credential-bearing Neon query was rejected before execution by the local
  action safety reviewer pending a fresh action-time confirmation. No OTP value
  was returned, printed, persisted, or entered; no verification request was
  sent and no learner session was established. No instructor code was
  requested.
- Stopped before authentication completion and before the mandatory clean-SHA
  restoration/payment preflight. No Checkout, card entry, payment, webhook,
  booking, credit transaction, BCS attribution, funding source, contract,
  reconciliation, refund, payout, transfer, dispute, Connect action, Step 14,
  later step, or Slice 3 operation occurred. The gated temporary recovery
  deployment remains active pending the owner's immediate direction; the clean
  SHA has not yet been redeployed because no payment can begin in this state.

### 5 August 2026 - Learner authenticated; instructor OTP confirmation blocked

- The owner supplied fresh action-time authority to read and enter the exact
  shadow-05 learner OTP and authorised exactly one replacement learner request
  if the earlier record had expired. A metadata-only query proved the original
  learner record expired, so the visible supported learner send-code flow was
  invoked exactly once for the authorised replacement.
- The replacement learner record was singular, current, unused, school `1`,
  purpose `login`, role `learner`, and attributable to that request. Its value
  moved only from the Neon query result in process memory into the visible
  existing six-digit form; it was never printed, persisted, copied to the
  clipboard, placed in a command argument, or added to this log.
- The first programmatic per-box entry attempt left only the first field
  populated and sent no verification request. Re-reading the same still-current
  unused record and typing it as ordinary keystrokes through the form succeeded.
  The code was consumed once and the existing learner session cookie was issued.
- The synthetic learner then reached the existing Terms acceptance screen.
  No legal terms were accepted on the learner's behalf. Without inspecting
  cookies, tokens, local storage, or session contents, the supported learner
  profile page successfully called its authenticated read model and rendered
  the exact synthetic learner profile and signed-in navigation. Learner
  authentication is therefore complete.
- The visible supported instructor login flow was then invoked exactly once
  for the exact school-1 synthetic instructor. SMTP failed as expected, the
  gated client recovery exposed the existing verification form, and a
  metadata-only Neon query proved exactly one fresh singular, current, unused
  school-1 instructor record with purpose `login` and role `instructor`.
- The credential-bearing instructor query was rejected before execution by the
  local action safety reviewer because the latest action-time confirmation was
  learner-specific. No instructor OTP value was returned, printed, persisted,
  or entered; no instructor verification request was sent and no instructor
  session was established.
- Stopped at that instructor-specific confirmation boundary. The temporary
  gated deployment remains active, the clean SHA has not yet been restored,
  and the mandatory pre-Checkout gate has not run. No Checkout, card entry,
  payment, webhook, booking, credit transaction, BCS attribution, funding
  source, contract, reconciliation, refund, payout, transfer, dispute, Connect
  action, Step 14, later step, or Slice 3 operation occurred. Existing
  `direct_slot` evidence remains untouched.

### 5 August 2026 - Both sessions established; clean SHA restored

- The owner supplied fresh action-time authority to read and enter the exact
  shadow-05 instructor OTP and authorised exactly one replacement instructor
  request if the inaccessible earlier record expired. The original record was
  allowed to expire naturally. Only after a metadata query proved there was no
  current unused instructor token did the visible supported instructor flow
  issue the one authorised replacement request.
- The replacement instructor record was singular, current, unused, school `1`,
  purpose `login`, role `instructor`, and attributable to that request. Its
  value moved only from the Neon query result in process memory into the
  visible existing six-digit form; it was never printed, persisted, copied to
  the clipboard, placed in a command argument, or added to this log. The form
  consumed it once and redirected to the instructor calendar.
- Without inspecting cookies, tokens, local storage, or session contents, the
  supported instructor profile page successfully called its authenticated read
  model and rendered exact synthetic instructor
  `instructor.shadow05.step12@example.invalid`, name
  `Shadow Step 12 Instructor`, and signed-in navigation. Instructor
  authentication is therefore complete.
- Restored the two temporary client files to exact clean source SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`; the detached worktree then had
  no tracked diff and passed `git diff --check`. Deployed that clean source
  only to isolated Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`.
  Deployment `dpl_FKLpQBKToEhbNLSasQTXDKc91hQh` is READY, Production-targeted,
  owns alias `cc-simon-s2-shadow-05.vercel.app`, and provider metadata reports
  the exact Git SHA with no dirty-source marker.
- Against that clean alias, the supported learner profile page rendered exact
  synthetic learner `Shadow Step 13 Learner` with signed-in navigation, and the
  supported instructor profile page rendered the exact synthetic instructor
  with signed-in navigation. Both sessions therefore survived clean-source
  restoration. No legal terms were accepted on the learner's behalf.
- Removed only temporary worktree
  `C:\tmp\cc-simon-shadow05-auth-recovery-c84a37e` after the clean deployment
  and both session checks succeeded. The main workspace still has this living
  log as its only modification; it remains unstaged and uncommitted.
- No Checkout, card entry, payment, webhook delivery, booking, credit
  transaction, BCS attribution, funding source, contract, reconciliation,
  refund, payout, transfer, dispute, Connect action, Step 14, later step, or
  Slice 3 operation occurred during authentication and restoration. The
  mandatory pre-Checkout isolation/ledger/provider gate remains next.

### 5 August 2026 - `test_date_direct` attempted once; stopped on missing launch evidence

- The mandatory pre-Checkout gate passed against clean deployment
  `dpl_FKLpQBKToEhbNLSasQTXDKc91hQh`: Vercel reported exact Git SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6`, READY Production target, exact
  isolated project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, and alias
  `cc-simon-s2-shadow-05.vercel.app`. Supported learner and instructor profile
  pages both remained authenticated on that alias.
- Read-only Neon preflight reconfirmed exact project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, database `neondb`,
  active school `1`, the exact synthetic identities, one booking, one
  `slot_purchase`, one BCS attribution, one funding source, and one processed
  test receipt. Origin counts were `direct_slot=1`, `test_date_direct=0`,
  `one_off_offer=0`, and `captured_request=0`; live receipts and every checked
  prohibited-operation ledger were zero.
- Stripe Dashboard visibly remained in Sandbox. Dedicated destination
  `we_1U0qdyIqhTSdZedS2h8O3RxW` was Active at the exact shadow-05 webhook URL
  with eight events. Obsolete destinations
  `we_1TVRRbIqhTSdZedS5mdOHWWB` and
  `we_1T3B9jIqhTSdZedSZjCfwjxX` remained Disabled. No destination was edited,
  resent, rotated, enabled, disabled, or deleted.
- Through the supported learner Driving Test page, saved the synthetic fixture
  date `2026-08-12`, time `11:00`, and centre `Reading Test Centre`. The normal
  booking page then proved one available recommended 90-minute slot,
  `10:15-11:45`, with the exact existing instructor, saved pickup address,
  zero same-instructor credit, and server price GBP `8250` minor units.
- Created exactly one `test_date_direct` Checkout attempt. Stripe-hosted
  Checkout visibly showed Sandbox, the exact 90-minute test-date item and
  GBP 82.50 amount, the exact synthetic learner email, and a success/cancel
  host belonging to the clean shadow-05 provider deployment. Submitted exactly
  once with Stripe's authorised official bypass-pending test card; no retry or
  second identity was used.
- Stripe completed exact Checkout Session
  `cs_test_a1ZaOg4f77LkkKVjlyN2r64fkdAKZKwIVOr5JOsydpoWipbqNALhtG9qoo`,
  PaymentIntent `pi_3U197HIqhTSdZedS15voowoW`, charge
  `ch_3U197HIqhTSdZedS13sFGPgw`, and balance transaction
  `txn_3U197HIqhTSdZedS1FnpGeGB`. Dashboard evidence shows Succeeded, gross
  `8250`, Stripe fee `226`, net `8024`, the official test-card ending `0278`,
  and funds displayed as available immediately on 5 August. Checkout metadata
  correctly contained origin `test_date_direct`, schema
  `simon_launch_payment_v1`, and immutable candidate
  `d7222fee-25aa-4211-81ae-36a16ac142b6`.
- Dedicated webhook delivery of event
  `evt_1U197IIqhTSdZedShCv0DUxf` returned HTTP 200 and the school-1 receipt is
  `processed` with no last error. Exact Vercel runtime evidence contains one
  `POST action=checkout-test-date` HTTP 200 and one webhook HTTP 200. The only
  logged post-commit errors are the expected isolated SMTP `ESOCKET` failures
  for learner and instructor confirmations; the repair correctly kept them
  outside the retryable core boundary.
- The required origin success gate nevertheless failed. Neon contains exactly
  one new scheduled test-date booking, ID `2`, for `2026-08-12` at
  `10:15-11:45`, purpose `test_date`, test start `11:00`, centre
  `Reading Test Centre`, and list price `8250`; exactly one new
  `slot_purchase`, ID `2`; and exactly one new BCS row, ID `3`. However the
  credit transaction retained null charge and fee snapshots, the booking has
  null `lesson_payment_contract_id`, total funding sources remained `1`, and
  candidate `d7222fee-25aa-4211-81ae-36a16ac142b6` produced zero funding
  sources and zero immutable contracts. Origin count therefore remains
  `test_date_direct=0`, not the required singular `complete` result.
- Read-only source inspection explains the observed stop state as a webhook
  timing gap: when exact Stripe charge/balance evidence is missing at
  materialisation time, `materializeLaunchPaymentContract` returns a pending,
  non-materialised result without inserting a funding source or contract. The
  webhook still completes and its receipt becomes processed, so the now-visible
  immediate Stripe evidence is not consumed without a later reconciliation or
  event replay. Neither was authorised or invoked here.
- Stopped immediately on this first-origin failure. `one_off_offer` and
  `captured_request` were not begun. Final core counts are two bookings, two
  `slot_purchase` rows, two BCS attributions, one funding source, two processed
  test receipts, zero failed receipts, and zero live receipts. Every checked
  earnings, payout, transfer, refund, dispute, connected-account, obligation,
  statement, and delivery-attempt ledger remains exactly zero.
- Existing `direct_slot` contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remains untouched and exactly
  `pending`, with original PaymentIntent `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`, gross `8250`, fee `288`, availability
  `2026-08-07T00:00:00Z`, and null ineligibility/contradiction codes.
  No live-mode, payout, transfer, refund, dispute, Connect/onboarding,
  reconciliation, Step 14, later-step, or Slice 3 action occurred. Step 13
  remains **incomplete and stopped after the single failed
  `test_date_direct` attempt**.

### 6 August 2026 - Webhook timing repair prepared and locally verified

- Continued from exact clean source SHA
  `c84a37ed58701f4711fe5de6d189fc2423620bb6` in isolated worktree
  `C:\tmp\cc-simon-shadow05-evidence-timing-repair-c84a37e` on focused branch
  `codex/simon-shadow05-evidence-timing-repair`. The main workspace retained
  this append-only project log as its only modification; no protected spec was
  edited and no existing shadow-05 financial row was touched.
- Confirmed the timing defect: a launch candidate with temporarily incomplete
  Charge/balance evidence returned a pending, non-materialised result, while
  the slot-booking handler ignored that result and allowed the event receipt to
  become processed. Prepared a narrow repair that fails only this retryable
  evidence state after singular booking, BCS, test-date flag, and post-commit
  notification attempts have completed. A later webhook delivery uses the
  existing-transaction path to materialise evidence without repeating those
  effects. Fully evidenced contracts with genuinely pending Stripe funds still
  complete normally.
- Added an exact historical-candidate recovery gate restricted to
  `test_date_direct`. Its dry run is outside the cron lock and performs no
  audit or financial writes. Before execution it requires the exact school,
  candidate, Checkout Session, PaymentIntent, charge, balance transaction,
  booking, credit transaction, BCS, amount, fee, currency, active mapping,
  instructor, cutover, agreement, and fresh available Stripe evidence, while
  proving zero existing source/contract evidence. Execution additionally
  requires the literal confirmation and audit records, and postflights exactly
  one source, one complete contract, and one booking link. Broad reconciliation
  is not invoked by this path.
- Focused launch and webhook tests passed `37/37`; the complete non-database
  Stripe launch, payout-source, and slot-booking regression set passed
  `150/150`. Repository syntax passed for `199` files, the C1 check passed for
  `271` files, the Stripe Slice 2 rollout review reported no failures, and
  `git diff --check` passed. The historical payout-source rollout manifest
  remains deliberately blocked by pre-existing base-SHA artifact drift; this
  repair neither expands nor resolves that older rollout authority.
- No branch push, PR, deployment, provider dry run, candidate recovery,
  reconciliation, Checkout, payment, webhook replay, refund, payout, transfer,
  dispute, Connect action, `one_off_offer`, `captured_request`, Step 14, later
  step, or Slice 3 action had occurred at this checkpoint. Existing
  `direct_slot` contract `4af03473-9cfd-4051-9606-654245e1b6ab` remained
  untouched.

### 6 August 2026 - Repair committed locally; external publication paused

- Staged only the seven reviewed repair/test files in the isolated worktree and
  created local commit `1bd75e2` (`Repair Stripe launch evidence retries`) on
  branch `codex/simon-shadow05-evidence-timing-repair`. The living project log
  was not staged or committed and remains only in the main workspace.
- The managed action reviewer rejected the attempted GitHub push because
  publishing would export those seven repository files to the external remote
  and required fresh explicit approval after that risk was surfaced. No retry,
  workaround, push, PR, deployment, provider preflight, candidate recovery, or
  later Step 13 origin was attempted. Existing `direct_slot` evidence remains
  untouched.

### 6 August 2026 - Repair published and deployed; recovery dry run blocked before invocation

- After fresh owner approval of the stated external-publication risk, pushed
  exact commit `1bd75e2ac49972fa498ef33c81e5433f2d30945a` to branch
  `codex/simon-shadow05-evidence-timing-repair` and opened draft PR `#349`,
  `https://github.com/coachcarteruk-gif/coachcarter-website/pull/349`, against
  `main`. GitHub reports that exact SHA as the draft PR head.
- Bound only the isolated worktree to Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` and deployed the exact clean repair
  commit. Deployment `dpl_9K2mX1q318veJVK1wCXFT9oUyEuT` is READY on the
  Production target, owns alias `cc-simon-s2-shadow-05.vercel.app`, and provider
  metadata reports exact Git SHA
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`, branch
  `codex/simon-shadow05-evidence-timing-repair`, and no dirty-source marker.
- Supported profile-page checks on the repaired alias proved both existing
  sessions remained valid. The learner profile rendered exact synthetic
  `Shadow Step 13 Learner`; the instructor profile read model rendered exact
  synthetic `Shadow Step 12 Instructor` and
  `instructor.shadow05.step12@example.invalid`. No cookie, token, browser
  storage, credential store, or authentication record was inspected, and no
  legal term was accepted.
- A fresh read-only Neon query against project `shiny-bonus-66942766`, branch
  `br-empty-cell-za5kh6nr`, database `neondb`, reconfirmed one exact school-1
  `slot_purchase` ID `2`, booking ID `2`, and BCS ID `3`; gross `8250`; null
  local fee snapshots; scheduled `test_date`; no refund; null booking contract
  link; zero target sources; zero target contracts; `direct_slot=1`; and
  `test_date_direct=0`.
- Attempted to obtain the deployed shadow-operation credential without
  exposing or changing it by pulling the isolated project's Production
  environment into one exact temporary `C:\tmp` file. Vercel correctly
  exported the sensitive value as empty, so the client-side length guard
  stopped before sending any HTTP request; the temporary file was removed in a
  `finally` block. No valid credential exists in the process environment.
- A subsequent presence/length-only check of repository-local environment
  files was rejected by the managed safety reviewer as credential probing from
  a new source. The files were not searched and no workaround was attempted.
  Therefore neither the deployed read-only recovery gate nor the authorised
  execution endpoint has been invoked. Candidate
  `d7222fee-25aa-4211-81ae-36a16ac142b6` remains missing, `one_off_offer` and
  `captured_request` remain unstarted, and existing `direct_slot` evidence
  remains untouched.

### 6 August 2026 - Approved root credential check found no key

- After fresh owner approval, inspected only repository-root `.env*` files for
  the presence and minimum length of `STRIPE_LAUNCH_SHADOW_CRON_SECRET`, without
  printing or persisting any value. No root file contained the key.
- The managed safety reviewer rejected extending the same value-suppressed
  check to nested repository `.env*` files because that was a broader credential
  scope requiring separate explicit approval. No nested file was searched, no
  deployed dry-run or recovery request was sent, and candidate
  `d7222fee-25aa-4211-81ae-36a16ac142b6` remains unchanged. `one_off_offer` and
  `captured_request` remain unstarted; existing `direct_slot` evidence remains
  untouched.

### 6 August 2026 - Approved nested credential check also found no key

- After separate owner approval, checked nested repository `.env*` files for
  only the presence and minimum length of
  `STRIPE_LAUNCH_SHADOW_CRON_SECRET`, excluding `.git` and dependency content
  and never printing or persisting a value. The result was zero matches.
- The installed Vercel CLI exposes no decrypt or reveal option. A proposed
  deployment-ID-specific read-only environment pull for exact READY deployment
  `dpl_9K2mX1q318veJVK1wCXFT9oUyEuT` was rejected by the managed safety reviewer
  as a new credential source requiring separate explicit approval. It was not
  executed. No dry-run or recovery HTTP request was sent; the candidate and
  existing `direct_slot` evidence remain unchanged.

### 6 August 2026 - Deployment-specific credential pull unavailable; recovery blocked

- After separate owner approval, attempted exactly one deployment-ID-specific
  read-only Vercel environment pull for READY deployment
  `dpl_9K2mX1q318veJVK1wCXFT9oUyEuT`, with value output suppressed and an exact
  temporary-file cleanup guard. Vercel rejected the operation before creating
  a file because deployment-specific pulls require an `INITIALIZING`
  deployment and this exact deployment is already `READY`.
- The Production environment export provides an empty placeholder for this
  sensitive value, the process environment has no valid value, and approved
  root and nested repository `.env*` checks found no key. All safe existing
  credential sources are therefore exhausted. No application dry run or
  recovery execution was invoked.
- The timing repair remains implemented, tested, published in draft PR `#349`,
  and deployed at exact SHA
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`. Candidate
  `d7222fee-25aa-4211-81ae-36a16ac142b6` remains unmaterialised;
  `one_off_offer` and `captured_request` remain unstarted. Existing
  `direct_slot` contract `4af03473-9cfd-4051-9606-654245e1b6ab` remains
  untouched. Step 13 is blocked before the deployed recovery dry run pending
  access to the original shadow-operation credential or new authority to
  change configuration.

### 6 August 2026 - Exact `test_date_direct` candidate recovered complete

- The owner explicitly authorised replacing only isolated shadow-05's
  Production `STRIPE_LAUNCH_SHADOW_CRON_SECRET`, redeploying exact repair commit
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`, and using the replacement for the
  exact candidate recovery. No other Vercel variable, Stripe credential, or
  webhook destination was changed.
- Generated a fresh strong replacement only in process memory. Two attempted
  `vercel env update` calls were rejected by Vercel's sensitive-variable update
  API before changing provider state. The documented same-key force-replace
  path then overwrote exactly the existing sensitive Production
  `STRIPE_LAUNCH_SHADOW_CRON_SECRET` record. The value was passed through
  redirected standard input without a command-line argument, file, log, or
  printed output.
- Redeployed the unchanged clean isolated worktree. Deployment
  `dpl_8KnJgNG4qgZGXm8K3XfYx4w5cgVs` is READY on isolated project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, Production-targeted, owns alias
  `cc-simon-s2-shadow-05.vercel.app`, and provider metadata reports exact Git
  SHA `1bd75e2ac49972fa498ef33c81e5433f2d30945a`, exact repair branch, and no
  dirty marker.
- The deployed exact-candidate dry run performed only immutable Stripe reads
  and exact local identity checks. It returned `ready`, `dry_run=true`, school
  `1`, origin `test_date_direct`, candidate
  `d7222fee-25aa-4211-81ae-36a16ac142b6`, booking `2`, credit transaction `2`,
  BCS `3`, exact Checkout Session, PaymentIntent, charge and balance
  transaction, gross `8250`, Stripe fee `226`, and currency `gbp`.
- Invoked the authorised execution endpoint exactly once with the literal
  confirmation. It returned `complete`, `dry_run=false`, and the same exact
  identity. The replacement bearer and random byte buffer were then cleared
  from process memory, and the secret-free temporary runner was removed.
- Read-only Neon postflight proved exactly one target funding source, exactly
  one immutable contract, and exactly one booking link. Contract
  `d7222fee-25aa-4211-81ae-36a16ac142b6` is origin `test_date_direct`, regime
  `launch`, evidence `complete`, exact gross `8250`, fee `226`, GBP, exact
  PaymentIntent `pi_3U197HIqhTSdZedS15voowoW`, charge
  `ch_3U197HIqhTSdZedS13sFGPgw`, balance transaction
  `txn_3U197HIqhTSdZedS1FnpGeGB`, available at
  `2026-08-05T18:00:35.000Z`, with null contradiction and ineligibility codes.
  Source evidence is also `complete` and singular. Audit postflight found
  exactly one recovery-started and one recovery-completed record.
- Origin counts are now `direct_slot=1` and `test_date_direct=1`.
  Existing `direct_slot` contract `4af03473-9cfd-4051-9606-654245e1b6ab`
  remains exactly `pending`, with its original PaymentIntent, charge, balance
  transaction, gross `8250`, fee `288`, GBP, availability
  `2026-08-07T00:00:00.000Z`, and null contradiction/ineligibility codes. It was
  not selected, replayed, reconciled, or changed.
- `one_off_offer` and `captured_request` had not begun at this checkpoint. No
  payout, earning, transfer, refund, dispute, Connect, Step 14, later-step, or
  Slice 3 action occurred.

### 6 August 2026 - `one_off_offer` completed singularly through Sandbox Checkout

- Read-only Neon preflight on exact project `shiny-bonus-66942766`, branch
  `br-empty-cell-za5kh6nr`, database `neondb` proved one eligible synthetic
  learner, no pending offers, active instructor availability, and no conflict
  for Thursday 13 August 2026 at `09:00-10:30`. Standard Lesson was active at
  the server-owned price of GBP `8250` for 90 minutes. The learner's
  `terms_accepted_at` remained null.
- The calendar offer modal exposed a viewport defect at the browser's 720px
  height: its action sat wholly outside the visible viewport. Keyboard and
  scrolling checks sent no POST and Neon remained at zero offers. Continued
  through the supported instructor Dashboard payment-link surface, which uses
  the same fixed `create-offer` contract and provides a scrollable modal.
- Created exactly one fixed, non-repeating payment-link offer through visible
  instructor UI for the existing synthetic learner. Offer `1` is manual,
  Standard Lesson, GBP `8250`, scheduled `2026-08-13` at `09:00-10:30`, with
  null `max_repeat_weeks`. Isolated SMTP/SMS delivery failed as expected, but
  the product rendered the acceptance link and held the slot once.
- Opened that token on the isolated shadow-05 host. The acceptance page visibly
  showed the exact learner, instructor, date, time, duration, and GBP `82.50`.
  Stripe-hosted Checkout visibly showed Sandbox, the exact item and amount,
  and the immutable deployment-specific shadow-05 success/cancel host.
- Submitted exactly one card payment with Stripe's authorised official
  bypass-pending test card ending `0278`. No retry or second Checkout was
  created. Stripe returned to isolated `offer-success.html`; the initial
  product message was `Booking in progress` while webhook processing settled.
- Read-only Neon postflight proved offer `1` accepted once, booking `3`
  scheduled once, `slot_purchase` credit transaction `3` once, BCS `4` once,
  payout funding source `4` once, and immutable contract
  `72c4e43b-69f0-49f1-b459-9ff2a0d6c4bf` once. The contract is origin
  `one_off_offer`, regime `launch`, evidence `complete`, gross `8250`, Stripe
  fee `226`, GBP, PaymentIntent `pi_3U1MqlIqhTSdZedS1Xgm22dO`, charge
  `ch_3U1MqlIqhTSdZedS1wYygD98`, balance transaction
  `txn_3U1MqlIqhTSdZedS1nRaBzIf`, funds available
  `2026-08-06T08:40:28.000Z`, and null contradiction/ineligibility codes.
  Source evidence is singular and `complete`; the booking links to that exact
  contract.
- Receipt `evt_1U1MqnIqhTSdZedS9rLNdBI9` is test mode, singular, `processed`,
  and has null last error. Exact deployment runtime logs show the first webhook
  delivery returned HTTP 500 after isolated SMTP connection refusal, followed
  by successful HTTP 200 retry processing. This exercised the repaired retry
  path without duplicating the offer, booking, slot purchase, BCS, funding
  source, contract, or receipt.
- Origin counts are now exactly `direct_slot=1`, `test_date_direct=1`, and
  `one_off_offer=1`. Protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remains unchanged and pending with its
  original PaymentIntent, charge, balance transaction, gross `8250`, fee
  `288`, GBP, availability `2026-08-07T00:00:00.000Z`, and null contradiction
  and ineligibility codes. No reconciliation, replay, payout, earning,
  transfer, refund, dispute, Connect, Step 14, later-step, or Slice 3 action
  occurred. The next and only remaining Step 13 origin is `captured_request`.

### 6 August 2026 - `captured_request` stopped pending before capture

- Read-only Neon preflight on exact project `shiny-bonus-66942766`, branch
  `br-empty-cell-za5kh6nr`, database `neondb` proved no pending requests and no
  booking conflict for Friday 14 August 2026 at `09:00-10:30`. The instructor's
  original `request_to_book` setting was false.
- Enabled `request_to_book` once through the visible instructor Profile and
  confirmed it in Neon. Through the visible signed-in learner booking UI,
  selected the exact available Standard Lesson request for Friday 14 August at
  `09:00-10:30`; the confirmation visibly stated GBP `82.50` would only be
  charged if the instructor accepted.
- Stripe-hosted Sandbox Checkout visibly showed the exact lesson request and
  GBP `82.50` hold semantics. Submitted exactly one authorisation with Stripe's
  authorised official bypass-pending test card ending `0278`. No retry or
  second Checkout was created.
- Read-only Neon post-authorisation proved exactly one pending request, ID `1`,
  payment method `card_hold`, amount `8250`, Checkout Session
  `cs_test_a1ss4vbYdGOIRFCx6TVvS4jAW06IYVKAkpp4q8grrob8thxUUf4vUL31aX`, and
  PaymentIntent `pi_3U1MxLIqhTSdZedS2bi13Uox`. It has null booking,
  hold-transaction, decision, and release fields and expires at
  `2026-08-08T08:47:17.748Z`.
- The visible instructor Dashboard correctly reported one future request and
  linked to `/instructor/?date=2026-08-14`. On two supported navigations plus a
  direct alias reload, the visible Calendar consistently rendered the exact
  date and availability but omitted the request card and therefore exposed no
  Accept or Decline control. Neon continued to prove the request was pending.
- Stopped under the exercise's pending/ambiguity rule. Did not call
  `accept-request` directly, manufacture a UI control, retry Checkout, capture
  the PaymentIntent, create a booking, or materialise a `captured_request`
  contract. Restored the instructor's original `request_to_book=false` through
  the visible Profile and confirmed it in Neon.
- Final stopped-state read proved exactly one pending request, zero bookings in
  the requested slot, and zero `captured_request` contracts. Protected
  direct-slot contract `4af03473-9cfd-4051-9606-654245e1b6ab` remains unchanged
  and pending with gross `8250`, fee `288`, its original PaymentIntent, charge,
  balance transaction and availability, and null contradiction/ineligibility
  codes. No payout, earning, transfer, refund, dispute, Connect, Step 14,
  later-step, or Slice 3 action occurred. Step 13 remains incomplete pending a
  supported visible instructor acceptance path or separately authorised scope
  to repair that UI defect.

### Next-session handover - calendar request card repair and Step 13 resume

- Begin from exact repair commit
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`, but do not add the calendar fix
  to draft PR `#349`. Create a separate tightly scoped branch named
  `codex/simon-shadow05-calendar-request-card-repair` from that exact commit so
  the evidence-timing repair remains independently reviewable.
- The living log is intentionally modified but unstaged in the primary
  workspace while Step 13 is incomplete. Preserve it and all unrelated user
  changes. Do not switch or clean that dirty worktree; use a separate worktree
  for the new branch if needed.
- First read `AGENTS.md`, `CLAUDE.md`, `PROJECT.md`,
  `docs/stripe-connect.md`, and this entire living log. Inspect the visible
  Calendar read/render path for `/api/instructor?action=list-requests` and add
  the smallest focused test that reproduces the missing future request card.
  Keep the repair UI/read-model-only unless evidence proves otherwise; do not
  change `accept-request`, capture, booking, ledger, webhook, refund, payout,
  transfer, Connect, or other money mutation behaviour.
- Validate the focused repair locally, review the exact diff, publish it as a
  separate draft PR, and deploy only its exact clean commit to isolated
  shadow-05. Do not change any environment variable or deploy to another
  project. Verify the alias and deployed Git SHA before browser use.
- Before touching request ID `1`, query isolated Neon project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, database `neondb`.
  Continue only if the request is still singular, `pending`, unbooked,
  unreleased, unexpired, and its exact Sandbox PaymentIntent remains safely
  capturable. Its recorded expiry is `2026-08-08T08:47:17.748Z`. If it is no
  longer an exact valid pending candidate, stop and report; do not create or
  submit a replacement request without new owner authority.
- If valid, enable `request_to_book` only as needed through visible Profile UI,
  confirm the repaired Calendar visibly renders the exact 14 August
  `09:00-10:30` request, and click its Accept control exactly once. Do not call
  the mutation endpoint directly and do not retry on any error, pending result,
  duplicate, contradiction, or ambiguity. Restore the original
  `request_to_book=false` setting afterward.
- Declare Step 13 complete only after read-only postflight proves exactly one
  accepted request, one booking, singular ledger/funding-source links, and one
  immutable `captured_request` contract with complete Stripe fee/balance-
  transaction/availability evidence and null contradiction/ineligibility
  codes. Recheck all prior origin counts and protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` unchanged. Append the outcome here;
  do not begin Step 14 or Slice 3.

### 6 August 2026 - Calendar request-card repair and Step 13 completed

- Preserved the dirty primary workspace and its unstaged living-log change.
  Created isolated worktree
  `C:\\tmp\\cc-simon-shadow05-calendar-request-card-repair` on fresh branch
  `codex/simon-shadow05-calendar-request-card-repair` from exact commit
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`. Draft PR `#349` was not
  modified.
- Diagnosed a split-read Calendar failure: `schedule-range` and
  `list-requests` were fetched together, but the Calendar parsed and threw on
  a failed schedule response before consuming a successful request response.
  Dashboard parsed its independent reads and therefore still reported the
  request. The Calendar's later availability/date render then obscured the
  schedule error, leaving the exact date and availability visible without the
  request card.
- Added focused browser regression
  `tests/instructor-calendar-request-card.spec.js`, proving a successful exact
  future pending request still renders with visible Accept and Decline controls
  when the independent schedule-range read fails. The minimum production fix
  only moves existing request-response parsing ahead of schedule parsing in
  `public/instructor/index.js`; no API, mutation, Stripe, booking, webhook,
  ledger, refund, payout, transfer, Connect, or configuration code changed.
- Verification passed: focused Calendar plus existing day-planner tests `4/4`,
  syntax check `199` files, C1 control check `271` files, and
  `git diff --check`. Reviewed diff contains only the two intended files.
  Clean repair commit
  `07871219afc9fc66084f2f8bc1bf609b23802dfd` has exact parent
  `1bd75e2ac49972fa498ef33c81e5433f2d30945a`. Published separate draft PR
  `#350`, `Render pending lesson requests on instructor Calendar`.
- Deployed only exact clean repair commit `07871219...` to existing isolated
  Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`. Deployment
  `dpl_2PhCs5DreBMCxHNducTRQpZocnVd` is READY and Production-targeted. Before
  browser interaction, Vercel control-plane evidence proved the exact Git SHA,
  correct branch/project, no alias error, and ownership of
  `https://cc-simon-s2-shadow-05.vercel.app`. No environment variable or
  project setting changed.
- Mandatory read-only Neon preflight on exact project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, database `neondb`
  at server time `2026-08-06T10:09:25.595351Z` proved request ID `1` singular,
  pending, unbooked, unreleased, and unexpired until
  `2026-08-08T08:47:17.748Z`. It retained exact PaymentIntent
  `pi_3U1MxLIqhTSdZedS2bi13Uox`, GBP `8250`, Friday 14 August 2026
  `09:00-10:30`, zero slot bookings, and zero `captured_request` source or
  contract rows. Stripe's visible Sandbox dashboard independently showed the
  same GBP `82.50` PaymentIntent as `Uncaptured`, with a live Capture control
  and latest charge `ch_3U1MxLIqhTSdZedS2IivkS3r`.
- Enabled `request_to_book` only through the visible instructor Profile. The
  repaired deployed Calendar visibly rendered exactly one Friday 14 August
  request card at `09:00-10:30` for `Shadow Step 13 Learner`, labelled
  `Card held`, with singular Accept and Decline controls. Invoked that visible
  Accept control exactly once. The browser-control call timed out while the
  native confirmation/input command was resolving, so no second click or
  mutation retry was attempted. Immediate read-only Neon state proved that the
  single original interaction had completed once. Restored
  `request_to_book=false` through the visible Profile and confirmed it in the
  final database read.
- Read-only Neon postflight proved request ID `1` is accepted once with booking
  ID `4`; the exact slot has one scheduled 90-minute booking, one
  `slot_purchase` credit transaction ID `4`, one BCS row ID `6`, one payout
  funding source ID `5`, and one linked immutable payment contract
  `c85048ef-573d-4a4e-a978-3df54cd18b1d`. Every booking, credit, BCS, source,
  and contract link is singular and same-school; no slot release or refund
  marker exists.
- The `captured_request` source and contract are both `complete`, origin/regime
  `captured_request`/`launch`, gross `8250`, Stripe fee `226`, GBP, split
  `9000` bps, exact PaymentIntent `pi_3U1MxLIqhTSdZedS2bi13Uox`, charge
  `ch_3U1MxLIqhTSdZedS2IivkS3r`, balance transaction
  `txn_3U1MxLIqhTSdZedS2iThfXkc`, and funds available at
  `2026-08-06T10:12:55.000Z`. Contract ineligibility and contradiction codes
  are null; source contradiction is null. Stripe's visible Sandbox postflight
  independently showed `Succeeded`, GBP `82.50 captured`, Stripe fee GBP
  `2.26`, and net GBP `80.24` for the exact payment.
- Receipt `evt_3U1MxLIqhTSdZedS2k1Y9vWJ` is test mode, singular,
  `payment_intent.succeeded`, `processed`, and has null last error. Duplicate
  receipt-event count is zero. Exact materialisation counts are booking `1`,
  slot purchase `1`, BCS `1`, funding source `1`, and contract `1`.
- Final origin counts are exactly `direct_slot=1`, `test_date_direct=1`,
  `one_off_offer=1`, and `captured_request=1` for both contracts and funding
  sources. Protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remains unchanged and pending with
  its original PaymentIntent, charge, balance transaction, gross `8250`, fee
  `288`, GBP, availability `2026-08-07T00:00:00.000Z`, fingerprint, and null
  contradiction/ineligibility codes.
- A separate read-only prohibited-effect postflight returned zero exact-payment
  refund events, zero contract refund intents, zero legacy booking earnings,
  zero instructor or school payout line items for booking `4`, zero launch
  earnings for the captured-request contract, and zero school-1 payout
  transfers.
- Step 13 is complete. No direct mutation endpoint call, second acceptance,
  replacement request, Checkout Session, card entry, refund, payout, earning,
  transfer, dispute, Connect action, environment change, Step 14, later step,
  or Slice 3 action occurred. The Stripe plugin was neither installed nor
  used. This living-log update remains unstaged in the preserved primary
  workspace.

### 6 August 2026 - Calendar request-card repair PR merged

- After PR `#349` was squash-merged as commit
  `a332e400fa3d5deddc8f22d4b14ceef4028495f3`, rebased the separate
  calendar repair onto that exact `main` commit. The corrected branch remained
  one commit and two files only: `public/instructor/index.js` and
  `tests/instructor-calendar-request-card.spec.js`. Its final repair commit was
  `26727e088216906be3333231ddc1d617acddc0f0` with exact parent `a332e400...`.
- Repeated focused verification passed locally after the rebase: Calendar plus
  existing day-planner tests `4/4`, syntax check `199` files, C1 control check
  `271` files, and `git diff --check`. All four Vercel deployment contexts and
  Vercel Preview Comments reported success for the corrected PR head.
- GitHub Actions then experienced a declared major outage affecting hosted
  runners, workflow starts, and webhook triggers. Two PR workflow attempts
  were cancelled before executing repository steps; the dependent Playwright
  jobs were skipped. A manually requested retry for run `31125542938` was
  accepted for exact head `26727e08...` but remained queued with no jobs in the
  Actions API during the outage. These cancellations were infrastructure
  outcomes, not test failures.
- The owner reported the PR UI green and squash-merged PR `#350`, `Render
  pending lesson requests on instructor Calendar`. Post-merge GitHub metadata
  independently confirms state `MERGED` at `2026-08-06T21:55:13Z`, one commit,
  the exact two intended files, and squash-merge commit
  `e89a99bf4e14216ae04bbd79e6f54b2e1d263150`. A direct remote-ref read proves
  `refs/heads/main` is exactly `e89a99bf...`.
- At this verification point GitHub still reported the Actions major outage,
  the old retry remained queued in the API, and no post-merge push workflow for
  `e89a99bf...` was visible, consistent with GitHub's published webhook
  throttling. The merge and remote `main` state are verified; a clean
  post-outage Actions result is not independently available from the API yet.
- No code, deployment, environment, Stripe, booking, ledger, refund, payout,
  transfer, Connect, Step 14, later-step, or Slice 3 action was taken during
  this merge follow-up. The preserved primary workspace remains on its original
  branch with this living log modified and unstaged.

### 7 August 2026 - Step 14 cross-cutting Slice 2 validation completed

- Preserved the deliberately dirty primary workspace and both pre-existing
  clean worktrees. Created isolated worktree
  `C:\\tmp\\cc-simon-shadow05-step14-cross-cutting-validation` on branch
  `codex/simon-shadow05-step14-cross-cutting-validation` from exact clean
  `origin/main` commit `cca163ebcba338fb160e88b805e7816796b5398a`.
  `HEAD`, `origin/main`, and merge-base matched, and the required ancestor check
  for `cca163eb...` passed.
- Before publication, GitHub Actions run `31129319266` for exact baseline
  `cca163ebcba338fb160e88b805e7816796b5398a` was independently checked and
  reported completed/success for workflow `ci`.
- Re-read the complete required project, product, technical, rollout, Stripe,
  and living-log sources. Reverified the LF-normalised protected hashes exactly:
  product specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed.
- Local gates passed before external validation: repository syntax `199`
  files, C1 controls `271` files, Slice 2 rollout review `14/14` with no
  failures and static status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, and `80/80`
  focused Playwright tests covering payment contracts, shadow operations/auth,
  required audits, rollout review, schema/fixture foundation, webhook
  reliability, and instructor-login audit failure. The required triple-gated,
  rollback-only `stripe-launch-payment-contracts.integration.spec.js` suite
  passed `8/8` with zero skips against a disposable loopback PostgreSQL 17.7
  production-shaped aggregate. It was not connected to production or
  shadow-05 and was stopped after the run.
- The reproducible matrix passed: delayed balance-transaction evidence remains
  pending without guessed values and controlled reconciliation promotes only
  exact available evidence; webhook and reconciliation replay are idempotent;
  exact fee mismatch, amount/currency/Stripe-link mismatch, and one-payment-to-
  many-lessons are rejected; pre-cutover payment is ineligible; reschedule
  continuity is conserved; cross-school candidates remain untouched; shadow
  auth fails closed; required start/completion auditing and audit-write failure
  stop behaviour hold; and prohibited money/effect writers remain absent.
- Reverified isolated identities read-only before the operation: exact Vercel
  project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, Neon project
  `shiny-bonus-66942766`, branch `br-empty-cell-za5kh6nr`, database `neondb`,
  and school `1`. Stripe's dashboard visibly showed Sandbox/test mode account
  `acct_1QUSsNIqhTSdZedS`; programmatic gates also returned test mode. Dedicated
  active webhook destination `we_1U0qdyIqhTSdZedS2h8O3RxW` remained bound to
  `https://cc-simon-s2-shadow-05.vercel.app/api/webhook` for the eight approved
  events. Historical transient HTTP 500 deliveries were followed by successful
  HTTP 200 retries, and receipt postflight remained singular and processed.
- Read-only preflight proved all four approved origins singular, with the three
  prior contracts complete and protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` still pending. Stripe independently
  showed its exact test-mode GBP `82.50` payment succeeded, fee GBP `2.88`, net
  GBP `79.62`, and funds available on 7 August. Local evidence retained exact
  PaymentIntent `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`, gross `8250`, fee `288`, GBP, availability
  `2026-08-07T00:00:00.000Z`, one booking link, and null contradiction and
  ineligibility codes. Both deployed unauthenticated reconciliation and expiry
  requests returned HTTP 401 without writes.
- Before any possible shadow write, presented the exact singular reconciliation
  operation, exact project/database/school/contract identities, expected
  contract/source/audit writes, replay protection, prohibited effects, and
  stop conditions; the owner gave fresh action-time confirmation. The existing
  sensitive bearer could not be retrieved because the provider returned no
  value. Work stopped before calling the endpoint, and the owner separately
  authorised replacement of only `STRIPE_LAUNCH_SHADOW_CRON_SECRET`, an
  unchanged exact-SHA redeploy, and one use.
- The first authorised replacement/deploy produced READY deployment
  `dpl_55NnBN1BwjSRhNo2PcgWUgauLjeb`, but newline handling and a local response-
  parser mismatch stopped the procedure before the endpoint was called. The
  bearer was cleared; read-only Neon evidence proved the contract still
  pending, no operation audits, and every prohibited effect still zero. No
  retry was inferred. The owner then gave fresh recovery confirmation for a
  newline-free replacement, unchanged exact-SHA deployment verification, and
  one request.
- Replaced only the sensitive shadow bearer without a trailing newline and
  redeployed unchanged clean app SHA
  `07871219afc9fc66084f2f8bc1bf609b23802dfd`. Connected Vercel postflight
  reports current READY Production-target deployment
  `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`, exact project, exact SHA, and alias
  `cc-simon-s2-shadow-05.vercel.app`. The singular authenticated reconciliation
  request was then sent exactly once. It returned HTTP 200, `ok=true`,
  `shadow=true`, programmatic test mode, school `1`, `checked=1`,
  `pending_contracts=1`, `unmaterialized_origins=0`, `completed=1`, and all
  pending/contradictory/ineligible/failed counts zero. The exact contract result
  was `complete`. The bearer and transient random bytes were cleared, and no
  second request was sent.
- School-scoped read-only Neon postflight proved the direct contract and source
  singular and complete, with every immutable Stripe identity, amount,
  currency, availability time, fingerprint, and booking link conserved. All
  four origins are exactly one complete contract each; pending contracts and
  unmaterialized origins are zero. Audit log counts are exactly one
  `stripe-launch-shadow-reconcile-payments-started` and one
  `stripe-launch-shadow-reconcile-payments`; completion details record
  `checked=1`, `completed=1`, and zero pending, contradictory, and failed.
  Stripe receipts remain exactly four test-mode processed rows, with zero
  failed, processing, live, or duplicate event IDs.
- Final prohibited-effect counts for school `1` are all exactly zero:
  `stripe_launch_booking_earnings`, `payout_runs`,
  `instructor_payout_batches`, `stripe_launch_transfer_intents` and attempts,
  `refund_intents` and attempts, `connect_account_state_events`,
  `payout_statements` and delivery attempts, `payment_disputes` and events,
  `instructor_payout_obligations` and applications, and
  `payout_batch_earning_dispositions`. No Checkout Session, PaymentIntent,
  payment, webhook destination, Connect resource, schema/migration, direct SQL
  mutation, payout, earning, transfer, refund, dispute, onboarding, bank payout,
  live-mode, or CoachCarter production mutation was created or performed. The
  Stripe plugin was neither installed nor used.
- Step 14 is complete. This documentation-only handover does not accept Slice
  2 and grants no authority for Step 15, Step 16, Step 17, Slice 3, or any later
  operation.

### 8 August 2026 - Step 15 prohibited-effect postflight completed

- Fetched current remote refs and independently verified PR `#352` is merged.
  Its source commit is `80b000dbb4de0557cfdce2c76e0c8e538e406bc3`,
  its squash-merge commit is
  `ec648a578949fe8e585fee13f125df74311743b2`, and that merge is the exact
  current `origin/main` tip. Step 13 baseline
  `cca163ebcba338fb160e88b805e7816796b5398a` remains an ancestor. Both the PR
  head diff and squash-merge diff contain only this living project log.
  GitHub Actions workflow `ci` run `31225124878` for the exact merge commit was
  `completed/success` before Step 15 began.
- The primary workspace no longer matched the earlier handover description: it
  was already clean on `main` at the verified PR #352 merge rather than dirty on
  the earlier repair branch. It was inspected read-only and left unchanged.
  The three named preserved worktrees were also clean and left untouched. Step
  15 ran in isolated worktree
  `C:\\tmp\\cc-simon-shadow05-step15-prohibited-effects-postflight` on branch
  `codex/simon-shadow05-step15-prohibited-effects-postflight` from exact
  `origin/main` `ec648a578949fe8e585fee13f125df74311743b2`.
- Reverified the protected LF-normalised SHA-256 hashes exactly: product
  specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and technical implementation plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed.
- Connected provider metadata reconfirmed exact Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, name `cc-simon-s2-shadow-05`, current
  READY production-target deployment `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`,
  deployed Git SHA `07871219afc9fc66084f2f8bc1bf609b23802dfd`, and owned alias
  `cc-simon-s2-shadow-05.vercel.app`. Connected Neon metadata and explicitly
  school-scoped reads reconfirmed project `shiny-bonus-66942766`, default
  production branch `br-empty-cell-za5kh6nr`, database `neondb`, and
  `school_id=1` without a database write.
- Stripe's visible banner and programmatically inspected dashboard route and
  accessible account state reconfirmed Sandbox/Test mode for exact account
  `acct_1QUSsNIqhTSdZedS`. Dedicated destination
  `we_1U0qdyIqhTSdZedS2h8O3RxW` remains active, singularly bound to
  `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`, and subscribed to
  eight events. The Sandbox list contained only this singular shadow-05
  binding plus recorded historical destinations. A separate read-only
  live-mode destination view contained no binding to the shadow-05 URL. No
  webhook destination was created, edited, or invoked, and the Stripe plugin
  was neither installed nor used.
- Fresh read-only Neon postflight proved exactly one complete contract and one
  complete payout funding source for each approved origin:
  `direct_slot=1`, `test_date_direct=1`, `one_off_offer=1`, and
  `captured_request=1`. Unsupported origins, pending contracts,
  contradictory contracts, ineligible post-cutover contracts, and
  unmaterialized origins are each exactly zero. The launch configuration
  remains `simon_launch_v1` in `shadow` mode with no activation or pause.
- Protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remains singular with origin/regime
  `direct_slot`/`launch`, `evidence_status=complete`, gross `8250`, Stripe fee
  `288`, currency `gbp`, split `9000` bps, PaymentIntent
  `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`, and funds availability
  `2026-08-07T00:00:00.000Z`. It retains exactly one active scheduled or
  chargeable booking link. Its singular funding source remains
  `stripe_backed`, `available`, and complete, with gross `8250`, fee `288`,
  payable pool `7962`, refundable pool `7962`, matching payment origin,
  currency, Stripe IDs, and availability. Contract ineligibility and
  contradiction codes and source contradiction code remain null.
- School `1` audit evidence remains exactly one
  `stripe-launch-shadow-reconcile-payments-started` row and exactly one
  `stripe-launch-shadow-reconcile-payments` row. Both retain operation
  `reconcile_payments` and exact Vercel project identity
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`; completion details remain `checked=1`,
  `completed=1`, `pending=0`, `contradictory=0`, and `failed=0`. No raw IP,
  credential, request header, or sensitive payload was inspected or recorded.
- School `1` Stripe receipts remain exactly `4` total, `4` test-mode, and `4`
  processed, with `0` live, `0` failed, `0` processing, and `0` duplicate
  Stripe event IDs.
- The complete school-1 prohibited-effect matrix remains exactly zero:
  `stripe_launch_booking_earnings=0`, `payout_runs=0`,
  `instructor_payout_batches=0`, `stripe_launch_transfer_intents=0`,
  `stripe_launch_transfer_attempts=0`, `refund_intents=0`,
  `refund_attempts=0`, `connect_account_state_events=0`,
  `payout_statements=0`, `payout_statement_delivery_attempts=0`,
  `payment_disputes=0`, `payment_dispute_events=0`,
  `instructor_payout_obligations=0`,
  `instructor_payout_obligation_applications=0`, and
  `payout_batch_earning_dispositions=0`.
- Local verification passed: repository syntax `199` files, Slice 2 rollout
  review `14/14` with no failures and static status
  `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, protected hashes exact, and
  `git diff --check`. The isolated diff is documentation-only and changes only
  this living log; no protected document or production code changed.
- Step 15 is complete. No reconciliation, expiry, mutation endpoint, webhook
  replay, payment, provider resource, deployment, environment, database,
  schema, earning, payout, transfer, refund, dispute, obligation, statement,
  Connect, bank-payout, live-mode, or CoachCarter production mutation occurred.
  Step 16, Step 17, formal Slice 2 acceptance, and Slice 3 have not begun. This
  handover grants no authority for any of them.

### 8 August 2026 - Step 16 final Slice 2 evidence package completed

- Preserved the primary workspace and every pre-existing worktree exactly as
  found. The primary workspace was clean at the prior Step 15 baseline
  `ec648a578949fe8e585fee13f125df74311743b2`. One separate worktree contained
  pre-existing user changes and was left untouched. Step 16 ran only in fresh
  isolated worktree
  `C:\\tmp\\cc-simon-shadow05-step16-final-evidence-package` on branch
  `codex/simon-shadow05-step16-final-evidence-package`.
- Fetched current remote refs and independently verified PR
  [#353](https://github.com/coachcarteruk-gif/coachcarter-website/pull/353) is
  merged. Its source commit is
  `fe75c7a70f565fe73a6dd41d62ef08df4959b0e1`, source branch is
  `codex/simon-shadow05-step15-prohibited-effects-postflight`, and squash merge
  `b9aee19d71598364c4d6ff33d9ad4f4631535890` is exact current `origin/main`.
  Previous Step 15 baseline `ec648a578949fe8e585fee13f125df74311743b2`
  remains an ancestor, and PR #353 changed only this living log.
- Exact merge-commit GitHub Actions push run
  [31227210226](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31227210226),
  workflow `ci`, branch `main`, completed `success`; it was created
  `2026-08-07T23:28:01Z` and completed/updated `2026-08-07T23:29:43Z`.
- Reverified the protected LF-normalised SHA-256 hashes exactly: product
  specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and technical implementation plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed.
- Connected read-only provider metadata reconfirmed Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`, name `cc-simon-s2-shadow-05`, current
  `READY` production-target deployment `dpl_ADaLL8crPKphQtwVfZtNbZCJtKun`,
  exact deployed app SHA `07871219afc9fc66084f2f8bc1bf609b23802dfd`,
  and alias `cc-simon-s2-shadow-05.vercel.app`. Neon remained exact project
  `shiny-bonus-66942766`, default/primary ready branch
  `br-empty-cell-za5kh6nr` named `production`, database `neondb`, and school
  `1`.
- The authenticated Stripe Dashboard freshly reconfirmed Sandbox/Test account
  `acct_1QUSsNIqhTSdZedS`. Dedicated active webhook destination
  `we_1U0qdyIqhTSdZedS2h8O3RxW`, name `cc-simon-s2-shadow-05`, remains bound
  exactly to `https://cc-simon-s2-shadow-05.vercel.app/api/webhook`, API version
  `2024-11-20.acacia`, for exactly eight events: `account.updated`,
  `charge.failed`, both Checkout async outcomes, Checkout completed/expired,
  and PaymentIntent failed/succeeded. The separate live destination view has no
  shadow-05 binding.
- Fresh connected Neon queries were read-only and every tenant-table read
  explicitly used `school_id=1`. The single config remains
  `simon_launch_v1`/`shadow` with cutover
  `2026-08-04T21:19:37.270Z` and no activation or pause. The exact matrix is one
  complete contract and one complete launch source for each of
  `direct_slot`, `test_date_direct`, `one_off_offer`, and `captured_request`.
  Pending contracts, contradictory contracts, ineligible post-cutover
  contracts, unsupported origins, and unmaterialized origins are each `0`.
- Protected direct-slot contract
  `4af03473-9cfd-4051-9606-654245e1b6ab` remains singular and complete with
  origin/regime `direct_slot`/`launch`, gross `8250`, fee `288`, `gbp`, split
  `9000` bps, PaymentIntent `pi_3U0qsPIqhTSdZedS2Xi4DZDN`, charge
  `ch_3U0qsPIqhTSdZedS2XhVtLvQ`, balance transaction
  `txn_3U0qsPIqhTSdZedS2gWKkLmQ`, created
  `2026-08-04T22:32:01.000Z`, available
  `2026-08-07T00:00:00.000Z`, exactly one active booking, and null
  ineligibility/contradiction codes. Singular source `1` remains
  `stripe_backed`, `available`, complete, gross `8250`, fee `288`, payable and
  refundable pools `7962`, with exact matching origin, currency, contract,
  Stripe identities, times, and null contradiction. Stripe independently
  showed the exact test payment succeeded at GBP `82.50`, fee GBP `2.88`, net
  GBP `79.62`, with funds available on 7 August.
- Audit evidence remains exactly one
  `stripe-launch-shadow-reconcile-payments-started` row and exactly one
  `stripe-launch-shadow-reconcile-payments` row. Both retain operation
  `reconcile_payments` and exact Vercel project ID. Completion remains
  `checked=1`, `completed=1`, `pending=0`, `contradictory=0`, `failed=0`.
  No raw IP, request header, credential, or sensitive payload was retained.
- Stripe receipt counts remain exactly `total=4`, `test-mode=4`,
  `processed=4`, `live=0`, `failed=0`, `processing=0`, and duplicate IDs `0`;
  `received` and `manual_review` also remain `0`.
- The complete school-1 prohibited-effect matrix remains exactly zero:
  `stripe_launch_booking_earnings`, `payout_runs`,
  `instructor_payout_batches`, `stripe_launch_transfer_intents` and attempts,
  `refund_intents` and attempts, `connect_account_state_events`,
  `payout_statements` and delivery attempts, `payment_disputes` and events,
  `instructor_payout_obligations` and applications, and
  `payout_batch_earning_dispositions`.
- Step 14's committed cross-cutting evidence covers delayed evidence,
  webhook/reconciliation replay and idempotency, exact fee handling, known fee,
  amount, currency, and Stripe-link mismatch rejection, one-payment-to-many-
  lessons rejection, pre-cutover ineligibility, reschedule continuity,
  cross-school isolation, shadow-auth negative paths, required audit start and
  completion, audit-write fail-closed behaviour, webhook reliability, and
  absence of prohibited writers. Step 16 freshly reproduced syntax `199`, C1
  controls `271`, Slice 2 static review `14/14`, and the same focused
  Playwright matrix `80/80`.
- Explicit limitation: Step 14's triple-gated rollback-only PostgreSQL 17.7
  integration result (`8/8`, zero skips, disposable confirmed non-production
  loopback database) is retained from the merged handover and was not rerun in
  this documentation/read-only step because no disposable database was
  provisioned. Historical request timing and action-time confirmation are also
  retained rather than replayed. Step 16 independently reverified the resulting
  repository, CI, provider, database, Stripe, audit, receipt, and zero-effect
  state read-only.
- Step 16 did not invoke reconciliation or request expiry, call a mutation
  endpoint, replay a webhook, create or alter any Stripe object, change an
  environment variable or deployment, manipulate a credential, or issue a
  database mutation/DDL. It changed only the authorised rollout review and
  living log. The Stripe plugin was neither installed nor used.
- Step 16 is complete. Slice 2 remains not formally accepted or rejected. Step
  17 and Slice 3 have not begun, and this handover grants no authority for
  either or for any production or money operation.

### 8 August 2026 - Step 17 formally accepted Slice 2

- Worked only in fresh isolated worktree
  `C:\\tmp\\cc-simon-slice2-step17-formal-decision` on branch
  `codex/simon-slice2-step17-formal-decision`. The primary workspace and all
  preserved worktrees were left untouched.
- Fetched current remote refs and independently verified PR
  [#354](https://github.com/coachcarteruk-gif/coachcarter-website/pull/354) is
  merged from source commit
  `7e08023d9e251e397d6c784e056c92c76574fc79`. Merge commit
  `8e7a7598a3acd20cf0ec0cbec7b2e334f6d48211` is exact `origin/main`, has Step
  16 baseline `b9aee19d71598364c4d6ff33d9ad4f4631535890` as its parent, and changed
  only this log and the Slice 2 rollout review. Exact merge-commit Actions run
  [31246352745](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31246352745)
  completed successfully, including syntax/encoding and Playwright jobs.
- Fresh read-only Vercel, Neon, Stripe Dashboard, and explicitly
  `school_id=1` Neon SQL checks reproduced the exact Step 16 resource identities,
  four singular complete origin contracts and sources, protected direct-slot
  evidence, exact audit and receipt counts, zero terminal discrepancies, and
  the complete prohibited-effect matrix at zero. Stripe remained Sandbox/Test
  with the exact active eight-event shadow-05 webhook and no live binding; the
  protected payment independently remained GBP `82.50` succeeded, GBP `2.88`
  fee, GBP `79.62` net, with funds available on 7 August.
- Reverified the protected LF-normalised hashes exactly: product specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4` and
  technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Fresh local validation passed syntax `199`, C1 controls `271`, all `14/14`
  static Slice 2 checks with production status
  `PREPARED_NOT_APPROVED_NOT_DEPLOYED`, and the exact focused Playwright matrix
  `80/80`. `git diff --check` passed and the final diff remained limited to the
  two authorised decision documents.
- Independently reviewed every protected Slice 2 acceptance criterion and the
  retained Step 14 cross-cutting evidence. The historical rollback-only
  PostgreSQL 17.7 result (`8/8`, zero skips) and action-time request evidence
  were not replayed because this documentation/read-only decision task
  provisioned no disposable database and authorised no operation. The retained
  merged evidence, current source-level validation and exact-main CI, and fresh
  terminal-state/zero-effect checks make this an explicit limitation, not an
  unresolved acceptance defect.
- **Formal decision: `SLICE 2 ACCEPTED`.** This accepts only the completed
  shadow-05 Slice 2 evidence and payment-contract controls. Production rollout
  remains `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- No reconciliation, expiry, webhook replay, Checkout, PaymentIntent, payment,
  provider/environment/deployment change, credential operation, database
  write/DDL, earning, payout, transfer, refund, Connect, live-mode, production,
  or money action occurred. The Stripe plugin was neither installed nor used.
- Step 18 is now an active hold. Slice 3 requires a new, separately scoped task
  and approval from fresh latest-main review; this decision grants no such
  authority.

### 8 August 2026 - Slice 3 retired-product implementation prepared inactive

- Received the separately scoped Slice 3 implementation authority that lifted
  Step 18 only for this task. It granted no Slice 4, deployment, production
  activation, provider mutation, database mutation, or money authority.
- Verified PR #355 merged as
  `7be7920e07c75767e8eb923d3f122d62947f1899`, exact current `origin/main`, and
  confirmed exact post-merge CI run `31248540845` passed. Reverified the
  protected LF-normalised hashes before editing: product specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4` and
  technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Preserved the primary workspace and every existing worktree exactly as found,
  including the pre-existing dirty detached `cc5f` worktree. Created isolated
  worktree `C:\\tmp\\cc-simon-slice3-retire-products` on branch
  `codex/simon-slice3-retire-products` from exact `origin/main`.
- Added strict school-scoped state
  `schools.config.features.retire_incompatible_products === true`. Missing,
  malformed, string, numeric, null, and false values remain inactive. Active
  creation attempts return stable HTTP 410 code
  `PRODUCT_CREATION_RETIRED` before mutation.
- Gated repeated learner bookings, Reserved Weekly Slot preview/credit commit/
  bank Checkout creation, flexible offers, repeating offer creation, and
  flexible/repeating acceptance. Existing self-serve Lesson Credit purchase
  endpoints retain their earlier server-side `410 CREDIT_PURCHASE_RETIRED`.
- Removed active-state learner/instructor entry points and corrected admin copy.
  Preserved one-off booking/payment-link offers, per-instructor balance reads and
  spending, cancellation returns, recurring status/moves/cancellations/series
  management, historical ledgers, and idempotent in-flight webhook settlement.
  Legacy-credit and retired multi-booking sources remain outside the exact
  one-payment/one-lesson whitelist and remain £0 automated launch earnings.
- Verification passed: syntax 200 files; C1 controls 272 files; 157/157 focused
  and affected non-browser tests; and 8/8 Chrome browser assertions covering
  inactive legacy behavior plus active retirement UI. `git diff --check` passed
  and protected hashes remained exact. The local Playwright package expected a
  newer bundled Chromium revision than cached, so browser tests used the already
  installed system Chrome through a temporary config outside the repository;
  no browser or dependency was downloaded.
- No deployment, config flip, Neon write/DDL, Stripe/Vercel mutation, Checkout,
  PaymentIntent, payment, webhook replay, reconciliation, expiry, earning,
  payout, transfer, refund, Connect, production, or money operation occurred.
  Slice 3 remains `IMPLEMENTED_INACTIVE_NOT_DEPLOYED`; production activation is
  a separate communication/readiness decision and Slice 4 remains unauthorised.

### 9 August 2026 - Slice 3 post-merge inactive verification completed

- Received separately scoped authority for post-merge inactive verification
  only. Production activation, school-config mutation, payments, refunds,
  earnings, payouts, transfers, webhook replay, and Slice 4 remained prohibited.
- Fetched current remote refs and verified PR
  [#356](https://github.com/coachcarteruk-gif/coachcarter-website/pull/356)
  merged at `2026-08-09T06:40:35Z` with exact merge commit
  `ea3a65cb3871924025f2355f388b98488bd71219`. That commit was exact
  `origin/main` and the base of isolated branch
  `codex/simon-slice3-postmerge-inactive-verification` in worktree
  `C:\\tmp\\cc-simon-slice3-postmerge-inactive-verification`.
- Inspected the primary workspace and every registered worktree before work.
  All were clean except the already-dirty detached `cc5f` worktree; its existing
  tracked and untracked user changes were recorded and left untouched. No
  pre-existing workspace was changed.
- Exact post-merge Actions run
  [31299415244](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31299415244)
  was a successful `main` push run at exact SHA `ea3a65cb...`. Jobs
  `syntax + encoding checks` (`93209674152`) and `playwright e2e`
  (`93209698709`) passed. GitHub reported successful deployments for the exact
  SHA to `coachcarter-website`, `coachcarter-website-main`,
  `cc-simon-s2-shadow-01`, and `cc-simon-s2-shadow-03`; direct read-only Vercel
  inspection independently reported the bound deployment IDs production-target
  and `READY`.
- Reverified the protected LF-normalised hashes before editing: product
  specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4` and
  technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Ran one minimum-field production Neon `SELECT` inside a serializable read-only
  transaction. It proved the row exists for exact school `1`, name
  `CoachCarter Driving School`, slug `coachcarter`; both the nested retirement
  value and its JSON type were SQL `NULL`, proving the path is absent and
  retirement inactive. The query did not select or print the complete config,
  connection string, or any secret. No production write or DDL was issued.
- Passive public GET checks returned HTTP 200 for the CoachCarter home page,
  ordinary learner booking page, and actual fixed-offer acceptance page.
- Fresh local validation passed syntax `200`, C1 controls `272`, `112/112`
  focused retirement/preservation contract assertions, `53/53` additional
  ordinary one-off/fixed-offer/credit/reserved/payment-contract assertions, and
  `8/8` installed-system-Chrome UI assertions with two live-API cases skipped by
  design. The passing matrix covers strict inactive/active state interpretation,
  pre-mutation 410 gates, direct one-off checkout, fixed and free offers,
  grandfathered credit reads/spending/returns, existing series and Reserved
  management, historical ledgers/source snapshots, idempotent webhook
  settlement, and the one-payment/one-lesson whitelist.
- The initial browser harness used Python static serving and returned 404 for
  clean URLs; the unchanged tests passed after the temporary loopback server
  matched clean-URL behavior. One additional batch initially stopped during
  discovery because no Stripe credential existed; it passed with a visibly
  synthetic non-authenticating test constructor placeholder. Neither attempt
  reached Stripe or any production mutation. All temporary harness and result
  files were removed.
- Updated the Slice 3 rollout review with exact merge/deployment evidence,
  production-inactive proof, preservation results, and exact school-1
  activation/rollback SQL. The runbook requires a locked serializable
  transaction, exact identity and row-count predicates, minimum before/after
  evidence, safe expected-410 smokes, rollback to JSON Boolean `false`, and
  explicit stop conditions. It is documentation only and was not executed.
- No activation, config flip, database write/DDL, environment or deployment
  change, Checkout, PaymentIntent, payment, refund, earning, payout, transfer,
  Connect action, webhook replay, reconciliation, expiry, live-mode action, or
  Slice 4 work occurred. Slice 3 is
  `MERGED_DEPLOYED_INACTIVE_VERIFIED`; production activation remains a separate
  approval and Slice 4 remains unauthorised.

### 9 August 2026 - Slice 4 Accounts v2/agreement readiness prepared inactive

- Received separately scoped Slice 4 implementation authority. It granted no
  provider mutation, migration application, production configuration,
  deployment, merge, Slice 3 activation, Slice 5, payout, earning, transfer,
  refund, payment, or cutover authority.
- Fetched current refs and verified PR #357 merged at exact current
  `origin/main` commit `502e675dc338cf2d232045e09289fdc1fb5387c5`.
  Reverified protected LF-normalised hashes before editing: product
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
  and technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Preserved the primary workspace and every registered worktree exactly as
  found, including the pre-existing dirty detached `cc5f` worktree. Created
  `C:\tmp\cc-simon-slice4-accounts-v2-readiness` on branch
  `codex/simon-slice4-accounts-v2-readiness` from exact `origin/main`.
- Confirmed pinned `stripe@22.4.0` / API `2026-07-29.dahlia` supports the
  reviewed Accounts v2 account, recipient, Account Link, thin-event parsing,
  and related-object contract. No dependency/API upgrade occurred.
- Added strict inactive route/webhook gates, durable creation identity and
  reconciliation evidence, latest-state readiness, signed link state,
  append-only agreement workflow, instructor/admin diagnostics, and additive
  unexecuted migration 041. Legacy Connect and every money/retirement/cutover
  path remain unchanged.
- Verification passed syntax (204 files), C1 (276 files), 15/15 focused mocked
  and installed-system-Chrome assertions, all 14 canonical launch-schema checks,
  250/250 broader Stripe/auth/tenant/
  booking/credit/refund/payout/webhook/launch regressions, and all 9 migration
  035 byte/rollout guards under temporary LF normalization with exact original
  checkout bytes restored. Final syntax/C1 reruns and `git diff --check` passed;
  both protected LF-normalised hashes remained exact. The primary workspace and
  all registered worktrees were re-inspected and remained unchanged, including
  the pre-existing dirty detached `cc5f` worktree.
- Added `docs/stripe-connect-simon-slice-4-rollout-review.md` with exact gates,
  identity/reconciliation, readiness, agreement, event ordering, unexecuted
  staging, and non-destructive rollback rules.
- No Stripe call, provider mutation, account/link/onboarding session, event
  destination change, production read/write, migration application, Vercel or
  school flag change, replay, deployment, payment, refund, earning, payout,
  transfer, cutover, Slice 3 activation, or Slice 5 work occurred. Status is
  `IMPLEMENTED_INACTIVE_NOT_DEPLOYED`.

### 9 August 2026 - Slice 4 post-merge inactive verification completed

- Received separately scoped Slice 4 post-merge inactive-verification authority
  only. No Stripe, Vercel configuration, database, school configuration,
  deployment-state, payment, refund, earning, payout, transfer, cutover, Slice
  3 activation, or Slice 5 mutation was authorised or performed.
- Verified PR [#358](https://github.com/coachcarteruk-gif/coachcarter-website/pull/358),
  `Slice 4: prepare inactive Accounts v2 readiness`, merged at
  `2026-08-09T17:08:51Z` with exact squash commit
  `be6f06dc619bb941078ab19e1a8814772fc5e993`. Exact `HEAD`, `origin/main`, and
  merge-base all matched that SHA. Created isolated worktree
  `C:\tmp\cc-simon-slice4-postmerge-inactive-verification` on branch
  `codex/simon-slice4-postmerge-inactive-verification` from that commit; no
  existing worktree was switched or changed.
- Exact merge-triggered GitHub Actions push run
  [31325635483](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31325635483)
  completed successfully for exact SHA `be6f06dc...`. Job
  `syntax + encoding checks` (`93275424866`) passed from
  `2026-08-09T17:08:57Z` to `17:09:09Z`; `playwright e2e`
  (`93275453716`) passed from `17:09:12Z` to `17:10:26Z`.
- GitHub reported exactly four final successful Vercel contexts and four
  production-environment deployment records for the exact SHA. Direct
  read-only Vercel API inspection independently proved all four deployments
  were production-targeted, `READY`, sourced from repository
  `coachcarteruk-gif/coachcarter-website`, ref `main`, and exact Git SHA
  `be6f06dc619bb941078ab19e1a8814772fc5e993`:
  - `coachcarter-website-main`: project
    `prj_rvHVfX2lCxAugCtYGcoYMk37W4zk`, deployment
    `dpl_FZMnqTz6zubnKRrzcZYR9gXobuki`, GitHub deployment `5820957584`, alias
    `coachcarter-website-main.vercel.app`;
  - `cc-simon-s2-shadow-03`: project
    `prj_zz7VKC3stOrJvlw8Rbc4FHMf6leW`, deployment
    `dpl_2NW6HLodVve4WVkkwkif4i9nGq51`, GitHub deployment `5820957698`, alias
    `cc-simon-s2-shadow-03.vercel.app`;
  - `cc-simon-s2-shadow-01`: project
    `prj_CprETJA11YddzEz9hrbxfUtBUplK`, deployment
    `dpl_8wFKiKgrv3hLA7TcdVGyCsyBwhyM`, GitHub deployment `5820958026`, alias
    `cc-simon-s2-shadow-01.vercel.app`;
  - `coachcarter-website`: project `prj_ikyhcHbDHOR4jDQuZUeGFv3pw1Lk`,
    deployment `dpl_5pUSWp4qWJCMbxWqQMEhRXHqPDk2`, GitHub deployment
    `5820963783`, aliases `coachcarter.uk` and `www.coachcarter.uk`.
  No deployment, redeploy, promotion, alias, domain, project, or environment
  mutation was submitted during this verification.
- Read-only Vercel environment metadata returned zero variables with prefix
  `STRIPE_CONNECT_V2` in each of the four deployed projects. Therefore the
  global gate, every account/link/dashboard/agreement/webhook operation gate,
  live gate, and dedicated webhook secret all remain absent. No value or secret
  was read or printed.
- At `2026-08-09T17:22:37.702Z`, one minimum-field serializable, deferrable,
  read-only production Neon transaction proved there is exactly one school;
  school `1`, `CoachCarter Driving School`, slug `coachcarter`, has no
  `features.stripe_connect_accounts_v2` path or JSON type. Migration 041 is not
  applied: all three Slice 4 tables and its guard function resolve SQL `NULL`.
  School 1 has zero connected-account scopes, zero account-state observations,
  zero Slice 4 creation identities, zero onboarding-link events, and zero
  payout agreement versions (draft, accepted, approved, and active are all
  zero). Its payout engine remains exactly `v1`, and `payout_runs` remains zero.
- The same transaction recorded the current legacy-Connect production shape
  without exposing account IDs: seven school-1 instructors, one legacy mapping,
  one onboarding-complete row, one paused-payout row, and canonical state hash
  `9a61690d542ccd0938dcc92e035491eab5d0513a9971aff713819aac6ec81dbe`.
  The merged source changes only dispatch the separately named v2 actions before
  legacy actions; every legacy action-handler body is byte-identical to the
  parent commit, and no payout implementation file was changed by PR #358.
- At `2026-08-09T17:23:33.500Z`, aggregate-only Stripe live-mode GET/list
  inspection found one existing event destination but zero destination names or
  webhook URLs matching Accounts/Connect v2 or `/api/webhook-connect-v2`.
  Accounts v2 recipient listing found one provider-visible recipient account
  but zero with CoachCarter Slice 4 metadata prefix `cc:connect-v2:`. The one
  existing legacy connected account remained singular; its sanitized provider
  state hash was
  `4134cece57903987429bfd1373b89074582389ab9f44ce4711d35453311e5651`.
  No Stripe create, update, delete, enable, disable, ping, retrieve-related,
  onboarding, login-link, webhook delivery, payment, refund, payout, transfer,
  or other mutation call was made.
- These independent controls confirm no Accounts v2 account creation, webhook
  destination, onboarding link/session, agreement acceptance/activation, payout
  behaviour activation, or legacy Connect replacement occurred. With every
  gate absent, the school flag absent, migration tables absent, and no v2
  mapping, the deployed code cannot reach provider mutation paths. Passive
  production GETs followed the canonical-host redirect and returned `200` for
  home and instructor earnings, `401` for both legacy `connect-status` and v2
  `v2-status` without authentication, and `405` for GET on the POST-only v2
  webhook boundary.
- Reverified the protected LF-normalised hashes exactly: product specification
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4` and
  technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  Neither protected document changed between Slice 4's base and merge commit.
- Inspected all 22 registered worktrees by exact path, branch/detached state,
  commit, and porcelain status. Twenty-one were clean. Only the pre-existing
  detached `C:\Users\Fraser\.codex\worktrees\cc5f\coachcarter-website-main`
  remained dirty with its same 12 tracked and two untracked user entries; it
  and every other existing worktree were left untouched.
- Fresh local merged-SHA verification passed syntax for `204` JavaScript files,
  C1 controls for `276` files, and all `14/14` focused Accounts v2 inactive
  contract tests. The focused matrix proves exact fail-closed gates, school and
  role scope, deterministic recipient identity, ambiguous-create reconciliation
  without replacement, current-evidence readiness, signed onboarding state,
  thin-event validation/replay safety, inactive no-Stripe behavior, migration
  append-only constraints, and absence of payout/refund/earning/cutover/
  retirement writers. `git diff --check` passed after the documentation update.
- Slice 4 status is `MERGED_DEPLOYED_INACTIVE_VERIFIED`. This evidence update
  does not approve migration 041, any gate or school flag, Accounts v2 account
  creation, onboarding, an event destination, an agreement, payout behavior,
  legacy Connect change, production activation, or Slice 5. Slice 5 was not
  started and requires new, separately scoped owner authority.

### 9 August 2026 - Slice 4 non-production staging acceptance stopped at Vercel target guard

- Began from a fresh isolated worktree
  `C:\tmp\coachcarter-simon-slice4-staging-acceptance` on branch
  `codex/simon-slice4-staging-acceptance`. Read-only
  `git ls-remote origin refs/heads/main`, the fetched `origin/main`, worktree
  `HEAD`, and merge base all resolved to exact required commit
  `ccafbfc483937f2005f99f334134c92d46c8f28b`, which includes merged PR #359.
  All existing worktrees and user changes were preserved.
- Re-read the complete required worker/project/Stripe/launch documents and
  reverified the protected LF-normalised SHA-256 values before action:
  product specification
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
  and technical implementation plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
  Neither protected document was edited.
- Created only disposable Neon branch `br-dark-recipe-zarmjbix`, name
  `cc-simon-s4-acceptance-01-20260809`, at `2026-08-09T18:02:22Z` in exact
  isolated project `shiny-bonus-66942766`, organisation
  `org-fancy-forest-47074420`, database `neondb`. The branch is non-primary,
  non-default, unprotected, and descended from the already-isolated shadow
  branch; every SQL call named it explicitly.
- Corrected read-only preflight proved the implementation's actual observation
  ledger is `connect_account_state_events`, all real migration prerequisites
  exist, migration 041 was absent, and conflicting instructor-owner and
  school-owner mapping counts were both zero. It also recorded school gate
  absent, payout engine `v1`, no legacy school/instructor account mapping, no
  connected-account scopes, an inactive inherited Slice 3 `shadow` config, and
  zero payout runs/refund intents/refund events/launch earnings/transfer
  intents/payout transfers.
- Applied only exact repository migration
  `db/migrations/041_connect_v2_onboarding_readiness.sql` as one transaction to
  `br-dark-recipe-zarmjbix`. Postflight proved the three new tables present
  with zero rows, all six reviewed indexes, all three append-only/identity
  triggers, and the existing agreement trigger bound to the hardened function.
  Migration 041 was not destructively rolled back.
- Added synthetic school-1 instructors `2` (`Slice 4 Synthetic Fraser`) and
  `3` (`Slice 4 Synthetic Simon`) plus synthetic school-1 superadmin `2`.
  Synthetic emails use the reserved `.invalid` domain; no real name, email,
  password, bank detail, or connected account was reused. A distinct random
  bcrypt value was generated after a safety control correctly rejected an
  attempted plan to copy an existing hash.
- Created isolated Vercel project `prj_JfBT8mm5ob4CWwseF8Ym62fJ4wSk`, name
  `cc-simon-s4-staging-01`, under team
  `team_DXEEAusHmjcfcr6auPjqloL0` at `2026-08-09T18:12:11.593Z`. Provider
  preflight reported `live=false`, no latest deployment, and no domains.
  Configured Preview only with the disposable Neon URL, staging JWT and base
  URL, `STRIPE_MODE=test`, and the reviewed account-create, account-link,
  dashboard-link, agreement, webhook-processing, and global gates. No
  Production variable was added and `STRIPE_CONNECT_V2_LIVE_ENABLED` remained
  absent. A local `sk_test_...` credential was used as the documented fallback
  because a least-privilege Accounts v2 restricted key was not retrievable; it
  was never called.
- `vercel link` created ignored local `.vercel/project.json` and `.env.local`
  state and temporarily appended a redundant `.env*` ignore line. That line
  was removed immediately; `.gitignore` now hashes exactly to its `HEAD` blob.
  No secret file is tracked or included in the documentation change.
- Submitted exact command
  `npx.cmd --yes vercel@latest deploy --yes --scope coachcarteruk-2599s-projects`
  without `--prod`. Vercel's first-deployment behaviour nevertheless assigned
  target `production`, created deployment
  `dpl_2dvLLths8Xe4rPaTtLoyHLyWaQaW`, and assigned project aliases
  `cc-simon-s4-staging-01.vercel.app` and
  `cc-simon-s4-staging-01-coachcarteruk-2599s-projects.vercel.app`. It was
  created at `2026-08-09T18:23:18.683Z`, became `READY` at
  `2026-08-09T18:24:06.466Z`, and reports exact Git SHA
  `ccafbfc483937f2005f99f334134c92d46c8f28b`. Provider metadata reports
  `gitDirty=1` solely because the redundant ignore line existed at upload.
- Stopped immediately on that production-target identity, before any
  application request or Stripe API call. The isolated deployment's
  Production environment has exactly zero variables, so it contains no Neon
  URL, Stripe credential/mode, JWT, global/operation gate, or live gate and is
  inert. No CoachCarter production project, alias, domain, deployment,
  environment, database, school configuration, payment, refund, earning,
  payout, transfer, or Slice 3 state was read for mutation or changed.
- Per fail-closed cleanup, overwrote the five Preview operation gates to
  `false` between `2026-08-09T18:24:38.946Z` and `18:24:53.975Z`, then the
  Preview global gate to `false` at `18:24:57.703Z`. The live gate remains
  absent. Set the disposable database's school-1 JSON Boolean to `false` at
  `18:25:08.282Z`. No dedicated Accounts v2 event destination was created, so
  none required disabling. Retained the branch, migration, deployment, and
  synthetic rows as evidence; no provider/database evidence was deleted.
- Final disposable-database evidence shows zero Accounts v2 creation intents,
  attempts, onboarding-link events, connected-account scopes, accounts, or
  provider mappings. Synthetic instructors `2` and `3` remain unpaused with
  `stripe_account_id=NULL`. Before/after hashes match exactly for legacy
  Connect state `7b1a79ae40ffd98871758eda5f46a220`, inherited Slice 3 config
  `d7edd0928fd680cb66f3b155be666b09`, and lesson payment contracts
  `b6ec3337d53441f01ec5b39e780d029a`; payout/refund/earning/transfer tables
  remained empty with MD5 `d41d8cd98f00b204e9800998ecf8427e`.
- Because the stop gate fired, no deterministic Accounts v2 recipient,
  ambiguous-result injection/reconciliation, hosted onboarding link, refresh/
  return/expiry/replay/tamper/tenant/instructor test, thin-event destination or
  delivery, agreement draft/accept/activate/immutability/overlap exercise,
  current-state retrieval, or complete post-exercise regression matrix was
  run. Slice 3 was not activated and Slice 5 was not started. Slice 4 staging
  acceptance remains incomplete and requires new authority plus a Vercel path
  proven not to auto-classify its first deployment as production.

### 9 August 2026 - Slice 4 staging acceptance attempt 2 stopped despite explicit Preview target

- Resumed under fresh operator authority using worktree
  `C:\tmp\coachcarter-simon-slice4-staging-acceptance-2`, branch
  `codex/simon-slice4-staging-acceptance-2`, and exact merged `origin/main`
  `90183a9889458581718fb3438403e703f36b8b9a` (PR #360). Remote, fetched ref,
  worktree `HEAD`, and merge base agreed. Protected LF-normalised hashes again
  matched product specification
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
  and technical plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
- Read-only revalidation of retained Neon branch `br-dark-recipe-zarmjbix`
  proved database `neondb`, non-default/unprotected branch identity, migration
  041 still present, school gate `false`, zero conflicting owner mappings, and
  zero Accounts v2 intent/attempt/link/scope/observation/synthetic-agreement
  rows. Synthetic instructors `2` and `3` remained active, unpaused, and
  without legacy Stripe mappings. Payout engine `v1`, inactive Slice 3 shadow
  config, and all payout/refund/earning/transfer zero counts were unchanged.
  Attempt 2 submitted no SQL write.
- Created exact replacement Vercel project
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, name `cc-simon-s4-staging-02`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`, at `2026-08-09T20:01:24.142Z`. Initial
  state was `live=false`, with no deployment, domain, or environment variable.
- Exact no-upload command `vercel deploy --dry --target preview --skip-domain`
  failed closed because the installed Vercel CLI permits `--skip-domain` only
  with a production target. The operator then explicitly approved the supported
  `--target preview` form, with a required provider target/alias check before
  any secret, database URL, mode, gate, or Stripe call.
- Vercel link created only ignored local metadata and a temporary redundant
  `.env*` ignore line. The credential file was removed, the line reverted, the
  `.gitignore` working hash equalled its `HEAD` blob, and the worktree was clean
  before upload.
- Submitted exact command `npx.cmd --yes vercel@latest deploy --target preview
  --yes --scope coachcarteruk-2599s-projects --json` with zero project
  environment variables. Vercel nevertheless classified the first deployment
  as `production`, created `dpl_53R1HXZHMgYu7QpBSV2kNEVZzrFv`, and assigned
  aliases `cc-simon-s4-staging-02.vercel.app` and
  `cc-simon-s4-staging-02-coachcarteruk-2599s-projects.vercel.app`. Created at
  `2026-08-09T20:05:43.527Z`, it became `READY` at
  `2026-08-09T20:06:40.153Z` and reports exact Git SHA
  `90183a9889458581718fb3438403e703f36b8b9a` with no dirty-source marker.
- Stopped immediately on the production-target provider identity. Read-only
  final metadata proves zero total environment variables, zero Production
  variables, zero Preview variables, and zero `STRIPE_CONNECT_V2*` variables.
  The deployment is inert: it has no Neon URL, Stripe credential or mode, JWT,
  global/operation/live gate, or webhook secret. No manual staging alias was
  created or moved, and no application or Stripe request was made.
- No Accounts v2 account, stable identity, ambiguous reconciliation, hosted
  onboarding link, event destination/delivery, agreement action, payment,
  refund, earning, payout, transfer, Slice 3 activation, or Slice 5 work
  occurred. With no gates or destination, no disable action was needed. The
  project/deployment remain preserved as evidence. Full provider acceptance
  and the post-exercise regression matrix remain unexecuted.
- A further attempt must use a provider-side path that can be proven Preview
  before source upload or a separately approved isolated non-production host;
Vercel CLI first-deployment target selection is now disproven twice and must
not be retried.

### 10 August 2026 - Slice 4 staging acceptance attempt 3 stopped at reconciliation contract

- Resumed under the approved non-production authority in fresh worktree
  `C:\tmp\coachcarter-simon-slice4-staging-acceptance-3`, branch
  `codex/simon-slice4-staging-acceptance-3`. `git ls-remote`, fetched
  `origin/main`, worktree `HEAD`, and merge base all resolved to exact current
  main `7bea1fbc3cd05b0fabadfed28956c7c83dbf2bbb`, which includes the merged
  attempt-2 evidence PR #361. The required worker/project/Stripe documents,
  complete living log, rollout review, protected product specification, and
  technical plan were read in full before provider action. LF-normalised
  SHA-256 values matched exactly before action and after shutdown: product
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4` and
  technical plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
- Revalidated only Neon project `shiny-bonus-66942766`, organisation
  `org-fancy-forest-47074420`, database `neondb`, retained branch
  `br-dark-recipe-zarmjbix` / `cc-simon-s4-acceptance-01-20260809`, and compute
  `ep-wandering-field-zadlm6r7`. Provider metadata remained
  `primary=false`, `default=false`, `protected=false`, parent
  `br-empty-cell-za5kh6nr`; the exact pooled host was
  `ep-wandering-field-zadlm6r7-pooler.c-2.eu-west-2.aws.neon.tech`. Read-only
  preflight at `2026-08-10T05:38:20.250Z` proved database `neondb`, schema
  `public`, PostgreSQL `18.4`, migration 041's three tables, six indexes and
  four relevant trigger bindings intact, zero owner duplicates, zero v2
  intents/attempts/links/scopes/synthetic observations/agreements, and the
  reviewed synthetic instructor/superadmin identities. Migration 041 was
  already applied by attempt 1 and was neither reapplied nor rolled back.
- The same preflight proved school `1` gate `false`, payout engine `v1`, null
  legacy school mapping, synthetic instructors `2` and `3` active/unpaused
  with null legacy mappings, inherited Slice 3 config exactly `shadow` with
  `activated_at=NULL`, four unchanged lesson payment contracts, and zero payout
  runs, refund intents/events, launch earnings, launch transfer intents, payout
  transfers, cutover configs/events/readiness snapshots, and shadow cycles.
- Used isolated Vercel project `cc-simon-s4-staging-02`, ID
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`. Custom environment `staging`, ID
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, created
  `2026-08-10T05:27:07.679Z`, independently returned `type=preview` and
  `domains=[]`. Its Production environment had zero variables throughout.
  The provider supports `--skip-domain` only for Production, so attempt 3 used
  the approved custom preview target command
  `npx.cmd --yes vercel@latest deploy --target staging --yes --scope
  coachcarteruk-2599s-projects --json`. The inert zero-variable canary
  `dpl_H51GNhY6xRm7n12bnaqEbGnoVESo` became `READY`; OIDC bound it to exact
  project/environment IDs and the only alias was the automatic staging-only
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
- Streamed the exact disposable Neon URL, a new random staging JWT, and the
  approved local `sk_test_...` fallback directly into custom environment
  `staging`; no value was printed. The first PowerShell JWT generator used an
  unavailable static `Fill` method and was caught before deployment. Its
  predictable placeholder was immediately replaced. A later controlled
  readable capture rotated the secret once more, restored its Vercel type to
  Sensitive before deployment, and enabled local synthetic cookie signing.
  Only staging received `POSTGRES_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`,
  `BASE_URL`, `STRIPE_MODE=test`, the global gate, and the five account-create,
  account-link, dashboard-link, agreement, and webhook-processing gates.
  `STRIPE_CONNECT_V2_LIVE_ENABLED` remained absent; Production still had zero
  variables.
- Configured deployment `dpl_3Vs1f5jX5oiV21RLYNb9AaGUbEXh` returned the
  expected authenticated inactive model while the school flag was false:
  `school_gate_inactive`, no mapping, no observation, and no agreement. The
  guarded school update set only school `1`'s JSON Boolean true at
  `2026-08-10T05:53:12.487Z`, retaining payout engine `v1` and null legacy
  school mapping. This clone contains only school `1`, so a second-school
  inactive assertion was not applicable and is an explicit limitation.
- Before provider creation, Stripe test mode scanned one recipient account and
  found zero matches for stable identities
  `cc:connect-v2:1:2:test:recipient` and
  `cc:connect-v2:1:3:test:recipient`. It scanned six pre-existing test event
  destinations and found no name or URL collision. The temporary harness first
  requested `limit: 100`; Stripe rejected it before mutation with `Limit cannot
  be greater than 20`. After correcting that preflight-only harness to the
  provider maximum, exactly one destination was created at
  `2026-08-10T05:55:25.006Z`: test ID
  `ed_test_61VCA8bFOvczEINoS16TV2QrP1E9xyoubgu5pnVoOD8a`, name
  `cc-simon-s4-acceptance-3-20260810`, `livemode=false`, `status=enabled`,
  `event_payload=thin`, `events_from=["@self"]`, staging webhook URL, and only
  the eight event types in `SUPPORTED_ACCOUNT_EVENT_TYPES`. Its `whsec_...`
  value was stored Sensitive only in staging.
- One intermediate deployment, `dpl_7Jfin7m2FxdRbGcezyrwALYu8hfU`, uploaded
  an untracked non-routed acceptance script and therefore had a dirty source
  marker. The script contained no secret and no account/event action had run.
  It was removed from the deployable worktree; the dirty deployment was
  retained rather than deleted. Exact clean commit
  `7bea1fbc3cd05b0fabadfed28956c7c83dbf2bbb` was then deployed as
  `dpl_BroKjPNuJCCNss4fAiZ1MB9BBvyS`, `READY`, `gitDirty=NULL`, custom
  environment `staging`, before account submission.
- Through that clean staging deployment, exactly one authenticated/CSRF-bound
  `POST /api/connect?action=v2-account` was made as synthetic instructor `2`.
  It returned `{version:2,state:"created",has_account:true}`. Durable intent
  `6a617fd1-e59e-461b-94cc-61428454cbad` preceded the provider call and reached
  `succeeded`; attempt 1 was `provider_succeeded` at
  `2026-08-10T05:59:17.869Z`, provider request
  `req_v2OdAMYJPICVTmYnh`. Scope `1` maps exactly test account
  `acct_1U2mEuEzBBwP0X12` to school `1` / instructor `2`. Read-only Stripe
  retrieval proved exactly one stable match, `livemode=false`, object
  `v2.core.account`, recipient applied, Express dashboard, GB identity,
  application fee/loss responsibility, and transfer capability `restricted`
  pending hosted onboarding. The local observation is singular
  `api.account_created` at `2026-08-10T05:59:18.285Z`.
- The Simon ambiguity harness ran outside the deployable worktree. It proved
  zero prior stable matches/intents/scopes, called Accounts v2 create exactly
  once, retained returned account ID `acct_1U2mHvIGQey1BnGx`, and injected a
  timeout after provider acceptance. Durable intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` moved to `reconciling`; attempt 1 is
  `provider_ambiguous`, error class `network`, provider code `ETIMEDOUT`,
  request `req_v2jEH4nkzkb9KTgyP`, at `2026-08-10T06:02:24.197Z`. Read-only
  provider listing proved exactly one original stable identity and exact
  recipient/Express/test/responsibility metadata.
- The next command injected a client whose create method could only count and
  throw; it recorded zero replacement-create calls and invoked the merged
  reconciliation list path. That path returned `500` before recording a second
  attempt or mapping a scope. Read-only isolation then proved the exact blocker:
  `api/_connect-v2-routes.js` `findReconciliationMatches` calls
  `accounts.list(... limit: 100)`, and Stripe rejects it with `Limit cannot be
  greater than 20`. No retry, replacement, list-limit workaround, manual SQL
  mapping, onboarding, link, dashboard, agreement, webhook-delivery, or money
  action followed. Simon remains singular, unmapped, and `reconciling` under
  the original identity as required.
- Non-destructive shutdown overwrote the five staging operation gates to
  literal `false`, then the global gate to `false`; set school `1`'s JSON flag
  false at `2026-08-10T06:04:46.720Z`; and disabled, never deleted, the exact
  test destination at `2026-08-10T06:05:04.127Z`. Final clean disabled
  deployment `dpl_7GtYzEowSXzUVNddpf5VbMPEwJpu` is `READY`, exact Git SHA,
  `gitDirty=NULL`, OIDC environment `staging`, and retains only the staging
  alias. A provider pull proved all six gates literally false and the live gate
  absent. Authenticated runtime status returned
  `global_gate_inactive` and `school_gate_inactive`. Stripe postflight proved
  both stable identities have exactly one test account and the destination is
  `disabled` with its exact eight-type contract preserved.
- Database postflight at `2026-08-10T06:08:03.657Z` retained migration 041,
  zero owner duplicates, one Fraser scope/observation, zero link events and
  agreements, and the singular Simon reconciling intent with no scope. Both
  instructors remain active, unpaused, and without legacy `stripe_account_id`.
  School payout engine is `v1`; Slice 3 remains unactivated `shadow`; four
  payment contracts and every zero payout/refund/earning/transfer/cutover
  count match preflight. No payout engine, pause state, legacy mapping,
  payment, refund, earning, payout run, transfer, cutover, or production state
  changed. Slice 3 was not activated and Slice 5 was not started.
- Local verification passed syntax `204/204`, C1 `276/276`, focused Slice 4
  `15/15` (including `2/2` installed-system-Chrome UI assertions), canonical
  launch schema `14/14`, migration-035 byte guards `9/9` under temporary LF
  normalisation with original checkout SHA
  `f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`
  restored exactly, and a current broader affected superset `570/570` across
  62 non-integration Stripe/auth/tenant/booking/credit/refund/payout/webhook/
  Connect files. The first browser run failed before assertions because the
  bundled browser was absent; installed Chrome then passed. No regression test
  used the staging database or provider credentials.
- Attempt 3 status is
  `STAGING_ACCEPTANCE_STOPPED_RECONCILIATION_LIST_LIMIT_DISABLED`. Hosted
  onboarding refresh/return/expiry/replay/tamper/wrong-tenant/wrong-instructor,
  Express login-link use, signed thin-event delivery/replay/out-of-order/
  regression/current-state checks, and agreement draft/accept/activate/
  immutability/overlap/readiness cases remain unexecuted. Resume only after a
  separately reviewed code repair accepts Stripe's supported list pagination;
  the first permitted provider action must reconcile Simon's preserved intent
  and `acct_1U2mHvIGQey1BnGx`, never create a replacement.
- Final local cleanup removed only the two external, secret-free harness files,
  the exact staging environment export, and the worktree `.env.local`; all four
  paths were verified absent. No remote or database evidence was deleted. The
  protected hashes were reverified unchanged after documentation edits. Of 25
  registered worktrees, this attempt worktree had only these two documentation
  changes and the pre-existing user worktree
  `C:\Users\Fraser\.codex\worktrees\cc5f\coachcarter-website-main` retained
  its 14 existing status entries; every other worktree was clean.

### 10 August 2026 - Slice 4 Accounts v2 reconciliation pagination repair reviewed

- Verified fetched `origin/main` was still exact required commit
  `8feeac6f0bed30015a0cd4685b95eb2f076f4dc8`, including merged PR #362,
  before creating isolated branch
  `codex/slice4-accounts-v2-pagination-repair` in a fresh worktree. Every
  pre-existing worktree and user change remained untouched.
- Reverified the protected LF-normalised SHA-256 values before code work and
  again before publication:
  product specification
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
  and technical plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
- Reviewed Stripe's current Accounts v2 list contract and pinned
  `stripe@22.4.0`. The repair requests recipient pages at `limit: 20`, then
  follows Stripe's opaque `next_page_url` through the SDK's public
  `rawRequest` interface. It validates the exact Accounts v2 path, recipient
  filter, positive limit no greater than 20, singular opaque page token,
  response shape, account object/ID/metadata shape, and non-repeated page
  tokens/account IDs. A 500-page traversal ceiling prevents unbounded unique
  malformed pagination; reaching it remains unresolved and fails closed.
- Existing reconciliation and creation semantics remain intact. Zero matches
  keeps the durable intent `reconciling`; one stable-identity match still must
  pass the existing account-object, intent, school, instructor, mode,
  recipient, and Express validation before mapping; multiple matches retain
  the existing `manual_review` stop. Provider failures, malformed or cyclic
  pagination, changed filters, oversized pages, duplicate accounts, and
  unexpected objects cannot select or create an account. A `planned` intent
  retains its original single idempotent create behavior; `submitting` or
  `reconciling` never enters that create path.
- Deterministic local verification passed focused route/state-machine tests
  `22/22`, focused installed-Chrome UI tests `2/2`, syntax `204/204`, C1
  `276/276`, canonical launch schema `14/14`, and migration-035 byte/rollout
  guards `9/9` under temporary LF normalisation. The original migration
  checkout SHA
  `f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`
  was restored exactly. The broader non-integration Stripe/auth/tenant/
  booking/credit/refund/payout/webhook/Connect superset passed `608/608`
  across 65 files. No test used staging/provider/database credentials.
- No schema contradiction was found. Migration 041, the aggregate migration,
  account creation/onboarding/agreement/webhook/payout/refund/payment/earnings/
  transfer/cutover behavior, gates, destinations, retained accounts, staging
  database, and production resources were not changed or accessed. Slice 3
  remains inactive and Slice 5 was not started.
- Status remains
  `STAGING_ACCEPTANCE_STOPPED_REPAIR_REVIEWED_PENDING_MERGE`. This code-and-test
  repair does not resume acceptance. After merge, any staging resumption and
  first provider reconciliation require separate explicit authority; the
  preserved ambiguous intent must never create a replacement account while
  reconciliation is unresolved.

### 10 August 2026 - Slice 4 reconciliation-only checkpoint stopped at retained staging authentication and disabled

- Resumed under the approved reconciliation-only authority in fresh worktree
  `C:\tmp\coachcarter-simon-slice4-reconciliation-checkpoint`, branch
  `codex/simon-slice4-reconciliation-checkpoint`. Fetched `origin/main` before
  work and again before deployment; remote, fetched ref, worktree `HEAD`, and
  merge base remained exact required PR #363 merge
  `019bfc13c6f19443398ab1293c0dd19b865553d1`. All pre-existing worktrees and
  user changes were preserved.
- Re-read the complete required worker/project/Stripe/launch documents and
  reverified the protected LF-normalised SHA-256 values before provider work:
  product specification
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
  and technical plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
  Pinned `stripe@22.4.0` exposed the reviewed public `rawRequest` pagination
  surface. Local preflight passed route/state-machine `22/22`, installed-
  Chrome UI `2/2`, canonical schema `14/14`, migration-035 guards `9/9` with
  original checkout bytes restored, syntax `204/204`, and C1 `276/276`. No
  local test used a staging credential or contacted Stripe.
- Fresh connected Neon metadata proved exact organisation
  `org-fancy-forest-47074420`, project `shiny-bonus-66942766`, retained branch
  `br-dark-recipe-zarmjbix` / `cc-simon-s4-acceptance-01-20260809`, database
  `neondb`, and compute `ep-wandering-field-zadlm6r7`. The branch remained
  ready, non-primary, non-default, unprotected, and descended from
  `br-empty-cell-za5kh6nr`. Read-only school-scoped preflight proved migration
  041 intact; school gate false; payout engine `v1`; two active, unpaused
  synthetic instructors with null legacy mappings; one Fraser scope and
  observation; and Simon's singular unmapped `reconciling` intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` with only its original
  `provider_ambiguous` attempt. Four lesson payment contracts and all inspected
  payout/refund/earning/transfer/cutover zero counts and hashes matched the
  retained baseline.
- Fresh Vercel metadata proved exact project
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, name `cc-simon-s4-staging-02`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`, custom Preview environment `staging`
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA` with no domains, and zero Production
  variables. Pulled configuration proved `STRIPE_MODE=test`, all five
  operation gates and the global gate false, and the live gate absent.
  Disabled preflight deployment `dpl_6kbDJnsTLqu3MYLPnEgyTrQhjHg9` was
  `READY`, exact source SHA, `gitDirty=NULL`, custom environment `staging`, and
  retained only the automatic staging alias.
- Temporarily enabled only `STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED` and
  `STRIPE_CONNECT_V2_ENABLED`; the link, dashboard-link, agreement, webhook-
  processing, live, Slice 3, and money-operation gates remained false. Exact
  clean enabled deployment `dpl_7m4F1NH8Aqf3hTa4Bi7G97LVNq6c` was `READY`,
  exact source SHA, `gitDirty=NULL`, and staging-only. A guarded Neon update
  then changed only school `1`'s `features.stripe_connect_accounts_v2` Boolean
  to true while preserving payout engine `v1` and null legacy school mapping.
- The retained staging authentication could not be used safely. Vercel
  environment pull intentionally returned no readable `JWT_SECRET`, and its
  non-mutating environment runner omitted that Sensitive variable from the
  child process. A proposed persistent staging JWT rotation was rejected
  before execution because it was an additional authentication mutation not
  explicitly authorised. No workaround was attempted. The authenticated/
  CSRF-bound `POST /api/connect?action=v2-account` request count is exactly
  zero; Stripe was never contacted; Accounts v2 list/create was never called;
  and the retained disabled destination was neither read nor changed.
- Mandatory shutdown set the account-creation staging gate false, then the
  global staging gate false, then the school Boolean false. A fresh provider
  pull proved all six gates false, `STRIPE_MODE=test`, and live absent. Final
  clean disabled deployment `dpl_2fiVKGXT8DnBLFZay3v96V37k1tV` is `READY`,
  exact source SHA, `gitDirty=NULL`, custom environment `staging`, and carries
  only alias
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  Production retained zero variables and was untouched.
- Read-only postflight matched preflight exactly. Simon remains stable identity
  `cc:connect-v2:1:3:test:recipient`, original intent `reconciling`, attempt
  count `1`, scope count `0`, and observation count `0`. Fraser remains one
  scope and one `api.account_created` observation. Both instructors remain
  active/unpaused with null legacy mappings; Slice 3 remains unactivated
  `shadow`; lesson payment contracts remain `4`; and all inspected payout,
  refund, earning, transfer, and cutover counts remain zero. Baseline hashes
  for legacy Connect state, Slice 3 config, lesson payment contracts, payout
  runs, refunds, launch earnings/transfers, and payout transfers are unchanged.
- Final local regression passed `615/615` across the current 65-file non-
  integration Stripe/auth/tenant/booking/credit/refund/payout/webhook/Connect
  matrix using installed system Chrome. Migration-035 checkout SHA
  `f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`
  was restored exactly after the guard run.
- Status is `STAGING_RECONCILIATION_CHECKPOINT_STOPPED_DISABLED`. Resumption
  requires separate authority for either a valid ephemeral Simon staging
  session or rotation of only the isolated staging JWT. The first later Stripe
  action must still be the single reconciliation request for the preserved
  Simon identity and must never create a replacement account. Slice 3 was not
  activated and Slice 5 was not started.

### 10 August 2026 - Slice 4 JWT-authorised reconciliation checkpoint stopped at Vercel protection and disabled

- Resumed from fresh worktree
  `C:\tmp\coachcarter-simon-slice4-reconciliation-completion`, branch
  `codex/simon-slice4-reconciliation-completion`, after PR #364 merged. Fetched
  `origin/main`, worktree `HEAD`, and merge base were exact merge commit
  `e0acd83ba1fcf8bcfc2516359dd42d72b546115d`; exact merge CI run
  `31398122278` had completed successfully. All other worktrees and user changes
  were preserved.
- Reconfirmed protected LF-normalised hashes exactly: product specification
  `79778382071613efbb9dec4e17f135a63c9f8d8b3010d921882d7ed631530dd4`
  and technical plan
  `64bc84e3ce8303e8cbe1c7fa0e8adeb221e7f4ad3294c5871417e06f0eeaf916`.
  Pinned `stripe@22.4.0` remained exact. Credential-free preflight passed
  Accounts v2 route/state-machine `22/22`, installed-Chrome UI `2/2`, canonical
  launch schema `14/14`, migration-035 guards `9/9` with original checkout
  bytes restored, syntax `204/204`, and C1 `276/276`.
- Fresh provider and database preflight reconfirmed exact isolated Vercel
  project `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, custom Preview environment
  `staging` `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, zero custom domains, and zero
  Production variables; and exact Neon organisation
  `org-fancy-forest-47074420`, project `shiny-bonus-66942766`, retained ready
  non-primary/non-default/unprotected branch `br-dark-recipe-zarmjbix`, database
  `neondb`, and compute `ep-wandering-field-zadlm6r7`. All six staging gates
  and school `1`'s Boolean were false; the live gate was absent.
- Database preflight retained Simon intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` in `reconciling`, stable identity
  `cc:connect-v2:1:3:test:recipient`, only attempt 1
  `provider_ambiguous`, no provider ID/scope/observation, one unchanged Fraser
  scope/observation, active unpaused synthetic instructors with null legacy
  mappings, payout engine `v1`, unactivated Slice 3 `shadow`, four lesson
  payment contracts, and all inspected payout/refund/earning/transfer/cutover
  counts zero. Retained hashes matched the preceding checkpoint exactly.
- Disabled exact-source preflight deployment
  `dpl_GzohgMe4w5MUCEuwf7X6dYUvRjH2` was `READY`, `gitDirty=NULL`, custom
  environment `staging`, and carried only the staging alias. Under the owner's
  explicit authority, a fresh 64-character random JWT was generated in memory,
  never persisted to disk or printed, and used to update only staging
  `JWT_SECRET` as Sensitive. Rotated-JWT disabled deployment
  `dpl_4fyPzrPub3YsH5uJLcUppWpiGTmE` passed the same exact deployment guard;
  all operation/global/school gates remained false.
- Temporarily enabled only staging
  `STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED=true` and
  `STRIPE_CONNECT_V2_ENABLED=true`. Link, dashboard-link, agreement, webhook-
  processing, live, Slice 3, and money-operation gates remained false. Exact
  clean enabled deployment `dpl_8Z18XLDBALyrF7iMEkzfaqVFV474` was `READY`,
  exact source SHA, `gitDirty=NULL`, and staging-only. Only then did a guarded
  Neon update set school `1`'s feature Boolean true while preserving payout
  engine `v1` and null legacy school mapping.
- Exactly one authenticated/CSRF-bound `POST /api/connect?action=v2-account`
  was dispatched to the custom staging alias with redirects disabled and no
  client retry. Vercel deployment protection returned HTTP `401` with code
  `Protected deployment`, `vercel_auth_enabled=true`, before the CoachCarter
  function executed. The response was not retried or redirected. The
  application therefore made no Accounts v2 list or create call, Stripe was
  not contacted, and no account, scope, observation, intent attempt, audit row,
  provider object, event, payment, refund, earning, payout, transfer, cutover,
  Slice 3, Slice 5, or production mutation resulted.
- Mandatory shutdown set the staging account-creation gate false, then the
  staging global gate false, then the school Boolean false. The ephemeral local
  JWT copy was cleared. A fresh pull proved all six gates false,
  `STRIPE_MODE=test`, and live absent. Final disabled deployment
  `dpl_F657tCmJdCbfwsjbdEMmsQaf5fgy` is `READY`, exact source SHA,
  `gitDirty=NULL`, custom environment `staging`, and has only alias
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  The rotated JWT remains Sensitive only in staging; Production still has zero
  variables.
- Read-only database postflight matched preflight exactly: Simon remains
  `reconciling` with attempt count `1`, scope `0`, observation `0`, and no
  provider ID; Fraser remains scope `1` and observation `1`; all Slice 4 row
  counts, instructor/payout/Slice 3 state, financial counts, and recorded hashes
  are unchanged. The retained disabled Stripe event destination was neither
  queried nor changed because the first Stripe action never occurred.
- Final current non-integration regression passed `615/615` across the 65-file
  Stripe/auth/tenant/booking/credit/refund/payout/webhook/Connect matrix using
  installed system Chrome. Migration-035 checkout bytes were restored exactly.
- Status remains `STAGING_RECONCILIATION_CHECKPOINT_STOPPED_DISABLED`. No
  retry is authorised. A later attempt requires separate explicit authority
  and a prevalidated Vercel-authenticated transport; it must still submit only
  one reconciliation request and never create a replacement Simon account.

## 10 August 2026 — post-PR #365 resume stopped at protected product hash

- Started from fresh remote `main`
  `a90acfd5243b1dc3501a0e86a79d9aa8dbbff8a6` in isolated worktree
  `C:\tmp\coachcarter-simon-slice4-reconciliation-resume` on branch
  `codex/simon-slice4-reconciliation-resume`. This source descends from merged
  PR #365 (`9ca1e5e6b34dda693298923e153433f98db2e994`); PR #365's recorded checks
  passed. Current `main` also includes later merged PRs #366 and #367.
- Read every mandated repository and launch document before provider or
  application action. The current source's LF-normalised protected hashes are:
  product specification
  `B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585`;
  technical implementation plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
  The product hash does not match this log's approved
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`.
  Repository history attributes the protected product-document change to PR
  #366. No replacement approved hash or explicit product-document review was
  found in the current source. The living log explicitly requires a stop on
  either protected-document hash changing, so this was a hard preflight stop.
- Static code review confirmed that a `submitting` or `reconciling` intent
  enters reconciliation/listing and returns before the Accounts v2 create
  branch. Focused readiness tests pin the no-replacement contract and passed
  `38/38`. Syntax checks passed for `206` JavaScript files, and the C1 scan
  passed across `278` files. The prior checkpoint's full `615/615` regression
  remains the latest full-suite evidence; this stopped resume did not rerun the
  full matrix after the protected-document mismatch was found.
- Vercel preflight matched the isolated staging project
  `coachcarteruk-2599s-projects/cc-simon-s4-staging-02`, project ID
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, custom staging environment ID
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, and alias
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  Retained disabled deployment `dpl_F657tCmJdCbfwsjbdEMmsQaf5fgy` is `READY`.
  It remains the previous checkpoint's exact-source disabled deployment; no
  fresh current-source deployment was produced because the source-integrity
  prerequisite failed first.
- Read-only named-variable verification against only the non-secret controls
  proved all six staging operation/global gates exactly `false`,
  `STRIPE_MODE=test`, and the live gate absent. Production has zero environment
  variables. The broad environment pull was not used because it could expose
  unrelated secrets. The school `1` Slice 4 Boolean is `false`. No gate or
  environment value was changed, so shutdown was already in its required
  disabled state and no shutdown deployment was necessary or authorised after
  the preflight stop.
- Read-only Neon postflight matched project `shiny-bonus-66942766`, branch
  `br-dark-recipe-zarmjbix`, database `neondb`, school `1` CoachCarter Driving
  School (`coachcarter`), and synthetic Simon instructor `3`. Simon's intent is
  `3c2349a0-1696-4b57-b732-fc14bbde57df`, state `reconciling`, stable identity
  `cc:connect-v2:1:3:test:recipient`, mode `test`, with no provider mapping or
  scope. Exactly one retained attempt exists: attempt `1`, outcome
  `provider_ambiguous`, error class `network`; Simon has scope `0` and
  observations `0`. Fraser remains scope `1` and observation `1`.
- Final database counts remain: intents `2`, attempts `2`, link events `0`,
  scopes `1`, observations `1`, agreements `1`, lesson payment contracts `4`,
  payout runs `0`, refund intents `0`, refund events `0`, launch earnings `0`,
  launch transfer intents `0`, payout transfers `0`, payout transfer attempts
  `0`, cutover configs `0`, cutover shadow cycles `0`, cutover readiness rows
  `0`, and cutover events `0`. Slice 3 `simon_launch_v1` remains `shadow`, not
  activated, and not paused. Because no write or operational request occurred,
  database before/after state is unchanged and there was no account, user,
  payment, refund, earning, payout, transfer, cutover, Slice 3, Slice 5, or
  Production mutation.
- Exact Simon reconciliation request count in this resume: **zero**. HTTP and
  application outcome: **not attempted**, because the protected-hash guard
  failed before the harmless transport GET. Stripe actions performed: **none**;
  there was no list/reconciliation call and no Accounts v2 create call. The
  staging JWT was not rotated, generated, read, printed, or persisted. The
  retained disabled Stripe event destination was not queried or changed.
- Final status:
  `STAGING_RESUME_STOPPED_PROTECTED_PRODUCT_HASH_MISMATCH_DISABLED`. Resumption
  requires explicit owner review of the protected product-document change and
  approved integrity evidence. No retry or workaround was attempted.

## 10 August 2026 — owner-approved protected product hash rebaseline

- After PR #368 merged as
  `5014d73f1a6776fb0735a57b2fdb840df8123649`, the owner explicitly confirmed
  that the PR #366 protected product-specification changes had been reviewed
  and approved, including the cross-instructor rescheduling policy.
- The owner explicitly approved LF-normalised SHA-256
  `B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585` as the
  replacement protected baseline. A fresh byte-level verification on exact
  merged `main` reproduced that value. The protected technical implementation
  plan independently reproduced its unchanged approved hash
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- This rebaseline resolves only the product-document integrity stop. It does
  not retrospectively turn the stopped resume into an attempted reconciliation
  and does not grant new operational authority. Historical entries retain the
  old hash and the exact reason that the earlier session stopped.
- No Vercel, Neon, application, Stripe, authentication, configuration, gate,
  school, account, user, payment, refund, earning, payout, transfer, cutover,
  Slice 3, Slice 5, or Production action was performed for this docs-only
  rebaseline. The last verified disabled staging and database state recorded by
  PR #368 remains the operational handover state.
- Current status:
  `PRODUCT_SPEC_HASH_APPROVED_REBASELINED_RECONCILIATION_STOPPED_DISABLED`.
  Any future resume requires newly explicit operational authority and must
  begin from fresh `main`, repeat every preflight guard, preserve the original
  Simon identity, and retain the one-request/no-retry/no-replacement controls.

## 10 August 2026 — authenticated transport passed; reconciliation dispatch not sent; disabled

- Resumed under the owner's narrowly scoped reconciliation authority from
  fresh `origin/main` commit
  `f3c21d9bd75e4de4a4143ca243b4d06d0880865e`, the merge commit for PR #369,
  in isolated branch `codex/simon-s4-reconciliation-20260810`. PR #369 was
  merged with every required check successful. The LF-normalised protected
  hashes reproduced the approved product specification
  `B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585`
  and technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Read-only preflight matched isolated Vercel project
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, custom Preview environment `staging`
  (`env_vvxYWVPTHOiutcFOPmeWw2kX08mA`), zero custom-environment domains, and
  zero Production variables. Global, account-creation, and webhook-processing
  controls were exact string `false`; account-link, dashboard-link, agreement,
  and live controls were absent and therefore fail closed under the exact-true
  gate contract. `STRIPE_MODE=test`. School `1`'s feature value was exact JSON
  Boolean `false`.
- Neon preflight on retained branch `br-dark-recipe-zarmjbix` matched Simon
  instructor `3`, intent `3c2349a0-1696-4b57-b732-fc14bbde57df` in
  `reconciling`, stable identity `cc:connect-v2:1:3:test:recipient`, and its
  singular attempt `1` (`provider_ambiguous`, `network`). Simon had no provider
  mapping, scope, or observation; Fraser remained scope `1`/observation `1`.
  Instructors `2` and `3` were active and unpaused with no legacy mapping,
  payout engine remained `v1`, and `simon_launch_v1` remained inactive
  `shadow`.
- Static review and focused Accounts v2/UI/schema tests (`38/38`) reconfirmed
  that a `reconciling` intent lists/reconciles and returns before the Accounts
  v2 creation branch. A replacement account was not reachable from Simon's
  retained state.
- Fresh disabled deployment `dpl_GuyP2bCMXJSPYa2pxRrKahqtKkkM` was `READY`,
  exact source, clean, custom `staging`, and carried only the expected staging
  alias. Exactly one harmless Vercel-authenticated `GET /api/status` was sent
  with redirects and client retries disabled. It reached CoachCarter and
  returned the non-mutating JSON status at `2026-08-10T21:50:02.393Z`; the
  handler has no database or Stripe access. Harmless transport-test request
  count is **one**.
- Because the retained Sensitive staging JWT was unreadable, the one authorised
  staging-only `JWT_SECRET` rotation was performed from a memory-only
  controller. The value was never printed or written to disk. Rotated-disabled
  deployment `dpl_ELA5ofzPgDZFp8uou1v5zd5g22QB` and enabled deployment
  `dpl_BvwtMjKexqtgYDHMHj21PWT5Niaw` were each `READY`, exact source, clean,
  custom `staging`, and alias-only. Only account creation and the global gate
  were made true; every other operation/live gate remained false. A guarded
  Neon update then changed only school `1`'s existing Slice 4 Boolean to true.
- The local dispatch controller incremented its dispatch-attempt guard once,
  but a controller output-composition defect supplied its deployment
  verification marker alongside the deployment ID. The local command parser
  rejected that malformed argument (`exit 255`, `'id' is not recognized`)
  before `vercel curl` could issue an HTTP request. The exact Simon
  reconciliation HTTP POST count is therefore **zero**; there is no HTTP or
  application response. Enabled-deployment runtime request counts were empty.
  This was not retried or worked around. Stripe was not contacted, so neither
  Accounts v2 list nor create ran and no replacement account was created.
- Mandatory shutdown still ran immediately: account-creation false, global
  false, then a guarded school-Boolean update back to false. The memory-only
  JWT/session/CSRF values were cleared and the external controller/signals were
  removed. Final deployment `dpl_J3FB1xBf9CJAaLRxbqhXkARUzkc2` is `READY`,
  exact commit `f3c21d9bd75e4de4a4143ca243b4d06d0880865e`, `gitDirty=NULL`, custom
  `staging`, and bound only to
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  Postflight proves all six gates fail closed, the three present Slice 4
  controls exact `false`, the school Boolean exact false, live absent,
  `STRIPE_MODE=test`, and Production still at zero variables.
- Database postflight exactly retained intents `2`, attempts `2`, link events
  `0`, scopes `1` (Simon `0`, Fraser `1`), observations `1` (Simon `0`, Fraser
  `1`), agreements `1`, and lesson payment contracts `4`. Payout runs, refund
  intents/events, launch earnings/transfer intents, payout transfers/attempts,
  cutover configs/shadow cycles/readiness/events all remain `0`. Simon's exact
  intent and attempt are unchanged. Slice 3 remains inactive shadow; no Slice 5
  or Production state changed. The retained disabled Stripe event destination
  was neither queried nor modified.
- Final validation passed the focused `38/38` suite and the current 65-file
  non-integration Stripe/auth/tenant/booking/credit/refund/payout/webhook/
  Connect matrix `612/612`. Migration 035 was temporarily LF-normalised for
  its reviewed-byte verifier and restored to its original checkout hash.
- Final status is
  `STAGING_RECONCILIATION_DISPATCH_NOT_SENT_CONTROLLER_ARGUMENT_ERROR_DISABLED`.
  The authorised JWT rotation has been consumed and the no-retry rule remains
  binding. Any new attempt requires explicit owner approval; this audit does
  not authorise a correction or another dispatch.

## 11 August 2026 - deployment stdout shape mismatch; reconciliation not started; disabled

- Resumed under new owner authority from fresh merged `main`
  `91752b16deb704e1a9b69451d73689f7bcb84a2f` (PR #370) on isolated branch
  `codex/simon-s4-reconciliation-20260811`. PR checks were successful and the
  approved LF-normalised product/technical hashes reproduced exactly as
  `B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585` and
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Read-only retained-state preflight matched custom staging environment
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, zero Production variables, test mode,
  all operation/live gates fail closed, and school `1`'s existing Slice 4
  Boolean false. Simon instructor `3` retained intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df`, stable identity
  `cc:connect-v2:1:3:test:recipient`, state `reconciling`, its singular
  `provider_ambiguous`/`network` attempt, and no provider mapping, scope, or
  observation. Focused no-replacement/readiness tests passed `38/38`.
- The external controller first passed offline scalar-ID, array-rejection, and
  prior success-stream-pollution tests. It created a fresh disabled deployment
  but failed closed before transport when current Vercel deploy stdout parsed
  without the assumed `.id` field. No fallback, redeploy, or retry was made.
  Read-only inspection identified
  `dpl_EbTnh5cMqNiKZcayPRSUw68Nynih` as `READY`, exact PR #370 source,
  `gitDirty=NULL`, custom `staging`, and carrying only the expected staging
  alias.
- After the operational stop, the external parser was corrected locally for
  Vercel's deployment-URL stdout contract: require one HTTPS
  `*.vercel.app` URL, resolve it read-only, then select and validate the
  metadata `.id`. Offline plain/JSON-string URL tests passed and one read-only
  live validation resolved the existing disabled URL to exactly
  `dpl_EbTnh5cMqNiKZcayPRSUw68Nynih`. The correction was not used for any
  operational continuation.
- Harmless transport GET count is **zero**. Authenticated reconciliation POST
  count is **zero**. The newly authorised staging-only JWT rotation was not
  performed and is unconsumed. No environment or database write occurred; no
  gate or school flag was enabled. Stripe was not contacted, so Accounts v2
  list/create, replacement accounts, and event-destination actions are all
  zero.
- Read-only postflight retained intents `2`, attempts `2`, link events `0`,
  scopes `1` (Simon `0`), observations `1` (Simon `0`), agreements `1`, and
  lesson payment contracts `4`. All inspected payout/refund/earning/transfer/
  cutover counts remain `0`; Slice 3 remains inactive shadow. Staging remains
  disabled, live absent, test mode, and Production zero-variable.
- Regression evidence passed focused `38/38`, the current 65-file matrix
  `612/612`, syntax `206`, and C1 `278`. Migration 035 was restored to exact
  checkout SHA-256
  `f1297ae03e9329d986252a73f09889401a707b85c9ef68d60c97e1ed1e2c1709`.
  The two protected LF-normalised hashes remained exact after the docs edits.
- Final status is
  `STAGING_RECONCILIATION_STOPPED_DEPLOY_STDOUT_SHAPE_MISMATCH_DISABLED`.
  No retry is authorised. Any future attempt requires new explicit owner
  authority and every existing identity, no-replacement, one-request,
  no-retry, shutdown, and postflight control.

## 11 August 2026 - PR #371 reconciliation stopped on retained gate-shape mismatch; disabled

- Continued from fresh merged `main`
  `a6adc9d01904c59ce4b5e8df8cdb1a4e3e749f78`, the merge commit for PR #371,
  on branch `codex/simon-stripe-connect-slice4-reconciliation`. `HEAD` and
  `origin/main` were identical before work and the worktree was clean. The
  protected LF-normalised hashes reproduced exactly: product specification
  `B925C1500E7E775DC2A91AABDFA348BEB78045826875599E8EAACC7D54291585` and
  technical plan
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`.
- Static source review reconfirmed that Simon's `reconciling` intent enters
  Accounts v2 listing and returns before the `planned`-intent account-create
  branch. The temporary external controller was pinned to the PR #371 commit,
  isolated to fresh state paths, and corrected to inspect the application's
  plural account-link, dashboard-link, and agreement gate names. Its offline
  scalar-ID, array-rejection, success-stream-pollution, plain-URL, and
  JSON-string URL tests passed. The controller file SHA-256 was
  `9A278BD6901CCABE614983B21825554A36703F3A0429D05E4204BE06F9321084`.
- Read-only preflight matched exact Neon project `shiny-bonus-66942766`,
  database `neondb`, and retained temporary branch
  `br-dark-recipe-zarmjbix`, which remained ready,
  non-primary/non-default/unprotected. School `1` retained exact JSON Boolean
  `false` for `features.stripe_connect_accounts_v2`, payout engine `v1`, and
  null legacy school mapping. Simon instructor `3` remained active, unpaused,
  and unmapped with intent `3c2349a0-1696-4b57-b732-fc14bbde57df`, stable
  identity `cc:connect-v2:1:3:test:recipient`, state `reconciling`, and only
  attempt 1 `provider_ambiguous`/`network` with provider code `ETIMEDOUT`.
  Simon scope and observation counts remained zero; Fraser remained the one
  retained scope and observation.
- The corrected controller's initial disabled-gate assertion then stopped
  before deployment. Contrary to the retained handover's absent-gate shape,
  `STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED` was present. Sanitised read-only
  inventory established the complete actual shape: global, account creation,
  account links, dashboard links, agreements, and webhook processing were all
  present and exact `false`; live remained absent and `STRIPE_MODE=test`.
  This is fully disabled behavior, but it does not satisfy the reviewed
  controller's exact absent-gate invariant. Per the mismatch/controller-error
  stop rule, there was no correction, deployment, URL-to-ID live-shape
  validation, enablement, transport probe, dispatch, or operational retry.
- Exact staging-only JWT rotation count is **zero**. Exact harmless transport
  GET count is **zero**. Exact authenticated, CSRF-bound Simon reconciliation
  POST count is **zero**. No Vercel environment or Neon row was written and no
  controller state/signal/result file was created. The existing staging
  `JWT_SECRET` remains one Sensitive record; Production remains at zero
  variables. The first permitted Stripe action was never reached, so Accounts
  v2 list/create, replacement-account, direct provider-create, and disabled
  event-destination action counts are all zero.
- Read-only Vercel postflight retained latest deployment
  `dpl_EbTnh5cMqNiKZcayPRSUw68Nynih`, READY from exact PR #370 source; no
  PR #371 deployment exists. Deployment-scoped runtime request-path and status
  counts remain empty. Read-only Neon postflight matched preflight exactly:
  intents `2`, attempts `2`, link events `0`, scopes `1` (Simon `0`),
  observations `1` (Simon `0`), agreements `1`, lesson payment contracts `4`,
  and all inspected payout/refund/earning/transfer/cutover counts `0`. The
  ledger-state fingerprint remained
  `c308d045ffd57a922d40cb17d2b2d918`; Slice 3 remains inactive `shadow`.
- Regression evidence passed focused Accounts v2/UI/schema tests `38/38`,
  syntax `206/206`, and C1 `278/278`. The current 65-file non-integration
  matrix ran once: `602/612` passed and ten browser-backed UI cases failed only
  because Chromium launch returned operating-system `spawn EPERM` (eight
  refund UI cases and two Connect UI cases). No assertion failed and the suite
  was not retried or moved to another browser. Migration 035 was already pure
  LF and exact to the tracked HEAD blob, SHA-256
  `7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`;
  it was not rewritten.
- Final status is
  `STAGING_RECONCILIATION_STOPPED_GATE_SHAPE_MISMATCH_DISABLED`. Mandatory
  disabled-state postflight is complete. This attempt performed no Stripe
  action and consumed no JWT rotation, but the no-retry stop remains binding;
  any future attempt requires fresh owner direction after reviewing the exact
  present-false gate shape.

## 11 August 2026 - owner-approved approval-controlled MVP rebaseline

- Fraser chose to keep and launch toward the new Accounts v2/source-backed
  system rather than place Simon on the legacy payout regime. The product and
  technical plans now define an approval-controlled beta as the immediate
  launch boundary while retaining the fuller automation design as post-MVP
  scope.
- The MVP automates only post-cutover direct single-slot payments with exact
  one-payment/one-lesson evidence, an explicit instructor outcome, immutable
  agreement economics, Simon's £90 weekly obligation/carry-forward, Fraser's
  £0 weekly fee, protected cash, immutable statements, deterministic transfer
  idempotency and reconciliation. Tenancy, auth, audit, restricted authority,
  school-wide engine isolation and no-replacement-account controls remain
  non-negotiable.
- Automatic refunds, learner issue automation, outcome reminders, automated
  dispute lifecycle/recovery, unattended Friday scheduling, automatic
  statement delivery, bank-arrival correlation, and practical-test/offer/
  captured-request automated origins are deferred. During the beta, reviewed
  operator refund procedures and audited issue/dispute/payment holds apply;
  affected lessons cannot be waived into earnings.
- Two accepted shadow Fridays remain required. Each of the first four live
  Friday runs requires Fraser's exact approval, immediate reconciliation and a
  signed review. A successful first run does not enable unattended operation;
  that requires a separate owner decision and reviewed code/config change.
- The MVP delivery sequence is now: complete Simon's retained Slice 4
  reconciliation/onboarding using a version-controlled controller; implement
  direct-slot contract/outcome eligibility and manual holds; reconcile the
  planner/fee/statement/approval model; adapt durable transfers and school-wide
  routing; then shadow and perform a controlled cutover. Completed inactive
  ledger, transfer, webhook, protected-balance and cutover foundations are
  reused rather than rebuilt.
- This documentation rebaseline began from clean merged `main`
  `52ff27aad0e0edc4619da80648c779b35f39f023` (PR #372) on branch
  `codex/simon-launch-mvp-rebaseline`. It deliberately changes both protected
  documents under the owner's new scope decision. The replacement
  LF-normalised SHA-256 values are product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
- No Vercel, Neon, Stripe, environment, authentication, gate, school,
  database, account, payment, refund, earning, payout, transfer, cutover,
  deployment or production action was performed. Simon's last verified
  retained staging identity/state and the fully disabled gates recorded by PR
  #372 are not changed or assumed reverified by this docs-only decision.
- Local verification passed the focused Accounts v2/UI/schema suite `38/38`,
  syntax `206/206`, C1 `278/278`, `git diff --check`, and the complete
  Playwright regression discovery of `1321` tests with exit code `0`. No
  database integration gate was enabled and no external service was contacted.
- Current status:
  `APPROVAL_CONTROLLED_MVP_REBASELINED_NOT_IMPLEMENTED_NOT_DEPLOYED`.
  The next implementation work is MVP A's reviewed controller and Connect
  completion. Any operational reconciliation still requires separately scoped
  authority and a new full preflight; this rebaseline grants none.

## 11 August 2026 - MVP A1 staging reconciliation controller prepared locally only

- Began from clean, freshly updated `origin/main`
  `c85381e53d2c4e9754e80c093d60b0fac10061b0`, the merge commit for PR #373,
  on branch `codex/simon-staging-reconciliation-controller`. GitHub confirmed
  PR #373 was merged before the branch was created.
- Reproduced the approved LF-normalised protected hashes before editing:
  product specification
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical implementation plan
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  Neither protected document was modified.
- Added the repository-owned, dependency-injected Node controller
  `scripts/stripe-connect-simon-staging-controller.js`. Its no-argument mode is
  offline/dry-run with a zero request budget. Operational mode requires an
  explicit approval phrase and an absolute external adapter outside the
  repository; the adapter surface is sealed and exposes no direct provider
  account-creation operation.
- The controller pins Simon instructor `3`, intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df`, and stable identity
  `cc:connect-v2:1:3:test:recipient`. It requires retained state
  `reconciling`, forbids replacement/direct creation, permits exactly one
  authenticated and CSRF-bound POST only to
  `/api/connect?action=v2-account`, and requires listing to be the first Stripe
  action with zero account-create calls. Redirects, retries, alternate routes,
  ambiguous transport, zero/multiple matches, mismatches and improvised retries
  fail closed.
- The corrected deployment contract accepts only one plain or JSON-string HTTPS
  `*.vercel.app` URL, rejects arrays/multiple values/pollution, resolves the URL
  read-only, requires one scalar `dpl_...` ID, and validates exact project,
  custom `staging` environment, clean commit, staging-only alias/domain and
  non-production target before enablement.
- Disabled preflight and shutdown require all six named Slice 4 gates present
  and exact `false`, live absent or exact `false`, `STRIPE_MODE=test`, Production
  proven untouched, and the guarded school value exact JSON Boolean false.
  Minimal enablement is structurally limited to global true, account creation
  true solely for the existing route, and the school Boolean true. Shutdown
  always attempts account creation false, global false and school false in that
  order, then proves the complete disabled state and validates a final disabled
  deployment.
- Offline fault-injection tests passed `11/11`; the existing Accounts
  v2/UI/schema suite passed `38/38`; syntax passed `206/206`; C1 passed
  `278/278`; the full local Playwright regression passed all `1332` discovered
  tests; and `git diff --check` passed. The default repository controller command
  returned offline mode with POST count `0`.
- This was controller preparation only. No Vercel or Neon metadata request,
  harmless GET, deployment, environment read/write, JWT rotation, gate change,
  school-Boolean read/write, database query/write, authenticated reconciliation
  POST, Stripe list/create, account, event-destination, payment, refund, earning,
  payout, transfer, cutover, Slice 3, Slice 5 or Production action occurred.
  Sensitive provider output and authentication material were neither printed
  nor persisted. Retained external state was not operationally reverified and
  is not claimed changed.
- Current status is
  `MVP_A1_STAGING_CONTROLLER_PREPARED_FOR_REVIEW_NOT_OPERATED`. Stop after the
  draft controller PR. Simon reconciliation remains prohibited until this
  controller PR is reviewed and merged and Fraser provides new explicit
  operational authority.

## 11 August 2026 - MVP A2 controller stopped before dispatch; disabled postflight

- Began from freshly updated merged PR #374 at
  `d4a6c2dfd934499b3454fd27aaf8a5d871a3fed4` on isolated branch
  `codex/simon-staging-reconciliation-mvp-a2`. The protected LF-normalised
  product and technical hashes remained exact at
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  The merged controller and focused Accounts v2/UI/schema suite passed
  `49/49` before operation.
- Read-only Vercel preflight proved all six reviewed staging gates exact
  `false`, live absent, `STRIPE_MODE=test`, Production at zero environment
  records, and exactly one staging-only Sensitive `JWT_SECRET` record.
  Read-only Neon preflight used explicit retained non-primary branch
  `br-dark-recipe-zarmjbix` and proved school `1`'s feature exact JSON Boolean
  false, Simon instructor `3` active, the original intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` still `reconciling`, its stable
  identity unchanged, its sole attempt still `provider_ambiguous`/`network`,
  and no provider mapping, intent scope, Simon scope, observation, successful
  attempt, reconciled attempt, or replacement.
- The merged controller created disabled deployment
  `dpl_3hf2XmZNRnbcNjK81tyMbPfmcky1`, but stopped before minimal enablement.
  Its adapter emitted `staging_deployment_created` without the subsequent
  `deployment_verified` marker, so the fail-closed path was entered before
  either enable gate, the school Boolean, or authentication material changed.
  Independent read-only metadata inspection proved the already-created
  deployment READY, non-production, clean `gitDirty=NULL`, exact merged source,
  exact custom staging environment, and the one expected staging alias.
  Although the raw stdout bytes were not retained, read-only inspection of the
  exact cached package used by the adapter established the structural contract
  without another deployment: `vercel@latest` resolved to CLI `58.9.1`, the
  inherited Codex marker plus non-TTY stdin selected agent/non-interactive
  mode, and that success path writes a JSON object with `status: "ok"` and the
  scalar deployment URL at `deployment.url`. The merged parser accepted only a
  plain URL or JSON-string URL, so it deterministically rejected this object
  before calling `resolveDeploymentUrl`. No historic stdout value is
  reconstructed or assumed.
- During shutdown, the external Neon bridge checkpoint was mistakenly treated
  as an enable request even though it was the idempotent `set_school_false`
  shutdown proof. The bridge returned failure without executing SQL, causing
  the controller to report `MANDATORY_SHUTDOWN_FAILED`. No school write was
  needed or made because the value remained false. The controller still wrote
  both staging gates false and created its final disabled deployment.
- Independent mandatory postflight proved the real shutdown state complete.
  Final deployment `dpl_AdnxVB9VGnFmtJYt6Z7Mnh2EjVWU` is READY,
  non-production, clean, from exact merged commit `d4a6c2d`, in custom
  `staging`, and bound only to the expected staging alias. All six staging
  gates are exact `false`, live is absent, `STRIPE_MODE=test`, school `1` is
  exact JSON Boolean false, and Production remains untouched at zero variables.
- Exact staging JWT rotations: **zero**. Exact reconciliation POSTs: **zero**.
  Exact redirects, retries, harmless probes, Accounts v2 list calls, account
  creates, direct provider creates, replacement accounts, and onboarding calls:
  **zero**. No Stripe request was dispatched and no authentication secret,
  provider payload, or connection string was printed or persisted.
- Neon postflight matched preflight: intents `2`, attempts `2`, link events
  `0`, scopes `1` (Simon `0`), observations `1` (Simon `0`), agreements `1`,
  and lesson payment contracts `4`. Simon's intent, stable identity, state,
  sole attempt, and unmapped status are unchanged. Payout runs, refund intents/
  attempts, launch earnings/transfer intents/attempts, payout transfers/
  attempts, and all inspected cutover config/shadow/readiness/event counts
  remain `0`.
- Final status is
  `MVP_A2_STAGING_RECONCILIATION_NOT_DISPATCHED_CONTROLLER_DEPLOY_OUTPUT_STOP_DISABLED`.
  This operational run is stopped without retry despite the unused POST and JWT
  budgets. Simon remains unresolved and onboarding remains prohibited. Any
  future operational attempt requires fresh owner authority after a reviewed
  correction to the retained deployment-output evidence path.

- The repository correction is deliberately limited to recognising the exact
  agent success envelope and extracting only its scalar `deployment.url`.
  Error-status, missing/malformed deployment objects, arrays, polluted output,
  non-HTTPS, non-Vercel hosts, paths and multiple values still fail closed. URL
  resolution remains read-only, and the independent exact project, custom
  environment, commit, clean-source, alias/domain and non-production metadata
  checks are unchanged. Focused fault injection also proves a rejected agent
  envelope reaches ordered mandatory shutdown with zero enablement and zero
  reconciliation POSTs. This correction is repository preparation only and
  does not authorise or retry the stopped operation.
- Final local verification passed the corrected controller tests `12/12` and
  the unchanged Accounts v2/UI/schema tests `38/38` (`50/50` combined), plus
  `git diff --check`. The protected LF-normalised product and technical hashes
  remained exact at the approved values above. This diagnosis and repair made
  no Vercel, Neon, Stripe, environment, deployment, JWT, gate, school-feature,
  database, reconciliation, account, replacement, onboarding or Production
  request or mutation. Repository status is
  `MVP_A2_CONTROLLER_DEPLOY_AGENT_OUTPUT_CORRECTION_PREPARED_NOT_OPERATED`.

## 11 August 2026 - MVP A3 stopped on absent clean-source evidence; disabled postflight

- Fraser authorised one Simon staging reconciliation attempt from merged PR
  #375 commit `63c4b86f83104062cbeca7be34878d0cba024e0e`, preserving the exact
  isolated project, custom `staging` environment, retained Simon identity,
  no-replacement rule, one authenticated POST, zero retries, mandatory
  shutdown and no onboarding. The attempt ran once from a clean detached
  deployment worktree on branch `codex/simon-staging-reconciliation-mvp-a3`.
  The protected LF-normalised product and technical hashes remained exact at
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  The merged controller and Accounts v2/UI/schema suite passed `50/50`, and
  the no-argument controller reported offline mode with POST count `0`.
- Fresh read-only Vercel preflight proved exact project
  `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`, custom Preview environment `staging`
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, all six reviewed gates exact `false`,
  live absent, `STRIPE_MODE=test`, one staging-only Sensitive `JWT_SECRET`
  record and zero Production variables. Fresh Neon preflight explicitly used
  retained non-primary/non-default/unprotected branch
  `br-dark-recipe-zarmjbix`; school `1` remained exact Boolean false with
  payout engine `v1`, Simon instructor `3` remained active and unpaused with
  no legacy mapping, and the original intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` remained unmapped `reconciling` with
  stable identity `cc:connect-v2:1:3:test:recipient`, its single
  `provider_ambiguous`/`network` attempt, zero scope and zero replacement.
- The only controller invocation created disabled deployment
  `dpl_EvZU97KjnvH89EbK2LkisB9j47oj`. The merged agent-envelope correction
  worked: the adapter emitted both `staging_deployment_created` and
  `deployment_verified`. The v13 metadata record was READY, exact project,
  exact custom environment, exact commit, staging-only alias/domain and
  non-production. It carried `meta.gitCommitRef = "HEAD"` but omitted the
  `meta.gitDirty` property. The controller requires that property to be
  present and exact `null`; it therefore failed closed before either enable
  gate, the school enable, JWT rotation or reconciliation dispatch.
- Ordered shutdown still set account creation false, global false and school
  false. The corrected external bridge accepted the required idempotent
  `set_school_false` checkpoint and executed one guarded school-1 update that
  returned exact Boolean false while preserving payout engine `v1` and the
  null legacy mapping. Final disabled deployment
  `dpl_FSgamEDDPXYRUqNhA6HCbpQuNxBg` was also READY, exact project,
  environment, commit, alias/domain and non-production, but its v13 metadata
  likewise omitted `meta.gitDirty`; the controller consequently reported
  `MANDATORY_SHUTDOWN_FAILED` even though independent state proof succeeded.
- Independent Vercel postflight proved all six staging gates exact `false`,
  live absent, `STRIPE_MODE=test`, Production still zero-variable and
  untouched, and the expected staging alias on the final deployment.
  Independent Neon postflight proved the school feature exact Boolean false
  and retained counts unchanged: intents `2`, attempts `2`, link events `0`,
  scopes `1` (Simon `0`), observations `1` (Simon `0`), agreements `1`, and
  lesson payment contracts `4`. Payout runs, refund intents/attempts, launch
  earnings/transfer intents/attempts, payout transfers/attempts remain `0`.
- Exact staging JWT rotations, authenticated reconciliation POSTs, redirects,
  retries, Accounts v2 list/create calls, direct provider creates,
  replacement accounts and onboarding calls were all **zero**. No Stripe
  request was dispatched and no authentication secret, provider payload or
  database connection string was printed or persisted.
- Final status is
  `MVP_A3_STAGING_RECONCILIATION_NOT_DISPATCHED_DEPLOYMENT_GIT_DIRTY_EVIDENCE_ABSENT_DISABLED`.
  The authorised attempt is consumed and stopped without retry. Simon remains
  unresolved and onboarding remains prohibited. Any future operational
  attempt requires fresh owner authority after a reviewed correction to the
  clean-source deployment-evidence path.

## 11 August 2026 - MVP A4 clean-source controller correction prepared; not operated

- Preparation began from freshly updated merged `main` at
  `6744ec0f6189b119a23c81b1a75044e36a82d030` on branch
  `codex/simon-staging-reconciliation-mvp-a4`. Retained evidence for
  deployments `dpl_EvZU97KjnvH89EbK2LkisB9j47oj` and
  `dpl_FSgamEDDPXYRUqNhA6HCbpQuNxBg` was used without another deployment or
  staging attempt. Both records matched the exact isolated project, custom
  `staging` environment, authorised commit, staging-only alias/domain and
  non-production target, but carried `meta.gitCommitRef = "HEAD"` and omitted
  `meta.gitDirty`. The controller's requirement that `meta.gitDirty` be present
  and exact `null` remains unchanged.
- The diagnosis is a deployment-source procedure gap. The controller previously
  learned that source proof was ambiguous only after a deployment existed; its
  sealed adapter did not have to prove a named branch/worktree before calling
  Vercel. Controller version 2 now requires `readDeploymentSource` before every
  deployment. The proof must state an actual worktree, non-detached HEAD, the
  exact `refs/heads/<expected branch>` symbolic ref, matching named branch,
  `HEAD` commit and branch-tip commit both equal to the exact authorised merged
  commit, explicit clean state, and empty porcelain status including untracked
  files. Missing or contradictory proof fails before deployment and before any
  enablement.
- A future separately authorised adapter must therefore deploy from a fresh
  named branch/worktree pinned to that attempt's exact authorised merged commit,
  set the same branch and commit in `expectedDeployment`, and derive the source
  proof immediately before each deployment. Deployment metadata must then
  reproduce the exact named `meta.gitCommitRef`, exact commit and the existing
  explicit `meta.gitDirty === null` proof. Detached `HEAD`, absent symbolic-ref
  evidence, dirty/untracked status, branch/HEAD/tip mismatch, `HEAD` metadata,
  or absent/ambiguous `gitDirty` all fail closed.
- Focused controller tests passed `15/15`; detached/missing named-branch proof,
  dirty/untracked and mismatched source, and absent deployment `meta.gitDirty`
  fault injections each retained POST count `0` and exercised ordered shutdown.
  Exact named clean source plus exact commit and explicit `gitDirty: null`
  reached deployment validation only with POST count `0`. The unchanged
  Accounts v2/UI/schema suite passed `38/38` (`53/53` combined), and
  `git diff --check` passed. Protected LF-normalised hashes remained exact:
  product `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
- This was repository preparation only. Vercel, Neon and Stripe were not
  contacted; no deployment, gate or school flag change, JWT rotation,
  authenticated reconciliation POST, database write, Accounts v2 list/create,
  direct provider create, replacement account, onboarding action or Production
  action occurred. Status is
  `MVP_A4_CLEAN_SOURCE_CONTROLLER_CORRECTION_PREPARED_NOT_OPERATED`. Simon's
  retained intent, stable identity and no-replacement controls remain unchanged;
  a future attempt still requires fresh explicit owner authority.

## 11 August 2026 - MVP A5 stopped on external source-proof comparison; disabled with no deployment

- Fraser authorised exactly one no-retry Simon staging reconciliation attempt
  from freshly merged `main` commit
  `eebf15e44cf7359585be62e6fc9d2162261e802b`. The attempt used fresh named
  branch `codex/simon-staging-reconciliation-mvp-a5` and worktree
  `C:\tmp\coachcarter-simon-mvp-a5-eebf15e`. Immediately before operation,
  source proof was `insideWorkTree=true`, `detached=false`, symbolic ref
  `refs/heads/codex/simon-staging-reconciliation-mvp-a5`, matching named
  branch, `HEAD` and branch tip both the exact authorised commit, clean true,
  and empty tracked/untracked porcelain status. The protected LF-normalised
  hashes matched exactly: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
- Pre-operation local evidence passed all `55/55` selected tests: controller
  `15/15`, Accounts v2 `22/22`, Accounts v2 UI `2/2`, and payout v2 schema
  `16/16`. The no-argument controller returned version `2`, offline dry-run,
  completed true, POST count `0`, and shutdown complete false.
- Fresh read-only Vercel preflight proved isolated project
  `cc-simon-s4-staging-02` / `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`, custom Preview environment `staging` /
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, and staging-only alias
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  All six staging gates were exact `false`, live was absent,
  `STRIPE_MODE=test`, exactly one staging-only Sensitive `JWT_SECRET` record
  existed, and Production had zero environment records.
- Fresh read-only Neon preflight explicitly used retained ready branch
  `br-dark-recipe-zarmjbix` in project `shiny-bonus-66942766`, database
  `neondb`. The branch remained non-primary, non-default and unprotected.
  School `1` retained exact JSON Boolean false and payout engine `v1`; Simon
  instructor `3` was active with no legacy mapping. Original intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` remained unmapped `reconciling`, test
  recipient/Express identity `cc:connect-v2:1:3:test:recipient`, with exactly
  one attempt `1` at `provider_ambiguous` / `network`, zero Simon scope,
  observation or replacement account, and no conflicting financial or cutover
  activity.
- Controller v2 was invoked exactly once with approval
  `SIMON_STAGING_RECONCILIATION_APPROVED` and the external adapter at
  `C:\tmp\cc-simon-mvp-a5-adapter.js`. The adapter returned every required
  source fact correctly. Before invoking Vercel, however, its extra defensive
  check compared the controller-normalised source object and its fresh source
  object with `JSON.stringify`. The objects had identical keys and values but
  different property insertion order, so the adapter raised
  `DEPLOYMENT_SOURCE_CHANGED`. This stopped the attempt before the disabled
  deployment, any enablement, JWT rotation, authentication material,
  reconciliation POST or Stripe request. Read-only Vercel deployment listing
  found exactly zero deployments carrying the A5 branch or authorised commit.
- The controller entered its mandatory finally path without retry. It applied
  the required idempotent staging updates in order: account-creation false,
  global false, then one guarded school-1 Boolean-false update on the retained
  Neon branch. Disabled state reads passed. The same external adapter comparison
  defect then stopped the final-disabled deployment before Vercel was called,
  so the controller correctly returned `MANDATORY_SHUTDOWN_FAILED`. No alternate
  deployment-source procedure was used and no deployment was reconstructed.
- Independent postflight proved actual runtime shutdown: all six staging gates
  exact `false`, live absent, `STRIPE_MODE=test`, one staging-only Sensitive
  JWT record, school Boolean exact false, payout engine `v1`, and Production
  untouched with zero variables. The staging alias still targets retained
  disabled A3 deployment `dpl_FSgamEDDPXYRUqNhA6HCbpQuNxBg`; no exact-source
  A5 final-disabled deployment exists, which remains the explicit shutdown
  evidence blocker.
- Neon postflight matched preflight: intents `2`, attempts `2`, link events
  `0`, scopes `1` with Simon `0`, observations `1` with Simon `0`, agreements
  `1`, lesson payment contracts `4`, payout runs `0`, refund intents/attempts/
  events `0`, booking earnings `0`, payout transfers/attempts `0`, and cutover
  configs/shadow cycles/readiness/events `0`. Launch config remains inactive
  `shadow`, not activated and not paused. Simon's retained intent, stable
  identity, ambiguous attempt and unmapped state are unchanged.
- Exact controller invocations: **one**. Exact A5 deployments, JWT rotations,
  authenticated reconciliation POSTs, redirects, retries, Accounts v2 list
  calls, Accounts v2 account creates, direct provider creates, replacement
  accounts and onboarding calls: **zero**. No Stripe, account-link, dashboard,
  agreement, webhook-processing, payment, refund, earning, payout, transfer,
  cutover or Production action occurred.
- Final status is
  `MVP_A5_STAGING_RECONCILIATION_NOT_DISPATCHED_EXTERNAL_SOURCE_PROOF_COMPARISON_STOP_DISABLED_NO_DEPLOYMENT`.
  The authorised attempt is consumed and stopped without retry. Simon remains
  unresolved and onboarding remains prohibited. Any later attempt requires
  fresh owner authority after review of the external adapter's order-sensitive
  equality check; the repository controller and protected specifications were
  not changed by the operational stop.

## 11 August 2026 - MVP A6 stopped on absent deployment `meta.gitDirty`; disabled without reconciliation

- Fraser authorised exactly one controlled, no-retry Simon staging
  reconciliation attempt from freshly merged `main` commit
  `bd016d914e080cbcb1e4b6c1930ab6612d005f21`. The attempt used fresh named
  branch `codex/simon-staging-reconciliation-mvp-a6` and worktree
  `C:\tmp\coachcarter-simon-mvp-a6-bd016d9`. Before operation and after
  postflight, source proof was `insideWorkTree=true`, `detached=false`, exact
  symbolic ref `refs/heads/codex/simon-staging-reconciliation-mvp-a6`, exact
  named branch, `HEAD` and branch tip both the authorised commit, `clean=true`,
  and empty tracked/untracked porcelain status.
- The external A6 adapter remained outside the repository. Its source-proof
  correction explicitly sealed the eight fields `insideWorkTree`, `detached`,
  `branch`, `symbolicRef`, `headCommitSha`, `branchCommitSha`, `clean`, and
  `statusPorcelain`; compared exact typed values structurally; and rejected
  missing or additional fields. Local-only verification accepted equivalent
  objects with different insertion order, rejected one mutation to each of the
  eight fields, rejected each of eight missing-field cases and one additional
  field, and matched the live A6 source contract. Those checks performed zero
  deployments, environment mutations, database writes, authentication
  requests, POSTs, or Stripe calls.
- Pre-operation local evidence passed all `55/55` selected tests: controller
  `15/15`, Accounts v2 `22/22`, Accounts v2 UI `2/2`, and payout v2 schema
  `16/16`. The no-argument controller returned version `2`, offline dry-run,
  completed true, POST count `0`, and shutdown complete false. Protected
  LF-normalised hashes matched product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
- Fresh read-only Vercel preflight proved project
  `cc-simon-s4-staging-02` / `prj_drQlkxVnFwSGW86fdpEpHxdYYeY2`, team
  `team_DXEEAusHmjcfcr6auPjqloL0`, custom Preview environment `staging` /
  `env_vvxYWVPTHOiutcFOPmeWw2kX08mA`, and exact staging-only alias
  `cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app`.
  All six staging gates were exact `false`, live was absent,
  `STRIPE_MODE=test`, exactly one staging-only Sensitive `JWT_SECRET` record
  existed, and Production had zero environment records.
- Fresh read-only Neon preflight proved project `shiny-bonus-66942766`, retained
  branch `br-dark-recipe-zarmjbix`, and database `neondb`. The branch was
  explicitly ready, non-primary, non-default, and unprotected. School `1`'s
  feature was exact JSON Boolean false and payout engine `v1`; instructor `3`
  was active with null legacy mapping. Original intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` remained unmapped `reconciling`, test
  recipient/Express identity `cc:connect-v2:1:3:test:recipient`, with exactly
  one attempt `1` at `provider_ambiguous` / `network`, zero Simon scope,
  observation or replacement intent, and no conflicting financial or cutover
  activity.
- Controller v2 was invoked exactly once with approval
  `SIMON_STAGING_RECONCILIATION_APPROVED`. The corrected structural comparison
  passed and the disabled-preflight deployment
  `dpl_EAWbQDKkK9Yxd9PnzkbpR2PcbXSg` reached `READY`. Read-only v13 metadata
  proved the exact project, non-production target, exact named branch and
  commit, custom `staging` environment, deployment domain, and single expected
  alias. Vercel omitted the own `meta.gitDirty` property. Because missing
  evidence is not exact `null`, controller v2 stopped before either enable
  gate, the school-true mutation, JWT rotation, authentication material,
  reconciliation POST or Stripe request. No alternate deployment-source
  procedure or retry was used.
- The controller entered mandatory shutdown. It applied account-creation false,
  then global false, then one guarded school-1 Boolean-false update on the
  retained Neon branch. Disabled state reads passed. Final-disabled deployment
  `dpl_4EQQn2vmaXbxkcqM1iXwiW9bHqw8` reached `READY` and again proved exact
  project, named branch, commit, custom environment, domain, single alias and
  non-production target, but Vercel again omitted `meta.gitDirty`. The
  controller therefore correctly returned `MANDATORY_SHUTDOWN_FAILED`; the
  final deployment is disabled and exact-source but cannot satisfy the required
  explicit `meta.gitDirty === null` shutdown proof.
- Independent postflight proved all six gates exact `false`, live absent,
  `STRIPE_MODE=test`, one staging-only Sensitive JWT record, school Boolean
  exact false, payout engine `v1`, Production zero-variable and untouched, and
  zero runtime logs/requests on both A6 deployments. The exact staging alias is
  attached to the final-disabled deployment. The named worktree remained exact
  and clean.
- Neon postflight matched preflight: intents `2`, attempts `2`, link events
  `0`, scopes `1` with Simon `0`, observations `1` with Simon `0`, agreements
  `1`, lesson payment contracts `4`, payout runs `0`, refund intents/attempts/
  events `0`, booking earnings `0`, payout transfers/attempts `0`, and cutover
  configs/shadow cycles/readiness/events plus launch events `0`. Launch config
  remains inactive `shadow`, not activated and not paused. Simon's retained
  intent, stable identity, single ambiguous attempt and unmapped state are
  unchanged.
- Exact controller invocations: **one**. Exact A6 deployments: **two**, both
  disabled. Exact JWT rotations, authentication requests, authenticated
  reconciliation POSTs, redirects, retries, Accounts v2 list calls, Accounts
  v2 account creates, direct provider creates, replacement accounts and
  onboarding calls: **zero**. No Stripe, account-link, dashboard, agreement,
  webhook-processing, payment, refund, earning, payout, transfer, cutover or
  Production action occurred.
- Final status is
  `MVP_A6_STAGING_RECONCILIATION_NOT_DISPATCHED_DEPLOYMENT_GIT_DIRTY_EVIDENCE_ABSENT_DISABLED`.
  The authorised attempt is consumed and stopped without retry. Simon remains
  unresolved and onboarding remains prohibited. Any later operational attempt
  requires fresh owner authority; the protected specifications were not
  changed.

## 12 August 2026 - MVP A7 deployment-source attestation prepared; not operated

- Preparation began only after fetching `origin` and creating fresh named
  branch `codex/simon-staging-reconciliation-mvp-a7` and worktree
  `C:\tmp\coachcarter-simon-mvp-a7-591a699` from current `origin/main` at
  `591a6996497c939435977b7f244a7c834fe73de3`. That commit is PR #379's merge
  commit and was explicitly proved an ancestor of the A7 `HEAD`. The stale
  primary checkout and local `main` were not used as the source baseline.
- The protected LF-normalised hashes matched before implementation: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  Neither protected document was modified.
- Current official Vercel CLI documentation confirms that repeated
  `vercel deploy --meta KEY=value` arguments attach deployment metadata. The
  primary Vercel CLI source independently parses caller metadata, computes
  best-effort Git metadata, and submits them as separate `meta` and
  `gitMetadata` create options. Its Git helper reports a local Boolean `dirty`,
  but the service's returned `meta.gitDirty` representation is not documented
  as a required own property. A6's two omissions are therefore handled as a
  real contract boundary, not weakened into an inferred clean state.
- Controller version 3 preserves the pre-deployment eight-field proof: actual
  worktree, non-detached `HEAD`, exact expected named branch and symbolic ref,
  exact expected `HEAD` and branch-tip commits, explicit clean Boolean and
  empty tracked/untracked porcelain. Only after that proof passes does the
  controller create a 256-bit random nonce and a sealed `ccSource*` metadata
  namespace containing version, phase, all source facts, the SHA-256 of empty
  porcelain status, nonce and canonical proof SHA-256.
- The controller supplies the external adapter both the sealed attestation and
  an exact repeated `--meta KEY=value` argument array. Read-only deployment
  validation retains exact native `gitCommitSha` and named `gitCommitRef` plus
  the existing project, non-production target, custom `staging` environment,
  single staging alias and deployment-domain checks. Every expected
  `ccSource*` property must be present and exact; any missing, altered or
  unknown namespaced property stops. An absent native `meta.gitDirty` is
  permitted only when the custom attestation passes. Any present non-null
  native `gitDirty` remains a hard contradiction.
- Focused offline controller tests pass `17/17`; the controller plus unchanged
  Accounts v2, Accounts v2 UI and payout-v2 schema selection passes `57/57`
  (`17` controller, `22` Accounts v2, `2` Connect UI and `16` payout-v2
  schema tests).
  Syntax passes `206/206` files and C1 passes `278/278`. The no-argument
  controller reports version `3`, offline dry-run, completed true, POST count
  `0` and shutdown complete false. The controller tests prove exact typed local
  source fields, rejection of each missing field and any additional field,
  deterministic canonicalization of reordered property insertion, dirty and
  detached rejection, branch and commit mismatch rejection, absent native
  `gitDirty` acceptance, non-null native dirty contradiction, missing,
  partial, wrong-digest, malformed and extra namespaced attestation evidence,
  nonce-bound deployment freshness, exact Vercel meta arguments, Production
  and alias rejection, zero-POST stops and ordered mandatory shutdown. Default
  controller execution remains offline/dry-run with no operational request
  budget.
- This task performed no controller operational invocation, Vercel deployment
  or mutation, gate or school change, JWT rotation, authentication request,
  reconciliation POST, database write, Stripe request, account creation,
  mapping, replacement, onboarding, payment, refund, earning, payout,
  transfer, cutover or Production action. A6 was not rerun. Simon remains the
  original unmapped `reconciling` intent with exactly one retained ambiguous
  attempt and no Simon scope, observation, provider mapping or replacement.
- Exact A7 external-effect counts are: operational controller invocations `0`,
  Vercel deployments `0`, Vercel/environment/gate mutations `0`, JWT rotations
  `0`, Neon/database writes `0`, school-feature mutations `0`, authentication
  requests `0`, reconciliation POSTs `0`, Stripe API requests `0`, Accounts v2
  list calls `0`, Accounts v2 creates `0`, replacement accounts `0`, onboarding
  calls `0`, payments/refunds/earnings/payouts/transfers/cutovers `0`, and
  Production actions `0`.
- Status is `MVP_A7_DEPLOYMENT_SOURCE_ATTESTATION_PREPARED_NOT_OPERATED`.
  Another operational attempt requires fresh, explicit owner authority and a
  separately reviewed external adapter that passes the controller-supplied
  metadata arguments unchanged.

## 12 August 2026 - MVP A8 stopped before operation on source ancestry and adapter compatibility

- A8 began by fetching `origin --prune`. Exact PR #380 merge commit is
  `27e94651369594a02791adbb178b9309c09d2f3b`; this was also the frozen starting
  `origin/main`. Fresh named branch
  `codex/simon-staging-reconciliation-mvp-a8` was created in isolated worktree
  `C:\tmp\coachcarter-simon-mvp-a8-27e9465`. Before any possible operation it
  was non-detached on exact symbolic ref
  `refs/heads/codex/simon-staging-reconciliation-mvp-a8`, with `HEAD` and
  branch tip both equal to the frozen commit and empty tracked/untracked
  porcelain.
- PR #380's merge commit is an ancestor of the frozen source. Exact A7 commit
  `a5287d7296f84c150d0b469f666daa59996f5c56` is not an ancestor: PR #380 was
  squash-merged with sole parent `591a6996497c939435977b7f244a7c834fe73de3`.
  The A7 and merge-commit trees are identical, but the owner-required ancestry
  proof explicitly failed and was not weakened into content equivalence.
- The only reviewed operational adapter was
  `C:\tmp\cc-simon-mvp-a6-adapter.js`, SHA-256
  `899B004186B0AADA52C2CBDBBFE62D908D7D48369D52D3A888C2BCA4004CD86E`,
  with source-proof dependency `C:\tmp\cc-simon-mvp-a6-source-proof.js`,
  SHA-256
  `45B5BECF6C12399B2766D3FFBA358B428360C121DB229EAA77314D0780260DBA`.
  Its callable surface is exactly `expectedDeployment` plus the controller's
  ten required methods: gate, school, intent and source reads; deploy and
  read-only deployment resolution; the two reviewed controls and guarded
  school mutation; the single authenticated CSRF reconciliation method; and
  postflight. It exposes no direct Stripe, Accounts v2 account-create or
  provider-create method. The reconciliation method is fixed to the existing
  application route, one POST, zero redirects and zero retries; its structured
  parsers reject malformed output and it clears in-memory JWT/session/CSRF
  values without logging or persisting them.
- The adapter cannot be used for A8: its worktree, commit, branch, bridge and
  expected-deployment facts are sealed to A6, and its `deploy` method accepts
  only `{ environment, phase, source }`. It neither accepts nor forwards
  controller v3's `sourceAttestation` and exact immutable
  `sourceAttestationMetaArgs`. Changing or substituting it would require a
  separate reviewed repository-only correction, so no adapter was changed and
  the A8 operational process was not started.
- Current official Vercel CLI documentation still specifies repeated
  `vercel deploy --meta KEY=value` metadata and `--target=staging` for a custom
  environment. Current primary CLI source parses repeated metadata into the
  custom `meta` object and computes `gitMetadata` separately; its Git helper
  reports local dirty state but does not establish an own returned
  `meta.gitDirty` property. Controller v3's attestation design remains valid;
  the blocker is the absent compatible external adapter and failed required
  commit ancestry, not a new controller defect.
- Pre-stop offline validation passed `57/57`: controller `17/17`, Accounts v2
  `22/22`, Connect UI `2/2`, and payout-v2 schema `16/16`. The no-argument
  controller returned version `3`, `offline-dry-run`, completed true, POST
  count `0`, shutdown complete false. Syntax passed `206/206`; C1 passed
  `278/278`. Before documentation, `git diff --check` passed and both protected
  LF-normalised hashes matched: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  After this audit documentation, the same `57/57`, controller dry-run,
  `206/206` syntax and `278/278` C1 checks passed again; `git diff --check`
  passed and both protected hashes remained exact.
- A8 authority was not consumed because no operational controller process
  started. Operational controller invocations, A8 deployments, authentication
  requests, reconciliation POSTs, redirects, retries, Stripe list requests and
  pages, Accounts v2 creates, direct creates, replacements, onboarding calls,
  database writes, gate changes, school changes and Production actions are all
  exactly `0`. All payment, refund, earning, payout, transfer, cutover, Slice 3,
  Slice 5 and A9 effects are also `0`.
- Because A8 stopped before the controller's external preflight, it did not
  independently re-read staging or Simon. A8 caused zero state delta. The last
  trusted A6/A7 handover therefore remains: all six staging gates false, live
  absent, Stripe test mode, school `1` exact Boolean false, payout engine v1,
  and Simon's original intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` unmapped `reconciling` under stable
  identity `cc:connect-v2:1:3:test:recipient`, with one retained ambiguous
  attempt and zero Simon mapping, scope, observation or replacement.
- Status is
  `MVP_A8_NOT_OPERATED_SOURCE_ANCESTRY_AND_ADAPTER_COMPATIBILITY_STOP`.
  A8 authority remains unconsumed, but it must not be treated as authority to
  operate from changed instructions or a new adapter. No A9 action occurred.

## 12 August 2026 - MVP A8.1 controller-v3 external adapter preparation

- A8.1 is repository-only preparation. It began after `git fetch origin
  --prune` from exact `origin/main`
  `d2f5330fd9bdd1afafb93e9b1ac3daa11a9dbc1e`, PR #381's merge commit. Fresh
  branch `codex/simon-staging-reconciliation-mvp-a8-1-adapter-preparation`
  was created in isolated worktree
  `C:\Users\Fraser\AppData\Local\Temp\coachcarter-a8-1-adapter-preparation`.
  The starting worktree was non-detached, exact at the frozen commit and clean.
- PR #381 commit `d2f5330fd9bdd1afafb93e9b1ac3daa11a9dbc1e` and PR #380 commit
  `27e94651369594a02791adbb178b9309c09d2f3b` were both proved ancestors of the
  frozen source. A7 commit `a5287d7296f84c150d0b469f666daa59996f5c56`
  was not required to be an ancestor of PR #380's squash merge. Their exact
  Git tree ID is the same:
  `78597d0b02c4ff9053a0676b383ce5999190c6c6`.
- The A6 external adapter and source-proof dependency were read completely and
  reproduced their reviewed SHA-256 values:
  `899B004186B0AADA52C2CBDBBFE62D908D7D48369D52D3A888C2BCA4004CD86E`
  and
  `45B5BECF6C12399B2766D3FFBA358B428360C121DB229EAA77314D0780260DBA`.
  They were not changed or operated.
- Repository support is a narrow generator plus byte-exact conformance
  validator in `scripts/stripe-connect-simon-staging-adapter-tool.js`. A
  future separately authorised session must provide a fresh exact worktree,
  named branch and final merged commit in a non-secret JSON configuration. The
  tool refuses a generated operational path inside the repository and requires
  the gitignored suffix `.generated-operator-adapter.js`. The final adapter is
  self-contained, credential-free, generated outside the repository and
  validated byte-for-byte before loading; it is not bound to this preparation
  branch's pre-merge commit.
- The generated adapter is frozen and exposes exactly
  `expectedDeployment` plus the controller's sealed ten-method surface:
  `readGateState`, `readSchoolFeature`, `readRetainedIntent`,
  `readDeploymentSource`, `deploy`, `resolveDeploymentUrl`,
  `setStagingGate`, `setSchoolFeature`,
  `postAuthenticatedCsrfReconciliation`, and `readPostflight`. It has no
  direct Stripe, Accounts v2 account-create or provider-create method. The only
  reconciliation request is the authenticated, CSRF-bound application route
  `/api/connect?action=v2-account`, with one-attempt budget, manual redirects,
  zero followed redirects and zero retries.
- Controller v3 remains unchanged. Before each deployment it still creates the
  fresh nonce-bound `sourceAttestation` from the exact typed eight-field source
  proof and supplies the frozen `sourceAttestationMetaArgs`. The adapter
  requires exactly those five `deploy` input fields, validates the frozen
  attestation and frozen argument array pair-by-pair in controller order,
  rejects reused nonces, immediately re-reads the exact source, and appends the
  original array as the final Vercel arguments after fixed
  `deploy --target=staging --force --yes --scope <exact-scope>`. It cannot add,
  remove, reorder, reconstruct, normalise or supplement the attestation
  arguments. The controller's independent post-deploy project, custom
  environment, alias, READY, non-production, native commit/ref and custom
  attestation proofs are not weakened. Missing native `gitDirty` therefore
  remains acceptable only after the complete custom proof passes, while any
  present non-null value remains rejected.
- Current official Vercel documentation confirms repeated
  [`--meta KEY=value`](https://vercel.com/docs/cli/deploy#meta) deployment
  metadata and custom [`--target=staging`](https://vercel.com/docs/cli/target).
  Current primary CLI source defines `meta` as a repeated string option in the
  [`deploy` command](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/deploy/command.ts),
  parses each `KEY=value` item in order with the
  [`parse-meta` helper](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/parse-meta.ts),
  and passes the resulting custom `meta` separately from `gitMetadata` in the
  [`deploy` implementation](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/deploy/index.ts).
  Because the CLI parser would otherwise allow a later duplicate key to win,
  the adapter's exact unique ordered-array validation is load-bearing.
- Offline conformance tests inject every Git, Vercel CLI/API, bridge and HTTP
  process result; no real external call is available to the tests. Coverage
  rejects missing, extra, reordered, altered, reconstructed or mutable
  attestation input; wrong project, environment, alias, branch or commit;
  Production targets; polluted/multi-value/reconstructed URLs and deployment
  IDs; provider-create surfaces; second POSTs; redirects/retries; and secret
  printing/persistence. It also proves exact metadata-array tail equality,
  structural command/API parsing and authentication clearing in `finally`.
- Selected offline validation passes `63/63`: controller `17/17`, new adapter
  generator/conformance `6/6`, existing Accounts v2 `22/22`, Connect UI `2/2`
  and payout-v2 schema `16/16`. The no-argument controller reports version
  `3`, offline dry-run, completed true, POST count `0` and shutdown complete
  false. Syntax passes `206/206`, C1 passes `278/278`, direct syntax checks for
  the new script/test pass, and `git diff --check` passes.
- A8 authority was not consumed and cannot authorise the later adapter or
  changed instructions. No fresh external preflight or postflight occurred.
  Exact A8.1 external-effect counts are: operational controller invocations
  `0`; Vercel deployments `0`; Vercel configuration/environment/gate reads or
  mutations `0`; Neon contacts or database reads/writes `0`; authentication
  requests `0`; JWT rotations `0`; reconciliation POSTs `0`; redirects `0`;
  retries `0`; Stripe API requests/list pages/account creates/direct creates
  `0`; account mapping/replacement/onboarding `0`; school changes `0`;
  payments/refunds/earnings/payouts/transfers/cutovers `0`; Production actions
  `0`; and A9 actions `0`. The last trusted A6/A7 disabled staging and Simon
  retained-intent evidence is not reasserted as fresh evidence.
- Both protected LF-normalised hashes remained exact: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  Neither protected document was modified. Status is
  `MVP_A8_1_CONTROLLER_V3_EXTERNAL_ADAPTER_PREPARED_NOT_OPERATED`.

## 12 August 2026 - MVP A8 controller-v3 launch ambiguity stopped closed

- Fresh authority covered exactly one Simon staging reconciliation through
  `/api/connect?action=v2-account`, using the exact source and generated
  adapter frozen in this session. It did not authorise onboarding or A9. The
  separately supplied approval scalar matched controller v3 and is not
  reproduced in this audit.
- After `git fetch origin --prune`, the operation froze exact `origin/main`
  `9fd4e02a7a80917068b37fd1b9c3cdd6289f0c05`, PR #382's merge commit. PR
  #382, PR #381 commit `d2f5330fd9bdd1afafb93e9b1ac3daa11a9dbc1e`, and PR #380
  commit `27e94651369594a02791adbb178b9309c09d2f3b` were all ancestors. PR
  #380 and A7 retained identical tree
  `78597d0b02c4ff9053a0676b383ce5999190c6c6`; obsolete A7 commit ancestry
  was not required.
- Fresh named branch
  `codex/simon-staging-reconciliation-mvp-a8-operational` was exact at the
  frozen commit in isolated worktree
  `C:\tmp\coachcarter-simon-mvp-a8-operational-9fd4e02`. `HEAD`, branch tip
  and symbolic ref matched, the worktree was non-detached, and tracked plus
  untracked porcelain was empty before operation.
- The repository tool generated the credential-free external adapter at
  `C:\tmp\cc-simon-mvp-a8-operational.generated-operator-adapter.js` from
  the exact 13-field outside-repository configuration. Immediate byte-exact
  validation passed with SHA-256
  `768e47c15219fb588c4b6d9561b8cfc493bcfbb7db1dc2f104a2be725c838836`.
  The object was frozen and its callable surface was exactly the reviewed ten
  methods, with no direct account/provider-create surface. Its deploy contract
  preserved controller v3's immutable ordered metadata array unchanged as the
  final command arguments after fixed staging deployment arguments.
- Pre-operation local evidence passed `63/63`: controller `17/17`, adapter
  conformance `6/6`, Accounts v2 `22/22`, Connect UI `2/2`, and payout-v2
  schema `16/16`. Syntax passed `206/206`, C1 passed `278/278`, the
  no-argument controller reported offline version `3` with POST count `0`,
  `git diff --check` passed, and both protected hashes were exact.
- The one permitted operational launch command was submitted once after a
  final byte-exact adapter validation. Its wrapper returned without a
  controller PID/start record, controller JSON report, bridge request, stdout,
  stderr, or observable child process. Both dedicated controller log files
  remained zero bytes. This is an ambiguous launch outcome: it is treated as
  the one consumed controller invocation, and no second invocation or retry
  was made.
- The absence of even bridge sequence `1` proves the controller did not reach
  the reviewed Neon preflight required before any deployment or mutation.
  Therefore no disabled-preflight, minimal-enabled or final-disabled
  deployment was created; no gate or school mutation, JWT rotation,
  authentication request, application POST, Stripe request, mapping, or
  onboarding path was reached.
- Independent read-only shutdown verification then called the adapter's
  reviewed gate read once. All six staging gates were exact `false`, live was
  absent, `STRIPE_MODE` was exact `test`, and Production reported untouched
  with mutation count `0`. A single read-only Neon statement against retained
  ready, non-primary, non-default, unprotected branch
  `br-dark-recipe-zarmjbix` in project `shiny-bonus-66942766`, database
  `neondb`, proved school `1`'s guarded feature remained exact JSON Boolean
  false. Simon intent `3c2349a0-1696-4b57-b732-fc14bbde57df` remained test
  `reconciling`, unmapped, under stable identity
  `cc:connect-v2:1:3:test:recipient`, with one retained ambiguous attempt and
  zero scope, replacement intent, reconciled-existing attempt, observation,
  or onboarding link event.
- Exact operational-effect counts are: controller launch submissions `1`,
  controller completions/reports `0`; deployments by disabled-preflight,
  minimal-enabled and final-disabled phase `0/0/0`; JWT rotations `0`;
  authentication requests `0`; reconciliation POSTs `0`; redirects `0`;
  retries `0`; Stripe API requests and Accounts v2 list pages `0`; Accounts v2
  creates `0`; direct provider creates `0`; mappings `0`; replacements `0`;
  onboarding calls `0`; database writes `0`; gate changes `0`; school changes
  `0`; payments, refunds, earnings, payouts, transfers and cutovers `0` each;
  Production actions `0`; and A9 actions `0`. Post-stop verification added
  exactly one read-only Vercel gate-state operation and one read-only Neon SQL
  statement, with no mutation.
- The authority is consumed and must not be reused. Status is
  `MVP_A8_CONTROLLER_LAUNCH_AMBIGUOUS_STOPPED_CLOSED_DISABLED_VERIFIED`. No
  onboarding or A9 occurred.

## 12 August 2026 - MVP A8 retry-01 one-match validation 409 stopped closed

- Fresh authority covered exactly one controller-v3 Simon staging
  reconciliation through `/api/connect?action=v2-account` from frozen source
  `7fe8c3ff93dcce20cf65c255f3a90f32192196c0`. It explicitly excluded retry,
  account creation or replacement, onboarding, financial activity, Production
  changes and A9. The separately supplied controller approval scalar was used
  once and is not reproduced here.
- PR #383 merge `e8ee468944a370e1fb709b2f9312ad2cea592892`, PR #382 merge
  `9fd4e02a7a80917068b37fd1b9c3cdd6289f0c05`, PR #381 commit
  `d2f5330fd9bdd1afafb93e9b1ac3daa11a9dbc1e`, and PR #380 commit
  `27e94651369594a02791adbb178b9309c09d2f3b` were all proven ancestors of the
  frozen source. PR #380's tree remained exact
  `78597d0b02c4ff9053a0676b383ce5999190c6c6`.
- The operation used clean named branch
  `codex/simon-staging-reconciliation-mvp-a8-retry-01-operational` in isolated
  non-detached worktree
  `C:\tmp\coachcarter-simon-mvp-a8-retry-01-7fe8c3f`. `HEAD` and branch tip
  matched the frozen commit. The new external adapter was generated at
  `C:\tmp\cc-simon-mvp-a8-retry-01.generated-operator-adapter.js` with exact
  SHA-256
  `8D7BA1655976C1C43CD27A9B96357CE0AC8EC0144BCC77B76758776CCB1DEF60`.
  Byte-exact validation proved the frozen ten-method surface, no provider-create
  method, exact staging target and source, immutable metadata tail, one-POST
  budget, zero redirects/retries, and credential clearing in `finally`.
- Pre-operation validation passed selected tests `63/63`: controller `17`,
  adapter `6`, Accounts v2 `22`, Connect UI `2`, and payout-v2 schema `16`.
  Syntax passed `206/206`, C1 passed `278/278`, direct syntax and
  `git diff --check` passed, and the no-argument controller dry-run reported
  version `3`, completion true and POST count `0`.
- The authorised controller process was launched directly once as PID `23156`.
  It remained observable, made one reconciliation POST, completed mandatory
  shutdown, and exited once with code `1` and controller code
  `RECONCILIATION_APPLICATION_MISMATCH`. There was no second invocation,
  redirect or retry.
- The controller created exactly three READY, non-production custom-staging
  deployments, each bound to the frozen source and operational branch:
  disabled-preflight `dpl_HkGFi6FpRcTZSGCHga6XpWQEFpwX`, minimal-enabled
  `dpl_8DFtD4JuMafXDizJkJXffDQ6eboM`, and final-disabled
  `dpl_8awNPHnpmR1AfK8o1FEUi5cThu9e`. The final deployment retained the single
  exact staging alias and passed independent project, owner, custom-environment,
  READY, non-production, native commit/ref and namespaced source-attestation
  validation.
- Reviewed bridge sequence was exact: read-only preflight; guarded school
  Boolean `false` to `true`; and mandatory guarded shutdown `true` to `false`.
  No reconciliation-postflight bridge request occurred because the application
  POST failed first. Bridge responses contained only the reviewed sanitised
  fields, and no bridge artifacts remained after exit. The adapter rotated the
  isolated staging JWT exactly once and cleared authentication material.
- Vercel recorded exactly one Preview request to the minimal-enabled deployment:
  `POST /api/connect`, request ID `j8ktn-1786574094630-8f17c693ba2e`, HTTP
  `409`. The application log did not preserve the response body, so the exact
  provider-validation 409 subtype is intentionally not inferred.
- Append-only Neon evidence proves the retained Simon intent
  `3c2349a0-1696-4b57-b732-fc14bbde57df` remains `reconciling`, unmapped, with
  stable identity `cc:connect-v2:1:3:test:recipient`, `connect_scope_id` null,
  provider account null and retained `last_error_class=network`. Attempt `2`
  occurred at `2026-08-12T22:34:59.528641Z` with outcome
  `reconciled_existing`, provider account `acct_1U2mHvIGQey1BnGx`, null error
  class and evidence `{ "match_count": 1 }`. Its preceding audit row records
  the single application request at `2026-08-12T22:34:55.729872Z`. Provider
  validation returned 409 before scope registration or intent completion.
- Independent post-exit evidence proved all six staging gates exact false,
  live absent, `STRIPE_MODE=test`, school feature exact JSON Boolean false,
  legacy school and instructor Stripe mappings null, and Production untouched
  with mutation count `0`. Retained Neon branch
  `br-dark-recipe-zarmjbix` remained non-default and unprotected.
- Exact resulting counts for Simon are: creation attempts `2` total, with one
  new `reconciled_existing` evidence row; provider account-create successes
  `0`; new or replacement intents `0`; connected-account scopes/mappings `0`;
  account-state observations `0`; and onboarding link events `0`. The route's
  reconciling branch listed before any creation path, and the sealed adapter had
  no direct provider-create surface.
- Forbidden-effect counts remained exact zero: lesson-payment-contract delta,
  payout runs, refund intents/attempts/events, booking earnings, launch booking
  earnings, launch transfer intents/attempts, payout transfers/attempts,
  payout-v2 cutover config/shadow/readiness/events, Stripe Connect launch
  events, onboarding actions, Production mutations and A9 actions. No payment,
  refund, earning, payout, transfer or cutover occurred.
- Post-operation audit validation again passed selected tests `63/63`, syntax
  `206/206`, C1 `278/278`, direct syntax, no-argument controller dry-run with
  POST count `0`, and `git diff --check`. Protected LF-normalised hashes remained
  exact: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
  Neither protected document was modified.
- The consumed one-shot authority cannot be reused. Status is
  `MVP_A8_RETRY_01_ONE_MATCH_PROVIDER_VALIDATION_HTTP_409_STOPPED_CLOSED_DISABLED`.
  No onboarding or A9 occurred.

## 13 August 2026 - owner rebaselined Simon launch to hardened interim v1

- Owner authority explicitly superseded the 11 August sequencing decision that
  Simon had to wait for Accounts v2/source-backed payout v2 rather than use the
  legacy engine. The reason is that creating and initially paying instructor
  number two had become incorrectly coupled to replacement of the complete
  payout architecture.
- CoachCarter remains school-wide on payout engine v1 for the interim period.
  The next implementation is the focused **Simon interim v1 hardening**:
  ambiguity-safe account identity, complete tenant/audit scope, deliberate
  `payouts_start_date`, `payouts_paused=true`, exact approved CoachCarter
  Stripe-funded eligibility in addition to `chargeable`, an itemised Fraser
  preview, configuration-driven `weekly_franchise_fee_pence`, human handling
  of insufficient weeks and a distinct first-run approval boundary.
- The three-state lifecycle and 48-hour/calendar payout rule remain
  authoritative. No routine instructor-outcome or dual-confirmation workflow
  is an interim prerequisite; the existing pre-payout `mark-not-delivered`
  exception remains available.
- Account onboarding, the first reviewed payout and any later unattended Simon
  payouts are separate future authority boundaries. The current v1 routes are
  not represented as safe before the hardening is reviewed and merged.
- Accounts v2/payout v2, further Slice 4 reconciliation, two v2 shadow Fridays,
  v2 cutover, four v2 live approvals and A8/A9/controller work are deferred.
  The complete A8 retry-01 record and retained test-mode Simon shell, stable
  identity, intent, attempts, one-match evidence and HTTP-409 stop remain
  preserved. They were not deleted, replaced, completed, mapped to Production
  or reinterpreted as a v1 identity.
- Work started from frozen `origin/main`
  `4a6ba4fafbebe167b113e61e80b0c0a711da3ccf`, the merge commit for PR #387,
  which was verified merged and an ancestor of the frozen baseline. The prior
  protected LF-normalised hashes matched exactly before editing: product
  `D91D5E2A01458840A2C569BC3041573BF093F1D726573B6F86C83E21A16B783B`
  and technical
  `C6FC70B23F35513199D7C2B94CAC750AB07D7658C9D13B4E56537BB3BA981C58`.
- The owner-authorised protected rebaseline produced product
  `5D2E956C94A88D496265DCBDDBC85BC2E5F92FFCE262463C978081805302BED3`
  and technical
  `C1C76E9DB3450D22C83B0CE3D9D47D835244CF9F51A73B120B3E3E7344851A2A`
  after LF normalisation.
- This was documentation-only. Stripe, Neon and Vercel requests were `0`;
  database/deployment/environment/gate/account/mapping/onboarding/invite,
  payment/refund/payout/transfer/cutover, Production, controller, A8 and A9
  actions were all `0`. No Stripe, Neon or Vercel credentials were requested or
  used.

## 13 August 2026 - Simon interim v1 hardening implemented locally

- Starting safety froze fetched `origin/main` at
  `f29e67d945a559fd00c7ff08e1f34c96514e01f1`. That commit is the merged PR
  #388 commit and was verified as an ancestor of the frozen remote tip. Work
  was isolated on `codex/simon-interim-v1-hardening` in a separate worktree.
- Before editing, the protected LF-normalised hashes matched exactly: product
  `5D2E956C94A88D496265DCBDDBC85BC2E5F92FFCE262463C978081805302BED3`
  and technical
  `C1C76E9DB3450D22C83B0CE3D9D47D835244CF9F51A73B120B3E3E7344851A2A`.
  Verification tests confirm both remain unchanged.
- Additive, inert migration 043 introduces durable v1 account intents and
  attempts, immutable controlled-instructor and exact funding-evidence rows,
  first-run approvals, and durable transfer intents/attempts. It seeds no
  instructor, account, date, fee, approval or transfer.
- The hardened Connect path persists the school/instructor/live/Express
  identity and start/pause safeguards before account creation, uses one stable
  provider idempotency key, and reconciles ambiguous results by exact metadata
  without replacement creation. Account creation and invitation are separate
  superadmin commands with separate exact confirmations.
- Controlled instructors are isolated from generic cron/admin bulk payouts and
  cannot be generically unpaused. Their direct-slot webhook evidence and payout
  preview require exact live CoachCarter Stripe identities, gross, fee,
  payment time and funds availability, plus a one-payment/one-lesson ledger
  match after the deliberate start. Unsupported sources are reason-coded
  manual/£0.
- The owner preview, first-run approval and movement are distinct. Approval is
  bound to the recomputed canonical fingerprint and exact amount. The transfer
  intent and payout claims exist before the provider call; ambiguous/failed
  outcomes retain claims, reconciliation uses the same identity, success keeps
  the instructor paused, and a completed first run cannot authorize another
  under this milestone. The weekly fee is loaded from
  `weekly_franchise_fee_pence`; no Simon ID or £90 constant was added.
- The admin UI exposes preparation, separate invitation, exact preview,
  approval and first transfer controls only to the platform owner. The generic
  bulk button is explicitly labelled legacy and cannot select a controlled
  instructor.
- Local verification completed without external systems: focused hardening
  tests `13/13`; related payout/Accounts-v2 non-browser regressions `50/50`;
  related headless UI regressions `2/2`; direct syntax checks passed. No
  controller, A8 or A9 command ran.
- Stripe, Neon and Vercel requests were `0`; credentials requested/used `0`;
  database reads/writes `0`; migrations/deployments/environment/gate/feature
  changes `0`; real account list/create/map/reconcile `0`; invitations/emails
  `0`; previews from Production data `0`; unpauses/payouts/transfers `0`; and
  Production mutations `0`.

## 17 August 2026 - payment fulfilment incident and controlled-source evidence

- A production webhook permission defect prevented the existing balance audit
  trigger from writing its append-only row under the restricted runtime role.
  Four already-paid Checkout sessions had durable `slot_purchase` rows but no
  corresponding booking. Stripe showed the four sessions paid and complete;
  no fifth in-scope payment, refund or dispute was found.
- After fresh tenant, identity and all-source slot-conflict checks, the four
  payments were reconciled into exactly four scheduled bookings and four
  `booking_credit_sources` rows. Each scoped learner/instructor balance
  finished at its pre-repair value. No charge, refund, payout, transfer or
  customer communication was created.
- The one Simon-controlled direct booking received one interim-v1 funding
  evidence row. Its provider identity remains `py_` and its balance transaction
  type remains `payment`, so the evidence is deliberately `pending` and
  payout-blocking. It was not reinterpreted as exact `ch_`/`charge` evidence.
- The audit trigger is now owner-controlled with `SECURITY DEFINER`, a fixed
  `pg_catalog, public` search path, schema-qualified ledger writes and no public
  execute privilege. The runtime role received no direct audit table or
  sequence grants. Permanent webhook recovery is restricted to one-off paid
  slots, exact ledger reconciliation and conflict-free creation.
- Simon remains paused. This incident did not authorize onboarding, unpausing,
  payout approval, payout execution, transfer, A8/A9 or payout-v2 cutover.

## 4 September 2026 - exact manual-settlement handoff boundary prepared

- The owner confirmed Simon was paid manually only up to Friday 4 September
  2026 at 12:00 Europe/London. The first system payout week must therefore use
  the half-open interval `[2026-09-04 12:00, 2026-09-11 12:00)`, classifying a
  lesson by its Europe/London end instant. Exact equality at the opening noon
  is included; exact equality at the following Friday noon is excluded.
- The immutable original interim-v1 payout start date is retained. Additive,
  inert migration 057 creates a separate one-row-per-instructor append-only
  manual-settlement boundary with owner, reason and evidence reference. It
  seeds no data and makes no Stripe request.
- The dedicated superadmin mutation requires its own exact confirmation,
  Friday dates exactly seven local calendar days apart, the existing interim-v1
  control, and `payouts_paused=true`. It refuses a different replay, any prior
  interim-v1 approval, or an overlapping existing payout claim. Its transaction
  records only the boundary and required audit row.
- Preview classification includes the exact booking end instant and boundary
  in the canonical fingerprint. Rows before the opening instant are marked
  `MANUALLY_SETTLED_BEFORE_CUTOFF`; rows at or after the closing instant are
  marked `AFTER_FIRST_SYSTEM_PERIOD`. A missing boundary blocks approval.
- This implementation work did not send an onboarding invitation, generate a
  Production payout preview, approve or create a payout, create a transfer, or
  unpause Simon. Recording the Production boundary remains a separate explicit
  owner operation after deployment and requires the manual-payment evidence
  reference.
- The schema was rehearsed against a temporary branch of the protected
  Production parent. Catalogue verification found the table, both explicit
  indexes, all foreign-key/uniqueness/check constraints and the append-only
  trigger; seeded boundary rows were exactly `0`. Europe/London noon resolved
  to `2026-09-04T11:00:00.000Z` and `2026-09-11T11:00:00.000Z`.
- After explicit owner approval, the tested schema was applied to protected
  Production `main` and the temporary rehearsal branch was deleted. PR #433
  merged as `81eb4327922e20aeb96bebc9d5f3b7dd4cc3b890`; Vercel reported the
  resulting Production deployment complete.
- Post-apply read-only verification retained Simon's stable identity
  `cc:connect-v1:1:6:live:express`, provider account
  `acct_1U3pyqIjVkzjlvAE`, succeeded mapping, original start date
  `2026-08-14`, completed onboarding and `payouts_paused=true`. Boundary,
  approval, payout and transfer-intent counts were all exactly `0`. The
  boundary row remains pending the owner's manual bank-payment evidence
  reference; no value will be invented.
