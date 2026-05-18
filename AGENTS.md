# Repository Working Rules

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
