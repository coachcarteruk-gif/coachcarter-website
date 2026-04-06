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

### 2.3b — Inbound iCal Feed Sync ✅ Complete

Instructors can paste their personal calendar's iCal feed URL (Google, Outlook, Apple) into their profile page. A cron job polls feeds every 15 minutes and stores busy-time blocks. Slot generation checks these events alongside bookings and blackout dates — overlapping slots are automatically blocked for learners. No OAuth; works with any calendar provider.

**What was built:**
- ✅ `db/migrations/022_ical_sync.sql` — `instructor_external_events` table + `ical_feed_url`, `ical_last_synced_at`, `ical_sync_error` columns on `instructors`
- ✅ `api/ical-sync.js` — Vercel cron job (every 15 min), processes 1 instructor per invocation, expands RRULE recurring events, upserts via uid_hash dedup
- ✅ `api/instructor.js` — `ical-test` (validate feed URL), `ical-status` (sync status), `ical_feed_url` in update-profile
- ✅ `api/slots.js` — loads external events into existing bookedIndex/blackoutIndex (~15 lines added)
- ✅ `public/instructor/profile.html` — Calendar Sync card with URL input, test button, sync status indicator, help text for Google/Outlook/Apple

### 2.4 — Learner Dashboard Enhancements ✅ Complete

Surface the new booking system on the existing learner dashboard.

**What was built:**
- ✅ Credit balance card at the top of the dashboard with "Buy Credits" and "Book a Lesson" CTAs (removed in 2.39)
- ✅ "Book a Lesson" button automatically dimmed when balance is zero, prompting learner to buy credits (removed in 2.39)
- ✅ Upcoming lessons section showing next confirmed booking with date, time, and instructor name
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
- ✅ Dashboard profile completion card with 2-step checklist (prior experience + initial assessment)
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

### 2.39 — Learner Dashboard Navigation Hub ✅ Complete (31 March 2026)

Redesigned learner dashboard as a navigation hub focused on learning, not upselling.

**What was built:**
- ✅ 5 quick-action buttons: Mock Test, Ask Examiner, Book Lessons, Progress, Quiz
- ✅ Removed "Hours Remaining" credit balance card (felt like upselling, not learner-focused)
- ✅ Upcoming lessons section retained
- ✅ Profile completion card simplified to 2 steps only: Prior Experience + Initial Assessment
- ✅ Profile card CTA copy adapts: "Add Your Experience" or "Complete Skill Assessment" based on next step

### 2.40 — Navigation Alignment: Desktop Groups + Fixed Mobile Tabs ✅ Complete (31 March 2026)

Aligned desktop and mobile navigation so both surfaces share the same mental model of sections and subsections.

**What was built:**
- ✅ Desktop sidebar: Lessons, Practice, Learn now expand as collapsible groups (accordion — one open at a time) revealing subsection links. Auto-expands to current section on page load.
- ✅ Mobile bottom bar: replaced contextual tabs that changed per-section with 5 fixed tabs (Home, Lessons, Practice, Learn, Profile) — consistent muscle memory across all pages
- ✅ Mobile header hamburger restored so users can access the sidebar on mobile (previously hidden when bottom bar was present)
- ✅ Active tab on mobile highlights based on `activeOn` mapping — e.g. visiting `/learner/mock-test.html` lights up the Practice tab
- ✅ Single file change: `public/sidebar.js` only

### 2.41 — UI/Design Refresh: Borderless Cards + App-Style Polish ✅ Complete (31 March 2026)

Mobbin-inspired visual refresh across the learner and instructor portals, bringing the aesthetic closer to top iOS apps (Revolut, Calm, Freenow, komoot).

**What was built:**
- ✅ Cards site-wide: removed all `border: 1px solid` from `.card`, `.choice-card`, `.quick-action-card`, `.stat-pill`, `.progress-card`, `.upcoming-card`, `.profile-card`, `.cal-sync-banner` — replaced with neutral ambient shadows
- ✅ Upcoming lesson cards retain the orange left-border accent, all others are fully borderless
- ✅ `.choice-card` hover: removed border-colour change, now uses shadow depth only
- ✅ Bottom tab active state: warm pill highlight (`#fff4ec` background) instead of orange text alone
- ✅ Changes via CSS injection in `sidebar.js` — no edits to individual page files
- ✅ `public/shared-auth.css` updated for login/choice card styles

### 2.42 — Instructor Calendar: Timepage-Style Weekly View ✅ Complete (31 March 2026)

Replaced the time-grid weekly view (which crushed columns on mobile) with an agenda-style layout inspired by Timepage.

**What was built:**
- ✅ Each day is a horizontal row: compact day label (DOW + date number) on the left, lesson cards on the right
- ✅ Lesson cards have a coloured left-bar matching the lesson type colour
- ✅ Today's day label is highlighted in orange
- ✅ Empty days show "No lessons" placeholder
- ✅ Tap day label → drills into daily view; tap lesson card → opens booking detail modal
- ✅ Preserves: cancelled/completed styling, `hideWeekends` filter, `showCancelled` toggle, lesson type colours
- ✅ Scales naturally to any screen width — no more crushed columns on mobile
- ✅ Changes in `public/instructor/index.html` only (CSS + `renderWeekly()` function)

### 2.43 — Floating Pill Bottom Nav Bar ✅ Complete (31 March 2026)

Replaced the edge-to-edge fixed bottom bar with a floating pill — matching the premium app style of Revolut, Linear, and top iOS apps.

**What was built:**
- ✅ Bar floats 12px above the bottom edge with 10px side margins (not full-width)
- ✅ `border-radius: 26px` — fully rounded pill shape
- ✅ `backdrop-filter: blur(20px)` frosted glass effect on the bar background
- ✅ Layered shadow (`0 8px 32px` + `0 2px 8px`) for depth
- ✅ Subtle `1px border` at `rgba(0,0,0,0.06)` for edge definition
- ✅ Inactive tabs: lighter grey `#a0a0a0`; active: orange icon + warm `#fff3e8` pill
- ✅ Active icon scales 1.1× with bolder stroke (2.5)
- ✅ Home tab: switched from dashboard/grid icon to house icon
- ✅ Safe area inset handled via `max(12px, env(safe-area-inset-bottom))`
- ✅ Content height updated from 72px to 80px to account for floating offset

### 2.44 — Dashboard Redesign: Hero Cards, Pills & Action Cards ✅ Complete (1 April 2026)

Replaced the top section of both learner and instructor dashboards with an app-style layout inspired by Klarna, Zing, and Monday.com. Prioritises answering "when's my next lesson?" and reducing clutter.

**What was built (Learner — `public/learner/index.html`):**
- ✅ Compact greeting (`Hi, {name}`) replacing the old welcome banner + subtitle
- ✅ **Next Lesson hero card** — orange gradient card showing next upcoming lesson: date, time, instructor, countdown ("In 3 hours", "Tomorrow"), plus 52px readiness ring (white-on-orange)
- ✅ Dashed empty state with "Book a Lesson" CTA when no lessons exist
- ✅ **Quick Access Pills** — horizontal scrollable row of 5 circular icon shortcuts (Progress, Videos, Quiz, Examiner AI, Log Session) with coloured backgrounds
- ✅ **Colour Action Cards** — 3-column grid: Book Lesson (orange gradient), Buy Credits (green gradient), Mock Test (blue gradient)
- ✅ Upcoming section now shows 2nd+ lessons (1st is in hero card); hidden when 0–1 lessons
- ✅ Calendar sync banner moved outside upcoming section so it always shows
- ✅ Inline SVG icons throughout (no emojis)

**What was built (Instructor — `public/instructor/index.html`):**
- ✅ Compact greeting (`Hi, {first name}`)
- ✅ **Next Lesson hero card** — same orange gradient style, shows countdown ("In 45m"), learner name, pickup address, phone. Right side shows today's lesson count stat bubble
- ✅ Empty state with "Add a Lesson" CTA
- ✅ **Quick Access Pills** — Learners (blue), Earnings (green), Availability (purple), Q&A (orange), Profile (grey)
- ✅ **Colour Action Cards** — Add Lesson (orange), Set Availability (purple), View Earnings (green)
- ✅ Glance stats row moved below new section
- ✅ Print CSS updated to exclude new elements

**Key decisions:**
- Reused existing API data (`BOOKINGS_DATA.upcoming[0]` for learner, `bookingCache` for instructor) — no new endpoints
- Pills are "browse" shortcuts; action cards are primary CTAs — separates discovery from doing
- Hidden scrollbar on pill row for clean mobile swipe
- Action cards collapse to horizontal scroll only below 340px (not 380px, so standard iPhone widths get the grid)

### 2.45 — Learner Weekly Availability + Waiting List ✅ Complete (1 April 2026)

Two companion features: learners declare their typical free times, and a waitlist notifies them when matching slots open via cancellation.

**What was built:**
- ✅ `learner_availability` table — mirrors `instructor_availability` (day_of_week + time range), max 14 windows per learner
- ✅ `waitlist` table — optional day/time prefs, instructor, lesson type; status lifecycle (active → notified → booked/expired), 14-day auto-expiry
- ✅ `api/learner.js` — `my-availability` + `set-availability` actions (delete-and-insert, 30-min boundaries)
- ✅ `api/waitlist.js` — `join`, `my-waitlist`, `leave` actions + `checkWaitlistOnCancel()` internal function
- ✅ `api/slots.js` — cancellation hook: both single and series cancellations trigger waitlist matching (fire-and-forget)
- ✅ Profile page: "My Availability" card (day rows with time chips, add/remove, overlap detection) + "My Waitlist" card (entries with status badges, leave button)
- ✅ Booking page: "Notify me when a slot opens" button on empty state, inline form with day/time/instructor prefs or "match my availability" checkbox
- ✅ Notifications: WhatsApp + email to all matching learners when a slot frees up

**Key decisions:**
- Notify-all approach (not sequential) — existing `uq_instructor_slot` unique index + 10-min Stripe reservation prevents double-booking
- Waitlist matching uses two branches: explicit entry prefs OR learner_availability fallback (via EXISTS subquery)
- Auto-expiry on read (no cron) — stale entries expired in `checkWaitlistOnCancel` and `my-waitlist`
- Max 10 active waitlist entries per learner

---

## Phase 3: Next Up (Prioritised)

### 2.46 — Instructor Profile Enhancement ✅ Complete (1 April 2026)

Extended the instructor profile with qualifications, vehicle, service area, and languages — preparing for multi-school/multi-instructor support.

- **Qualifications & Experience** — ADI grade, pass rate %, years of experience, specialisms chip selector (8 options)
- **Vehicle** — make, model, transmission type (manual/automatic/both), dual controls toggle
- **Service Area** — comma-separated postcodes/areas, stored as JSONB for future geo-search
- **Languages** — comma-separated, JSONB array, defaults to English
- **DB**: 10 new columns on `instructors` table (JSONB arrays for specialisms, service_areas, languages)
- **API**: Extended `profile` GET and `update-profile` POST with validation
- **Files**: `db/migration.sql`, `api/instructor.js`, `public/instructor/profile.html`

---

### 2.47 — Instructor Portal Cleanup ✅ Complete (1 April 2026)

Bug fixes and UI cleanup across the instructor portal.

- **Fix**: Profile page JS parse error — backslash-backtick (`\``) in `loadBookingLinks` was a literal backslash+backtick, not a valid template literal. Replaced with string concatenation. Also extracted specialisms chip builder from nested template literal.
- **Fix**: Earnings page 500 error — `earnings-week` query referenced `instructor_notes` column that was missing from production DB (table created before column was added to schema; `CREATE TABLE IF NOT EXISTS` skipped it). Removed unused column from query and added idempotent `ALTER TABLE`.
- **Fix**: Earnings page "Invalid Date" — Neon returns Postgres date columns as objects, not ISO strings. Added `toDateStr()` normalizer.
- **UI**: Removed redundant fixed header bar (CoachCarter branding + Sign out) from all 6 instructor pages. The sidebar already provides both. This was overlapping page content and blocking summary cards on earnings. Reduced page `margin-top` from 124px to 64px.
- **Files**: All 6 `public/instructor/*.html`, `api/instructor.js`, `db/migration.sql`

---

### 2.48 — Stripe Connect & Weekly Instructor Payouts ✅ Complete (1 April 2026)

Automated instructor payouts via Stripe Connect Express accounts. Learner payments land in the platform account as before, then instructor earnings are transferred every Friday via a Vercel cron job.

- **Stripe Connect Express** — instructors onboard via Stripe's hosted flow (self-service from earnings page or admin-triggered invite email)
- **Weekly cron job** (`api/cron-payouts.js`) — runs every Friday 9am UTC. Finds eligible bookings (completed OR confirmed 3+ days old), calculates instructor share (price × commission_rate), creates Stripe transfers, sends email notifications
- **Safety**: `UNIQUE(booking_id)` constraint on `payout_line_items` prevents double-payment even if cron and manual trigger fire simultaneously
- **Admin controls**: Payouts section in admin portal with connect status table, upcoming estimates, pause/resume toggle per instructor, manual "Process Payouts Now" trigger
- **Platform owner handling**: "Not needed" dismiss button for instructors who own the platform and don't need payouts (clears half-created accounts, hides banner permanently)
- **Webhook**: `account.updated` event auto-marks `stripe_onboarding_complete = TRUE` when instructor finishes Stripe onboarding
- **New files**: `api/connect.js` (6 actions), `api/cron-payouts.js`, `api/_payout-helpers.js`
- **New tables**: `instructor_payouts`, `payout_line_items`
- **New columns**: `instructors.stripe_account_id`, `instructors.stripe_onboarding_complete`, `instructors.payouts_paused`
- **Modified**: `api/instructor.js` (+2 actions), `api/admin.js` (+4 actions), `api/webhook.js`, `vercel.json`, `public/instructor/earnings.html`, `public/admin/portal.html`

### 2.49 — Fixed Weekly Franchise Fee Model ✅ Complete (2 April 2026)

Alternative billing model: instead of taking a percentage commission per lesson, the platform takes a fixed weekly franchise fee (e.g. £50/week or £200/week). The instructor keeps all lesson revenue minus the fee.

- **Two fee models** per instructor, configurable via admin portal dropdown: "Commission (%)" or "Franchise Fee (fixed weekly)"
- **New columns**: `instructors.weekly_franchise_fee_pence` (NULL = commission model), `instructor_payouts.franchise_fee_pence` (audit trail)
- **Payout logic**: franchise fee capped at weekly gross — instructor never goes negative
- **Earnings display**: franchise model shows gross/fee/net breakdown on weekly view; bottom note shows "Franchise fee: £X/week" instead of commission rate
- **Backward compatible**: NULL franchise fee = legacy commission_rate model (no existing behaviour changed)
- **Modified**: `api/_payout-helpers.js`, `api/instructor.js` (4 earnings endpoints), `api/admin.js`, `api/instructors.js`, `public/admin/portal.html`, `public/instructor/earnings.html`, `db/migration.sql`

---

### 3.1 — Push Notifications

PWA push notifications for lesson reminders, quiz nudges, and new message alerts.

### 3.2 — Automated Lesson Reminders

24-hour email/WhatsApp reminder to learner and instructor before each lesson. Needs Vercel cron job.

### 3.3 — Refund Flow

Learner requests cash refund from dashboard, admin approves in portal, Stripe processes reversal.

### 3.4 — Referral System

Unique referral link per learner. Both referrer and new learner receive hours bonus on first purchase.

### 3.5 — Recurring/Repeat Bookings

"Repeat weekly" option when booking — creates multiple bookings in one transaction. Depends on lesson types (Feature 3).

### 3.6 — Per-Service Booking Links

URL parameter support: `/learner/book?type=2hr` pre-selects lesson type. Shareable links for marketing.

### 3.7 — GDPR Full Compliance (3 April 2026)

Full GDPR compliance pass across the entire platform. Addresses cookie consent, data portability, right to erasure, data retention, and audit logging.

**What was built:**
- Cookie consent banner on all 35 HTML pages — PostHog analytics only loads after explicit user consent
- Data export API (`POST /api/learner?action=export-data`) — learners download all personal data as JSON
- User-initiated account deletion (`request-deletion` + `confirm-deletion`) — email-verified cascading delete
- Credit transactions anonymized (not deleted) for 7-year tax retention
- Data retention cron (`api/cron-retention.js`) — weekly, archives inactive learners >3 years, purges after 90 days
- Audit logging (`api/_audit.js`) — tracks admin data mutations (delete, adjust credits, instructor changes)
- Consent recording to DB with hashed IP for audit proof
- `last_activity_at` updates on login and booking for retention policy
- Privacy & Data section in learner profile (export, cookie preferences, delete account)
- Cookie Settings link in sidebar footer and landing page

**Files created:** `public/cookie-consent.js`, `public/posthog-loader.js`, `public/learner/confirm-deletion.html`, `api/cron-retention.js`, `api/_audit.js`
**Files modified:** 35 HTML files, `api/learner.js`, `api/admin.js`, `api/config.js`, `api/magic-link.js`, `api/slots.js`, `db/migration.sql`, `public/sidebar.js`, `public/learner/profile.html`, `vercel.json`
**DB:** 3 new tables (`cookie_consents`, `audit_log`, `deletion_requests`), 5 new columns, FK change on `credit_transactions`

### 3.8 — Database Security & Performance Hardening (3 April 2026)

Security hardening and query performance optimization across the entire platform.

**Security fixes:**
- Fixed SQL injection pattern — replaced dynamic table/column name interpolation with explicit parameterized queries in 3 files
- Added security headers to all responses via middleware.js (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Centralised CORS in middleware.js — restricted from `*` to coachcarter.uk/co.uk domains only, removed per-file CORS from 31 API files
- Rate limiting on magic link sends (5 per email/phone per hour) via `rate_limits` DB table
- Verified Neon SSL (`sslmode=require` + `channel_binding=require`) and connection pooling

**Performance — 28 new indexes:**
- FK indexes on lesson_bookings (learner_id, instructor_id, lesson_type_id), credit_transactions, driving_sessions, skill_ratings, quiz_results, mock_tests, qa_questions/answers, slot_reservations, instructor_learner_notes
- Composite indexes: (school_id, status, scheduled_date), (instructor_id, scheduled_date, start_time), (learner_id, status)
- Partial indexes on magic_link_tokens (email/phone WHERE NOT NULL)
- Medium priority: lesson_confirmations, sent_reminders, lesson_offers, instructor_availability, admin_users

**Also in this session:**
- Replaced JSON data export download with readable "My Data" page (`/learner/my-data.html`) matching privacy/terms page style
- Profile page: Export button replaced with subtle text links (View my data · Cookie preferences · Privacy policy)
- Test data seed endpoint (`/api/seed-test-data`) creating 3 test accounts with realistic data for GDPR flow testing
- Updated privacy policy to platform model (CoachCarter as sole Data Controller for all schools)
- Cookie consent banner added to all 47 HTML pages (11 were missing initially)
- Fixed multiple column name mismatches in export queries (qa_questions, skill_ratings, quiz_results, mock_tests, learner_onboarding)

**Files created:** `api/seed-test-data.js`, `public/learner/my-data.html`
**Files modified:** `middleware.js`, `api/admin.js`, `api/learner.js`, `api/cron-retention.js`, `api/magic-link.js`, `db/migration.sql`, 31 API files (CORS removal), `public/privacy.html`, `public/learner/profile.html`, `CLAUDE.md`
**DB:** 1 new table (`rate_limits`), 28 new indexes, `last_activity_at` DEFAULT NOW()

---

### 3.9 — Dark Mode (4 April 2026)

System-wide dark mode support across all learner, instructor, admin, and public pages.

**How it works:**
- CSS custom properties in `learner.css`, `instructor.css`, and `shared-auth.css` are overridden via `@media (prefers-color-scheme: dark)` and a `.dark-mode` class on `:root`
- Dark palette uses dark greys (#1a1a1a body, #242424 surface, #2e2e2e cards) rather than pure black — matches existing #262626 brand colour
- Orange accent (#f58321) stays the same in both modes
- Manual toggle on learner and instructor profile pages — stored in `localStorage` key `cc_dark_mode` (values: `auto`, `light`, `dark`)
- `public/shared/dark-mode.js` loaded on every page before DOM renders to prevent flash of wrong theme
- Skeleton shimmer uses CSS variables instead of hardcoded greys
- Sidebar, bottom nav, and mobile header all use CSS variables for dark mode compatibility

**What was built:**
- Dark mode CSS variable overrides in `learner.css`, `instructor.css`, `shared-auth.css`
- `public/shared/dark-mode.js` — theme toggle logic, localStorage persistence, system preference detection, theme-color meta tag updates
- Theme selector dropdown in sidebar footer (above Sign Out button), available on every page for both logged-in and logged-out users
- Converted hardcoded colours (#fff, #f9f9f9, #262626, #e0e0e0, #797879) to CSS variables across 27 HTML inline style blocks
- Converted sidebar.js hardcoded colours to CSS variable fallback pattern

**Files created:** `public/shared/dark-mode.js`
**Files modified:** `public/shared/learner.css`, `public/shared/instructor.css`, `public/shared-auth.css`, `public/sidebar.js`, 48 HTML files (dark-mode.js script tag + inline colour variable conversion)

---

## Competitive Differentiators

> All 17 competitor-inspired features (from Total Drive and Setmore analysis) are complete.

| Strength | Detail |
|----------|--------|
| Hours balance + Klarna | Flexible hour packages with bulk discounts |
| Race-condition prevention | 10-minute slot reservation during Stripe checkout |
| DL25 competency framework | 39 sub-skills across 10 categories |
| AI Examiner + Quiz | Neither competitor has anything close |
| WhatsApp notifications | More personal than SMS |
| Multiple availability windows/day | More flexible than one open/close per day |
| Recurring bookings | Weekly series with conflict detection |
| Post-lesson skill self-assessment | Session logging is unique |
| webcal:// subscription feeds | Learner + instructor feeds with VALARM reminders |

### UX Cleanup — Learner Booking & Instructor Portal (4 April 2026)

Major UX declutter across 8 pages, removing 1,123 lines of duplicate navigation, cluttered banners, and orange overload.

**Learner booking page (`book.html`) + buy-credits:**
- Removed old `.site-nav`, `.sub-tabs`, `.bottom-nav` (sidebar.js handles all nav)
- Replaced full upcoming bookings strip with compact "Next lesson" card + "View all" link
- Grouped slot feed by date headers instead of repeating date on every card
- Toned down orange: neutral pills/card hover/banners, accent only on primary CTAs
- Merged lesson type pills + instructor filter into one sticky toolbar row
- Removed redundant "Book a Lesson" title heading and calendar sync banner

**Instructor portal (all 6 pages):**
- Removed old `.site-nav` and `.bottom-nav` from availability, earnings, learners, qa, profile, index
- Removed duplicated `.bottom-nav` CSS from each page's style block

**Instructor dashboard redesign:**
- Created new `/instructor/dashboard.html` — compact no-scroll view of today's lessons
- Shows greeting, inline stats strip ("3 today · 12 this week"), today's lesson list
- Next upcoming lesson highlighted with accent left-border; completed lessons muted
- "Book Lesson" button with learner search modal (reuses create-booking API)
- Removed pill-row, action-cards, orange gradient hero card, calendar sync banner from calendar page
- Calendar page (`/instructor/index.html`) is now pure calendar with sticky toolbar

**Navigation update:**
- Instructor bottom tabs: Dashboard | Calendar | Learners | Earnings | Profile (was: Calendar | Learners | Earnings | Q&A | Profile)
- Q&A moved to sidebar-only (not removed, just deprioritised from bottom tabs)
- Dashboard added as first sidebar item

**Files changed:** `sidebar.js`, `public/instructor/dashboard.html` (new), `public/instructor/index.html`, `public/instructor/availability.html`, `public/instructor/earnings.html`, `public/instructor/learners.html`, `public/instructor/qa.html`, `public/instructor/profile.html`, `public/learner/book.html`, `public/learner/buy-credits.html`

---

## Phase 4: Future Considerations (Not Yet Scoped)

- ~~**T&Cs acceptance on login** — add checkbox to magic link login flow ("I agree to Terms & Privacy Policy"), record acceptance with timestamp in DB. Also update terms.html to platform model language.~~ ✅ Done (2.54)
- **Capacitor native wrapper** — wrap PWA for App Store / Play Store submission
- ~~**Instructor dashboard** — earnings tracking, lesson stats, learner progress overview~~ ✅ Done (2.48)
- **Theory test prep** — built-in revision tools integrated with competency system
- **Multi-instructor scaling** — instructor-specific pricing, rating system (specialisations done in 2.46)
- **Automated progress reports** — weekly email digest with competency changes and recommendations
- **Parent/guardian view** — read-only progress access for parents of younger learners
- **Intensive course packages** — multi-day bundled bookings with special pricing

---

## 2.50 — Setmore Booking Sync (April 2026)

**What:** Ongoing sync from Setmore (third-party booking system) into CoachCarter's built-in booking system. Both systems run in parallel during the transition.

**Built:**
- `api/setmore-sync.js` — cron every 15 min, imports Setmore appointments as real `lesson_bookings`
- OAuth2 auth via `SETMORE_REFRESH_TOKEN` env var
- Auto-creates/matches learner accounts by phone number or email
- Idempotent via `setmore_key` unique index on `lesson_bookings`
- Service mapping strips Setmore's built-in 30-min buffer from lesson durations
- Resolves correct instructor from each appointment's `staff_key`
- 3 new lesson types: 3-Hour Lesson (active), 1-Hour Lesson (inactive), Free Trial (inactive)
- ✅ Cancellation detection — marks bookings as cancelled when Setmore appointments are cancelled or removed
- ✅ `api/setmore-welcome.js` — daily cron sends one-time welcome email with 7-day magic link to Setmore-created learners
- ✅ `api/_travel-time.js` — travel time check between pickup postcodes using OpenRouteService, integrated into booking flow as a warning
- ✅ Pickup address import — pulls address from Setmore customer profile (`address`, `city`, `postal_code`) into `lesson_bookings.pickup_address`, with backfill for existing bookings
- ✅ "Slots hidden" banner on `book.html` — shows learners how many slots were filtered by travel distance
- ✅ Admin `max_travel_minutes` setting — per-instructor travel threshold editable from admin portal instructor form

**Transition plan:** New bookings through CoachCarter, existing Setmore clients migrate gradually, then remove sync.

## 2.51 — Pickup Address & Buy Lesson Types (2 April 2026)

**What:** Improve the travel-time slot filtering UX and give learners a choice of lesson types when purchasing.

**Built:**
- ✅ Pickup postcode prompt on `book.html` — inline input above calendar for learners without a `pickup_address`, saves to profile via existing `update_profile` API, then re-fetches slots with travel filter active. Non-blocking.
- ✅ Learner address backfill in `setmore-sync.js` — step 5d copies the most recent booking's `pickup_address` to `learner_users.pickup_address` when the learner's profile field is empty. Scoped per-instructor, idempotent.
- ✅ Single lesson type cards on `buy-credits.html` — dynamically fetched from `/api/lesson-types`, each card shows name, duration, price, and colour-coded Buy button. "Or save with hour packages" divider separates from bulk discounts.
- ✅ Test Ready Guarantee section temporarily hidden (`display:none`) pending review.

**Files changed:** `public/learner/book.html`, `public/learner/buy-credits.html`, `api/setmore-sync.js`

## 2.52 — "Next Available" Slot Feed (3 April 2026)

**What:** Replace the weekly/monthly/daily time-grid calendar on the booking page with a clean "next available" feed. Learners see only available slots, sorted by date+time — no empty hours or empty days.

**Built:**
- ✅ Slot feed — flat scrollable list of slot cards showing date, time, instructor, lesson type colour. No grid, no timeline.
- ✅ Sticky lesson type pill bar — compact pills below the header (`position: sticky`), always visible while scrolling. Shows type name, duration, price.
- ✅ Progressive loading — 14 days at a time with "Show more slots" button (up to 90 days).
- ✅ Removed ~500 lines of old calendar CSS/JS: 3 renderers (monthly/weekly/daily), view toggle, date navigation arrows, cursor state, drillToDay.
- ✅ Admin adjust-credits fix — transaction log INSERT made best-effort so balance updates succeed even if the log fails.
- ✅ Postcode save fix — corrected action name (`update_profile` → `update-profile`).

**Files changed:** `public/learner/book.html`, `api/admin.js`

## 2.53 — Instructor Blackout Date Ranges (3 April 2026)

**What:** Instructors can now block out a date range (start + end date) instead of adding one day at a time. Ideal for holidays or extended time off.

**Built:**
- ✅ DB migration — added `end_date` column to `instructor_blackout_dates`, backfills existing single-day rows, new composite index
- ✅ API — GET `blackout-dates` returns `start_date` + `end_date`; POST `set-blackout-dates` accepts `{ ranges: [{ start_date, end_date, reason }] }` with overlap + max 365-day validation
- ✅ Slot filtering — range overlap query in `slots.js`, expands ranges into per-day Set entries (slot generation loop unchanged)
- ✅ UI — two date pickers (start/end), end auto-follows start, overlap check on add, ranges display as "Mon 3 Apr – Fri 7 Apr 2026" with day count badge

**Files changed:** `db/migration.sql`, `api/instructor.js`, `api/slots.js`, `public/instructor/availability.html`

## 2.54 — Terms & Conditions Acceptance (4 April 2026)

**What:** Learners must accept Terms & Conditions and Privacy Policy before accessing the dashboard. Gate appears after magic link login (both email and SMS flows). Also updated terms.html to use platform language consistent with privacy.html.

**Built:**
- ✅ DB — `terms_accepted_at TIMESTAMPTZ` column on `learner_users`
- ✅ API — `POST /api/learner?action=accept-terms` sets timestamp
- ✅ Magic link verify/verify-code responses now include `terms_accepted` boolean
- ✅ Frontend gate — new screen in `login.html` with checkbox ("I agree to the Terms & Conditions and Privacy Policy") shown after successful auth when `terms_accepted` is false. New users always see it after name collection.
- ✅ GDPR — `terms_accepted_at` included in `export-data` response. No deletion cascade change needed (column on `learner_users` which is already deleted).
- ✅ `terms.html` rewritten with platform language — CoachCarter as platform operator, driving schools as service providers. Added "Platform and services" and "Your data and privacy" sections.

**Files changed:** `db/migration.sql`, `api/magic-link.js`, `api/learner.js`, `public/learner/login.html`, `public/terms.html`, `PROJECT.md`

## 2.55 — PWA Enhancement Audit (4 April 2026)

**What:** Comprehensive PWA audit against modern best practices. Used a pwa-enhance skill to detect issues and generate a prioritised roadmap (`PWA_ROADMAP.md`). Implemented 13 of 15 items.

**Built:**
- ✅ Non-blocking Google Fonts — `preload` + `media="print"` swap pattern on all 47 HTML files. Mobile FCP expected to drop from 2.9s → ~1.5s
- ✅ Manifest `id` field — stable app identity decoupled from start_url
- ✅ Manifest `screenshots` — 2 mobile + 1 desktop screenshot for richer Android install UI
- ✅ Manifest `shortcuts` — Book a Lesson, My Progress, Practice Log (long-press quick actions)
- ✅ `overscroll-behavior: none` on body in shared CSS — prevents rubber-banding and pull-to-refresh in standalone mode
- ✅ Content Security Policy header (report-only) in `middleware.js` — covers Stripe, PostHog, fonts, CDNs, Cloudflare Stream
- ✅ Service worker update flow — removed auto-`skipWaiting()`, added `SKIP_WAITING` message pattern + user-facing update banner
- ✅ Cache size limits — max 100 items with `trimCache()`, `navigator.storage.persist()` request
- ✅ `system-ui` font fallback in `--font-head` and `--font-body` CSS variables
- ✅ Install banner + update banner safe-area padding (`env(safe-area-inset-bottom)`)
- ✅ Bottom nav context menu prevention (`-webkit-touch-callout: none` + `contextmenu` event)
- ✅ Skeleton shimmer loading states on dashboard, booking page, and progress page

**Not implemented (documented in PWA_ROADMAP.md):**
- Dark mode (`prefers-color-scheme` + manual toggle) — large cross-file effort, planned for next session
- Background Sync for offline form submissions — low priority for this app's use case

**Lighthouse scores (mobile, pre-change):** Performance 90 | Accessibility 96 | Best Practices 96 | SEO 100

**Files changed:** `public/manifest.json`, `public/sw.js`, `public/pwa.js`, `public/sidebar.js`, `middleware.js`, `public/shared/learner.css`, `public/shared/instructor.css`, `public/learner/index.html`, `public/learner/book.html`, `public/learner/progress.html`, all 47 HTML files (font loading), `public/icons/screenshot-*.png` (new), `PWA_ROADMAP.md` (new)

## 2.56 — Learner Upcoming Lessons Page & Instructor Lesson Detail Modal (4 April 2026)

**What changed:**

1. **Learner upcoming lessons page (`/learner/lessons.html`)** — replaced the redirect-only page with a full lessons view. Shows upcoming and past lessons in tabbed view, grouped by date. Each card displays time, instructor, lesson type with colour accent, duration, and pickup address. Actions: Add to Calendar (ICS download), Reschedule (48hr+ away, max 2 per chain), Cancel (with full 48hr policy modal). Series bookings grouped with "Cancel series" option. Empty state links to booking page.

2. **Instructor dashboard lesson detail modal** — tapping a lesson on the instructor dashboard now opens a detail modal instead of navigating to the calendar. Shows learner name, phone (tel: link), email, pickup/drop-off addresses, lesson type, duration, status, booking notes, and "prefer contact before" flag. Instructor can add notes and mark lessons as complete (past lessons only) or cancel (future lessons). Dashboard auto-refreshes after actions.

**Files changed:** `public/learner/lessons.html`, `public/instructor/dashboard.html`

## 2.57 — Running Late Notification (4 April 2026)

**What changed:**

1. **Running late button on instructor dashboard** — new "Running Late" button in the dashboard header alongside "+ Book Lesson". Opens a modal with preset delay options (10/15/20/30 min) and a custom input field. Shows how many learners will be notified. Button is disabled when there are no upcoming lessons today, auto-updates as lessons are completed or cancelled.

2. **Running late API action (`POST /api/instructor?action=running-late`)** — accepts `{ delay_minutes }`, queries today's remaining confirmed bookings where start_time is after the current time, sends WhatsApp (Twilio) and email to each learner with a personalised message including the lesson time and delay estimate. Returns `{ ok, notified }` count.

**Files changed:** `api/instructor.js`, `public/instructor/dashboard.html`

## 2.58 — Unauthenticated Booking Page Enhancements (5 April 2026)

**What changed:**

1. **Instructor filter and lesson type pills for unauthenticated users** — the booking page now loads the instructor dropdown and lesson type pill bar for visitors who aren't logged in. Previously these only loaded after authentication, leaving guests with an empty "All instructors" dropdown.

2. **Instructor-specific booking links (`?instructor=X`)** — booking page accepts an `instructor` URL parameter to pre-filter slots to a single instructor. Combined with `?type=` for full control (e.g. `?instructor=4&type=standard`). Instructor profile page now shows a "Your booking page" link at the top of the Booking Links section with per-lesson-type variants that include the instructor ID.

**Files changed:** `public/learner/book.html`, `public/instructor/profile.html`

---

## 2.59 — Guest Checkout (5 April 2026)

**What changed:**

1. **Guest booking without account** — learners can now book and pay for lessons without creating an account first. When an unauthenticated user clicks a slot, the booking modal shows guest fields (name, email, phone, pickup address, terms checkbox) instead of requiring login. The API creates the learner account immediately before Stripe payment so the existing webhook handler works unchanged.

2. **New API action (`POST /api/slots?action=checkout-slot-guest`)** — unauthenticated endpoint that validates guest fields, finds-or-creates a learner account by email (backfills empty fields on existing accounts), reserves the slot with the real learner_id, and creates a Stripe Checkout session. Rate limited: 10 per IP per hour + 5 per phone per hour.

3. **Modal scroll fix** — added `max-height` and `overflow-y: auto` to the booking modal so the guest form doesn't push buttons off-screen on mobile viewports.

**Files changed:** `api/slots.js`, `public/learner/book.html`

---

## 2.60 — Inline Profile Completion in Booking Modal (6 April 2026)

**What changed:**

1. **Profile fields in booking modal** — logged-in users who haven't set their phone number or pickup address now see those fields inline in the booking modal instead of being blocked with a "go update your profile" error. Details are saved to their profile automatically before the booking proceeds. Only missing fields are shown — if they already have a phone number, only pickup address appears.

**Files changed:** `public/learner/book.html`

---

## 2.61 — Sub-Tab Navigation for Mobile Sections (6 April 2026)

**What changed:**

1. **Sub-tab pill bar** — pages within sidebar groups (Lessons, Practice, Learn) now show a horizontal pill bar below the mobile header for navigating between sub-pages. Previously users had to open the hamburger sidebar to switch between e.g. Book / Buy Credits / Upcoming within the Lessons section. Built into `sidebar.js` and auto-generated from the existing nav config.

2. **Videos removed from Learn navigation** — Videos page hidden from sidebar and bottom tab. Learn tab now defaults to Examiner AI. Page code retained for future re-enablement.

**Files changed:** `public/sidebar.js`

---

## 2.62 — Bug Fixes: Instructor Cancel, Lesson Types Admin, Sidebar (6 April 2026)

**What changed:**

1. **Instructor cancel-booking fix** — the refund query used non-existent `credits` column instead of `credit_balance`, causing every instructor cancellation to fail with a 500 error. Now correctly returns `balance_minutes` and `credit_balance`, sets `credit_returned` and `cancelled_at` on the booking, and fetches `minutes_deducted` to return the correct amount.

2. **Admin lesson types fix** — lesson types section used undefined lowercase `token` instead of the admin portal's `HEADERS` constant. Load, save, and toggle lesson type actions were all broken.

3. **Sidebar sub-tabs fix** — `buildSubTabsHTML` referenced undefined `sections` variable instead of `navItems`. `preselectedTypeSlug` moved to module scope so `loadLessonTypes` can access it from the unauthenticated code path.

**Files changed:** `api/instructor.js`, `public/admin/portal.html`, `public/sidebar.js`, `public/learner/book.html`

---

## 2.63 — Admin Management of Instructor Blackout Dates (6 April 2026)

**What changed:**

1. **Admin blackout dates UI** — the Availability section of the admin portal now includes a "Blackout Dates" sub-section below the availability grid. When an instructor is selected, their blackout dates load automatically. Admins can add date ranges with optional reasons, remove individual blackouts, and save. Same validation as the instructor portal (no overlaps, max 365-day range).

2. **New admin API actions** — `GET /api/admin?action=instructor-blackouts&instructor_id=X` returns future blackout dates. `POST /api/admin?action=set-instructor-blackouts` with `{ instructor_id, ranges }` replaces all future blackout dates. Both use admin JWT auth.

**Files changed:** `api/admin.js`, `public/admin/portal.html`

---

## Technical Notes

- **Stack:** Vanilla HTML/JS frontend, Vercel serverless functions (Node.js), Neon (PostgreSQL), Stripe, JWT auth, Resend + Nodemailer for email
- **Hosting:** Vercel Pro (upgraded to support >12 serverless functions)
- **Payments:** Stripe (Klarna enabled via Stripe dashboard — not hardcoded). Stripe Connect Express for instructor payouts (weekly Friday cron)
- **Calendar:** Custom-built, no third-party calendar dependency
- **Lesson types:** Configurable via `lesson_types` table + admin portal. Standard (90min/£82.50), 2-Hour (120min/£110), 3-Hour (165min/£165, active), 1-Hour (60min, inactive), Free Trial (60min, inactive). Do NOT add CHECK constraints on booking duration — multiple durations must coexist.
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
- **Shared code:** Auth helpers in `api/_auth-helpers.js`, mail utilities in `api/_shared.js`, error alerts in `api/_error-alert.js`, payout logic in `api/_payout-helpers.js`
- **Shared frontend:** CSS in `public/shared/learner.css` + `instructor.css`, auth JS in `public/shared/learner-auth.js` + `instructor-auth.js`
- **Error alerting:** Email alerts on 500 errors via `api/_error-alert.js` (requires `ERROR_ALERT_EMAIL` env var)
- **Setmore sync:** Ongoing import from Setmore booking system via REST API. Cron every 15 min (`api/setmore-sync.js`). Imports as real `lesson_bookings` with `created_by='setmore_sync'`. Pulls pickup addresses from customer profiles. Idempotent via `setmore_key`. Both systems run in parallel during transition.
- **InstructorBook product split (April 2026):** Strategic plan to launch InstructorBook (instructorbook.co.uk) as a national SaaS for driving instructors, separate from CoachCarter's learner-facing brand. Same codebase, two front doors. CoachCarter becomes school #1 in the InstructorBook network. See `INSTRUCTORBOOK-PLAN.md` for full strategy, pricing model, competitive analysis, and marketplace phasing.
