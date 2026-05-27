# Per-Instructor Credits Audit

Last updated: 2026-05-27

This is the living implementation audit for the move from pooled learner credit
(`learner_users.balance_minutes`) to per-instructor credit balances via
`learner_credit_balances(learner_id, instructor_id, school_id, balance_minutes)`.

Source plans:

- `FRANCHISE-MODEL-PLAN.md` Phase 2 / Thread A
- `PROJECT.md` credit ledger and admin API sections
- `MIGRATION-PLAN.md` payment/refund portability notes
- `docs/stripe-connect.md` refund sections

Maintenance rule:

- Treat this file as the living tracker for per-instructor credits.
- Any implementation slice that changes credit purchase, booking, cancellation,
  refund, reconciliation, admin adjustment, or balance display behaviour should
  update the current-state table and the recommended next slice before commit.

## Executive Summary

Per-instructor credits are implemented across the main learner and operator
credit paths.

The core server booking paths use `learner_credit_balances` and
`booking_credit_sources`, and learner-facing purchase/booking/display surfaces
now carry instructor context. Admin/operator credit surfaces are scoped, and
the refund/reconciliation cleanup has pinned the remaining back-office
contracts.

Biggest risk: platform-balance refund exposure remains advisory because it
still values the legacy aggregate balance at the school rate rather than
valuing each instructor-scoped credit source at its effective rate.

## Current State Table

| Area | File/function | Current data source | Per-instructor safe? | Notes |
|---|---|---|---|---|
| Shared grants | `api/_credit-grant.js` `grantCredits`, `lockBalanceAndMutate`, `lockBalanceAdjustLCB` | LCB in Phase 2A | Mostly yes | Good core helper; LCB writes/guards now include `school_id`. Missing `instructorId` still grandfather-routes to instructor `1` by design during cutover. |
| Credit checkout | `api/credits.js` `handleCheckout` | Required request `instructor_id`; school bulk pricing | Mostly yes | New learner-facing checkout rejects missing, cross-school, inactive, or hidden/demo instructors and writes `instructor_id` to Stripe metadata. Pricing still uses school bulk pricing only; per-instructor rate/bulk opt-in remains Thread B. |
| Credit balance API | `api/credits.js` `handleBalance` | School-scoped LCB rows joined to same-school instructors | Yes | Preserves aggregate `balance_minutes`/`balance_hours`/`credit_balance`, adds per-instructor `balances`, and supports optional validated `instructor_id` with selected balance fields. |
| Credit verify/webhook | `api/webhook.js` `handleCreditPurchase` | Stripe metadata + `grantCredits` | Mostly yes | Purchase completion consumes metadata `instructor_id` and grants to that instructor's LCB row. Legacy/missing metadata still goes to instructor `1` through the shared helper for old Stripe retries. |
| Learner credit booking | `api/slots.js` credit transaction path | LCB + FIFO `credit_transactions` by instructor | Yes | Locks/decrements chosen instructor row, writes BCS and list price. |
| Instructor-created credit booking | `api/instructor.js` credit transaction path | LCB + FIFO CT by instructor | Yes | Same safe shape as learner booking. |
| Cancellations | `api/slots.js`, `api/instructor.js` cancel paths | Booking `instructor_id` + `lockBalanceAdjustLCB` | Mostly yes | Returns credit to original instructor row and marks BCS refunded. Not fully transactional with booking update. |
| Reschedule | `api/slots.js`, `api/instructor.js` reschedule paths | Carries original booking/BCS | Yes | No new balance mutation; copies attribution. |
| Edit booking duration | `api/admin.js`, `api/instructor.js` edit-booking paths | Booking instructor's school-scoped LCB row; mutation uses scoped helper | Mostly yes | Extra-duration precheck no longer reads pooled learner balance. Response text preserved. |
| Admin adjust credits | `api/admin.js` `handleAdjustCredits`, `public/admin/portal.js` | UI requires explicit instructor; server uses school-scoped LCB auto-resolve/explicit instructor | Mostly yes | Server guard is scoped: 0 rows grandfathers to instructor `1`, 1 row auto-resolves, 2+ rows returns `AMBIGUOUS_INSTRUCTOR`, explicit `instructor_id` reads that exact LCB row. Admin UI now chooses an instructor and posts `instructor_id`; response/audit still includes pooled totals for compatibility. |
| Goodwill/reconciliation | `api/_admin-credit-goodwill.js`, `api/_admin-credit-reconciliation.js` | Explicit learner/instructor/school + shared helper | Yes | Strongest admin path; tests already pin scope and mutation shape. |
| Refund executor | `api/_refund-executor.js` | Planner lines + `lockBalanceAdjustLCB` | Yes | Uses `learner_id`/`instructor_id` from trusted plan lines and `school_id` from the admin scope for the LCB decrement; tests pin that caller-supplied scope fields are ignored. BCS execution intentionally disabled. |
| Learner dashboard/profile/sidebar displays | `public/learner/index.js`, `public/learner/profile.js`, `public/sidebar.js` | Aggregate + per-instructor `GET /api/credits?action=balance` data; sidebar localStorage fallback copy | Mostly yes | Dashboard labels aggregate as total across instructors and fetches live balance; profile shows total plus per-instructor rows; sidebar says total credit instead of implying a universally spendable balance. |
| Learner buy UI | `public/learner/buy-credits.js` | Selected public instructor + selected/aggregate balance read | Mostly yes | Direct visits show an instructor selector from `/api/instructors?action=list`; `?instructor_id=...` preselects when valid; package and single-lesson checkout stay blocked until selected and send `instructor_id`. |
| Learner booking UI | `public/learner/book.js` | Selected slot instructor balance | Mostly yes | Booking modal reads `/api/credits?action=balance&instructor_id=<slot instructor>` before showing credit eligibility, uses `selected_instructor_balance_minutes`, and carries the slot instructor into buy-credits links. Aggregate balance remains elsewhere. |
| Admin/instructor displays | `api/instructor.js`, `public/admin/portal.js`, `public/instructor/index.js`, `public/instructor/dashboard.js`, `public/shared/instructor-booking-actions.js` | Admin adjust selector + current-instructor LCB balance for booking helper pickers | Mostly yes | Admin adjust no longer looks pooled. Instructor `school-learners` aliases current instructor LCB minutes as `balance_minutes` for existing picker code, and helper copy says "with you" / "with this instructor". |
| Credit reconcile cron | `api/cron-credit-reconcile.js` | Ledger vs LCB by learner/instructor within `SCHOOL_ID` | Yes | Compares school-scoped ledger rows against LCB, including explicit `school_id` filters on BCS/CSA source reads. |
| Platform balance | `api/_platform-balance.js` | Legacy aggregate balance valued at school rate | Partial | Advisory only, but not accurate for per-instructor effective rates or goodwill absorber. Left deferred because changing it requires pricing/refund/payout policy design. |

## Required Implementation Slices

### Slice 1: Fix Unsafe Server Control Flow

Status: Complete in `codex/per-instructor-credit-safety-slice` (2026-05-27).

Scope:

- Replace pooled edit-booking prechecks with scoped LCB reads for the booking's
  `(learner_id, instructor_id, school_id)`.
- Add missing `school_id` filters to LCB reads in `_credit-grant.js`,
  `credits.js`, and `admin.js`.
- Keep existing helper APIs unless they prove insufficient.

Landed behaviour:

- `_credit-grant.js` LCB existence checks, fallback reads, and conflict-branch
  writes are school-scoped.
- `api/credits.js?action=balance` sums only the authenticated learner's
  school-scoped LCB rows.
- `api/admin.js?action=adjust-credits` keeps the existing 0/1/2+ LCB
  resolution behaviour, but all LCB reads are scoped by `school_id`; explicit
  `instructor_id` prechecks read that exact learner/instructor/school row.
- Admin and instructor edit-booking duration increases precheck the booking
  instructor's LCB row, not pooled `learner_users.balance_minutes`.

Primary files:

- `api/_credit-grant.js`
- `api/admin.js`
- `api/instructor.js`
- `api/credits.js`

### Slice 2: Make Purchase And Balance APIs Instructor-Aware

Status: API complete in `codex/instructor-aware-credit-apis` (2026-05-27); learner UI picker still deferred to Slice 3.

Scope:

Landed behaviour:

- `POST /api/credits?action=checkout` requires explicit `instructor_id` for
  normal learner purchases and rejects missing/cross-school/inactive/hidden
  instructors.
- Stripe Checkout metadata includes `instructor_id` for credit purchases.
- `GET /api/credits?action=balance` keeps aggregate fields and returns
  `balances: [{ instructor_id, instructor_name, balance_minutes, balance_hours }]`.
- `GET /api/credits?action=balance&instructor_id=...` validates school scope
  and returns selected-instructor balance fields.
- Webhook purchase completion already grants through metadata instructor scope;
  tests now pin that call shape. Legacy missing-metadata Stripe retries remain
  grandfathered by `_credit-grant.js` to instructor `1`.
- `public/learner/buy-credits.js` has only a tiny
  `?instructor_id=...` pass-through hook; no UI picker/redesign landed here.

Primary files:

- `api/credits.js`
- `api/_pricing-helpers.js`
- `public/learner/book.js`
- `public/learner/buy-credits.js`

### Slice 3: Update Learner UI Displays

Status: Learner-facing credit displays complete through Slice 3b / 4-lite (2026-05-27); admin/operator surfaces deferred.

Scope:

Landed behaviour:

- Buy-credits chooses or receives an instructor and passes `instructor_id`.
- Buy-credits direct visits show an instructor selector sourced from the public
  instructor list; checkout buttons remain blocked until an instructor is
  selected.
- Buy-credits login links preserve `?instructor_id=...` when present.
- Booking modal decides credit eligibility from the selected slot instructor's
  `selected_instructor_balance_minutes`, not aggregate balance.
- Booking modal "buy more hours" / "buy a bundle" links pass the selected slot
  `instructor_id`.
- Dashboard fetches `GET /api/credits?action=balance`, labels its stat as total
  hours across instructors, and uses the auth blob only as a display fallback.
- Profile fetches `GET /api/credits?action=balance`, shows total credit across
  instructors, and renders per-instructor balance rows.
- Sidebar footer copy uses "total credit" instead of "remaining" to avoid
  implying Instructor A credit can book Instructor B.

Primary files:

- `public/learner/buy-credits.js`
- `public/learner/buy-credits.html`
- `public/learner/book.js`
- `public/learner/index.js`
- `public/learner/profile.js`
- `public/sidebar.js`

### Slice 4: Admin And Instructor Operator Surfaces

Status: Implemented in `codex/admin-operator-credit-surfaces` (2026-05-27).

Scope:

Landed behaviour:

- Admin adjust-credits modal requires an instructor selection, reuses the
  existing admin instructor list, posts `instructor_id`, and handles
  `AMBIGUOUS_INSTRUCTOR` with choose-instructor copy.
- Instructor booking helper pickers use the signed-in instructor's LCB balance
  from `api/instructor.js?action=school-learners`.
- Instructor helper copy says "with you" / "with this instructor" rather than
  implying an aggregate balance can be spent anywhere.
- Refund math, payout logic, DB schema, and booking mutation paths were left
  unchanged.

Primary files:

- `api/admin.js`
- `api/instructor.js`
- `public/admin/portal.js`
- `public/instructor/index.js`
- `public/instructor/dashboard.js`
- `public/shared/instructor-booking-actions.js`

### Slice 5: Refund, Reconciliation, Docs, And Tests Cleanup

Status: In progress in `codex/per-instructor-credit-cleanup` (2026-05-27).

Scope:

Landed behaviour:

- Refund executor LCB decrements are pinned to trusted planner lines:
  `learner_id` and `instructor_id` come from the selected credit source, while
  `school_id` comes from the authenticated admin scope.
- Caller-supplied learner/instructor/school fields on execute requests do not
  influence the LCB decrement.
- Reconciliation/goodwill writer tests already pin explicit learner,
  instructor, and school mutation/audit payloads plus cross-school rejection.
- Credit reconcile cron source reads now explicitly filter BCS rows by
  `school_id` while continuing to compare the ledger to LCB by learner and
  instructor inside the school scope.
- Back-office docs now distinguish instructor-scoped LCB rows from the legacy
  aggregate display shadow.

Primary files:

- `api/_refund-executor.js`
- `api/_refund-planner.js`
- `tests/admin-execute-refund.spec.js`
- `tests/admin-credit-contract.spec.js`
- `tests/slots-credit-bcs.integration.spec.js`

## Recommended Next Code PR

Recommended next PR: platform-balance advisory redesign or manual refund
ledger UI, depending on operational priority.

Exact behaviour to verify:

- Decide whether platform balance should value per-instructor live credits from
  LCB/source attribution rather than the legacy aggregate shadow.
- Keep manual bank-refund ledger-only recording separate from automatic Stripe
  refund execution.
- Continue treating BCS automatic refund execution as disabled unless a
  payout-safe design/test slice explicitly broadens it.

Why this next:

- Learner, operator, refund, reconciliation, and cron guardrail surfaces now
  carry or verify instructor context without changing refund math or payout
  behaviour.
- Remaining risk is a policy/design question rather than a narrow code
  correctness issue: platform cash exposure is still an advisory aggregate.

## Test Plan

Existing useful coverage:

- `tests/credit-grant-phase2a.integration.spec.js`
- `tests/slots-credit-bcs.integration.spec.js`
- `tests/instructor-create-booking-bcs.integration.spec.js`
- `tests/cancel-bcs-refund.integration.spec.js`
- `tests/reschedule-credit-returned.integration.spec.js`
- `tests/admin-credit-contract.spec.js`
- `tests/admin-credit-reconciliation-writer.spec.js`
- `tests/admin-execute-refund.spec.js`
- `tests/cron-credit-reconcile.integration.spec.js`
- `tests/learner-credit-ui.spec.js`

Remaining risks / missing scenarios:

- Learner has 90 minutes with Instructor A and 0 with Instructor B; booking B by
  credit is refused.
- Booking UI/API balance for selected Instructor B returns 0 even if aggregate
  total is 90.
- `credits?action=checkout` without instructor is rejected or deliberately
  resolved; no silent default for new UI.
- Cancellation returns credit only to the original booking instructor.
- Cross-school LCB rows are never read without `school_id`.
- Platform balance refund exposure is still advisory and aggregate-valued.

## Open Questions

No hard blockers if this assumption is accepted:

- Legacy/missing instructor credit during the cutover continues to grandfather
  to Fraser / instructor `1`, but all new learner-facing purchase UI should
  require an explicit instructor before checkout.
