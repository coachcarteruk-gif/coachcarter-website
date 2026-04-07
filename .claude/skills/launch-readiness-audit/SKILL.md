---
name: launch-readiness-audit
description: "Comprehensive website launch-readiness audit. Use this skill whenever the user wants to audit their site, check if it's ready to go live, do a pre-launch review, run a site health check, or assess production readiness. Also trigger when the user mentions launch checklist, go-live checklist, site audit, production audit, deployment review, or asks 'is my site ready'. Works especially well for Vercel-deployed sites with serverless APIs, but applies to any web project."
---

# Launch Readiness Audit

Run a systematic, automated audit of a website across 11 categories and produce a scored report with actionable findings. The audit combines code-level static analysis (Grep, Glob, Read) with live browser checks (Claude Preview tools).

**Important framing:** This audit is a pre-flight checklist, not a diagnostic test. It verifies that known-important items are in place (configuration readiness) but cannot verify that the system works correctly at runtime (runtime readiness). Both scores are reported separately so the user understands exactly what has and hasn't been verified.

## Step 0: Launch Context Questionnaire

Before running any checks, ask the user these questions to calibrate the audit. Their answers adjust which checks are launch blockers, which thresholds apply, and how to interpret the results.

1. **Launch type:** Soft launch (limited users/beta) or public launch (press, marketing, open signups)?
   - Soft launch: SEO and OG tag checks downgraded from FAIL to WARN. Missing structured data is N/A.
   - Public launch: Full strictness on all checks.

2. **Does the site handle payments or financial data?**
   - Yes: Add a report caveat that payment flow testing is critical and not covered by this audit. Flag if no Stripe/payment integration tests are found.
   - No: Payment-related checks are N/A.

3. **Does the site store personal user data (accounts, profiles, PII)?**
   - Yes: GDPR checks at full strictness. Data export and deletion are WARN (not N/A).
   - No: GDPR data rights checks (export, deletion) are N/A. Cookie consent still applies if analytics are present.

4. **Is this multi-tenant (multiple organisations/schools sharing one database)?**
   - Yes: Phase 11 (Data Isolation) runs at full strictness.
   - No: Phase 11 is entirely N/A.

5. **Do you have rollback capability (can you revert in under 5 minutes)?**
   - Yes: Note in the report that some WARNs are lower risk given fast rollback.
   - No: Standard strictness.

If the user says "just run it" or wants to skip the questionnaire, use these defaults: public launch, handles payments, stores PII, auto-detect multi-tenancy from schema, no rollback assumed.

**Persisting answers:** After the questionnaire (or defaults), save the answers to `.launch-audit-config.json` in the project root. On subsequent runs, load this file and use the saved answers — ask "I found your previous audit config. Use the same settings, or reconfigure?" This eliminates score variance between runs caused by different questionnaire answers.

```json
{
  "launch_type": "public",
  "handles_payments": true,
  "stores_pii": true,
  "multi_tenant": true,
  "rollback_capable": false,
  "configured_at": "2026-04-07T14:30:00Z"
}
```

## Audit modes

The skill supports two modes. Ask the user which they want, or default to quick scan for a first pass.

### Quick scan (default, ~5 minutes)
Runs code-level phases only (1-5, 7-9, 11). No dev server needed. Use this for fast feedback during development or as a first pass before a full audit.

### Full audit (~20-40 minutes)
Runs all 11 phases including browser-based checks (6, 10). Requires a running dev server. Use for a definitive pre-launch assessment.

## How to run

Execute audit phases and produce findings tagged as PASS, WARN, FAIL, or N/A. After all phases complete, generate the final report with an overall launch readiness score.

**Important workflow principles:**
- For full audits: start the dev server with `preview_start` before any browser-based checks
- Run code-level checks in parallel where possible using subagents — they don't depend on each other
- Run browser checks after the server is confirmed running
- Never ask the user to manually verify something you can check programmatically
- If a check doesn't apply to this project (e.g., no database, no build step, no user accounts), mark it as **N/A** rather than WARN or FAIL. N/A checks are excluded from scoring entirely — they don't drag down the score for irrelevant items.
- If a check can't run due to an error (e.g., no preview server, missing config), mark it as **N/A** with note "unable to verify — [reason]". An unknown result is not a warning; don't penalise the score for infrastructure limitations.

## Confidence levels

Every finding must include a confidence tag that tells the user exactly what was verified. This makes the gap between "pattern exists" and "feature works" visible rather than hidden.

| Confidence | Meaning | Example |
|------------|---------|---------|
| `verified-behavior` | Tested in a running browser — observed the actual behavior | Color contrast checked via preview_inspect, form submitted and validation observed |
| `verified-pattern` | Code pattern confirmed via grep/read — the right code exists, but runtime behavior is not tested | `requireAuth()` is called in the file, tagged template literals used for SQL |
| `verified-file` | A file or HTML element exists — nothing about its contents or correctness is verified | `privacy.html` exists, `<meta name="description">` tag present |
| `unable-to-verify` | Check could not run — treated as N/A, not a failure | Dev server not running, file format unrecognised |

Include the confidence tag in every finding's JSON output (see `references/report-template.md` for format). In the final report, show confidence inline: `[PASS · pattern] Auth check present on all mutation endpoints`.

## Operationalised judgment calls

To improve consistency between runs, use these specific thresholds instead of subjective judgment:

- **"Sample key pages" (contrast, branding):** Check the 5 pages linked from the main navigation or homepage. If fewer than 5 exist, check all pages.
- **"Console.log — a few are OK":** Fewer than 5 in non-test, non-node_modules files = PASS. 5-20 = WARN. More than 20 = FAIL.
- **"Major pages" for navigation completeness:** Any page linked from the sidebar or bottom nav. Orphan = any HTML page in public/ with zero inbound links from other HTML files.
- **"Protected mutation endpoints":** Any API handler using POST, PUT, PATCH, or DELETE methods (check for `req.method` or function name patterns like `handleCreate`, `handleUpdate`, `handleDelete`).
- **"User input" for XSS checks:** Any value from `req.query`, `req.body`, URL parameters, or `document.querySelector('input')`. If `innerHTML` is set to a value derived from these without sanitisation, flag it.

## Launch blockers (circuit-breaker)

Certain findings are so severe that they override the percentage score. If ANY of the following checks FAIL, the final verdict is **"NOT READY — Launch Blocker Found"** regardless of the overall score. These represent risks where launching would cause immediate harm to users, legal exposure, or data loss.

| Blocker ID | Check | Why it blocks launch |
|------------|-------|---------------------|
| LB-1 | Hardcoded secrets in code (Phase 4, check 8) | Credentials exposed in source = instant compromise |
| LB-2 | SQL injection patterns found (Phase 4, check 3) | Direct path to data breach |
| LB-3 | Missing auth on mutation endpoints (Phase 4, check 5) | Anyone can modify data without authentication |
| LB-4 | Missing cookie consent (Phase 5, check 1) | GDPR violation from first pageview — legal liability |
| LB-5 | Analytics loading without consent (Phase 5, check 2) | GDPR violation — tracking users without permission |
| LB-6 | Wildcard CORS on authenticated endpoints (Phase 4, check 2) | Any website can make authenticated requests on behalf of users |
| LB-7 | Tenant data leakage — SQL queries missing school_id filter (Phase 11, check 1) | Tenant A can see Tenant B's data |
| LB-8 | Missing privacy policy (Phase 5, check 3) | Legal requirement for any site collecting personal data |

When a launch blocker is found, it appears at the very top of the report with a prominent warning banner, above the score summary. The score is still calculated (it's useful for tracking progress) but the verdict line reads: **"BLOCKED — X launch blocker(s) found. Fix these before any other work."**

## Phase 1: Performance (code-level)

Check for common performance issues in the source code:

1. **Unoptimized images** — Glob for image files (`**/*.{png,jpg,jpeg,gif,bmp,tiff}`). Flag images over 500KB as WARN, over 2MB as FAIL. Check if `<img>` tags use `loading="lazy"` for below-fold images.
2. **Large JS bundles** — Glob for JS files in the public/output directory. Flag individual files over 200KB as WARN, over 500KB as FAIL. Check for minification (look for `.min.js` or built output).
3. **Missing compression** — Check Vercel config (`vercel.json`) or middleware for gzip/brotli headers. Check for `Content-Encoding` headers in middleware.
4. **API response patterns** — Grep API files for patterns that suggest slow responses: missing database indexes (queries without WHERE on indexed columns), N+1 query patterns (queries inside loops), missing pagination on list endpoints.
5. **Render-blocking resources** — Check HTML files for `<script>` tags without `async` or `defer` in the `<head>`. Check for large inline `<style>` blocks (>5KB).

## Phase 2: Accessibility (WCAG 2.1 AA)

Audit HTML files for accessibility compliance. Some checks here overlap with SEO and Responsive — run them once here and reference the finding in other categories rather than checking twice.

1. **Image alt text** — Every `<img>` must have an `alt` attribute. Decorative images should use `alt=""`. Flag missing alt as FAIL. Also check for gaming: if >80% of images use `alt=""` (all marked decorative), flag as WARN "suspiciously high ratio of decorative images — genuine accessibility requires a mix of descriptive alt text and decorative alt=''." *(Also counts toward SEO — descriptive alt text helps search indexing.)*
2. **Form labels** — Every `<input>`, `<select>`, `<textarea>` must have an associated `<label>` (via `for` attribute or wrapping) or `aria-label`/`aria-labelledby`. Flag unlabelled inputs as FAIL.
3. **ARIA landmarks** — Check for `<main>`, `<nav>`, `<header>`, `<footer>` or equivalent ARIA roles. Flag pages with no landmarks as WARN.
4. **Heading hierarchy** — Check that headings don't skip levels (e.g., h1 → h3 without h2) AND that each page has exactly one `<h1>`. Flag skipped levels as WARN, zero/multiple h1s as WARN. *(Also counts toward SEO — don't recheck in Phase 3.)*
5. **Color contrast** — Use `preview_inspect` to check text elements against WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text). Sample key pages.
6. **Keyboard focus** — Check for `outline: none` or `outline: 0` in CSS without a replacement focus style. Flag as FAIL.
7. **Touch targets** — Check that interactive elements (buttons, links) have minimum 44x44px touch targets via `preview_inspect`. *(Also counts toward Responsive — don't recheck in Phase 6.)*
8. **Language attribute** — Check that `<html>` has a `lang` attribute. Flag missing as FAIL.

## Phase 3: SEO

Check search engine optimization fundamentals. Heading hierarchy and image alt text are checked in Phase 2 (Accessibility) — reference those findings here, don't recheck.

1. **Meta titles** — Every HTML page must have a `<title>` tag. Flag missing as FAIL. Flag titles over 60 chars as WARN.
2. **Meta descriptions** — Check for `<meta name="description">`. Flag missing as WARN. Flag descriptions over 160 chars as WARN.
3. **Open Graph tags** — Check for `og:title`, `og:description`, `og:image`, `og:url`. Flag missing as WARN (FAIL for public-facing/marketing pages).
4. **Canonical URLs** — Check for `<link rel="canonical">`. Flag missing on public pages as WARN.
5. **sitemap.xml** — Check if `public/sitemap.xml` exists. Flag missing as WARN.
6. **robots.txt** — Check if `public/robots.txt` exists. Flag missing as WARN.
7. **Structured data** — Check for JSON-LD (`<script type="application/ld+json">`) on key pages. Flag missing as WARN for business sites.

## Phase 4: Security (OWASP)

Audit for common security vulnerabilities:

1. **Security headers** — Check middleware/config for: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`. Flag each missing header as FAIL (CSP as WARN since it's complex to implement).
2. **CORS configuration** — Check for overly permissive CORS (`Access-Control-Allow-Origin: *`). Flag wildcard CORS as FAIL. Verify CORS is centralized (not per-file).
3. **SQL injection prevention** — Grep for string concatenation in SQL queries (e.g., `${variable}` inside SQL strings without tagged template literals). Flag as FAIL.
4. **XSS prevention** — Check for `innerHTML` usage with user input, `dangerouslySetInnerHTML`, or `eval()` with dynamic content. Flag as FAIL.
5. **Auth patterns** — Check that protected API routes call `requireAuth()` or equivalent. Flag unprotected mutation endpoints as FAIL.
6. **Rate limiting** — Check that public endpoints sending emails/SMS have rate limiting. Flag unprotected send endpoints as WARN.
7. **Error exposure** — Grep for `err.stack` or raw error objects in API responses. Flag as FAIL.
8. **Secrets in code** — Grep for hardcoded API keys, passwords, or tokens (patterns like `sk_live_`, `password = "`, `apiKey = "`). Flag as FAIL.
9. **HTTPS enforcement** — Check for hardcoded `http://` URLs (not localhost). Flag as WARN.
10. **Dependency vulnerabilities** — If `package.json` exists, check for known issues: flag if no `package-lock.json` as WARN.

## Phase 5: GDPR / Privacy Compliance

Check privacy and data protection:

1. **Cookie consent** — Check for a cookie consent mechanism (banner, modal). Grep for cookie consent JS. Don't just check the file exists (`verified-file`) — verify the code contains consent state management (localStorage/cookie read, callback pattern, or event listener for user choice). Confidence: `verified-pattern`. Flag missing as FAIL.
2. **Analytics consent gating** — Check that analytics (PostHog, GA, etc.) only loads after consent. Trace the code path: find the analytics init call and verify it's inside a consent callback or conditional, not just in a separate file. The gating must be in the execution flow, not just co-located. Confidence: `verified-pattern`. Flag ungated analytics as FAIL.
3. **Privacy policy** — Check for a privacy policy page (`privacy.html` or similar). Then verify content depth: read the file and check it contains at least 500 characters AND at least 2 of these key phrases: "data controller", "cookies", "third party", "personal data", "contact", "rights". Flag missing file as FAIL. Flag file under 500 chars or missing key phrases as WARN with "privacy policy appears to be a placeholder". Confidence: `verified-pattern` (not just `verified-file`).
4. **Terms of service** — Check for terms page. Apply the same content-depth check (>500 chars). Flag missing as WARN. Flag placeholder as WARN.
5. **Data export** — Check for a data export/download endpoint (GDPR Article 20). Flag missing as WARN.
6. **Account deletion** — Check for account deletion capability (GDPR Article 17). Flag missing as WARN.
7. **Third-party disclosures** — Check privacy policy for mentions of third-party services used (Stripe, PostHog, etc.). Cross-reference with actual integrations. Flag undisclosed services as WARN.
8. **Cookie policy specifics** — Check that consent banner distinguishes between necessary and optional cookies. Flag all-or-nothing consent as WARN.

## Phase 6: Responsive Design & Cross-browser (full audit only)

Check mobile and cross-browser readiness. Touch targets are checked in Phase 2 (Accessibility) — reference that finding here.

1. **Viewport meta** — Every HTML page must have `<meta name="viewport" content="width=device-width, initial-scale=1">`. Flag missing as FAIL.
2. **Responsive breakpoints** — Check CSS for media queries. Flag no media queries as WARN.
3. **Mobile layout** — Use `preview_resize` to check key pages at mobile (375px), tablet (768px), and desktop (1280px). Take screenshots. Flag layout breaks as FAIL.
4. **Horizontal scroll** — Check for horizontal overflow at mobile widths. Flag as FAIL.
5. **Font readability** — Check that body text is at least 16px on mobile. Flag smaller as WARN.

## Phase 7: Broken Links & Dead Pages

Crawl the site for broken references:

1. **Internal link audit** — Glob all HTML files. Extract all `href` values pointing to local pages. Check each target exists. Flag 404s as FAIL.
2. **Navigation completeness** — Check that sidebar/nav includes links to all major pages. Flag orphan pages (no inbound links) as WARN.
3. **Asset references** — Check `<img src>`, `<link href>`, `<script src>` paths resolve to existing files. Flag missing assets as FAIL.
4. **API route audit** — Cross-reference frontend fetch/XHR calls with existing API files. Flag calls to non-existent endpoints as FAIL.
5. **Anchor links** — Check `href="#id"` links point to elements that exist on the page. Flag broken anchors as WARN.

## Phase 8: Code Quality

Check for production-readiness of the code:

1. **Console statements** — Grep for `console.log`, `console.debug`, `console.warn` in production code (not node_modules, not test files). Flag `console.log` as WARN (a few are OK for error reporting, many are not).
2. **TODO/FIXME/HACK comments** — Grep for `TODO`, `FIXME`, `HACK`, `XXX` comments. Flag as WARN with count and locations.
3. **Error handling** — Check API files for try/catch around async operations. Flag unhandled async calls as WARN.
4. **Dead code** — Look for commented-out code blocks (more than 5 consecutive commented lines). Flag as WARN.
5. **Consistent error responses** — Check API files return consistent error format (`{ error: ... }`). Flag inconsistent formats as WARN.
6. **Environment checks** — Check for `process.env` references and verify they're documented or have fallbacks. Flag undocumented env vars as WARN.

## Phase 9: Infrastructure

Check deployment and operational readiness:

1. **Vercel configuration** — Check `vercel.json` exists and has sensible config (rewrites, headers, crons). Flag missing as WARN.
2. **Environment variables** — Cross-reference `process.env.*` usage with `.env.example` or documentation. Flag undocumented vars as WARN.
3. **Error alerting** — Check for error reporting/alerting mechanism (error handler that sends notifications). Flag missing as WARN.
4. **Database indexes** — Check migration files for indexes on foreign key columns and common query patterns. Flag missing FK indexes as WARN.
5. **Cron jobs** — If crons exist in `vercel.json`, verify the handler files exist and have error handling. Flag missing handlers as FAIL.
6. **Build configuration** — Check `package.json` for build scripts. Verify the build succeeds (or check for build output). Flag missing build config as WARN.
7. **404/Error pages** — Check for custom 404 and error pages. Flag missing as WARN.

## Phase 10: UX & Design Consistency (browser-based)

Use Claude Preview tools to check the live site:

1. **Branding consistency** — Check that brand colors, fonts, and logo appear consistently across 3-5 key pages. Use `preview_inspect` to compare CSS values. Flag inconsistencies as WARN.
2. **Loading states** — Check pages that fetch data for loading indicators (spinners, skeletons). Use `preview_snapshot` to check for loading UI. Flag missing loading states as WARN.
3. **Error states** — Trigger API errors (e.g., fetch with bad auth) and check if the UI shows meaningful error messages. Flag raw errors or silent failures as FAIL.
4. **Empty states** — Check list/table pages with no data for empty state messaging. Flag blank pages as WARN.
5. **Form validation** — Submit forms with invalid/empty data and check for inline validation messages. Flag missing validation as WARN.
6. **Favicon** — Check for favicon (`<link rel="icon">`). Flag missing as WARN.
7. **Page titles** — Check that each page has a unique, descriptive `<title>`. Flag duplicate or generic titles as WARN.

## Phase 11: Data Isolation & Multi-tenancy

For SaaS / multi-tenant applications, this is often the single most important correctness property. If the project has no multi-tenancy (single-user app, static site), mark all checks as N/A.

**How to detect if multi-tenancy applies:** Look for tenant identifiers in the schema — columns like `school_id`, `org_id`, `tenant_id`, `team_id`, or `workspace_id` in migration files or schema definitions. If found, this phase applies.

1. **Tenant-scoped queries** — [LAUNCH BLOCKER LB-7] Grep all SQL queries in API files. For every table that has a tenant ID column (e.g., `school_id`), verify that queries on that table include a `WHERE` clause filtering by the tenant ID. Flag queries missing the tenant filter as FAIL. This is the most common multi-tenancy vulnerability — it means Tenant A can see Tenant B's data.
2. **JWT tenant claims** — Check that JWTs include the tenant identifier (e.g., `school_id` in the payload). Check that auth middleware extracts and validates it. Flag missing as FAIL.
3. **API endpoint tenant scoping** — Check that API routes pass the tenant ID from the authenticated user's JWT to database queries, rather than accepting it from query parameters without validation. Flag endpoints that trust client-supplied tenant IDs without auth checks as FAIL.
4. **Cross-tenant data in responses** — Check API responses that return lists/collections. Verify they filter by tenant. Flag list endpoints without tenant filtering as FAIL.
5. **Admin/superadmin bypass safety** — If the app has a superadmin role that can access all tenants, check that this bypass is explicitly gated (e.g., `if (role === 'superadmin')`) rather than accidentally available. Flag ungated cross-tenant access as WARN.

## Generating the Report

After all phases complete, compile findings into a markdown report. Read `references/report-template.md` for the exact format.

**Scoring formula:**
- Each finding is weighted: FAIL = 0 points, WARN = 0.5 points, PASS = 1 point, N/A = excluded from denominator
- Category score = (points earned / applicable max points) * 100
- Overall score = weighted average of category scores (excluding categories that are 100% N/A) with these weights:
  - Security: 18%
  - Accessibility: 12%
  - GDPR: 12%
  - Data Isolation: 11% (N/A if not multi-tenant — weight redistributed proportionally)
  - Performance: 10%
  - Infrastructure: 9%
  - SEO: 7%
  - Responsive: 7%
  - Broken Links: 5%
  - Code Quality: 5%
  - UX Consistency: 4%

**Dual sub-scores — report both:**

The overall score is split into two sub-scores so the user understands what has actually been verified:

1. **Configuration Readiness** (static analysis) — Covers all checks verified via `verified-pattern` or `verified-file` confidence. This tells you: "The right code, files, and configuration are in place." This is what the quick scan measures.

2. **Runtime Readiness** (browser-verified) — Covers checks verified via `verified-behavior` confidence. This tells you: "We observed the site actually doing the right thing in a browser." Only available in full audit mode.

In the report, display both:
```
Configuration Readiness: 87% (based on 62 static checks)
Runtime Readiness: 74% (based on 15 browser-verified checks)
Overall Score: 83% (weighted combination)
```

If running quick scan only, display:
```
Configuration Readiness: 87% (based on 62 static checks)
Runtime Readiness: NOT TESTED (run full audit to assess)
Overall Score: 87% (configuration only — runtime untested)
```

**Variance band:** Scores include a +/- 4% variance band to communicate measurement uncertainty from LLM judgment calls. Display as `87% (±4%)`. When the score falls within the variance band of a threshold boundary (e.g., 86-94% near the 90% threshold), explicitly note: "This score is near the [threshold] boundary. The difference may not be meaningful — focus on the specific findings rather than the number."

**Confidence ceiling — verdicts:**
The verdict label depends on BOTH the score AND what was verified:

| Score | Has `verified-behavior` checks? | Verdict |
|-------|-------------------------------|---------|
| 90%+ | Yes (full audit) | **Configuration & Runtime Ready** |
| 90%+ | No (quick scan only) | **Configuration Ready** (not "Ready to Launch" — runtime untested) |
| 75-89% | Either | **Launch with Known Issues** (fix WARNs soon) |
| 60-74% | Either | **Not Recommended** — fix FAILs first |
| <60% | Either | **Significant Work Needed** |

The key insight: never say "Ready to Launch" when zero runtime behavior was verified. A quick scan can confirm configuration is in place, but it cannot confirm the site works. The label must reflect this.

These thresholds are author-set heuristics, not empirically validated. The launch-blocker circuit-breaker is more reliable than the percentage for go/no-go decisions.

**High-stakes launch warning:** If the questionnaire indicated `handles_payments=true` AND `stores_pii=true`, append a mandatory non-collapsible block to the report (NOT in a `<details>` tag — it must be visible):

```
## ⚠ HIGH-STAKES LAUNCH: Manual Verification Required

Your app handles payments and personal data. This audit checks configuration
patterns, not runtime security. Before going live, you MUST also:

1. □ Test the complete payment flow end-to-end (add to cart → pay → confirm)
2. □ Have a security-literate person review authentication and authorization logic
3. □ Have a lawyer or DPO review your privacy policy against ICO/GDPR requirements
4. □ Test account creation, login, and password reset flows manually
5. □ Verify Stripe webhook handling with Stripe's test mode

Skipping these steps exposes you to: failed payments, data breach liability,
regulatory fines (up to 4% of turnover under GDPR), and loss of user trust.
```

**Confidence distribution:** Include in every report summary:
```
Confidence breakdown: X verified-behavior · Y verified-pattern · Z verified-file
```
If the ratio is heavily skewed toward `verified-file` (>60% of checks), add: "Most checks verified only file existence, not content or behavior. Consider running the full audit for deeper verification."

**Report output:** Save the report as `LAUNCH-AUDIT-REPORT.md` in the project root.

**Report structure (progressive disclosure):**
The report uses progressive disclosure to prevent audit fatigue. The most critical information is at the top; details are expandable.

1. **Launch blockers** (if any) — always visible, top of report
2. **High-stakes warning** (if payments+PII) — always visible
3. **Top 5 Critical Fixes** — always visible. The 5 highest-impact items (FAIL first, then highest-weight-category WARNs), sorted by effort (low first). This is the "fix these in the next 2 hours" list.
4. **Score summary** with confidence distribution and variance band
5. **All FAILs with fixes** — expandable `<details>` block
6. **All WARNs grouped by category** — expandable `<details>` block
7. **Passing checks** — expandable `<details>` block (collapsed by default)
8. **Methodology and limitations** — always visible

Also display a summary in the chat with the overall score, category breakdown, and the Top 5 Critical Fixes.

**After generating the report, offer to fix:** Conclude with: "I found [N] low-effort items I can fix right now. Would you like me to fix them?" List the specific items (e.g., "add lang='en' to 5 HTML files, add missing alt text to 3 images, add defer to 2 script tags"). This converts the audit from a passive report into active remediation.

**Sorting recommendations by effort:** Within each priority tier (Before Launch, After Launch, Long-term), sort findings by effort level — low-effort fixes first. Quick wins should be visually obvious so the developer knows what to tackle in the first hour. Use this format:
```
1. [low effort] Fix missing alt text on 3 images — `public/book.html:42`, `public/dashboard.html:18`
2. [low effort] Add lang="en" to html tag on 5 pages
3. [medium effort] Add Content-Security-Policy header to middleware.js
4. [high effort] Implement data export endpoint for GDPR Article 20
```

## Parallel execution strategy

**Quick scan mode:**
1. **In parallel (subagents):** Run phases 1-5, 7-9, and 11 (all code-level checks)
2. **Compile** all findings into the report

**Full audit mode:**
1. **First:** Start the dev server with `preview_start`
2. **In parallel (subagents):** Run phases 1-5, 7-9, and 11 (all code-level checks)
3. **After server is ready:** Run phases 6 and 10 (browser-based checks)
4. **Compile** all findings into the report

Use the Agent tool to run code-level phases as parallel subagents. Each subagent should return its findings as a structured list following the finding format in `references/report-template.md`. The main thread handles browser checks and report compilation.

## What this audit can and cannot do

Be honest with the user about the nature of this audit. Include this in the report methodology section.

**What it does well:**
- Verifies the *presence* of security patterns, accessibility attributes, SEO tags, and compliance mechanisms
- Catches common oversights (missing headers, unlabelled inputs, broken links, exposed secrets)
- Provides a structured, prioritised fix list with effort estimates
- Identifies multi-tenancy data isolation gaps via static SQL analysis

**What it cannot do:**
- Test whether authentication *actually works* at runtime (it checks that `requireAuth()` is called, not that it's correctly implemented)
- Test whether rate limiting holds under load
- Verify that the privacy policy is *legally adequate* (it checks the file exists, not its contents against the law)
- Detect logic bugs, race conditions, or auth bypasses that require runtime execution
- Perform penetration testing or load testing

**Recommendation to include in every report:**
> This audit is a static analysis and limited browser check — it verifies patterns and configuration, not runtime behavior. For a production launch handling real user data or payments, complement this with: manual security testing (or a professional pentest), load testing under expected traffic, and legal review of privacy/terms pages.
