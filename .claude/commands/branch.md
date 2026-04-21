---
description: Create a new feature branch from latest main and start the Vercel dev server at localhost:3000
argument-hint: [short branch name, kebab-case — e.g. cancel-reason-field]
---

Fraser wants to start working on a new branch: **$ARGUMENTS**

Your job is to set him up to edit and test locally. Follow these steps in order — do NOT skip the safety checks.

## Step 1 — Decide the branch name

If `$ARGUMENTS` is empty or vague ("test", "stuff", "changes"), ask him what the feature is in one sentence before creating anything. A good branch name is kebab-case and describes the feature, not the action — e.g. `cancel-reason-field`, not `add-cancel-reason`.

If `$ARGUMENTS` looks sensible, use it as-is (lowercase, replace spaces with hyphens).

## Step 2 — Safety checks before creating the branch

Run these in parallel and **stop and report** if any of them reveal a problem:

1. `git status` — if there are uncommitted changes on the current branch, STOP. Ask Fraser whether to stash, commit, or discard them. Never silently carry changes onto a new branch.
2. `git branch --show-current` — note what he's on now.
3. `git branch --list "<name>"` — if the branch already exists locally, STOP and ask whether to switch to it or pick a different name.

## Step 3 — Create the branch from latest main

Only once Step 2 is clean:

1. `git checkout main`
2. `git pull origin main` — always start from the freshest main, per `CLAUDE.md`.
3. `git checkout -b <name>` — creates the branch and switches to it.
4. Confirm with `git branch --show-current`.

## Step 4 — Check the Vercel dev server

The dev server runs on http://localhost:3000. Check if it's already up:

1. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` — if it returns `200`, the server is already running. Don't start a second one (port conflict).
2. If it's not running:
   - Verify `.env.local` exists. If not, remind Fraser to run `vercel env pull .env.local --environment=production --yes` (or offer to do it).
   - Start it in the background: `vercel dev --listen 3000` via Bash with `run_in_background: true`.
   - Wait a few seconds, then `curl` the homepage to confirm it came up.

## Step 5 — Brief Fraser

Once the branch is created and the server is up, tell him:

- Which branch he's now on (e.g. `cancel-reason-field`)
- The URL: http://localhost:3000
- That switching branches (`git checkout main` / `git checkout <branch>`) changes which version localhost serves — same URL, just refresh
- Reminders about the live data in `.env.local`:
  - `DATABASE_URL` is **prod Neon** — real bookings, real learners
  - Resend and Twilio will send **real** emails/SMS if triggered
  - Stripe he already said he avoids (manual credits instead)
- When ready to ship: commit → push → open a PR. Don't merge into main from his machine — let the PR flow happen on GitHub.

## Session metadata

Call `mcp__nimbalyst-session-naming__update_session_meta` with a descriptive name based on what the branch is for, phase `implementing`, and tag `feature` (plus any area tag like `booking`, `admin`, `setmore`).

## Do NOT

- Do NOT branch off whatever he's currently on — always off fresh `main`.
- Do NOT delete or overwrite uncommitted changes without asking.
- Do NOT start a second `vercel dev` process if one is already running.
- Do NOT run migrations or hit any `?secret=MIGRATION_SECRET` endpoint as part of setup.
