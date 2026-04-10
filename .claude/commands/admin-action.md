---
description: Start a session for adding a new admin action (create, update, delete on any user data)
argument-hint: [short description of the admin action]
---

I'm adding a new admin action: **$ARGUMENTS**

Admin actions that mutate user data have extra rules. Before writing any code, read `CLAUDE.md` and `docs/gdpr.md`, then confirm you will follow these rules:

1. **Audit log is mandatory** — call `logAudit(sql, { admin_id, action, target_type, target_id, details, school_id })` from `api/_audit.js`. No exceptions.
2. **Tenant scoping** — use `requireAuth(req, { roles: ['admin', 'superadmin'] })` and filter every query by `school_id`. Superadmins can override via `?school_id=X`.
3. **Never hard-delete credit/financial records** — anonymize with `learner_id = NULL, anonymized = true`.
4. **Rate limiting** — if the action sends emails, SMS, or calls a paid API, rate-limit it (see the `rate_limits` DB table pattern in `magic-link.js`).
5. **Error shape** — return `{ ok: true, ... }` or `{ error: true, code, message }`. Never leak `err.stack` or raw SQL errors.
6. **`?action=` routing** — add to the appropriate `api/admin.js` or `api/schools.js` action dispatcher.

**Files likely relevant:**
- `api/_auth.js` — `requireAuth`, `getSchoolId`
- `api/_audit.js` — `logAudit` helper
- `api/admin.js` — existing admin action dispatcher (pattern reference)

**Before committing, verify:**
- [ ] `logAudit()` called with correct `target_type` and `target_id`
- [ ] Every query filters by `school_id`
- [ ] Rate-limited if it sends email/SMS/costs money
- [ ] Error responses don't leak internals
- [ ] `PROJECT.md` updated with the new action
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `api/_audit.js` and one existing admin action in `api/admin.js` as a pattern, then summarise your plan.
