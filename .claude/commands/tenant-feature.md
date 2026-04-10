---
description: Start a session for adding a tenant-scoped feature (new table, query, or endpoint)
argument-hint: [short feature description]
---

I'm adding a new tenant-scoped feature: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md` and `docs/multi-tenancy.md`, then confirm you will follow these rules:

1. Any new table MUST have `school_id INTEGER NOT NULL REFERENCES schools(id)` with `DEFAULT 1`
2. Every SQL query on the new table MUST include `WHERE school_id = ${schoolId}`
3. Use `requireAuth` from `api/_auth.js` — never write local auth
4. Any new FK column MUST have a `CREATE INDEX IF NOT EXISTS` in `db/migration.sql`
5. New API endpoints use `?action=` routing and return `{ ok: true, ... }` or `{ error: true, code, message }`
6. If this adds PII, also apply the rules from `docs/gdpr.md` (export + deletion cascade)

**Files likely relevant:**
- `api/_auth.js` — auth + `getSchoolId()`
- `db/migration.sql` — where the new table + index go
- An existing similar API file as a pattern reference (ask me which)

**Before committing, verify:**
- [ ] `school_id` on the table with correct default
- [ ] Every query filters by `school_id`
- [ ] New FK columns are indexed
- [ ] JWT payload (if touched) includes `school_id`
- [ ] `PROJECT.md` updated with the new table/action
- [ ] `DEVELOPMENT-ROADMAP.md` has an entry

Now read the referenced files and summarise your plan before writing any code.
