---
description: Classify a draft prompt and recommend which session template (slash command) to use
argument-hint: [draft prompt you were about to send]
---

I'm about to start work on something but I'm not sure which session template to use. Here's what I was going to ask you:

> $ARGUMENTS

**Your job is to classify this and recommend a slash command.** Do NOT start the work yet — just recommend.

## Available commands

- `/tenant-feature` — new table, query, or feature scoped to a school (rules: `school_id`, `requireAuth`, index FKs)
- `/pii-change` — adding/changing any field containing personal data (rules: GDPR export, deletion cascade, retention, audit)
- `/admin-action` — new admin mutation on user data (rules: audit log, tenant scoping, rate limit if external side-effects)
- `/api-endpoint` — new API route or `?action=` action (rules: `?action=` routing, response shape, rate limit, CORS central, parameterized SQL)
- `/booking-work` — anything on `book.html` or `api/slots.js` (rules: no calendar views, no view toggles, progressive loading, guest checkout)
- `/nav-change` — sidebar, bottom tabs, or page layout (rules: "intentionally removed" list, fixed tab counts, sidebar.js single source of truth)
- `/setmore-work` — Setmore sync, imports, service mapping (rules: don't touch `setmore_key`, no duration CHECK, no notifications for imports, edit protection via `edited_at`)
- `/payouts-work` — Stripe Connect, cron-payouts, fee models (rules: no double-payment, Fraser dismissed, commission vs franchise, audit admin mutations)
- `/schema-migration` — any change to `db/migration.sql` (rules: idempotent, `school_id` on new tables, index FKs, no duration CHECK, status constraint discipline)
- `/quick-fix` — small bug fix, no schema, no new routes (rules: start from main, minimum change, don't expand scope)

## Reference material

The full rules live in `CLAUDE.md` and `docs/*.md`. The command-to-doc mapping:

- `/tenant-feature` → `docs/multi-tenancy.md`
- `/pii-change` → `docs/gdpr.md`
- `/admin-action` → `docs/gdpr.md` (audit section)
- `/api-endpoint` → `docs/security.md`
- `/booking-work` → `docs/navigation.md` + `docs/travel-time.md`
- `/nav-change` → `docs/navigation.md`
- `/setmore-work` → `docs/setmore-sync.md`
- `/payouts-work` → `docs/stripe-connect.md`
- `/schema-migration` → `docs/multi-tenancy.md` + `docs/security.md`

## Output format

Respond in exactly this structure. Keep it short — this is a router, not a plan.

```
**Primary:** /<command> — <one sentence why>

**Also consider:** /<command> if <condition> (or "None" if single-area)

**Risk flags:** <any rules Fraser is likely to violate based on the draft prompt, or "None">

**Confidence:** <High / Medium / Low>

**If Low confidence**, explain what's ambiguous about the prompt and ask one clarifying question.
```

## Rules for your classification

1. **Prefer specific over general** — if the task touches the booking page, `/booking-work` beats `/quick-fix` even if it's small.
2. **PII is sticky** — if the task involves learners' personal data in any way (name, email, phone, address, notes, progress), `/pii-change` belongs in primary or secondary.
3. **Schema changes are sticky** — if the task needs SQL in `db/migration.sql`, `/schema-migration` belongs somewhere.
4. **Admin mutations are sticky** — if an admin will be the one triggering the action, `/admin-action` belongs somewhere.
5. **If the draft prompt contains a red-flag phrase** (drop column, cascade delete, remove from nav, re-add calendar, add CHECK on lesson_bookings duration, skip auth, inline PostHog), surface it in "Risk flags" with the specific rule from `CLAUDE.md`.
6. **Never recommend `/quick-fix`** for anything that touches multi-tenancy, PII, auth, or the booking page — those always need a specific template.
7. **If the prompt is genuinely ambiguous** (e.g. "add a feature for instructors"), set confidence to Low and ask exactly one clarifying question.

Now classify the draft prompt above.
