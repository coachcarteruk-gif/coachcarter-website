# Stripe Connect & Instructor Payouts

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when working on payouts, connect onboarding, or fee models.

Instructors are paid via Stripe Connect Express accounts. Money flows: learner pays → platform Stripe account → weekly Friday transfer to instructor's connected account.

## Files

- `api/connect.js` — onboarding, status, dashboard link, admin invite
- `api/cron-payouts.js` — Vercel cron every Friday 9am UTC
- `api/_payout-helpers.js` — shared payout calculation logic

## Rules

- Eligible bookings: `lesson_bookings.status = 'chargeable'` (the hourly `cron-auto-complete` flip applies a 1-hour buffer past `end_time`; no extra grace is needed — see `docs/booking-statuses.md`)
- `instructor_payouts` + `payout_line_items` tables (UNIQUE on booking_id prevents double-payment)
- `getEligibleBookings` honours `instructors.payouts_start_date` — bookings before that date are invisible to the cron. NULL = no floor (legacy behaviour). Set it on every onboarding to prevent the first Friday cron from sweeping the instructor's entire historical chargeable backlog in one transfer. See `feedback_payout_date_floor.md` for the failure mode.
- Platform owner (Fraser) is a normal instructor row — has his own Connect Express account (`acct_1THXFyIAf6hvFTx9`) and is paid via the Friday cron on the same code path as every other instructor. The platform Stripe account (`acct_1QUssNIqhTSdZedS`) holds both escrow for undelivered learner credit and platform revenue (commission cuts / franchise margin); its payout schedule is **Manual**, drained to the sole-trader bank by Fraser when cashflow is needed. This is a deliberate cashflow-over-structural-refund-safety trade-off; refund-safety becomes a discipline-and-visibility problem (see the platform-balance-vs-credit-liability admin widget). Do not re-propose a platform-sweep cron or a separate Connect account for platform revenue.
- Admin can pause/resume individual instructor payouts from admin portal
- Customer refund wording must distinguish credit returns from approved cash/card refunds. 48+ hour lesson cancellations return lesson credit to the learner's balance with the booking instructor; they are not automatic cash refunds. Where a refund is approved, it should be returned to the original payment method where possible, minus any non-refundable payment processing fees charged by the payment provider. This wording should be solicitor-reviewed before being treated as final legal copy.

## Refund Preview / Execute Policy

Approved card refunds are net of the original non-refundable Stripe processing fee. The learner absorbs that original processing fee; no goodwill exception is assumed by default.

For partial refunds, the withheld fee is the refunded portion's attributed/proportional share of the original Stripe fee. Prefer exact BCS attribution (`booking_credit_sources.stripe_fee_pence`) where it exists; otherwise use the source or booking fee snapshot (`credit_transactions.stripe_fee_pence`, `lesson_bookings.stripe_fee_pence`) or a Stripe balance transaction lookup. If fee evidence cannot be found, automatic refund preview/execution must block and return manual review rather than assuming zero.

Already-paid-out direct bookings must not be automatically Stripe-refunded. Once a lesson appears in `payout_line_items`, Fraser should handle any approved refund manually from the bank account and record it through `POST /api/admin?action=record-manual-bank-refund`. Admin preview and automatic execute both return this as blocked guidance.

The first implementation slice is `POST /api/admin?action=refund-preview`: read-only, admin-authenticated, school-scoped, and itemised as gross lesson credit value, withheld processing fee, and amount returned. It does not call `stripe.refunds.create`.

The second implementation slice is `POST /api/admin?action=execute-refund`: admin-authenticated, school-scoped, and tightly gated by an explicit `operator_go` confirmation plus caller-supplied idempotency key. Execute re-runs the trusted server-side planner before any Stripe mutation, rejects blocked/manual-review plans, calls `stripe.refunds.create` only through an injected/created Stripe client, writes `refund_events(status='executed')` and `refund_event_lines`, audit-logs `admin.execute_refund`, and creates `credit_source_adjustments` plus locked balance decrements for supported unused credit-source refunds. It must not be run against production without a future explicit operator go.

Manual bank recording is a separate ledger-only path: `POST /api/admin?action=record-manual-bank-refund` re-runs the preview, refuses clean `execute_eligible` cases, requires `operator_go="RECORD_MANUAL_BANK_REFUND_CONFIRMED"`, a stable idempotency key, and a bank reference, then writes `refund_events` / `refund_event_lines` with `metadata.refund_channel = "manual_bank"`. It does not call Stripe refund APIs, mutate booking status, edit payout rows, create `credit_source_adjustments`, or change learner credit balances.

## Fee models

Two fee models per instructor (set via admin portal):

- **Commission** (default): instructor gets `commission_rate` (e.g. 85%) of each lesson price
- **Franchise fee**: platform takes a fixed `weekly_franchise_fee_pence` per week, instructor keeps the rest. Capped at gross (never goes negative). Set `weekly_franchise_fee_pence = NULL` to revert to commission.

## Connect-status surfacing (instructor + admin views)

`?action=connect-status` returns six fields when `has_account=true`:

| Field | Source | Meaning |
|---|---|---|
| `has_account` | DB | `instructors.stripe_account_id IS NOT NULL` |
| `onboarding_complete` | DB (live-updated) | `stripe_onboarding_complete`. Flipped to `TRUE` the first time Stripe reports `charges_enabled && payouts_enabled`. Never flipped back. |
| `payouts_paused` | DB | `payouts_paused`. Set by admin (no instructor-facing UI; the dismiss button was removed 2026-05-16). |
| `charges_enabled` | Stripe live | Can the account currently accept charges? |
| `payouts_enabled` | Stripe live | Can the account currently receive payouts? |
| `requirements_pending` | Stripe live | Count of `account.requirements.currently_due` items |

`onboarding_complete=true` is a **one-way flag** — once true, it stays true even if Stripe later disables capabilities or raises new `currently_due` requirements (a common path: re-verification cycles, expired ID documents, regulator-driven info requests). The instructor earnings banner and dashboard alert use the live Stripe fields to detect this *re-blocked* state and prompt the instructor back into Stripe's hosted onboarding flow.

The admin instructor-list Payments badge is DB-only and won't flag a re-blocked instructor until they next visit their earnings page (which re-syncs). This is intentional — it avoids an N+1 Stripe round-trip on every admin pageload, and the instructor sees the truth on their own pages anyway.

**Banner states** (in `public/instructor/earnings.js::renderConnectBanner`):

| State | Trigger | Visual |
|---|---|---|
| 1. Hidden | `!has_account && payouts_paused` (admin paused an instructor before they onboarded; previously also the platform-owner state until 2026-05-15) | — |
| 2. Red "Set Up Direct Payouts" | `!has_account` | `.connect-banner.not-started` |
| 3. Amber "Finish Setting Up Payouts" | DB onboarding not yet complete | `.connect-banner.pending` |
| 4. Amber "Action required" *(NEW)* | DB complete, but Stripe live state is unhealthy | `.connect-banner.pending` + red count badge |
| 5. Amber "Payouts Paused" | `payouts_paused=true` | `.connect-banner.pending` |
| 6. Green "Payouts Active" | All checks pass | `.connect-banner.active` |
