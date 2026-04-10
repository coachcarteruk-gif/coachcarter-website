---
description: Start a session for a small bug fix (no new schema, no new routes, no new tables)
argument-hint: [short description of the bug]
---

I'm doing a quick bug fix: **$ARGUMENTS**

This is a small change — no new tables, no new API routes, no schema migrations. If it turns out to need any of those, stop and use a more specific command (`/tenant-feature`, `/api-endpoint`, `/schema-migration`).

Before touching anything, confirm:

1. **Start from latest main** — `git checkout main && git pull origin main`. Do NOT continue on an old feature branch.
2. **Small fixes commit directly to main** — per working practices. No feature branch needed unless this grows.
3. **Don't expand scope** — fix the reported bug. Don't refactor. Don't add a feature. If you find related problems, report them but don't fix them in the same commit.
4. **Tenant safety still applies** — if the fix touches SQL, every query still needs `WHERE school_id = ${schoolId}`.
5. **Don't re-add removed features** — if the bug report sounds like "X is missing from nav", check `CLAUDE.md` first. It was probably removed intentionally.
6. **Async discipline** — always `await` before `res.json()`. Vercel kills functions after response.
7. **Error shape** — don't leak `err.stack` or raw SQL errors. `{ error: 'Human message' }` at most.

**Before committing, verify:**
- [ ] Actually on `main`, not some old branch
- [ ] Only the minimum change needed to fix the bug
- [ ] Tenant scoping still correct
- [ ] No removed feature re-added
- [ ] Commit message is specific (e.g. `fix(slots): handle null pickup_postcode` not `fix bug`)

Now tell me the exact symptom and where it's happening, and I'll find the root cause before suggesting a fix.
