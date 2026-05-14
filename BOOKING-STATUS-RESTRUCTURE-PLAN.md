# Booking Status Restructure Plan

The plan for collapsing CoachCarter's seven-state booking-status model into a three-state model, deleting the dual-confirmation system, and aligning the payout pipeline with the new "instructor paid unless 48h+ notice" rule.

> **Companion document**: [`INSTRUCTOR-PAYMENTS-PLAN.md`](INSTRUCTOR-PAYMENTS-PLAN.md). This restructure should land **before** Step 4 of that plan, because Step 4's payout-snapshot logic builds on the eligibility filter that this work rewrites.

## Goal in one sentence

Replace the seven-state booking lifecycle (`confirmed`, `awaiting_confirmation`, `completed`, `no_show`, `disputed`, `cancelled`, `rescheduled`) and its dual-confirmation email flow with a three-state model (`scheduled`, `chargeable`, `refunded`) governed by a single rule — *the instructor is paid unless the learner gave 48h+ notice*.

## Current state

### The seven-state lifecycle

`db/migration.sql` enforces:
```sql
CHECK (status IN ('confirmed', 'completed', 'cancelled', 'rescheduled',
                  'awaiting_confirmation', 'disputed', 'no_show'));
```

A live booking flows:
1. Created as `confirmed` (slots.js, webhook.js, setmore-sync.js, admin.js).
2. Hourly `prompt-confirmations` cron (`api/reminders.js:425-536`) transitions ended lessons to `awaiting_confirmation` and emails both parties a confirm link.
3. Both submit via `POST /api/learner?action=confirm-lesson` or `POST /api/instructor?action=confirm-lesson` → `api/_confirmation-resolver.js` resolves to `completed`, `no_show`, or `disputed`.
4. Backstop: `auto-confirm` cron (`api/reminders.js:538-614`) forces resolution at 48h post-lesson by fabricating missing confirmations.
5. Parallel-but-separate: `api/cron-auto-complete.js` flips `confirmed → completed` once `scheduled_date + end_time < NOW()` — overlaps with the confirmation cron.
6. Cancellations write `cancelled`; reschedules write `rescheduled` on the old row and `confirmed` on the new one (`api/slots.js:2442-2468`).

### The payout filter

`api/_payout-helpers.js:32-35`:
```sql
AND (
  lb.status = 'completed'
  OR (lb.status = 'confirmed' AND lb.scheduled_date <= CURRENT_DATE - INTERVAL '3 days')
)
```

The 3-day grace was a safety net for the confirmation flow stalling.

### Why this is being torn down

- The dual-confirmation flow is overwrought for a small driving school — almost every lesson resolves the same way (`completed`), and disputes are handled out-of-band anyway.
- `cron-auto-complete` and `prompt-confirmations`/`auto-confirm` overlap and race each other.
- The new model encodes the actual policy already in the cancellation logic in `slots.js`: *instructor paid unless learner gave 48h+ notice*.

## The new model

### States

| Status | Meaning | Blocks slot? | Instructor paid? |
|---|---|---|---|
| `scheduled` | On the calendar, not yet resolved | Yes | Not yet |
| `chargeable` | Past lesson, instructor will be paid | Yes (for historical-overlap detection) | Yes |
| `refunded` | Killed booking, credit returned to learner | No | No |

### Transitions

```
       (book)
          │
          ▼
     scheduled ─────────────────► chargeable
          │     (end_time +1h, cron)     │
          │                              │
          ▼                              ▼
      refunded ◄─────── (admin override only) ──┘
```

- **`scheduled` → `chargeable`** — automatic, hourly cron, when `(scheduled_date + end_time) < NOW() - INTERVAL '1 hour'`. One-hour buffer absorbs clock skew and reschedule races.
- **`scheduled` → `refunded`** — any of:
  - Learner cancels with ≥48h notice (`slots.js` cancellation path).
  - Instructor cancels their own slot (any time).
  - Instructor manually cancels on the learner's behalf (any time — learner messaged outside system).
  - Admin manually cancels.
- **Late-cancel under 48h (learner)** — credit is *forfeited*. Status stays `scheduled` but new column `credit_forfeited = TRUE` is set. The hourly cron flips to `chargeable` after end-time as normal. Instructor still gets paid. This keeps the calendar UI sensible (no "chargeable" badge on a future-dated lesson).
- **`chargeable` → `refunded`** — admin manual override only (goodwill, retroactive dispute, post-payout correction).
- **`refunded`** — terminal. No transition out.

### The principle

> **The instructor is paid for every lesson on their calendar, unless the learner gave 48h+ notice that it wouldn't happen.**

This must be stated in `CLAUDE.md` and `docs/booking-statuses.md` so future-Claude doesn't accidentally undo it by re-adding a "did the lesson happen?" prompt.

## What gets deleted

| File / endpoint | Action |
|---|---|
| `public/learner/confirm-lesson.html` | DELETE |
| `public/learner/confirm-lesson.js` | DELETE |
| `POST /api/learner?action=confirm-lesson` | DELETE handler |
| `POST /api/instructor?action=confirm-lesson` | DELETE handler |
| `api/_confirmation-resolver.js` | DELETE file |
| `?action=prompt-confirmations` in `api/reminders.js` (lines 425-536) | DELETE handler + dispatch |
| `?action=auto-confirm` in `api/reminders.js` (lines 538-614) | DELETE handler + dispatch |
| `api/cron-auto-complete.js` | REPLACE — see new cron below |
| `vercel.json` lines 6-7 (prompt-confirmations, auto-confirm crons) | DELETE |
| `vercel.json` line 14 (cron-auto-complete) | KEEP — repoint at new logic |
| `POST /api/admin?action=resolve-dispute` (`api/admin.js:1147-1182`) | DELETE — no more disputed bookings |
| `?action=pending-confirmations` (if exists in learner.js) | DELETE |
| Dispute-counter on admin dashboard (`api/admin.js:266`) | DELETE column |
| `lesson_confirmations` table | KEEP one release cycle (rollback safety), DROP in follow-up migration |
| `sent_reminders` rows where `reminder_type = 'confirmation_prompt'` | LEAVE — historical record, harmless |

## What stays (and gets renamed)

- All cancellation logic in `slots.js`. The 48h-rule branches stay; the only change is the terminal status string (`cancelled` → `refunded`) and the late-cancel branch writes `credit_forfeited = TRUE` instead of leaving the booking with status `cancelled`.
- All rescheduling logic in `slots.js:2442-2468`. The old row becomes `refunded` (was `rescheduled`). `lesson_bookings.rescheduled_from` audit column is retained — the *value* in `rescheduled_from` is what now distinguishes a reschedule-refund from a plain cancel-refund.
- The Setmore sync (`setmore-sync.js`) continues writing `scheduled` for new bookings and `refunded` for cancellations during the transition window (Fraser is nearly off Setmore — sync code may be retired entirely soon).

## Sequenced steps

### Step 1 — Helper module + docs (~1 hour, no behaviour change)

**1a. New module `api/_booking-status.js`.**

Exports constants and predicates. Nothing else in the codebase imports it yet. This is created first so Step 3's diffs are smaller.

```javascript
const SCHEDULED  = 'scheduled';
const CHARGEABLE = 'chargeable';
const REFUNDED   = 'refunded';

const ALL_STATUSES      = [SCHEDULED, CHARGEABLE, REFUNDED];
const LIVE_STATUSES     = [SCHEDULED];          // selectable for cancel/reschedule
const BLOCKING_STATUSES = [SCHEDULED, CHARGEABLE]; // block the slot for new bookings
const PAYABLE_STATUSES  = [CHARGEABLE];

function isLive(s)       { return s === SCHEDULED; }
function isChargeable(s) { return s === CHARGEABLE; }
function blocksSlot(s)   { return s === SCHEDULED || s === CHARGEABLE; }
function isTerminal(s)   { return s === REFUNDED; }

module.exports = {
  SCHEDULED, CHARGEABLE, REFUNDED,
  ALL_STATUSES, LIVE_STATUSES, BLOCKING_STATUSES, PAYABLE_STATUSES,
  isLive, isChargeable, blocksSlot, isTerminal
};
```

**1b. New doc `docs/booking-statuses.md`.** State diagram (ASCII), transitions table, who-sets-each, payment implications, history-of-change section ending with "May 2026 — collapsed from 7 to 3 states; see `BOOKING-STATUS-RESTRUCTURE-PLAN.md` for migration."

**1c. CLAUDE.md updates** in the same commit:
- Replace the seven-status list in the Setmore section with the three new values.
- Add to "Key conventions": *"Don't inline booking-status string lists. Use `api/_booking-status.js` predicates and constants."*
- Add `docs/booking-statuses.md` to the docs index.
- Add the load-bearing principle: *"Instructor is paid for every lesson on their calendar unless the learner gave 48h+ notice."*

**Acceptance:**
- New module exports verified by importing into a one-off node script.
- CLAUDE.md grep for `'awaiting_confirmation'` returns zero matches.

---

### Step 2 — Schema migration with mapped backfill (~2 hours)

**2a. Migration block in `db/migration.sql`.**

```sql
-- ── Collapse booking statuses from 7 to 3 ───────────────────────────────
-- Drop the existing check, remap rows, recreate with new values.
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_status_check;

UPDATE lesson_bookings SET status = CASE status
  WHEN 'confirmed'             THEN 'scheduled'
  WHEN 'awaiting_confirmation' THEN 'scheduled'
  WHEN 'completed'             THEN 'chargeable'
  WHEN 'no_show'               THEN 'chargeable'
  WHEN 'disputed'              THEN 'chargeable'
  WHEN 'cancelled'             THEN 'refunded'
  WHEN 'rescheduled'           THEN 'refunded'
  ELSE status
END
WHERE status IN ('confirmed','awaiting_confirmation','completed','no_show','disputed','cancelled','rescheduled');

ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('scheduled', 'chargeable', 'refunded'));

-- New flag for late-cancellations (under 48h)
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE;
```

**2b. Mapping rationale (for the doc + commit message):**

| Old | New | Why |
|---|---|---|
| `confirmed` | `scheduled` | Live, no resolution yet |
| `awaiting_confirmation` | `scheduled` | The flow's being deleted; treat as plain live |
| `completed` | `chargeable` | Instructor was paid |
| `no_show` | `chargeable` | New rule: instructor still paid |
| `disputed` | `chargeable` | Default in instructor's favour; admin can flip individual cases to `refunded` post-migration if Fraser wants |
| `cancelled` | `refunded` | Credit was/should-be returned |
| `rescheduled` | `refunded` | Old half of a reschedule pair; `rescheduled_from` on new row preserves the audit trail |

**2c. Pre-migration audit** — before running, dump counts in dev:

```sql
SELECT status, COUNT(*) FROM lesson_bookings GROUP BY status;
```

If any `disputed` rows exist, Fraser reviews each one individually and decides whether to flip to `refunded` *before* the migration runs (cleaner than after). Capture the IDs in the commit message.

**Acceptance:**
- Migration applies cleanly via `GET /api/migrate?secret=...`.
- `SELECT DISTINCT status FROM lesson_bookings` returns only `{scheduled, chargeable, refunded}`.
- Row counts before/after reconcile: `count_old(confirmed+awaiting_confirmation) = count_new(scheduled minus new-this-window)`, etc.
- No row has `status IS NULL`.
- `credit_forfeited` column exists and defaults to `FALSE` for all existing rows.

---

### Step 3 — Code-level rename + helper adoption (~4–6 hours)

Refactor each file currently containing status string literals to use `api/_booking-status.js`. Run in a single PR.

**Backend files:**

| File | Edit |
|---|---|
| `api/slots.js` | Replace `'confirmed'` → `SCHEDULED`; `'cancelled'`/`'rescheduled'` → `REFUNDED`; IN-list arrays use `LIVE_STATUSES` / `BLOCKING_STATUSES`. Late-cancel branch sets `credit_forfeited = TRUE`, status stays `SCHEDULED`. |
| `api/instructor.js` | Cancel handler, calendar feed |
| `api/learner.js` | Booking list filters |
| `api/admin.js` | Stats query (drop disputed-counter line 266), reschedule handler, cancel handler |
| `api/webhook.js` | `handleSlotBooking`, `handleOfferBooking`, `handleFreeOffer` all write `SCHEDULED` |
| `api/setmore-sync.js` | `'confirmed'` → `SCHEDULED`; `'cancelled'` → `REFUNDED` |
| `api/_travel-time.js` | Slot-conflict filter uses `BLOCKING_STATUSES` |
| `api/calendar.js` | Calendar export uses `BLOCKING_STATUSES` |
| `api/cron-retention.js` | Cleanup query uses constants |
| `api/cron-referral-rewards.js` | Eligibility uses `isChargeable` |
| `api/reminders.js` | `send-due`, `daily-schedule` filter by `SCHEDULED` |
| `api/_payout-helpers.js` | **Handled separately in Step 5** |

**Frontend files** (status badge labels, filters in JS):

| File | Edit |
|---|---|
| `public/learner/lessons.html` + `.js` | Past tab = `chargeable`/`refunded`; upcoming = `scheduled` |
| `public/learner/profile.html` | Update status labels |
| `public/learner/book.js` | Past-bookings count, status filters |
| `public/learner/buy-credits.html`/`.js` | "credits used on past lessons" tally — switch to `chargeable` |
| `public/instructor/dashboard.html`/`.js`, `index.html`/`.js` | Status badges, agenda filter |
| `public/instructor/earnings.html`/`.js` | "Lessons taught" tally uses `chargeable` |
| `public/instructor/learners.html`/`.js` | Past-lessons-with-learner count |
| `public/admin/portal.html`/`.js`, `dashboard.js` | All status filters and badge maps; remove disputed/awaiting columns |
| Anywhere a status colour chip is rendered | Three colours: blue (scheduled), green (chargeable), grey (refunded) |

**Acceptance:**
- Grep across `api/` and `public/` for the seven old status strings returns zero hits *outside the migration block itself*.
- Playwright suite passes (post-Step 6 update).
- Manual smoke: book → see `scheduled` chip; cancel ≥48h → `refunded`; cancel <48h → stays `scheduled` with `credit_forfeited = TRUE`, no credit returned.

---

### Step 4 — Replace the confirmation crons with a single flip cron (~1 hour)

**4a. Rewrite `api/cron-auto-complete.js`** as a single `scheduled → chargeable` flip:

```javascript
const result = await sql`
  UPDATE lesson_bookings
     SET status = 'chargeable'
   WHERE status = 'scheduled'
     AND (scheduled_date + end_time) < (NOW() - INTERVAL '1 hour')
`;
```

Keep the existing path/filename for vercel.json continuity, or rename to `cron-flip-chargeable.js` and update vercel.json. Either works — the rename better reflects what it does.

**4b. Delete from `vercel.json`**:
- prompt-confirmations cron entry
- auto-confirm cron entry

**4c. Delete dispatchers in `api/reminders.js`:**
- Action dispatch lines for `prompt-confirmations` and `auto-confirm`.
- The two handler functions (lines 425-614).
- The `resolveConfirmations` import.

**4d. Delete the resolver and confirmation endpoints:**
- `api/_confirmation-resolver.js`
- `confirm-lesson` action handlers in `learner.js` and `instructor.js`
- `public/learner/confirm-lesson.html` + `.js`
- `?action=resolve-dispute` in `admin.js` (lines 1147-1182)
- Admin portal UI affordances pointing at resolve-dispute (search `portal.js` and `portal.html`)

**Acceptance:**
- Hourly cron flips eligible scheduled bookings to chargeable; doesn't touch refunded ones.
- The 1-hour buffer is honoured: a lesson ending at 14:00 stays `scheduled` if cron runs at 14:30, flips at 15:30 cron run.
- `GET /api/learner?action=confirm-lesson` returns 404 (handler gone).
- Vercel cron dashboard shows two fewer crons.

---

### Step 5 — Payout filter rewrite (~1 hour)

**5a. `api/_payout-helpers.js:32-35`** — replace the WHERE clause:

```javascript
AND lb.status = 'chargeable'
```

Drop the 3-day grace — the new model has its own 1-hour buffer on `scheduled → chargeable` and no confirmation step to stall.

**5b. Same change in `getEligibleSchoolBookings` (line 316-319)** — currently has the duplicated old condition.

**5c. Risk window analysis (for the commit message and the doc):**

> Payouts run Fri 09:00 UTC (`vercel.json`). With the new model, a Thursday-19:00 lesson is flipped to `chargeable` at the 20:30 cron run, leaving ~12 hours for Fraser to manually mark `refunded` before payout if a dispute surfaces. Rare; handled by admin retroactive refund post-payout (record stays in `payout_line_items`; the `refunded` flip itself doesn't unwind a Stripe transfer).

**Acceptance:**
- Payout dry-run on Friday-morning prod data returns the same instructor list and pence-exact same totals as the *new* logic would have produced for the previous week (compare against the actual `instructor_payouts` row for last Friday).
- A booking flipped to `refunded` after a payout has run does *not* appear in the next payout (no double-recovery).

---

### Step 6 — Test sweep + docs (~2 hours)

**6a. Playwright suite.**
No tests currently reference confirm-lesson (verified via grep on `tests/`). Update any booking-flow tests that assert on status strings — switch to the new vocabulary. Add one new test: late-cancel (<48h) → booking stays `scheduled` with `credit_forfeited = TRUE`, no credit returned. After cron flip, status becomes `chargeable`.

**6b. Doc updates:**
- `PROJECT.md` — removed `confirm-lesson` actions; new `_booking-status.js` module; new `docs/booking-statuses.md`.
- `DEVELOPMENT-ROADMAP.md` — entry "May 2026 — collapsed booking statuses to 3-state model; deleted dual-confirmation flow."
- `MIGRATION-PLAN.md` — note new module + status constants.

**Acceptance:**
- All docs grep clean for old status names except in explicit "history" sections.

## Migration shape — summary

```sql
-- One transactional block
BEGIN;

ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_status_check;

UPDATE lesson_bookings SET status = CASE status
  WHEN 'confirmed'             THEN 'scheduled'
  WHEN 'awaiting_confirmation' THEN 'scheduled'
  WHEN 'completed'             THEN 'chargeable'
  WHEN 'no_show'               THEN 'chargeable'
  WHEN 'disputed'              THEN 'chargeable'
  WHEN 'cancelled'             THEN 'refunded'
  WHEN 'rescheduled'           THEN 'refunded'
END;

ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('scheduled', 'chargeable', 'refunded'));

ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
```

Reverse migration (if needed within rollback window):

```sql
-- Best-effort: collapse-then-expand loses information (no_show vs completed).
-- Default reverse: everything chargeable -> completed, refunded -> cancelled.
-- Manual fixup needed for any rows that were originally no_show/disputed/rescheduled.
ALTER TABLE lesson_bookings DROP CONSTRAINT lesson_bookings_status_check;

UPDATE lesson_bookings SET status = CASE status
  WHEN 'scheduled'  THEN 'confirmed'
  WHEN 'chargeable' THEN 'completed'
  WHEN 'refunded'   THEN CASE WHEN rescheduled_from IS NOT NULL THEN 'rescheduled' ELSE 'cancelled' END
END;

ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('confirmed','completed','cancelled','rescheduled','awaiting_confirmation','disputed','no_show'));

-- credit_forfeited column can stay; harmless if old code ignores it.
```

The reverse only works for one release cycle while `lesson_confirmations` rows still exist — after the follow-up drop migration, it's lossy.

## Risks

| Risk | Mitigation |
|---|---|
| Migration runs mid-Friday between payout job and cleanup, putting payouts in inconsistent state | **Don't deploy on a Friday.** Pick Mon–Wed. The migration is fast (one UPDATE + constraint swap) but discipline matters |
| Browser-cached HTML/JS shows old status badges to logged-in users | Bump asset version query strings in `sidebar.js`/affected pages; Vercel's hashing handles JS but inline HTML labels won't refresh until reload |
| In-flight `awaiting_confirmation` bookings during deploy | Migration maps them to `scheduled`. Next cron flips them to `chargeable`. Verify zero `awaiting_confirmation` rows after migration. |
| Setmore sync writes `cancelled` (literal) during transition window | Step 3 ships the Setmore rename atomically with the migration. If they desync, the new CHECK constraint will reject — fail fast is fine. Fraser is nearly off Setmore anyway. |
| Late-cancel under 48h forfeits credit *and* leaves booking `scheduled` — double-payout risk? | No: status stays `scheduled`, cron flips to `chargeable` at end-time +1h as normal. Single payout path. The `credit_forfeited` flag is informational only (UI label, audit). |
| Rollback after `lesson_confirmations` is dropped | Keep the table around (empty, dormant) for one release cycle as a rollback safety. Schedule the DROP for ~2 weeks later in a follow-up migration |
| Tests break silently because Playwright doesn't check status strings | Add one new test for the late-cancel → scheduled-with-forfeit → chargeable path so the new policy is regression-locked |
| `instructor_payouts` already-recorded for a booking that later gets `refunded` via admin override | Admin-override-to-refunded after payout already wrote a `payout_line_items` row is fine for accounting — the line item stays, Fraser handles the goodwill refund out-of-band via Stripe. Document this explicitly. |

## Suggested sequencing

### This week (one PR, four commits)

1. **Step 1** — new module + docs + CLAUDE.md updates. Commit 1.
2. **Step 2** — schema migration. Commit 2. *Do not merge yet.*
3. **Steps 3 + 4 + 5** — code refactor + cron rewrite + payout filter. Commit 3.
4. **Step 6** — test + doc sweep. Commit 4.

Open PR end-of-week. Merge **Monday or Tuesday** of the following week (avoid Friday payout collision). Run migration immediately after merge via `GET /api/migrate?secret=...`. Smoke-test, then let it sit.

### Two weeks later

Follow-up PR: drop `lesson_confirmations` table, remove the reverse-migration helper, remove this plan document (or archive it under `docs/history/`).

### Before instructor #2 onboards

All of the above must be done before `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4 ships. Step 4 of that plan touches the same payout query — landing both at once will be hard to reason about.

## What this interacts with

- **`INSTRUCTOR-PAYMENTS-PLAN.md` Step 3** (Phase 1 schema groundwork) — independent. Can ship before or after this work.
- **`INSTRUCTOR-PAYMENTS-PLAN.md` Step 4** (per-instructor credit scoping + payout snapshot reads) — depends on this restructure. The payout filter rewrite in Step 5 here should land first; then Step 4 of the payments plan changes the price-source (live → `list_price_pence`) on top of the new filter. Reversed order is painful.
- **The deferred "Step 4f — Stripe-fee pass-through"** (A3: net-of-Stripe at booking level) — also depends on `list_price_pence` and the payout filter. Lands cleanly after this + Step 4. Mention in 4f's eventual writeup that this restructure is a prerequisite.
- **`FRANCHISE-MODEL-PLAN.md`** — unaffected (its rate/tier work is orthogonal to status semantics).

## Open questions

1. **`api/admin.js:266`** has a `disputed` counter on the dashboard stats query. Removing it is a one-liner but make sure the dashboard widget that consumes it doesn't break — quick frontend grep needed during Step 3.

2. **Disputed bookings in current production data** — Fraser should run the pre-migration audit (Step 2c) and personally review every existing `disputed` row before mapping them all to `chargeable`. If any of them should be `refunded`, decide before the migration runs.

3. **Verify Friday payout cron actually runs at 09:00 UTC** in `vercel.json` before locking in the "Thursday risk window" framing. If it's been moved earlier, the risk window shrinks and the case for grace-removal gets stronger.

4. **`lesson_bookings.cancelled_at` and `cancel_reason` columns** — keep both. They're set on transition to `refunded` and carry information that `refunded` alone doesn't (when, why).
