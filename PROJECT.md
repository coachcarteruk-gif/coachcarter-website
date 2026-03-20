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
| `ADMIN_SECRET` | Admin password for config editor and guarantee price overrides |
| `STAFF_EMAIL` | Email address for staff notifications (booking alerts, enquiries) |
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
│   ├── videos.js                   # Video library CRUD (admin) + public listing
│   ├── availability.js             # Read/write public availability slots
│   ├── enquiries.js                # Contact form: submit, list, update status
│   ├── webhook.js                  # Stripe webhook handler
│   ├── guarantee-price.js          # Dynamic Pass Programme pricing (read/increment/override)
│   ├── create-checkout-session.js  # Legacy Stripe checkout (pass programme / packages)
│   ├── verify-session.js           # Stripe payment verification
│   ├── update-status.js            # Booking status update
│   ├── status.js                   # Health check endpoint
│   └── config.js                   # Shared config helpers
│
├── public/                         # Static files served directly
│   ├── index.html                  # Homepage (main marketing page)
│   ├── classroom.html              # Video library — grid + reels dual mode (public)
│   ├── availability.html           # Availability/booking page
│   ├── learner-journey.html        # Pricing page — tiers, PAYG, and Pass Programme with dynamic pricing
│   ├── lessons.html                # PAYG + bulk packages (Pass Programme redirects to learner-journey)
│   ├── admin.html                  # Redirect shim → /admin/login.html
│   ├── admin-availability.html     # Standalone admin availability management
│   ├── success.html                # Post-payment success page
│   ├── maintenance.html            # Maintenance mode page
│   ├── privacy.html
│   ├── terms.html
│   ├── admin/
│   │   ├── login.html              # Admin login (JWT auth)
│   │   ├── portal.html             # Full admin portal (dashboard, instructors, availability, bookings, videos)
│   │   ├── dashboard.html          # Admin enquiry dashboard
│   │   └── editor.html             # Admin content editor
│   ├── learner/
│   │   ├── index.html              # Learner hub — dashboard (credits, bookings, progress)
│   │   ├── login.html              # Magic-link login (email or SMS)
│   │   ├── verify.html             # Token verification page (two-step: validate then verify)
│   │   ├── book.html               # Lesson booking calendar — monthly/weekly/daily views (credit or pay-per-slot)
│   │   ├── buy-credits.html        # Buy lesson credits via Stripe
│   │   ├── log-session.html        # Log a driving session (3-step wizard, traffic light ratings, booking pre-fill)
│   │   └── videos.html             # Video library (behind login)
│   ├── instructor/
│   │   ├── login.html              # Magic-link login for instructors
│   │   ├── index.html              # Instructor schedule calendar (monthly/weekly/daily views)
│   │   ├── availability.html       # Instructor sets their own weekly availability
│   │   └── profile.html            # Instructor updates bio, contact details, and buffer time
│   ├── demo/
│   │   └── book.html               # Demo booking calendar — real flow with free demo instructor
│   ├── videos.json                 # Legacy video data (fallback — videos now managed in DB via admin portal)
│   ├── config.json                 # Site config
│   └── Logo.png                    # CoachCarter logo
│
├── db/
│   ├── migrations/                 # SQL files — run manually in Neon SQL Editor
│   │   ├── 001_booking_system.sql  # Core booking tables
│   │   ├── 002_admin_users.sql     # Admin users table
│   │   ├── 003_calendar_token.sql  # iCal token column on learner_users
│   │   ├── 004_instructor_portal.sql # Instructor magic-link tokens
│   │   ├── 005_contact_preference.sql # prefer_contact_before on learner_users
│   │   ├── 006_pickup_address.sql  # pickup_address on learner_users
│   │   ├── 007_buffer_minutes.sql  # buffer_minutes on instructors
│   │   ├── 008_videos.sql          # video_categories + videos tables
│   │   └── 009_session_booking_link.sql # booking_id on driving_sessions
│   └── seeds/                      # Placeholder data for testing
│       ├── 001_placeholder_instructors.sql
│       └── 002_demo_instructor.sql # Creates demo instructor with full 7-day availability
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

Fonts: **Bricolage Grotesque** (headings) + **Lato** (body). All pages link to them via:
```html
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Lato:wght@300;400;700&display=swap">
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
- **Demo instructor:** Bookings against the demo instructor (email `demo@coachcarter.uk`) are free — no credit check or deduction. The demo instructor is excluded from real booking flows. No emails sent to the demo instructor on book/cancel. Cancel returns no credits (since none were taken).
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
| `sessions` | POST | Yes | Save a new session (optional `booking_id` to link to completed booking) |
| `progress` | GET | Yes | Returns latest skill ratings, stats, current tier, phone, pickup_address, prefer_contact_before |
| `update-name` | POST | Yes | Set learner name (used after first magic-link login) |
| `profile` | GET | Yes | Returns learner profile (name, email, phone, pickup_address, prefer_contact_before) |
| `update-profile` | POST | Yes | Update phone and pickup_address |
| `contact-pref` | GET | Yes | Returns prefer_contact_before flag |
| `set-contact-pref` | POST | Yes | Toggle prefer_contact_before. Body: `{ prefer_contact_before: boolean }` |
| `unlogged-bookings` | GET | Yes | Returns completed bookings that haven't been logged yet |

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
phone TEXT
pickup_address TEXT
prefer_contact_before BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ
```

**`driving_sessions`** / **`skill_ratings`** — session logging tables. `driving_sessions` has optional `booking_id` (FK to `lesson_bookings`) to link sessions to completed bookings. Unique constraint ensures one log per booking. Skill ratings use Traffic Light system: `struggled` (red), `ok` (amber), `nailed` (green).

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

**`guarantee_pricing`** *(auto-created on first API call)*
```sql
id            INTEGER PRIMARY KEY DEFAULT 1
base_price    INTEGER NOT NULL DEFAULT 1500   -- starting price in £
current_price INTEGER NOT NULL DEFAULT 1500   -- current price in £
increment     INTEGER NOT NULL DEFAULT 100    -- £ added per purchase
cap           INTEGER NOT NULL DEFAULT 3000   -- max price in £
purchases     INTEGER NOT NULL DEFAULT 0      -- total enrolments
updated_at    TIMESTAMPTZ
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
| `schedule-range` | GET | JWT | Bookings in date range for calendar views. Query: `from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `complete` | POST | JWT | Mark a lesson as completed |
| `availability` | GET | JWT | Current weekly availability windows |
| `set-availability` | POST | JWT | Update weekly availability windows |
| `profile` | GET | JWT | Profile details |
| `update-profile` | POST | JWT | Update bio, contact details, and buffer_minutes |

### Database tables

**`instructors`** — name, email, phone, bio, photo_url, active flag, buffer_minutes (default 30)

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

## Classroom (video library)

`/classroom.html` (public) and `/learner/videos.html` (behind login) both feature a dual-mode video library: **grid view** (thumbnail cards, category tags, click-to-play modal) and **reels view** (fullscreen vertical swipe like TikTok). Videos are managed from the admin portal and stored in the database.

### Video hosting — Cloudflare Stream

- Customer subdomain: `customer-qn21p6ogmlqlhcv4.cloudflarestream.com`
- HLS manifest: `https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/{uid}/manifest/video.m3u8`
- Thumbnails: `https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/{uid}/thumbnails/thumbnail.jpg?time=2s&width=480`
- Videos are publicly accessible — no auth needed

### API — `api/videos.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `list` | GET | No | Published videos (optional `category` and `learner_only` filters) |
| `categories` | GET | No | All categories with video counts |
| `create` | POST | Admin JWT | Add a video |
| `update` | POST | Admin JWT | Edit a video |
| `delete` | POST | Admin JWT | Delete a video |
| `reorder` | POST | Admin JWT | Update sort order for multiple videos |
| `create-category` | POST | Admin JWT | Add a category |
| `update-category` | POST | Admin JWT | Edit a category |
| `delete-category` | POST | Admin JWT | Delete a category (only if empty) |

### Database tables

**`video_categories`**
```sql
id SERIAL PRIMARY KEY
slug TEXT UNIQUE       -- e.g. 'roundabouts'
label TEXT             -- e.g. 'Roundabouts'
sort_order INTEGER     -- display order
color TEXT             -- CSS color for tags
```

**`videos`**
```sql
id SERIAL PRIMARY KEY
cloudflare_uid TEXT    -- Cloudflare Stream video UID
title TEXT
description TEXT
category_slug TEXT     -- FK → video_categories.slug
thumbnail_url TEXT     -- optional (auto-generated from CF Stream if blank)
sort_order INTEGER     -- within category
published BOOLEAN      -- hide without deleting
learner_only BOOLEAN   -- only shown in learner portal
```

### Adding videos

Upload to Cloudflare Stream, then add via Admin Portal → Videos → "+ Add Video". Enter the Cloudflare UID, title, description, and category. No code changes or redeployment needed.

### Technical approach

- HLS.js loads manifests on non-Safari; Safari uses native HLS
- Grid view: click opens a modal player with full controls
- Reels view: `IntersectionObserver` (threshold 0.6) attaches/detaches HLS on scroll
- `scroll-snap-type: y mandatory` for snap-scroll in reels mode
- Global `globalMuted` boolean — user unmutes once; all subsequent videos play with sound
- Fallback: if DB tables don't exist, both pages fall back to `videos.json`

---

## Maintenance mode

Set `MAINTENANCE_MODE=true` in Vercel environment variables to redirect all visitors to `/maintenance.html`. API routes (`/api/*`) are exempt. Handled by `middleware.js`.

---

## Known gotchas

- **JWT_SECRET must be set in Vercel** — without it, all auth endpoints return 500
- **Neon Postgres cold starts** — first request after inactivity may be slow (~1–2s)
- **HLS.js CDN** — classroom loads HLS.js from jsDelivr; consider self-hosting if CDN latency becomes an issue
- **Videos are now DB-backed** — managed from admin portal; `videos.json` is a legacy fallback only
- **Neon sql tagged templates** — the Neon serverless driver does NOT support nested `sql` template literals for conditional queries; always use separate query branches instead
- **Mobile autoplay** — browsers require videos to start muted; `video.muted = false` after a user gesture unlocks sound
- **Klarna** — enabled via Stripe dashboard, not hardcoded; no code changes needed to toggle it
- **DB migrations** — run manually in Neon SQL Editor; files in `db/migrations/` are numbered sequentially
- **Magic link tokens** — two-step flow (validate then verify) prevents email-client link prefetchers from consuming tokens; `verify` is POST-only
- **Slot reservations** — 10-minute TTL; expired reservations are excluded from availability but cleaned up lazily (on next webhook or when table is queried)
- **Dynamic pricing table** — `guarantee_pricing` is auto-created and seeded on first call to `/api/guarantee-price`; no manual migration needed. The webhook increments the price atomically after each Pass Programme purchase. Admin can override the price via the editor or direct API call.
- **Pricing page routing** — all site nav "Pricing" links now point to `/learner-journey.html`, not `/lessons.html`. The old lessons page still works for PAYG/bulk but is no longer the primary entry point.
- **PostHog analytics** — all pages include the PostHog snippet for event tracking and session recording

---

## Recent changes (March 2026)

- **Demo booking system** (20 March) — public demo page at `/demo/book.html` lets users explore the full booking flow (monthly/weekly/daily calendar views) with a dedicated demo instructor. Requires sign-up/login but bookings are free (no credit deduction). Users receive real confirmation emails, calendar invites, and can cancel from the page. Demo instructor (ID 5, email `demo@coachcarter.uk`) has full 7-day availability (07:00–21:00) with zero buffer. Filtered out of real booking flows via email check in `api/instructors.js` and `api/slots.js`. Demo links added to homepage quiz and pricing page. SQL seed at `db/seeds/002_demo_instructor.sql`.
- **Dynamic Pass Programme pricing** (20 March) — demand-based pricing for the Pass Programme: starts at £1,500, increases £100 per enrolment, caps at £3,000. New `/api/guarantee-price` endpoint with dedicated `guarantee_pricing` DB table, atomic increments via Stripe webhook, manual override in admin editor. Transparent "launch pricing" messaging with progress bar on the learner journey page.
- **Pricing page restructure** (20 March) — learner-journey.html is now the canonical pricing page (linked from all nav bars site-wide). Features a tabbed hero card (PAYG vs Pass Programme) with live dynamic pricing. The old lessons.html retains PAYG and bulk packages with a redirect banner for the Pass Programme. Comparison table and guarantee calculator removed from lessons.html.
- **Renamed Pass Guarantee → Pass Programme** (20 March) — all user-facing references renamed across HTML, JS, config, and email templates. Code identifiers (`pass_guarantee`, `isPassGuarantee`) kept for Stripe/webhook compatibility.
- **Retake price corrected** (20 March) — config `retake_price` updated from £0 to £325
- **Calendar views** (18 March) — instructor schedule and learner booking pages rebuilt with monthly/weekly/daily views, view toggle, navigation, and drill-down
- **Contact preference** (18 March) — learners can toggle "Contact me before my first lesson"; shown as badge on instructor schedule
- **Phone & pickup address** (18 March) — required before booking; shown to instructors on schedule and in booking detail
- **Buffer time** (18 March) — configurable per-instructor buffer (0–120 mins, default 30) between booked lessons
- **Upcoming lessons upgrade** (18 March) — rich cards with date block, countdown, calendar download, today highlight
- **Video library rebuild** (18 March) — replaced static JSON with DB-backed system, grid + reels dual mode, admin management section
- **Slot engine SQL fix** (18 March) — fixed 500 error caused by nested Neon sql template literals in conditional query fragments
- **Pay-per-slot booking** — learners with 0 credits can now pay £82.50 at the point of booking via Stripe Checkout, with a 10-minute slot reservation during payment
- **Magic link login fix** — email clients pre-fetching links were consuming tokens; fixed with a two-step validate (GET) → verify (POST) flow
- **Session logging rebuild v2** (20 March) — complete rewrite of `log-session.html`: consolidated from 8 steps to 3 (details → rate all skills → notes/save). Replaced emoji ratings (😬/😊/🤩) with Traffic Light system (Red = Needs work, Amber = Getting there, Green = Confident). Sessions now link to completed bookings via `booking_id` column. When instructor marks a lesson complete, learner receives email with direct link to log that session. Dashboard shows "unlogged lessons" banner. Instructor schedule now displays collapsible learner self-assessments on completed bookings. Fonts migrated to Bricolage Grotesque + Lato across learner portal. New API endpoint: `unlogged-bookings`. Migration: `009_session_booking_link.sql`
- **Learner portal videos** — classroom videos page added behind login with bottom nav
- **Homepage quiz update** — quiz results now direct to Learner Hub / Book a Free Trial / Explore Prices
- **Instructor login redesign** — choice screen (Sign In / Join the Team), two-step magic link prefetch fix, and "Join the team" enquiry form for prospective instructors

## What's still to build

See `DEVELOPMENT-ROADMAP.md` for the full prioritised list. Key remaining items:

- **Refund flow** — learner requests cash refund, admin approves, Stripe reverses the charge
- **Automated reminders** — 24-hour email to learner and instructor before each lesson (needs a Vercel cron job)
- **Reviews & testimonials** — post-lesson email prompt, star rating + comment, optional public display
- **Waiting list** — capture leads when calendar is fully booked
- **Referral system** — unique links per learner, credit bonuses for both parties on first referral purchase
