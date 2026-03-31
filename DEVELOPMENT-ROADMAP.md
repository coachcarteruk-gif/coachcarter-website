# Coach Carter — Website Development Roadmap

## Overview

This document tracks the development of the **Coach Carter driving school platform** — a comprehensive web application for booking lessons, processing payments, tracking learner competency, and providing AI-powered learning tools. The platform includes a learner portal, instructor portal, admin portal, Stripe-integrated payments (with Klarna), a DL25-aligned 17-skill competency framework, AI chat features powered by Claude, and full Progressive Web App (PWA) support for installable, offline-capable access.

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

## Phase 2: Platform Features ✅ Complete

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

### 2.4 — Learner Dashboard Enhancements ✅ Complete

Surface the new booking system on the existing learner dashboard.

**What was built:**
- ✅ Credit balance card at the top of the dashboard with "Buy Credits" and "Book a Lesson" CTAs
- ✅ "Book a Lesson" button automatically dimmed when balance is zero, prompting learner to buy credits
- ✅ Upcoming lessons section showing next 5 confirmed bookings with date, time, and instructor name
- ✅ "Manage" link on each upcoming lesson through to the booking page for cancellations

### 2.5 — Pay-Per-Slot Booking ✅ Complete

Allow learners with 0 credits to pay for a single lesson at the point of booking instead of requiring them to buy credits first.

**What was built:**
- ✅ Dual-path booking modal — detects credit balance and shows either "Confirm booking" (use credit) or "Pay £82.50 & book" (Stripe Checkout)
- ✅ `api/slots.js` `checkout-slot` action — creates Stripe Checkout session with `payment_type: 'slot_booking'` metadata
- ✅ Slot reservation system — `slot_reservations` table holds slot for 10 minutes during payment, excluded from availability
- ✅ `api/webhook.js` `handleSlotBooking` — processes payment, atomically adds/deducts credit, creates booking, sends .ics calendar attachment to both parties
- ✅ No-credits banner updated from red (alarming) to soft orange with messaging: "No worries — you can pay when you book, or buy a bundle to save."
- ✅ Success/cancellation toasts on return from Stripe

### 2.6 — Session Logging Rebuild ✅ Complete (v1 → superseded by 2.21)

Original rebuild as an 8-step wizard with emoji-based ratings. Superseded by v2 (section 2.21).

### 2.7 — Learner Portal Videos ✅ Complete

Added the classroom/videos page to the learner portal behind login, accessible from the bottom nav.

**What was built:**
- ✅ `public/learner/videos.html` — video library accessible within the learner portal
- ✅ Bottom nav pattern shared across all learner portal pages

### 2.8 — Homepage Quiz Update ✅ Complete

Updated the homepage quiz results to direct learners to the Learner Hub, Book a Free Trial, or Explore Prices instead of just the booking page.

### 2.9 — Magic Link Login Fix ✅ Complete (17 March 2026)

Fixed magic link login — email clients were pre-fetching the verify link and consuming the token before the learner clicked it. Applied to both learner and instructor logins.

**What was built:**
- ✅ New `validate` endpoint (GET) — lightweight token check that does NOT mark it as used
- ✅ `verify` endpoint changed to POST-only — only browser JavaScript can consume the token
- ✅ `public/learner/verify.html` — two-step flow: validate (GET) then verify (POST)
- ✅ `api/instructor.js` — new `validate-token` (GET) + `verify-token` changed to POST-only
- ✅ Email prefetchers can no longer burn tokens on either portal

### 2.10 — Instructor Login Redesign ✅ Complete (17 March 2026)

Redesigned the instructor login page as a choice screen with two paths.

**What was built:**
- ✅ Choice screen: "I'm a CoachCarter instructor" (sign in) or "Join the team" (enquiry)
- ✅ Sign-in path: same magic-link flow with two-step prefetch protection
- ✅ Join-the-team path: name, email, phone, message form → submits as `join-team` enquiry type
- ✅ Enquiry goes through existing `api/enquiries.js` → staff email with "Instructor Application" label
- ✅ `api/enquiries.js` updated with `join-team` enquiry type label

### 2.11 — Calendar Views (Instructor + Learner) ✅ Complete (18 March 2026)

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

### 2.12 — Learner Contact Preference ✅ Complete (18 March 2026)

Learners can request their instructor contacts them before their first lesson.

**What was built:**
- ✅ Toggle on learner dashboard: "Contact me before my first lesson"
- ✅ `api/learner.js` new `contact-pref` (GET) and `set-contact-pref` (POST) endpoints
- ✅ `prefer_contact_before` returned in existing `progress` endpoint
- ✅ "Contact first" badge on instructor daily view next to learner name
- ✅ "Learner would like a call or message before their first lesson" in instructor booking detail modal
- ✅ `db/migrations/005_contact_preference.sql`

### 2.13 — Phone & Pickup Address Required ✅ Complete (18 March 2026)

Learners must provide their phone number and pickup address before they can book a lesson.

**What was built:**
- ✅ "My Details" card on learner dashboard with phone and pickup address fields
- ✅ Red "Required for booking" / green "Complete" badge
- ✅ `api/learner.js` new `profile` (GET) and `update-profile` (POST) endpoints
- ✅ Booking blocker — toast message if learner tries to book without completing profile
- ✅ Pickup address shown to instructors in daily view and booking detail modal
- ✅ `db/migrations/006_pickup_address.sql`

### 2.14 — Buffer Time Between Lessons ✅ Complete (18 March 2026)

Configurable rest/travel time between booked slots for instructors.

**What was built:**
- ✅ `buffer_minutes` column on instructors table (default 30 mins)
- ✅ Instructor profile: "Scheduling" card with dropdown (0–120 mins)
- ✅ Admin portal: buffer field in instructor add/edit modal
- ✅ Slot engine applies buffer after each booked lesson when generating available slots
- ✅ `db/migrations/007_buffer_minutes.sql`

### 2.15 — Learner Dashboard Upcoming Lessons Upgrade ✅ Complete (18 March 2026)

Improved the upcoming lessons section on the learner dashboard.

**What was built:**
- ✅ Rich cards with date block (large day number, month, day-of-week), time, instructor, countdown
- ✅ Countdown text: "Starting very soon", "In 5 hours", "Tomorrow", "In 3 days"
- ✅ Calendar download button on each card
- ✅ Today's lessons highlighted with green left border
- ✅ Section always visible with "No upcoming lessons. Book one now" when empty

### 2.16 — Video Library Rebuild ✅ Complete (18 March 2026)

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

### 2.17 — Dynamic Pass Programme Pricing ✅ Complete (20 March 2026)

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

### 2.18 — Pricing Page Restructure ✅ Complete (20 March 2026)

Consolidated pricing into the learner journey page and made it the primary pricing destination site-wide.

**What was built:**
- ✅ Learner journey page hero replaced with tabbed pricing card (Mockup C approach): PAYG tab shows £82.50/lesson with bulk discount grid, Pass Programme tab shows live dynamic price with urgency messaging
- ✅ All site-wide nav "Pricing" links updated to point to `/learner-journey.html` (homepage, classroom, instructor pages, learner login, terms, privacy)
- ✅ Old guarantee calculator and comparison table removed from `lessons.html`, replaced with a compact redirect banner pointing to the learner journey page
- ✅ `lessons.html` now focuses on PAYG and bulk packages only
- ✅ Renamed "Pass Guarantee" → "Pass Programme" across all user-facing text (HTML, JS, config, email templates). Code identifiers kept as `pass_guarantee` / `isPassGuarantee` for Stripe/webhook compatibility

### 2.19 — Demo Booking System ✅ Complete (20 March 2026)

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

### 2.20 — Session Logging v2 ✅ Complete (20 March 2026)

Complete rewrite of the session logging system: consolidated from 8 steps to 3, replaced emoji ratings with Traffic Light system, linked sessions to completed bookings, and gave instructors visibility into learner self-assessments.

**What was built:**
- ✅ `public/learner/log-session.html` — 3-step wizard: details → rate all skills on one page → notes/save
- ✅ Traffic Light rating system: Red (Needs work → `struggled`), Amber (Getting there → `ok`), Green (Confident → `nailed`)
- ✅ Booking pre-fill: when accessed via `?booking_id=X`, auto-fills date, time, duration, instructor from the completed booking
- ✅ `db/migrations/009_session_booking_link.sql` — adds `booking_id` column to `driving_sessions` with unique constraint
- ✅ `api/learner.js` — `sessions` POST accepts optional `booking_id` with validation (must belong to learner, be completed, not already logged)
- ✅ `api/learner.js` — new `unlogged-bookings` endpoint returns completed bookings without session logs
- ✅ `api/instructor.js` — `handleComplete` sends email to learner with direct link to log the session
- ✅ `api/instructor.js` — schedule/schedule-range queries now JOIN `driving_sessions` and `skill_ratings` to include learner self-assessment data
- ✅ `public/learner/index.html` — unlogged booking banner ("You have X lessons to log") with CTA linking to log page
- ✅ `public/learner/index.html` — progress cards and session history use traffic light dots instead of emojis
- ✅ `public/instructor/index.html` — collapsible "Learner Self-Assessment" section on completed bookings in daily view and booking detail modal
- ✅ Font migration: learner portal pages (`index.html`, `log-session.html`) updated to Bricolage Grotesque + Lato

### 2.21 — Session Logging v2 Bug Fixes ✅ Complete (20 March 2026)

Addressed issues discovered after the v2 launch.

### 2.22 — Q&A System ✅ Complete (March 2026)

Learner and instructor Q&A forum.

**What was built:**
- ✅ Learners can ask questions, instructors can reply
- ✅ Thread-based with status tracking
- ✅ Accessible from both learner and instructor portals
- ✅ API endpoints in `api/learner.js` (`qa-list`, `qa-detail`, `qa-ask`, `qa-reply`)
- ✅ `db/migrations/014_qa_system.sql`

### 2.23 — Google Reviews ✅ Complete (March 2026)

Embedded Google Reviews on public-facing pages.

**What was built:**
- ✅ `api/reviews.js` serves cached Google Reviews
- ✅ `db/migrations/015_google_reviews.sql`
- ✅ `db/migrations/016_seed_google_reviews.sql`

### 2.24 — Sidebar Navigation ✅ Complete (March 2026)

Replaced all previous navigation patterns (bottom tabs, top nav, hamburger menus) with a unified sidebar.

**What was built:**
- ✅ Single `sidebar.js` IIFE used across all 22+ pages
- ✅ Context-aware: detects public/learner/instructor from URL path
- ✅ Collapsible "Lessons" group with Book/Purchase/Upcoming sub-tabs
- ✅ Auth-aware footer with user name, credits, logout
- ✅ Mobile responsive with hamburger toggle at 960px breakpoint
- ✅ Admin link injection for admin instructors

### 2.25 — Examiner Knowledge Base ✅ Complete (March 2026)

Interactive quiz and AI-powered Q&A based on the DVSA DL25 examiner marking sheet.

**What was built:**
- ✅ 50-question interactive quiz covering all 17 DL25 skill areas
- ✅ AI "Ask the Examiner" chat powered by Claude with full DL25 knowledge base system prompt
- ✅ Quiz results persist per-question to `quiz_results` table, feeding competency system
- ✅ Both accessible from learner sidebar and dashboard cards

### 2.26 — DL25-Aligned Competency System ✅ Complete (March 2026)

Unified 17-skill competency framework aligned to the DVSA DL25 marking sheet. Shared config (`competency-config.js`) used across 6 features.

**17 skills in 5 areas:**
- **Vehicle Control:** Accelerator, Clutch, Gears, Footbrake, Parking Brake, Steering
- **Observation:** Mirrors, Signals, Awareness & Planning
- **Road Procedure:** Signs & Signals, Positioning, Clearance, Following Distance
- **Junctions & Speed:** Junctions, Judgement, Use of Speed, Pedestrian Crossings

**Database tables:** `mock_tests`, `mock_test_faults`, `quiz_results`, `competency_snapshots`; `skill_ratings` extended with fault columns

**Migration:** `db/migrations/017_competency_system.sql`

### 2.27 — Log Session Upgrade (17 Skills) ✅ Complete (March 2026)

Upgraded from 10 generic questions to 17 DL25-aligned skills with fault tallies.

**What was built:**
- ✅ Traffic light ratings (struggled/ok/nailed) + driving/serious/dangerous fault counts per skill
- ✅ Skills grouped into 5 collapsible accordion areas matching `competency-config.js`
- ✅ Feeds into `competency_snapshots` for My Progress page

### 2.28 — Mock Driving Test ✅ Complete (March 2026)

Full mock driving test simulator with 3 x 10-minute parts and DL25 fault recording.

**What was built:**
- ✅ Start screen with phone/safety warning
- ✅ 3 parts with count-up timer, minimum 60s per part before recording faults
- ✅ Per-skill fault recording with tap counters [D] [S] [X] across all 17 skills
- ✅ Results screen with PASS/FAIL (15D or fewer, 0S, 0X = pass), per-part breakdown, improvement suggestions
- ✅ API endpoints: `mock-tests` (GET/POST), `mock-test-faults` (GET/POST)

### 2.29 — My Progress Page ✅ Complete (March 2026)

Comprehensive competency dashboard with data visualisation.

**What was built:**
- ✅ Radar chart showing all 17 skills
- ✅ Skill breakdown table with lesson ratings, quiz accuracy, fault counts
- ✅ Readiness score calculation (0–100%)
- ✅ Mock test history with pass/fail badges
- ✅ Session timeline
- ✅ Data from: session logs, quiz results, mock tests, onboarding

### 2.30 — Learner Onboarding ✅ Complete (March 2026)

"Build Your Driving Profile" flow that captures learner context from day one.

**What was built:**
- ✅ Step 1: Prior experience (professional hours, private hours, previous tests, transmission, test date, concerns)
- ✅ Step 2: Initial self-assessment (5 areas with drill-down to individual skills for weak areas)
- ✅ Step 3: Summary and save
- ✅ Initial ratings saved as special 'onboarding' session feeding competency system
- ✅ Dashboard profile completion card with 5-step checklist and smart CTAs
- ✅ `db/migrations/018_learner_onboarding.sql`

### 2.31 — AI Personalisation ✅ Complete (March 2026)

Ask the Examiner AI now reads full learner profile before every response.

**What was built:**
- ✅ Onboarding data (prior hours, test count, test date, concerns)
- ✅ Latest skill ratings grouped by strength
- ✅ Quiz weak areas (below 70% accuracy)
- ✅ Mock test results
- ✅ Session statistics
- ✅ Gracefully degrades if DB query fails

### 2.32 — AI Lesson Advisor ✅ Complete (March 2026)

Conversational AI sales assistant that recommends lesson packages and creates Stripe checkouts.

**What was built:**
- ✅ Uses Claude `tool_use` to decide when to offer checkout
- ✅ Reads learner competency data to estimate hours needed
- ✅ Pricing: £82.50/lesson base, bulk discounts 5–25% (proportional between tiers)
- ✅ Server-side pricing validation prevents AI from offering invalid prices
- ✅ Creates real Stripe Checkout sessions mid-conversation
- ✅ Conversation persists in localStorage across login redirect
- ✅ Accessible from public sidebar and learner portal

### 2.33 — Progressive Web App ✅ Complete (March 2026)

Full PWA support for installable app experience.

**What was built:**
- ✅ `manifest.json` with app metadata, icons, standalone display mode
- ✅ Service worker (`sw.js`) caching app shell, network-first for dynamic content
- ✅ Custom install prompt banner (`pwa.js`)
- ✅ Branded offline fallback page (`offline.html`)
- ✅ Icons in 6 sizes (48–512px) with maskable variants
- ✅ Works on Chrome, Edge, Safari (iOS 16.4+), Samsung Internet, Firefox

### 2.34 — Codebase Cleanup ✅ Complete (March 2026)

Housekeeping and code quality improvements.

**What was built:**
- ✅ Fixed migration numbering (three 009_ files → sequential 009–018)
- ✅ Extracted shared auth helpers (`api/_auth-helpers.js`) and mail utilities (`api/_shared.js`)
- ✅ Removed dead/unused files

### 2.35 — Foundation Cleanup ✅ Complete (25 March 2026)

Three-part cleanup to eliminate technical debt that was slowing down development.

**Part 1: Centralised DB Migration**
- ✅ `db/migration.sql` — single idempotent file defining all 23 tables the app needs (safe to re-run)
- ✅ `api/migrate.js` — protected endpoint to run migrations (requires `MIGRATION_SECRET` env var)
- ✅ Removed all scattered `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS` from 11 API files (264 lines removed)
- ✅ Removed try/catch fallbacks for missing tables (`credit_transactions`, `driving_sessions`)
- ✅ All queries now assume tables exist — no more defensive schema checks at runtime

**Part 2: Shared CSS/JS Extraction**
- ✅ `public/shared/learner.css` — CSS variables, reset, body styles, site-nav styles, utilities
- ✅ `public/shared/instructor.css` — CSS variables, reset, body styles, site-nav styles, portal header
- ✅ `public/shared/learner-auth.js` — `ccAuth.getAuth()`, `ccAuth.logout()`, `ccAuth.requireAuth()`, `ccAuth.getToken()`
- ✅ `public/shared/instructor-auth.js` — same API for instructor portal
- ✅ Updated 13 learner pages and 5 instructor pages to use shared CSS (~984 lines of duplicated CSS removed)
- ✅ Updated 13 learner pages and 5 instructor pages to use shared auth JS (inline localStorage reads/logout functions replaced with `ccAuth` calls)

**Part 3: Email Error Alerts**
- ✅ `api/_error-alert.js` — fire-and-forget `reportError()` utility using existing SMTP config
- ✅ Added `reportError()` before every `res.status(500)` call across 21 API files
- ✅ Sends formatted email with endpoint, error message, and stack trace
- ✅ Requires `ERROR_ALERT_EMAIL` env var (silently no-ops if not set)
- ✅ Non-blocking — does not await, does not slow error responses

### 2.36 — Multiple Lesson Types & Hours-Based Balance ✅ Complete (31 March 2026)

Replaced fixed 90-min/1-credit lessons with variable-duration lesson types and an hours-based balance system.

**What was built:**
- ✅ `lesson_types` table with admin CRUD API (`api/lesson-types.js`)
- ✅ Seeded: Standard Lesson (90min/£82.50), 2-Hour Lesson (120min/£110)
- ✅ `balance_minutes` column on learner_users — hours-based balance (stored as minutes internally)
- ✅ Existing credit balances migrated: `balance_minutes = credit_balance × 90`
- ✅ `lesson_type_id` + `minutes_deducted` on lesson_bookings for audit trail
- ✅ Slot generation engine (`api/slots.js`) accepts `lesson_type_id` for variable-duration slots
- ✅ All booking flows (book, checkout-slot, cancel, reschedule) use minutes-based balance
- ✅ `api/credits.js` sells hours at £55/hr with discount tiers (6/12/18/24/30 hrs)
- ✅ Webhook dual-writes `credit_balance` + `balance_minutes` for rollback safety
- ✅ Admin portal: Lesson Types CRUD management section
- ✅ Learner booking page: lesson type selector (shown when multiple types exist)
- ✅ Buy Credits → Buy Hours page with hour-based packages
- ✅ Dashboard, sidebar, emails, WhatsApp, ICS all show hours instead of credits
- ✅ Instructor create-booking modal has lesson type dropdown
- ✅ AI Lesson Advisor prompt updated with hours-based pricing

### 2.37 — Colour-Coded Lesson Types ✅ Complete (31 March 2026)

Lesson type colours visible across the instructor calendar and learner booking page.

**What was built:**
- ✅ Monthly view: booking pills use lesson type colour as background
- ✅ Weekly view: Setmore-style tinted background with coloured left border
- ✅ Daily view: lesson type badge pill next to time, coloured card borders
- ✅ Booking detail modal: type name badge with duration
- ✅ Learner upcoming bookings: coloured left border + type name label
- ✅ Completed bookings: reduced opacity regardless of type colour

### 2.38 — Agenda/List View ✅ Complete (31 March 2026)

Fourth calendar view mode for instructors showing a scrollable list of upcoming lessons.

**What was built:**
- ✅ "Agenda" button in instructor calendar toolbar alongside Daily/Weekly/Monthly
- ✅ 14-day rolling window of bookings grouped by date headers
- ✅ Each card: time, colour-coded lesson type badge, learner name, pickup address, status
- ✅ Date headers clickable to drill into daily view
- ✅ Respects showCancelled toggle
- ✅ Cards open existing booking detail modal
- ✅ ±14 day navigation, Today button works

---

## Phase 3: Next Up (Prioritised)

### 3.1 — Push Notifications

PWA push notifications for lesson reminders, quiz nudges, and new message alerts.

### 3.2 — Automated Lesson Reminders

24-hour email/WhatsApp reminder to learner and instructor before each lesson. Needs Vercel cron job.

### 3.3 — Refund Flow

Learner requests cash refund from dashboard, admin approves in portal, Stripe processes reversal.

### 3.4 — Waiting List

Capture leads when all instructors are fully booked. "No slots available" triggers sign-up form. Admin notified and can manually offer slots.

### 3.5 — Referral System

Unique referral link per learner. Both referrer and new learner receive hours bonus on first purchase.

### 3.6 — Recurring/Repeat Bookings

"Repeat weekly" option when booking — creates multiple bookings in one transaction. Depends on lesson types (Feature 3).

### 3.7 — Per-Service Booking Links

URL parameter support: `/learner/book?type=2hr` pre-selects lesson type. Shareable links for marketing.

---

## Phase 4: Future Considerations (Not Yet Scoped)

- **Capacitor native wrapper** — wrap PWA for App Store / Play Store submission
- **Instructor dashboard** — earnings tracking, lesson stats, learner progress overview
- **Theory test prep** — built-in revision tools integrated with competency system
- **Multi-instructor scaling** — instructor-specific pricing, specialisations, rating system
- **Automated progress reports** — weekly email digest with competency changes and recommendations
- **Parent/guardian view** — read-only progress access for parents of younger learners
- **Intensive course packages** — multi-day bundled bookings with special pricing

---

## Technical Notes

- **Stack:** Vanilla HTML/JS frontend, Vercel serverless functions (Node.js), Neon (PostgreSQL), Stripe, JWT auth, Resend + Nodemailer for email
- **Hosting:** Vercel Pro (upgraded to support >12 serverless functions)
- **Payments:** Stripe (Klarna enabled via Stripe dashboard — not hardcoded)
- **Calendar:** Custom-built, no third-party calendar dependency
- **Lesson types:** Configurable via `lesson_types` table + admin portal. Standard (90min/£82.50), 2-Hour (120min/£110). More types addable via admin.
- **Balance system:** Hours-based (`balance_minutes` column). Learners buy hours, each lesson type deducts its duration. Legacy `credit_balance` maintained via dual-write.
- **Buffer time:** Configurable per instructor (default 30 mins), blocks time after each booked slot
- **Advance booking window:** 90 days
- **Cancellation policy:** 48 hours minimum notice for credit return
- **Rescheduling:** Learners can reschedule 48hr+ in advance (max 2 per chain), instructors anytime. No credit change.
- **Booking lead time:** Per-instructor `min_booking_notice_hours` (default 24h) filters slots too close to now
- **Instructor-initiated booking:** Instructors can book lessons on behalf of learners via "Add Lesson" modal (cash/credit/free payment)
- **Per-booking addresses:** `pickup_address` and `dropoff_address` on each booking (overrides learner profile default)
- **Calendar display:** Configurable `calendar_start_hour` (default 7); non-working hours greyed out using availability windows
- **Calendar views:** Daily, Weekly, Monthly, Agenda (14-day list). Toggles: hide weekends, show/hide cancelled, print schedule
- **Video hosting:** Cloudflare Stream (HLS adaptive streaming), managed from admin portal
- **API pattern:** Related endpoints grouped into single files using `?action=` routing
- **DB migrations:** `db/migration.sql` — single idempotent file, run via `GET /api/migrate?secret=MIGRATION_SECRET`
- **Seed data:** `db/seeds/` — placeholder instructors for testing
- **AI:** Claude API (Anthropic) for Ask the Examiner, Lesson Advisor, with `tool_use` for dynamic checkout
- **Competency:** 17-skill DL25-aligned framework defined in `competency-config.js`, shared across 6 features
- **Navigation:** Context-aware sidebar (`sidebar.js`) replaces all previous nav patterns
- **PWA:** Installable with service worker caching, offline support, custom install prompt
- **Analytics:** PostHog for event tracking and session recording
- **Shared code:** Auth helpers in `api/_auth-helpers.js`, mail utilities in `api/_shared.js`, error alerts in `api/_error-alert.js`
- **Shared frontend:** CSS in `public/shared/learner.css` + `instructor.css`, auth JS in `public/shared/learner-auth.js` + `instructor-auth.js`
- **Error alerting:** Email alerts on 500 errors via `api/_error-alert.js` (requires `ERROR_ALERT_EMAIL` env var)
