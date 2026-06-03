# CoachCarter Website — Project Reference

> **Last updated:** 3 April 2026

A complete reference for the CoachCarter driving instructor website. Use this when continuing development with an AI assistant — paste it in at the start of a new session so the AI is fully up to speed.

---

## What the site is

A driving instructor website for CoachCarter (Fraser). It has seven distinct areas:

- **Public marketing site** — homepage, pricing, availability, about, contact, Google Reviews
- **Learner portal** — dashboard, lesson booking, session logging, progress tracking, examiner quiz, AI examiner chat, AI lesson advisor, mock driving tests, onboarding, videos, profile
- **Instructor portal** — schedule, availability, profile
- **Admin portal** — instructors, bookings, availability, videos, dashboard
- **Classroom** — public video library with grid + reels UI
- **Examiner Knowledge Base** — interactive quiz + AI chat based on DVSA DL25 marking sheet
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
│   ├── learner.js                  # Learner sessions, progress, profile, competency, onboarding
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
│   ├── guarantee-price.js          # Dynamic Pass Programme pricing (read/override) — Pass Programme is hidden, increment-on-purchase retired with PR-J 2026-05-19
│   ├── update-status.js            # Booking status update
│   ├── advisor.js                  # AI Lesson Advisor with Stripe tool_use checkout
│   ├── ask-examiner.js             # AI examiner chat with personalised learner context
│   ├── address-lookup.js           # Address autocomplete API
│   ├── cron-retention.js           # GDPR data retention cron (weekly, archives/purges inactive data)
│   ├── cron-reconcile-payments.js  # Hourly Stripe webhook reconciliation — alerts on paid sessions missing from credit_transactions
│   ├── cron-referral-rewards.js    # Daily 04:00 UTC. Issues per-lesson referrer rewards (floor(duration/3) min) after a 7-day grace
│   ├── r.js                        # Bound to /r/:code via vercel.json. Logs click + redirects to login with ?ref=CODE
│   ├── _audit.js                   # GDPR audit logging utility (logAudit)
│   ├── _booking-status.js          # Three-state booking lifecycle constants + predicates (scheduled / chargeable / refunded). See docs/booking-statuses.md
│   ├── _payout-helpers.js          # Shared payout logic used by cron-payouts.js and admin manual trigger
│   ├── cron-auto-complete.js       # Hourly cron — flips scheduled → chargeable at end_time + 1 hour
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
│   ├── lessons.html                # Bulk packages marketing page. Bulk hours buy via /api/credits?action=checkout (login wall, PR-J 2026-05-19). PAYG buttons redirect to /learner/book.html. Pass Programme hidden 2026-04-28.
│   ├── admin.html                  # Redirect shim → /admin/login.html
│   ├── admin-availability.html     # Standalone admin availability management
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
│   │   └── lessons.html            # My Lessons — tabbed upcoming/past view with cancel, reschedule, calendar actions
│   ├── instructor/
│   │   ├── login.html              # Magic-link login for instructors
│   │   ├── dashboard.html          # Compact dashboard — today's lessons + Book Lesson + lesson detail modal
│   │   ├── index.html              # Full calendar (monthly/weekly/daily/agenda views)
│   │   ├── availability.html       # Instructor sets their own weekly availability
│   │   ├── earnings.html           # Weekly earnings and payout history
│   │   ├── learners.html           # Learner management and skill tracking
│   │   └── profile.html            # Instructor updates bio, contact details, and buffer time
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

**Landing routes:**
- `/` — marketing homepage (scrollable, for cold/curious traffic). Replacing the linktree as of April 2026 (groundwork in 2.82, homepage page ships in follow-up commit).
- `/login.html` — linktree-style 2-button picker (Learner / Instructor). Primary entry for returning users and PWA installs (`manifest.json` `start_url` points here).

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
- **Mobile bottom bar:** floating pill style (border-radius 26px, 10px side margins, frosted glass blur, layered shadow) — 5 fixed tabs for learner (Home/Lessons/Practice/Learn/Profile), 4 for instructor (Calendar/Learners/Earnings/Profile)
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

Learners buy hours, stored per learner/instructor in `learner_credit_balances`, via Stripe (Klarna available). New credit purchases are priced server-side for the selected instructor:

Rate precedence is learner/instructor custom rate → instructor hourly rate → school default `schools.config.pricing.bulk_hourly_pence`. School-wide tiers live in `schools.config.pricing.bulk_discount_tiers`, but apply only when the selected instructor has `instructors.bulk_tiers_enabled = TRUE`. New instructors default off; Fraser is grandfathered on. Existing credit rows keep their snapshotted `effective_rate_pence_per_minute`.

The school default is currently **£55 per hour** (£82.50 for a standard 1.5-hour lesson). Instructor-scoped balances are stored as `learner_credit_balances.balance_minutes`; the legacy `learner_users.balance_minutes` column is an aggregate/display shadow.

Admins can set `instructors.hourly_rate_pence` when creating/editing instructors; leaving it blank stores NULL and inherits the school default. Admins can also set `bulk_tiers_enabled`, and instructors can manage the same opt-in from their profile.

`/learner/buy-credits.html` is selected-instructor-aware: learners must choose an instructor before checkout, the page fetches `/api/credits?action=bulk-pricing&instructor_id=...`, labels the balance as hours with that instructor, shows the effective hourly rate returned by the server, and only shows discount/savings copy when that instructor has opted into bulk tiers. Checkout still posts `{ hours, instructor_id }`; the server remains the pricing source of truth.

Direct pay-and-book uses the same effective hourly fallback for the selected instructor and lesson duration: learner/instructor custom rate → instructor hourly rate → school default `bulk_hourly_pence`. Bulk discount tiers do not apply to direct single-slot payments. The booking modal gets these prices from server APIs and checkout sends only slot/instructor/lesson-type context, not a client-side amount.

Instructor-created paid offers now freeze their final per-lesson price into `lesson_offers.offer_price_pence` at creation. Explicit `offer_price_pence` wins, including £0 free offers; otherwise the server computes custom learner rate → instructor hourly rate → school default for the lesson duration, then applies the offer's `discount_pct`. Bulk-tier opt-in never discounts offers. Repeat-offer Stripe checkout uses the stored per-lesson price as `unit_amount` and the selected repeat count as `quantity`, so accepted offers do not reprice later.

**Lesson type catalogue defaults** (managed via admin portal; selected-instructor checkout recalculates the final payable price):
- 1-Hour Lesson — 60 min / £55.00 (active, instructor opt-in only)
- Standard Lesson — 90 min / £82.50
- 2-Hour Lesson — 120 min / £110.00
- More types can be added via admin portal (`api/lesson-types.js`)

### How booking works

- Instructors set recurring weekly availability windows (admin or self-service via instructor portal)
- The slot engine (`api/slots.js`) generates slots based on the selected lesson type's duration
- Learners select a lesson type (if multiple exist), browse the calendar, filter by instructor (optional), and book
- Booking is instant — no instructor approval needed
- **With hours balance:** Duration deducted from the selected instructor's `learner_credit_balances.balance_minutes` row on booking; returned automatically to the booking instructor's row on 48+ hour cancellations
- **Without balance (pay-per-slot):** Slot reserved for 10 minutes during Stripe Checkout; on payment, hours added + deducted atomically, booking created, .ics calendar attachment sent to both parties
- **Guest checkout (no account):** Unauthenticated learners can book via `checkout-slot-guest`. They provide name, email, phone, and pickup address in the booking modal. The API creates a learner account immediately (find-or-create by email), reserves the slot with the real learner_id, then redirects to Stripe. The existing webhook handles the rest unchanged. Rate limited by IP and phone number. Guest bookings tagged with `created_by = 'guest_checkout'`
- **Spectator mode (April 2026):** `/learner/book.html` is publicly accessible — every "Book" CTA across the marketing surface routes there directly (no login redirect). Logged-out visitors see a `#guestBanner` and a guest-aware sidebar (Buy Credits, Upcoming, Profile filtered out via `authOnly`). Inside the booking modal, when the school's lesson types include a row with `slug='trial'`, an inline CTA "Claim this as your free trial →" redirects to `/free-trial.html?instructor_id=…&date=…`. The slot is not force-converted; the trial handler enforces strict duration matching, so the guest re-picks a real trial slot on the dedicated page (which honours the hints by filtering and scrolling).
- **Free trial (self-serve, no payment):** Public `/free-trial.html` page lets anyone book a 1-hour free first lesson without an account. POSTs to `/api/slots?action=book-free-trial`, which creates a `confirmed` booking with `payment_method='free'`, `created_by='free_trial_self_serve'`, `minutes_deducted=0`. No Stripe involved. Email confirmation includes a magic-link so the guest can sign in to manage the booking. Guarded against repeat use by email or phone (any status — cancelled trials count). Instructors must include `"trial"` in their `offered_lesson_types` (or have it `NULL`) to be surfaced. The page also accepts optional `?instructor_id=` and `?date=` hints (used by the `book.html` "claim as free trial" CTA) — `instructor_id` filters the slot feed, `date` highlights and scrolls to the matching day group via `.day-group--preselected`.
- **Demo instructor:** Bookings against the demo instructor (email `demo@coachcarter.uk`) are free — no credit check or deduction. The demo instructor is excluded from real booking flows via email check in `api/instructors.js` and `api/slots.js`. No emails sent to the demo instructor on book/cancel. Cancel returns no credits (since none were taken).
- Race condition protection via DB unique index on `(instructor_id, scheduled_date, start_time)` + slot reservations table

### Cancellation policy

- 48+ hours notice — lesson credit returned automatically to the learner's balance with the booking instructor
- Under 48 hours — credit forfeited, learner informed at time of cancellation
- Approved cash/card refunds are separate from cancellation credit returns. Customer copy should say: "Where a refund is approved, it will be returned to the original payment method where possible. Any non-refundable payment processing fees charged by our payment provider will be deducted from the refunded amount." Solicitor review is still recommended before treating this as final legal copy.

---

## Learner portal

### Authentication

**Password login** at `/learner/login.html` (May 2026 — replaced magic links). Learner enters email + password. Existing accounts without a password (created via the old magic-link or SMS flow) are migrated on next login: a 6-digit code is emailed, they verify it, then choose a password. Phone-only learners (no email on the account) are prompted to add an email first.

JWT lives in an httpOnly cookie (`cc_learner`); the `cc_learner` localStorage key holds a display-only blob `{ user: { id, name, email, school_id, tier } }` so the sidebar doesn't need an extra API call.

**Forgot password** sends both a 6-digit code and a clickable reset link. The code is the primary path (works inside the PWA without cross-context bugs); the link is a desktop-friendly fallback.

### API — `api/learner-auth.js` (May 2026)

| Action | Method | Auth | Description |
|---|---|---|---|
| `check-account` | POST | No | Routes login UI: `{ exists, has_password }` for an email. Blocks instructor emails. Body: `{ email }` |
| `login` | POST | No | Email + password sign-in. 5-fail / 15-min lockout per email. Body: `{ email, password }` |
| `signup` | POST | No | Create account with password. Free-trial credit + audit-logged. Body: `{ email, password, name?, referral_code?, school_id? }` |
| `set-password` | POST | No (ticket) | Completes migration or reset. Body: `{ ticket, password }` (ticket from `verify-email-code`) |
| `set-password-from-offer` | POST | No (offer token) | Bridges a paid lesson offer to an authed session for guest learners on `offer-success.html`. Verifies offer is `accepted`, learner has no password yet, and `accepted_at` is within 24h. Sets password + issues session. Audit-logged as `learner.password_set` with `purpose: 'offer_signup'`. Body: `{ offer_token, password }` |
| `request-reset` | POST | No | Sends reset email (code + link). Enumeration-safe. Body: `{ email }` |
| `add-email` | POST | No | Phone-only user adds an email so they can migrate to password. Body: `{ phone, email }` |

### API — `api/magic-link.js` (legacy + email-code paths)

Kept for SMS code login, password-reset emails, and the migration code flow. Magic-link login (long URL token) is no longer the primary path for learners but `verify` is preserved for in-flight emails during deploys.

| Action | Method | Auth | Description |
|---|---|---|---|
| `send-link` | POST | No | Legacy magic-link / current SMS code send. Body: `{ email, phone, method }` |
| `validate` | GET | No | Lightweight token check (legacy) |
| `verify` | POST | No | Legacy magic-link consume + login. Body: `{ token }` |
| `verify-code` | POST | No | SMS 6-digit code → JWT. Body: `{ code, phone }` |
| `send-email-code` | POST | No | Sends a 6-digit email code for `purpose: 'migration'\|'reset'`. Enumeration-safe. Body: `{ email, purpose, role? }` |
| `verify-email-code` | POST | No | Verifies a 6-digit email code, returns a 5-min ticket the caller exchanges via `learner-auth?action=set-password`. Body: `{ email, code, purpose, role? }` |
| `logout` | POST | No | Clears `cc_learner` + `cc_csrf` cookies |

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
| `unlogged-bookings` | GET | Yes | Returns past chargeable bookings that haven't been logged yet |
| `mock-tests` | GET/POST | Yes | Create and list mock tests |
| `mock-test-faults` | GET/POST | Yes | Record/retrieve per-skill faults for mock test parts |
| `quiz-results` | GET/POST | Yes | Persist per-question examiner quiz results |
| `competency` | GET | Yes | Full competency dashboard data (lesson ratings, quiz accuracy, mock summary, faults) |
| `onboarding` | GET/POST | Yes | Get/save onboarding profile (prior experience + initial self-assessment) |
| `profile-completeness` | GET | Yes | Returns profile completion steps; dashboard uses prior_experience + initial_assessment (2 steps) |
| `validate-referral` | GET | No | Public. Validates a referral code before signup. Params: `code`, `school_id`. Returns `{ ok, valid, referrer_first_name }`. Rate-limited (10/min per IP) |
| `referral-code` | GET | Yes | Returns learner's referral code (auto-generates on first call). `share_url` is the short form `https://coachcarter.uk/r/CODE`. Returns `{ ok, enabled, code, share_url }` |
| `referral-stats` | GET | Yes | Referral dashboard data: `{ ok, total_referred, total_reward_minutes, recent_referrals[] }`. Each `recent_referrals` entry includes `status` (`joined` / `booked` / `lessoned`) computed from the referee's bookings |
| `my-availability` | GET | Yes | Returns learner's active weekly availability windows |
| `set-availability` | POST | Yes | Replace all availability windows. Body: `{ windows: [{ day_of_week, start_time, end_time }] }` |
| `accept-terms` | POST | Yes | Records T&C acceptance (`terms_accepted_at = NOW()`). Called from login flow gate. |

### Broadcast offer endpoints (PR 2b, on `api/instructor.js`)

| Action | Method | Auth | Description |
|---|---|---|---|
| `preview-broadcast-audience` | GET | Instructor | `?scheduled_date=YYYY-MM-DD&start_time=HH:MM&end_time=HH:MM` — returns learners with active weekly availability covering the slot. Each learner row includes their full availability windows so the picker can show "Mon · Wed eves" alongside the name. |
| `create-broadcast-offer` | POST | Instructor | Body: `{ scheduled_date, start_time, lesson_type_id?, discount_pct? (0/25/50/75/100), learner_ids[] }`. Mints `lesson_offers` rows with `kind='broadcast'`, `trigger='instructor_manual'`, shared `batch_id`, and per-recipient frozen `offer_price_pence` from effective instructor pricing. Sends WhatsApp + email per recipient. |
| `close-broadcast-offer` | POST | Instructor | Body: `{ batch_id }`. Cancels all pending siblings via `supersedeBroadcastSiblings()` and sends "no longer available" follow-up. Slot is implicitly freed. |
| `my-broadcast-batches` | GET | Instructor | Returns active broadcast batches with pending counts for the dashboard card. |

### Module — `api/_notify-availability.js`

Internal module (no public actions). Two exports:

**`notifyAvailableLearners({ instructor_id, instructor_name, scheduled_date, start_time, end_time, lesson_type_id, school_id })`** — called from `api/slots.js` after a cancellation. Finds every learner with an active `learner_availability` window covering the freed slot and either:
- Sends a plain "slot opened" WhatsApp + email (default), OR
- Mints a broadcast offer batch in `lesson_offers` at 25% off effective instructor pricing and emails per-recipient single-use tokens to `/accept-offer.html?token=…`. Triggered when the cancellation is <48h before lesson start AND `instructors.broadcast_offers_enabled = TRUE`.

**`supersedeBroadcastSiblings({ instructor_id, scheduled_date, start_time, school_id, winnerOfferId, batchId })`** — called from booking paths (Stripe webhook for offer accept, `slots.js?action=book`, webhook `handleSlotBooking`). Marks all pending broadcast offers on the slot/batch except the winner as `'superseded'` and sends a "no longer available" WhatsApp + email follow-up.

Replaced the retired `api/waitlist.js` (May 2026). Weekly availability is now the single primitive — no separate waitlist signup is required. Broadcast offers shipped in PR 2a.

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
| `balance` | GET | Yes | Returns aggregate `balance_minutes`, `balance_hours`, `credit_balance`, recent transactions, and per-instructor `balances: [{ instructor_id, instructor_name, balance_minutes, balance_hours }]`. Optional `instructor_id` validates school scope and adds `selected_instructor_balance_minutes` / `selected_instructor_balance_hours`. |
| `checkout` | POST | Yes | Creates Stripe checkout for hours purchase. Body: `{ hours, instructor_id }` (or legacy `{ quantity, instructor_id }` for lesson count). New learner-facing purchases require an active same-school instructor; Stripe metadata includes `instructor_id`, `amount_pence`, `discount_pct`, and `effective_rate_pence_per_minute` from the instructor-aware server total. |
| `create-payment-intent` | POST | Learner | Native PaymentSheet credit purchase prep. Body: `{ hours, instructor_id }` (or legacy `{ quantity, instructor_id }`). Requires an active same-school instructor, prices via `calcBulkTotal(sql, schoolId, hours, { instructorId, learnerId })`, creates a Stripe PaymentIntent with the same `credit_purchase` metadata contract as Checkout, and returns `{ clientSecret, paymentIntentId, ...pricingEcho }`. `payment_intent.succeeded` grants through the shared `grantCredits` path using PaymentIntent idempotency. |
| `bulk-pricing` | GET | No | Public pricing contract for buy-credits UI. Optional `instructor_id` validates same-school active non-demo instructor and returns instructor-aware `hourly_pence`, applicable `discount_tiers`, `bulk_tiers_enabled`, and `rate_source`; optional `hours` also returns `full_pence`, `discount_pct`, `discount_amount_pence`, and `total_pence`. |
| `verify` | GET | Yes | Post-checkout safety net. Params: `session_id` (Stripe checkout session ID). Checks Stripe payment status and grants credits idempotently if webhook missed them. Returns `{ ok, already_processed }` or `{ ok, granted, hours, minutes }`. Referrer rewards are NOT issued here — `cron-referral-rewards.js` handles them per completed lesson |

### API — `api/r.js` (referral short URL)

Bound to `/r/:code` via a `vercel.json` rewrite. No `?action=` routing — this is a single-purpose endpoint.

| Method | Auth | Description |
|---|---|---|
| GET | No | Validates the code against `referrals`, rate-limits per IP+code (30/hr), logs a row in `referral_clicks` with hashed IP, then 302-redirects to `/learner/login.html?ref=CODE`. Unknown codes 302 to `/` with no attribution. Fail-open on any error so a shared link never breaks the friend's experience |

### API — `api/slots.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `available` | GET | No | Available slots for a lesson type duration. Params: `from`, `to`, `instructor_id?`, `lesson_type_id?`, `pickup_postcode?`, `min_duration_only?`. When `min_duration_only=1`, the API treats `lesson_type_id` as grid-spacing only and skips the `offered_lesson_types` filter — used by the slot-first feed where the instructor list isn't yet narrowed by duration. |
| `durations-for-slot` | GET | No | Slot-first companion to `available`. For a given `instructor_id` + `date` + `start_time`, returns every active lesson type for the school (excluding `slug='trial'`) with a `fits` boolean + `reason` (`window`/`notice`/`not_offered`/`clash`/`travel`/`null`). Optional `pickup_postcode` runs the same travel-time heuristic as the slot feed. Used by `book.html` when the user clicks a slot to populate the modal duration dropdown. |
| `book` | POST | Yes | Book a slot — deducts `duration_minutes` from the selected instructor's LCB row. Body includes `lesson_type_id` |
| `checkout-slot` | POST | Yes | Pay-per-slot: reserves slot, creates Stripe Checkout from effective instructor hourly pricing × lesson duration. Bulk tiers are ignored. |
| `checkout-slot-guest` | POST | No | Guest checkout: validates guest fields (name, email, phone, pickup), finds-or-creates learner account, reserves slot, creates Stripe Checkout from effective instructor hourly pricing × lesson duration. Bulk tiers are ignored. Rate limited: 10/IP/hr + 5/phone/hr |
| `book-free-trial` | POST | No | Self-serve free trial booking. No Stripe. Body matches `checkout-slot-guest` plus optional `referral_code`. Resolves the `trial` lesson type (id 37, school 1), runs a one-trial-per-learner guard (email OR phone, any status), creates a `scheduled` booking with `payment_method='free'`, generates a 7-day magic-link token, emails learner + instructor. Rate limited: 10/IP/hr + 3/phone/hr |
| `cancel` | POST | Yes | Cancel a booking. 48h+ notice → status flips to `refunded` and `minutes_deducted` returned to balance. <48h notice → status stays `scheduled` with `credit_forfeited = TRUE` so the hourly cron later flips it to `chargeable` and the instructor is still paid. See `docs/booking-statuses.md`. |
| `reschedule` | POST | Yes | Move a scheduled booking to a new slot (48hr+ notice, max 2 per chain, no balance change) |
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

**DB columns:** `lesson_bookings.setmore_key`, `lesson_bookings.pickup_address`, `lesson_bookings.cancel_reason`, `lesson_bookings.edited_at` (set when manually edited — sync skips these), `learner_users.setmore_customer_key`, `learner_users.welcome_email_sent_at`, `instructors.setmore_staff_key`, `instructors.setmore_last_synced_at`, `instructors.setmore_sync_error`

### API — `api/setmore-welcome.js`

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/setmore-welcome` | GET | CRON_SECRET | Cron job (daily 10am). Sends one-time welcome email with 7-day magic link to Setmore-created learners who haven't logged in. Processes up to 10 per run. Tracked via `welcome_email_sent_at`. |

### API — `api/_travel-time.js` (shared helper)

Two-mode travel time checking between pickup postcodes. **Slot filtering** (pre-booking) uses postcodes.io + haversine estimation to hide unreachable slots — returns `travel_hidden` count in API response, shown as a banner on `book.html`. **Booking warning** (post-booking) uses OpenRouteService for precise routing — warning only, does not block.

**Env:** `OPENROUTESERVICE_API_KEY` — free API key from openrouteservice.org (only needed for post-booking warnings; slot filtering uses free postcodes.io)

**DB columns:** `instructors.max_travel_minutes` — per-instructor threshold (default 30 mins), editable from admin portal

**DB columns:** `instructors.offered_lesson_types` JSONB — array of lesson type slugs the instructor offers (e.g. `["standard","2hr"]`). NULL means the default active lesson set; opt-in-only slugs such as `"1hr"` are excluded until explicitly saved in the array. Controls which pills appear on `/book/:slug` and filters `/api/lesson-types?action=list` when `instructor_id` is passed.

### API — `api/offers.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `get-offer` | GET | None (token) | Returns offer details for public accept page |
| `accept-offer` | POST | None (token) | Collects learner details. Paid offers → Stripe checkout. Free slot-pinned → creates booking directly. Free flexible → creates/finds learner, adds credit, redirects to success page. |
| `expire-offers` | POST | CRON_SECRET | Bulk-expires stale pending offers (hourly cron) |

### API — `api/instructor.js` (offer actions)

| Action | Method | Auth | Description |
|---|---|---|---|
| `create-offer` | POST | Instructor JWT | Creates lesson offer, sends email to learner. Body: `{ learner_email?, learner_name?, scheduled_date?, start_time?, lesson_type_id?, offer_price_pence?, discount_pct?, max_repeat_weeks? (1-18) }`. New paid offers snapshot final `offer_price_pence`: explicit pence wins, otherwise effective instructor pricing with optional offer discount. `max_repeat_weeks > 1` lets the learner book a recurring weekly series via the accept page (skip-clash, may exceed the 12-week self-serve cap). |
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
price_pence INTEGER NOT NULL        -- admin catalogue/base price; direct selected-instructor checkout recalculates from effective hourly pricing
colour TEXT DEFAULT '#3b82f6'       -- hex for calendar colour-coding
active BOOLEAN DEFAULT TRUE
sort_order INTEGER DEFAULT 0
created_at TIMESTAMPTZ
```

**`learner_availability`** — recurring weekly free-time windows per learner (mirrors `instructor_availability`). Columns: `learner_id`, `day_of_week` (0-6), `start_time`, `end_time`, `active`. Used by `api/_notify-availability.js` to ping matching learners on cancellation, and surfaced on the instructor's "My Learners" page so the instructor can see who's flexible.

**`waitlist`** — *retired May 2026.* Replaced by `learner_availability` driving cancellation notifications. Table dropped via `db/migration.sql`.

**`driving_sessions`** / **`skill_ratings`** — session logging tables. `driving_sessions` has optional `booking_id` (FK to `lesson_bookings`) to link sessions to completed bookings. Unique constraint ensures one log per booking. Skill ratings use Traffic Light system: `struggled` (red), `ok` (amber), `nailed` (green). `skill_ratings` also has `driving_faults`, `serious_faults`, and `dangerous_faults` columns for DL25 fault tracking.

**`credit_transactions`**
```sql
id SERIAL PRIMARY KEY
learner_id INTEGER
type TEXT               -- see allowed values below
credits INTEGER
minutes INTEGER DEFAULT 0  -- hours equivalent (in minutes)
amount_pence INTEGER
payment_method TEXT
stripe_session_id TEXT
created_at TIMESTAMPTZ
```
Allowed `type` values (enforced by `credit_transactions_type_check`):
- `purchase` — bulk credit purchase via Stripe (or free trial bonus from learner signup)
- `slot_purchase` — pay-per-slot or lesson-offer payment via Stripe
- `edit_adjustment` — booking edit changed lesson length (admin/instructor)
- `admin_add` / `admin_remove` — manual credit adjustment by admin
- `referral_bonus` — credit granted to a new learner who signed up with a referral code
- `referral_reward` — credit granted to the referrer when the referee completes a lesson (cron)
- `refund` — reserved for future refund flows (no callsite writes this today; cancellations update `balance_minutes` directly without an audit row)

**`learner_credit_balances`** — per `(learner_id, instructor_id)` scoped credit balance. Columns: `learner_id`, `instructor_id`, `school_id`, `balance_minutes`, `updated_at`, unique `(learner_id, instructor_id)`. This is the materialised balance; `credit_transactions` are grants and `booking_credit_sources` are deductions.

Per-instructor credit safety tracker: [`docs/per-instructor-credits-audit.md`](docs/per-instructor-credits-audit.md). Read it before changing credit purchase, booking, cancellation, refund, reconciliation, admin adjustment, platform-balance, or balance display paths.

**`booking_credit_sources`** — Step 5 financial attribution rows linking a booking to the credit transaction source(s) that funded it. Columns: `booking_id`, `credit_transaction_id`, `school_id`, `minutes_drawn`, `rate_pence_per_minute`, `contribution_pence`, `stripe_fee_pence`, `absorbed_by`, `refunded_at`, `created_at`. Tenant-scoped by explicit `school_id`; active rows are `refunded_at IS NULL`; unique `(booking_id, credit_transaction_id)` prevents retry double-inserts.

**`credit_source_adjustments`** — additive source-level adjustment ledger for cash refunds, admin corrections, and dispute clawbacks. Columns: `credit_transaction_id`, `kind`, `minutes_adjusted`, `pence_adjusted`, `reason`, `stripe_refund_id`, `created_at`, `created_by`. Never mutates `credit_transactions.minutes` / `amount_pence`.

**`refund_events`** — dedicated refund accounting ledger for approved/manual refund work. Columns: `school_id`, `learner_id`, `created_by`, `refund_type` (`credit_purchase`, `repeat_offer_partial`, `direct_slot`, `direct_offer`, `manual_record`), `status` (`previewed`, `manual_review`, `blocked`, `executed`), gross/fee/net pence, Stripe identities, idempotency key, reason, metadata, created_at.

**`refund_event_lines`** — itemised refund ledger lines keyed to source rows. Columns: `school_id`, `refund_event_id`, optional `credit_transaction_id`, `booking_credit_source_id`, `lesson_booking_id`, `credit_source_adjustment_id`, gross/source-fee/withheld/net pence, `minutes_adjusted`, created_at.

**`refund_event_notes`** — admin-only refund notes timeline linked to `refund_events`. Columns: `school_id`, `refund_event_id`, `created_by`, `note_type` (`operator_note`, `evidence`, `incident`, `repair_decision`), `incident_status` (`open`, `watching`, `resolved`, `not_applicable`), body, optional evidence reference, metadata, created_at. Notes do not mutate refund ledger, booking, payout, Stripe, CSA, or learner credit state.

**`lesson_bookings`**
```sql
id SERIAL PRIMARY KEY
learner_id INTEGER
instructor_id INTEGER
scheduled_date DATE
start_time TIME
end_time TIME
status TEXT             -- 'scheduled', 'chargeable', 'refunded' (CHECK constraint enforced; see api/_booking-status.js)
credit_returned BOOLEAN DEFAULT FALSE
credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE  -- set when learner late-cancels under 48h; instructor still paid
stripe_session_id TEXT  -- idempotency key for pay-per-slot bookings
rescheduled_from INTEGER  -- links to the booking this one replaced (NULL for original bookings)
reschedule_count INTEGER DEFAULT 0  -- how many times this booking chain has been rescheduled (max 2)
created_by TEXT DEFAULT 'learner'    -- 'learner', 'instructor', 'admin'
payment_method TEXT DEFAULT 'credit' -- 'credit', 'stripe', 'cash', 'free'
lesson_type_id INTEGER              -- FK to lesson_types
transmission_type TEXT DEFAULT 'manual' -- 'manual' or 'automatic'; concrete per-lesson vehicle type
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

**`google_reviews`** — Cached Google Reviews

---

## Instructor portal

The instructor login page (`/instructor/login.html`) presents a choice: "I'm a CoachCarter instructor" (email + password sign in) or "Join the team" (enquiry form for prospective instructors). Instructors are **invite-only** — accounts are created by admins via the admin portal. Admins set or reset instructor passwords; the instructor is forced to change their password on first login. There is no self-serve forgot-password — instructors are told to contact the admin.

### API — `api/instructor-auth.js` (May 2026)

| Action | Method | Auth | Description |
|---|---|---|---|
| `login` | POST | No | Email + password sign-in. Returns `must_change_password: true` if the password was admin-set. 5-fail / 15-min lockout per email. |
| `change-password` | POST | JWT | Self-serve password change. Requires current_password to re-prove identity. Used by both forced first-login and voluntary changes from profile. |
| `logout` | POST | No | Clear `cc_instructor` + `cc_csrf` cookies |

### API — `api/instructor.js` (legacy magic-link login + portal actions)

The magic-link login actions (`request-login`, `validate-token`, `verify-token`) are retained but no longer called by the UI — they stay as an emergency fallback path. New code should use `api/instructor-auth.js` for sign-in.

| Action | Method | Auth | Description |
|---|---|---|---|
| `request-login` | POST | No | (Legacy) Send magic link to instructor email — retained, not used by UI. |
| `validate-token` | GET | No | (Legacy) Lightweight token check |
| `verify-token` | POST | No | (Legacy) Consume token, return JWT. Body: `{ token }` |
| `schedule` | GET | JWT | Instructor's upcoming scheduled bookings |
| `schedule-range` | GET | JWT | Bookings, pending offers, and one-off availability overrides in date range for calendar views. Query: `from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `availability` | GET | JWT | Current weekly availability windows |
| `set-availability` | POST | JWT | Update weekly availability windows |
| `availability-overrides` | GET | JWT | Date-specific extra availability. Query: `from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `create-availability-override` | POST | JWT | Add a one-off available window without changing weekly availability. Body: `{ override_date, start_time, end_time, note? }` |
| `delete-availability-override` | POST | JWT | Remove a one-off available window. Body: `{ id }` |
| `profile` | GET | JWT | Profile details, including `bulk_tiers_enabled` and read-only `effective_hourly_rate_pence` |
| `update-profile` | POST | JWT | Update bio, contact, buffer, qualifications, vehicle, service area, languages, ical_feed_url, and `bulk_tiers_enabled` |
| `ical-test` | POST | JWT | Test-fetch an iCal feed URL, returns event count |
| `ical-status` | GET | JWT | Returns iCal sync status (url, last_synced, error, event_count) |
| `cancel-booking` | POST | JWT | Cancel a scheduled booking (always refunds learner credit — instructor-initiated cancellations bypass the 48h rule). Body: `{ booking_id, reason?, notify? }` — `notify: false` skips learner email |
| `reschedule-booking` | POST | JWT | Move a booking to a new slot (no time restriction, no count limit) |
| `edit-booking` | POST | JWT | In-place edit of a booking's date, time, or lesson type. Body: `{ booking_id, scheduled_date?, start_time?, lesson_type_id?, force?, notify? }`. Adjusts the learner's balance with that booking's instructor if duration changes. Returns conflict details if overlapping (with `can_force: true`). Sets `edited_at`, Setmore sync skips edited bookings |
| `create-booking` | POST | JWT | Book a lesson on behalf of a learner (cash/credit/free payment) |
| `blackout-dates` | GET | JWT | Returns active/future blackout date ranges. Response: `{ blackout_dates: [{ id, start_date, end_date, reason }] }` |
| `set-blackout-dates` | POST | JWT | Replace all future blackout ranges. Body: `{ ranges: [{ start_date, end_date, reason? }] }`. Validates no overlaps, max 365-day span |
| `payout-history` | GET | JWT | Paginated payout records for the instructor |
| `next-payout-preview` | GET | JWT | Estimated next Friday payout amount + eligible lesson count |
| `running-late` | POST | JWT | Notify all remaining learners today that instructor is running late. Body: `{ delay_minutes }` (1-120). Sends WhatsApp + email to each learner with upcoming scheduled lessons. Returns `{ ok, notified }` |

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
Eligible bookings: `status = 'chargeable'`. The 1-hour buffer on the `scheduled → chargeable` flip in `cron-auto-complete.js` absorbs clock skew and last-minute reschedule races; no extra grace period is applied.
Creates Stripe transfers to instructor Express accounts. Sends email notifications.
Safety: UNIQUE(booking_id) on payout_line_items prevents double-payment. See `docs/booking-statuses.md` for the risk-window analysis.

### API — `api/cron-balance-snapshot.js` (Vercel Cron — daily 08:00 UTC)

Captures a daily snapshot of the Next Payout Preview widget's state into `platform_balance_snapshots`. Auth: CRON_SECRET. Reuses the widget's compute logic via the shared `api/_platform-balance.js` so the snapshot and the dashboard always show identical numbers. The stored `refund_exposure_pence` is the widget's advisory legacy aggregate exposure signal, not an exact per-instructor refund liability.

Two alarm triggers:
- **Trigger A** (in `_payout-helpers.js`) — after a Stripe `transfers.create` failure, looks back at the last 24h of snapshots; if any reported `status='green'`, emails `ERROR_ALERT_EMAIL` with both the snapshot and the Stripe error so a "widget said green, reality was red" mismatch is never silent.
- **Trigger B** (in this cron) — after writing the snapshot, compares trailing-30d Stripe inflow (`credit_transactions` with a Checkout Session, PaymentIntent, or Charge identity) vs trailing-30d payout outflow (`instructor_payouts.amount_pence + stripe_fees_pence WHERE status='completed'`). If outflow > inflow + £100, emails the gap with the five most recent driving payouts. £100 floor exists to suppress noise on quiet weeks.

### Database tables

**`instructors`** — name, email, phone, bio, photo_url, active flag, slug (unique, auto-generated from first name — used for clean booking URLs like `/book/fraser`), buffer_minutes (default 30), min_booking_notice_hours (default 24), calendar_start_hour (default 7), adi_grade, pass_rate, years_experience, specialisms (JSONB array), vehicle_make, vehicle_model, transmission_type (manual/automatic/both), dual_controls (default true), service_areas (JSONB array), languages (JSONB array, default ["English"]), ical_feed_url, ical_last_synced_at, ical_sync_error, stripe_account_id, stripe_onboarding_complete, payouts_paused, weekly_franchise_fee_pence (NULL = commission model, non-NULL = fixed weekly fee), hourly_rate_pence (NULL = inherit school default, non-NULL = admin-set instructor hourly override)

`instructors.hourly_rate_pence` is the admin-editable per-instructor lesson rate override used after any learner/instructor custom rate and before the school default. `instructors.bulk_tiers_enabled` controls whether school-defined bulk discounts apply to future credit purchases for that instructor; when true, the instructor absorbs the discount. It does not discount direct pay-and-book single-slot payments.

**`instructor_learner_notes`** — per instructor-learner pair. Columns: instructor_id, learner_id (unique together), notes, test_date, custom_hourly_rate_pence (NULL = use standard school rate, otherwise hourly rate in pence that scales to all lesson durations). Used by direct booking checkout, lesson-types/duration pricing APIs, credit checkout, earnings view, and payout calculations. Direct pay-and-book pricing uses custom learner rate → instructor hourly rate → school `bulk_hourly_pence`; bulk discounts remain credit-package only.

**`instructor_availability`** — recurring weekly windows per instructor (day_of_week 0-6, start_time, end_time)

**`instructor_availability_overrides`** — date-specific extra availability per instructor. Columns: instructor_id, school_id, override_date, start_time, end_time, active, note. These rows make a single slot/window bookable without altering recurring weekly availability. The learner slot feed and `durations-for-slot` merge them with weekly windows; on blackout dates, explicit overrides are the only windows that can open that date.

**`instructor_blackout_dates`** — date ranges when an instructor is unavailable (holidays, sick days). Columns: blackout_date (start), end_date, reason. Single-day blackouts have end_date = blackout_date. Slot generation skips all dates within any active range. Indexed on (instructor_id, blackout_date, end_date).

**`instructor_external_events`** — synced events from instructor's personal iCal feed (event_date, start_time, end_time, is_all_day, uid_hash for dedup). Indexed on (instructor_id, event_date). Used by slot generation to block slots that conflict with personal events.

**`lesson_offers`** — instructor-initiated lesson offers pending learner acceptance + payment. Two modes: **slot-pinned** (instructor picks date/time) and **flexible** (learner picks from available slots). Fields: token (unique, 64-char hex), instructor_id, learner_email, learner_id (nullable — set when learner exists or after payment creates account), scheduled_date (nullable — NULL for flexible offers), start_time (nullable), end_time (nullable), lesson_type_id, discount_pct, offer_price_pence (nullable for legacy pending offers; new paid/free offers store the frozen final per-lesson pence), status ('pending'/'accepted'/'expired'/'cancelled'), booking_id (set by webhook after payment), stripe_session_id, expires_at (24h from creation), accepted_at. New offer pricing uses explicit `offer_price_pence` if supplied, otherwise effective instructor pricing (custom learner rate → instructor hourly rate → school default) with `discount_pct` applied to that base; bulk tiers are credit-package only and never affect offers. Partial unique index on (instructor_id, scheduled_date, start_time) WHERE status='pending' AND scheduled_date IS NOT NULL prevents duplicate pending offers for the same slot. Slot-pinned pending offers block slot availability; flexible offers do not block any slot until the learner picks one.

**`instructor_login_tokens`** — magic-link tokens with expiry and used flag

**`instructor_payouts`** — id, instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence (audit trail, NULL for commission model), stripe_transfer_id, period_start, period_end, status ('pending'/'processing'/'completed'/'failed'/'skipped'), failure_reason, created_at, completed_at, shortfall_pence (amount instructor owes CCL from this period; rolls forward to next positive payout), shortfall_recovered_from_payout_id (NULL until cleared by a later payout), deposit_deducted_pence (£250 vehicle deposit deducted on week-1 Full-Franchise payouts; partial-amount tolerant)

**`payout_line_items`** — id, payout_id, booking_id (UNIQUE — prevents double-payment), price_pence, instructor_amount_pence, commission_rate

**`platform_balance_snapshots`** — id, captured_at, status ('green'/'red'), available_pence, pending_pence, total_payout_pence, balance_after_payout_pence, refund_exposure_pence, payout_preview_json (per-instructor breakdown of the dry-run), trailing_30d_stripe_inflow_pence, trailing_30d_payout_outflow_pence. Written daily by `cron-balance-snapshot.js`. Index on `captured_at DESC` for the Trigger A 24h lookup. Read by `_payout-helpers.js` (Trigger A) and the cron itself (Trigger B). The widget compute lives in `api/_platform-balance.js` and is the single source of truth for both the dashboard and the snapshot. The API exposes exact source-attributed unused-credit exposure separately as `exact_refund_exposure_pence` / `exact_refund_exposure`; the historical `refund_exposure_pence` snapshot column remains the legacy aggregate advisory value, also returned as `legacy_advisory_refund_exposure_pence`. Exact valuation policy and open questions are documented in [`docs/refund-exposure-valuation-audit.md`](docs/refund-exposure-valuation-audit.md).

---

## Admin portal

Login at `/admin/login.html` with email + password. JWT stored in `localStorage` as `cc_admin`.

### API — `api/admin.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `login` | POST | No | Returns JWT. 5-fail/hour per email + 10/hour per IP rate limit. |
| `request-reset` | POST | No | Sends a 6-digit reset code to the admin's email. Enumeration-safe. Body: `{ email }` |
| `reset-password` | POST | No | Verify code + set new password atomically; issues fresh session. Body: `{ email, code, new_password }`. Audit-logged as `admin.password_reset` |
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
| `credit-reconciliation` | POST | JWT | Admin reconciliation for a missed Stripe credit-purchase webhook. Dry-run/inspection requests (`dry_run: true` or `mode: 'inspect'`) are non-mutating and return `inspection_only: true`, `credit_granted: false`. Mutating mode requires a non-empty `reason`, runs Stripe/DB inspection plus `buildReconciliationGrantInput()` before any mutation, writes through the shared serialized LCB credit mutation path, and audit-logs `admin.credit_reconciliation`. The admin UI currently exposes inspection only; no apply/grant button has shipped. |
| `credit-goodwill` | POST | JWT | Grant goodwill credits to a learner/instructor pair through the shared serialized LCB credit mutation path. Requires learner/instructor scope, minutes, reason, and `absorbed_by` (`platform` or `instructor`). Audit-logged as `admin.credit_goodwill_grant` |
| `refund-preview` | POST | JWT | Read-only admin refund planner for net-of-processing-fee refunds. Supports credit purchase/source previews, partial repeat-offer unused value previews, and direct slot/offer booking previews. It itemises gross lesson credit value, withheld original processing fee, and net amount returned; blocks missing-fee cases and already-paid-out direct bookings for manual review. It does not write `refund_events`, mutate credit balances/CSA, or call `stripe.refunds.create`. |
| `execute-refund` | POST | JWT | Tightly gated admin refund executor. Requires `idempotency_key` and `operator_go: "EXECUTE_REFUND_CONFIRMED"`, re-runs `_refund-planner.js`, blocks manual-review plans, calls `stripe.refunds.create` through an injectable Stripe client, writes `refund_events(status='executed')` / `refund_event_lines`, creates CSA + locked balance decrements for supported unused credit-source refunds, and audit-logs `admin.execute_refund`. Already-paid-out direct bookings remain blocked. |
| `record-manual-bank-refund` | POST | JWT | Ledger-only manual bank refund record. Requires `idempotency_key`, `operator_go: "RECORD_MANUAL_BANK_REFUND_CONFIRMED"`, `manual_bank_reference`, and a reason. Optional `evidence_reference` and `operator_note` are retained in `refund_events.metadata`. It re-runs `_refund-planner.js`, refuses clean execute-eligible original-method refunds, writes executed refund ledger rows/lines, and audit-logs `admin.record_manual_bank_refund`. It does not call Stripe, change bookings, edit payout rows, create CSA rows, or mutate learner credit. |
| `refund-notes` | GET | JWT | Lists admin refund notes for a school-scoped `refund_event_id`. Returns the refund event summary plus ordered `refund_event_notes` rows. |
| `add-refund-note` | POST | JWT | Adds an admin note to a school-scoped refund event. Body: `{ refund_event_id, note_type, body, incident_status?, evidence_reference? }`. Supports operator/evidence/incident/repair-decision notes and audit-logs `admin.add_refund_note`. It records context only; it does not repair or mutate refund accounting. |
| `invite-learner` | POST | JWT | Create learner account and send 7-day magic link invite email |
| `edit-booking` | POST | JWT | In-place edit of a booking's date, time, or lesson type (same as instructor version but admin-scoped). Audit-logged |
| `instructor-blackouts` | GET | JWT | Get future blackout dates for an instructor (`?instructor_id=X`) |
| `set-instructor-blackouts` | POST | JWT | Replace all future blackout dates for an instructor. Body: `{ instructor_id, ranges }` |
| `update-learner` | POST | JWT | Edit learner name/email/phone/pickup_address. Audit-logged with before/after values |
| `referral-activity` | GET | JWT | Aggregated referral stats per school (referrer names, codes, counts, total rewards) |
| `referral-config` | GET | JWT | Current referral config for the school (enabled, welcome bonus, reward minutes) |
| `update-referral-config` | POST | JWT | Update referral config. Body: `{ referral_enabled, referral_welcome_bonus_minutes, referral_reward_minutes }`. Audit-logged |

Refund operations runbook: [`docs/refund-operator-runbook.md`](docs/refund-operator-runbook.md).

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
- **Dynamic pricing table** — `guarantee_pricing` is auto-created and seeded on first call to `/api/guarantee-price`. The webhook-driven price increment was retired with PR-J (2026-05-19) when the legacy Stripe checkout was deleted. The Pass Programme is hidden on the marketing site; the table now serves as a read-only admin-override source for `current_price` if it's ever re-enabled.
- **Pricing page routing** — all site nav "Pricing" links point to `/learner-journey.html`, not `/lessons.html`. `/lessons.html` is now a bulk-packages marketing page that funnels into `/api/credits?action=checkout` (login wall required). PAYG buttons redirect to `/learner/book.html` instead of running a Stripe checkout themselves (PR-J 2026-05-19).
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
| `/api/cron-reconcile-payments` | GET | Vercel cron / CRON_SECRET | Hourly check that completed Stripe sessions have matching `credit_transactions` rows; alerts on mismatches |
| `/api/cron-referral-rewards` | GET | Vercel cron / CRON_SECRET | Daily (04:00 UTC). For every chargeable paid lesson by a referred learner past a 7-day grace window, credits the referrer with `floor(duration_minutes / 3)` minutes. Per-booking idempotency via `lesson_bookings.referral_rewarded_at` |

### Database tables

| Table | Purpose |
|---|---|
| `cookie_consents` | Stores consent decisions (visitor_id, analytics boolean, ip_hash, timestamp) |
| `audit_log` | Admin action audit trail (who did what to whom, when) |
| `deletion_requests` | Tracks self-service deletion flow (pending → confirmed → completed) |
| `referrals` | Learner referral codes (learner_id, school_id, code, unique per school) |
| `referral_clicks` | One row per visit to `/r/CODE` — referral_code, school_id, ip_hash (sha256, first 16 chars), user_agent, referer, clicked_at. Pre-signup, so referee not yet known. Used for attribution debugging and abuse signal |

### Key columns added to existing tables

| Table | Column | Purpose |
|---|---|---|
| `learner_users` | `last_activity_at` | Tracks last login/booking for retention policy |
| `learner_users` | `archived_at` | Soft-delete timestamp (set by retention cron) |
| `enquiries` | `archived_at` | Soft-delete timestamp (set by retention cron) |
| `credit_transactions` | `anonymized` | Boolean, set when learner is deleted (records kept for tax) |
| `learner_users` | `referred_by` | FK to learner_users(id) — permanent link to referrer |
| `magic_link_tokens` | `referral_code` | Carries referral code through the signup flow |
| `lesson_bookings` | `referral_rewarded_at` | Per-booking idempotency key set by `cron-referral-rewards.js`. Once stamped, a booking will never trigger another reward |

### Deletion cascade (user-initiated or retention cron)

When a learner is deleted, data is handled as follows:
- **Anonymized** (kept for tax): `credit_transactions` — `learner_id` set to NULL, `anonymized = true`
- **Deleted**: skill_ratings, driving_sessions, quiz_results, mock_tests, lesson_bookings, learner_onboarding, instructor_learner_notes, learner_availability, magic_link_tokens, sent_reminders, slot_reservations, lesson_confirmations, referrals
- **Untouched** (no PII tied to learner): `referral_clicks` is keyed by `referral_code` not `learner_id`, and stores only `ip_hash` — clicks remain attributable to the code without identifying any individual
- **Nullified**: cookie_consents.learner_id set to NULL, learner_users.referred_by set to NULL (for referred learners)
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
| `magic_link_tokens(email)`, `(phone)` | Partial indexes for login |
| + 15 more FK indexes | See `db/migration.sql` |

---

## What's still to build

- **Refund flow polish** — backend preview, tightly gated execute, admin execute UI, manual bank-refund ledger recording, and admin refund notes timeline exist. Learner request UI, richer approval workflow, and actual incident repair tooling are still to build.
- **Automated reminders** — 24-hour email/SMS before lessons (Vercel cron)
- **Waiting list** — capture leads when fully booked
- **Referral system** — unique links, credit bonuses for both parties
- **Push notifications** — lesson reminders, quiz nudges, new message alerts (PWA)
- **Capacitor native wrapper** — App Store / Play Store submission
- ~~**Instructor dashboard** — earnings tracking, lesson stats, learner progress overview~~ ✅ Done (earnings page + Stripe Connect payouts)
- **Theory test prep** — built-in revision tools
