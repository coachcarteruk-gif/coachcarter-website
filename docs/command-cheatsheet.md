# Slash command cheat sheet

> Quick reference for picking a session template. If unsure, type `/suggest <your draft prompt>` and Claude will recommend.

## At a glance

| Command | One-line purpose |
|---|---|
| `/tenant-feature` | New table, query, or feature that's scoped to a school |
| `/pii-change` | Adding or changing any field containing personal data |
| `/admin-action` | New admin mutation (create/update/delete on user data) |
| `/api-endpoint` | New API route or `?action=` action |
| `/booking-work` | Anything on `book.html` or `api/slots.js` |
| `/nav-change` | Sidebar, bottom tabs, or page layout |
| `/setmore-work` | Setmore sync, imports, service mapping |
| `/payouts-work` | Stripe Connect, cron-payouts, fee models |
| `/schema-migration` | Any change to `db/migration.sql` |
| `/quick-fix` | Small bug fix, no schema, no new routes |
| `/suggest` | "I'm not sure which one to use" — Claude recommends |

## Keyword → command

Match what you were about to type against the left column.

| You were about to say… | Use |
|---|---|
| "add a new table for…" | `/tenant-feature` (+ `/pii-change` if it has personal data) |
| "add a column to learner_users / instructors / any learner table" | `/pii-change` |
| "add a column to lesson_bookings" | `/tenant-feature` or `/schema-migration` |
| "create an API endpoint for…" | `/api-endpoint` |
| "add an action to /api/admin" | `/admin-action` |
| "fix the booking page" / "the slot feed is…" | `/booking-work` |
| "add a new tab" / "move X to the sidebar" / "hide X from nav" | `/nav-change` |
| "the Setmore sync isn't…" / "Setmore imports" | `/setmore-work` |
| "Stripe payouts" / "instructor not getting paid" / "franchise fee" | `/payouts-work` |
| "add a migration" / "run this SQL" / "add an index" | `/schema-migration` |
| "small thing — can you fix…" | `/quick-fix` |
| "add a new learner preference" | `/pii-change` (usually) |
| "send a new email to…" | `/api-endpoint` (+ rate limit) |
| "add a new admin button that…" | `/admin-action` |
| "add a new feature flag per school" | `/tenant-feature` |
| "change how the cron runs" | depends on which cron — `/setmore-work`, `/payouts-work`, or `/api-endpoint` |
| "update the data export" | `/pii-change` (data export is GDPR) |
| "add a new booking status" | `/schema-migration` (status CHECK constraint) |
| "change a JWT payload" | `/tenant-feature` (must include school_id) |

## Multi-area tasks — combine templates

Some tasks span multiple areas. In that case, run one command first, then read the rules from the second template's file manually.

| Task shape | Primary | Also load |
|---|---|---|
| New table with PII + admin UI | `/tenant-feature` | `.claude/commands/pii-change.md` + `.claude/commands/admin-action.md` |
| New API that sends an email | `/api-endpoint` | think: rate limit, audit log if admin |
| Migration + new query | `/schema-migration` | `.claude/commands/tenant-feature.md` for the query rules |
| New booking status | `/schema-migration` | `.claude/commands/setmore-work.md` (status constraint affects sync) |
| Change to instructor earnings display | `/payouts-work` | `.claude/commands/booking-work.md` if the booking page is involved |
| New GDPR request type | `/pii-change` | `.claude/commands/api-endpoint.md` for the endpoint + rate limit |

## Red flags — stop and rethink

If your draft prompt contains any of these, pause and pick a template (don't just start):

- "drop column" / "delete table" / "cascade delete" → **never hard-delete credit data**. Use `/schema-migration` and plan anonymization.
- "remove from nav" / "simplify the menu" → check `CLAUDE.md` "Intentionally removed" list first. Use `/nav-change`.
- "re-add the calendar view" → **don't.** It was removed intentionally. Read `docs/navigation.md`.
- "add a CHECK constraint to lesson_bookings" → stop. Duration constraints are forbidden; status has its own constraint. Use `/schema-migration`.
- "skip auth for this" → never. Use `requireAuth` or validate school context via `?school_id=X`.
- "add inline PostHog" → never. Use `posthog-loader.js` (consent-gated).

## Still unsure?

Type `/suggest <your draft prompt>` and Claude will classify the intent, name the relevant rules, and recommend a command (or combination).
