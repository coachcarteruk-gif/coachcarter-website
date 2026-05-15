# Pre-Session Checklist — Plan Item 1.7 (Pre-Signing Payout Rehearsal)

**Drafted:** 2026-05-10
**Plan ref:** `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md` item 1.7
**Pre-signing-day blocker:** yes
**Important:** This rehearsal needs **environmental setup before the session starts.** Don't open a Claude Code session without these in place — you'd burn the session waiting on Stripe email confirmations.

---

## What 1.7 actually is

A test-mode dry-run of "instructor #2's first payout day." The platform isn't ready (Phase 1 schema isn't shipped, Stripe-fee passthrough B3.4 isn't built, statement itemisation B3.5 isn't built). The point of the rehearsal is to **discover which gaps are tolerable for week 1 vs which need filling first**, by walking through the flow with a fake instructor against test-mode Stripe.

Likely outcome: confirms B3.4 / B3.5 (Stripe-fee passthrough + itemisation) can wait until Tier 3, but surfaces something specific to fix before signing.

---

## Recommended sequencing relative to other items

**Best order:** ship 1.3 + 2.10 (shortfall column + £250 deposit deduction) FIRST, then rehearse. Reasons:

1. The rehearsal *will* exercise both shortfall and deposit logic — instructor #2's week 1 in every scenario produces a £0 payout because of the deposit. Without 1.3+2.10, the rehearsal can't tell you whether the *automation* works correctly; it can only tell you what happens with manual SQL fix-ups.
2. The other major payout pieces (B3.3 snapshot reads, B3.4 Stripe passthrough, B3.5 itemisation) are deliberately Tier 3, scheduled for after instructor #2 is teaching. The rehearsal's job is to confirm those can wait — not to test them.
3. After 1.3+2.10 ship, the rehearsal becomes a test of "does the new shortfall code recover correctly across two consecutive payouts?" — a higher-value question.

**Acceptable alternative:** rehearse against the current code (no shortfall column, deposit handled manually). Cheaper but less informative — you'll spend the session figuring out manual workarounds rather than testing what week 1 actually looks like.

---

## Pre-session environmental setup

Don't skip these. Set them up *before* opening the Claude session.

### 1. Stripe test-mode account active
- If you don't already have one, sign up at https://dashboard.stripe.com — flip the "Test mode" toggle once in.
- If you already use Stripe in production for CCL, the test-mode account is already there alongside it; just switch.

### 2. Test API keys captured
- Test mode publishable key: starts `pk_test_…`
- Test mode secret key: starts `sk_test_…`
- Test mode webhook signing secret: starts `whsec_…` (generate a new one for the test endpoint)

### 3. `.env.local` populated for local dev
```
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
```
**Do NOT commit `.env.local`.** It's already in `.gitignore` for this repo (verify with `git check-ignore .env.local`).

### 4. A test Connect Express account onboarded
- In test mode, create a fake "instructor" Connect Express account.
- Easiest: trigger the onboarding flow you already use in `api/connect.js`. Walk through Stripe's test onboarding steps. Stripe accepts dummy data in test mode (made-up Companies House number, bank account `108800/00012345`, etc.).
- At the end you'll have a `stripe_account_id` for a test account in `Express` mode with onboarding complete.

### 5. Insert that test instructor into the dev DB
```sql
INSERT INTO instructors (
  name, email, school_id, active, stripe_account_id,
  stripe_onboarding_complete, payouts_paused,
  weekly_franchise_fee_pence
) VALUES (
  'Test Instructor #2 (rehearsal)', 'rehearsal@example.local',
  1, TRUE, 'acct_…',  -- the one from step 4
  TRUE, FALSE,
  19500  -- £195 Full Franchise weekly fee
);
```
Note the inserted instructor's `id` — you'll need it.

### 6. Decide whether to fake Phase 1 columns
- Phase 1 schema isn't shipped. The rehearsal can either (a) accept that the existing `lesson_types.price_pence` live-lookup is what gets exercised, or (b) hand-add the new columns to the dev DB just for this rehearsal.
- Recommend (a) — the rehearsal's job is "what happens *today* on instructor #2's first payout day." Faking Phase 1 columns confuses the question.

### 7. Plan some test bookings
- Decide your week 1 scenario before the session starts. From the earnings projection (`docs/franchise/sample-earnings-projection.md`):
  - **Best case rehearsal**: 4 lessons in week 1 → revenue £330 → with £250 deposit + £160 effective fee + Stripe fees = £85.76 shortfall.
  - **Worst case rehearsal**: 1 lesson in week 1 → revenue £82.50 → £337.94 shortfall.
- Insert these bookings into the dev DB with `status='chargeable'`, `scheduled_date <= CURRENT_DATE`, `instructor_id = <your test instructor>`. (May 2026: payout filter is now `chargeable`-only; the old three-day grace on `confirmed` is gone — see `docs/booking-statuses.md`.)

### 8. Clear any prior test payouts
```sql
DELETE FROM payout_line_items WHERE booking_id IN (
  SELECT id FROM lesson_bookings WHERE instructor_id = <test>
);
DELETE FROM instructor_payouts WHERE instructor_id = <test>;
```

---

## What to walk through during the session

Structured in 4 phases:

### Phase A — Trigger payout
- Manually call the payout cron endpoint with admin auth (no need to wait for Friday).
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron-payouts
  ```
  Or hit it from the admin portal if there's a manual-trigger button.
- Observe what happens. Expected:
  - `getEligibleBookings()` returns the test bookings.
  - `processPayoutForInstructor()` calculates gross, applies `Math.min(franchiseFee, totalGrossPence)` truncation if needed.
  - Stripe `transfers.create()` fires (test mode — no real money moves).
  - `instructor_payouts` row created with `status='completed'`.
  - Notification email sent to the test instructor email.

### Phase B — Inspect the result
- Pull up the `instructor_payouts` row created. Note `amount_pence`, `franchise_fee_pence`, `period_start`, `period_end`, `status`.
- Pull up the `payout_line_items` rows. Note per-booking `instructor_amount_pence` and `commission_rate`.
- Find the email in your test inbox. Read the body. Note: does it itemise Stripe fees? (No, B3.5 not built.) Does it show shortfall? (No, B3.6 not built.) Does it show deposit deduction? (No, B3.14 not built.)
- Find the Stripe Dashboard transfer record. Note transfer amount, destination, description.

### Phase C — Catalogue the gaps
- For each thing the email/database/Stripe transfer DOES NOT show that the agreement says it should:
  - Stripe fees passed through? → catalogue as B3.4 gap (already on Tier 3).
  - Stripe fees itemised on statement? → catalogue as B3.5 gap (already on Tier 3).
  - Negative-payout shortfall recorded? → catalogue as B3.6 gap (planned in 1.3).
  - £250 deposit deducted from week 1? → catalogue as B3.14 gap (planned in 2.10).
  - Anything else? → that's the *finding* the rehearsal exists to surface.

### Phase D — Decide which gaps must close before signing
- The Tier 3 ones (B3.3 / B3.4 / B3.5) can wait — they affect month 2 onwards.
- 1.3 + 2.10 must be closed before Start Date (already planned).
- Anything *else* the rehearsal surfaces — decide tier on the spot.

---

## Acceptance criteria for the rehearsal

The session is done when:

- [ ] A test payout has been triggered and observed end-to-end (DB row + Stripe Dashboard + email).
- [ ] You've walked through the projection's worst-case week-1 scenario and seen the actual platform behaviour.
- [ ] You've catalogued every gap between the agreement's commitments and what the code actually does.
- [ ] Each gap is mapped to either an existing plan item or a new one with a tier assignment.
- [ ] Zero real money has moved (verify in Stripe Dashboard test mode).
- [ ] The dev DB is left in a state you can re-run the rehearsal from without manual cleanup (or: documented how to clean up).

---

## What this rehearsal does NOT do

- It does **not** test Phase 2A per-instructor credit scoping (Phase 1 schema isn't shipped).
- It does **not** test the consent flow or content-licensing economics (different code path entirely).
- It does **not** test Lead Floor rebate calculations (manual-only until S1.17/S1.18, deferred per CC5).
- It does **not** test offer-based recurring-series booking against the new shortfall logic — that's a separate edge-case rehearsal worth doing once 1.3+2.10 ships.

---

## Estimated session length

**1 session** if the pre-session setup (steps 1–8 above) is genuinely complete. Add 30–45 minutes if any of steps 1–4 (Stripe test account, keys, webhook, Connect onboarding) hasn't been done — Stripe takes time to verify even in test mode.
