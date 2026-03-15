# CoachCarter Website — Project Reference

A complete reference for the CoachCarter driving instructor website. Use this when continuing development with an AI assistant — paste it in at the start of a new session so the AI is fully up to speed.

---

## What the site is

A driving instructor website for CoachCarter (Fraser). It has three distinct areas:

- **Public marketing site** — homepage, pricing, availability, about, contact
- **Learner portal** — private area where learners log driving sessions and track their progress
- **Classroom** — a public video library with a mobile-first reels-style UI

---

## Hosting & deployment

- **Platform:** Vercel (serverless)
- **Repo:** `https://github.com/coachcarteruk-gif/coachcarter-website.git` (branch: `main`)
- **Deploy:** Automatic on push to `main`
- **Database:** Neon Postgres (serverless) — connection string in `POSTGRES_URL` env var
- **Push to deploy:** `git push` from terminal triggers a Vercel build automatically

### Environment variables (set in Vercel dashboard)

| Variable | Purpose |
|---|---|
| `POSTGRES_URL` | Neon Postgres connection string |
| `JWT_SECRET` | Signs learner auth tokens (30-day expiry) |
| `MAINTENANCE_MODE` | Set to `"true"` to redirect all traffic to maintenance page |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |

---

## Project structure

```
/
├── api/                        # Vercel serverless functions
│   ├── learner.js              # Learner portal: register, login, sessions, progress
│   ├── availability.js         # Read/write availability slots
│   ├── submit-enquiry.js       # Contact form submissions
│   ├── get-enquiries.js        # Admin: list enquiries
│   ├── get-enquiry.js          # Admin: single enquiry
│   ├── update-enquiry-status.js
│   ├── create-checkout-session.js  # Stripe checkout
│   ├── verify-session.js       # Stripe payment verification
│   ├── webhook.js              # Stripe webhook handler
│   ├── status.js               # Health check
│   ├── config.js               # Shared config helpers
│   └── update-statis.js        # (legacy status update)
│
├── public/                     # Static files served directly
│   ├── index.html              # Homepage (main marketing page)
│   ├── classroom.html          # Video reels page (public)
│   ├── availability.html       # Availability/booking page
│   ├── learner-journey.html    # Marketing page for the learner portal
│   ├── admin.html              # Admin login
│   ├── admin-availability.html # Admin availability management
│   ├── admin/
│   │   ├── dashboard.html      # Admin enquiry dashboard
│   │   └── editor.html         # Admin content editor
│   ├── learner/
│   │   ├── index.html          # Learner hub — main landing page (choose where to go)
│   │   ├── login.html          # Login / register form
│   │   ├── dashboard.html      # Learner progress dashboard
│   │   └── log-session.html    # Log a driving session
│   ├── videos.json             # Video library data (edit to add/remove videos)
│   ├── config.json             # Site config
│   ├── Logo.png                # CoachCarter logo
│   ├── success.html            # Post-payment success page
│   ├── maintenance.html        # Maintenance mode page
│   ├── privacy.html
│   └── terms.html
│
├── middleware.js               # Vercel middleware — handles maintenance mode redirect
├── vercel.json                 # Route config: /api/* → api/, everything else → public/
└── package.json
```

---

## Routing

`vercel.json` defines two rules:

```json
{ "src": "/api/(.*)", "dest": "/api/$1" }
{ "src": "/(.*)",     "dest": "/public/$1" }
```

So `/classroom.html` serves `public/classroom.html`, `/api/learner?action=login` calls `api/learner.js`, etc.

---

## Learner portal

### How it works

Learners register/login at `/learner/` (email + password). A JWT is issued and stored in `localStorage` under the key `cc_learner` as `{ token, user }`. All subsequent API calls include the token as a `Bearer` header.

### API — `api/learner.js`

All requests go to `/api/learner?action=<action>`.

| Action | Method | Auth | Description |
|---|---|---|---|
| `register` | POST | No | Create account. Body: `{ name, email, password }` |
| `login` | POST | No | Returns JWT. Body: `{ email, password }` |
| `sessions` | GET | Yes | Returns last 20 sessions with skill ratings |
| `sessions` | POST | Yes | Save a new session |
| `progress` | GET | Yes | Returns latest skill ratings, stats, current tier |

### Database tables

**`learner_users`**
```
id SERIAL PRIMARY KEY
name TEXT
email TEXT UNIQUE
password_hash TEXT
current_tier INTEGER DEFAULT 1
created_at TIMESTAMPTZ
```

**`driving_sessions`**
```
id SERIAL PRIMARY KEY
user_id INTEGER
session_date DATE
duration_minutes INTEGER
session_type TEXT  -- 'instructor' or 'private'
notes TEXT         -- overall session notes
created_at TIMESTAMPTZ
```

**`skill_ratings`**
```
id SERIAL PRIMARY KEY
session_id INTEGER
user_id INTEGER
tier INTEGER
skill_key TEXT     -- e.g. 'speed_control', 'junctions'
rating TEXT        -- 'green', 'amber', 'red'
note TEXT          -- per-question note added by learner (nullable)
created_at TIMESTAMPTZ
```

Tables are created automatically on first use (CREATE TABLE IF NOT EXISTS). The `note` column was added later with `ALTER TABLE skill_ratings ADD COLUMN IF NOT EXISTS note TEXT` — this runs on every request to handle existing databases safely.

### The 10-question self-assessment

When logging a session (`log-session.html`), the learner answers 10 questions across 4 driving groups. Each question gets a green/amber/red rating and an optional per-question note (toggled with a ✎ button). The groups and questions are:

**Speed & Control** — Acceleration smoothly, Braking progressively, Appropriate speed for conditions

**Looking Around** — Effective observation at junctions, Checking mirrors regularly, Awareness of road positioning

**Junctions & Roundabouts** — Correct approach and positioning, Giving way correctly

**Reversing** — Controlled speed when reversing, Effective all-round observation

The dashboard (`dashboard.html`) shows the latest rating for each question as a colour-coded grid, plus a session history list that includes the per-question notes inline.

---

## Classroom (video reels)

### How it works

`/classroom.html` is a full-screen mobile-first page where learners scroll through short driving videos like Instagram Reels or YouTube Shorts. Videos are organised into 4 groups matching the assessment categories.

### Video hosting — Cloudflare Stream

- Customer subdomain: `customer-qn21p6ogmlqlhcv4.cloudflarestream.com`
- Each video has a UID (e.g. `7e36d845f1a0d80c57ebf7ef969c2572`)
- HLS manifest URL: `https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/{uid}/manifest/video.m3u8`
- Videos are publicly accessible — no authentication needed

### Technical approach

**Iframes were abandoned.** Cloudflare Stream iframes use internal nested frames, making it impossible to reliably control mute/unmute via `postMessage`. After several failed approaches, the page was rewritten to use native `<video>` elements.

Current approach:
- Native `<video>` elements with `object-fit: cover`, `playsinline`, `loop`, `muted`
- **HLS.js** (`cdn.jsdelivr.net/npm/hls.js@1.5.7`) loads the HLS manifest on non-Safari browsers
- Safari uses its native HLS support (detected via `canPlayType('application/vnd.apple.mpegurl')`)
- `IntersectionObserver` (threshold 0.6) triggers `attachHls(uid)` when a video scrolls into view and `detachHls(uid)` when it scrolls out — this prevents audio bleed and saves bandwidth
- `video.muted = false` for direct mute control — no cross-origin messaging
- CSS `scroll-snap-type: y mandatory` + `scroll-snap-align: start` for the snap-scroll behaviour
- Global `globalMuted` boolean — user only needs to unmute once; all subsequent videos play with sound

### Adding videos — `public/videos.json`

Edit this file to add or remove videos:

```json
[
  {
    "uid": "7e36d845f1a0d80c57ebf7ef969c2572",
    "title": "Smooth acceleration",
    "description": "How to build speed progressively from a standstill.",
    "group": "speed-control"
  }
]
```

Valid group values: `speed-control`, `looking-around`, `junctions`, `reversing`

Upload videos to Cloudflare Stream dashboard, copy the UID, add an entry here, commit and push.

---

## Maintenance mode

Set `MAINTENANCE_MODE=true` in Vercel environment variables to redirect all visitors to `/maintenance.html`. The API routes (`/api/*`) are exempt and still function. Change back to `false` (or delete the variable) to restore normal traffic. Handled by `middleware.js`.

---

## Design system

The site uses a consistent dark theme across all pages:

```css
--bg: #0a0c10        /* page background */
--surface: #13161f   /* card / panel background */
--border: #1e2230    /* dividers */
--text: #e8eaf2      /* body text */
--muted: #6b7280     /* secondary text */
--blue: #4f6ef7      /* primary accent */
--green: #22c55e
--amber: #f59e0b
--red: #ef4444
--radius: 14px
```

Font: Inter (Google Fonts). All pages link to it via `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">`.

---

## Known gotchas

- **JWT_SECRET must be set in Vercel** for the learner portal to work. Without it, all auth endpoints return 500.
- **Neon Postgres cold starts** — the first request after inactivity may be slow (~1–2s). Subsequent requests are fast.
- **HLS.js CDN** — the classroom page loads HLS.js from jsDelivr. If that CDN is slow, video load will be delayed. Consider self-hosting if this becomes an issue.
- **videos.json is the source of truth** for the classroom — there's no admin UI for it yet. Edit the file directly in the repo and push.
- **Mobile autoplay policy** — browsers require videos to start muted. The classroom does this correctly. `video.muted = false` after a user gesture is what unlocks sound.
- `api/update-statis.js` appears to be a legacy file with a typo in the name — treat carefully.

---

## Potential next features

- Admin UI for managing videos.json (drag to reorder, add/remove without editing code)
- Learner portal: instructor can view a learner's progress dashboard
- Notifications / reminders for learners to log sessions
- More video groups or sub-categories in the classroom
- Stripe integration for lesson booking payments (foundation already exists in api/)
