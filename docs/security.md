# Database & API Security (April 2026)

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when touching auth, middleware, headers, CORS, rate limiting, or DB indexes.

## What's in place

- **Security headers** — HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy set on every response via `middleware.js`
- **Centralised CORS** — Handled in `middleware.js`. Only allows `coachcarter.uk`, `coachcarter.co.uk`, Vercel previews, and localhost. Individual API files no longer set CORS headers.
- **Parameterized SQL only** — All queries use tagged template literals (`` sql`...` ``). No dynamic table/column name interpolation.
- **Rate limiting** — Magic link sends limited to 5 per email/phone per hour via `rate_limits` DB table.
- **SSL/TLS** — Neon serverless library connects over HTTPS by default. No raw TCP.
- **No credential exposure** — `POSTGRES_URL` never logged or sent to clients.

## Instructor session persistence (23 September 2026; pending rollout)

Normal instructor sessions last 180 days; admin support sessions remain two hours.
Before support replaces `cc_instructor`, its original non-impersonation token is
saved in `cc_instructor_return` (HttpOnly, Secure, SameSite=Lax, host-only, Path=/),
with its remaining lifetime. This cookie is deliberately excluded from general
auth cookie selection. Only POST `stop-instructor-access`, with matching CSRF,
may restore it. The route verifies signature/expiry, school and active account,
returns server-loaded display data, and audits recovery even when the support
cookie has expired. A repeat exit does not delete an already-restored login.
New support tokens cannot mint a replacement from return identity metadata;
the legacy path only supports pre-rollout live sessions. Fresh instructor login
and explicit instructor logout clear the saved token.

The admin Back to Portal button preserves login. Network errors, 429 and 5xx
verification responses never invoke logout. Support-exit failures leave the
display state intact for retry; a confirmed 401 returns to login without sending
another logout request. Tests: `tests/instructor-session-persistence.spec.js`
(including a real Chromium cookie-restoration check), existing support-access
and email-code-login specs.

## Database performance

- 28 indexes on FK columns and common query patterns (added April 2026)
- Key composite indexes:
  - `lesson_bookings(school_id, status, scheduled_date)`
  - `lesson_bookings(instructor_id, scheduled_date, start_time)`
  - `lesson_bookings(learner_id, status)`
- Partial indexes on `magic_link_tokens(email)` and `magic_link_tokens(phone)` WHERE NOT NULL
- All new FK columns MUST have an index — check `db/migration.sql` for the pattern
