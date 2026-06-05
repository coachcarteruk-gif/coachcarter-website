# Learner Booking Calendar UX Improvement Plan

Last updated: 2026-06-04

## Purpose

This plan turns the learner booking calendar feedback into an implementation path for `public/learner/book.html` and `public/learner/book.js`.

The current page is functionally strong, but visually and interaction-wise it behaves more like a slot feed than a learner booking calendar. The proposed direction keeps the existing booking safety logic intact while making the learner decision flow calmer:

1. Pick lesson length.
2. Pick date.
3. Pick time of day.
4. Review selected slot.
5. Confirm using credit or payment.

This should make the page feel closer to the reference layouts: compact date pills, clear time groups, direct time buttons, and a strong bottom action once the learner has made a selection.

## Non-Goals And Guardrails

- Do not reintroduce removed calendar/product surfaces from older flows.
- Do not change booking, refund, payout, Stripe, or credit mutation behaviour as part of the UI redesign.
- Do not trust client-side pricing or duration decisions. The backend remains authoritative.
- Do not remove postcode/travel filtering, overflow alternatives, reschedule mode, slot hold timer, repeat weekly booking, guest checkout, or credit/pay routing.
- Do not broaden automatic refunds, cancellation handling, or lesson status behaviour.
- Keep the work tightly scoped to the learner booking page unless shared learner styles need small reusable improvements.

Relevant existing files:

- `public/learner/book.html`
- `public/learner/book.js`
- `public/shared/learner.css`
- `api/slots.js`
- `api/lesson-types.js`

## Current-State Diagnosis

### What Works Well

- The page already has a robust booking engine.
- Slots are filtered by instructor, lesson duration capability, travel feasibility, booking notice, and availability.
- Learners can book with existing credit or pay directly.
- Guest checkout is supported.
- Repeat weekly booking is supported.
- Reschedule mode reuses the same slot surface.
- Overflow routing suggests other instructors when the selected instructor has no availability.
- The modal has escape routes and handles async loading states.
- The slot hold timer communicates reservation urgency.

### Main Usability Issues

1. The page starts with "Slot feed" language, which feels more operational than learner-facing.
2. The first visible control is an instructor select, not the primary learner decision.
3. Lesson duration is chosen inside the confirmation modal, after the learner has already tapped a time.
4. Dates are passive section headers rather than selectable controls.
5. Time scanning requires vertical scrolling through individual cards.
6. Time-of-day context is missing, so the learner has to infer morning, afternoon, or evening from individual times.
7. Slot cards are visually large compared with the amount of information they contain.
8. The modal carries too many responsibilities: duration, profile completion, guest details, drop-off, repeat booking, payment, credit, and success.
9. Repeat weekly booking is useful but visually underdeveloped.
10. Clickable `div.feed-card` elements should become more accessible interactive controls.

## Design Principles

Use the `ui-ux-pro-max` priorities in this order:

1. Accessibility: keyboard support, screen-reader names, focus states, contrast.
2. Touch and interaction: 44px minimum targets, clear pressed states, no precision taps.
3. Layout and responsive: mobile-first, no horizontal page overflow, stable sticky areas.
4. Forms and feedback: progressive disclosure, field errors near fields, disabled/loading states.
5. Style consistency: keep CoachCarter brand tokens, avoid inventing a separate visual system.
6. Performance: avoid layout shifts, avoid expensive DOM work for long slot lists.

The page should feel like a booking assistant, not an admin feed.

## Target User Flow

### Default Learner Flow

1. Learner opens `Book`.
2. Page heading says "Choose a lesson time".
3. Learner sees lesson length tabs, for example `60 min`, `90 min`, `2 hr`.
4. Learner optionally filters instructor or transmission.
5. Learner chooses a date from a horizontal date strip.
6. Page shows available times grouped into `Morning`, `Afternoon`, and `Evening`.
7. Learner taps a time chip.
8. Sticky bottom summary appears with:
   - Date
   - Time
   - Instructor
   - Lesson length
   - Credit or price summary
   - Primary `Continue` button
9. Learner taps `Continue`.
10. Confirmation modal opens with only the remaining details needed to complete booking.

### Guest Flow

1. Guest can browse the same date and time surface.
2. Guest selects a slot.
3. Sticky summary shows price and `Continue`.
4. Modal asks for guest details and terms acceptance.
5. Guest pays and books.

### Reschedule Flow

1. Reschedule banner remains prominent.
2. Original lesson summary stays visible.
3. Learner chooses a new date and time.
4. Sticky summary changes copy to `Move lesson`.
5. Confirmation modal compares `Was` and `Now`.

### Repeat Booking Flow

1. Repeat option stays collapsed by default.
2. Inside confirm modal, use a clearer section:
   - Toggle: `Repeat weekly`
   - Count control: `2`, `3`, `4`, `6`, `8` lessons
   - Preview list of dates
   - Conflict warning if any repeated date is unavailable
3. Longer-term enhancement: replace the count select with a small recurrence sheet inspired by the reference screenshot.

## Proposed Layout

### Mobile Layout

Top to bottom:

1. Compact page header
   - Title: `Choose a lesson time`
   - Supporting line: `Pick a date and time that works for your lesson.`

2. Status rows
   - Guest banner
   - No credits banner
   - Next lesson banner
   - Reschedule banner
   - Postcode prompt

3. Lesson length segmented control
   - Buttons generated from active lesson types.
   - Exclude trial from normal booking choices.
   - Persist last selected lesson type in local storage.
   - Use the chosen lesson type to fetch/render availability.

4. Filter row
   - Instructor select
   - Optional transmission select if needed by school setup.
   - Keep filters compact.

5. Date strip
   - Horizontally scrollable chips.
   - Each chip contains weekday, date, month, and availability count/state.
   - Today/tomorrow labels where useful.
   - Selected date has strong visual treatment.
   - Days with no slots are visible but subdued.

6. Time groups
   - Section heading: `Morning`, `Afternoon`, `Evening`.
   - Time buttons in a responsive grid.
   - Instructor name/avatar shown beneath or inside chip when all instructors are selected.
   - Transmission shown as small text or icon label only when it matters.

7. Sticky selected-slot summary
   - Hidden until a slot is selected.
   - Anchored to bottom with safe-area padding.
   - Contains short summary and primary action.
   - Does not cover the last row of time buttons; add bottom padding to page when visible.

### Desktop Layout

Keep the main content constrained, but use desktop width better:

- Left/top: controls and date strip.
- Main area: time groups with wider chip grid.
- Sticky summary can be a right-side summary panel at wider breakpoints or remain a bottom bar.
- Avoid turning the page into a large monthly calendar unless there is a strong learner need.

## Component Plan

### 1. `booking-controls`

Purpose: lesson length and filters.

Markup responsibilities:

- Render lesson length segmented control.
- Render instructor filter.
- Keep current filter select accessible.
- Add clear labels, not just visual context.

Implementation notes:

- Use real `button` elements for lesson length tabs.
- Add `aria-pressed` for selected tab.
- Keep selected lesson type in JS state.
- When lesson type changes, reset selected slot and refetch/render availability.

### 2. `date-strip`

Purpose: make dates selectable rather than passive headers.

Markup responsibilities:

- Render 7 to 14 date buttons from currently loaded availability.
- Include availability count or state:
  - `3 slots`
  - `Full`
  - `Today`
  - `Tomorrow`

Implementation notes:

- Use `button` elements.
- Selected date uses `aria-pressed="true"` or `aria-current="date"`.
- Keep hit target at least 44px tall.
- Allow horizontal scroll only inside the date strip, not the full page.
- Provide visible focus.

### 3. `time-groups`

Purpose: replace a long feed of cards with grouped time choices.

Groups:

- Morning: before 12:00
- Afternoon: 12:00 to before 17:00
- Evening: 17:00 onward

Implementation notes:

- Use `button` elements for time slots.
- Each button should include an accessible label such as:
  - `Book 3:00 PM with Fraser, manual transmission`
- Show instructor avatar/name when all instructors are visible.
- If a specific instructor is selected, reduce repeated instructor labels.
- Keep time text prominent and tabular.
- Use disabled state only for known unavailable options if displayed; otherwise omit unavailable times.

### 4. `selected-slot-summary`

Purpose: give the learner a stable review point before opening the modal.

Content:

- Date and time
- Instructor
- Duration
- Credit or price summary
- Primary CTA: `Continue`, `Pay and book`, `Use credit`, or `Move lesson` depending on flow

Implementation notes:

- Hidden until a slot is selected.
- Sticky bottom on mobile.
- Use safe-area inset padding.
- Reserve page bottom padding when visible.
- On click, open existing booking/reschedule modal with `pendingSlot` populated.

### 5. Confirmation Modal Simplification

Purpose: reduce cognitive load after slot selection.

Keep:

- Selected slot summary.
- Required profile or guest fields.
- Drop-off address.
- Repeat weekly.
- Payment/credit action.
- Slot timer.

Improve:

- Put selected slot in a compact top summary.
- Move lesson length choice out of the modal for normal bookings.
- Keep duration check as a backend validation step before enabling confirm.
- If the selected duration no longer fits, show a clear inline error and let the learner return to times.

## JavaScript State Plan

Current state is mostly feed-based. Proposed state:

```js
let selectedLessonType = null;
let selectedDate = null;
let selectedSlot = null;
let visibleDateRange = { from: null, to: null };
let slotCache = {};
```

Key changes:

- `selectedLessonType` becomes a first-class page-level selection instead of only modal-level.
- `selectedDate` controls which slots are shown.
- `selectedSlot` controls the sticky summary.
- `pendingSlot` remains the modal/booking payload.

Existing functions to adapt:

- `loadLessonTypes()`
- `initFeed()`
- `fetchFeedSlots()`
- `renderFeed()`
- `buildSlotFeedHtml()`
- `openBookModal()`
- `loadDurationsForSlot()`

Recommended new or renamed functions:

```js
function renderBookingControls() {}
function renderDateStrip(slotsByDate) {}
function renderTimeGroups(slotsForSelectedDate) {}
function selectLessonType(lessonTypeId) {}
function selectDate(dateStr) {}
function selectSlotFromButton(buttonEl) {}
function renderSelectedSlotSummary() {}
function clearSelectedSlot() {}
```

## Data And API Notes

Preferred first pass: no backend changes.

Current endpoints appear sufficient:

- `/api/lesson-types?action=list`
- `/api/slots?action=available`
- `/api/slots?action=durations-for-slot`
- `/api/slots?action=book`
- `/api/slots?action=checkout-slot`
- `/api/slots?action=checkout-slot-guest`
- `/api/slots?action=reschedule`

Important behaviour to preserve:

- Server prices remain authoritative.
- `durations-for-slot` still validates the chosen lesson type.
- Travel filtering still uses pickup postcode.
- Instructor filter still scopes availability.
- Overflow alternatives still appear when one selected instructor has no slots.

Potential future backend improvement:

- Add an availability summary response for date counts, so the date strip can show counts without loading detailed slots for every day.
- This is optional and should only be added if frontend grouping becomes too slow or too chatty.

## Phased Implementation

### Phase 1: Structure And Accessibility

Goal: improve layout and interaction without changing business logic.

Tasks:

- Replace the doc-style header copy with learner-facing booking copy.
- Add page-level lesson length segmented control.
- Convert slot card click targets from `div` to `button`.
- Add clear accessible names to slot buttons.
- Add visible focus and pressed states.
- Preserve current feed rendering behind the new controls while preparing grouped rendering.

Acceptance criteria:

- Keyboard users can tab to lesson length, instructor filter, date/time choices, and continue action.
- Every tappable control is at least 44px tall.
- Focus order matches visual order.
- Existing booking modal still opens and works.

### Phase 2: Date Strip And Time Groups

Goal: replace vertical slot scanning with date-first booking.

Tasks:

- Build date strip from loaded slot dates.
- Set default selected date to the first date with slots.
- Group slots for selected date into morning, afternoon, evening.
- Render time chips instead of large feed cards.
- Show empty state for a selected date with no slots.
- Do not expose `Show more slots` / `Show later dates`; the learner calendar loads the complete 4-week self-serve window.

Acceptance criteria:

- Learner can choose a date without scrolling through unrelated days.
- Time choices are grouped by day part.
- All-instructor view still identifies instructor per time.
- Specific-instructor view avoids redundant labels.
- Existing empty states still make sense.

### Phase 3: Sticky Selected-Slot Summary

Goal: give learners a clear review step before modal confirmation.

Tasks:

- Add sticky summary markup.
- Populate summary from selected slot and selected lesson type.
- Add bottom page padding when summary is visible.
- Change time button click behaviour:
  - Select slot.
  - Do not immediately open modal.
  - Let learner tap summary CTA to continue.
- In reschedule mode, CTA says `Move lesson`.

Acceptance criteria:

- Selecting a time clearly changes selected state.
- Learner can change selected time before continuing.
- Summary does not obscure time choices.
- Summary works on mobile and desktop.

### Phase 4: Modal Simplification

Goal: make the modal a confirmation/detail capture step, not the primary decision UI.

Tasks:

- Remove normal duration dropdown from modal when page-level duration is selected.
- Keep `durations-for-slot` validation before enabling confirm.
- If validation fails, show a friendly no-fit message.
- Reorganise modal sections:
  1. Slot summary
  2. Required details
  3. Optional drop-off/repeat
  4. Credit/payment action
- Keep guest and profile fields progressively disclosed.

Acceptance criteria:

- Modal opens faster conceptually because choices were made on the page.
- Learner does not have to re-evaluate duration after choosing a time.
- Credit and pay paths remain unchanged.
- Guest checkout still validates fields inline.

### Phase 5: Repeat Booking Polish

Goal: make recurring bookings feel intentional and understandable.

Tasks:

- Improve repeat section layout.
- Replace plain select with segmented or stepper-like count control.
- Keep conflict preview visible and clear.
- Rename labels for learner clarity:
  - `Repeat weekly`
  - `Book this time for`
  - `4 lessons`
  - `Unavailable dates`
- Consider a future advanced recurrence sheet only after weekly repeat is stable.

Acceptance criteria:

- Learner can understand exactly how many lessons will be booked.
- Conflicting repeat dates are easy to see.
- Confirm button disables when conflicts exist.

## Visual Direction

Keep the CoachCarter brand, but reduce the document/feed aesthetic on this task page.

Recommended style:

- White or surface background.
- Strong black/neutral text.
- Orange accent for selected states and primary actions.
- Green only for successful/positive status.
- Muted gray for disabled/no availability.
- 8px to 12px radius for chips and controls.
- Avoid oversized cards for individual times.
- Use concise labels and strong spacing.

Reference-inspired patterns:

- Date pills from the restaurant booking screenshot.
- Time-of-day grouping from the lesson booking screenshot.
- Recurrence controls from the repeat booking screenshot, adapted carefully for CoachCarter.

## Accessibility Requirements

Must-have:

- Real buttons for date and time selections.
- `aria-label` or clear text for time buttons.
- `aria-current="date"` or `aria-pressed` for selected date.
- `aria-pressed` for selected lesson length and selected time.
- Visible focus ring on every control.
- 44px minimum touch targets.
- No information conveyed by color alone.
- Disabled states use both visual styling and `disabled`.
- Modal focus management remains intact.
- Escape still closes modals.
- Screen-reader text should not announce raw implementation labels like `Slot feed`.

Recommended:

- Add a polite live region for changes like `Showing afternoon slots for Tuesday`.
- Announce no-slot states near the date strip.
- Respect reduced motion for any sticky summary or modal transitions.

## Performance Considerations

- Avoid rendering large all-instructor slot card lists; the self-serve learner calendar is capped to a 4-week date strip.
- Render only the selected date's time buttons.
- Keep date summaries lightweight.
- Do not recalculate date grouping on every small interaction if the slot cache has not changed.
- Reserve sticky summary space to prevent layout jump.
- Keep skeleton/loading states sized similarly to final layout.

## Testing Plan

### Manual Browser Checks

Test at:

- 375px mobile
- 430px mobile
- 768px tablet
- 1280px desktop

Scenarios:

- Logged-in learner with credits.
- Logged-in learner without credits.
- Guest booking.
- Missing postcode/profile details.
- Selected instructor with slots.
- Selected instructor with no slots, triggering alternatives.
- Reschedule mode.
- Repeat weekly with all dates available.
- Repeat weekly with conflicts.
- Dark mode.

### Automated Checks

Add or update Playwright tests if there are existing booking UI smoke tests.

Suggested assertions:

- Lesson length control renders active lesson types.
- Date buttons render and are keyboard focusable.
- Selecting a date changes visible time buttons.
- Selecting a time shows sticky summary.
- Continue opens modal with matching date/time/instructor.
- Slot button accessible name includes time and instructor.
- No horizontal page overflow on mobile.

### Syntax And Regression

Run:

```powershell
npm.cmd test
```

If full test runtime is too high, at minimum run:

```powershell
node scripts/check-syntax.js
```

## Suggested Delivery Order

1. Implement Phase 1 and Phase 2 together if scope allows.
2. Verify visually with screenshots before touching modal behaviour.
3. Implement sticky summary as a separate PR if risk feels high.
4. Simplify modal after the page-level selection is proven.
5. Polish repeat booking last.

## Success Measures

Qualitative:

- Learners understand what to do without reading explanatory copy.
- Booking feels like choosing a date/time, not scanning a data feed.
- The page feels calmer on mobile.
- The confirmation modal feels shorter and more final.

Quantitative, if tracked:

- Increase slot click to booking completion rate.
- Reduce booking modal closes before confirmation.
- Reduce time from page load to selected slot.
- Reduce support questions around lesson duration or repeat bookings.
- Track how often learners switch date/time after first selection.

## Open Questions

- Should lesson length default to the learner's last booked duration, the shortest available duration, or the school's standard lesson?
- Should the date strip show availability counts, or only availability/no availability?
- Should all-instructor view prioritise earliest slots or group by instructor inside each day part?
- Should transmission be a visible filter, inferred from instructor setup, or only shown as metadata?
- Should repeat weekly stay in the modal, or eventually become a separate bottom sheet?
- Should sticky summary primary text be generic `Continue` or context-specific `Use credit`, `Pay and book`, and `Move lesson`?

