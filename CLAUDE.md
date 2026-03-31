# CoachCarter Website

Driving school website for CoachCarter (coachcarter.uk). Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Project structure

- `public/` — Static HTML pages (learner portal in `public/learner/`, instructor in `public/instructor/`, admin in `public/admin/`)
- `api/` — Vercel serverless functions. Files prefixed with `_` are shared utilities (not endpoints)
- `db/migration.sql` — Single idempotent migration file defining all 24 tables
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

`POSTGRES_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ANTHROPIC_API_KEY`, `MIGRATION_SECRET`, `ERROR_ALERT_EMAIL`, `STAFF_EMAIL`, `ADMIN_SECRET`, `BASE_URL`

## Error alerting

`api/_error-alert.js` sends email on 500 errors. All API files call `reportError()` before `res.status(500)`. Requires `ERROR_ALERT_EMAIL` env var.

## Navigation design (app mode — March 2026)

The site is designed as an app experience. Do NOT re-add any of the removed items.

**Start page (`/`)**: Role selection — "I'm a Learner" or "I'm an Instructor". No other links.

**Mobile layout**: No top header bar. Bottom bar has 4 tabs: Menu (hamburger) + 3 contextual tabs that change by section.

**Bottom tab sections (learner)**:
- Learn: Videos, Ask the Examiner, Examiner Quiz
- Practice: Log Session, Mock Test, My Progress
- Lessons: Book, Buy Credits, Upcoming
- Profile: Test Readiness, Mock Results, Progress

**Intentionally removed** (do NOT re-add):
- Pricing page / tab
- Lesson Advisor
- Privacy Policy tab (page still exists, just not in nav)
- Terms tab (page still exists, just not in nav)
- Q&A (hidden for now)
- Dashboard as a permanent bottom tab

**Desktop**: Sidebar nav is unchanged.

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
- `COMPETITOR-FEATURES-ROADMAP.md` — competitor-inspired features (15 of 17 done; #15 Waiting List remaining, #16 Google Calendar deferred post-app-launch)
