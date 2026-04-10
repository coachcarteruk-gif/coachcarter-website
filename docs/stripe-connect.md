# Stripe Connect & Instructor Payouts

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when working on payouts, connect onboarding, or fee models.

Instructors are paid via Stripe Connect Express accounts. Money flows: learner pays → platform Stripe account → weekly Friday transfer to instructor's connected account.

## Files

- `api/connect.js` — onboarding, status, dashboard link, admin invite, dismiss
- `api/cron-payouts.js` — Vercel cron every Friday 9am UTC
- `api/_payout-helpers.js` — shared payout calculation logic

## Rules

- Eligible bookings: status='completed' OR (status='confirmed' AND 3+ days old)
- `instructor_payouts` + `payout_line_items` tables (UNIQUE on booking_id prevents double-payment)
- Platform owner (Fraser) has payouts dismissed — revenue stays in platform account
- Admin can pause/resume individual instructor payouts from admin portal

## Fee models

Two fee models per instructor (set via admin portal):

- **Commission** (default): instructor gets `commission_rate` (e.g. 85%) of each lesson price
- **Franchise fee**: platform takes a fixed `weekly_franchise_fee_pence` per week, instructor keeps the rest. Capped at gross (never goes negative). Set `weekly_franchise_fee_pence = NULL` to revert to commission.
