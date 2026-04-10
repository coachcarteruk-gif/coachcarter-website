# Database & API Security (April 2026)

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when touching auth, middleware, headers, CORS, rate limiting, or DB indexes.

## What's in place

- **Security headers** — HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy set on every response via `middleware.js`
- **Centralised CORS** — Handled in `middleware.js`. Only allows `coachcarter.uk`, `coachcarter.co.uk`, Vercel previews, and localhost. Individual API files no longer set CORS headers.
- **Parameterized SQL only** — All queries use tagged template literals (`` sql`...` ``). No dynamic table/column name interpolation.
- **Rate limiting** — Magic link sends limited to 5 per email/phone per hour via `rate_limits` DB table.
- **SSL/TLS** — Neon serverless library connects over HTTPS by default. No raw TCP.
- **No credential exposure** — `POSTGRES_URL` never logged or sent to clients.

## Database performance

- 28 indexes on FK columns and common query patterns (added April 2026)
- Key composite indexes:
  - `lesson_bookings(school_id, status, scheduled_date)`
  - `lesson_bookings(instructor_id, scheduled_date, start_time)`
  - `lesson_bookings(learner_id, status)`
- Partial indexes on `magic_link_tokens(email)` and `magic_link_tokens(phone)` WHERE NOT NULL
- All new FK columns MUST have an index — check `db/migration.sql` for the pattern
