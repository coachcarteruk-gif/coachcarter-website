# Learner interface simplification

23 September 2026 — implemented on branch; not deployed.

The learner clutter audit found that summaries, promotion and repeated controls
often appeared before the learner's immediate task. This pass changes display
order and disclosure, using the existing vanilla frontend and brand tokens.

## Display contract

- Dashboard: greeting, next lesson (or booking empty state), lesson follow-ups,
  compact hours summary, optional onboarding, driving plan and referrals. The
  duplicate practice percentage and driving-test shortcut are removed; the
  driving plan and permanent Driving Test navigation remain available. Real
  curriculum reflection prompts remain visible, while hidden prompts have no box.
- The hours total is display-only. Flexible Hours remain school-wide; Lesson
  Credit remains instructor-scoped. The same read endpoints supply the total
  and breakdown. Profile balance sections start collapsed and retain their
  detailed scope and instructor rows when opened.
- Booking: all permitted dates still load using the existing requests and
  instructor booking window. Initially seven dates are displayed. Show later
  dates reveals the rest; a selection outside the initial range expands it
  automatically. This is disclosure, not a new booking-window limit.
- Below 600px, a labelled native lesson-length select replaces the button row.
  It includes product name, duration, exact price when available, and applicable
  discount/original-price copy. Wider layouts retain buttons; equal-duration
  products show their names. Both controls use the existing selection handler,
  including the reschedule guard and server duration validation. At 1100px and
  above the date selector sits beside the selected day's times.
  The signed-in test-day booking panel starts collapsed; expanding it retains
  the existing start choices, pricing/credit labels and submission handler.
- Upcoming lessons: a compact Packages link remains prominent in the heading.
  A keyboard-operable native Manage lesson disclosure contains calendar,
  reschedule and cancellation controls. Policy conditions, review modals and
  mutating handlers are unchanged. Pencilled-offer payment deadlines and actions
  are not placed inside this disclosure.
- Driving plan: one focus appears initially; further suggestions, weekly detail
  and recent activity are expandable. Existing signal-source labels and formal
  mock distinctions remain. Curriculum-beta content is not merged into legacy
  practice signals.
- Driving Test: consistent select/input styling, expandable explanatory help,
  and a visible profile-only caveat before Save. No changes to profile writes.
- Learner install prompts, including booking aliases, do not appear automatically.
  Profile offers installation when the browser supports it, plus instructions
  for browsers without the install event. Other portals retain existing prompts.
- Learner cookie prompts, including booking aliases, initially show accept/reject
  and Choose preferences. Reopening preferences shows the individual categories.
  Version, defaults, events, recording and tracker consent gates are unchanged.
  Keyboard focus considers only visible controls. Other pages retain the full
  category panel.

## Scope and validation

No APIs, database schema, financial mutations, pricing rules, feature flags,
booking eligibility, account permissions or shared navigation destinations change.
Packages catalogue redesign was only a source-level observation in the audit and
is outside this pass; its required cross-link remains.

`tests/learner-clutter-ui.spec.js` uses synthetic, intercepted APIs for visual
position and interaction checks: phone dashboard, prompt presence/absence,
guest/empty states, all-date access, mobile product selection, duration-validation
reads, keyboard lesson management, balance disclosure, manual app installation,
booking aliases, Save clearance above navigation, practice disclosures and
separate cookie-category consent. No live bookings or payments are submitted.

Related regression suites cover credit display and eligibility, booking location
contracts, reserved lesson policy, discount pricing, practice signal wording,
cookie consent and Meta consent. Mobile/desktop light and mobile dark screenshots
are reviewed separately from the interaction checks.
