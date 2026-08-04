# Stripe Connect Simon Launch Project Log

**Purpose:** Durable handover and journey log for the Simon Stripe Connect,
payment-contract, refund, and instructor-payout launch.

**Current status:** **SLICE 2 NOT ACCEPTED — SHADOW-04 FAILED — SHADOW-05
STEP 11 PASSED — STEP 12 WRITER REVIEW PASSED, PUBLICATION PENDING — NOT
DEPLOYED — FIXTURE UNCHANGED**

**Last updated:** 4 August 2026

**Verified source baseline:** remote `main` at
`d911c89868eebe86a08a757b22ed6e3524cd5fe8`

**Current blocker:** Independent review of the narrow Step 12 config/agreement
writer passed after auth-scope, exact runtime-gate, replay-evidence, rollback,
and error-sanitisation hardening. Publication evidence is still pending. The
writer remains undeployed and unavailable on shadow-05. The prior Step 12
attempt stopped before mutation and all recorded fixture counts remain zero.
This review grants no deployment, environment-change, fixture, Step 12, Stripe,
later-step, or Slice 3 authority.

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
   — owner-agreed target product and accounting policy, dated 1 August 2026.
2. [`stripe-connect-simon-launch-technical-implementation-plan.md`](stripe-connect-simon-launch-technical-implementation-plan.md)
   — implementation sequence, slice gates, tests, and acceptance criteria.
3. `AGENTS.md` and `CLAUDE.md` — repository, tenancy, auth, money, and safety
   rules.
4. [`stripe-connect-simon-slice-2-rollout-review.md`](stripe-connect-simon-slice-2-rollout-review.md)
   — committed Slice 2 controls and pass gates. Its `shadow-01`/`shadow-02`
   narrative predates shadow-04 and is historical, not the current resume point.
5. [`stripe-launch-schema-foundation-rollout-review.md`](stripe-launch-schema-foundation-rollout-review.md)
   — verified Slice 1 production schema evidence.
6. [`stripe-connect.md`](stripe-connect.md) and
   [`payout-v2-source-ingestion-rollout-review.md`](payout-v2-source-ingestion-rollout-review.md)
   — current v1 and older inactive Payout v2 context. Where they conflict with
   the protected Simon documents, the protected Simon product specification
   governs the future launch.
7. Committed code, migrations, tests, rollout manifests, Git history, and
   reviewed PR evidence.
8. This log — the current journey/handover record, not a replacement for
   product authority or executable tests.

### Protected-document integrity

Both protected documents were reverified on 3 August 2026 using UTF-8 bytes
after normalising CRLF and lone CR line endings to LF. They matched the supplied
SHA-256 values exactly:

| Protected document | LF-normalised SHA-256 |
|---|---|
| Product specification | `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4` |
| Technical implementation plan | `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916` |

Do not modify either protected document during repair or shadow-exercise work.
If either hash changes, stop and obtain an explicit product-document review.

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
- No production payout, transfer, refund, Connect onboarding, live payment,
  payout-engine transition, or Slice 3 operation is authorised by this log.
- Do not start Slice 3 until Slice 2 is formally accepted with a clean,
  independently bound environment and every required scenario passing.

## 5. Current status at a glance

| Area | Status | Evidence |
|---|---|---|
| Latest baseline | Verified | Remote `main` resolves to PR #345 merge `d911c898…` on 4 August 2026. GitHub reports reviewed head `4c303c7…`, base `6635b8f…`, and all checks successful; the squash-merge tree is byte-for-byte identical to the reviewed head. This provider-evidence log update remains intentionally uncommitted. |
| Slice 0: Stripe client boundary | Merged | PR #333, merge `5a59db1…`; Stripe `22.4.0`, API `2026-07-29.dahlia`, central client boundary. |
| Slice 1: inert schema | Applied, inactive | PRs #334–#335; migration 039 applied schema-only; production school remained on payout engine v1. |
| Slice 2: payment contracts | Merged but not accepted | PRs #336–#337 prepared and repaired shadow-gated payment evidence/contracts. Static status remains `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. |
| Fresh-schema bootstrap | Repair merged | PR #340 mirrors migration 013 and extends the rollback-only aggregate test for the Boolean/default contract plus real admin support access, tenancy, audit, password, and login-code boundaries. All three fresh-schema tests and all eight rollback/payment-contract tests passed against a disposable, confirmed non-production loopback database with the three gates enabled. |
| Deployment/database identity | Step 10 passed; temporary access revoked | Vercel reports clean deployment `dpl_ELTwjwU1yvbuiTHonJjZomjivaWN`, READY on the isolated project's Production target, provider host `cc-simon-s2-shadow-05-n6pepjew7-coachcarteruk-2599s-projects.vercel.app`, exact Git SHA `d911c898…`, and no dirty marker. The one-shot identity preflight passed with fingerprint `sha256:c94c4cc0c3ceaaf24f8401dd8a23e55ba3c26343bda0b3e3ab4a688162aa3127` and database-enforced read-only evidence. Final Neon-key and Vercel-bypass inventories are zero. |
| Shadow Checkout return URLs | Merged; shadow exercise pending | PR #342 merged fail-closed URL binding for all approved producers. Twelve focused tests and CI pass; non-shadow URL semantics remain unchanged. No Stripe Checkout or shadow-05 exercise has been performed. |
| Shadow-04 | Failed evidence; preserve | Aggregate applied once to an empty schema and a direct-slot payment was attempted. The environment has known binding/return-URL contamination and the `is_admin` defect. Never reuse it as clean acceptance evidence. |
| Money movement | Not performed | No payout, transfer, refund, Connect onboarding, live Stripe, or Slice 3 action was performed in shadow-04. |
| Next implementation | Publish the reviewed Step 12 writer as a draft PR, then stop | The writer is JWT-school-scoped, authenticated with existing CSRF enforcement, exact shadow/test/Vercel-environment/project gated, atomic, required-audit fail-closed, and exact-replay idempotent. The required 69-test combined suite and Slice 2 static review pass. It remains undeployed, so Step 12 remains blocked. Do not use direct SQL, seed a partial fixture, rerun the aggregate/one-shot identity preflight, or begin Stripe/later-step activity. |

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

### Current blocker: local Step 12 writer is not reviewed or deployed

The minimum config/agreement writer now exists only as uncommitted local code
on `codex/simon-shadow05-fixture-writer`. It cannot be treated as a supported
shadow-05 route until it is intentionally staged, reviewed, committed, pushed,
and deployed under separate authority. No provider configuration or fixture
state changed during implementation.

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

### Unresolved observations, not yet diagnosed

- The attempted `direct_slot` payment created a scheduled booking but no linked
  launch contract. A clean rerun must prove whether this was caused by the
  exercise setup, evidence timing, metadata, configuration, or another defect.
- Shadow-04's original deployment/database mismatch prevents a clean assertion
  about all non-financial side effects before rebinding.
- The missing `Origin` header demonstrated a production-return-URL fallback in
  the temporary harness. The local prerequisite repair now ignores client
  origin/forwarded-host evidence for launch candidates and binds both return
  URLs to the identity-verified Vercel deployment. That repair merged in PR
  #342, but it has not been exercised in shadow-05 and shadow-04 remains failed
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
| Required fresh rerun | `cc-simon-s2-shadow-05` | Existing Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`; one READY production deployment `dpl_6oUNe2Niuuf5HmvDq8QRpxnKCjVz` from exact `a8f9f2a…`, provider host `cc-simon-s2-shadow-05-9h8txzygx-coachcarteruk-2599s-projects.vercel.app`. Existing Neon project `shiny-bonus-66942766` in `aws-eu-west-2`, default branch `br-empty-cell-za5kh6nr`, read-write endpoint `ep-frosty-truth-zatfdzrb`, provider-generated pooled host `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, database `neondb`, Postgres 18, Neon Auth disabled. Production-only shadow configuration exists inside this isolated project; no schema or seed exists. Identity preflight is blocked before provider/database checks, and the exposed shadow database credential requires rotation. |
| Shadow Stripe mode | `test` | Shadow-04 only; Connect permissions disabled. |
| Shadow webhook events | `checkout.session.completed`, `payment_intent.succeeded` | Shadow-04 only. |

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

## 13. Unfinished Slice 2 acceptance scenarios

### Four approved payment origins

| Exact origin | Shadow-04 result | Required acceptance |
|---|---|---|
| `direct_slot` | Attempted; one scheduled booking, no linked contract. **Not passed.** | One supported direct-slot payment must create exactly one booking, one correct BCS/slot-purchase attribution, one source, and one complete contract with exact amount, currency, fee, Stripe creation time, availability time, school, learner, and instructor evidence. |
| `test_date_direct` | Not reached. | One payment must map to exactly one 90-minute lesson with `booking_purpose='test_date'`, preserve test-date evidence, and pass every normal payment/fee/cutover/tenancy predicate. |
| `one_off_offer` | Not reached. | One paid, slot-pinned, single-lesson offer must produce one booking/source/contract. Flexible, repeating, or multi-booking offer shapes must produce no Slice 2 contract. |
| `captured_request` | Not reached. | A captured request must have the accepted same-school request, booking, and `slot_purchase` credit transaction before materialisation. If local state is not ready, receipt processing remains retryable; it must never guess a source or create duplicates. |

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
  `0c496b0…` with green CI. The diagnostic has not yet run against shadow-05,
  so no provider/database identity pass exists.
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
  `0c496b0…` with green CI for all four approved origins. It has not been
  exercised through Stripe or shadow-05.
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

- **Status:** Still blocked before mutation. All identity, protected hash, Step
  11 schema/column, and zero-fixture preconditions passed. A minimum writer now
  exists and passes local verification, but is uncommitted, unreviewed, and not
  deployed to shadow-05. No fixture row was created.
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

- **Status:** Not started.
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

- **Status:** Not started.
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

- **Status:** Not started.
- **Preconditions:** Steps 13–14 complete.
- **Evidence required:** Sanitised zero-row queries for all tables listed in
  section 7, plus zero Connect/onboarding/live effects and no config outside the
  exercise school.
- **Stop conditions:** Any unexplained money-mutation row or prohibited resource.
- **Expected output:** Final zero-side-effect evidence.
- **Relevant artifacts:** Read-only postflight diagnostics and provider logs.
- **Production/money risk:** Read-only verification.

### 16. Collect final evidence and update the Slice 2 review

- **Status:** Not started.
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

- **Status:** Not started.
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

- **Status:** Pending Slice 2 acceptance.
- **Preconditions:** Formal step 17 acceptance plus a separately scoped Slice 3
  task/approval.
- **Evidence required:** Accepted Slice 2 record and fresh latest-main review.
- **Stop conditions:** Slice 2 is failed, incomplete, or merely “prepared.”
- **Expected output:** No Slice 3 work until the gate is satisfied.
- **Relevant artifacts:** Protected implementation sequence.
- **Production/money risk:** Prevents premature product/payment changes.

## 15. Next session starts here

Step 12 preflight passed and fixture mutation did not start. Do not rerun the
aggregate or the one-shot identity preflight. The retained exact deployment,
Neon identity, Step 11 schema, `instructors.is_admin`, and zero-fixture evidence
remains the last accepted provider/database state.

The local branch `codex/simon-shadow05-fixture-writer` now contains the minimum
school-scoped `simon_launch_v1` shadow config and active agreement writer. Local
verification passes, but the code is deliberately uncommitted and undeployed.
The next task is independent review and a separately authorized stage/commit/
push/deploy sequence. Until deployment identity is reverified and Step 12 is
explicitly reauthorized, do not create any fixture row, change provider config,
use direct SQL, or begin Stripe activity, Step 13, a later step, or Slice 3.

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
  sensitive-payload blocker within this exact writer scope. Commit and draft-PR
  evidence remain pending final publication and will be recorded without
  changing the implementation scope.
- No deployment, Vercel or Neon configuration, shadow-05 access or mutation,
  fixture row, Stripe client/API call, Checkout, payment, webhook, refund,
  payout, transfer, Connect object, Step 12 execution, Step 13, later step, or
  Slice 3 action was authorised or performed. Step 12 and deployment remain
  explicitly unauthorised.
