# CoachCarter Website Repo Health Audit

First-pass orientation for PR #147 on branch `audit/coachcarter-website-repo-health`.

This is an audit plan only. No code fixes are included in this branch.

## High-Level Repo Summary

`coachcarter-website` is a public CoachCarter / InstructorBook web platform built as a vanilla HTML/CSS/JS frontend with Vercel serverless API routes and Neon Postgres. The product surface is much larger than a marketing site: it includes learner booking, instructor scheduling, admin/superadmin management, payments, Stripe Connect payouts, reminders, referral rewards, GDPR data tools, Setmore/iCal sync, AI-assisted learner tools, and school-level multi-tenancy.

The backend is organized as single-file Vercel functions under `api/`, usually dispatching with `?action=`. The frontend is static under `public/`, with role-specific areas for public, learner, instructor, admin, and superadmin screens. Database state is managed through one large idempotent migration at `db/migration.sql`, plus older legacy migrations and seed files.

The repository has strong inline operational documentation (`README.md`, `CLAUDE.md`, `PROJECT.md`, and focused docs in `docs/`). Some docs describe retired features or older auth language, so audit findings should verify against current code rather than treating every doc line as canonical.

## Key Systems And Entry Points

### Runtime, Deployment, And Config

- Vercel app with `vercel.json` rewrites:
  - `/api/:path*` to serverless functions in `api/`
  - `/r/:code` to referral redirect handler
  - `/book/:slug` to learner booking UI
  - all other paths to `public/`
- `middleware.js` handles maintenance mode, learner page auth gating, central CORS, and security headers including CSP.
- `package.json` scripts are minimal:
  - `npm run dev` / `npm start` use `vercel dev`
  - `npm test` runs Playwright
  - `npm run deploy` runs `vercel --prod`
- No `.github/` directory was present in this branch, so there is no visible GitHub Actions CI config in-repo.
- Scheduled Vercel crons include reminders, iCal sync, offer expiry, payouts, Setmore sync/welcome, retention, auto-completion, payment reconciliation, referral rewards, and platform balance snapshots.

### API Surface

The core action-routed API entry points are:

- Auth and identity: `api/learner-auth.js`, `api/instructor-auth.js`, `api/admin.js`, `api/magic-link.js`, shared `api/_auth.js`, `api/_csrf.js`, `api/_password.js`.
- Booking and availability: `api/slots.js`, `api/instructor.js`, `api/instructors.js`, `api/availability.js`, `api/calendar.js`, `api/ical-sync.js`, `api/setmore-sync.js`.
- Payments and offers: `api/credits.js`, `api/webhook.js`, `api/offers.js`, `api/connect.js`, `api/cron-payouts.js`, `api/_payout-helpers.js`, `api/_platform-balance.js`, `api/_stripe-fee.js`.
- Admin/school management: `api/admin.js`, `api/schools.js`, `api/config.js`, `api/lesson-types.js`, `api/videos.js`.
- GDPR/compliance/supporting services: `api/learner.js`, `api/cron-retention.js`, `api/_audit.js`, `api/enquiries.js`, `api/reminders.js`, `api/reviews.js`, `api/address-lookup.js`.
- AI tools: `api/advisor.js`, `api/ask-examiner.js`.

### Frontend Entry Points

- Public: `public/index.html`, `public/availability.html`, `public/free-trial.html`, `public/lessons.html`, `public/learner-journey.html`, `public/accept-offer.html`, `public/success.html`, `public/privacy.html`, `public/terms.html`.
- Learner: `public/learner/*.html` and paired JS files for login, dashboard, booking, credits, lessons, progress, profile, data export/deletion, referral, practice, videos, AI tools, and mock tests.
- Instructor: `public/instructor/*.html` and paired JS for login, calendar, dashboard, availability, learners, earnings, onboarding, and profile.
- Admin/superadmin: `public/admin/*.html`, `public/superadmin/*.html`, plus legacy/admin redirect pages.
- Shared frontend utilities include `public/sidebar.js`, `public/shared/learner-auth.js`, `public/shared/instructor-auth.js`, `public/shared/admin-auth.js`, `public/cookie-consent.js`, `public/posthog-loader.js`, `public/sw.js`, and branding/dark-mode helpers.

### Database

The primary schema lives in `db/migration.sql`, currently defining or evolving 40+ tables. Core tables include:

- Identity and tenancy: `schools`, `admin_users`, `learner_users`, `instructors`.
- Auth/session support: `magic_link_tokens`, `instructor_login_tokens`, `rate_limits`.
- Booking and availability: `lesson_bookings`, `slot_reservations`, `lesson_types`, `instructor_availability`, `instructor_blackout_dates`, `instructor_external_events`, `lesson_offers`, `learner_availability`.
- Learning/progress: `driving_sessions`, `skill_ratings`, `learner_onboarding`, `quiz_results`, `mock_tests`, `mock_test_faults`, `focused_practice_sessions`.
- Payments/accounting: `credit_transactions`, `instructor_payouts`, `payout_line_items`, `school_payouts`, `balance_audit`, `platform_balance_snapshots`.
- Compliance and communications: `cookie_consents`, `audit_log`, `deletion_requests`, `sent_reminders`, `enquiries`, `availability_submissions`, `referrals`, `referral_clicks`.

Tenant scoping through `school_id` is a major invariant. `CLAUDE.md` explicitly requires tenant-scoped tables and queries to filter by `school_id`.

### Tests

Current tests are Playwright-based:

- `tests/booking-status.spec.js` pins the three-state booking lifecycle contract.
- `tests/advance-cap.spec.js` checks the 12-week booking cap, with deeper live API assertions gated by environment variables.
- `tests/offer-recurring-series.spec.js` covers recurring offer behavior.
- `tests/cookie-consent.spec.js` covers consent behavior.
- `tests/fixtures/auth.js` supports authenticated API tests when configured.

The default Playwright config starts a static `npx serve public` server unless `CC_TEST_BASE_URL` is provided. Live API coverage requires `vercel dev`, database access, and test credentials.

## Phase 1 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is inventory and check output only; no code fixes were made.

### Inventory Summary

The route inventory confirms that most backend entry points are Vercel functions in `api/*.js`, with shared helpers kept in underscore-prefixed files. The action-routed public or token-based endpoints are:

- `api/slots.js`: `available`, `durations-for-slot`, `checkout-slot-guest`, and `book-free-trial` are public booking/slot surfaces; `book`, `checkout-slot`, `cancel`, `reschedule`, `my-bookings`, and `series-info` require learner auth.
- `api/offers.js`: `get-offer` and `accept-offer` are public offer-token flows; `expire-offers` is intended as a cron action.
- `api/learner-auth.js`: public password auth and account setup actions: `check-account`, `login`, `signup`, `set-password`, `set-password-from-offer`, `request-reset`, `add-email`.
- `api/instructor-auth.js`: public `login`/`logout`; `change-password` requires instructor auth.
- `api/magic-link.js`: public SMS/email-code support actions: `send-link`, `verify-code`, `send-email-code`, `verify-email-code`, `logout`.
- `api/config.js`: public `GET` config and public `record-consent`; config save is protected by `ADMIN_SECRET`.
- `api/reviews.js`: public cached review `GET`; forced refresh is protected by `ADMIN_SECRET`.
- `api/guarantee-price.js`: public `GET`; `POST` accepts either `STRIPE_WEBHOOK_SECRET` or `ADMIN_SECRET`.
- `api/r.js`: public referral redirect, rate-limited per IP/code.
- `api/status.js`: public maintenance/status JSON.
- `api/verify-session.js`: public Stripe session lookup by `session_id`.
- `api/webhook.js`: Stripe webhook only, protected by Stripe signature verification with `STRIPE_WEBHOOK_SECRET`.

Authenticated learner-facing endpoint groups:

- `api/learner.js`: learner auth for profile, progress, sessions, onboarding, GDPR export/deletion, availability, referrals, quizzes/mock tests, practice, and terms/contact actions.
- `api/credits.js`: learner auth for `balance`, `checkout`, and `verify`; `bulk-pricing` is public config-style pricing.
- `api/calendar.js`: learner/instructor calendar feed actions with auth-dependent feed URL generation and tokenized feed/download paths.
- `api/address-lookup.js`: any signed-in learner, instructor, or admin.
- `api/advisor.js` and `api/ask-examiner.js`: use shared auth/context, currently no role filter in `_shared.verifyAuth()`.

Authenticated instructor/admin endpoint groups:

- `api/instructor.js`: instructor auth for schedule, availability, bookings, offers, broadcasts, learner notes/history, earnings, iCal, onboarding/profile, and running-late actions.
- `api/admin.js`: admin auth for dashboard, bookings, learners, instructors, payouts, platform balance, referral config/activity, and manual payout processing. Public auth actions are `login`, `logout`, `request-reset`, and `reset-password`. `create-admin` can be authorized by existing admin auth or legacy `ADMIN_SECRET`.
- `api/instructors.js`: admin auth for list/create/update/availability/password actions; also references `ADMIN_SECRET`.
- `api/schools.js`: `branding` is public; `list`, `create`, `toggle`, `create-admin`, `platform-stats`, and `school-stats` require superadmin; `get` and `update` allow school admin for own school or superadmin.
- `api/connect.js`: learner/instructor/admin Stripe Connect actions; school-level actions are admin-oriented.
- `api/lesson-types.js`, `api/videos.js`, `api/update-status.js`, `api/availability.js`, and admin paths in `api/enquiries.js` require admin or role-specific auth as indicated in code comments.

Secret-protected and cron endpoints:

- Shared cron auth lives in `api/_auth.js::verifyCronAuth()`. It accepts `Authorization: Bearer <CRON_SECRET>`, `?key=`, or `?secret=`, and fails closed when `CRON_SECRET` is absent.
- `api/reminders.js?action=send-due` hourly and `daily-schedule` daily use shared `verifyCronAuth()`. Comments say POST, but handlers do not enforce method, so Vercel's GET cron can run them.
- `api/cron-payouts.js`, `api/cron-auto-complete.js`, `api/cron-reconcile-payments.js`, `api/cron-referral-rewards.js`, `api/cron-retention.js`, `api/cron-balance-snapshot.js`, `api/setmore-sync.js`, and `api/setmore-welcome.js` use shared `verifyCronAuth()`. `api/cron-payouts.js` also allows an admin JWT for manual dashboard trigger.
- `api/ical-sync.js` has a local `verifyCronAuth()` implementation. It returns true if `CRON_SECRET` is missing and compares secrets with plain equality. This differs from the shared fail-closed, timing-safe helper and should move to Phase 2 auth/endpoint review.
- `api/offers.js?action=expire-offers` is configured in `vercel.json` as a Vercel cron path, but the handler requires POST. Vercel cron invokes GET requests, so this scheduled expiry path appears unable to run as configured. This belongs in Phase 2 or an operations fix branch after approval.
- `api/migrate.js` and `api/seed-test-data.js` are protected by `MIGRATION_SECRET`.

Vercel cron schedule from `vercel.json`:

- Hourly or sub-hourly: reminders due, iCal sync every 15 minutes, offer expiry at minute 30, Setmore sync every 15 minutes, auto-complete at minute 15, payment reconciliation at minute 30.
- Daily/weekly: daily schedule email at 19:00 UTC, Setmore welcome at 10:00 UTC, referral rewards at 04:00 UTC, platform balance snapshot at 08:00 UTC, retention weekly Sunday 03:00 UTC, payouts Friday 09:00 UTC.
- Auth model is mostly shared `CRON_SECRET`, with the two exceptions above: iCal local fail-open behavior and offer expiry GET-vs-POST mismatch.

Environment variables referenced by runtime/test files:

- Core runtime: `POSTGRES_URL` is used by most DB-backed API files; `JWT_SECRET` is used by `_auth.js`, admin/instructor/learner auth, magic-link, offers, and selected instructor flows; `BASE_URL` is used for generated links across admin, learner, instructor, magic-link, offers, Setmore welcome, notifications, and slots.
- Payment and money movement: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SLACK_WEBHOOK_URL`.
- Cron/admin secrets: `CRON_SECRET`, `ADMIN_SECRET`, `MIGRATION_SECRET`.
- Email/alerts: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `STAFF_EMAIL`, `ERROR_ALERT_EMAIL`, `RESEND_API_KEY`.
- Messaging: `TWILIO_SID`, `TWILIO_AUTH`, `TWILIO_FROM`, `TWILIO_WHATSAPP_FROM`.
- External integrations: `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`, `OPENROUTESERVICE_API_KEY`, `SETMORE_REFRESH_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `N8N_WEBHOOK_URL`.
- Operational/test flags: `MAINTENANCE_MODE`, `CI`, `CC_TEST_BASE_URL`, `CC_TEST_API`, and the live auth test credential variables described in `tests/fixtures/auth.js`.

Tests present:

- `tests/booking-status.spec.js`: pure Node/Playwright assertions for the three-state booking lifecycle constants and predicates. Runs without live services.
- `tests/cookie-consent.spec.js`: static browser tests for cookie banner behavior, PostHog consent gating, localStorage persistence, Escape rejection, stale-version prompting, and mocked `/api/config?action=record-consent`.
- `tests/offer-recurring-series.spec.js`: static browser/API-mocked tests for accept-offer recurring UI and instructor modal markup. Live create-offer validation tests are gated by `CC_TEST_API`.
- `tests/advance-cap.spec.js`: booking cap tests. The live API block is skipped unless `CC_TEST_API=1`; authenticated variants additionally need `CC_TEST_LEARNER_EMAIL/PASSWORD`, `CC_TEST_INSTRUCTOR_EMAIL/PASSWORD`, and `CC_TEST_ADMIN_EMAIL/PASSWORD`.
- `tests/fixtures/auth.js`: worker-scoped live login fixtures for learner, instructor, and admin against `CC_TEST_BASE_URL`.

CI/deployment checks:

- No `.github/` directory is present in this checkout, so no GitHub Actions workflow is visible in-repo.
- `package.json` exposes `npm test`, but there is no lint, format, typecheck, or dedicated syntax-check script.
- Vercel deployment is configured through `vercel.json`; any external Vercel checks, branch protection, or other CI provider are not represented in this repository.

### Commands Run And Results

- `git pull --ff-only origin audit/coachcarter-website-repo-health`: branch was already up to date.
- `npm install`: first attempt failed because PowerShell blocks `npm.ps1`; `npm.cmd install` then failed under sandboxed network/cache access. Rerun with approved network access succeeded, installing 156 packages and reporting 0 vulnerabilities during install. It warned that `scmp@2.1.0` and `glob@10.5.0` are deprecated.
- `npx playwright install chromium`: required after the first test run because Playwright's Chromium binary was missing. Download/install succeeded.
- `npm test`: after Chromium install, 35 tests discovered, 23 passed, 12 skipped. Skipped tests are the `CC_TEST_API` and authenticated live API tests.
- `npm audit --omit=dev`: succeeded and reported 0 vulnerabilities.
- `node --check middleware.js`: passed.
- `Get-ChildItem api -Filter *.js | ForEach-Object { node --check $_.FullName }`: passed for all API JavaScript files.

### Confirmed Gaps

- No in-repo CI workflow is present.
- `npm test` is not cold-start complete unless dependencies and Playwright browsers are installed first. A fresh CI runner would need explicit `npm ci` or `npm install` plus `npx playwright install --with-deps chromium` or equivalent.
- `package-lock.json` did not include the declared Playwright dev dependency metadata before local install. `npm install` generated a lockfile delta; it was reverted because this audit branch should only commit `AUDIT.md`.
- Live DB/API coverage is intentionally skipped without `CC_TEST_API`, `CC_TEST_BASE_URL`, and role credentials. Current default tests mostly validate static UI/module contracts.
- No lint/type/static analysis script is defined. The manual `node --check` pass only proves JavaScript parses; it does not catch runtime imports, missing env, SQL/tenant mistakes, or browser regressions.
- `api/ical-sync.js` cron auth is inconsistent with the shared helper and fails open when `CRON_SECRET` is missing.
- `api/offers.js?action=expire-offers` appears incompatible with Vercel cron's GET invocation because the handler requires POST.

### Proposed CI/Test Harness Next Steps

- Add a minimal GitHub Actions workflow on PRs with `npm ci`, `npx playwright install --with-deps chromium`, `npm test`, `npm audit --omit=dev`, and a JS syntax check over `api/*.js`, `middleware.js`, and `playwright.config.js`.
- Add a package script for syntax checks so local and CI commands match.
- Decide whether the lockfile should be regenerated to include declared dev dependencies, then do that in a separate chore branch rather than the audit branch.
- Add a second optional CI job for live API smoke tests, gated on explicit staging secrets: `CC_TEST_BASE_URL`, `CC_TEST_API=1`, role test credentials, `CRON_SECRET`, and a non-production Neon database.
- Define a safe seed/reset story before enabling DB-backed tests for bookings, offers, payments, retention, and tenant isolation.

### Move To Later Audit Phases

- Phase 2 auth/tenant review: full endpoint-by-endpoint auth matrix; `api/ical-sync.js` fail-open cron auth; `api/offers.js?action=expire-offers` cron method mismatch; public cost/email/SMS endpoints and rate-limit coverage; `_shared.verifyAuth()` call sites that accept any valid role; superadmin `school_id` overrides in admin/school routes.
- Phase 3 payments/booking review: Stripe webhook idempotency; `verify-session` public Stripe session lookup behavior; guest checkout and offer acceptance race windows; slot reservation lifecycle; payout cron/admin parity; balance snapshot and reconciliation coverage.
- Phase 4 data protection review: confirm `learner.js` export/deletion and `cron-retention.js` cover every PII-bearing table currently in `db/migration.sql`.

## Risk Areas Ranked By Priority

### P0: Money Movement And Payment Idempotency

Stripe Checkout, Stripe webhooks, guest booking, credit purchases, offers, partial refunds, Stripe Connect onboarding, Friday payout cron, payout retries, and platform balance snapshots are the highest-risk areas. These flows move money, mutate learner balances, create bookings, and trigger instructor/school transfers.

Audit focus:
- Idempotency for `checkout.session.completed`, async payment failures, retries, partial refunds, and reconciliation.
- Whether every booking/credit/payment mutation is tenant-scoped and duplicate-safe.
- Whether failed payout rollback logic always leaves bookings retryable without double-paying.
- Whether historical/backlog payout controls such as `payouts_start_date` are enforced everywhere.
- Whether manual admin payout and cron payout paths are behaviorally identical.

### P0: Auth, CSRF, Tenant Isolation, And Privilege Boundaries

The repo has a centralized auth module and CSRF double-submit checks, but the API surface is broad and some endpoints still use legacy secrets or older helper patterns.

Audit focus:
- Every mutating endpoint should use `requireAuth()` or a deliberately documented public/cron/secret path.
- Every tenant-scoped query should constrain by `school_id`.
- Superadmin school override behavior should be explicit and safe.
- Legacy `ADMIN_SECRET`, `MIGRATION_SECRET`, `magic-link`, and seed/test endpoints should be reviewed for production exposure.
- Public endpoints that send email/SMS, cost money, or create bookings should be rate-limited and abuse-resistant.

### P1: Booking Lifecycle, Scheduling, And Race Conditions

Booking is central and complex: slot generation, reservations, credits, guest checkout, free trials, offers, Setmore imports, iCal events, travel-time checks, cancellations, rescheduling, status transitions, and payout eligibility all intersect.

Audit focus:
- Race windows around slot reservations, Stripe checkout completion, offer acceptance, cancellations, and reschedules.
- Consistency of the three-state booking model: `scheduled`, `chargeable`, `refunded`.
- Late cancellation under 48 hours and cron auto-complete behavior.
- Repeated-offer series behavior and partial refund handling.
- Known free-trial carry-over concerns documented in handover notes, especially duplicate prevention by phone and WhatsApp delivery observability.

### P1: Data Protection, GDPR, And Retention

The app stores learner, instructor, booking, financial, referral, analytics-consent, and audit data. It has export/deletion flows and a retention cron, but those need to be checked against the current schema.

Audit focus:
- Whether all PII-bearing tables appear in export, deletion, anonymization, and retention paths.
- Whether financial records are retained/anonymized rather than hard-deleted.
- Whether cookie consent is loaded on all relevant pages and PostHog remains consent-gated.
- Whether admin data mutations are consistently audit-logged.

### P1: Operational Crons And External Integrations

Many production-critical flows run on Vercel cron or external APIs: reminders, Setmore sync, iCal sync, payment reconciliation, retention, referral rewards, and balance snapshots.

Audit focus:
- Cron auth consistency. Most use shared `verifyCronAuth`; `api/ical-sync.js` has a local implementation worth comparing.
- Idempotency and failure alerting for each scheduled job.
- External API failure modes for Stripe, Twilio/WhatsApp, SMTP/Resend, Setmore, Google Places, OpenRouteService, PostHog, Cloudflare Stream, and Anthropic.
- Whether crons can overlap and produce duplicate side effects.

### P2: Migration And Schema Governance

The schema is managed through one large idempotent migration plus legacy migrations. This can work, but it increases drift risk.

Audit focus:
- Whether `db/migration.sql` remains replayable from an empty database and safe on a populated database.
- Whether legacy tables marked as retired, such as `waitlist`, still exist deliberately or only by inertia.
- Whether constraints and indexes match current code paths.
- Whether docs and migration comments match the current code.

### P2: Test Coverage And CI Gaps

There is useful targeted Playwright coverage, but no visible GitHub Actions config. Default tests mostly exercise static frontend behavior unless live API env vars are provided.

Audit focus:
- Add CI strategy for static tests, dependency audit, lint/syntax checks, and optionally live API smoke tests.
- Identify high-value DB-backed tests for booking, payment, auth, and tenant isolation.
- Add a safe fixture strategy for Neon/Vercel dev that avoids production data.

### P2: Dependency And Runtime Health

The dependency set is small but includes security-sensitive libraries: `bcryptjs`, `jsonwebtoken`, `stripe`, `twilio`, `nodemailer`, `resend`, `@neondatabase/serverless`, and `node-ical`.

Audit focus:
- Run `npm audit` and review package freshness.
- Decide whether any Vercel/runtime Node version should be pinned.
- Check whether `package-lock.json` is current with `package.json`.
- Review transitive risks for email, JWT, and payment packages.

### P3: Frontend Maintainability And Stale Surfaces

The frontend is vanilla and broad, with many large HTML files and paired scripts. Navigation, auth gates, CSP restrictions, and shared JS conventions matter.

Audit focus:
- Pages with inline scripts/styles against current CSP expectations.
- Pages missing shared auth, branding, cookie consent, or PostHog loader patterns.
- Legacy pages and docs that might mislead future changes.
- PWA/service worker caching and stale asset behavior around auth-sensitive pages.

## Recommended Audit Phases

### Phase 1: Baseline Inventory And Automated Checks

- Run `npm install`, `npm test`, and targeted syntax checks.
- Run `npm audit` and dependency freshness review.
- Produce an endpoint inventory: public, authenticated, admin, superadmin, cron, secret-protected, webhook.
- Produce an environment variable inventory and map each secret to the files that consume it.
- Confirm there is no CI, then propose minimal GitHub Actions coverage.

### Phase 2: Auth, Tenant, And Endpoint Access Review

- Review every `api/*.js` entry point for auth model, role checks, CSRF behavior, rate limiting, and tenant scoping.
- Trace `school_id` from session/JWT/request through major queries.
- Check all superadmin override paths in `api/schools.js`, `api/admin.js`, and related admin frontend code.
- Review legacy secret-protected endpoints and decide whether they need additional controls or retirement.

### Phase 3: Payments, Booking, And Payout Deep Dive

- Trace credit purchase, guest slot checkout, learner credit booking, offer checkout, recurring offer fan-out, free trial booking, and webhook completion.
- Review Stripe webhook idempotency and payment reconciliation behavior.
- Review payout cron/manual payout parity, payout retry behavior, shortfall/deposit handling, and Stripe Connect health surfacing.
- Add or design DB-backed tests for high-value race and idempotency cases.

### Phase 4: Data Protection And Retention Review

- Map all PII and financial tables.
- Verify export/deletion/retention/anonymization coverage.
- Review audit logging for admin, password, and data mutation flows.
- Check cookie consent/PostHog loading across HTML pages.
- Review privacy/terms text against actual services in use.

### Phase 5: Operations, External Integrations, And Observability

- Review all Vercel cron handlers for auth, idempotency, alerting, and overlap safety.
- Review error reporting coverage and whether caught third-party failures surface in Vercel logs/email/Slack.
- Check Setmore/iCal sync invariants and manual recovery docs.
- Review credential rotation docs against current environment variables.

### Phase 6: Frontend/PWA Maintainability Pass

- Inventory pages by role and shared JS dependencies.
- Check CSP compatibility, service worker caching, stale auth handling, and route redirects.
- Identify duplicate/legacy UI surfaces that should be retired or documented.
- Prioritize ergonomic fixes only after security/payment findings are understood.

## Suggested Branch/PR Strategy For Future Fixes

- Keep PR #147 and branch `audit/coachcarter-website-repo-health` as the planning and findings home.
- Do not put code fixes in the audit branch unless they are documentation-only audit updates.
- For each fix area, create focused branches from latest `main`:
  - `fix/auth-tenant-scope-<topic>`
  - `fix/payments-idempotency-<topic>`
  - `fix/booking-race-<topic>`
  - `fix/gdpr-retention-<topic>`
  - `chore/ci-health-checks`
  - `chore/dependency-maintenance`
- Prefer small PRs with one risk class each. Payment/auth fixes should include tests or a written manual verification plan.
- Merge order should be:
  1. Low-risk CI/test harness improvements.
  2. Documentation corrections that reduce future mistakes.
  3. Auth/tenant/payment fixes, one flow at a time.
  4. Operational cleanup and frontend maintainability work.
- After each merged fix PR, update `AUDIT.md` in this branch or a follow-up audit PR with status and remaining risk.

## Immediate Questions Or Missing Context

- Is Vercel Cron configured with `CRON_SECRET` Authorization headers in production, or are any cron paths currently relying on query-string `?key=` manual triggers?
- Is there an external CI provider, Vercel checks-only workflow, or branch protection setup not represented by `.github/` files?
- Which Neon database should be used for DB-backed tests: local/dev/staging, and can it be safely reset with `api/seed-test-data.js`?
- Are Stripe test-mode credentials and webhook forwarding available for audit reproduction, or should payment tests remain mocked/design-level?
- Which flows are currently live revenue-critical: CoachCarter single-school bookings only, multi-school InstructorBook onboarding, franchise payouts, or all of them?
- Are legacy docs/features like `waitlist`, old magic-link wording, `create-checkout-session.js`, and pass-guarantee package flows still intentionally retained?
- Should audit findings be tracked only in `AUDIT.md`, or should high-priority confirmed issues become GitHub issues as they are found?
- Who should approve production-sensitive tests that trigger emails/SMS/WhatsApp, Stripe sessions, payouts, or retention/deletion flows?
