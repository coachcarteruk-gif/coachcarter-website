# CoachCarter Website

Driving school website for CoachCarter (coachcarter.uk). Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Project structure

- `public/` — Static HTML pages (learner portal in `public/learner/`, instructor in `public/instructor/`, admin in `public/admin/`)
- `api/` — Vercel serverless functions. Files prefixed with `_` are shared utilities (not endpoints)
- `db/migration.sql` — Single idempotent migration file defining all 23 tables
- `public/shared/` — Shared CSS (learner.css, instructor.css) and auth JS (learner-auth.js, instructor-auth.js)
- `public/sidebar.js` — Context-aware sidebar nav used on all pages
- `public/competency-config.js` — 17-skill DL25 framework shared across 6 features

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

## Docs

- `DEVELOPMENT-ROADMAP.md` — full feature history and roadmap
- `PROJECT.md` — complete project reference (APIs, tables, flows)
