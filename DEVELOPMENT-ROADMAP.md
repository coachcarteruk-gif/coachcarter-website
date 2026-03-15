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
- Full audit trail: type (purchase/refund), credits, amount in pence, payment method, Stripe IDs

---

### 1.4 — User Flows ✅

**Learner purchases credits:**
1. Learner logs in → navigates to "Buy Credits"
2. Selects quantity (discount tier cards highlight applicable discount)
3. Pays via Stripe (card or Klarna)
4. Stripe webhook confirms payment → credits added to balance, confirmation email sent

**Learner books a lesson:**
1. Learner logs in → opens booking calendar (`/learner/book.html`)
2. Browses available slots week by week (filter by instructor optional)
3. Clicks a slot → confirmation modal shows date, time, instructor, credit cost
4. Confirms → 1 credit deducted, booking confirmed, both parties emailed

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

### 2.2 — Automated Reminders
Email (and optionally SMS) reminders before upcoming lessons.
- 24-hour reminder to learner
- 24-hour reminder to instructor
- Triggered by a scheduled job or cron webhook

### 2.3 — Refund Flow
Cash refund for unused credits.
- Learner requests refund from dashboard
- Admin approves in portal
- Stripe processes reversal, credit deducted from balance

### 2.4 — Learner Dashboard Enhancements
Surface the new booking system on the existing learner dashboard.
- Credit balance and "Buy Credits" / "Book a Lesson" CTAs at the top
- Upcoming bookings listed (currently only visible on the book page)
- Transaction history

### 2.5 — Reviews & Testimonials
Post-lesson review prompt triggered after a lesson is marked completed.
- Automated email 24 hours after lesson status → completed
- Simple star rating + comment
- Optional: display approved reviews publicly

### 2.6 — Waiting List
Capture leads when all instructors are fully booked.
- "No slots available" state on calendar triggers a waiting list sign-up
- Notifies admin when someone joins
- Admin can manually offer a slot and notify the learner

### 2.7 — Referral System
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
