# Coach Carter — Website Development Roadmap

## Overview

This document outlines the planned development of a **custom booking and credit system** for the Coach Carter driving school website. The system allows learners to purchase lesson credits (via Stripe with Klarna support), store them on their account, and use those credits to book 1.5-hour lessons with any available instructor through a built-in calendar.

---

## Phase 1: Booking & Payment System ✅ Complete

### 1.1 — Lesson Credits & Payments ✅

**How it works:**
Learners purchase lesson credits through the website. Each credit equals one 1.5-hour lesson. Payments are processed through Stripe, with Klarna available as a payment method for spreading the cost. Bulk discount tiers apply automatically based on quantity.

**Key decisions:**
- Lesson length: **1.5 hours** (fixed, single slot type for now)
- Base price: **£82.50 per credit**
- Bulk discounts applied at checkout:
  - 4 credits (6hrs) → 5% off
  - 8 credits (12hrs) → 10% off
  - 12 credits (18hrs) → 15% off
  - 16 credits (24hrs) → 20% off
  - 20 credits (30hrs) → 25% off
- Credits are **refundable**
- Credits are stored as a balance on the learner's account

**What was built:**
- ✅ `api/credits.js` — balance lookup and Stripe checkout with bulk discount logic
- ✅ `api/webhook.js` — updated to handle `credit_purchase` payments, writes to Neon DB atomically
- ✅ `public/learner/buy-credits.html` — quantity selector, discount tier cards, live price breakdown, Klarna note
- ✅ Confirmation email to learner on successful purchase
- ✅ Klarna enabled (payment methods inherited from Stripe dashboard)

**Still to build:**
- Refund flow — learner requests cash refund, admin approves, Stripe processes reversal

---

### 1.2 — Instructor Availability & Calendar ✅

**How it works:**
Each instructor has recurring weekly availability windows. The system automatically divides these into bookable 1.5-hour slots. Booked slots are removed from the calendar in real time.

**Key decisions:**
- Calendar is **custom-built** (no third-party dependency)
- Learners can book **any available instructor**, not just a specific one
- Booking is **instant confirmation** — no instructor approval needed
- Learners can book up to **3 months in advance**
- **48-hour cancellation policy** — cancellations with 48+ hours notice automatically return the credit

**What was built:**
- ✅ `api/instructors.js` — instructor CRUD + weekly availability window management (admin-protected)
- ✅ `api/slots.js` — slot generation engine, booking, cancellation, and my-bookings endpoints
- ✅ `public/learner/book.html` — week-by-week calendar UI, instructor filter, booking confirmation modal, cancellation modal with 48-hour policy display
- ✅ Confirmation emails to both learner and instructor on booking and cancellation
- ✅ 48-hour cancellation policy enforced server-side with automatic credit return
- ✅ Race condition protection via DB unique index on instructor/date/time

---

### 1.3 — Data Model ✅

All tables live in **Neon (PostgreSQL)**. Migration file: `db/migrations/001_booking_system.sql`.

**`learner_users`** *(extended)*
- Added: `credit_balance` (integer, DB constraint prevents negative), `phone`

**`instructors`**
- Name, email, phone, bio, photo URL, active flag

**`instructor_availability`**
- Recurring weekly windows per instructor (day_of_week 0–6, start_time, end_time)

**`lesson_bookings`**
- Learner → Instructor link, date/time (90 min enforced at DB level)
- Status: confirmed / completed / cancelled
- Tracks whether credit was returned on cancellation
- Unique index prevents double-booking a slot

**`credit_transactions`**
- Full audit trail: type (purchase/refund/slot_purchase), credits, amount in pence, payment method, Stripe IDs

**`slot_reservations`**
- Holds slots during Stripe Checkout (10-minute TTL)
- instructor_id, scheduled_date, start_time, end_time, learner_id, stripe_session_id, expires_at
- Excluded from availability results; cleaned up after payment or expiry

**`magic_link_tokens`**
- Token, email, phone, method (email/sms), expires_at (15 min), used flag
- Two-step verification: validate (GET, read-only) then verify (POST, consumes token)

---

### 1.4 — User Flows ✅

**Learner purchases credits:**
1. Learner logs in → navigates to "Buy Credits"
2. Selects quantity (discount tier cards highlight applicable discount)
3. Pays via Stripe (card or Klarna)
4. Stripe webhook confirms payment → credits added to balance, confirmation email sent

**Learner books a lesson (has credits):**
1. Learner logs in → opens booking calendar (`/learner/book.html`)
2. Browses available slots week by week (filter by instructor optional)
3. Clicks a slot → confirmation modal shows date, time, instructor, credit cost
4. Confirms → 1 credit deducted, booking confirmed, both parties emailed

**Learner books a lesson (no credits — pay per slot):**
1. Learner opens booking calendar with 0 credits
2. Banner shows: "No lessons on your account. No worries — you can pay when you book, or buy a bundle to save."
3. Clicks a slot → modal shows "Pay £82.50 & book" path instead of credit deduction
4. Clicks pay → slot reserved for 10 minutes, redirected to Stripe Checkout (£82.50)
5. Stripe webhook confirms payment → 1 credit added + immediately deducted, booking confirmed, both parties emailed with .ics calendar attachment
6. If payment cancelled or abandoned → reservation expires after 10 minutes, slot released back to calendar

**Learner cancels a lesson:**
1. Learner views upcoming bookings at top of calendar page
2. Clicks Cancel → modal shows whether credit will be returned (48hr check)
3. If 48+ hours before lesson → credit returned automatically
4. If under 48 hours → credit forfeited, learner informed of policy

---

## Phase 2: Next Steps

The following features are prioritised for the next phase, ordered roughly by value.

### 2.1 — Admin / Instructor Portal ✅ Complete
A web-based interface for managing instructors and their schedules without touching SQL or the API directly.

**What was built:**
- ✅ `api/admin.js` — admin authentication (JWT), dashboard stats, bookings management, instructor listing
- ✅ `public/admin/login.html` — admin login page with JWT-based auth, stored in localStorage
- ✅ `public/admin/portal.html` — full admin portal with sidebar navigation and four sections:
  - **Dashboard** — upcoming lessons count, today/this week stats, total learners, active instructors, total revenue
  - **Instructors** — add, edit, activate/deactivate instructors
  - **Availability** — set and update weekly availability windows per instructor
  - **Bookings** — view all bookings with status filters, mark lessons as completed
- ✅ `db/migrations/002_admin_users.sql` — `admin_users` table with role support (admin / superadmin)
- ✅ Admin accounts secured with bcrypt password hashing and JWT tokens
- ✅ `public/admin.html` — redirect shim from `/admin` to `/admin/login.html`

**Bug fixes (15 March 2026):**
- ✅ Fixed `middleware.js` returning empty 200 responses instead of passing requests through to handlers — was silently breaking all pages and API endpoints
- ✅ Renamed `api/update-statis.js` → `api/update-status.js` to match frontend API calls

### 2.2 — Instructor Self-Service Portal ✅ Complete
Instructors can log in, view their own schedule, mark lessons complete, and manage their availability and profile — without needing admin access.

**What was built:**
- ✅ `api/instructor.js` — magic-link login (email token), schedule view, lesson completion, availability management, profile view/update
- ✅ `db/migrations/004_instructor_portal.sql` — `instructor_login_tokens` table for magic-link auth
- ✅ `public/instructor/login.html` — magic-link login page (no password needed)
- ✅ `public/instructor/index.html` — instructor dashboard: upcoming schedule, lesson completion
- ✅ `public/instructor/availability.html` — instructor sets their own weekly availability windows
- ✅ `public/instructor/profile.html` — instructor updates their bio and contact details

### 2.3 — Calendar / iCal Integration ✅ Complete
Learners can subscribe to a personal iCal feed of their upcoming lessons, so bookings appear automatically in Apple Calendar, Google Calendar, etc.

**What was built:**
- ✅ `api/calendar.js` — `.ics` file download per booking, personalised iCal feed URL, feed polling endpoint (no JWT needed for feed — uses a per-learner token)
- ✅ `db/migrations/003_calendar_token.sql` — `calendar_token` column on `learner_users`, indexed for fast polling
- ✅ Feed URL exposed to learners via `GET /api/calendar?action=feed-url`

### 2.4 — Automated Reminders
Email (and optionally SMS) reminders before upcoming lessons.
- 24-hour reminder to learner
- 24-hour reminder to instructor
- Triggered by a scheduled job or cron webhook

### 2.4 — Refund Flow
Cash refund for unused credits.
- Learner requests refund from dashboard
- Admin approves in portal
- Stripe processes reversal, credit deducted from balance

### 2.5 — Learner Dashboard Enhancements ✅ Complete
Surface the new booking system on the existing learner dashboard.

**What was built:**
- ✅ Credit balance card at the top of the dashboard with "Buy Credits" and "Book a Lesson" CTAs
- ✅ "Book a Lesson" button automatically dimmed when balance is zero, prompting learner to buy credits
- ✅ Upcoming lessons section showing next 5 confirmed bookings with date, time, and instructor name
- ✅ "Manage" link on each upcoming lesson through to the booking page for cancellations

### 2.6 — Pay-Per-Slot Booking ✅ Complete
Allow learners with 0 credits to pay for a single lesson at the point of booking instead of requiring them to buy credits first.

**What was built:**
- ✅ Dual-path booking modal — detects credit balance and shows either "Confirm booking" (use credit) or "Pay £82.50 & book" (Stripe Checkout)
- ✅ `api/slots.js` `checkout-slot` action — creates Stripe Checkout session with `payment_type: 'slot_booking'` metadata
- ✅ Slot reservation system — `slot_reservations` table holds slot for 10 minutes during payment, excluded from availability
- ✅ `api/webhook.js` `handleSlotBooking` — processes payment, atomically adds/deducts credit, creates booking, sends .ics calendar attachment to both parties
- ✅ No-credits banner updated from red (alarming) to soft orange with messaging: "No worries — you can pay when you book, or buy a bundle to save."
- ✅ Success/cancellation toasts on return from Stripe

### 2.7 — Session Logging Rebuild ✅ Complete
Rebuilt the session logging page as a stepped wizard with emoji-based ratings.

**What was built:**
- ✅ `public/learner/log-session.html` — multi-step wizard replacing the original form
- ✅ Emoji-based skill ratings (green/amber/red) with optional notes per skill
- ✅ Consistent font stack (Space Grotesk + Outfit) matching learner portal design

### 2.8 — Learner Portal Videos ✅ Complete
Added the classroom/videos page to the learner portal behind login, accessible from the bottom nav.

**What was built:**
- ✅ `public/learner/videos.html` — video library accessible within the learner portal
- ✅ Bottom nav pattern shared across all learner portal pages

### 2.9 — Homepage Quiz Update ✅ Complete
Updated the homepage quiz results to direct learners to the Learner Hub, Book a Free Trial, or Explore Prices instead of just the booking page.

### 2.10 — Magic Link Login Fix ✅ Complete (17 March 2026)
Fixed magic link login — email clients were pre-fetching the verify link and consuming the token before the learner clicked it. Applied to both learner and instructor logins.

**What was built:**
- ✅ New `validate` endpoint (GET) — lightweight token check that does NOT mark it as used
- ✅ `verify` endpoint changed to POST-only — only browser JavaScript can consume the token
- ✅ `public/learner/verify.html` — two-step flow: validate (GET) then verify (POST)
- ✅ `api/instructor.js` — new `validate-token` (GET) + `verify-token` changed to POST-only
- ✅ Email prefetchers can no longer burn tokens on either portal

### 2.11 — Instructor Login Redesign ✅ Complete (17 March 2026)
Redesigned the instructor login page as a choice screen with two paths.

**What was built:**
- ✅ Choice screen: "I'm a CoachCarter instructor" (sign in) or "Join the team" (enquiry)
- ✅ Sign-in path: same magic-link flow with two-step prefetch protection
- ✅ Join-the-team path: name, email, phone, message form → submits as `join-team` enquiry type
- ✅ Enquiry goes through existing `api/enquiries.js` → staff email with "Instructor Application" label
- ✅ `api/enquiries.js` updated with `join-team` enquiry type label

### 2.12 — Calendar Views (Instructor + Learner) ✅ Complete (18 March 2026)
Replaced flat list layouts with full calendar interfaces on both the instructor schedule and learner booking pages.

**What was built:**
- ✅ Instructor schedule: monthly grid (booking pills, click-to-drill), weekly time-grid (positioned event blocks), daily timeline (availability indicators, mark-complete)
- ✅ Learner booking: same three calendar views with slot count badges (monthly), positioned slot blocks (weekly), and hour-by-hour slot cards (daily)
- ✅ `api/instructor.js` new `schedule-range` endpoint for date-bounded calendar queries
- ✅ View toggle (Monthly / Weekly / Daily), navigation arrows, "Today" button, instructor filter in toolbar
- ✅ Add availability modal accessible directly from instructor daily view
- ✅ All monthly cells clickable for drill-down (not just days with bookings)
- ✅ Multiple availability windows per day preserved when adding from modal

**Bug fix:**
- ✅ Fixed SQL syntax error in `api/slots.js` — Neon serverless driver doesn't support nested `sql` tagged template literals for conditional query fragments; split into separate query branches

### 2.13 — Learner Contact Preference ✅ Complete (18 March 2026)
Learners can request their instructor contacts them before their first lesson.

**What was built:**
- ✅ Toggle on learner dashboard: "Contact me before my first lesson"
- ✅ `api/learner.js` new `contact-pref` (GET) and `set-contact-pref` (POST) endpoints
- ✅ `prefer_contact_before` returned in existing `progress` endpoint
- ✅ "📞 Contact first" badge on instructor daily view next to learner name
- ✅ "📞 Learner would like a call or message before their first lesson" in instructor booking detail modal
- ✅ `db/migrations/005_contact_preference.sql`

### 2.14 — Phone & Pickup Address Required ✅ Complete (18 March 2026)
Learners must provide their phone number and pickup address before they can book a lesson.

**What was built:**
- ✅ "My Details" card on learner dashboard with phone and pickup address fields
- ✅ Red "Required for booking" / green "Complete" badge
- ✅ `api/learner.js` new `profile` (GET) and `update-profile` (POST) endpoints
- ✅ Booking blocker — toast message if learner tries to book without completing profile
- ✅ Pickup address shown to instructors: "📍" line in daily view, "Pickup" row in booking detail modal
- ✅ `db/migrations/006_pickup_address.sql`

### 2.15 — Buffer Time Between Lessons ✅ Complete (18 March 2026)
Configurable rest/travel time between booked slots for instructors.

**What was built:**
- ✅ `buffer_minutes` column on instructors table (default 30 mins)
- ✅ Instructor profile: "Scheduling" card with dropdown (0–120 mins)
- ✅ Admin portal: buffer field in instructor add/edit modal
- ✅ Slot engine applies buffer after each booked lesson when generating available slots
- ✅ `db/migrations/007_buffer_minutes.sql`

### 2.16 — Learner Dashboard Upcoming Lessons Upgrade ✅ Complete (18 March 2026)
Improved the upcoming lessons section on the learner dashboard.

**What was built:**
- ✅ Rich cards with date block (large day number, month, day-of-week), time, instructor, countdown
- ✅ Countdown text: "Starting very soon", "In 5 hours", "Tomorrow", "In 3 days"
- ✅ Calendar download button (📅) on each card
- ✅ Today's lessons highlighted with green left border
- ✅ Section always visible with "No upcoming lessons. Book one now →" when empty

### 2.17 — Video Library Rebuild ✅ Complete (18 March 2026)
Replaced static `videos.json` with a database-backed video library managed from the admin portal.

**What was built:**
- ✅ `video_categories` and `videos` database tables with ordering, thumbnails, published/unpublished, learner-only flags
- ✅ `api/videos.js` — public list/categories endpoints + full admin CRUD (create, update, delete, reorder videos and categories)
- ✅ Classroom page: grid view (thumbnail cards, category tags, click-to-play modal) + reels view (fullscreen vertical swipe), mode toggle, category filter pills
- ✅ Learner videos page: same dual grid/reels with `learner_only=true` to include exclusive content
- ✅ Admin portal: Videos section with filterable list, add/edit modal, category management modal
- ✅ Auto-generated Cloudflare Stream thumbnails as fallback
- ✅ Graceful fallback to `videos.json` if DB tables don't exist yet
- ✅ `db/migrations/008_videos.sql` with default category seeds

### 2.18 — Dynamic Pass Programme Pricing ✅ Complete (20 March 2026)
Demand-based pricing for the Pass Programme that starts low and increases with each enrolment, rewarding early adopters while the programme is proven out.

**What was built:**
- ✅ `api/guarantee-price.js` — dedicated API endpoint for reading and incrementing the Pass Programme price, with manual admin override support
- ✅ `guarantee_pricing` database table — auto-created on first API call, stores base price (£1,500), current price, increment (£100), cap (£3,000), and purchase count
- ✅ Webhook integration — `api/webhook.js` atomically increments the price after each successful Pass Programme purchase via Stripe
- ✅ Learner journey page updated with tabbed pricing card (PAYG vs Pass Programme) in the hero section, fetching live price from the API
- ✅ Transparent "launch pricing" messaging — urgency bar explains the mechanic honestly, progress bar shows price journey from £1,500 to £3,000
- ✅ Admin editor gains a "Dynamic Pricing" section showing live status, purchase count, and manual price override
- ✅ Config updated: `retake_price` corrected from £0 to £325, guarantee pricing fields added

**Pricing model:**
- Starts at £1,500 (launch price)
- Increases by £100 with every enrolment
- Caps at £3,000 (full price)
- Only goes up, never decays — but admin can manually override
- Transparent to visitors — they see the mechanic and progress bar

### 2.19 — Pricing Page Restructure ✅ Complete (20 March 2026)
Consolidated pricing into the learner journey page and made it the primary pricing destination site-wide.

**What was built:**
- ✅ Learner journey page hero replaced with tabbed pricing card (Mockup C approach): PAYG tab shows £82.50/lesson with bulk discount grid, Pass Programme tab shows live dynamic price with urgency messaging
- ✅ All site-wide nav "Pricing" links updated to point to `/learner-journey.html` (homepage, classroom, instructor pages, learner login, terms, privacy)
- ✅ Old guarantee calculator and comparison table removed from `lessons.html`, replaced with a compact redirect banner pointing to the learner journey page
- ✅ `lessons.html` now focuses on PAYG and bulk packages only
- ✅ Renamed "Pass Guarantee" → "Pass Programme" across all user-facing text (HTML, JS, config, email templates). Code identifiers kept as `pass_guarantee` / `isPassGuarantee` for Stripe/webhook compatibility

### 2.20 — Demo Booking System ✅ Complete (20 March 2026)
A dedicated demo page that lets users (and the site owner) explore the full booking flow with a free demo instructor.

**What was built:**
- ✅ `public/demo/book.html` — full booking calendar (monthly/weekly/daily views) filtered to the demo instructor only
- ✅ Requires login (redirects to `/learner/login.html` if not authenticated)
- ✅ Bookings are real (stored in DB, emails sent, calendar invites generated) but free — no credit deduction
- ✅ Upcoming demo bookings shown with cancel buttons; cancellation frees the slot with no credit return
- ✅ Demo instructor (ID 5, `demo@coachcarter.uk`) with full 7-day availability (07:00–21:00), zero buffer time
- ✅ Demo instructor hidden from real booking flows: email filter in `api/instructors.js` (list) and `api/slots.js` (unfiltered availability)
- ✅ `api/slots.js` — `handleBook` skips credit check/deduction for demo instructor; `handleCancel` skips credit return; no emails sent to demo instructor
- ✅ Demo links added to homepage quiz ("Try the booking demo") and pricing page ("try the booking demo")
- ✅ `db/seeds/002_demo_instructor.sql` — SQL seed for creating the demo instructor and availability
- ✅ Bottom nav includes Demo tab; demo banner at top of page explains the mode

### 2.21 — Reviews & Testimonials
Post-lesson review prompt triggered after a lesson is marked completed.
- Automated email 24 hours after lesson status → completed
- Simple star rating + comment
- Optional: display approved reviews publicly

### 2.22 — Waiting List
Capture leads when all instructors are fully booked.
- "No slots available" state on calendar triggers a waiting list sign-up
- Notifies admin when someone joins
- Admin can manually offer a slot and notify the learner

### 2.23 — Referral System
Reward learners for recommending friends.
- Unique referral link per learner
- Both referrer and new learner receive a credit bonus on first purchase

---

## Phase 3: Future Considerations (Not Yet Scoped)

- **Progress tracking** — learner dashboard showing lessons completed, skills covered, test readiness (the existing skill tracker may feed into this)
- **Theory test prep** — built-in revision tools rather than sending learners to third-party apps
- **Online payments for non-lesson services** — theory test booking, intensive course packages
- **Instructor earnings tracking** — per-lesson payout calculations, monthly summaries

---

## Technical Notes

- **Stack:** Vanilla HTML/JS frontend, Vercel serverless functions (Node.js), Neon (PostgreSQL), Stripe, JWT auth, Resend + Nodemailer for email
- **Hosting:** Vercel Pro (upgraded to support >12 serverless functions)
- **Payments:** Stripe (Klarna enabled via Stripe dashboard — not hardcoded)
- **Calendar:** Custom-built, no third-party calendar dependency
- **Slot duration:** 1.5 hours (hardcoded, can be made configurable later)
- **Buffer time:** Configurable per instructor (default 30 mins), blocks time after each booked slot
- **Advance booking window:** 90 days
- **Cancellation policy:** 48 hours minimum notice for credit return
- **Video hosting:** Cloudflare Stream (HLS adaptive streaming), managed from admin portal
- **API pattern:** Related endpoints grouped into single files using `?action=` routing
- **DB migrations:** `db/migrations/` — run manually in Neon SQL Editor
- **Seed data:** `db/seeds/` — placeholder instructors for testing
