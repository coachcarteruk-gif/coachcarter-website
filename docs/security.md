# Database & API Security (April 2026)

## Authentication contract

Learner and instructor user-facing sign-in uses a 6-digit email code. Admins retain password authentication. Legacy learner/instructor password columns and endpoints remain for compatibility with old accounts, password-reset links, and accepted-offer flows, but must not be reintroduced into the primary learner or instructor login UI.

**Per-role auth model:**

- **Learner** — existing accounts sign in with an email code. People whose lesson/trial was arranged outside the system create a zero-credit account by verifying their email code; they do not choose a password and do not receive another trial entitlement. `api/magic-link.js`, `api/learner-auth.js`.
- **Instructor** — invite-only (no public signup); the current login UI uses an email code. Legacy admin-set password support remains compatibility-only.
- **Admin** — password login in `api/admin.js`, with code-based self-serve password reset.

**Hard rules:**

1. **Do not add password fields to learner or instructor signup/sign-in UI.** Use `send-email-code` / `verify-email-code`; retain legacy password endpoints only while old flows still depend on them.
2. **Keep login enumeration-safe.** Existing-account code requests always return generic copy. Account creation may return `account_exists` because the person explicitly chose the signup path.
3. **Purpose-bind verification.** Existing-account `purpose: 'login'` verification may issue the session directly. New learner `purpose: 'signup'` verification returns a 5-minute `audience: 'learner-signup'` ticket, which `signup-with-code` consumes before creating the account and session.
4. **Offline lesson/trial signup grants zero credit.** It must not insert a free-trial credit transaction or silently create another trial entitlement.
5. **Use 6-digit codes inside the PWA**, not clickable login links; links open in the OS browser and break session continuity.
6. **Auth state mutations are audit-logged.** This includes passwordless learner account creation (`learner.signup`, method `email_code`) and every retained password mutation.
7. **Use `api/_password.js` for retained password operations.** Never roll a local password hash or lockout implementation.
8. **Admin support access to instructor accounts uses impersonation, not passwords.** Do not reveal, reuse, or reset an instructor password just so admin can access their portal.

> Read this contract for auth, middleware, headers, CORS, rate limiting or DB indexes. Shared repository rules live in [AGENTS.md](../AGENTS.md).

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
- All new FK columns MUST have an index — follow [migration governance](migration-governance.md) for new schema changes

## Database and API maintenance rules

1. **Never use dynamic SQL identifiers**: No `` sql(`DELETE FROM ${tableName}`) ``. Always write explicit queries with tagged template literals.
2. **Never add per-file CORS headers**: CORS is handled centrally in `middleware.js`. If a new origin needs access, add it to `ALLOWED_ORIGINS` in middleware.js.
3. **Rate-limit sensitive public endpoints**: Any new unauthenticated endpoint that sends emails, SMS, or costs money must be rate-limited.
4. **Don't expose error internals**: Never send `err.stack` or raw SQL errors to clients. Return a safe public message; keep exception details in server-side diagnostics. Do not expose `err.message` indiscriminately.
5. **Keep security headers in middleware.js**: Don't set or override security headers in individual API files.
6. **Index all new FK columns**: Every new foreign key column must have a corresponding `CREATE INDEX IF NOT EXISTS` in the governed migration. Follow [migration governance](migration-governance.md); the aggregate file is not authority for new migrations.
7. **No inline `<script>` tags on public pages**: Production CSP `script-src` does not allow `'unsafe-inline'` (verify in `middleware.js`). Inline `<script>foo()</script>` blocks are silently dropped in production but run fine in local preview — easy to ship a regression. Put logic in an external `.js` file and have it auto-detect placeholder elements on load.
