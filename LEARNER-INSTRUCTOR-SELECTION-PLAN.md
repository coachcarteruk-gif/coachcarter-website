# Learner Instructor Selection — Delivery Plan (DRAFT)

**Status:** drafted 2026-05-19. **DRAFT — coupling-impact check vs `PER-INSTRUCTOR-CREDITS-PLAN.md` still outstanding.** Do not start implementation until both plans have been walked side-by-side and revised together.

**Scope:** the learner-facing front door for the multi-instructor era. Replaces the existing `book.html` (slot-first mixed feed) and `buy-credits.html` (pooled credit purchase) with an instructor-first paradigm centred on `/instructors` index and per-instructor pages.

**Trigger:** Simon (instructor #2) is on the system today. Fraser pays him manually until he onboards Stripe Connect, but the learner-UX surface is the gating constraint on Simon being publicly visible.

**Sequencing:** ships AFTER `PER-INSTRUCTOR-CREDITS-PLAN.md` Steps 0–5 (the data-layer + admin grant endpoints). Sequential, not interleaved — interleaving doubles half-state risk during Simon's launch.

**Owner:** Fraser.

---

## Why this plan exists

The existing booking surfaces (`book.html`, `buy-credits.html`) were built for a single-instructor world. They have no concept of choosing an instructor — the choice is implicit because there's only one. The per-instructor credits work (`PER-INSTRUCTOR-CREDITS-PLAN.md`) makes credits attributable to a specific instructor at purchase time, but says almost nothing about *how* a learner makes that choice in the UI.

This plan answers: where does a learner first encounter the choice of instructor, what does each instructor's surface look like, how does the existing booking + purchase flow get retired, and what gets put in its place.

---

## Load-bearing commercial decisions (resolved 2026-05-19 with Fraser)

Eight commercial decisions are baked into this plan. They're recorded here so future-readers can see what was decided and why, and so a reviewer can challenge a specific decision without re-litigating the whole plan.

1. **Discovery surface:** dedicated `/instructors` index page. Public, SEO-indexed, no auth required. The canonical front door.
2. **Existing surfaces retired:** `book.html` and `buy-credits.html` are replaced, not augmented. Single-paradigm front door, no parallel flows for legacy learners.
3. **Price visibility on the index:** rates hidden on instructor cards. Rates revealed only after clicking through to a specific instructor's page. Trade-off: less price-shopping, more relationship-led decisions.
4. **Existing learner experience:** no special "legacy" mode. Existing learners go through the new flow like everyone else. Cutover: today's `book.html` and `buy-credits.html` URLs redirect to `/instructor/fraser` for 30 days, then to `/instructors`.
5. **Bundle surface:** bulk-pack tier cards + single-lesson options side-by-side on each instructor's page. Instructor opts into which appear via two toggles (`bulk_tiers_enabled`, new `single_lessons_enabled`).
6. **Trust signals on cards:** photo + name + area + short bio + pass rate + years experience + specialism tags. Reviews/testimonials and live availability deferred (reviews need a separate system; availability is a heavy query at index load).
7. **Auth gating:** guests can browse all the way through bundle/lesson selection. Account required only at checkout. Matches existing `book.html` spectator mode + free-trial guest checkout pattern.
8. **Cross-instructor honesty:** if a learner with credits at instructor A lands on instructor B's page, B's bundles render normally but a small notice acknowledges the existing credit at A. Upstream honesty before the booking refusal moment.

---

## Hard rules

1. **`/instructors` is the canonical front door.** Every learner journey starts there. `book.html` and `buy-credits.html` are retired surfaces — they exist only as redirects.
2. **Per-instructor purchase surfaces are the only place credits are bought.** No school-wide "buy credits" page survives.
3. **The instructor page is the booking surface AND the purchase surface.** Two functions on one page so the learner never has to navigate between "deciding to commit" and "completing the commitment."
4. **Existing free-trial flow stays intact during the cutover.** `school='trial'` learners and the `?action=book-free-trial` path are not in scope for this plan. The free-trial CTA can be surfaced on instructor pages but the underlying flow is unchanged.
5. **Auth at checkout, not browsing.** Guests can land on `/instructors`, click into any instructor, browse slots and bundles, see prices. Account required only at `?action=checkout` time.
6. **No instructor-page UI implies automation that doesn't exist.** Simon's page during State 3 (visible, no Stripe Connect) looks identical to Fraser's — no badges, no language about "automated payouts," no infrastructure exposed to learners. Payment-routing internals stay internal.
7. **Mobile-first responsive layout.** Most learners book on phones. Every screen in this plan must work on a 375px viewport before it's considered done.
8. **SEO-friendly URL structure.** `/instructors` and `/instructor/[slug]` are public marketing surfaces. Server-rendered title/meta/structured-data per instructor.

---

## Page-by-page specification

### `/instructors` — public index page

**URL:** `/instructors`
**Auth:** none required
**Renders:** all instructors where `instructors.active = TRUE AND instructors.publicly_visible = TRUE` (new column — gates visibility independently of activity)

**Card shape (per instructor):**
```
[Photo]
Name
Area covered (e.g. "Bromsgrove, Redditch, Droitwich")
Short bio (one or two lines)
Pass rate: X% (last Y lessons)
Years experience: N
Specialisms: [tag] [tag] [tag]
[ Book lessons → ] CTA
```

**Filters / sort (Phase 1):** none. Single grid of cards. If the school has ≥5 instructors, add filtering in a Phase 2.

**SEO:** server-rendered, sitemap entry, structured data per instructor card (`Person` + `ProfilePage` schema.org), unique title/meta per school.

### `/instructor/[slug]` — per-instructor page

**URL:** `/instructor/[slug]` where `slug = instructors.slug` (new column, populated at instructor creation).
**Auth:** none required for browsing; required at checkout
**Renders:** the instructor's full profile + purchase + booking surface

**Section 1 — profile header.** Photo, name, area, full bio, pass rate, years experience, specialism tags. The same trust signals as the index card but expanded.

**Section 2 — purchase options.** Three sub-sections, each gated on instructor opt-in:

- **Bulk-pack tiers** (if `bulk_tiers_enabled = TRUE`): cards for 5h / 10h / 20h (whatever the school catalogue defines) showing total cost and effective per-hour rate at this instructor's tier.
- **Single lessons** (if `single_lessons_enabled = TRUE`): cards for 60 / 90 / 120 / 165-min lessons at the instructor's list rate.
- **Free trial** (if school has `slug = 'trial'` OR the instructor has a free-trial flag enabled — to be decided in the coupling check): CTA to `/free-trial.html?instructor_id=X`.

**Section 3 — slot picker.** The booking surface. Shows the next available slots with this instructor over the next 84 days (existing `?action=available&min_duration_only=1` feed, filtered to one instructor). Click a slot → modal opens with duration picker → checkout flow.

**Section 4 — cross-instructor notice (logged-in learners only).** If the learner has credits with other instructor(s):
> "You have 6 hours of credit with Fraser. Use them with him via [his page]. The bundles below would be new credit attributed to Simon."

Honest, factual, points the learner at the action. No upsell pressure.

**Section 5 — footer / FAQs.** Same on every instructor page. Cancellation policy, what to expect on a first lesson, contact.

### Checkout

No new page — Stripe Checkout opens in a modal/redirect as it does today. The only change: `instructor_id` is passed through from whichever button was clicked (bulk card, single-lesson card, slot picker).

This is the coupling point with `PER-INSTRUCTOR-CREDITS-PLAN.md` Step 4 — `api/credits.js?action=checkout` requires `instructor_id` in the request body. The button passes it; the server snapshots `effective_rate_pence_per_minute` from the Step 3 pricing helper; the BCS row gets created in Step 5's flow.

### Account flow (for guest checkout)

Pattern matches existing `?action=checkout-slot-guest`: guest provides email + name during Stripe Checkout, account is created post-purchase, magic-link / email-code lands them in the PWA logged in.

---

## Files touched

### New pages

- `public/instructors.html` — the `/instructors` index page
- `public/instructor.html` — the per-instructor template (slug-routed via Vercel rewrites)
- Maybe a new sidebar entry "Find an instructor" linking to `/instructors`

### Modified pages

- `public/book.html` — replaced. Either deleted entirely (with redirect rules) or repurposed as the free-trial-only spectator surface. Confirm during coupling check.
- `public/buy-credits.html` — replaced. Redirects to `/instructor/fraser` for 30 days, then `/instructors`.
- `public/learner/profile.html` — Step 4 of credits plan already covers the balance UI change. This plan adds a "Find another instructor" link.
- Sidebar nav (in `sidebar.js`) — adds "Find an instructor" / "Browse instructors" entry.

### New / modified API endpoints

- `api/instructors.js?action=list-public` — returns the index data (one card per publicly-visible instructor). Public, no auth, cached aggressively.
- `api/instructors.js?action=profile&slug=X` — returns one instructor's full profile + opt-in flags. Public, no auth.
- `api/slots.js?action=available` — already exists. Filter by `instructor_id` is already supported.
- `api/credits.js?action=checkout` — already changing in credits plan Step 4 (requires `instructor_id`).

### Schema additions

- `instructors.slug TEXT UNIQUE` — URL-friendly identifier. Populated at instructor creation or backfilled from `name`.
- `instructors.publicly_visible BOOLEAN NOT NULL DEFAULT FALSE` — gates appearance on `/instructors`. Defaults FALSE so new instructors are hidden until explicitly toggled on (Fraser-controlled).
- `instructors.bio_short TEXT` — one-line bio for cards.
- `instructors.bio_long TEXT` — full bio for the profile page.
- `instructors.area_covered TEXT` — comma-separated area names or postcodes.
- `instructors.pass_rate_pct INTEGER` — manually maintained for now; could auto-compute later.
- `instructors.pass_rate_sample INTEGER` — "X% over last N lessons" for credibility.
- `instructors.years_experience INTEGER`
- `instructors.specialisms TEXT[]` — array of tags ("manual", "automatic", "nervous learners", "motorway")
- `instructors.single_lessons_enabled BOOLEAN NOT NULL DEFAULT FALSE` — new toggle paralleling `bulk_tiers_enabled` from credits plan Step 7.
- `instructors.free_trial_offered BOOLEAN NOT NULL DEFAULT FALSE` — gates whether free-trial CTA appears on the page.

All school-scoped (`school_id` inherited via FK to the instructor's school).

---

## Sequencing

| # | Step | Effort | Depends on |
|---|------|--------|-----------|
| 1 | Schema additions (slug, publicly_visible, trust-signal columns, new toggles) | 2–3h | Migration via /api/migrate |
| 2 | Backfill slug + trust-signal fields for Fraser and Simon | 1h | Step 1 |
| 3 | `api/instructors.js?action=list-public` and `?action=profile` endpoints | 3–4h | Step 1 |
| 4 | `/instructors` index page (HTML/CSS/JS, SEO, mobile-first) | 6–8h | Step 3 |
| 5 | `/instructor/[slug]` profile page (header + purchase sections + slot picker + cross-instructor notice) | 8–10h | Step 3 + credits plan Step 4 |
| 6 | Admin UI for trust-signal fields + new toggles on instructor edit form | 3–4h | Step 1 |
| 7 | Checkout integration (buttons pass instructor_id; checkout works for bulk + single-lesson) | 3–4h | Credits plan Step 4 |
| 8 | Cross-instructor notice logic | 2h | Step 5 + credits plan Step 4 |
| 9 | Retire `book.html` + `buy-credits.html`: redirect rules to `/instructor/fraser` for 30 days, then to `/instructors` | 2h | All pages live |
| 10 | SEO meta, sitemap, structured data | 2–3h | Steps 4 + 5 |
| 11 | Mobile-first responsive pass on all new pages | 4–6h | Steps 4 + 5 |
| 12 | Update sidebar nav to include "Find an instructor" | 1h | Step 4 |

**Total: ~37–48h.** Same magnitude as the credits plan itself. Most of the cost is in the new pages (Steps 4 + 5) and the responsive pass.

---

## Coupling points with `PER-INSTRUCTOR-CREDITS-PLAN.md`

This section is the focus of the next review pass. Every coupling point listed here is something where a decision in one plan constrains the other plan. Both plans need to agree on each point before either ships.

### Hard couplings (cannot ship Plan B without Plan A's decision)

1. **`api/credits.js?action=checkout` requires `instructor_id`.** Credits plan Step 4 makes this required. Learner-UX plan's buttons pass it. **Decision shared:** both plans must agree on the exact request shape and validation rules.

2. **`getEffectiveRatePencePerMinute` returns per-instructor rates.** Credits plan Step 3 builds the helper. Learner-UX uses it on the instructor page to display bundle and single-lesson prices. **Decision shared:** when the helper is called from a public (unauthenticated) endpoint with no `learner_id`, what's the fallback behaviour? The plan's three-level fallback assumes `learner_id` — we need a clean public-rate path.

3. **`learner_credit_balances` is the source of truth for "do I have credits with this instructor."** Credits plan Step 2 schema. Learner-UX queries this to render the cross-instructor notice. **Decision shared:** the public profile page can't query LCB without authentication; only the logged-in version of the page surfaces the notice.

4. **`booking_credit_sources.absorbed_by` propagates from `credit_transactions`.** Credits plan Step 5.5. Learner-UX doesn't directly touch absorption but a goodwill-funded booking should NOT appear in the learner's "buy more like this" suggestions (because no money changed hands). **Decision shared:** does the instructor page show "you took 3 lessons here" history? If yes, do goodwill lessons count?

### Soft couplings (one plan's decision should inform the other's)

5. **The "single lesson" path needs a `credit_transactions` row per purchase.** This is implied by credits plan Step 2 (`booking_credit_sources.credit_transaction_id` is NOT NULL) but not explicitly traced through. Buying a single 60-min lesson via the instructor page creates a `credit_transactions` row with `minutes = 60`, `source = 'stripe'`, `instructor_id` set. The Stripe Checkout success drains the credit immediately into a booking. **Decision shared:** does the single-lesson Stripe Checkout flow look any different from the bulk-pack Stripe Checkout flow internally? My instinct: no, they're the same code path with different `minutes` values.

6. **Free trials still create a zero-value `credit_transactions` row** (credits plan Step 1b free-trial wiring). Learner-UX shows a free-trial CTA on instructor pages where enabled. **Decision shared:** the CTA links to the existing `/free-trial.html?instructor_id=X&date=Y` page — does that page also need a redesign or does the existing page stay as the trial-funnel landing?

7. **Cutover sequencing.** Credits plan reaches "scoped, attributed, atomic" at Step 5. Learner-UX needs that to be true before its checkout buttons can route correctly. **Decision shared:** is there a window where credits-data is live but learner-UX isn't, during which Fraser-only existing learners continue using the legacy URLs (now redirecting to `/instructor/fraser`)? My instinct: yes, that's the soft transition window.

8. **GDPR data export.** Credits plan Step 2 updates `handleExportData()` to include scoped balances + adjustments + sources. Learner-UX adds new `instructors` columns (slug, bio, etc) that are NOT learner data and shouldn't be in the export. **Decision shared:** confirm no learner PII enters the new `instructors` columns; if it does (e.g. a reviews field referencing learner names), GDPR cascade needs updating.

9. **Admin UI.** Credits plan Step 8 (admin UI for tiers + per-instructor rates) is currently DEFERRED. Learner-UX plan Step 6 adds admin UI for the trust-signal fields + new toggles. These should share one instructor-edit screen, not two. **Decision shared:** does Step 6 here unblock Step 8 of the credits plan (one consolidated admin screen), or are they genuinely separate? My instinct: consolidate.

10. **`instructors.single_lessons_enabled` is a new commercial toggle that the credits plan doesn't anticipate.** It interacts with the credits-data layer because turning it OFF means no single-lesson `credit_transactions` rows can be created for that instructor. **Decision shared:** the credits plan's API should not reject a single-lesson checkout outright when the toggle is FALSE — the learner-UX layer should hide the option upstream. Defence-in-depth: the checkout endpoint *also* validates the toggle, but doesn't shape its primary behaviour around it.

### Schema couplings

11. **Both plans add columns to `instructors` table.** Credits plan adds `hourly_rate_pence` (Step 3), `bulk_tiers_enabled` (Step 7). Learner-UX adds slug, publicly_visible, bio_short, bio_long, area_covered, pass_rate_pct, pass_rate_sample, years_experience, specialisms, single_lessons_enabled, free_trial_offered. **Decision shared:** one migration step that adds all of these together, or two separate migrations? My instinct: consolidate into one migration to avoid Step 8 of the credits plan being half-built.

12. **GDPR cascade additions.** Credits plan extends `deleteLearnerCascade()` for `learner_credit_balances`. Learner-UX doesn't add learner-data tables but the new `instructors` columns must not be exported in learner data export. **Decision shared:** explicit no-op confirmation in `handleExportData()` review.

---

## Things explicitly chosen NOT to do

- **Filtering / sorting on `/instructors` index in Phase 1.** Single grid of cards. Adds when school has ≥5 instructors.
- **Live availability indicators on cards** (e.g. "Next slot: Thursday 6pm"). Heavy query at index load, marginal value at 2 instructors. Revisit when ≥5 instructors.
- **Learner reviews / testimonials system.** Doesn't exist today. Building it adds 10+ hours and a moderation surface. Defer until Fraser specifically asks for it.
- **A separate "compare instructors" page.** The cards on `/instructors` ARE the comparison. No separate compare-side-by-side view.
- **A "favourite instructor" feature.** Speculative. Defer.
- **Search / fuzzy match.** Two instructors means scrolling. Add when ≥10.
- **`instructors.publicly_visible` UI toggle exposed to instructors themselves.** It's an admin (Fraser) decision whether an instructor appears publicly. Instructors don't toggle their own public visibility — that's a Fraser-controlled launch signal.

---

## Open questions (to resolve during coupling-impact review)

1. **What happens to `book.html` exactly?** Three options:
   - Delete entirely (redirects to `/instructor/fraser` for 30 days, then `/instructors`)
   - Repurpose as the free-trial-only landing (since free-trial flow has its own spectator-mode pattern)
   - Keep as a slot-feed-only debug surface accessible by admin

2. **Slot picker on the instructor page — replaces `book.html` entirely or just for this instructor's slots?** If the latter, what about overflow routing? The April 2026 overflow routing on `book.html` shows alternative instructors when the chosen one has no slots. Does the new instructor page have an "Overflow to other instructors →" CTA when the slot picker is empty?

3. **Does Simon's instructor page surface anything that learners might construe as a "verified" or "vetted" badge?** Trust signals matter but I want to be honest about what we're claiming. Pass rate is empirical; "verified" implies platform-level vetting that we don't currently do.

4. **What about instructors who are active but not yet publicly visible?** Internal/test instructors might exist. The `publicly_visible` flag handles this for `/instructors`, but `/instructor/[slug]` is also public — should we render a 404 for non-publicly-visible instructors' slug URLs, or render the page but with a "Not yet accepting bookings" notice?

---

## How this maps to existing plans

- `PER-INSTRUCTOR-CREDITS-PLAN.md` — data + API + admin layer. Ships first.
- This plan — learner UX layer. Ships second.
- `FRANCHISE-MODEL-PLAN.md` — the umbrella plan for franchise expansion. This plan is the consumer-facing implementation of the franchise model. Phase 2C (admin UI) of the franchise plan is partially absorbed into Step 6 of this plan.
- `INSTRUCTOR-EXPERIENCE-PLAN.md` — the non-software companion. This plan implements the consumer side of the cold-start lead allocation problem.
