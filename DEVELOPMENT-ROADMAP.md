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
Fixed magic link login — email clients were pre-fetching the verify link and consuming the token before the learner clicked it.

**What was built:**
- ✅ New `validate` endpoint (GET) — lightweight token check that does NOT mark it as used
- ✅ `verify` endpoint changed to POST-only — only browser JavaScript can consume the token
- ✅ `public/learner/verify.html` — two-step flow: validate (GET) then verify (POST)
- ✅ Email prefetchers can no longer burn tokens

### 2.11 — Reviews & Testimonials
Post-lesson review prompt triggered after a lesson is marked completed.
- Automated email 24 hours after lesson status → completed
- Simple star rating + comment
- Optional: display approved reviews publicly

### 2.12 — Waiting List
Capture leads when all instructors are fully booked.
- "No slots available" state on calendar triggers a waiting list sign-up
- Notifies admin when someone joins
- Admin can manually offer a slot and notify the learner

### 2.13 — Referral System
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
- **Advance booking window:** 90 days
- **Cancellation policy:** 48 hours minimum notice for credit return
- **API pattern:** Related endpoints grouped into single files using `?action=` routing
- **DB migrations:** `db/migrations/` — run manually in Neon SQL Editor
- **Seed data:** `db/seeds/` — placeholder instructors for testing
