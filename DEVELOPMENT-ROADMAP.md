# Coach Carter — Website Development Roadmap

## Overview

This document tracks the development of the **Coach Carter driving school platform** — a comprehensive web application for booking lessons, processing payments, tracking learner competency, and providing AI-powered learning tools. The platform includes a learner portal, instructor portal, admin portal, Stripe-integrated payments (with Klarna), a DL25-aligned 17-skill competency framework, AI chat features powered by Claude, and full Progressive Web App (PWA) support for installable, offline-capable access.

---

## 2.102 — Repeat Offer BCS Attribution for Fully Booked Series (26 May 2026)

PR #220 shipped BCS attribution for paid, non-flexible, slot-pinned repeat offer series when every requested repeat week is successfully booked. The webhook now splits the single `slot_purchase` credit transaction across all booked lessons using the existing BCS booking-plan helper.

**Contract:**
- Scope is intentionally limited to paid, non-flexible, slot-pinned repeat offer series where every requested repeat week books successfully.
- The allocation preserves exact conservation of minutes, contribution pence, and Stripe fee pence.
- Retry/idempotency is guarded by `ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING`.
- Partial repeat offers remain intentionally outside this slice and need a later CSA-aware implementation.

**Deploy note:** PR #220 "Attribute BCS for fully booked repeat offers" merged and deployed on 2026-05-26. Focused local `npm.cmd test -- tests/bcs-fifo.spec.js tests/bcs-booking-plan.spec.js tests/webhook-offer-bcs.spec.js` passed: 26 passed.

**Post-deploy prod note:** read-only `cron-credit-reconcile` ran at 2026-05-26T16:48:34.705Z and returned clean: `ok=true`, `schema_mode=full`, `has_bcs=true`, `has_bcs_school_id=true`, `has_csa=true`, `has_grandfathered_at=true`, `pairs_scanned=30`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, empty missing-BCS and drift summaries, and both truncation flags false. No prod writes other than the read-only cron trigger, migrations, payout crons, Neon/prod integration tests, live Stripe calls, Stripe mutations, goodwill grants, reconciliation grants, or UI apply/grant paths were run.

**Files:** `api/webhook.js`, `tests/bcs-booking-plan.spec.js`, `tests/webhook-offer-bcs.spec.js`.

---

## 2.101 — Step 5.5 Admin Credit Reconciliation Backend Writer (26 May 2026)

Backend-only follow-up to the Step 5.5 reconciliation inspection slices. `POST /api/admin?action=credit-reconciliation` now has a mutating backend path for reconciling a missed Stripe credit-purchase webhook, while the admin UI remains inspection-only with no apply/grant button.

**Contract:**
- Dry-run/inspection requests (`dry_run: true` or `mode: 'inspect'`) remain non-mutating and return `inspection_only: true` plus `credit_granted: false`.
- Mutating mode requires a non-empty `reason`.
- The writer runs Stripe/DB inspection and `buildReconciliationGrantInput()` before any mutation.
- The credit grant uses the shared serialized credit mutation path / LCB lock path (`lockBalanceAndMutate()`), creating a reconciliation `admin_add` ledger row with all Stripe identities carried from inspection.
- Audit action: `admin.credit_reconciliation`.
- Duplicate Stripe identity races are handled by re-inspection instead of retrying a grant.

**Deploy note:** PR #218 merged and deployed on 2026-05-26. Blocker fixes in pushed commit `48ebc07` reject refunded latest/resolved Stripe Charges via `charge.amount_refunded > 0` while keeping the PaymentIntent-level guard, and verify learner/instructor school scope before `lockBalanceAndMutate()`. Full local `npm.cmd test` after fixes passed: 193 passed / 169 skipped.

**Post-deploy prod note:** read-only `cron-credit-reconcile` ran at 2026-05-26T09:47:19.119Z and returned clean: `pairs_scanned=30`, `drift_count=0`, `missing_bcs_count=0`, `grandfathered_count=0`, `alert_sent=false`, empty missing-BCS and drift summaries. No real-payment reconciliation grants, goodwill grants, UI apply/grant path, migrations, payout crons, Neon/prod integration tests, live Stripe calls, or Stripe mutations were run.

**Files:** `api/admin.js`, `api/_admin-credit-reconciliation.js`, `api/_admin-credit-reconciliation-stripe.js`, `api/_credit-grant.js`, `tests/admin-credit-reconciliation-*.spec.js`, `tests/admin-credit-contract.spec.js`.

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

### 2.22 — Q&A System ❌ Removed (April 2026 — originally shipped March 2026)

Learner/instructor Q&A forum was built in March 2026 but saw zero real-world use
(only a single test question ever submitted). Entire feature stripped in April 2026:

- Deleted pages: `public/learner/qa.html`, `public/learner/qa.js`, `public/instructor/qa.html`, `public/instructor/qa.js`
- Deleted API handlers: `qa-list`, `qa-detail`, `qa-ask`, `qa-reply` in both `learner.js` and `instructor.js`
- Deleted standalone file: `api/qa-digest.js` + its vercel.json cron entry
- Dropped tables: `qa_questions`, `qa_answers` (via `DROP TABLE IF EXISTS` in `db/migration.sql`)
- Removed Q&A from GDPR export, deletion cascade, retention cron, and seed-test-data
- Nav references stripped from `sidebar.js`, `log-session.html`, `videos.html`
- Historical schema preserved in `db/migrations/014_qa_system.sql` for reference

Do not re-add — if a learner Q&A feature is wanted later, spec it fresh rather than reviving this.

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

### 2.54 — Instructor Calendar Tidy ✅ Complete (11 April 2026)

Removed "Weekdays" and "Cancelled" filter buttons from the instructor calendar toolbar (both inline and overflow menu). Weekends are always shown (was the default), cancelled lessons are always hidden (was the default). No behaviour change — just fewer buttons.

- **Modified**: `public/instructor/index.html`, `public/instructor/index.js`

---

### 2.55 — Weekly Availability as Cancellation-Notify Primitive ✅ Complete (7 May 2026)

Retired the waitlist. Weekly availability (`learner_availability`) is now the single primitive for "ping me when something opens up" — learners no longer need to opt into a separate waitlist entry. When a booking is cancelled, every learner whose availability window covers the freed slot gets an immediate WhatsApp + email notification.

The instructor's "My Learners" page now shows each learner's weekly free times as chips so the instructor can see at a glance who's flexible.

Conceptual model: weekly availability is durable ("I'm typically free Mon 4–6pm"); waitlists were the *active* layer ("I want a lesson in the next 14 days"). With cancellations as the only real trigger, the active layer was pure ceremony — setting availability already captured everything we needed.

Follow-up landed in PR 2a (see entry below).

- **Added**: `api/_notify-availability.js` (exports `notifyAvailableLearners()`); free-times chip row + endpoint extension in `api/instructor.js?action=my-learners`.
- **Removed**: `api/waitlist.js`; `waitlist` table (via `db/migration.sql` `DROP TABLE IF EXISTS waitlist CASCADE`); "My Waitlist" card on `public/learner/profile.html`; orphaned waitlist join form in `public/learner/book.js` + CSS in `public/learner/book.html`; GDPR-cascade and seed-test-data references.
- **Modified**: `api/slots.js` (both single + series cancel paths now call `notifyAvailableLearners()`); `public/instructor/learners.html` + `learners.js` (chip rendering); `CLAUDE.md`, `PROJECT.md`, `MIGRATION-PLAN.md`.

---

### 2.57 — Broadcast Offers, Instructor-Triggered (PR 2b) ✅ Complete (8 May 2026)

Builds on PR 2a's broadcast-offer plumbing by exposing it to the instructor as a manual lever. Three additions:

1. **Profile toggle** for `broadcast_offers_enabled` so the auto-cancellation flow PR 2a built can actually be turned on without poking the DB. Sits in a new "Last-minute broadcasts" card on `/instructor/profile.html`. Default off.

2. **Manual broadcast picker** on the existing "Offer a lesson" modal. New "Send to" radio: *One specific learner* (existing behaviour, unchanged) or *All learners free at this time* (new). When broadcast is selected, the picker fetches the matching audience via `?action=preview-broadcast-audience`, shows a checkbox list with all learners ticked by default, and lets the instructor untick anyone they don't want to message. Soft warning at >10 selected ("Twilio cost approx £X"). On send, posts to `?action=create-broadcast-offer` which mints a `kind='broadcast', trigger='instructor_manual'` batch.

3. **Pending-broadcast dashboard card** on `/instructor/dashboard.html` showing every active batch (slot date/time, recipient count, trigger source, discount) with a one-click "Close offer" button. Closing fires `?action=close-broadcast-offer` which cancels all pending siblings via the existing `supersedeBroadcastSiblings()` helper, sends "no longer available" follow-up, and frees the slot back up on the calendar.

The existing 1:1 "Offer a lesson" path (instructor → specific learner) is untouched — same modal, same fields, same result. The radio defaults to that mode so muscle memory works.

- **Schema**: none. Re-uses everything PR 2a shipped.
- **Added** (`api/instructor.js`): four new actions — `preview-broadcast-audience` (GET), `create-broadcast-offer` (POST), `close-broadcast-offer` (POST), `my-broadcast-batches` (GET). Plus `broadcast_offers_enabled` plumbed through `handleProfile` and `handleUpdateProfile`.
- **Added** (`public/instructor/index.html` + `index.js`): audience-radio + broadcast pane in the offer modal; `loadBroadcastAudience()`, `updateAudienceSummary()`, `sendBroadcastOffer()`. Lesson-type / date / time changes reload the audience list.
- **Added** (`public/instructor/dashboard.html` + `dashboard.js`): `#dashBroadcasts` card; `loadBroadcasts()`, `closeBroadcastBatch()`. Card auto-hides when there are no pending batches.
- **Added** (`public/instructor/profile.js`): "Last-minute broadcasts" card with the opt-in toggle, wired into the existing `update-profile` POST.
- **Modified**: `CLAUDE.md`, `PROJECT.md`, `MIGRATION-PLAN.md`.

---

### 2.56 — Broadcast Offers, Cancellation-Triggered (PR 2a) ✅ Complete (8 May 2026)

Extended the existing `lesson_offers` system to support 1-slot-to-many-learners "broadcast" offers. When a booking is cancelled <48h before lesson start *and* the instructor has opted in, the system mints one offer per matching learner (same `batch_id`, individual `token` each) at 25% off the lesson type's price. First learner to accept wins; siblings get marked `'superseded'` and receive a "no longer available" follow-up message.

The accept page (`/accept-offer.html`) detects `kind='broadcast'` and swaps copy: shows a "We've had a last-minute cancellation" banner, race-aware framing ("first come, first served — book quickly to secure it"), and a "Book this slot" button instead of "Accept & pay". The existing 1:1 manual offer flow ("Offer a lesson" button on the instructor's learner detail page) is unchanged — new offers default to `kind='manual'`.

The unique index `uq_offer_slot` was replaced with `uq_offer_slot_manual` (partial: `WHERE kind = 'manual'`) so manual offers keep their per-slot uniqueness while broadcasts can have many pending rows for the same slot.

Sibling supersession is centralised in `api/_notify-availability.js::supersedeBroadcastSiblings()` and called from three booking paths: the Stripe offer-acceptance webhook, `slots.js?action=book` (credit-based), and `webhook.js::handleSlotBooking()` (guest checkout). Fire-and-forget and idempotent.

Follow-up planned in PR 2b: instructor-triggered manual broadcasts (instructor picks a slot + audience from a multi-select picker). Same primitives, different trigger.

- **Schema** (`db/migration.sql`): added `lesson_offers.kind` (`'manual'` | `'broadcast'`), `batch_id` (UUID), `trigger` (`'cancellation'` | `'instructor_manual'`); added `'superseded'` to status CHECK; replaced `uq_offer_slot` with partial-on-manual variant; added two new indexes; added `instructors.broadcast_offers_enabled BOOLEAN DEFAULT FALSE`.
- **Modified**: `api/_notify-availability.js` (split into plain + broadcast paths, exported new `supersedeBroadcastSiblings()`); `api/slots.js` (passes `lesson_type_id` to notify; calls supersede after credit booking); `api/webhook.js` (calls supersede after offer-accept and after guest-checkout slot booking); `api/offers.js` (returns `kind`/`trigger` from `get-offer`, distinguishes `SUPERSEDED` from generic NOT_FOUND); `public/accept-offer.html` + `accept-offer.js` (race-aware banner + button copy).
- **Docs**: `CLAUDE.md` (broadcast-offers rules), `PROJECT.md`, `MIGRATION-PLAN.md`.

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

### 2.62 — Remove Daily View, Agenda as Default ✅ Complete (9 April 2026)

**What was built:**
- Removed the Daily tab from the instructor calendar toolbar — it was functionally redundant with agenda (both showed a compact lesson list)
- Agenda is now the default view on calendar load
- Agenda renders from today by default; scrolls today's date header into view automatically as a "today anchor"
- Weekly view day-label click now jumps to agenda (was daily) — clicking a day in weekly shows agenda from that date
- Monthly drill-down (`drillToDay`) also routes to agenda
- Agenda date-header onclick removed (was drilling to daily)
- Swipe gesture restricted to weekly only (was daily+weekly)
- `navPrev`/`navNext` else branch simplified to agenda (14-day steps)
- Availability re-render after save now calls `renderCurrentView()` instead of `renderDaily()`

**Files changed:** `public/instructor/index.html`, `CLAUDE.md`

---

### 2.63 — Post-Checkout Credit Verification Fallback ✅ Complete (11 April 2026)

**What:** Safety net for when Stripe webhooks fail silently. After checkout redirect, the frontend calls `GET /api/credits?action=verify&session_id=X`. The endpoint retrieves the Stripe session, confirms payment succeeded, and grants credits idempotently (using `stripe_session_id` uniqueness). The learner dashboard now shows a success toast on return from checkout.

**Key details:**
- Idempotent via `stripe_session_id` — safe to call even if webhook already processed
- Double-checks: payment_status, payment_type metadata, learner_id match, school_id match
- Success URL now includes `{CHECKOUT_SESSION_ID}` Stripe template variable
- Frontend cleans URL params immediately, fires verify call in background

**Files changed:** `api/credits.js`, `public/learner/index.html`

### 2.64 — Admin Edit Learner Details ✅ Complete (12 April 2026)

**What:** Admins can now edit a learner's name, email, phone, and pickup address from the admin portal. Follows the `update-instructor` pattern with full audit logging (before/after values).

**Key details:**
- Email and phone uniqueness enforced per school
- Audit log captures before/after values for every field
- Existing learner JWT sessions unaffected (auth is ID-based, not email-based)
- No rate limiting needed (no emails/SMS sent)

**Files changed:** `api/admin.js`

---

### 2.65a — Fix Klarna async_payment_succeeded handling ✅ Complete (8 May 2026)

**What:** Klarna purchases were silently dropping confirmation emails because the webhook only listened for `checkout.session.completed`. Stripe fires that event early for Klarna with `payment_status='unpaid'`, then a follow-up `checkout.session.async_payment_succeeded` once the payment clears. We weren't subscribed to the second event and the first one shouldn't have run any handler logic anyway.

**Diagnosis:** Reconciliation cron (entry 2.89) caught the silent drops — paid Klarna sessions kept showing up in the "missing webhook processing" alert email despite `cron-reconcile-payments` running hourly. Tracing it back: card payments worked because `completed` already had `payment_status='paid'`; Klarna stayed `unpaid` until `async_payment_succeeded`.

**Fix:**
- `api/webhook.js` dispatcher routes both `checkout.session.completed` and `checkout.session.async_payment_succeeded` to the same handler chain
- New `isPaid(session)` guard at the top of all four payment handlers (`handleCreditPurchase`, `handleSlotBooking`, `handleOfferBooking`, plus pass-guarantee path) — no-ops when `payment_status !== 'paid'`, so the early `completed` event for Klarna does nothing and the `async_payment_succeeded` event drives all writes
- New tiny handler for `checkout.session.async_payment_failed` that logs via `reportError` so payment failures show up in the alert email rather than being invisible

**Manual step (one-time, in Stripe Dashboard):** add `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` to the webhook endpoint's subscribed events. Without this Stripe still won't deliver them no matter what the code does.

**Files changed:** `api/webhook.js`

---

### 2.65 — 12-Week Booking Cap + Offer-Driven Recurring Series ✅ Complete (8 May 2026)

**What:** Tightened the global advance booking window from 90 days to 84 days (12 weeks) for self-serve learner bookings, and gave instructors a way to offer a regular weekly slot that legitimately runs past the cap.

**Two changes that work together:**

1. **Hard 12-week cap** — `MAX_DAYS_AHEAD` in `api/slots.js` lowered from 90 → 84. Frontend `FEED_MAX_DAYS` in `public/learner/book.js` matched. New `create-offer` validation rejects offer dates more than 84 days out.

2. **Weekly-repeat offers** — when an instructor sends a one-to-one "Offer a slot", they now see a "Weekly repeats (optional)" select with options 1–18. If they pick > 1, the learner sees a "How many weekly lessons?" select on the accept page. The chosen count multiplies the Stripe charge (per-lesson price × N).

**Skip-clash fan-out:** the webhook (`api/offers.js bookOfferSeries()`, called from `api/webhook.js handleOfferBooking`) walks weekly from the offer's start date, booking the slot whenever it's free. If a week is clashed (existing non-cancelled booking, blackout, or instructor not available that day-of-week), it skips and rolls to the next free week at the same time. Bounded to a 18-week lookahead from the original date so a 6-lesson series can't drag on forever. If we hit the boundary without filling all weeks, Stripe is partially refunded for the unused weeks.

**Why offers can exceed the cap:** the 12-week cap is for *self-serve* bookings. An instructor who explicitly sets `max_repeat_weeks` is opting in to offer this learner a regular slot — their schedule, their call. The series creation in the webhook is the only path that may insert bookings past 84 days from today.

**Schema:** `lesson_offers.max_repeat_weeks INTEGER NULL` with `CHECK (BETWEEN 1 AND 18)`. Null/1 = single lesson (existing behaviour).

**Files changed:** `db/migration.sql`, `api/slots.js`, `api/instructor.js` (handleCreateOffer), `api/offers.js` (bookOfferSeries helper, handleAcceptOffer, handleFreeOffer), `api/webhook.js` (handleOfferBooking), `public/instructor/index.html` + `index.js` (offer modal), `public/accept-offer.html` + `accept-offer.js` (repeat-weeks picker), `public/learner/book.js`.

---

### 2.66 — Payout Shortfall Tracking + £250 Vehicle Deposit Deduction ✅ Complete (10 May 2026)

**What:** Negative-payout weeks no longer silently disappear — the gap is recorded as a shortfall on the payout row and rolls forward to the next positive payout. Full-Franchise instructors automatically get £250 deducted from week-1 (vehicle deposit per agreement clause 5.5). Both visible to the instructor on `/instructor/earnings.html` so there are no surprise conversations.

**Why:** Pre-signing-day prep for instructor #2 (franchise plan items 1.3 + 2.10, bundled — same file, same migration, same statement-email surface). Today's `_payout-helpers.js` did `Math.min(franchiseFee, totalGrossPence)` which truncated the negative — the £85 / £140 just disappeared. The 12-week earnings projection (`docs/franchise/sample-earnings-projection.md`) surfaced that £250 deposit means £0 net to instructor in week 1 of every scenario, so the deposit code had to be in place by Start Date, not month 3.

**Schema:** Three new columns on `instructor_payouts`:
- `shortfall_pence INTEGER NOT NULL DEFAULT 0` — positive = amount instructor owes CCL from this period.
- `shortfall_recovered_from_payout_id INTEGER REFERENCES instructor_payouts(id)` — NULL until cleared by a later payout.
- `deposit_deducted_pence INTEGER NOT NULL DEFAULT 0` — week-1 Full-Franchise deposit, partial-amount tolerant.
- Partial index `idx_instructor_payouts_unrecovered_shortfall` on `(instructor_id, period_end) WHERE status='completed' AND shortfall_pence > 0 AND shortfall_recovered_from_payout_id IS NULL` — drives the lookup query and the running-balance banner.

**Recovery model:** Full-or-nothing. If the next positive payout can cover the prior shortfall in full, it does and the prior row is marked recovered. Otherwise the prior shortfall rolls forward unchanged (no partial recovery — deliberately simpler; revisit only if multi-week complex partial-recovery becomes a real pattern).

**Failure safety:** The prior shortfall is marked recovered ONLY after the Stripe transfer succeeds. On transfer failure, line items are deleted (so bookings retry next run) and the prior shortfall stays unrecovered. The SELECT for prior shortfalls also filters `status='completed'` so a failed-and-rolled-back row can't masquerade as a settled debt.

**Zero-payout case:** When the entire gross is consumed by fee + deposit + prior shortfall, `totalInstructorPence` is 0 and Stripe is skipped (it rejects amount=0). The payout row is still marked `completed` and any recovery applied — the statement email is reframed as "Weekly Statement" instead of "Payout Sent".

**Full-Franchise detection:** Heuristic on `weekly_franchise_fee_pence === 19500` (£195) until Phase 1 ships `franchise_tier_id`. Comment in helper marks the swap-out point.

**Files changed:** `db/migration.sql` (3 columns + partial index), `api/_payout-helpers.js` (prior-shortfall read, week-1 + Full-Franchise detection, branched maths for positive vs zero-payout, recovery UPDATE inside try block, refactored return shape via `buildResult` helper), `api/cron-payouts.js` (statement email body now adds deposit / recovery / shortfall lines, reframes header on £0 weeks), `api/instructor.js` (`handlePayoutHistory` exposes new columns + computes `outstanding_shortfall_pence`), `public/instructor/earnings.html` (CSS for `.payout-detail` + `.outstanding-banner`), `public/instructor/earnings.js` (per-row deposit/shortfall/recovery sub-rows + top-of-list outstanding banner).

---

### 2.67 — Overflow Lead Routing on book.html ✅ Complete (10 May 2026)

**What:** When a learner picks a specific instructor on `book.html` and that instructor has zero bookable slots across the full 12-week window, the empty state is replaced with a heading ("No slots with [FirstName] in the next 12 weeks.") + subhead ("Slots with our other instructors:") + a slot feed showing alternatives from the school's other active instructors. Clicking an alternative opens the booking modal with that instructor; the dropdown filter stays on the originally-chosen instructor.

**Why:** Pre-signing-day prep for instructor #2 (franchise plan item 1.2). Platform-side delivery of the Lead Floor commitment (agreement clause 4.4). Without this, a learner who picks instructor #2 in their sparse first weeks sees "No slots available" and leaves CCL's funnel.

**Trigger conditions** (all must hold; the original empty state renders otherwise):
1. A specific instructor is selected via `instructorFilter`.
2. That instructor has zero slots across the full 84-day window (`FEED_MAX_DAYS`). Triggering on shorter windows would falsely surface alternatives for instructors who book ahead.
3. The school has more than one active instructor (otherwise overflow has nothing to show).

**API:** None changed. The existing `?action=available` endpoint already returns slots from all active instructors when `instructor_id` is omitted. Lesson-type, postcode and travel-time filters continue to apply.

**Eager full-window fetch:** When a specific instructor is chosen, `initFeed` fetches the full 84 days up front (rather than the usual 14-day chunk). This is required to know whether the instructor is *truly* empty before deciding overflow has fired — chunked load could falsely declare empty after only chunk 1. Side benefit: when the learner picks one specific instructor, showing all 84 days of their diary at once is a better UX than chunked load-more clicks. The "load more" button is hidden for chosen-instructor mode.

**Alternatives caching:** The alternatives result (all-instructor query) is cached in `overflowCache` keyed by `${ltId}|${postcode}` so toggling the dropdown back to the same chosen-empty-instructor doesn't re-fetch. Invalidated on lesson-type or postcode change via `onFilterChange`.

**Travel-hidden banner:** The alternatives fetch passes `skipTravelBanner: true` so it doesn't overwrite the chosen-instructor banner state. The chosen-instructor fetch (which runs first) sets the banner correctly.

**Out of scope (separate plan items):** geographic instructor-coverage filtering (H9.6, deferred), "jump to next available slot" button when chosen instructor has slots-but-far-out (2.11), direct booking from instructor profile page (3.9), dropdown-switch on alternative-slot click (explicitly rejected during design).

**Files changed:** `public/learner/book.js` (3 module-level overflow state vars; `onFilterChange` resets them; `fetchFeedSlots` now accepts `targetCache`/`omitInstructor`/`skipTravelBanner`/`skipRangeDedup` opts; `initFeed` does the eager 84-day fetch + alternatives query when needed; `renderFeed` has a new top branch for overflow that renders heading + subhead + the shared `buildSlotFeedHtml` helper, plus a tweaked empty-state for the alternatives-also-empty case; slot-card markup factored into `buildSlotFeedHtml` to share between branches), `public/learner/book.html` (CSS for `.overflow-section` / `.overflow-heading` / `.overflow-subhead`).

---

### 2.68 — Booking-Status 3-State Restructure ✅ Complete (15 May 2026)

**What:** Collapsed `lesson_bookings.status` from seven states (`confirmed`, `awaiting_confirmation`, `completed`, `no_show`, `disputed`, `cancelled`, `rescheduled`) to three: `scheduled`, `chargeable`, `refunded`. Deleted the entire dual-confirmation email flow that was meant to resolve "did the lesson happen?" disputes — in practice it fired on every lesson and had near-zero useful signal.

**Load-bearing principle (now explicit in CLAUDE.md):** the instructor is paid for every lesson on their calendar unless the learner gave 48h+ notice that it wouldn't happen. Late-cancel under 48h now sets `lesson_bookings.credit_forfeited = TRUE` and leaves the booking `scheduled`; the hourly cron then flips it to `chargeable` at `end_time + 1 hour` so the instructor is still paid. No more "did you turn up?" prompt.

**State semantics:**
- `scheduled` — live, not yet resolved. Blocks slot. Instructor not yet paid.
- `chargeable` — past lesson, instructor will be paid. Blocks slot (historical-overlap detection).
- `refunded` — killed booking, credit returned to learner. Does not block slot. Terminal.

**Why:** the seven-state model was carrying machinery (`lesson_confirmations` table, `_confirmation-resolver.js`, prompt-confirmations + auto-confirm crons, admin `resolve-dispute` endpoint, learner-side `confirm-lesson.html`) for a behaviour Fraser never used. The new model is closer to how he actually runs the business — payout follows the calendar, not a confirmation step.

**Single source of truth:** `api/_booking-status.js` exports `SCHEDULED`/`CHARGEABLE`/`REFUNDED` constants, `BLOCKING_STATUSES` / `PAYABLE_STATUSES` sets, and `isLive` / `isChargeable` / `blocksSlot` / `isTerminal` predicates. Per CLAUDE.md, backend code must import these — no inline string literals on `lesson_bookings.status`. Frontend display code may read the strings directly (untrusted display data).

**Payout filter rewrite:** `api/_payout-helpers.js` `getEligibleBookings` and `getEligibleSchoolBookings` now filter on `lb.status = 'chargeable'` only. The previous two-branch `completed OR (confirmed AND ≥3-day grace)` is gone — the new model's 1-hour buffer on `scheduled → chargeable` already absorbs clock skew and last-minute reschedule races, and there is no confirmation step to stall. Risk window: a Thursday-evening lesson is flipped to `chargeable` at the 20:30 cron run, leaving ~12 hours for admin to manually flip to `refunded` before the Friday 09:00 UTC payout cron picks it up. Documented in `docs/booking-statuses.md`.

**Migration:**
```sql
ALTER TABLE lesson_bookings DROP CONSTRAINT lesson_bookings_status_check;

UPDATE lesson_bookings SET status = CASE status
  WHEN 'confirmed'             THEN 'scheduled'
  WHEN 'awaiting_confirmation' THEN 'scheduled'
  WHEN 'completed'             THEN 'chargeable'
  WHEN 'no_show'               THEN 'chargeable'
  WHEN 'disputed'              THEN 'chargeable'
  WHEN 'cancelled'             THEN 'refunded'
  WHEN 'rescheduled'           THEN 'refunded'
END;

ALTER TABLE lesson_bookings ADD CONSTRAINT lesson_bookings_status_check
  CHECK (status IN ('scheduled', 'chargeable', 'refunded'));

ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE;
```

**Files changed (PR #125, six commits):**
1. `api/_booking-status.js` (new), `docs/booking-statuses.md` (new), `CLAUDE.md` (load-bearing principle + status-string rule).
2. `db/migration.sql` — state collapse + CHECK constraint + `credit_forfeited` column.
3. Backend rename across every file that read/wrote `lesson_bookings.status`. Deleted: `api/_confirmation-resolver.js`, `public/learner/confirm-lesson.html` + `.js`, `learner.js` confirm handlers, `instructor.js handleComplete` + `handleConfirmLesson`, `admin.js handleResolveDispute`, `reminders.js handlePromptConfirmations` + `handleAutoConfirm`, two `vercel.json` cron entries.
4. `api/cron-auto-complete.js` rewritten as the hourly `scheduled → chargeable` flip with the 1-hour buffer.
5. `api/_payout-helpers.js` — payout filter swapped to `status = 'chargeable'` (3-day grace removed).
6. `tests/booking-status.spec.js` (new constants/predicate contract test); `PROJECT.md`, `DEVELOPMENT-ROADMAP.md`, `MIGRATION-PLAN.md` doc updates.

**Out of scope (deliberately deferred):**
- Drop `lesson_confirmations` table (kept dormant for one release cycle as rollback safety — follow-up migration ~2 weeks later).
- DB-seeded Playwright E2E for the late-cancel → cron-flip → chargeable flow (current suite has no DB fixture; tracked as a separate task).
- `payouts_start_date` floor on `getEligibleSchoolBookings` (the instructor-side floor exists; the school-side asymmetry is a separate concern).

**Refs:** `BOOKING-STATUS-RESTRUCTURE-PLAN.md`, [`docs/booking-statuses.md`](docs/booking-statuses.md), PR #125.

---

### 2.69 — Stripe-Fee Pass-Through (Step 4f) ✅ Complete (16 May 2026)

**What:** Instructors now absorb the Stripe processing fee on each payment they receive, rather than the platform silently eating it from the commingled balance. Schema captures the fee at webhook time (`credit_transactions.stripe_fee_pence`, `lesson_bookings.stripe_fee_pence`) and the Friday payout cron subtracts it per booking (`payout_line_items.stripe_fee_pence`, `instructor_payouts.stripe_fees_pence`).

**Maths (locked-in Decision 1):**
- **Franchise model:** `payout = (gross − stripe_fees) − franchise_fee − deposit − prior_shortfall`. Stripe fees come off totalGross BEFORE the deductions math runs — never enter the carry-forward shortfall ledger.
- **Commission model:** `payout = (gross × commission_rate) − stripe_fees`. Commission on gross, fees deducted from instructor share.

**Pro-rata attribution (offer series):** one N-week charge → N bookings. Per-booking share = `floor(totalFee / repeatWeeks)`, remainder onto LAST booked lesson. Unbooked-weeks share when clashes hit lookahead is orphan fee → platform absorbs (Decision 3: Stripe kept its cut on the partial refund, Sept 2022 policy).

**Reschedule:** new booking inherits old booking's `stripe_fee_pence` + source. Old booking flips to REFUNDED so no double-attribution.

**PRs:** #134 (4f.a schema + 4f.b webhook capture), #135 (4f.d cron deduction), #136 (4f.c writer onto lesson_bookings).

**Weekly summary email** (this PR): platform owner receives a Friday-evening digest after each payout cron with gross / Stripe fees deducted / payout sent + per-instructor breakdown + NULL-fee tracker for the rollout window. Recipient: `coachcarteruk@gmail.com`. Lives at `api/_payout-email.js`.

**Out of scope (deferred):**
- Step 4f.c for credit-funded bookings (`?action=book` + flexible offers) — requires Step 4g's `booking_credit_sources` for cross-source pro-rata.
- Step 4f.e — daily reconcile cron that backfills NULL fees from Stripe API.
- Step 4f.f — instructor earnings UI 4-line breakdown.
- Step 4f.g — admin orphan-fee watchlist widget.
- Step 4f.h — historical backfill script.

Until 4g lands, credit-funded bookings keep `lesson_bookings.stripe_fee_pence = NULL` → cron treats as zero → platform absorbs. Acceptable interim since current traffic is mostly guest-checkout via `handleSlotBooking` (covered).

**Refs:** `INSTRUCTOR-PAYMENTS-PLAN.md` Step 4f, `memory/project_stripe_fee_passthrough.md`.

---

### 2.70 — Widget Falsifiability Alert Layer ✅ Complete (17 May 2026)

**What:** Daily snapshot of the Next Payout Preview widget (#143) plus two email triggers that fire when the widget is silently lying. The widget is a passive gauge of "would Friday's cron succeed?"; without an alert layer, a green dashboard could hide a real failure or a slow bleed of the platform float.

**Triggers:**
- **A — Failure despite green.** Wired into `_payout-helpers.js processPayoutForInstructor` failure branch. After a Stripe transfer for a payout fails (`stripe.transfers.create` rejects), look back at the last 24h of `platform_balance_snapshots`. If the most recent one reported `status='green'`, send `🚨 Payout #N failed despite green widget` to `ERROR_ALERT_EMAIL` with the snapshot id, captured timestamp, the snapshot's `balance_after_payout_pence`, and the Stripe error.
- **B — Aggregate bias.** Wired into the snapshot cron itself. After writing the daily row, compare trailing-30d Stripe inflow vs trailing-30d payout outflow. If outflow exceeds inflow by more than £100, send `⚠️ Trailing 30d payouts exceed Stripe inflow by £X` with both totals and the last 5 completed payouts driving the gap. The floor exists to suppress noise on quiet weeks; tune in a follow-up PR if it fires spuriously once meaningful outflow accrues.

**Schema:** `platform_balance_snapshots` — captures `status`, all four widget pence totals, `payout_preview_json`, and the two trailing-30d aggregates. Index on `captured_at DESC` for the 24h lookup.

**Cron:** `api/cron-balance-snapshot.js`, daily at `0 8 * * *` UTC. Reuses the widget's compute logic via the new shared `api/_platform-balance.js` (`handlePlatformBalance` in `api/admin.js` was refactored down to a thin wrapper at the same time — both surfaces now produce identical numbers by construction).

**Helpers:** `api/_error-alert.js` gained `sendAlertEmail({subject, html, text})` for non-error operational alerts. The two triggers share that helper.

**Validation:** `scripts/validate-widget-alert-layer.mjs` is the read-only assertion harness — runs `computePlatformBalance`, both trailing-30d queries, and the Trigger-A snapshot lookup query against the configured DB. `scripts/validate-alert-email-builders.mjs` exercises the email-build paths (with `ERROR_ALERT_EMAIL` unset to prevent real sends) to confirm templates don't throw on apostrophes / £-formatting / Stripe error strings.

**Why now:** Step 0 (PR #132) flipped the platform Stripe schedule to Manual on 2026-05-15, and Step 4f.d (#135 + #136) reshaped the Friday cron's payout math. The first cron under the new regime fires 2026-05-22. The alert layer goes live the week before so any production-only failure mode is caught immediately.

**Bundled fix — refund_exposure filter.** The widget's `refund_exposure_pence` advisory had been silently reading £0 in prod since v2 (#142) because the SQL filtered `credit_transactions.payment_method = 'stripe'`, but the webhook (`api/webhook.js` line 143) writes `session.payment_method_types?.[0] || 'card'` — never the literal `'stripe'`. Filter changed to `stripe_session_id IS NOT NULL` (intent-based, captures every Stripe-originated row regardless of which card/wallet type Stripe reports). Verified read-only against prod: the new filter returns £1,451.40 where the old filter returned £0.00. The trailing-30d-inflow query in `cron-balance-snapshot.js` was written with the same intent-based filter from the start, so no further work was needed there.

**Files:** `db/migration.sql` (new table + index), `vercel.json` (new cron schedule), `api/cron-balance-snapshot.js` (new), `api/_platform-balance.js` (new shared compute + refund_exposure filter fix), `api/admin.js` (refactor to use shared helper), `api/_payout-helpers.js` (Trigger A wiring), `api/_error-alert.js` (sendAlertEmail helper).

**Refs:** `memory/project_next_session_priority.md` (locked-in plan), `memory/project_credit_funded_default.md` (the bias Trigger B exists to surface).

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

## 2.64 — Booking Flow Audit & Instructor Booking Actions (6 April 2026)

**What changed:**

1. **Booking flow audit** — comprehensive code-level UX review of the end-to-end booking flow, resulting in `BOOKING-FLOW-AUDIT.md` with 24 items across P0–P3 priorities. 20 items implemented across 4 sprints.

2. **Shared instructor booking actions** — new `public/shared/instructor-booking-actions.js` module providing cancel, reschedule, and add-lesson modals used across instructor dashboard and calendar pages. Includes real-time conflict checking during reschedule.

3. **Various UX improvements** — auto-refresh fix, blackout save pattern, toast CSS, pre-lesson notes, styled modals replacing alert()/confirm(), default time inputs, guest validation, touch targets, retry buttons, reschedule count display, mobile toolbar overflow.

**Files changed:** `public/shared/instructor-booking-actions.js` (new), `api/admin.js`, `api/instructor.js`, `api/slots.js`, `public/admin/portal.html`, `public/instructor/*.html`, `public/learner/book.html`, `public/learner/buy-credits.html`, `public/learner/lessons.html`, `public/sidebar.js`

---

## 2.65 — Reschedule & Blackout Bug Fixes (7 April 2026)

**What changed:**

1. **Reschedule 500 fix** — the `lesson_bookings` status CHECK constraint didn't include `'rescheduled'`, causing every reschedule attempt to fail with a DB constraint violation. Added `'rescheduled'` to the CHECK constraint.

2. **Missing school_id in reschedule/create-booking INSERTs** — both learner and instructor reschedule handlers, plus instructor create-booking, were missing `school_id` in their INSERT statements. Added explicit `school_id` from JWT payload. Also improved unique constraint error detection with PostgreSQL error code `23505` fallback.

3. **Learner reschedule flow broken** — `book.html` never read the `?reschedule=BOOKING_ID` URL param from `lessons.html`, so reschedule mode was never activated. Now fetches booking details, pre-selects the instructor filter, and activates reschedule mode with the confirmation modal.

4. **Blackout date fallback** — the blackout query in slot generation silently failed if the `end_date` column was missing. Added fallback to single-date query with warning log.

5. **Calendar wording** — renamed "Subscribe"/"Sync" calendar buttons to "Auto-update your calendar" across learner booking page, dashboard, and demo page.

**Files changed:** `api/slots.js`, `api/instructor.js`, `db/migration.sql`, `public/learner/book.html`, `public/learner/index.html`, `public/demo/book.html`

---

## 2.66 — Launch Readiness Audit & Multi-tenant Fixes (7 April 2026)

**What changed:**

1. **Launch readiness audit** — ran a comprehensive 9-phase code-level audit covering security, accessibility, GDPR, SEO, performance, infrastructure, code quality, broken links, and data isolation. Overall score: 72% with 4 launch blockers (all LB-7: missing school_id filtering). Full report saved as `LAUNCH-AUDIT-REPORT.md`.

2. **Multi-tenant data isolation fixes (launch blockers):**
   - `api/instructors.js` — added `school_id` filter to public list endpoint, switched admin actions (create/update/set-availability) from local `verifyAdmin()` to centralised `requireAuth()`/`getSchoolId()` from `_auth.js`. Instructors are now scoped to their school.
   - `api/waitlist.js` — replaced local `verifyAuth()` with `requireAuth()` from `_auth.js`, added `school_id` filtering to all waitlist queries (join, my-waitlist, leave).
   - `api/qa-digest.js` — restructured from "send all questions to all instructors" to per-school processing. Questions grouped by `school_id`, each school's instructors only receive their own school's unanswered questions.
   - `api/reminders.js` — added cross-table `school_id` consistency JOINs (`lu.school_id = lb.school_id`, `i.school_id = lb.school_id`) to send-due, daily-schedule, and prompt-confirmations cron actions. Prevents cross-tenant data in reminder emails. Daily schedule now JOINs `schools` table for future branding use.

3. **Cookie consent school_id** — `api/config.js` record-consent action now includes `school_id` in the `cookie_consents` INSERT.

4. **CORS cleanup** — removed dead per-file CORS stubs from `api/availability.js`, `api/create-checkout-session.js`, `api/instructors.js`, `api/waitlist.js`, `api/reminders.js` (CORS handled centrally by `middleware.js`).

5. **SEO & infrastructure** — created `public/robots.txt` (blocks admin/portal/api paths), `public/sitemap.xml` (public-facing pages), and branded `public/404.html` error page.

**Files changed:** `api/instructors.js`, `api/waitlist.js`, `api/qa-digest.js`, `api/reminders.js`, `api/config.js`, `api/availability.js`, `api/create-checkout-session.js`, `public/robots.txt` (new), `public/sitemap.xml` (new), `public/404.html` (new), `LAUNCH-AUDIT-REPORT.md` (new), `.launch-audit-config.json` (new)

---

## 2.67 — Launch Audit Blocker Fixes (8 April 2026)

**What changed:**

1. **Security blockers (LB-3):** Added `requireAuth()` to `api/create-checkout-session.js` (learner/admin roles) and `api/availability.js` GET handler (admin only). These were unauthenticated endpoints handling sensitive data.

2. **Data isolation blockers (LB-7) — ~40 SQL queries fixed:** Added `school_id` filtering across `api/slots.js` (bookings, reservations, offers, blackouts, external events, learner/instructor lookups, getLessonType), `api/instructor.js` (Q&A queries, learner history, create booking, schedule range), `api/learner.js` (update-name, update-profile, contact-pref, unlogged-bookings, pending-confirmations, qa-ask INSERT), `api/admin.js` (booking/session subqueries in all-learners, learner-detail, adjust-credits INSERT, all-instructors), `api/enquiries.js` (all handlers — new `school_id` column added to table), `api/magic-link.js` (new learner INSERT now includes `school_id` from token).

3. **DB migrations:** Added `school_id` column (DEFAULT 1) + index to `enquiries` and `magic_link_tokens` tables.

4. **Error exposure cleanup:** Replaced all ~50 instances of `details: err.message` with `details: 'Internal server error'` across every API file. Server-side `console.error(err)` retained for logging.

5. **Auth migration:** Migrated local `verifyAuth()`/`verifyAdmin()` in `api/address-lookup.js`, `api/update-status.js`, `api/videos.js`, `api/credits.js`, `api/enquiries.js` to use centralised `requireAuth()` from `api/_auth.js`. Removed dead `setCors()` stubs from these files plus `api/slots.js`.

6. **Rate limiting:** Added rate limiting to `api/enquiries.js` submit action (5 per IP per hour), matching the pattern from `magic-link.js`.

7. **SEO/perf quick wins:** Compressed `FraserDiag.JPG` (5.4MB) to `FraserDiag.webp` (200KB). Fixed OG domain from `coachcarter.co.uk` to `coachcarter.uk` in `coachcarter-landing.html` and `lessons.html`. Added `loading="lazy"` to below-fold testimonial images. Darkened `--muted` colour from `#797879` to `#595959` for WCAG 4.5:1 contrast ratio.

8. **Privacy policy update:** Added Anthropic (Claude AI), postcodes.io, and OpenRouteService to "Who we share your data with" section in `public/privacy.html`.

**Files changed:** `api/create-checkout-session.js`, `api/availability.js`, `api/slots.js`, `api/instructor.js`, `api/learner.js`, `api/admin.js`, `api/enquiries.js`, `api/magic-link.js`, `api/address-lookup.js`, `api/update-status.js`, `api/videos.js`, `api/credits.js`, `api/advisor.js`, `api/config.js`, `api/cron-retention.js`, `api/instructors.js`, `api/migrate.js`, `api/offers.js`, `api/reviews.js`, `api/seed-test-data.js`, `api/verify-session.js`, `db/migration.sql`, `public/coachcarter-landing.html`, `public/lessons.html`, `public/privacy.html`, `public/FraserDiag.webp` (new)

---

## 2.68 — Remove Stale Video Links from Learner Portal (8 April 2026)

**What changed:**

Videos were removed from sidebar.js navigation in 2.64 (commit `89cb4fd`), but 6 learner pages still had hardcoded inline nav referencing `/classroom.html` and `/learner/videos.html`. These pre-dated the `sidebar.js` overhaul and were never cleaned up.

Removed video links from:
- `learner/index.html` — dropdown menu "Free Videos" link and quick-access pill row "Videos" pill
- `learner/confirm-lesson.html` — site-nav "Free Videos" link
- `learner/log-session.html` — dropdown "Free Videos" link and bottom-nav "Videos" tab
- `learner/login.html` — site-nav "Videos" link
- `learner/qa.html` — bottom-nav "Videos" tab
- `learner/videos.html` — dropdown "Free Videos" link and bottom-nav "Videos" tab (page itself retained for future re-enablement)

Zero video references now remain in `/learner/`. The public `/classroom.html` page and its landing page links are unaffected — those are marketing-facing, not part of the learner portal nav.

**Files changed:** `public/learner/index.html`, `public/learner/confirm-lesson.html`, `public/learner/log-session.html`, `public/learner/login.html`, `public/learner/qa.html`, `public/learner/videos.html`

---

## 2.69 — Fix Setmore Sync Duration Fallback for Unrecognised Services (8 April 2026)

**What changed:**

When a Setmore appointment's `service_key` wasn't in the hardcoded `SERVICE_MAP`, the sync fell back to the raw Setmore slot duration (which includes a 30-min buffer) and defaulted the lesson type to 'standard'. This caused e.g. 2hr lessons to import as 3-hour "Standard Lesson" bookings.

Added `inferFromDuration()` fallback that subtracts the Setmore buffer and infers the correct lesson type slug from the resulting real duration. Unrecognised service keys are now logged via `console.warn` for monitoring.

**Files changed:** `api/setmore-sync.js`

---

## 2.70 — Sort Upcoming Bookings Soonest-First (8 April 2026)

**What changed:**

The admin `all-bookings` API endpoint sorted results `DESC` (furthest-away first). The admin dashboard's "Upcoming Lessons" section filters to future bookings and takes the first 10, so it was displaying the 10 furthest-away bookings instead of the 10 soonest. Changed sort order to `ASC` so upcoming bookings display soonest-first.

**Files changed:** `api/admin.js`

---

## 2.71 — Redesign Instructor Daily Calendar as Lesson List (8 April 2026)

**What changed:**

The instructor daily calendar view showed a full time-grid with every hour slot from early morning to evening, most of which were empty rows. Replaced with a compact lesson-list layout that only shows booked lessons — matching the style of the existing agenda and weekly views. All booking card content preserved (learner name, email, phone, pickup/dropoff addresses, action buttons, status badges, notes, feedback). Empty days show a clean message with availability windows if set.

**Files changed:** `public/instructor/index.html`

---

## 2.72 — Per-Learner Custom Hourly Rate (8 April 2026)

**What changed:**

Instructors can now set a custom hourly rate per learner from the learner detail page (My Learners → tap learner → "Custom hourly rate" field). The rate scales to all lesson lengths (e.g. £50/hr = £75 for 90 min, £100 for 2 hours). Leave blank to use the standard school rate. The custom rate applies everywhere: booking page prices, Stripe checkout, earnings view, and payout calculations.

**Files changed:** `db/migration.sql`, `api/instructor.js`, `api/slots.js`, `api/lesson-types.js`, `api/_payout-helpers.js`, `public/instructor/learners.html`, `public/learner/book.html`

---

## 2.73 — Clean Booking URLs & Dashboard Link (8 April 2026)

**What changed:**

Instructor booking links now use friendly URLs: `coachcarter.uk/book/fraser` instead of `/learner/book.html?instructor=4`. Slugs are auto-generated from instructor first names and stored in the `instructors.slug` column. The instructor profile page generates clean URLs for sharing. The booking link is also now surfaced on the instructor dashboard as a compact bar with a "Copy link" button, making it easy to share without navigating to Profile. Old `?instructor=ID` URLs still work as a fallback.

**Files changed:** `db/migration.sql`, `api/instructors.js`, `api/instructor.js`, `vercel.json`, `public/learner/book.html`, `public/instructor/profile.html`, `public/instructor/dashboard.html`

---

## 2.74 — Lesson Type Chooser on Booking Links (9 April 2026)

**What changed:**

When a learner arrives via an instructor's clean booking link (e.g. `/book/fraser`) without a `?type=` param, they now see a "Choose your lesson length" prompt with lesson type pills instead of auto-selecting Standard Lesson. Slots only load after they pick a type. Also fixed variable scoping bugs (`preselectedInstructorSlug` and `preselectedTypeId` were declared inside `init()` but referenced by `loadLessonTypes()`). Fixed dark mode readability for active lesson type pills and buy-credits cards (replaced literal CSS `white` with `var(--white)` in `color-mix()`). Fixed toast notification element peeking above viewport bottom on desktop across 12 pages.

**Files changed:** `public/learner/book.html`, `public/learner/buy-credits.html`, `public/learner/lessons.html`, plus 9 other pages for toast fix

---

## 2.75 — Edit Booking (Date, Time & Lesson Type) (9 April 2026)

**What changed:**

Instructors and admins can now edit a confirmed booking's date, start time, and lesson type directly via an "Edit" button in the booking detail modal (instructor calendar) or bookings table (admin portal). This is an in-place UPDATE (not reschedule) designed for correcting Setmore import data.

Key features:
- Credit/balance adjustment when lesson type changes (charge extra or refund difference)
- Slot conflict check with override — conflicts show learner name, time, and estimated travel time between pickups; instructor can force-save
- Learner email notification toggle (default: on, uncheck for data cleanup)
- Cancel notification toggle added to the cancel modal too
- Setmore sync protection: edited bookings have `edited_at` set; sync skips them
- Payout protection: blocks lesson type changes on already-paid-out bookings
- Inactive lesson types (e.g. 1-Hour) available in the edit dropdown for legacy corrections
- Audit logging on admin edits
- Travel time indicators between consecutive bookings on daily and agenda calendar views
- One-off migration cleanup deletes Setmore re-imported duplicates

**Files changed:** `db/migration.sql`, `api/instructor.js`, `api/admin.js`, `api/lesson-types.js`, `api/setmore-sync.js`, `public/instructor/index.html`, `public/admin/portal.html`

---

## 2.76 — Flexible Offers End-to-End (11 April 2026)

**What changed:**

Flexible lesson offers (where the instructor doesn't pin a date/time) now work end-to-end across all three acceptance paths:

- **Paid flexible**: Stripe checkout → `offer-success.html?flexible=1` now shows "Payment received!" with a "Book your lesson →" button linking to the slot feed, instead of the misleading "Lesson confirmed!" message. Date/time rows are hidden since the learner hasn't picked a slot yet.
- **Free flexible**: Previously just marked the offer as accepted and redirected to `/learner/book.html` without creating a learner account or adding credits. Now properly creates/finds the learner, adds 1 credit + balance_minutes, sends a confirmation email, and redirects to the success page.
- **Free slot-pinned**: Unchanged (already worked — creates booking directly).

The `offer-success.js` page now reads the `?flexible=1` URL param and adapts its title, subtitle, detail card, info box, and CTA accordingly. If the offer details can't be fetched (webhook still processing), it falls back to a generic flexible success message.

**Files changed:** `api/offers.js`, `public/offer-success.html`, `public/offer-success.js`, `PROJECT.md`

---

## 2.76 — Post-Audit Tenant Isolation Hardening (10 April 2026)

**What changed:**

Re-ran the launch-readiness audit against the current `main` branch after commits `079959b` and `6f2f51a` landed. The previous 2026-04-07 audit report was stale — 4 of its 4 LB-7 launch blockers were already fixed in those commits. Generated a fresh `LAUNCH-AUDIT-REPORT.md`. Overall score moved from 72% to 76%, and the verdict changed from "BLOCKED — 4 launch blockers" to "Launch with Known Issues (conditional)." Data Isolation category score: 43% → 63%. SEO: 60% → 75%. Accessibility: 35% → 42%.

Then applied four targeted low-effort hardening fixes flagged by the fresh audit:

- **`api/address-lookup.js`** — added missing `reportError()` call in the catch block so postcode lookup failures surface in the error alert pipeline. (Only `api/status.js` now lacks one, and that is intentional — it is a sync env-var read with no failure path.)
- **`api/waitlist.js` `handleLeave`** — now verifies `school_id` alongside `learner_id` on the UPDATE, closing a theoretical ID-guess hole where a learner could cancel another school's waitlist entry if they knew the ID. Uses `getSchoolId()` from `_auth.js`.
- **`api/calendar.js` `handleDownload`** — enforces `AND lb.school_id = ${user.school_id || 1}` from the JWT on the single-booking `.ics` download query (defence-in-depth).
- **`api/calendar.js` `handleInstructorFeed`** — now fetches `i.school_id` from the `calendar_token` lookup and enforces it on the bookings query.
- **`api/reminders.js` `handleDailySchedule`** — added explicit `AND lb.school_id = ${inst.school_id}` to the per-instructor tomorrow-bookings query, matching the CLAUDE.md "every query filters by school_id" convention.
- **`api/reminders.js` `handleSendDue` and `handlePromptConfirmations`** — documented in comments why JOIN-based tenant fencing (`lu.school_id = lb.school_id`, `i.school_id = lb.school_id`) is the correct pattern for these cross-school crons rather than a top-level `WHERE` clause. Also projected `lb.school_id` into the SELECT list so downstream handlers have explicit tenant context.

**One conditional launch blocker remains (not fixed in this session):**

The `availability_submissions` table (`db/migration.sql:385`) has no `school_id` column at all, and the admin GET in `api/availability.js:19-31` returns all submissions without a tenant filter. For **CoachCarter-only launch** this is not a blocker (shared lead pool is by design). For **InstructorBook multi-school launch** this is a launch blocker — must be fixed before any second school goes live: add `school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)`, populate on POST from subdomain/query param, filter on the admin GET.

**Recommended follow-up (not yet done):**

1. Accessibility FAILs before public launch — add `<label>` elements to unlabelled form inputs, replace `outline: none` with visible focus styles, add `role="button"` to interactive divs. EAA 2025 legal requirement.
2. CI lint — 20-line script that greps every SQL tagged template in `api/` for `school_id` presence, fails the build otherwise. Prevents LB-7-class regressions permanently.
3. Smoke test the hardening in production — download a calendar `.ics`, join and leave a waitlist entry.
4. Review GitHub Dependabot moderate vulnerability flagged on push (one dependency bump).

**Files changed:** `api/address-lookup.js`, `api/waitlist.js`, `api/calendar.js`, `api/reminders.js`, `LAUNCH-AUDIT-REPORT.md`, `.launch-audit-config.json`

---

## 2.77 — Fix Stripe Checkout for SMS-Only Learners (10 April 2026)

**What changed:**

Three checkout endpoints (`api/credits.js`, `api/advisor.js`, `api/slots.js`) were passing `user.email` (or `learner.email`) directly to Stripe's `customer_email` field without validation. Because magic-link login supports both email and SMS, SMS-only learners have no email on their account. Stripe rejects blank/invalid emails with an opaque HTTP 500 "Invalid email address:" error, which was showing up in production as failed credit purchases and failed pay-per-slot bookings. Error alert emails at 2026-04-10 08:19 confirmed one learner hit this three times in a row.

**Fix applied:**

Each endpoint now checks the email with a simple regex before building the Stripe session. If valid, it's included as `customer_email` (fast pre-fill UX). If missing or invalid, the `customer_email` field is omitted and Stripe's hosted checkout collects the email from the learner on the payment page. The `metadata.learner_email` field is similarly blanked when the source email is invalid, which the webhook already handles via its `metadata.learner_email || session.customer_email` fallback (`api/webhook.js:107`).

No frontend or profile-page changes required — SMS-only learners can now complete checkout without needing to add an email to their account first, and email learners still get the pre-filled checkout UX.

**Also noted during investigation:**

The learner profile page (`public/learner/profile.html`) has no email-edit field at all. If a future feature needs learners to add/change their email, that would need to be built. For the immediate Stripe bug this is not required.

**Files changed:** `api/credits.js`, `api/advisor.js`, `api/slots.js`

---

## 2.78 — Flexible Offers Schema (11 April 2026)

**What:** Database schema changes to support flexible lesson offers where the learner picks their own slot, instead of the instructor pinning a specific date/time. Also adds custom pricing — instructor sets an exact price in pence rather than choosing from rigid discount tiers.

**Schema changes:**
- `lesson_offers.scheduled_date` — made nullable (NULL for flexible offers, set for slot-pinned offers)
- `lesson_offers.start_time` — made nullable
- `lesson_offers.end_time` — made nullable
- `lesson_offers.offer_price_pence` — new INTEGER column, nullable. When set, this is the exact price the learner pays. When NULL, falls back to `discount_pct` calculation (backward compat).
- `uq_offer_slot` unique index — replaced with partial index that only applies when `scheduled_date IS NOT NULL`, so flexible offers (no date) don't conflict.

**Backward compatible:** Existing slot-pinned offers continue to work unchanged. The app doesn't use the new nullable/price fields yet — this is the schema foundation for the flexible offers feature.

**Files changed:** `db/migration.sql`, `PROJECT.md`

---

## 2.79 — Fix Setmore Sync Timezone Duplication & Neon Retry (11 April 2026)

**What changed:**

Three bugs in `api/setmore-sync.js` caused lessons to be duplicated 1 hour ahead after BST started (29 March 2026), and a 3am Neon cold-start error went unrecovered:

1. **Timezone double-conversion (root cause of duplicates):** `toLondon()` treated all Setmore timestamps as UTC and converted to Europe/London. Setmore actually returns times in the account's local timezone (already BST) without a `Z` suffix. During GMT this was invisible (UTC=London), but during BST it added +1 hour. Replaced `toLondon()` with `parseSetmoreTime()` that treats bare timestamps as already-local, only converting via `Intl` when an explicit timezone indicator is present.

2. **Cancellation detection guard (amplified duplicates):** When the Setmore API returned 0 appointments (transient error), `activeSetmoreKeys` was empty, causing **every** existing confirmed setmore booking to be cancelled as "Removed from Setmore". The next successful sync re-imported them all with the +1h timezone shift. Added a guard: cancellation detection is skipped when `activeSetmoreKeys.size === 0`.

3. **Neon transient retry:** The 500 error at 3am was `NeonDbError` with `"neon:retryable": true` — a cold-start control plane blip. Added a single retry for `NeonDbError` to prevent these from failing the entire sync.

**Files changed:** `api/setmore-sync.js`, `docs/setmore-sync.md`

---

## 2.80 — Learner Referral System (13 April 2026)

> **Superseded by 2.91 (27 April 2026):** the purchase-time flat reward described below was replaced with per-lesson recurring rewards (`floor(duration/3)` minutes per completed paid lesson) issued by `cron-referral-rewards.js`. Share URL format also changed to `/r/CODE`. Welcome bonus, code generation, and signup attribution from this entry are unchanged.

**What:** Each learner gets a unique referral code (format: FIRSTNAME-XXXX). New learners can enter a code at signup via URL param (`?ref=CODE`) or manual text input. The referred learner gets configurable welcome bonus minutes, and every future credit purchase by a referred learner earns the referrer a flat reward. Feature is gated behind `schools.config.referral_enabled`.

**Schema changes:**
- New `referrals` table (learner_id, school_id, code, unique per school)
- New `learner_users.referred_by` column (FK to learner_users, ON DELETE SET NULL)
- New `magic_link_tokens.referral_code` column (carries code through signup flow)
- New `credit_transactions` types: `referral_bonus` (welcome credit), `referral_reward` (referrer reward)

**schools.config keys:** `referral_enabled` (boolean), `referral_welcome_bonus_minutes` (int, default 90), `referral_reward_minutes` (int, default 30)

**API actions added:**
- `GET /api/learner?action=referral-code` — returns code + share URL (auto-generates on first call)
- `GET /api/learner?action=referral-stats` — total referred, reward minutes, recent referrals
- `GET /api/admin?action=referral-activity` — aggregated referral stats per school

**GDPR:** Referral data included in data export. Deletion cascade nullifies `referred_by`, deletes `referrals` row. Credit transactions with referral types anonymized (7-year retention). Cron retention updated.

**Email notifications:** Referrer notified when their code is used and when they earn rewards.

**Files changed:** `db/migration.sql`, `api/magic-link.js`, `api/credits.js`, `api/learner.js`, `api/admin.js`, `api/cron-retention.js`, `public/learner/login.html`, `public/learner/login.js`, `public/learner/index.html`, `public/learner/index.js`, `PROJECT.md`

---

## 2.81 — Instructor Offered Lesson Types (22 April 2026)

Instructors can now control which lesson lengths appear on their public booking page.

**What changed:**
- New `offered_lesson_types` JSONB column on `instructors` (NULL = all types, array of slugs = explicit list)
- Instructor profile page "Lesson Types & Booking Links" card: toggle each lesson length on/off, copy shareable link per type
- Booking page lesson type pills filtered to only show what the instructor offers when arriving via `/book/:slug` or with instructor filter set
- Guest learners also get filtered lesson types (previously only authed learners passed `instructor_id` to the lesson-types API)

**Files changed:** `db/migration.sql`, `api/instructor.js`, `api/lesson-types.js`, `public/instructor/profile.js`, `public/learner/book.js`

---

## 2.94 — Auto-scroll to free-trial details form on slot click (28 April 2026)

QoL fix on `/free-trial.html`. Before: picking a slot tinted it green but left the learner scrolled at the slot picker, with the "Your details" form below the fold and the only CTA out of view — common cause of drop-off. After: `selectSlot()` smooth-scrolls `#step-2-heading` into view so the form lands at the top of the viewport with the submit button visible.

Considered the alternative of collapsing other days, but auto-scroll is simpler, mobile-friendly, and doesn't hide context if the learner wants to glance back at their other options.

**Files changed:** `public/free-trial.js`

---

## 2.93 — Slot-first booking UX (28 April 2026)

Inverts the booking flow so learners pick the **slot first** and the **lesson length second**, instead of the other way around. The lesson-type pill bar at the top of `book.html` is gone; the slot feed now renders at the smallest active duration; clicking a slot opens the modal in a "Checking durations…" state, then populates a `<select>` of every active lesson type with prices (non-fitting durations stay in the dropdown but disabled, with a reason suffix — `travel`, `clash`, `too long`, `short notice`, `not offered`).

**Rationale:** with no live customers yet, the council's "wait for funnel data" objection didn't apply, and the council's other concerns (4× OpenRouteService cost on feed render, irreversible refactor) turned out to be moot — the travel-time check uses cached postcodes.io geocoding + a heuristic (no OpenRouteService on feed at all), and the new endpoint is purely additive so a revert is one boolean flip away. Setmore-imported bookings continue to act as travel-time / clash blocks because they write to the same `lesson_bookings` columns the new endpoint reads — and Setmore is being retired anyway.

**Backend (additive only — `available` keeps its old shape):**
- New `?min_duration_only=1` flag on `?action=available`. When set, `lesson_type_id` is treated as grid-spacing only and the `offered_lesson_types` filter is dropped — so the slot feed shows every active instructor in the school, not only those who offer the (effectively arbitrary) min-duration type.
- New `?action=durations-for-slot` endpoint. Accepts `instructor_id`, `date`, `start_time`, optional `school_id` and `pickup_postcode`. Returns `{durations: [{lesson_type_id, slug, name, duration_minutes, price_pence, colour, fits, reason}]}` with `reason` ∈ `'window'|'notice'|'not_offered'|'clash'|'travel'|null`. Excludes `slug='trial'` (free trials have their own dedicated flow). Reuses the same window/notice/clash/travel logic as the slot feed but runs it once per click for one slot.

**Frontend:**
- `book.html`: pill bar removed (CSS + container). Modal gets a duration `<select id="mdLessonTypeSelect">`, plus dedicated rows for the loading state, single-type confirmation, no-fit empty state, and a "Using your usual length" hint.
- `book.js`: extracted `applyLessonTypeToModal(lt, isGuest, needsProfileFields)` that recomputes price/duration/credit-vs-pay UI for any picked lesson type and rewrites `pendingSlot.end_time` to match the chosen duration. New `loadDurationsForSlot(slot, ...)` fires the new endpoint, sorts fitting durations first, preselects via the chain `?type=` URL slug → `cc_last_lesson_type_id` localStorage → smallest fitting. Repeat-weekly works unchanged (it queries `?action=available` post-pick with the chosen `lesson_type_id`). Reschedule mode bypasses the picker — rescheduled bookings keep their original duration.
- localStorage `cc_last_lesson_type_id` (no expiry) persists the returning learner's usual choice. Written on credit-path success and just-before Stripe redirect (guest + authed). When honoured, a tiny "Using your usual length" hint shows under the dropdown until the learner manually changes it.

**PostHog funnel events:**
- `slot_clicked` no longer carries `lesson_type_slug` (not known at click time).
- New `durations_loaded` (`fits_count`, `total_count`).
- New `duration_selected` fired on initial preselect and on dropdown change. Carries `lesson_type_slug`, `duration_minutes`, `price_pence`, `was_preselected`, `source` (`url_param`|`localStorage`|`single_option`|`default`|`manual`), `fits`, `all_options`.
- New `slot_no_durations_fit` for the empty-state case, with `reasons` array.
- `booking_modal_closed` extended with `had_duration_selected` boolean.

**Rollback path:** every change is gated by either the `min_duration_only` flag (additive) or the new endpoint (additive). Reverting the merge commit restores length-first UX cleanly; the backend endpoint can stay (harmless).

**Files changed:** `api/slots.js`, `public/learner/book.js`, `public/learner/book.html`, `PROJECT.md`, `docs/navigation.md`, `CLAUDE.md`, `MIGRATION-PLAN.md`, `DEVELOPMENT-ROADMAP.md`

---

## 2.92 — Booking page spectator mode + inline free-trial CTA (28 April 2026)

Drops the login wall in front of `/learner/book.html` so visitors can browse real availability before committing to an account. The page already supported guest checkout via `?action=checkout-slot-guest` — the wall was purely link-level (every "Book" CTA routed through `/learner/login.html?redirect=...`). Repointing the CTAs reveals the existing guest path.

**Spectator mode:**
- All "Book" links now point straight at `/learner/book.html`: homepage hero + footer (`public/index.html`), marketing top bar + mobile tab bar + public sidebar (`public/sidebar.js`).
- New `#guestBanner` on `book.html` for logged-out visitors: "Browsing as a guest — pick any slot to pay & book, or sign in to use lesson hours." The misleading "No hours on your account" banner is suppressed for guests via an `auth &&` gate in `updateCreditBadge()`.
- Sidebar `Buy Credits`, `Upcoming` (children of Lessons) and `Profile` (bottom-tab) now carry `authOnly: true` and are filtered out for guests. The bottom-bar renderer was extended to honour `authOnly` (it previously only worked on the sidebar tree).

**Inline "claim as free trial" CTA:**
- Inside the guest section of the booking modal, a dashed-border CTA reads "Never had a lesson with us before? Claim this as your free trial →". Shown only when the school's lesson-types list includes a row with `slug='trial'` (per-tenant gating, no new feature flag column needed).
- Clicking redirects to `/free-trial.html?instructor_id=…&date=…`. The chosen slot is *not* force-converted to a trial booking — the trial handler (`api/slots.js handleBookFreeTrial`) enforces strict duration + offered-types matching, so the guest re-picks a real trial slot on the dedicated page. Eligibility (one-trial-per-email/phone) is checked at submit time by the existing handler, not pre-flighted (avoids a PII-enumeration endpoint).
- `/free-trial.html` honours `?instructor_id=` (filters the slot feed to that instructor) and `?date=` (highlights and scroll-into-views the matching day group via a new `.day-group--preselected` style).

**PostHog instrumentation (council-recommended, for evaluating slot-first later):**
- New events `claim_trial_cta_shown` and `claim_trial_cta_clicked` (props: `instructor_id`, `date`, `lesson_type_slug`).
- Existing `free_trial_page_viewed` extended with `from_book: boolean`.

**Explicitly NOT done:**
- `/free-trial.html` is **not** retired — kept as a marketing landing page (Google Ads target, social shares, school-specific deep links).
- Booking UX is **not** inverted to slot-first (see CLAUDE.md "Booking page — do NOT re-add"). Lesson-type pills + "next available" feed unchanged.
- No client-side trial-eligibility pre-check (would require a PII enumeration endpoint).

**Files changed:** `public/index.html`, `public/sidebar.js`, `public/learner/book.html`, `public/learner/book.js`, `public/free-trial.html`, `public/free-trial.js`

---

## 2.91 — Referral system Phase 1: per-lesson recurring rewards + share UI (27 April 2026)

Builds on the original referral system from 2.80, replacing the broken purchase-time reward with a correct lesson-completion-time engine, and adding the user-facing share surface.

**Reward engine ([#108](https://github.com/coachcarteruk-gif/coachcarter-website/pull/108)):**
- New cron `api/cron-referral-rewards.js` runs daily at 04:00 UTC. For every completed paid lesson by a referred learner past a 7-day grace window, credits the referrer with `floor(duration_minutes / 3)` minutes — recurring per booking, single-tier only.
- New column `lesson_bookings.referral_rewarded_at` is the per-booking idempotency key. Atomic stamp-then-credit via `UPDATE...RETURNING` makes the cron race-safe.
- Removed the old purchase-time reward block from `api/credits.js` (was rewarding flat 30 min on credit purchase regardless of refunds — wrong on both counts).
- Migration includes a backfill that stamps existing rewarded referees' first booking, so the new cron never double-pays anyone already credited under the old logic.

**Share UI ([#109](https://github.com/coachcarteruk-gif/coachcarter-website/pull/109)):**
- New short URL `/r/CODE` via `api/r.js` + `vercel.json` rewrite. Validates the code, rate-limits per IP+code (30/hr), logs the click with hashed IP, redirects to `/learner/login.html?ref=CODE`. Fail-open on any error so a shared link never breaks the friend's experience.
- New `referral_clicks` table for attribution debugging and abuse signal.
- New dedicated page `/learner/refer.html` — share link with copy + native share (mobile only, when `navigator.share` is supported), stats, three-step explainer, recent referrals with status badges (joined / booked / driving), small FAQ.
- New "Refer a friend" sidebar entry with gift icon (learner role only).
- Dashboard referral card simplified to a clickable teaser linking to `refer.html`.
- `referral-stats` endpoint extended to compute per-referee status (`joined` → `booked` → `lessoned`).
- Share URL format updated from `/learner/login.html?ref=X` to the short `/r/X` form.

**Auth gate fix ([#110](https://github.com/coachcarteruk-gif/coachcarter-website/pull/110)):**
- `refer.js` was assuming `ccAuth` only existed when logged in. It exists for logged-out users too (with `isLoggedIn: false`). Fixed by checking `ccAuth.isLoggedIn` and calling `ccAuth.requireAuth()` to show the shared sign-in modal when needed.

**No share-message template by design:** every learner shares differently to different friends — a canned line reads as ad-spam when forwarded. Bare link with the sender's own context feels like a real recommendation.

**Files changed:** `db/migration.sql`, `api/cron-referral-rewards.js` (new), `api/r.js` (new), `api/credits.js`, `api/learner.js`, `vercel.json`, `public/learner/refer.html` (new), `public/learner/refer.js` (new), `public/learner/index.html`, `public/learner/index.js`, `public/sidebar.js`, `PROJECT.md`, `MIGRATION-PLAN.md`

---

## 2.90 — Fix credits system: payments_enabled flag + booking confirmation balance display (27 April 2026)

Root cause: `schools.config` for CoachCarter (school #1) never had `payments_enabled: true` set, so `skipPayments` was always `true` in `handleBook`. Result: no credits deducted on booking, `minutes_deducted = 0` stored, and refunds never fired on cancellation (all cascading from the same flag).

**Fixes:**
- `db/migration.sql`: `UPDATE schools SET config = config || '{"payments_enabled": true}'` for school #1 (idempotent, only sets if not already present)
- `public/learner/book.html` + `book.js`: added `#successBalance` element to booking confirmation step showing remaining hours after booking

**Files changed:** `db/migration.sql`, `public/learner/book.html`, `public/learner/book.js`

---

## 2.89 — Hourly Stripe webhook reconciliation cron (26 April 2026)

Safety net for silent webhook failures (entry 2.88 root-caused one). Runs every hour at :30 past, fetches all Stripe checkout sessions completed in the last 25 hours that are paid + have a tracked `payment_type` (`credit_purchase` / `slot_booking` / `lesson_offer`), and bulk-checks `credit_transactions.stripe_session_id`. Any paid session without a matching DB row is reported via email to `ERROR_ALERT_EMAIL` (or `STAFF_EMAIL` as fallback). Alert-only — no auto-replay — because re-running a partially-applied handler against a mutated DB is riskier than a manual "Resend" click in the Stripe dashboard. Legacy `pass_guarantee` / calculator-package payments use an in-memory store and are intentionally excluded. Window is 25h not 24h to guarantee no events slip through cron-schedule edges.

**Files changed:** `api/cron-reconcile-payments.js` (new), `vercel.json` (cron schedule), `PROJECT.md` (file tree + endpoint table)

---

## 2.88 — Fix coachcarter.co.uk references (26 April 2026)

Stripe webhook URL was configured as `https://coachcarter.co.uk/api/webhook` — a domain we don't own. All `checkout.session.completed` deliveries had been silently failing with TLS errors for an unknown period: payments succeeded in Stripe, but no confirmation email or DB write fired. Discovered when a learner paid £82.50 and got no confirmation; Fraser compensated her with a free lesson out-of-band. Stripe webhook URL changed to `https://coachcarter.uk/api/webhook` in the Stripe dashboard. This commit cleans up every other `.co.uk` reference: `vercel.json` redirect, `api/connect.js` Stripe Connect base URL, `api/cron-payouts.js` payout email link, `middleware.js` CORS allow-list, and contact emails in `privacy.html` / `terms.html` (which were directing GDPR / data-rights requests to a domain we don't control). Code comments in `_auth.js` and `_csrf.js` also tidied. Remaining work: a reconciliation cron to detect future silent webhook failures.

**Files changed:** `vercel.json`, `api/connect.js`, `api/cron-payouts.js`, `api/_auth.js`, `api/_csrf.js`, `middleware.js`, `public/privacy.html`, `public/terms.html`

---

## 2.87 — Close C1 phone-bypass with guest_phone column (26 April 2026)

The free-trial one-trial guard could be bypassed by a second booking with the same phone but a different email, because the phone-collision fallback creates a learner row with `phone=NULL`, making the phone check invisible to the guard. Fix: added `guest_phone TEXT` to `lesson_bookings`, populated by `book-free-trial` with the raw submitted phone. The dedup query now checks `lb.guest_phone` in addition to `lu.phone`, closing the bypass. Column also added to GDPR data export.

**Requires migration:** `GET /api/migrate?secret=MIGRATION_SECRET`

**Files changed:** `db/migration.sql`, `api/slots.js`, `api/learner.js`

---

## 2.86 — Fix PostHog CSP regression (26 April 2026)

`posthog-loader.js` fetches `array.js` from `https://eu-assets.i.posthog.com` but only `https://eu.i.posthog.com` was whitelisted in `script-src`. Browser was silently blocking the script, breaking analytics on every page that loads `posthog-loader.js`. Added `eu-assets.i.posthog.com` to `script-src` in `middleware.js`.

**Files changed:** `middleware.js`

---

## 2.85 — Fix terms-acceptance Continue button on mobile (26 April 2026)

The "One last step" terms-acceptance screen shown after a magic-link login had a Continue button that never enabled on mobile. Root cause: the `<label>` wrapping the checkbox also contains `<a>` links to T&C/Privacy pages; on mobile, tapping the label area (especially near those links) doesn't reliably fire a `change` event on the checkbox. Added `click` listeners on both the checkbox and the label (with a `setTimeout` tick so the checked state has settled) so the button syncs correctly regardless of tap position.

**Affects every new learner** coming through the free-trial CTA.

**Files changed:** `public/learner/login.js`

---

## 2.84 — Free Trial Self-Serve Booking (26 April 2026)

Public-access free 1-hour trial lesson booking, end-to-end. Anyone visiting `/free-trial.html` can pick a slot, submit name/email/phone/pickup, and get a confirmed booking + magic-link login email — no Stripe, no payment, no account creation step. The Free Trial lesson type already existed in `lesson_types` (id 37, slug `trial`, duration 60 min, price 0p) but was inactive and had no public surface.

**What changed:**
- New `book-free-trial` action on `/api/slots` — validates inputs, rate-limits, runs a one-trial-per-learner guard, creates a confirmed booking with `payment_method='free'`, `created_by='free_trial_self_serve'`, `minutes_deducted=0`
- Magic-link token (32-byte hex, 7-day expiry) generated and emailed instead of setting a session cookie — closes the impersonation vector that would otherwise let any form submission auto-login as any email
- Reused the existing `/api/slots?action=available` endpoint with `lesson_type_id=37` for the slot picker; the existing `offered_lesson_types` filter (slots.js:166) means instructors must explicitly include `"trial"` in their array OR have `NULL` (= all types) to surface
- New `public/free-trial.html` + `public/free-trial.js` — public marketing page with slot picker, guest form, validation, PostHog events (`free_trial_page_viewed`, `_slot_selected`, `_submitted`, `_confirmed`, `_blocked_existing`). Captures `?ref=XXX` for forward-compat with future referrer-only mode
- New `public/free-trial-success.html` — minimal post-booking confirmation page that points at `/learner/login.html` if the email doesn't arrive
- `instructor.js` `validSlugs` extended to include `'trial'` so instructors can opt in/out via the existing profile lesson type toggle UI
- DB: `lesson_types.active = true` for the trial type; Fraser's `offered_lesson_types` updated to `["standard","2hr","trial"]`. Simon Edwards stays `NULL` (already opted in by prior conversation)
- Homepage hero now has a dual CTA: primary `Try a Free Lesson` → `/free-trial.html`, secondary outlined `Already with us? Book a lesson` → existing login → book path. Final CTA repointed at `/free-trial.html`

**One-trial guard:** matches by email OR phone (both `07xxx` and `+447xxx` variants), no status filter — so cancelled bookings count, preventing cancel/rebook loops.

**Known limitations (TODO for v2):**
- Phone-side guard misses prior bookings whose resolved learner row had `phone=null` (set by the phone-collision fallback during initial insert). Email guard is the primary defence; phone is supplementary. Closing this hole properly needs a `guest_phone` column on `lesson_bookings` populated from form submission directly. End-to-end test on 2026-04-26 confirmed this edge case works as documented.
- WhatsApp confirmation messages are best-effort via the shared `sendWhatsApp` helper. Tested locally on 2026-04-26 — message did not arrive at `07903081618`. Not a free-trial regression (same helper is shared with paid bookings); flagged for separate Twilio config investigation.
- `validSlugs` in `instructor.js` is hardcoded and has drifted from `lesson_types` table (e.g. `1hr` is in the DB but not the validator). Should dynamicise from the table — TODO comment added.
- Slot picker shows ALL of an opted-in instructor's available slots. No mechanism today to expose only specific times for free trials specifically.
- `REQUIRE_REFERRAL` constant in `handleBookFreeTrial` is `false`; flip to `true` to gate behind referral codes once the referrer-reward feature is built.

**Verified end-to-end:** Real booking via the preview at `2026-04-27 14:30` with throwaway email + Fraser's real phone. Booking row landed correctly with all expected fields, magic-link token generated with correct expiry, both confirmation emails delivered. C1 guard correctly blocks retries with the same email. Test booking + learner cleaned up post-test.

**Rollback:**
- Frontend: revert commit `30fa493` (deletes the three new public files) and revert commit `ef0d860` (restores prior homepage CTAs)
- Backend: revert commit `b58faf6` (removes `book-free-trial` action) and `cea5a6c` (removes `'trial'` from `validSlugs`)
- DB: `UPDATE lesson_types SET active = false WHERE slug = 'trial' AND school_id = 1;` and `UPDATE instructors SET offered_lesson_types = '["standard","2hr"]'::jsonb WHERE id = 4;`

**Files changed:** `api/slots.js`, `api/instructor.js`, `public/index.html`, `public/free-trial.html` (new), `public/free-trial.js` (new), `public/free-trial-success.html` (new), `.claude/launch.json`

---

## 2.83 — Marketing Homepage Launch (26 April 2026)

Replaced the linktree-style `index.html` with a scrollable marketing homepage. Cold visitors can now learn about CoachCarter before being asked to log in; returning users keep their fast path via `/login.html` (PWA `start_url`) and a dismissible shortcut bar at the top of the homepage.

**What changed:**
- New `public/index.html` adapted from the existing `coachcarter-landing.html` draft (which was deleted along with `coachcarter-landing.js`)
- Added an "About CoachCarter" section ("Hi, I'm Fraser") — the explicit gap the linktree had: nowhere to learn about the company without committing to a login
- Added a dismissible shortcut bar above the nav for returning visitors ("Already a member? Learner login · Instructor login"), state stored in `localStorage` under `cc_shortcut_dismissed`
- Replaced the draft's "where would you like to go?" quiz section (which duplicated the linktree's self-classify function) with a 4-tile pass-photo strip
- Andrew's testimonial photo swapped to the newly processed `/images/home/testimonial-andrew.jpg`
- New JS file `public/home.js` (renamed from `coachcarter-landing.js`) — strips the dead quiz code and adds shortcut-bar dismiss handling

**Verified at 375 / 768 / 1280 px viewports:** no horizontal scroll, mobile tab bar shows/hides correctly, shortcut bar collapses label on mobile, About + hero + pass strip + features + testimonials all reflow cleanly. Console clean. GDPR scripts (`cookie-consent.js`, `posthog-loader.js`) and PWA scripts intact.

**Rollback:** `/login.html` still serves the original linktree verbatim. To revert, point Vercel rewrites or rename files so `/` serves `login.html` again.

**Files changed:** `public/index.html` (replaced), `public/home.js` (new), `public/coachcarter-landing.html` (deleted), `public/coachcarter-landing.js` (deleted)

---

## 2.82 — Marketing Homepage Groundwork (26 April 2026)

Preparing to replace the linktree-style landing page (`index.html`) with a scrollable marketing homepage that gives curious visitors a chance to learn about CoachCarter before being asked to log in. This commit is the routing-and-assets prep step; the new homepage ships in a follow-up commit.

**What changed:**
- Linktree preserved at `/login.html` (verbatim copy of previous `index.html`) — keeps the fast 2-button choice for returning users and PWA installs
- `manifest.json` `start_url` switched from `/` to `/login.html` so installed PWAs continue to skip the marketing layer
- 6 pass-photo testimonials added under `/public/images/home/` (consent confirmed by Fraser, EXIF stripped, resized to ≤1400px wide, ~230–500KB each)

**Baseline metrics:** Captured as of 2026-04-26 = unknown (no historical PostHog snapshot pulled). Future homepage performance compared against post-launch traffic from this date.

**Success criteria for the follow-up homepage commit:** combined click-through to `/learner/login.html` + `/instructor/login.html` ≥ 80% of post-launch baseline within 14 days. Below 60% → revert via `manifest.json` rollback (~5 min).

**Files changed:** `public/manifest.json`, `public/login.html` (new), `public/images/home/*` (new)

---

## 2.83 — Hide TRG, 3-Tier Journey & Stale Pricing from Public Marketing (28 April 2026)

The Test Ready Guarantee, the 3-tier learner journey programme, and the pay-as-you-go callouts were still being advertised on `index.html` and `lessons.html` despite no longer being offered. The "Pricing" page (`learner-journey.html`) also still listed old hourly rates and bundle prices that no longer matched what learners were actually charged in the hub at booking time. Cleanup pass to bring public marketing in line with what's currently sold, and to push curious visitors toward the free trial first.

**What changed:**
- **`public/lessons.html`** — TRG meta/OG tags, hero badge "Test Ready Guarantee Available", hero stats 3 & 4 (£2,400 / 18wk), full PAYG section, and the entire "Test Ready Guarantee redirect banner" all commented out (preserved in source for easy restore). Hero subheadline rewritten to push the free trial. Enquiry-form dropdown option "Test Ready Guarantee" hidden. Testimonial meta references to TRG cleaned.
- **`public/lessons.js`** — `loadLivePricing()` added: fetches the standard 90-min lesson type from `/api/lesson-types?school_id=1` and overlays the live hourly rate onto the page so the marketing-side price always matches what learners are actually charged at booking. Stopped overriding hero subheadline / hero CTA / guarantee section titles from config (the DB-backed `/api/config` was reintroducing TRG copy from old `config.json` values). All element overrides made null-safe so commented-out sections don't throw.
- **`public/index.html`** — TRG meta/OG tags, "Test Ready Guarantee" feature card, the entire "Pricing Preview" section (£82.50 PAYG / Credit Bundles / £1,500 TRG), and footer "Pricing" link all commented out. Andrew's testimonial copy updated to remove TRG reference. New "Free Trial Lesson" feature card added in TRG's slot.
- **`public/sidebar.js`** — Marketing nav "Pricing" → "Free Trial". Both desktop top bar and mobile bottom-tab bar updated. Affects `index.html`, `lessons.html`, `learner-journey.html`, `instructor/login.html`.
- **`public/learner-journey.html`** — Added `<meta name="robots" content="noindex, nofollow">`. Page still works at the direct URL for anyone with a saved link, but is dropped from search engines and unreachable from any public marketing nav or footer.

**Restore path:** every commented-out block carries a dated note and the original HTML/copy verbatim. Restoring the TRG marketing presence is a 5-minute reversal; no source has been deleted.

**Known follow-up flagged:** `api/credits.js` hardcodes `PRICE_PER_STANDARD_LESSON_PENCE = 8250` (£55/hr) for bulk-hour purchases, while individual slot bookings read `price_pence` from the `lesson_types` table. The two flows can disagree on price. Spawned as a separate task — not fixed in this commit.

**Files changed:** `public/lessons.html`, `public/lessons.js`, `public/index.html`, `public/sidebar.js`, `public/learner-journey.html`

---

## 2.84 — Per-School Bulk Credit Pricing (28 April 2026)

The bulk-credits checkout (`api/credits.js`) was using a hardcoded £55/hr rate and a fixed 12hr/24hr/36hr → 5%/10%/15% discount tier structure. This created two issues: (a) the buy-credits page displayed prices computed from `lesson_types.price_pence` while the API charged from a different hardcoded constant — page and Stripe receipt would silently disagree the moment `lesson_types` was edited; (b) every InstructorBook school onboarding would inherit CoachCarter's hourly rate regardless of their local pricing.

Bulk pricing was always intended as channel pricing (reward upfront commitment, help cashflow) — this commit makes that intent explicit and per-school configurable.

**What changed:**
- **`api/_pricing-helpers.js` (new)** — single source of truth for bulk pricing. `getBulkPricing(sql, schoolId)` reads `schools.config.pricing.bulk_hourly_pence` + `bulk_discount_tiers`, falls back to the school's standard 90-min lesson type rate, then to a hardcoded £55/hr last-resort. `calcBulkTotal()` does the full breakdown. `validateBulkPricingConfig()` enforces sanity caps (1–50000 pence, 0–50% discount, 1–36 min_hours, no duplicate tiers).
- **`api/credits.js`** — removed `PRICE_PER_STANDARD_LESSON_PENCE` and `DISCOUNT_TIERS` hardcoded constants. `handleCheckout` now calls `calcBulkTotal(sql, schoolId, hours)`. New public `?action=bulk-pricing` endpoint returns the same data the page renders, so what's displayed = what's charged.
- **`api/config.js`** — admin saves now run `validateBulkPricingConfig()` before persisting. Bad input is rejected with a clear error message.
- **`public/admin/editor.html` + `editor.js`** — new "Bulk Credit Pricing" section under Pricing Settings: `bulk_hourly_pence` input + dynamic discount-tier table with add/remove rows. Client-side validation mirrors server. Save button blocks until errors are fixed.
- **`public/learner/buy-credits.js`** — fetches live pricing from `/api/credits?action=bulk-pricing` on load. Both bulk packages and single-lesson cards now compute display price from `bulk_hourly × hours`, not from `lt.price_pence`. Page = receipt by construction.
- **`db/migration.sql`** — idempotent seed for school 1 (CoachCarter): sets `bulk_hourly_pence = 5500` and the existing 5/10/15% tier structure if not already set. Preserves existing behaviour exactly. New schools get nothing seeded — they fall back to their lesson_types rate (= no bulk discount) until admin opts in.

**Per-learner override behaviour:** `instructor_learner_notes.custom_hourly_rate_pence` continues to apply at slot-booking time only (`api/slots.js`). Bulk credits ignore custom rates — credits are paid into a balance not tied to a specific instructor at purchase time. Documented in helper file.

**`paygHourly` field unchanged:** stays as the marketing-page rate (used by `lessons.html` display via `lessons.js`). Different concept from `bulk_hourly_pence`. Editor now has a callout explaining the difference.

**Files changed:** `api/_pricing-helpers.js` (new), `api/credits.js`, `api/config.js`, `public/admin/editor.html`, `public/admin/editor.js`, `public/learner/buy-credits.js`, `db/migration.sql`

---

## 2.95 — Learner Password Auth (7 May 2026)

Magic-link login was failing for PWA users: clicking the email link opened in the system browser, not the installed PWA, leaving the PWA still on the login screen because OS-level storage isolation gives PWAs their own cookie jar. This pushed users into a broken loop. Replaced learner login with email + password, keeping magic-link infrastructure only for password reset and a one-time migration code for existing accounts. Magic links for *login* are gone.

**What changed:**

- **`api/_password.js` (new)** — shared bcrypt hash/verify, NIST-aligned password validation (8 char min, common-password blocklist, no complexity rules), and 5-fail / 15-min lockout per email keyed off the existing `rate_limits` table. Used by learner-auth; admin keeps its own bcrypt calls (predates this module — left untouched).
- **`api/learner-auth.js` (new)** — `login`, `signup`, `set-password`, `request-reset`, `add-email`, `check-account`. `login` enforces lockout + fails closed on missing password (no enumeration leak). `signup` audit-logs as `learner.signup`. `set-password` consumes a 5-min ticket from `verify-email-code` and audit-logs as `learner.password_set` or `learner.password_reset`. `add-email` lets phone-only users attach an email so they can migrate.
- **`api/magic-link.js`** — new `send-email-code` and `verify-email-code` actions for `purpose: 'migration' | 'reset'`. Codes are 6 digits, 15-min expiry, scoped via a new `email_code` column (avoiding the global UNIQUE collision the SMS path could theoretically hit). `verify-email-code` returns a JWT ticket (`audience: 'password-set'`) the caller redeems through learner-auth — login is never granted by the email step alone.
- **`db/migration.sql`** — `email_verified` + `password_set_at` on `learner_users`, `instructors`, `admin_users`. `password_hash` added to `instructors` (nullable; flow not yet wired). `magic_link_tokens` gains `purpose`, `email_code`, `role` columns + a partial index for `(email, email_code, role, purpose) WHERE used = false`.
- **`public/learner/login.html` + `login.js`** — full rewrite. Explicit "Sign in" / "Sign up" tabs, forgot-password screen with code-based reset (PWA-safe), migration screen for existing users, add-email screen for phone-only users, SMS fallback retained. Reuses the existing 6-digit code input UI for three different purposes (migration / reset / SMS). Legacy `?token=` magic-link URLs still work for ~15 min after deploy via the preserved `verify` action.
- **`CLAUDE.md`** — corrected "JWT in localStorage" claim (it's an httpOnly cookie; localStorage holds a display blob). Added "Password auth" rules section with audit-log requirements, enumeration-leak rules, and the email-code rationale for PWA round-trips.
- **`PROJECT.md`** — Authentication section rewritten. New `learner-auth.js` action table; `magic-link.js` table updated to mark legacy actions and add the email-code paths.

**Why email codes, not magic links, for PWA round-trips:** an email link clicked in iOS/Android Mail or Gmail opens in Safari/Chrome — never the installed PWA. The browser logs in (cookie lands in browser jar). The PWA still has no cookie because storage is partitioned per origin × install. A 6-digit code typed into the PWA stays inside the PWA's storage context, so the session lands where it's needed.

**Migration UX (existing accounts with no password):** user enters their email + any password → server returns "exists, no password" → UI sends a code → user types it → ticket issued → user picks a password → logged in. Three taps after the email box.

**Phone-only users:** SMS code login still works. After verifying, if the account has no email the UI routes them through `add-email` → migration code → set-password.

**Deferred to next session:** instructor password flow + admin forgot-password + the matching login UI for both. Instructors are still magic-link only — they're not the PWA user (they use the desktop dashboard).

**Files changed:** `api/_password.js` (new), `api/learner-auth.js` (new), `api/magic-link.js`, `db/migration.sql`, `public/learner/login.html`, `public/learner/login.js`, `CLAUDE.md`, `PROJECT.md`

---

## 2.96 — Instructor + Admin Password Auth (7 May 2026)

Follow-up to 2.95. Brings instructor and admin sign-in onto the same email + password model as learner, with a different operational shape per role:

- **Instructors are invite-only.** No self-serve signup. Admins set or reset instructor passwords via a new modal in the admin portal; the instructor is forced through a change-password screen on first sign-in. No self-serve forgot-password — instructors contact the admin (login page hint mails `bookings@coachcarter.uk`). Decision rationale: instructors are non-technical; "your password is X, change it on first login" over WhatsApp is more reliable than email-code flows.
- **Admins** keep their existing password login (already shipped pre-May 2026) but gain a code-based forgot-password flow that mirrors the learner UX — 6-digit code by email, set new password, fresh session. Same enumeration-safe and PWA-safe behaviour.
- **Magic-link login retired entirely.** The `validate` and `verify` actions in `api/magic-link.js`, the email-link branch of `send-link`, plus the `sendMagicLinkEmail` and `sendWelcomeEmail` helpers are gone. The legacy `?token=` URL handler in `learner/login.js` is also gone. Magic-link infrastructure that survives: SMS code login (`verify-code`), learner email-code migration/reset (`send-email-code` / `verify-email-code`), and the admin reset code path. Instructor magic-link handlers in `api/instructor.js` (`request-login`, `validate-token`, `verify-token`) are preserved as a dead-but-callable fallback in case of admin lockout.

**What changed:**

- **`api/instructor-auth.js` (new)** — `login`, `change-password` (authed), `logout`. Login uses the shared `_password.js` lockout, returns `must_change_password` when the password was admin-set so the UI can route to the change-password screen. `change-password` re-verifies the current password before saving; clears `must_change_password`; audit-logged as `instructor.password_change`.
- **`api/instructors.js`** — new admin-only `set-password` action. Hashes the typed password, sets `must_change_password = TRUE`, audit-logged as `admin.instructor_password_set`. Multi-tenant guard (school must match admin's school).
- **`api/admin.js`** — new `request-reset` and `reset-password` actions. Code-based, enumeration-safe, mirrors learner reset UX. Issues a fresh admin session JWT on success. Audit-logged as `admin.password_reset`.
- **`db/migration.sql`** — `instructors.must_change_password BOOLEAN DEFAULT FALSE`. Existing learner/admin schema unchanged.
- **`public/instructor/login.html` + `login.js`** — sign-in screen now email + password. New change-password screen forced after admin-set password. Forgot-password hint points to admin email instead of self-serve flow. Magic-link sign-in / link-sent / verify spinner / verify-error screens left in HTML as harmless dead markup (JS no longer activates them); will be deleted in a tidy-up pass.
- **`public/admin/login.html` + `login.js`** — sign-in screen unchanged; new "Forgot password?" link toggles to a forgot-email screen → reset code + new password screen. Same code+pw atomic flow as the API.
- **`public/admin/portal.js` + `dashboard.js`** — instructor list rows gain a "Set password" / "Reset password" button (label switches based on `has_password`). Modal asks the admin to type the password and warns it'll force change on first sign-in. `api/admin.js?action=all-instructors` now returns a `has_password` boolean (never the hash itself).
- **`api/magic-link.js`** — cleanup: dropped routes for `validate` + `verify`; `send-link` with `method:'email'` returns 410 with a clear message; helpers `sendMagicLinkEmail` and `sendWelcomeEmail` removed. SMS path + email-code paths untouched.
- **`public/learner/login.js`** — dropped the `?token=` legacy magic-link landing handler and its unused `showErrorScreen` helper.
- **`CLAUDE.md`** — Password auth section rewritten to cover all three roles + their per-role rules. Added the audit-log action name list.
- **`PROJECT.md`** — Instructor portal section rewritten to describe the password flow + invite-only model; new `instructor-auth.js` action table; admin action table gains `request-reset` + `reset-password`.

**Migration UX (existing instructors):** they have no `password_hash` yet, so login fails with invalid_credentials. Admin opens the portal, clicks "Set password" on each instructor row, types a temporary password, and shares it via WhatsApp/text. Instructor signs in, is forced through change-password, picks their own password.

**Known follow-ups:**
- Delete the dead magic-link screens from `instructor/login.html` and the unused `request-login` / `validate-token` / `verify-token` handlers in `api/instructor.js` after a few days of stable operation.
- Add a "Change password" section on the instructor profile page so instructors can voluntarily change their password after the initial admin-set one. The API endpoint exists (`api/instructor-auth.js?action=change-password`); only the UI is missing.

**Files changed:** `api/instructor-auth.js` (new), `api/instructors.js`, `api/admin.js`, `api/magic-link.js`, `db/migration.sql`, `public/instructor/login.html`, `public/instructor/login.js`, `public/admin/login.html`, `public/admin/login.js`, `public/admin/portal.js`, `public/admin/dashboard.js`, `public/learner/login.js`, `CLAUDE.md`, `PROJECT.md`

---

## 2.98 — Auth gate on offer-success.html for guest learners (10 May 2026)

Closes the customer-impacting gap from the 10 May incident. A learner who paid for a flexible lesson offer as a guest (no prior CoachCarter account) landed on `offer-success.html?flexible=1`, picked a slot, tapped Confirm booking, and the call to `/api/slots?action=book` 401'd because they had no session cookie on this device. The Stripe webhook had created their `learner_users` row but no session was ever issued to the browser that just paid.

The fix: an inline auth gate appears on `offer-success.html` before the slot picker for guests. Two modes:

- **Set password** (default for new accounts) — POSTs to a new endpoint `?action=set-password-from-offer` with `{ offer_token, password }`. The endpoint verifies the offer is `accepted`, the learner has `password_hash IS NULL`, and `accepted_at` is within 24h, then hashes the password, issues a session JWT, and audit-logs as `learner.password_set` with `purpose: 'offer_signup'`. Email field is hidden (server resolves email from the offer).
- **Sign in** (when `check-account` reports `has_password: true`) — uses the existing `?action=login` endpoint. Email is pre-filled and readonly. Includes a "Forgotten your password?" escape hatch linking to `/learner/login.html` with a redirect-back param.

Once the gate posts successfully, the session cookie is set server-side, the `cc_learner` localStorage display blob is updated client-side, and `initSlotPicker()` runs. The booking `fetchAuthed` then succeeds because the session is now established.

Authorisation: the offer token alone is unguessable (32 bytes random) and the `status='accepted'` gate prevents pre-payment use. The `password_hash IS NULL` check refuses to overwrite an existing customer's password — they must use sign-in mode instead. The 24h post-acceptance window prevents stale tokens from being weaponised long after the booking flow has lapsed.

API contract changes: `?action=get-offer` on a `status='accepted'` offer now returns the existing 410 response **plus** a minimal `offer` payload (`id`, `learner_email`, `instructor_name`, `duration_minutes`, `is_flexible`) so the auth gate can pre-fill the email field and route to the correct mode. Existing callers that only check `data.code === 'ALREADY_ACCEPTED'` are unaffected.

**Why not auto-issue a session JWT silently from Stripe metadata:** any leak of the offer token would mint a session for someone else's account. Forcing a password step ties account access to a secret only the legitimate learner sets, and onboards them to a real account they can re-use for future bookings.

**Files changed:** `api/learner-auth.js`, `api/offers.js`, `public/offer-success.html`, `public/offer-success.js`, `PROJECT.md`

---

## 2.97 — Sync `credit_transactions.type` CHECK constraint with codebase reality (10 May 2026)

Production's `credit_transactions_type_check` CHECK constraint, inherited from the original `db/migrations/001_booking_system.sql`, only allowed `('purchase','refund')`. The codebase has since added six other type values, all of which were silently 23514-erroring in production:

- `slot_purchase` — written by `api/webhook.js` for slot-booking and lesson-offer payments
- `edit_adjustment` — written by `api/admin.js` and `api/instructor.js` when a booking edit changes lesson length
- `admin_add` / `admin_remove` — written by `api/admin.js` for manual credit adjustments
- `referral_bonus` — written by `api/magic-link.js` for referee signup bonuses
- `referral_reward` — written by `api/cron-referral-rewards.js` for referrer rewards (and queried in `admin.js` and `learner.js`)

The webhook insert was the most visible failure — it's not in a try/catch, so the whole `handleOfferBooking` flow aborted before the offer could be marked accepted. This was discovered on 10 May 2026 when a Stripe webhook outage (apex-vs-www URL mismatch) was diagnosed and webhook events were resent — they then failed for a second reason: this constraint. Live-patched at the time; this commit makes it permanent.

**What changed:**

- `db/migration.sql` — DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT block in the migration-evolution section, following the same pattern used for `lesson_bookings_status_check`. The new allowed set is the union of every type string the code actually writes plus `'refund'` (kept for legacy/future use even though no callsite writes it today).
- `PROJECT.md` — `credit_transactions` table doc now lists every allowed `type` value with its meaning.

**Audit-trail gap:** `credit_transactions` rows for non-`purchase`/`refund` types are missing in production for the entire pre-2026-05-10 history. The customer-facing `balance_minutes` column was always updated correctly (those updates are separate from the audit insert), so balances are right — only the historical audit trail is incomplete. Not backfilling: too risky, balances are consistent, and going forward the audit row will land.

**Deploy:** requires running `GET /api/migrate?secret=MIGRATION_SECRET` in production after merge so the constraint is updated.

**Files changed:** `db/migration.sql`, `PROJECT.md`

---

## 2.99 — Stripe Connect health surface: instructor banner upgrade + admin Payments column (16 May 2026)

Step 1 of `INSTRUCTOR-PAYMENTS-PLAN.md`. The first slice of the instructor-payments work — gets the Connect onboarding flow visible to instructors and at-a-glance to admins, without touching credit scoping or schema. Triggered by an audit of Fraser's own Connect account that found three past-due requirements (external account, representative, ToS) silently blocking payouts — Stripe was rejecting transfers while the existing earnings-page banner rendered green.

**Root cause of the silent state:** `renderConnectBanner` in `earnings.js` branched only on `has_account` and `onboarding_complete` (DB flags). Once `stripe_onboarding_complete = TRUE` was written (which happens the first time charges and payouts are enabled), the banner stayed green forever — even if Stripe later raised new `currently_due` requirements (re-verification, expired ID, missing bank details) or disabled capabilities.

**What changed:**

- `api/connect.js` — `?action=connect-status` now returns `charges_enabled`, `payouts_enabled`, and `requirements_pending` (count of `account.requirements.currently_due` items) whenever `has_account=true`. Previously these were checked internally but never surfaced. Mirrors the existing `school-connect-status` pattern.
- `public/instructor/earnings.js` — `renderConnectBanner` gained a fourth state: amber "Action required" with a red count badge, slotted between "DB onboarding incomplete" and "fully healthy". Triggered when `onboarding_complete=true` but `!charges_enabled || !payouts_enabled || requirements_pending > 0`. Copy adapts to the failure mode (count of items vs. capability disabled). Legacy API responses without the new fields fall through to the old green branch for back-compat during deploy.
- `public/instructor/dashboard.html` + `dashboard.js` — one-line clickable Connect-health alert above today's lessons. Hidden when account is healthy; amber when there's something to act on; red when no Connect account exists. Click navigates to the earnings page where the full banner with action buttons lives. Fire-and-forget — a Connect API hiccup doesn't block dashboard load.
- `api/admin.js` — `?action=all-instructors` returns three new DB columns: `connect_has_account`, `connect_onboarding_complete`, `connect_payouts_paused`. No live Stripe lookup (avoiding N+1 round-trips on every admin pageload).
- `public/admin/portal.js` — Payments badge on each instructor card: ✅ (active), ⚠️ (in-progress or paused), ❌ (no account). DB-only triage view; live state lives on the instructor's own earnings page.

**Deliberately out of scope:** Step 2 (public instructor profile pages), Step 3 (schema migration for credits + tiers), Steps 4 / 4f / 4g (per-instructor credit scoping, Stripe-fee pass-through, FIFO consumption). Those are gated on the signed franchise agreement and ship together when instructor #2 onboards.

**Files changed:** `api/connect.js`, `public/instructor/earnings.js`, `public/instructor/dashboard.html`, `public/instructor/dashboard.js`, `api/admin.js`, `public/admin/portal.js`, `docs/stripe-connect.md`, `INSTRUCTOR-PAYMENTS-PLAN.md`

---

## 2.100 — Discovery: platform Stripe schedule blocks the Friday payout cron architecture (16 May 2026)

Same-session follow-on to 2.99. While auditing Fraser's own Connect account post-deploy, ran a multi-perspective deliberation on whether he should reconnect his row to the Friday cron. The deliberation surfaced a deeper question — and the answer changed the franchise model's MVP scope.

**The discovery:** the platform Stripe account is configured for "Automatic Daily" payouts (Stripe Dashboard → Business → Payouts → Schedule). Every day, Stripe pays out the full available balance to Fraser's bank. The platform balance is consistently £0 at end-of-period.

**Why this matters:** the Friday cron (`api/cron-payouts.js`) assumes the platform balance acts as escrow between purchase and lesson delivery. By the time `stripe.transfers.create` runs, the funds have already been auto-paid to Fraser's bank. The transfer would fail with `insufficient_funds`. **This means the instructor payout cron cannot pay anyone in the current configuration, including instructor #2 when they onboard.**

**Confirmed by data:**

- Fraser's row has 49 unpaid chargeable bookings totalling £3,842.50 (all blocked from cron by `payouts_paused=TRUE`)
- April 2026 payout reconciliation report: £676.50 charges in, £645.07 paid out, ending balance £0.00

**The fix (documented as Step 0 in `INSTRUCTOR-PAYMENTS-PLAN.md`, build deferred to next session):**

- Switch Stripe Dashboard payout schedule from "Automatic Daily" → "Manual"
- New `api/cron-platform-sweep.js` scheduled at Friday 09:30 UTC (30 min after instructor-payouts cron) — calls `stripe.payouts.create` for whatever's left in the platform balance, sending it to Fraser's bank

**End state:**
- Today (one instructor): platform balance accumulates Mon-Thu, sweep cron pays it out Friday → Fraser receives one weekly STRIPE deposit instead of daily
- After instructor #2: instructor-payouts cron transfers their share at 09:00, sweep cron transfers Fraser's residue (his share + franchise fee component) at 09:30 → Fraser still receives one weekly deposit, instructor #2 receives theirs separately, all hands-off

**Why this is documented as a discovery now rather than fixed:** building a money-moving cron at the end of a long session is when subtle bugs slip in. Captured as a prerequisite to Step 4 instead; will ship before instructor #2's onboarding. See memory `project_platform_owner_payout_model.md` for the decision-tree detail.

**Files changed:** `INSTRUCTOR-PAYMENTS-PLAN.md` (Step 0 added), `DEVELOPMENT-ROADMAP.md`

---

## 2.101 — Retire legacy `create-checkout-session` + `verify-session` (PR-J, audit #13, 19 May 2026)

GPT-audit finding #13: `api/create-checkout-session.js` accepted caller-supplied `line_items` + `metadata` (no server-side pricing or validation) and routed paid checkouts to `webhook.js handleCheckoutComplete`, which stored bookings in an **in-memory `Map` that evaporated on every serverless cold start**. The `payg` and `bulk` buttons on `/lessons.html` had been pointed at this endpoint since the credit system shipped; in practice almost no one used them (the marketing site funnels through the free-trial flow) but anyone who did paid Stripe with no DB record landing — a latent customer-facing money-loss bug. `api/verify-session.js` was the unauthenticated post-payment confirmation read.

**What changed:**
- **Deleted:** `api/create-checkout-session.js`, `api/verify-session.js`, `public/success.html`, `public/success.js`
- **Deleted from `api/webhook.js`:** the in-memory `bookings` Map, `handleCheckoutComplete()`, `sendCustomerConfirmation()`, `notifyStaff()`, `sendAvailabilityFormLink()`, `getPackageDisplayName()`, `incrementGuaranteePrice()`. The dispatcher's `else` branch that previously routed unknown `payment_type` to the legacy handler now alerts via `reportError()` — fail-loud, not silent.
- **`public/lessons.js` — bulk-package buyer flow** (`btn-package`): now calls `/api/credits?action=checkout` with `{ hours: pkg.hrs }` after a login wall. Server prices via `calcBulkTotal()`; client sends nothing it can dictate. Anonymous visitors are bounced to `/learner/login.html?redirect=/lessons.html%23packages`. Slider/cards now also pull live bulk pricing from `/api/credits?action=bulk-pricing` so the displayed price matches what `?action=checkout` will charge (closes the latent `public/config.json` ↔ `schools.config.pricing` drift).
- **`public/lessons.js` — PAYG button** (`cta-primary`): rebound to `bookFreeTrial()`. No Stripe call at all — the same redirect path the hero CTA already uses (send to `/learner/login.html` if not logged in, `/learner/book.html` otherwise). PAYG is bought as hours via the credit system once the learner has an account, not as a standalone Stripe charge.
- **`public/lessons.js` — dead-code removal:** `startCalculatorCheckout()`, `calculateProfit()`, `getSelectedRetakes()`, `toggleAddon()`, `updateTotal()`, the `addonPrices` / `addonTiers` / `basePrice` calculator state, and the unused `applyConfig()` addon DOM-prep block. All only existed to drive the TRG calculator UI which has been hidden since 2026-04-28.

**Post-purchase landing:** bulk-package buyers land on `/learner/?hours_added=N&session_id=…` — the same dashboard-toast path the in-app `buy-credits.html` flow already uses. No dedicated success page.

**Guarantee pricing:** `api/guarantee-price.js` and the `guarantee_pricing` table survive; the increment-on-purchase wiring is gone but admin-override-via-Neon still works if the Pass Programme is ever re-enabled.

**Why guest-checkout for bulk was rejected:** Fraser's call. Free-trial booking remains friction-free for guests (handled by `?action=book-free-trial` + `?action=checkout-slot-guest` paths, unchanged); bulk hours requires an account first because `handleCreditPurchase` needs `learner_id` to credit the right balance. The marketing site funnels new visitors through free-trial → account creation → bulk hours, which matches the post-April 2026 conversion flow.

**Files changed:** `api/webhook.js`, `api/credits.js` (comment fix), `public/lessons.js`, `scripts/audit-stripe-charges.js` (comment refresh), `PROJECT.md`, `MIGRATION-PLAN.md`, `DEVELOPMENT-ROADMAP.md`. Deleted: `api/create-checkout-session.js`, `api/verify-session.js`, `public/success.html`, `public/success.js`.

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
