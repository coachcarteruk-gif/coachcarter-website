# CoachCarter: Competitor Features Roadmap

> Inspired by Total Drive and Setmore. **15 of 17 done.**
>
> **Last updated:** 2026-03-31

---

## Status

| # | Feature | Status |
|---|---------|--------|
| 1 | Lesson reminder notifications | DONE |
| 2 | Rescheduling | DONE |
| 3 | Multiple lesson types/durations | DONE |
| 4 | Colour-coded lesson types | DONE |
| 5 | Instructor-initiated booking | DONE |
| 6 | Recurring/repeat bookings | DONE |
| 7 | Drop-off location | DONE |
| 8 | Calendar start time & working hours | DONE |
| 9 | "Today" quick-jump button | DONE |
| 10 | Scheduling lead time | DONE |
| 11 | Agenda/list view | DONE |
| 12 | Hide weekends toggle | DONE |
| 13 | Cancellation visibility toggle | DONE |
| 14 | Per-service booking links | DONE |
| 15 | Waiting list | TODO |
| 16 | Google Calendar bi-directional sync | Deferred (post-app-launch) |
| 17 | Print calendar | DONE |

---

## Remaining

### Feature 15: Waiting List

**Effort: 2-3 sessions**

When no slots are available, learners can join a waitlist. On cancellation, matching learners are notified. First-come-first-served with a 2-hour booking window before the next person is notified. Entries auto-expire after 2 weeks.

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

**API (`api/waitlist.js`):** `join`, `my-waitlist`, `leave`, `check` (called on cancellation)

**`api/slots.js`:** Cancel action triggers waitlist check.

---

### Feature 16: Google Calendar Bi-directional Sync

**Deferred to post-app-launch. Effort: 4-5 sessions.**

Webcal feeds already handle CoachCarter→Google. This would add Google→CoachCarter (read personal events as blocked time). Requires Google OAuth2 for instructors.

---

## What CoachCarter Does Better Than Competitors

| Strength | Detail |
|----------|--------|
| Hours balance + Klarna | Flexible hour packages with bulk discounts |
| Race-condition prevention | 10-minute slot reservation during Stripe checkout |
| DL25 competency framework | 39 sub-skills across 17 categories |
| AI Examiner + Quiz | Neither competitor has anything close |
| WhatsApp notifications | More personal than SMS |
| Multiple availability windows/day | More flexible than one open/close per day |
| Recurring bookings | Weekly series with conflict detection |
| Post-lesson skill self-assessment | Session logging is unique |
| webcal:// subscription feeds | Learner + instructor feeds with VALARM reminders |
