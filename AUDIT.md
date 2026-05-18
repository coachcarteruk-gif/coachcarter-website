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
