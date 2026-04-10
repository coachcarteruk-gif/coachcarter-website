---
description: Start a session for adding or changing any field/table containing personal data (GDPR-sensitive)
argument-hint: [short description of the PII change]
---

I'm adding or changing PII: **$ARGUMENTS**

This is GDPR-sensitive. Before writing any code, read `CLAUDE.md` and `docs/gdpr.md`, then confirm you will follow these rules:

1. **Data export** — if this adds a new PII column or table, update `handleExportData()` in `api/learner.js` so learners can still export all their data.
2. **Deletion cascade** — if this adds a table referencing `learner_users`, add it to the cascade in both `handleConfirmDeletion()` (learner.js) and `cron-retention.js`.
3. **Never hard-delete credit/financial records** — always anonymize (`learner_id = NULL, anonymized = true`). 7-year legal retention.
4. **school_id** — if this is a new table, it's also tenant-scoped (see `docs/multi-tenancy.md`).
5. **Retention policy** — does this data have a lifetime? If yes, add cleanup logic to `api/cron-retention.js`.
6. **Third-party processors** — if a new external service will see this data, list it in `public/privacy.html` and consider whether it needs new consent.
7. **Audit log** — if admins can mutate this field, the action must call `logAudit()` from `api/_audit.js`.

**Files likely relevant:**
- `api/learner.js` — `handleExportData`, `handleRequestDeletion`, `handleConfirmDeletion`
- `api/cron-retention.js` — deletion cascade + retention
- `api/_audit.js` — admin action logging
- `public/privacy.html` — if adding a new processor
- `db/migration.sql` — if new columns/tables

**Before committing, verify:**
- [ ] Data export includes the new field/table
- [ ] Deletion cascade includes the new table
- [ ] Retention policy decided (or explicit "no lifetime" note)
- [ ] `public/privacy.html` updated if a new processor was added
- [ ] `PROJECT.md` updated
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `api/learner.js` (export + deletion functions) and `api/cron-retention.js`, then summarise your plan before writing code.
