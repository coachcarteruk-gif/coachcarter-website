# memory/

Repo-local operational memory. Read this folder **before** making any changes to credits, payouts, webhooks, crons, or migrations. It is the durable counterpart to `CLAUDE.md` (rules) and the top-level `*-PLAN.md` files (designs).

## How to use it (Codex / future agents)

Paste this as the task preamble:

> Before making any change, read `memory/README.md`, then skim `memory/current-state.md` and `memory/prod-facts.md`. If the task touches credits, payouts, webhooks, crons, or migrations, also read `memory/operator-runbook.md` in full and check `memory/chips.md` for adjacent in-flight work. Use `memory/decision-log.md` to understand *why* the current shape exists before proposing alternatives — superseded entries are kept deliberately so we don't relitigate. Treat any fact tagged `assumption` as needing re-verification against current `main` or prod before you rely on it. Prod writes (any POST to `/api/migrate*`, mutations to `credit_transactions` / `learner_credit_balances` / booking money columns, Stripe configuration changes) require explicit Fraser confirmation — show dry-run output and wait. If the task changes shipped state, prod facts, migration status, or the chip queue, update the relevant memory file in the same PR.

Expanded:

1. Skim `current-state.md` — what is live on prod right now, what has just shipped, what is being watched.
2. Check `prod-facts.md` for any fact you intend to rely on. Treat anything not marked `verified` as an assumption that needs re-checking.
3. If your task touches money flow (credits, payouts, webhooks, refunds, Stripe), read `operator-runbook.md` end-to-end before writing code.
4. Check `chips.md` to see if your task is already on the queue, and to understand adjacent in-flight work.
5. Use `decision-log.md` to understand *why* the current shape exists before proposing changes. Superseded decisions are kept on purpose — do not re-litigate.
6. **If your change moves shipped state, alters a prod fact, advances migration status, or resolves/creates a chip, update the matching `memory/*.md` file in the same PR.** The folder is only useful if it stays current.

For coding-coach sessions, also read `memory/coding-coach.md` before advising on worker prompts, reviews, PRs, or merges.

## What this folder is NOT

- Not a changelog (that's `DEVELOPMENT-ROADMAP.md`).
- Not a design plan (those are `PER-INSTRUCTOR-CREDITS-PLAN.md`, `FRANCHISE-MODEL-PLAN.md`, etc).
- Not a rulebook (that's `CLAUDE.md`).
- Not session narrative. Anything chatty, speculative, or unverified does not belong here.

## Updating

When a fact in here is proven wrong, **do not delete it**. Move it to `decision-log.md` under a "Superseded" entry with the date, what replaced it, and why. The history is load-bearing for credit-math debugging.

When you ship something material, update `current-state.md` and `chips.md` in the same PR. If you introduced a new architectural commitment, add it to `decision-log.md`.
