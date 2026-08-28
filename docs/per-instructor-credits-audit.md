# Per-Instructor Credits Audit

Last updated: 2026-08-17

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
credit paths. Thread B's server pricing contract also landed: new credit
purchase pricing historically used per-learner/instructor/school rate precedence
and applied school bulk tiers only when the selected instructor opted in. New
self-serve credit purchases are now server-retired; those helpers remain only
for historical/in-flight compatibility and read-only pricing. Slice B learner UI
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
rate. The design/audit note for the exact valuation slice lives in
[`docs/refund-exposure-valuation-audit.md`](docs/refund-exposure-valuation-audit.md).

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
| Credit checkout | `api/credits.js` `handleCheckout`, `handleCreatePaymentIntent` | Server-retired creation; historical instructor-aware helpers retained | Yes | Both self-serve creation actions return `410 CREDIT_PURCHASE_RETIRED` before SQL or Stripe. In-flight pre-retirement Checkout/PaymentIntent webhook and verify paths remain idempotent so paid learners are not stranded. |
| Direct pay-and-book checkout | `api/slots.js` `checkout-slot`, `checkout-slot-guest`; `api/webhook.js`; `api/_paid-booking-orphan-recovery.js`; `api/lesson-types.js`; `durations-for-slot` | Server-side `calcDirectLessonPrice` using custom learner rate → instructor hourly rate → school default | Yes | Stripe amount and metadata come from the selected instructor's effective hourly rate × duration. A retry that finds a completed `slot_purchase` but no booking no longer acknowledges the orphan: one-off direct slots and slot-pinned offers enter a serializable, tenant-scoped recovery transaction. Recovery requires exact immutable payment/source identity, a free slot across every availability source, and a scoped ledger balance that reconciles either before or after a staged credit. It then creates one booking/BCS and consumes credit net-zero; conflicts or drift remain retryable/manual. Bulk-tier opt-in is ignored for direct single-slot payments, and trial lesson types remain excluded. |
| Social-video booking discount | `api/slots.js`, `api/webhook.js`, `api/_pricing-helpers.js` | Instructor opt-in + learner per-booking consent + 18+ confirmation | Yes | `social_video_consent` and `social_video_age_confirmed` are separate request booleans. The server validates `instructors.social_video_opt_in` and requires the 18+ confirmation before applying the 5% discount to the Stripe amount only. `charge_minutes`, `credit_transactions.minutes`, `lesson_bookings.minutes_deducted`, and BCS attribution retain the full lesson duration so eligible cancellation returns the complete lesson entitlement. Consent, age confirmation, and discount pct are snapshotted on `lesson_bookings`. |
| Paid 1-hour lesson opt-in | `db/migration.sql`, `api/_lesson-type-helpers.js`, `api/lesson-types.js`, `api/slots.js`, `public/instructor/profile.js`, `public/learner/buy-credits.js` | Active `slug='1hr'` with explicit instructor opt-in | Yes | The paid 1-hour lesson type is active, but `offered_lesson_types = NULL` means the default active set and excludes opt-in-only `"1hr"`. Instructors can enable it in profile lesson-type toggles; booking and buy-credit single-lesson cards respect the selected instructor's offered list. |
| Credit balance API | `api/credits.js` `handleBalance` | School-scoped LCB rows joined to same-school instructors | Yes | Preserves aggregate and per-instructor balances plus optional validated `instructor_id`. Slice 3 adds the strict school-scoped `incompatible_products_retired` display flag without blocking balance reads or spending. |
| Credit verify/webhook | `api/webhook.js` `handleCreditPurchase` | Stripe metadata + `grantCredits` | Mostly yes | Checkout completion and native `payment_intent.succeeded` consume metadata `instructor_id` and grant to that instructor's LCB row. PaymentIntent-only grants use `stripe_payment_intent_id` idempotency when no Checkout session id exists. Legacy/missing metadata still goes to instructor `1` through the shared helper for old Stripe retries. |
| Learner credit booking | `api/slots.js` credit transaction path | LCB + FIFO `credit_transactions` by instructor | Yes | Locks/decrements chosen instructor row, writes BCS and list price. Social-video consent is snapshotted for the lesson, but an existing Lesson Credit balance always deducts the full booked duration; the 5% filming discount belongs to the direct cash price and does not reduce or inflate minutes. |
| Instructor-created credit booking | `api/instructor.js` credit transaction path | LCB + FIFO CT by instructor | Yes | Same safe shape as learner booking. Instructor/admin schedule warnings may be explicitly overridden before this transaction; the override does not change the school-scoped LCB lock, FIFO source draw, BCS attribution, or booking collision guards. |
| Cancellations / not delivered | `api/slots.js`, `api/instructor.js` cancel and mark-not-delivered paths | Booking `instructor_id` + `lockBalanceAdjustLCB` | Mostly yes | Returns credit to original instructor row and marks BCS refunded. Instructor `mark-not-delivered` is a transactional pre-payout exception for past unpaid lessons and refuses bookings already in `payout_line_items`. Self-serve free-trial learner cancellations terminate the booking without credit mutation because `minutes_deducted=0`. Ordinary cancel paths are not fully transactional with booking update. |
| Reschedule | `api/slots.js`, `api/instructor.js` reschedule paths | Same-instructor moves carry original BCS; learner- or instructor-initiated instructor switches write paired transfer-out/transfer-in CT rows and replacement BCS | Yes | Same-instructor moves do not mutate balances. Ordinary switches preserve the paid entitlement without a second charge, move its instructor scope atomically, and keep the immutable original Stripe source linked through `transferred_from_credit_transaction_id`. Instructor confirmation also terminates the old booking, inserts the replacement, and rewrites funding in one transaction. Reserved Weekly Slot moves remain same-instructor only. |
| Edit booking duration | `api/admin.js`, `api/instructor.js` edit-booking paths | Booking instructor's school-scoped LCB row; mutation uses scoped helper | Mostly yes | Extra-duration precheck no longer reads pooled learner balance. Response text preserved. |
| Admin retrospective lesson entry | `api/admin.js` `handleCreateRetrospectiveBooking`, `public/admin/portal.js` | Credit option locks the selected learner/instructor/school LCB row and draws FIFO CT sources into BCS; cash option writes no credit draw | Yes | Past-only admin insert creates `chargeable` lessons. Credit-funded entries write BCS, snapshot payable list price, and decrement per-instructor balance in one transaction; cash entries keep `minutes_deducted = 0`. |
| Admin adjust credits | `api/admin.js` `handleAdjustCredits`, `public/admin/portal.js` | UI requires explicit instructor; server uses school-scoped LCB auto-resolve/explicit instructor | Mostly yes | Server guard is scoped: 0 rows grandfathers to instructor `1`, 1 row auto-resolves, 2+ rows returns `AMBIGUOUS_INSTRUCTOR`, explicit `instructor_id` reads that exact LCB row. Admin UI now chooses an instructor and posts `instructor_id`; response/audit still includes pooled totals for compatibility. |
| Goodwill/reconciliation | `api/_admin-credit-goodwill.js`, `api/_admin-credit-reconciliation.js` | Explicit learner/instructor/school + shared helper | Yes | Strongest admin path; tests already pin scope and mutation shape. |
| Refund executor | `api/_refund-executor.js` | Planner lines + `lockBalanceAdjustLCB` | Yes | Uses `learner_id`/`instructor_id` from trusted plan lines and `school_id` from the admin scope for the LCB decrement; tests pin that caller-supplied scope fields are ignored. BCS execution intentionally disabled. |
| Learner dashboard/profile/sidebar displays | `public/learner/index.js`, `public/learner/profile.js`, `public/sidebar.js` | Aggregate + per-instructor `GET /api/credits?action=balance` data; sidebar localStorage fallback copy | Mostly yes | Dashboard labels aggregate as total across instructors and fetches live balance; profile shows total plus per-instructor rows; sidebar says total credit instead of implying a universally spendable balance. |
| Learner buy UI | `public/learner/buy-credits.js` | Read-only aggregate and selected-instructor balance display | Yes | Direct visits are an existing Lesson Credit balance page. No purchase/package CTA or credit-checkout request remains. |
| Learner booking UI | `public/learner/book.js` | Selected slot instructor balance + strict school retirement state | Mostly yes | One-off booking still reads selected-instructor spendable credit. When Slice 3 retirement is active, repeat and new Reserved Weekly Slot prompts are removed; existing balance spending, returns, and reserved-booking management remain available. |
| Admin/instructor displays | `api/instructor.js`, `public/admin/portal.js`, `public/instructor/index.js`, `public/instructor/dashboard.js`, `public/shared/instructor-booking-actions.js` | Admin adjust selector + current-instructor LCB balance for booking helper pickers | Mostly yes | Admin adjust no longer looks pooled. Instructor `school-learners` aliases current instructor LCB minutes as `balance_minutes` for existing picker code, and helper copy says "with you" / "with this instructor". |
| Credit reconcile cron | `api/cron-credit-reconcile.js` | Ledger vs LCB by learner/instructor within `SCHOOL_ID` | Yes | Compares school-scoped ledger rows against LCB, including explicit `school_id` filters on BCS/CSA source reads. |
| Platform balance | `api/_platform-balance.js`, `public/admin/portal.js`, `api/cron-balance-snapshot.js` | Exact source-attributed LCB exposure plus legacy aggregate advisory value | Mostly yes | API now exposes `exact_refund_exposure_pence` / `exact_refund_exposure` from school-scoped `learner_credit_balances`, source rates, BCS usage, CSA adjustments, and `absorbed_by` buckets. The legacy aggregate `refund_exposure_pence` remains available as `legacy_advisory_refund_exposure_pence` and is still used by the existing snapshot column. |

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

- Exact platform-balance refund-liability valuation: read-model slice landed.
  The remaining product/accounting questions are how to display or act on
  instructor-absorbed goodwill and legacy unknown absorber buckets.
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

## Flexible Hours boundary (2026-08-16)

Flexible Hours do not weaken or replace the per-instructor Lesson Credit model. Their authority is the separate school-scoped `flexible_package_sources` ledger and its allocation/return/reduction evidence; they never write `learner_credit_balances` or the aggregate `learner_users.balance_minutes` shadow.

The instructor dimension is introduced only when actual package units are allocated to a booking. The booking stores the delivering same-school active `instructor_id`, the sum of its immutable source contributions in `list_price_pence`, `list_price_source='flexible_package_frozen_rate'`, and zero booking Stripe fee because CoachCarter absorbs the original purchase fee. Existing scheduled/chargeable/refunded payout eligibility then applies normally. Entitlement creation alone has no instructor and creates no earning or payout entry.

Cancellation at 48+ hours appends one return per allocation and restores those exact sources. Under 48 hours appends no return, leaves the booking scheduled/payable, and therefore cannot manufacture Lesson Credit or move value to a different instructor. The 30-minute unit model rejects incompatible durations instead of rounding.

Flexible Hours rescheduling uses the same 48+ hour learner rule. It atomically terminates the old booking, appends exact allocation returns, and attaches identical frozen-value allocations to the replacement booking. Because the entitlement is school-wide, the replacement may use another active same-school instructor; the new booking carries that delivering instructor into the normal payout lifecycle. Any active `booking_credit_sources` row on the same lesson is a hard contradiction: Lesson Credit and Flexible Hours cannot jointly fund one booking.

The normal Flexible Hours purchase path requires the school-wide spendable balance to be zero before another Checkout starts. This reduces cross-price overlap without weakening the immutable source/FIFO model needed for historical returns, webhook reordering and reconciliation.
