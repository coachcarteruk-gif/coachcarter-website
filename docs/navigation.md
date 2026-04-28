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

- **Slot feed:** Flat scrollable list of available slots sorted by date+time. No empty hours, no grid. Each card shows date, time, instructor, lesson type colour.
- **Lesson type pill bar:** Sticky bar below header. Compact pills with type name, duration, price. Selecting a type re-fetches slots.
- **Progressive loading:** 14 days at a time. "Show more slots" button loads the next 14 days (max 90).
- **Instructor filter:** Dropdown in toolbar filters slots by instructor.
- **URL parameters:** `?instructor=X` pre-selects instructor filter, `?type=slug` pre-selects lesson type. Both work for unauthenticated visitors.
- **Guest checkout:** Unauthenticated users can book without creating an account. The modal shows guest fields (name, email, phone, pickup address, terms). Account created server-side before Stripe payment via `checkout-slot-guest` action. Existing webhook handles booking creation unchanged.
- **Spectator mode (April 2026):** Every "Book" CTA across the marketing surface (homepage hero + footer, top bar, mobile tab bar, public sidebar) routes directly to `/learner/book.html` — there is intentionally no auth wall in front of the booking page. Logged-out visitors see a `#guestBanner` ("Browsing as a guest — sign in to use lesson hours") instead of the misleading "No hours on your account" banner. Sidebar `Buy Credits` / `Upcoming` and the bottom-tab `Profile` are filtered out for guests via `authOnly: true`.
- **Inline free-trial CTA (April 2026):** Inside the guest section of the booking modal, when the school's `lesson_types` list contains a row with `slug='trial'`, a "Claim this as your free trial →" link is shown. Clicking redirects to `/free-trial.html?instructor_id=…&date=…`. The slot is not force-converted (trial handler enforces strict duration matching) — the guest re-picks a real trial slot on the dedicated page, which honours the hints by filtering the slot feed and scrolling the matching date into view.
- No view toggles, no date navigation arrows, no cursor state.
