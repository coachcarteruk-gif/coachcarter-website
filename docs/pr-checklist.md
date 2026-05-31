# PR Checklist

Use this checklist for normal CoachCarter changes. Keep one thread and one branch
per work item where possible.

## Start

- Start from current `main`.
- Create one scoped `codex/...` branch.
- Check `AGENTS.md` before editing high-risk areas.
- Keep unrelated local files, generated output, and secrets out of the PR.

## Scope

- State the intended change in one or two sentences.
- Touch only files needed for that change.
- For money, credit, refund, payout, auth, tenancy, GDPR, or database work, add
  focused tests for the exact contract being changed.
- Do not revive intentionally removed product surfaces without checking the
  relevant docs first.

## Validate

- Run the narrowest meaningful tests.
- Run syntax or lint checks when frontend or API code changed.
- Run `git diff --check` before publishing.
- Note any checks not run and why.

## PR

- Include a short summary, safety notes, and validation output.
- For high-risk work, ask for a human/code review before merge.
- Merge only after checks pass and the approved scope is still the only scope.
- After merge, return the local workspace to `main` and pull the latest changes.

## Roadmap

- Update `docs/planned-work-register.md` only when a slice actually ships or a
  plan is deliberately changed.
- Keep roadmap updates in the same PR when they are part of the change, or in a
  small follow-up docs-only PR immediately after merge.
