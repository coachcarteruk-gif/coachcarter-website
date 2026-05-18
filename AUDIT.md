# CoachCarter Website Repo Health Audit

## Read This First: Remediation Merge Strategy

`main` should stay untouched until the user explicitly approves a merge plan. Focused remediation branches should be opened as draft PRs into `main` for review only, and left unmerged. Use `integration/audit-fixes-preview` only as a disposable combined testing branch if the fixes need to be built and tested together before anything lands on `main`.

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

## Phase 2 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is documentation-only audit evidence for Auth, Tenant, and Endpoint Access Review. No code fixes were made.

### Endpoint Auth Matrix Summary

Legend: public = unauthenticated; learner/instructor/admin/superadmin = `requireAuth()` role gate or equivalent local wrapper; cron = `CRON_SECRET`; legacy secret-protected = `ADMIN_SECRET` or `MIGRATION_SECRET`; token/link protected = high-entropy one-time or calendar/referral/offer token; Stripe webhook = Stripe signature verification.

| Endpoint/action | Method | Current access model | Evidence / notes |
|---|---:|---|---|
| `api/address-lookup.js` | GET | learner auth, instructor auth, admin auth | Calls `requireAuth(req, { roles: ['learner', 'instructor', 'admin'] })`; also rate-limits 60/hour per authenticated `user.id`. |
| `api/admin.js?action=login` | POST | public | Public password login; email and IP rate-limited in `handleLogin()`. |
| `api/admin.js?action=logout` | POST | public/session cleanup | Clears admin cookie; no privileged data mutation beyond logout. |
| `api/admin.js?action=request-reset` | POST | public | Sends admin reset code; email/IP rate-limited and enumeration-safe. |
| `api/admin.js?action=reset-password` | POST | token/link protected | Verifies email code from `magic_link_tokens`, then resets password and issues admin cookie. |
| `api/admin.js?action=create-admin` | POST | admin auth or legacy secret-protected | `handleCreateAdmin()` accepts either existing admin JWT or `verifyAdminSecret(req)`. |
| `api/admin.js?action=verify` | GET | admin auth | Uses `verifyAdminJWT()` / shared `requireAuth(req, { roles: ['admin'] })`. |
| `api/admin.js?action=dashboard-stats`, `all-bookings`, `edit-booking`, `mark-complete`, `all-instructors`, `create-instructor`, `update-instructor`, `toggle-instructor`, `all-learners`, `learner-detail`, `update-learner`, `adjust-credits`, `delete-learner`, `confirmation-details`, `toggle-payout-pause`, `payout-overview`, `platform-balance`, `process-payouts`, `instructor-payout-history`, `invite-learner`, `instructor-blackouts`, `set-instructor-blackouts`, `referral-activity`, `referral-config`, `update-referral-config` | mixed GET/POST | admin auth; superadmin accepted as admin by shared helper | Central wrapper uses `requireAuth(req, { roles: ['admin'] })`; in `_auth.js`, role `admin` also accepts `superadmin` and instructor tokens with `isAdmin === true`. |
| `api/advisor.js` | POST | public for chat; any valid role for personalised context/checkout trigger | `verifyAuth()` from `_shared.js` calls `requireAuth(req)` with no role filter. Chat is explicitly optional auth; checkout creation only checks that some `user` exists, not that `role === 'learner'`. |
| `api/ask-examiner.js` | POST | public for chat; any valid role for personalised context | Same `_shared.verifyAuth()` no-role-filter pattern as `advisor.js`. |
| `api/availability.js` GET | GET | admin auth | `requireAuth(req, { roles: ['admin'] })`; queries filter `availability_submissions.school_id = schoolId`. |
| `api/availability.js` POST | POST | public | Public availability submission; rate-limited 5/IP/hour; sends staff/customer email when Resend is configured. |
| `api/calendar.js?action=download` | GET | any valid role, effectively learner-owned booking | `verifyAuth()` calls `requireAuth(req)` with no role filter, then query requires `lb.learner_id = user.id` and `lb.school_id = user.school_id`. |
| `api/calendar.js?action=feed` | GET | token/link protected | Uses `learner_users.calendar_token`, no JWT; feed token is the bearer secret. |
| `api/calendar.js?action=feed-url` | GET | any valid role, intended learner | `verifyAuth()` has no role filter and updates `learner_users WHERE id = user.id`; non-learner roles will normally get no learner row but this is not an explicit role gate. |
| `api/calendar.js?action=instructor-feed` | GET | token/link protected | Uses `instructors.calendar_token`, no JWT. |
| `api/calendar.js?action=instructor-feed-url` | GET | instructor auth | Calls `requireAuth(req, { roles: ['instructor'] })`. |
| `api/config.js` GET | GET | public | Reads school config by `?school_id=` or legacy site config. |
| `api/config.js?action=record-consent` | POST | public | Records consent row; no rate limit observed. |
| `api/config.js` POST save config | POST | legacy secret-protected | Requires body `password` matching `ADMIN_SECRET`; can update `schools.config` for body `school_id`. |
| `api/connect.js?action=create-account`, `onboarding-link`, `connect-status`, `dashboard-link` | mixed | instructor auth | Uses `requireAuth(req, { roles: ['instructor'] })` and `user.school_id`. |
| `api/connect.js?action=admin-create-account`, `admin-send-invite` | POST | admin auth | Uses `requireAuth(req, { roles: ['admin'] })`, scoped to `admin.school_id || 1`. |
| `api/connect.js?action=school-create-account`, `school-onboarding-link`, `school-connect-status`, `school-dashboard-link` | mixed | admin auth | School Stripe Connect actions use admin auth and `admin.school_id || 1`; no `getSchoolId()` superadmin override observed. |
| `api/create-checkout-session.js` | POST | learner auth or admin auth | Legacy checkout path accepts `requireAuth(req, { roles: ['learner', 'admin'] })`; creates Stripe Checkout using caller-supplied line items/metadata/URLs. Defer payment semantics to Phase 3. |
| `api/credits.js?action=bulk-pricing` | GET | public | Public pricing/config data by school. |
| `api/credits.js?action=balance`, `checkout`, `verify` | mixed | learner auth or admin auth | `verifyAuth()` allows `roles: ['learner', 'admin']`; tenant-scoped by `user.school_id || 1`. |
| `api/cron-auto-complete.js` | any | cron | Shared `verifyCronAuth()`, fail-closed if `CRON_SECRET` missing. |
| `api/cron-balance-snapshot.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/cron-payouts.js` | any | cron or admin auth | `verifyCronAuth(req)` OR `requireAuth(req, { roles: ['admin'] })` for manual trigger. |
| `api/cron-reconcile-payments.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/cron-referral-rewards.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/cron-retention.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/enquiries.js?action=submit` | POST | public | Public contact/enquiry submission; rate-limited 5/IP/hour; sends staff email if configured. |
| `api/enquiries.js?action=list`, `get`, `update-status` | mixed | admin auth | Calls `requireAuth(req, { roles: ['admin'] })`; queries use `schoolId`. |
| `api/guarantee-price.js` GET | GET | public | Reads guarantee pricing. |
| `api/guarantee-price.js` POST | POST | legacy secret-protected | Requires body `secret` equal to either `STRIPE_WEBHOOK_SECRET` or `ADMIN_SECRET`. |
| `api/ical-sync.js` | GET | cron intended; fail-open when secret missing | Local `verifyCronAuth()` returns `true` when `CRON_SECRET` is unset and compares with `===`; does not use shared fail-closed helper. |
| `api/instructor.js?action=request-login`, `validate-token`, `verify-token`, `logout` | mixed | public/token legacy flow | Legacy instructor login-token flow still present in `instructor.js`; current password login lives in `instructor-auth.js`. |
| `api/instructor.js?action=schedule`, `schedule-range`, `availability`, `set-availability`, `profile`, `update-profile`, `blackout-dates`, `set-blackout-dates`, `learner-history`, `cancel-booking`, `reschedule-booking`, `edit-booking`, `create-booking`, `stats`, `upload-photo`, `my-learners`, `school-learners`, `update-notes`, `learner-notes`, `learner-mock-tests`, `update-learner-notes`, `earnings-week`, `earnings-history`, `earnings-summary`, `ical-test`, `ical-status`, `create-offer`, `list-offers`, `cancel-offer`, `preview-broadcast-audience`, `create-broadcast-offer`, `close-broadcast-offer`, `my-broadcast-batches`, `payout-history`, `next-payout-preview`, `complete-onboarding`, `running-late` | mixed | instructor auth | Shared `requireAuth(req, { roles: ['instructor'] })`. |
| `api/instructor-auth.js?action=login`, `logout` | POST | public/session cleanup | Password login/logout; login is public. |
| `api/instructor-auth.js?action=change-password` | POST | instructor auth | Calls `requireAuth(req, { roles: ['instructor'] })`. |
| `api/instructors.js?action=list`, `availability`, `create`, `update`, `set-availability`, `set-password` | mixed | admin auth | Uses `requireAuth(req, { roles: ['admin'] })`; comments still mention `ADMIN_SECRET` but current code uses admin JWT. |
| `api/learner.js?action=validate-referral` | GET | public | Public referral-code validation by `code` and `school_id`. |
| `api/learner.js?action=confirm-deletion` | POST | token/link protected | Uses deletion token from `deletion_requests`, no JWT. |
| `api/learner.js?action=update-name`, `sessions`, `progress`, `contact-pref`, `set-contact-pref`, `profile`, `update-profile`, `unlogged-bookings`, `mock-tests`, `mock-test-faults`, `focused-practice`, `quiz-results`, `competency`, `onboarding`, `profile-completeness`, `my-availability`, `set-availability`, `accept-terms`, `referral-code`, `referral-stats`, `export-data`, `request-deletion` | mixed | any valid role, intended learner | Local `verifyAuth()` calls `requireAuth(req)` with no role filter. Most queries use `user.id` as learner id and `user.school_id`, but role is not enforced. |
| `api/learner-auth.js?action=login`, `signup`, `set-password`, `set-password-from-offer`, `request-reset`, `add-email`, `check-account` | mixed | public/token depending action | Public account setup/password endpoints. Reset/password-set actions rely on email codes or password-set tickets; no authenticated role gate. |
| `api/lesson-types.js?action=list` | GET | public | Public active lesson types by school. |
| `api/lesson-types.js?action=all`, `create`, `update`, `toggle` | mixed | admin auth | Admin wrapper uses `requireAuth(req, { roles: ['admin'] })`. |
| `api/magic-link.js?action=send-link`, `verify-code`, `send-email-code`, `verify-email-code`, `logout` | mixed | public/token | Public SMS/email-code support. Send actions have manual rate limits keyed by email/phone. |
| `api/migrate.js` | GET | legacy secret-protected | Requires `?secret=` matching `MIGRATION_SECRET` via `safeEqual()`. |
| `api/offers.js?action=get-offer` | GET | token/link protected | Public offer token lookup. No rate limit observed. |
| `api/offers.js?action=accept-offer` | POST | token/link protected; public side effects | Public offer token acceptance; can create learner/session, create Stripe Checkout, create free bookings, and send emails. No rate limit observed. |
| `api/offers.js?action=expire-offers` | POST required | cron | Shared `verifyCronAuth()` fail-closed, but handler requires POST while Vercel cron path invokes GET. |
| `api/r.js` | GET | public token/code redirect | Public referral redirect by code; rate-limited 30/IP+code/hour; logs click best-effort. |
| `api/reminders.js?action=send-due`, `daily-schedule` | any | cron | Shared `verifyCronAuth()`; comments say POST but handlers do not enforce method, so Vercel GET can run. |
| `api/reminders.js?action=settings`, `update-settings` | mixed | instructor auth | Uses instructor auth. |
| `api/reviews.js` GET | GET | public | Serves cached Google reviews and refreshes stale cache. |
| `api/reviews.js` POST | POST | legacy secret-protected | Requires body password matching `ADMIN_SECRET`. |
| `api/schools.js?action=branding` | GET | public | Public branding lookup by `school_id` or `slug`. |
| `api/schools.js?action=list`, `create`, `toggle`, `create-admin`, `platform-stats`, `school-stats` | mixed | superadmin | Handlers call admin auth and then require `isSuperAdmin(admin)` for platform operations. |
| `api/schools.js?action=get`, `update` | mixed | admin auth for own school or superadmin | Non-superadmin rejected unless `admin.school_id === target school_id`; superadmin may target any school. |
| `api/seed-test-data.js` | GET | legacy secret-protected | Requires `?secret=` matching `MIGRATION_SECRET`; `action=clean` deletes seeded test data. |
| `api/setmore-sync.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/setmore-welcome.js` | any | cron | Shared `verifyCronAuth()`, fail-closed. |
| `api/slots.js?action=available`, `durations-for-slot` | GET | public | Public slot feed/duration checks by `school_id`; tenant filters are mostly present on reads. |
| `api/slots.js?action=checkout-slot-guest` | POST | public | Public paid guest checkout; rate-limited 10/IP/hour and 5/phone/hour; creates learner/reservation and Stripe Checkout. |
| `api/slots.js?action=book-free-trial` | POST | public | Public free-trial booking; rate-limited 10/IP/hour and 3/phone/hour; creates learner, booking, email/login token side effects. |
| `api/slots.js?action=book`, `checkout-slot`, `cancel`, `reschedule`, `my-bookings`, `series-info` | mixed | learner auth | Uses `requireAuth(req, { roles: ['learner'] })`. |
| `api/status.js` | GET | public | Public health/status JSON. |
| `api/update-status.js` | POST | admin auth | Uses `requireAuth(req, { roles: ['admin'] })`. |
| `api/verify-session.js` | GET | public | Public Stripe session lookup by `session_id`; defer payment/privacy implications to Phase 3/4. |
| `api/videos.js?action=list`, `categories` | GET | public | Public video listing/category reads. |
| `api/videos.js?action=create`, `update`, `delete`, `reorder`, `upload-url`, `fetch-meta`, `bulk-update`, `bulk-delete`, `create-category`, `update-category`, `delete-category` | mixed | admin auth | Admin wrapper calls `requireAuth(req, { roles: ['admin'] })`. |
| `api/webhook.js` | POST | Stripe webhook | Verifies Stripe signature with `STRIPE_WEBHOOK_SECRET`. |

### Confirmed Auth, Cron, And Secret Issues

- `api/ical-sync.js` has a confirmed fail-open cron auth bug. Its local `verifyCronAuth()` returns `true` when `process.env.CRON_SECRET` is missing, while shared `api/_auth.js::verifyCronAuth()` fails closed, accepts `Authorization: Bearer`, `?key=`, or `?secret=`, and uses `crypto.timingSafeEqual()`. It also compares provided secrets with plain equality.
- `api/offers.js?action=expire-offers` is confirmed incompatible with the Vercel cron path in `vercel.json`. `vercel.json` schedules `/api/offers?action=expire-offers`; the handler only allows POST, while Vercel Cron invokes GET. This means scheduled offer expiry appears unable to run as configured. Manual POST with `CRON_SECRET` would still work.
- `_shared.verifyAuth()` intentionally calls `requireAuth(req)` without roles. `api/advisor.js` and `api/ask-examiner.js` are public chat endpoints and use the no-role helper only for optional personalisation, but `advisor.js` creates Stripe Checkout when any valid JWT exists. That should become explicit learner auth before checkout creation.
- `api/learner.js` repeats the no-role `requireAuth(req)` pattern for learner-targeted data and mutation actions. Most handlers use `user.id` as a learner id and therefore tend to fail harmlessly for non-learner ids, but the role boundary is implicit instead of enforced. This should be reviewed as an auth-hardening fix.
- `api/calendar.js?action=feed-url` also uses no-role auth and writes a learner calendar token by `user.id`; non-learner roles normally will not match a `learner_users` row, but the route should still be explicitly learner-gated.
- Legacy secret-protected endpoints remain production-sensitive: `config.js` save config and `reviews.js` force refresh use `ADMIN_SECRET`; `guarantee-price.js` POST accepts `STRIPE_WEBHOOK_SECRET` or `ADMIN_SECRET`; `migrate.js` and `seed-test-data.js` use `MIGRATION_SECRET`; `admin.js?action=create-admin` accepts admin JWT or `ADMIN_SECRET`. All use server-side secrets, but they should be inventoried for intended production exposure and rotation ownership.
- CSRF protection is centralized in `requireAuth()` and enforced for mutating authenticated requests. Public/token/cron/secret endpoints do not use CSRF, which is expected for non-cookie auth, but public POST endpoints need rate limiting and idempotency instead.

### Tenant Isolation Observations

- `api/admin.js` mostly derives `schoolId` through `getAdminSchoolId(admin, req)`, and common high-risk handlers such as all bookings, edit booking, learner detail/update, adjust credits, instructor CRUD, payouts, referrals, and referral config filter by that school. Superadmin targeting is implicit through `getAdminSchoolId()`, which allows a `school_id` override when `admin.school_id` is null.
- `api/admin.js?action=instructor-blackouts` and `set-instructor-blackouts` are confirmed tenant-scope gaps. Both accept `instructor_id`; the read, delete, insert, and saved-list queries filter only by `instructor_id` and date, with no check that the instructor belongs to the admin's school. A school admin could read or replace another school's instructor blackout dates if they know/guess the id.
- `api/admin.js?action=delete-learner` first confirms the learner belongs to `schoolId`, then deletes/anonymizes related rows by `learner_id` without `school_id`. Because the learner ownership check precedes the cascade, this is probably functionally safe for the target learner, but it should be revisited in Phase 4 GDPR to ensure all PII/financial cascades include current tables and intended retention semantics.
- `api/instructor.js` generally scopes schedule, schedule range, booking edit/reschedule, create booking, learner lists, broadcast audience, broadcast creation, and batch close by `instructor.id` plus `schoolId`. This is the strongest sampled area.
- `api/instructor.js?action=learner-notes` and `update-learner-notes` are tenant/relationship gaps. They read/upsert `instructor_learner_notes` by `instructor_id` and supplied `learner_id`, without confirming the learner is in the same school or has a booking/relationship with that instructor. The instructor id is authenticated, but the learner id is caller-controlled.
- `api/instructor.js` has additional low-confidence observations where reads/writes are scoped by `instructor.id` but not always by `school_id` (`payout-history`, `next-payout-preview`, some profile/onboarding helpers). Those are likely acceptable because `instructor.id` comes from the JWT, but a later hardening pass could add `school_id` for consistency.
- `api/slots.js?action=available` and `durations-for-slot` consistently join or filter instructor/availability/bookings/reservations/offers/blackouts/external events by supplied `school_id`. That public `school_id` is intentionally caller-controlled for public booking pages.
- `api/slots.js?action=checkout-slot` and `checkout-slot-guest` contain tenant-scope gaps in conflict and instructor validation. They derive `schoolId`, but the existing booking/reservation/offer conflict queries filter only by `instructor_id`, date, and time, and the instructor lookup in both flows checks `id` and `active` without `school_id`. The reservation rows are inserted with the caller's `schoolId`. This should be fixed before relying on multi-school public booking flows.
- `api/slots.js?action=book-free-trial` is better scoped for the final instructor lookup (`id`, `active`, `school_id`) and lesson type, but its prior-trial guard and slot conflict queries do not filter `lb.school_id` / `slot_reservations.school_id` / `lesson_offers.school_id`. Some of this may intentionally prevent cross-school duplicate free trials by email/phone, but the behavior is not documented and should be made explicit.
- `api/offers.js` derives the school from the offer's instructor for accept/free-offer flows, which is a reasonable token-based model. However, `findOrCreateLearner()` looks up existing learners by email or phone without `school_id`, then updates that matched learner and returns its id. This can attach a cross-school learner to an offer/booking from the instructor's school if email or phone overlaps. That is a confirmed high-risk multi-tenant bug.
- `api/schools.js` has explicit platform rules: `branding` is public; `get` and `update` allow own-school admin or superadmin; `list`, `create`, `toggle`, `create-admin`, `platform-stats`, and `school-stats` are superadmin-only. This is clearer than the implicit superadmin behavior in `admin.js`.
- `api/connect.js` consistently uses `user.school_id || 1` or `admin.school_id || 1` for instructor and school Stripe Connect actions. It does not use `getSchoolId()`, so a superadmin without `school_id` appears to default to school 1 rather than being able to target another school. That may be a product limitation rather than a vulnerability, but it should be documented.

### Public Abuse And Rate-Limit Gaps

- Rate-limited public endpoints confirmed: `availability.js` POST (5/IP/hour), `enquiries.js?action=submit` (5/IP/hour), `magic-link.js` send actions (manual email/phone rate limits), `slots.js?action=checkout-slot-guest` (10/IP/hour and 5/phone/hour), `slots.js?action=book-free-trial` (10/IP/hour and 3/phone/hour), `r.js` referral redirect (30/IP+code/hour), admin login/reset flows, and `address-lookup.js` authenticated proxy (60/user/hour).
- Public/token endpoints with cost or side effects and no rate limit observed: `offers.js?action=get-offer`, `offers.js?action=accept-offer`, `advisor.js`, `ask-examiner.js`, `config.js?action=record-consent`, `reviews.js` GET stale-cache refresh, `credits.js?action=bulk-pricing`, `lesson-types.js?action=list`, `verify-session.js`, and public calendar feed token endpoints. The highest priority among these are `offers?action=accept-offer` because it can create Stripe sessions, free bookings, learner rows, cookies, and emails, and AI endpoints because every request can call Anthropic.
- `create-checkout-session.js` is authenticated, but it accepts caller-supplied Stripe `line_items`, metadata, success URL, cancel URL, and custom fields. Because it is a legacy money path and accepts admin as well as learner auth, Phase 3 should decide whether it is still used or should be retired/locked down.

### Recommended Fix Branches / PR Order

1. `fix/auth-cron-ical-offers`: replace `api/ical-sync.js` local cron auth with shared `verifyCronAuth()` and make `offers?action=expire-offers` accept Vercel GET cron safely, with tests or manual Vercel cron verification notes.
2. `fix/auth-learner-role-gates`: add explicit learner role checks to `api/learner.js`, `api/calendar.js` learner actions, and `advisor.js` checkout creation while preserving deliberately public chat behavior.
3. `fix/tenant-admin-instructor-scope`: add school/relationship validation to admin instructor blackout handlers and instructor learner notes handlers.
4. `fix/tenant-public-booking-scope`: add school-scoped instructor/conflict checks to `slots.js` guest/auth checkout and clarify the intended cross-school free-trial duplicate policy.
5. `fix/tenant-offer-learner-lookup`: scope `offers.js` learner lookup/update by school or document and safely handle deliberate cross-school identity reuse.
6. `fix/abuse-public-ai-offers`: add rate limits/idempotency controls for offer acceptance and AI endpoints, then review public token feed exposure separately.

### Defer To Later Phases

- Phase 3 payments/booking: Stripe webhook idempotency; `verify-session` public session lookup; legacy `create-checkout-session.js`; slot reservation races; offer acceptance races; free-trial duplicate policy; payout cron/manual parity; Connect onboarding/account ownership edge cases.
- Phase 4 GDPR/data protection: `learner.js` and `admin.js` deletion cascades; retention cron coverage against current schema; calendar feed token lifetime/revocation; cookie consent write volume/rate limits; public token endpoints that expose PII through possession of a link.
- Phase 5 operations: whether Vercel production actually has `CRON_SECRET` set for Authorization headers; whether any cron/manual triggers still rely on query-string `?key=`; how secret rotation is documented for `ADMIN_SECRET`, `MIGRATION_SECRET`, `CRON_SECRET`, and Stripe webhook secrets.

## Phase 3 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is documentation-only audit evidence for Payments, Booking, and Payout Deep Dive. No code fixes were made. Findings below are based on source review only; Stripe live dashboard state, Vercel env vars, Neon production data, and actual webhook delivery history were not available in this checkout.

### Payment And Booking Flow Map

- Credit purchase flow: learner calls `api/credits.js?action=checkout`, which creates a Stripe Checkout session with `payment_type=credit_purchase`, learner id, purchased minutes/hours, amount, and `school_id` in metadata. Completion is handled by `api/webhook.js::handleCreditPurchase()`, which checks `payment_status='paid'`, inserts a `credit_transactions` row keyed by `stripe_session_id`, then increments `learner_users.credit_balance` and `balance_minutes`. `api/credits.js?action=verify` is an authenticated post-checkout safety net that retrieves the session directly from Stripe, validates paid state, learner id, and school id, then grants credits if no matching `credit_transactions` row exists.
- Learner credit booking flow: learner calls `api/slots.js?action=book`. The handler validates learner, instructor, lesson type, booking window, and balance; checks current bookings/reservations/offers; deducts minutes from `learner_users`; inserts one or more `lesson_bookings`; and refunds the deducted minutes if an insert fails. The DB-level slot uniqueness is `lesson_bookings(instructor_id, scheduled_date, start_time) WHERE status != 'refunded'`, so a concurrent insert should fail closed at the booking row.
- Authenticated paid slot checkout flow: learner calls `api/slots.js?action=checkout-slot`. It validates the target slot, creates a Stripe session with `payment_type=slot_booking`, and inserts a 10-minute row in `slot_reservations`. On webhook completion, `api/webhook.js::handleSlotBooking()` inserts `credit_transactions`, adds then deducts the purchased minutes, inserts `lesson_bookings`, supersedes pending broadcast siblings, and deletes the reservation.
- Guest paid slot checkout flow: guest calls `api/slots.js?action=checkout-slot-guest`. It rate-limits by IP and phone, validates the slot, finds or creates a learner in the supplied school, creates a Stripe session with `payment_type=slot_booking`, and inserts a `slot_reservations` hold. The same webhook `handleSlotBooking()` finalizes it.
- Free trial booking flow: guest calls `api/slots.js?action=book-free-trial`. It rate-limits by IP and phone, resolves the `trial` lesson type, checks prior trials by email and phone, checks conflicts, finds or creates a learner, and inserts a free `lesson_bookings` row directly. There is no Stripe or reservation row for the free-trial flow.
- Offer checkout flow: public token user calls `api/offers.js?action=accept-offer`. The handler fetches a pending, unexpired offer, derives `school_id` from the instructor, computes price/repeats, and either handles free offers directly or creates a Stripe session with `payment_type=lesson_offer`. On webhook completion, `api/webhook.js::handleOfferBooking()` finds or creates the learner, inserts one `credit_transactions` row for the whole paid offer, adds then deducts minutes for slot-pinned offers, calls `bookOfferSeries()` for one or more bookings, optionally issues a partial refund for unfilled repeat weeks, then marks the offer accepted.
- Flexible offer flow: flexible paid offers still go through Stripe and leave the purchased credit on the learner account without immediate booking. Flexible free offers skip Stripe, add credit directly, mark the offer accepted, and set a learner session cookie.
- Payout flow: `api/cron-payouts.js` authorizes by shared `CRON_SECRET` or admin JWT, then calls `processAllPayouts()` and `processSchoolPayouts()` from `api/_payout-helpers.js`. Instructor eligibility comes from `lesson_bookings.status='chargeable'`, no existing `payout_line_items` row, optional `instructors.payouts_start_date`, and non-test learners. Instructor transfers are created through Stripe Connect and recorded in `instructor_payouts` plus `payout_line_items`.

### Confirmed Idempotency, Race, And Authorization Issues

- Webhook idempotency is implemented at the application level but not enforced by a database uniqueness constraint on `credit_transactions.stripe_session_id`. `handleCreditPurchase()`, `handleSlotBooking()`, and `api/credits.js?action=verify` all perform "check then insert" against `credit_transactions`, and `handleOfferBooking()` checks `lesson_offers.status` before processing, but `db/migration.sql` defines `stripe_session_id TEXT` without a unique index. Concurrent webhook retry plus success-page verify, or duplicate webhook invocations that pass the pre-check together, can double-insert transactions and double-adjust learner balances.
- `api/webhook.js` catches errors inside the payment handlers and still returns `{ received: true }` to Stripe. That prevents Stripe retry from recovering failed DB/email work. `cron-reconcile-payments.js` mitigates fully missing `credit_transactions` rows by alerting, but it does not auto-replay and cannot detect every partial state such as transaction inserted, balance updated, booking insert failed, or notification failed.
- `api/credits.js?action=verify` has stronger authorization than the public legacy verifier: it requires learner auth and checks session metadata learner id and school id. However, because it shares the same non-unique `stripe_session_id` idempotency pattern as the webhook, it can race the webhook and double-grant if both see no row before either insert commits.
- `api/verify-session.js` is public and retrieves any supplied Stripe Checkout session id with line items expanded. It returns payment success, derived package name/type, amount, and a booking reference without requiring auth or checking session ownership. Stripe session ids are high entropy, but this remains an unnecessary public Stripe lookup surface for legacy success pages.
- `api/create-checkout-session.js` is still reachable from `public/lessons.js` and allows any authenticated learner or admin to submit arbitrary `line_items`, `metadata`, `custom_fields`, `success_url`, and `cancel_url` to Stripe. Because server-side pricing/product allowlisting is absent in this legacy endpoint, it should be retired or constrained before relying on it for any live money path.
- Slot reservation lifecycle is weakly enforced at the DB layer. `slot_reservations` has no unique constraint on active `(instructor_id, scheduled_date, start_time)` holds and the insert uses `ON CONFLICT DO NOTHING` without a matching conflict target. The code does pre-check active reservations, but parallel checkout requests can create multiple active holds for the same slot. The later `lesson_bookings` unique index prevents double booking, but users can still pay for a race-lost slot and fall into the paid-but-not-booked safety path.
- Authenticated `checkout-slot` omits `school_id` from Stripe session metadata, so `handleSlotBooking()` defaults `schoolId` to 1. Guest checkout includes `school_id`. In a multi-school deployment, authenticated paid slot checkout from a non-school-1 learner can write `credit_transactions` and `lesson_bookings` against school 1 even though the request derived `schoolId` from the learner JWT.
- Phase 2 tenant gaps remain confirmed in booking conflicts: authenticated and guest paid checkout conflict checks and instructor validation still mostly filter by instructor/date/time but not `school_id`. Free trial final instructor lookup is school-scoped, but the prior-trial guard and conflict checks intentionally or accidentally cross school boundaries. That behavior needs a product decision before code changes.
- Free trial duplicate prevention is not atomic. `book-free-trial` checks for an existing trial and then inserts a booking, but the schema has no uniqueness rule for one trial per email/phone/school. Two simultaneous requests with the same guest identity for different slots can both pass the prior-trial guard and create two free-trial bookings.
- Offer acceptance is not atomically claimed before checkout/session creation. Multiple `accept-offer` requests for the same pending token can create multiple Stripe sessions and overwrite `lesson_offers.stripe_session_id`; the webhook later checks offer status, so one completion should win, but losing paid sessions can become payment-without-booking/refund/manual-support cases. Free offer acceptance has the same status-update-after-booking shape and can race until the booking insert or later status update fails.
- `offers.js::findOrCreateLearner()` remains a high-risk tenant issue from Phase 2. It matches learners by email or phone globally without `school_id`, then updates the matched row and returns that learner id for an offer derived from the instructor's school. The same helper is used by free, flexible, and paid offer paths.

### Stripe Webhook And Reconciliation Observations

- Webhook dispatch correctly handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and each handler skips sessions whose `payment_status` is not `paid`. This is the right shape for Klarna/delayed payment methods.
- Webhook signature verification uses `stripe.webhooks.constructEvent()` with `STRIPE_WEBHOOK_SECRET`. Without live env access, this audit cannot confirm the production endpoint URL, signing secret, or Stripe retry/delivery history.
- The reconciliation cron is alert-only by design. It lists recent paid Checkout sessions for tracked `payment_type` values and alerts if there is no matching `credit_transactions.stripe_session_id`. It explicitly does not cover the legacy pass-guarantee/package flow and does not repair missing rows automatically.
- Reconciliation only detects sessions with no `credit_transactions` row. It will not catch duplicate rows for the same `stripe_session_id`, duplicate balance increments, slot/offer sessions where the transaction exists but booking creation failed, missing `school_id` on authenticated paid slot metadata, or partial refund/accounting drift after repeat-offer fan-out.
- Stripe fee capture exists through `fetchSessionFeePence()` in webhook handlers, and `cron-balance-snapshot.js` uses `credit_transactions` inflow and `instructor_payouts` outflow for aggregate drift alerting. Fee backfill behavior depends on code not fully reviewed in this Phase 3 pass and should be tested with Stripe test-mode sessions before being treated as operationally proven.

### Payout And Connect Observations

- Cron and manual payout paths share the same helper module, but they are not behaviorally identical. `api/admin.js?action=process-payouts` calls `processAllPayouts(sql, stripe, { schoolId })`, while `api/_payout-helpers.js::processAllPayouts()` only accepts `(sql, stripe)` and queries all active, onboarded, unpaused instructors. A school admin manual trigger can therefore process payouts for all schools, not just their own school.
- `processPayoutForInstructor()` inserts `instructor_payouts` and `payout_line_items` before making the Stripe transfer. If the Stripe transfer fails, it marks the payout failed and deletes line items so bookings retry on the next run. The unique index on `payout_line_items(booking_id)` is the primary double-pay guard for instructor payouts.
- The payout insertion and line-item insertion are not wrapped in an explicit database transaction. If the function crashes after creating an `instructor_payouts` row but before all line items are inserted or before the Stripe transfer result is recorded, a later retry's behavior depends on how much state survived. This should be tested in a DB-backed failure-injection test or made transactional.
- `processSchoolPayouts()` has a separate school payout model using `school_payouts.booking_ids` arrays rather than `payout_line_items`. It excludes only booking ids in completed school payouts. Failed transfers clear `booking_ids` for retry, but there is no equivalent unique line-item table to prevent concurrent school payout runs from selecting the same bookings.
- Instructor payout preview and daily platform balance snapshot use shared/similar helper logic, which is a positive parity sign. The code comments explicitly require preview filters to match payout filters, and `cron-balance-snapshot.js` records the preview and trailing inflow/outflow drift.
- Stripe Connect onboarding updates are driven by explicit status checks and `account.updated` webhooks. The webhook marks any instructor or school with the matching `stripe_account_id` complete when Stripe reports charges and payouts enabled. Because the DB does not visibly enforce uniqueness of `stripe_account_id`, account ownership integrity depends on application code paths not assigning the same account id to multiple rows.
- Admin and school Connect routes use `admin.school_id || 1`, so a superadmin without `school_id` defaults to school 1 for school-level Connect actions rather than requiring an explicit target school. That was noted in Phase 2 as a product/authorization ambiguity and remains relevant for payout ownership.

### Recommended Fix Branches / PR Order

1. `fix/payments-session-idempotency`: add a DB uniqueness strategy for non-null `credit_transactions.stripe_session_id`, make webhook/verify inserts conflict-safe, and add tests for webhook vs verify double-delivery. Include a migration cleanup plan if production already has duplicate session ids.
2. `fix/payments-authenticated-slot-school`: include `school_id` in authenticated `checkout-slot` Stripe metadata, school-scope slot checkout conflict/instructor/custom-rate queries, and add regression coverage for non-school-1 paid bookings.
3. `fix/payments-legacy-checkout-retire`: remove or strictly allowlist `api/create-checkout-session.js` and decide whether `api/verify-session.js` can be replaced by authenticated/specific verifiers or limited to legacy package session metadata.
4. `fix/booking-reservation-claiming`: add an atomic active-slot reservation/claim model for `slot_reservations` and offer acceptance, then test two parallel guest checkout and two parallel offer acceptance attempts.
5. `fix/booking-free-trial-uniqueness`: make the one-free-trial rule explicit by school/product, then enforce it atomically through a normalized identity table, idempotency key, or DB constraint rather than a pre-check alone.
6. `fix/offers-tenant-learner-lookup`: scope `findOrCreateLearner()` by school or implement deliberate cross-school identity linking with explicit ownership rules.
7. `fix/payout-manual-scope-parity`: make admin manual payout processing honor the requesting admin's school or require superadmin intent, and add a test proving cron all-school behavior and manual school-scoped behavior are intentional.
8. `fix/payout-transactional-safety`: wrap payout row, line items, transfer status, and retry cleanup in explicit transactional or idempotent units; add failure-injection tests for crash/Stripe-transfer failure paths.

### Defer To Later Phases

- Phase 4 GDPR/data protection: public `verify-session` exposure and offer/success pages that display learner/payment-derived metadata should be reviewed as public possession-of-link data surfaces; offer/free-trial auto-login cookies and long-lived magic links should be included in the token/PII review.
- Phase 4 GDPR/data protection: confirm learner deletion/anonymization covers `slot_reservations`, offer-linked learner data, `credit_transactions`, payout line items, and balance audit records without breaking required financial retention.
- Phase 5 operations: verify the live Stripe webhook endpoint URL, signing secret, event retry settings, and whether recent paid sessions have duplicate/missing `credit_transactions` rows.
- Phase 5 operations: verify Vercel cron Authorization headers for payout, reconciliation, and balance snapshot crons; the source code fails closed, but production env wiring was not inspectable here.
- Phase 5 operations: define manual runbooks for payment-without-booking alerts, partial refund failures, failed Stripe transfers, and Connect account ownership corrections.

## Phase 4 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is documentation-only audit evidence for Data Protection And Retention Review. No code fixes were made.

### PII And Financial Table Map

High-confidence PII or account tables from `db/migration.sql`:

- `learner_users`: learner identity and contact data: name, email, phone, pickup address, test date/time, password hash, calendar token, referral link, retention timestamps, school id, and test-account flag.
- `instructors`: instructor identity/contact/profile data: name, email, phone, bio, photo URL, vehicle/service metadata, iCal feed URL/sync status, Setmore staff key, Stripe account id, password hash, calendar token, onboarding and payout flags.
- `admin_users`: admin identity, email, password hash, role, active flag, and school id.
- `lesson_bookings`: learner/instructor schedule history, pickup/dropoff address, guest phone for free trials, Setmore key, payment method, payout/referral/Stripe-fee attribution, status and cancellation metadata.
- `lesson_offers`: public offer token, learner email/name/id, Stripe session id, booking id, slot and pricing data, broadcast metadata, expiry/accepted timestamps, and school id.
- `slot_reservations`: temporary checkout holds with learner id, instructor id, slot, Stripe session id, expiry, and school id.
- `magic_link_tokens` and `instructor_login_tokens`: email/phone/login/reset/migration tokens, short codes, role/purpose, referral code, school id, expiry, used flag.
- `driving_sessions`, `skill_ratings`, `learner_onboarding`, `quiz_results`, `mock_tests`, `mock_test_faults`, `focused_practice_sessions`, `instructor_learner_notes`, and `learner_availability`: learner progress, notes, preferences, availability, test/practice records, and supervisor/instructor observations.
- `enquiries` and `availability_submissions`: public lead/contact records with name, email, phone, message/availability data, marketing consent/status, archive timestamp, and school id.
- `cookie_consents`, `audit_log`, `deletion_requests`, `referrals`, `referral_clicks`, `sent_reminders`, `lesson_confirmations`, and `instructor_external_events`: consent proof, admin action metadata, deletion tokens/status, referral attribution, reminder/confirmation state, and imported external calendar blocks.
- `waitlist` still exists in the migration even though `CLAUDE.md` says the feature was removed. Its runtime status was not fully reviewed in Phase 4, but it remains a schema-level PII table if present in production.

Financial or accounting tables from `db/migration.sql`:

- `credit_transactions`: learner-linked balance/accounting rows with type, credits/minutes, amount, payment method, Stripe session id, Stripe fee, anonymized flag, school id, and nullable learner id.
- `instructor_payouts`, `payout_line_items`, and `school_payouts`: instructor/school payout amounts, Stripe transfer ids, booking ids, line items, franchise/shortfall/deposit/Stripe-fee fields, status, failure reason, and school id.
- `balance_audit` and `platform_balance_snapshots`: balance correction and daily platform-balance evidence. `balance_audit` stores admin id/email, learner id/name, previous/new balances, reason, and school id. `platform_balance_snapshots` stores aggregate Stripe/payout/refund exposure and preview JSON.
- `guarantee_pricing`, `site_config`, `schools`, `lesson_types`, `google_reviews`, and `google_reviews_meta` are mostly configuration/public content, but `schools` includes owner email and Stripe account fields and `site_config`/`schools.config` can contain operational settings that should not be treated as anonymous by default.

### Export, Deletion, And Anonymization Coverage

- `api/learner.js::handleExportData()` covers profile, onboarding, bookings, credit transactions, driving sessions, skill ratings, quiz results, mock tests, focused practice, referral code, and referrals made. It does not export `mock_test_faults`, `instructor_learner_notes`, `learner_availability`, `sent_reminders`, `lesson_confirmations`, `slot_reservations`, `lesson_offers`, `magic_link_tokens`, `deletion_requests`, `cookie_consents`, `audit_log` entries targeting the learner, `balance_audit`, referral click records, or payout-line/booking-linked financial attribution.
- `handleExportData()` omits fault-level mock-test detail even though `handleMockTests()` returns joined fault rows elsewhere in the same file. It also omits offer/free-trial data that can contain learner email/name/phone/pickup details before or during account creation.
- `api/learner.js::handleConfirmDeletion()` anonymizes `credit_transactions` by setting `learner_id = NULL, anonymized = true`, then deletes many learner/progress/booking tables and nullifies `cookie_consents.learner_id` and `learner_users.referred_by`. It deletes `lesson_bookings`, which can break or orphan later financial/payout evidence because `payout_line_items.booking_id`, `instructor_payouts`, `school_payouts.booking_ids`, `balance_audit`, and booking-level Stripe-fee attribution are not explicitly reconciled before booking deletion.
- `handleConfirmDeletion()` does not explicitly remove or anonymize `lesson_offers` rows where the learner is referenced by `learner_id`, `learner_email`, `learner_name`, `booking_id`, or `stripe_session_id`. It also does not cover `balance_audit`, `instructor_payouts`, `payout_line_items`, `school_payouts`, `availability_submissions`, or audit-log rows that may contain learner names/emails in JSON details.
- `api/admin.js::handleDeleteLearner()` is materially narrower than learner self-deletion and retention deletion. It only anonymizes `credit_transactions`, deletes `skill_ratings`, `driving_sessions`, and `lesson_bookings`, then deletes `learner_users`. It does not cover quiz/mock/onboarding/focused-practice/reminder/reservation/confirmation/referral/cookie/deletion-request/magic-token/learner-availability tables. Depending on live FK constraints, this may either fail or leave records behind.
- The deletion paths are not wrapped in an explicit transaction. Several deletes are best-effort `try/catch` blocks that continue after failure, so partial deletion is possible if one table errors. This is especially important because the request is marked completed only near the end.
- Financial anonymization is currently one-table only. `credit_transactions` has the intended `anonymized` flag and nullable learner id, but booking-linked payout records and balance-audit records do not have an equivalent documented anonymization strategy. A product/legal decision is needed before changing whether paid `lesson_bookings` are hard-deleted, anonymized, or retained with learner references removed.

### Retention Cron Observations

- `api/cron-retention.js` uses the shared fail-closed `verifyCronAuth()` helper and allows only `GET`, matching the Vercel cron shape better than the Phase 3 `offers?action=expire-offers` method mismatch.
- The cron refreshes `learner_users.last_activity_at` from learner row creation, `lesson_bookings.created_at`, and `driving_sessions.created_at` only. It does not consider login/session activity from password auth, profile updates, credit purchases without bookings, offers, quiz/mock/practice activity, learner availability updates, referral activity, or admin-managed account changes. Some active learners could be archived if they have no recent booking/session rows.
- Hard deletion in the retention cron mirrors the learner self-deletion cascade more closely than admin deletion, but it still does not cover `lesson_offers`, `balance_audit`, payout tables, `availability_submissions`, `audit_log`, `referral_clicks`, or direct cleanup of old pending/expired `magic_link_tokens` except by matching the deleted learner's email.
- The cron purges anonymized `credit_transactions` after 7 years, cleans completed deletion requests after 90 days, deletes cookie consent rows after 2 years, deletes stale `rate_limits` after 2 hours, and archives/deletes `enquiries` after the documented 2-year plus 30-day model.
- There is no general retention policy in code for `lesson_offers`, `slot_reservations` after expiry except lazy cleanup in booking flows, `sent_reminders`, `audit_log`, `referral_clicks`, `instructor_external_events`, `instructor_login_tokens`, expired/used `magic_link_tokens`, `balance_audit`, or `platform_balance_snapshots`.
- The audit could not verify production Vercel cron headers, recent run history, or live row counts without secrets/live environment access.

### Public Token, Link, Cookie, And Session Observations

- `api/verify-session.js` is a public possession-of-`session_id` endpoint. It retrieves a Stripe Checkout session and returns package type/name, amount, and a booking reference without authenticating the requester or checking that the session belongs to the current user. It does not expose full card data, but it is still payment-derived metadata.
- `api/offers.js?action=get-offer` is public possession-of-token access. For pending offers it returns learner email, learner name, learner phone, pickup address, slot, price, instructor, and repeat limit when present. For accepted offers it returns learner email and slot details for the success page. This is expected for an offer-link flow, but the token is the only access control.
- Offer acceptance and free flexible offers can auto-login the learner by setting a learner session cookie. The JWT is signed with `expiresIn: '180d'`, matching `SESSION_MAX_AGE_SEC.learner = 180 days` in `_auth.js`. This is materially longer than admin's 7 days and should be an explicit product/security decision, especially for public token acceptance flows.
- `api/slots.js?action=book-free-trial` creates a 7-day `magic_link_tokens` row and emails `/learner/login.html?token=...` after public booking. This is documented in `PROJECT.md`. The code says no session cookie is set, but the long link can be used by whoever has the email link until expiry.
- Admin invite learner flow in `api/admin.js::handleInviteLearner()` also creates a 7-day magic-link token. `api/setmore-welcome.js` is documented as sending 7-day magic links too, but Phase 4 did not fully review that file.
- Learner and instructor calendar feeds use persistent `calendar_token` values in `learner_users` and `instructors`. `api/calendar.js` creates a token on demand and serves feed data to any holder of the token. There is no expiry, rotation, explicit revocation endpoint, or learner/instructor UI evidence of revocation in the reviewed code.
- Learner feed tokens are looked up without school id in `handleFeed()` (`SELECT id, name FROM learner_users WHERE calendar_token = ...`), while instructor feed rows include school id after lookup. Tokens are unique, so this is not an immediate cross-school data leak, but revocation/lifetime and school-scoped lookup should be reviewed together.

### Cookie Consent And PostHog Observations

- `public/cookie-consent.js` records consent in `localStorage` under `cc_cookie_consent`, writes a visitor id, reads learner id from the display-only `cc_learner` localStorage blob, and POSTs to `/api/config?action=record-consent`. `api/config.js` stores visitor id, learner id, analytics boolean, hashed IP prefix, user agent, and school id in `cookie_consents`.
- `public/posthog-loader.js` only initializes PostHog when `window.ccCookieConsent.analyticsAllowed()` is true, listens for `cookie-consent-updated`, and clears `ph_` localStorage keys on opt-out. PostHog custom event calls in page scripts are guarded by `window.posthog` or `typeof posthog !== 'undefined'`, so they are no-ops before consent-based loading.
- The HTML inventory found three pages missing both `cookie-consent.js` and `posthog-loader.js`: `public/admin/franchise-comparison.html`, `public/learner/learn.html`, and `public/learner/lessons-hub.html`. These may be stale/low-traffic pages, but they violate the current `CLAUDE.md` rule for new pages.
- The inventory did not find inline PostHog snippets in HTML. PostHog is centralized through `posthog-loader.js`; `posthog-tracking.js` loads only after PostHog is initialized.
- `public/privacy.html` lists Stripe, Twilio, Resend, IONOS SMTP, Neon, PostHog, Vercel, Anthropic, postcodes.io, OpenRouteService, and social platforms. Runtime code also references Cloudflare Stream (`api/videos.js`), Setmore (`api/setmore-sync.js`/`setmore-welcome.js`), Google Reviews/Places, and optional Slack/N8N-style operational webhooks in env/docs. Those service disclosures should be reconciled in a privacy-policy docs PR.

### Admin Audit Logging Observations

- `api/_audit.js::logAudit()` inserts admin id/email, action, target type/id, JSON details, IP address, school id, and timestamp. Failures are swallowed after logging to server logs, so audit logging is best-effort rather than fail-closed.
- `api/admin.js` audit-logs `edit-booking`, `mark-complete`, `create-instructor`, `update-instructor`, `toggle-instructor`, `update-learner`, `adjust-credits`, `delete-learner`, `update-referral-config`, and `admin.password_reset`. `api/instructors.js` audit-logs `admin.instructor_password_set`.
- Mutating admin paths reviewed that appear not audit-logged include `create-admin`, `toggle-payout-pause`, `process-payouts`, `set-instructor-blackouts`, `invite-learner`, and some admin/superadmin mutations outside `api/admin.js` such as `api/config.js` config saves, `api/schools.js` school/admin changes, `api/lesson-types.js`, `api/videos.js`, `api/availability.js`, `api/enquiries.js`, and selected `api/connect.js` actions. Some may be low-risk or operational rather than learner-data mutations, but the coverage is not consistent with the `CLAUDE.md` rule.
- The privacy page says administrative data access is audit-logged. The current implementation mostly logs administrative data mutations, not reads such as `all-learners`, `learner-detail`, payout overview, or booking lists. If access logging is a compliance requirement, this needs a separate decision because read logging can become high volume.

### Recommended Fix Branches / PR Order

1. `fix/gdpr-delete-shared-cascade`: extract one shared learner deletion/anonymization routine used by learner self-deletion, retention cron, and admin deletion; add a dry-run/report mode and tests for all current learner-linked tables.
2. `fix/gdpr-financial-anonymization-policy`: decide and implement the financial retention model for paid bookings, payout line items, school payout booking arrays, balance audit, and Stripe/session references; keep tax/accounting evidence while removing direct learner identifiers where legally appropriate.
3. `fix/gdpr-export-schema-coverage`: update `handleExportData()` to include every learner-linked PII category in the current schema, including mock-test faults, instructor notes, availability, offers, cookie/deletion/audit metadata where appropriate, and documented exclusions.
4. `fix/gdpr-retention-coverage`: expand `cron-retention.js` last-activity signals and retention cleanup for expired/used tokens, offers, reservations, reminders, referral clicks, audit logs, external events, snapshots, and other tables with defined lifetimes.
5. `fix/gdpr-token-lifecycle`: add calendar feed token rotation/revocation, review 180-day learner cookies for public offer/free flows, and shorten or split invite/free-trial magic-link lifetimes if product agrees.
6. `fix/gdpr-public-link-surfaces`: limit public possession-of-link responses for `verify-session`, `get-offer`, `offer-success`, and free-trial/success surfaces to the minimum needed, with tests that prevent accidental extra PII exposure.
7. `fix/gdpr-cookie-page-coverage`: add the consent/PostHog loader pair to the three missing HTML pages or retire those pages, then add a static test that fails when an HTML page omits the loaders.
8. `fix/gdpr-audit-logging-coverage`: create an admin mutation audit matrix and add `logAudit()` to agreed mutation paths across admin, schools, config, lesson types, videos, availability, enquiries, connect, and payout/manual operations.
9. `docs/privacy-service-inventory`: reconcile `public/privacy.html`, `docs/gdpr.md`, and `PROJECT.md` with current processors/integrations and mark which data rights are automated versus manual.

### Defer To Later Phases

- Phase 5 operations: verify live cron headers, retention cron run history, row counts/backlog for archived learners/enquiries/tokens/offers/reservations, and whether production has orphaned payout/booking/credit rows.
- Phase 5 operations: define manual runbooks for DSAR exports involving dashcam footage, Stripe records, Setmore data, Cloudflare videos, PostHog person/session data, and any processor-side deletion requests.
- Phase 5 operations: verify third-party data-processing agreements/regions for Stripe, Twilio, Resend/IONOS, Neon, Vercel, Anthropic, PostHog, Cloudflare, Setmore, postcodes.io, OpenRouteService, Google, Slack/N8N if used.
- Phase 6 frontend/PWA: review whether service-worker caching could retain auth-sensitive pages or exported data in browser cache, and verify all learner privacy/data UI still matches the backend after any GDPR fixes.
- Phase 6 frontend/PWA: decide whether stale pages missing consent loaders should be retired from navigation/build output rather than updated.

## Phase 5 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is documentation-only audit evidence for Operations, External Integrations, and Observability. No code fixes were made.

### Cron Inventory And Auth Model

`vercel.json` currently defines 12 scheduled paths:

| Path | Schedule | Current code auth | Main side effect |
|---|---:|---|---|
| `/api/reminders?action=send-due` | hourly at minute 0 | shared `verifyCronAuth()` | Sends learner email/WhatsApp reminders and records `sent_reminders`. |
| `/api/reminders?action=daily-schedule` | daily 19:00 UTC | shared `verifyCronAuth()` | Sends next-day schedule emails to instructors. |
| `/api/ical-sync` | every 15 minutes | local `verifyCronAuth()` | Syncs one instructor iCal feed into `instructor_external_events`. |
| `/api/offers?action=expire-offers` | hourly at minute 30 | shared `verifyCronAuth()`, but handler requires POST | Expires stale pending `lesson_offers`. |
| `/api/cron-payouts` | Friday 09:00 UTC | shared `verifyCronAuth()` or admin JWT | Creates instructor/school payout rows and Stripe transfers. |
| `/api/setmore-sync` | every 15 minutes | shared `verifyCronAuth()` | Imports Setmore appointments into `lesson_bookings`; marks removed/cancelled Setmore bookings `refunded`. |
| `/api/setmore-welcome` | daily 10:00 UTC | shared `verifyCronAuth()` | Sends one-time welcome/magic-link emails to Setmore-created learners. |
| `/api/cron-retention` | Sunday 03:00 UTC | shared `verifyCronAuth()` | Archives/deletes learner, enquiry, consent, deletion-request, and anonymized transaction records. |
| `/api/cron-auto-complete` | hourly at minute 15 | shared `verifyCronAuth()` | Flips past `scheduled` bookings to `chargeable`. |
| `/api/cron-reconcile-payments` | hourly at minute 30 | shared `verifyCronAuth()` | Lists paid Stripe Checkout sessions and alerts when tracked sessions lack `credit_transactions`. |
| `/api/cron-referral-rewards` | daily 04:00 UTC | shared `verifyCronAuth()` | Credits referrers for eligible chargeable referred lessons. |
| `/api/cron-balance-snapshot` | daily 08:00 UTC | shared `verifyCronAuth()` | Captures platform balance snapshots and alerts on trailing outflow/inflow drift. |

Shared cron auth in `api/_auth.js` fails closed when `CRON_SECRET` is absent, accepts `Authorization: Bearer <secret>`, `?key=`, or `?secret=`, and uses `crypto.timingSafeEqual()`. The helper explicitly rejects the spoofable `x-vercel-cron` header as an auth source.

`api/ical-sync.js` is still the auth outlier. It defines a local helper that returns true when `CRON_SECRET` is missing and compares the provided value with plain equality. This confirms the Phase 1/2 deferral: iCal sync can fail open in an environment where `CRON_SECRET` is not configured, unlike every reviewed shared-helper cron.

`api/offers.js?action=expire-offers` remains configured as a Vercel cron path, but `handleExpireOffers()` requires `POST`. Vercel cron invokes configured paths with GET, so pending offer expiry appears unable to run as configured. The handler itself uses the shared cron auth once method passes.

The audit cannot verify from repository contents whether production Vercel is actually attaching the `Authorization: Bearer <CRON_SECRET>` header to cron runs, whether any manual invocations rely on query-string secrets, or whether recent cron runs are succeeding. `docs/operations/credential-rotation.md` states that Vercel cron "automatically uses `CRON_SECRET` from env vars", but that is an operational claim that needs dashboard/log confirmation.

### Idempotency And Overlap Observations

- Reminder sends have a durable per-booking guard: `sent_reminders` has `UNIQUE(booking_id, reminder_type)`, and `api/reminders.js` inserts with `ON CONFLICT DO NOTHING` after sending. If two cron invocations overlap, both can pass the pre-send `NOT EXISTS` query before either inserts, so duplicate messages are still possible in the race window. The row prevents future repeats, not necessarily simultaneous duplicates.
- Daily instructor schedule emails have no durable idempotency key. A repeated or overlapping `/api/reminders?action=daily-schedule` run can resend the same day's schedule.
- `api/cron-auto-complete.js` is naturally idempotent because it updates only rows where `status = scheduled`; repeated runs flip zero additional rows.
- `api/cron-referral-rewards.js` has a strong per-booking guard. It stamps `lesson_bookings.referral_rewarded_at` with `UPDATE ... WHERE referral_rewarded_at IS NULL RETURNING id` before crediting the referrer, so overlapping runs should only award once.
- `api/setmore-sync.js` imports are idempotent through the unique `lesson_bookings.setmore_key` index and existing-row checks. It also has a guard that skips "removed from Setmore" cancellation detection when Setmore returns zero active appointments, reducing mass-cancel risk during transient API failures.
- `api/ical-sync.js` upserts on `(instructor_id, uid_hash)` and deletes stale future events for the selected instructor. It processes one oldest/eligible instructor per invocation. There is no explicit lease/lock, so overlapping invocations can choose the same instructor before `ical_last_synced_at` is updated. Upserts reduce duplicate rows, but overlapping delete/upsert cycles could still cause noisy logs or transient stale-event behavior.
- `api/setmore-sync.js` also has no explicit lease/lock around the "oldest synced instructor" selection. Duplicate imports are constrained by `setmore_key`, but two overlapping runs can still duplicate external API calls and race cancellation/backfill work.
- `api/cron-payouts.js` delegates to `_payout-helpers.js`. Instructor payout double-payment is guarded by `payout_line_items.booking_id` uniqueness; on Stripe transfer failure the code marks the payout failed and deletes the line items so bookings can retry. School payouts store paid booking ids in `school_payouts.booking_ids` and filter only completed school payouts; there is no equivalent per-booking unique table for school payouts in the reviewed schema, so overlap safety for school-level transfers is weaker than instructor payouts.
- Stripe webhook handlers check `credit_transactions.stripe_session_id` before processing tracked Checkout sessions. That is useful idempotency evidence, but the reviewed code performs multi-step DB mutation without an explicit transaction. A crash after creating `credit_transactions` but before booking creation or notifications can make later webhook retries return early. `notifyBookingInsertFailed()` improves the known booking-insert failure path, but it does not cover every possible mid-flow failure.
- `api/cron-reconcile-payments.js` is alert-only and looks for paid tracked Checkout sessions missing from `credit_transactions`. Because it treats the transaction row as the completion marker, it will not catch "payment has a transaction row but no booking" or "transaction row exists but confirmation notifications failed" cases.
- `api/cron-balance-snapshot.js` writes a new snapshot each run; this is append-only by design. Repeated runs produce extra evidence rows rather than duplicate customer-visible side effects.
- `api/cron-retention.js` generally applies idempotent archive/delete queries. The per-learner hard-delete cascade catches and swallows individual table deletion failures, increments `hard_deleted` only after deleting the learner row, and does not alert on partial per-table skips unless the whole cron fails.

### Alerting And Error-Reporting Observations

- Shared `api/_error-alert.js` sends sanitized 500/error emails to `ERROR_ALERT_EMAIL` through SMTP and exposes `sendAlertEmail()` for non-500 operational alarms. Alert delivery is fire-and-forget and silently swallowed on failure, so SMTP/`ERROR_ALERT_EMAIL` misconfiguration can blind the alert channel.
- Hard cron failures in `cron-retention`, `cron-payouts`, `cron-reconcile-payments`, `cron-balance-snapshot`, `cron-auto-complete`, `cron-referral-rewards`, `setmore-sync`, `setmore-welcome`, `ical-sync`, and reminder outer catches call `reportError()`.
- `cron-payouts` has additional operational alerts for failed instructor payouts, failed school payouts, summary-email failures, and school payout exceptions. `_payout-helpers.js` sends a specific "widget said green but Stripe transfer failed" alert when a recent green platform-balance snapshot exists.
- `cron-balance-snapshot` sends a Trigger B alert when trailing 30-day payout outflow exceeds Stripe inflow by more than GBP 100.
- `cron-reconcile-payments` sends an action-required email for paid tracked Stripe Checkout sessions with no matching `credit_transactions` row. The email tells the operator to resend the Stripe event manually from the dashboard.
- iCal and Setmore sync failures that are expected integration failures, such as HTTP errors, parse failures, token errors, and fetch timeouts, are written into instructor sync-error columns and returned as `{ ok: false }`; they do not call `reportError()` unless the function itself throws. That gives UI/status visibility, but production alerting depends on someone checking those fields or cron logs.
- WhatsApp/SMS delivery failures in `api/_whatsapp.js` are caught and logged with `console.warn()` only. This matches the free-trial handover deferral: Twilio delivery issues can remain invisible outside Vercel logs/Twilio console.
- Many email sends in notification fan-out paths are best-effort. Some are awaited and can trip outer catches; others intentionally catch and log locally (`reminders`, `_notify-availability`, `setmore-welcome`, `cron-payouts` instructor emails, multiple booking notification paths). There is no central delivery ledger for email/SMS/WhatsApp attempts or failures.
- `api/setmore-welcome.js` marks `welcome_email_sent_at` even when the email send fails, explicitly to avoid retry bombing. That protects users from repeated attempts, but it also means delivery failure requires log review to discover and cannot be retried from code without manual DB intervention.
- `api/enquiries.js` returns success even when database save, N8N forwarding, Resend, or SMTP staff notification fails individually. This is operationally friendly for public form UX, but staff lead loss is not currently elevated through `reportError()` unless the enclosing handler throws.
- Stripe webhook handler failures inside `handleCreditPurchase`, `handleSlotBooking`, and `handleOfferBooking` are caught and logged but not consistently passed to `reportError()`. Since the top-level webhook returns 200 after awaited handlers complete, these caught failures can prevent Stripe retries and depend on reconciliation/manual log review. The known booking-insert-failed path now alerts and emails the learner, but other caught mid-flow failures still need a runbook and/or alerting.

### External Integration Failure Modes

- Stripe: Webhook signature verification is strict and alerts on signature failure. Tracked Checkout sessions are gated on `payment_status = paid`, and async payment failure events call `reportError()`. Reconciliation checks only tracked `credit_purchase`, `slot_booking`, and `lesson_offer` sessions from the last 25 hours and only checks for missing `credit_transactions`. It does not auto-replay and does not inspect legacy pass-guarantee/package flows.
- Stripe payouts: Instructor payouts have stronger retry semantics than school payouts because failed instructor transfers delete `payout_line_items`, while failed school transfers clear `school_payouts.booking_ids`. Live Stripe transfer state, failed transfer dashboards, and connected-account disablement histories cannot be verified locally.
- Stripe fee capture: `api/_stripe-fee.js` returns `NULL` on fee-fetch failure and comments that a future reconciliation cron will backfill later. `api/cron-balance-snapshot.js` and payout math tolerate null/zero fees, but Phase 5 did not find a shipped fee-backfill cron in the scheduled inventory.
- Setmore: OAuth refresh token absence/failure and appointment fetch failures are captured in `instructors.setmore_sync_error`. The sync imports via `setmore_key`, maps staff by `setmore_staff_key`, and guards against zero-appointment mass cancellation. Learner matching by Setmore customer key, phone, then email is not school-scoped in the reviewed helper; this was not reclassified as an operations fix here, but it is relevant to multi-school rollout risk.
- iCal: Feed fetch, timeout, over-large response, invalid calendar, and parse failures write `ical_sync_error`. The sync uses a 90-day window, upserts by `(instructor_id, uid_hash)`, and deletes stale events. There is no alert on repeated feed failures beyond status fields/logs.
- Email: SMTP is the common path for error alerts and many transactional emails. Resend appears as a public enquiry fallback/primary depending on `RESEND_API_KEY`. The repo has no delivery-status webhook ingestion or bounce handling.
- SMS/WhatsApp: Twilio failures are swallowed after logging. There is no message SID persistence, status callback, bounce/failure dashboard inside the app, or alert when WhatsApp is unconfigured.
- N8N/Google Sheets-style lead forwarding: `api/enquiries.js` posts to `N8N_WEBHOOK_URL` when configured and logs failures only. The rotation playbook treats `N8N_WEBHOOK_URL` as not a secret, but privacy/processor inventory should still confirm whether it receives PII.
- Google/OpenRouteService/postcodes-style travel/address integrations, Cloudflare Stream, Anthropic, PostHog, and Google Places/Reviews are present in docs/env/code, but this phase focused on cron/ops files. Their live quotas, provider dashboards, DPA/region settings, and failure history cannot be verified without provider access.

### Live-Environment Items Not Verifiable Locally

- Vercel cron run history, current `Authorization` headers, recent 401/405/500 rates, and whether `/api/offers?action=expire-offers` is currently failing with 405 in production.
- Production values and rotation dates for `CRON_SECRET`, `MIGRATION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `ADMIN_SECRET`, `POSTGRES_URL`, SMTP, Resend, Twilio, Setmore, Cloudflare, Google, Anthropic, OpenRouteService, PostHog, and optional N8N/Slack-style webhooks.
- Live row counts/backlogs for archived learners/enquiries, expired/used tokens, old `slot_reservations`, stale pending `lesson_offers`, unsent/duplicate `sent_reminders`, `ical_sync_error`/`setmore_sync_error` rows, pending deletion requests, null Stripe fee rows, failed/processing payouts, and orphan payment-without-booking records.
- Stripe Dashboard evidence for webhook delivery failures, failed async payments, failed transfers, partial refund failures, connected-account disablement, and payout arrival.
- Twilio console delivery evidence for WhatsApp/SMS failures and whether `TWILIO_WHATSAPP_FROM` is a valid WhatsApp Business sender.
- Email provider delivery/bounce evidence for SMTP and Resend.
- Processor-side DSAR/deletion procedures and DPA/region settings for Stripe, Twilio, Resend/IONOS, Neon, Vercel, Anthropic, PostHog, Cloudflare, Setmore, postcodes.io/getAddress, OpenRouteService, Google, and N8N/Slack if used.

### Recommended Fix Branches / PR Order

1. `fix/ops-cron-auth-and-methods`: move `api/ical-sync.js` to shared `verifyCronAuth()` and make offer expiry compatible with Vercel cron GET, with a small manual verification plan for Vercel cron headers.
2. `fix/ops-cron-overlap-guards`: add lightweight DB leases or durable idempotency markers for high-impact crons where overlap can duplicate external side effects, starting with daily schedule emails, reminders send-before-insert, iCal/Setmore instructor selection, and school payouts.
3. `fix/ops-payment-reconciliation-runbook`: document and/or implement checks for payment-without-booking, transaction-without-notification, failed partial refunds, failed transfers, duplicate/missing transactions, and Stripe event replay. Include SQL queries for `credit_transactions` without matching bookings and failed/processing payout rows.
4. `fix/ops-webhook-alerting`: ensure caught webhook handler failures that could happen after Stripe has paid call `reportError()` or write an operational incident row before returning 200.
5. `fix/ops-delivery-observability`: add a delivery-attempt ledger or at least structured alerting for WhatsApp/SMS/email failure paths, including Twilio message SIDs/status callbacks where practical.
6. `fix/ops-sync-health-dashboard`: expose iCal/Setmore repeated-failure status and age of last successful sync in admin/instructor views, with an alert threshold for stale syncs.
7. `docs/ops-runbooks`: add runbooks for cron failure triage, Stripe webhook replay, Stripe partial-refund failures, payout transfer failures, Setmore/iCal recovery, failed welcome/reminder delivery, and DSAR/deletion requests that require processor-side actions.
8. `docs/processor-inventory`: reconcile privacy docs, credential rotation docs, and actual env/code references into a third-party processor inventory with owner, data categories, region/DPA notes, rotation cadence, and deletion/export handling.
9. `chore/ops-row-count-checks`: create read-only SQL scripts or admin-only diagnostic endpoints for retention/backlog counts that can be run against staging/prod with explicit approval.

### Defer To Phase 6 Frontend/PWA

- Service-worker and browser-cache behavior for auth-sensitive pages, data exports, learner privacy screens, offer success pages, and stale offline content.
- Frontend surfacing of delivery failures, sync health, Connect/account re-blocked states, and admin operational queues after the backend runbooks/diagnostics are defined.
- Stale HTML pages missing cookie consent/PostHog loaders, already identified in Phase 4, unless the ops decision is to retire them rather than update them.
- User-facing copy and UX for partial operational failures, such as "payment received but booking on hold", Setmore-imported learner welcome failures, and delayed WhatsApp/email delivery.

## Phase 6 Findings

Collected on 18 May 2026 on branch `audit/coachcarter-website-repo-health`. This section is documentation-only audit evidence for the Frontend/PWA Maintainability Pass. No code fixes were made.

### Frontend/PWA Route And Page Inventory

The current static frontend inventory contains 56 HTML pages under `public/`:

- Public/root: `404.html`, `accept-offer.html`, `admin.html`, `availability.html`, `classroom.html`, `free-trial.html`, `free-trial-success.html`, `index.html`, `learner-journey.html`, `lessons.html`, `login.html`, `maintenance.html`, `offer-success.html`, `offline.html`, `privacy.html`, `success.html`, `terms.html`.
- Learner: `advisor.html`, `ask-examiner.html`, `book.html`, `buy-credits.html`, `confirm-deletion.html`, `examiner-quiz.html`, `focused-practice.html`, `index.html`, `learn.html`, `lessons.html`, `lessons-hub.html`, `log-session.html`, `login.html`, `mock-test.html`, `my-data.html`, `onboarding.html`, `practice.html`, `profile.html`, `progress.html`, `refer.html`, `videos.html`.
- Instructor: `availability.html`, `dashboard.html`, `earnings.html`, `index.html`, `learners.html`, `login.html`, `onboarding.html`, `profile.html`.
- Admin: `dashboard.html`, `editor.html`, `franchise-calculator.html`, `franchise-comparison.html`, `login.html`, `portal.html`.
- Superadmin: `index.html`, `school-detail.html`, `schools.html`.
- Demo: `demo/book.html`.

The paired JS inventory is broad and mostly one-script-per-page, with shared foundations in `public/sidebar.js`, `public/pwa.js`, `public/sw.js`, `public/cookie-consent.js`, `public/posthog-loader.js`, `public/auth-gate.js`, and `public/shared/{learner-auth,instructor-auth,admin-auth,branding,dark-mode,maintenance-check}.js`.

`vercel.json` rewrites all non-API paths to `public/`, maps `/book/:slug` to `/learner/book.html`, and redirects `/classroom(.html)` to `/`. That means stale pages can still be reachable directly unless deleted, redirected, or deliberately documented.

### Shared Auth And Session Handling Observations

- `middleware.js` has a server-side stale-session guard only for learner pages. It redirects most `/learner/*` requests without a `cc_learner` cookie to `/learner/login.html?expired=1&redirect=...`, while deliberately excluding `login`, `book`, `ask-examiner`, `examiner-quiz`, `confirm-deletion`, and static assets.
- There is no equivalent middleware gate for `/instructor/*`, `/admin/*`, or `/superadmin/*`. Those pages render based on localStorage display blobs and then depend on API failures or page JS to redirect. APIs still enforce real cookies, but a browser with stale localStorage and no cookie can see shell UI before the first protected fetch fails.
- `public/shared/learner-auth.js` is the strongest stale-session UX. Its `fetchAuthed()` clears `cc_learner` localStorage and shows a session-expired prompt on 401 responses.
- `public/shared/instructor-auth.js` and `public/shared/admin-auth.js` attach credentials and CSRF headers but do not have the learner module's shared 401 handling. Instructor/admin pages generally show generic load failures, toasts, alerts, or page-specific logout behavior rather than a consistent "session expired" recovery path.
- `public/auth-gate.js` is now partly stale copy. It says "No password needed - we'll send you a magic link", while `CLAUDE.md` says magic-link login was retired and all three roles now use email/password sign-in. Several learner pages still load this modal for spectator-mode gating.
- `public/admin/portal.js` mostly centralizes admin fetches through `window.ccAdminAuth.fetchAuthed`, but at least two protected POST paths still use raw `fetch()` (`/api/instructors?action=create|update` and `/api/videos?action=create|update`). Because raw fetch omits `credentials: include` and `X-CSRF-Token`, those actions can fail unexpectedly under the current httpOnly-cookie/CSRF model unless another legacy authorization path happens to accept them.
- Superadmin pages perform a localStorage role check before loading, then call protected `/api/schools` endpoints through `ccAdminAuth.fetchAuthed`. This is fine for display gating, but role truth is still only verified once the backend responds; stale localStorage can produce confusing "Error loading..." states rather than a clear re-login prompt.

### Service Worker And Cache Observations

- `public/pwa.js` registers `/sw.js` on most app pages that include it and checks for service-worker updates hourly. Update activation is user-controlled via a banner that posts `SKIP_WAITING`; the page reloads after `controllerchange`.
- `public/sw.js` uses cache name `cc-v4` and precaches `['/', '/learner/', '/sidebar.js', '/competency-config.js', '/Logo.png', '/logo-dark.png', '/icons/icon-192.png', '/offline.html']`.
- API calls, Stripe, and PostHog are intentionally skipped by the service worker, which is good for authenticated JSON, payments, and analytics transport.
- HTML requests are network-first, but every successful HTML response is cached and later used as an offline fallback for that exact request. This can store authenticated shell pages such as `/learner/my-data.html`, `/learner/profile.html`, `/learner/lessons.html`, `/instructor/*`, `/admin/*`, and `/superadmin/*` after a signed-in user visits them. The cached HTML appears to be mostly shell markup rather than API data, but it can still expose page structure, stale user-facing copy, and any static inline content on shared devices.
- `SHELL_ASSETS` precaches `/learner/`, which is the learner dashboard shell. A logged-out browser offline can receive the cached dashboard shell, although API data is not available offline. This needs a product decision: either accept app-shell offline behavior, or exclude auth-sensitive shells from service-worker caching and reserve offline fallback for public pages.
- Static assets use cache-first with background revalidation. `vercel.json` gives JS/CSS `max-age=3600, must-revalidate`, but the service worker can still return stale cached JS immediately until background revalidation completes. High-risk shared files (`sidebar.js`, auth modules, `pwa.js`, `cookie-consent.js`, `posthog-loader.js`) therefore need either versioned filenames, deliberate `CACHE_NAME` bumps, or a tighter SW update policy after security/auth changes.
- The service worker does not set custom cache exclusions for GDPR export pages, success pages, offer pages, admin/superadmin pages, or role-specific portal pages. No live browser cache inspection was performed in this phase.

### CSP And Inline Script/Style Observations

- `middleware.js` enforces a CSP with `script-src` that does not include `'unsafe-inline'`. This matches `CLAUDE.md`'s rule that inline scripts should not be added.
- Confirmed inline script blocks remain in:
  - `public/admin/franchise-calculator.html`
  - `public/admin/franchise-comparison.html`
  - `public/learner/focused-practice.html`
  - `public/learner/index.html` (two blocks)
  - `public/learner/learn.html`
  - `public/learner/lessons-hub.html`
  - `public/learner/log-session.html`
  - `public/learner/mock-test.html`
- The two learner redirect shims (`learn.html`, `lessons-hub.html`) are especially direct CSP failures because they rely on inline `window.location.replace(...)`. Under production CSP, those redirects can be blocked and leave users on a blank/stale shim page.
- Inline styles are present across most HTML pages. Current CSP explicitly allows `style-src 'unsafe-inline'`, and `middleware.js` comments note this as a future cleanup area. Removing inline-style allowance would be a larger CSS extraction project.
- Runtime JS also injects `<style>` tags in `pwa.js`, `sidebar.js`, `cookie-consent.js`, and `auth-gate.js`. This depends on the current inline-style allowance and should be tracked if the CSP is tightened.

### Consent And PostHog Loader Coverage

- Repository scan found 56 HTML pages. All but three include both `cookie-consent.js` and `posthog-loader.js`.
- Missing both consent and PostHog loaders:
  - `public/admin/franchise-comparison.html`
  - `public/learner/learn.html`
  - `public/learner/lessons-hub.html`
- The two learner pages are redirect shims and may be better retired/redirected at `vercel.json` level than updated as normal content pages.
- `public/admin/franchise-comparison.html` also lacks `pwa.js` and has an inline script. It looks like a standalone/legacy planning tool rather than part of the current admin app shell, but it is still reachable as static HTML.
- Consent is localStorage-based and recorded to `/api/config?action=record-consent`. PostHog only loads through `posthog-loader.js` after analytics consent. No live browser verification of PostHog network requests was performed in this phase.

### Stale Or Legacy UI Surfaces

- `PROJECT.md` is visibly stale in several frontend areas: it still describes magic-link learner/instructor login, older calendar-style learner booking, waitlist/future roadmap items, and "all pages include the PostHog snippet" language. `CLAUDE.md` is more current and should be treated as the stronger rule source.
- `docs/navigation.md` says learner Learn links to videos and describes accordion behavior, while current `sidebar.js` links Learn to Examiner AI/Quiz and keeps groups flattened. The difference may be intentional, but the docs can mislead future nav edits.
- `public/learner/learn.html` and `public/learner/lessons-hub.html` are inline-script redirect shims. They are stale and CSP-fragile.
- `public/classroom.html` exists but `vercel.json` redirects `/classroom(.html)` to `/`; it remains in the static tree and still has JS/assets. This is likely intentional retirement, but it should be documented or deleted in a cleanup PR.
- `public/admin/franchise-calculator.html` and `public/admin/franchise-comparison.html` look like standalone legacy/planning tools outside the main admin portal. The comparison page is missing consent loaders and contains inline JS; both should be classified as keep-with-maintenance or retire.
- `public/success.html` supports older `verify-session`/Pass Programme-style success copy, while current booking/offer flows also use `offer-success.html`, `free-trial-success.html`, and learner booking modals. The success-page family should be mapped to active Stripe products before copy fixes are made.

### Operational Failure UX Gaps

- Payment confirmation UX is present but uneven. `public/success.js` tells users that if payment completed, the team has their details and asks them to contact `hello@coachcarter.com`; `public/offer-success.js` renders "Payment received!" for offer/flexible flows and then gates follow-up booking, but booking failure after payment generally becomes "Failed to book. Please try again." or "Connection failed. Please try again." It does not clearly explain "payment received, booking on hold, staff will follow up" for every partial-failure path.
- Instructor Connect health is comparatively strong on `public/instructor/earnings.js`: it distinguishes no account, onboarding incomplete, Stripe re-verification/action-required, admin pause, and healthy payouts, including currently-due requirement counts when the API supplies them.
- Admin Connect health in `public/admin/portal.js` is weaker by design. The instructor-row badge is DB-only and comments that live Stripe state is not fetched to avoid N+1 requests. It can show "Payments: active" from stored state even if Stripe later re-blocks payouts until the instructor earnings page refreshes status.
- Admin payout UX has useful surfaces: platform-balance preview, next payout would succeed/fail, excluded instructors, failed recent payout rows, manual payout results with processed/skipped/failed counts, and pause/resume controls. It still does not expose a dedicated operational queue for orphan payment-without-booking, transaction-without-notification, failed delivery attempts, null Stripe fees, or repeated webhook/reconciliation alerts.
- iCal sync health is visible to instructors on `public/instructor/profile.js` through `ical_sync_error`, `ical_last_synced_at`, and pending copy. Admin-side repeated sync failure visibility was not found in the reviewed frontend; Setmore sync health also appears to remain backend/log/status-field driven rather than a dashboard queue.
- Instructor running-late and broadcast flows show local success/failure to the instructor, but Phase 5's delivery-observability gap remains: Twilio/email delivery failures are not surfaced back into a message delivery ledger or admin queue.
- Learner-facing copy for delayed WhatsApp/email reminders, Setmore-imported welcome-email failure, and partial Stripe/webhook failures is not centralized. Most pages show generic retry/contact copy.

### Live/Browser Items Not Verifiable Locally

- Whether production CSP is exactly the middleware CSP on every deployed path, and whether the confirmed inline scripts are currently blocked in live browsers.
- Actual service-worker cache contents after signed-in learner, instructor, admin, and superadmin browsing, including whether cached HTML exposes any sensitive static content on shared devices.
- PWA install/update behavior on iOS/Android/desktop, including whether users receive and accept update banners quickly enough after auth/security JS changes.
- Real PostHog network behavior and consent state across fresh, returning, rejected, accepted, and consent-version-change sessions.
- Live admin/superadmin/instructor stale-cookie behavior after cookies expire or are cleared while localStorage display blobs remain.
- Live operational queue counts for failed payouts, Stripe re-blocked Connect accounts, sync failures, orphan payments, delivery failures, and retention/deletion backlogs.

### Recommended Fix Branches / PR Order

1. `fix/frontend-csp-inline-scripts`: move the remaining inline scripts into external JS files or replace redirect shims with Vercel redirects. Start with `learner/learn.html` and `learner/lessons-hub.html`, then learner pages with inline blocks, then admin standalone tools.
2. `fix/frontend-session-expiry`: add consistent 401/session-expired handling for instructor, admin, and superadmin shared auth wrappers, and consider middleware cookie gates for `/instructor/*`, `/admin/*`, and `/superadmin/*` with explicit login/asset exclusions.
3. `fix/pwa-cache-auth-boundaries`: decide and implement cache exclusions for role portals, learner data/privacy pages, success pages, and admin/superadmin pages, or document the intentional app-shell offline model. Include browser cache verification.
4. `fix/frontend-consent-coverage`: either add consent/PostHog loaders to the three missing pages or retire/redirect those pages so they are no longer reachable HTML surfaces.
5. `fix/admin-auth-fetch-wrapper`: replace remaining protected raw `fetch()` admin POSTs with `ccAdminAuth.fetchAuthed()` and add a small browser/API smoke test for admin create/update actions.
6. `fix/ops-frontend-health-queues`: after Phase 5 backend diagnostics exist, add admin queues for orphan payments, failed delivery attempts, repeated sync errors, failed/processing payouts, Stripe Connect re-blocked accounts, and deletion/retention backlogs.
7. `fix/payment-partial-failure-copy`: standardize success/hold/error copy across `success.js`, `offer-success.js`, learner booking checkout returns, and free-trial flows so paid-but-not-fully-booked states are clear and reassuring.
8. `docs/frontend-pwa-inventory`: update `PROJECT.md`, `docs/navigation.md`, and related docs to match password auth, slot-first booking, retired pages, current Learn navigation, and PWA/cache behavior.

### Final Cross-Phase Audit Summary And Suggested Next Steps

Across Phases 1-6, the highest-confidence issues are not a single broken page but a pattern: the repo has grown into a real multi-role SaaS surface, while CI, auth/session UX, cron guarantees, payment reconciliation, delivery observability, cache boundaries, and docs have not all caught up evenly.

Recommended next sequence:

1. Land low-risk hygiene first: CI/syntax/audit workflow, lockfile/dependency cleanup if needed, and docs corrections that stop future agents from reintroducing retired flows.
2. Fix the confirmed auth/cron mismatches: iCal cron fail-open behavior, offer-expiry GET/POST mismatch, protected admin raw fetches, and stale-session UX for instructor/admin/superadmin.
3. Prioritize money and booking integrity: Stripe webhook caught-failure alerting, reconciliation queries for payment-without-booking and transaction-without-notification, payout overlap guards, and Stripe Connect re-block surfacing.
4. Tighten GDPR/frontend boundaries: service-worker cache exclusions or an explicit offline-app-shell policy, consent-loader coverage or page retirement, and CSP inline-script cleanup before tightening inline styles.
5. Add operational visibility after backend diagnostics exist: admin queues for delivery failures, sync health, payout failures, orphan payments, and deletion/retention backlogs.
6. Only then do broader frontend maintainability refactors, keeping each PR focused on one surface or shared utility.

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
- For each fix area, create focused branches from latest `origin/main`, even if `main` is not being merged into yet:
  - `fix/auth-tenant-scope-<topic>`
  - `fix/payments-idempotency-<topic>`
  - `fix/booking-race-<topic>`
  - `fix/gdpr-retention-<topic>`
  - `fix/ops-cron-auth-and-methods`
  - `chore/ci-health-checks`
  - `chore/dependency-maintenance`
- Open each remediation branch as a focused draft PR into `main`, but leave it unmerged until explicitly approved.
- Prefer small PRs with one risk class each. Payment/auth fixes should include tests or a written manual verification plan.
- If combined verification is useful before merging to `main`, create a disposable `integration/audit-fixes-preview` branch and merge or rebase selected draft fix branches into it for testing only. Do not treat the integration preview branch as the source of truth.
- Merge order should be:
  1. Low-risk CI/test harness improvements.
  2. Documentation corrections that reduce future mistakes.
  3. Auth/tenant/payment fixes, one flow at a time.
  4. Operational cleanup and frontend maintainability work.
- Track proposed ordering in PR titles, for example `[AUDIT-FIX 01] chore: add CI health checks`, `[AUDIT-FIX 02] fix: harden cron auth and methods`, and so on.
- After each merged fix PR, update `AUDIT.md` in this branch or a follow-up audit PR with the PR number, status, and remaining risk.

## Immediate Questions Or Missing Context

- Is Vercel Cron configured with `CRON_SECRET` Authorization headers in production, or are any cron paths currently relying on query-string `?key=` manual triggers?
- Is there an external CI provider, Vercel checks-only workflow, or branch protection setup not represented by `.github/` files?
- Which Neon database should be used for DB-backed tests: local/dev/staging, and can it be safely reset with `api/seed-test-data.js`?
- Are Stripe test-mode credentials and webhook forwarding available for audit reproduction, or should payment tests remain mocked/design-level?
- Which flows are currently live revenue-critical: CoachCarter single-school bookings only, multi-school InstructorBook onboarding, franchise payouts, or all of them?
- Are legacy docs/features like `waitlist`, old magic-link wording, `create-checkout-session.js`, and pass-guarantee package flows still intentionally retained?
- Should audit findings be tracked only in `AUDIT.md`, or should high-priority confirmed issues become GitHub issues as they are found?
- Who should approve production-sensitive tests that trigger emails/SMS/WhatsApp, Stripe sessions, payouts, or retention/deletion flows?
