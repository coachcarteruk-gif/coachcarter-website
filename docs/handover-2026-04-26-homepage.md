# Handover — Marketing Homepage Launch (2026-04-26)

> Read this before resuming any homepage / free-trial / guest-checkout work.
> Self-contained — assumes the next session has zero memory of this one.

## What shipped today (3 commits, deployed to main)

| Commit | Summary |
|---|---|
| `0edd04d` | Groundwork: linktree preserved at `/login.html`, `manifest.json` `start_url` → `/login.html`, 6 pass photos processed into `/public/images/home/` |
| `9e6c1f6` | New marketing homepage at `/` (replaces linktree). Adds About section, dismissible shortcut bar, pass-photo strip. Old `coachcarter-landing.html` + `.js` deleted. |
| `56aeaf7` | CTA honesty fix: "Book Your Free Trial" → "Book Your First Lesson" everywhere on the homepage |

All three are live. Local preview server is stopped.

## Why "Book Your First Lesson" not "Book Your Free Trial"

The free-trial flow doesn't actually exist yet. The user wanted Option B (build the real flow), the `/consciousness-council` skill pushed back hard (4-of-5 archetypes recommended honest copy now over a rushed payments build), and the user agreed.

**Do not "fix" the CTA back to "Free Trial" without first building the actual flow.** It's deliberately honest copy.

## The free-trial flow situation (the real follow-up)

This is the next-session work, and it has more landmines than its surface scope suggests.

### What exists in the codebase

- API endpoint `/api/slots?action=checkout-slot-guest` — guest checkout that auto-creates a learner account, returns a Stripe URL
- A `Free Trial` lesson type in `lesson_types` table — **currently `active = false`**
- Magic-link login infrastructure — **assumed to work for guest-created accounts but never verified**
- `/public/success.html` — likely reusable as the post-payment confirmation page

### What does NOT exist

- Any public page that calls `checkout-slot-guest` (no `/free-trial.html`, no `/book.html`)
- Auto-refund mechanism for the £1 deposit (manual via Stripe dashboard works for v1)
- Abuse prevention (no phone dedup, no rate limiting on the guest endpoint)
- Existing-learner detection UX (what happens when someone with an account tries to book a free trial?)

### Pre-build verification (do this BEFORE writing any UI code)

These are the unverified assumptions the v1 plan rested on. Each is a 5–10 minute check, all read-only:

1. **Does `checkout-slot-guest` actually work end-to-end?** Hit it with curl using a real instructor + slot. Does it return a working Stripe URL or does it 500?
2. **Does the magic-link system fire for accounts created via this endpoint?** Trace the code or test it.
3. **Does the `Free Trial` lesson type appear in slot picker if `active = true` is flipped?** Specifically: do instructors with `offered_lesson_types = NULL` automatically include it, or do they need explicit opt-in?
4. **Is `/api/slots?action=checkout-slot-guest` rate-limited?** CLAUDE.md mandates rate-limiting on unauthenticated money-touching endpoints. If not, that's a security finding before the build.

### Open product decisions (need answers before building)

| Decision | User's leaning | Notes |
|---|---|---|
| Free trial duration | 60 min (current DB config) | Alternative: 90 min like standard |
| Payment | £1 refundable Stripe deposit | Recommended over £0 — solves Stripe rejection AND captures payment method as abuse deterrent |
| Abuse prevention | Phone dedup + £1 deposit | Phone dedup alone is weak (virtual numbers exist) — deposit is the stronger barrier |
| No-show policy | Standard 48hr rule, deposit forfeited on no-show | Inherits from existing booking system |
| Instructor opt-in | All active instructors by default | Verify how `offered_lesson_types = NULL` interacts with newly-activated types |
| URL | `/free-trial.html` | Alternative: `/book-trial.html`, `/start.html` |
| Existing-learner UX | Friendly "looks like you already have an account, log in" | Don't let them double-dip. Plan didn't sketch the actual screen — needs design pass |

### Realistic estimate

1–8 hours of focused work depending on which verification assumptions hold. The v1 estimate of 2–4 was anchored on the agent's report, not independent checks.

## The homepage itself

### Architecture

```
public/
├── index.html              ← marketing homepage (NEW, ~1750 lines, single file)
├── home.js                 ← scroll animations + shortcut bar dismiss logic
├── login.html              ← preserved linktree (PWA start_url points here)
├── manifest.json           ← start_url: "/login.html"
└── images/home/            ← 6 processed pass photos (≤500KB each, EXIF stripped)
    ├── hero-1.jpg, hero-2.jpg
    ├── strip-1.jpg, strip-2.jpg
    └── testimonial-andrew.jpg, testimonial-elena.jpg
```

### Key behaviours

- **Shortcut bar at top** — dismissible, state stored in `localStorage.cc_shortcut_dismissed`
- **PWA installs land on `/login.html`** (the linktree), not `/` — protects warm-traffic UX
- **Cookie consent + PostHog loader** included per CLAUDE.md rules
- **`/login.html` rollback path** — if the marketing homepage is a flop, swap behaviour by renaming files OR adding a Vercel rewrite. Linktree is byte-identical to the pre-launch version.

### Verified at

- 375 / 768 / 1280 px viewports
- Console clean at all 3
- `/login.html` still serves the linktree correctly

### Not verified (couldn't test from this session)

- **PWA reinstall behaviour** — did the `start_url` change actually take effect for installed apps? The user needs to clear and reinstall on a real device to confirm.
- **PostHog event firing on the new page structure** — events are configured but not validated against new section/CTA names.

## Success criteria & rollback (Plan v6)

- **Review window:** 14 days post-deploy (so deadline ~2026-05-10)
- **Threshold:** combined click-through to `/learner/login.html` + `/instructor/login.html` ≥ 80% of post-launch baseline
- **<60% of baseline:** revert via `manifest.json` rollback (5 min). No-one has captured a true *pre-launch* baseline because PostHog wasn't queried — recorded as "baseline = unknown" in `DEVELOPMENT-ROADMAP.md` 2.82.

## Hidden test the user agreed to

The Strategist archetype in the council session raised a real question: **"Book Your First Lesson" might convert *better* than "Book Your Free Trial"** because "free" attracts tire-kickers and "first lesson" pre-qualifies intent. The current copy is now a free A/B test of that hypothesis. Worth checking PostHog data after a couple of weeks before committing to the Option B build.

## User context (so the next session has the same lens)

- Fraser is a solo driving instructor in Reading, not a software engineer
- Tends toward "ship now" energy — momentum is real, but he's open to push-back
- April 2026 has been a feature avalanche (multi-tenancy, GDPR audit, Stripe Connect, lesson types, referral foundations) — burnout risk is non-trivial
- Has shipped a lot of features fast and patched edge cases later. Pattern works for non-payment features. Payments don't patch cheaply.
- Responds well to honest critique (used `/scientific-critical-thinking` and `/consciousness-council` on this session's plans and acted on the findings)

## Do NOT in the next session

- **Re-add "Free Trial" CTA copy without building the actual flow first** — the current copy is deliberate
- **Skip the verification checks** above before starting the Option B build — the plan rested on unverified assumptions
- **Bundle the free-trial work into another session** — give it its own clean brief, fresh branch (`/branch` slash command), tight scope
- **Activate `Free Trial` lesson type in the DB without the public page in place** — instructors will see it appear in their booking links and get confused

## File locations for fast pickup

- Homepage: `public/index.html`
- Homepage JS: `public/home.js`
- Linktree: `public/login.html`
- Pass photos: `public/images/home/`
- Roadmap entries: `DEVELOPMENT-ROADMAP.md` §2.82 (groundwork) and §2.83 (launch)
- Routing docs: `PROJECT.md` "Routing" section

## Open browser tabs / next steps for Fraser personally

1. Wait for Vercel deploy to finish (~2 min after push)
2. Hard-refresh `coachcarter.uk/` and walk through it on phone + laptop
3. Reinstall PWA on phone, confirm it lands on `/login.html`
4. Check PostHog in 7–14 days for the click-through threshold
5. When ready for Option B: open a fresh session, paste this handover doc, start with "let's verify the guest-checkout API before planning anything"
