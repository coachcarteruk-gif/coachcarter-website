# CoachCarter Platform

Multi-tenant driving school SaaS platform. Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres. Originally built for CoachCarter (coachcarter.uk), now supports multiple driving schools.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Key conventions

> For full project structure, see [PROJECT.md](PROJECT.md).

- API routes use `?action=` routing (e.g. `/api/slots?action=book`)
- Auth: JWT stored in localStorage (`cc_learner`, `cc_instructor`, `cc_admin`)
- Frontend auth via `window.ccAuth` from shared auth JS files
- All new pages must include `sidebar.js` and `branding.js`
- Phone numbers stored as UK format (07xxx), converted to +447xxx at send time
- Always `await` async operations before `res.json()` — Vercel kills functions after response
- **Every SQL query on tenant-scoped tables MUST filter by `school_id`**

## Multi-tenancy (April 2026)

The platform is multi-tenant. Each driving school is an isolated tenant with their own instructors, learners, bookings, lesson types, pricing, and branding.

**Key tables:**
- `schools` — school profile, branding (colours, logo), Stripe Connect account, config JSONB
- `school_payouts` — platform-to-school payment transfers

**Roles:**
- `superadmin` — platform owner (Fraser). Can see all schools, create schools, manage school admins. JWT has `school_id: null`.
- `admin` — school admin. Scoped to their `school_id`. Can manage their school's instructors, learners, bookings, payouts.
- `instructor` — belongs to one school. JWT has `school_id`.
- `learner` — belongs to one school. JWT has `school_id` and `role: 'learner'`.

**Auth module (`api/_auth.js`):**
- `requireAuth(req, { roles })` — validates JWT, returns payload with normalised `school_id`
- `getSchoolId(payload, req)` — returns effective school_id. Superadmins can override via `?school_id=X`.
- Old JWTs without `school_id` default to `school_id = 1` (CoachCarter).

**Branding:**
- `public/shared/branding.js` — loaded on all pages. Fetches school branding from API, caches in localStorage, applies CSS custom properties (`--brand-primary`, `--brand-secondary`, `--brand-accent`).
- `GET /api/schools?action=branding&school_id=X` — public endpoint returning school name, colours, logo.
- HTML elements with `data-brand-name` and `data-brand-logo` attributes are auto-updated.

**Stripe payment flow:**
- Learner pays → platform Stripe account → weekly cron transfers to school's Stripe Connect (minus platform fee) → school handles instructor payments externally.
- CoachCarter (school #1) retains the legacy per-instructor payout system alongside.

**School onboarding:**
- Superadmin creates school via `/api/schools?action=create`
- Superadmin creates school admin via `/api/schools?action=create-admin`
- School admin creates instructors via `/api/admin?action=create-instructor` (sends invite email)
- Admin/instructor invites learners via `/api/admin?action=invite-learner`

**Rules when adding features:**
1. Every new tenant-scoped table MUST have `school_id INTEGER NOT NULL REFERENCES schools(id)` with `DEFAULT 1`
2. Every new SQL query MUST include `WHERE school_id = ${schoolId}`
3. Every new JWT must include `school_id` in the payload
4. Use `requireAuth` from `api/_auth.js`, not local auth functions
5. Public endpoints that need school context accept `?school_id=X` or `?school=slug`

**Future plans (documented, not yet built):**
- Marketplace model (learners browse across schools) — phased for 2027+ (see `INSTRUCTORBOOK-PLAN.md` section 9)
- Custom domains per school
- Embeddable booking widget (like Setmore)
- Self-service school signup — priority for InstructorBook launch
- Multi-school instructors
- Per-school content (videos, quizzes)

## GDPR Compliance (April 2026)

The platform is GDPR-compliant. All future changes MUST follow these rules.

### What's in place
- **Cookie consent banner** (`public/cookie-consent.js`) — appears on all pages before any analytics load. PostHog only initialises after explicit consent via `public/posthog-loader.js`.
- **Data export** (`POST /api/learner?action=export-data`) — learners can download all personal data as JSON from their profile page (Article 20 — Right to Portability).
- **User-initiated deletion** (`POST /api/learner?action=request-deletion`, `confirm-deletion`) — email-verified cascading delete with credit_transactions anonymized for 7-year tax retention (Article 17 — Right to Erasure).
- **Data retention cron** (`api/cron-retention.js`) — runs weekly (Sunday 3am UTC). Soft-archives learners inactive >3 years, hard-deletes after 90-day grace period. Archives enquiries >2 years.
- **Audit logging** (`api/_audit.js`) — logs admin actions (delete-learner, adjust-credits, create/update/toggle-instructor, mark-complete) to `audit_log` table.
- **Consent recording** (`POST /api/config?action=record-consent`) — stores cookie consent decisions with hashed IP and timestamp for audit proof.
- **`last_activity_at`** — updated on login (`magic-link.js`) and booking creation (`slots.js`) to support retention policy.

### GDPR tables
- `cookie_consents` — visitor_id, learner_id, analytics boolean, ip_hash, user_agent, school_id
- `audit_log` — admin_id, action, target_type, target_id, details JSONB, school_id
- `deletion_requests` — learner_id, token, status (pending/confirmed/completed/cancelled), school_id

### Rules for ALL future changes

1. **New pages MUST include cookie consent**: Every HTML page must load `cookie-consent.js` and `posthog-loader.js` instead of inline PostHog. Never add inline PostHog scripts.
2. **Never load analytics without consent**: PostHog, or any future tracking, must only load after the user accepts analytics cookies. Use the `posthog-loader.js` pattern.
3. **New PII fields must be included in data export**: If you add a new table or column containing personal data, update `handleExportData()` in `api/learner.js` to include it.
4. **New PII tables must be included in deletion cascade**: If you add a table referencing `learner_users`, add it to the deletion cascade in both `handleConfirmDeletion()` (learner.js) and `cron-retention.js`.
5. **New tenant-scoped GDPR tables need school_id**: Cookie consents, audit logs, and deletion requests are all scoped by `school_id`.
6. **Admin data mutations must be audit-logged**: Any new admin action that creates, modifies, or deletes user data must call `logAudit()` from `api/_audit.js`.
7. **Credit/financial records must never be hard-deleted**: Always anonymize (`learner_id = NULL, anonymized = true`) instead. 7-year legal retention.
8. **New third-party services**: If integrating a new service that processes personal data, update `public/privacy.html` to list it, and consider whether it needs consent.
9. **Cookie consent categories**: Currently only "Necessary" (login tokens) and "Analytics" (PostHog). If adding marketing cookies or new tracking, add a new category to `cookie-consent.js`.
10. **Data retention**: New tables with PII should have a retention policy. Add cleanup logic to `api/cron-retention.js` if data has a defined lifetime.

### Key files
- `public/cookie-consent.js` — consent banner UI + localStorage state + server recording
- `public/posthog-loader.js` — consent-gated PostHog initialisation
- `api/_audit.js` — shared `logAudit(sql, {...})` utility
- `api/cron-retention.js` — weekly data retention enforcement (Vercel cron, Sunday 3am UTC)
- `api/learner.js` — `export-data`, `request-deletion`, `confirm-deletion` actions
- `public/learner/confirm-deletion.html` — token-based deletion confirmation page
- `public/learner/profile.html` — "Privacy & Data" section (export, cookie settings, delete account)

## Database & API Security (April 2026)

### What's in place
- **Security headers** — HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy set on every response via `middleware.js`
- **Centralised CORS** — Handled in `middleware.js`. Only allows `coachcarter.uk`, `coachcarter.co.uk`, Vercel previews, and localhost. Individual API files no longer set CORS headers.
- **Parameterized SQL only** — All queries use tagged template literals (`sql\`...\``). No dynamic table/column name interpolation.
- **Rate limiting** — Magic link sends limited to 5 per email/phone per hour via `rate_limits` DB table.
- **SSL/TLS** — Neon serverless library connects over HTTPS by default. No raw TCP.
- **No credential exposure** — `POSTGRES_URL` never logged or sent to clients.

### Database performance
- 28 indexes on FK columns and common query patterns (added April 2026)
- Key composite indexes: `lesson_bookings(school_id, status, scheduled_date)`, `lesson_bookings(instructor_id, scheduled_date, start_time)`, `lesson_bookings(learner_id, status)`
- Partial indexes on `magic_link_tokens(email)` and `magic_link_tokens(phone)` WHERE NOT NULL
- All new FK columns MUST have an index — check `db/migration.sql` for the pattern

### Rules for ALL future changes

1. **Never use dynamic SQL identifiers**: No `sql(\`DELETE FROM ${tableName}\`)`. Always write explicit queries with tagged template literals.
2. **Never add per-file CORS headers**: CORS is handled centrally in `middleware.js`. If a new origin needs access, add it to `ALLOWED_ORIGINS` in middleware.js.
3. **Rate-limit sensitive public endpoints**: Any new unauthenticated endpoint that sends emails, SMS, or costs money must be rate-limited.
4. **Don't expose error internals**: Never send `err.stack` or raw SQL errors to clients. Use `{ error: 'Human message', details: err.message }` at most.
5. **Keep security headers in middleware.js**: Don't set or override security headers in individual API files.
6. **Index all new FK columns**: Every new foreign key column must have a corresponding `CREATE INDEX IF NOT EXISTS` in `db/migration.sql`.

## InstructorBook (April 2026)

The platform is being launched nationally as **InstructorBook** (instructorbook.co.uk) — an independent SaaS brand for driving schools. CoachCarter is school #1 in the InstructorBook network.

**Key principles:**
- **One codebase, two front doors** — InstructorBook and CoachCarter share API, database, and backend. Different presentation layers.
- **InstructorBook is invisible to learners** — learners on coachcarter.uk (or any school) never see "InstructorBook." School brands are primary.
- **InstructorBook is independent** — not publicly tied to Fraser or CoachCarter. Competing schools must trust it as a neutral platform.
- **Feature flags per school** — `schools.config` JSONB controls which features are enabled (e.g., `learnerbook_enabled`). CoachCarter has everything; new InstructorBook schools get booking/payments only.
- **Pricing: Model D** — free to use, 0.75% fee on automated weekly payouts.
- **Full strategy in `INSTRUCTORBOOK-PLAN.md`** — pricing analysis, competitive landscape, marketplace phasing, brand architecture, implementation priorities.

## Working practices

- Small fixes: commit directly to main
- Bigger features: feature branch + PR
- Never commit .env files or secrets
- DB migrations: run via `GET /api/migrate?secret=MIGRATION_SECRET`
- **Before pushing to main**, update the relevant docs for any non-trivial change:
  - `PROJECT.md` — API actions, DB table descriptions, flow docs
  - `DEVELOPMENT-ROADMAP.md` — new feature entry with date, description, files changed
  - `MIGRATION-PLAN.md` — if new tables, API routes, or shared modules were added
  - `CLAUDE.md` — if new conventions, env vars, or important design decisions were introduced

## Error alerting

> For full env var list, see [PROJECT.md](PROJECT.md).

`api/_error-alert.js` sends email on 500 errors. All API files call `reportError()` before `res.status(500)`. Requires `ERROR_ALERT_EMAIL` env var.

## Stripe Connect & Instructor Payouts

Instructors are paid via Stripe Connect Express accounts. Money flows: learner pays → platform Stripe account → weekly Friday transfer to instructor's connected account.

- `api/connect.js` — onboarding, status, dashboard link, admin invite, dismiss
- `api/cron-payouts.js` — Vercel cron every Friday 9am UTC
- `api/_payout-helpers.js` — shared payout calculation logic
- Eligible bookings: status='completed' OR (status='confirmed' AND 3+ days old)
- `instructor_payouts` + `payout_line_items` tables (UNIQUE on booking_id prevents double-payment)
- Platform owner (Fraser) has payouts dismissed — revenue stays in platform account
- Admin can pause/resume individual instructor payouts from admin portal
- **Two fee models** per instructor (set via admin portal):
  - **Commission** (default): instructor gets `commission_rate` (e.g. 85%) of each lesson price
  - **Franchise fee**: platform takes a fixed `weekly_franchise_fee_pence` per week, instructor keeps the rest. Capped at gross (never goes negative). Set `weekly_franchise_fee_pence = NULL` to revert to commission.

## Setmore → CoachCarter booking transition (live since April 2026)

Fraser is migrating from Setmore (third-party booking) to CoachCarter's built-in booking system. **Both systems run in parallel** during the transition.

**How it works:**
- `api/setmore-sync.js` — cron every 15 min, imports Setmore appointments as real `lesson_bookings`
- Syncs via Setmore REST API (OAuth2, refresh token in `SETMORE_REFRESH_TOKEN` env var)
- Each appointment's `staff_key` maps to the correct CoachCarter instructor via `instructors.setmore_staff_key`
- Learners auto-created or matched by phone/email, linked via `learner_users.setmore_customer_key`
- Idempotent — `lesson_bookings.setmore_key` unique index prevents duplicates
- Imported bookings have `created_by = 'setmore_sync'` and `minutes_deducted = 0` (no balance deduction)
- Service durations subtract Setmore's built-in 30-min buffer (e.g. 120min Setmore = 90min real lesson)
- **Pickup addresses** pulled from Setmore customer profile (`address`, `city`, `postal_code` fields) and stored in `lesson_bookings.pickup_address`. Backfills existing bookings that previously had no address. Customer data cached per `customer_key` to avoid duplicate API calls.

**Instructor DB emails differ from Setmore emails:**
- Fraser: DB has `fraser@coachcarter.uk` (Setmore has `coachcarteruk@gmail.com`)
- Simon: DB has `simon.edw@outlook.com` (Setmore has `simon@coachcarter.uk`)
- Always use instructor `id` (Fraser=4, Simon=6) when updating, not email

**Key rules:**
- Do NOT delete or modify the `setmore_key` column or `idx_bookings_setmore_key` index
- Do NOT add CHECK constraints on lesson_bookings duration — multiple lesson types exist (60, 90, 120, 165 min). A `chk_booking_90_min` constraint was removed in April 2026 because it blocked non-standard durations.
- **Valid booking statuses:** `confirmed`, `completed`, `cancelled`, `rescheduled`, `awaiting_confirmation`, `disputed`, `no_show`. The `lesson_bookings_status_check` CHECK constraint enforces this. If adding a new status, update the constraint in `db/migration.sql`.
- Do NOT send notifications for imported bookings (the sync deliberately skips this)
- Imported bookings block slots automatically — no changes needed in `slots.js`
- The service mapping in `setmore-sync.js` is hardcoded to Fraser's Setmore account — update if services change
- **Edit-booking protection:** Editing a booking sets `edited_at` on the booking. The Setmore sync checks `edited_at` and skips manually edited bookings. Do NOT clear `setmore_key` when editing — the sync needs it to find and skip the booking.
- **Notification toggles:** Both `edit-booking` and `cancel-booking` accept a `notify` param (default true). Instructors can untick "Notify learner" when doing bulk data cleanup.

**Cancellation sync:** The sync also detects cancelled/removed Setmore appointments and marks the corresponding `lesson_bookings` entry as cancelled. Checks both the appointment `status` field and missing appointments (removed from Setmore entirely).

**Welcome emails:** `api/setmore-welcome.js` runs daily at 10am, sending a one-time welcome email with a 7-day magic link to Setmore-created learners who haven't logged in. Tracked via `learner_users.welcome_email_sent_at`.

**Transition plan:** New bookings go through CoachCarter. Existing Setmore clients migrate as lessons complete. Once all clients are on CoachCarter, remove the sync cron and `SETMORE_REFRESH_TOKEN` env var.

## Travel time check

`api/_travel-time.js` provides two modes of travel time checking between pickup postcodes:

**Slot filtering (pre-booking):** `handleAvailable()` in `slots.js` hides slots where the instructor can't travel between adjacent bookings in time. Uses postcodes.io (free, no key) for geocoding + haversine distance estimation. The learner's postcode is passed via `&pickup_postcode=` query param from `book.html`. Formula: gap between slots must be >= estimated drive time + 10 min buffer.

**Booking warning (post-booking):** `handleBook()` in `slots.js` returns `travel_warnings` in the response using OpenRouteService for precise routing. Warning only, does not block.

- Slot filtering requires no API key (uses postcodes.io + distance estimation)
- Booking warnings require `OPENROUTESERVICE_API_KEY` env var (free from openrouteservice.org)
- Threshold configurable per instructor via `instructors.max_travel_minutes` (default 30), editable from admin portal
- Extracts UK postcodes from free-text addresses using regex
- Gracefully degrades — if no postcode provided or API unavailable, all slots show
- Skip booking warning with `?skip_travel_check=true` query param
- API returns `travel_hidden` count when slots are removed by the filter
- `book.html` shows a banner: "X slots hidden due to travel distance from your pickup address"
- `book.html` shows an inline postcode prompt above the slot feed for learners without a pickup_address; saves to profile and re-fetches with travel filter
- `setmore-sync.js` step 5d backfills `learner_users.pickup_address` from the learner's most recent booking if their profile field is empty

## Booking page (slot feed — April 2026)

`book.html` uses a "next available" slot feed instead of a calendar. Do NOT re-add calendar views (weekly/monthly/daily were intentionally removed).

- **Slot feed:** Flat scrollable list of available slots sorted by date+time. No empty hours, no grid. Each card shows date, time, instructor, lesson type colour.
- **Lesson type pill bar:** Sticky bar below header. Compact pills with type name, duration, price. Selecting a type re-fetches slots.
- **Progressive loading:** 14 days at a time. "Show more slots" button loads the next 14 days (max 90).
- **Instructor filter:** Dropdown in toolbar filters slots by instructor.
- **URL parameters:** `?instructor=X` pre-selects instructor filter, `?type=slug` pre-selects lesson type. Both work for unauthenticated visitors.
- **Guest checkout:** Unauthenticated users can book without creating an account. The modal shows guest fields (name, email, phone, pickup address, terms). Account created server-side before Stripe payment via `checkout-slot-guest` action. Existing webhook handles booking creation unchanged.
- No view toggles, no date navigation arrows, no cursor state.

## Navigation design (app mode — March 2026)

The site is designed as an app experience. Do NOT re-add any of the removed items.

**Start page (`/`)**: Role selection — "I'm a Learner" or "I'm an Instructor". No other links.

**Mobile layout**: Top header bar with hamburger to open sidebar. Fixed bottom bar with 5 tabs that never change.

**Fixed bottom tabs (learner)**: Home | Lessons | Practice | Learn | Profile
- Each tab links to the first page in that group (Home → dashboard, Lessons → book, Practice → log-session, Learn → videos)
- Active tab highlights orange based on which section the current page belongs to
- Subsection navigation (e.g. Book vs Buy Credits vs Upcoming) via the sidebar collapsible groups

**Sidebar groups (learner)**:
- Dashboard (standalone)
- Lessons → Book, Buy Credits, Upcoming
- Practice → Log Session, Mock Test, My Progress
- Learn → Videos, Examiner AI, Quiz
- My Profile (standalone, auth-gated)
- Accordion behaviour — one group open at a time; auto-expands to current section on page load

**Fixed bottom tabs (instructor)**: Dashboard | Calendar | Learners | Earnings | Profile
- Dashboard (`/instructor/dashboard.html`) — compact no-scroll view of today's lessons + "Book Lesson" action
- Calendar (`/instructor/`) — full calendar with monthly/weekly/agenda views. Agenda is the default view on load. Do NOT re-add daily view or hour-slot grids
- Q&A is accessible from the sidebar only (not in bottom tabs)

**Sidebar items (instructor)**:
- Dashboard, Calendar, Availability, My Learners, Earnings
- (divider)
- Q&A, Profile

**Desktop**: Fixed 240px sidebar with the same collapsible group structure. No bottom bar.

**Intentionally removed** (do NOT re-add):
- Pricing page / tab
- Lesson Advisor
- Privacy Policy tab (page still exists, just not in nav)
- Terms tab (page still exists, just not in nav)
- Q&A as a bottom tab (moved to sidebar only — April 2026)
- Old `.site-nav` dark top bar on any page (sidebar.js handles all nav)
- Old `.bottom-nav` inline bottom bar on any page (sidebar.js handles all nav)
- Old `.sub-tabs` on learner booking/buy-credits pages (sidebar handles navigation)
- Quick-access pill row and action cards on instructor dashboard (sidebar duplicates these)
- Calendar sync banner on booking/dashboard pages (accessible via profile or success modal)
- Menu/hamburger as a bottom tab (sidebar opened via top header hamburger instead)
- Videos in Learn section navigation (page still exists at `/learner/videos.html`, just not in nav — April 2026)
- Hour-slot time grid on instructor daily calendar (replaced with compact lesson list — April 2026)
- Daily view tab on instructor calendar (removed April 2026 — agenda absorbs its function, with today-anchor scroll and "Today" button; daily was redundant)

## Migration awareness (React Native app planned)

This codebase is being prepared for migration to a React Native (Expo) app. See `MIGRATION-PLAN.md` for the full plan. When making changes, follow these principles:

**Before any architectural decision**, consider: "Will this be straightforward to port to React Native?"

1. **Keep logic server-side** — API routes should do the heavy lifting. Frontend should be a thin display layer that fetches and renders. Don't put business logic in HTML/JS that will need rewriting.
2. **Use `?action=` routing consistently** — every new API endpoint must follow the existing pattern. The app will use the same endpoints.
3. **Don't add web-only dependencies** — avoid new libraries that only work in browsers (e.g. DOM-specific, canvas-only). If you must, isolate them so the data layer is reusable.
4. **Keep `competency-config.js` as the single source of truth** — this will be ported to TypeScript for the app. Any skill/category changes must happen here first.
5. **Standardise API responses** — new endpoints should return `{ ok: true, ...data }` for success and `{ error: true, code: 'MACHINE_READABLE', message: '...' }` for errors.
6. **No new auth patterns** — use the existing `verifyAuth()` from `_shared.js`. Don't create alternative auth flows.

**When making structural changes** (new tables, new API routes, new shared modules, competency changes), update `MIGRATION-PLAN.md` to reflect the current state.

## Docs

- `PROJECT.md` — complete project reference (APIs, tables, flows, env vars, design system)
- `DEVELOPMENT-ROADMAP.md` — full feature history, roadmap, and competitor differentiators
- `DESIGN-REVIEW.md` — UI/UX design principles, style guide, component standards
- `MIGRATION-PLAN.md` — React Native app migration plan (keep updated)
- `INSTRUCTORBOOK-PLAN.md` — InstructorBook national SaaS strategy, pricing, competitive analysis, marketplace phasing
