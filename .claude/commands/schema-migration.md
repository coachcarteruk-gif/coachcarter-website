---
description: Start a session for a database schema migration (new table, new column, new index, constraint change)
argument-hint: [short description of the migration]
---

I'm adding a database migration: **$ARGUMENTS**

Before writing any SQL, read `CLAUDE.md`, `docs/multi-tenancy.md`, and `docs/security.md`, then confirm you will follow these rules:

1. **Idempotent only** — use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. The migration runs via `GET /api/migrate?secret=MIGRATION_SECRET` and must be safe to re-run.
2. **Tenant scoping** — new tables MUST have `school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1`.
3. **Index all FK columns** — every new foreign key needs a corresponding `CREATE INDEX IF NOT EXISTS`.
4. **`lesson_bookings` rules**:
   - Do NOT add CHECK constraints on duration (multiple lesson types: 60, 90, 120, 165 min)
   - If adding a new booking status, update `lesson_bookings_status_check` to include it. Valid statuses: `confirmed`, `completed`, `cancelled`, `rescheduled`, `awaiting_confirmation`, `disputed`, `no_show`.
   - Do NOT touch `setmore_key` or `idx_bookings_setmore_key`
5. **Credit/financial tables** — never add a hard-delete cascade. Use `ON DELETE SET NULL` and anonymize.
6. **GDPR tables** (cookie_consents, audit_log, deletion_requests) MUST have `school_id`.
7. **Parameterized queries only** — no dynamic table/column name interpolation.
8. **Indexes to consider** — if this is a frequently queried combination, add a composite index (e.g. the pattern `lesson_bookings(school_id, status, scheduled_date)`).

**Files likely relevant:**
- `db/migration.sql` — the single migration file
- `api/migrate.js` — the runner

**Before committing, verify:**
- [ ] All statements are idempotent (safe to re-run)
- [ ] `school_id` on any new table
- [ ] All new FK columns indexed
- [ ] Status constraint updated if new status added
- [ ] No CHECK on lesson_bookings duration
- [ ] `setmore_key` untouched
- [ ] `PROJECT.md` updated with new tables/columns
- [ ] `MIGRATION-PLAN.md` updated
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `db/migration.sql` to see the existing patterns, then show me the SQL before running it.
