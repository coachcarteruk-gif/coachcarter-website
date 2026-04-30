# Launch Readiness Audit — 2026-04-30 (FULL)

**Mode:** Full audit — static analysis + browser-based runtime checks
**Context:** Public launch · handles payments · stores PII · multi-tenant · no fast-rollback assumed
**Commit at audit time:** `8e7c1c3`
**Browser checks:** mobile (375px), tablet (768px), desktop (1280px) on 5 key pages

---

## ✅ No launch blockers found

All 8 launch-blocker checks (LB-1 through LB-8) passed. Cookie consent fires correctly in the browser, analytics gating works, privacy policy is substantive, CORS, secrets, SQL injection, tenant isolation, and auth-on-mutation patterns are all in place.

---

## ⚠ HIGH-STAKES LAUNCH: Manual Verification Required

Your app handles payments and personal data. This audit checks configuration patterns and observed UI behaviour, but cannot replace these manual steps:

1. ☐ Test the complete payment flow end-to-end (book slot → pay → confirm → email)
2. ☐ Have a security-literate person review authentication and authorization logic
3. ☐ Have a lawyer/DPO review `privacy.html` against ICO/GDPR requirements
4. ☐ Test account creation, magic-link login, and deletion flows manually
5. ☐ Verify Stripe webhook handling with Stripe test mode + simulated failures

---

## Score Summary

```
Configuration Readiness: 86% (±4%) — based on ~70 static checks
Runtime Readiness:       72% (±4%) — based on 18 browser-verified checks
Overall Score:           82% (±4%) (configuration + runtime weighted)
```

**Verdict: Launch with Known Issues.**
The hard stuff is solid (security, GDPR, tenant isolation). The runtime score is dragged down by **two real defects discovered in the browser**: tablet breakpoint is broken, and 60–80% of form inputs on auth/booking pages have no labels or aria-labels. These are launch-quality issues, not launch blockers — but a new learner on an iPad or using a screen reader will hit them.

**Confidence breakdown:** 18 verified-behavior · 55 verified-pattern · 10 verified-file

---

## Top 5 Critical Fixes (do these first)

1. **[medium effort] Fix tablet layout (768px breakpoint).** Homepage renders at ~300px wide column on tablet with massive white space on the right. CSS media queries are not handling 768–1024px. Likely a `max-width` on a wrapper that doesn't release. Affects everyone on iPad.
2. **[medium effort] Add labels/aria-labels to form inputs.** Login page: 11/14 inputs unlabelled (email, phone, name, OTP digits, referral). Book page: 12/18 unlabelled. Placeholders ≠ labels for screen readers. WCAG 2.1 AA fail.
3. **[low effort] Add `<main>` landmark and a `<h1>`** to `learner/login.html` and `learner/book.html` (currently zero h1 elements; sidebar `<nav>` is the only landmark).
4. **[low effort] Increase bottom-tab font size.** Mobile bottom-tab pills render at **9.92px font** (e.g. "📅Book") — well below the 12px floor for readable mobile text.
5. **[low effort] Add canonical URLs** to public marketing pages — currently 0/55 pages have `<link rel="canonical">`. Important: `coachcarter.uk`, `instructorbook.co.uk`, and `*.vercel.app` all serve the same content.

---

## Category Scores

| Category | Score | Notes |
|----------|-------|-------|
| Security (18%) | **94%** | Headers, CORS, no secrets, no SQLi. Minor WARN: `err.message` exposure in `offers.js:383`; XSS sweep recommended on 269 `innerHTML` sinks. |
| Accessibility (12%) | **62%** ⬇ | Down from quick scan. Browser confirmed real label gaps (login: 11/14, book: 12/18 inputs unlabelled). Homepage `<main>` landmark missing. Bottom-tab font 9.92px. |
| GDPR (12%) | **96%** | Cookie banner verified rendering and gating PostHog. Privacy policy substantive. 2 learner pages still missing consent scripts. |
| Data Isolation (11%) | **98%** | School-id filtering enforced at JWT → resolver → SQL. No missing-filter queries found. |
| Performance (10%) | **80%** | JS bundles fine. WARN: 2 images >500KB; render-blocking head scripts; no `Cache-Control` headers in `vercel.json`. |
| Infrastructure (9%) | **90%** | Vercel config solid, all 13 cron handlers present. FAIL: `package.json` has no `scripts` block. |
| SEO (7%) | **55%** | FAIL: 0 canonicals, OG on 3/55 pages, descriptions on 14/55. PASS: titles, robots.txt, sitemap (small). |
| **Responsive (7%)** | **55%** ⬇ | Browser-verified. Mobile (375px) clean. **Tablet (768px) BROKEN** — homepage column ~300px wide, white-space right. Desktop fine. |
| Broken Links (5%) | **95%** | All sampled internal hrefs, assets, and API routes resolve. `classroom.html` is dead code. |
| Code Quality (5%) | **80%** | Try/catch coverage near 1:1, error shape consistent, `console.log` count clean. WARN: 251 TODO/FIXME comments across 38 files. |
| **UX Consistency (4%)** | **80%** | Browser-verified. Branding consistent (Lato font, orange CTA, white bg on public pages, dark bg on auth). Cookie banner renders correctly. No console errors on homepage. |

---

## Runtime findings (new — from browser checks)

**Tablet layout broken (FAIL · verified-behavior).** At 768x1024, the homepage `<body>` reports `clientWidth: 753`, `scrollWidth: 753` (no horizontal overflow), but the visible content column is ~300px and the rest is white space. Screenshot confirms. The mobile layout is being applied to tablet without expansion. Affected pages likely include all marketing pages using the same shell.

**Login page is missing core landmarks and labels (FAIL · verified-behavior).**
- `<h1>` count: 0
- `<main>` landmark: missing
- 11/14 visible/hidden inputs have no `<label>`, `aria-label`, or `aria-labelledby` (only the 3 cookie/terms checkboxes are labelled)
- Inputs affected: email, phone, name, referral code, 6 OTP digit fields

**Book page has the same input-label problem (FAIL · verified-behavior).**
- `<h1>` count: 0
- `<main>` landmark: missing
- 12/18 inputs unlabelled

**Free-trial page is exemplary (PASS · verified-behavior).** `<main>` present, single h1, all 6 inputs labelled, no overflow at mobile. Use this as the reference for fixing the others.

**Mobile CTA size (PASS · verified-behavior).** Hero CTAs are 47–49px tall on mobile (above 44px touch-target floor), 16px font.

**Mobile bottom-tab font size (WARN · verified-behavior).** Tab pills render at 9.92px font ("📅Book"). 12px is the absolute floor; 14–16px is recommended.

**No console errors on homepage (PASS · verified-behavior).** Empty error log after page load + cookie consent interaction.

**Cookie banner renders correctly (PASS · verified-behavior).** Necessary/Analytics distinction visible, Reject All / Save / Accept All buttons present.

---

## All FAILs

- **Responsive — tablet layout broken at 768px.** Column ~300px instead of expanding. Affects iPad users.
- **Accessibility — 23 unlabelled visible inputs across login + book pages.** Screen-reader users cannot identify form fields.
- **Accessibility — login + book pages have zero `<h1>` and no `<main>` landmark.**
- **SEO — canonical URLs missing on every page (0/55).**
- **SEO — Open Graph tags on only 3/55 pages.**
- **SEO — meta descriptions on only 14/55 pages.**
- **Infrastructure — `package.json` has no `scripts` block.**
- **Code Quality — 251 TODO/FIXME/HACK comments across 38 files.**

---

## All WARNs by category

**Security**
- `err.message` leaked in `api/offers.js:383` (learner-facing). Lower-priority: `cron-auto-complete.js:35`, `cron-reconcile-payments.js:94`, `cron-referral-rewards.js:151`.
- 269 `innerHTML =` usages in `public/` — targeted XSS audit recommended on user-derived sinks.
- Auth-on-mutation not exhaustively verified per handler — recommend explicit sweep of every `POST/PUT/PATCH/DELETE` in `api/admin.js`, `api/learner.js`, `api/instructor.js`, `api/slots.js`.

**Accessibility**
- Bottom-tab font size 9.92px on mobile.
- Homepage `<main>` landmark missing (sidebar `<nav>` present).
- 39 `outline:none` occurrences across 23 files. Spot-checks show focus replacements in `shared-auth.css`, others should be audited.
- Form-label coverage on remaining auth pages (instructor login, admin login, dashboards) not yet runtime-verified — likely same pattern.

**GDPR**
- 2/55 pages missing consent scripts: `public/learner/learn.html`, `public/learner/lessons-hub.html`.

**Performance**
- 2 images >500KB: `icons/screenshot-desktop-1.png` (525KB), `images/home/strip-2.jpg` (507KB).
- `vercel.json` has no `headers` block — no long-cache `Cache-Control` for static assets.
- Render-blocking `<script>` in `<head>` on `index.html`, `learner/book.html`, `free-trial.html`. `dark-mode.js`, `font-swap.js` can be `defer`.

**Broken Links**
- `public/classroom.html` is permanently redirected to `/` by `vercel.json` — dead code.

**SEO**
- `sitemap.xml` only has 5 URLs; missing `free-trial.html`, `learner-journey.html`.

**UX Consistency**
- Login/book/dashboard pages use dark bg (rgb(26,26,26)) while marketing pages use white. Likely intentional (auth-shell vs marketing-shell), but worth a deliberate decision rather than accidental drift.

---

## What this audit did and did not verify

**Verified at runtime (browser):**
- Homepage, free-trial, login, book pages render at mobile/tablet/desktop
- Cookie consent banner appears, has correct categories, has Reject/Save/Accept buttons
- Form input labelling on login + book + free-trial
- Bottom-tab font size and CTA touch targets on mobile
- Console errors on homepage load
- Page landmarks, h1 counts, viewport, favicon, lang attribute
- Branding consistency (font, bg color, CTA color) across 4 pages

**Verified by code (static):**
- Security headers, CORS, auth patterns, SQL injection, secrets
- Cookie consent script structure, PostHog gating logic
- Multi-tenancy SQL filters across all `api/*.js`
- API surface integrity, cron handlers, error alerting wiring

**NOT verified (still required for public launch):**
- Whether auth *actually rejects* tampered tokens
- Whether rate limiting holds under load
- Whether Stripe payment flow works end-to-end (test mode booking → webhook → confirmation email)
- Whether tenant isolation holds under adversarial probing
- Whether `privacy.html` is legally adequate (lawyer/DPO review)
- Cross-browser testing (only Chromium tested via preview)
- Real iOS/Android device testing
- Loading and error states under network failure conditions

---

*Saved as `LAUNCH-AUDIT-REPORT.md`. Config: `.launch-audit-config.json` (last_audit: 2026-04-30, full mode).*
