# Learner Instructor Selection — Delivery Plan (DRAFT)

**Status:** drafted 2026-05-19, revised same day after GPT-5.5 coupling-impact review. **STILL DRAFT** — awaiting joint round-1 external critique (this is the learner-UX plan's first formal review). Do not start implementation until both plans converge through that round.

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
4. **Existing learner experience:** no special "legacy" mode. Existing learners go through the new flow like everyone else. **Cutover happens in Step 9, not on Day 1.** During Phase 1: `public/learner/book.html` and `public/learner/buy-credits.html` stay live and reachable at their existing URLs (including `/book/:slug` per `vercel.json:35-39`, the PWA manifest shortcut at `public/manifest.json:40-43`, and the webhook redirect targets). After ≥30 clean days post-launch, Step 9 introduces redirects: `book.html` and `buy-credits.html` 302-redirect to `/instructor/fraser` for 30 days (so deep-linked learners landing from email/PWA see a familiar booking surface), then 301 to `/instructors`. The redirect work itself is in scope of THIS plan's Step 9; the eventual file deletion is a follow-up.
5. **Bundle surface:** bulk-pack tier cards + single-lesson options side-by-side on each instructor's page. Instructor opts into which appear via two toggles (`bulk_tiers_enabled`, new `single_lessons_enabled`).
6. **Trust signals on cards:** photo + name + area + short bio + pass rate + years experience + specialism tags. Reviews/testimonials and live availability deferred (reviews need a separate system; availability is a heavy query at index load).
7. **Auth gating:** guests can browse the `/instructors` index, every `/instructor/[slug]` profile page, all bundle/single-lesson cards, and the slot picker. Account creation is required **at the bundle/single-lesson CTA click** for bulk/single credit purchases (matches credits plan Path A — `PER-INSTRUCTOR-CREDITS-PLAN.md` "Guest bulk checkout — Path A"). The existing free-trial slot path (`?action=checkout-slot-guest` → `/free-trial.html?instructor_id=…`) remains the only guest-purchase route on the site; it is unchanged. Round-4 correction: the original plan wording "account required only at checkout" was ambiguous — read literally it implied guests could click "Buy 10 hours" and reach Stripe Checkout. They cannot. Both plans now use the same wording: account required *at the CTA*, before any Stripe Session is created.
8. **Cross-instructor honesty:** if a learner with credits at instructor A lands on instructor B's page, B's bundles render normally but a small notice acknowledges the existing credit at A. Upstream honesty before the booking refusal moment.

---

## Multi-tenant school resolution on public surfaces

Coupling-review surfaced that public APIs currently default to `school_id = 1` silently — fine for CoachCarter, dangerous for InstructorBook as it onboards more schools.

**Round-4 correction (closes round-4 flaw "Multi-tenant school resolution claims infrastructure that does not exist").** The original wording said "already handled by `middleware.js` / `branding.js`." That is **false**. `middleware.js:17-99` handles maintenance mode, learner-area auth gating, and CORS only — it has no host→school mapping. `api/instructors.js:49` still does `parseInt(req.query.school_id) || 1`. `api/slots.js:108-109` does the same. The CLAUDE.md tenancy rule "every tenant-scoped query MUST filter by `school_id`" is honoured by query-string passing, not by a server-resolved tenant identity.

This plan therefore **introduces** the missing infrastructure. It is a prerequisite for any of the new public endpoints below.

### Step 0 — Shared tenant-resolution helper (NEW prerequisite, must ship before any new public endpoint)

**Single-host-per-school is sufficient for MVP** (scope-reduction decision 2026-05-19 — re-evaluate when the first non-CoachCarter school onboards to InstructorBook, i.e. the first row in `schools` with `id != 1`. Same trigger as the I1 tenant-resolution drift gate, since multi-host needs become live at exactly the same moment legacy-endpoint sweeps do). One `schools.primary_host TEXT` column; no separate lookup table. If a school later needs apex + www + custom-domain support, that's a follow-up — for now `www.coachcarter.uk` is treated as the canonical host and apex traffic is handled by Vercel-level redirects (already in place).

```sql
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_host TEXT;
UPDATE schools SET primary_host = 'www.coachcarter.uk' WHERE id = 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_primary_host
  ON schools(primary_host) WHERE primary_host IS NOT NULL;
```

New `api/_tenant.js` exporting `resolveSchoolFromRequest(req)`:

```js
// Priority order:
//   1. Host header lookup against schools.primary_host (case-insensitive exact match)
//   2. ?school=<slug> query string lookup against schools.slug
//   3. Development fallback: localhost / *.vercel.app -> school_id = 1
//   4. None of the above -> null (caller MUST 404, never silently default)
//
// Returns { schoolId, source: 'host' | 'query' | 'dev_fallback' }
```

**Authenticated endpoints** continue to derive `school_id` from the JWT, not from the request — JWT-derived tenancy is the authoritative path and is not affected by this helper.

**Public endpoints introduced by this plan** (`api/instructors?action=list-public`, `?action=profile`, `api/credits?action=public-rate`) MUST call `resolveSchoolFromRequest()` and 404 if it returns null. They MUST NOT accept `school_id` from the client.

**Existing public endpoints** (`api/instructors?action=list`, `api/slots?action=available` guest path, free-trial flow) keep their current `parseInt(req.query.school_id) || 1` shape during Phase 1 — switching them over is a follow-up after Simon's school stays on `school_id = 1`. The migration risk of touching every existing public surface during the InstructorBook launch is higher than the leak risk (today there is only one school).

### Tenant-resolution drift gate (resolves round-4 critical I1)

The "existing endpoints stay on `|| 1` until later" carve-out is safe only while `schools` contains exactly one row (CoachCarter, `id = 1`). The moment a second school exists, every legacy endpoint that defaults to `school_id = 1` becomes a cross-tenant leak. The plan defends this with belt-and-braces:

**Belt — database trigger on `schools` insert.** Modelled on the Step 1c → Step 2 migration-marker pattern from the credits plan. Insertion of any school with `id != 1` requires a marker row asserting the sweep is done:

```sql
-- Reuses the migration_markers table introduced in the credits plan (Step 1c).
-- The marker is inserted by hand after the implementer has:
--   1. Replaced every `parseInt(req.query.school_id) || 1` in api/instructors.js,
--      api/slots.js, api/free-trial.js, and any other public endpoint that
--      currently has the silent default, with a `resolveSchoolFromRequest()` call.
--   2. Verified each replacement returns 404 when host/query/dev-fallback all
--      fail (i.e. when called from an unmapped host with no ?school=).
--   3. Deployed and smoke-tested against CoachCarter prod.
-- Only then does the implementer insert the marker.

CREATE OR REPLACE FUNCTION assert_public_endpoints_tenant_resolved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> 1 AND NOT EXISTS (
    SELECT 1 FROM migration_markers
     WHERE key = 'public_endpoints_tenant_resolved'
  ) THEN
    RAISE EXCEPTION 'Cannot create school id=% — public endpoints still default to school_id=1. '
      'Sweep legacy endpoints to use resolveSchoolFromRequest(), then insert the '
      '"public_endpoints_tenant_resolved" migration marker before creating non-default schools.',
      NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_schools_require_tenant_resolution
  BEFORE INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION assert_public_endpoints_tenant_resolved();
```

Why a trigger rather than a documentation note: the plan already proves that documentation-as-gate fails — the original "already handled by middleware.js / branding.js" wording sat in the plan for weeks before it was caught. A trigger is unbypassable without explicit acknowledgment (the marker insert), which is the right ergonomic for a once-per-platform-lifetime decision.

The trigger ships in the same migration as Step 0 (`schools.primary_host` column). The marker stays absent until the legacy-endpoint sweep is actually done. Inserting the marker is itself an audit-loggable event — admin SQL only, no API surface for it.

**Braces — daily drift detector on the operator widget.** See `PER-INSTRUCTOR-CREDITS-PLAN.md` "Operator widget additions" for the new "Tenant-resolution drift" tile. It runs the same falsifier query as the trigger predicate but as a daily snapshot, so a future implementer who finds a way around the trigger (e.g. by inserting the marker prematurely without doing the sweep) still gets caught the next morning.

If none of the three sources produce a `school_id`, the new endpoints return 404. **No cross-school listing on `/instructors`.** Each school sees only its own instructors. CoachCarter learners must never see InstructorBook tenants' instructors in their picker, and vice versa.

This step is a hard prerequisite — none of the new endpoints below ship until it's live in prod.

## Hard rules

1. **`/instructors` is the canonical front door for *new* learner journeys.** `public/learner/book.html` and `public/learner/buy-credits.html` are NOT retired in Phase 1 — they stay live during a soft-transition window. The "exist only as redirects" wording from the original draft was inconsistent with both the Modified-pages section ("keep them accessible") and the sequencing table's Step 9 (retire/redirect in a final step). Round-4 correction: Phase 1 keeps legacy surfaces, adds new entry points, and ships redirects only in Step 9. Retirement of the legacy pages happens in a separate follow-up plan once the new flow has ≥30 days of clean booking-failure-rate data. See "Files touched / Modified pages" for the cutover detail.
2. **Per-instructor purchase surfaces are the only place credits are bought.** No school-wide "buy credits" page survives.
3. **The instructor page is the booking surface AND the purchase surface.** Two functions on one page so the learner never has to navigate between "deciding to commit" and "completing the commitment."
4. **Existing free-trial flow stays intact during the cutover.** `school='trial'` learners and the `?action=book-free-trial` path are not in scope for this plan. The free-trial CTA can be surfaced on instructor pages but the underlying flow is unchanged.
5. **Auth at CTA click, not browsing.** Guests can land on `/instructors`, click into any instructor, browse slots and bundles, see prices. Clicking a "Buy" CTA on a bundle or single-lesson card routes them to login/signup (with a returnTo back to the same card), then back. The `?action=checkout` endpoint itself remains learner-authenticated — matches credits plan Path A. The only guest-purchase route on the site is the existing free-trial slot path (`?action=checkout-slot-guest`).
6. **No instructor-page UI implies automation that doesn't exist.** Simon's page during State 3 (visible, no Stripe Connect) looks identical to Fraser's — no badges, no language about "automated payouts," no infrastructure exposed to learners. Payment-routing internals stay internal.
7. **Mobile-first responsive layout.** Most learners book on phones. Every screen in this plan must work on a 375px viewport before it's considered done.
8. **SEO-friendly URL structure.** `/instructors` and `/instructor/[slug]` are public marketing surfaces. Server-rendered title/meta/structured-data per instructor.

   **Round-4 SEO addendum (closes flaw #12 "lacks canonical/duplicate-content rules"):**
   - Each `/instructor/[slug]` page emits a `<link rel="canonical" href="https://<school-primary-host>/instructor/<slug>">` resolved server-side from `schools.primary_host`.
   - Title and meta-description templates per page MUST interpolate at least name + area + one specialism tag so two instructors with identical bios don't generate identical metadata. Title pattern: `"{name} — driving instructor in {area_covered} | {school.name}"`. Meta description pattern: first 150 chars of `bio` (full), falling back to `bio_short` + specialisms list.
   - Admin-edit guidance copy added next to the `bio` and `bio_short` fields: "Each instructor's bio is publicly indexed. Pages that copy each other's bios verbatim rank worse than unique copy." This is guidance, not enforcement — the system does NOT block duplicate bios server-side (would create a confusing admin UX for the trivial case of brand-new instructors).
   - The sitemap (`/sitemap.xml`, switched from static `public/sitemap.xml:2` to server-rendered in Step 10) lists each public instructor at the canonical host only.

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
- **Free trial** — round-4 update closes flaw #8 ("contradictory and incomplete free-trial gating"). The CTA appears if and only if **all three** of the following are true (single server predicate, used by both the profile API and the page render). The "OR" wording in earlier drafts is dropped:
  1. The school has an `active = TRUE` lesson type with `slug = 'trial'` (matches `api/slots.js:1791-1797`).
  2. The instructor has `free_trial_offered = TRUE` (new column from Schema additions section).
  3. The instructor's `offered_lesson_types` JSONB allows `"trial"` (matches `api/slots.js:1900-1906` — already enforced server-side at trial-booking time).

  CTA links to `/free-trial.html?instructor_id=<id>&date=<earliest-available-trial-slot-date>`. If the predicate is false, the section is hidden — not "disabled" with a tooltip, just absent. This prevents the UI showing a CTA that the API then rejects after the learner has filled the form.

**Section 3 — slot picker.** The booking surface. Shows the next available slots with this instructor over the next 84 days (existing `?action=available&min_duration_only=1` feed, filtered to one instructor via `instructor_id`). Click a slot → modal opens with duration picker → checkout flow.

**Empty slot state** (coupling-review open question #2, revised round 4): when this instructor has no slots in the next 84 days, the slot section renders an empty state. **The CTA branches on visible-instructor count in the school** (closes round-4 flaw #7 — "Empty-slot CTA can dead-end single-instructor schools"):

- **If `COUNT(*) FROM instructors WHERE school_id = <school> AND publicly_visible = TRUE AND active = TRUE >= 2`:** CTA reads "No upcoming slots with this instructor. Browse other instructors →" linking to `/instructors`. The existing `book.html` overflow logic at `public/learner/book.js:428-442` uses the same `instructors.length > 1` gate today — we mirror that rule.
- **If the count is 1 (only this instructor is publicly visible):** CTA reads "No upcoming slots with [name] right now. Get notified when one opens →" linking to a learner-availability form (already exists at `api/_notify-availability.js` after the May 2026 waitlist replacement; the form lives on `/learner/profile.html` today and we add an inline mini-form on the instructor page). Fallback secondary CTA: "Or contact us →" linking to the school's `contact_phone` / `contact_email` from `schools` table.
- **Logged-out variant:** if the learner is a guest, the "get notified" form first collects email/name and signs them up before saving availability — mirrors the `?action=checkout-slot-guest` post-purchase signup pattern.

The instructor page never renders a mixed slot feed of alternative instructors inline — that would dilute the instructor-first model. The existing `book.html` overflow routing (April 2026, DEVELOPMENT-ROADMAP 2.67) stays intact for the legacy page and may be removed in the post-Phase-1 retirement of `book.html`.

**Section 4 — cross-instructor notice (logged-in learners only).** If the learner has credits with other instructor(s):
> "You have 6 hours of credit with Fraser. Use them with him via [his page]. The bundles below would be new credit attributed to Simon."

Honest, factual, points the learner at the action. No upsell pressure. **Ship this copy as-is** (scope-reduction 2026-05-19 — re-evaluate when Fraser hears the first real piece of feedback about it: a learner asking a confused question that traces to this notice, watching a learner react in person, or Simon mentioning a learner brought it up. Conversation-driven, not metric-driven — no analytics instrumentation planned for this). Hours-only, no £ value — keeps the comparison apples-to-apples with the bundle cards directly below.

**Auth-gating implementation** (coupling-review #3):

The instructor profile HTML/JS is public — no auth required to render. The cross-instructor notice section is hidden by default and populated via a separate authenticated AJAX call:

```http
GET /api/credits?action=instructor-balances
Authorization: required (cc_learner cookie)
Response: [
  { "instructor_id": 1, "instructor_name": "Fraser", "instructor_slug": "fraser", "balance_minutes": 360 },
  { "instructor_id": 2, "instructor_name": "Simon", "instructor_slug": "simon", "balance_minutes": 0 }
]
```

- The endpoint derives `learner_id` from the `cc_learner` cookie. **It never accepts `learner_id` as a parameter.** This is non-negotiable — accepting `learner_id` from the client would let any visitor query any learner's balances by URL manipulation.
- 401 for guests. Page JS handles 401 silently — the notice section stays hidden.
- The notice only renders when the response contains at least one row with `balance_minutes > 0` AND that row's `instructor_id ≠` the currently-viewed instructor.
- Linkified instructor names use the `instructor_slug` from the response, not a client-side lookup.

**Section 5 — footer / FAQs.** Same on every instructor page. Cancellation policy, what to expect on a first lesson, contact.

### Checkout

No new page — Stripe Checkout opens in a modal/redirect as it does today. The only change: `instructor_id` is passed through from whichever button was clicked (bulk card, single-lesson card, slot picker).

This is the coupling point with `PER-INSTRUCTOR-CREDITS-PLAN.md` Step 4 — `api/credits.js?action=checkout` requires `instructor_id` in the request body. The button passes it; the server snapshots `effective_rate_pence_per_minute` from the Step 3 pricing helper; the BCS row gets created in Step 5's flow.

### Account flow at the bundle/single-lesson CTA

When a guest clicks a "Buy" CTA on a bulk or single-lesson card:

1. The card click handler detects no `cc_learner` cookie.
2. UI routes the guest to `/learner/login.html?signup=1&returnTo=/instructor/<slug>%23<card-anchor>` (returnTo is the same page + the fragment identifier of the card they clicked, so the post-signup landing scrolls them back to the exact card).
3. After signup or login, the page reloads at the returnTo and the same CTA is re-armed with the now-authenticated session.
4. The CTA's `?action=checkout` call now runs as an authenticated learner; credits plan's normal Path A logic takes over.

The existing `?action=checkout-slot-guest` flow is **not** extended to bulk/single-lesson purchases. That endpoint stays scoped to free-trial slot-clicks only, as recorded in credits plan "Guest bulk checkout — Path A."

This is the only place the learner-UX plan's account flow differs from the original phrasing. The free-trial flow continues to handle account creation post-Stripe via magic-link / email-code as it does today.

---

## Trust-signal language rules (resolved in coupling review)

Specific copy decisions for the instructor cards and profile pages. These exist to avoid implying platform-level claims that aren't backed by an actual policy.

- **"Pass rate X%"** renders ONLY when `pass_rate IS NOT NULL` AND `pass_rate_sample IS NOT NULL` AND `pass_rate_sample >= 5`. The display includes the sample size: "Pass rate 87% (across last 23 lessons)". Single percentage without a denominator is misleading and is hidden.

  **Round-4 correction (closes flaw #10 "Trust-signal enforcement is only a rendering rule"):** the server enforces this, not just the client. The public endpoints `api/instructors.js?action=list-public` and `?action=profile` MUST return a precomputed `pass_rate_display` field — a string like `"87% (across last 23 lessons)"` or `null` — and MUST NOT return the raw `pass_rate` or `pass_rate_sample` columns to public callers. Today's `api/instructors.js:51-52` returns raw `pass_rate` with no sample field; that is changing here. A tampered client cannot fabricate the display string because the underlying numbers never reach it. Admin-authenticated endpoints (`api/admin.js:625-644`) keep returning the raw columns for editing.
- **When pass-rate cannot render**, fall back to displaying `years_experience` as "Experience" and `specialisms` only. Don't substitute a worse signal.
- **No "Verified" badge** appears on cards or profile pages. The platform does not currently vet instructor claims (DVSA registration, insurance, vehicle MOT, etc.). Until a verification policy exists with documented criteria and a sustainable verification process, no badge is shown.
- **Specialisms tags** render from the existing `specialisms` JSONB column. The tag vocabulary is admin-defined and the rendering layer must treat the tag text as user-controlled (see XSS section below).
- **No fake urgency.** Cards don't render "Booking fast" / "Only 2 slots left this week" without a real query backing it. If we ever add availability indicators, they query real data.

## Lesson history on the instructor page (coupling-review #4, resolved 2026-05-19)

**Phase 1 decision** (scope-reduction 2026-05-19 — re-evaluate when a learner asks for a spend/revenue breakdown on the instructor page, OR when ≥3 instructors are publicly visible and learners start using the lesson count to compare across instructors): for logged-in learners on `/instructor/[slug]`, surface a simple lesson count only — "You've taken N lessons with [name]" — sourced from `COUNT(*) FROM lesson_bookings WHERE learner_id = $me AND instructor_id = $this AND status IN ('scheduled', 'chargeable')`. No revenue figures, no per-funding-source breakdowns, no "you've spent £X" line.

Including a free-trial or goodwill lesson in this count is fine — it's a lesson the learner attended with this instructor, which is what the number represents. Distinguishing funding sources adds complexity for negligible learner-facing value at Phase 1's scale.

If a future surface needs to distinguish "lessons paid for" from "lessons attended" (e.g. a billing-history view, or instructor-revenue signals), define the `funding_kind` enum at that point — not speculatively now. The shape would naturally derive from `booking_credit_sources.credit_transaction_id → credit_transactions.source` and `absorbed_by`, but Phase 1 doesn't build it.

## Bio XSS and image hosting (net-new findings from coupling review)

**Bio fields are user-controlled and rendered on public pages.** The existing `bio` column and the new `bio_short` column both accept admin/instructor-supplied text that ends up on `/instructor/[slug]` and `/instructors` cards respectively. Rules:

- Frontend MUST render via `textContent` (innerHTML is banned for these fields). Plain text only. No formatting.
- If we later want formatted bios (paragraphs, links), introduce a Markdown layer with a server-side sanitiser. Don't roll a permissive HTML field.
- Server-side validation: strip control characters (per `feedback_c1_control_chars.md`), reject anything > 2000 chars (`bio`) / 280 chars (`bio_short`).

**Instructor photos** need a storage decision the plan was originally silent on. Round-4 critique surfaced that the previous wording (Vercel Blob, validation, "existing off-platform URLs stay valid") was unimplementable as written — no upload endpoint, no auth role, no byte validation, no deletion policy, no resolution of the existing-off-platform-URL trust boundary, no privacy update.

This section now specifies the full shape.

**Current state (verified against `main`):**
- `api/instructor.js:1633-1658` accepts a base64 data URL via `?action=upload-photo` (instructor-authenticated) and stores it directly in `instructors.photo_url`.
- `api/instructors.js:156-157` and `api/admin.js:801-802` accept arbitrary `photo_url` strings from admin update payloads with no validation.
- `middleware.js:115-121` CSP `img-src 'self' data: https: blob:` allows broad https hosts.

**Decision: Vercel Blob is the only sanctioned storage for new uploads. Existing off-platform `photo_url` values are NOT trusted.**

**Upload endpoint shape (NEW):**
- `POST /api/instructor.js?action=upload-photo` — instructor-authenticated, replaces the existing base64-data-URL endpoint.
- `POST /api/admin.js?action=upload-instructor-photo` — admin-authenticated, used from the admin instructor-edit modal to set photos for instructors who haven't uploaded their own.
- Both endpoints accept `multipart/form-data` (NOT base64 in JSON) with a single `photo` field.
- Both endpoints declare a Vercel function-config `maxDuration = 30` seconds, so any decode path that hangs is cleanly killed instead of letting Stripe/Vercel apply the default 60s ceiling (resolves I2 Gap 1 belt-side).
- Server-side validation, in this order:
  1. Authenticate the caller; reject 401 otherwise.
  2. Read first 12 bytes; verify magic number matches one of: JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), WebP (`RIFF....WEBP`). Reject otherwise — do NOT trust the `Content-Type` header.
  3. Byte length ≤ 5MB; reject otherwise.
  4. Construct sharp pipeline with `sharp(buffer, { limitInputPixels: 50_000_000, sequentialRead: true })`. The pixel cap rejects decompression bombs (a 200KB PNG claiming 50000×50000 decodes past the cap → sharp throws `Input image exceeds pixel limit`; caller catches and returns 400 `INVALID_IMAGE_DECODE`). Resolves I2 Gap 1.
  5. Decode dimensions via `pipeline.metadata()`; width ≤ 2000, height ≤ 2000; reject otherwise.
  6. Re-encode to WebP at quality 82 (strips EXIF, normalises orientation, removes any embedded scripts/metadata that bypassed format detection).
  7. Compute `sha256` of the re-encoded buffer (used for the provenance audit row in step 10).
  8. Upload re-encoded buffer to Vercel Blob with `addRandomSuffix: true` and a deterministic prefix `instructor-photos/<schoolId>/<instructorId>/`.
  9. Delete the previous Blob URL if `instructors.photo_url` already pointed at a Blob URL (i.e. the prefix `https://*.public.blob.vercel-storage.com/instructor-photos/...`). Do NOT attempt to delete off-platform URLs.
  10. Set `instructors.photo_url = <new blob url>`, `photo_uploaded_at = NOW()`.
- Audit-log via `api/_audit.js`: action `instructor.photo_uploaded` for instructor-self, `admin.instructor_photo_set` for admin path. **The `details` JSONB MUST include:** `ip` (from `X-Forwarded-For` first hop, validated as an IP), `user_agent`, `original_filename` (sanitised — strip path components, cap at 255 chars), `sha256` of the stored bytes (from step 7), `blob_url` (the URL written to `photo_url`), `bytes_in` (uploaded size), `bytes_out` (re-encoded size). Resolves I2 Gap 2. Queryable later via `audit_logs.details->>'sha256'` if a content-provenance dispute arises.

**`publicly_visible` × `photo_url` CHECK constraint (resolves I2 Gap 3):**

The frontend placeholder-on-non-Blob rule is a last line of defence, not the primary one. The DB enforces that any instructor who is publicly visible either has a Blob-hosted photo or no photo at all (placeholder avatar):

```sql
ALTER TABLE instructors ADD CONSTRAINT chk_publicly_visible_photo_url
  CHECK (
    publicly_visible = FALSE
    OR photo_url IS NULL
    OR photo_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  );
```

What this does and doesn't block:
- ✅ Blocks an admin click that flips `publicly_visible = TRUE` while `photo_url` is still a legacy off-platform URL. The UPDATE raises a constraint violation; admin sees an error and is forced to re-upload through the Vercel Blob pipeline first.
- ✅ Permits `publicly_visible = TRUE` with `photo_url IS NULL` (instructor without a photo renders a placeholder avatar, which is fine — no leaked off-platform content).
- ✅ Permits any `publicly_visible = FALSE` state (test instructors, archived instructors can have whatever `photo_url` value, since they're not on public pages).
- ❌ Does NOT block someone manually pointing `photo_url` at a Vercel Blob URL they don't control. The Blob prefix is the trust boundary; we trust anything served from our Blob bucket. If a future review wants to harden this further, the prefix can include the exact account/store ID (`addRandomSuffix` already provides per-upload entropy).

The constraint ships in the same migration as the `publicly_visible` column. Migration script must run `UPDATE instructors SET publicly_visible = FALSE WHERE photo_url IS NOT NULL AND photo_url NOT LIKE 'https://%.public.blob.vercel-storage.com/%'` immediately before adding the constraint, to ensure existing rows don't violate it on creation. Today this is a no-op (no instructor has `publicly_visible` yet — the column is brand new), but the defensive UPDATE makes the migration idempotent and re-runnable.

**Existing off-platform `photo_url` values — one-time migration (NEW, closes round-4 flaw #5):**

The previous wording "existing off-platform URLs stay valid" is too permissive — a reused Imgur/personal-domain URL can become attacker-controlled content on a public SEO-indexed instructor profile. Migration plan:

1. **Inventory:** before any new instructor profile page goes public (i.e. before any instructor has `publicly_visible = TRUE`), Fraser audits every existing non-NULL `instructors.photo_url`. Today this is 1–2 rows (Fraser, Simon).
2. **Re-upload through the new pipeline:** for each photo Fraser wants to keep, download the source image, re-upload via the new endpoint. The new validation rebuilds the image bytes — anything malicious in the original is dropped.
3. **Block raw off-platform URLs going forward:** admin update endpoint at `api/instructors.js:156-157` and `api/admin.js:801-802` rejects `photo_url` strings unless they start with the Vercel Blob public host prefix. The only way to set a non-Blob URL is via direct SQL (admin-only operational escape hatch).
4. **Public-profile gate:** any instructor with `photo_url` not matching the Blob prefix renders a placeholder avatar on the public profile page until re-uploaded. Internal admin views still show the legacy URL (so Fraser can see what was there) with a "needs re-upload" warning badge.

**Privacy policy update (CLAUDE.md GDPR rule #8 — "new third-party services processing personal data must update `public/privacy.html`"):**

Add Vercel Blob storage to the list of subprocessors. One line: "Instructor profile photos are stored on Vercel Blob (Vercel Inc.) and served via Vercel's CDN. EU/UK region selected via `VERCEL_BLOB_STORE_REGION`."

**Deletion / retention:**

- Instructor self-delete (rare; instructors are business contacts) anonymises rather than deletes, but the photo IS deleted from Blob (Blob is not under retention obligation — only the financial records are, and a photo is not a financial record).
- Admin-archive of an instructor (`active = FALSE`) leaves the photo in place — they may come back.
- Admin replacement of an instructor's photo deletes the previous Blob URL (see upload step 9 above).

**Acceptance criteria:**

- Uploading a 6MB JPEG → 400 with `FILE_TOO_LARGE`.
- Uploading a renamed `.txt` file with `Content-Type: image/jpeg` → 400 with `INVALID_IMAGE_FORMAT` (magic-number check fires).
- Uploading a 3MB PNG → succeeds; resulting Blob URL is WebP; EXIF stripped.
- Uploading a 200KB PNG that claims 50000×50000 dimensions → 400 with `INVALID_IMAGE_DECODE` (sharp `limitInputPixels` fires, decode never completes). I2 Gap 1 acceptance.
- Replacing an existing Blob-hosted photo → previous Blob URL is deleted (verify via `list` on the Blob bucket).
- Setting `photo_url` via admin update endpoint to `https://i.imgur.com/abc.jpg` → 400 with `NON_BLOB_PHOTO_URL`.
- Public profile for an instructor whose `photo_url` doesn't match the Blob prefix → renders placeholder avatar.
- After any successful upload, `audit_logs` has a row with the matching action name and `details` JSONB containing `ip`, `user_agent`, `original_filename`, `sha256`, `blob_url`, `bytes_in`, `bytes_out`. I2 Gap 2 acceptance.
- Attempting `UPDATE instructors SET publicly_visible = TRUE WHERE id = <instructor with legacy off-platform photo_url>` → constraint violation `chk_publicly_visible_photo_url`. Admin UI surfaces this as "Re-upload the photo through the new pipeline before publishing." I2 Gap 3 acceptance.

## Hard-delete semantics

No admin endpoint currently hard-deletes instructors (confirmed against `api/admin.js`). This is good. The plan reinforces:

- **Don't add a hard-delete endpoint.** Use `active = FALSE` (existing) for retirement and `publicly_visible = FALSE` (new) for "active but not surfaced publicly." Hard delete would break referential integrity with bookings, payouts, audit logs.
- **If an instructor must be removed for GDPR reasons** (extremely rare — instructors are business contacts, not data subjects in most cases), the path is anonymisation, not deletion. Define this only when a real request arrives.

## Publicly-visible = FALSE rule

`/instructor/[slug]` for an instructor with `publicly_visible = FALSE`:

- Returns HTTP 404. Not a "Not accepting bookings" page (that would leak the existence of internal/test instructors and create thin pages that Google indexes negatively).
- Excluded from the sitemap (`/sitemap.xml` generated server-side, filters on `publicly_visible = TRUE`).
- The `api/instructors?action=profile&slug=X` endpoint returns 404 for the same instructors.

**Phase 1 simplification** (scope-reduction 2026-05-19 — re-evaluate when an instructor who has been publicly visible for ≥6 months wants to retire AND a quick check of Google Search Console shows their profile page has had organic impressions in the last 90 days. Both conditions must hold — duration alone doesn't matter if nobody searches for them, and impressions alone don't matter for a brand-new profile. At that moment, build `retired_at` / `was_public` / redirect-target metadata for the specific case, not speculatively now). The original wording said "for instructors who WERE public and have been retired, return HTTP 410." Distinguishing "retired-from-public" from "never-public test instructor" requires state the schema doesn't have. Phase 1: every `publicly_visible = FALSE` returns 404 uniformly; sitemap excludes them. Zero current instructors meet the trigger conditions — Fraser, Simon, and Nick are all on launch trajectory, not retirement. This avoids carrying unused columns the credits/franchise principles explicitly warn against ("don't add columns 'for future flexibility' if no active code path reads them").

## Files touched

### New pages

- `public/instructors.html` — the `/instructors` index page
- `public/instructor.html` — the per-instructor template (slug-routed via Vercel rewrites)
- Maybe a new sidebar entry "Find an instructor" linking to `/instructors`

### Modified pages

Coupling-review surfaced that `book.html` is **deeply referenced** across the codebase (`sidebar.js`, `index.html`, `learner/lessons.js`, `manifest.json`, `webhook.js`) — deleting or repurposing it in Phase 1 would cascade into many other places.

- `public/learner/book.html` (NOT `public/book.html` — round-4 path correction) — **KEEP during the soft-transition window.** The instructor profile page (`/instructor/[slug]`) becomes the primary booking surface for new learners and any learner clicking through `/instructors`. The legacy page stays accessible at both `/book/:slug` (rewritten by `vercel.json:35-39`) and `/learner/book.html` for backward-compat — existing learners who deep-link to it (via PWA manifest at `public/manifest.json:40-43`, lesson-page links at `public/learner/lessons.js`, webhook redirect targets in `api/webhook.js`) continue to work. Once the new flow is proven (≥30 days post-launch, with no booking-failure-rate regression), retire in a follow-up that updates all callers. Phase 1 does NOT touch `book.html`'s functionality — `?paid`, `?cancelled`, `?reschedule`, `?instructor=` query handling (see `public/learner/book.js:62-80`) all stay intact.
- `public/learner/buy-credits.html` (NOT `public/buy-credits.html`) — **KEEP during the soft-transition window.** Same rationale. Once Phase 1 is proven and the legacy page is being retired, replace with a 301 to `/instructors`.
- `public/learner/profile.html` — Step 4 of credits plan already covers the balance UI change. This plan adds a "Find another instructor" link.
- Sidebar nav (in `sidebar.js`) — adds "Find an instructor" / "Browse instructors" entry pointing at `/instructors`. The existing "Book a lesson" entry (pointing at `book.html`) stays during the soft-transition window.
- Admin instructor modal — **extends the existing** modal at `public/admin/portal.html:878-947` rather than building a separate screen. Adds fields for `publicly_visible`, `bio_short`, `area_covered`, `pass_rate_sample`, `single_lessons_enabled`, `free_trial_offered`. The save handler at `public/admin/portal.js:300-337` and backend at `api/instructors.js:131-156` extend accordingly. When credits plan Step 8 ships, rate/tier fields land in the same modal.

### New / modified API endpoints

- `api/instructors.js?action=list-public` — returns the index data (one card per publicly-visible instructor). Public, no auth, cached aggressively.
- `api/instructors.js?action=profile&slug=X` — returns one instructor's full profile + opt-in flags. Public, no auth.
- `api/slots.js?action=available` — already exists. Filter by `instructor_id` is already supported.
- `api/credits.js?action=checkout` — already changing in credits plan Step 4 (requires `instructor_id`).

### Schema additions

Reconciled against current `db/migration.sql` after coupling-review #11 surfaced that several columns already exist. **Use existing columns where present** — don't introduce parallel names.

**Already exist** (verify and reuse, don't re-add):
- `instructors.slug TEXT` (currently globally `UNIQUE` — see migration note below)
- `instructors.pass_rate NUMERIC(4,1)` — preferred over the originally-proposed `pass_rate_pct INTEGER`
- `instructors.years_experience INTEGER`
- `instructors.specialisms JSONB` — preferred over the originally-proposed `TEXT[]` (matches the existing convention; queryable via `?` and `@>` operators)
- `instructors.bio TEXT` — covers most of what `bio_long` would have done
- `instructors.photo_url TEXT`

**New columns required:**
- `instructors.publicly_visible BOOLEAN NOT NULL DEFAULT FALSE` — gates appearance on `/instructors`. Defaults FALSE so new instructors are hidden until explicitly toggled on (Fraser-controlled).
- `instructors.bio_short TEXT` — one-line bio for cards. The existing `bio` field stays as the full version.
- `instructors.area_covered TEXT` — comma-separated area names or postcodes.
- `instructors.pass_rate_sample INTEGER` — "X% over last N lessons" credibility denominator. If NULL, the page renders pass-rate as "Experience" instead (see Trust-signal language section).
- `instructors.single_lessons_enabled BOOLEAN NOT NULL DEFAULT FALSE` — new toggle paralleling `bulk_tiers_enabled` from credits plan Step 7.
- `instructors.free_trial_offered BOOLEAN NOT NULL DEFAULT FALSE` — gates whether free-trial CTA appears on the page.

### Migration: school-scope the `slug` unique constraint

The existing `slug` column has a global unique partial index, not a column-level constraint. Round-4 correction (closes flaw #9): the actual object is named `idx_instructors_slug` (see `db/migration.sql:1117`), not `instructors_slug_key`. The original migration text would have left the old unique index in place because `DROP CONSTRAINT IF EXISTS` / `DROP INDEX IF EXISTS instructors_slug_key` both no-op against the real name.

For multi-tenant InstructorBook this is a clash waiting to happen — two schools both having a "fraser" or "simon" is plausible.

```sql
-- Migration: change global slug uniqueness to school-scoped
DROP INDEX IF EXISTS idx_instructors_slug;
CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_school_slug
  ON instructors(school_id, slug)
  WHERE slug IS NOT NULL;
```

The partial-index predicate `WHERE slug IS NOT NULL` is preserved so the unique constraint doesn't fire on legacy rows with NULL slug. Run this migration BEFORE any new school is onboarded. CoachCarter has only `school_id = 1` today, so no data conflict — this is a forward-looking fix.

### Backfill rule for `slug` (revised round 4 — closes flaw #1 "Slug backfill is unsafe")

The original wording `lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))` produces leading/trailing hyphens (`"  Simon  "` → `"-simon-"`), empty slugs for purely non-ASCII names, no collision handling within a school, and no reserved-slug blocklist (a slug of `admin`, `api`, `static`, `learner`, `instructor`, `book`, `buy-credits`, `free-trial`, `contact`, `privacy`, `terms`, `login`, `signup`, `instructors` would conflict with platform routes).

New canonical `slugifyInstructorName(name)` rule (lives in `api/_tenant.js` or a new `api/_slug.js`; one function, used by both the backfill and the admin create/edit handler):

```js
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'static', 'learner', 'instructor', 'instructors',
  'book', 'buy-credits', 'free-trial', 'contact', 'privacy', 'terms',
  'login', 'signup', 'forgot-password', 'logout', 'sitemap', 'robots',
  'manifest', 'favicon', 'index', 'app', 'pwa', 'cron', 'webhook',
  'trial', 'school', 'schools'
]);

function slugifyInstructorName(name) {
  if (!name) return null;
  let s = name
    .normalize('NFKD')                // decompose accented chars
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')      // collapse non-alnum to single hyphen
    .replace(/^-+|-+$/g, '');         // trim leading/trailing hyphens
  if (!s) return null;                 // empty after stripping -> caller picks fallback
  if (RESERVED_SLUGS.has(s)) s = `${s}-instructor`;
  return s.slice(0, 60);              // hard cap
}
```

Backfill SQL must run client-side via a one-shot Node script (Postgres `regexp_replace` alone cannot collapse + trim + reserved-word-check + collision-resolve atomically):

```js
// db/scripts/backfill-instructor-slugs.js
const instructors = await sql`SELECT id, school_id, name FROM instructors WHERE slug IS NULL OR slug = ''`;
for (const row of instructors) {
  let base = slugifyInstructorName(row.name) || `instructor-${row.id}`;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const clash = await sql`
      SELECT 1 FROM instructors WHERE school_id = ${row.school_id} AND slug = ${candidate} AND id <> ${row.id} LIMIT 1
    `;
    if (clash.length === 0) break;
    candidate = `${base}-${suffix++}`;
  }
  await sql`UPDATE instructors SET slug = ${candidate} WHERE id = ${row.id}`;
}
```

Admin create/edit calls `slugifyInstructorName()` then runs the same `(school_id, slug)` collision-resolve loop. Empty-after-strip names fall back to `instructor-<id>`.

---

## Sequencing

| # | Step | Effort | Depends on |
|---|------|--------|-----------|
| 0 | **Tenant-resolution helper** (`api/_tenant.js`, `schools.primary_host`, `school_hosts` table). Hard prerequisite for any new public endpoint. | 3–4h | Migration via /api/migrate |
| 1 | Schema additions (publicly_visible, bio_short, area_covered, pass_rate_sample, single_lessons_enabled, free_trial_offered, photo_uploaded_at) + slug index rebuild as `(school_id, slug)` partial unique | 2–3h | Step 0 |
| 2 | Backfill slug (via `db/scripts/backfill-instructor-slugs.js`) + trust-signal fields for Fraser and Simon | 1h | Step 1 |
| 2a | Vercel Blob photo pipeline (upload endpoint + admin endpoint + re-upload audit of Fraser/Simon existing photos) | 4–6h | Step 1, privacy.html update |
| 3 | `api/instructors.js?action=list-public` and `?action=profile` endpoints | 3–4h | Step 1 |
| 4 | `/instructors` index page (HTML/CSS/JS, SEO, mobile-first) | 6–8h | Step 3 |
| 5 | `/instructor/[slug]` profile page (header + purchase sections + slot picker + cross-instructor notice) | 8–10h | Step 3 + credits plan Step 4 |
| 6 | Admin UI for trust-signal fields + new toggles on instructor edit form | 3–4h | Step 1 |
| 7 | Checkout integration (buttons pass instructor_id; checkout works for bulk + single-lesson) | 3–4h | Credits plan Step 4 |
| 8 | Cross-instructor notice logic | 2h | Step 5 + credits plan Step 4 |
| 9 | Soft-transition redirects (NOT retirement): `public/learner/book.html` and `public/learner/buy-credits.html` 302-redirect to `/instructor/fraser` for 30 days, then 301 to `/instructors`. Files stay on disk; deletion is a follow-up plan. Also: update `public/manifest.json:40-43` PWA shortcut to `/instructor/fraser`, and update webhook redirect targets in `api/webhook.js` to point at the new surface. | 3h | All pages live, ≥30 clean days of metrics |
| 10 | SEO meta, sitemap, structured data | 2–3h | Steps 4 + 5 |
| 11 | Mobile-first responsive pass on all new pages | 4–6h | Steps 4 + 5 |
| 12 | Update sidebar nav to include "Find an instructor" | 1h | Step 4 |

**Total: ~44–58h** after round-4 additions (tenant-resolution Step 0 + photo pipeline Step 2a). Same magnitude as the credits plan itself. Most of the cost is in the new pages (Steps 4 + 5) and the responsive pass.

### Cross-plan rollout order (NEW in round 4)

Both plans now describe the same API shapes, schema columns, and rollout order. The full sequence across both plans:

| Wave | Source | Step | Reason |
|------|--------|------|--------|
| W1 | Credits | 0 — webhook transactional refactor + `grantCredits()` + resumability SQL | Closes existing partial-success bug; no schema additions yet. |
| W1 | Credits | 0.5, 1a — `list_price_pence` + `list_price_source` schema | Schema-only, no behaviour change. |
| W2 | Credits | 3 — `getEffectiveRatePencePerMinute` (auth) + `getPublicInstructorRatePencePerMinute` (public) | Pricing fallback live before snapshots. |
| W2 | Credits | 1b, 1c — Writer code + backfill | Snapshots use Step 3 helper from day one. |
| W2 | Credits | 2 — Per-instructor balance schema | Gated on Step 1c backfill marker. |
| W3.a | Learner-UX | 0 — Tenant-resolution helper (`api/_tenant.js`, `schools.primary_host`, `schools` trigger) | **Ships alone, in its own PR, as its own prod deploy.** Smoke-test before opening W3.b: a GET to any existing endpoint still returns the same data (no regression in the legacy `parseInt(... ) \|\| 1` paths); any new endpoint that imports `_tenant.js` returns 404 when called from an unmapped host. Only after this is live and verified in prod does W3.b open. |
| W3.b | Credits | 4 — Phase 2A reads/writes switch + `api/credits?action=public-rate` endpoint (with cache+rate-limit per round-4 update) | Calls `resolveSchoolFromRequest()` from W3.a. Smoke-test: a GET to `/api/credits?action=public-rate&instructor_id=1&purchase_kind=bulk` from the production host returns 200 with the expected rate JSON; the same call from a non-mapped host returns 404; the `Cache-Control` header sets `s-maxage=300`. |
| W3.c | Credits | 5, 5.5 — FIFO + admin grant endpoints | Closes "scoped, attributed, atomic." Can ship in the same PR as W3.b or as a follow-up; no further ordering constraint. |
| W4 | Learner-UX | 1–2a — Schema, slug backfill, Vercel Blob pipeline | Foundations for public pages. |
| W4 | Learner-UX | 3 — `?action=list-public` + `?action=profile` endpoints | Both endpoints call `resolveSchoolFromRequest()`. |
| W5 | Learner-UX | 4–6 — `/instructors`, `/instructor/[slug]`, admin UI | Public surfaces live. |
| W5 | Learner-UX | 7 — Checkout button integration | Uses credits Step 4 `?action=checkout` with `instructor_id`. |
| W6 | Learner-UX | 8, 10, 11, 12 — Cross-instructor notice, SEO/sitemap, responsive pass, sidebar nav | Polish. |
| W7 | Learner-UX | 9 — Soft-transition redirects on legacy pages | ≥30 clean days post-launch. |
| W8 | Credits | 7, 8 — `bulk_tiers_enabled` UI, admin pricing UI | Deferred per existing plan; admin UI lands in the shared instructor-edit modal (coupling point #9). |

**Critical ordering invariant:** Learner-UX Step 0 (Wave W3.a) MUST be deployed to prod AND smoke-tested before the W3.b PR is opened. "Same wave" is not "same PR" — these are two distinct prod deploys with a verification gate between them. Reasoning: if the public-rate endpoint and the helper land in one batch and the import resolution races (or the helper file fails to deploy for any reason), the endpoint exists but the helper doesn't, producing either a runtime crash or a silent fall-through to `school_id = 1`. Splitting also gives a clean roll-back: if W3.b misbehaves, revert it without touching W3.a (which is now load-bearing for other code paths). Both plans now reflect this dependency.

---

## Coupling points with `PER-INSTRUCTOR-CREDITS-PLAN.md`

This section is the focus of the next review pass. Every coupling point listed here is something where a decision in one plan constrains the other plan. Both plans need to agree on each point before either ships.

### Hard couplings (cannot ship Plan B without Plan A's decision)

1. **`api/credits.js?action=checkout` requires `instructor_id`.** Credits plan Step 4 makes this required. Learner-UX plan's buttons pass it. **Decision shared:** both plans must agree on the exact request shape and validation rules.

2. **`getEffectiveRatePencePerMinute` returns per-instructor rates.** Credits plan Step 3 builds the helper. Learner-UX uses it on the instructor page to display bundle and single-lesson prices. **Decision shared:** when the helper is called from a public (unauthenticated) endpoint with no `learner_id`, what's the fallback behaviour? The plan's three-level fallback assumes `learner_id` — we need a clean public-rate path.

3. **`learner_credit_balances` is the source of truth for "do I have credits with this instructor."** Credits plan Step 2 schema. Learner-UX queries this to render the cross-instructor notice. **Decision shared:** the public profile page can't query LCB without authentication; only the logged-in version of the page surfaces the notice.

4. **`booking_credit_sources.absorbed_by` propagates from `credit_transactions`.** Credits plan Step 5.5. Learner-UX doesn't directly touch absorption but a goodwill-funded booking should NOT appear in the learner's "buy more like this" suggestions (because no money changed hands). **Decision (resolved 2026-05-19):** the instructor page shows a simple "You've taken N lessons with [name]" count and nothing else. All attended lessons count, including free trials and goodwill. No funding-source distinction in Phase 1. See "Lesson history on the instructor page" above.

### Soft couplings (one plan's decision should inform the other's)

5. **The "single lesson" path needs a `credit_transactions` row per purchase.** This is implied by credits plan Step 2 (`booking_credit_sources.credit_transaction_id` is NOT NULL) but not explicitly traced through. Buying a single 60-min lesson via the instructor page creates a `credit_transactions` row with `minutes = 60`, `source = 'stripe'`, `instructor_id` set. The Stripe Checkout success drains the credit immediately into a booking. **Decision shared:** does the single-lesson Stripe Checkout flow look any different from the bulk-pack Stripe Checkout flow internally? My instinct: no, they're the same code path with different `minutes` values.

6. **Free trials still create a zero-value `credit_transactions` row** (credits plan Step 1b free-trial wiring). Learner-UX shows a free-trial CTA on instructor pages where enabled. **Decision shared:** the CTA links to the existing `/free-trial.html?instructor_id=X&date=Y` page — does that page also need a redesign or does the existing page stay as the trial-funnel landing?

7. **Cutover sequencing.** Credits plan reaches "scoped, attributed, atomic" at Step 5. Learner-UX needs that to be true before its checkout buttons can route correctly. **Decision shared:** is there a window where credits-data is live but learner-UX isn't, during which Fraser-only existing learners continue using the legacy URLs (now redirecting to `/instructor/fraser`)? My instinct: yes, that's the soft transition window.

8. **GDPR data export.** Credits plan Step 2 updates `handleExportData()` to include scoped balances + adjustments + sources. Learner-UX adds new `instructors` columns (slug, bio, etc) that are NOT learner data and shouldn't be in the export. **Decision shared:** confirm no learner PII enters the new `instructors` columns; if it does (e.g. a reviews field referencing learner names), GDPR cascade needs updating.

9. **Admin UI consolidated into one modal with sections** (decided 2026-05-19). The existing instructor-edit modal at `public/admin/portal.html:878-947` is extended in learner-UX Step 6 with three sections:
   - **Profile** — name, bio, bio_short, photo_url (Vercel Blob upload), area_covered, specialisms, pass_rate, pass_rate_sample, years_experience.
   - **Visibility** — `active`, `publicly_visible`, `single_lessons_enabled`, `free_trial_offered`, `bulk_tiers_enabled` (from credits Step 7).
   - **Pricing** — `hourly_rate_pence` and bulk-tier overrides. This section is added when credits-plan Step 8 ships; until then the section is absent (not greyed-out).

   Step 6 (this plan) builds the Profile + Visibility sections and the modal scaffolding. Credits Step 8 just inserts the Pricing section into the same modal — no separate screen. The save-handler at `public/admin/portal.js:300-337` and backend at `api/instructors.js:131-156` accept all fields with section-aware validation.

10. **`instructors.single_lessons_enabled` is a new commercial toggle that the credits plan doesn't anticipate.** It interacts with the credits-data layer because turning it OFF means no single-lesson `credit_transactions` rows can be created for that instructor. **Decision shared:** the credits plan's API should not reject a single-lesson checkout outright when the toggle is FALSE — the learner-UX layer should hide the option upstream. Defence-in-depth: the checkout endpoint *also* validates the toggle, but doesn't shape its primary behaviour around it.

### Schema couplings

11. **Both plans add columns to `instructors` table.** Round-4 correction: the stale `bio_long`/`pass_rate_pct`/`years_experience`/`specialisms` mentions are removed — those columns already exist on `main` (`db/migration.sql:487-489`) and the Schema additions section now correctly reuses them. The actual net-new column list per plan is:
   - **Credits plan:** `hourly_rate_pence` (Step 3), `bulk_tiers_enabled` (Step 7).
   - **Learner-UX plan:** `slug` already exists (but global unique index is replaced with `(school_id, slug)`), `publicly_visible`, `bio_short`, `area_covered`, `pass_rate_sample`, `single_lessons_enabled`, `free_trial_offered`, `photo_uploaded_at` (added by the Vercel Blob section above).

   **Decision shared:** two separate migrations, not one. Credits plan Steps 0–5 ship first (sequencing is fixed); their migration adds `hourly_rate_pence` and `bulk_tiers_enabled` at Steps 3 and 7. Learner-UX plan's migration then adds the rest. Consolidating into one migration would invert the sequencing discipline — implementers would have to wait on learner-UX work to land before credits Step 3 can ship. Separate migrations keep the discipline.

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

## Decisions made during coupling-impact review (2026-05-19 evening)

All four open questions resolved:

1. **`book.html` stays during soft transition.** Deeply referenced across sidebar.js, index.html, learner/lessons.js, manifest.json, webhook.js. Retire only after ≥30 days of proven new flow. Documented in "Modified pages" section.
2. **Empty slot picker → "Browse other instructors" CTA**, not inline mixed feed. Keeps the instructor-first model honest. Existing `book.html` overflow routing stays intact during transition.
3. **No "Verified" badge.** Pass rate renders only when both `pass_rate` and `pass_rate_sample` are populated, with the sample size shown. Otherwise falls back to "Experience" + "Specialisms" only. Trust-signal language section codifies this.
4. **`publicly_visible = FALSE` → HTTP 404**, excluded from sitemap. Retired instructors return 410 GONE optionally. Documented in "Publicly-visible = FALSE rule" section.

Net-new fixes that came out of coupling review:

- **Multi-tenant school resolution** added as a hard rule. All public surfaces resolve `school_id` from host/branding/explicit slug, never silently default to 1.
- **Bio XSS policy** codified — `textContent` only, no `innerHTML`, server-side validation.
- **Image hosting decision** made — Vercel Blob with allowlist of formats and size limits.
- **Hard-delete semantics** explicitly disallowed — use `active = FALSE` or `publicly_visible = FALSE`.
- **Slug uniqueness** changed from global to `(school_id, slug)` composite. Migration before InstructorBook tenant onboarding.
- **Schema reconciled** against existing columns: `slug`, `pass_rate`, `years_experience`, `specialisms` (JSONB), `bio`, `photo_url` already exist — reuse, don't duplicate.

Coupling-resolution touchpoints with `PER-INSTRUCTOR-CREDITS-PLAN.md` (changes applied to that plan in the same session):

- Credits plan locked the checkout request shape (`instructor_id`, `hours`/`duration_minutes`, `purchase_kind`, explicit error codes).
- Credits plan added `getPublicInstructorRatePencePerMinute` distinct from the authenticated helper.
- Credits plan documented Path A (account required at bundle CTA) for guest checkout.
- Credits plan added server-side `single_lessons_enabled` enforcement in both `api/credits.js` and `api/slots.js`.

## Outstanding before either plan starts implementation

1. **PII leak fix in `api/instructors?action=list`** — spawned as a separate task during the coupling review. Must be merged before either plan ships because both plans expand the API surface that's leaking.
2. **GPT-5.5 round-1 review of this plan** + round-4 review of the credits plan, both against this revised pair.
3. **Lesson-history `funding_kind` work** is documented for Phase 2 — Phase 1 doesn't render history on the instructor page.

## Things still left to decide (lower priority, can resolve at coding time)

- The exact bulk-tier definitions per school (5h/10h/20h or other). Currently in `schools.config.pricing.bulk_discount_tiers`. Confirm CoachCarter's current values are appropriate for the new card UI.
- Exact card grid layout for `/instructors` — design decision, not architectural. Cards are the unit; the grid responds to viewport.
- The free-trial CTA wording on instructor pages.

---

## How this maps to existing plans

- `PER-INSTRUCTOR-CREDITS-PLAN.md` — data + API + admin layer. Ships first.
- This plan — learner UX layer. Ships second.
- `FRANCHISE-MODEL-PLAN.md` — the umbrella plan for franchise expansion. This plan is the consumer-facing implementation of the franchise model. Phase 2C (admin UI) of the franchise plan is partially absorbed into Step 6 of this plan.
- `INSTRUCTOR-EXPERIENCE-PLAN.md` — the non-software companion. This plan implements the consumer side of the cold-start lead allocation problem.
