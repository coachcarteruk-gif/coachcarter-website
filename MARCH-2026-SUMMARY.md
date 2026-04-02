# CoachCarter — March 2026 Summary

**Period:** 2 March — 2 April 2026 | **Commits:** 230+ | **PRs merged:** 84

---

## From Zero to Full Platform

The month started with the initial commit and ended with a fully functional driving school platform with learner, instructor, and admin portals.

### Core Platform
- Built the full database schema (26 tables) with centralised migration system
- Serverless API on Vercel with `?action=` routing (stayed within Hobby plan limits)
- JWT auth with magic link login (email) and 6-digit SMS verification (Twilio)
- PWA support — installable on phones as a native-feeling app
- Email error alerting on all 500 errors

### Learner Portal
- Dashboard with quick-action nav hub and profile card
- Booking calendar (daily/weekly/monthly views) with real-time availability
- Pay-per-slot booking via Stripe Checkout (Klarna enabled)
- Recurring/repeat bookings (2-8 weeks)
- Multiple lesson types with hours-based balance system
- Session logging wizard with DL25 competency tracking (10 categories, 39 sub-skills)
- My Progress page with radar chart and skill breakdown
- Mock driving test with fault recording and GPS route tracking
- Examiner AI — interactive quiz and knowledge base
- Video classroom with Cloudflare Stream (grid + reels modes)
- Postcode-based address lookup for pickup locations
- iPhone/Google calendar subscription feeds
- Weekly availability preferences and waiting list
- AI-powered onboarding flow and personalised dashboard

### Instructor Portal
- Magic link auth with schedule management
- Calendar with agenda view, daily/weekly/monthly, print support
- Instructor-initiated bookings and lesson offers with discounts
- My Learners page with detail views, notes, and progress
- Earnings dashboard with weekly pay view and history
- Post-lesson dual confirmation system
- Configurable availability, blackout dates, buffer time
- External iCal feed sync (personal calendar blocking)
- Stripe Connect onboarding for payouts
- Admin access switching for instructor-admins

### Admin Portal
- Instructor management (commission rates, franchise fees, payout controls)
- Learner list with search, detail views, and credit adjustment
- Video upload and management (direct + batch TUS upload)
- Booking overview and system configuration

### Payments & Monetisation
- Stripe Checkout with Klarna and promo code support
- Two fee models: commission-based and fixed weekly franchise fee
- Stripe Connect Express for instructor payouts (weekly Friday cron)
- Bulk discount tiers on credit purchases

### Design & UX
- App-style navigation: fixed bottom tabs + collapsible sidebar
- Role selection start page (learner/instructor)
- Redesigned dashboard with hero cards and pill navigation
- Floating pill bottom bar with section-aware highlighting
- Dark/light theme iterations, settled on white + orange brand
- iPhone safe area handling and mobile-first responsive design
- Google Reviews integration on homepage

### Infrastructure & Quality
- PostHog analytics with custom event tracking and A/B testing
- Centralised shared CSS and auth JS across all pages
- Context-aware sidebar navigation (sidebar.js)
- DL25 competency config as single source of truth
- 500-error email alerts on all API routes
- CLAUDE.md with session safeguards and branch check hooks
- Full documentation: PROJECT.md, DEVELOPMENT-ROADMAP.md, MIGRATION-PLAN.md

---

**Next up:** Setmore API integration for booking migration, React Native app build.
