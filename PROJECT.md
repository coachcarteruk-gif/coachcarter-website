# CoachCarter Website — Project Reference

> **Last updated:** 13 August 2026

A complete reference for the CoachCarter driving instructor website. Use this when continuing development with an AI assistant — paste it in at the start of a new session so the AI is fully up to speed.

---

## What the site is

A driving instructor website for CoachCarter (Fraser). It has seven distinct areas:

- **Public marketing site** — homepage, pricing, availability, about, contact, Google Reviews
- **Learner portal** — dashboard, lesson booking, session logging, progress tracking, examiner quiz, AI examiner chat, AI lesson advisor, mock driving tests, onboarding, videos, profile
- **Instructor portal** — schedule, availability, shared team notes, profile
- **Admin portal** — instructors, bookings, availability, videos, dashboard
- **Classroom** — public video library with grid + reels UI
- **Examiner Knowledge Base** — interactive quiz + AI chat based on DVSA DL25 marking sheet
- **AI Lesson Advisor** — conversational AI lesson-planning assistant. Self-serve credit checkout links are retired.

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
| `STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION` | Stripe Payment Method Configuration ID used only by Reserved Weekly Slot Pay by Bank Checkout. The referenced Stripe configuration must be Pay by Bank-only for this product; Pay As You Go and offers must not use this env var. |
| `STRIPE_PACKAGES_TEST_RESTRICTED_KEY` | Dedicated Stripe test-mode restricted key for Learner Package Checkout only; no live/shared-key fallback. |
| `STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION` | Dedicated test-mode Pay by Bank Payment Method Configuration ID for Learner Packages. Must not be the Reserved Weekly Slot configuration. |
| `STRIPE_PACKAGES_TEST_WEBHOOK_SECRET` | Signing secret for the separate `/api/package-webhook` endpoint. |
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
│   ├── credits.js                  # Credit balance, retired self-serve credit checkout, verification for in-flight sessions
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
│   ├── advisor.js                  # AI Lesson Advisor; checkout tool retired
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
│   ├── lessons.html                # Lesson options marketing page. Self-serve credit packages retired; CTAs route to booking. Pass Programme hidden 2026-04-28.
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
│   │   ├── buy-credits.html        # Read-only existing Lesson Credit balance page
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

Existing Lesson Credit is stored per learner/instructor in `learner_credit_balances`. Learner-facing self-serve credit purchases are retired as of Stage 2 of the pricing/booking work; learners without enough Lesson Credit use direct pay-and-book instead. Existing balances remain spendable and eligible cancellation/reschedule/admin-return behaviour is unchanged.

Historical and operator credit rows keep their snapshotted pricing:

Rate precedence is learner/instructor custom rate → instructor hourly rate → school default `schools.config.pricing.bulk_hourly_pence`. School-wide tiers live in `schools.config.pricing.bulk_discount_tiers`, but apply only when the selected instructor has `instructors.bulk_tiers_enabled = TRUE`. New instructors default off; Fraser is grandfathered on. Existing credit rows keep their snapshotted `effective_rate_pence_per_minute`.

The school default is currently **£55 per hour** (£82.50 for a standard 1.5-hour lesson). Instructor-scoped balances are stored as `learner_credit_balances.balance_minutes`; the legacy `learner_users.balance_minutes` column is an aggregate/display shadow.

Admins can set `instructors.hourly_rate_pence` when creating/editing instructors; leaving it blank stores NULL and inherits the school default. Admins can also set `bulk_tiers_enabled`, and instructors can manage the same opt-in from their profile.

`/learner/buy-credits.html` remains only as a read-only existing Lesson Credit balance page for old bookmarks. It fetches `/api/credits?action=balance`, can filter by instructor, and does not create checkout sessions.

Direct pay-and-book uses the same effective hourly fallback for the selected instructor and lesson duration: learner/instructor custom rate → instructor hourly rate → school default `bulk_hourly_pence`. Bulk discount tiers do not apply to direct single-slot payments. The booking modal gets these prices from server APIs and checkout sends only slot/instructor/lesson-type context, not a client-side amount.

Instructor-created paid offers now freeze their final per-lesson price into `lesson_offers.offer_price_pence` at creation. Explicit `offer_price_pence` wins, including £0 free offers; otherwise the server computes custom learner rate → instructor hourly rate → school default for the lesson duration, then applies the offer's `discount_pct`. Bulk-tier opt-in never discounts offers. Repeat-offer Stripe checkout uses the stored per-lesson price as `unit_amount` and the selected repeat count as `quantity`, so accepted offers do not reprice later.

Social video filming is an instructor opt-in (`instructors.social_video_opt_in`) with learner consent captured per booking. If the instructor has opted in and the learner checks the filming option, the server applies a 5% booking-only discount. The booked lesson still uses the full lesson type duration and calendar `end_time`; direct Stripe amounts, paid booking metadata, `lesson_bookings.minutes_deducted`, BCS draw minutes, and cancellation credit returns use the discounted charge value. The booking stores `social_video_consent = TRUE` and `social_video_discount_pct = 5` so instructor agenda views can mark it as filmed.

**Lesson type catalogue defaults** (managed via admin portal; selected-instructor checkout recalculates the final payable price):
- 1-Hour Lesson — 60 min / £55.00 (active, instructor opt-in only)
- Standard Lesson — 90 min / £82.50
- 2-Hour Lesson — 120 min / £110.00
- More types can be added via admin portal (`api/lesson-types.js`)

### How booking works

- Instructors set recurring weekly availability windows (admin or self-service via instructor portal)
- The slot engine (`api/slots.js`) generates slots based on the selected lesson type's duration
- Learners select a lesson type (if multiple exist), browse the calendar, filter by instructor (optional), and book
- Booking is instant — no instructor approval needed — unless the instructor has `request_to_book` enabled (see Request to book below)
- **With hours balance:** Duration deducted from the selected instructor's `learner_credit_balances.balance_minutes` row on booking; returned automatically to the booking instructor's row on 48+ hour cancellations
- **Without balance (pay-per-slot):** Slot reserved for 10 minutes during Stripe Checkout; on payment, hours added + deducted atomically, booking created, .ics calendar attachment sent to both parties
- **Social video filming discount:** When the instructor has opted in and the learner consents in the booking modal, the booking is discounted by 5%. The slot remains blocked for the full lesson duration; the payable credit minutes / Stripe amount are the discounted charge value, and the instructor agenda badges the lesson as filmed.
- **Retired multi-booking creation:** `schools.config.features.retire_incompatible_products === true` is the strict, school-scoped retirement state. Missing, malformed, or non-Boolean values default inactive. When active, the server returns `410 PRODUCT_CREATION_RETIRED` before creating repeated learner bookings, Reserved Weekly Slot previews/commits/bank checkouts, flexible offers, or offers with more than one lesson. Learner/instructor UI removes those entry points. Existing recurring blocks, bookings, credit balances, cancellation returns, moves, status reads, offer history, and in-flight pre-retirement Stripe webhook settlement remain available and unchanged. The flag is prepared but must not be activated in production without the separate communication/readiness approval recorded in the Simon launch log.
- **Recurring weekly block legacy management:** The existing Reserved Weekly Slot implementation remains the management/read model for grandfathered blocks. `recurring-block-status`, `reserved-policy-move`, cancellation, reschedule guards, and series reads remain available. Creation actions (`recurring-block-preview`, `recurring-block-commit`, and `recurring-block-bank-checkout`) retain their historical implementation only for schools where the retirement state is inactive; once active they reject before any hold, booking, credit, or Stripe mutation. In-flight bank sessions created before activation still settle idempotently through the webhook.
- **Guest checkout (no account):** Unauthenticated learners can book via `checkout-slot-guest`. They provide name, email, phone, and pickup address in the booking modal. The API creates a learner account immediately (find-or-create by email), reserves the slot with the real learner_id, then redirects to Stripe. The existing webhook handles the rest unchanged. Rate limited by IP and phone number. Guest bookings tagged with `created_by = 'guest_checkout'`
- **Spectator mode (April 2026; credit purchase update June 2026):** `/learner/book.html` is publicly accessible — every "Book" CTA across the marketing surface routes there directly (no login redirect). Logged-out visitors see a `#guestBanner` and a guest-aware sidebar (Upcoming and Profile filtered out via `authOnly`). The old `buy-credits.html` route is read-only for existing Lesson Credit balances, not a purchase page. Inside the booking modal, when the school's lesson types include a row with `slug='trial'`, an inline CTA "Claim this as your free trial →" redirects to `/free-trial.html?instructor_id=…&date=…`. The slot is not force-converted; the trial handler enforces strict duration matching, so the guest re-picks a real trial slot on the dedicated page (which honours the hints by filtering and scrolling).
- **Free trial (self-serve, no payment):** Public `/free-trial.html` page lets anyone book a 1-hour free first lesson without an account. `/free-lesson.html` is the direct-response landing page for the funnel (July 2026 redesign) — every CTA on it points at `/free-trial.html`; the booking and confirmation pages share its design system (Archivo/Instrument Sans, orange `#F58220`). A small display-only helper `free-trial-sticky.js` mirrors the slot summary into the mobile sticky submit dock. POSTs to `/api/slots?action=book-free-trial`, which creates a `confirmed` booking with `payment_method='free'`, `created_by='free_trial_self_serve'`, `minutes_deducted=0`. No Stripe involved. Email confirmation includes a magic-link so the guest can sign in to manage the booking. Guarded against repeat use by email or phone (any status — cancelled trials count). Instructors must include `"trial"` in their `offered_lesson_types` (or have it `NULL`) to be surfaced. The page also accepts optional `?instructor_id=` and `?date=` hints (used by the `book.html` "claim as free trial" CTA) — `instructor_id` filters the slot feed, `date` highlights and scrolls to the matching day group via `.day-group--preselected`.
- **Demo instructor:** Bookings against the demo instructor (email `demo@coachcarter.uk`) are free — no credit check or deduction. The demo instructor is excluded from real booking flows via email check in `api/instructors.js` and `api/slots.js`. No emails sent to the demo instructor on book/cancel. Cancel returns no credits (since none were taken).
- **Request to book (July 2026, LESSON-REQUEST-PLAN.md):** Per-instructor toggle `instructors.request_to_book`. When ON, the learner's slot feed shows "Request this slot" instead of "Book this slot"; a request holds the payment instead of taking it. Credit path: `?action=request-slot` deducts the minutes as a `request_hold` credit_transactions row (refunded in full via `request_refund` on decline/expiry/withdrawal). Card path: `?action=checkout-request` creates a Stripe Checkout with `capture_method='manual'` — the card is authorized, captured only on accept, cancelled otherwise (works for guests too, same rate limits as guest checkout). Pending requests block their slot everywhere pending offers do (partial unique index `uq_request_slot`). The instructor accepts/declines from a dashboard card (`/api/instructor?action=list-requests|accept-request|decline-request`); accept books through the standard credit FIFO transaction (credit) or a slot-purchase-shaped ledger flow (card). Requests expire at min(created + 48h, lesson start − 2h) via the hourly `?action=expire-requests` cron in `api/requests.js`, which also retries crashed hold releases (`released_at IS NULL`) and closes out accepted-but-never-booked requests in the learner's favour. Learners see and withdraw pending requests from a card on `book.html`. No weekly repeats and no social-video discount on requests (v1).
- Race condition protection via DB unique index on `(instructor_id, scheduled_date, start_time)` + slot reservations table

### Cancellation policy

- 48+ hours notice — lesson credit returned automatically to the learner's balance with the booking instructor
- Under 48 hours — credit forfeited, learner informed at time of cancellation
- Approved cash/card/bank-payment refunds are separate from cancellation credit returns. Customer copy should say: "Where a cash or original-payment-method refund is approved as an exception, it will be returned to the original payment method where possible. Stripe processing fees from the original transaction are not returned by Stripe and will be deducted from the refunded amount. Approved Stripe refunds normally take 5-10 days to appear on the customer's account." If a Stripe original-method refund fails, cannot be funded from the Stripe balance, cannot return to the original method, or is otherwise blocked, the approved refund is handled manually by bank transfer as the last resort and recorded through `POST /api/admin?action=record-manual-bank-refund` with evidence/reference and operator notes. Solicitor review is still recommended before treating customer-facing copy as final legal copy.

---

## Learner portal

### Authentication

**Passwordless email-code login** at `/learner/login.html` (July 2026). Existing learners enter their email, receive a 6-digit code, and are signed in after verification. Learners whose lesson or trial was arranged outside the booking system can create an account with name + email: `purpose: 'signup'` verifies the email, then a 5-minute `audience: 'learner-signup'` ticket authorises `signup-with-code`. That recovery route creates a verified zero-credit account and deliberately grants no additional free-trial entitlement. Legacy password endpoints remain compatibility-only for old accounts and accepted-offer/reset flows; password fields are not part of the primary learner UI.

JWT lives in an httpOnly cookie (`cc_learner`); the `cc_learner` localStorage key holds a display-only blob `{ user: { id, name, email, school_id, tier } }` so the sidebar doesn't need an extra API call.

**Forgot password** sends both a 6-digit code and a clickable reset link. The code is the primary path (works inside the PWA without cross-context bugs); the link is a desktop-friendly fallback.

### API — `api/learner-auth.js` (May 2026)

| Action | Method | Auth | Description |
|---|---|---|---|
| `check-account` | POST | No | Routes login UI: `{ exists, has_password }` for an email. Blocks instructor emails. Body: `{ email }` |
| `login` | POST | No | Email + password sign-in. 5-fail / 15-min lockout per email. Body: `{ email, password }` |
| `signup` | POST | No | Legacy password account creation; retained for compatibility, not used by the primary learner UI. |
| `signup-with-code` | POST | No (ticket) | Create a verified zero-credit account for an offline lesson/trial learner. Audit-logged; issues session cookies. Body: `{ ticket, name, referral_code? }` where ticket has `audience: 'learner-signup'`. |
| `set-password` | POST | No (ticket) | Completes migration or reset. Body: `{ ticket, password }` (ticket from `verify-email-code`) |
| `set-password-from-offer` | POST | No (offer token) | Bridges a paid lesson offer to an authed session for guest learners on `offer-success.html`. Verifies offer is `accepted`, learner has no password yet, and `accepted_at` is within 24h. Sets password + issues session. Audit-logged as `learner.password_set` with `purpose: 'offer_signup'`. Body: `{ offer_token, password }` |
| `request-reset` | POST | No | Sends reset email (code + link). Enumeration-safe. Body: `{ email }` |
| `add-email` | POST | No | Phone-only user adds an email so they can migrate to password. Body: `{ phone, email }` |

### API — `api/magic-link.js` (legacy + email-code paths)

Handles current learner/instructor email-code sign-in, passwordless learner signup verification, SMS fallback, and retained reset/migration flows. Long URL login tokens are legacy-only.

| Action | Method | Auth | Description |
|---|---|---|---|
| `send-link` | POST | No | Legacy magic-link / current SMS code send. Body: `{ email, phone, method }` |
| `validate` | GET | No | Lightweight token check (legacy) |
| `verify` | POST | No | Legacy magic-link consume + login. Body: `{ token }` |
| `verify-code` | POST | No | SMS 6-digit code → JWT. Body: `{ code, phone }` |
| `send-email-code` | POST | No | Sends a rate-limited 6-digit code for `purpose: 'login'\|'signup'\|'migration'\|'reset'`. Existing-account actions are enumeration-safe; signup may return `account_exists`. Body: `{ email, purpose, role?, school_id? }` |
| `verify-email-code` | POST | No | Login verification issues the appropriate session. Signup returns a 5-minute `audience: 'learner-signup'` ticket; migration/reset return a `password-set` ticket for retained compatibility flows. Body: `{ email, code, purpose, role? }` |
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
| `referral-stats` | GET | Yes | Referral dashboard data: `{ ok, total_referred, total_reward_minutes, recent_referrals[] }`. Each `recent_referrals` entry includes first-name display data, `status` (`joined` / `booked` / `lessoned`), `reward_minutes`, and `pending_reward_minutes` computed from the referee's paid bookings |
| `submit-feedback` | POST | Yes | Stores a learner issue report or suggestion in `learner_feedback`. Body: `{ type: 'issue'|'suggestion', title, message, page_url? }`. Rate-limited per learner; issue reports also send a staff email alert. |
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

### Lesson request endpoints (July 2026, on `api/instructor.js`)

| Action | Method | Auth | Description |
|---|---|---|---|
| `list-requests` | GET | Instructor | Pending lesson requests (plus last 30 days decided) for the dashboard card, with learner name/phone and lesson type. Lazily expires stale pending rows so the card never shows an unanswerable request. |
| `accept-request` | POST | Instructor | Body: `{ request_id }`. Atomic pending→accepted claim, pre-flight booking clash check, then: credit path refunds the `request_hold` and books via `createInstructorCreditBookingTransaction`; card path captures the manual-capture PaymentIntent and books via `bookAcceptedCardRequest` (slot_purchase ledger shape). Any failure closes the request in the learner's favour (hold released / capture refunded) with notifications both ways. |
| `decline-request` | POST | Instructor | Body: `{ request_id, reason? }`. Atomic claim → hold released in full (credit refund / PI cancel — the card is never charged) → learner notified with the optional reason. |

### API — `api/requests.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `expire-requests` | GET | CRON_SECRET | Hourly (:20). 1) Expires stale pending requests (release hold + notify learner). 2) Retries hold releases that crashed mid-decision (`released_at IS NULL`, >10 min). 3) Closes out accepted-but-never-booked requests (>15 min) — refunds captured card payments / releases holds, flips to declined, alerts the operator. Shared lifecycle helpers live in `api/_lesson-requests.js`. |

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
| `balance` | GET | Yes | Returns aggregate `balance_minutes`, `balance_hours`, `credit_balance`, recent transactions, and per-instructor `balances: [{ instructor_id, instructor_name, balance_minutes, balance_hours }]`. Optional `instructor_id` validates school scope and adds selected-instructor fields. Also returns strict school state `incompatible_products_retired`; this gates creation displays only and never blocks grandfathered balance reads or spending. |
| `checkout` | POST | Yes | Retired for learner self-serve Lesson Credit purchases. Returns `410 CREDIT_PURCHASE_RETIRED`; existing in-flight paid sessions are still handled by `verify`/webhook. |
| `create-payment-intent` | POST | Learner | Retired for native self-serve Lesson Credit purchases. Returns `410 CREDIT_PURCHASE_RETIRED`; existing webhook handling remains for PaymentIntents already created before retirement. |
| `bulk-pricing` | GET | No | Read-only pricing contract retained for admin/legacy display compatibility. Optional `instructor_id` validates same-school active non-demo instructor and returns instructor-aware `hourly_pence`, applicable `discount_tiers`, `bulk_tiers_enabled`, and `rate_source`; optional `hours` also returns `full_pence`, `discount_pct`, `discount_amount_pence`, and `total_pence`. It does not create purchases. |
| `verify` | GET | Yes | Post-checkout safety net. Params: `session_id` (Stripe checkout session ID). Checks Stripe payment status and grants credits idempotently if webhook missed them. Returns `{ ok, already_processed }` or `{ ok, granted, hours, minutes }`. Referrer rewards are NOT issued here — `cron-referral-rewards.js` handles them per completed lesson |

### API — `api/r.js` (referral short URL)

Bound to `/r/:code` via a `vercel.json` rewrite. No `?action=` routing — this is a single-purpose endpoint.

| Method | Auth | Description |
|---|---|---|
| GET | No | Validates the code against `referrals`, rate-limits per IP+code (30/hr), logs a row in `referral_clicks` with hashed IP, then 302-redirects to `/learner/login.html?ref=CODE`. Unknown codes 302 to `/` with no attribution. Fail-open on any error so a shared link never breaks the friend's experience |

### API — `api/slots.js`

Practical test date lessons use a narrow named exception to the ordinary
28-day learner booking cap: `test-date-availability`, `book-test-date`, and
`checkout-test-date`. These learner-authenticated actions read the learner's
saved `test_date` / `test_time`, force a 90-minute booking, generate nearby
quarter-hour starts around `test_time - 45 minutes`, run normal availability,
clash, reservation, blackout, and travel checks, and snapshot
`booking_purpose='test_date'`, `test_start_time`, and `test_centre` on
`lesson_bookings`. Credit-funded bookings use the existing instructor-scoped
LCB/FIFO/BCS path; direct-pay checkout prices server-side and preserves the
test metadata through the slot-booking webhook.

| Action | Method | Auth | Description |
|---|---|---|---|
| `available` | GET | No | Available slots for a lesson type duration. Params: `from`, `to`, `instructor_id?`, `lesson_type_id?`, `pickup_postcode?`, `min_duration_only?`. When `min_duration_only=1`, the API treats `lesson_type_id` as grid-spacing only and skips the `offered_lesson_types` filter — used by the slot-first feed where the instructor list isn't yet narrowed by duration. |
| `durations-for-slot` | GET | No | Slot-first companion to `available`. For a given `instructor_id` + `date` + `start_time`, returns every active lesson type for the school (excluding `slug='trial'`) with a `fits` boolean + `reason` (`window`/`notice`/`not_offered`/`clash`/`travel`/`null`). Also returns instructor `social_video_opt_in`, `social_video_discount_pct`, and display-only discounted per-duration prices when filming is available. Optional `pickup_postcode` runs the same travel-time heuristic as the slot feed. Used by `book.html` when the user clicks a slot to populate the modal duration dropdown. |
| `recurring-block-preview` | GET | Learner | Legacy future weekly block preview. With retirement active, returns `410 PRODUCT_CREATION_RETIRED` before building a preview. Otherwise validates the authenticated learner/school anchor and returns candidates, skipped reasons, selected slots, pricing, and same-instructor credit sufficiency without storing anything. Existing-block reads use `recurring-block-status`. |
| `recurring-block-commit` | POST | Learner | Legacy credit-funded recurring block creation. With retirement active, returns `410 PRODUCT_CREATION_RETIRED` before mutation. Otherwise revalidates all slots and sufficient same-instructor Lesson Credit, then atomically creates the confirmed block, booked items, future bookings, BCS rows, and scoped LCB decrement. |
| `recurring-block-bank-checkout` | POST | Learner | Legacy Reserved Weekly Slot bank checkout. With retirement active, returns `410 PRODUCT_CREATION_RETIRED` before payment configuration, holds, or Stripe. Otherwise, this remains available. This is the only Checkout path that may use the reserved-block bank payment-method configuration. The referenced Stripe configuration must exclude card, Apple Pay, Klarna, and any non-bank method. The webhook creates `lesson_bookings` only after Stripe reports successful payment. Before payment success it does not mutate `learner_credit_balances`, write BCS rows, or create credit purchase rows, and it does not support partial Lesson Credit plus bank payment. Confirmed bank-paid occurrences use the existing 48h+ cancellation path to return same-instructor Lesson Credit by default; cash/original-payment-method refunds remain admin/operator exceptions. Notifications and expiry cron remain out of v1 scope. Sessions created before retirement activation still settle through the unchanged webhook and remain readable through `recurring-block-status`. |
| `recurring-block-status` | GET | Learner | Learner-facing Reserved Weekly Slot bank checkout status. Params: `block_id`. Requires learner auth, scopes by `learner_id` and `school_id`, opportunistically expires stale `pending_payment` bank blocks (`expires_at <= NOW()`) and releases held items idempotently, then returns block status/funding method/selected lesson count/expiry/safe Stripe refs plus item dates and linked booking IDs for confirmed blocks. It does not mutate `learner_credit_balances`, write BCS rows, create credit purchase rows, or trigger Stripe refunds; it also does not create bookings during cleanup or broaden payout/refund semantics. |
| `book` | POST | Yes | Book a slot — deducts minutes from the selected instructor's LCB row. Body includes `lesson_type_id`, optional per-booking `pickup_address` / `dropoff_address`, and optional `social_video_consent`. If the instructor opted in and consent is true, the server deducts the 5%-discounted charge minutes while the slot still uses the full lesson duration. A changed pickup re-runs the adjacent-lesson travel-spacing gate and can return `PICKUP_TRAVEL_CONFLICT`. |
| `checkout-slot` | POST | Yes | Pay-per-slot: reserves slot, creates Stripe Checkout from effective instructor hourly pricing × lesson duration. Bulk tiers are ignored. Optional `pickup_address` / `dropoff_address` are frozen into Stripe metadata and written to the booking by the webhook; optional `social_video_consent` applies the server-side 5% filming discount only when the instructor opted in. Changed pickup runs the same adjacent-lesson travel-spacing gate before checkout starts. |
| `checkout-slot-guest` | POST | No | Guest checkout: validates guest fields (name, email, phone, pickup), finds-or-creates learner account, reserves slot, creates Stripe Checkout from effective instructor hourly pricing × lesson duration. Optional `dropoff_address` and `social_video_consent` are supported; the filming discount is server-validated against instructor opt-in. Bulk tiers are ignored. Rate limited: 10/IP/hr + 5/phone/hr. Guest pickup runs the adjacent-lesson travel-spacing gate before checkout starts. |
| `book-free-trial` | POST | No | Self-serve free trial booking. No Stripe. Body matches `checkout-slot-guest` plus optional `referral_code`. Resolves the `trial` lesson type (id 37, school 1), runs a one-trial-per-learner guard (email OR phone, any status), creates a `scheduled` booking with `payment_method='free'`, generates a 7-day magic-link token, emails learner + instructor. Rate limited: 10/IP/hr + 3/phone/hr |
| `cancel` | POST | Yes | Cancel a booking. 48h+ notice → status flips to `refunded` and `minutes_deducted` returned to balance. <48h notice → status stays `scheduled` with `credit_forfeited = TRUE` so the hourly cron later flips it to `chargeable` and the instructor is still paid. See `docs/booking-statuses.md`. |
| `reserved-policy-move` | POST | Learner | Learner self-serve 48+ hour move for one confirmed Reserved Weekly Slot occurrence. Body: `{ booking_id, new_date, new_start_time }`. Same school/learner/instructor/lesson type/duration only. Marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the old recurring-block item, creates a replacement booked item, and copies BCS attribution. Under-48-hour attempts return `RESERVED_MOVE_NOTICE_TOO_SHORT`. Does not mutate learner-credit balances, Stripe refunds, refund ledgers, payout rows, payment flows, or notifications. |
| `reschedule` | POST | Yes | Move an ordinary scheduled one-off booking to a new slot (48hr+ notice, max 2 per chain). Optional `new_instructor_id` switches the paid entitlement to another active same-school instructor without charging again; the server rechecks overlapping bookings, reservations, pending requests/offers, recurring holds, active availability, booking window, lesson-type support, transmission, and pickup travel before confirmation. Lesson Credit switches move through paired transfer ledger rows and replacement BCS. Flexible Hours switches atomically return the old append-only allocations and attach identical frozen-value allocations to the replacement booking; Flexible Hours and Lesson Credit cannot fund the same lesson. Body may include replacement `pickup_address` / `dropoff_address`. Confirmed Reserved Weekly Slot occurrences are refused here and must use `reserved-policy-move`, which remains same-instructor only. |
| `my-bookings` | GET | Yes | Learner's bookings with lesson type info (name, colour, duration). Confirmed recurring-block bookings also include reserved-slot read fields: `is_reserved_weekly_slot`, `recurring_slot_block_id`, `recurring_slot_block_item_id`, `reserved_move_notice_hours`, `reserved_move_request_deadline`, `reserved_move_policy_open`, and `reserved_move_policy_mode`. Learner UI uses these fields to show `Move reserved lesson` only for 48+ hour reserved occurrences. |
| `request-slot` | POST | Yes | Request-to-book (credit path): validates like `book` (single slot, no repeats), inserts the pending `lesson_requests` row (claims the slot via `uq_request_slot`), then deducts the minutes as a guarded `request_hold` ledger row via `lockBalanceAndMutate`. Notifies the instructor by SMS + email. 402 `INSUFFICIENT_BALANCE` routes the UI to pay-and-request. Rejects with `REQUEST_TOO_LATE` inside 2h of the slot start and `REQUEST_NOT_ENABLED` when the instructor books instantly. |
| `checkout-request` | POST | No | Request-to-book (card path, learner or guest): Stripe Checkout with `payment_intent_data.capture_method='manual'`, card only. Guest variant find-or-creates the learner account and shares guest-checkout rate limits. Reserves the slot for 10 min; the webhook (`payment_type='lesson_request_hold'`) creates the pending request from the completed (authorized-not-captured) session. |
| `my-requests` | GET | Yes | Learner's lesson requests (pending first, last 90 days). |
| `withdraw-request` | POST | Yes | Learner cancels their own pending request. Atomic status claim → hold released in full (credit refund / PI cancel) → instructor notified. |

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

Two-mode travel time checking between pickup postcodes. **Slot filtering** (pre-booking) uses postcodes.io + haversine estimation to hide unreachable slots — returns `travel_hidden` count in API response, shown as a banner on `book.html`. The same postcodes.io + haversine spacing logic is re-run on booking, pay-and-book checkout, guest checkout, and learner reschedule when a per-booking pickup is selected, returning `PICKUP_TRAVEL_CONFLICT` before the slot is booked or paid for if it no longer leaves enough travel time from adjacent lessons. **Booking warning** (post-booking) uses OpenRouteService for precise routing — warning only, does not block.

**Env:** `OPENROUTESERVICE_API_KEY` — free API key from openrouteservice.org (only needed for post-booking warnings; slot filtering uses free postcodes.io)

**DB columns:** `instructors.max_travel_minutes` — per-instructor threshold (default 30 mins), editable from admin portal

**DB columns:** `instructors.offered_lesson_types` JSONB — array of lesson type slugs the instructor offers (e.g. `["standard","2hr"]`). NULL means the default active lesson set; opt-in-only slugs such as `"1hr"` are excluded until explicitly saved in the array. Controls which pills appear on `/book/:slug` and filters `/api/lesson-types?action=list` when `instructor_id` is passed.

### API — `api/offers.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `get-offer` | GET | None (token) | Returns offer details and strict school retirement state. An active school's legacy flexible offer returns `410 PRODUCT_CREATION_RETIRED`; fixed offers remain readable for one-lesson acceptance. |
| `accept-offer` | POST | None (token) | With retirement active, flexible acceptance or a requested repeat count above one returns `410 PRODUCT_CREATION_RETIRED` before credit, booking, or Stripe mutation. A fixed offer can still produce exactly one lesson. |
| `expire-offers` | POST | CRON_SECRET | Bulk-expires stale pending offers (hourly cron) |

### API — `api/instructor.js` (offer actions)

| Action | Method | Auth | Description |
|---|---|---|---|
| `create-offer` | POST | Instructor JWT | Creates a fixed one-lesson offer. A fixed slot that overlaps a schedule block or falls outside recurring/one-off availability first returns `409 SCHEDULE_OVERRIDE_REQUIRED`; resend with exact Boolean `availability_override: true` to confirm the instructor/admin exception. Real lesson, offer, request, and reservation conflicts remain blocked. With retirement active, flexible input or `max_repeat_weeks > 1` returns `410 PRODUCT_CREATION_RETIRED` before insert or notification. One-off offers keep their existing price snapshot rules. |
| `list-offers` | GET | Instructor JWT | Lists instructor's offers with status filter |
| `cancel-offer` | POST | Instructor JWT | Cancels a pending offer |

### API — `api/ask-examiner.js`

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| (single endpoint) | POST | Yes | AI examiner chat — sends conversation to Claude with DVSA knowledge base system prompt + personalised learner context (onboarding, competency, quiz data) |

### API — `api/advisor.js`

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| (single endpoint) | POST | Yes | AI lesson advisor chat. Recommends lesson planning and booking next steps; the old credit checkout tool is retired. |

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
learner_category TEXT              -- regular/sporadic/inactive/passed for admin segmentation
primary_instructor_id INTEGER      -- optional assigned instructor FK
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

**`learner_feedback`** - authenticated learner issue reports and suggestions. Columns: `school_id`, `learner_id`, `type` (`issue`/`suggestion`), `title`, `message`, `page_url`, `user_agent`, `status` (`open`/`reviewed`/`closed`), `reviewed_at`, `created_at`. Learner submissions are exposed in GDPR export/deletion; admins view and triage them in the portal.

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

Admin lesson edits can correct the duration of unpaid completed credit lessons. Those corrections write an `edit_adjustment` credit transaction against the learner/instructor balance and update the booking's `minutes_deducted`; existing `booking_credit_sources` rows stay as the original funding attribution ledger.

**`recurring_slot_blocks`** — Stage 4 recurring weekly block header. Columns include `school_id`, `learner_id`, `instructor_id`, optional `anchor_booking_id`, `lesson_type_id`, `status` (`pending_payment`, `confirmed`, `payment_failed`, `expired`, `released`), `funding_method` (`lesson_credit`, `bank_payment`), selected lesson count, duration/start/end snapshot, price snapshot, payment references, expiry/confirmation/release timestamps, and JSONB metadata. The first writer is Lesson Credit only and creates `confirmed` rows.

**`recurring_slot_block_items`** — Future slot rows for a recurring block. Columns include `block_id`, `school_id`, `instructor_id`, optional `lesson_booking_id`, date/time, `status` (`held`, `booked`, `released`), and price snapshot. `held` rows block availability without being normal bookings; `booked` rows link to real `lesson_bookings`.

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
payment_method TEXT DEFAULT 'credit' -- 'credit', 'flexible_package', 'stripe', 'cash', 'free'
booking_purpose TEXT DEFAULT 'lesson' -- 'lesson' or 'test_date'
test_start_time TEXT                 -- practical test start snapshot for test-date bookings
test_centre TEXT                     -- practical test centre snapshot for test-date bookings
lesson_type_id INTEGER              -- FK to lesson_types
transmission_type TEXT DEFAULT 'manual' -- 'manual' or 'automatic'; concrete per-lesson vehicle type
minutes_deducted INTEGER            -- hours deducted (in minutes) for audit trail
pickup_address TEXT                  -- per-booking pickup (overrides learner profile)
dropoff_address TEXT                 -- per-booking dropoff (school, work, test centre)
social_video_consent BOOLEAN DEFAULT FALSE       -- learner agreed to filming for this booking
social_video_discount_pct INTEGER DEFAULT 0      -- 0 or 5, snapshotted at booking time
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
| `availability` | GET | JWT | Current weekly availability windows, including `transmission_type` (`manual`, `automatic`, or `both`) |
| `set-availability` | POST | JWT | Update weekly availability windows. Body: `{ windows: [{ day_of_week, start_time, end_time, transmission_type? }] }` |
| `availability-overrides` | GET | JWT | Date-specific extra availability. Query: `from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `create-availability-override` | POST | JWT | Add a one-off available window without changing weekly availability. Body: `{ override_date, start_time, end_time, note? }` |
| `delete-availability-override` | POST | JWT | Remove a one-off available window. Body: `{ id }` |
| `profile` | GET | JWT | Profile details, including `max_booking_days_ahead`, `bulk_tiers_enabled`, `social_video_opt_in`, and read-only `effective_hourly_rate_pence` |
| `update-profile` | POST | JWT | Update bio, contact, buffer, learner advance booking window, qualifications, vehicle, service area, languages, ical_feed_url, `bulk_tiers_enabled`, and `social_video_opt_in` |
| `ical-test` | POST | JWT | Test-fetch an iCal feed URL, returns event count |
| `ical-status` | GET | JWT | Returns iCal sync status (url, last_synced, error, event_count) |
| `cancel-booking` | POST | JWT | Cancel a scheduled booking (always refunds learner credit — instructor-initiated cancellations bypass the 48h rule). Body: `{ booking_id, reason?, notify? }` — `notify: false` skips learner email |
| `mark-not-delivered` | POST | JWT | Pre-payout instructor exception for a past lesson that stayed on the calendar but did not happen. Body: `{ booking_id, reason_code?, note?, notify? }`. Only accepts the signed-in instructor's past `scheduled`/unpaid `chargeable` bookings, refuses rows already present in `payout_line_items`, flips the booking to `refunded`, returns deducted lesson credit to the same learner/instructor balance, marks BCS rows refunded, and audit-logs the reason. |
| `reschedule-options` | GET | JWT | List active same-school instructors eligible for the signed-in instructor's booking lesson type and transmission. Query: `booking_id`. Reserved Weekly Slot occurrences return only the current instructor. |
| `reschedule-availability` | GET | JWT | Read-only preview for an instructor-managed reschedule. Rechecks the selected instructor's availability/overrides, lessons, reservations, blackouts, busy/external events, pending requests/offers, recurring holds, notice/window, and pickup travel spacing. Query: `booking_id`, `new_instructor_id`, `new_date`, `new_start_time`. |
| `reschedule-booking` | POST | JWT | Move an authorised booking to a new slot or active eligible same-school instructor (no old-lesson notice restriction and no count limit). Body: `{ booking_id, new_date, new_start_time, new_instructor_id? }`. Confirmation repeats the full availability check server-side. The old-row termination, replacement booking, and BCS/funding transfer are atomic; cross-instructor moves reuse migration 042's paired transfer ledger and do not charge the learner again. Reserved Weekly Slot occurrences cannot switch instructor. |
| `edit-booking` | POST | JWT | In-place edit of a booking's date, time, or lesson type. Body: `{ booking_id, scheduled_date?, start_time?, lesson_type_id?, force?, notify? }`. Adjusts the learner's balance with that booking's instructor if duration changes. Returns conflict details if overlapping (with `can_force: true`). Sets `edited_at`, Setmore sync skips edited bookings |
| `create-booking` | POST | JWT | Book a lesson on behalf of a learner (cash/credit/flexible-package/free payment). Schedule blocks and times outside recurring/one-off availability first return `409 SCHEDULE_OVERRIDE_REQUIRED`; resend with exact Boolean `availability_override: true` to confirm the exception. Actual lesson and held-request conflicts are not overridable. |
| `blackout-dates` | GET | JWT | Returns active/future blackout date ranges. Response: `{ blackout_dates: [{ id, start_date, end_date, reason }] }` |
| `set-blackout-dates` | POST | JWT | Replace all future blackout ranges. Body: `{ ranges: [{ start_date, end_date, reason? }] }`. Validates no overlaps, max 365-day span |
| `payout-history` | GET | JWT | Paginated payout records for the instructor |
| `next-payout-preview` | GET | JWT | Estimated next Friday payout amount + eligible lesson count |
| `running-late` | POST | JWT | Notify all remaining learners today that instructor is running late. Body: `{ delay_minutes }` (1-120). Sends WhatsApp + email to each learner with upcoming scheduled lessons. Returns `{ ok, notified }` |
| `list-notes` | GET | JWT | List every shared instructor note for the signed-in instructor's school, newest first. Returns each note with its author and timestamp. |
| `create-note` | POST | JWT | Post a note to the signed-in instructor's school-wide board. Body: `{ content }`; trimmed content must be 1–2,000 characters. |

### API — `api/connect.js` (Stripe Connect)

| Action | Method | Auth | Description |
|---|---|---|---|
| `create-account` | POST | Instructor JWT | Create Express account + return onboarding URL |
| `onboarding-link` | GET | Instructor JWT | Fresh onboarding link for incomplete setup |
| `connect-status` | GET | Instructor JWT | Check account status, auto-update DB if complete |
| `dashboard-link` | GET | Instructor JWT | Stripe Express dashboard login link |
| `admin-create-account` | POST | Admin JWT | Create Express account for a specific instructor |
| `admin-send-invite` | POST | Admin JWT | Create account + email onboarding link to instructor |

The Simon interim-v1 hardening adds owner-only, school-scoped actions without
changing the school payout engine:

| Action | Method | Auth | Description |
|---|---|---|---|
| `interim-v1-status` | GET | Superadmin JWT | Database-only durable account/control status |
| `interim-v1-account` | POST | Superadmin JWT + exact confirmation | Establish start/pause/intent, then create or reconcile one exact live Express account |
| `interim-v1-invite` | POST | Superadmin JWT + exact confirmation | Send hosted onboarding only after exact account/start/pause evidence |
| `interim-v1-payout-preview` | GET (`api/admin.js`) | Superadmin JWT | Read-only exact-funding preview and fingerprint |
| `interim-v1-approve-first-run` | POST (`api/admin.js`) | Superadmin JWT + exact confirmation | Immutable fingerprint/amount approval; no money movement |
| `interim-v1-process-approved-payout` | POST (`api/admin.js`) | Superadmin JWT + separate exact confirmation | One durable, reviewed transfer attempt; instructor stays paused |
| `interim-v1-reconcile-transfer` | POST (`api/admin.js`) | Superadmin JWT + exact confirmation | Same-identity ambiguous transfer lookup; never replacement submission |

Migration 043 is additive/inert. A controlled instructor is excluded from the
generic cron and bulk-admin payout selector and cannot be generically unpaused.
Only exact live direct-slot Stripe evidence after the deliberate start can have
positive preview value; incomplete, external, credit, pre-start, test and
contradictory sources are reason-coded manual/£0. See
`docs/simon-interim-v1-hardening-implementation.md`.

Slice 4 adds separately versioned, inactive-by-default actions without changing
those legacy routes:

| Action | Method | Auth | Description |
|---|---|---|---|
| `v2-account` | POST | Instructor JWT | Deterministically create/retrieve/reconcile one same-school Accounts v2 recipient |
| `v2-onboarding-link` | POST | Instructor JWT | Create a recipient hosted-onboarding link after exact gates |
| `v2-onboarding-refresh` / `v2-onboarding-return` | GET | Instructor JWT + signed state | Validate exact scope and refresh link/current status |
| `v2-status` | GET | Instructor JWT | Database-only current readiness and blockers; no historical completion boolean |
| `v2-dashboard-link` | POST | Instructor JWT | Gated Express dashboard login link |
| `v2-agreements` / `v2-agreement-accept` | GET / POST | Instructor JWT | Read and accept an exact immutable agreement fingerprint |
| `v2-admin-readiness` | GET | Admin JWT | Sanitized school-scoped readiness diagnostics |
| `v2-admin-agreement-draft` | POST | Admin JWT | Append a server-validated agreement draft |
| `v2-admin-agreement-activate` | POST | Superadmin JWT | Activate an accepted version only after current account readiness |

`api/webhook-connect-v2.js` is the dedicated Accounts v2 thin-event boundary.
See `docs/stripe-connect-simon-slice-4-rollout-review.md` for gates, schema,
ordering, replay, reconciliation, staging, and rollback rules. These routes do
not activate payouts or replace legacy Connect.

### API — `api/cron-payouts.js` (Vercel Cron — Fridays 09:00 UTC)

Processes weekly payouts for all onboarded, unpaused, non-interim-controlled instructors. Auth: CRON_SECRET or Admin JWT.
Eligible bookings: `status = 'chargeable'`. The 1-hour buffer on the `scheduled → chargeable` flip in `cron-auto-complete.js` absorbs clock skew and last-minute reschedule races; no extra grace period is applied.
Creates Stripe transfers to instructor Express accounts. Sends email notifications.
Safety: UNIQUE(booking_id) on payout_line_items prevents double-payment. See `docs/booking-statuses.md` for the risk-window analysis.

### API — `api/cron-balance-snapshot.js` (Vercel Cron — daily 08:00 UTC)

Captures a daily snapshot of the Next Payout Preview widget's state into `platform_balance_snapshots`. Auth: CRON_SECRET. Reuses the widget's compute logic via the shared `api/_platform-balance.js` so the snapshot and the dashboard always show identical numbers. The stored `refund_exposure_pence` is the widget's advisory legacy aggregate exposure signal, not an exact per-instructor refund liability.

Two alarm triggers:
- **Trigger A** (in `_payout-helpers.js`) — after a Stripe `transfers.create` failure, looks back at the last 24h of snapshots; if any reported `status='green'`, emails `ERROR_ALERT_EMAIL` with both the snapshot and the Stripe error so a "widget said green, reality was red" mismatch is never silent.
- **Trigger B** (in this cron) — after writing the snapshot, compares trailing-30d Stripe inflow (`credit_transactions` with a Checkout Session, PaymentIntent, or Charge identity) vs trailing-30d payout outflow (`instructor_payouts.amount_pence + stripe_fees_pence WHERE status='completed'`). If outflow > inflow + £100, emails the gap with the five most recent driving payouts. £100 floor exists to suppress noise on quiet weeks.

### Database tables

**`instructors`** — name, email, phone, bio, photo_url, active flag, slug (unique, auto-generated from first name — used for clean booking URLs like `/book/fraser`), buffer_minutes (default 30), min_booking_notice_hours (default 24), max_booking_days_ahead (default 84, instructor-selected learner-facing booking window, 1–84 days — since July 2026 this IS the effective window; 84 days is the platform ceiling), calendar_start_hour (default 7), adi_grade, pass_rate, years_experience, specialisms (JSONB array), vehicle_make, vehicle_model, transmission_type (manual/automatic/both), dual_controls (default true), service_areas (JSONB array), languages (JSONB array, default ["English"]), ical_feed_url, ical_last_synced_at, ical_sync_error, stripe_account_id, stripe_onboarding_complete, payouts_paused, weekly_franchise_fee_pence (NULL = commission model, non-NULL = fixed weekly fee), hourly_rate_pence (NULL = inherit school default, non-NULL = admin-set instructor hourly override)

`instructors.hourly_rate_pence` is the admin-editable per-instructor lesson rate override used after any learner/instructor custom rate and before the school default. `instructors.bulk_tiers_enabled` controls whether school-defined bulk discounts apply to future credit purchases for that instructor; when true, the instructor absorbs the discount. It does not discount direct pay-and-book single-slot payments.

`instructors.social_video_opt_in` lets instructors offer a learner-selected 5% discount in exchange for that lesson being filmed for CoachCarter social media/training/marketing. The learner's per-booking choice is snapshotted on `lesson_bookings`; clients may request only `social_video_consent`, while the server validates instructor opt-in and calculates the discount.

**`instructor_learner_notes`** — per instructor-learner pair. Columns: instructor_id, learner_id (unique together), notes, test_date, learner_category (`regular`, `sporadic`, `inactive`, `passed`, or NULL), custom_hourly_rate_pence (NULL = use standard school rate, otherwise hourly rate in pence that scales to all lesson durations). `learner_users.learner_category` is the global admin/broadcast-facing category; `instructor_learner_notes.learner_category` is the instructor relationship category. Used by direct booking checkout, lesson-types/duration pricing APIs, historical credit pricing, earnings view, and payout calculations. Direct pay-and-book pricing uses custom learner rate → instructor hourly rate → school `bulk_hourly_pence`; bulk discounts remain historical credit-package only.

**`instructor_notes`** — school-wide instructor ideas board. Columns: school_id, instructor_id, content (1–2,000 characters), created_at. The composite instructor/school foreign key enforces tenant ownership, and the feed is always read with the authenticated instructor's `school_id`. Notes are deleted if their instructor account is deleted.

**`instructor_availability`** — recurring weekly windows per instructor (day_of_week 0-6, start_time, end_time, transmission_type). Dual-car instructors can mark normal weekly windows as `manual`, `automatic`, or `both`; learner slot generation, duration validation, booking checkout, and reserved weekly moves clamp those values against the instructor profile's `transmission_type`.

**`instructor_availability_overrides`** — date-specific extra availability per instructor. Columns: instructor_id, school_id, override_date, start_time, end_time, active, note. These rows make a single slot/window bookable without altering recurring weekly availability. The learner slot feed and `durations-for-slot` merge them with weekly windows; on blackout dates, explicit overrides are the only windows that can open that date.

**`instructor_blackout_dates`** — date ranges when an instructor is unavailable (holidays, sick days). Columns: blackout_date (start), end_date, reason. Single-day blackouts have end_date = blackout_date. Slot generation skips all dates within any active range. Indexed on (instructor_id, blackout_date, end_date).

**`instructor_external_events`** — synced events from instructor's personal iCal feed (event_date, start_time, end_time, is_all_day, uid_hash for dedup). Indexed on (instructor_id, event_date). Used by slot generation to block slots that conflict with personal events.

**`lesson_offers`** — instructor-initiated lesson offers pending learner acceptance + payment. Two modes: **slot-pinned** (instructor picks date/time) and **flexible** (learner picks from available slots). Fields: token (unique, 64-char hex), instructor_id, learner_email, learner_id (nullable — set when learner exists or after payment creates account), scheduled_date (nullable — NULL for flexible offers), start_time (nullable), end_time (nullable), lesson_type_id, discount_pct, offer_price_pence (nullable for legacy pending offers; new paid/free offers store the frozen final per-lesson pence), status ('pending'/'accepted'/'expired'/'cancelled'), booking_id (set by webhook after payment), stripe_session_id, expires_at (24h from creation), accepted_at. New offer pricing uses explicit `offer_price_pence` if supplied, otherwise effective instructor pricing (custom learner rate → instructor hourly rate → school default) with `discount_pct` applied to that base; bulk tiers are credit-package only and never affect offers. Partial unique index on (instructor_id, scheduled_date, start_time) WHERE status='pending' AND scheduled_date IS NOT NULL prevents duplicate pending offers for the same slot. Slot-pinned pending offers block slot availability; flexible offers do not block any slot until the learner picks one.

**`lesson_requests`** — learner-initiated request-to-book holds (July 2026, LESSON-REQUEST-PLAN.md) for instructors with `instructors.request_to_book = TRUE`. Fields: school_id, instructor_id, learner_id (nullable, ON DELETE SET NULL — GDPR anonymise keeps the row), guest_name/email/phone (pre-signup card requests), scheduled_date, start_time, end_time, lesson_type_id, pickup_address, transmission_type, payment_method ('card_hold'/'credit'), stripe_session_id + payment_intent_id + amount_pence (card path — manual-capture PI, captured on accept, cancelled otherwise), credits_minutes + hold_transaction_id (credit path — the `request_hold` credit_transactions row deducted at request time), list_price_pence/list_price_source snapshot, status ('pending'/'accepted'/'declined'/'expired'/'withdrawn'), booking_id (set on accept), decline_reason, expires_at (min(created + 48h, lesson start − 2h)), decided_at, released_at (exactly-once hold-release marker; decided-but-unreleased rows are swept by the expire cron). Partial unique index `uq_request_slot` on (instructor_id, scheduled_date, start_time) WHERE status='pending' is the slot lock — pending requests block availability everywhere pending offers do. Decided rows purge after 12 months via retention cron.

**`instructor_login_tokens`** — magic-link tokens with expiry and used flag

**`instructor_payouts`** — id, instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence (audit trail, NULL for commission model), stripe_transfer_id, period_start, period_end, status ('pending'/'processing'/'completed'/'failed'/'skipped'), failure_reason, created_at, completed_at, shortfall_pence (amount instructor owes CCL from this period; rolls forward to next positive payout), shortfall_recovered_from_payout_id (NULL until cleared by a later payout), deposit_deducted_pence (£250 vehicle deposit deducted on week-1 Full-Franchise payouts; partial-amount tolerant)

**`payout_line_items`** — id, payout_id, booking_id (UNIQUE — prevents double-payment), price_pence, instructor_amount_pence, commission_rate

**Prepared Payout v2 source ingestion (not approved or deployed)** —
`_payout-v2-source-writer.js`, `_stripe-event-receipts.js`, `_stripe-fee.js`,
and the signed `api/webhook.js` success paths are prepared to dual-write
immutable source evidence for in-flight credit purchases, direct slot
bookings, paid offers, and captured request-to-book payments. Positive
`stripe_backed` value requires exact succeeded PaymentIntent, paid/captured
Charge, linked balance transaction, matching GBP amount, and fee evidence.
Missing or contradictory evidence is zero-value `manual_review`; legacy
grandfather credit stays zero-payable. The reviewed packet and hashes are in
`docs/payout-v2-source-ingestion-rollout-review.md` and
`db/rollouts/payout-v2-source-ingestion-application.manifest.json`. This
application rollout is not deployed, v1 remains authoritative, and no v2
planner, transfer, cutover, cron, or admin mutation route is exposed.

**Inactive Payout v2 Slice 3/4 modules** — `_payout-v2-earning-planner.js`
is the pure versioned source-backed authority; `_payout-v2-shadow.js` loads
explicit school/route/period snapshots and keeps the current v1 fallback query
comparison-only; `_payout-v2-materializer.js` revalidates the reviewed
fingerprints inside one transaction before writing only `booking_earnings`,
`booking_earning_sources`, planned `payout_batches`,
`payout_batch_earnings`, and recovery-application adjustments. Materialized
batches retain the exact immutable reviewed `plan_json`.

`_payout-v2-transfer-executor.js` is the inactive Slice 4 executor/reconciler.
It accepts only an explicit school-scoped materialized batch and expected plan
fingerprint; revalidates the batch, claims, calculation snapshots, source
allocations, recovery total, route, destination, source caps, and v1 overlap;
then persists deterministic source-linked transfer intents before using an
injected Stripe client. Stripe-backed transfers group by immutable charge and
use `source_transaction`; explicitly funded non-Stripe sources require an
immutable documented source group. The logical fingerprint and Stripe
idempotency key are stable for the school, batch, destination, source group,
amount, currency, and plan. Append-only `payout_transfer_attempts` retain
non-PII submission/reconciliation evidence.
An optional injected alert callback receives structured, non-PII confirmed
failure, ambiguity, identity-mismatch, and local-write-failure events; no live
alert transport is wired while Slice 4 remains inactive.

Batch state advances through `planned` → `claimed` → `submitting`, then
`transferred`, `failed_confirmed`, or `reconciling`. Timeouts and ambiguous
responses never release claims; same-day reconciliation matches immutable
metadata and identities, attaches a lost successful transfer, and distinguishes
authoritative same-day not-found/safe-retry from operator review. A Connect
transfer is not a connected-bank payout; `bank_paid` and
`bank_payout_failed` remain later webhook/read-model states. A zero final amount
creates no transfer and makes no Stripe call.

`_payout-v2-webhook.js` is the inactive Slice 5 signed-event ingestor. It
requires raw request bytes, a Stripe signature and endpoint secret, an injected
signature constructor, and injected read-only Stripe correlation methods;
signature verification happens before any database or Stripe I/O and there is
no real-client fallback. The closed event set covers connected-account
transfer, payout, refund, and dispute visibility. Globally unique connected
account scope derives the school before all business joins become explicitly
school-scoped. Durable event receipts make completed replay a no-op and failed
partial processing retryable.

Append-only minimised evidence records exact transfer identity and
reversal/refund/dispute facts without changing historical accounting rows.
Connected bank payouts link to local transfer intents only through exact payout
balance-transaction source identities; amount/date approximation is forbidden.
Out-of-order or contradictory terminal states are retained for operator review.
A failed connected-bank payout does not undo or relabel the earlier successful
platform-to-Connect transfer. `_payout-v2-bank-visibility.js` and the matching
read-only SQL diagnostic expose distinct Connect-transferred, bank-paid,
bank-payout-failed, and operator-review copy and blockers.

`_payout-v2-protected-balance.js`, `_payout-v2-authority.js`, and
`_payout-v2-platform-balance-contract.js` are the inactive Slice 6 liquidity
and operator-control authority. Protected free cash subtracts exact
source-attributed unused learner exposure, disjoint earned/untransferred and
in-flight instructor obligations, latest approved/unexecuted refunds, and the
configured reserve from Stripe available cash. Pending cash is display-only;
transfer readiness is separate. Missing reserve configuration, exposure
warnings, manual-review/legacy-positive evidence, reconciling transfers, stale
Stripe evidence, and scope contradictions block withdrawal use. Global scope
aggregates explicit school-scoped components; a school view cannot label the
undivided global Stripe balance as school free cash.

The inactive widget composer and snapshot writer consume the same calculation
object and exact fingerprint. Migration 035 is now installed schema-only, but
they remain unimported by the live admin widget and daily snapshot cron. The withdrawal
preflight has no route and no Stripe mutation. Mutation authority is limited to
verified cron, superadmin, or an explicitly configured scoped operator and
requires reason, confirmation, deterministic idempotency, and an unchanged
fingerprint. Append-only Slice 6 tables retain reserve versions, refund
obligations, protected snapshots, operator evidence, and deduplicated alerts.
The read-only diagnostic is `npm run diagnose:payout-v2-protected-balance`; the
manual procedure is in `docs/payout-v2-manual-withdrawal-runbook.md`.

`_payout-v2-cutover.js` and `_payout-engine-version.js` are the inactive Slice 7
controlled-cutover preparation. The first defines immutable owner-approved
config, two-distinct-shadow-cycle readiness, protected-fingerprint, capped
first-batch dry-run, immediate reconciliation, rollback, and future atomic
engine-transition contracts. The hard cap blocks the entire reviewed plan when
exceeded; it never truncates a transfer or partially releases claims.
Ordinary school admins cannot cut over or perform global payout operations.
Per-school readiness points to an explicitly global protected-balance/reserve
snapshot because platform Stripe cash is undivided; it does not call that cash
school-owned free cash.

The future engine transition locks one explicit school, rechecks current engine
`v1`, its immutable ready snapshot/config/two shadow records/named operator,
writes the transition event, and changes that school to `v2` in one
transaction. No route calls it. The small live v1 guard has no effect while a
school remains `v1`; after a future successful cutover it makes both
instructor-direct and school-route v1 mutation hard-refuse for that school
before eligibility reads, claims, writes, or Stripe calls.

The applied but inactive migration 035 also defines append-only
`payout_v2_cutover_config_versions`, `payout_v2_shadow_cycle_evidence`,
`payout_v2_cutover_readiness_snapshots`, and `payout_v2_cutover_events`.
Readiness remains blocked until route, external/cash/Setmore classification,
risk reserve, first-live instructor/cap, named operator, rollback criteria, two
real shadow Fridays, diagnostics, and owner sign-off are explicit. A Connect
transfer is still not connected-bank settlement. See
`docs/payout-v2-cutover-runbook.md` and
`docs/payout-v2-rollback-incident-runbook.md`.

There is no production materialisation/execution/webhook API, admin action, cron
connection, feature activation, real Stripe fallback, or native/client
authority. By owner decision,
vehicle deposits are handled entirely off-system: Payout v2 always records and
deducts zero, while the comparison-only v1 preview reports the current
£195/£250 heuristic as a deliberate difference. Every current school remains
v1 and its current payout behaviour is unchanged; the future v2-school refusal
is dormant. See
[`docs/payout-v2-implementation-plan.md`](docs/payout-v2-implementation-plan.md).

**`platform_balance_snapshots`** — id, captured_at, status ('green'/'red'), available_pence, pending_pence, total_payout_pence, balance_after_payout_pence, refund_exposure_pence, payout_preview_json (per-instructor breakdown of the dry-run), trailing_30d_stripe_inflow_pence, trailing_30d_payout_outflow_pence. Written daily by `cron-balance-snapshot.js`. Index on `captured_at DESC` for the Trigger A 24h lookup. Read by `_payout-helpers.js` (Trigger A) and the cron itself (Trigger B). The widget compute lives in `api/_platform-balance.js` and is the single source of truth for both the dashboard and the snapshot. The API exposes exact source-attributed unused-credit exposure separately as `exact_refund_exposure_pence` / `exact_refund_exposure`; the historical `refund_exposure_pence` snapshot column remains the legacy aggregate advisory value, also returned as `legacy_advisory_refund_exposure_pence`. Exact valuation policy and open questions are documented in [`docs/refund-exposure-valuation-audit.md`](docs/refund-exposure-valuation-audit.md).

---

## Admin portal

Login at `/admin/login.html` with email + password. Session auth lives in the httpOnly `cc_admin` cookie; `localStorage.cc_admin` is display-only for portal/sidebar rendering.

Admin support access can open an instructor portal session without password knowledge/reset via `POST /api/admin?action=access-instructor-account`. The resulting `cc_instructor` cookie is short-lived (2 hours), carries impersonation metadata, and is visibly marked in the instructor UI with a "Viewing as admin" banner. Admin-user sessions keep `cc_admin` intact; instructor-admin sessions are restored from return metadata when support access ends. This is audit-only in v1; instructor actions taken inside the support session still run through the normal instructor endpoints.

### API — `api/admin.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `login` | POST | No | Returns JWT. 5-fail/hour per email + 10/hour per IP rate limit. |
| `request-reset` | POST | No | Sends a 6-digit reset code to the admin's email. Enumeration-safe. Body: `{ email }` |
| `reset-password` | POST | No | Verify code + set new password atomically; issues fresh session. Body: `{ email, code, new_password }`. Audit-logged as `admin.password_reset` |
| `stats` | GET | JWT | Dashboard stats (upcoming lessons, revenue, learner count) |
| `bookings` | GET | JWT | All bookings with status filters. Includes confirmed Reserved Weekly Slot read metadata for admin display: linked block/item IDs, `is_reserved_weekly_slot`, 48-hour move deadline/open state, and under-48-hour goodwill eligibility. |
| `instructors` | GET | JWT | Instructor list |
| `add-instructor` | POST | JWT | Add a new instructor |
| `update-instructor` | POST | JWT | Edit instructor details |
| `toggle-instructor` | POST | JWT | Activate / deactivate instructor |
| `access-instructor-account` | POST | Admin JWT | Starts admin support access for an active same-school instructor. Body: `{ instructor_id }`. Mints a 2-hour `cc_instructor` session with impersonation metadata and audit-logs `admin.instructor_access_start`. Does not reveal or mutate passwords. Admin-user sessions keep `cc_admin`; instructor-admin initiators get return metadata for restoration. |
| `stop-instructor-access` | POST | Admin JWT or support JWT | Ends admin support access by clearing the support `cc_instructor`, refreshing CSRF, restoring an instructor-admin initiator when present, and returning the admin to the portal. Audit-logs `admin.instructor_access_stop` when the support session can be decoded. |
| `toggle-payout-pause` | POST | JWT | Pause or resume an instructor's payouts |
| `payout-overview` | GET | JWT | All instructors' connect status, upcoming estimates, recent payouts |
| `process-payouts` | POST | JWT | Manual trigger for payout processing (same logic as cron) |
| `instructor-payout-history` | GET | JWT | Payout history with line items for a specific instructor |
| `payout-v2-shadow-statement` | GET | JWT | Read-only inactive v2 statement for one explicit school-scoped route/period (`payout_route`, `period_start`, `period_end`, plus `instructor_id` for direct). Returns versioned/fingerprinted source-backed booking lines, blockers, totals, and a comparison-only v1 preview. It takes no locks, writes no claims/financial rows, calls no Stripe API, and cannot activate or materialise v2. |
| `credit-reconciliation` | POST | JWT | Admin reconciliation for a missed Stripe credit-purchase webhook. Dry-run/inspection requests (`dry_run: true` or `mode: 'inspect'`) are non-mutating and return `inspection_only: true`, `credit_granted: false`. Mutating mode requires a non-empty `reason`, runs Stripe/DB inspection plus `buildReconciliationGrantInput()` before any mutation, writes through the shared serialized LCB credit mutation path, and audit-logs `admin.credit_reconciliation`. The admin UI currently exposes inspection only; no apply/grant button has shipped. |
| `credit-goodwill` | POST | JWT | Grant goodwill credits to a learner/instructor pair through the shared serialized LCB credit mutation path. Requires learner/instructor scope, minutes, reason, and `absorbed_by` (`platform` or `instructor`). Audit-logged as `admin.credit_goodwill_grant` |
| `refund-preview` | POST | JWT | Read-only admin refund planner for net-of-processing-fee refunds. Supports credit purchase/source previews, partial repeat-offer unused value previews, and direct slot/offer booking previews. It itemises gross lesson credit value, withheld original processing fee, and net amount returned; blocks missing-fee cases and already-paid-out direct bookings for manual review. It does not write `refund_events`, mutate credit balances/CSA, or call `stripe.refunds.create`. |
| `execute-refund` | POST | JWT | Tightly gated admin refund executor. Requires `idempotency_key` and `operator_go: "EXECUTE_REFUND_CONFIRMED"`, re-runs `_refund-planner.js`, blocks manual-review plans, calls `stripe.refunds.create` through an injectable Stripe client, writes `refund_events(status='executed')` / `refund_event_lines`, creates CSA + locked balance decrements for supported unused credit-source refunds, and audit-logs `admin.execute_refund`. Already-paid-out direct bookings remain blocked. |
| `record-manual-bank-refund` | POST | JWT | Ledger-only manual bank refund record. Requires `idempotency_key`, `operator_go: "RECORD_MANUAL_BANK_REFUND_CONFIRMED"`, `manual_bank_reference`, and a reason. Optional `evidence_reference` and `operator_note` are retained in `refund_events.metadata`. It re-runs `_refund-planner.js`, refuses clean execute-eligible original-method refunds, writes executed refund ledger rows/lines, and audit-logs `admin.record_manual_bank_refund`. It does not call Stripe, change bookings, edit payout rows, create CSA rows, or mutate learner credit. |
| `refund-events` | GET | JWT | Read-only, school-scoped admin refund-event discovery/detail read model. Supports event ID, generic search (`q` across event ID, idempotency key, Stripe refund/payment references, learner name/email), learner ID/name/email, refund type/status, Stripe refund ID, idempotency key, and recent/date filters. Detail responses include `refund_event_lines`, metadata, and the notes timeline. The admin event detail UI also loads incident readiness for visibility. It does not call Stripe or mutate refund, booking, payout, CSA, or learner-credit tables. |
| `refund-incident-readiness` | GET | JWT | Read-only, school-scoped incident readiness classifier for an existing `refund_event_id`. Reads local refund event, ledger lines, stored Stripe refs, metadata, and notes only; does not call Stripe and does not mutate refund, booking, payout, CSA, BCS, credit-transaction, or learner-credit tables. Returns `complete`, `incomplete`, or `needs_manual_decision` plus evidence/stop reasons for operator review. It is visible in Refund Operations event detail, with note-prefill shortcuts only; it is not a repair mutation. |
| `refund-notes` | GET | JWT | Lists admin refund notes for a school-scoped `refund_event_id`. Returns the refund event summary plus ordered `refund_event_notes` rows. |
| `add-refund-note` | POST | JWT | Adds an admin note to a school-scoped refund event. Body: `{ refund_event_id, note_type, body, incident_status?, evidence_reference? }`. Supports operator/evidence/incident/repair-decision notes and audit-logs `admin.add_refund_note`. It records context only; it does not repair or mutate refund accounting. |
| `invite-learner` | POST | JWT | Create learner account and send 7-day magic link invite email |
| `create-retrospective-booking` | POST | JWT | Admin creates a past lesson as `chargeable`. Body: `{ learner_id, instructor_id, scheduled_date, start_time, lesson_type_id, payment_method: "credit"|"cash", pickup_address?, dropoff_address?, notes? }`. Validates same-school learner/instructor/type, rejects future/in-progress lessons, checks instructor overlaps, audit-logs `admin.create_retrospective_booking`. Credit payment locks the per-instructor LCB row, writes FIFO `booking_credit_sources`, snapshots list price, and decrements credit; cash records no credit draw. |
| `edit-booking` | POST | JWT | In-place edit of a booking's date, time, or lesson type (same as instructor version but admin-scoped). Audit-logged |
| `reserved-goodwill-move` | POST | JWT | Admin-only under-48-hour goodwill move for one confirmed Reserved Weekly Slot occurrence. Body: `{ booking_id, new_date, new_start_time, reason }`. Same school/learner/instructor/lesson type/duration only. Marks the old booking `refunded` with `credit_returned = TRUE`, creates a replacement `scheduled` booking, releases the old recurring-block item, creates a replacement booked item, copies BCS attribution when present, and audit-logs `reserved_goodwill_admin_move`. Does not mutate learner-credit balances, Stripe refunds, refund ledgers, payout rows, or payment flows. |
| `instructor-blackouts` | GET | JWT | Get future blackout dates for an instructor (`?instructor_id=X`) |
| `set-instructor-blackouts` | POST | JWT | Replace all future blackout dates for an instructor. Body: `{ instructor_id, ranges }` |
| `update-learner` | POST | JWT | Edit learner name/email/phone/pickup_address. Audit-logged with before/after values |
| `learner-controls` | GET | JWT | Dense admin read model for `/admin/learner-controls.html`. Returns school-scoped learners with assignment, custom rate, trial status, test date/time/centre, test-instructor flag, credit balances, booking stats, attention inputs, plus school instructors. Read-only; credit balances are display-only here. |
| `update-learner-controls` | POST | JWT | Updates the focused admin learner controls: `{ learner_id, primary_instructor_id?, learner_category?, custom_hourly_rate_pence?, free_trial_allowed, test_date?, test_time?, test_centre?, test_instructor_booked, admin_control_notes? }`. Validates same-school active instructor, writes per-instructor custom rate to `instructor_learner_notes`, updates learner-level flags on `learner_users`, and audit-logs before/after as `admin.update_learner_controls`. |
| `learner-broadcast-preview` | POST | JWT | Preview the exact school-scoped recipients for selected global learner categories. Body: `{ categories: ['regular', ...] }`. Returns usable-phone recipients plus skipped learners. |
| `send-learner-broadcast` | POST | JWT | Manual one-off learner SMS broadcast. Body: `{ label, message_body, categories }`. Re-resolves recipients by `school_id`, skips unusable phone numbers, sends through `sendWhatsApp()`, writes `learner_broadcasts` / `learner_broadcast_recipients`, and audit-logs `admin.send_learner_broadcast`. No scheduling/templates in v1. |
| `learner-broadcast-history` | GET | JWT | Recent broadcast campaigns and per-recipient outcomes for the authenticated school. |
| `learner-feedback` | GET | JWT | School-scoped learner feedback queue. Optional filters: `status=open|reviewed|closed`, `type=issue|suggestion`, `limit`. Returns learner contact fields plus feedback title/message/page/status. |
| `update-learner-feedback` | POST | JWT | Updates a feedback row status. Body: `{ id, status: 'open'|'reviewed'|'closed' }`. Sets/clears `reviewed_at` and audit-logs `learner_feedback.update_status`. |
| `referral-activity` | GET | JWT | Aggregated referral stats per school (referrer names, codes, counts, total rewards) |
| `update-referral-code` | POST | JWT | Admin edits an existing learner referral code. Body: `{ learner_id, code }`. Uppercases and validates the code, enforces per-school uniqueness and learner scope, and audit-logs changes as `admin.update_referral_code` |
| `referral-relationships` | GET | JWT | Per-referee relationship rows for admin: referrer/referee details, referral code, joined/booked/lessoned stage, earned reward minutes, pending reward minutes, and first booking / first paid lesson dates |
| `link-referral-relationship` | POST | JWT | Admin correction tool. Body: `{ referrer_learner_id, referred_learner_id }`. Sets `learner_users.referred_by` for the referred learner after same-school, self-link, cycle, and already-rewarded reassignment guards. Audit-logged as `admin.link_referral_relationship`; does not issue reward credit |
| `referral-config` | GET | JWT | Current referral config for the school (enabled, welcome bonus, reward minutes) |
| `update-referral-config` | POST | JWT | Update referral config. Body: `{ referral_enabled, referral_welcome_bonus_minutes, referral_reward_minutes }`. Audit-logged |

Refund operations runbook: [`docs/refund-operator-runbook.md`](docs/refund-operator-runbook.md).
Learner broadcast details: [`docs/learner-broadcasts.md`](docs/learner-broadcasts.md).

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
- **Stripe payment methods** — live Checkout uses dynamic payment methods. Klarna has been removed from Stripe configuration; do not reintroduce local Klarna copy or hardcoded Checkout method lists.
- **DB migrations** — single file `db/migration.sql` covers all tables; run via `GET /api/migrate?secret=MIGRATION_SECRET`. Legacy per-feature files in `db/migrations/` are superseded
- **Magic link tokens** — two-step flow (validate then verify) prevents email-client link prefetchers from consuming tokens; `verify` is POST-only
- **Slot reservations** — 10-minute TTL; expired reservations are excluded from availability but cleaned up lazily (on next webhook or when table is queried)
- **Dynamic pricing table** — `guarantee_pricing` is auto-created and seeded on first call to `/api/guarantee-price`. The webhook-driven price increment was retired with PR-J (2026-05-19) when the legacy Stripe checkout was deleted. The Pass Programme is hidden on the marketing site; the table now serves as a read-only admin-override source for `current_price` if it's ever re-enabled.
- **Pricing page routing** — all site nav "Pricing" links point to `/learner-journey.html`, not `/lessons.html`. `/lessons.html` no longer creates self-serve credit-package checkout sessions; CTAs route learners into booking/pay-and-book.
- **PostHog analytics** — all pages include the PostHog snippet for event tracking and session recording
- **competency-config.js** — shared across 6 pages; changes affect quiz, mock test, log session, progress, onboarding, and AI context
- **sidebar.js** — used on all 22+ pages; changes affect entire site navigation
- **PWA caching** — service worker caches app shell; update CACHE_NAME version string in sw.js to bust cache on deploy
- **AI Advisor checkout** — the AI Advisor no longer creates credit-package checkout links. It can advise on lesson planning and directs learners to booking/pay-and-book.

---

## Recent changes (March–April 2026)

- **"Next available" slot feed** (2.52) — replaced weekly/monthly/daily calendar with a flat feed of available slots sorted by date+time. Sticky lesson type pill bar, progressive 14-day loading, removed ~500 lines of old calendar code. Also fixed admin adjust-credits and postcode save bugs.
- **Pickup address & lesson types** (2.51) — pickup postcode prompt on book.html encourages learners to add their address for travel filtering; setmore-sync backfills `learner_users.pickup_address` from booking data; buy-credits.html now shows dynamic single-lesson type cards alongside bulk hour packages; Test Ready Guarantee section temporarily hidden
- **Dashboard redesign** (2.44) — replaced top section of both learner and instructor dashboards with app-style layout: orange gradient hero card (next lesson with countdown), horizontal pill shortcuts (5 icons), colourful action cards (3 gradient cards). Inspired by consumer fintech/SaaS app patterns. No new API endpoints.
- **Foundation cleanup** (#75–78) — centralised DB migration (`db/migration.sql` + `/api/migrate`), extracted shared CSS/JS into `public/shared/` (removed ~984 lines of duplicated CSS), wired up shared auth JS (`ccAuth.getAuth()`, `ccAuth.logout()`), added email error alerts on all 500 errors (`api/_error-alert.js`)
- **PWA support** (#62) — manifest, service worker, install prompt, offline page, generated icons
- **Codebase cleanup** (#61) — fixed migration numbering, extracted shared auth/mail helpers, removed dead files
- **AI Lesson Advisor** (#60) — conversational AI assistant for lesson planning. Its old credit checkout tool is retired.
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
| `learner_broadcasts` | Admin learner broadcast campaign ledger (label, body, selected categories, counts, status, school_id) |
| `learner_broadcast_recipients` | Per-learner broadcast recipient ledger with sent/skipped/failed status and school_id |

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

## Curriculum MVP (July 2026)

`/instructor/curriculum.html` is a school-specific discovery workspace for
active instructors and school admins. It is deliberately not an official
published curriculum: topics, named contributions, replies, and structural
suggestions remain readable as raw conversations.

### API — `api/curriculum.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `bootstrap` | GET | Active instructor or school admin | Returns the school topic list, seven fixed prompt definitions, current actor, activity counts, and pending suggestions for admins |
| `topic` | GET | Active instructor or school admin | Returns one school-scoped topic, subtopics, graph connections, and attributed threaded contributions |
| `create-topic` | POST | Active instructor or school admin | Creates a top-level topic or subtopic after duplicate matching |
| `create-connection` | POST | Active instructor or school admin | Adds an undirected connection between two same-school topics |
| `create-contribution` | POST | Active instructor or school admin | Adds a prompt contribution or typed conversational reply; `connect_topic` can also create a topic connection |
| `edit-contribution` | POST | Owner only | Edits only the authenticated actor's own words and records `edited_at` |
| `suggest-structure` | POST | Active instructor or school admin | Adds a named structural suggestion for admin review |
| `admin-topic` | POST | School admin only | Renames, moves, archives, or safely merges a topic without deleting history |
| `review-suggestion` | POST | School admin only | Accepts or rejects a pending structural suggestion and audit-logs the review |

### Curriculum tables

- `curriculum_topics` — school-scoped topics with optional list parent,
  archive state, and safe merge redirect.
- `curriculum_topic_connections` — undirected many-to-many topic edges,
  ready for future mind maps and dependency views.
- `curriculum_contributions` — seven fixed prompt areas, named thread seeds,
  replies, optional linked topics, ownership, and edit timestamps.
- `curriculum_structural_suggestions` — instructor/admin suggestions with
  pending/accepted/rejected admin review state.

The idempotent migration seeds Controls, Junctions, and Manoeuvres for existing
schools. `bootstrap` lazily ensures the same starting topics for schools created
after migration.

---

## Learner Packages: revised Full Curriculum test foundation (15 August 2026)

Learner Packages is separate from historical Lesson Credit. Migrations 044-045 provide the immutable catalogue and test-mode payment evidence; migration 046 applies the commercial revision and adds Full Curriculum fulfilment records; migration 047 adds explicit matching, assignment history and versioned agreed availability; migration 048 adds consumer-contract, cooling-off, termination and manual-refund evidence; migration 049 adds the inert owner-certified adult controlled-pilot gate, approved prospective valuation and durable-confirmation constraint. Phase 1/2/3 identities remain historical but are inactive/hidden customer products. Flexible 30 Hours and Manoeuvres remain visible without fulfilment. Only Full Curriculum can use the default-off test purchase path.

### API â€” `api/packages.js`

| Action | Method | Auth | Description |
|---|---|---|---|
| `feature-state` | GET | No | Resolves the request school and returns only the strict Boolean feature state. Missing, malformed, string, numeric, and false values are disabled. |
| `catalogue` | GET | No/optional learner | Returns active visible products. Full Curriculum eligibility also reads verified future first-test, duplicate-active-enrolment and controlled-pilot-access state. |
| `submit-test-booking` | POST | Learner | Records only future date, time and centre for manual verification. |
| `test-bookings` / `verify-test-booking` | GET / POST | School admin | Lists same-school facts and records a one-way manual verify/reject decision with audit reason. |
| `create-checkout` | POST | Verified learner | Full Curriculum only. Requires active pilot access, adult declaration, valid immutable valuation config, terms acceptance, explicit start choice and current disclosure; freezes/hashes that evidence before one idempotent test Checkout call. |
| `attempt-status` | GET | Owning learner | Polls school/learner-scoped payment and webhook-created enrolment identity; never fulfils from the browser. |
| `attempt-diagnostics` | GET | School admin | Read-only queue or exact-session provider comparison; never guesses, replaces, or mutates an attempt. |
| `admin-list` | GET | School admin | Returns all same-school stable products and immutable versions, including hidden, inactive, and future rows. |
| `create-version` | POST | School admin | Creates the next immutable version with a server-validated GBP pence price, effective timestamp, terms identity, and content snapshot. Audit action: `package.create_version`. |
| `update-product` | POST | School admin | Changes only stable display state (`visible`, `active`, `sort_order`) within the authenticated school. Audit action: `package.update_product`. |
| `set-feature` | POST | School admin | Stores only a real JSON Boolean at `features.learner_packages_enabled`. Audit action: `package.set_feature`. |
| `set-purchasing-feature` | POST | School admin | Stores only a real JSON Boolean at `features.learner_package_purchasing_test_enabled`. Audit action: `package.set_purchasing_feature`. It does not configure Stripe. |
| `programme-status` / `programme-list` | GET | Learner / instructor or admin | Returns role-appropriate same-school programme state. |
| `programme-pilot-access` / `grant-programme-pilot-access` / `revoke-programme-pilot-access` | GET / POST | School admin | Lists, grants or revokes the one active same-school verified adult-pilot candidate. Grant/revocation is audited and never enables a feature flag or creates Checkout. |
| `assign-instructor` / `accept-assignment` | POST | Admin or assigned instructor | Admin assigns/reassigns an active same-school instructor; an ordinary instructor can self-assign or accept only themselves. Assignment history is append-only. |
| `record-programme-availability` | POST | Admin or current instructor | Appends the agreed weekday/local-time windows and IANA timezone. Zero windows is allowed; no booking or financial row is created. |
| `start-programme` | POST | Instructor or admin | Starts an unstarted `paid_matching` enrolment only after durable-confirmation delivery, current-instructor acceptance and availability, then creates first-test/24-week bounded weekly opportunities in the school's IANA timezone. An authorised admin can exceptionally bypass missing acceptance only with exact Boolean `instructor_acceptance_override: true`; the effective override is audit/progress evidence. Payment alone never starts this clock. |
| `release-cooling-off-hold` | POST | School admin | After durable-confirmation delivery and `service_may_start_at`, moves a deferred-start enrolment from `cooling_off_hold` to matching and appends contract/audit evidence. |
| `request-programme-termination` | POST | Learner or school admin | Receives one UUID cancellation/withdrawal idempotently, stops programme activity and creates a trusted immutable manual-refund calculation/case. It does not call Stripe. |
| `programme-refund-cases` | GET | Learner or school admin | Returns only the owning learner's or authenticated school's retained calculation, evidence lines and manual provider state. |
| `review-programme-refund` / `approve-programme-refund` | POST | Two different school admins | Records first review/actual fee evidence, then requires a different approver for the exact pence amount. The original fee never reduces the refund. |
| `record-programme-refund-result` | POST | School admin | Records a manually issued Stripe `re_...` success/failure for reconciliation. It never issues or retries a refund. |
| `record-readiness` / `record-assessment` | POST | Instructor or admin | Appends readiness and a different-instructor assessment result; a pass advances the internal phase without checkout. |
| `record-test-date-change` / `record-extension` | POST | Admin | Separates a date change from an audited DVSA/exception/CoachCarter replacement extension. |
| `allocate-programme-booking` / `record-week-outcome` | POST | Instructor or admin | Links actual same-school lessons and records cancellation/replacement outcomes without Lesson Credit. |
| `activate-retake` / `record-retake-test-change` | POST | Admin | Activates one 600-minute allowance or moves its 28-day window for verified DVSA/exception evidence. |

**`package_products`** stores stable school-owned identities, product type, same-school prerequisite, visibility, activation, and display order. Seeded choices are the 10-hour, 15-hour and 30-hour Flexible Hours packages, Phases 1â€“3, Full Curriculum, Manoeuvres, and Manoeuvres Challenge.

**`package_product_versions`** stores immutable numbered commercial/catalogue snapshots: same-school product identity, GBP pence price, JSONB content, customer terms identity, effective timestamp, and creating actor evidence. A database trigger rejects update/delete so changes are prospective new versions.

**`package_purchase_attempts`**, **`package_payment_events`**, and **`package_purchase_attempt_state_events`** store the immutable server-priced attempt, durable signed-event receipt, and append-only status history. Late success may promote failed/expired/review states to paid; reordered failure cannot downgrade paid. Learner deletion one-way nulls the retained financial record's learner link, and live learner attempts are included in GDPR export.

`/api/package-webhook` is separate from the legacy booking webhook. It verifies raw bytes before database access, rejects live events, durably deduplicates event IDs, validates exact test-mode tenant/learner/version/amount/currency/terms/Payment Method Configuration plus adult/consent evidence, and atomically/idempotently creates one immutable purchase plus one unstarted Full Curriculum enrolment. It awaits delivery of the exact purchased terms and cancellation information; a failed delivery leaves the webhook receipt retryable and service actions blocked. A valid early-start request enters `paid_matching` with a payment-anchored seven-day deadline; the default enters `cooling_off_hold` and anchors the deadline after the 14-day boundary. It creates no programme weeks. A later instructor/admin `start-programme` action anchors the 24-week clock after `service_may_start_at`.

Migration 046 adds `full_curriculum_test_bookings`, `learner_package_purchases`, `full_curriculum_enrolments`, weekly opportunities, progress events, independent assessments, test-date changes, extensions, actual booking allocations, retake allowances/window events and retake movements. Migration 047 adds `full_curriculum_matching_records`, append-only `full_curriculum_assignment_events`, `full_curriculum_availability_versions`, and their structured windows. Migration 048 adds `full_curriculum_consumer_contract_evidence`, contract/termination events, manual refund cases/lines/events and cooling timestamps. Migration 049 adds `adult_age_confirmed`, `full_curriculum_pilot_access`, one-active-learner indexes and the owner-certified prospective product version. Initial assignment and financial evidence cannot be overwritten; corrections are additive. Every relation is school scoped and indexed. No row is inserted into `learner_credit_balances`.

**Not-executed controlled-pilot setup order:** (1) review and apply migrations 044-049 to a disposable/test database; (2) verify the owner-certified prospective version and durable email path; (3) retain the distinct Stripe test Payment Method Configuration/restricted key/webhook; (4) smoke-test while both flags remain false; (5) separately grant one verified adult learner and deliberately activate only the approved test-school exercise. No Checkout, production migration, deployment or feature activation is implied by the repository implementation.

The enable/test/disable/diagnose procedure and exact preflight evidence are in [`docs/learner-packages-test-purchasing-runbook.md`](docs/learner-packages-test-purchasing-runbook.md). The production Vercel project is `coachcarter-website`; operators must verify the project/domain explicitly instead of trusting a local `.vercel/project.json` link.

`/learner/packages.html` presents the revised model, explicit checkout/start choices, cancellation receipt and refund state alongside programme progress. `/admin/packages.html` provides immutable valuation inputs, cooling-hold release, termination receipt, manual two-person refund review/approval and provider-result recording in addition to the programme controls. `/instructor/programmes.html` remains restricted to the current instructor's assignments and provides acceptance, availability, agreed-start, readiness and assessment controls.

See [`docs/learner-packages-product-decision-record.md`](docs/learner-packages-product-decision-record.md). `/learner/buy-credits.html`, retired `api/credits?action=checkout`, and Reserved Weekly Slot routes/configuration remain unchanged.

---

## Flexible Hours package addendum (2026-08-16)

This addendum supersedes earlier references to a lone 30-hour draft or to Flexible Hours fulfilment being wholly deferred. Migration 050 adds the approved stable 15-hour (£810) identity, a prospective approved 30-hour (£1,590) version, and a separate append-only school-wide attempt/payment, purchase/source, booking allocation, eligible return, manual source reduction and state-event ledger. It never writes `learner_credit_balances` or `learner_users.balance_minutes`.

Migration 051 aligns the ledger with calendar-style credit use: one unresolved Checkout per learner, no new Checkout while spendable Flexible Hours remain, and append-only exact-value allocation movement for learner rescheduling at 48+ hours. Flexible Hours remain school-wide and can move to another active same-school instructor. A lesson has one funding method only; Flexible Hours, Lesson Credit and Pay As You Go are never blended.

`/api/flexible-packages` exposes owned balances/status plus school-admin reconciliation and manual refund evidence. `/api/flexible-package-webhook` is the sole entitlement fulfiller. Required production identities are `STRIPE_FLEXIBLE_PACKAGES_LIVE_RESTRICTED_KEY`, `STRIPE_FLEXIBLE_PACKAGES_LIVE_PAYMENT_METHOD_CONFIGURATION`, and `STRIPE_FLEXIBLE_PACKAGES_LIVE_WEBHOOK_SECRET`, with no shared/test fallback. The exact School 1 live gate is default-off and intentionally has no admin UI setter. Code and operator read models are implemented; production migration, Stripe configuration, gate activation and Checkout creation remain separate approved operations. See `docs/flexible-hours-packages-runbook.md`.

## What's still to build

- **Learner Packages operational setup** - Full Curriculum pilot activation and Flexible Hours production migration, dedicated live Stripe configuration and exact gate activation remain separate approved operations. Flexible Hours code and fulfilment are implemented but inactive. Manoeuvres fulfilment, automated matching, automatic Stripe refunds, rewards and broader rollout remain deferred.

- **Refund flow polish** — backend preview, tightly gated execute, admin execute UI, manual bank-refund ledger recording, admin refund-event discovery/detail, admin refund notes timeline, and read-only incident readiness classification exist. Learner request UI, richer approval workflow, and actual incident repair mutation tooling are still to build.
- **Automated reminders** — 24-hour email/SMS before lessons (Vercel cron)
- **Waiting list** — capture leads when fully booked
- **Referral system** — unique links, credit bonuses for both parties
- **Push notifications** — lesson reminders, quiz nudges, new message alerts (PWA)
- **Capacitor native wrapper** — App Store / Play Store submission
- ~~**Instructor dashboard** — earnings tracking, lesson stats, learner progress overview~~ ✅ Done (earnings page + Stripe Connect payouts)
- **Theory test prep** — built-in revision tools
### Booked-lesson curriculum progress beta (August 2026)

`api/curriculum-progress.js` is a separate authenticated action route from the instructor curriculum-discovery workspace. It supports `feature-state`, `reviews-due`, `review`, `submit-instructor-review`, `reflection-due`, `reflection`, `submit-learner-reflection`, and `progress`. Every action reads the authenticated actor's `school_id`; mutations then resolve learner, instructor, date and status from the owned `lesson_bookings` row.

Migration 054 adds `curriculum_review_submissions` (immutable instructor/learner revisions and retry ids), `curriculum_rating_events` (separate 1–3 assessor signals) and `curriculum_completion_events` (once-per-learner completion checks). All tables and query paths carry `school_id`. `driving_sessions` remains the booking-linked header and its existing one-booking constraint is reused. `public/competency-config.js` exports the 61 stable item definitions to browser and CommonJS runtimes.

The strict rollout gate is `schools.config.features.curriculum_progress_beta === true`; absent, malformed, string, numeric and false values disable reads and mutations. It is off by default and has no admin UI setter. Operational steps are in `docs/curriculum-progress-beta-runbook.md`.
