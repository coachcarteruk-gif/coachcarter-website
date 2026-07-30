# Curriculum Launch Readiness Audit

**Project:** CoachCarter Curriculum MVP
**Date:** 2026-07-30
**Audit mode:** Full Curriculum diff review, mocked browser behaviour, and isolated Neon integration verification
**Overall score:** **95% (±2%) — Production candidate with release controls**

## Verdict

**The Curriculum MVP is technically ready to become a reviewed production release candidate. It is not a go for an immediate unreviewed production deployment.**

The previously blocking related-topic navigation defect is fixed and regression-tested. Migration 038 has been applied twice successfully to the configured isolated test database, and the real API/auth/schema path passed focused tenant, ownership, redirect, constraint, and audit checks.

Production release still requires a reviewed commit, CI disposition for three unrelated pre-existing suite failures, the normal production backup/migration procedure, and a post-deploy authenticated smoke test. No production migration or deployment was performed during this audit.

## Fixes completed

1. **Related-topic routing fixed.** Connection cards now use `topic_id`, while ordinary topic and subtopic cards continue to use `id`. A browser regression fixture with connection `id: 3` and destination `topic_id: 2` asserts the exact href `/instructor/curriculum-topic?id=2`; the subtopic `id: 4` path is asserted separately.
2. **Instructor-admin authority hardened.** Curriculum now reads the current `instructors.is_admin` value and requires both that database flag and the JWT claim before granting admin structure controls. A stale elevated JWT no longer preserves Curriculum admin authority after database revocation.
3. **Topic-link integrity enforced.** Non-`connect_topic` responses can no longer submit a hidden `linked_topic_id`. The rule is enforced in the API, client payload, and an idempotent named database constraint.
4. **Merge safety improved.** Merging a topic into one of its descendants is rejected with `MERGE_CYCLE`, preventing a hierarchy that points back through a merged topic. Child reassignment and the merge redirect write now execute in one Neon transaction.
5. **Accessibility corrected.** Dialog focus is contained while sheets are open and restored to the opener on close. Remaining interactive reply/link controls were raised from 36–40px to a 44px minimum target, with browser measurements.
6. **Database integration coverage added.** A gated test suite applies migration 038 idempotently and exercises the real handler with signed session cookies, CSRF, and isolated database rows.

## Test evidence

| Check | Result |
|---|---|
| `npm.cmd test -- tests/curriculum-mvp.spec.js` | **PASS — 8/8** |
| Guarded isolated-DB Curriculum integration suite | **PASS — 3/3** |
| `npm.cmd run check:syntax` | **PASS — 191 files** |
| `npm.cmd run check:c1` | **PASS — no C1 controls in 263 files** |
| `npm.cmd test` final run | **PARTIAL — 848 passed, 266 skipped, 3 failed** |
| `git diff --check` | **PASS** |

The first full-suite run also exposed the known concurrency-sensitive learner-login recovery test; it passed with one worker, and the complete suite rerun passed that test. It is not connected to the Curriculum diff.

## Real test-database verification

Migration 038 was applied twice inside transactions to the configured `POSTGRES_URL_TEST`; the guard first confirmed it differed from the `.env.local` `POSTGRES_URL`. This verified:

- all four Curriculum tables and the new named link-contract constraint;
- idempotent migration execution;
- starter-topic creation for a new school;
- active instructor and active admin access;
- inactive-instructor rejection;
- current database revalidation of instructor-admin permission;
- same-school reads and cross-school topic rejection;
- contribution creation, owner edit, and non-owner edit rejection;
- invalid self-links, invalid cross-school connections, and valid same-school connections;
- invalid linked topics on non-connection replies;
- merge-cycle rejection, atomic child reassignment, and merged-topic redirect data;
- archived-topic history reads;
- suggestion review and school-scoped audit rows.

The test created temporary schools and actors. Its temporary school-onboarding marker was inserted and removed inside the same transaction, and all fixture schools, actors, Curriculum rows, and audit rows were cleaned up afterward.

This did **not** test a deployed Vercel route, browser login against the live API, production data volume, or production migration execution.

## Remaining warnings and release steps

### Repository suite is not fully green

The final full run has three failures in unchanged, out-of-scope artifacts:

1. `tests/marketing-pricing-copy.spec.js` is LF-sensitive while `public/lessons.js` is CRLF.
2. `tests/payout-v2-schema-rollout-review.spec.js` reports the protected migration 035 byte fingerprint differs from its rollout manifest.
3. The same payout review therefore returns `BLOCKED` instead of `SCHEMA_APPLIED_INACTIVE`.

No Curriculum test failed. The protected payout artifact, money logic, and marketing code were not changed. Release ownership must either repair these on an appropriately scoped branch or formally waive them with evidence.

### Release process remains manual

Before production:

1. Review and commit the currently modified/untracked Curriculum changes.
2. Run CI and disposition the three unrelated full-suite failures.
3. Take the normal pre-migration backup/snapshot.
4. Apply migration 038 using the approved production migration process; do not use the test command.
5. Smoke-test active instructor, inactive instructor, admin, and cross-school denial through the deployed route with real browser sessions.
6. Verify related-topic and merge redirects on the deployed host.
7. Monitor Curriculum API errors and query latency after release.

### Bounded growth remains post-MVP work

Bootstrap currently returns every active topic, and a topic request returns every contribution for that topic. This is acceptable for the initial MVP, but pagination or documented school-level thresholds should be added before large content volumes accumulate.

## Passing controls

- Every Curriculum table, foreign-key relationship, read, and mutation is scoped by authenticated `school_id`.
- Active account checks are backed by current database state.
- Admin structure actions and suggestion reviews are permission-gated, awaited, and audit-logged.
- Contribution editing is owner-only.
- Curriculum history has no hard-delete API.
- Composite foreign keys prevent cross-school graph and thread relationships.
- User-authored content is rendered as text, not injected HTML.
- Client errors remain generic; SQL errors and stacks are not returned.
- Archive history stays readable, while merged topics return a deterministic destination.
- Pages have cookie consent, consent-gated analytics, labels, reduced-motion handling, focus containment, and measured touch targets.
- Phone/desktop layouts and light/dark themes pass browser checks without horizontal overflow.

## Methodology and limitations

This audit reviewed the complete Curriculum diff, schema, API, navigation, browser pages, auth bridge, accessibility behaviour, and focused tests. It used representative browser mocks plus direct invocation of the production API handler against an isolated Neon database and the real auth/CSRF helpers.

It is not a penetration test, load test, legal review, deployed-environment test, or production migration rehearsal. Payments, credits, refunds, bookings, Stripe, and payout implementation were intentionally left unchanged.
