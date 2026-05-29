# CoachCarter Worker Rules

CoachCarter is a multi-tenant driving school SaaS platform. The backend is Vercel serverless API routes with Neon Postgres; the frontend is vanilla HTML/CSS/JS. This file is a short, practical entry point for code agents. For fuller project context, load `CLAUDE.md`, `PROJECT.md`, and the area docs linked below only when they are relevant.

## Start Safe

1. Start from latest `main` and create a fresh branch for non-trivial work.
2. Keep PRs tightly scoped. Do not include opportunistic refactors, generated noise, or unrelated formatting.
3. Do not resurrect removed product surfaces. If navigation, booking UI, waitlist, Q&A, confirmation prompts, or old calendars look "missing", check `CLAUDE.md` and `docs/navigation.md` before changing them.
4. Never commit secrets, `.env` files, local agent folders, or temporary output.

## Production Change Guardrails

- Production JavaScript, API routes, DB migrations, Stripe flows, credit mutation code, refund code, and payout code are high-risk areas. Only change them when the task explicitly calls for it.
- Prefer docs, tests, and read-model clarification before changing money mutation paths.
- When behaviour must change, add focused tests around the exact money, tenancy, or auth contract being touched.
- Always await async work before returning `res.json()` from an API route.

## Tenant Scope

- Every tenant-scoped table and query must be scoped by `school_id`.
- JWTs and auth-derived context must carry `school_id`.
- Learners, instructors, bookings, credits, refunds, payouts, and admin actions must stay within the authenticated school.
- Public endpoints that need school context should accept `?school_id=` or `?school=slug` following existing patterns.

## Money And Credit Rules

- The current credit model is per learner/instructor: `learner_credit_balances(learner_id, instructor_id, school_id, balance_minutes)`.
- Treat `learner_users.balance_minutes` as an aggregate/display shadow, not the source of spendable credit.
- New learner-facing credit purchases must require a same-school active `instructor_id` and price server-side.
- Do not trust client-submitted prices, discounts, Stripe amounts, or instructor scope.
- Preserve Stripe idempotency and metadata contracts for credit purchases, direct booking checkout, offer acceptance, and PaymentIntent flows.
- Read `docs/per-instructor-credits-audit.md` before touching credit purchase, booking deduction, cancellation return, refund execution, reconciliation, admin credit adjustment, platform balance, or balance display behaviour.
- Keep `booking_credit_sources`, `credit_source_adjustments`, `refund_events`, and `refund_event_lines` as accounting ledgers. Do not silently mutate historical financial rows.

## Booking, Refund, And Payout Rules

- Instructor payment depends on the three-state booking lifecycle: `scheduled`, `chargeable`, `refunded`. Use `api/_booking-status.js` constants and predicates in backend control flow.
- The load-bearing rule is: instructors are paid for lessons on their calendar unless the learner gave 48h+ notice.
- Late learner cancellations under 48h leave the booking payable; do not reintroduce dual-confirmation or "did the lesson happen?" prompts.
- Do not broaden automatic Stripe refund execution, BCS refund execution, payout eligibility, Stripe Connect transfers, or platform-balance semantics unless the task explicitly scopes that change.
- Read `docs/booking-statuses.md`, `docs/stripe-connect.md`, `docs/refund-operator-runbook.md`, and `docs/refund-exposure-valuation-audit.md` before changing refund or payout behaviour.

## Pricing And Franchise Rules

- Commercial numbers belong in admin-editable config, DB columns, JSONB, or admin-managed tables, not hardcoded constants.
- Lesson pricing fallback is most-specific first: learner/instructor custom rate, then instructor hourly rate, then school default.
- Bulk-tier discounts are per-instructor opt-in and apply only to future credit-package purchases, not direct pay-and-book single-slot checkout or instructor-created offers.
- Instructors absorb opted-in bulk discounts through the snapshotted effective rate.
- Deferred franchise automation stays deferred until the trigger conditions in `FRANCHISE-MODEL-PLAN.md` are met.

## Auth, Privacy, And Security

- Auth tokens live in httpOnly cookies. LocalStorage copies are display-only and untrusted.
- Use existing auth helpers such as `requireAuth` from `api/_auth.js`; do not create local auth forks.
- Password mutations and admin data mutations must be audit-logged.
- Do not expose raw SQL errors, stack traces, or account-existence leaks to clients.
- New unauthenticated endpoints that send email, SMS, or cost money must be rate-limited.
- New PII fields must be included in GDPR export/deletion handling. Financial records are anonymised for retention, not hard-deleted.

## Docs To Load On Demand

- `CLAUDE.md` - full hard rules and intentionally removed features.
- `PROJECT.md` - API, DB, env, and flow reference.
- `docs/per-instructor-credits-audit.md` - current per-instructor credit safety tracker.
- `docs/multi-tenancy.md` - school scoping and onboarding.
- `docs/booking-statuses.md` - booking lifecycle and payout implications.
- `docs/stripe-connect.md` - payout and Stripe Connect behaviour.
- `MIGRATION-PLAN.md` - React Native portability constraints.
- `FRANCHISE-MODEL-PLAN.md` - franchise/pricing planning and deferred triggers.
