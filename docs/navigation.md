# Navigation design (app mode — March 2026)

> **The "Intentionally removed" list lives in `CLAUDE.md`** because Claude tends to violate it. This file is structural reference — load it when working on sidebar, bottom tabs, or page layout.

The site is designed as an app experience.

## Start page

**`/`**: Role selection — "I'm a Learner" or "I'm an Instructor". No other links.

## Mobile layout

Top header bar with hamburger to open the sidebar. Each role has a fixed bottom bar for its primary destinations.

## Learner — fixed bottom tabs

**Lessons | Driving Test | Profile**

- Availability is managed inside the Profile page rather than taking a separate tab.
- Active tab highlights orange based on which section the current page belongs to
- Subsection navigation (e.g. Book vs Upcoming) via the sidebar collapsible groups

## Learner — sidebar groups

- Dashboard (standalone)
- Lessons → Book, Upcoming
- Packages (top-level public comparison page; rendered only when the resolved school's strict `learner_packages_enabled` Boolean is true)
- Driving Test (standalone, auth-gated)
- My Profile (standalone, auth-gated; includes the learner's usual availability)
- Accordion behaviour — one group open at a time; auto-expands to current section on page load

`Packages` opens `/learner/packages.html`. It is deliberately separate from Lessons and from the read-only `/learner/buy-credits.html` compatibility page. Lessons and Packages cross-link prominently. Packages remains a hamburger/sidebar destination on mobile.

## Instructor — fixed bottom tabs

**Dashboard | Calendar | Learners | Earnings | Profile**

- Dashboard (`/instructor/dashboard.html`) — one chronological view of today: lessons, pending lesson requests, pending offers, recurring/date-specific availability, and busy blocks. Future requests collapse into one slim link to their first calendar date. The single Add menu owns booking and time-management actions.
- Calendar (`/instructor/`) — learner-style month date selector followed by one chronological selected-day list. Desktop and mobile deliberately use the same structure. Pending requests live on their requested date with Accept/Decline controls; lessons, offers, recurring/date-specific availability, and busy blocks share the same timeline. Do NOT re-add multi-view toggles, hour-slot grids, "Weekdays" filter, or "Cancelled" filter.

## Instructor — sidebar items

- Dashboard, Calendar, Availability, My Learners, Earnings, Curriculum, Notes
- (divider)
- Profile

`Curriculum` opens the school-scoped instructor knowledge workspace. It is a
sidebar destination only and is deliberately not added to the fixed five-item
mobile bottom bar. School admins can also enter it from the admin portal.

## Desktop

Fixed 240px sidebar with the same collapsible group structure. No bottom bar.

## Booking page (learner calendar — June 2026)

`book.html` uses a learner-facing booking calendar with page-level lesson length selection.

- **Calendar:** Week-by-week Mon–Sun date grid covering the full 4-week self-serve window (July 2026 — replaced the horizontal date strip and its desktop scroll arrows). Days without availability stay visible but disabled/dimmed so learners can map slots onto their weekly routine and see fully-booked days at a glance; available days carry a dot indicator. Selected-date time groups below (`Morning`, `Afternoon`, `Evening`). Date and time selections are real buttons with accessible labels and 44px+ touch targets. This is a date *selector*, not a calendar slot view — the "do NOT re-add calendar views" rule (empty-hour grids, view toggles, cursor state) still stands.
- **Lesson length:** Lesson length is selected at page level before choosing a time. The rendered feed uses the selected duration via `?action=available&min_duration_only=1`; clicking a slot still opens the modal and calls `?action=durations-for-slot&instructor_id=…&date=…&start_time=…` as the server-side validation gate. Non-fitting durations are handled by the existing reasons (`travel`, `clash`, `too long`, `short notice`, `not offered`). Single-type schools auto-collapse to a confirmation row. No-fit slots show an inline empty-state. `cc_last_lesson_type_id` in localStorage persists the returning learner's usual choice (no expiry) — when honoured, a small "Using your usual length" hint appears under the controls.
- **No progressive loading:** Learners do not click to reveal more slots. The page loads the whole 28-day platform window immediately.
- **Instructor filter:** Dropdown in toolbar filters slots by instructor.
- **URL parameters:** `?instructor=X` pre-selects the instructor filter. `?type=slug` (or `?type_id=N`) preselects the page-level lesson length.
- **Guest checkout:** Unauthenticated users can book without creating an account. The modal shows guest fields (name, email, phone, pickup address, terms). Account created server-side before Stripe payment via `checkout-slot-guest` action. Existing webhook handles booking creation unchanged.
- **Spectator mode (April 2026; credit-purchase update June 2026):** Every "Book" CTA across the marketing surface (homepage hero + footer, top bar, mobile tab bar, public sidebar) routes directly to `/learner/book.html` — there is intentionally no auth wall in front of the booking page. Logged-out visitors see a `#guestBanner` ("Browsing as a guest — sign in to use lesson hours") instead of the misleading "No hours on your account" banner. Sidebar `Upcoming` and the bottom-tab `Profile` are filtered out for guests via `authOnly: true`. `buy-credits.html` is no longer a purchase surface; it is a read-only existing Lesson Credit balance page for old bookmarks. **Spectator mode still extends to `log-session.html` (form fully explorable, save gated at submit) and `profile.html` (form visible, saves gated). `my-data.html` shows a soft "please log in" inline message — appropriate for a personal-data-export page. Pages that fundamentally require user-specific data — `lessons.html`, `mock-test.html`, `focused-practice.html`, `progress.html`, `ask-examiner.html`, `examiner-quiz.html`, `refer.html`, `onboarding.html` — remain login-walled.**
- **Inline free-trial CTA (April 2026):** Inside the guest section of the booking modal, when the school's `lesson_types` list contains a row with `slug='trial'`, a "Claim this as your free trial →" link is shown. Clicking redirects to `/free-trial.html?instructor_id=…&date=…`. The slot is not force-converted (trial handler enforces strict duration matching) — the guest re-picks a real trial slot on the dedicated page, which honours the hints by filtering the slot feed and scrolling the matching date into view.
- No view toggles, no date navigation arrows, no cursor state, no "show later dates" control.
