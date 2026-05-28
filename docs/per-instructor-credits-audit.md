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
  update the current-state table and remaining deferred items before commit.

## Executive Summary

Per-instructor credits are implemented across the main learner and operator
credit paths. Thread B's server pricing contract has also landed: new credit
purchases use per-learner/instructor/school rate precedence and apply school
bulk tiers only when the selected instructor has opted in. Slice B learner UI
polish is also live: the buy-credits page now renders the selected instructor's
server-priced hourly rate, scoped balance label, and bulk/no-bulk package state.
Slice D direct booking pricing alignment has landed too: pay-per-slot checkout
and the booking modal's duration prices now use the same effective hourly
fallback for the selected instructor, while bulk discounts remain credit-package
only. Offer pricing alignment has also landed for new instructor-created offers:
`offer_price_pence` is now the frozen final per-lesson price, computed from the
same effective fallback unless an explicit offer price is supplied. Bulk-tier
opt-in remains credit-package only.

The core server booking paths use `learner_credit_balances` and
`booking_credit_sources`, and learner-facing purchase/booking/display surfaces
now carry instructor context. Admin/operator credit surfaces are scoped, and
the refund/reconciliation cleanup has pinned the remaining back-office
contracts.

Final audit sweep result: no remaining active checkout, booking, admin
mutation, refund execution, or credit-reconciliation control flow reads from
pooled `learner_users.balance_minutes` were found. The remaining pooled-shadow
uses are compatibility/display/advisory only.

Biggest deliberate deferral: platform-balance refund exposure remains advisory.
The dashboard and snapshot now label it as a legacy aggregate exposure signal,
but the number still values the legacy aggregate balance shadow at the school
rate rather than valuing each instructor-scoped credit source at its effective
rate.

## Final Audit Sweep

Completed: 2026-05-27 in `codex/per-instructor-credit-audit-closeout`.

Searches run:

- `rg -n "balance_minutes|credit_balance|learner_credit_balances|hours on account|remaining|credit balance|credits remaining|refund exposure|pooled|instructor_id" api public docs tests PROJECT.md MIGRATION-PLAN.md FRANCHISE-MODEL-PLAN.md`
- `rg -n "learner_users\\.balance_minutes|lu\\.balance_minutes|balanceMinutes|creditBalance" api public tests`
- `rg -n "Buy hours|Buy Credits|adjust credits|admin_add|admin_remove|AMBIGUOUS_INSTRUCTOR|selected_instructor_balance" api public tests docs`

Classification:

| Classification | Remaining examples | Closeout decision |
|---|---|---|
| Safe aggregate display | Learner dashboard/profile/sidebar total credit, admin learner list total hours, no-credit banner shown only when aggregate total is zero | Safe as aggregate copy; not used to approve booking credit. |
| Legacy compatibility shadow, read-only sync, or fallback | `learner_users.balance_minutes` aggregate response/audit fields, `_credit-grant.js` Pre-2A fallback branches, migration/backfill scripts and trigger tests | Kept for old sessions, migrations, and display compatibility. New Phase 2A paths write/read LCB. |
| Advisory read model, clearly labelled | `_platform-balance.js` refund exposure and daily balance snapshot | Kept advisory. Exact per-instructor/source valuation is deferred and design-needed. |
| Real bug/control-flow risk | None found in this sweep | No code patch required. |

## Current State Table

| Area | File/function | Current data source | Per-instructor safe? | Notes |
|---|---|---|---|---|
| Shared grants | `api/_credit-grant.js` `grantCredits`, `lockBalanceAndMutate`, `lockBalanceAdjustLCB` | LCB in Phase 2A | Mostly yes | Good core helper; LCB writes/guards now include `school_id`. Missing `instructorId` still grandfather-routes to instructor `1` by design during cutover. |
| Credit checkout | `api/credits.js` `handleCheckout` | Required request `instructor_id`; instructor-aware `calcBulkTotal` | Yes | New learner-facing checkout rejects missing, cross-school, inactive, or hidden/demo instructors and writes `instructor_id` to Stripe metadata. Pricing uses custom learner rate → instructor hourly rate → school default, with bulk tiers only if `instructors.bulk_tiers_enabled = TRUE`. |
| Direct pay-and-book checkout | `api/slots.js` `checkout-slot`, `checkout-slot-guest`; `api/lesson-types.js`; `durations-for-slot` | Server-side `calcDirectLessonPrice` using custom learner rate → instructor hourly rate → school default | Yes | Stripe amount and metadata now come from the selected instructor's effective hourly rate × duration. Bulk-tier opt-in is ignored for direct single-slot payments; it only affects prepaid credit packages. Trial lesson types remain excluded/rejected on paid booking paths. |
| Paid 1-hour lesson opt-in | `db/migration.sql`, `api/_lesson-type-helpers.js`, `api/lesson-types.js`, `api/slots.js`, `public/instructor/profile.js`, `public/learner/buy-credits.js` | Active `slug='1hr'` with explicit instructor opt-in | Yes | The paid 1-hour lesson type is active, but `offered_lesson_types = NULL` means the default active set and excludes opt-in-only `"1hr"`. Instructors can enable it in profile lesson-type toggles; booking and buy-credit single-lesson cards respect the selected instructor's offered list. |
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
| Learner buy UI | `public/learner/buy-credits.js` | Selected public instructor + selected balance read + `/api/credits?action=bulk-pricing&instructor_id=...` | Yes | Direct visits show an instructor selector from `/api/instructors?action=list`; `?instructor_id=...` preselects when valid; pricing and balance reload on instructor changes; package and single-lesson checkout stay blocked until selected pricing loads and send `instructor_id`. The page labels "Credits for [Instructor]", shows their effective hourly rate, and renders discount copy only when `bulk_tiers_enabled = TRUE`. |
| Learner booking UI | `public/learner/book.js` | Selected slot instructor balance | Mostly yes | Booking modal reads `/api/credits?action=balance&instructor_id=<slot instructor>` before showing credit eligibility, uses `selected_instructor_balance_minutes`, and carries the slot instructor into buy-credits links. Aggregate balance remains elsewhere. |
| Admin/instructor displays | `api/instructor.js`, `public/admin/portal.js`, `public/instructor/index.js`, `public/instructor/dashboard.js`, `public/shared/instructor-booking-actions.js` | Admin adjust selector + current-instructor LCB balance for booking helper pickers | Mostly yes | Admin adjust no longer looks pooled. Instructor `school-learners` aliases current instructor LCB minutes as `balance_minutes` for existing picker code, and helper copy says "with you" / "with this instructor". |
| Credit reconcile cron | `api/cron-credit-reconcile.js` | Ledger vs LCB by learner/instructor within `SCHOOL_ID` | Yes | Compares school-scoped ledger rows against LCB, including explicit `school_id` filters on BCS/CSA source reads. |
| Platform balance | `api/_platform-balance.js`, `public/admin/portal.js`, `api/cron-balance-snapshot.js` | Legacy aggregate balance valued at school rate, capped by Stripe-originated net cash-in | Partial | API returns `refund_exposure_basis` and admin copy labels the value as an advisory legacy aggregate exposure signal, not exact liability. It still does not value LCB/source rows by per-source effective rate or goodwill absorber, which remains deferred pending pricing/refund/payout policy design. |

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

Status: Complete in `codex/per-instructor-credit-cleanup` and verified by the
closeout sweep (2026-05-27).

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

### Slice 6: Platform Balance Advisory Cleanup

Status: Complete as advisory-labelling cleanup in
`codex/platform-balance-advisory`; exact valuation remains deferred by design
(2026-05-27).

Scope:

Landed behaviour:

- `refund_exposure_pence` calculation remains unchanged: legacy aggregate
  `learner_users.balance_minutes` valued at school bulk hourly pricing and
  capped by Stripe-originated net cash-in.
- The platform-balance API now returns `refund_exposure_basis` metadata so
  consumers can distinguish the advisory signal from exact refund liability.
- Admin portal copy calls the value a legacy aggregate exposure signal instead
  of "additional cash needed".
- Daily snapshot comments clarify that persisted `refund_exposure_pence` is the
  same advisory widget value.
- Refund math, payout logic, DB schema, Stripe refund behaviour, and BCS refund
  execution remain unchanged.

Primary files:

- `api/_platform-balance.js`
- `api/admin.js`
- `api/cron-balance-snapshot.js`
- `public/admin/portal.js`
- `tests/payout-read-model.spec.js`

## Remaining Deferred Items

There is no required next per-instructor-credit safety PR from this closeout
sweep. Remaining items are non-blocking design/product work:

- Exact platform-balance refund-liability valuation: design whether to value
  live credits from LCB/source attribution, `effective_rate_pence_per_minute`,
  and goodwill absorber/source treatment instead of the legacy aggregate shadow.
- Manual refund ledger UI: keep this separate from automatic Stripe execution
  and from BCS execution capability.
- Slice C1 bulk-tier controls landed: admin create/edit and instructor profile
  can manage `bulk_tiers_enabled`; instructor profile also shows the
  server-computed effective hourly rate read-only.
- Admin hourly-rate editing landed: admin create/edit can set a positive
  `instructors.hourly_rate_pence` override or clear it back to NULL so the
  instructor inherits the school default.
- Learner UI Slice B polish landed: buy-credits now makes selected-instructor
  pricing, balance scope, and bulk opt-in/off state explicit.
- Thread C franchise-tier/admin configurability remains outside this Thread A
  closeout.

Exact behaviour to verify:

- Decide whether platform balance should value per-instructor live credits from
  LCB/source attribution rather than the legacy aggregate shadow.
- Decide how goodwill absorber/source attribution should affect any exact
  liability number before changing the dashboard calculation.
- Keep manual bank-refund ledger-only recording separate from automatic Stripe
  refund execution.
- Continue treating BCS automatic refund execution as disabled unless a
  payout-safe design/test slice explicitly broadens it.

Why these remain deferred:

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

Regression coverage highlights:

- Learner UI tests pin selected-instructor balance reads and prevent aggregate
  `balanceMinutes` from driving booking-modal credit eligibility.
- Credit API tests pin checkout `instructor_id` validation, selected instructor
  balance fields, and missing-instructor rejection for new checkout sessions.
- Booking/refund/reconciliation tests pin LCB mutation scope, BCS attribution,
  cancellation credit return, refund execution scope, and cron reconciliation
  school filters.
- Admin/operator UI tests pin explicit instructor selection, ambiguity handling,
  and instructor-scoped balance copy.
- Platform-balance tests pin that refund exposure is labelled advisory and
  aggregate-valued; exact per-source/per-instructor liability remains deferred.

## Open Questions

No hard blockers remain for Thread A closeout.

- Legacy/missing instructor credit during the cutover continues to grandfather
  to Fraser / instructor `1` through shared helper fallback branches. Treat
  those branches as compatibility only; all new learner-facing purchase UI
  requires an explicit instructor before checkout.
