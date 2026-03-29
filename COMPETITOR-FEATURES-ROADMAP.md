# CoachCarter: Competitor Features Roadmap

> Comprehensive plan for 17 improvements inspired by Total Drive and Setmore, designed for migration-aware implementation. Each feature is built API-first so both the current web PWA and the future React Native app benefit.
>
> **Competitors analysed:** Total Drive (web.totaldrive.app) — driving school management platform; Setmore (go.setmore.com) — general appointment scheduling with branded booking pages.
>
> **Last updated:** 2026-03-29

---

## Architecture Principles (from MIGRATION-PLAN.md)

Every feature in this roadmap follows these constraints:

1. **API-first** — All business logic lives in serverless API routes. Frontend is a thin display layer.
2. **`?action=` routing** — Every new API action follows the existing pattern.
3. **Standardised responses** — `{ ok: true, ...data }` for success, `{ error: true, code: 'X', message: '...' }` for errors.
4. **No web-only dependencies** — Nothing that won't port to React Native.
5. **`verifyAuth()` from `_shared.js`** — No alternative auth patterns.
6. **Migration-safe DB changes** — All schema changes go in `db/migration.sql` as idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements.

---

## Priority Matrix

| # | Feature | Priority | Effort | Impact | Depends On |
|---|---------|----------|--------|--------|------------|
| 1 | Lesson reminder notifications | **High** | Medium | Very High | Push infra (Phase 0.5) |
| 2 | Rescheduling | **High** | Medium | High | — |
| 3 | Multiple lesson types/durations | **High** | High | Very High | DB schema change |
| 4 | Colour-coded lesson types | **High** | Low | Medium | #3 |
| 5 | Instructor-initiated booking | **High** | Medium | High | — |
| 6 | Recurring/repeat bookings | Medium | High | Medium | #3 |
| 7 | Drop-off location | Medium | Low | Medium | — |
| 8 | Calendar start time & working hours greying | Medium | Low | Medium | — |
| 9 | "Today" quick-jump button | Medium | Trivial | Low | — |
| 10 | Scheduling lead time | Medium | Low | Medium | — |
| 11 | Agenda/list view | Medium | Medium | Medium | — |
| 12 | Hide weekends toggle | Lower | Trivial | Low | — |
| 13 | Cancellation visibility toggle | Lower | Trivial | Low | — |
| 14 | Per-service booking links | Lower | Low | Medium | #3 |
| 15 | Waiting list | Lower | Medium | Medium | — |
| 16 | Google Calendar bi-directional sync | Lower | High | Low | — |
| 17 | Print calendar | Lower | Low | Low | — |

---

## Implementation Plan

---

### Feature 1: Lesson Reminder Notifications

**Inspired by:** Total Drive (SMS reminders with configurable timing + custom message), Setmore (email reminders with 1-day-before default, separate team/customer notification controls)

**Why this matters:** Currently CoachCarter only has `.ics` VALARM reminders embedded in calendar files (2hr + 15min before). These only fire if the learner has synced the calendar — many won't. Both competitors send server-side reminders. This is the single highest-ROI feature for reducing no-shows.

**What to build:**
- Server-side scheduled reminder system (email + WhatsApp) sent 24 hours before each lesson
- Instructor reminder email at the start of each working day with that day's schedule
- Optional: "tomorrow's lessons" summary email for the instructor each evening
- Configurable reminder timing per instructor (24hr default, option for 48hr or 12hr)

**Database changes:**
```sql
-- Add to migration.sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS reminder_hours INTEGER DEFAULT 24;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS daily_schedule_email BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS sent_reminders (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES lesson_bookings(id),
  reminder_type TEXT NOT NULL, -- 'learner_24h', 'instructor_daily', 'instructor_24h'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  channel TEXT NOT NULL, -- 'email', 'whatsapp', 'push'
  UNIQUE(booking_id, reminder_type)
);
```

**API changes (`api/reminders.js` — new file):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `send-due` | POST | Admin/Cron | Called by Vercel Cron every hour. Finds bookings where `scheduled_date - NOW() <= reminder_hours` and no row in `sent_reminders`. Sends email + WhatsApp to learner, optionally push notification. |
| `daily-schedule` | POST | Admin/Cron | Called by Vercel Cron at 7am. Sends instructor their day's schedule as a formatted email. |
| `settings` | GET | Instructor | Returns current reminder config. |
| `update-settings` | POST | Instructor | Updates `reminder_hours`, `daily_schedule_email`. |

**Vercel Cron (`vercel.json`):**
```json
{
  "crons": [
    { "path": "/api/reminders?action=send-due&secret=CRON_SECRET", "schedule": "0 * * * *" },
    { "path": "/api/reminders?action=daily-schedule&secret=CRON_SECRET", "schedule": "0 7 * * *" }
  ]
}
```

**Frontend changes:**
- Instructor Settings page: add "Reminder Settings" section with timing dropdown and daily schedule toggle
- No learner-facing UI needed — reminders are automatic

**Migration-plan alignment:**
- Uses the same `_auth-helpers.js` SMTP transporter for emails
- Uses the same Twilio WhatsApp integration from `slots.js`
- Push notifications (Phase 0.5 of migration plan) can be added as a channel later — the `sent_reminders` table already has a `channel` column
- The `send-due` logic is pure server-side, so the React Native app benefits automatically
- Cron approach avoids the need for a persistent background worker

**Estimated effort:** 2 sessions (1 for API + cron, 1 for instructor settings UI)

---

### Feature 2: Rescheduling

**Inspired by:** Setmore (toggle for "Allow online rescheduling" — learners reschedule themselves via the booking page)

**Why this matters:** Currently learners must cancel (potentially losing their credit if < 48 hours) and then manually rebook. This creates friction, reduces rebooking rates, and causes unnecessary credit forfeitures.

**What to build:**
- A "Reschedule" action that atomically moves a booking to a new time slot
- Same cancellation policy applies (48hr cutoff — no rescheduling within 48hr of the original lesson)
- No credit transaction involved — the booking just moves
- Both learner-initiated and instructor-initiated

**Database changes:**
```sql
-- Add to migration.sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS rescheduled_from INTEGER REFERENCES lesson_bookings(id);
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;
```

**API changes (`api/slots.js` — new action):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `reschedule` | POST | Learner | Body: `{ booking_id, new_date, new_start_time }`. Validates: booking is confirmed, new slot is available, original lesson is > 48hr away. Atomically: marks old booking as `status='rescheduled'`, creates new booking with `rescheduled_from` pointer, sends confirmation email + WhatsApp. |

**`api/instructor.js` — new action:**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `reschedule-booking` | POST | Instructor | Same logic but instructor-initiated. No 48hr restriction (instructor can reschedule anytime). |

**Frontend changes:**
- `public/learner/book.html`: Add "Reschedule" button on upcoming lesson cards (alongside existing Cancel). Clicking opens the slot picker pre-filled for the same instructor. On slot selection, calls `reschedule` instead of `book`.
- `public/instructor/index.html`: Add "Reschedule" option in the booking detail modal. Opens a date/time picker, calls `reschedule-booking`.
- Confirmation modal should show: "Moving your lesson from [old date/time] to [new date/time]"

**Migration-plan alignment:**
- Logic is 100% server-side — the app just calls `POST /api/slots?action=reschedule`
- Reuses the existing slot-availability checking from `action=available`
- Reuses the existing email/WhatsApp notification functions
- The new `status='rescheduled'` value needs handling in queries that currently filter by `status != 'cancelled'` — search for these in `slots.js`, `instructor.js`, and `learner.js`

**Edge cases to handle:**
- Prevent rescheduling a booking that's already been rescheduled (follow the chain to the latest active booking)
- If the new slot overlaps with the reservation system, honour it
- Reschedule count could be capped (e.g. max 2 reschedules per booking) to prevent abuse

**Estimated effort:** 2 sessions (1 for API, 1 for learner + instructor UI)

---

### Feature 3: Multiple Lesson Types & Durations

**Inspired by:** Total Drive (6 types: Lesson, Driving Test, Mock Test, Pass Plus, Refresher, Motorway with flexible durations), Setmore (9 services each with unique duration, buffer, and price)

**Why this matters:** Currently hard-coded to 90-minute lessons at £82.50. This blocks offering 1hr lessons, 2hr lessons, test-day bookings, Pass Plus, or refresher sessions. Both competitors treat service variety as a first-class feature.

**What to build:**
- A `lesson_types` table defining available services
- Each type has: name, duration (minutes), price (pence), colour, buffer override, active flag
- The slot-generation engine respects per-type durations
- Booking flow lets the learner select a lesson type before seeing available slots
- Credit system adapts: 1 credit = 1 lesson of any type, OR credits have different values per type

**Database changes:**
```sql
-- Add to migration.sql
CREATE TABLE IF NOT EXISTS lesson_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,              -- 'Standard Lesson', 'Driving Test', etc.
  slug TEXT NOT NULL UNIQUE,        -- 'standard', 'driving-test', etc.
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  price_pence INTEGER NOT NULL DEFAULT 8250,
  colour TEXT NOT NULL DEFAULT '#f58321',  -- hex colour for calendar
  buffer_minutes INTEGER,          -- NULL = use instructor default
  credits_required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default types
INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, credits_required, sort_order)
VALUES
  ('Standard Lesson', 'standard', 90, 8250, '#3b82f6', 1, 1),
  ('2-Hour Lesson', '2hr', 120, 11000, '#8b5cf6', 2, 2),
  ('Driving Test', 'driving-test', 180, 16500, '#ef4444', 2, 3),
  ('Mock Test Day', 'mock-test-day', 120, 11000, '#f59e0b', 2, 4),
  ('Pass Plus', 'pass-plus', 120, 11000, '#22c55e', 2, 5),
  ('Refresher', 'refresher', 60, 5500, '#06b6d4', 1, 6)
ON CONFLICT (slug) DO NOTHING;

-- Link bookings to lesson types
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS lesson_type_id INTEGER REFERENCES lesson_types(id);

-- Remove the hard-coded 90-minute CHECK constraint
-- (the existing constraint: end_time - start_time = 5400 seconds)
-- This needs careful handling — see implementation notes below
```

**API changes:**

**`api/lesson-types.js` (new file):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `list` | GET | None | Returns all active lesson types (for booking page). |
| `all` | GET | Admin | Returns all types including inactive (for admin management). |
| `create` | POST | Admin | Creates a new lesson type. |
| `update` | POST | Admin | Updates an existing type (name, duration, price, colour, active). |

**`api/slots.js` changes:**

| Action | Change |
|--------|--------|
| `available` | New required param: `lesson_type_id` or `duration_minutes`. Slot generation uses the type's duration instead of hard-coded `SLOT_MINUTES = 90`. Buffer uses type's `buffer_minutes` if set, else instructor default. |
| `book` | New required param: `lesson_type_id`. Validates credit balance against `credits_required`. Sets `lesson_bookings.lesson_type_id`. |
| `checkout-slot` | Price comes from `lesson_types.price_pence` instead of hard-coded `LESSON_PRICE_PENCE`. |

**Frontend changes:**
- `public/learner/book.html`: Add lesson type selector (card grid or dropdown) before the calendar. Selecting a type filters available slots to that duration. The confirmation modal shows type name, duration, and price.
- `public/instructor/index.html`: Booking cards show lesson type badge with colour. Calendar events use the type's colour.
- Admin page: CRUD interface for managing lesson types.

**Migration-plan alignment:**
- `lesson_types` table gets a TypeScript interface in the future `lib/types.ts`
- The `list` action returns data the React Native app can use identically
- No web-only dependencies — just API calls and data rendering
- The slot generation engine stays in `slots.js` (server-side) — both web and app call the same endpoint
- Consider making `competency-config.js` aware of lesson types (e.g. different skills tracked per type)

**Critical implementation detail — removing the CHECK constraint:**
The existing migration has `CHECK (EXTRACT(EPOCH FROM (end_time - start_time)) = 5400)`. This must be dropped:
```sql
ALTER TABLE lesson_bookings DROP CONSTRAINT IF EXISTS lesson_bookings_duration_check;
```
Then add a new flexible constraint:
```sql
ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_duration_check
  CHECK (EXTRACT(EPOCH FROM (end_time - start_time)) BETWEEN 1800 AND 14400);
  -- Between 30 minutes and 4 hours
```

**Estimated effort:** 3-4 sessions (1 for DB + lesson_types API, 1 for slots.js refactor, 1-2 for frontend)

---

### Feature 4: Colour-Coded Lesson Types on Calendar

**Inspired by:** Total Drive (separate "Delivered" and "Booked" colours per type), Setmore (colour-coded left border per service)

**Why this matters:** Once multiple lesson types exist (#3), visual distinction on the calendar becomes essential. At a glance, instructors should know if a block is a standard lesson, a driving test, or a mock test day.

**What to build:**
- Calendar event blocks use the `lesson_types.colour` value
- Two visual states per colour: solid fill for confirmed, lighter/hatched for completed
- Instructor calendar legend showing type → colour mapping
- Learner calendar also shows type colours on their upcoming lessons

**Database changes:** None — colour already added in Feature #3's `lesson_types` table.

**API changes:** None — the `lesson_types.colour` is already returned by `list` action, and booking queries already join with `lesson_types` if Feature #3 is implemented.

**Frontend changes:**

**`public/instructor/index.html`:**
- Week/Daily view: Set `background-color` on booking blocks from `booking.lesson_type_colour`
- Confirmed = solid colour at 80% opacity, Completed = same colour at 30% opacity with a checkmark icon
- Add a small legend bar below the calendar header: coloured circles + type names
- CSS approach: `style="background: ${colour}20; border-left: 3px solid ${colour}"` (Setmore-style left border is cleaner than full-fill)

**`public/learner/book.html`:**
- Available slots show the lesson type colour as a left-border or badge
- Upcoming lessons strip uses the type colour

**Migration-plan alignment:**
- Colours are stored server-side and returned via API — React Native reads the same data
- In React Native, colours map directly to `View` `style.backgroundColor`
- No web-only CSS dependency — the colour hex values work on any platform

**Estimated effort:** 1 session (purely frontend, depends on #3 being done)

---

### Feature 5: Instructor-Initiated Booking

**Inspired by:** Total Drive ("Add Lesson" modal from the diary — instructor selects pupil, date, time, duration, type, pick-up, drop-off, and creates the booking directly)

**Why this matters:** Currently only learners can book. If a learner phones to arrange a lesson, or if the instructor wants to rebook someone after a cancellation, there's no way to do it within the system. The instructor has to tell the learner to go book it themselves.

**What to build:**
- "Add Lesson" button on the instructor calendar
- Modal with: learner selector (searchable dropdown from `my-learners`), date picker, time picker, lesson type selector, notes field
- Creates a booking directly without requiring learner credit deduction (instructor-booked lessons can be marked as "paid cash" or deduct from credits)
- Sends confirmation notification to the learner

**Database changes:**
```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'learner';
  -- 'learner', 'instructor', 'admin'
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'credit';
  -- 'credit', 'stripe', 'cash', 'free'
```

**API changes (`api/instructor.js` — new action):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `create-booking` | POST | Instructor | Body: `{ learner_id, scheduled_date, start_time, lesson_type_id, payment_method, notes }`. Validates slot availability (reuses logic from `slots.js`). If `payment_method='credit'`, deducts from learner balance. Creates booking with `created_by='instructor'`. Sends learner notification. |

**Frontend changes:**
- `public/instructor/index.html`: Add "+" button (or "Add Lesson" in the header). Opens a modal matching Total Drive's pattern:
  - Searchable learner dropdown (populated from `my-learners` API)
  - Date picker (default: selected day on calendar, or today)
  - Time picker (show only available slots for that day)
  - Lesson type dropdown (from `lesson_types` API, includes duration auto-fill)
  - Payment method radio: "Deduct credit" / "Cash" / "Free"
  - Notes textarea
  - "Create" button

**Migration-plan alignment:**
- Server-side logic reuses the availability-checking engine from `slots.js`
- The modal in React Native becomes a screen or bottom sheet — no web-specific UI patterns
- The `created_by` column lets the app distinguish learner-booked from instructor-booked lessons (useful for analytics)

**Estimated effort:** 2 sessions (1 for API, 1 for instructor UI modal)

---

### Feature 6: Recurring/Repeat Bookings

**Inspired by:** Total Drive ("Repeat Lesson" dropdown: One Off Lesson / Weekly / Fortnightly), Setmore (event repeat options)

**Why this matters:** Many learners book the same time every week. Currently they must manually rebook each time. A "repeat weekly for 4 weeks" option saves time and locks in their preferred slot.

**What to build:**
- "Repeat" option in both learner and instructor booking flows
- Options: One off (default), Weekly for 2/3/4/6/8 weeks
- Creates multiple `lesson_bookings` rows in one transaction
- Each booking in the series is independent (can be individually cancelled/rescheduled)
- Validates all slots are available before creating any
- Total credits required shown upfront

**Database changes:**
```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS series_id UUID;
  -- NULL for one-off bookings, shared UUID for all bookings in a recurring series
```

**API changes (`api/slots.js` — modified action):**

| Action | Change |
|--------|--------|
| `book` | New optional params: `repeat_weeks` (2/3/4/6/8). If set, checks availability for all N weeks, validates credit balance for N bookings, creates N rows sharing a `series_id`. Returns all created bookings. If any slot is taken, returns which weeks conflict so the learner can adjust. |
| `cancel` | New optional param: `cancel_series` (boolean). If true and booking has a `series_id`, cancels all future bookings in the series. |

**Frontend changes:**
- `public/learner/book.html`: After selecting a slot, show a "Repeat?" toggle/dropdown in the confirmation modal. When repeat is selected, show:
  - Which weeks will be booked (date list)
  - Any conflicts highlighted in red
  - Total credits required: "2 credits x 4 weeks = 8 credits"
- `public/learner/lessons.html`: Group recurring bookings visually (e.g. "Weekly series — 3 of 4 remaining")

**Migration-plan alignment:**
- All logic is server-side (one API call creates the series)
- The `series_id` UUID is database-native and works across web and app
- React Native booking screen just adds the same repeat UI component
- No recurring background jobs needed — all bookings are concrete rows created at booking time

**Estimated effort:** 2-3 sessions (1 for API logic, 1 for learner UI, 0.5 for instructor UI if needed)

---

### Feature 7: Drop-Off Location

**Inspired by:** Total Drive (separate Pick-up and Drop-off location dropdowns per lesson, drawn from a configurable locations list)

**Why this matters:** Currently CoachCarter stores only `pickup_address` on the learner profile. But learners often need to be dropped somewhere different (school, work, home vs. pick-up point). Test-day bookings especially need a test centre as the destination.

**What to build:**
- Add `dropoff_address` field to bookings (not the learner profile — drop-off varies per lesson)
- Instructor sees both addresses on the booking card
- Optional: saved locations list (like Total Drive's Diary Locations) so common addresses can be selected from a dropdown

**Database changes:**
```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS pickup_address TEXT;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS dropoff_address TEXT;

-- Optional: saved locations for quick selection
CREATE TABLE IF NOT EXISTS saved_locations (
  id SERIAL PRIMARY KEY,
  instructor_id INTEGER REFERENCES instructors(id),
  name TEXT NOT NULL,           -- 'Home', 'Work', 'Stevenage Test Centre'
  address TEXT,
  is_test_centre BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**API changes:**

**`api/slots.js`:**
- `book` and `checkout-slot`: Accept optional `pickup_address` and `dropoff_address` in the request body. Default `pickup_address` from the learner's profile if not provided.

**`api/instructor.js`:**
- `create-booking`: Accept `pickup_address` and `dropoff_address`.
- `schedule` and `schedule-range`: Return both addresses in the booking response.
- New actions: `saved-locations` (GET), `save-location` (POST), `delete-location` (POST).

**Frontend changes:**
- `public/learner/book.html`: Add optional "Pick-up" and "Drop-off" fields in the booking confirmation modal. Pick-up pre-filled from profile. Drop-off is blank by default.
- `public/instructor/index.html`: Booking cards show both addresses. If a `saved_locations` list exists, show a dropdown for quick selection in the instructor-initiated booking modal (#5).
- Instructor settings: "Diary Locations" management page (matching Total Drive's pattern).

**Migration-plan alignment:**
- Addresses are text fields — no geocoding or map dependency required
- The saved locations API is simple CRUD that ports trivially to React Native
- Per-booking addresses (not just per-learner) are more flexible and support the test-day use case
- The `is_test_centre` flag could later integrate with mock test GPS route tracking

**Estimated effort:** 1-2 sessions (straightforward schema + UI additions)

---

### Feature 8: Calendar Start Time & Working Hours Greying

**Inspired by:** Total Drive (configurable "Diary Start Time" dropdown — e.g. 7:00 AM — plus non-working hours greyed out based on per-day working hours)

**Why this matters:** The current calendar shows all hours equally. If the instructor works 8:30–17:30, the hours before and after are wasted space. Total Drive greys these out and lets you set where the calendar scroll position starts.

**What to build:**
- Instructor-configurable "Calendar start hour" (persisted in instructor profile)
- Working hours rendered with a white/coloured background; non-working hours greyed out
- Calendar auto-scrolls to the start hour on load
- Lunch break support (grey band in the middle of the day)

**Database changes:**
```sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS calendar_start_hour INTEGER DEFAULT 7;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS lunch_start TIME;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS lunch_end TIME;
```

**API changes:**
- `api/instructor.js` → `update-profile`: Accept `calendar_start_hour`, `lunch_start`, `lunch_end`.
- `api/instructor.js` → `profile`: Return these new fields.
- `api/instructor.js` → `availability`: Also return lunch times for rendering.

**Frontend changes:**

**`public/instructor/index.html` (week view):**
```javascript
// On load, scroll the time-grid to the instructor's start hour
const startHourPx = (calendarStartHour - 6) * 48; // 48px per hour
timeGrid.scrollTop = startHourPx;

// Grey out non-working hours per day column
availabilityWindows.forEach(window => {
  // Cells outside window.start_time – window.end_time get class "non-working"
});

// Grey out lunch break
if (lunchStart && lunchEnd) {
  // Add grey band between lunchStart and lunchEnd
}
```

CSS:
```css
.time-cell.non-working {
  background: #f3f4f6;
  pointer-events: none;
}
.time-cell.lunch-break {
  background: repeating-linear-gradient(45deg, #f9fafb, #f9fafb 5px, #f3f4f6 5px, #f3f4f6 10px);
}
```

**`public/learner/book.html`:** Same greying applied so learners see which hours are working hours.

**Migration-plan alignment:**
- Data is server-side — React Native reads the same `profile` and `availability` API responses
- The greying logic is pure presentation — different implementation in RN (using `View` opacity) but same data
- `calendar_start_hour` is used by the RN `ScrollView` `contentOffset` prop

**Estimated effort:** 1 session (mostly CSS/JS on the existing calendar)

---

### Feature 9: "Today" Quick-Jump Button

**Inspired by:** Both competitors — Setmore has a prominent "Today" button in the calendar header; Total Drive has left/right arrows plus a date-picker icon

**Why this matters:** Small but meaningful UX improvement. When navigating weeks/months, getting back to today requires clicking through each week. A single "Today" button fixes this instantly.

**What to build:**
- "Today" pill button in the calendar header (both learner and instructor calendars)
- Active/highlighted state when viewing today's date
- Keyboard shortcut: `T` key jumps to today (like Setmore)

**Database changes:** None.

**API changes:** None.

**Frontend changes:**

**`public/instructor/index.html` and `public/learner/book.html`:**
```html
<!-- Add between the prev/next arrows and the date display -->
<button class="today-btn" onclick="jumpToToday()">Today</button>
```

```javascript
function jumpToToday() {
  currentDate = new Date();
  renderCalendar(); // re-render at today's date
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.key === 't' && !e.target.closest('input, textarea')) jumpToToday();
});
```

```css
.today-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--white);
  cursor: pointer;
  font-size: 13px;
}
.today-btn:hover { background: var(--accent-lt); }
```

**Migration-plan alignment:** Trivial — React Native equivalent is a `TouchableOpacity` with the same `jumpToToday` logic. No API dependency.

**Estimated effort:** 0.5 session (quick UI addition)

---

### Feature 10: Scheduling Lead Time

**Inspired by:** Setmore ("Lead time: How much notice do you require before an appointment?" — configurable as hours/days)

**Why this matters:** Currently a learner can book a slot starting in 30 minutes if one is available. This doesn't give the instructor time to prepare or travel to the pick-up location.

**What to build:**
- Per-instructor "minimum booking notice" setting (default: 24 hours)
- The slot-availability engine excludes slots that start within the lead time window
- Instructor can override for specific bookings (e.g. instructor-initiated booking ignores lead time)

**Database changes:**
```sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS min_booking_notice_hours INTEGER DEFAULT 24;
```

**API changes (`api/slots.js`):**
- `available`: After generating slots, filter out any where `slot_start - NOW() < min_booking_notice_hours`. This is a one-line addition to the existing availability engine.

**API changes (`api/instructor.js`):**
- `update-profile`: Accept `min_booking_notice_hours` (0–168, i.e. 0 = no minimum, up to 1 week).
- `profile`: Return the field.

**Frontend changes:**
- `public/instructor/availability.html` or profile page: Add "Minimum booking notice" dropdown (e.g. None / 2 hours / 6 hours / 12 hours / 24 hours / 48 hours).
- No learner-facing change needed — they just won't see last-minute slots.

**Migration-plan alignment:**
- Purely server-side filtering — the app calls the same `available` API and gets pre-filtered results
- One column addition, one filter line in the availability engine

**Estimated effort:** 0.5 session (tiny change)

---

### Feature 11: Agenda/List View

**Inspired by:** Setmore (Agenda view — flat chronological list of all upcoming appointments, keyboard shortcut `A`)

**Why this matters:** The time-grid calendar is great for seeing the shape of a day/week, but sometimes you just want a scrollable list of "what's coming up". Especially useful on mobile where the weekly grid gets cramped.

**What to build:**
- New "Agenda" view mode alongside Daily/Weekly/Monthly
- Shows a flat scrollable list: date headers, then booking cards underneath each date
- Infinite scroll or "load more" pagination
- Each card shows: time, learner name, lesson type (with colour badge), pick-up address, status
- Filter options: upcoming only / include past / specific date range

**Database changes:** None.

**API changes:**
- The existing `schedule` and `schedule-range` actions in `instructor.js` already return bookings in a format suitable for a list view. May need a new action `agenda` that returns bookings sorted chronologically across a wider date range (e.g. next 30 days) with pagination.

```
GET /api/instructor?action=agenda&from=2026-03-29&days=30&page=1
```

**Frontend changes:**

**`public/instructor/index.html`:**
- Add "Agenda" icon/button to the view switcher (alongside Day/Week/Month)
- New render function `renderAgendaView()` that creates:
  ```html
  <div class="agenda-view">
    <div class="agenda-date-header">Monday, 31 March 2026</div>
    <div class="agenda-card" style="border-left: 3px solid #3b82f6">
      <span class="agenda-time">09:00 – 10:30</span>
      <span class="agenda-learner">Jane Smith</span>
      <span class="agenda-type">Standard Lesson</span>
      <span class="agenda-pickup">📍 123 High Street</span>
    </div>
    <!-- more cards... -->
    <div class="agenda-date-header">Tuesday, 1 April 2026</div>
    <!-- ... -->
  </div>
  ```
- Empty state: "No upcoming lessons" with a link to share the booking page

**`public/learner/lessons.html`:** This page is already essentially an agenda view for the learner. Could be enhanced with the same styling.

**Migration-plan alignment:**
- In React Native this becomes a `FlatList` with `SectionList` for date headers — a natural fit
- The API returns structured data — no DOM dependency
- Mobile-first design pattern (list view is actually better on phones than grids)

**Estimated effort:** 1-2 sessions (API tweak + new view rendering)

---

### Feature 12: Hide Weekends Toggle

**Inspired by:** Setmore ("Hide weekends" toggle in the calendar view switcher)

**Why this matters:** If the instructor doesn't work weekends (Sat/Sun both have 00:00–00:00 working hours in the Total Drive config), the 7-column week view wastes 28% of horizontal space on empty columns.

**What to build:**
- Toggle button in the calendar header: "Hide weekends"
- When active, the week view shows Mon–Fri only (5 columns, each wider)
- Preference persisted in localStorage (or instructor profile)
- Monthly view: weekends still show but are visually muted

**Database changes:**
```sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS hide_weekends BOOLEAN DEFAULT false;
```

**API changes:** Add to `update-profile` / `profile` response.

**Frontend changes:**

**`public/instructor/index.html`:**
```javascript
// In week view column generation:
const days = hideWeekends
  ? [1, 2, 3, 4, 5]  // Mon-Fri
  : [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun

// Column width calculation:
const colWidth = hideWeekends ? '20%' : '14.28%';
```

Toggle in the header:
```html
<label class="toggle-label">
  <input type="checkbox" id="hideWeekends" onchange="toggleWeekends()">
  Hide weekends
</label>
```

**Migration-plan alignment:** Preference stored server-side, React Native reads it. Layout logic is platform-specific but trivial.

**Estimated effort:** 0.5 session

---

### Feature 13: Cancellation Visibility Toggle

**Inspired by:** Total Drive ("Hide Cancellations" dropdown on the diary view)

**Why this matters:** Cancelled bookings clutter the calendar. An instructor might cancel 3-4 bookings per week — seeing these as greyed-out blocks adds noise when you're trying to see your actual schedule.

**What to build:**
- Toggle: "Show cancelled" / "Hide cancelled" in the calendar header
- Default: hidden (matches Total Drive's default)
- When shown, cancelled bookings appear with reduced opacity and strikethrough text
- Persisted preference

**Database changes:** None (or add to instructor profile like #12).

**API changes:**
- `schedule-range`: Add optional `include_cancelled` param (default false). Currently the query already filters `status != 'cancelled'` — make this conditional.

**Frontend changes:**
- Toggle button in calendar header
- Cancelled booking style: `opacity: 0.4; text-decoration: line-through;`
- Different border colour (grey) to distinguish from active bookings

**Migration-plan alignment:** Purely display logic + one API param.

**Estimated effort:** 0.5 session

---

### Feature 14: Per-Service Booking Links

**Inspired by:** Setmore (Easy Share page — each service has a "Copy link" button that generates a unique URL going directly to booking that specific service)

**Why this matters:** Instead of sending a learner to the general booking page, you could send a link like `coachcarter.uk/book?type=2hr` that pre-selects a 2-hour lesson. Useful for marketing, social media, and responding to enquiries.

**What to build:**
- URL parameter support on the booking page: `/learner/book?type=standard` or `/learner/book?type=2hr`
- When a `type` param is present, skip the lesson type selection step and go straight to the calendar
- Shareable links page for the instructor (or just a section in settings)

**Database changes:** None (uses `lesson_types.slug` from Feature #3).

**API changes:** None (booking page reads the param client-side and passes the `lesson_type_id` to the `available` API).

**Frontend changes:**

**`public/learner/book.html`:**
```javascript
// On page load:
const params = new URLSearchParams(window.location.search);
const typeSlug = params.get('type');
if (typeSlug) {
  const type = lessonTypes.find(t => t.slug === typeSlug);
  if (type) {
    selectedType = type;
    skipTypeSelection = true;
    renderCalendar(); // Go straight to slots
  }
}
```

**`public/instructor/index.html` or a new settings section:**
- List of lesson types with "Copy link" buttons
- Each button copies: `https://coachcarter.uk/learner/book?type=${slug}`

**Migration-plan alignment:**
- Deep linking in React Native uses Expo Router's URL params — `book?type=standard` maps to the `book.tsx` screen with a `type` route param
- The same URL works for both web and app (universal links)

**Estimated effort:** 0.5 session (depends on #3 being done)

---

### Feature 15: Waiting List

**Inspired by:** Total Drive (SMS-based waiting list in the Reminders section)

**Why this matters:** When a learner's preferred time slot is taken, they have no way to express interest. A waitlist auto-notifies them when a cancellation opens up that slot, increasing rebooking rates and reducing instructor downtime.

**What to build:**
- "Join waitlist" button shown when a time slot is fully booked (or in a general "preferred times" form)
- When a cancellation occurs, check the waitlist and notify matching learners
- First-come-first-served: the first learner on the waitlist gets priority to book
- Auto-expire waitlist entries after 2 weeks

**Database changes:**
```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER REFERENCES learner_users(id) NOT NULL,
  instructor_id INTEGER REFERENCES instructors(id),  -- NULL = any instructor
  preferred_day INTEGER,  -- 0=Sun, 1=Mon, ..., 6=Sat. NULL = any day
  preferred_start_time TIME,  -- NULL = any time
  preferred_end_time TIME,
  lesson_type_id INTEGER REFERENCES lesson_types(id),
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'notified', 'booked', 'expired'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  notified_at TIMESTAMPTZ
);
```

**API changes:**

**`api/waitlist.js` (new file):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `join` | POST | Learner | Body: `{ instructor_id?, preferred_day?, preferred_start_time?, preferred_end_time?, lesson_type_id? }`. Creates a waitlist entry. |
| `my-waitlist` | GET | Learner | Returns the learner's active waitlist entries. |
| `leave` | POST | Learner | Removes a waitlist entry. |
| `check` | POST | Internal | Called automatically when a booking is cancelled. Finds matching waitlist entries, sends notification to the first matching learner, marks as `notified`. Gives them 2 hours to book before notifying the next person. |

**`api/slots.js` change:**
- In the `cancel` action, after cancelling a booking, call the waitlist check logic.

**Frontend changes:**
- `public/learner/book.html`: When no slots are available for a selected day/time, show: "No slots available. [Join waitlist for this time]"
- `public/learner/lessons.html`: "My Waitlist" section showing active waitlist entries with "Leave" buttons
- Notification: email + WhatsApp saying "A slot just opened up for [day] at [time]! Book now before it's taken."

**Migration-plan alignment:**
- Server-side matching + notification — app benefits automatically
- Push notification channel (Phase 0.5) is ideal for waitlist alerts
- Simple CRUD API that maps directly to React Native screens

**Estimated effort:** 2-3 sessions (1 for API + cancel integration, 1 for learner UI, 0.5 for notifications)

---

### Feature 16: Google Calendar Bi-Directional Sync

**Inspired by:** Setmore (Google Calendar connected as an overlay in the sidebar, bi-directional sync)

**Why this matters:** CoachCarter currently has one-way `webcal://` feeds (read-only). This means if a learner adds a personal event in Google Calendar that conflicts with a lesson, CoachCarter doesn't know about it. Bi-directional sync would let CoachCarter read the instructor's Google Calendar to block out times when they have personal events.

**What to build:**
- OAuth2 connection to Google Calendar (instructor-side)
- Read instructor's personal calendar events and treat them as blocked time (like blackout dates, but automatic)
- Optionally push CoachCarter bookings to Google Calendar as events (replacing the webcal feed)

**Why this is "Lower" priority:**
- Google OAuth adds significant complexity (token refresh, scope management, consent screen)
- The webcal feed already handles the CoachCarter → Google direction
- The main value (Google → CoachCarter blocking) could be achieved more simply by the instructor manually adding blackout dates
- This is a Phase 5+ feature in the migration plan context

**Database changes:**
```sql
CREATE TABLE IF NOT EXISTS calendar_connections (
  id SERIAL PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  calendar_id TEXT DEFAULT 'primary',
  sync_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_type, user_id, provider)
);
```

**API changes:**

**`api/calendar-sync.js` (new file):**

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `connect` | GET | Instructor | Initiates Google OAuth flow, returns redirect URL. |
| `callback` | GET | None | OAuth callback, exchanges code for tokens, stores in DB. |
| `disconnect` | POST | Instructor | Removes the connection. |
| `sync` | POST | Cron | Fetches recent Google Calendar events for all connected instructors, caches them as virtual blackout periods. |
| `status` | GET | Instructor | Returns connection status and last sync time. |

**Impact on slot availability:**
- The `available` action in `slots.js` would need to additionally check Google Calendar events as blocked times (similar to how it checks `instructor_blackout_dates`)

**Migration-plan alignment:**
- Google OAuth is web-initiated but the tokens are server-side — the React Native app can use the same connection
- In React Native, OAuth uses `expo-auth-session` which opens a web browser
- This is explicitly a later-phase feature and should not block other work

**Estimated effort:** 4-5 sessions (OAuth flow is the complex part)

---

### Feature 17: Print Calendar

**Inspired by:** Total Drive (Print button on the diary that opens browser print dialog with a print-optimised layout)

**Why this matters:** Some instructors like to have a paper copy of their schedule in the car. It's old-school but practical.

**What to build:**
- "Print" button in the instructor calendar header
- Print-optimised CSS stylesheet that:
  - Removes navigation, sidebar, buttons
  - Fills the page with the week grid
  - Uses high-contrast colours (works in black & white)
  - Adds the date range as a header
  - Shows learner names, times, pick-up addresses in each cell

**Database changes:** None.

**API changes:** None.

**Frontend changes:**

**`public/instructor/index.html`:**
```html
<button class="print-btn" onclick="window.print()">🖨 Print</button>
```

```css
@media print {
  .sidebar, .bottom-bar, .calendar-controls, .stats-row,
  .print-btn, .refresh-btn, .view-switcher { display: none !important; }

  .calendar-grid {
    width: 100% !important;
    max-height: none !important;
    overflow: visible !important;
  }

  .booking-block {
    color: #000 !important;
    border: 1px solid #000 !important;
    -webkit-print-color-adjust: exact;
  }

  .calendar-header-print {
    display: block !important;
    text-align: center;
    font-size: 16pt;
    margin-bottom: 10px;
  }
}
```

**Migration-plan alignment:**
- This is web-only — React Native doesn't have a print concept
- But it's zero-dependency and doesn't affect the API or data model
- Could be replaced in the app by a "Share schedule as PDF" feature using `expo-print`

**Estimated effort:** 0.5 session (CSS only)

---

## Implementation Sequence

Based on dependencies and the migration plan phases, here's the recommended build order:

### Sprint 1: Foundation (aligns with Migration Phase 0)
| # | Feature | Sessions | Notes |
|---|---------|----------|-------|
| 3 | Multiple lesson types | 3-4 | Unlocks #4, #6, #14. Core schema change. |
| 9 | Today button | 0.5 | Quick win. |
| 10 | Scheduling lead time | 0.5 | Quick win, one-line filter. |

### Sprint 2: Calendar Polish
| # | Feature | Sessions | Notes |
|---|---------|----------|-------|
| 4 | Colour-coded types | 1 | Depends on #3. |
| 8 | Working hours greying | 1 | Calendar UX. |
| 12 | Hide weekends | 0.5 | Calendar UX. |
| 13 | Cancellation toggle | 0.5 | Calendar UX. |
| 11 | Agenda view | 1-2 | New view mode. |

### Sprint 3: Booking Flow Improvements
| # | Feature | Sessions | Notes |
|---|---------|----------|-------|
| 2 | Rescheduling | 2 | High impact. |
| 5 | Instructor-initiated booking | 2 | High impact. |
| 7 | Drop-off location | 1-2 | Data model addition. |
| 14 | Per-service booking links | 0.5 | Depends on #3. |

### Sprint 4: Notifications & Engagement (aligns with Migration Phase 0.5)
| # | Feature | Sessions | Notes |
|---|---------|----------|-------|
| 1 | Lesson reminders | 2 | Highest-impact single feature. |
| 15 | Waiting list | 2-3 | Engagement + fill rate. |

### Sprint 5: Nice-to-Have
| # | Feature | Sessions | Notes |
|---|---------|----------|-------|
| 6 | Recurring bookings | 2-3 | Depends on #3. |
| 17 | Print calendar | 0.5 | Web-only. |
| 16 | Google Calendar sync | 4-5 | Complex, defer to post-app-launch. |

### Total: ~22-28 sessions across 5 sprints

---

## What CoachCarter Already Does Better

For context, here's what doesn't need copying from the competitors:

| Strength | Detail |
|----------|--------|
| **Credit system + Klarna** | More sophisticated than either competitor's payment model |
| **Race-condition prevention** | 10-minute slot reservation during Stripe checkout prevents double-bookings |
| **DL25 competency framework** | 39 sub-skills — far deeper than Total Drive's progress bars |
| **AI Examiner + Quiz** | Neither competitor has anything close |
| **WhatsApp notifications** | More personal than SMS, already integrated via Twilio |
| **Multiple availability windows/day** | More flexible than Total Drive's single open/close per day |
| **Post-lesson skill self-assessment** | Session logging is unique to the platform |
| **webcal:// subscription feeds** | Both learner and instructor feeds with built-in VALARM reminders |

---

## Notes for Claude Code Sessions

When implementing any feature from this roadmap:

1. **Start with the DB migration** — add to `db/migration.sql` as idempotent statements
2. **Build the API actions** — following `?action=` routing with standardised responses
3. **Test the API** — use `curl` or the admin portal before touching frontend
4. **Build the frontend** — thin display layer calling the API
5. **Update this document** — mark features as done, note any deviations
6. **Update MIGRATION-PLAN.md** — if the feature adds new tables, API routes, or shared modules
