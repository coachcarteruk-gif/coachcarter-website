# Booking Flow Design Audit

> **Date**: 6 April 2026
> **Scope**: End-to-end booking flow — learner booking, instructor receiving/viewing/managing lessons, availability management
> **Method**: Code-level UX review of all HTML pages, API routes, modals, feedback patterns, and mobile considerations
> **Review**: Priorities validated and adjusted via multi-perspective council deliberation

---

## Overall Assessment

The booking flow is functionally complete — learners can book, instructors can manage. But the two sides feel like they were built independently. The learner experience is polished (slot feed, Stripe, recurring bookings), while the instructor side has inconsistent interactions, duplicate code, and mobile friction that matters because **instructors use their phones between lessons**.

### Strategic Filter (InstructorBook Launch)

> "Which of these fixes would make a new school's first week so smooth they tell another school about it?"

When a new school signs up for InstructorBook, their instructors will set up availability (#8, #9, #16) and their first learners will try to book (#4, #14). First-impression items are flagged with a rocket emoji throughout.

---

## Implementation Plan

### Sprint 1 — Emergency Patches (1 day)

Quick wins that each take under 30 minutes individually. Ship together in one afternoon.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 2 | Skip auto-refresh when input focused | 20 min | Check `document.activeElement`, skip cycle |
| 8+9 | Blackout saves: update state only on success + unify to explicit save | 2-3 hrs | These are the same fix — making blackouts use explicit save automatically fixes the desync |
| 3p | Toast CSS fix: remove `nowrap`, add `max-width` | 15 min | All pages benefit immediately |
| 5 | Remove status restriction on notes | 10 min | One `if` clause in the API |
| 11 | Replace `alert()` calls with toasts | 30 min | Find-and-replace across 3 files |
| 18 | Default time to next half-hour | 10 min | 4 lines of JS in 2 files |

### Sprint 2 — Guest Checkout & Mobile Fundamentals (2-3 days)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 4 | Inline validation on guest checkout | Half day | Per-field errors, keep toast as fallback |
| 3r | Touch targets to 44px, input font-size to 16px | Half day | Availability remove buttons + modal inputs |
| 10 | Retry buttons on all error empty states | Half day | All 5 instructor pages |
| 15 | Show reschedule count on lesson cards | 1-2 hrs | "1 reschedule remaining" badge |

### Sprint 3 — Instructor Calendar Overhaul (3-5 days)

Batch all `public/instructor/index.html` work into one sprint to avoid merge conflicts and regressions.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | Extract shared booking-action modals | 1-2 days | Core refactor, enables all below |
| 7 | Conflict check in reschedule modal | Half day | Show end time + warn on overlap |
| 12 | Declutter toolbar on mobile | Half day | Overflow menu for secondary toggles |
| 13 | Swipe navigation on daily/weekly | Half day | Touch event listeners |
| 17 | Action buttons on learner history modal | 2-3 hrs | Call, WhatsApp, Offer Lesson |
| 23 | Skeleton loading for calendar start hour | 1-2 hrs | Prevent layout jump |

### Sprint 4 — Learner Flow Polish (2 days)

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 6 | Pre-filter reschedule to same instructor | Half day | Deep-link with instructor + type params |
| 19 | Rebook shortcut on past lessons | 2-3 hrs | "Book again" button |
| 14 | Slot reservation countdown | Half day | Timer in modal before Stripe redirect |
| 22 | Pagination on lessons page | Half day | Promoted from P3 — breaks at multi-tenant scale |

### Deferred

| # | Item | Reason |
|---|------|--------|
| 16 | Smart availability defaults | Nice but low impact |
| 20 | Focus trapping on modals | Schedule during a dedicated accessibility pass |
| 21 | No-credits banner dismiss | Cosmetic |
| 24 | Daily schedule email opt-out | Ship when notification preferences page is built |

---

## Priority Recommendations

### P0 — Critical (data loss or scheduling disasters)

#### 2. Fix 60-second auto-refresh destroying in-progress input
- **Problem**: Daily view auto-refreshes every 60 seconds via `renderCurrentView()`, which replaces all innerHTML. If an instructor is mid-typing in the inline notes field, their input is wiped.
- **Impact**: Data loss. Instructor types notes after completing a lesson, refresh fires, notes gone.
- **Fix**: Before re-rendering, check if any input/textarea within `#calContent` has focus. If so, skip that refresh cycle or store and restore the value.
- **Files**: `public/instructor/index.html`
- **Sprint**: 1

#### 8. Fix blackout date UI desync on save failure :rocket:
- **Problem**: When adding/removing a blackout, the local `blackoutRanges` array is modified before the API call. If `saveBlackoutDates()` fails, the UI shows the updated state but the server still has the old state.
- **Impact**: Instructor thinks a blackout is set (or removed) when it isn't. A blackout that silently fails to save means an instructor gets booked on a day they blocked off — the learner shows up and the instructor is on holiday. **This is a real-world scheduling disaster.**
- **Fix**: Only update local state after successful API response. On failure, re-render from the last known-good state. Combine with #9 — making blackouts use explicit save automatically fixes this.
- **Dependency**: Implement together with #9 (same fix).
- **Files**: `public/instructor/availability.html`
- **Sprint**: 1

#### 9. Unify save patterns on availability page :rocket:
- **Problem**: Weekly availability requires explicit "Save changes" click. Blackout dates auto-save immediately on add/remove. Mixed save patterns on the same page.
- **Impact**: Instructor may expect blackout changes to wait for Save, or assume availability also auto-saves.
- **Fix**: Make blackouts use the same explicit save bar as availability. Blackout changes queue into the dirty state. This automatically fixes #8 because local state only updates on successful save.
- **Dependency**: Implement together with #8 (same fix).
- **Files**: `public/instructor/availability.html`
- **Sprint**: 1

#### 3. Fix mobile touch targets and input zoom
- **Problem**: Three specific issues:
  - "X" remove buttons on availability windows are ~24px (WCAG minimum is 44px)
  - Modal input `font-size: 0.85rem` triggers iOS Safari auto-zoom (must be >= 16px)
  - Toast `white-space: nowrap` clips long messages on mobile (present on every page)
- **Impact**: Instructors between lessons on phones will mis-tap, get zoomed-in modals, and miss truncated error messages.
- **Fix**: (a) Increase all remove buttons to 44x44px minimum, (b) set modal input font-size to 16px, (c) remove `nowrap` from toasts, add `max-width: calc(100vw - 32px)` with word-wrap.
- **Split**: Toast CSS fix in Sprint 1 (15 min). Touch targets and font-size in Sprint 2 (half day).
- **Files**: `public/instructor/availability.html`, `public/learner/book.html`, all pages with toast CSS

#### 4. Add inline validation to guest checkout :rocket:
- **Problem**: Guest form validation uses toasts (bottom of screen) not inline field errors. On mobile, the keyboard covers the toast. User doesn't know which field failed.
- **Impact**: Guest checkout is a critical conversion path. A new school's first learner hitting this = lost booking and bad first impression.
- **Fix**: Add per-field inline errors (red border + helper text below each field). Keep toast as a summary fallback.
- **Files**: `public/learner/book.html`
- **Sprint**: 2

---

### P1 — High (significant UX friction)

#### 1. Unify cancel/complete/reschedule across dashboard and calendar
- **Problem**: Dashboard uses `window.confirm()` for cancel; calendar has a styled modal with reason field. Dashboard has no "Reschedule" button. "Mark Complete" appears at different times on each page. Two separate "Add Lesson" modal implementations with separate learner search logic.
- **Impact**: Instructors switch between these pages constantly. Inconsistent behaviour erodes trust and causes confusion. Also a maintenance hazard — when learner search logic changes, two implementations must be updated.
- **Fix**: Extract shared booking-action modals into a common JS file (`instructor-booking-actions.js`) loaded by both pages. One cancel modal (with reason), one reschedule modal, one add-lesson modal.
- **Dependency**: Do this first in Sprint 3 — items #7, #12, #13, #17, #23 all modify the same file and benefit from the cleaner structure.
- **Files**: `public/instructor/dashboard.html`, `public/instructor/index.html`
- **Sprint**: 3

#### 5. Allow pre-lesson notes on confirmed bookings
- **Problem**: API restricts `update-notes` to completed lessons only. Instructors want to jot prep notes ("learner struggles with roundabouts, focus today") before the lesson.
- **Impact**: No mechanism for pre-lesson preparation notes.
- **Fix**: Remove the status restriction in `handleUpdateNotes()` or add a separate `instructor_prep_notes` field.
- **Files**: `api/instructor.js`
- **Sprint**: 1 (quick win — one `if` clause)

#### 6. Simplify the learner reschedule flow
- **Problem**: From lessons.html, clicking "Reschedule" opens a modal that just says "Go to booking page". User navigates to book.html, sees a banner, must find a new slot from scratch with no pre-filtering.
- **Impact**: Multi-step page navigation with lost scroll position. Feels broken — and a learner who hits this calls their instructor to sort it out, creating instructor workload the platform should eliminate.
- **Fix**: Either show available slots in-modal, or at minimum pre-filter book.html to the same instructor and highlight the current time range.
- **Files**: `public/learner/lessons.html`, `public/learner/book.html`
- **Sprint**: 4

#### 7. Show lesson duration and conflict check in instructor reschedule modal
- **Problem**: Instructor enters only a new start time. No confirmation of end time, no preview of whether the new slot conflicts with other lessons.
- **Impact**: Instructor reschedules blindly and may create an overlap that only errors on submit.
- **Fix**: Display calculated end time below the start time input. Run a quick conflict check and show a warning before the "Move lesson" button.
- **Dependency**: Part of Sprint 3 `index.html` batch.
- **Files**: `public/instructor/index.html`
- **Sprint**: 3

#### 10. Add retry buttons to all error empty states
- **Problem**: Every instructor page shows an error message on load failure with no way to retry except full-page refresh.
- **Impact**: Between lessons on poor mobile signal, instructors hit errors frequently. No retry = frustration.
- **Fix**: Add a "Try again" button to every error empty state that re-calls the load function.
- **Files**: `public/instructor/dashboard.html`, `public/instructor/index.html`, `public/instructor/availability.html`, `public/instructor/learners.html`, `public/instructor/earnings.html`
- **Sprint**: 2

#### 13. Add swipe navigation to daily/weekly calendar views
- **Problem**: Mobile users must tap small chevron buttons to navigate days. Swipe left/right is the expected mobile calendar gesture.
- **Impact**: Every calendar app on every phone supports swipe. Its absence screams "this is a website, not an app." Core mobile interaction for a daily-use tool.
- **Fix**: Add touch event listeners for horizontal swipe on the calendar content area. Swipe left = next day/week, swipe right = previous.
- **Dependency**: Part of Sprint 3 `index.html` batch.
- **Files**: `public/instructor/index.html`
- **Sprint**: 3

---

### P2 — Medium (UX polish and consistency)

#### 11. Replace all `alert()` calls with toast notifications
- **Problem**: `alert()` used in: calendar confirm-lesson failure, earnings Connect flow errors, earnings dismiss confirmation, waitlist time validation.
- **Impact**: Native alerts are jarring, block the thread, and can't be styled. Inconsistent with the toast pattern used everywhere else.
- **Fix**: Replace with toast (errors) or styled confirmation modals (destructive actions).
- **Files**: `public/instructor/index.html`, `public/instructor/earnings.html`, `public/learner/book.html`
- **Sprint**: 1 (quick win — find-and-replace)

#### 12. Declutter instructor calendar toolbar on mobile
- **Problem**: 7+ controls in the toolbar at 375px: nav arrows, Today, 4 view tabs, + Add Lesson, Offer, Weekdays, Cancelled. Very cluttered.
- **Impact**: Hard to find primary actions. Secondary toggles compete visually with "Today".
- **Fix**: Group controls — primary action (+ Add Lesson) stays prominent. Move Weekdays/Cancelled toggles to a "..." overflow menu or icon-only toggles. Differentiate "Today" button visually from Offer/Weekdays/Cancelled.
- **Dependency**: Part of Sprint 3 `index.html` batch.
- **Files**: `public/instructor/index.html`
- **Sprint**: 3

#### 14. Show slot reservation countdown before Stripe redirect
- **Problem**: Slot is held for 10 minutes on checkout, but no timer is shown on book.html. User only sees "Slot held for 10 minutes" on the Stripe page.
- **Impact**: Users who hesitate or get distracted may lose their slot with no warning.
- **Fix**: Show a subtle countdown timer in the booking modal or as a banner after the Stripe redirect initiates.
- **Files**: `public/learner/book.html`
- **Sprint**: 4

#### 15. Show reschedule limit to learners before they hit it
- **Problem**: Learners can reschedule max 2 times, but see no warning. The limit only surfaces as an API error on the 3rd attempt.
- **Impact**: Surprise friction. Learner tries to reschedule, gets blocked, feels punished.
- **Fix**: Show "1 reschedule remaining" or "Reschedule not available (limit reached)" on the lesson card.
- **Files**: `public/learner/lessons.html`
- **Sprint**: 2

#### 17. Make learner history modal actionable
- **Problem**: Calendar's learner history modal has only a "Close" button. No way to call, WhatsApp, book, or offer a lesson from within.
- **Impact**: Instructor reviews history, decides to act, must close modal and navigate elsewhere.
- **Fix**: Add action buttons (Call, WhatsApp, Offer Lesson) to the learner history modal footer.
- **Dependency**: Part of Sprint 3 `index.html` batch.
- **Files**: `public/instructor/index.html`
- **Sprint**: 3

#### 22. Handle 50-booking limit on learner lessons page
- **Problem**: `handleMyBookings` has `LIMIT 50`. Heavy users with recurring lessons hit this silently.
- **Impact**: Becomes urgent at multi-tenant scale — a school with 10 instructors and 30 regular learners blows past 50 bookings in month one. Support tickets follow.
- **Fix**: Add cursor-based pagination or "Load more" button.
- **Files**: `api/instructor.js`, `public/learner/lessons.html`
- **Sprint**: 4

---

### P3 — Low (minor improvements)

#### 16. Default new availability windows intelligently
- **Problem**: New windows always default to 09:00-17:00, even if the day already has a window (e.g., 08:00-12:00).
- **Fix**: Default new window to start after the last existing window's end time on that day.
- **Deferred**: Nice but low impact.

#### 18. Default "Book Lesson" modal time to next half-hour
- **Problem**: Both dashboard and calendar default the time input to 09:00 regardless of current time.
- **Fix**: Default to the next 30-minute increment from `Date.now()`.
- **Sprint**: 1 (quick win — 4 lines of JS)

#### 19. Add "Rebook" shortcut to past lessons
- **Problem**: Learner's past lessons tab has no way to re-book the same instructor/type/time.
- **Fix**: Add a "Book again" button that navigates to book.html pre-filtered to that instructor and lesson type.
- **Sprint**: 4

#### 20. Add focus management to modals
- **Problem**: No focus trap on any modal. Tab key reaches elements behind the overlay.
- **Fix**: Trap focus within modal on open, return focus to trigger element on close.
- **Deferred**: Schedule during a dedicated accessibility pass.

#### 21. Add "No credits" banner dismiss
- **Problem**: `#noCreditsBanner` has no dismiss button. It stays visible for the entire session, stacking with other banners.
- **Fix**: Add a dismiss "X" with localStorage memory (re-show on next session).
- **Deferred**: Cosmetic.

#### 23. Prevent `calendarStartHour` layout jump on daily view
- **Problem**: Daily timeline renders at hardcoded hour 7 before the profile API responds, then re-renders at the instructor's configured start hour. Causes a layout jump.
- **Fix**: Show a skeleton/loading state until the profile response arrives, then render once.
- **Sprint**: 3 (part of calendar overhaul batch)

#### 24. Show daily schedule email opt-out in instructor profile
- **Problem**: `daily_schedule_email` column exists but there is no UI toggle for instructors to opt out.
- **Fix**: Add a toggle to the instructor profile page under notification preferences.
- **Deferred**: Ship when notification preferences page is built.

---

## Blind Spots — Areas Not Covered by This Audit

These were identified during council review and should be audited separately:

### 25. Notification UX
- **Gap**: What do the actual emails, SMS, and WhatsApp messages look like after booking, cancelling, or rescheduling? Are they clear, timely, and actionable?
- **Why it matters**: Notifications are half the experience. A learner who books successfully but gets no confirmation feels uncertain. An instructor who gets a cancellation SMS with no detail feels blind.
- **Recommendation**: Audit all notification templates (email HTML, WhatsApp message strings) for clarity, completeness, and mobile readability.
- **Files to review**: `api/_email.js`, `api/_whatsapp.js`, `api/slots.js` (notification sections), `api/instructor.js` (running-late, reschedule notifications)

### 26. Admin Booking Management
- **Gap**: The school admin's view of bookings across all their instructors was not examined. In a multi-tenant SaaS, the admin is the buyer.
- **Why it matters**: If the admin portal has the same inconsistencies as the instructor side, the person who pays for the platform has a poor experience. New InstructorBook schools need admin tools from day one.
- **Recommendation**: Audit admin booking views, dispute resolution flow, and cross-instructor visibility.
- **Files to review**: `api/admin.js`, `public/admin/` pages

### 27. Payment Failure Recovery
- **Gap**: What happens when Stripe checkout fails mid-flow? Does the slot get released? Does the learner know what happened? What about webhook failures?
- **Why it matters**: Payment edge cases are where trust is built or destroyed. A learner who pays but doesn't get a booking — or sees a double charge — will never use the platform again.
- **Recommendation**: Map all Stripe failure scenarios (card declined, webhook timeout, slot reservation expiry during checkout, duplicate webhook delivery) and verify each has clear user feedback and correct server-side cleanup.
- **Files to review**: `api/slots.js` (checkout actions), `api/stripe-webhook.js`, `api/cron-cleanup.js`

---

## Re-Ranking Summary

Items adjusted from the original audit based on council review:

| Item | Original Rank | Revised Rank | Reason |
|------|--------------|-------------|--------|
| #8 Blackout desync | P1 | **P0** | Silent save failure = unwanted bookings. Real-world scheduling disaster. |
| #9 Save pattern | P1 | **P0** | Same fix as #8 — implementing explicit save fixes the desync. |
| #1 Unify modals | P0 | **P1** | Important refactor but not data loss. Batch with Sprint 3 calendar work. |
| #13 Swipe nav | P2 | **P1** | Core mobile interaction for a daily-use app. Absence signals "website not app." |
| #22 Booking limit | P3 | **P2** | Becomes urgent at multi-tenant scale with 5+ instructors. |
| #5 Pre-lesson notes | P1 | **Sprint 1 quick win** | One line change, immediate instructor value. |
| #11 Replace alert() | P2 | **Sprint 1 quick win** | Simple find-and-replace, consistency win. |
| #18 Default time | P3 | **Sprint 1 quick win** | 4 lines of JS, removes daily annoyance. |

---

## Key Dependencies

Items that must be sequenced or batched:

- **#8 + #9** → Same fix. Implement together.
- **Sprint 3 batch** → Items #1, #7, #12, #13, #17, #23 all modify `public/instructor/index.html`. Working them independently across weeks causes merge conflicts and regressions. Extract shared modals (#1) first, then apply the rest.
- **#6 depends on #15** → Showing reschedule limits (#15) should ship before simplifying the reschedule flow (#6), so learners understand the constraint before hitting the new flow.

---

## What Works Well

These are strong design decisions that should be preserved — and considered for further investment:

- **Slot feed design** — flat scrollable list instead of calendar grid is excellent for mobile booking. No empty hours wasting space
- **Recurring booking UX** — repeat-weekly toggle with per-date conflict detection is sophisticated and well-executed
- **Running Late feature** — one-tap notification to all today's learners with preset time pills. Genuinely useful between-lesson feature
- **Travel time filtering** — auto-hiding unreachable slots based on postcode is a strong differentiator. Degrades gracefully when no postcode provided. *Consider extending to show estimated drive time per slot, not just hiding unreachable ones — no competitor has this.*
- **Guest checkout** — booking without account creation removes a major conversion barrier
- **Cancel policy enforcement** — 48hr rule with acknowledgment checkbox is a good safeguard
- **Learner history on calendar** — clicking a learner name shows full booking history with skills feedback inline. Great for pre-lesson review
- **Setmore sync running in parallel** — clean migration path with idempotent sync and no disruption to existing bookings

---

## Files Referenced

| File | Role |
|------|------|
| `public/learner/book.html` | Slot feed, booking modal, guest checkout, reschedule mode |
| `public/learner/lessons.html` | Upcoming/past lessons, cancel/reschedule entry points |
| `public/instructor/dashboard.html` | Today's lessons, running late, book lesson, lesson detail |
| `public/instructor/index.html` | Full calendar (monthly/weekly/daily/agenda), all booking modals |
| `public/instructor/availability.html` | Weekly availability windows, blackout dates |
| `public/instructor/learners.html` | Learner list, detail view, notes, history |
| `public/instructor/earnings.html` | Earnings display, Stripe Connect |
| `api/slots.js` | Available slots, booking, checkout, cancel, reschedule |
| `api/instructor.js` | Schedule, complete, confirm, cancel, reschedule, notes, offers |
| `api/admin.js` | Admin mark-complete, resolve dispute |
