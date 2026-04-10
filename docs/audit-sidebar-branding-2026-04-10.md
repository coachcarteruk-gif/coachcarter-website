# Sidebar & Branding Includes Audit

**Date:** 2026-04-10
**Total HTML files audited:** 54 (all `public/**/*.html`)
**Rule:** CLAUDE.md requires all new pages include `sidebar.js` and `branding.js`

---

## Summary

| Status | Count |
|--------|-------|
| Has both sidebar.js + branding.js | 4 |
| Has sidebar.js only (missing branding.js) | 29 |
| Has branding.js only (missing sidebar.js) | 1 |
| Missing both | 20 |

---

## Category A — Exempt (no fix needed)

These pages intentionally operate outside the sidebar/branding system (login gates, utility pages, landing pages, standalone flows):

| File | Reason |
|------|--------|
| `index.html` | Public landing page, no auth |
| `coachcarter-landing.html` | Marketing landing page |
| `404.html` | Error page (has branding.js, no sidebar — acceptable) |
| `offline.html` | Service worker offline fallback |
| `maintenance.html` | Maintenance mode page |
| `success.html` | Post-action redirect page |
| `accept-offer.html` | Standalone offer acceptance flow |
| `offer-success.html` | Standalone offer success page |
| `learner/confirm-deletion.html` | Account deletion flow, intentionally minimal |
| `learner/confirm-lesson.html` | Has sidebar.js — confirm flow, borderline exempt |
| `admin/login.html` | Login gate, no sidebar expected |
| `instructor/login.html` | Login gate (has sidebar.js — unusual but not broken) |
| `learner/login.html` | Login gate (has sidebar.js — unusual but not broken) |
| `instructor/onboarding.html` | Onboarding wizard (has sidebar.js — borderline) |
| `learner/onboarding.html` | Onboarding wizard (has sidebar.js — borderline) |
| `demo/book.html` | Demo/preview page |

**16 files exempt.**

---

## Category B — Real bugs (missing includes on app pages)

### B1: Missing both sidebar.js and branding.js

| File | Priority |
|------|----------|
| `admin.html` | Medium — legacy admin entry point |
| `admin/dashboard.html` | High — active admin page |
| `admin/editor.html` | High — active admin page |
| `admin/portal.html` | High — active admin page |
| `availability.html` | Medium — may be legacy/redirect |
| `lessons.html` | Medium — may be legacy/redirect |
| `superadmin/index.html` | Medium — superadmin pages |
| `superadmin/school-detail.html` | Medium — superadmin pages |
| `superadmin/schools.html` | Medium — superadmin pages |

**9 files missing both.**

### B2: Missing sidebar.js only

No app pages are missing sidebar.js alone (only `404.html`, which is exempt).

### B3: Missing branding.js only (has sidebar.js)

| File | Priority |
|------|----------|
| `learner-journey.html` | Medium |
| `classroom.html` | Medium |
| `terms.html` | Low — static content |
| `privacy.html` | Low — static content |

**4 standalone/content pages.**

---

## Category C — Primary finding: branding.js missing from 24 learner/instructor app pages

These are core authenticated app pages that have `sidebar.js` but are missing `branding.js`. This means school branding (logo, colors, name) won't apply on these pages for multi-tenant schools.

### Learner pages (17)

- `learner/advisor.html`
- `learner/ask-examiner.html`
- `learner/book.html`
- `learner/buy-credits.html`
- `learner/examiner-quiz.html`
- `learner/focused-practice.html`
- `learner/lessons.html`
- `learner/log-session.html`
- `learner/mock-test.html`
- `learner/my-data.html`
- `learner/profile.html`
- `learner/progress.html`
- `learner/qa.html`
- `learner/videos.html`

### Instructor pages (7)

- `instructor/availability.html`
- `instructor/dashboard.html`
- `instructor/earnings.html`
- `instructor/index.html`
- `instructor/learners.html`
- `instructor/profile.html`
- `instructor/qa.html`

### Pages with both (for reference)

- `learner/index.html`
- `learner/learn.html`
- `learner/lessons-hub.html`
- `learner/practice.html`

**These 4 files are the only ones where branding.js was added — likely the most recently created or updated pages.**

---

## Recommended follow-up sessions

1. **`/quick-fix` — Add branding.js to Category C pages (24 files)**
   Highest impact. These are active multi-tenant app pages. Without branding.js, InstructorBook schools see default CoachCarter branding.

2. **`/quick-fix` — Add sidebar.js + branding.js to Category B1 admin/superadmin pages (9 files)**
   Medium priority. Admin pages may have their own layout, so check whether sidebar/branding is appropriate for each.

3. **`/quick-fix` — Add branding.js to Category B3 content pages (4 files)**
   Low priority. Static content pages, but school branding would still be nice.

4. **Review login pages** — `instructor/login.html` and `learner/login.html` currently include sidebar.js which seems unnecessary for a login gate. Consider whether to remove sidebar.js or add branding.js for consistency.
