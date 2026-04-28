# Navigation design (app mode — March 2026)

> **The "Intentionally removed" list lives in `CLAUDE.md`** because Claude tends to violate it. This file is structural reference — load it when working on sidebar, bottom tabs, or page layout.

The site is designed as an app experience.

## Start page

**`/`**: Role selection — "I'm a Learner" or "I'm an Instructor". No other links.

## Mobile layout

Top header bar with hamburger to open sidebar. Fixed bottom bar with 5 tabs that never change.

## Learner — fixed bottom tabs

**Home | Lessons | Practice | Learn | Profile**

- Each tab links to the first page in that group (Home → dashboard, Lessons → book, Practice → log-session, Learn → videos)
- Active tab highlights orange based on which section the current page belongs to
- Subsection navigation (e.g. Book vs Buy Credits vs Upcoming) via the sidebar collapsible groups

## Learner — sidebar groups

- Dashboard (standalone)
- Lessons → Book, Buy Credits, Upcoming
- Practice → Log Session, Mock Test, My Progress
- Learn → Videos, Examiner AI, Quiz
- My Profile (standalone, auth-gated)
- Accordion behaviour — one group open at a time; auto-expands to current section on page load

## Instructor — fixed bottom tabs

**Dashboard | Calendar | Learners | Earnings | Profile**

- Dashboard (`/instructor/dashboard.html`) — compact no-scroll view of today's lessons + "Book Lesson" action
- Calendar (`/instructor/`) — full calendar with monthly/weekly/agenda views. Agenda is the default view on load. Do NOT re-add daily view, hour-slot grids, "Weekdays" filter, or "Cancelled" filter

## Instructor — sidebar items

- Dashboard, Calendar, Availability, My Learners, Earnings
- (divider)
- Profile

## Desktop

Fixed 240px sidebar with the same collapsible group structure. No bottom bar.

## Booking page (slot feed — April 2026)

`book.html` uses a "next available" slot feed instead of a calendar.

- **Slot feed:** Flat scrollable list of available slots sorted by date+time. No empty hours, no grid. Each card shows date, time, instructor.
- **Slot-first booking UX (April 2026):** Lesson length is picked *inside* the booking modal after a slot click, not before. The slot feed renders at the smallest active duration via `?action=available&min_duration_only=1`. Clicking a slot opens the modal in a "Checking durations…" state, fires `?action=durations-for-slot&instructor_id=…&date=…&start_time=…`, and populates a duration `<select>` showing every active lesson type with its price; non-fitting durations are kept in the dropdown but disabled with a reason suffix (`travel`, `clash`, `too long`, `short notice`, `not offered`). Single-type schools auto-collapse to a confirmation row. No-fit slots show an inline empty-state. `cc_last_lesson_type_id` in localStorage persists the returning learner's usual choice (no expiry) — when honoured, a small "Using your usual length" hint appears under the dropdown.
- **Progressive loading:** 14 days at a time. "Show more slots" button loads the next 14 days (max 90).
- **Instructor filter:** Dropdown in toolbar filters slots by instructor.
- **URL parameters:** `?instructor=X` pre-selects the instructor filter. `?type=slug` (or `?type_id=N`) preselects that lesson type *inside the modal dropdown* after a slot click — the page-load behaviour of the old pill bar is gone.
- **Guest checkout:** Unauthenticated users can book without creating an account. The modal shows guest fields (name, email, phone, pickup address, terms). Account created server-side before Stripe payment via `checkout-slot-guest` action. Existing webhook handles booking creation unchanged.
- **Spectator mode (April 2026):** Every "Book" CTA across the marketing surface (homepage hero + footer, top bar, mobile tab bar, public sidebar) routes directly to `/learner/book.html` — there is intentionally no auth wall in front of the booking page. Logged-out visitors see a `#guestBanner` ("Browsing as a guest — sign in to use lesson hours") instead of the misleading "No hours on your account" banner. Sidebar `Buy Credits` / `Upcoming` and the bottom-tab `Profile` are filtered out for guests via `authOnly: true`. **Spectator mode also extends to `buy-credits.html` (prices visible, balance card hidden, buy buttons gated via `requireAuth()` at submit), `log-session.html` (form fully explorable, save gated at submit), and `profile.html` (form visible, saves gated). `my-data.html` shows a soft "please log in" inline message — appropriate for a personal-data-export page. Pages that fundamentally require user-specific data — `lessons.html`, `mock-test.html`, `focused-practice.html`, `progress.html`, `ask-examiner.html`, `examiner-quiz.html`, `refer.html`, `onboarding.html`, `confirm-lesson.html` — remain login-walled.**
- **Inline free-trial CTA (April 2026):** Inside the guest section of the booking modal, when the school's `lesson_types` list contains a row with `slug='trial'`, a "Claim this as your free trial →" link is shown. Clicking redirects to `/free-trial.html?instructor_id=…&date=…`. The slot is not force-converted (trial handler enforces strict duration matching) — the guest re-picks a real trial slot on the dedicated page, which honours the hints by filtering the slot feed and scrolling the matching date into view.
- No view toggles, no date navigation arrows, no cursor state.
