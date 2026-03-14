# Coach Carter — Website Development Roadmap

## Overview

This document outlines the planned development of a **custom booking and credit system** for the Coach Carter driving school website. The system allows learners to purchase lesson credits (via Stripe with Klarna support), store them on their account, and use those credits to book 1.5-hour lessons with any available instructor through a built-in calendar.

---

## Phase 1: Booking & Payment System

### 1.1 — Lesson Credits & Payments

**How it works:**
Learners purchase lesson credits through the website. Each credit equals one 1.5-hour lesson. Payments are processed through Stripe, with Klarna available as a payment method for spreading the cost.

**Key decisions:**
- Lesson length: **1.5 hours** (fixed, single slot type for now)
- Pricing: flat rate per credit, no packages or bulk discounts at this stage
- Credits are **refundable**
- Credits are stored as a balance on the learner's account

**What needs building:**
- Stripe integration for one-off and Klarna payments
- Webhook handler to confirm payment and credit the learner's account
- Learner dashboard showing current credit balance and transaction history
- Refund flow — learner requests refund, admin approves, Stripe processes reversal, credit deducted from balance

---

### 1.2 — Instructor Availability & Calendar

**How it works:**
Each instructor sets their recurring weekly availability (e.g. Monday 9am–5pm, Wednesday 10am–4pm). The system automatically divides availability into bookable 1.5-hour slots. Booked slots are removed from the calendar in real time.

**Key decisions:**
- Calendar is **custom-built** (no third-party dependency) for full control over how slots, credits, and payments interact
- Learners can book **any available instructor**, not just a specific one
- Booking is **instant confirmation** — no instructor approval needed
- Learners can book up to **3 months in advance**
- **48-hour cancellation policy** — cancellations with 48+ hours notice automatically return the credit to the learner's balance

**What needs building:**
- Instructor availability management (set recurring weekly windows)
- Slot generation engine — converts availability into 1.5hr bookable slots, excluding already-booked times
- Calendar UI for learners — filterable by instructor, date range
- Booking confirmation flow (email/notification to both learner and instructor)
- Cancellation flow with 48-hour policy enforcement and automatic credit return

---

### 1.3 — Data Model

The core system revolves around four entities:

**Instructors**
- Name, contact details, profile info
- Weekly availability windows (day, start time, end time)

**Learners**
- Account details (name, email, phone)
- Credit balance
- Booking history

**Bookings**
- Learner → Instructor link
- Date, start time, end time (always 1.5hrs)
- Status: confirmed, completed, cancelled
- Credit deducted at booking, returned on valid cancellation

**Transactions**
- Stripe payment ID
- Amount paid, payment method (card / Klarna)
- Credits purchased
- Refund records

---

### 1.4 — User Flows

**Learner purchases credits:**
1. Learner logs in → navigates to "Buy Lessons"
2. Selects number of credits
3. Pays via Stripe (card or Klarna)
4. Stripe webhook confirms payment
5. Credits added to learner's balance

**Learner books a lesson:**
1. Learner logs in → opens booking calendar
2. Browses available slots (filtered by instructor or date)
3. Selects a 1.5hr slot
4. One credit deducted from balance
5. Booking confirmed — both learner and instructor notified

**Learner cancels a lesson:**
1. Learner views upcoming bookings
2. Selects a booking to cancel
3. If 48+ hours before the lesson → credit returned automatically
4. If under 48 hours → credit forfeited, learner informed of policy

---

## Phase 2: Future Considerations (Not Yet Scoped)

The following features are on the radar but **not part of the initial build**. They'll be revisited once the core booking system is live and working.

- **Referral system** — reward learners for recommending friends (likely credit-based)
- **Discount / package deals** — bulk credit purchases at reduced rates
- **Progress tracking** — learner dashboard showing lessons completed, skills covered, test readiness
- **Instructor portal** — lesson notes, earnings tracking, learner management
- **Automated reminders** — SMS or email reminders before upcoming lessons
- **Reviews & testimonials** — post-lesson or post-pass review prompts
- **Theory test prep** — built-in revision tools rather than sending learners to third-party apps
- **Online payments for non-lesson services** — theory test booking, intensive course packages
- **Waiting list** — capture leads when all instructors are fully booked

---

## Technical Notes

- **Payments:** Stripe (with Klarna enabled as a payment method within Stripe)
- **Calendar:** Custom-built, no third-party calendar dependency
- **Slot duration:** 1.5 hours (hardcoded for now, can be made configurable later)
- **Advance booking window:** 3 months
- **Cancellation policy:** 48 hours minimum notice for credit return
