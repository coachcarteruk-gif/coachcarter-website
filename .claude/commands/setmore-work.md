---
description: Start a session for Setmore sync work (imports, cancellations, service mapping)
argument-hint: [short description of the sync change]
---

I'm working on the Setmore sync: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md` (the Setmore "do NOT" rules) and `docs/setmore-sync.md`, then confirm you will follow these hard rules:

1. **Do NOT delete or modify** the `setmore_key` column or `idx_bookings_setmore_key` index.
2. **Do NOT add CHECK constraints** on `lesson_bookings` duration — multiple lesson types exist (60, 90, 120, 165 min).
3. **Valid booking statuses**: `confirmed`, `completed`, `cancelled`, `rescheduled`, `awaiting_confirmation`, `disputed`, `no_show`. If adding a new status, update the `lesson_bookings_status_check` constraint in `db/migration.sql`.
4. **Do NOT send notifications** for imported bookings — the sync deliberately skips this.
5. **Imported bookings block slots automatically** — no changes needed in `slots.js`.
6. **Do NOT clear `setmore_key`** when editing a booking — the sync uses it to find and skip edited bookings (protection via `edited_at`).
7. **Service durations subtract a 30-min buffer** — 120min Setmore = 90min real lesson.
8. **Instructor emails differ** — Fraser DB=`fraser@coachcarter.uk` (Setmore=`coachcarteruk@gmail.com`). Simon DB=`simon.edw@outlook.com` (Setmore=`simon@coachcarter.uk`). Use instructor `id` (Fraser=4, Simon=6), not email.
9. **Service mapping is hardcoded** to Fraser's Setmore account — update if services change.

**Files likely relevant:**
- `api/setmore-sync.js` — the sync cron
- `api/setmore-welcome.js` — daily welcome email
- `api/slots.js` — edit/cancel booking (if touching `edited_at` logic)
- `db/migration.sql` — if changing the status constraint

**Before committing, verify:**
- [ ] `setmore_key` column/index untouched
- [ ] No new CHECK constraint on `lesson_bookings` duration
- [ ] No notifications sent for imports
- [ ] `edited_at` protection still works
- [ ] Idempotency preserved (still safe to re-run)
- [ ] `PROJECT.md` updated if flow changed
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `api/setmore-sync.js` and summarise your plan before writing code.
