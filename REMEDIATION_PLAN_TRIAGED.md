# Remediation Plan — Triaged

Verified 2026-05-18 against actual codebase. Source: `~/Desktop/REMEDIATION_PLAN.md` (GPT audit on PR #147).

**Score:** 13 CONFIRMED, 10 PARTIAL, 0 FALSE POSITIVE, 0 INTENTIONAL, 0 ALREADY FIXED.

Audit is credible. Most "PARTIAL" verdicts are framing-overstatement, not wrong-on-the-code.

## Key reframings vs original audit

- **#06 + #09** are *pre-school-#2 onboarding blockers*, not live bugs. Invisible today because only school 1 has active paid bookings / Connect-enabled instructors. School #2 onboarding is the trigger event.
- **#07** real race is webhook-vs-webhook (Stripe retries), not webhook-vs-verify-session. `verify-session.js` doesn't touch `credit_transactions`.
- **#10** instructor payouts are already protected by `uq_payout_booking` UNIQUE index. Only `school_payouts` needs the equivalent guard.
- **#11** offers (`uq_offer_slot_manual`) and bookings (`uq_instructor_slot`) are protected. Only `slot_reservations` is racy.
- **#17** magic-link tokens and offer tokens are short-lived by design (5-min / 24h). Genuinely concerning: `calendar_token` (never expires, never rotates).
- **#23 + #24** overstated. Two of three "missing consent" pages are no-content redirect stubs. `docs/navigation.md` and `privacy.html` are clean.

## Recommended PR clustering

| PR | Findings | Priority | Scope | Notes |
|---|---|---|---|---|
| **A** | #01 + #02 | P2 | small | CI workflow + `node --check` + Playwright install + lockfile resync. Foundation for everything below. |
| **B** | #06 + #09 | P0 | medium | school_id in Stripe metadata + webhook handlers (kill `\|\| 1` default) + conflict checks + payout helper accepts schoolId. **Pre-school-#2 blocker.** |
| **C** | #08 | P0 | small | Offer learner lookup: 4 SELECTs need `AND school_id = ${schoolId}`. Can fold into PR-B. |
| **D** | #03 | P0 | small | Swap local `verifyCronAuth` → shared `_auth.js` version. Fix offer-expiry GET/POST mismatch in `vercel.json`. |
| **E** | #04 | P0 | small/medium | Add `{ roles: ['learner'] }` to `requireAuth` in `learner.js`, `calendar.js`, `advisor.js`. Broad test surface. |
| **F** | #05 | P0 | small/medium | Blackouts: filter by school_id. Learner notes: relationship check (same school + existing booking). |
| **G** | #07 + #11 + #12 | P0/P1 | small | Three UNIQUE-constraint adds: `credit_transactions.stripe_session_id`, partial unique on `slot_reservations` where not expired, partial unique for free-trial booking. Catch duplicate-key in callers. |
| **H** | #10 (school half) | P0/P1 | medium | Per-booking guard on `school_payouts`. Instructor payouts already safe. |
| **I** | #14 + #15 | P1 | medium | Webhook re-throw on fatal errors (so Stripe retries). `pg_try_advisory_lock` wrapper on every cron entry. |
| **J** | #13 | P1 | medium | Retire `create-checkout-session.js` + `verify-session.js`. Migrate `public/lessons.js` + `success.js` to credit/slot flows. **Touches real user path — care needed.** |
| **K** | #16 | P1 | medium | Extract `deleteLearnerCascade()` into `api/_gdpr.js`. Wrap in transaction. Anonymise paid bookings instead of hard-delete. |
| **L** | #17 | P1 | small | Add 7 missing tables to `handleExportData`. Add `calendar_token_rotated_at` + rotation UI on profile. |
| **M** | #18 | P2 | medium | Sweep `logAudit()` into `schools.js`, `connect.js`, `config.js`, 6 missing `admin.js` handlers. |
| **N** | #19 | P2 | medium | `notification_log` table + writes from Twilio/email/Setmore. **Defer until first delivery incident if no rush.** |
| **O** | #20 + #21 | P2 | small | `public/sw.js` carve-out for `/learner/*` `/instructor/*` `/admin/*`. Add 401 handling to instructor + admin auth modules. |
| **P** | #22 + #23 | P3 | medium | Move 6 inline `<script>` blocks to external files. Add consent loaders to `franchise-comparison.html` + `franchise-calculator.html`. |

**Skipped from original audit:**
- #24 stale-doc sweep as proposed — actual surface is ~5 lines in `PROJECT.md`. Fold into the relevant feature PR rather than its own branch.

## Order of operations

1. PR-A first — every later PR rests on this.
2. PR-D, E, F, G in parallel (small, independent, no shared files).
3. PR-B + PR-C bundled (same theme, same migration window).
4. PR-H, I, K, L, M as time allows.
5. PR-J needs a quiet weekend — it touches the live lessons-purchase path.
6. PR-N, O, P after the P0/P1 dust settles.

## Detailed evidence

See verification reports in agent transcripts; key file:line citations below.

**#03** — `api/ical-sync.js:14-19` local `verifyCronAuth` returns `true` when `CRON_SECRET` missing. `vercel.json:7` GETs `/api/offers?action=expire-offers`, handler at `api/offers.js:743` rejects non-POST. Lazy-expire at `offers.js:274-277` is masking this in prod.

**#04** — `api/learner.js:14-15`, `api/calendar.js:28-29`, `api/advisor.js:207` use `requireAuth(req)` with no roles arg. `_auth.js:177-199` skips role check when `roles` is empty.

**#05** — `api/instructor.js:794-887` blackouts: no school_id filter. `api/instructor.js:1855-1908` learner notes: no relationship check on `learner_id`.

**#06** — `api/slots.js:1389-1401` Stripe metadata omits `school_id`. `api/webhook.js:266` (and 124, 786) defaults to `school_id = 1`. `slots.js:1317-1350` conflict checks not school-scoped.

**#07** — `db/migration.sql:181` `stripe_session_id TEXT` no UNIQUE. `verify-session.js` doesn't touch `credit_transactions` (audit wrong on race partner). Webhook check-then-insert at `webhook.js:135-161`, 278, 875.

**#08** — `api/offers.js:208-217` SELECTs by email/phone with no school_id filter. Race-recovery path at 244-249 same issue. Only the INSERTs include school_id.

**#09** — `api/admin.js:1316` passes `{ schoolId }` to `processAllPayouts`. `_payout-helpers.js:365` signature drops the arg. SELECT at 366-373 pulls all active instructors from all schools.

**#10** — `_payout-helpers.js` has no `BEGIN/COMMIT`. Instructor payouts: `db/migration.sql:730` `uq_payout_booking UNIQUE` on `payout_line_items(booking_id)` prevents double-pay. School payouts: `school_payouts.booking_ids` is array column, no cross-row uniqueness.

**#11** — `slots.js:1314-1338` DELETE → SELECT → INSERT ON CONFLICT (no-op without unique constraint). `db/migration.sql:1196-1197` only non-unique indexes on `slot_reservations`.

**#12** — `slots.js:1763-1779` pre-check only. No DB unique on `lesson_bookings(learner_id, lesson_type_id)` for trial type.

**#13** — `create-checkout-session.js:16` accepts caller `line_items` + `metadata`. `verify-session.js:4-22` no auth. Referenced from `public/lessons.js:336,391` and `public/success.js:15`.

**#14** — `webhook.js:97-103` (`account.updated`) swallows errors then 200. `webhook.js:976-996` (booking insert failed) — even with commit 521941a's alert, still returns 200. `cron-reconcile-payments.js:80` only flags missing credit_transactions rows.

**#15** — No advisory-lock infrastructure anywhere. Reminders dedup is post-send (`reminders.js:78-167`). Instructor payouts accidentally safe via `uq_payout_booking`. School payouts exposed.

**#16** — Self-delete (`learner.js:1268-1298`) hits 17+ tables. Admin delete (`admin.js:1085-1093`) hits 4. Retention cron (`cron-retention.js:57-77`) matches self-delete. All three `DELETE FROM lesson_bookings` (violates CLAUDE.md anonymise-financial rule). No transactions.

**#17** — Export at `learner.js:1077-1153` missing: `learner_availability`, `mock_test_faults`, `instructor_learner_notes`, `cookie_consents`, `deletion_requests`, `lesson_confirmations`, `lesson_offers`. `calendar_token` at `db/migration.sql:20,59` no expiry/revocation. `calendar.js:160-169` lazy-issues, never rotates.

**#18** — Zero `logAudit` in `schools.js` (9 mutation handlers), `connect.js` (10), `config.js` (1). Six missing in `admin.js`: `handleEditBooking` (l.396), `handleUpdateLearner` (l.926), `handleTogglePayoutPause` (l.1151), `handleSetInstructorBlackouts` (l.1497), `handleUpdateReferralConfig` (l.1615), `handleResetPassword` (l.1777).

**#19** — No `delivery_log`/`message_log`/`sync_status` table. `_whatsapp.js:22-24` `console.warn` only.

**#20** — `sw.js:6-15` precaches `/learner/`. `sw.js:57-71` caches every successful HTML response with no auth-route carve-out.

**#21** — Learner has 401 handling (`learner-auth.js:62-72`). Instructor (`instructor-auth.js:39-54`) + admin (`admin-auth.js:41-57`) do not. Audit's "raw fetch without credentials" claim is unsupported.

**#22** — `middleware.js:117` no `'unsafe-inline'`. Inline `<script>` blocks in: `learner/index.html:746`, `learner/mock-test.html:1210`, `learner/log-session.html:847`, `learner/focused-practice.html:617`, `admin/franchise-comparison.html:766`, `admin/franchise-calculator.html:618`. Plus stub redirects at `learner/learn.html:7` + `learner/lessons-hub.html:7` (silently broken in prod).

**#23** — Real omissions: `admin/franchise-comparison.html` + `admin/franchise-calculator.html` (audit missed the latter). Other two are redirect stubs.

**#24** — `docs/navigation.md` clean. `privacy.html` clean. `PROJECT.md` has ~5 stale magic-link login refs at lines 130, 147. ~5-line edit, not a sweep.
