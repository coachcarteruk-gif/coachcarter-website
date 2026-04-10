# Launch Readiness Audit Report

**Project:** CoachCarter / InstructorBook Platform
**Date:** 2026-04-10
**Audit mode:** Quick Scan (code-level only)
**Commit audited:** `0d279b2` (main)
**Supersedes:** previous report dated 2026-04-07 (stale after commits `079959b`, `6f2f51a`, `5dca538`)
**Overall Score:** 76% (±4%) — **Launch with Known Issues** (conditionally blocked — see below)

---

## LAUNCH BLOCKED (conditionally)

**1 potential launch blocker remains** (down from 4 in the previous audit). Whether this blocks launch depends on scope:

- **For CoachCarter-only launch (school #1 only):** NOT blocked. Proceed with the WARN/fix list below.
- **For InstructorBook multi-tenant launch (multiple schools live):** BLOCKED until LB-7 is resolved.

| Blocker | Finding | Location | Status vs 2026-04-07 |
|---------|---------|----------|----------------------|
| LB-7 | `availability_submissions` table has no `school_id` column; admin GET returns all schools' submissions | `api/availability.js:19-31`, `db/migration.sql:385-395` | NEW — prior audit listed as WARN; re-classified because admin-role endpoint exposes cross-tenant data |

### LB-7 blockers that were fixed since 2026-04-07 ✅

| Previous blocker | File | Verified state at commit 0d279b2 |
|------------------|------|----------------------------------|
| Instructor list returns ALL schools' instructors | `api/instructors.js` | **FIXED** — `handleList` line 44 includes `AND school_id = ${schoolId}`. Create/update/set-availability all use `requireAuth` + `getSchoolId`. |
| Waitlist has zero school_id filtering | `api/waitlist.js` | **MOSTLY FIXED** — 10 `school_id` references across join/mywaitlist/cancel-helper. `handleLeave` has a residual WARN (see below). |
| Reminder cron processes all schools | `api/reminders.js` | **PARTIAL** — downgraded from FAIL to WARN (see §Data Isolation warnings). |
| QA digest sends cross-school questions | `api/qa-digest.js` | **FIXED** — lines 36-42 explicitly group by `school_id`, line 52 filters instructor fetch per-school. |
| Cookie consent INSERT missing school_id | `api/config.js:47` | **FIXED** — INSERT now includes `school_id`. |

---

## ⚠ HIGH-STAKES LAUNCH: Manual Verification Required

Your app handles payments and personal data. This audit checks configuration patterns, not runtime security. Before going live, you MUST also:

1. □ Test the complete payment flow end-to-end (add to cart → pay → confirm) in Stripe test mode
2. □ Have a security-literate person review authentication and authorization logic
3. □ Have a lawyer or DPO review your privacy policy against ICO/GDPR requirements
4. □ Test account creation, login, and password reset flows manually
5. □ Verify Stripe webhook handling with Stripe's test mode

Skipping these steps exposes you to: failed payments, data breach liability, regulatory fines (up to 4% of turnover under GDPR), and loss of user trust.

---

## Top 5 Critical Fixes

1. **[low effort · FAIL · LB-7]** Add `school_id` column to `availability_submissions` table; add `WHERE school_id = ${schoolId}` to the admin GET in `api/availability.js:19-31`; populate `school_id` from `?school_id=` or subdomain on the POST (or default to 1 for CoachCarter-only launch). — `api/availability.js`, `db/migration.sql:385`
2. **[low effort · FAIL]** Add `reportError()` calls to the catch blocks in `api/address-lookup.js` and `api/status.js` — these are the only two API files still missing error alerting. — `api/address-lookup.js`, `api/status.js`
3. **[low effort · WARN]** Add explicit `AND school_id = ${schoolId}` to the nested bookings query in `api/reminders.js:240-259` (`handleDailySchedule`) and convert the join-based fences on lines 114-116 and 443-445 to explicit top-level `WHERE` clauses to match convention. — `api/reminders.js`
4. **[low effort · WARN]** Add `school_id` verification to `api/waitlist.js:222` (`handleLeave`) — currently verifies only `learner_id`, allowing an ID-guess from a cross-school actor to cancel a waitlist entry. — `api/waitlist.js:222`
5. **[low effort · WARN]** Add `school_id` filters to `api/calendar.js:71` (`handleDownload`) and `api/calendar.js:228` (`handleInstructorFeed`) for defence-in-depth. — `api/calendar.js`

---

## Score Summary

**Configuration Readiness:** 76% (±4%) (based on 82 static checks)
**Runtime Readiness:** NOT TESTED (run full audit to assess)
**Confidence breakdown:** 0 verified-behavior · 66 verified-pattern · 16 verified-file

> Note: This score is near the 75% threshold boundary. The ±4% variance means the difference may not be meaningful — focus on the specific findings rather than the number. The launch-blocker circuit-breaker is the reliable go/no-go signal.

> Most checks verified code patterns, not runtime behavior. For a payments + PII launch, runtime testing is essential — see the High-Stakes Launch block above.

| Category | Score | Weight | FAILs | WARNs | PASSes | N/A | Δ vs 2026-04-07 |
|----------|-------|--------|-------|-------|--------|-----|-----------------|
| Security | 85% | 18% | 0 | 4 | 9 | 0 | — |
| Accessibility | 42% | 12% | 4 | 3 | 3 | 0 | +7% (lang fixed) |
| GDPR/Privacy | 92% | 12% | 0 | 1 | 9 | 0 | +2% (config.js) |
| Data Isolation | 63% | 11% | 1 | 5 | 5 | 0 | +20% (4 LB-7 fixed) |
| Performance | 75% | 10% | 0 | 2 | 2 | 0 | — |
| Infrastructure | 88% | 9% | 0 | 2 | 6 | 0 | −5% (2 missing reportError) |
| SEO | 75% | 7% | 0 | 5 | 5 | 0 | +15% (sitemap/robots/404/lang) |
| Responsive Design | N/A | 7% | — | — | — | All | — |
| Broken Links | 83% | 5% | 0 | 1 | 2 | 0 | — |
| Code Quality | 90% | 5% | 0 | 1 | 4 | 0 | — |
| UX Consistency | N/A | 4% | — | — | — | All | — |

---

<details>
<summary>

## All Critical Findings (5 FAILs)

</summary>

### [FAIL · pattern] Data Isolation — availability_submissions table has no school_id (LB-7 candidate)
- **What:** The `availability_submissions` table schema (`db/migration.sql:385-395`) does not include a `school_id` column. The admin GET in `api/availability.js:19-31` does `SELECT * FROM availability_submissions` with no tenant filter. An admin authenticated against school B can list every school's submissions.
- **Where:** `api/availability.js:19-31`, `db/migration.sql:385-395`
- **Why it matters:** Cross-tenant lead data exposure. For CoachCarter-only operation this is shared platform data and arguably fine; for any InstructorBook school going live, this is a launch blocker and violates the CLAUDE.md rule "Every new tenant-scoped table MUST have school_id INTEGER NOT NULL".
- **Fix:** Add `ALTER TABLE availability_submissions ADD COLUMN school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id);` to `db/migration.sql`. Add `requireAuth` + `getSchoolId` to the GET branch in `api/availability.js` and append `AND school_id = ${schoolId}` to both `query` and `countQuery`. Populate `school_id` on the POST branch from `req.query.school_id` or a subdomain lookup.

### [FAIL · pattern] Accessibility — Interactive divs without button semantics
- **What:** Availability grid uses divs with click handlers but no `role="button"`, `aria-label`, or keyboard support.
- **Where:** `public/availability.html:649-654`
- **Fix:** Use `<button>` elements or add `role="button"`, `aria-label`, `tabindex="0"`, and keydown handling for Enter/Space.

### [FAIL · pattern] Accessibility — Form input missing label
- **What:** `<textarea id="notes">` has no associated `<label>`.
- **Where:** `public/availability.html:566`
- **Fix:** Add `<label for="notes">Additional notes</label>` immediately before the textarea.

### [FAIL · pattern] Accessibility — outline:none without focus replacement
- **What:** CSS removes `outline` without a visible focus alternative. Prevents keyboard users from seeing which element is focused.
- **Where:** `public/shared-auth.css:214,443,514`, `public/accept-offer.html:89`, ~18 other files
- **Fix:** Replace `outline: none` with `outline: 2px solid var(--brand-primary); outline-offset: 2px;` or equivalent box-shadow on `:focus-visible`.

### [FAIL · pattern] Accessibility — Form labels missing on some inputs
- **What:** Some form inputs depend on placeholder text only.
- **Where:** `public/availability.html`, `public/instructor/onboarding.html`
- **Fix:** Add `<label>` or `aria-label` to every input.

</details>

---

<details>
<summary>

## Warnings (24 WARNs)

</summary>

### Data Isolation

- **[WARN · pattern]** `api/instructors.js:66-72` — `handleAvailability` query lacks explicit `school_id` filter. Scoped by `instructor_id` which is globally unique, so no data leak, but violates convention.
- **[WARN · pattern]** `api/waitlist.js:222` — `handleLeave` UPDATE checks only `learner_id`, not `school_id`. ID-guess attack would allow cross-school cancellation.
- **[WARN · pattern]** `api/reminders.js:114-116, 443-445` — Uses join-based tenant fencing (`lu.school_id = lb.school_id`) instead of explicit top-level `WHERE school_id`. Structurally equivalent but violates CLAUDE.md convention.
- **[WARN · pattern]** `api/reminders.js:240-259` — `handleDailySchedule` inner bookings query lacks `school_id` filter. Scoped by `inst.id` which is globally unique, so no data leak, but the loop body should still carry the tenant context.
- **[WARN · pattern]** `api/calendar.js:71,228` — `handleDownload` and `handleInstructorFeed` filter by `learner_id` / `instructor_id` only. Defence-in-depth would add `school_id`.
- **[WARN · pattern]** `api/_shared.js:36-56` — `buildLearnerContext` relies on caller enforcement rather than query-level `school_id`. No SQL leak in practice because the caller always passes authenticated `user.id`, but violates the "every query" rule.

### Security (unchanged from prior audit)

- **[WARN · pattern]** CSP in report-only mode — `middleware.js:79`. Switch to enforcing once violations reviewed.
- **[WARN · pattern]** `innerHTML` used with server data — 80+ occurrences across `public/` files. Audit for XSS.
- **[WARN · pattern]** Raw `err.message` sent to clients — 30+ occurrences. Replace with generic messages.
- **[WARN · pattern]** Residual per-file CORS stubs — `api/availability.js`, `api/create-checkout-session.js`. Remove dead CORS code.

### GDPR

- **[WARN · pattern]** Enquiries missing `school_id` scoping — `api/enquiries.js`. Related to the availability_submissions issue.

### Accessibility

- **[WARN · pattern]** Multiple h1 headings on page — `public/availability.html`. Change error h1 to h2.
- **[WARN · pattern]** Missing `<main>` landmark — several pages.
- **[WARN · pattern]** Heading hierarchy skip — `public/availability.html` uses h3 after h1 without h2.

### SEO

- **[WARN · pattern]** 41 of 54 pages missing `<meta name="description">` — previously 37, slightly worse due to new pages added.
- **[WARN · pattern]** 3 titles over 60 chars — `learner/ask-examiner.html` (84), `learner/advisor.html` (80), `learner/examiner-quiz.html` (77). Unchanged.
- **[WARN · pattern]** Only 2 of 54 pages have Open Graph tags — `og:title` / `og:image` missing from 52 pages.
- **[WARN · pattern]** 0 of 54 pages have canonical URLs — `<link rel="canonical">` absent.
- **[WARN · pattern]** No JSON-LD structured data on `index.html`, `coachcarter-landing.html`, `lessons.html`.

### Performance

- **[WARN · file]** `public/icons/screenshot-desktop-1.png` is 525 KB. Compress or convert to webp.
- **[WARN · pattern]** Render-blocking scripts in `<head>` — `sidebar.js`, `competency-config.js`, auth scripts. Add `defer`.

### Infrastructure

- **[WARN · pattern]** `api/address-lookup.js` missing `reportError()` call in catch block.
- **[WARN · pattern]** `api/status.js` missing `reportError()` call in catch block.

### Broken Links

- **[WARN · pattern]** `/availability.html` may be orphaned (superseded by instructor/availability.html).

### Code Quality

- **[WARN · pattern]** Comment blocks detected — 26 instances, all JSDoc headers (false positive, no action needed).

</details>

---

<details>
<summary>

## Passing Checks (41 items)

</summary>

### Security
- [PASS · pattern] All 6 security headers present (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection)
- [PASS · pattern] No wildcard CORS — centralized allowlist in middleware
- [PASS · pattern] All SQL uses tagged template literals
- [PASS · pattern] Auth enforced on all mutation endpoints
- [PASS · pattern] Rate limiting on magic link, guest checkout, deletion requests
- [PASS · pattern] No `err.stack` in client responses
- [PASS · pattern] No hardcoded secrets
- [PASS · pattern] No insecure HTTP URLs
- [PASS · file] `package-lock.json` exists

### GDPR/Privacy
- [PASS · pattern] Cookie consent with state management and server recording
- [PASS · pattern] PostHog consent-gated via `posthog-loader.js`
- [PASS · pattern] Privacy policy comprehensive (10 KB)
- [PASS · file] Terms of service present (7 KB)
- [PASS · pattern] Data export endpoint
- [PASS · pattern] Email-verified account deletion
- [PASS · pattern] Third-party disclosures match actual integrations
- [PASS · pattern] Cookie consent distinguishes necessary vs analytics
- [PASS · pattern] **`api/config.js:47` cookie consent INSERT now includes `school_id`** (was FAIL on 2026-04-07)

### Data Isolation
- [PASS · pattern] JWTs include `school_id` in payload
- [PASS · pattern] Superadmin bypass explicitly gated in `_auth.js:99-101`
- [PASS · pattern] `getSchoolId()` validates role before allowing override
- [PASS · pattern] **`api/instructors.js` list/create/update/set-availability all include `school_id`** (was FAIL)
- [PASS · pattern] **`api/waitlist.js` join / mywaitlist / checkWaitlistOnCancel all include `school_id`** (was FAIL)
- [PASS · pattern] **`api/qa-digest.js` groups questions by `school_id` and sends per-school** (was FAIL)

### Performance
- [PASS · file] No JS files over 200 KB
- [PASS · pattern] Vercel handles compression automatically

### Infrastructure
- [PASS · file] `vercel.json` with 11 cron jobs, redirects, routing
- [PASS · pattern] Environment variables documented in CLAUDE.md / PROJECT.md
- [PASS · pattern] Error alerting via `_error-alert.js` + `reportError()` on 32 of 34 API files
- [PASS · pattern] 50 database indexes in `db/migration.sql`
- [PASS · pattern] All 11 cron handlers exist with error handling and auth
- [PASS · file] Build config present

### SEO
- [PASS · file] **`public/sitemap.xml` created** with 6 public pages (was missing)
- [PASS · file] **`public/robots.txt` created** with sitemap reference (was missing)
- [PASS · file] **`public/404.html` created** with branding and home link (was missing)
- [PASS · pattern] **All 54 HTML files now have `lang="en"` on the `<html>` tag** (was 5+ FAIL)
- [PASS · pattern] All 54 HTML files have `<title>` tags

### Broken Links
- [PASS · pattern] All internal page links resolve
- [PASS · pattern] All asset references resolve

### Code Quality
- [PASS · pattern] Only 1 `console.log` in production API code
- [PASS · pattern] Zero `TODO` / `FIXME` / `HACK` comments
- [PASS · pattern] All API files have try/catch on async operations
- [PASS · pattern] Consistent error response format across APIs

### Accessibility
- [PASS · pattern] All images have alt attributes
- [PASS · pattern] Decorative images properly use `alt=""`
- [PASS · pattern] **`lang="en"` present on all pages** (was FAIL)

</details>

---

## Recommendations

### Before Launch
1. **[low effort]** Decide LB-7 scope: CoachCarter-only launch → mark as known issue and proceed. InstructorBook multi-tenant launch → add `school_id` to `availability_submissions` and fix the admin GET.
2. **[low effort]** Add `reportError()` to `api/address-lookup.js` and `api/status.js` catch blocks.
3. **[low effort]** Add `AND school_id = ${schoolId}` to the `handleLeave` UPDATE in `api/waitlist.js:222`.
4. **[low effort]** Convert `api/reminders.js` join-based fencing (lines 114-116, 443-445) and the `handleDailySchedule` nested query (lines 240-259) to explicit `WHERE school_id` clauses.
5. **[low effort]** Add `school_id` filters to `api/calendar.js:71, 228`.

### After Launch (first month)
1. **[low effort]** Replace `outline: none` with visible focus styles across CSS.
2. **[low effort]** Add `<label>` elements to unlabelled form inputs.
3. **[low effort]** Add `defer` to non-critical scripts in `<head>`.
4. **[low effort]** Add meta descriptions to the 41 missing pages.
5. **[medium effort]** Compress `public/icons/screenshot-desktop-1.png` (525 KB → <200 KB).
6. **[medium effort]** Switch CSP from report-only to enforcing.
7. **[medium effort]** Replace `err.message` with generic messages in 30+ API responses.
8. **[medium effort]** Add a CI lint that greps every SQL tagged template in `api/` for `school_id` presence. Prevents LB-7 regressions.

### Long-term
1. **[high effort]** Audit all `innerHTML` usage for consistent XSS escaping.
2. **[medium effort]** Add Open Graph tags to public-facing pages.
3. **[medium effort]** Add canonical URLs to all pages.
4. **[medium effort]** Add JSON-LD structured data (Organization, LocalBusiness).
5. **[medium effort]** Add `<main>` landmarks to all pages.
6. **[low effort]** Add `role="button"` and keyboard support to interactive divs.

---

## Methodology

This audit checked 82 findings across 9 applicable categories using:
- Static code analysis (Grep, Glob, Read)
- 82 individual checks performed (82 applicable, 0 marked N/A within active categories)
- 2 categories marked N/A entirely (Responsive Design, UX Consistency — require full audit with browser)
- Parallel subagent execution on phases 1-11 to reduce runtime

### Change vs 2026-04-07 audit

This re-audit was triggered because commits `079959b "Fix launch blockers: auth, tenant isolation, error exposure, SEO, cleanup"`, `6f2f51a "Fix multi-tenant launch blockers and add SEO/infrastructure improvements"`, and `5dca538 "Add per-learner custom hourly rate and clean booking URLs"` landed after the previous audit report was written. The previous report ("BLOCKED — 4 launch blockers") was stale.

**Net effect:**
- Launch blockers: 4 → 1 (conditional on multi-tenant launch scope)
- Score: 72% → 76%
- Verdict: "NOT READY" → "Launch with Known Issues" (conditional)
- Data Isolation category: 43% → 63%
- SEO category: 60% → 75%
- Accessibility category: 35% → 42% (only `lang="en"` fix confirmed; focus rings, labels still outstanding)

### What this audit covers
This audit verifies the **presence** of security patterns, accessibility attributes, SEO tags, compliance mechanisms, and data isolation filters through static code analysis.

### What this audit does NOT cover
- **Runtime behavior** — checks that `requireAuth()` is called, not that the auth logic is uncircumventable
- **Load testing**
- **Penetration testing**
- **Legal adequacy** — checks that a privacy policy file exists, not that its contents satisfy GDPR/ICO requirements
- **Logic bugs** — race conditions, auth bypasses from edge cases, and business logic errors require manual testing

### Recommended complementary testing
1. Manual security testing or a professional penetration test
2. Load testing under expected peak traffic (booking flow + concurrent slot reservations)
3. Legal review of `public/privacy.html` and `public/terms.html`
4. Manual QA walkthrough of: signup, magic-link login, book lesson (credit), book lesson (pay-per-slot), Stripe webhook, cancellation with credit return, GDPR data export, GDPR account deletion

---

*Generated by the `launch-readiness-audit` skill. To re-run: invoke the skill and point it at current `main`.*
