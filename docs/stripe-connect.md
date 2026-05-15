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
- Platform owner (Fraser) has `payouts_paused = TRUE` and `stripe_account_id = NULL` — revenue stays in platform account, paid out to bank via Stripe's normal payout schedule. Set by a historical "Dismiss banner" click that wiped the row; the dismiss UI was removed 2026-05-16 (see Step 0 in INSTRUCTOR-PAYMENTS-PLAN.md for the planned platform-sweep cron that will keep this state coherent post-instructor-#2).
- Admin can pause/resume individual instructor payouts from admin portal

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
| 1. Hidden | `!has_account && payouts_paused` (legacy platform-owner state) | — |
| 2. Red "Set Up Direct Payouts" | `!has_account` | `.connect-banner.not-started` |
| 3. Amber "Finish Setting Up Payouts" | DB onboarding not yet complete | `.connect-banner.pending` |
| 4. Amber "Action required" *(NEW)* | DB complete, but Stripe live state is unhealthy | `.connect-banner.pending` + red count badge |
| 5. Amber "Payouts Paused" | `payouts_paused=true` | `.connect-banner.pending` |
| 6. Green "Payouts Active" | All checks pass | `.connect-banner.active` |
