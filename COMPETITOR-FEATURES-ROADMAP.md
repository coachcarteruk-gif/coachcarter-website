# CoachCarter: Competitor Features Roadmap

> Inspired by Total Drive and Setmore. **16 of 17 done.**
>
> **Last updated:** 2026-04-01

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
| 15 | Waiting list | DONE |
| 16 | Google Calendar bi-directional sync | Deferred (post-app-launch) |
| 17 | Print calendar | DONE |

---

## Remaining

### Feature 15: Waiting List — DONE

Implemented with a companion "Learner Weekly Availability" feature. Learners set their typical free times on their profile page. When no slots are available, learners can join the waitlist from the booking page. On cancellation, all matching waitlist learners are notified simultaneously via WhatsApp + email. First to book wins (existing slot reservation system handles races). Entries auto-expire after 14 days.

**Tables:** `learner_availability` (mirrors instructor_availability), `waitlist`
**API:** `api/waitlist.js` (join, my-waitlist, leave) + `checkWaitlistOnCancel()` hooked into `api/slots.js`
**UI:** Profile page (availability card + waitlist card), booking page (waitlist join on empty state)

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
