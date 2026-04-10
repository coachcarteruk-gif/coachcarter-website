---
description: Start a session for Stripe Connect / instructor payouts work
argument-hint: [short description of the payouts change]
---

I'm working on Stripe Connect / payouts: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md` and `docs/stripe-connect.md`, then confirm you understand these rules:

1. **Money flow**: learner pays → platform Stripe account → weekly Friday cron transfers to instructor's Connect account.
2. **Eligibility**: bookings are payable when `status='completed'` OR (`status='confirmed'` AND 3+ days old).
3. **No double-payment**: `payout_line_items` has a UNIQUE constraint on `booking_id`. Never bypass this.
4. **Fraser's payouts are dismissed** — platform owner's revenue stays in the platform account. Never re-enable without explicit instruction.
5. **Pause/resume** per instructor is an admin feature. Respect the `payouts_paused` flag.
6. **Two fee models** per instructor:
   - **Commission** (default): instructor gets `commission_rate` × lesson price
   - **Franchise fee**: platform takes fixed `weekly_franchise_fee_pence`/week, capped at gross. `NULL` = revert to commission.
7. **Multi-tenancy**: for non-CoachCarter schools, payouts go school → school (via `school_payouts`), not instructor → instructor. CoachCarter (school #1) keeps the legacy per-instructor system alongside.
8. **Audit log** for any admin mutation (pause/resume, fee model change).

**Files likely relevant:**
- `api/connect.js` — onboarding, status, dashboard link
- `api/cron-payouts.js` — weekly Friday cron
- `api/_payout-helpers.js` — shared calculation logic
- `api/_audit.js` — for admin mutations

**Before committing, verify:**
- [ ] No double-payment possible (UNIQUE on booking_id respected)
- [ ] Fraser's dismiss flag still honoured
- [ ] Fee model logic covers both commission AND franchise
- [ ] Franchise fee still capped at gross (never negative)
- [ ] School-level payouts (non-CoachCarter) unaffected
- [ ] Admin mutations audit-logged
- [ ] `PROJECT.md` updated if flow changed
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `api/_payout-helpers.js` and `api/cron-payouts.js`, then summarise your plan before writing code.
