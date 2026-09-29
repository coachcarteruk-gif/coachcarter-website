# CoachCarter worker rules

Multi-tenant driving-school SaaS: vanilla HTML/CSS/JS, Vercel serverless APIs and Neon Postgres. This is the shared rulebook for code agents. Read only the task-relevant documents below; neither `CLAUDE.md` nor the whole `PROJECT.md` is an additional prerequisite.

## Working safely

- Inspect Git status and preserve existing work. Start new code changes and non-trivial documentation work on a fresh `codex/` branch from latest `main`; use an isolated worktree when needed. Read-only audits need no branch switch. Explicit continuation of existing work stays on its branch.
- Keep changes scoped. Never commit secrets, `.env` files, local agent folders or temporary output.
- Change production JS, API routes, migrations or money paths only within the requested task. Add focused tests for changed money, tenancy or auth behavior; use checks proportionate to other changes.
- A code change or merge does not authorise production migrations, feature activation, refunds or payouts. Preserve the applicable operational gates.

## Core contracts

- Scope tenant tables, queries, joins and mutations by authorised `school_id`. Auth context must carry school scope. Use `api/_auth.js::requireAuth` with appropriate roles and the existing tenant helpers; new public endpoints use `api/_tenant.js`.
- Auth tokens belong in httpOnly cookies; localStorage is display-only. Learner/instructor sign-in uses email codes, not new password fields. Preserve legacy compatibility and support impersonation rules.
- Price on the server. Never trust client prices, discounts, payment amounts or instructor scope. Preserve Stripe metadata, idempotency and immutable accounting ledgers.
- Ordinary Lesson Credit is instructor-scoped in `learner_credit_balances`; `learner_users.balance_minutes` is an aggregate/display shadow. Self-serve Lesson Credit purchasing is retired. Flexible Hours uses separate sources/allocations. Preserve historical settlement, spending and returns.
- Use `api/_booking-status.js` constants/predicates for backend booking control flow: `scheduled`, `chargeable`, `refunded`. Instructors are paid for calendar lessons unless the learner gave 48h+ notice; late cancellations remain payable. Do not restore dual confirmation.
- Do not broaden refunds, credit mutations, payout eligibility, transfers or platform-balance semantics without explicit task scope. Never silently rewrite historical financial facts.
- Await asynchronous work before returning an API response. Keep required persistence and best-effort notification failure handling distinct.
- Use shared auth, consent and security helpers. Rate-limit unauthenticated costly endpoints; never expose raw exceptions, SQL errors or login account-existence leaks. Audit auth/password and admin data mutations. Include new PII in export, deletion and retention handling; anonymise retained financial records.
- Keep commercial values configurable. Preserve server pricing precedence and product-specific discounts. Deferred franchise automation stays deferred until its documented triggers are met.
- Preserve school branding and intentional product removals. Check the navigation contract before restoring apparently missing UI.

## Read for the task

Use [the topic map](docs/README.md) for detailed references and specialist gates.

| Task | Start here |
|---|---|
| Pages, navigation, removed features | [Navigation](docs/navigation.md) |
| Auth, tenants, PII, tracking | [Security](docs/security.md), [tenancy](docs/multi-tenancy.md), [GDPR](docs/gdpr.md), as applicable |
| APIs, schema, architecture | [Development conventions](docs/development-conventions.md); [migration governance](docs/migration-governance.md) for schema changes |
| Booking, requests, offers, extensions | [Booking contracts](docs/booking-contracts.md), plus the affected funding contract |
| Credit/balance meaning or mutation, pricing, packages | [Topic map: money and products](docs/README.md#money-and-products) |
| Refunds, payouts, Simon launch | [Topic map: refunds-and-payouts](docs/README.md#refunds-and-payouts) |
| Setmore/imports | [Setmore](docs/setmore-sync.md) |

Pure styling/copy changes need financial references only if they change balance meaning, amounts, entitlements or payment claims. If that is uncertain, read the contract. Keep detailed contracts and rollout history in topic documents; update this file only for shared rules or reading triggers.
