# CoachCarter Code Review Remediation Plan

**Created:** 13 July 2026  
**Review scope:** Whole repository on clean `main` at commit `22da13c`  
**Purpose:** Self-contained handoff for a future Codex session to implement the code-review findings safely.

## How to use this document

Work from the top down. Do not combine every item into one pull request. Each security or reliability concern should be implemented and verified as a tightly scoped change.

Before starting any item:

1. Read `AGENTS.md` and the relevant sections of `CLAUDE.md`.
2. Start from the latest remote `main`.
3. Create a fresh `codex/` branch for the selected item.
4. Preserve tenant scoping with `school_id` and add focused regression tests.
5. Do not change payment, credit, refund, payout, or booking-status behaviour unless the selected item explicitly requires it.
6. Do not restore product features merely because an old source-shape test expects them.

## Priority legend

- **P0 — Emergency:** Active compromise, data loss, or money movement defect. None identified in this review.
- **P1 — High:** Security boundary, abuse/cost exposure, or vulnerable production dependency. Fix before launch or further expansion.
- **P2 — Medium:** Privacy, integrity, or reliability weakness that should follow immediately after P1 work.
- **P3 — Maintenance:** Test and engineering hygiene that reduces future regression risk.

## Recommended implementation order

- [x] P1.1 Make the shared rate limiter atomic and window-safe
- [ ] P1.2 Enforce learner role and tenant scope in AI personalization
- [ ] P1.3 Add abuse and input controls to public AI endpoints
- [ ] P1.4 Upgrade vulnerable production dependencies
- [ ] P2.1 Stop public pricing endpoints trusting `learner_id`
- [ ] P2.2 Prevent forged or cross-tenant consent records
- [ ] P2.3 Await booking and broadcast notification delivery
- [ ] P2.4 Restore authenticated personalization in Ask Examiner
- [ ] P3.1 Reconcile the stale/failing test contracts

---

## P1.1 — Make the shared rate limiter atomic and window-safe

### Problem

`api/_rate-limit.js:37` deletes every `rate_limits` row older than the window used by the current caller. Because callers use different windows, a one-minute endpoint can erase still-valid one-hour login limits. For example:

- Admin login uses one-hour email and IP limits in `api/admin.js`.
- Referral validation uses a one-minute limit in `api/learner.js`.
- Calling referral validation after an admin-login row is more than one minute old can delete the login row before its one-hour window expires.

The counter update is also a non-atomic `SELECT` followed by `UPDATE` or `INSERT`. `rate_limits.key` has only a normal index in `db/migration.sql:1341`, so concurrent first requests can create duplicate rows for the same key. Later reads select only one arbitrary row, fragmenting the count.

### Affected files

- `api/_rate-limit.js`
- `db/migration.sql`
- `api/admin.js` and other callers for regression coverage only
- New focused test file, suggested: `tests/rate-limit-atomicity.spec.js`

### Implementation approach

1. Add an idempotent migration that removes duplicate keys before adding uniqueness.
   - Rate-limit rows are ephemeral. Keep the newest row per key or consolidate deterministically.
   - Add `CREATE UNIQUE INDEX IF NOT EXISTS ... ON rate_limits(key)` after deduplication.
   - Do not attempt to add the unique index before handling existing duplicates.
2. Replace the read-then-write sequence with one atomic `INSERT ... ON CONFLICT (key) DO UPDATE ... RETURNING` statement.
3. In the upsert:
   - If the stored window has expired for this request, reset `request_count` to `1` and `window_start` to `NOW()`.
   - Otherwise increment `request_count` atomically.
   - Decide `allowed` from the returned count.
4. Remove caller-window-based global cleanup.
   - Either omit cleanup from the hot path and add a separate retention cleanup, or delete only rows older than a fixed conservative retention period such as several days.
   - Never use the current endpoint's window to clean unrelated keys.
5. Keep the current fail-open/fail-closed policy as an explicit decision. For login and other security-sensitive endpoints, consider whether a fail-closed option should be supported without changing unrelated call sites in the same PR.

### Acceptance criteria

- A 60-second limiter cannot delete or reset a valid 3,600-second limiter.
- Concurrent calls for the same new key produce one row and one monotonically increasing count.
- The request at the configured maximum is allowed; the next request is rejected.
- After the window expires, the next request starts a fresh window at count `1`.
- Existing callers retain their current response contracts.
- The migration is idempotent and succeeds when duplicate keys already exist.

### Tests

- Unit/integration test two keys with different window lengths and verify one cannot remove the other.
- Run several concurrent calls for one key and verify there is one DB row and the returned/final count reflects all calls.
- Test boundary counts and expiry reset.
- Run existing admin login, learner login, referral, enquiry, address lookup, and feedback tests.

---

## P1.2 — Enforce learner role and tenant scope in AI personalization

### Problem

`api/_shared.js:14` calls `requireAuth(req)` without a role restriction. Both `api/advisor.js` and `api/ask-examiner.js` are learner-facing, but any valid learner, instructor, or admin cookie can currently be accepted.

`buildLearnerContext(userId)` then queries learner tables using only that numeric ID. It does not filter by `school_id`. Instructor/admin IDs come from different tables and can numerically collide with learner IDs, causing an unrelated learner's name, test details, concerns, competency ratings, quiz performance, and driving history to be inserted into the model prompt.

### Affected files

- `api/_shared.js`
- `api/advisor.js`
- `api/ask-examiner.js`
- New focused test file, suggested: `tests/ai-learner-context-scope.spec.js`

### Implementation approach

1. Replace the roleless helper with learner-only optional authentication.
   - A valid learner token should return the learner payload.
   - Instructor/admin tokens must be treated as no learner context, never as a learner ID.
   - Guests must remain supported because both AI surfaces intentionally allow public use.
2. Change the context function signature to require both identity values, for example:
   - `buildLearnerContext({ learnerId, schoolId })`
3. Add `school_id = ${schoolId}` to every tenant-scoped query in the context builder:
   - `learner_onboarding`
   - `skill_ratings`
   - `quiz_results`
   - `mock_tests`
   - `driving_sessions`
   - `learner_users`
4. Verify the learner exists in that school before building any context.
5. Avoid a generic optional-auth implementation that silently accepts the first valid cookie of any role.
6. Keep AI context read-only. Do not change booking, credit, or pricing behaviour in this task.

### Acceptance criteria

- A learner receives context only from their own `learner_id` and `school_id`.
- An instructor or admin session never loads learner context through an ID collision.
- A learner from school A cannot load data from school B.
- A guest can still use both AI endpoints with no personalized context.
- Every learner-context SQL query includes tenant scope.

### Tests

- Learner token with matching school returns personalized context.
- Instructor token whose ID matches an existing learner returns no learner context.
- Admin token whose ID matches an existing learner returns no learner context.
- Learner token with a different school cannot retrieve the other school's rows.
- Guest request succeeds without querying learner-specific data.

---

## P1.3 — Add abuse and input controls to public AI endpoints

### Problem

`api/advisor.js` and `api/ask-examiner.js` accept unauthenticated POST requests that directly call Anthropic. There is no rate limit, request-body size limit, per-message limit, or upstream timeout. `messages.slice(-20)` limits message count sent upstream but does not limit the length or shape of each message.

This creates a direct cost-exhaustion and availability risk.

### Dependency

Complete P1.1 first so these endpoints do not rely on the defective rate limiter.

### Affected files

- `api/advisor.js`
- `api/ask-examiner.js`
- Potential shared validation helper, if it remains small and focused
- New focused test file, suggested: `tests/ai-abuse-controls.spec.js`

### Implementation approach

1. Add per-IP rate limits before calling Anthropic.
   - Use separate keys for Advisor and Ask Examiner.
   - Consider a second authenticated learner key so one IP cannot evade limits by cycling accounts.
   - Keep limits in named constants or environment-backed security configuration.
2. Validate the `messages` array:
   - Maximum number of messages.
   - Allowed roles only, normally `user` and `assistant`.
   - `content` must be a string.
   - Maximum characters per message.
   - Maximum total characters across the submitted conversation.
3. Reject malformed or oversized input with `400` or `413` before any upstream request.
4. Add an `AbortController` timeout to the Anthropic fetch and return a controlled `502`/`504` response on timeout.
5. Return `429` with a generic retry message when rate-limited.
6. Do not expose Anthropic response bodies, API errors, or credentials to the client.
7. Add logging that records endpoint, status, duration, and approximate input size without logging conversation content or learner PII.

### Acceptance criteria

- Repeated guest requests are throttled before they incur further Anthropic calls.
- Oversized or malformed conversations never reach Anthropic.
- A stalled upstream request is aborted within the configured timeout.
- Valid guest and authenticated learner conversations continue to work.
- Logs do not contain prompts, messages, learner context, or API keys.

### Tests

- Under-limit request reaches the mocked upstream once.
- Over-limit request returns `429` and does not call the upstream.
- Oversized single message and oversized total conversation are rejected.
- Invalid role/non-string content is rejected.
- Timeout produces the intended controlled response.

---

## P1.4 — Upgrade vulnerable production dependencies

### Problem

`npm audit --omit=dev` reported three production dependency vulnerabilities:

| Package | Installed | Severity | Dependency path |
|---|---:|---:|---|
| `nodemailer` | `8.0.7` | High | Direct dependency |
| `form-data` | `4.0.5` | High | Twilio → Axios → form-data |
| `qs` | `6.15.0` | Moderate | Stripe and Twilio |

Affected lockfile locations include `package-lock.json:594`, `package-lock.json:1087`, and `package-lock.json:1330`.

### Affected files

- `package.json`
- `package-lock.json`
- Email, Stripe, and Twilio tests for verification only

### Implementation approach

1. Check the current fixed versions and release notes before editing.
2. Upgrade `nodemailer` to a version outside the audited vulnerable range.
   - Treat a major-version upgrade as potentially breaking.
   - Verify SMTP transporter creation, password-reset emails, booking emails, payout emails, and error alerts.
3. Update Twilio/Axios or the lockfile so `form-data` resolves to a fixed version.
4. Update Stripe/Twilio or use a narrowly scoped `overrides` entry so `qs` resolves to a fixed version, only after confirming compatibility.
5. Prefer direct dependency upgrades over broad permanent overrides.
6. Run `npm audit --omit=dev` again and record the clean or accepted result in the PR.
7. Do not commit `.env` files or expose credentials during email/SMS verification.

### Acceptance criteria

- The three reported advisories are removed from `npm audit --omit=dev`.
- Syntax checks pass.
- Existing mocked Stripe, email, WhatsApp/Twilio, webhook, and payout tests pass.
- No production API contract changes unintentionally.

### Tests and commands

```powershell
npm.cmd run check:syntax
npm.cmd audit --omit=dev
npm.cmd test
```

If the full suite remains red because of the known stale contracts in P3.1, run and report all directly relevant dependency/integration tests separately.

---

## P2.1 — Stop public pricing endpoints trusting `learner_id`

### Problem

Public pricing paths accept `learner_id` from query parameters:

- `api/lesson-types.js:72`
- `api/slots.js:2006` in `handleDurationsForSlot()`

They pass that ID into `calcDirectLessonPrice()`, which can read `instructor_learner_notes.custom_hourly_rate_pence`. Anyone who can enumerate learner and instructor IDs can therefore query negotiated learner-specific prices.

This also contradicts the warning in `api/_pricing-helpers.js` that the effective learner rate helper is for authenticated callers only.

The public lesson-type list additionally honours `include_inactive=true`, despite the endpoint being documented as returning active public types.

### Affected files

- `api/lesson-types.js`
- `api/slots.js`
- `api/_pricing-helpers.js` only if a public-rate helper is introduced
- `public/learner/book.js`
- `public/admin/portal.js`
- `public/instructor/index.js`
- Existing direct-pricing tests and new authorization tests

### Implementation approach

1. Never trust query-string `learner_id` for personalized pricing.
2. For a valid learner session in the resolved tenant, derive learner ID from the JWT.
3. For guests or non-learner sessions, calculate only public/instructor-default pricing with no learner-specific override.
4. Keep checkout authoritative:
   - Authenticated checkout must continue recalculating from `user.id` server-side.
   - Guest checkout must continue resolving/creating the learner server-side before calculating the final charge.
   - Never accept a client-submitted price.
5. Remove `learner_id` from the corresponding frontend URLs.
6. Make `include_inactive` unavailable to public callers.
   - Admin callers should use the authenticated `action=all` endpoint or another explicitly authenticated route.
   - Decide whether instructors genuinely need inactive types; if so, provide a role-scoped read rather than weakening the public endpoint.
7. Preserve host/slug tenant resolution for public requests.

### Acceptance criteria

- Changing `?learner_id=` cannot change a public response price.
- An authenticated learner sees their own custom rate where appropriate.
- A learner cannot request another learner's custom rate.
- Guests see only public/instructor-default rates.
- Public callers cannot retrieve inactive lesson types.
- Checkout still prices independently and server-side.

### Tests

- Public request with arbitrary `learner_id` does not expose a custom rate.
- Authenticated learner gets their custom rate.
- Cross-school learner/instructor combinations fall back or reject safely.
- `include_inactive=true` is ignored or rejected for guests and accepted only on the intended authenticated route.
- Existing direct booking effective-pricing and Stripe metadata tests pass.

---

## P2.2 — Prevent forged or cross-tenant consent records

### Problem

`api/config.js?action=record-consent` accepts public `learner_id` and `school_id` values from the request body. `public/cookie-consent.js` sources the learner ID from the display-only `cc_learner` localStorage blob, which project rules explicitly classify as untrusted.

An unauthenticated caller can therefore create consent records associated with another learner or tenant. This undermines the integrity of the consent audit trail. The endpoint is also a public database-writing route without a dedicated rate limit or strong input bounds.

### Dependency

Complete P1.1 before adding the rate limit.

### Affected files

- `api/config.js`
- `public/cookie-consent.js`
- `api/_tenant.js` for reuse only, not redesign
- `tests/cookie-consent.spec.js`
- New server-side consent integrity tests

### Implementation approach

1. Resolve `school_id` from the request host/slug using `resolveSchoolFromRequest()`; do not accept body `school_id` as authority.
2. Ignore body `learner_id`.
3. Optionally associate the consent with a learner only when a valid learner session exists and its `school_id` matches the resolved tenant.
4. Keep anonymous visitor consent supported with `learner_id = NULL`.
5. Validate:
   - `visitor_id` type, format, and maximum length.
   - `analytics` as an explicit boolean.
   - User-agent length, preserving the current cap.
6. Rate-limit consent submissions per IP and/or visitor ID to prevent database spam.
7. Update the frontend so it no longer sends learner or school identity from localStorage.
8. Do not make analytics load before consent; preserve the existing PostHog consent gate.

### Acceptance criteria

- A caller cannot choose the stored `school_id` or `learner_id`.
- Anonymous consent records remain possible.
- Authenticated learner association is same-school and server-derived.
- Invalid and oversized visitor identifiers are rejected.
- Repeated spam submissions are throttled.
- PostHog still loads only after analytics consent.

### Tests

- Forged body `learner_id` and `school_id` are ignored.
- Authenticated learner is associated correctly within the resolved tenant.
- Cross-tenant association is impossible.
- Anonymous consent stores `learner_id = NULL`.
- Invalid input and rate-limit paths return controlled errors.
- Existing browser consent behavior remains intact.

---

## P2.3 — Await booking and broadcast notification delivery

### Problem

Several serverless handlers start notification promises and return before they settle. Examples include:

- `api/slots.js:6154` — free-trial WhatsApp confirmations
- `api/webhook.js:1169` — paid slot booking confirmations
- `api/instructor.js:4786` — manual broadcast WhatsApp
- `api/_notify-availability.js:137`, `:250`, and `:348` — availability/broadcast messages

Vercel can freeze a function after the response, so fire-and-forget delivery is unreliable. Some paths also omit rejection handling, risking unhandled promise rejections.

### Affected files

- `api/slots.js`
- `api/webhook.js`
- `api/instructor.js`
- `api/_notify-availability.js`
- Related notification tests

### Implementation approach

1. Collect WhatsApp and email promises in a local task array.
2. `await Promise.allSettled(tasks)` before the handler returns or the webhook event is marked complete.
3. Log rejected deliveries with purpose, school, and non-sensitive recipient identifiers.
4. Do not fail or roll back an already successful booking solely because a confirmation message failed.
5. In Stripe webhook paths, avoid throwing after the financial/booking operation solely for a notification failure; otherwise Stripe retries could cause unnecessary duplicate work.
6. Preserve existing notification-ledger/idempotency metadata in `_whatsapp.js`.
7. For potentially large broadcasts, enforce the existing audience cap or move delivery to a durable queue in a separate design. Do not create unbounded parallel work in a serverless request.
8. Await any function such as `supersedeBroadcastSiblings()` when its notifications must complete before response; document deliberate exceptions.

### Acceptance criteria

- The handler does not return until all scheduled notification attempts have settled.
- One failed delivery does not undo a confirmed booking or cause a Stripe retry.
- Failures are logged and do not become unhandled rejections.
- Learner and instructor confirmations are still sent through the same channels and templates.
- Broadcast APIs return an accurate attempted/succeeded/failed summary where appropriate.

### Tests

- Delay mocked WhatsApp/email promises and assert the handler waits.
- Reject one notification and verify booking success remains successful.
- Verify failure logging/summary behavior.
- Verify webhook completion is not rejected solely because a message failed.
- Verify no duplicate notifications are introduced on retry/idempotent paths.

---

## P2.4 — Restore authenticated personalization in Ask Examiner

### Problem

`public/learner/ask-examiner.js:78` uses plain `fetch()` for a POST. It does not attach the `X-CSRF-Token` header required by `requireAuth()`.

When a signed-in learner uses Ask Examiner, the API's optional authentication fails CSRF validation and returns `null`. Because guest access is allowed, the request still succeeds but silently loses personalized learner context.

### Dependency

Implement alongside or immediately after P1.2 so the optional learner authentication is role-safe and tenant-scoped.

### Affected files

- `public/learner/ask-examiner.js`
- `api/ask-examiner.js` if response metadata is added for testing
- `public/shared/learner-auth.js` for reuse only
- New/updated Ask Examiner tests

### Implementation approach

1. Use `ccAuth.fetchAuthed()` for the POST, matching Advisor.
2. Confirm that guests remain supported:
   - With no session and no CSRF cookie, the endpoint should operate anonymously.
   - With a valid learner session, the CSRF header should allow learner-only optional authentication.
3. Do not infer authentication from localStorage.
4. Consider returning a non-sensitive `personalized: true|false` flag to make the behavior testable and to support accurate UI copy.
5. Only show “personalized” UI messaging when the server actually confirms personalized context was used.

### Acceptance criteria

- Signed-in learner requests pass CSRF verification and use their scoped context.
- Guest requests still work without context.
- Instructor/admin sessions do not become learner sessions.
- The UI does not falsely claim personalization.

### Tests

- Signed-in learner request includes `X-CSRF-Token`.
- Guest request succeeds without a learner session.
- Missing/mismatched CSRF on a real learner session does not silently use learner data.
- The server personalization flag, if added, matches actual behavior.

---

## P3.1 — Reconcile the stale/failing test contracts

### Problem

The repository passes syntax and C1 checks, but the focused rerun of test files implicated by the broad suite produced:

- **49 passed**
- **17 failed**
- **2 skipped**

Many failures are source-string assertions expecting old markup, function boundaries, labels, or retired product surfaces. A permanently red or noisy suite makes genuine booking, tenancy, credit, and payment regressions harder to detect.

### Reproducing test files

- `tests/booking-overflow-ui.spec.js`
- `tests/half-hour-slot-starts.spec.js`
- `tests/learner-booking-availability-filter.spec.js`
- `tests/learner-booking-locations.spec.js`
- `tests/learner-categories.spec.js`
- `tests/learner-practice-log-flow.spec.js`
- `tests/learner-progress-driving-plan.spec.js`
- `tests/marketing-pricing-copy.spec.js`
- `tests/offer-recurring-series.spec.js`
- `tests/recurring-block-contract.spec.js`
- `tests/social-video-booking-discount.spec.js`
- `tests/test-swaps-marketplace.spec.js`

The initially reported admin platform-balance failures passed when rerun independently and should not be treated as confirmed production defects without further reproduction.

### Affected files

- The test files above
- Product code only when a test exposes a verified current-contract regression
- `CLAUDE.md`, `docs/navigation.md`, and relevant feature plans as the source of intended behavior

### Implementation approach

1. Triage each failure into one of three categories:
   - Real regression against current documented behavior.
   - Stale test for an intentionally changed/removed feature.
   - Brittle source-shape assertion that should be replaced with behavior testing.
2. Check `CLAUDE.md` and `docs/navigation.md` before changing navigation, booking UI, calendars, waitlist, Q&A, confirmation prompts, or other removed surfaces.
3. Do not alter correct production behavior merely to satisfy an exact source substring.
4. Prefer tests that execute exported helpers, handler behavior, or rendered DOM over tests that search function source text.
5. Keep high-value contract assertions for money, tenant, auth, and booking status rules.
6. Separate broad test-maintenance changes from security fixes unless a test is directly required to prove that fix.

### Acceptance criteria

- Every previously failing test is either updated to the current documented contract or exposes and verifies a production fix.
- No intentionally removed feature is restored.
- `npm.cmd test` is green, apart from explicitly documented environment-gated integration tests.
- Security and money-path tests remain strict and behavior-focused.

### Verification commands

```powershell
npm.cmd run check:syntax
npm.cmd run check:c1
npm.cmd test
```

---

## Suggested pull-request breakdown

To keep reviews safe and reversible:

1. **PR 1 — Rate limiter correctness**  
   P1.1 only: migration, atomic helper, and focused tests.
2. **PR 2 — AI endpoint hardening**  
   P1.2, P1.3, and P2.4, because they share the optional learner-auth and AI request path.
3. **PR 3 — Dependency security updates**  
   P1.4 only, with audit output and targeted integration tests.
4. **PR 4 — Public identity/privacy boundaries**  
   P2.1 and P2.2, provided the diff remains reviewable; split them if implementation grows.
5. **PR 5 — Notification delivery reliability**  
   P2.3 only, with explicit booking/webhook non-rollback tests.
6. **PR 6 — Test contract reconciliation**  
   P3.1, preferably divided by product area if the diff becomes large.

## Definition of done for every implementation PR

- [ ] Fresh branch from latest `main`
- [ ] Scope matches one remediation item or tightly related group
- [ ] Tenant-scoped queries include authenticated/resolved `school_id`
- [ ] No client-submitted price, learner identity, or school identity is trusted where server context exists
- [ ] Focused regression tests added
- [ ] `npm.cmd run check:syntax` passes
- [ ] `npm.cmd run check:c1` passes
- [ ] Relevant Playwright tests pass
- [ ] Full-suite result recorded
- [ ] No `.env`, credentials, local agent files, test artifacts, or unrelated formatting committed
- [ ] Documentation updated if the public/API contract changed

## Starting prompt for the next Codex session

> Read `AGENTS.md`, `CLAUDE.md`, and `CODE-REVIEW-REMEDIATION-PLAN.md`. Start with the first unchecked item only. Verify the issue against current `main`, create a fresh `codex/` branch, implement the scoped fix with focused tests, run the relevant verification commands, and report any assumptions or contract changes. Do not combine unrelated remediation items or restore intentionally removed product features.
