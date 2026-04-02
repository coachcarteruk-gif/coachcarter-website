# CoachCarter Website

Driving school website for CoachCarter (coachcarter.uk). Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Project structure

- `public/` — Static HTML pages (learner portal in `public/learner/`, instructor in `public/instructor/`, admin in `public/admin/`)
- `api/` — Vercel serverless functions. Files prefixed with `_` are shared utilities (not endpoints)
- `db/migration.sql` — Single idempotent migration file defining all 26 tables
- `public/shared/` — Shared CSS (learner.css, instructor.css) and auth JS (learner-auth.js, instructor-auth.js)
- `public/sidebar.js` — Context-aware sidebar nav used on all pages
- `public/competency-config.js` — 10-category DL25 framework (39 sub-skills) shared across 6 features

## Key conventions

- API routes use `?action=` routing (e.g. `/api/slots?action=book`)
- Auth: JWT stored in localStorage (`cc_learner`, `cc_instructor`, `cc_admin`)
- Frontend auth via `window.ccAuth` from shared auth JS files
- All new pages must include `sidebar.js`
- Phone numbers stored as UK format (07xxx), converted to +447xxx at send time
- Always `await` async operations before `res.json()` — Vercel kills functions after response

## Working practices

- Small fixes: commit directly to main
- Bigger features: feature branch + PR
- Never commit .env files or secrets
- DB migrations: run via `GET /api/migrate?secret=MIGRATION_SECRET`

## Important env vars

`POSTGRES_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ANTHROPIC_API_KEY`, `MIGRATION_SECRET`, `ERROR_ALERT_EMAIL`, `STAFF_EMAIL`, `ADMIN_SECRET`, `BASE_URL`, `SETMORE_REFRESH_TOKEN`, `OPENROUTESERVICE_API_KEY`

## Error alerting

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
- Do NOT send notifications for imported bookings (the sync deliberately skips this)
- Imported bookings block slots automatically — no changes needed in `slots.js`
- The service mapping in `setmore-sync.js` is hardcoded to Fraser's Setmore account — update if services change

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
- `book.html` shows an inline postcode prompt above the calendar for learners without a pickup_address; saves to profile and re-fetches with travel filter
- `setmore-sync.js` step 5d backfills `learner_users.pickup_address` from the learner's most recent booking if their profile field is empty

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

**Fixed bottom tabs (instructor)**: Calendar | Learners | Q&A | Profile

**Desktop**: Fixed 240px sidebar with the same collapsible group structure. No bottom bar.

**Intentionally removed** (do NOT re-add):
- Pricing page / tab
- Lesson Advisor
- Privacy Policy tab (page still exists, just not in nav)
- Terms tab (page still exists, just not in nav)
- Q&A (hidden for now)
- Dashboard as a permanent bottom tab
- Menu/hamburger as a bottom tab (sidebar opened via top header hamburger instead)

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

- `MIGRATION-PLAN.md` — React Native app migration plan (keep updated)
- `DEVELOPMENT-ROADMAP.md` — full feature history and roadmap
- `PROJECT.md` — complete project reference (APIs, tables, flows)
- `COMPETITOR-FEATURES-ROADMAP.md` — competitor-inspired features (all 17 done)
