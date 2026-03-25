# CoachCarter Website

Driving school website for CoachCarter (coachcarter.uk). Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres.

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

## Docs

- `DEVELOPMENT-ROADMAP.md` — full feature history and roadmap
- `PROJECT.md` — complete project reference (APIs, tables, flows)
