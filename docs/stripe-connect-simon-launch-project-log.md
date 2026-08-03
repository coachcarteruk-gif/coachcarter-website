# Stripe Connect Simon Launch Project Log

**Purpose:** Durable handover and journey log for the Simon Stripe Connect,
payment-contract, refund, and instructor-payout launch.

**Current status:** **SLICE 2 NOT ACCEPTED — SHADOW-04 FAILED — STEP 10 PAUSED
FOR DEPLOYMENT-HOST BOOTSTRAP REPAIR REVIEW/MERGE**

**Last updated:** 3 August 2026

**Verified source baseline:** remote `main` at
`0c496b0baafc71afbda444afeefafd4eead59a29`

**Current blocker:** the narrow deployment-host bootstrap repair is implemented
on `codex/simon-deployment-host-bootstrap` and its focused identity suite passes,
but the change is not yet reviewed or merged. The deployed application now uses
provider runtime `VERCEL_URL` only when no custom deployment host is configured;
the independent operator verifier still requires the exact post-deployment host
and matches it to both application evidence and the Vercel deployment API. A
present but wrong custom host still fails closed. Do not configure or deploy
shadow-05 until the repair is reviewed, merged, and Step 10 is separately
resumed. Do not seed, apply the aggregate, create a Checkout Session, or perform
any other Stripe operation meanwhile.

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
| Latest baseline | Verified | Remote/local `main` resolve to PR #342 merge `0c496b0…` on 3 August 2026. The documentation-only handover branch `codex/simon-shadow05-resource-handover` was created from that exact clean commit. |
| Slice 0: Stripe client boundary | Merged | PR #333, merge `5a59db1…`; Stripe `22.4.0`, API `2026-07-29.dahlia`, central client boundary. |
| Slice 1: inert schema | Applied, inactive | PRs #334–#335; migration 039 applied schema-only; production school remained on payout engine v1. |
| Slice 2: payment contracts | Merged but not accepted | PRs #336–#337 prepared and repaired shadow-gated payment evidence/contracts. Static status remains `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. |
| Fresh-schema bootstrap | Repair merged | PR #340 mirrors migration 013 and extends the rollback-only aggregate test for the Boolean/default contract plus real admin support access, tenancy, audit, password, and login-code boundaries. All three fresh-schema tests and all eight rollback/payment-contract tests passed against a disposable, confirmed non-production loopback database with the three gates enabled. |
| Deployment/database identity | Bootstrap repair pending review; provider pass pending | PR #342 merged the protected GET diagnostic and read-only operator verifier as `0c496b0…`. The focused follow-up on `codex/simon-deployment-host-bootstrap` removes the same-deployment host circularity while retaining independent operator/provider comparison. Local syntax and focused regressions pass; no shadow-05 provider/database identity has yet been checked, so this remains implementation evidence, not an identity pass. |
| Shadow Checkout return URLs | Merged; shadow exercise pending | PR #342 merged fail-closed URL binding for all approved producers. Twelve focused tests and CI pass; non-shadow URL semantics remain unchanged. No Stripe Checkout or shadow-05 exercise has been performed. |
| Shadow-04 | Failed evidence; preserve | Aggregate applied once to an empty schema and a direct-slot payment was attempted. The environment has known binding/return-URL contamination and the `is_admin` defect. Never reuse it as clean acceptance evidence. |
| Money movement | Not performed | No payout, transfer, refund, Connect onboarding, live Stripe, or Slice 3 action was performed in shadow-04. |
| Next implementation | Review deployment-host bootstrap repair | Review the focused identity helper/test/log diff on `codex/simon-deployment-host-bootstrap`. Do not merge or resume Step 10 deployment without separate approval. |

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
| Required fresh rerun | `cc-simon-s2-shadow-05` | Fresh Vercel project `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT`; no deployment. Fresh Neon project `shiny-bonus-66942766` in `aws-eu-west-2`, default branch `br-empty-cell-za5kh6nr`, read-write endpoint `ep-frosty-truth-zatfdzrb`, provider-generated pooled host `ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech`, database `neondb`, Postgres 18, Neon Auth disabled. No application connection, schema, or seed configured. |
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

The deployed application does not require a pre-deployment
`STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST`: when that variable is absent it binds
the host from provider runtime `VERCEL_URL`. If the variable is present, it is
still authoritative and a mismatch fails closed. After deployment, the
independent operator verifier must set the exact provider-derived deployment
host in `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST`; it then compares that host with
the application identity/fingerprint and Vercel deployment control-plane
evidence. A project alias, operator label, or previous deployment URL is never
accepted as a substitute.

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

- **Status:** Authorised but paused on 3 August 2026. Fresh Vercel project
  `prj_mDx2UdBimT96XqQdVDhv3xVPKtxT` and fresh isolated Neon project
  `shiny-bonus-66942766` exist with no deployment. A narrow host-bootstrap
  repair is implemented and locally verified on
  `codex/simon-deployment-host-bootstrap`, but it must be reviewed and merged
  before Step 10 can be separately resumed. Do not deploy the unreviewed branch.
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

- **Status:** Not started.
- **Preconditions:** Verified shadow-05 binding and zero-table proof.
- **Evidence required:** Before count zero; one successful aggregate apply;
  retained sanitised schema counts; explicit `instructors.is_admin` proof.
- **Stop conditions:** Non-empty schema, wrong identity, second apply attempt,
  DDL error, or count/column mismatch.
- **Expected output:** Fresh Slice 2-capable schema created exactly once.
- **Relevant artifacts:** `db/migration.sql`, fresh-schema verifier.
- **Production/money risk:** Shadow database DDL only; never production.

### 12. Rerun Slice 2 setup from the beginning

- **Status:** Not started.
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

The exact next task is:

> Review the focused deployment-host bootstrap repair on
> `codex/simon-deployment-host-bootstrap`, based on PR #342 merge `0c496b0…`.
> Confirm the deployed application may bootstrap its host from runtime
> `VERCEL_URL` only when no custom host is configured, while the independent
> operator verifier still requires the exact provider-derived post-deployment
> host and matches the application, Vercel deployment API, Neon control plane,
> active connection target, and read-only direct database result. A present but
> mismatched custom host must still fail closed. Do not merge the repair or
> resume Step 10 deployment without separate approval.

Do not resume, query, repair, or reuse shadow-04. Do not access production data;
apply a schema; seed data; create a Checkout Session, payment, refund, payout,
transfer, Connect account, or webhook; begin Slice 3; or continue into steps
11–18. A preflight pass grants identity evidence only and does not authorise any
later operation. If a new Stripe resource is necessary rather than only safely
configuring existing restricted test credentials, stop and request separate
authority.

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

### 3 August 2026 — deployment-host bootstrap repair implemented

- The owner separately authorised a narrowly scoped identity-bootstrap repair,
  including code, tests, documentation, commit, push, and a PR. Merge and any
  Step 10 deployment remain explicitly unauthorised pending further approval.
- Preserved the uncommitted resource handover on
  `codex/simon-shadow05-resource-handover` and created isolated repair worktree
  `codex/simon-deployment-host-bootstrap` from latest remote `main` at PR #342
  merge `0c496b0baafc71afbda444afeefafd4eead59a29`.
- Removed the same-deployment circular dependency without weakening the
  independent check: the application identity falls back to provider runtime
  `VERCEL_URL` only when `STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST` is absent. If a
  custom host is present, it remains authoritative and mismatch still fails.
  The operator preflight continues to require the exact post-deployment host and
  compare it with the application identity/fingerprint and Vercel deployment
  control-plane URL.
- Added focused coverage for runtime bootstrap versus explicit operator binding,
  an explicitly configured wrong host, an application/provider host that
  differs from the operator identity, and runtime-derived shadow return URLs.
  Identity and return-URL suites passed 32/32; shadow-operation,
  payment-contract, and Slice 2 rollout-review regressions passed 31/31; syntax
  passed for all 198 checked files. The executable Slice 2 review kept all
  14/14 checks true with terminal status `PREPARED_NOT_APPROVED_NOT_DEPLOYED`.
- No Vercel configuration/deployment, database connection/query/mutation,
  schema apply, seed, production access/configuration, Stripe operation or
  resource, API key, Slice 3 work, or Step 11–18 action was performed.
