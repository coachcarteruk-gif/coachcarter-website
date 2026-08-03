# Stripe Connect Simon Launch Project Log

**Purpose:** Durable handover and journey log for the Simon Stripe Connect,
payment-contract, refund, and instructor-payout launch.

**Current status:** **SLICE 2 NOT ACCEPTED — SHADOW-04 FAILED — FRESH-SCHEMA
REPAIR VERIFIED, READY FOR FOCUSED PR REVIEW**

**Last updated:** 3 August 2026

**Verified source baseline:** remote `main` at
`5a462837cafa9a7c83f5594b553f341ac6e857ad`

**Current blocker:** no verification blocker remains for the focused repair on
`codex/simon-fresh-schema-is-admin-repair`. Commit, push, and PR creation remain
intentionally unperformed pending explicit review and approval. Slice 2 remains
blocked until that repair is merged and the separate identity-preflight and
fail-closed shadow return-URL work is implemented and merged.

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
| Latest baseline | Verified | Remote and local `main` both resolved to `5a462837…` on 3 August 2026; the repair branch was created from that exact clean commit. |
| Slice 0: Stripe client boundary | Merged | PR #333, merge `5a59db1…`; Stripe `22.4.0`, API `2026-07-29.dahlia`, central client boundary. |
| Slice 1: inert schema | Applied, inactive | PRs #334–#335; migration 039 applied schema-only; production school remained on payout engine v1. |
| Slice 2: payment contracts | Merged but not accepted | PRs #336–#337 prepared and repaired shadow-gated payment evidence/contracts. Static status remains `PREPARED_NOT_APPROVED_NOT_DEPLOYED`. |
| Fresh-schema bootstrap | Repair verified; ready for focused PR review | The focused branch mirrors migration 013 and extends the rollback-only aggregate test for the Boolean/default contract plus real admin support access, tenancy, audit, password, and login-code boundaries. All three fresh-schema tests and all eight rollback/payment-contract tests pass against a disposable, confirmed non-production loopback database with the three gates enabled. |
| Shadow-04 | Failed evidence; preserve | Aggregate applied once to an empty schema and a direct-slot payment was attempted. The environment has known binding/return-URL contamination and the `is_admin` defect. Never reuse it as clean acceptance evidence. |
| Money movement | Not performed | No payout, transfer, refund, Connect onboarding, live Stripe, or Slice 3 action was performed in shadow-04. |
| Next implementation | Focused repair PR review | Review the three-file repair diff and, only with explicit approval, commit, push, and open the focused repair PR. Do not create or exercise shadow-05. |

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

## 7. Completed implementation slices and relevant PRs

| PR | Merge commit | What is trustworthy from it | What it does not prove |
|---|---|---|---|
| [#333](https://github.com/coachcarteruk-gif/coachcarter-website/pull/333) | `5a59db1155bdc54934f5b4768fa3a61f24145808` | Pinned Stripe SDK/API and central, fail-closed client boundary. | Accounts v2, restricted-key rollout, or a payment-contract exercise. |
| [#334](https://github.com/coachcarteruk-gif/coachcarter-website/pull/334) | `cbb820867c038293d90a2cad4f2b7af447718cee` | Inert Slice 1 schema and integrity controls. | Production application or Slice 2 acceptance. |
| [#335](https://github.com/coachcarteruk-gif/coachcarter-website/pull/335) | `12c5a5a2c7d203656ab054183451240f88381df7` | Production migration 039 evidence and `SCHEMA_APPLIED_INACTIVE`. | Any launch config, agreement, writer, or money action. |
| [#336](https://github.com/coachcarteruk-gif/coachcarter-website/pull/336) | `307864b0a7ed43242e5f720270f62f7baf060409` | Initial Slice 2 implementation and migration 040 correction. | Deployment, shadow activation, or a complete live exercise. |
| [#337](https://github.com/coachcarteruk-gif/coachcarter-website/pull/337) | `8e71267ad3ff50c17285f32e1b5de619a2cb1b46` | Four-origin repair, retryable evidence, strict shadow/audit gates, protected-document hashes. | Fresh aggregate completeness or shadow acceptance. |
| [#338](https://github.com/coachcarteruk-gif/coachcarter-website/pull/338) | `3710c9b0f5ac9b095297950c999393ae5577ffbe` | Empty-schema `schools` ordering repair and two rollback-only bootstrap tests. | `instructors.is_admin`, a real `access-instructor-account` call, or full aggregate reapply idempotency. |

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

- Remote and local `main` resolved to
  `5a462837cafa9a7c83f5594b553f341ac6e857ad`; the exercise baseline remains
  the earlier `3710c9b0…` commit recorded in the failed shadow-04 history.
- The worktree was clean before
  `codex/simon-fresh-schema-is-admin-repair` was created from remote `main`.
- PR #338 is merged and its GitHub merge metadata matches that commit.
- PR #339 preserved this living log and the Simon-specific `AGENTS.md` rule on
  remote `main` before the repair branch was created.
- The two protected LF-normalised hashes match exactly and the documents were
  not changed by this task.
- `api/admin.js` selects `COALESCE(is_admin, FALSE) AS is_admin` in
  `handleAccessInstructorAccount()`.
- `db/migrations/013_instructor_is_admin.sql` adds
  `instructors.is_admin BOOLEAN DEFAULT FALSE`.
- The repair branch adds exactly one aggregate DDL statement equivalent to
  migration 013 and no unrelated migration cleanup.
- `tests/migration-fresh-schema.integration.spec.js` now asserts the column's
  Boolean/default contract and invokes the real admin route against the same
  freshly bootstrapped transaction. It covers same-school success, cross-school
  rejection, the required audit event, unchanged password state, an unused
  login-code row, no sensitive response fields, and captured route SQL that
  never references password or login-code storage.
- `tests/admin-instructor-access.spec.js` is a source-contract test; it does not
  run the route against a freshly bootstrapped database.
- `npm run check:syntax` reports 195 files passing; the focused launch/auth
  selection reports 43 tests passing; the Slice 2 rollout-review test reports
  one passing test.
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

**Implemented repair:** the focused branch mirrors migration 013 in
`db/migration.sql`, asserts the column contract on a genuinely empty aggregate
schema, and adds focused database-backed same-school/cross-school admin-access
coverage. The three-test fresh-schema suite and eight-test
rollback/payment-contract suite both pass with all three database gates against
a disposable confirmed non-production loopback database. The repair blocker is
closed; Slice 2 acceptance remains separately blocked.

### Unresolved observations, not yet diagnosed

- The attempted `direct_slot` payment created a scheduled booking but no linked
  launch contract. A clean rerun must prove whether this was caused by the
  exercise setup, evidence timing, metadata, configuration, or another defect.
- Shadow-04's original deployment/database mismatch prevents a clean assertion
  about all non-financial side effects before rebinding.
- The missing `Origin` header demonstrated a production-return-URL fallback in
  the temporary harness. Shadow operations must fail closed or derive an
  explicitly trusted shadow base URL.
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
| Required fresh rerun | `cc-simon-s2-shadow-05` | Not created. Must use an entirely new Vercel project and Neon resource. |
| Shadow Stripe mode | `test` | Shadow-04 only; Connect permissions disabled. |
| Shadow webhook events | `checkout.session.completed`, `payment_intent.succeeded` | Shadow-04 only. |

Do not add resource URLs containing credentials or any secret values to this
inventory. Store secrets only in the relevant provider secret store.

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

- **Status:** Not started.
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

- **Status:** Not started.
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
  deployment metadata helper, identity-focused tests.
- **Production/money risk:** Read-only; do not expose the diagnostic publicly.

### 9. Make shadow return URLs fail closed

- **Status:** Not started.
- **Preconditions:** Identify every Slice 2 Checkout producer and trusted shadow
  base-URL source.
- **Evidence required:** Tests prove a shadow request cannot fall back to
  `https://coachcarter.uk` when `Origin` is missing/invalid; accepted shadow
  URLs resolve only to the bound shadow deployment.
- **Stop conditions:** Client-controlled arbitrary redirect, production fallback
  in shadow, or broad change to live payment semantics without separate review.
- **Expected output:** Correct direct-slot, test-date, offer, and request return
  URLs in shadow, including the temporary harness path.
- **Relevant artifacts:** `api/slots.js`, `api/offers.js`, Checkout producer tests.
- **Production/money risk:** Payment-flow code; potentially production-affecting
  and therefore requires focused regression/review, but no money operation is
  needed to implement it.

### 10. Create `cc-simon-s2-shadow-05`

- **Status:** Not started.
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

> Review the three-file diff on
> `codex/simon-fresh-schema-is-admin-repair`. If it is approved, explicitly
> authorise commit, push, and creation of a focused repair PR. After that PR is
> reviewed and merged, add and merge the deployment/database identity preflight
> and fail-closed shadow return-URL repair. Only then, under separate explicit
> resource-creation authority and after the identity plan is ready, create the
> entirely fresh Vercel and Neon resources for `cc-simon-s2-shadow-05`.

Do not resume shadow-04. Do not create shadow-05 in the repair session unless a
separate explicit task authorises resource creation after the repair PR merges.

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
