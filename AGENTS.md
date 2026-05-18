# Repository Working Rules

## Read This First: Main Stays Untouched Until Approved

For the repo health audit remediation, do not merge anything into `main` just because a focused fix PR is ready.

- `main` remains untouched until the user explicitly approves a merge plan.
- PR #147 / `audit/coachcarter-website-repo-health` is the audit planning home only.
- Remediation branches are opened as draft PRs into `main` for review, but they must stay unmerged.
- If combined testing is needed before touching `main`, use `integration/audit-fixes-preview` as a disposable preview branch.
- The integration branch is not the source of truth. Focused remediation branches remain the units of review.
- Do not suggest merging a remediation PR into `main` unless the user has explicitly asked to start merging.

## General Branch Rules

- Never commit directly to `main`.
- Create a branch for every audit, fix, feature, or chore.
- Open a pull request for changes intended for `main`.
- Keep audit-only notes on `audit/...` branches.
- Keep code changes scoped to `fix/...`, `feature/...`, or `chore/...` branches.
- Ask before merging pull requests.

## Audit Remediation Branch Strategy

- Keep `audit/coachcarter-website-repo-health` and PR #147 as the audit planning home.
- Use the audit branch only for documentation-only audit notes, status updates, and decision logs.
- Do not put code fixes on the audit branch.
- Create every remediation branch from the latest `origin/main`, even while `main` remains unmerged/untouched.
- Open remediation work as focused draft PRs into `main`; leave them unmerged until explicitly approved.
- Keep each fix PR scoped to one risk class or one small operational surface.
- Use an optional `integration/audit-fixes-preview` branch only as a disposable combined testing branch. Do not treat it as the source of truth.
- After a fix PR merges, update the audit planning branch with the PR number, what changed, and any remaining risk.
