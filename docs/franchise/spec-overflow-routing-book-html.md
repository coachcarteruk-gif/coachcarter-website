# Spec — Overflow Lead Routing on `book.html` (plan item 1.2)

**Drafted:** 2026-05-10
**Plan ref:** `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md` item 1.2
**Audit ref:** `FRANCHISE-AUDIT-2026-05-09.md` H9.4
**Source commitment:** `INSTRUCTOR-EXPERIENCE-PLAN.md` "Cold-start problem", section A
**Pre-signing-day blocker:** yes

This spec is self-contained. Implementation can start from this document without re-deriving the design.

---

## Goal in one sentence

When a learner picks a specific instructor on `book.html` and that instructor has zero bookable slots across the entire 4-week (28-day) learner booking window, replace the empty state with the same calendar showing slots from CCL's other active instructors.

---

## Why this exists

Instructor #2's first weeks will have a sparse diary. Without overflow routing, a learner who picks instructor #2 sees "No slots available" and leaves. The agreement (clause 4.4 — Lead Floor) commits CCL to routing leads to instructors. The platform-side delivery of that commitment is this feature: when an instructor is fully empty, surface alternatives so the learner stays inside CCL's funnel rather than going elsewhere. This is the *truthful pitch* the Lead Floor makes good on.

---

## Trigger conditions (locked)

The overflow section renders **only** when **all** of the following are true:

1. The learner has selected a specific instructor via the `instructorFilter` dropdown (i.e. `instructorFilter.value` is non-empty).
2. The chosen instructor has **zero** bookable slots in the next 28 days (`FEED_MAX_DAYS`).
3. (Implicit) other active instructors at the school exist (otherwise overflow has nothing to show — fall back to the original empty state).

When any of those is false:
- No specific instructor selected → existing empty state, no overflow.
- Chosen instructor has slots (even one) → existing feed renders normally; no overflow.
- Only one instructor exists at the school → existing empty state, no overflow.

**Why "zero in 28 days" not "zero in 7 days":** instructors who book ahead may have the first week fully booked but later weeks free. Triggering on 7-day emptiness would falsely surface alternatives and undermine instructors with healthy diaries. The 28-day window matches `FEED_MAX_DAYS` already used by the learner calendar.

---

## What renders

Replace the current empty state at `public/learner/book.js:493`:

```html
<div class="empty-state">
  <div class="empty-icon">📅</div>
  <h3>No slots available</h3>
  <p>No slots found in the next 4 weeks. ...</p>
</div>
```

With:

```html
<div class="overflow-section">
  <h3>No slots with [FirstName] in the next 4 weeks.</h3>
  <p class="overflow-subhead">Slots with our other instructors:</p>
  <!-- slot feed renders here, same DOM structure as a normal feed -->
</div>
```

Where `[FirstName]` is the chosen instructor's first name (split on first space, fallback to full name if no space). E.g. "Sarah" not "Sarah Henderson"; "Tom" not "Tom O'Brien".

The calendar below the heading uses the **same date strip and time-group controls** as the normal learner booking surface. Visual differentiation is achieved by each time button showing the instructor's name and avatar when alternatives are shown.

If after the fallback query the result *also* has zero slots (i.e. nobody at the school has any availability — extreme edge case), fall back to the original empty state with a note: "No slots found in the next 4 weeks. Please check back later."

---

## API changes

**None required.** The existing `?action=available` endpoint already returns slots from all active instructors when the `instructor_id` query parameter is omitted. No new endpoint, no new query, no schema change.

The existing query already handles:
- `lesson_type_id` filter (per the chosen length)
- `pickup_postcode` filter (travel-distance from learner)
- `min_duration_only=1` flag for slot-first rendering
- `active = TRUE` filter (paused/suspended instructors excluded)

All of these continue to apply when overflow is triggered.

---

## Frontend changes

### `public/learner/book.js`

**Change 1 — detect zero-slots-for-chosen-instructor.**

Inside `fetchFeedSlots()` or immediately after, check whether `instructorFilter.value` is non-empty AND the result for that instructor across the full 28-day window is empty. If so, set a flag, e.g. `overflowMode = true`.

The cleanest hook is inside `initFeed()` after fetching the full 28-day learner window so overflow is decided from the complete visible booking horizon.

**Change 2 — when overflow is active, refetch without `instructor_id`.**

Issue a second `?action=available` query identical to the current one *except* without the `instructor_id` parameter. This returns slots from all active instructors. (Lesson-type and postcode filters still apply.)

Cache the overflow result separately from the chosen-instructor cache so toggling the dropdown back to "all instructors" doesn't recompute.

**Change 3 — render the overflow section.**

Replace the empty-state branch with the overflow heading + subheading + the existing learner calendar rendering. The date and time buttons themselves are unchanged.

**Change 4 — preserve the dropdown state.**

The chosen-instructor dropdown stays on the chosen instructor regardless of which slot the learner clicks. No JS change here — just don't add code that changes `instructorFilter.value` when an alternative is clicked. The existing `data-instructor-id` attribute on each card already routes the booking modal to the right instructor without touching the page filter.

### `public/learner/book.html`

**Change 5 — minimal CSS additions.**

Style the `.overflow-section` heading + subheading. Visually distinct from the date strip but not louder than the time buttons. Recommend reusing the existing `h3` / `h2` styling and adding a small subtitle style for the "Slots with our other instructors:" line.

No new layout primitives needed — the alternatives below use the existing learner booking calendar.

---

## Edge cases and behaviours

| Case | Behaviour |
|------|-----------|
| Chosen instructor has 1+ slot anywhere in 28 days | Normal calendar; no overflow. |
| Chosen instructor has 0 slots in 28 days, school has other active instructors | Overflow renders. |
| Chosen instructor has 0 slots, school has no other active instructors | Original empty state ("No slots found in the next 4 weeks..."). |
| Learner clicks alternative slot | Booking modal opens with the alternative instructor. Page dropdown unchanged. After booking, page returns to chosen instructor's feed (still empty). |
| Learner changes dropdown to "all instructors" while overflow is showing | Re-render in normal mode; overflow-specific UI vanishes. |
| Learner changes dropdown from instructor A to instructor B (both have 0 slots) | Re-render with new heading "No slots with [B's first name]…" and same overflow data (cached, no refetch needed). |
| Lesson-type or postcode filter narrows alternatives to zero | Final-fallback empty state ("No slots found…"). |
| Learner is travelling (postcode filter) and one alternative is hidden by travel-time check | Existing travel-hidden banner mechanism applies normally. |

---

## Out of scope (do NOT add to 1.2)

These are deliberately deferred — addressed by separate plan items.

- **Geographic instructor-coverage filtering** (`coverage_postcodes` column): plan item H9.6, deferred.
- **"Jump to next available slot" button** (instructor has slots, but first one is far out): plan item 2.11.
- **Direct booking from instructor profile page**: plan item 3.9.
- **Instructor-pair custom rates affecting overflow display**: existing pricing fallback (clause 4.9 / `instructor_learner_notes.custom_hourly_rate_pence`) applies normally — no special handling needed.
- **Dropdown-switch on alternative-slot click**: explicitly rejected during design (Q6). Don't add it.

---

## Acceptance criteria

The implementation is done when, on `book.html`:

- [ ] Selecting an instructor from the dropdown who has zero slots in 28 days replaces the empty state with an overflow section.
- [ ] The overflow heading reads "No slots with [FirstName] in the next 4 weeks." and the subheading reads "Slots with our other instructors:".
- [ ] First name is split on first space; full name used as fallback if no space exists.
- [ ] The slot feed below shows slots from all *other* active instructors at the same school (chosen instructor self-excludes by virtue of having no slots).
- [ ] Existing lesson-type, postcode, and travel-time filters continue to apply.
- [ ] Clicking an alternative slot opens the booking modal with that slot's instructor; the dropdown filter stays on the chosen instructor.
- [ ] After a successful booking via overflow, returning to `book.html` shows the chosen instructor's still-empty feed (until they have new availability).
- [ ] When the school has only one active instructor (the chosen one with 0 slots), the original empty state renders, not overflow.
- [ ] When the lesson-type/postcode filters narrow alternatives to zero, a final-fallback empty state renders.
- [ ] No API endpoint changes; only frontend changes to `book.js` + `book.html`.
- [ ] Mobile: heading + subheading fit on a 320px-wide screen without awkward wrapping for first-name-only instructor names.

---

## Implementation notes for the next session

The changes are concentrated in two functions in `book.js`:

1. **`fetchFeedSlots()`**. Add a second fetch when the post-query result for the chosen instructor is zero across all 28 days. Cache the alternatives result separately.

2. **`renderFeed()`**. Add a branch: if `overflowMode` and we have alternatives, render the overflow heading + subheading + learner calendar with alternative slots. Otherwise render the normal calendar or empty state.

The function `initFeed()` should fetch the full 28-day range before deciding overflow has fired.

Test fixtures needed:
- An instructor with availability in some weeks (control — overflow should NOT fire).
- An instructor with zero availability across 28 days (overflow trigger).
- A school with the test instructor as the only active instructor (overflow falls back to empty state).
- Alternative instructors with mixed lesson types (verify lesson-type filter still applies).

Approximate scope: **1 session**, ~150–250 lines of changes across two files.

---

## Out of band — what this spec deliberately does NOT do

This is a *minimum-viable* overflow feature designed to deliver the Lead Floor commitment to instructor #2. It is not a discovery / browse / instructor-comparison surface. Items like featured instructors, ratings, comparison side-by-side, "instructors who match you" are explicitly out of scope and belong to plan items 3.9 (direct profile booking) and beyond.
