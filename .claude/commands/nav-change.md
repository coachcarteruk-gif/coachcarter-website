---
description: Start a session for changing navigation (sidebar, bottom tabs, or page layout)
argument-hint: [short description of the navigation change]
---

I'm changing navigation: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md` (the "Intentionally removed" list) and `docs/navigation.md`, then confirm you will NOT re-add any of the following:

1. Pricing page / tab
2. Lesson Advisor
3. Privacy Policy tab (page exists, not in nav)
4. Terms tab (page exists, not in nav)
5. Q&A as a bottom tab (sidebar only)
6. Old `.site-nav` dark top bar
7. Old `.bottom-nav` inline bottom bar
8. Old `.sub-tabs` on learner pages
9. Quick-access pill row and action cards on instructor dashboard
10. Calendar sync banner on booking/dashboard pages
11. Menu/hamburger as a bottom tab
12. Videos in Learn section navigation
13. Hour-slot time grid on instructor daily calendar
14. Daily view tab on instructor calendar

Also confirm these structural rules:

- **Mobile**: top header bar with hamburger + fixed bottom bar with exactly 5 tabs
- **Desktop**: fixed 240px sidebar, no bottom bar
- **Learner bottom tabs**: Home | Lessons | Practice | Learn | Profile
- **Instructor bottom tabs**: Dashboard | Calendar | Learners | Earnings | Profile
- **Sidebar accordion**: one group open at a time, auto-expands to current section
- All pages must load `sidebar.js` and `branding.js`

**Files likely relevant:**
- `public/shared/sidebar.js` — the single source of truth for navigation
- `public/shared/branding.js` — per-school branding
- The page(s) being changed

**Before committing, verify:**
- [ ] No removed items re-added
- [ ] Mobile bottom bar still has 5 tabs
- [ ] Desktop sidebar still 240px
- [ ] Active tab highlighting still works
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `sidebar.js` and summarise your plan before writing code.
