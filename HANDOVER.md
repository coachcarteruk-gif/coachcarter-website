# Session handover — `redesign/learner-hub`

**Date:** 2026-04-27
**Branch:** `redesign/learner-hub` (PR #107)
**Status:** Pushed to origin, deployed to Vercel preview, **NOT merged to main**
**Working tree:** Clean. No uncommitted changes.

---

## What this branch already shipped

Nine commits, in order:

1. **`a2607ab`** — Initial phase 1–3 shell refresh & dashboard overhaul
2. **`c864586`** — Extend desktop margin fix to `.page` containers, boost secondary page titles
3. **`506bec9`** — Marketing shortcut bar larger on desktop, learner-journey nav border consistency
4. **`dc156c1`** — Hub bottom bar "Home" → "Dashboard", added "Back to website" link
5. **`9c54b19`** — Extracted shared brand tokens (`/shared/brand-tokens.css`), fixed marketing dark-mode bleed
6. **`b5787c2`** — Arrival toast: one-time "Welcome back, [name]" post-login
7. **`b488a97`** — `sidebar.js` skips public/marketing pages entirely (was hiding their own nav)
8. **`97c3576`** — Removed all Videos / classroom references from marketing surface; 302 redirect `/classroom.html` → `/`
9. **`8674669`** — Sidebar Login button goes to `/learner/login.html` not `/`

**What's now true on the branch:**

- Single source of truth for design tokens at `/shared/brand-tokens.css` — colours, type, radius. Both marketing and hub import it.
- Dark mode is **scoped to the hub only** (`body.cc-has-sidebar`). Marketing pages stay light regardless of system preference.
- `learner.css` no longer has its own `:root` — only layout/component CSS.
- Hub pages: bigger Bricolage greeting with first name, credit-balance badge, action strip (Book/Practice/Learn), arrival toast on login.
- `lessons-hub.html` and `learn.html` are redirect stubs — sidebar groups now navigate directly to `book.html` / `ask-examiner.html`.
- Marketing site Videos references all removed (top nav, footer, mobile tab bar, pricing bullets, hero trust strip, feature card grid, final CTA, About paragraph, meta description, testimonial). `/classroom.html` 302s to `/`. Source files preserved for future relaunch.
- `sidebar.js` no longer runs on public/marketing pages.

**Pages still with their own `:root` blocks (intentionally out of scope):**
`admin/*`, `superadmin/*`, `free-trial.html`, `free-trial-success.html`, `terms.html`, `privacy.html`, `availability.html`, `instructor.css`, `shared-auth.css`. Migrate when those areas are next touched.

---

## The unresolved question

Late in the session Fraser asked for "the hub to look more like the marketing site." After back-and-forth, the conversation arrived at a 4-step plan to (a) unify the shell across marketing + hub, (b) make all pages browseable by visitors with preview states, (c) replace sidebar with combined top-bar + sidebar + bottom-bar chrome, (d) action-gate authentication.

**A `/scientific-critical-thinking` review of that plan flagged it as compromised.** Key findings:

1. The plan reversed the council's "don't converge layouts" recommendation without new evidence — driven by accommodation across multiple turns, not analysis.
2. Step 3 (per-page preview states) was estimated at 30–60 min/page; realistic estimate is half a day per page minimum (~5-day project for 10 pages).
3. The plan bundled three independent decisions (shell unification, visitor-browseability, sidebar replacement) as one. They should be evaluated separately.
4. The "schools just change colours and photos" assumption is unfalsified — based on a sample size of one (Fraser).
5. The Calendly/Booking.com analogy supports browseable booking flows specifically, not "all pages browseable."

**The recommendation that emerged:** ship Phase 1 only — unify the chrome (top bar + bottom bar consistent across all pages). Don't commit to visitor-browseability or sidebar replacement until there's real evidence (school #2 onboarding, A/B data).

**Phase 1 was NOT started.** The branch is at the state described above.

---

## What the next session should do

**The user needs to decide before any new code:**

1. **Do Phase 1 only** (unify chrome — half a day) — recommended.
2. **Do nothing more on this branch** — merge what's there to main, defer further work until InstructorBook traction creates real evidence.
3. **Commit to the full 4-step plan despite the critical-thinking pushback** — biggest scope, ~5-day project, architectural commitment.

If the user confirms option 1, the implementation plan is:

### Phase 1 — Unify the chrome (half-day)

**Goal:** Every page (marketing + hub, logged-in and logged-out) has the same top bar and same mobile bottom bar. Page contents stay specialised. The sidebar continues to exist on hub pages only.

**Concrete steps:**

1. **Rewrite `sidebar.js` (or fork as `shell.js`) to handle all pages, not just hub pages.**
   - Always inject a top bar (logo + brand + account/login button)
   - Always inject a mobile bottom bar (4–5 primary destinations)
   - On hub pages, additionally inject the desktop sidebar (240px left rail) and a mobile drawer
   - Logged-out top bar: Home / Pricing / Book / Login
   - Logged-in top bar: same + a Dashboard link
   - Logged-out mobile bottom bar: Home / Pricing / Book / Login
   - Logged-in mobile bottom bar: Dashboard / Lessons / Practice / Learn / Profile

2. **Strip the per-page navs from marketing HTML files.**
   - `index.html`, `lessons.html`, `learner-journey.html`, `success.html`, `instructor/login.html` all currently embed their own `.site-nav` and `.mobile-tab-bar`. Remove those entirely; let the unified shell render them.
   - Remove the corresponding per-page CSS for `.site-nav`, `.mobile-tab-bar` from those files' `<style>` blocks.

3. **Reconcile the `cc-has-sidebar` body class.**
   - Currently used to hide page-native navs and apply hub layout adjustments.
   - With unified shell, rename (or split) into `cc-has-shell` (always on) and `cc-has-sidebar` (only on hub pages where the desktop left rail is shown).

4. **Verify on each page:**
   - Marketing homepage, pricing, lessons, success → top bar + bottom bar, NO sidebar
   - Learner pages logged in → top bar + sidebar + bottom bar (mobile)
   - Learner pages logged out → top bar + bottom bar, sidebar shows minimal "log in to access" state

5. **Sidebar content (when shown) — flatten the accordions.**
   - Fraser confirmed flattening (no accordions). Lessons / Practice / Learn show all sub-items as visible siblings, not collapsed.
   - Reference: `navItems.learner` and `navItems.instructor` in current `sidebar.js`.

6. **Don't touch page contents.** No preview states. No new pages. No content rewrites. Just chrome.

### Files that will change in Phase 1

- `public/sidebar.js` (or new `public/shared/shell.js`) — major rewrite
- `public/index.html` — strip embedded `.site-nav` and `.mobile-tab-bar` (HTML and CSS)
- `public/lessons.html` — same
- `public/learner-journey.html` — same
- `public/success.html` — same
- `public/instructor/login.html` — same
- `public/shared/learner.css` — review whether `body.cc-has-sidebar` rules need to split into `body.cc-has-shell` / `body.cc-has-sidebar`

### Phase 1 risks to flag to Fraser

- The per-page navs each have minor variations (active states, "Free Trial" CTAs, etc.). The unified shell needs to absorb those variations or accept some loss of nuance.
- Mobile bottom bar showing on a marketing page may compete with cookie consent banner / shortcut bar at the top. Test before merging.
- The current `auth-gate.js` modal flow assumes the page is reachable while logged-out. That model is preserved; no change needed.

---

## What NOT to do without further conversation

These were considered and explicitly deferred:

- **Don't build visitor preview states for hub pages.** Premature. ~5-day project. Wait for evidence (school #2 onboarding, conversion data).
- **Don't replace the sidebar with combined top+sidebar+bottom chrome on the entire site.** That was the 4-step plan that failed the critical-thinking review.
- **Don't migrate `:root` blocks in admin/superadmin/instructor/free-trial/terms/privacy/availability files.** Out of scope. Migrate as those areas are next touched.
- **Don't rename `learner-journey.html`** — it's a confusing filename for a marketing pricing page, but renaming requires redirect chains and SEO consideration. Not in scope.
- **Don't add custom-domain support for InstructorBook.** Confirmed earlier in the session: subdomains first.
- **Don't redesign hub pages to look like marketing pages.** The architectural reasoning behind keeping them visually distinct (per the council deliberation) still stands; it's only the *chrome* that should unify, not the page contents.

---

## Important context the next session should know

### Architecture decisions (do not undo)

- **Marketing site and learner hub deliberately use different page layouts.** Same brand tokens, different layouts. This is an InstructorBook architectural decision: schools customise via tokens, not layouts.
- **Dark mode is hub-only.** Marketing pages are light always. Don't move the dark-mode block back into `brand-tokens.css`.
- **`brand-tokens.css` is the single source of truth for colours/type/radius** for the 5 user-facing pages currently migrated. Don't add per-page `:root` overrides.

### Recently removed (do not re-add)

- Videos / `/classroom.html` from marketing nav. Source files preserved; redirect in `vercel.json`. Future feature.
- `lessons-hub.html` and `learn.html` as standalone pages. They're redirect stubs.
- "Home" label on the learner hub bottom bar (renamed to "Dashboard").
- Sidebar.js running on public/marketing pages.

### Known mojibake risk

A previous PowerShell write introduced UTF-8 mojibake in `learner/index.html` and `learner/progress.html` (calendar, bar-chart, pencil, car, brain emojis). This was fixed in commit `b5787c2`. **If using PowerShell to bulk-edit HTML files in future, use `[System.IO.File]::ReadAllBytes` / `WriteAllBytes` rather than `Get-Content` / `Set-Content`** to avoid encoding round-trips. Or use `perl -i` if available.

### Preview server caching

The static-server preview (`mcp__Claude_Preview__preview_start`) caches CSS aggressively. If a token change doesn't appear to apply, hard-bust the CSS link via `link.href = link.href.split('?')[0] + '?v=' + Date.now()`. Code on disk is usually right; the browser is wrong.

### `.env.local` is production data

Real bookings, real learners, real Stripe Connect, real Resend/Twilio. Anything that triggers an email or SMS will fire for real.

---

## How to start the next session

```
git checkout redesign/learner-hub
git pull origin redesign/learner-hub
cat HANDOVER.md
```

Then ask Fraser: **"Phase 1 only, do nothing more on this branch and merge, or commit to the full 4-step plan?"** Do not start coding until he picks one.

If Phase 1: follow the implementation plan above.
If merge-and-defer: ensure PR #107 description is up to date, then merge.
If full plan: re-read the critical-thinking review section above and push back on Fraser before starting.
