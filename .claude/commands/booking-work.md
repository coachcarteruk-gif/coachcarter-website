---
description: Start a session for booking page / slot feed work (book.html, slots.js)
argument-hint: [short description of the change]
---

I'm working on the booking page / slot feed: **$ARGUMENTS**

Before writing any code, read `CLAUDE.md` and `docs/navigation.md`, then confirm you understand these hard "do NOT re-add" rules:

1. **Do NOT re-add calendar views** — weekly, monthly, and daily calendar views were intentionally removed. The booking page is a "next available" slot feed only.
2. **Do NOT re-add view toggles** — no view switcher, no date navigation arrows, no cursor state.
3. **Do NOT re-add empty-hour grids** — the slot feed is a flat list, not a time grid.
4. **Do NOT remove progressive loading** — 14 days at a time, max 90.
5. **Do NOT remove guest checkout** — unauthenticated users book via `checkout-slot-guest` action.
6. **Travel time filter stays** — postcodes.io-based slot filtering is part of the booking flow. See `docs/travel-time.md`.
7. **`?action=` routing** on any new API calls.

**Files likely relevant:**
- `public/book.html` — slot feed UI
- `api/slots.js` — `handleAvailable`, `handleBook`
- `api/_travel-time.js` — slot filtering + warnings
- `public/shared/sidebar.js` — navigation (if adding new URL params)

**Before committing, verify:**
- [ ] No calendar/grid/view-toggle code added
- [ ] Progressive loading still works
- [ ] Guest checkout still works
- [ ] Travel time filter still applies
- [ ] Tested on mobile layout
- [ ] `PROJECT.md` updated if flow changed
- [ ] `DEVELOPMENT-ROADMAP.md` entry added

Now read `book.html` and the relevant handler in `slots.js`, then summarise your plan before writing code.
