# Launch Readiness Audit Report

**Project:** CoachCarter / InstructorBook Platform
**Date:** 2026-04-07
**Audit mode:** Quick Scan (code-level only)
**Overall Score:** 72% (±4%) — **BLOCKED — 4 launch blocker(s) found**

---

## LAUNCH BLOCKED

**4 launch blocker(s) found (LB-7: Tenant Data Leakage).** These must be fixed before any other work. The score below is calculated for tracking purposes but the verdict is: **NOT READY.**

| Blocker | Finding | Location |
|---------|---------|----------|
| LB-7 | Instructor list returns ALL schools' instructors (no school_id filter) | `api/instructors.js:65-71` |
| LB-7 | Waitlist has zero school_id filtering | `api/waitlist.js` (all queries) |
| LB-7 | Reminder cron processes all schools without isolation | `api/reminders.js` (5 queries) |
| LB-7 | QA digest sends cross-school questions to all instructors | `api/qa-digest.js:22-38` |

---

## HIGH-STAKES LAUNCH: Manual Verification Required

Your app handles payments and personal data. This audit checks configuration patterns, not runtime security. Before going live, you MUST also:

1. [ ] Test the complete payment flow end-to-end (add to cart -> pay -> confirm)
2. [ ] Have a security-literate person review authentication and authorization logic
3. [ ] Have a lawyer or DPO review your privacy policy against ICO/GDPR requirements
4. [ ] Test account creation, login, and password reset flows manually
5. [ ] Verify Stripe webhook handling with Stripe's test mode

Skipping these steps exposes you to: failed payments, data breach liability, regulatory fines (up to 4% of turnover under GDPR), and loss of user trust.

---

## Top 5 Critical Fixes

The 5 highest-impact items to fix first. Launch blockers first, then highest-weight WARNs.

1. **[low effort · FAIL · LB-7]** Add `WHERE school_id = ${schoolId}` to `api/instructors.js` list query and admin actions — `api/instructors.js:65-71`
2. **[medium effort · FAIL · LB-7]** Add school_id filtering to all `api/waitlist.js` queries — `api/waitlist.js`
3. **[medium effort · FAIL · LB-7]** Add per-school processing to `api/reminders.js` cron actions — `api/reminders.js`
4. **[medium effort · FAIL · LB-7]** Group QA digest by school_id, send per-school — `api/qa-digest.js:22-38`
5. **[low effort · FAIL]** Add `lang="en"` to `<html>` tag on pages missing it — `public/admin.html`, `public/classroom.html`, + others

---

## Score Summary

**Configuration Readiness:** 72% (±4%) (based on 76 static checks)
**Runtime Readiness:** NOT TESTED (run full audit to assess)
**Confidence breakdown:** 0 verified-behavior · 58 verified-pattern · 18 verified-file

> Note: This score is near the 75% threshold boundary. The ±4% variance means the difference may not be meaningful — focus on the specific findings rather than the number.

> Most checks verified code patterns or file existence, not runtime behavior. Run the full audit for browser-verified checks.

| Category | Score | Weight | FAILs | WARNs | PASSes | N/A |
|----------|-------|--------|-------|-------|--------|-----|
| Security | 85% | 18% | 0 | 4 | 9 | 0 |
| Accessibility | 35% | 12% | 5 | 3 | 2 | 0 |
| GDPR/Privacy | 90% | 12% | 0 | 2 | 8 | 0 |
| Data Isolation | 43% | 11% | 5 | 6 | 3 | 0 |
| Performance | 75% | 10% | 0 | 2 | 2 | 0 |
| Infrastructure | 93% | 9% | 0 | 1 | 6 | 0 |
| SEO | 60% | 7% | 0 | 8 | 2 | 0 |
| Responsive Design | N/A | 7% | — | — | — | All |
| Broken Links | 83% | 5% | 0 | 1 | 2 | 0 |
| Code Quality | 90% | 5% | 0 | 1 | 4 | 0 |
| UX Consistency | N/A | 4% | — | — | — | All |

---

<details>
<summary>

## All Critical Findings (10 FAILs — must fix before launch)

</summary>

### [FAIL · pattern] Data Isolation — Instructor list returns all schools' data (LB-7)
- **What:** `GET /api/instructors?action=list` queries `WHERE active = true` with NO school_id filter. Create/update/set-availability actions also lack school_id.
- **Where:** `api/instructors.js:65-71`
- **Why it matters:** Learners from School B see School A's instructors. Admin actions could modify other schools' instructors.
- **Fix:** Add `AND school_id = ${schoolId}` to list query. Add `requireAuth` + `getSchoolId` to admin actions.

### [FAIL · pattern] Data Isolation — Waitlist has zero school_id filtering (LB-7)
- **What:** All waitlist operations lack school_id filtering. Cross-school waitlist contamination possible.
- **Where:** `api/waitlist.js` (all SQL queries)
- **Why it matters:** Learners from one school could join waitlists for another school's instructors.
- **Fix:** Add `school_id` filtering to all waitlist queries.

### [FAIL · pattern] Data Isolation — Reminder cron processes all schools (LB-7)
- **What:** All reminder actions query lesson_bookings without school_id. Could send reminders with wrong school branding.
- **Where:** `api/reminders.js` (lines 116, 253, 366, 442, 546)
- **Fix:** Process per-school with configurable settings, or add school_id filtering.

### [FAIL · pattern] Data Isolation — QA digest leaks across schools (LB-7)
- **What:** QA digest queries qa_questions and instructors without school_id. Instructors from School A see School B's questions.
- **Where:** `api/qa-digest.js:22-38`
- **Fix:** Group questions by school_id and send digests per-school.

### [FAIL · pattern] Data Isolation — Cookie consent insert missing school_id
- **What:** `INSERT INTO cookie_consents` does not include school_id despite the table having the column.
- **Where:** `api/config.js:47`
- **Fix:** Pass school_id from the request in consent recording.

### [FAIL · pattern] Accessibility — Missing lang attribute on html element
- **What:** Multiple HTML files lack `lang="en"` on the `<html>` tag.
- **Where:** `public/admin.html`, `public/classroom.html`, and others
- **Fix:** Add `lang="en"` to `<html>` on all pages.

### [FAIL · pattern] Accessibility — Interactive divs without button semantics
- **What:** Availability grid uses divs with click handlers but no `role="button"` or ARIA labels.
- **Where:** `public/availability.html:649-654`
- **Fix:** Use `<button>` elements or add `role="button"`, `aria-label`, and `tabindex="0"`.

### [FAIL · pattern] Accessibility — Form input missing label
- **What:** Textarea with id='notes' has no associated `<label>` element.
- **Where:** `public/availability.html:566`
- **Fix:** Add `<label for="notes">` before the textarea.

### [FAIL · pattern] Accessibility — outline:none without focus replacement
- **What:** CSS removes outline without visible focus alternative. Affects 20+ files.
- **Where:** `public/shared-auth.css:214,443,514`, `public/accept-offer.html:89`, 18+ other files
- **Fix:** Replace `outline: none` with `outline: 2px solid var(--accent)` or equivalent box-shadow.

### [FAIL · pattern] Accessibility — Form labels missing on some inputs
- **What:** Some form inputs depend on placeholder text only, lacking proper `<label>` or `aria-label`.
- **Where:** `public/availability.html`, `public/instructor/onboarding.html`
- **Fix:** Add associated labels or aria-labels to all inputs.

</details>

---

<details>
<summary>

## Warnings (28 WARNs — fix soon after launch)

</summary>

### Security

- **[WARN · pattern] CSP in report-only mode** — `middleware.js:79`. Switch to enforcing once violations reviewed.
- **[WARN · pattern] innerHTML used with server data** — 80+ occurrences across public/ files. Inconsistent use of `esc()` helper. Audit for XSS.
- **[WARN · pattern] Raw err.message sent to clients** — 30+ occurrences. Replace with generic messages in responses.
- **[WARN · pattern] Residual per-file CORS stubs** — `api/availability.js`, `api/create-checkout-session.js`. Remove dead CORS code.

### Data Isolation

- **[WARN · pattern] Calendar feed queries lack school_id** — `api/calendar.js`. Data scoped by user token but violates convention.
- **[WARN · pattern] Payout queries partially lack school_id** — `api/_payout-helpers.js`. Scoped by instructor_id but should be explicit.
- **[WARN · pattern] Setmore sync inserts without explicit school_id** — `api/setmore-sync.js`. Relies on DB default of 1.
- **[WARN · pattern] Learner stats queries lack school_id** — `api/_shared.js:36-56`. Scoped by user_id.
- **[WARN · pattern] Public endpoints accept unchecked school_id** — `api/slots.js:120-121`. Validate school exists.
- **[WARN · pattern] Availability endpoint missing auth and school_id** — `api/availability.js`. Add auth + scoping.

### GDPR

- **[WARN · pattern] Enquiries missing school_id scoping** — `api/enquiries.js`. All enquiries from all schools returned.
- **[WARN · pattern] Availability submissions missing school_id** — `api/availability.js`. No tenant isolation.

### Accessibility

- **[WARN · pattern] Multiple h1 headings on page** — `public/availability.html`. Change error h1 to h2.
- **[WARN · pattern] Missing main landmark** — Several pages lack `<main>` element.
- **[WARN · pattern] Heading hierarchy skip** — `public/availability.html` uses h3 after h1 without h2.

### SEO

- **[WARN · pattern] 3 titles over 60 chars** — `learner/ask-examiner.html`, `learner/advisor.html`, `learner/examiner-quiz.html`
- **[WARN · pattern] 37 pages missing meta description** — 74% coverage gap
- **[WARN · pattern] 6 descriptions over 160 chars** — Multiple learner pages
- **[WARN · pattern] Only 2 pages have Open Graph tags** — Missing on 48 pages
- **[WARN · pattern] No canonical URLs anywhere** — All 50 HTML files
- **[WARN · file] No sitemap.xml** — `public/sitemap.xml` does not exist
- **[WARN · file] No robots.txt** — `public/robots.txt` does not exist
- **[WARN · pattern] No structured data (JSON-LD)** — No schema markup on any page

### Performance

- **[WARN · file] One image over 500KB** — `public/icons/screenshot-desktop-1.png` (525KB)
- **[WARN · pattern] Render-blocking scripts in head** — `sidebar.js`, `competency-config.js`, auth scripts could use `defer`

### Infrastructure

- **[WARN · file] No custom 404 page** — Default Vercel 404 shown

### Broken Links

- **[WARN · pattern] Potentially orphaned pages** — `/availability.html` may be superseded by instructor version

### Code Quality

- **[WARN · pattern] Comment blocks detected** — 26 instances, all JSDoc headers (false positive, no action needed)

</details>

---

<details>
<summary>

## Passing Checks (34 items)

</summary>

### Security
- [PASS · pattern] All 6 security headers present (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection)
- [PASS · pattern] No wildcard CORS — centralized allowlist in middleware
- [PASS · pattern] All SQL uses tagged template literals — no injection vectors
- [PASS · pattern] Auth enforced on all mutation endpoints
- [PASS · pattern] Rate limiting on magic link, guest checkout, deletion requests
- [PASS · pattern] No err.stack in client responses
- [PASS · pattern] No hardcoded secrets in codebase
- [PASS · pattern] No insecure HTTP URLs
- [PASS · file] package-lock.json exists

### GDPR/Privacy
- [PASS · pattern] Cookie consent with state management and server recording
- [PASS · pattern] PostHog consent-gated via posthog-loader.js
- [PASS · pattern] Privacy policy comprehensive (10KB, names all processors)
- [PASS · file] Terms of service present (7KB)
- [PASS · pattern] Data export endpoint (learner.js export-data)
- [PASS · pattern] Account deletion with email verification (learner.js request-deletion, confirm-deletion)
- [PASS · pattern] Third-party disclosures match actual integrations
- [PASS · pattern] Cookie consent distinguishes necessary vs analytics

### Data Isolation
- [PASS · pattern] JWTs include school_id in payload
- [PASS · pattern] Superadmin bypass explicitly gated in _auth.js
- [PASS · pattern] getSchoolId validates role before allowing override

### Performance
- [PASS · file] No JS files over 200KB (largest: sidebar.js at 39KB)
- [PASS · pattern] Vercel handles compression automatically

### Infrastructure
- [PASS · file] vercel.json with crons, redirects, routing
- [PASS · pattern] Environment variables documented in CLAUDE.md/PROJECT.md
- [PASS · pattern] Error alerting via _error-alert.js + reportError()
- [PASS · pattern] 50+ database indexes including composite and partial indexes
- [PASS · pattern] All 11 cron handlers exist with error handling and auth
- [PASS · file] Build config present (no build step needed for vanilla JS)

### Broken Links
- [PASS · pattern] All internal page links resolve to existing files
- [PASS · pattern] All asset references (img, script, css) resolve

### Code Quality
- [PASS · pattern] Only 1 console.log in production API code
- [PASS · pattern] Zero TODO/FIXME/HACK comments
- [PASS · pattern] All API files have try/catch on async operations
- [PASS · pattern] Consistent error response format across all APIs

### Accessibility
- [PASS · pattern] All images have alt attributes
- [PASS · pattern] Decorative images properly use alt=""

</details>

---

## Recommendations

### Before Launch (fix launch blockers)
1. [medium effort] Add school_id filtering to `api/instructors.js` — all actions (list, create, update, set-availability)
2. [medium effort] Add school_id filtering to `api/waitlist.js` — all queries
3. [medium effort] Add per-school processing to `api/reminders.js` — all cron actions
4. [medium effort] Add school_id grouping to `api/qa-digest.js` — digest queries
5. [low effort] Add school_id to `api/config.js:47` cookie consent insert

### After Launch (fix within first month)
1. [low effort] Add `lang="en"` to all HTML files missing it
2. [low effort] Replace `outline: none` with visible focus styles across CSS
3. [low effort] Add `<label>` elements to unlabelled form inputs
4. [low effort] Create `public/robots.txt` and `public/sitemap.xml`
5. [low effort] Add meta descriptions to 37 pages missing them
6. [low effort] Create custom `public/404.html` page
7. [low effort] Add `defer` to non-critical scripts in `<head>`
8. [medium effort] Switch CSP from report-only to enforcing
9. [medium effort] Replace `err.message` with generic messages in 30+ API responses
10. [medium effort] Add school_id to calendar, payout, and shared queries for defense-in-depth

### Long-term
1. [high effort] Audit all innerHTML usage for consistent XSS escaping
2. [medium effort] Add Open Graph tags to public-facing pages
3. [medium effort] Add canonical URLs to all pages
4. [medium effort] Add JSON-LD structured data (Organization, LocalBusiness)
5. [medium effort] Add `<main>` landmarks to all pages
6. [low effort] Add `role="button"` and keyboard support to interactive divs

---

## Methodology

This audit checked 76 findings across 9 categories using:
- Static code analysis (Grep, Glob, Read)
- 76 individual checks performed (76 applicable, 0 marked N/A within active categories)
- 2 categories marked N/A entirely (Responsive Design, UX Consistency — require full audit with browser)

Categories are weighted by their impact on user safety and experience:
- Security, GDPR, and Data Isolation carry the highest weight (41% combined) because failures here have legal, trust, and data breach consequences
- Accessibility is weighted at 12% reflecting both legal requirements (EAA/WCAG) and user inclusivity
- Infrastructure is weighted at 9% because error alerting, database indexes, and cron reliability are strong predictors of post-launch incidents
- Performance and SEO at 10%/7% reflect their impact on user experience and discoverability
- Other categories at 4-7% each cover operational and quality concerns

**Note on thresholds:** The scoring thresholds (90% = ready, etc.) and file-size limits (500KB image, 200KB JS) are author-set heuristics, not empirically validated against launch-outcome data. The launch-blocker circuit-breaker is a more reliable go/no-go signal than the percentage.

### What this audit covers
This audit verifies the **presence** of security patterns, accessibility attributes, SEO tags, compliance mechanisms, and data isolation filters through static code analysis.

### What this audit does NOT cover
- **Runtime behavior** — it checks that `requireAuth()` is called, not that the auth logic is correct
- **Load testing** — it does not test performance under concurrent users
- **Penetration testing** — it does not attempt to exploit vulnerabilities, only detect patterns
- **Legal adequacy** — it checks that a privacy policy file exists, not that its contents satisfy GDPR/ICO requirements
- **Logic bugs** — race conditions, auth bypasses from edge cases, and business logic errors require manual testing

### Recommended complementary testing
For a production launch handling real user data or payments:
1. Manual security testing or professional penetration test
2. Load testing under expected peak traffic
3. Legal review of privacy policy and terms pages
4. Manual QA walkthrough of critical user journeys (signup, booking, payment)
