# CoachCarter Launch Readiness Audit

**Audit date:** 17 September 2026

**Target:** `codex/trial-discount-pencilled-offers` at `7c10ce1` plus the audited working-tree security patch

**Launch type:** Public production launch

**Verdict:** **LIVE — BLOCKERS REMEDIATED AND VERIFIED**

> [!IMPORTANT]
> The audit originally found two confirmed launch blockers in the learner identity-migration flow. Both were remediated before launch: `add-email` now requires the SMS-authenticated learner session and CSRF token, proposed email remains uncommitted until verification, and the final mutation is bound to the signed learner ID and `school_id`. The former unauthenticated production request now returns HTTP 401.

Production migrations 066–068 and deployment `dpl_j5girvSU2vfpGUMtckq4iomnqHL5` completed on 17 September 2026. The public alias is `https://www.coachcarter.uk`. Database snapshot `snap-dry-art-ab9rji4w` was created immediately before migration.

## Executive Summary

The branch-specific Stripe test-mode rehearsal succeeded end-to-end: a signed event was accepted with HTTP 200, its duplicate was accepted idempotently, Vercel runtime logs confirmed the preview function response, and the isolated rehearsal database showed no unexpected booking, offer, refund, or credit mutations.

The mandatory gate then found a pre-existing authentication vulnerability in `api/learner-auth.js`. It was repaired and covered by focused regression tests. A fresh preview rejected the former attack with HTTP 401, the updated preview accepted a newly resent signed Stripe test event with HTTP 200, and the public production route also rejects the attack with HTTP 401. Runtime inspection additionally confirmed the expected security headers are present, correcting the original static false negative. Remaining findings are follow-up hardening and quality work rather than launch blockers.

## Resolved Launch Blockers

### LB-3 — Unauthenticated learner account takeover — RESOLVED

**Evidence:** `POST /api/learner-auth?action=add-email` accepts a phone number and a new email without requiring an authenticated learner session or a challenge delivered to a previously trusted channel. It selects the learner by phone at line 695 and updates the stored email to the caller-supplied address before verification at line 728. The verification code is then sent to the new address controlled by the caller.

**Impact:** A caller who knows a learner's phone number can redirect the identity flow to their own email and proceed toward setting a password for the victim account.

**Resolution:** The endpoint now requires the learner session issued after SMS verification and the normal CSRF header. It rate-limits by account and IP, stores the proposed address only on the short-lived token, and changes the learner email and password together after email-code verification. Focused tests cover rejection without a session, non-mutation before verification, and learner-bound final mutation. Preview and production both return HTTP 401 for the former attack request.

### LB-7 — Missing tenant scope in identity mutation — RESOLVED

**Evidence:** The same learner lookup and update do not include `school_id`. Additional legacy learner password/offer mutation paths also use learner identifiers without consistently binding the query to authenticated school context.

**Impact:** In a multi-tenant application, identity resolution and mutation can cross school boundaries or resolve the wrong tenant record.

**Resolution:** SMS lookup, email-code verification, password reset, offer-password setup, and final learner mutation now carry trusted `school_id`. The migration ticket is signed with learner ID and school ID, and the update requires both.

## Readiness Scorecard

| Category | Score | Result |
|---|---:|---|
| Security | 67% | Follow-up hardening |
| Accessibility | 67% | Needs work |
| GDPR / privacy | 94% | Mostly ready |
| Data isolation | 100% | Ready |
| Performance | 40% | Needs work |
| Infrastructure | 79% | Needs work |
| SEO | 57% | Needs work |
| Broken links | 90% | Mostly ready |
| Code quality | 67% | Needs work |
| Responsive design | N/A | Not runtime-tested in quick scan |
| UX flows | N/A | Not runtime-tested in quick scan |

**Weighted readiness score:** approximately **73%** across applicable categories.

**Static checks after remediation/runtime correction:** 34 pass, 23 warn, 5 fail, 3 not applicable.

**Confidence:** 59 pattern-verified checks, 3 file-verified checks, 0 full runtime-behaviour checks in the launch-audit scan. The earlier signed Stripe rehearsal is recorded separately above.

No confirmed launch blocker remains. The score still reflects non-blocking hardening, accessibility, performance, and SEO debt.

## Failed Checks Requiring Remediation

1. **Stored/DOM XSS exposure:** unsafe rendering sinks were found in `public/learner/my-data.js` and `public/instructor/profile.js`. Replace HTML-string insertion for untrusted values with text-safe DOM APIs or context-appropriate escaping, then add payload tests.
2. **Dependency security:** the dependency audit reports a high-severity Nodemailer advisory and a moderate `qs` advisory. Upgrade to patched compatible versions and rerun the full test suite and dependency audit.
3. **Accessibility labels:** a broad scan found 252 controls without reliable programmatic label association, including the admin dashboard filters. Add `label[for]`/matching `id`, `aria-label`, or `aria-labelledby` as appropriate and verify with an accessibility scanner.
4. **Performance asset budget:** `public/FraserDiag.JPG` is approximately 5.56 MB. Resize and encode an appropriately dimensioned WebP/AVIF derivative, retain a fallback if needed, and verify visual quality.
5. **Error disclosure:** migration/admin API responses can expose raw database error detail. Log detailed errors server-side and return stable, non-sensitive client error envelopes.

## Warnings

- **Security:** no enforceable Content Security Policy was found; public email/mutation routes need explicit rate limits.
- **Performance:** testimonial images should be lazy-loaded; `public/admin/portal.js` is approximately 270 KB; multiple N+1 access patterns and render-blocking/large inline assets need profiling; compression must be verified against the deployed response.
- **Accessibility:** page landmarks and heading hierarchy are inconsistent; colour contrast and touch targets require rendered-page testing.
- **SEO:** many pages lack descriptions, Open Graph metadata, and canonicals; several titles are too long; the sitemap contains a stale `coachcarter-landing.html` URL; no structured data was found.
- **GDPR:** Setmore usage should be disclosed consistently in the privacy/cookie material.
- **Broken links:** several HTML pages appear orphaned and should be confirmed intentional or linked/removed.
- **Code quality:** seven production `console.log` calls and two TODO markers remain; API error envelopes are inconsistent; `GOOGLE_PLACE_ID` is used but not clearly documented.
- **Infrastructure:** the environment-variable contract needs a single authoritative inventory; there is no aggregate predeploy verification command; a dedicated 5xx error page was not found.

## Checks That Passed

- No wildcard CORS policy was found.
- Reviewed database calls use parameterised SQL rather than interpolated SQL strings.
- No real hard-coded production secrets were found in the audited source.
- No insecure external HTTP endpoints were found.
- Stripe webhook signature verification is present.
- JWTs carry school context, role-gated overrides are present, new pencilled-offer routes are school-scoped, and migrations 066–068 are school-scoped.
- Image alternative text, language attributes, consent gating, privacy/terms surfaces, data export/deletion paths, cookie categories, `robots.txt`, and keyboard focus replacements passed the static checks performed.
- Focused automated tests completed with 61 passing checks during the audit; the earlier branch verification completed with 55 passing and 2 expected remote-loopback skips, plus syntax validation across 252 JavaScript files.

## Recommended Remediation Order

1. Remove the identified XSS sinks and raw database-error disclosure.
2. Upgrade vulnerable dependencies and rerun the dependency audit.
3. Address accessibility labels and the 5.56 MB image; schedule the remaining warnings with owners and dates.
4. Remove cross-test module-cache pollution in the Stripe boundary suites. The affected tests pass in isolation, while the full parallel run completed with 1,446 passes, 312 skips, and two cache-pollution failures.
5. Commit and push the exact deployed working-tree patch through the normal review workflow so production is reproducible from source control.

## Methodology and Limitations

This was a rapid, code-first launch-readiness audit using repository inspection, targeted searches, dependency/test output, configuration review, and parallel security, frontend, and operations passes. It did not constitute a penetration test, legal opinion, full assistive-technology review, load test, or exhaustive runtime crawl. Responsive behaviour, colour contrast, touch targets, compression, and end-user UX require deployed-browser validation after the blockers are corrected.

After the initial blocker report, the user authorised remediation and launch. Production migrations were applied to the independently verified protected branch after snapshot creation, with exact manifest checksums recorded in `schema_migration_history`. Postflight found zero invalid indexes and zero unvalidated constraints. The production deployment reached READY and public probes returned 200 for the home/login pages and 401 for the former attack. No Stripe live-mode payment, refund, transfer, payout, or webhook test mutation was made.
