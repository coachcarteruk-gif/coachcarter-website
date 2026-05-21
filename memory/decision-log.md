# Decision log

Chronological record of architectural commitments. Newest first within each period. Superseded entries are kept on purpose so we don't relitigate.

Format: `**[Date] — Decision** — Reason — Consequence`.

---

## 2026-05 — Credits & payouts

**2026-05-21 — B1/B3 absorption rule: do not auto-fix refund-without-credit-return on grandfathered learners.**
Reason: Plan B1's synthetic `credit_transactions` rows mathematically absorb those draws. Flipping `credit_returned=TRUE` after the fact would manufacture opposite-sign drift because the synthetic CT row is fixed.
Consequence: Bookings #111, #113, #165, #194 are deliberately left in their current shape. Any future "fix all rows with shape X" sweep on `lesson_bookings` must use an explicit allowlist, not a predicate. See `prod-facts.md` for the canonical list.

**2026-05-21 — Step 4.5 daily credit-divergence cron is the falsifiability harness, not the fix.**
Reason: Plan invariants in `PER-INSTRUCTOR-CREDITS-PLAN.md` are only useful if they alert. Any non-empty `drift_summary` is a real defect.
Consequence: Do not silence alerts. If the cron is noisy, find the root cause; do not raise thresholds.

**2026-05-21 — Reschedule writer paths must set `credit_returned = TRUE` on the old booking (chip #3).**
Reason: The old booking flips to `refunded` but its `minutes_deducted` is still being counted as an active draw against LCB, producing drift.
Consequence: Lockstep with the rollback branch — on INSERT failure of the new booking, the rollback must flip `credit_returned = FALSE` again. Otherwise rollback manufactures `−minutes_deducted` of opposite-sign drift. See `api/instructor.js handleRescheduleBooking` and `api/slots.js handleReschedule`.

**2026-05-19 — Pricing helper splits into two: authenticated (`getEffectiveRatePencePerMinute`) vs public (`getPublicInstructorRatePencePerMinute`).**
Reason: The authenticated helper consults `instructor_learner_notes.custom_hourly_rate_pence`; the public helper must never leak per-pair pricing.
Consequence: Any new pricing call site must pick the right helper. Mixing them is an auth-boundary bug, not a styling choice.

**2026-05-19 — `api/credits?action=instructor-balances` derives `learner_id` from the cookie only.**
Reason: Accepting `learner_id` as a parameter would let any visitor enumerate other learners' balances.
Consequence: Never re-add a `learner_id` query parameter to this action. Server reads JWT from `cc_learner` cookie.

**2026-05-19 — Guest bulk checkout is Path A (account required at bundle CTA).**
Reason: Bulk checkout writes credit pack data that needs an account anyway; guest free-trial slot checkout is preserved separately.
Consequence: Marketing PAYG button on `/lessons.html` redirects to `/learner/book.html`. Bulk packages route through `/api/credits?action=checkout` (server-priced via `calcBulkTotal`).

**2026-05-17 — Trigger B threshold floor: £100.**
Reason: Picked without historical variance calibration because outflow is structurally zero until 2026-05-22.
Consequence: Recalibrate once 2–3 weeks of post-2026-05-22 outflow data exists. If it false-fires before then, raise to £200/£300 or compare to a percentile — don't disable.

**2026-05-17 — Almost all bookings are credit-funded; `lesson_bookings.stripe_fee_pence` is structurally near-empty.**
Reason: Stripe charges fire at credit-purchase time, not lesson time. Fee lives on the originating `credit_transactions` row.
Consequence: NULL `stripe_fee_pence` on a credit-funded booking is correct, not missing data. Full pro-rata attribution needs `booking_credit_sources` (Step 4g / Step 5). Until then the Friday cron overpays bulk-pack lessons by 1–3% vs effective cost. Acceptable; do not patch with a different "fix".

**2026-05-16 — Stripe-fee pass-through (Step 4f) chose Path B (no `lesson_bookings.list_price_pence` reuse for fee math).**
Reason: The cron's existing live-compute price expression is good enough for 4f.d. Adding `list_price_pence` (Step 1a) is independent work that can ship later.
Consequence: Step 1a was implemented anyway in PR #167 for the credits plan, but `_payout-helpers.js` still uses the live-compute path. Don't unify them under one column without auditing both surfaces.

**2026-05-16 — Commission model: fees off instructor share. Franchise model: fees off totalGross BEFORE deductions, never carry forward as shortfall.**
Reason: Locked-in Decision 1 of the payment plan.
Consequence: `processPayoutForInstructor` math is asymmetric by design. `simulatePayoutForInstructor` must match. Touch one → touch the other.

**2026-05-16 — Step 4f.0 audit closed: £1,890.90 historical Stripe gap is OUT OF SCOPE for the Friday cron.**
Reason: Three known cases (Hicksy £594, Elena £82.50, Maisie £1,214.40) were settled manually between Fraser-as-platform and Fraser-as-instructor. Root causes (apex 307 redirect + narrow CHECK constraint) were both fixed 2026-05-10.
Consequence: Do not backfill those three `credit_transactions` rows. Step 4f governs forward-only Friday-cron math.

**2026-05-15 — Platform Stripe schedule = Manual. Platform revenue and learner-credit escrow commingle in one Stripe account.**
Reason: Fraser explicitly chose this over a third Connect account for platform revenue. Cashflow visibility over structural refund-safety.
Consequence: The Next Payout Preview widget is the visibility safety net. `simulatePayoutForInstructor` must stay byte-for-byte in lockstep with `processPayoutForInstructor`. Do not re-propose splitting platform revenue into a separate Stripe entity.

**2026-05-15 — Three-state booking model: `scheduled` / `chargeable` / `refunded`. Dual-confirmation flow deleted.**
Reason: Instructor is paid for every lesson on their calendar unless the learner gave 48h+ notice. "Did the lesson happen?" is the wrong question.
Consequence: Do not re-add `cancelled` / `rescheduled` / `disputed` / `confirmed` states. Late-cancel under 48h sets `credit_forfeited = TRUE` and leaves `scheduled` until the cron flips it to `chargeable`. Late-cancel of a refunded booking is impossible by construction.

---

## 2026-04 / 2026-05 — Architecture & navigation

**2026-05-10 — Stripe webhook URL canonicalises on `www.coachcarter.uk`, never apex.**
Reason: Vercel 307-redirects apex → www. Stripe doesn't follow webhook redirects.
Consequence: Any new Stripe webhook configuration must use the `www.` host. If a new domain ships (e.g. instructorbook.co.uk), test for redirects before pointing Stripe at it.

**2026-05-10 — `credit_transactions_type_check` constraint widened to permit `purchase` / `refund` / `slot_purchase` / `admin_add` / `admin_remove` / `edit_adjustment` / `referral_bonus` / `referral_reward` / `legacy_grandfather`.**
Reason: Narrow constraint silently broke admin and webhook INSERTs inside try/catch.
Consequence: Any new credit_transaction type must be added to the constraint AND `api/_credit-grant.js`. Don't catch INSERT errors silently on this table.

**2026-05-10 — Self-serve learner bookings cap at 84 days (12 weeks).**
Reason: Operational and pedagogical reasons; broadcast offers re-aggregate past this cap deliberately.
Consequence: Only `bookOfferSeries()` may create bookings past 84 days. Don't add a per-instructor advance-window setting.

**2026-04 — Waitlist feature deleted; replaced by `learner_availability` + `_notify-availability.js`.**
Reason: Single primitive for "ping me when something opens up".
Consequence: Don't re-add `waitlist` table. See CLAUDE.md "intentionally removed".

**2026-04 — Q&A feature deleted (learner/instructor pages, API, `qa_questions`/`qa_answers` tables, daily digest cron).**
Reason: Zero real-world use.
Consequence: Don't re-add.

**2026-04 — Booking page is slot-first. Lesson length is picked inside the modal, not via a pill bar.**
Reason: UX research; pill bar added cognitive load before slot selection.
Consequence: Don't re-add `.lesson-type-pills` / `renderLessonTypePills` / `selectLessonType`.

---

## 2026-04 — Multi-tenancy

**2026-04 — Multi-tenant SaaS architecture. Every tenant-scoped table has `school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1`.**
Reason: InstructorBook national rollout; CoachCarter is school_id=1.
Consequence: Every new query MUST filter `WHERE school_id = ${schoolId}`. Every new JWT includes `school_id`.

---

## Superseded

**[Superseded 2026-05-21] — "`api/instructors?action=list` publicly returns instructor email and phone."**
Re-verified on current `main`: `api/instructors.js` public `list` selects only `id`, `name`, `slug`, `bio`, `photo_url`, `active`, `pass_rate`, `years_experience`, and `specialisms`. Frontend usage under `public/` only needs the public shape, primarily `id`, `name`, and `slug`.

**[Superseded 2026-05-21] — "Drift residual is 3 refund-bug bookings (#117, #133, #214)."**
This held at the moment PR #186 landed. Superseded by PR #187 the same day, which flipped `credit_returned = TRUE` on all three rows. Drift is now 0.

**[Superseded 2026-05-15] — "Platform Stripe schedule is Automatic Daily; Fraser receives a separate platform-revenue feed."**
Superseded by the Manual schedule decision (PR #132). Fraser is now a normal instructor on the Friday cron via `acct_1THXFyIAf6hvFTx9`.

**[Superseded 2026-05-15] — Seven-state booking lifecycle.**
Superseded by the three-state model (PR #125 + hotfix #126). Old states (`pending` / `confirmed` / `cancelled` / `rescheduled` / `disputed` etc.) collapsed deterministically per the migration; CHECK constraint enforces the new set.

**[Superseded 2026-05-10] — "credit_transactions only allows `purchase` and `refund`."**
Superseded by the widened CHECK constraint (commit 853f31c). Was the cause of silent INSERT failures in admin adjust-credits and webhook handlers.

**[Superseded 2026-05-10] — "Stripe webhook lives at `coachcarter.uk/api/webhook`."**
Superseded by `www.coachcarter.uk/api/webhook`. The apex URL silently 307'd every event for weeks.

**[Superseded 2026-05] — INSTRUCTOR-PAYMENTS-PLAN.md Steps 3–4g sequencing.**
Superseded by `PER-INSTRUCTOR-CREDITS-PLAN.md`. The new plan inherits the schemas and decided rules but reshuffles delivery (Step 0 transactional refactor first, pricing helper before writer code, two-helper pricing split).

**[Superseded 2026-04] — Magic-link-as-login.**
Superseded by email + password sign-in across all three roles (May 2026). Magic-link infrastructure survives only for: SMS code flow, learner password-reset codes, and the one-time email-code migration path for pre-password learner accounts. Do not re-introduce a magic-link sign-in flow.
