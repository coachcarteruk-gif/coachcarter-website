# Report Template

Use this exact structure for the final audit report.

---

```markdown
# Launch Readiness Audit Report

**Project:** [project name]
**Date:** [YYYY-MM-DD]
**Audit mode:** [Quick Scan | Full Audit]
**Overall Score:** [XX]% (±4%) — [Configuration & Runtime Ready | Configuration Ready | Launch with Known Issues | Not Recommended | Significant Work Needed]

> [If launch blockers found, add this banner FIRST:]
> ## LAUNCH BLOCKED
> **X launch blocker(s) found.** These must be fixed before any other work. The score below is calculated for tracking purposes but the verdict is: **NOT READY.**
>
> | Blocker | Finding | Location |
> |---------|---------|----------|
> | LB-1 | Hardcoded API key found | api/connect.js:42 |
> | LB-7 | SQL query missing school_id filter | api/bookings.js:88 |

> [If handles_payments=true AND stores_pii=true, add HIGH-STAKES WARNING — NOT in a details/collapsible block:]
> ## ⚠ HIGH-STAKES LAUNCH: Manual Verification Required
>
> Your app handles payments and personal data. This audit checks configuration
> patterns, not runtime security. Before going live, you MUST also:
>
> 1. □ Test the complete payment flow end-to-end (add to cart → pay → confirm)
> 2. □ Have a security-literate person review authentication and authorization logic
> 3. □ Have a lawyer or DPO review your privacy policy against ICO/GDPR requirements
> 4. □ Test account creation, login, and password reset flows manually
> 5. □ Verify Stripe webhook handling with Stripe's test mode
>
> Skipping these steps exposes you to: failed payments, data breach liability,
> regulatory fines (up to 4% of turnover under GDPR), and loss of user trust.

---

## Top 5 Critical Fixes

The 5 highest-impact items to fix in the next 2 hours. FAILs first, then highest-weight WARNs. Sorted by effort (quick wins first).

1. [low effort · FAIL] ...
2. [low effort · FAIL] ...
3. [medium effort · FAIL] ...
4. [low effort · WARN] ...
5. [medium effort · WARN] ...

---

## Score Summary

**Configuration Readiness:** XX% (based on XX static checks)
**Runtime Readiness:** XX% (based on XX browser-verified checks) [or: NOT TESTED — run full audit]
**Confidence breakdown:** X verified-behavior · Y verified-pattern · Z verified-file

> [If score is within ±4% of a threshold (90%, 75%, 60%):]
> Note: This score is near the [XX%] threshold. The ±4% variance means the difference may not be meaningful — focus on the specific findings rather than the number.

> [If quick scan and score >= 90%:]
> Note: This score reflects configuration checks only. No runtime behavior was verified. The verdict is "Configuration Ready", not "Ready to Launch." Run the full audit or perform manual testing before making a go-live decision.

| Category | Score | FAILs | WARNs | PASSes | N/A |
|----------|-------|-------|-------|--------|-----|
| Security (18%) | XX% | X | X | X | X |
| Accessibility (12%) | XX% | X | X | X | X |
| GDPR/Privacy (12%) | XX% | X | X | X | X |
| Data Isolation (11%) | XX% | X | X | X | X |
| Performance (10%) | XX% | X | X | X | X |
| Infrastructure (9%) | XX% | X | X | X | X |
| SEO (7%) | XX% | X | X | X | X |
| Responsive Design (7%) | XX% | X | X | X | X |
| Broken Links (5%) | XX% | X | X | X | X |
| Code Quality (5%) | XX% | X | X | X | X |
| UX Consistency (4%) | XX% | X | X | X | X |

---

<details>
<summary>## All Critical Findings (X FAILs — must fix before launch)</summary>

List all FAIL items here, grouped by category. Each finding should include:

### [FAIL] Category — Finding title
- **What:** Brief description of the issue
- **Where:** File path(s) or URL(s) affected
- **Why it matters:** Impact on users, security, or compliance
- **Fix:** Specific, actionable steps to resolve

</details>

---

<details>
<summary>## Warnings (X WARNs — fix soon after launch)</summary>

List all WARN items here, same format as above but with:

### [WARN] Category — Finding title
- **What:** Brief description
- **Where:** Location(s)
- **Why it matters:** Potential impact
- **Fix:** Suggested improvement

</details>

---

## Passing Checks

Collapsed summary of what passed, grouped by category. Keep this brief — the user cares most about what needs fixing.

<details>
<summary>Passing checks (X items)</summary>

### Performance
- [PASS] Image optimization — all images under 500KB
- [PASS] JS bundle sizes — within limits

### Accessibility
- [PASS] All images have alt text
- [PASS] Form labels present on all inputs

(etc.)
</details>

---

## Recommendations

### Before Launch
1. [Numbered list of the most impactful fixes, ordered by priority]

### After Launch
1. [Numbered list of improvements to make within the first month]

### Long-term
1. [Numbered list of nice-to-haves and strategic improvements]

---

## Methodology

This audit checked [X] files across [X] categories using:
- Static code analysis (Grep, Glob, Read)
- Live browser testing (Claude Preview tools) [if full audit]
- [X] individual checks performed ([X] applicable, [X] marked N/A)

Categories are weighted by their impact on user safety and experience:
- Security, GDPR, and Data Isolation carry the highest weight (41% combined) because failures here have legal, trust, and data breach consequences
- Accessibility is weighted at 12% reflecting both legal requirements (EAA/WCAG) and user inclusivity
- Infrastructure is weighted at 9% because error alerting, database indexes, and cron reliability are strong predictors of post-launch incidents
- Performance and SEO at 10%/7% reflect their impact on user experience and discoverability
- Other categories at 4-7% each cover operational and quality concerns

**Note on thresholds:** The scoring thresholds (90% = ready, etc.) and file-size limits (500KB image, 200KB JS) are author-set heuristics, not empirically validated against launch-outcome data. The launch-blocker circuit-breaker is a more reliable go/no-go signal than the percentage.

### What this audit covers
This audit verifies the **presence** of security patterns, accessibility attributes, SEO tags, compliance mechanisms, and data isolation filters through static code analysis and limited browser inspection.

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
```

---

## Finding format

When collecting findings during each phase, use this consistent structure:

```json
{
  "category": "Security",
  "id": "sec-01",
  "title": "Missing Content-Security-Policy header",
  "status": "WARN",
  "confidence": "verified-pattern",
  "description": "No CSP header found in middleware or Vercel config",
  "location": "middleware.js",
  "impact": "Increases XSS risk — browser can't restrict resource origins",
  "fix": "Add Content-Security-Policy header to middleware.js response headers. Start with a report-only policy to identify violations before enforcing.",
  "effort": "medium",
  "launch_blocker": false
}
```

**Confidence levels** (must be one of):
- `verified-behavior` — observed in a running browser (strongest)
- `verified-pattern` — code pattern confirmed via grep/read
- `verified-file` — file or HTML element exists (weakest positive)
- `unable-to-verify` — check could not run (treated as N/A)

**Effort levels:**
- **low** — under 30 minutes, single file change
- **medium** — 1-3 hours, multiple files or testing needed
- **high** — half day or more, architectural change or significant refactor

**In the report**, show confidence inline with each finding:
```
### [FAIL · pattern] Security — Missing auth on POST /api/admin?action=delete-learner
### [PASS · behavior] Accessibility — Color contrast meets WCAG AA on all sampled pages
### [WARN · file] SEO — sitemap.xml exists but may be outdated
```
