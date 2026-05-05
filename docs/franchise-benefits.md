# CoachCarter Franchise — Benefits Reference

> Reference doc for franchise-fee conversations. Consolidates what a CoachCarter instructor gets in exchange for the weekly franchise fee (or commission %), based on what is currently shipped in production plus what is in the pipeline.
>
> **Scope:** CoachCarter driving school (school_id=1). Some features listed here are CoachCarter-only and are deliberately *not* available to other schools on the InstructorBook platform — see "CoachCarter-only vs InstructorBook" at the bottom.

---

## 1. The headline benefits

The three things a solo ADI cannot easily replicate, no matter how much they pay for off-the-shelf software:

1. **Automated weekly Friday payouts to your bank account.** Learner pays at booking → money sits in CoachCarter's Stripe account → Stripe Connect transfers your share every Friday. No invoicing, no chasing, no bank-transfer admin. **No UK competitor offers this.**
2. **A learner-acquisition pipeline that already works.** Homepage quiz, free-trial funnel, Google Reviews integration, AI tools, and a paid-traffic-ready website. A solo instructor builds this from scratch — or doesn't.
3. **Legal and compliance cover handled at the platform level.** GDPR (cookie consent, data export, right-to-erasure, 7-year retention, audit log), terms acceptance, secure payment handling, security headers, rate limiting. Most solo ADIs are technically non-compliant and don't know it.

---

## 2. What's live today

### Booking & diary
- Branded online booking page with slot-feed UX (slot-first, not calendar-first)
- Multiple lesson types (60/90/120/165 min), colour-coded
- Instant confirmation — no instructor approval step
- Race-condition-safe 10-minute slot reservation during Stripe checkout
- Learner pickup-address capture and "contact first" preference flag
- Configurable per-instructor buffer / travel time between lessons
- Real travel-time checking via postcodes.io and OpenRouteService
- Multiple availability windows per day, blackout date ranges, learner waiting list
- Instructor calendar with weekly / agenda / monthly views
- Pay-per-slot guest checkout (walk-in revenue, no account needed)

### Payments & money
- Stripe-powered learner payments (card + Klarna)
- Hours-based credit balance with bulk discount tiers (5–25%)
- 48-hour auto-refund cancellation policy enforced server-side
- **Automated weekly Friday payouts via Stripe Connect**
- Instructor earnings dashboard with gross / fee / net breakdown
- Two fee models per instructor (set by admin):
  - **Commission %** of each lesson, or
  - **Fixed weekly franchise fee** — capped at weekly gross, you never go negative
- Per-learner custom hourly rate (overrides standard school rate)
- Post-checkout credit verification fallback if a Stripe webhook ever fails

### Calendar integrations
- Outbound `webcal://` feeds (instructor + learner) with VALARM reminders
- Inbound iCal sync (Google / Outlook / Apple) every 15 minutes — personal calendar busy-blocks automatically block bookable slots
- Setmore sync for the legacy CoachCarter import path

### Learner-facing tools (LearnerBook)
- DL25-aligned 17-skill / 39-sub-skill competency framework
- Post-lesson skill self-assessment with traffic-light ratings
- Session logging v2 — instructor sees learner self-assessments inline on completed bookings
- AI Examiner knowledge base
- AI Lesson Advisor
- AI personalisation
- Mock driving test
- "My Progress" page
- Learner onboarding flow
- Video library
- Homepage quiz funnel
- Free Trial flow

### Communication
- WhatsApp, SMS, and email lesson reminders
- Confirmation emails to learner and instructor on booking and cancellation
- `.ics` calendar attachments on booking confirmations

### Platform & admin
- Instructor self-service portal (magic-link login, no password)
- Admin portal: bookings, learners, instructor management
- Audit-logged admin mutations (every change to user data is recorded)
- Sidebar navigation, dark mode, full PWA install (add to home screen)
- Multi-tenant `school_id` isolation on every table

### Compliance / legal cover
- Full GDPR pass: cookie consent, data export, right-to-erasure
- 7-year financial retention with anonymisation (not deletion) for tax compliance
- Audit log for admin actions
- Retention cron: archives inactive learners >3 years, purges after 90 days
- Terms acceptance recorded with timestamp
- Security hardening: SQL-injection-safe queries, central CORS, rate-limited magic links, HSTS + security headers, 28 performance indexes
- Privacy policy listing all data processors

---

## 3. What's in the pipeline

Confirmed roadmap items from [DEVELOPMENT-ROADMAP.md](../DEVELOPMENT-ROADMAP.md) §3 and Phase 4, plus [INSTRUCTORBOOK-PLAN.md](../INSTRUCTORBOOK-PLAN.md):

### Near-term (next 1–3 months)
- **Push notifications** (PWA) — lesson reminders, message alerts
- **24h automated lesson reminders** via email / WhatsApp
- **Refund flow** — learner-initiated, admin-approved
- **Referral system** — unique link per learner, hours bonus both sides
- **Recurring / repeat bookings** — weekly series booked in one transaction
- **Per-service booking links** — shareable marketing URLs (e.g. `?type=2hr`)
- **MTD-ready income export** — CSV / PDF for tax compliance

### Medium-term (3–12 months)
- **Capacitor native wrapper** — iOS App Store and Google Play submission
- **Theory test prep** integrated with the competency system
- **Automated weekly progress reports** — competency-change email digest for learners
- **Accountant partnerships** — pitch driving-instructor accountants as an MTD referral channel

### Longer-term (12+ months)
- **Marketplace / lead-gen directory** — opt-in "Find a driving school" funnel feeding the franchisee's own booking page
- **Insurance / partnership opportunities** flagged in the InstructorBook timeline
- **InstructorBook Pro tier** — branded booking page, analytics, MTD reports, priority support (CoachCarter franchisees get all of this included)

---

## 4. The "saved hours" angle

Things the platform does that a solo ADI typically does manually. Useful when justifying the fee:

| Task | Solo ADI | CoachCarter franchisee |
|---|---|---|
| Taking lesson payments | Bank transfer / cash chasing | Automated at booking |
| Getting paid | Self-invoice, manual transfer | Automatic Friday payout |
| Booking admin | WhatsApp + Google Calendar | Self-serve booking page |
| Cancellation policy | Awkward conversations | Enforced by code |
| GDPR compliance | Usually non-compliant | Handled at platform level |
| Lesson reminders | Manual texts | Auto SMS / WhatsApp / email |
| Travel time between lessons | Mental maths | Calculated automatically |
| Tracking learner progress | Memory + paper | DL25 framework, traffic lights |
| Theory / mock test resources | "Use the app" | Built into learner portal |
| Calendar conflicts (personal life) | Constant juggling | Inbound iCal auto-blocks slots |
| MTD / tax reporting *(pipeline)* | Carrier bag of receipts | One-click CSV / PDF export |

A conservative estimate: **1–3 hours per week** of admin saved, which at a £38/hr lesson rate is £38–114/week of opportunity cost the franchise fee offsets before any other benefit.

---

## 5. CoachCarter-only vs InstructorBook

Important context for franchise conversations: CoachCarter is the **reference implementation** of InstructorBook (the national SaaS), but franchisees get more than the InstructorBook free tier.

| Feature | CoachCarter franchisee | InstructorBook free tier (other schools) |
|---|---|---|
| Booking, payments, payouts | ✅ | ✅ |
| Learner management | ✅ | ✅ |
| Travel time, iCal sync, reminders | ✅ | ✅ |
| White-label branded booking page | ✅ (CoachCarter brand) | ✅ (their brand) |
| DL25 competency framework | ✅ | ❌ |
| AI Examiner / Lesson Advisor / personalisation | ✅ | ❌ |
| Mock test, video library, learner onboarding | ✅ | ❌ |
| Session logging with traffic lights | ✅ | ❌ |
| Free trial funnel, homepage quiz | ✅ | ❌ |
| Google Reviews integration | ✅ | ❌ |
| Marketing site (SEO, pass rates, testimonials) | ✅ | ❌ (their problem) |

The LearnerBook layer (everything in the second block) is what makes CoachCarter franchise different from "just go signup to InstructorBook for free." A franchisee inherits a working learner-acquisition and learner-retention system; an InstructorBook-only school has to build that themselves.

---

## 6. Reference

- Full feature history: [DEVELOPMENT-ROADMAP.md](../DEVELOPMENT-ROADMAP.md)
- National SaaS strategy and pricing: [INSTRUCTORBOOK-PLAN.md](../INSTRUCTORBOOK-PLAN.md)
- Stripe Connect / payout / fee model details: [docs/stripe-connect.md](stripe-connect.md)
- Multi-tenancy model: [docs/multi-tenancy.md](multi-tenancy.md)
- GDPR posture: [docs/gdpr.md](gdpr.md)
- Travel-time engine: [docs/travel-time.md](travel-time.md)
