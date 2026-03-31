# CoachCarter: Competitor Features Roadmap

> 17 improvements inspired by Total Drive and Setmore. API-first, migration-aware.
>
> **Last updated:** 2026-03-31

---

## Architecture Principles

1. **API-first** — business logic in serverless routes, frontend is thin display layer
2. **`?action=` routing** — every endpoint follows the existing pattern
3. **Standardised responses** — `{ ok: true, ...data }` / `{ error: true, code, message }`
4. **No web-only deps** — everything must port to React Native
5. **`verifyAuth()` from `_shared.js`** — no alternative auth patterns
6. **Idempotent migrations** — `db/migration.sql` with `IF NOT EXISTS`

---

## Status

| # | Feature | Status | Date |
|---|---------|--------|------|
| 1 | Lesson reminder notifications | **TODO** | — |
| 2 | Rescheduling | DONE | 2026-03-30 |
| 3 | Multiple lesson types/durations | DONE | 2026-03-31 |
| 4 | Colour-coded lesson types | DONE | 2026-03-31 |
| 5 | Instructor-initiated booking | DONE | 2026-03-30 |
| 6 | Recurring/repeat bookings | **TODO** | — |
| 7 | Drop-off location | DONE | 2026-03-30 |
| 8 | Calendar start time & working hours | DONE | 2026-03-30 |
| 9 | "Today" quick-jump button | DONE | pre-existing |
| 10 | Scheduling lead time | DONE | 2026-03-30 |
| 11 | Agenda/list view | DONE | 2026-03-31 |
| 12 | Hide weekends toggle | DONE | 2026-03-30 |
| 13 | Cancellation visibility toggle | DONE | 2026-03-30 |
| 14 | Per-service booking links | **TODO** | — |
| 15 | Waiting list | **TODO** | — |
| 16 | Google Calendar bi-directional sync | **TODO** | — |
| 17 | Print calendar | DONE | 2026-03-30 |

**12 of 17 done. 5 remaining.**

---

## Completed Features (Summary)

### #2 Rescheduling
Learner `POST /api/slots?action=reschedule` (48hr cutoff, max 2 per chain). Instructor `POST /api/instructor?action=reschedule-booking` (no restrictions). Old booking gets `status='rescheduled'`, new booking links via `rescheduled_from`. Email + WhatsApp notifications.

### #3 Multiple Lesson Types & Durations
`lesson_types` table with admin CRUD (`api/lesson-types.js`). Seeded: Standard (90min/£82.50), 2-Hour (120min/£110). Balance system converted from integer credits to `balance_minutes`. Slot generation uses lesson type duration. All booking flows (book, checkout, cancel, reschedule) use minutes-based balance. Credits sold as hours at £55/hr with discount tiers (6-30 hrs). Dual-write maintains legacy `credit_balance` for rollback safety. Admin portal has Lesson Types management section.

### #4 Colour-Coded Lesson Types
Monthly pills use type colour as background. Weekly events use Setmore-style tinted background with coloured left border. Daily cards have type badge pill + coloured borders. Booking detail modal shows type. Learner upcoming bookings show coloured left border + type label. Completed = reduced opacity; cancelled overrides type colour.

### #5 Instructor-Initiated Booking
`POST /api/instructor?action=create-booking` with learner_id, date, time, lesson_type_id, payment_method (cash/credit/free), notes. "Add Lesson" button in calendar toolbar with searchable learner dropdown. Added `created_by` and `payment_method` columns.

### #7 Drop-Off Location
`pickup_address` and `dropoff_address` columns on `lesson_bookings` (per-booking, not just profile-level). Booking modals include optional drop-off field. Pickup defaults from learner profile. Reschedule carries addresses forward.

### #8 Calendar Working Hours
`calendar_start_hour` column on instructors (default 7). Non-working hours greyed out in daily/weekly views using availability windows.

### #9 Today Button
`goToday()` function + "Today" button in calendar toolbar. Pre-existing.

### #10 Scheduling Lead Time
`min_booking_notice_hours` column on instructors (default 24h). Slot generation filters out slots too close to current time.

### #11 Agenda/List View
4th view mode on instructor calendar. 14-day rolling window, bookings grouped by date headers. Cards show time, colour-coded type badge, learner name, pickup address, status. ±14 day navigation. Respects showCancelled toggle. No API changes.

### #12 Hide Weekends
"Weekdays" toggle in toolbar. Weekly/monthly views filter out Sat/Sun, CSS variable `--week-cols`/`--month-cols` for dynamic grid.

### #13 Cancellation Visibility
"Cancelled" toggle in toolbar. All three views filter via `showCancelled` variable. Cancelled bookings styled with red border, reduced opacity.

### #17 Print Calendar
Print button calls `window.print()`. `@media print` CSS hides nav/toolbar/modals, full-width layout, `break-inside: avoid` on cards.

---

## Remaining Features (Full Plans)

---

### Feature 1: Lesson Reminder Notifications

**Priority: HIGH | Effort: 2 sessions | Impact: Very High**

**Inspired by:** Total Drive (SMS reminders), Setmore (email reminders with 1-day-before default)

**Why:** Currently only `.ics` VALARM reminders (2hr + 15min). These only fire if the learner synced the calendar. Server-side reminders are the highest-ROI feature for reducing no-shows.

**What to build:**
- Email + WhatsApp reminder 24 hours before each lesson
- Instructor daily schedule email at 7am
- Configurable reminder timing per instructor (24hr default)

**Database:**
```sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS reminder_hours INTEGER DEFAULT 24;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS daily_schedule_email BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS sent_reminders (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES lesson_bookings(id),
  reminder_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  channel TEXT NOT NULL,
  UNIQUE(booking_id, reminder_type)
);
```

**API (`api/reminders.js`):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `send-due` | POST | Cron | Hourly. Finds bookings within reminder window, sends email + WhatsApp |
| `daily-schedule` | POST | Cron | 7am. Sends instructor their day's schedule |
| `settings` | GET | Instructor | Returns reminder config |
| `update-settings` | POST | Instructor | Updates reminder_hours, daily_schedule_email |

**Vercel Cron:**
```json
{ "path": "/api/reminders?action=send-due&secret=CRON_SECRET", "schedule": "0 * * * *" }
{ "path": "/api/reminders?action=daily-schedule&secret=CRON_SECRET", "schedule": "0 7 * * *" }
```

**Frontend:** Instructor settings page gets "Reminder Settings" section. No learner UI needed.

---

### Feature 6: Recurring/Repeat Bookings

**Priority: Medium | Effort: 2-3 sessions | Depends on: #3 (done)**

**Inspired by:** Total Drive ("Repeat Lesson" dropdown: One Off / Weekly / Fortnightly)

**Why:** Many learners book the same time every week. Currently must manually rebook each time.

**What to build:**
- "Repeat" option in booking modal: Weekly for 2/3/4/6/8 weeks
- Creates multiple `lesson_bookings` in one transaction
- Each booking is independent (can cancel/reschedule individually)
- Validates all slots available before creating any
- Total hours shown upfront

**Database:**
```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS series_id UUID;
```

**API changes (`api/slots.js`):**
- `book`: New optional `repeat_weeks` param. Checks availability for N weeks, validates balance for N × duration, creates N rows sharing a `series_id`. Returns conflicts if any slot taken.
- `cancel`: New optional `cancel_series` param. If true, cancels all future bookings in the series.

**Frontend:**
- Booking modal: "Repeat?" toggle shows date list, conflicts in red, total hours required
- Lessons page: group recurring bookings visually ("Weekly series — 3 of 4 remaining")

---

### Feature 14: Per-Service Booking Links

**Priority: Lower | Effort: 0.5 session | Depends on: #3 (done)**

**Inspired by:** Setmore (Easy Share page with per-service "Copy link" buttons)

**Why:** Send `coachcarter.uk/learner/book?type=2hr` to pre-select a lesson type. Useful for marketing and enquiry responses.

**What to build:**
- URL param `?type=slug` on booking page auto-selects lesson type and skips type selector
- Shareable links section for instructor (list of types with "Copy link" buttons)

**No DB or API changes** — booking page reads param client-side, passes `lesson_type_id` to API.

---

### Feature 15: Waiting List

**Priority: Lower | Effort: 2-3 sessions**

**Inspired by:** Total Drive (SMS-based waiting list)

**Why:** When preferred slots are taken, learners can express interest. Auto-notify on cancellation.

**What to build:**
- "Join waitlist" button when no slots available
- On cancellation, check waitlist and notify matching learners
- First-come-first-served with 2-hour booking window before next person notified
- Auto-expire entries after 2 weeks

**Database:**
```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER REFERENCES learner_users(id) NOT NULL,
  instructor_id INTEGER REFERENCES instructors(id),
  preferred_day INTEGER,
  preferred_start_time TIME,
  preferred_end_time TIME,
  lesson_type_id INTEGER REFERENCES lesson_types(id),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  notified_at TIMESTAMPTZ
);
```

**API (`api/waitlist.js`):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `join` | POST | Learner | Create waitlist entry with preferences |
| `my-waitlist` | GET | Learner | Active entries |
| `leave` | POST | Learner | Remove entry |
| `check` | POST | Internal | Called on cancellation, notifies matching learners |

**`api/slots.js`:** Cancel action triggers waitlist check.

---

### Feature 16: Google Calendar Bi-Directional Sync

**Priority: Lower | Effort: 4-5 sessions | Defer to post-app-launch**

**Inspired by:** Setmore (Google Calendar overlay, bi-directional sync)

**Why:** Currently one-way webcal feeds. Bi-directional would read instructor's Google Calendar to auto-block personal events. Lower priority because webcal already handles CoachCarter→Google direction, and blackout dates cover the reverse manually.

**What to build:**
- Google OAuth2 for instructors
- Read personal calendar events as blocked time
- Optionally push bookings to Google Calendar

**Database:** `calendar_connections` table (user_type, user_id, provider, tokens, sync state)

**API (`api/calendar-sync.js`):** connect, callback, disconnect, sync (cron), status

---

## What CoachCarter Already Does Better

| Strength | Detail |
|----------|--------|
| **Hours balance + Klarna** | Flexible hour packages with bulk discounts |
| **Race-condition prevention** | 10-minute slot reservation during Stripe checkout |
| **DL25 competency framework** | 39 sub-skills across 17 categories |
| **AI Examiner + Quiz** | Neither competitor has anything close |
| **WhatsApp notifications** | More personal than SMS, already integrated |
| **Multiple availability windows/day** | More flexible than one open/close per day |
| **Multiple lesson types** | Variable duration + colour-coded calendar |
| **Post-lesson skill self-assessment** | Session logging is unique to the platform |
| **webcal:// subscription feeds** | Learner + instructor feeds with VALARM reminders |

---

## Notes for Sessions

1. **DB migration** — add to `db/migration.sql` as idempotent statements
2. **Build API** — `?action=` routing with standardised responses
3. **Build frontend** — thin display layer calling the API
4. **Update this doc** — mark done, add implementation notes
5. **Update MIGRATION-PLAN.md** — if new tables, API routes, or shared modules added
