# CoachCarter: PWA to Native App Migration Plan (Revised)

## For use with Claude Code sessions — work through phases sequentially

---

## Current Architecture (Verified May 2026)

**Frontend:** 57 HTML pages (vanilla HTML/CSS/JS), no framework, no bundler, no build step
**Backend:** 40 Vercel serverless API route files (excluding `_*.js` shared modules), 100+ actions via `?action=X` routing
**Database:** Neon PostgreSQL, ~40 tables (single idempotent migration file at `db/migration.sql`; `waitlist` and `qa_*` tables are explicitly dropped near the end)
**Multi-tenancy:** Every tenant-scoped table has `school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1`. Every SQL query filters by `school_id`. Every JWT carries `school_id`. School #1 is CoachCarter; new schools onboard via the superadmin portal. See `docs/multi-tenancy.md`.
**Branding:** Two front doors share the same backend — `coachcarter.uk` (driving school) and `instructorbook.co.uk` (national SaaS for instructors). See `INSTRUCTORBOOK-PLAN.md`.
**Auth:** JWT in httpOnly cookies (display blob in localStorage). All three roles use **email + password** sign-in (May 2026). `api/learner-auth.js` for learners, `api/instructor-auth.js` for instructors, `api/admin.js` for admins. Magic-link login retired. Magic-link infrastructure (`api/magic-link.js`) survives only for SMS code login, learner password-reset codes, and the email-code migration path for legacy learner accounts. Instructors are invite-only — admin sets/resets their password via the admin portal; instructor is forced to change it on first sign-in. Password helpers live in `api/_password.js`. Audit log via `api/_audit.js`.
**Payments:** Stripe Checkout sessions + webhook handler. Klarna enabled. Stripe Connect for instructor payouts (Model D: 0.75% fee on weekly automated payouts). Native app parity note: direct pay-and-book clients must treat the server as the price source of truth. For a chosen instructor, direct slot pricing is custom learner hourly rate → instructor hourly rate → school `bulk_hourly_pence`, multiplied by duration; bulk discounts are credit-package only and are not applied to direct single-slot checkout.
**Booking:** 12-week (84-day) advance cap for self-serve. Slot-first UX on `book.html` (no calendar views, no lesson-type pill bar — pick slot first, then duration in modal). Offer-driven recurring series (`lesson_offers.max_repeat_weeks` 1–18) is the only path that may exceed the 12-week cap.
**AI:** Direct Anthropic API calls (ask-examiner + advisor endpoints, both hidden in v1)
**Analytics:** PostHog (loaded via `posthog-loader.js` after cookie consent)
**Hosting:** Vercel (frontend + serverless), domains coachcarter.uk + instructorbook.co.uk
**PWA:** Service worker (cache-first shell, network-first API), manifest with maskable icons. Cookie consent gating analytics scripts via `cookie-consent.js`.

### Verified Page Inventory

**Learner portal (22 pages):**
- index (dashboard), book, buy-credits, lessons, lessons-hub, log-session, progress, mock-test, examiner-quiz, ask-examiner, advisor (hidden), videos, profile, onboarding, login, learn, practice, focused-practice, refer, my-data, confirm-deletion

**Instructor portal (8 pages):**
- index (calendar/dashboard), dashboard, availability, learners, profile, earnings, onboarding, login

**Admin portal (7 pages):**
- dashboard, editor, portal, login, franchise-calculator, franchise-comparison, plus the legacy `admin.html` redirect at `public/admin.html`

**Superadmin portal (3 pages):**
- index, schools, school-detail (cross-tenant management; not visible to school admins)

**Public / marketing pages (~17):**
- index (role selector), classroom, availability, lessons, login, learner-journey, accept-offer, offer-success, free-trial, free-trial-success, privacy, terms, success, maintenance, offline, 404, demo/book

### Verified API Surface (40 route files, 100+ actions)

| File | Auth | Notes |
|------|------|-------|
| `learner.js` | learner | Sessions, progress, profile, mock-tests, quiz, competency, onboarding, weekly availability, GDPR export/deletion |
| `learner-auth.js` | none → learner | Signup, login, forgot-password (code-based reset), email-code migration |
| `instructor.js` | instructor | Schedule, availability, blackouts, learner history, notes, stats, cancel-booking, reschedule, create-booking, create-offer (with `max_repeat_weeks`), broadcast endpoints |
| `instructor-auth.js` | none → instructor | Login, change-password (forced on first sign-in via `must_change_password`) |
| `instructors.js` | public/instructor | Public instructor profile lookups (used by booking page) |
| `admin.js` | admin | Dashboard, bookings, instructor CRUD, learner management, credit adjustment, set-instructor-password, forgot-password code flow |
| `slots.js` | mostly learner | available (12-wk cap), durations-for-slot, book (+ `repeat_weeks` 1–8), checkout-slot, checkout-slot-guest, book-free-trial, cancel (+ cancel_series), reschedule, my-bookings, series-info |
| `offers.js` | public (token) | get-offer, accept-offer (with `repeat_weeks`), expire-offers (cron). Exports `bookOfferSeries()` for the webhook |
| `lesson-types.js` | mixed | CRUD for lesson types per school |
| `schools.js` | superadmin | School onboarding + config (per-school feature flags via `schools.config` JSONB) |
| `videos.js` | mixed | CRUD, upload-url, categories, bulk ops |
| `credits.js` | learner | balance, checkout |
| `calendar.js` | token | ICS feed for learners + instructors |
| `enquiries.js` | mixed | submit (public), list/get/update (admin) |
| `magic-link.js` | none | SMS code login, learner password-reset codes, email-code migration only |
| `ask-examiner.js` | learner | Anthropic streaming chat (hidden in v1) |
| `advisor.js` | learner | Anthropic lesson advisor (hidden in v1) |
| `availability.js` | mixed | Public availability submissions + lookups |
| `connect.js` | instructor/admin | Stripe Connect onboarding, status, dashboard, admin invite, dismiss |
| `webhook.js` | none (Stripe) | checkout.session.completed (incl. lesson_offer with series fan-out + partial refund), account.updated, async_payment_succeeded (Klarna) |
| `cron-payouts.js` | cron | Weekly Friday payout processing |
| `cron-auto-complete.js` | cron | Auto-completes bookings >24h after end_time |
| `cron-reconcile-payments.js` | cron | Stripe ↔ DB reconciliation safety net |
| `cron-referral-rewards.js` | cron | Daily 04:00 UTC. Per-lesson recurring referral rewards (floor(duration/3) min, 7-day grace window, idempotent via `lesson_bookings.referral_rewarded_at`) |
| `cron-retention.js` | cron | GDPR retention sweeps + deletion processing |
| `r.js` | none | Bound to `/r/:code` via vercel.json — referral code redirector with rate-limit + click logging |
| `reminders.js` | mixed | send-due (hourly cron), daily-schedule (7pm cron), settings, update-settings |
| `setmore-sync.js` | cron | Setmore → CoachCarter booking import (every 15 min). Service mapping hardcoded for Fraser's account |
| `setmore-welcome.js` | cron | Welcome emails for setmore-imported learners |
| `ical-sync.js` | cron | Per-instructor iCal feed sync (`instructor_external_events`) |
| `migrate.js` | secret | One-shot migration runner (`?secret=MIGRATION_SECRET`) |
| `seed-test-data.js` | secret | Test-data seeder for dev/staging |
| `update-status.js` | mixed | Generic status updates |
| `address-lookup.js` | mixed | postcodes.io proxy for travel-time fits |
| `guarantee-price.js` | none | Reads `guarantee_pricing` for the homepage CTA |
| `reviews.js` | mixed | Google Reviews proxy + cache |
| `config.js` | none | Per-school config lookup (logo, colours, slug) |
| `status.js` | none | Health check |

**Shared server modules (prefixed with `_`):**
- `_auth.js` — `requireAuth({ roles })`, JWT verification, cookie helpers, CSRF
- `_auth-helpers.js` — SMTP transporter, token generation
- `_shared.js` — Legacy `verifyAuth()`, AI context builder, skill labels
- `_password.js` — Hash/verify/validate/lockout for password auth (May 2026)
- `_audit.js` — Audit log writer for admin/auth mutations
- `_booking-status.js` — Three-state booking lifecycle: `SCHEDULED`/`CHARGEABLE`/`REFUNDED` constants, `BLOCKING_STATUSES`/`PAYABLE_STATUSES` sets, `isLive`/`isChargeable`/`blocksSlot`/`isTerminal` predicates (May 2026). Port to TS for the app — these strings are also the DB enum values. See `docs/booking-statuses.md`.
- `_csrf.js` — CSRF token mint + cookie helpers
- `_error-alert.js` — Email alerts on 500 errors
- `_notify-availability.js` — Cancellation → learner_availability fan-out, broadcast-offer minting, sibling supersession on booking
- `_payout-helpers.js` — Weekly payout calculation + Stripe transfers. Eligible bookings filter is `lb.status = 'chargeable'` (May 2026 — was `completed` + 3-day grace on `confirmed`).
- `_travel-time.js` — postcodes.io geocoding + OpenRouteService drive-time estimates for slot fit checks
- `_whatsapp.js` — WhatsApp Business API send wrapper

Additional May 2026 shared server note: `_refund-planner.js` computes net-of-original-processing-fee refund previews from credit sources, BCS attribution, direct booking snapshots, and Stripe fee evidence when available. `_refund-executor.js` is the tightly gated admin execution orchestrator; it re-runs the planner, blocks manual-review cases, uses injected Stripe refunds, writes refund ledger rows, and applies supported CSA/LCB adjustments server-side.

### Shared Client Modules

| File | Purpose |
|------|---------|
| `sidebar.js` | Context-aware nav — desktop sidebar with collapsible groups + mobile floating pill bottom bar (Home/Lessons/Practice/Learn/Profile) |
| `branding.js` | Per-school logo/colour injection from `schools.config` |
| `competency-config.js` | 10 DL25 categories, 39 sub-skills, fault types, ratings, readiness scoring (single source of truth — port to TS for the app) |
| `cookie-consent.js` | GDPR cookie banner — gates analytics |
| `posthog-loader.js` | Loads PostHog only after analytics consent |
| `auth-gate.js` | Modal login prompt, `window.ccAuth` (token, user, requireAuth) |
| `pwa.js` | Service worker registration + install banner |
| `test-routes.js` | Mock test GPS route definitions for test centres |
| `shared/learner-auth.js` + `shared/instructor-auth.js` | Per-role auth helpers |

### Database (~40 tables, organised by area)

**Multi-tenancy:** `schools`, `school_payouts`
**Users:** `learner_users`, `instructors`, `admin_users`
**Auth (legacy magic-link, kept for SMS / password-reset codes):** `magic_link_tokens`, `instructor_login_tokens`
**Scheduling:** `instructor_availability`, `instructor_blackout_dates`, `instructor_external_events`, `lesson_bookings`, `slot_reservations`, `learner_availability`, ~~`lesson_confirmations`~~ *(dormant May 2026 — drop scheduled in follow-up migration once the rollback window has elapsed)*
**Lesson catalogue:** `lesson_types`, `lesson_offers` (manual + broadcast, with `max_repeat_weeks` for recurring series)
**Notifications:** `sent_reminders`
**Payments:** `credit_transactions`, `booking_credit_sources`, `credit_source_adjustments`, `refund_events`, `refund_event_lines`, `instructor_payouts`, `payout_line_items`, `guarantee_pricing`
**Learning:** `driving_sessions`, `skill_ratings`, `learner_onboarding`, `quiz_results`, `mock_tests`, `mock_test_faults`, `focused_practice_sessions`
**Community:** `enquiries`, `availability_submissions`
**Config:** `site_config`, `google_reviews`, `google_reviews_meta`
**Notes:** `instructor_learner_notes`
**Referrals:** `referrals`, `referral_clicks`
**GDPR / compliance:** `cookie_consents`, `audit_log`, `deletion_requests`, `rate_limits`
**Dropped (do not re-add):** `qa_questions`, `qa_answers` (April 2026), `waitlist` (May 2026 — replaced by `learner_availability` + cancellation broadcasts)

**Notable columns added (March 2026):**
- `lesson_bookings.rescheduled_from` — FK to previous booking in reschedule chain
- `lesson_bookings.reschedule_count` — tracks reschedules per chain (max 2 for learners)
- ~~`lesson_bookings.status` now includes `'rescheduled'` value~~ *(superseded May 2026 — status collapsed to `scheduled`/`chargeable`/`refunded`; rescheduled bookings now map to `refunded` with `rescheduled_from` set on the replacement row)*
- `instructors.min_booking_notice_hours` — minimum hours before a slot can be booked (default 24)
- `lesson_bookings.created_by` — who initiated the booking: 'learner', 'instructor', 'admin'
- `lesson_bookings.payment_method` — how it was paid: 'credit', 'stripe', 'cash', 'free'
- `lesson_bookings.pickup_address` — per-booking pickup (overrides learner profile default)
- `lesson_bookings.dropoff_address` — per-booking dropoff address
- `instructors.calendar_start_hour` — calendar display start hour (default 7)
- `instructors.reminder_hours` — how many hours before lesson to send learner reminders (default 24)
- `instructors.daily_schedule_email` — whether to send next-day schedule email at 7pm (default true)

**Notable columns added (April 2026) — Instructor profile enhancement:**
- `instructors.adi_grade` — DVSA ADI grade (text, e.g. "A", "B", "6")
- `instructors.pass_rate` — learner pass rate percentage (numeric 0-100)
- `instructors.years_experience` — years as a driving instructor (integer)
- `instructors.specialisms` — JSONB array of specialisms (e.g. ["Nervous drivers", "Motorway lessons"])
- `instructors.vehicle_make` — teaching vehicle make (text)
- `instructors.vehicle_model` — teaching vehicle model (text)
- `instructors.transmission_type` — manual/automatic/both (text, default 'manual')
- `instructors.dual_controls` — whether vehicle has dual controls (boolean, default true)
- `instructors.service_areas` — JSONB array of postcodes/area names covered
- `instructors.languages` — JSONB array of languages spoken (default ["English"])

**Notable tables added (April 2026):**
- `learner_availability` — recurring weekly free-time windows (mirrors instructor_availability). On cancellation, `api/_notify-availability.js` finds learners with windows covering the freed slot and pings them via WhatsApp + email. Also surfaced as a "Free" chip row on the instructor's "My Learners" page.
- ~~`waitlist`~~ — *retired May 2026.* Replaced by `learner_availability` driving cancellation notifications. Table dropped, `api/waitlist.js` deleted, learner-side join/list UI removed.
- `lesson_offers` — extended in PR 2a (May 2026) to support broadcast offers. New columns: `kind` (`'manual'` | `'broadcast'`), `batch_id` (UUID grouping all rows in one fan-out), `trigger` (`'cancellation'` | `'instructor_manual'`). New status value `'superseded'` for broadcast losers. Per-slot unique index now partial on `kind = 'manual'`.
- `instructors.broadcast_offers_enabled` (BOOLEAN, DEFAULT FALSE) — per-instructor opt-in for cancellation-triggered broadcasts. Toggle UI on `/instructor/profile.html` (PR 2b).
- Instructor broadcast endpoints (PR 2b, on `api/instructor.js`): `preview-broadcast-audience`, `create-broadcast-offer`, `close-broadcast-offer`, `my-broadcast-batches`. Powers the manual broadcast picker (extends the existing offer modal on the schedule page) and the pending-broadcasts dashboard card.
- `sent_reminders` table — tracks sent reminders to prevent duplicates (unique on booking_id + reminder_type)
- `lesson_bookings.series_id` — UUID grouping recurring weekly bookings (same time slot, N weeks)
- `referrals` — one row per learner-with-a-code (learner_id, school_id, code, unique per school)
- `referral_clicks` — one row per visit to `/r/CODE` (referral_code, school_id, ip_hash, user_agent, referer, clicked_at). Pre-signup, no learner_id. For attribution debugging + abuse signal.
- `learner_users.referred_by` — FK to learner_users(id), permanent link to referrer
- `magic_link_tokens.referral_code` — carries code through email/SMS signup flow
- `lesson_bookings.referral_rewarded_at` — idempotency key for the recurring referral reward cron. Once stamped, the booking will never trigger another reward.

**Notable additions (May 2026):**
- **Multi-tenancy fully landed** — `schools` table + `school_id` on every tenant-scoped table (default 1 = CoachCarter). Every JWT carries `school_id`. Public endpoints accept `?school_id=X` or `?school=slug`. Per-school feature flags in `schools.config` JSONB. Superadmin portal for cross-tenant ops.
- **Password auth across all roles** — `learner_users.password_hash`, `instructors.password_hash`, `admin_users.password_hash` (all nullable for pre-May 2026 accounts). `instructors.must_change_password` forces password change on first sign-in for admin-created accounts. Magic-link login retired; SMS code login + email-code migration paths preserved on `api/magic-link.js`. Audit log entries: `learner.signup`, `learner.password_set`, `learner.password_reset`, `instructor.password_change`, `admin.instructor_password_set`, `admin.password_reset`. See `api/_password.js` and `api/_audit.js`.
- **GDPR compliance landed** — `cookie_consents`, `audit_log`, `deletion_requests`, `rate_limits` tables. PostHog now consent-gated via `posthog-loader.js`. `cron-retention.js` handles deletions + retention sweeps. `learner.js` exposes export-data and confirm-deletion. Credit/financial records are anonymised, never hard-deleted (7-year legal retention).
- **InstructorBook split** — same backend, two front doors. `branding.js` injects per-school logo/colour from `schools.config`. `coachcarter.uk` (school) and `instructorbook.co.uk` (national SaaS for instructors) coexist. Pricing model D: free to use, 0.75% fee on weekly automated payouts. See `INSTRUCTORBOOK-PLAN.md`.
- **`lesson_offers.max_repeat_weeks` (8 May 2026)** — INTEGER NULL, CHECK 1–18. Lets an instructor offer a recurring weekly slot. Learner picks count on the accept page. The webhook fans out a series with `series_id` via `bookOfferSeries()` in `api/offers.js`, skipping clashed weeks (existing booking, blackout, no DoW availability) and rolling to the next free week up to an 18-week lookahead. Stripe charges per-lesson × N; partial refund if we can't fill all weeks. **Only path that may exceed the 12-week self-serve booking cap.**
- **12-week advance booking cap** — `MAX_DAYS_AHEAD = 84` in `api/slots.js`, `FEED_MAX_DAYS = 84` in `public/learner/book.js`. Down from 90 days. Applies to all self-serve booking flows.
- **Booking-page slot-first refactor (April 2026)** — `book.html` no longer has calendar views, view toggles, lesson-type pill bar, or a login wall. Slot feed renders at the smallest active duration; per-duration fits checked on slot click via `?action=durations-for-slot`. Guests can pay without an account via `?action=checkout-slot-guest`.
- **Instructor calendar refactor (April 2026)** — daily view absorbed into agenda. Hour-slot time grid replaced with compact lesson list. Removed "Weekdays" and "Cancelled" filter buttons.
- **Free trial flow** — `free-trial.html` + `?action=book-free-trial` on `slots.js`. Tied to schools with `slug='trial'`.
- **Klarna BNPL** — webhook handles `async_payment_succeeded` for Klarna's deferred-confirmation flow.
- **Setmore sync (ongoing)** — every 15 min cron pulls Fraser's Setmore bookings as real `lesson_bookings` rows with `created_by='setmore_sync'`, `setmore_key` for idempotency. Edits protected via `edited_at`. Service mapping hardcoded.
- **Booking-status three-state restructure (15 May 2026)** — `lesson_bookings.status` collapsed from seven values to three: `scheduled` / `chargeable` / `refunded` (CHECK constraint enforced). New shared module `api/_booking-status.js` holds the constants + predicates. New column `lesson_bookings.credit_forfeited` records "no credit returned, instructor still paid" for sub-48h cancellations. Dual-confirmation flow deleted (`_confirmation-resolver.js`, `confirm-lesson.html`, prompt-confirmations + auto-confirm crons, admin `resolve-dispute`). New cron `api/cron-auto-complete.js` flips `scheduled → chargeable` at `end_time + 1 hour`. Payout filter (`api/_payout-helpers.js`) now `lb.status = 'chargeable'` only. **App port implication:** the status strings are part of the API contract — any TS port must use the same three literal values; reuse the constants module verbatim. See `BOOKING-STATUS-RESTRUCTURE-PLAN.md`, `docs/booking-statuses.md`.

### Critical Design Decisions Already Made

**Refunds (preview/execute foundation, May 2026):**
- Approved card refunds are net of the original non-refundable Stripe processing fee; the learner absorbs that fee unless a later goodwill policy explicitly says otherwise.
- `POST /api/admin?action=refund-preview` is read-only and school-scoped. It returns itemised gross lesson credit value, withheld processing fee, and amount returned.
- `POST /api/admin?action=execute-refund` is school-scoped and requires explicit `operator_go` plus `idempotency_key`. It re-runs server planning before Stripe, writes `refund_events(status='executed')` / lines, and audit-logs `admin.execute_refund`.
- Missing fee evidence and direct bookings already present in `payout_line_items` block automatic refund handling for manual review. Automatic booking-credit-source line execution remains deliberately disabled pending a payout-safe slice.

**Navigation (app-mode design — do NOT deviate):**
- Start page (`/`): Role selection only — "I'm a Learner" or "I'm an Instructor"
- Mobile: Top header with hamburger. **Floating pill bottom bar** (border-radius 26px, frosted glass, layered shadow, 10px side margins): Home | Lessons | Practice | Learn | Profile. Active tab reflects current section via `activeOn` mapping. Subsections accessed via sidebar collapsible groups.
- Desktop: Fixed 240px sidebar with collapsible groups (Lessons → Book/Buy/Upcoming, Practice → Log Session/Mock Test/Progress, Learn → Videos/Examiner AI/Quiz). Accordion — one group open at a time.

**Intentionally removed features (do NOT re-add):**
- Pricing page/tab
- Lesson Advisor (hidden)
- Privacy/Terms as nav tabs (pages exist, just not in nav)
- Q&A — removed entirely April 2026 (pages, API, tables all gone)
- Waitlist — removed May 2026 (table dropped, `api/waitlist.js` deleted, learner UI removed). Replaced by `learner_availability` driving cancellation broadcasts via `_notify-availability.js`.
- Dashboard as permanent bottom tab
- Calendar views (weekly/monthly/daily) on `book.html` — slot-first feed only
- Lesson-type pill bar on `book.html` — duration picked inside the modal after slot click
- Daily view tab on instructor calendar — agenda absorbs its function
- Hour-slot time grid on instructor daily calendar — replaced with compact lesson list
- "Weekdays" and "Cancelled" filter buttons on instructor calendar
- Videos in Learn-section nav (page still exists, just not in nav)
- Old `.site-nav` top bar, `.bottom-nav` inline bar, `.sub-tabs` — all replaced by `sidebar.js`

**Competency framework (just restructured March 2026):**
- 10 DL25 categories: Control, Move Off, Mirrors, Signals, Junctions, Judgement, Positioning, Progress, Signs/Signals, Manoeuvres
- 39 sub-skills matching the real DVSA DL25 marking sheet
- Session logs rate at the area level (10 skills, traffic-light)
- Mock tests record faults at the sub-skill level
- Legacy key mapping handles all old data

---

## Migration Strategy: React Native (Expo)

**Why Expo/React Native:**
- API is already REST/JSON — RN consumes it identically to current `fetch()` calls
- Fraser knows JavaScript — no new language
- Expo gives managed builds, OTA updates, push notifications
- Marketing pages stay on Vercel — only portals migrate
- The bottom-bar navigation design translates naturally to React Navigation tab bars

**What migrates to the app:** Learner portal, Instructor portal, Admin portal
**What stays on the website:** Landing page, public pages, SEO content, Superadmin portal (cross-tenant ops, low traffic), the offer-acceptance page (`accept-offer.html` is reached via email link from a non-logged-in context), free-trial flow (`free-trial.html`)

---

## Phase 0: API Preparation (Before any React Native)

> **Goal:** Make the existing API app-ready without breaking the website. Every change here benefits both web and app.

### 0.1 — Generate API specification

Create `api/API_SPEC.md` from the actual code. This is critical because the app team (you + Claude) needs an exact contract.

**Claude Code prompt:**
> "Read every file in /api/*.js. Generate API_SPEC.md documenting each endpoint: HTTP method, `?action=` value, auth required (learner/instructor/admin/none), request body TypeScript types, response TypeScript types, error codes. Use the actual code — don't guess."

**What already exists to work from:** `api/_auth.js` exposes `requireAuth(req, { roles })` — the canonical auth helper used by most new code (May 2026). Older routes still use `verifyAuth()` from `_shared.js` and inline JWT checks; converging on `requireAuth` is part of the prep work. Most routes follow `if (action === 'X') return handleX(req, res)`.

### 0.2 — Standardise error responses

Currently inconsistent — some return `{ error: 'message' }`, some return `{ error: true, message: '...' }`, some just `{ message: '...' }`.

Standardise to:
```javascript
// Success: { ok: true, ...data }
// Error: { error: true, code: 'MACHINE_READABLE', message: 'Human readable' }
```

**Important:** The `reportError()` pattern from `_error-alert.js` must be preserved — every 500 should still email `ERROR_ALERT_EMAIL`.

### 0.3 — Add API versioning header

In `_shared.js`, add a `getClientVersion(req)` helper:
```javascript
function getClientVersion(req) {
  return req.headers['x-cc-client'] || 'web';
}
```
This lets you handle web vs app differences without forking routes.

### 0.4 — Consolidate auth middleware

`api/_auth.js` already exposes the canonical `requireAuth(req, { roles })` helper, plus session cookie helpers (`buildSessionCookie`, `SESSION_COOKIE_NAMES`), and is used by all post-May-2026 code. The remaining work is:

1. **Migrate older routes** that still use the legacy `verifyAuth()` from `_shared.js` or inline JWT verification. They should be calling `requireAuth(req, { roles: ['learner'] })` etc.
2. **Standardise role checks** — current code uses `roles: ['learner']`, `roles: ['instructor']`, `roles: ['admin']`. Avoid creating new role names.
3. **Password auth** is on all three roles as of May 2026. `api/_password.js` is the shared module for hash/verify/lockout. `api/admin.js` retains its own `bcrypt` calls (legacy, intentionally left alone).
4. **CSRF**: `api/_csrf.js` mints + validates CSRF tokens via cookie + header pair. App auth flow needs to send the token back; web does this automatically via `ccAuth.fetchAuthed()`.

The instructor auth flow used to use `instructor_login_tokens` (magic-link). That's retired for login — passwords now. The table survives only for the email-code migration path.

### 0.5 — Add push notification infrastructure

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('learner', 'instructor')),
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',  -- 'web', 'ios', 'android'
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_type, user_id, push_token)
);
```

Create `api/push.js` with actions: `subscribe`, `unsubscribe`. Supports both Web Push (PWA) and Expo Push (app).

### 0.6 — Add PaymentIntent endpoint for in-app Stripe

The web uses Stripe Checkout (redirect). The app needs a PaymentSheet flow:

```javascript
// api/credits.js — add new action:
// POST ?action=create-payment-intent
// Body: { hours, instructor_id }    (learner_id resolved from JWT, same as ?action=checkout)
// Returns: { clientSecret, ephemeralKey, customerId }
```

Keep the existing `/api/credits?action=checkout` action working for web (it returns a Stripe Checkout URL), but preserve the Slice 2/Thread B contract: learner-facing purchases must pass an explicit same-school active `instructor_id`; `calcBulkTotal` must price server-side using custom learner rate → instructor hourly rate → school default; school bulk tiers apply only when that instructor has `bulk_tiers_enabled = TRUE`; and the metadata must carry `instructor_id`, `amount_pence`, `discount_pct`, and `effective_rate_pence_per_minute` through the `credit_purchase` webhook. The new in-app action shares that same pricing helper and webhook metadata.

Native buy-credits screens should mirror the web Slice B contract before creating a payment intent: require a selected instructor, fetch `/api/credits?action=bulk-pricing&instructor_id=...` for display-only hourly/package state, reload the selected instructor balance with `/api/credits?action=balance&instructor_id=...`, and avoid showing bulk savings when `bulk_tiers_enabled` is false. Payment creation still relies on the server-priced `{ hours, instructor_id }` request.

---

Instructor native profile screens should preserve the web profile contract: `GET /api/instructor?action=profile` returns `bulk_tiers_enabled` plus read-only `effective_hourly_rate_pence`, and `POST /api/instructor?action=update-profile` accepts a boolean `bulk_tiers_enabled`.

## Phase 1: React Native Project Scaffolding

> **Goal:** Bootable Expo app with navigation, theming, and auth — matching the existing app-mode UX.

### 1.1 — Create Expo project

```bash
npx create-expo-app CoachCarterApp --template blank-typescript
cd CoachCarterApp
npx expo install expo-router expo-secure-store expo-constants
npx expo install @react-navigation/native @react-navigation/bottom-tabs
```

### 1.2 — Project structure (mirrors the web architecture)

```
/app
  /(auth)
    login.tsx               # Magic link (phone + email)
    verify.tsx              # Code verification
  /(learner)
    _layout.tsx             # Bottom tab navigator (5 fixed tabs matching sidebar.js: Home/Lessons/Practice/Learn/Profile)
    (learn)/                # "Learn" tab group
      videos.tsx
      ask-examiner.tsx
      examiner-quiz.tsx
    (practice)/             # "Practice" tab group
      log-session.tsx
      mock-test.tsx
      progress.tsx
    (lessons)/              # "Lessons" tab group
      book.tsx
      buy-credits.tsx
      lessons.tsx           # Upcoming lessons list
    (profile)/              # "Profile" tab group
      index.tsx             # Test readiness, mock results, progress
      onboarding.tsx
      profile.tsx
  /(instructor)
    _layout.tsx             # Bottom tab navigator
    index.tsx               # Calendar/dashboard
    availability.tsx
    learners.tsx
    profile.tsx
  /(admin)
    _layout.tsx
    dashboard.tsx
    editor.tsx
/lib
  api.ts                    # API client (base URL, auth headers, error handling)
  auth.ts                   # Token storage via expo-secure-store
  theme.ts                  # Design tokens (matches CSS custom properties)
  competency.ts             # Port of competency-config.js as TypeScript module
  types.ts                  # TypeScript types from API_SPEC.md
/components
  BottomTabBar.tsx          # Custom tab bar matching sidebar.js mobile design
  FaultCounter.tsx          # Reusable D/S/X counter (mock test + session log)
  SkillCard.tsx             # Area card with traffic-light rating
  LoadingSpinner.tsx
  ErrorBoundary.tsx
  Card.tsx
  Button.tsx
```

**Key architectural decision:** The tab structure must match the existing `sidebar.js` bottom bar sections exactly. The web now has 5 fixed tabs (Home, Lessons, Practice, Learn, Profile) that never change. In RN, use a bottom tab navigator with these same 5 tabs. Subsection navigation (e.g. Book vs Buy Credits vs Upcoming within Lessons) is handled by nested stack navigators within each tab group, mirroring the sidebar collapsible groups on web.

### 1.3 — Design tokens (match existing CSS variables)

```typescript
// lib/theme.ts — extracted from public/shared/learner.css + sidebar.js
export const theme = {
  colors: {
    primary: '#262626',     // --primary (charcoal)
    accent: '#f58321',      // --accent (orange)
    accentDark: '#e07518',  // --accent-dk
    accentLight: '#fff4ec', // --accent-lt
    muted: '#797879',       // --muted
    border: '#e0e0e0',      // --border
    background: '#ffffff',  // --white
    surface: '#f9f9f9',     // --surface
    green: '#22c55e',       // --green
    amber: '#f59e0b',
    red: '#ef4444',         // --red
  },
  fonts: {
    heading: 'BricolageGrotesque',
    body: 'Lato',
  },
  radius: 14, // --radius
};
```

### 1.4 — API client

```typescript
// lib/api.ts
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://coachcarter.co.uk/api';

export async function apiCall(
  method: string,
  action: string,
  body?: any,
  route: string = 'learner'
) {
  const token = await SecureStore.getItemAsync('cc_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CC-Client': 'app-1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${BASE_URL}/${route}?action=${action}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) throw new ApiError(data.code, data.message, res.status);
  return data;
}
```

**Important:** This matches the existing `?action=` routing pattern used by all API files. The web frontend already uses this exact pattern.

### 1.5 — Auth flow (May 2026: email + password)

Port the password login from `public/learner/login.html` + `api/learner-auth.js`:

1. **Sign in:** user enters email + password → `POST /api/learner-auth?action=login` → response `{ user, is_new_user, needs_name, terms_accepted }` and a `Set-Cookie` for the session JWT.
2. **Sign up:** user enters email + password + name → `POST /api/learner-auth?action=signup`. Same response shape.
3. **Forgot password:** `POST /api/learner-auth?action=request-reset { email }` → user gets a 6-digit code by email → `POST /api/magic-link?action=verify-email-code { email, code, purpose: 'reset', role: 'learner' }` returns a 5-min ticket → `POST /api/learner-auth?action=set-password { ticket, password }` to finish.
4. **Storage:** in the React Native app, store the session JWT in SecureStore (the web uses an httpOnly cookie which doesn't translate). Use the same JWT shape `{ id, email, role: 'learner', school_id }` so server-side `requireAuth` keeps working.
5. **First-run terms gate:** if `terms_accepted` is false, route to a terms-acceptance screen before the dashboard. The web does this via `/api/learner?action=accept-terms` — same endpoint in the app.
6. **No magic-link login in the app.** The web kept `?action=verify` only for in-flight emails during the May 2026 deploy and it should not be ported. SMS code login (`?action=verify-code`) is still valid and worth porting as a fallback for users without email — same flow as before, response shape unchanged.

**Nuance:** The web's `FREE_TRIAL_CREDITS` constant is currently `0` but the credit-transaction row is still written on signup as an audit trail. App can be agnostic — server handles it.

**Migration of existing accounts:** any learner created before May 2026 has `password_hash = NULL`. The web routes them through a one-time email-code → set-password flow. The app should detect `error: 'invalid_credentials'` from login and offer the same migration path: `POST /api/magic-link?action=send-email-code { email, purpose: 'migration', role: 'learner' }` → `verify-email-code` → `set-password`.

### 1.6 — Port competency-config.js to TypeScript

The competency framework is the backbone of 6 features. Port it as a proper TypeScript module:

```typescript
// lib/competency.ts — typed version of public/competency-config.js
export interface Area {
  id: string;
  label: string;
  icon: string;
  colour: string;
}

export interface SubSkill {
  key: string;
  label: string;
}

export interface Skill {
  key: string;
  label: string;
  area: string;
  subs: SubSkill[];
  description: string;
}

export const AREAS: Area[] = [
  { id: 'control', label: 'Control', icon: '🚗', colour: '#6366f1' },
  // ... all 10 areas
];

export const SKILLS: Skill[] = [
  // ... all 10 skills with 39 sub-skills
];

// ... all helper functions with proper types
```

This must stay in sync with the web version. Consider making the web version auto-generated from this TypeScript source.

---

## Phase 2: Screen-by-Screen Migration (Learner Portal)

> **Goal:** Migrate the 15 learner screens. Each is self-contained — fetch from API, render. Start with highest-value screens.

### Migration order (by user value + complexity):

| Priority | Screen | Complexity | Key challenge |
|----------|--------|-----------|---------------|
| 1 | Dashboard (index) | Medium | Credit balance, upcoming lessons, progress summary |
| 2 | Lessons | Low | List view, cancel flow |
| 3 | Book | Medium | Date picker, slot grid, instructor selection |
| 4 | Buy Credits | Medium | Stripe PaymentSheet (not Checkout redirect) |
| 5 | Progress | High | Radar chart (Canvas → react-native-svg), readiness bars, mock history |
| 6 | Profile | Low | Form fields, phone/email display |
| 7 | Log Session | Medium | 10 skill cards with traffic-light rating + fault counters |
| 8 | Mock Test | **Very High** | Multi-part flow, GPS tracking, Leaflet map → react-native-maps, fault counters, timer, manoeuvre types |
| 9 | Examiner Quiz | Medium | Scenario cards, answer buttons, score tracking, 50 scenarios |
| 10 | Ask Examiner | Medium | Streaming AI chat (Anthropic), message history |
| 11 | Videos | Low | Video list, category tabs, player |
| 12 | Onboarding | Low | Multi-step form (prior hours, transmission, test date, concerns) |

**Screens intentionally skipped for v1 (hidden on web too):**
- Advisor (hidden)

### Per-screen migration template:

**Claude Code prompt:**
> "Migrate [SCREEN] from public/learner/[file].html to app/(learner)/[name].tsx.
> 1. Read the HTML file — identify all API calls, state, and interactions
> 2. Create a React Native component using our api.ts, theme.ts, and competency.ts
> 3. Use the same API endpoints — no backend changes
> 4. Match the visual design: charcoal nav, orange accent, card layout
> 5. Handle loading, error, and empty states
> 6. Add pull-to-refresh for data screens"

### 2.1 — Mock Test (the hardest screen)

This is by far the most complex migration. The web version has:
- **Multi-part flow** with dynamic parts (user can continue indefinitely or end anytime)
- **GPS tracking** via `navigator.geolocation.watchPosition` → port to `expo-location`
- **Leaflet map** for placing faults at GPS coordinates → port to `react-native-maps`
- **Fault counters** with long-press-to-reset (custom pointer events) → port to `Pressable` with `onLongPress`
- **Timer** per part
- **Manoeuvre type selection** (Reverse/Right, Reverse park road/car park, Forward park)
- **10 collapsible area groups** with sub-skill fault counters
- **Results screen** with pass/fail, per-part breakdown, fault map
- **Wake Lock API** to prevent screen dimming

**Claude Code prompt:**
> "This is the most complex screen. Read public/learner/mock-test.html completely (it's ~1500 lines). The mock test has: dynamic parts (not fixed at 3), GPS tracking, a Leaflet fault map, fault counters with long-press reset, a timer, manoeuvre type selection, and results with pass/fail calculation. Port all of this to React Native."

### 2.2 — Stripe in-app payments

```bash
npx expo install @stripe/stripe-react-native
```

Use PaymentSheet flow instead of Checkout redirect:
1. App calls `POST /api/credits?action=create-payment-intent` with `hours` and `instructor_id`
2. API returns `{ clientSecret, ephemeralKey, customerId }`
3. App presents PaymentSheet
4. On success, credits are added via webhook (same as current flow)

### 2.3 — Ask Examiner AI chat

The web version streams responses from Anthropic. In React Native:
- Use the same `POST /api/ask-examiner` endpoint
- The API already returns streaming text — use `ReadableStream` or chunk the response
- The `buildLearnerContext()` function in `_shared.js` automatically builds a context string from the learner's onboarding data, session history, quiz results, and mock test faults — this feeds into the AI prompt server-side, so the app just sends the question

---

## Phase 3: Instructor Portal (6 screens)

| Screen | Complexity | Notes |
|--------|-----------|-------|
| Dashboard/Calendar | Medium | Schedule view, upcoming lessons, completion marking |
| Availability | Medium | Weekly time slot grid editor |
| Learners | Medium | Learner list with notes, phone/WhatsApp links |
| Profile | Low | Bio, photo upload (uses presigned URL), contact details. Should also include "Change password" form posting to `api/instructor-auth.js?action=change-password` (web has the API but not yet a UI for voluntary changes) |
| Login | Low | Email + password via `api/instructor-auth.js`. Force-change-password screen if `must_change_password: true` is returned on login. No self-serve forgot-password — point users to contact admin. |

**Important nuance:** Instructor auth uses a separate JWT (`role: 'instructor'`, `cc_instructor` cookie on web) but the same API auth model as learners. Use `api/instructor-auth.js` (May 2026) for sign-in, not the legacy magic-link endpoints in `api/instructor.js`.

---

## Phase 4: Admin Portal (3 screens)

| Screen | Notes |
|--------|-------|
| Dashboard | Stats, booking management, instructor CRUD, learner management |
| Editor | Video content management (CRUD, upload URLs, categories) |
| Login | Email + password via `api/admin.js?action=login`. Forgot-password is a 6-digit code by email (`request-reset` + `reset-password`) — same UX shape as the learner reset flow. |

Admin is lowest priority — Fraser is the only admin user. Could stay web-only initially.

---

## Phase 5: Native-Only Features

> **Goal:** Features that justify the native app over the PWA.

### 5.1 — Push notifications (Expo Push)

```bash
npx expo install expo-notifications expo-device
```

Replace SMS notifications for app users:
- Lesson reminders (24hr + 1hr before)
- Booking confirmations
- Credit purchase receipts
- Mock test results summary

**Saves Twilio costs** for users who have the app installed.

### 5.2 — Background GPS for mock tests

```bash
npx expo install expo-location expo-task-manager
```

The web version uses `navigator.geolocation.watchPosition` which only works in the foreground. The app can:
- Track GPS in the background during the entire mock test
- Higher accuracy and more frequent updates
- Better fault-to-location mapping

### 5.3 — Bluetooth clicker for fault marking

This is the killer native feature:
- Pair with a Bluetooth HID clicker (presenter remote)
- Single click = driving fault, double click = serious, long press = dangerous
- Faults automatically tagged with current GPS coordinates
- Instructor can mark faults while supervising without looking at the phone

### 5.4 — Camera for lesson footage

```bash
npx expo install expo-camera expo-media-library
```

- Record lessons for social media clips
- Feeds into the existing Remotion video pipeline

### 5.5 — Offline mode

Use `@tanstack/react-query` with persistence:
- Cache competency data, lesson history, progress locally
- Queue actions (log session, mark fault) when offline
- Sync when connection returns
- Mock test works fully offline (GPS + fault recording), syncs results later

---

## Phase 6: Build, Test & Ship

### 6.1 — App Store assets

- App icons from existing Logo.png / maskable icons
- Screenshots: iPhone 6.5", iPad 12.9", various Android sizes
- App name: "CoachCarter" (already trademarked?)
- Privacy policy: link to existing coachcarter.co.uk/privacy.html

### 6.2 — EAS Build

```bash
npm install -g eas-cli
eas build --platform all
```

### 6.3 — Beta testing

- iOS: TestFlight with 10-20 current learners
- Android: Internal testing track
- Keep PWA running in parallel — app is optional, not required

### 6.4 — OTA Updates

```bash
eas update --branch production
```

Bug fixes and new screens ship instantly without app review. Only native module changes need a store build.

---

## Realistic Timeline

| Phase | Scope | Sessions | Calendar |
|-------|-------|----------|----------|
| 0 | API prep (benefits web too) | 3-4 | 1-2 weeks |
| 1 | Scaffolding + auth + nav | 2-3 | 1 week |
| 2 | Learner screens (12) | 10-15 | 4-5 weeks |
| 3 | Instructor screens (6) | 4-5 | 1-2 weeks |
| 4 | Admin (optional, low priority) | 2-3 | 1 week |
| 5 | Native features | 5-7 | 2-3 weeks |
| 6 | Build + test + ship | 2-3 | 1-2 weeks |

**Total: ~28-40 Claude Code sessions over 10-16 weeks**

Note: Phase 0 is pure value — it improves the web experience too. Start there regardless of app timeline.

---

## Key Decisions Before Starting

1. **Expo managed vs bare?** Start managed. Only eject if you hit a native module wall (unlikely for your feature set).

2. **Same app binary or separate apps?** Same app with role-based routing. One store listing, simpler to maintain. JWT payload determines if user is learner/instructor.

3. **Admin in the app?** Recommend keeping admin web-only initially. Fraser is the only admin — no need to build native screens for one user.

4. **MVP scope for v1.0?** Dashboard, lessons, booking, buy credits, progress, profile, log session. Ship that, then add mock test, quiz, ask examiner via OTA updates.

5. **Web PWA during transition?** Keep it running. The app is additive, not a replacement. Users who don't install the app still use the web version. Eventually the web portals could redirect to app store links, but not initially.

---

## How to Use This Plan with Claude Code

Start each session with:

> "I'm working on Phase [X], Step [X.X] of the CoachCarter app migration. Here's the context: [paste the relevant section]. My web repo is at [path]. Let's go."

Each phase produces working, testable output. The web version keeps running throughout. The app builds up incrementally.

**Critical files to reference in every session:**
- `public/competency-config.js` — the competency framework (10 categories, 39 sub-skills)
- `api/_shared.js` — auth verification + AI context builder
- `public/sidebar.js` — the navigation design to replicate
- `CLAUDE.md` — project conventions and intentionally removed features
