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
