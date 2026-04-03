# CoachCarter Design Review & Implementation Guide

> **Last updated:** March 2026
>
> **Purpose**: This document is a comprehensive design review for the CoachCarter Driving School website. It contains specific, actionable instructions for improving the UI/UX across three core screens: the Homepage (`public/index.html`), the Learner Portal Dashboard (`public/learner/index.html`), and the Buy Credits page (`public/learner/buy-credits.html`). Every recommendation includes the reasoning behind it, the file(s) to change, and — where possible — concrete CSS/HTML guidance. This document also establishes design principles and a style guide that should be followed across all pages.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Style Guide & Design Tokens](#2-style-guide--design-tokens)
3. [Typography System](#3-typography-system)
4. [Component Standards](#4-component-standards)
5. [Homepage Improvements](#5-homepage-improvements-publicindexhtml)
6. [Learner Portal Dashboard Improvements](#6-learner-portal-dashboard-improvements-publiclearnerindexhtml)
7. [Buy Credits Page Improvements](#7-buy-credits-page-improvements-publiclearnerbuy-creditshtml)
8. [Cross-Cutting Issues](#8-cross-cutting-issues)
9. [Accessibility Standards](#9-accessibility-standards)
10. [Implementation Priority](#10-implementation-priority)

---

## 1. Design Principles

These principles should guide every design decision across the CoachCarter website. When in doubt, refer back to these.

### 1.1 Clarity Over Cleverness
CoachCarter's audience is learner drivers (often 17-25 year olds) and their parents. Many will be anxious about learning to drive. Every screen should make it immediately obvious what the user can do and what they should do next. Avoid ambiguity in button states, navigation paths, and data displays.

**In practice**: If a button is disabled, it should look visibly disabled (greyed out, reduced opacity) AND have a tooltip or helper text explaining why. Never leave the user guessing.

### 1.2 Trust Through Transparency
Driving lessons are a high-commitment, high-cost purchase. The website must actively build trust at every opportunity. This means showing social proof (reviews, pass rates), being upfront about pricing, and using clear refund/cancellation language.

**In practice**: Every page that involves money should include reassurance content (refund policy, what you get, no hidden fees). Every page visible to new visitors should include at least one trust signal (star rating, testimonial quote, pass count).

### 1.3 Progress = Motivation
The Learner Portal exists to make learners feel like they're moving forward. Every data point should be presented in a way that feels encouraging and forward-looking, not clinical or discouraging. Use green/positive colours for achievements, avoid unexplained red indicators, and always show "what comes next."

**In practice**: Empty states should never feel like dead ends — always suggest the next action. Progress sections should show completion counts even when collapsed. Rating colours must have a visible legend.

### 1.4 Mobile-First, Always
Most learner drivers will access CoachCarter on their phones. Every layout, touch target, and font size must work comfortably on a 320px-wide screen. The desktop experience should be a graceful expansion of the mobile layout, not the other way around.

**In practice**: Touch targets must be minimum 44x44px. Bottom navigation labels must not truncate. Horizontally-laid-out elements (like the discount tier cards) must be tested at 320px and either stack or scroll gracefully.

### 1.5 One Primary Action Per Screen
Every screen should have exactly one visually dominant call-to-action. Secondary actions should be clearly subordinate. This prevents decision paralysis and guides the user through the intended flow.

**In practice**: Use filled orange (`--accent`) background for the primary CTA only. Secondary actions use outlined or text-style buttons. Never have two filled-orange buttons competing on the same screen.

---

## 2. Style Guide & Design Tokens

### 2.1 Unified CSS Variables

There is currently a consistency problem across files: the `:root` variables differ between pages. For example, `--bg` is `#f5f5f3` on the homepage, `#ffffff` on the learner portal, and `#f5f5f5` on the book page. `--border` is `#e8e8e8` on the homepage and `#e0e0e0` everywhere else. `--radius` is `16px` on the homepage and `14px` on all learner pages. `--green` is `#22c55e` on the learner portal but `#1a9e5c` on the lessons page.

**Action required**: Create a single shared CSS file (`public/styles/tokens.css`) OR adopt one canonical set of variables and copy it identically to every page. The canonical set should be:

```css
:root {
  /* Colours */
  --primary:    #272727;
  --accent:     #f58321;
  --accent-dk:  #e07518;
  --accent-lt:  #fff4ec;
  --accent-mid: rgba(245, 131, 33, 0.12);
  --muted:      #797879;
  --border:     #e0e0e0;
  --bg:         #f9f9f9;       /* Unified background — warm off-white */
  --surface:    #ffffff;       /* Card/container backgrounds */
  --white:      #ffffff;

  /* Semantic colours */
  --green:      #22c55e;
  --green-lt:   rgba(34, 197, 94, 0.12);
  --amber:      #f59e0b;
  --amber-lt:   rgba(245, 158, 11, 0.12);
  --red:        #ef4444;
  --red-lt:     rgba(239, 68, 68, 0.12);

  /* Typography */
  --font-head:  'Bricolage Grotesque', system-ui, sans-serif;
  --font-body:  'Lato', system-ui, sans-serif;

  /* Spacing & Radii */
  --radius:     14px;
  --radius-sm:  8px;
  --radius-lg:  16px;
}
```

**Why**: Inconsistent variables mean the site feels subtly "off" — borders don't match, backgrounds shift between pages, and roundness changes. A unified token set ensures visual coherence.

### 2.2 Colour Usage Rules

| Token | When to use | When NOT to use |
|-------|-------------|-----------------|
| `--accent` (#f58321) | Primary CTA fills, brand highlights in headings, active nav states, the credit balance banner | Body text (fails WCAG contrast on white), secondary UI elements |
| `--accent-dk` (#e07518) | Hover/active states for accent elements | As a standalone colour without a parent accent element |
| `--accent-lt` (#fff4ec) | Card backgrounds for accent-related content, icon backgrounds, subtle highlights | Large background areas (too close to white, looks like a rendering error) |
| `--primary` (#272727) | Headings, body text, high-emphasis labels | Backgrounds, borders |
| `--muted` (#797879) | Secondary text, labels, timestamps, helper text | Primary actions, headings |
| `--green` (#22c55e) | Positive indicators (always/usually ratings, checkmarks, progress bars) | Decorative use, buttons |
| `--amber` (#f59e0b) | Warning/moderate indicators (sometimes ratings, attention states) | — |
| `--red` (#ef4444) | Negative indicators (never ratings, errors, destructive actions) | Decorative dots without explanation (see session skill pills issue below) |

### 2.3 Shadow System

Use a consistent shadow scale across all cards and elevated elements:

```css
/* Level 1 — default card resting state */
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

/* Level 2 — hover / elevated card */
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);

/* Level 3 — modals, toasts, popovers */
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
```

Currently the homepage uses `0 6px 20px rgba(0,0,0,0.10)` on hover while learner cards use `0 1px 3px rgba(0,0,0,0.05)`. Standardise to the scale above.

---

## 3. Typography System

### 3.1 Current Fonts

The site currently uses:
- **Headings**: Bricolage Grotesque (weights 400, 500, 700, 800)
- **Body**: Lato (weights 300, 400, 700)

**Assessment**: This is a solid pairing. Bricolage Grotesque is a characterful display font that gives CoachCarter personality, and Lato is a reliable, highly-readable body font. No change recommended for the core pairing.

### 3.2 Font Recommendations (Optional Improvements)

If you want to refresh the typography, here are two alternatives that would enhance readability and personality while maintaining the approachable, professional tone:

**Option A — Keep Bricolage Grotesque, upgrade body font:**
- Headings: Bricolage Grotesque (no change)
- Body: **Inter** (replace Lato)
- Why: Inter is purpose-built for screens, has better number rendering (useful for stats/pricing), superior small-size legibility, and a larger x-height than Lato. It's available on Google Fonts.
- Google Fonts import: `family=Inter:wght@400;500;600;700`

**Option B — Full refresh for a more modern feel:**
- Headings: **Plus Jakarta Sans** (replace Bricolage Grotesque)
- Body: **Inter** (replace Lato)
- Why: Plus Jakarta Sans has a warm, geometric personality similar to Bricolage Grotesque but with cleaner lines that scale better at small sizes (e.g. in stat pills and badges). Inter as body text is the industry standard for web apps.
- Google Fonts import: `family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700`

**If no font change is made**, the existing pairing works well. The important thing is consistent usage (see below).

### 3.3 Type Scale

Standardise the following type scale across all pages. Currently, font sizes are scattered (e.g. `1.55rem`, `1.35rem`, `0.92rem`, `0.82rem`, `0.78rem`, `0.75rem`, `0.72rem`, `0.7rem`, `0.68rem` — too many similar sizes creating visual noise rather than clear hierarchy).

| Name | Size | Weight | Font Family | Use |
|------|------|--------|-------------|-----|
| `h1` | 1.75rem (28px) | 800 | `--font-head` | Page titles ("Buy Lesson Credits", "Hi, fraser carter") |
| `h2` | 1.25rem (20px) | 700 | `--font-head` | Section headings ("Add credits to your account") |
| `h3` | 1rem (16px) | 700 | `--font-head` | Card titles ("Speed & Control", "Learner Portal") |
| `body` | 0.9375rem (15px) | 400 | `--font-body` | Default body text, question text, descriptions |
| `body-sm` | 0.8125rem (13px) | 400 | `--font-body` | Secondary text, card subtitles, helper text |
| `caption` | 0.75rem (12px) | 600 | `--font-body` | Badges, chips, labels, section titles ("YOUR PROGRESS") |
| `caption-sm` | 0.6875rem (11px) | 600 | `--font-body` | Bottom nav labels, stat pill labels (smallest allowed size) |

**Rule**: Never use a font size smaller than `0.6875rem` (11px). Anything smaller is unreadable on mobile.

---

## 4. Component Standards

### 4.1 Buttons

Three button tiers, applied consistently everywhere:

```css
/* PRIMARY — one per screen, the main action */
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  padding: 14px 24px;
  font-family: var(--font-head);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.btn-primary:hover { background: var(--accent-dk); }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled {
  background: var(--border);
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.7;
}

/* SECONDARY — supporting actions */
.btn-secondary {
  background: var(--white);
  color: var(--accent);
  border: 1.5px solid var(--accent);
  border-radius: var(--radius);
  padding: 12px 20px;
  font-family: var(--font-head);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-secondary:hover { background: var(--accent-lt); }

/* GHOST — tertiary / minimal actions */
.btn-ghost {
  background: none;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.btn-ghost:hover { color: var(--primary); border-color: var(--primary); }
```

**Apply to existing buttons**:
- Homepage "Book Your Free Trial Lesson" → `btn-primary` (already correct)
- Dashboard "Buy Credits" → `btn-secondary` (currently white on orange — should be outlined)
- Dashboard "Book a Lesson" → should be `btn-secondary` when credits > 0, `btn-primary:disabled` when credits = 0
- "Sign out" → `btn-ghost` (already close)

### 4.2 Cards

All cards should share a base style:

```css
.card-base {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.15s, border-color 0.15s;
}

/* Interactive cards (clickable) — add hover effect */
.card-interactive:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border-color: var(--accent);
}
```

### 4.3 Section Headers

Currently section titles like "YOUR PROGRESS" and "RECENT SESSIONS" use uppercase + letter-spacing, which is fine. Standardise the exact style:

```css
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 12px;
}
```

This is already used in the learner portal — just make sure it's applied consistently on all pages.

### 4.4 Bottom Navigation

The bottom nav is consistent across learner pages. Two improvements needed:

1. **Increase touch target size**: Currently `padding: 10px 8px` — increase to `padding: 12px 8px` minimum, and ensure each item is at least 44px tall.
2. **Test label truncation**: "Log Session" is the longest label. At 320px viewport, ensure it doesn't clip. If it does, shorten to "Log" to match "Book."
3. **Replace emoji icons with SVG**: The emoji icons (📊, 📅, 💳, 📝) render inconsistently across devices and operating systems. Replace them with simple SVG icons (e.g. from Lucide or Heroicons) for a more professional look. Use `stroke: currentColor` so they inherit the active/inactive colour from the nav item.

---

## 5. Homepage Improvements (`public/index.html`)

### 5.1 Add Contact Information [CRITICAL]

**Problem**: CoachCarter is a local, trust-based service. Parents and learners want to ask a question before committing to a trial lesson. There is currently no phone number, email, or WhatsApp link visible anywhere on the homepage.

**Why this matters**: For a driving school, a large percentage of conversions come from a phone call or message. A learner's parent might want to ask "what area do you cover?" or "is the trial really free?" before booking. Without a visible contact method, these potential customers bounce.

**Implementation**: Add a contact card between the "Lessons & Pricing" card and the footer:

```html
<div class="divider">
  <hr><span>questions?</span><hr>
</div>

<a class="card" href="tel:+447XXXXXXXXX" aria-label="Call CoachCarter">
  <div class="card-icon">📞</div>
  <div class="card-text">
    <div class="card-label">Call or WhatsApp</div>
    <div class="card-sub">07XXX XXX XXX — we're happy to chat</div>
  </div>
  <div class="card-arrow">→</div>
</a>
```

Alternatively, add a sticky footer bar with a phone icon and WhatsApp icon that persists across the homepage.

### 5.2 Add Social Proof [HIGH PRIORITY]

**Problem**: There is zero social proof on the homepage — no reviews, no star ratings, no pass count, no testimonials. For a service business, this is a significant trust gap.

**Why this matters**: A prospective learner comparing CoachCarter to another driving school will choose the one that looks established and reviewed. Even a single line of social proof significantly increases conversion.

**Implementation**: Add a social proof line directly below the `<header>` tagline, before the cards:

```html
<div class="social-proof">
  ⭐ 4.9 on Google · 200+ learners · DVSA approved
</div>
```

Style it as:

```css
.social-proof {
  font-size: 0.82rem;
  color: var(--muted);
  margin-top: 8px;
  margin-bottom: -8px; /* Pull cards closer */
  letter-spacing: 0.01em;
}
```

Replace the placeholder numbers with real data. If review data isn't available yet, even "DVSA Approved Instructor · Reading, Berkshire" adds credibility.

### 5.3 Improve Section Divider Contrast

**Problem**: The "already a learner?" and "want to know more?" divider labels are low-contrast grey (`--muted`: #797879) on the page background (`--bg`: #f5f5f3). They provide useful wayfinding but are easy to miss.

**Action**: Keep the same style but increase contrast. Change the divider text colour to `--primary` (#272727) at a lighter weight, or use a slightly darker muted value:

```css
.divider span {
  font-size: 0.75rem;
  color: #5a5a5a;  /* Darker than current --muted */
  white-space: nowrap;
  font-weight: 500;
}
```

### 5.4 Give "Lessons & Pricing" Visual Priority for New Visitors

**Problem**: "Lessons & Pricing" is the most important card for prospective (non-logged-in) learners, but it looks identical to "Learner Portal" and "Classroom."

**Action**: Add a subtle visual differentiator — an orange left border or a light orange background:

```css
.card.highlight {
  border-left: 3px solid var(--accent);
}
```

Then add `class="card highlight"` to the Lessons & Pricing card.

### 5.5 Replace Emoji Icons with Consistent SVG Icons

**Problem**: The card icons use emoji characters (📅, 🎓, 🎬, 🚗). These render differently on every OS and device — they'll look completely different on an iPhone vs. a Samsung vs. a desktop browser. This makes the design feel inconsistent and unprofessional.

**Action**: Replace emojis with inline SVG icons from a consistent icon set (Lucide Icons recommended — lightweight, open source, consistent style). Example for the calendar icon:

```html
<div class="card-icon">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
</div>
```

Apply `color: var(--accent)` to `.card-icon` and `color: #fff` to `.card.primary .card-icon` so the SVGs inherit the right colours.

**This recommendation applies to ALL emoji usage across the entire site** — the bottom nav, session cards, stat pills, and any other emoji should be replaced with SVG icons for consistency.

---

## 6. Learner Portal Dashboard Improvements (`public/learner/index.html`)

### 6.1 Fix Session Skill Pill Labels [CRITICAL]

**Problem**: The session history shows skill pills with internal key names like "t1_move", "t1_stop", "t1_steer", "t1_mirrors", "t1_mice", "t1_eval". These are database column names leaking into the UI. A learner has no idea what "t1_mice" means.

**Why this matters**: This is the single most obvious bug-like issue on the entire site. It makes the Recent Sessions section useless and damages trust — it looks like the app is broken.

**Where the issue lives**: In the `renderSessions()` function (around line 826), the `findQuestionLabel()` function tries to match `skill_key` against the QUESTIONS array. If no match is found, it falls back to displaying the raw key. The keys like `t1_move`, `t1_stop` don't match any QUESTIONS entry (those use `q1_speed_react`, `q2_speed_lane`, etc.), so the raw keys are shown.

**Fix**: Add a mapping for these legacy/alternate keys. Add this object near the top of the `<script>`:

```javascript
const SKILL_KEY_LABELS = {
  't1_move':    'Moving off',
  't1_stop':    'Stopping',
  't1_steer':   'Steering',
  't1_mirrors': 'Mirror checks',
  't1_mice':    'MICE routine',
  't1_eval':    'Overall assessment',
  // Add any other legacy keys as they appear
};
```

Then update `findQuestionLabel()`:

```javascript
function findQuestionLabel(key) {
  // Check custom mapping first
  if (SKILL_KEY_LABELS[key]) return SKILL_KEY_LABELS[key];
  // Then check questions array
  const q = QUESTIONS.find(q => q.key === key);
  if (q) {
    const words = q.text.split(' ');
    return words.slice(0, 4).join(' ') + (words.length > 4 ? '...' : '');
  }
  // Last resort: humanise the key
  return key.replace(/^[a-z]\d+_/, '').replace(/_/g, ' ');
}
```

### 6.2 Add Colour Legend for Rating Dots [CRITICAL]

**Problem**: The coloured dots next to session skill pills use green, light green, amber, and red to indicate ratings — but there's no legend. Without context, the red dots look alarming and discouraging.

**Action**: Add a small legend below the session ratings, or add it once at the top of the "Recent Sessions" section:

```html
<div class="rating-legend">
  <span><span class="dot" style="background: #22c55e;"></span> Always</span>
  <span><span class="dot" style="background: #86efac;"></span> Usually</span>
  <span><span class="dot" style="background: #f59e0b;"></span> Sometimes</span>
  <span><span class="dot" style="background: #ef4444;"></span> Needs work</span>
</div>
```

```css
.rating-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.72rem;
  color: var(--muted);
  margin-bottom: 12px;
}
.rating-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
```

**Also consider**: Changing the "never" label to "Needs work" — the word "never" feels harsh and discouraging for a learner driver.

### 6.3 Add Progress Indicators to Collapsed Accordion Headers

**Problem**: When the progress groups (Speed & Control, Looking Around, etc.) are collapsed, the user has no idea how they're doing without opening each one. This defeats the purpose of a dashboard — you should see status at a glance.

**Current state**: The code already shows a percentage on the header when `ratedCount > 0` (around line 730). However, when no questions are rated (which is the default for new users), there's no indicator at all.

**Action**: Show a "0/3 rated" or "3/3 rated" count on the right side of every collapsed header, in addition to the existing percentage:

In the `renderProgressCard()` function, update the header right section:

```javascript
// Replace the existing right-side content with:
<div style="display:flex;align-items:center;gap:10px;">
  <span style="font-size:0.75rem;color:var(--muted);">${ratedCount}/${questions.length}</span>
  ${ratedCount > 0 ? `<span style="font-size:0.8rem;font-weight:700;color:${pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'}">${pct}%</span>` : ''}
  <span class="chevron${expanded ? ' open' : ''}" id="${chevId}">▼</span>
</div>
```

### 6.4 Clarify the "Book a Lesson" Button State

**Problem**: When credits = 0, the "Book a Lesson →" button has its opacity reduced to 0.5 and pointer-events set to none (line 630-634). But visually it still looks like a button — there's no explanation of WHY it's not working.

**Action**: Replace the inline JS opacity hack with a proper disabled state and add explanatory text:

```javascript
if (bal === 0) {
  const bookBtn = document.getElementById('book-btn');
  bookBtn.classList.add('disabled');
  bookBtn.setAttribute('aria-disabled', 'true');
  bookBtn.title = 'Buy credits to book a lesson';
  bookBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Optionally: flash the "Buy Credits" button or scroll to it
  });
}
```

```css
.btn-book-lesson.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: auto; /* Keep it clickable so we can show a helpful response */
}
```

### 6.5 Improve Empty State for Stats Bar

**Problem**: When a new user arrives with 0 sessions, the stats bar shows "0 / Sessions", "0.0 / Hours logged", "0 / With instructor", "0 / Private practice". This is a wall of zeroes that doesn't motivate action.

**Action**: Consider hiding the stats bar entirely until the user has at least 1 session, and replacing it with a motivational empty state:

```html
<div class="stats-empty">
  <p>Complete your first session to start tracking your stats here.</p>
</div>
```

Or, if showing zeroes is preferred, at least change "0.0" hours to "0" (drop the decimal for zero):

```javascript
const hours = s.total_minutes / 60;
document.getElementById('stat-hours').textContent = hours === 0 ? '0' : hours.toFixed(1);
```

### 6.6 Replace the Clock SVG on the Balance Card

**Problem**: On the buy-credits page, there's an orange clock SVG icon next to the balance card. Its purpose is unclear — it could mean "pending", "history", "time-based credits", or nothing at all. It draws the eye without communicating meaning.

**Action**: Either remove it, or replace it with a functional icon. Suggestions:
- A "+" icon that links to buy-credits.html (makes it a quick shortcut)
- A wallet/credit card icon (reinforces that this is about money)
- Remove it entirely to simplify the card

---

## 7. Buy Credits Page Improvements (`public/learner/buy-credits.html`)

### 7.1 Make Package Selection State Visible [CRITICAL]

**Problem**: When a user taps a discount tier card (e.g. "12 hrs / 10% off"), the stepper updates and the tier card gets an `.active` class — but the active state (`border-color: var(--accent); background: var(--accent-lt)`) is visually subtle. More importantly, when the page first loads with qty=1, NO tier card is active, which makes it unclear that the tiers are interactive at all.

**Current state**: The code at line 586-588 correctly toggles the `.active` class. The CSS at line 225-228 applies a border and background change.

**Action**: Make the active state more prominent:

```css
.tier-card.active {
  border-color: var(--accent);
  background: var(--accent-lt);
  box-shadow: 0 0 0 2px var(--accent); /* Double-ring for emphasis */
  transform: translateY(-2px);
}
```

Also add a subtle animation when a tier is selected:

```css
.tier-card {
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
}
```

### 7.2 Add "Most Popular" Badge to Recommended Package

**Problem**: First-time buyers face 5 equal-looking tier options plus a stepper. This creates decision paralysis. Learners don't know how many hours they'll need, so they have no basis for choosing.

**Action**: Add a "Most popular" badge to the 12-hour (8 credits) tier:

```html
<div class="tier-card" onclick="updateQty(8)" data-credits="8" style="position: relative;">
  <div class="popular-badge">Most popular</div>
  <div class="tier-hours">12 hrs</div>
  <div class="tier-discount">10% off</div>
  <div class="tier-credits">8 credits</div>
</div>
```

```css
.popular-badge {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

### 7.3 Reframe Packages Around Hours

**Problem**: The tier cards show "6 hrs" in small grey text and "5% off" in large orange text. But learners think in hours ("how many hours do I need to pass?"), not in discount percentages. The hours should be the headline.

**Action**: Swap the visual hierarchy:

```html
<div class="tier-card" onclick="updateQty(4)" data-credits="4">
  <div class="tier-hours">6 hrs</div>        <!-- Make this the largest text -->
  <div class="tier-discount">Save 5%</div>    <!-- Make this secondary -->
  <div class="tier-credits">4 credits</div>
</div>
```

```css
.tier-hours {
  font-family: var(--font-head);
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--primary);
  margin-bottom: 4px;
}
.tier-discount {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent);
}
.tier-credits {
  font-size: 0.7rem;
  color: var(--muted);
  margin-top: 2px;
}
```

**Also consider**: Showing the effective per-lesson price on each tier (e.g. "£74.25/lesson") since this is what learners will compare against competitors.

### 7.4 Default to a Recommended Package

**Problem**: The page loads with qty=1, showing the highest per-unit price (£82.50) and no active tier card. This is the worst possible first impression for conversion.

**Action**: Default to the most popular package. Change the init call at line 642:

```javascript
// Change from:
updateQty(1);
// To:
updateQty(8); // Default to 12hrs / 10% off — the most popular package
```

This shows a more attractive price point immediately and highlights the value of bulk buying.

### 7.5 Improve Klarna Visibility

**Problem**: "Pay in 3 with Klarna" is plain text below the checkout button. For a purchase that could be £500+, installment options are a genuine decision factor for young learners and parents.

**Action**: Give it a card treatment with the Klarna logo:

```html
<div class="klarna-card">
  <img src="https://x.klarnacdn.net/payment-method/assets/badges/generic/klarna.svg"
       alt="Klarna" width="60" height="20">
  <div>
    <strong>Pay in 3 interest-free instalments</strong>
    <span>e.g. 3 × £<span id="klarnaInstalment">27.50</span>/month</span>
  </div>
</div>
```

```css
.klarna-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fce4ec;  /* Klarna's pink-ish brand colour, very subtle */
  border: 1px solid #f8bbd0;
  border-radius: var(--radius-sm);
  padding: 14px 18px;
  margin-top: 16px;
  font-size: 0.85rem;
}
.klarna-card span {
  display: block;
  font-size: 0.78rem;
  color: var(--muted);
  margin-top: 2px;
}
```

Update the instalment amount dynamically in the `updateQty()` function:

```javascript
const instalmentAmount = (total / 3 / 100).toFixed(2);
document.getElementById('klarnaInstalment').textContent = instalmentAmount;
```

### 7.6 Disable Minus Button at Minimum

**Problem**: The minus button should be visually disabled when qty = 1.

**Current state**: The code at line 559 already sets `btnMinus.disabled = qty <= 1`. The CSS at line 191 styles `:disabled` with `color: var(--border)`.

**Assessment**: This is already handled correctly. Just verify it works visually — the disabled button should look clearly inactive (not just slightly lighter).

---

## 8. Cross-Cutting Issues

### 8.1 Inconsistent `--bg` Background Colour

**Files affected**: ALL HTML files.

The background colour varies:
- `index.html`: `--bg: #f5f5f3`
- `learner/index.html`: `--bg: #ffffff`
- `learner/buy-credits.html`: `--bg: #ffffff`
- `learner/book.html`: `--bg: #f5f5f5`
- `learner/log-session.html`: `--bg: #ffffff`
- `lessons.html`: `--bg: #ffffff`

**Action**: Decide on ONE background colour and use it everywhere. Recommendation: `#f9f9f9` (very light warm grey) — it's close to white but provides enough contrast to make white cards visually "float" above the background, which helps define card boundaries. Pure white backgrounds make white cards invisible.

If the learner portal pages should feel different from the marketing pages, that's fine — but document it explicitly as a design decision, not leave it as an inconsistency.

### 8.2 Inconsistent `--border` Colour

- `index.html`: `--border: #e8e8e8`
- All other pages: `--border: #e0e0e0`

**Action**: Standardise to `#e0e0e0` everywhere.

### 8.3 Inconsistent `--radius`

- `index.html`: `--radius: 16px`
- All learner pages: `--radius: 14px`

**Action**: Standardise to `14px` everywhere (the 2px difference is barely visible but creates inconsistency in the code).

### 8.4 Header Inconsistencies

The homepage has no sticky header (it's a centered, full-page layout). The learner portal pages all have a sticky header with the brand, but the header background varies:
- `learner/index.html`: `background: var(--white)`
- `learner/log-session.html`: `background: var(--surface)` (which is #f9f9f9)

**Action**: All sticky headers should use `background: var(--white)` with `border-bottom: 1px solid var(--border)`.

### 8.5 No Shared CSS File

Every page duplicates the full CSS in a `<style>` block. This means every change requires updating multiple files, and inconsistencies creep in easily.

**Recommendation**: Create `public/styles/shared.css` containing:
- CSS reset
- `:root` variables (tokens)
- Header styles
- Bottom nav styles
- Button styles
- Card base styles
- Section title styles
- Typography utilities

Then each page only needs page-specific styles in its `<style>` block. This is the single most impactful architectural change for maintainability.

---

## 9. Accessibility Standards

All changes should meet WCAG 2.1 AA as a minimum. Specific issues to fix:

### 9.1 Colour Contrast

| Element | Current | Issue | Fix |
|---------|---------|-------|-----|
| White text on `--accent` (#f58321) | ~3.2:1 | Fails AA for normal text | Use `--accent-dk` (#e07518) for backgrounds with white text, OR increase font-weight to 700+ and size to 18px+ (passes AA for large text) |
| `--muted` (#797879) on `--bg` (#f5f5f3) | ~4.0:1 | Borderline for AA normal text | Darken muted to `#6b6b6b` for text that isn't large/bold |
| Orange discount text on white | ~3.2:1 | Fails AA for small text | Acceptable for large bold text (tier headings), but the small "4 credits" label below needs a darker colour |
| "Not rated" badge (`--muted` on `--surface`) | ~4.5:1 | Passes | No change needed |

### 9.2 Touch Targets

- Bottom nav items: Ensure minimum 44px height (currently close but verify on real devices)
- The quantity stepper buttons (+/-): Already 44x44px. Good.
- Footer links ("Privacy · Terms"): Currently rely on text size alone. Add padding to create 44x44px tap area:

```css
.footer a {
  display: inline-block;
  padding: 8px 12px;
  margin: -8px -12px; /* Offset the padding so layout doesn't shift */
}
```

### 9.3 Screen Reader Improvements

- **Stat pills**: Wrap number and label in a single `aria-label`. Instead of a screen reader announcing "1" then "Sessions" as separate elements, use `aria-label="1 session"`.
- **Progress accordion headers**: Add `aria-expanded="true/false"` attribute that toggles with the accordion state.
- **Tier cards**: Add `role="radio"` and `aria-checked="true/false"` to make the package selection accessible. Wrap all tiers in a `role="radiogroup"` with `aria-label="Choose a credit package"`.
- **Session skill pills**: Add `aria-label` that includes the rating (e.g. `aria-label="Moving off: Always"`).

### 9.4 Focus Styles

There are no visible `:focus` styles anywhere in the CSS. This means keyboard users can't see which element is focused.

**Action**: Add a global focus style:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Add this to every page's CSS, or include it in the shared CSS file.

---

## 10. Implementation Priority

Ordered by impact and effort. Tackle these in order:

### Phase 1 — Critical Fixes (do first)
1. **Fix session skill pill labels** (6.1) — Bug that makes the UI look broken
2. **Add colour legend for rating dots** (6.2) — Confusing without explanation
3. **Clarify the "Book a Lesson" disabled state** (6.4) — Ambiguous UI
4. **Make tier card selection state visible** (7.1) — Confusion at point of purchase
5. **Unify CSS variables across all pages** (8.1–8.4) — Foundation for consistency

### Phase 2 — High-Impact Improvements
6. **Add contact information to homepage** (5.1) — Missing conversion path
7. **Add social proof to homepage** (5.2) — Trust gap
8. **Default buy-credits to recommended package** (7.4) — Better first impression
9. **Add "Most popular" badge** (7.2) — Reduces decision paralysis
10. **Reframe tier cards around hours** (7.3) — Matches how learners think
11. **Add progress indicators to collapsed accordions** (6.3) — Dashboard usefulness

### Phase 3 — Polish & Accessibility
12. **Replace all emoji with SVG icons** (5.5) — Cross-device consistency
13. **Fix colour contrast issues** (9.1) — WCAG compliance
14. **Add focus styles** (9.4) — Keyboard accessibility
15. **Improve touch targets** (9.2) — Mobile usability
16. **Add screen reader improvements** (9.3) — Assistive technology support
17. **Improve Klarna visibility** (7.5) — Conversion for high-value purchases

### Phase 4 — Architecture
18. **Create shared CSS file** (8.5) — Long-term maintainability
19. **Standardise type scale** (3.3) — Visual consistency
20. **Standardise button and card components** (4.1–4.2) — Design system foundation

---

## Appendix: File Reference

| File | Description |
|------|-------------|
| `public/index.html` | Homepage — link tree style landing page |
| `public/lessons.html` | Marketing/pricing page for prospective learners |
| `public/learner/index.html` | Learner Portal dashboard (authenticated) |
| `public/learner/buy-credits.html` | Credit purchase page with Stripe checkout |
| `public/learner/book.html` | Lesson booking calendar |
| `public/learner/log-session.html` | Session logging form with skill ratings |
| `public/learner/login.html` | Authentication page |
| `public/classroom.html` | Driving video library |
| `public/privacy.html` | Privacy policy |
| `public/terms.html` | Terms of service |
