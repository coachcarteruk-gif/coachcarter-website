---
description: Start a session for adding a new API endpoint or action
argument-hint: [short description of the endpoint]
---

I'm adding a new API endpoint: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md`, then confirm you will follow these rules:

1. **`?action=` routing** — extend an existing action dispatcher where possible, instead of creating a new file. e.g. `/api/slots?action=book`, not `/api/book-slot`.
2. **Auth** — use `requireAuth` from `api/_auth.js`. For public endpoints, still validate school context via `?school_id=X` or `?school=slug`.
3. **Tenant scoping** — every query on a tenant-scoped table MUST filter by `school_id`.
4. **Response shape** — success: `{ ok: true, ...data }`. Error: `{ error: true, code: 'MACHINE_READABLE', message: 'Human message' }`. Never leak `err.stack` or raw SQL.
5. **Rate limiting** — if unauthenticated AND sends email/SMS/costs money, rate-limit via the `rate_limits` DB table.
6. **`await` before `res.json()`** — Vercel kills functions after the response. Never fire-and-forget async work after responding.
7. **CORS** — do NOT set per-file CORS headers. `middleware.js` handles it centrally.
8. **Security headers** — do NOT override. `middleware.js` handles them.
9. **Parameterized SQL only** — tagged template literals `` sql`...` ``. No dynamic table/column names.
10. **React Native friendly** — keep business logic server-side. The same endpoint will serve the future RN app.

**Files likely relevant:**
- `api/_auth.js`
- `middleware.js`
- An existing endpoint in the same area as a pattern reference

**Before committing, verify:**
- [ ] Uses `?action=` routing
- [ ] Uses `requireAuth` (or validates school context if public)
- [ ] All queries filter by `school_id`
- [ ] Response shape matches the standard
- [ ] Rate-limited if applicable
- [ ] `PROJECT.md` updated with the new action
- [ ] `DEVELOPMENT-ROADMAP.md` entry added
- [ ] `MIGRATION-PLAN.md` updated if this is a new shared module

Now read the existing file you plan to extend, and summarise your plan before writing code.
