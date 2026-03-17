# CoachCarter Website — Project Reference

A complete reference for the CoachCarter driving instructor website. Use this when continuing development with an AI assistant — paste it in at the start of a new session so the AI is fully up to speed.

---

## What the site is

A driving instructor website for CoachCarter (Fraser). It has five distinct areas:

- **Public marketing site** — homepage, pricing, availability, about, contact
- **Learner portal** — private area where learners log driving sessions, track progress, buy credits, and book lessons
- **Instructor portal** — private area where instructors view their schedule, manage availability, and update their profile
- **Admin portal** — internal tool for managing instructors, bookings, and availability
- **Classroom** — a public video library with a mobile-first reels-style UI

---

## Hosting & deployment

- **Platform:** Vercel Pro (upgraded to support >12 serverless functions)
- **Repo:** `https://github.com/coachcarteruk-gif/coachcarter-website.git` (branch: `main`)
- **Deploy:** Automatic on push to `main`
- **Database:** Neon Postgres (serverless) — connection string in `POSTGRES_URL` env var
- **Push to deploy:** `git push` from terminal triggers a Vercel build automatically

### Environment variables (set in Vercel dashboard)

| Variable | Purpose |
|---|---|
| `POSTGRES_URL` | Neon Postgres connection string |
| `JWT_SECRET` | Signs learner, instructor, and admin auth tokens |
| `MAINTENANCE_MODE` | Set to `"true"` to redirect all traffic to maintenance page |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `SMTP_HOST` | SMTP email host (booking confirmations, magic links) |
| `SMTP_PORT` | SMTP port (465 for secure) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `BASE_URL` | Site base URL for magic links (defaults to `https://coachcarter.uk`) |

---

## Project structure

```
/
├── api/                            # Vercel serverless functions
│   ├── learner.js                  # Learner sessions, progress, profile updates
│   ├── magic-link.js               # Learner magic-link login: send, validate, verify
│   ├── credits.js                  # Credit balance, Stripe checkout, bulk discounts
│   ├── slots.js                    # Slot generation, booking, cancellation, my-bookings, pay-per-slot checkout
│   ├── instructors.js              # Instructor CRUD + availability (admin-protected)
│   ├── instructor.js               # Instructor portal: magic-link login, schedule, profile
│   ├── admin.js                    # Admin auth (JWT), dashboard stats, bookings management
│   ├── calendar.js                 # iCal feed + .ics download for learners
│   ├── availability.js             # Read/write public availability slots
│   ├── enquiries.js                # Contact form: submit, list, update status
│   ├── webhook.js                  # Stripe webhook handler
│   ├── create-checkout-session.js  # Legacy Stripe checkout (pass guarantee / packages)
│   ├── verify-session.js           # Stripe payment verification
│   ├── update-status.js            # Booking status update
│   ├── status.js                   # Health check endpoint
│   └── config.js                   # Shared config helpers
│
├── public/                         # Static files served directly
│   ├── index.html                  # Homepage (main marketing page)
│   ├── classroom.html              # Video reels page (public)
│   ├── availability.html           # Availability/booking page
│   ├── learner-journey.html        # Marketing page for the learner portal
│   ├── lessons.html                # Lessons / pricing page
│   ├── admin.html                  # Redirect shim → /admin/login.html
│   ├── admin-availability.html     # Standalone admin availability management
│   ├── success.html                # Post-payment success page
│   ├── maintenance.html            # Maintenance mode page
│   ├── privacy.html
│   ├── terms.html
│   ├── admin/
│   │   ├── login.html              # Admin login (JWT auth)
│   │   ├── portal.html             # Full admin portal (dashboard, instructors, availability, bookings)
│   │   ├── dashboard.html          # Admin enquiry dashboard
│   │   └── editor.html             # Admin content editor
│   ├── learner/
│   │   ├── index.html              # Learner hub — dashboard (credits, bookings, progress)
│   │   ├── login.html              # Magic-link login (email or SMS)
│   │   ├── verify.html             # Token verification page (two-step: validate then verify)
│   │   ├── book.html               # Lesson booking calendar (credit or pay-per-slot)
│   │   ├── buy-credits.html        # Buy lesson credits via Stripe
│   │   ├── log-session.html        # Log a driving session (stepped wizard, emoji ratings)
│   │   └── videos.html             # Video library (behind login)
│   ├── instructor/
│   │   ├── login.html              # Magic-link login for instructors
│   │   ├── index.html              # Instructor dashboard (schedule, lesson completion)
│   │   ├── availability.html       # Instructor sets their own weekly availability
│   │   └── profile.html            # Instructor updates bio and contact details
│   ├── videos.json                 # Video library data (edit to add/remove videos)
│   ├── config.json                 # Site config
│   └── Logo.png                    # CoachCarter logo
│
├── db/
│   ├── migrations/                 # SQL files — run manually in Neon SQL Editor
│   │   ├── 001_booking_system.sql  # Core booking tables
│   │   ├── 002_admin_users.sql     # Admin users table
│   │   ├── 003_calendar_token.sql  # iCal token column on learner_users
│   │   └── 004_instructor_portal.sql # Instructor magic-link tokens
│   └── seeds/                      # Placeholder data for testing
│
├── middleware.js                   # Vercel middleware — maintenance mode redirect
├── vercel.json                     # Route config
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

**API pattern:** All related endpoints are grouped into a single file using `?action=` routing (e.g. `/api/slots?action=available`, `/api/slots?action=book`).

---

## Design system

The site uses a consistent dark charcoal theme matching the CoachCarter logo exactly.

```css
--navy:     #262626   /* primary dark background — charcoal black from logo */
--navy-2:   #2e2e2e   /* card / panel background */
--navy-3:   #383838   /* elevated surfaces */
--orange:   #f58321   /* primary accent — matches logo orange exactly */
--orange-dk:#e07518   /* hover / pressed state */
--orange-lt:#fff4e8   /* light orange tint */
--text:     #e8eaf0   /* body text on dark backgrounds */
--muted:    #6b7484   /* secondary / placeholder text */
--border:   #e2e4eb   /* dividers on light backgrounds */
```

Font: Inter (Google Fonts). All pages link to it via:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
```

---

## Booking & credit system

### How credits work

Each credit = one 1.5-hour lesson. Credits are stored as a balance on the learner's account and purchased via Stripe (Klarna available). Bulk discounts apply automatically:

| Credits | Hours | Discount |
|---|---|---|
| 4 | 6hrs | 5% off |
| 8 | 12hrs | 10% off |
| 12 | 18hrs | 15% off |
| 16 | 24hrs | 20% off |
| 20 | 30hrs | 25% off |

Base price: **£82.50 per credit** (set in `api/credits.js` as `CREDIT_PRICE_PENCE = 8250`).

### How booking works

- Instructors set recurring weekly availability windows (admin or self-service via instructor portal)
- The slot engine (`api/slots.js`) divides windows into 1.5-hour bookable slots
- Learners browse the calendar, filter by instructor (optional), and book any available slot
- Booking is instant — no instructor approval needed
- **With credits:** 1 credit deducted on booking; returned automatically on 48+ hour cancellations
- **Without credits (pay-per-slot):** Slot reserved for 10 minutes during Stripe Checkout; on payment confirmation, 1 credit added + deducted atomically, booking created, .ics calendar attachment sent to both parties
- Race condition protection via DB unique index on `(instructor_id, scheduled_date, start_time)` + slot reservations table

### Cancellation policy

- 48+ hours notice → credit returned automatically
- Under 48 hours → credit forfeited, learner informed at time of cancellation

---

## Learner portal

### Authentication

Magic-link login at `/learner/login.html` — learner enters email (or phone), receives a link, clicks it to sign in. No password needed. New accounts are created automatically on first login with 1 free trial credit.

JWT stored in `localStorage` as `cc_learner: { token, user }`. All API calls include it as a `Bearer` header.

### API — `api/magic-link.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `send-link` | POST | No | Sends magic link to email or phone. Body: `{ email, phone, method }` |
| `validate` | GET | No | Lightweight token check (does NOT consume). Prevents email prefetchers from burning tokens |
| `verify` | POST | No | Consumes token, issues JWT, auto-creates account if new. Body: `{ token }` |

### API — `api/learner.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `sessions` | GET | Yes | Returns last 20 sessions with skill ratings |
| `sessions` | POST | Yes | Save a new session |
| `progress` | GET | Yes | Returns latest skill ratings, stats, current tier |
| `update-name` | POST | Yes | Set learner name (used after first magic-link login) |

### API — `api/credits.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `balance` | GET | Yes | Returns current credit balance |
| `checkout` | POST | Yes | Creates Stripe checkout session with bulk discount logic |

### API — `api/slots.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `available` | GET | Yes | Available slots in date range, grouped by date (excludes reserved slots) |
| `book` | POST | Yes | Book a slot using 1 credit |
| `checkout-slot` | POST | Yes | Pay-per-slot: reserves slot for 10 min, creates Stripe Checkout (£82.50) |
| `cancel` | POST | Yes | Cancel a booking (returns credit if 48hr+ policy met) |
| `my-bookings` | GET | Yes | Learner's upcoming confirmed bookings |

### API — `api/calendar.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `download` | GET | JWT | Download `.ics` file for a single booking |
| `feed` | GET | Token | iCal feed for Apple/Google Calendar subscription (no JWT — uses per-learner token) |
| `feed-url` | GET | JWT | Returns the learner's personalised iCal feed URL |

### Database tables

**`learner_users`**
```sql
id SERIAL PRIMARY KEY
name TEXT
email TEXT UNIQUE
password_hash TEXT
phone TEXT
current_tier INTEGER DEFAULT 1
credit_balance INTEGER DEFAULT 0   -- DB constraint prevents negative
calendar_token TEXT UNIQUE         -- for iCal feed polling
created_at TIMESTAMPTZ
```

**`driving_sessions`** / **`skill_ratings`** — unchanged from original design (see original schema).

**`credit_transactions`**
```sql
id SERIAL PRIMARY KEY
user_id INTEGER
type TEXT               -- 'purchase', 'refund', 'booking', 'cancellation_return'
credits INTEGER
amount_pence INTEGER
stripe_payment_id TEXT
stripe_refund_id TEXT
created_at TIMESTAMPTZ
```

**`lesson_bookings`**
```sql
id SERIAL PRIMARY KEY
learner_id INTEGER
instructor_id INTEGER
scheduled_date DATE
start_time TIME
end_time TIME
status TEXT             -- 'confirmed', 'completed', 'cancelled'
credit_returned BOOLEAN DEFAULT FALSE
stripe_session_id TEXT  -- idempotency key for pay-per-slot bookings
created_at TIMESTAMPTZ
-- UNIQUE (instructor_id, scheduled_date, start_time) prevents double-booking
```

**`slot_reservations`** *(temporary holds during Stripe Checkout)*
```sql
id SERIAL PRIMARY KEY
instructor_id INTEGER
scheduled_date DATE
start_time TIME
end_time TIME
learner_id INTEGER
stripe_session_id TEXT
expires_at TIMESTAMPTZ  -- NOW() + 10 minutes
created_at TIMESTAMPTZ
```

**`magic_link_tokens`**
```sql
id SERIAL PRIMARY KEY
token TEXT UNIQUE
email TEXT
phone TEXT
method TEXT             -- 'email' or 'sms'
expires_at TIMESTAMPTZ  -- 15 minutes from creation
used BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
```

### The 10-question self-assessment

When logging a session, learners answer 10 questions across 4 groups (green/amber/red + optional note per question):

**Speed & Control** — Acceleration smoothly, Braking progressively, Appropriate speed for conditions

**Looking Around** — Effective observation at junctions, Checking mirrors regularly, Awareness of road positioning

**Junctions & Roundabouts** — Correct approach and positioning, Giving way correctly

**Reversing** — Controlled speed when reversing, Effective all-round observation

---

## Instructor portal

The instructor login page (`/instructor/login.html`) presents a choice: "I'm a CoachCarter instructor" (magic-link sign in) or "Join the team" (enquiry form for prospective instructors). Magic link login uses the same two-step validate/verify pattern as the learner login to prevent email prefetchers from consuming tokens. Join-the-team submissions go through the existing enquiry system (`api/enquiries.js`) with `enquiry_type: 'join-team'`.

### API — `api/instructor.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `request-login` | POST | No | Sends magic link to instructor email |
| `validate-token` | GET | No | Lightweight token check (does NOT consume). Prevents email prefetchers from burning tokens |
| `verify-token` | POST | No | Consumes token, returns JWT. Body: `{ token }` |
| `schedule` | GET | JWT | Instructor's upcoming confirmed bookings |
| `complete` | POST | JWT | Mark a lesson as completed |
| `availability` | GET | JWT | Current weekly availability windows |
| `set-availability` | POST | JWT | Update weekly availability windows |
| `profile` | GET | JWT | Profile details |
| `update-profile` | POST | JWT | Update bio and contact details |

### Database tables

**`instructors`** — name, email, phone, bio, photo_url, active flag

**`instructor_availability`** — recurring weekly windows per instructor (day_of_week 0–6, start_time, end_time)

**`instructor_login_tokens`** — magic-link tokens with expiry and used flag

---

## Admin portal

Login at `/admin/login.html` with email + password. JWT stored in `localStorage` as `cc_admin`.

### API — `api/admin.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `login` | POST | No | Returns JWT |
| `stats` | GET | JWT | Dashboard stats (upcoming lessons, revenue, learner count) |
| `bookings` | GET | JWT | All bookings with status filters |
| `instructors` | GET | JWT | Instructor list |
| `add-instructor` | POST | JWT | Add a new instructor |
| `update-instructor` | POST | JWT | Edit instructor details |
| `toggle-instructor` | POST | JWT | Activate / deactivate instructor |

**`admin_users`** table: email, bcrypt password_hash, role (`admin` / `superadmin`).

---

## Classroom (video reels)

`/classroom.html` is a full-screen mobile-first page where learners scroll through short driving videos like Instagram Reels / YouTube Shorts.

### Video hosting — Cloudflare Stream

- Customer subdomain: `customer-qn21p6ogmlqlhcv4.cloudflarestream.com`
- HLS manifest: `https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/{uid}/manifest/video.m3u8`
- Videos are publicly accessible — no auth needed

### Technical approach

Native `<video>` elements (iframes were abandoned — Cloudflare Stream's nested frames make mute/unmute via `postMessage` unreliable).

- HLS.js loads manifests on non-Safari; Safari uses native HLS
- `IntersectionObserver` (threshold 0.6) attaches/detaches HLS on scroll to prevent audio bleed
- `scroll-snap-type: y mandatory` for snap-scroll behaviour
- Global `globalMuted` boolean — user unmutes once; all subsequent videos play with sound

### Adding videos — `public/videos.json`

Upload to Cloudflare Stream, copy the UID, add an entry to `videos.json`, commit and push:

```json
{
  "uid": "7e36d845f1a0d80c57ebf7ef969c2572",
  "title": "Smooth acceleration",
  "description": "How to build speed progressively from a standstill.",
  "group": "speed-control"
}
```

Valid group values: `speed-control`, `looking-around`, `junctions`, `reversing`

---

## Maintenance mode

Set `MAINTENANCE_MODE=true` in Vercel environment variables to redirect all visitors to `/maintenance.html`. API routes (`/api/*`) are exempt. Handled by `middleware.js`.

---

## Known gotchas

- **JWT_SECRET must be set in Vercel** — without it, all auth endpoints return 500
- **Neon Postgres cold starts** — first request after inactivity may be slow (~1–2s)
- **HLS.js CDN** — classroom loads HLS.js from jsDelivr; consider self-hosting if CDN latency becomes an issue
- **videos.json is the source of truth** for the classroom — no admin UI for it yet; edit directly and push
- **Mobile autoplay** — browsers require videos to start muted; `video.muted = false` after a user gesture unlocks sound
- **Klarna** — enabled via Stripe dashboard, not hardcoded; no code changes needed to toggle it
- **DB migrations** — run manually in Neon SQL Editor; files in `db/migrations/` are numbered sequentially
- **Magic link tokens** — two-step flow (validate then verify) prevents email-client link prefetchers from consuming tokens; `verify` is POST-only
- **Slot reservations** — 10-minute TTL; expired reservations are excluded from availability but cleaned up lazily (on next webhook or when table is queried)

---

## Recent changes (March 2026)

- **Pay-per-slot booking** — learners with 0 credits can now pay £82.50 at the point of booking via Stripe Checkout, with a 10-minute slot reservation during payment
- **Magic link login fix** — email clients pre-fetching links were consuming tokens; fixed with a two-step validate (GET) → verify (POST) flow
- **Session logging rebuild** — stepped wizard with emoji-based ratings replacing the original single-page form
- **Learner portal videos** — classroom videos page added behind login with bottom nav
- **Homepage quiz update** — quiz results now direct to Learner Hub / Book a Free Trial / Explore Prices
- **Stale register links** — removed `?tab=register` query params from 9 files (registration is now handled by magic links)
- **Font consistency** — log-session.html updated to Space Grotesk + Outfit matching the rest of the portal
- **Instructor login redesign** — choice screen (Sign In / Join the Team), two-step magic link prefetch fix, and "Join the team" enquiry form for prospective instructors

## What's still to build

See `DEVELOPMENT-ROADMAP.md` for the full prioritised list. Key remaining items:

- **Refund flow** — learner requests cash refund, admin approves, Stripe reverses the charge
- **Automated reminders** — 24-hour email to learner and instructor before each lesson (needs a Vercel cron job)
- **Reviews & testimonials** — post-lesson email prompt, star rating + comment, optional public display
- **Waiting list** — capture leads when calendar is fully booked
- **Referral system** — unique links per learner, credit bonuses for both parties on first referral purchase
