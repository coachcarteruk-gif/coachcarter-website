# CoachCarter Website — Project Reference

> **Last updated:** 3 April 2026

A complete reference for the CoachCarter driving instructor website. Use this when continuing development with an AI assistant — paste it in at the start of a new session so the AI is fully up to speed.

---

## What the site is

A driving instructor website for CoachCarter (Fraser). It has seven distinct areas:

- **Public marketing site** — homepage, pricing, availability, about, contact, Google Reviews
- **Learner portal** — dashboard, lesson booking, session logging, progress tracking, examiner quiz, AI examiner chat, AI lesson advisor, mock driving tests, onboarding, Q&A, videos, profile
- **Instructor portal** — schedule, availability, profile, Q&A management
- **Admin portal** — instructors, bookings, availability, videos, dashboard
- **Classroom** — public video library with grid + reels UI
- **Examiner Knowledge Base** — interactive quiz + AI Q&A based on DVSA DL25 marking sheet
- **AI Lesson Advisor** — conversational AI sales assistant with Stripe checkout integration

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
| `ANTHROPIC_API_KEY` | Claude AI for Ask the Examiner and Lesson Advisor |
| `GOOGLE_PLACES_API_KEY` | Google Places API for address autocomplete (if used) |
| `MIGRATION_SECRET` | Secret for running DB migrations via `/api/migrate?secret=` |
| `ERROR_ALERT_EMAIL` | Email address for 500 error alerts (uses SMTP config) |

---

## Project structure

```
/
├── api/                            # Vercel serverless functions
│   ├── _auth-helpers.js            # Shared JWT verification + nodemailer transporter
│   ├── _shared.js                  # Shared utilities (learner context builder etc.)
│   ├── _error-alert.js             # Fire-and-forget email error alerting (500 errors)
│   ├── migrate.js                  # DB migration runner (protected by MIGRATION_SECRET)
│   ├── learner.js                  # Learner sessions, progress, profile, competency, onboarding, Q&A
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
│   ├── advisor.js                  # AI Lesson Advisor with Stripe tool_use checkout
│   ├── ask-examiner.js             # AI examiner Q&A with personalised learner context
│   ├── address-lookup.js           # Address autocomplete API
│   ├── qa-digest.js                # Q&A weekly digest emails
│   ├── cron-retention.js           # GDPR data retention cron (weekly, archives/purges inactive data)
│   ├── _audit.js                   # GDPR audit logging utility (logAudit)
│   ├── seed-test-data.js           # Test data seed/reset (3 test learner accounts, protected by MIGRATION_SECRET)
│   ├── reviews.js                  # Google Reviews API
│   ├── status.js                   # Health check endpoint
│   └── config.js                   # Shared config helpers + GDPR consent recording
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
│   ├── shared/
│   │   ├── learner.css             # Shared learner CSS (variables, reset, nav)
│   │   ├── instructor.css          # Shared instructor CSS (variables, reset, nav, portal header)
│   │   ├── learner-auth.js         # Shared learner auth (ccAuth.getAuth, logout, requireAuth)
│   │   └── instructor-auth.js      # Shared instructor auth (ccAuth.getAuth, logout, requireAuth)
│   ├── auth-gate.js                # Shared auth gate for login-required pages
│   ├── competency-config.js        # 17 DL25-aligned skill definitions, areas, ratings, fault types
│   ├── manifest.json               # PWA manifest
│   ├── pwa.js                      # PWA install prompt + service worker registration
│   ├── sw.js                       # Service worker (cache shell + network-first strategy)
│   ├── sidebar.js                  # Context-aware sidebar navigation (public/learner/instructor) + floating pill bottom bar + card styling overrides
│   ├── cookie-consent.js           # GDPR cookie consent banner (vanilla JS, self-contained)
│   ├── posthog-loader.js           # Consent-gated PostHog loader (only loads after analytics consent)
│   ├── posthog-tracking.js         # PostHog custom event tracking (button clicks, scroll, forms)
│   ├── offline.html                # Branded offline fallback page
│   ├── icons/                      # PWA icons (multiple sizes + maskable variants)
│   ├── admin/
│   │   ├── login.html              # Admin login (JWT auth)
│   │   ├── portal.html             # Full admin portal (dashboard, instructors, availability, bookings, videos)
│   │   ├── dashboard.html          # Admin enquiry dashboard
│   │   └── editor.html             # Admin content editor
│   ├── learner/
│   │   ├── index.html              # Learner hub — dashboard (hero card, pill shortcuts, action cards, upcoming lessons, profile)
│   │   ├── login.html              # Magic-link login (email or SMS)
│   │   ├── verify.html             # Token verification page (two-step: validate then verify)
│   │   ├── book.html               # Lesson booking calendar — monthly/weekly/daily views (credit or pay-per-slot)
│   │   ├── buy-credits.html        # Buy lesson credits via Stripe
│   │   ├── log-session.html        # Log a driving session (3-step wizard, 17 skills, fault tallies)
│   │   ├── videos.html             # Video library (behind login)
│   │   ├── advisor.html            # AI Lesson Advisor chat page
│   │   ├── ask-examiner.html       # Ask the Examiner AI chat
│   │   ├── examiner-quiz.html      # 50-question interactive examiner quiz
│   │   ├── mock-test.html          # Mock driving test (3 × 10-min parts with DL25 fault recording)
│   │   ├── onboarding.html         # "Build Your Driving Profile" — 3-step onboarding flow
│   │   ├── progress.html           # My Progress — radar chart, skill breakdown, readiness scores
│   │   ├── profile.html            # Learner profile page (includes Privacy & Data links)
│   │   ├── my-data.html            # GDPR "My Data" page — readable view of all personal data
│   │   ├── confirm-deletion.html   # GDPR account deletion confirmation (token-based)
│   │   ├── lessons.html            # My Lessons — tabbed upcoming/past view with cancel, reschedule, calendar actions
│   │   └── qa.html                 # Q&A forum
│   ├── instructor/
│   │   ├── login.html              # Magic-link login for instructors
│   │   ├── dashboard.html          # Compact dashboard — today's lessons + Book Lesson + lesson detail modal
│   │   ├── index.html              # Full calendar (monthly/weekly/daily/agenda views)
│   │   ├── availability.html       # Instructor sets their own weekly availability
│   │   ├── earnings.html           # Weekly earnings and payout history
│   │   ├── learners.html           # Learner management and skill tracking
│   │   ├── profile.html            # Instructor updates bio, contact details, and buffer time
│   │   └── qa.html                 # Instructor Q&A management
│   ├── demo/
│   │   └── book.html               # Demo booking calendar — real flow with free demo instructor
│   ├── videos.json                 # Legacy video data (fallback — videos now managed in DB via admin portal)
│   ├── config.json                 # Site config
│   └── Logo.png                    # CoachCarter logo
│
├── db/
│   ├── migration.sql               # Single idempotent migration — all 23 tables (run via /api/migrate)
│   ├── migrations/                 # Legacy per-feature SQL files (superseded by migration.sql)
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

> For full design tokens, colour palettes, and component standards, see [DESIGN-REVIEW.md](DESIGN-REVIEW.md).

**Quick ref:** Charcoal (`#262626`) + Orange (`#f58321`). Fonts: Bricolage Grotesque (headings) + Lato (body).

---

## Navigation

The site uses a **sidebar navigation** system (`public/sidebar.js`) that replaces all previous nav patterns (bottom tabs, top nav, hamburger menus). It's a single self-contained IIFE that:

- Detects context from URL path (public/learner/instructor)
- Renders appropriate nav items per context
- Supports collapsible groups (Lessons tab has 3 sub-items)
- Auth-aware (hides profile link when logged out, shows admin link for admin instructors)
- Mobile responsive with hamburger toggle at 960px breakpoint
- Shows user name, credit balance, and logout in footer
- **Mobile bottom bar:** floating pill style (border-radius 26px, 10px side margins, frosted glass blur, layered shadow) — 5 fixed tabs for learner (Home/Lessons/Practice/Learn/Profile), 5 for instructor (Calendar/Learners/Earnings/Q&A/Profile)
- **Card styling:** injects CSS overrides removing borders from cards site-wide, replacing with ambient shadows. Orange left-border retained on upcoming lesson cards only.
- **Instructor weekly view:** Timepage-style agenda layout (day label left, lesson cards with coloured left-bar right)
- **Dashboard top section (learner + instructor):** hero card (orange gradient) showing next lesson with countdown + readiness ring/today count, horizontal pill shortcuts (5 circular icons), 3 colourful action cards (gradient backgrounds). Replaces old emoji quick-action grid (learner) and plain next-lesson card (instructor).

---

## Competency system

The site uses a unified competency framework (10 DL25 categories, 39 sub-skills) aligned to the DVSA DL25 marking sheet. All skills are defined in `public/competency-config.js` which is shared across:

- Log Session (self-assessment ratings + fault tallies)
- Mock Test (per-skill fault recording across 3 parts)
- Examiner Quiz (per-question skill mapping)
- My Progress (radar chart + readiness calculation)
- Ask the Examiner (AI context injection)
- Onboarding (initial self-assessment)

### The 10 categories (39 sub-skills across 4 areas)

**Vehicle Control**: Accelerator, Clutch, Gears, Footbrake, Parking Brake, Steering

**Observation**: Mirrors, Signals, Awareness & Planning

**Road Procedure**: Signs & Signals, Positioning, Clearance, Following Distance

**Junctions & Speed**: Junctions, Judgement, Use of Speed, Pedestrian Crossings

### Rating system

- `struggled` (red) = Needs work
- `ok` (amber) = Getting there
- `nailed` (green) = Confident

### Fault types (DL25)

- **D** = Driving fault (minor)
- **S** = Serious fault
- **X** = Dangerous fault
- Pass criteria: <=15 driving faults, 0 serious, 0 dangerous

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

Base rate: **£55 per hour** (£82.50 for a standard 1.5-hour lesson). Learners buy hours, not lesson credits. Balance stored as `balance_minutes` internally.

**Lesson types** (managed via admin portal):
- Standard Lesson — 90 min / £82.50
- 2-Hour Lesson — 120 min / £110.00
- More types can be added via admin portal (`api/lesson-types.js`)

### How booking works

- Instructors set recurring weekly availability windows (admin or self-service via instructor portal)
- The slot engine (`api/slots.js`) generates slots based on the selected lesson type's duration
- Learners select a lesson type (if multiple exist), browse the calendar, filter by instructor (optional), and book
- Booking is instant — no instructor approval needed
- **With hours balance:** Duration deducted from `balance_minutes` on booking; returned automatically on 48+ hour cancellations
- **Without balance (pay-per-slot):** Slot reserved for 10 minutes during Stripe Checkout; on payment, hours added + deducted atomically, booking created, .ics calendar attachment sent to both parties
- **Demo instructor:** Bookings against the demo instructor (email `demo@coachcarter.uk`) are free — no credit check or deduction. The demo instructor is excluded from real booking flows via email check in `api/instructors.js` and `api/slots.js`. No emails sent to the demo instructor on book/cancel. Cancel returns no credits (since none were taken).
- Race condition protection via DB unique index on `(instructor_id, scheduled_date, start_time)` + slot reservations table

### Cancellation policy

- 48+ hours notice — credit returned automatically
- Under 48 hours — credit forfeited, learner informed at time of cancellation

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
| `mock-tests` | GET/POST | Yes | Create and list mock tests |
| `mock-test-faults` | GET/POST | Yes | Record/retrieve per-skill faults for mock test parts |
| `quiz-results` | GET/POST | Yes | Persist per-question examiner quiz results |
| `competency` | GET | Yes | Full competency dashboard data (lesson ratings, quiz accuracy, mock summary, faults) |
| `onboarding` | GET/POST | Yes | Get/save onboarding profile (prior experience + initial self-assessment) |
| `profile-completeness` | GET | Yes | Returns profile completion steps; dashboard uses prior_experience + initial_assessment (2 steps) |
| `qa-list` | GET | Yes | List Q&A questions |
| `qa-detail` | GET | Yes | Get single Q&A thread |
| `qa-ask` | POST | Yes | Submit a question |
| `qa-reply` | POST | Yes | Reply to a question |
| `my-availability` | GET | Yes | Returns learner's active weekly availability windows |
| `set-availability` | POST | Yes | Replace all availability windows. Body: `{ windows: [{ day_of_week, start_time, end_time }] }` |
| `accept-terms` | POST | Yes | Records T&C acceptance (`terms_accepted_at = NOW()`). Called from login flow gate. |

### API — `api/waitlist.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `join` | POST | Yes | Join waitlist with optional day/time/instructor prefs or `use_my_availability` flag |
| `my-waitlist` | GET | Yes | List active/notified entries (expires stale on read) |
| `leave` | POST | Yes | Remove a waitlist entry. Body: `{ waitlist_id }` |

Internal: `checkWaitlistOnCancel()` — called from `api/slots.js` after cancellation. Matches entries by explicit prefs or `learner_availability` fallback. Sends WhatsApp + email to all matches.

### API — `api/lesson-types.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `list` | GET | No | Active lesson types sorted by sort_order (public) |
| `all` | GET | Admin | All types including inactive |
| `create` | POST | Admin | Create a new lesson type |
| `update` | POST | Admin | Update an existing type |
| `toggle` | POST | Admin | Activate/deactivate a type |

### API — `api/credits.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `balance` | GET | Yes | Returns `balance_minutes`, `balance_hours`, `credit_balance` + recent transactions |
| `checkout` | POST | Yes | Creates Stripe checkout for hours purchase. Body: `{ hours }` (or legacy `{ quantity }` for lesson count). Discount tiers: 6h=5%, 12h=10%, 18h=15%, 24h=20%, 30h=25% |

### API — `api/slots.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `available` | GET | No | Available slots for a lesson type duration. Params: `from`, `to`, `instructor_id?`, `lesson_type_id?` |
| `book` | POST | Yes | Book a slot — deducts `duration_minutes` from `balance_minutes`. Body includes `lesson_type_id` |
| `checkout-slot` | POST | Yes | Pay-per-slot: reserves slot, creates Stripe Checkout at lesson type's price |
| `cancel` | POST | Yes | Cancel a booking (returns `minutes_deducted` to balance if 48hr+ policy met) |
| `reschedule` | POST | Yes | Move a confirmed booking to a new slot (48hr+ notice, max 2 per chain, no balance change) |
| `my-bookings` | GET | Yes | Learner's bookings with lesson type info (name, colour, duration) |

### API — `api/calendar.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `download` | GET | JWT | Download `.ics` file for a single booking |
| `feed` | GET | Token | iCal feed for Apple/Google Calendar subscription (no JWT — uses per-learner token) |
| `feed-url` | GET | JWT | Returns the learner's personalised iCal feed URL |

### API — `api/ical-sync.js`

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/ical-sync` | GET | CRON_SECRET | Cron job (every 15 min). Syncs one instructor's external iCal feed per invocation. Parses events, expands RRULE, upserts into `instructor_external_events`. |

### API — `api/setmore-sync.js`

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/setmore-sync` | GET | CRON_SECRET | Cron job (every 15 min). Imports Setmore appointments as `lesson_bookings`. Detects cancelled/removed appointments and marks bookings as cancelled. Auto-creates/matches learners by phone/email. Pulls pickup address from Setmore customer profile (address + city + postal_code). Backfills addresses on existing bookings. Idempotent via `setmore_key` unique index. Round-robin per instructor. |

**Env:** `SETMORE_REFRESH_TOKEN` — Setmore OAuth2 refresh token, swapped for access token on each run.

**DB columns:** `lesson_bookings.setmore_key`, `lesson_bookings.pickup_address`, `lesson_bookings.cancel_reason`, `learner_users.setmore_customer_key`, `learner_users.welcome_email_sent_at`, `instructors.setmore_staff_key`, `instructors.setmore_last_synced_at`, `instructors.setmore_sync_error`

### API — `api/setmore-welcome.js`

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/setmore-welcome` | GET | CRON_SECRET | Cron job (daily 10am). Sends one-time welcome email with 7-day magic link to Setmore-created learners who haven't logged in. Processes up to 10 per run. Tracked via `welcome_email_sent_at`. |

### API — `api/_travel-time.js` (shared helper)

Two-mode travel time checking between pickup postcodes. **Slot filtering** (pre-booking) uses postcodes.io + haversine estimation to hide unreachable slots — returns `travel_hidden` count in API response, shown as a banner on `book.html`. **Booking warning** (post-booking) uses OpenRouteService for precise routing — warning only, does not block.

**Env:** `OPENROUTESERVICE_API_KEY` — free API key from openrouteservice.org (only needed for post-booking warnings; slot filtering uses free postcodes.io)

**DB columns:** `instructors.max_travel_minutes` — per-instructor threshold (default 30 mins), editable from admin portal

### API — `api/offers.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `get-offer` | GET | None (token) | Returns offer details for public accept page |
| `accept-offer` | POST | None (token) | Collects learner details, creates Stripe checkout |
| `expire-offers` | POST | CRON_SECRET | Bulk-expires stale pending offers (hourly cron) |

### API — `api/instructor.js` (offer actions)

| Action | Method | Auth | Description |
|---|---|---|---|
| `create-offer` | POST | Instructor JWT | Creates lesson offer, sends email to learner |
| `list-offers` | GET | Instructor JWT | Lists instructor's offers with status filter |
| `cancel-offer` | POST | Instructor JWT | Cancels a pending offer |

### API — `api/ask-examiner.js`

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| (single endpoint) | POST | Yes | AI examiner chat — sends conversation to Claude with DVSA knowledge base system prompt + personalised learner context (onboarding, competency, quiz data) |

### API — `api/advisor.js`

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| (single endpoint) | POST | Yes | AI lesson advisor chat with Claude tool_use — recommends hour packages and creates Stripe Checkout sessions (£55/hr base, up to 25% discount, 1.5–30 hours) |

### API — `api/reviews.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `list` | GET | No | Returns cached Google Reviews |

### Database tables

**`learner_users`**
```sql
id SERIAL PRIMARY KEY
name TEXT
email TEXT UNIQUE
password_hash TEXT
phone TEXT
current_tier INTEGER DEFAULT 1
credit_balance INTEGER DEFAULT 0   -- legacy, kept via dual-write
balance_minutes INTEGER DEFAULT 0  -- hours-based balance (stored as minutes)
calendar_token TEXT UNIQUE         -- for iCal feed polling
pickup_address TEXT
prefer_contact_before BOOLEAN DEFAULT FALSE
terms_accepted_at TIMESTAMPTZ           -- T&C acceptance timestamp (NULL = not yet accepted)
created_at TIMESTAMPTZ
```

**`lesson_types`**
```sql
id SERIAL PRIMARY KEY
name TEXT NOT NULL                  -- 'Standard Lesson', '2-Hour Lesson'
slug TEXT NOT NULL UNIQUE           -- 'standard', '2hr'
duration_minutes INTEGER NOT NULL   -- 90, 120
price_pence INTEGER NOT NULL        -- 8250, 11000
colour TEXT DEFAULT '#3b82f6'       -- hex for calendar colour-coding
active BOOLEAN DEFAULT TRUE
sort_order INTEGER DEFAULT 0
created_at TIMESTAMPTZ
```

**`learner_availability`** — recurring weekly free-time windows per learner (mirrors `instructor_availability`). Columns: `learner_id`, `day_of_week` (0-6), `start_time`, `end_time`, `active`. Used for waitlist matching.

**`waitlist`** — learners waiting for specific slot types. Columns: `learner_id`, `instructor_id` (nullable = any), `preferred_day` (nullable), `preferred_start_time`/`preferred_end_time` (nullable = use learner_availability), `lesson_type_id`, `status` (active/notified/booked/expired), `expires_at` (14 days), `notified_at`. Auto-expired on read.

**`driving_sessions`** / **`skill_ratings`** — session logging tables. `driving_sessions` has optional `booking_id` (FK to `lesson_bookings`) to link sessions to completed bookings. Unique constraint ensures one log per booking. Skill ratings use Traffic Light system: `struggled` (red), `ok` (amber), `nailed` (green). `skill_ratings` also has `driving_faults`, `serious_faults`, and `dangerous_faults` columns for DL25 fault tracking.

**`credit_transactions`**
```sql
id SERIAL PRIMARY KEY
learner_id INTEGER
type TEXT               -- 'purchase', 'slot_purchase', 'refund'
credits INTEGER
minutes INTEGER DEFAULT 0  -- hours equivalent (in minutes)
amount_pence INTEGER
payment_method TEXT
stripe_session_id TEXT
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
status TEXT             -- 'confirmed', 'completed', 'cancelled', 'rescheduled'
credit_returned BOOLEAN DEFAULT FALSE
stripe_session_id TEXT  -- idempotency key for pay-per-slot bookings
rescheduled_from INTEGER  -- links to the booking this one replaced (NULL for original bookings)
reschedule_count INTEGER DEFAULT 0  -- how many times this booking chain has been rescheduled (max 2)
created_by TEXT DEFAULT 'learner'    -- 'learner', 'instructor', 'admin'
payment_method TEXT DEFAULT 'credit' -- 'credit', 'stripe', 'cash', 'free'
lesson_type_id INTEGER              -- FK to lesson_types
minutes_deducted INTEGER            -- hours deducted (in minutes) for audit trail
pickup_address TEXT                  -- per-booking pickup (overrides learner profile)
dropoff_address TEXT                 -- per-booking dropoff (school, work, test centre)
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

**`mock_tests`** — id, learner_id, started_at, completed_at, result (pass/fail), total_driving/serious/dangerous_faults, notes

**`mock_test_faults`** — id, mock_test_id, part (1-3), skill_key, driving/serious/dangerous_faults

**`quiz_results`** — id, learner_id, question_id, skill_key, correct, learner_answer, correct_answer, answered_at

**`competency_snapshots`** — id, learner_id, skill_key, lesson_avg, quiz_accuracy, quiz_attempts, fault counts, readiness_score, last_practised

**`learner_onboarding`** — id, learner_id (unique), prior_hours_pro, prior_hours_private, previous_tests, transmission, test_booked, test_date, main_concerns, completed_at

**`qa_questions`** — Q&A forum questions table

**`qa_replies`** — Q&A forum replies table

**`google_reviews`** — Cached Google Reviews

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
| `update-profile` | POST | JWT | Update bio, contact, buffer, qualifications, vehicle, service area, languages, ical_feed_url |
| `ical-test` | POST | JWT | Test-fetch an iCal feed URL, returns event count |
| `ical-status` | GET | JWT | Returns iCal sync status (url, last_synced, error, event_count) |
| `cancel-booking` | POST | JWT | Cancel a confirmed booking (always refunds learner credit) |
| `reschedule-booking` | POST | JWT | Move a booking to a new slot (no time restriction, no count limit) |
| `create-booking` | POST | JWT | Book a lesson on behalf of a learner (cash/credit/free payment) |
| `blackout-dates` | GET | JWT | Returns active/future blackout date ranges. Response: `{ blackout_dates: [{ id, start_date, end_date, reason }] }` |
| `set-blackout-dates` | POST | JWT | Replace all future blackout ranges. Body: `{ ranges: [{ start_date, end_date, reason? }] }`. Validates no overlaps, max 365-day span |
| `payout-history` | GET | JWT | Paginated payout records for the instructor |
| `next-payout-preview` | GET | JWT | Estimated next Friday payout amount + eligible lesson count |

### API — `api/connect.js` (Stripe Connect)

| Action | Method | Auth | Description |
|---|---|---|---|
| `create-account` | POST | Instructor JWT | Create Express account + return onboarding URL |
| `onboarding-link` | GET | Instructor JWT | Fresh onboarding link for incomplete setup |
| `connect-status` | GET | Instructor JWT | Check account status, auto-update DB if complete |
| `dashboard-link` | GET | Instructor JWT | Stripe Express dashboard login link |
| `admin-create-account` | POST | Admin JWT | Create Express account for a specific instructor |
| `admin-send-invite` | POST | Admin JWT | Create account + email onboarding link to instructor |

### API — `api/cron-payouts.js` (Vercel Cron — Fridays 09:00 UTC)

Processes weekly payouts for all onboarded instructors. Auth: CRON_SECRET or Admin JWT.
Eligible bookings: status='completed' OR (status='confirmed' AND scheduled_date <= NOW() - 3 days).
Creates Stripe transfers to instructor Express accounts. Sends email notifications.
Safety: UNIQUE(booking_id) on payout_line_items prevents double-payment.

### Database tables

**`instructors`** — name, email, phone, bio, photo_url, active flag, buffer_minutes (default 30), min_booking_notice_hours (default 24), calendar_start_hour (default 7), adi_grade, pass_rate, years_experience, specialisms (JSONB array), vehicle_make, vehicle_model, transmission_type (manual/automatic/both), dual_controls (default true), service_areas (JSONB array), languages (JSONB array, default ["English"]), ical_feed_url, ical_last_synced_at, ical_sync_error, stripe_account_id, stripe_onboarding_complete, payouts_paused, weekly_franchise_fee_pence (NULL = commission model, non-NULL = fixed weekly fee)

**`instructor_availability`** — recurring weekly windows per instructor (day_of_week 0-6, start_time, end_time)

**`instructor_blackout_dates`** — date ranges when an instructor is unavailable (holidays, sick days). Columns: blackout_date (start), end_date, reason. Single-day blackouts have end_date = blackout_date. Slot generation skips all dates within any active range. Indexed on (instructor_id, blackout_date, end_date).

**`instructor_external_events`** — synced events from instructor's personal iCal feed (event_date, start_time, end_time, is_all_day, uid_hash for dedup). Indexed on (instructor_id, event_date). Used by slot generation to block slots that conflict with personal events.

**`lesson_offers`** — instructor-initiated lesson offers pending learner acceptance + payment. Fields: token (unique, 64-char hex), instructor_id, learner_email, learner_id (nullable — set when learner exists or after payment creates account), scheduled_date, start_time, end_time, lesson_type_id, status ('pending'/'accepted'/'expired'/'cancelled'), booking_id (set by webhook after payment), stripe_session_id, expires_at (24h from creation), accepted_at. Partial unique index on (instructor_id, scheduled_date, start_time) WHERE status='pending' prevents duplicate pending offers for the same slot. Pending offers block slot availability.

**`instructor_login_tokens`** — magic-link tokens with expiry and used flag

**`instructor_payouts`** — id, instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence (audit trail, NULL for commission model), stripe_transfer_id, period_start, period_end, status ('pending'/'processing'/'completed'/'failed'/'skipped'), failure_reason, created_at, completed_at

**`payout_line_items`** — id, payout_id, booking_id (UNIQUE — prevents double-payment), price_pence, instructor_amount_pence, commission_rate

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
| `toggle-payout-pause` | POST | JWT | Pause or resume an instructor's payouts |
| `payout-overview` | GET | JWT | All instructors' connect status, upcoming estimates, recent payouts |
| `process-payouts` | POST | JWT | Manual trigger for payout processing (same logic as cron) |
| `instructor-payout-history` | GET | JWT | Payout history with line items for a specific instructor |

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

## PWA

The site is a Progressive Web App:

- `manifest.json` — app name, icons, standalone display mode, start_url: /learner/
- `sw.js` — service worker caching app shell + network-first for dynamic content
- `pwa.js` — handles beforeinstallprompt event, shows custom install banner
- `offline.html` — branded offline fallback page
- Icons generated in 6 sizes (48-512px) with maskable variants
- Works on Chrome, Edge, Safari (iOS 16.4+), Samsung Internet

---

## Maintenance mode

Set `MAINTENANCE_MODE=true` in Vercel environment variables to redirect all visitors to `/maintenance.html`. API routes (`/api/*`) are exempt. Handled by `middleware.js`.

---

## Known gotchas

- **JWT_SECRET must be set in Vercel** — without it, all auth endpoints return 500
- **ANTHROPIC_API_KEY must be set** — without it, Ask the Examiner and Lesson Advisor return "AI service not configured"
- **Neon Postgres cold starts** — first request after inactivity may be slow (~1-2s)
- **HLS.js CDN** — classroom loads HLS.js from jsDelivr; consider self-hosting if CDN latency becomes an issue
- **Videos are now DB-backed** — managed from admin portal; `videos.json` is a legacy fallback only
- **Neon sql tagged templates** — the Neon serverless driver does NOT support nested `sql` template literals for conditional queries; always use separate query branches instead
- **Mobile autoplay** — browsers require videos to start muted; `video.muted = false` after a user gesture unlocks sound
- **Klarna** — enabled via Stripe dashboard, not hardcoded; no code changes needed to toggle it
- **DB migrations** — single file `db/migration.sql` covers all tables; run via `GET /api/migrate?secret=MIGRATION_SECRET`. Legacy per-feature files in `db/migrations/` are superseded
- **Magic link tokens** — two-step flow (validate then verify) prevents email-client link prefetchers from consuming tokens; `verify` is POST-only
- **Slot reservations** — 10-minute TTL; expired reservations are excluded from availability but cleaned up lazily (on next webhook or when table is queried)
- **Dynamic pricing table** — `guarantee_pricing` is auto-created and seeded on first call to `/api/guarantee-price`; no manual migration needed. The webhook increments the price atomically after each Pass Programme purchase. Admin can override the price via the editor or direct API call.
- **Pricing page routing** — all site nav "Pricing" links now point to `/learner-journey.html`, not `/lessons.html`. The old lessons page still works for PAYG/bulk but is no longer the primary entry point.
- **PostHog analytics** — all pages include the PostHog snippet for event tracking and session recording
- **competency-config.js** — shared across 6 pages; changes affect quiz, mock test, log session, progress, onboarding, and AI context
- **sidebar.js** — used on all 22+ pages; changes affect entire site navigation
- **PWA caching** — service worker caches app shell; update CACHE_NAME version string in sw.js to bust cache on deploy
- **Stripe tool_use** — the AI Advisor uses Claude's tool_use to create checkouts; pricing bounds enforced server-side in api/advisor.js

---

## Recent changes (March–April 2026)

- **"Next available" slot feed** (2.52) — replaced weekly/monthly/daily calendar with a flat feed of available slots sorted by date+time. Sticky lesson type pill bar, progressive 14-day loading, removed ~500 lines of old calendar code. Also fixed admin adjust-credits and postcode save bugs.
- **Pickup address & lesson types** (2.51) — pickup postcode prompt on book.html encourages learners to add their address for travel filtering; setmore-sync backfills `learner_users.pickup_address` from booking data; buy-credits.html now shows dynamic single-lesson type cards alongside bulk hour packages; Test Ready Guarantee section temporarily hidden
- **Dashboard redesign** (2.44) — replaced top section of both learner and instructor dashboards with app-style layout: orange gradient hero card (next lesson with countdown), horizontal pill shortcuts (5 icons), colourful action cards (3 gradient cards). Inspired by Klarna/Zing/Monday.com. No new API endpoints.
- **Foundation cleanup** (#75–78) — centralised DB migration (`db/migration.sql` + `/api/migrate`), extracted shared CSS/JS into `public/shared/` (removed ~984 lines of duplicated CSS), wired up shared auth JS (`ccAuth.getAuth()`, `ccAuth.logout()`), added email error alerts on all 500 errors (`api/_error-alert.js`)
- **PWA support** (#62) — manifest, service worker, install prompt, offline page, generated icons
- **Codebase cleanup** (#61) — fixed migration numbering, extracted shared auth/mail helpers, removed dead files
- **AI Lesson Advisor** (#60) — conversational AI sales assistant using Claude tool_use to recommend lesson packages and create Stripe checkouts dynamically within pricing bounds
- **Learner onboarding** (#59) — 3-step "Build Your Driving Profile" flow (prior experience, initial 17-skill self-assessment), dashboard profile completion card, AI personalisation (Ask the Examiner now reads full learner profile)
- **My Progress page** (#57) — radar chart, skill breakdown table, mock test history, readiness scores, session timeline
- **Mock Test & Log Session upgrade** (#56) — mock driving test with 3 x 10-min parts and full DL25 fault recording, log session upgraded to 17 skills with fault tallies
- **DL25 competency system** (#55) — competency-config.js (17 skills, 5 areas, fault types), database tables (mock_tests, mock_test_faults, quiz_results, competency_snapshots), skill_ratings fault columns
- **Sidebar navigation** (#53, #54) — replaced all nav patterns with context-aware sidebar, collapsible Lessons group with sub-tabs
- **Examiner Knowledge Base** (#52) — 50-question interactive quiz + AI-powered Ask the Examiner chat, both based on DVSA DL25 marking sheet
- **Dashboard improvements** (#51) — prevented instructor emails creating learner accounts, UI polish
- **Learner hub logged-out experience** (#50) — improved landing for unauthenticated visitors
- **Sidebar profile visibility** (#49) — hide My Profile link when not logged in
- **Google Reviews** — embedded Google Reviews on public pages
- **Q&A system** — learner/instructor Q&A forum with question threads and replies

---

---

## GDPR Compliance (April 2026)

Full GDPR compliance implemented. See `CLAUDE.md` for rules that apply to all future changes.

### API endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/learner?action=export-data` | POST | Learner JWT | Downloads all personal data as JSON (Article 20) |
| `/api/learner?action=request-deletion` | POST | Learner JWT | Sends deletion verification email (Article 17) |
| `/api/learner?action=confirm-deletion` | POST | None (token) | Confirms and executes account deletion |
| `/api/config?action=record-consent` | POST | None | Records cookie consent decision to DB |
| `/api/cron-retention` | GET | Vercel cron / CRON_SECRET | Weekly data retention enforcement |

### Database tables

| Table | Purpose |
|---|---|
| `cookie_consents` | Stores consent decisions (visitor_id, analytics boolean, ip_hash, timestamp) |
| `audit_log` | Admin action audit trail (who did what to whom, when) |
| `deletion_requests` | Tracks self-service deletion flow (pending → confirmed → completed) |

### Key columns added to existing tables

| Table | Column | Purpose |
|---|---|---|
| `learner_users` | `last_activity_at` | Tracks last login/booking for retention policy |
| `learner_users` | `archived_at` | Soft-delete timestamp (set by retention cron) |
| `enquiries` | `archived_at` | Soft-delete timestamp (set by retention cron) |
| `credit_transactions` | `anonymized` | Boolean, set when learner is deleted (records kept for tax) |

### Deletion cascade (user-initiated or retention cron)

When a learner is deleted, data is handled as follows:
- **Anonymized** (kept for tax): `credit_transactions` — `learner_id` set to NULL, `anonymized = true`
- **Deleted**: skill_ratings, driving_sessions, quiz_results, mock_tests, qa_questions/answers, lesson_bookings, learner_onboarding, waitlist, instructor_learner_notes, learner_availability, magic_link_tokens, sent_reminders, slot_reservations, lesson_confirmations
- **Nullified**: cookie_consents.learner_id set to NULL
- **Confirmation email** sent after successful deletion

### Retention policy (enforced by `cron-retention.js`)

| Data | Retention | Action |
|---|---|---|
| Learner accounts | 3 years after last activity | Soft-archive → hard-delete after 90 days |
| Enquiries | 2 years after submission | Soft-archive → hard-delete after 30 days |
| Credit transactions | 7 years (legal/tax) | Anonymized, then purged after 7 years |
| Cookie consents | 2 years | Deleted |
| Deletion requests | 90 days after completion | Deleted |

### Cookie consent flow

1. User visits any page → `cookie-consent.js` shows banner (if no prior consent)
2. User chooses Accept All / Reject All / Save Preferences
3. Choice saved to `localStorage` key `cc_cookie_consent`
4. Choice recorded to `cookie_consents` table via `/api/config?action=record-consent`
5. `posthog-loader.js` checks consent — loads PostHog only if analytics accepted
6. User can re-open banner via "Cookie Settings" link (sidebar footer + landing page footer)
7. Revoking analytics consent calls `posthog.opt_out_capturing()` and clears PostHog localStorage

### Frontend GDPR features (learner profile page)

- **View my data** — opens `/learner/my-data.html` showing all personal data in a readable format
- **Cookie Preferences** — opens consent banner to change analytics setting
- **Delete My Account** — two-step confirmation dialog → verification email → token-based deletion

---

## Security & Performance (April 2026)

### Security

- **Security headers** on all responses via `middleware.js`: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Centralised CORS** in `middleware.js` — only allows `coachcarter.uk`, `coachcarter.co.uk`, Vercel previews, localhost
- **Parameterized SQL only** — no dynamic table/column name interpolation anywhere in the codebase
- **Rate limiting** on magic link sends — max 5 per email/phone per hour (`rate_limits` table)
- **Neon connection** — SSL (`sslmode=require` + `channel_binding=require`), connection pooling (`-pooler` hostname)

### Performance — Database Indexes

28 indexes added to FK columns and common query patterns:

| Index | Purpose |
|---|---|
| `lesson_bookings(school_id, status, scheduled_date)` | Admin dashboard, booking lists |
| `lesson_bookings(instructor_id, scheduled_date, start_time)` | Slot availability checks |
| `lesson_bookings(learner_id, status)` | Learner booking history |
| `lesson_bookings(learner_id)`, `(instructor_id)`, `(lesson_type_id)` | FK joins |
| `credit_transactions(learner_id)` | Balance/transaction lookups |
| `driving_sessions(user_id)`, `skill_ratings(user_id)` | Progress tracking |
| `quiz_results(learner_id)`, `mock_tests(learner_id)` | Learner progress |
| `qa_questions(user_id)`, `qa_answers(question_id)` | Q&A lookups |
| `magic_link_tokens(email)`, `(phone)` | Partial indexes for login |
| + 15 more FK indexes | See `db/migration.sql` |

---

## What's still to build

- **Refund flow** — learner requests cash refund, admin approves, Stripe reverses
- **Automated reminders** — 24-hour email/SMS before lessons (Vercel cron)
- **Waiting list** — capture leads when fully booked
- **Referral system** — unique links, credit bonuses for both parties
- **Push notifications** — lesson reminders, quiz nudges, new message alerts (PWA)
- **Capacitor native wrapper** — App Store / Play Store submission
- ~~**Instructor dashboard** — earnings tracking, lesson stats, learner progress overview~~ ✅ Done (earnings page + Stripe Connect payouts)
- **Theory test prep** — built-in revision tools
