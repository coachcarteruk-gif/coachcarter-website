# InstructorBook — Product & Launch Plan

> **Domain:** instructorbook.co.uk
> **Tagline:** "Free to use. We only charge when we pay you."
> **Date:** April 2026

---

## 1. Product Definition

**InstructorBook** is a free booking, diary, and payment platform for UK driving instructors. Its unique feature is automated weekly payouts via Stripe Connect — no competitor offers this.

InstructorBook is an **independent platform** — not publicly tied to CoachCarter or Fraser personally. This is deliberate: competing driving schools won't trust a platform visibly built by a rival instructor.

**CoachCarter becomes a school within the InstructorBook network** — school #1, the reference implementation. It demonstrates what InstructorBook can do, but learners on coachcarter.uk never see "InstructorBook" anywhere. The B2B brand (InstructorBook, for school owners) and B2C brand (CoachCarter, for learners) are completely separate.

Learning features (videos, quizzes, progress tracking, mock tests) are excluded from InstructorBook — these become **LearnerBook**, initially CoachCarter-exclusive.

### Why two products, not one?

Booking a lesson and studying for a theory test are different mental modes. Combining them creates a cluttered experience that serves neither well. Separating them also makes InstructorBook a clean, focused pitch to any driving school nationally — they get exactly what they need without features they didn't ask for.

### Brand architecture

- **instructorbook.co.uk** — B2B marketing site targeting school owners. Independent brand.
- **coachcarter.uk** — unchanged. Full learner experience (booking + LearnerBook). Powered by InstructorBook under the hood, but learners never see this.
- **Other schools** — get their own branded domain/subdomain, powered by InstructorBook. Their learners never see "InstructorBook" either.
- **The Stripe model** — InstructorBook is invisible infrastructure. Schools' brands are primary. This builds trust because schools know InstructorBook isn't competing for their learners.

### The CoachCarter front door

coachcarter.uk stays exactly as it is for learners. The one improvement: add a school-specific landing section (pass rates, testimonials, areas covered) for unauthenticated first-time visitors before the role selector. This addresses the "front door problem" — new visitors need social proof before creating an account. This landing section becomes a platform feature available to all InstructorBook schools via the `schools.config` JSONB column.

### What InstructorBook includes

- Instructor diary & availability management
- Online learner booking (slot feed, not calendar)
- Stripe-powered learner payments
- Automated Friday payouts to instructor bank accounts
- Learner management (contact details, upcoming lessons, booking history)
- Lesson reminders (SMS/email)
- Travel time checking between lessons
- School admin panel (multi-instructor management)
- White-label branding per school (colours, logo, name)
- MTD-ready income reports

### What it does NOT include (LearnerBook)

- DL25 competency progress tracking
- Practice session logging
- Instructional videos
- Quizzes / Examiner AI
- Mock tests

---

## 2. Pricing Model

### Why Model D (free + payout fee)?

Four pricing models were evaluated through scenario analysis:

| Model | Effective Cost | Verdict |
|---|---|---|
| A: Flat £15/mo | £15/mo | Triggers comparison shopping against MyDriveTime (£19) and Total Drive (£10). No compelling reason to switch. |
| B: 2-3% transaction fee | £80-112/mo | Deceptively expensive. ADI Facebook groups would calculate the real cost within days. Reputational suicide in a tight community. |
| C: Freemium + 1.5% fee | £57/mo | Two revenue streams = two decisions for users. Confusion kills conversion. |
| **D: Free + 0.75% payout fee** | **~£30/mo** | Zero adoption barrier. Fee is invisible (~£7/week). Only charges when delivering value. Simplest pitch. |

### How the maths works

- Full-time instructor: 25 lessons/week x £38 = £950/week gross
- 0.75% of £950 = £7.13/week = ~£30/month
- Stripe's own fee on payouts (~0.25%) comes out of InstructorBook's margin, not the instructor's

### Revenue projections

| Payout Users | Monthly Revenue | Annual Revenue |
|---|---|---|
| 100 | ~£3,000 | ~£36K |
| 500 | ~£15,000 | ~£180K |
| 1,000 | ~£30,000 | ~£360K |

### Phase 2 (after 12 months): Pro tier

Once trust is established and the user base is 500+, introduce InstructorBook Pro at £10-15/mo:
- Branded booking page (custom URL, school colours/logo)
- Analytics dashboard (booking trends, revenue, busiest times)
- MTD income reports (PDF/CSV export)
- Priority support

Never take away features people already have for free. Pro adds new capabilities on top.

---

## 3. Market & Competitive Position

### Market size

- 39,195 ADIs + ~4,000 PDIs = ~43,000 instructors nationally
- Average lesson: £36-40/hr
- UK driving school industry: ~£570-700M/year
- Software TAM: ~£7.7M/year (43K instructors x ~£15/mo)

### Competitors

| Name | Price | Payouts | Strength | Weakness |
|---|---|---|---|---|
| MyDriveTime | £19/mo | No | Market leader since 2014, brand trust | No payment automation, expensive |
| Total Drive | £10-12/mo | No | 5,000+ users, cheap | Basic payment features |
| ADI Book | Unknown | No | 6,500 weekly users | Limited payment integration |
| GoRoadie | £15/mo + 1.9% | No | Closest to payment integration | Marketplace model, not white-label |
| ADI Network | Free | No | Free attracts users | Limited features, unclear revenue model |

### InstructorBook's advantages

1. **Automated payouts** — genuinely unique, no competitor does this
2. **White-label branding** — schools get their own branded experience
3. **Travel time checking** — no competitor factors drive time between lessons
4. **Multi-tenant from day one** — built for schools, not bolted on
5. **Free with transparent pricing** — no hidden costs, no comparison shopping

### The real competitor

Not MyDriveTime. It's **WhatsApp + Google Calendar + bank transfer** — which costs nothing and is "good enough." InstructorBook must be so effortless that switching feels like relief, not work.

---

## 4. Target Customers (in priority order)

### Tier 1: Solo ADIs who are digitally comfortable (first 6 months)
- ~10,000 instructors
- Already use Square/Zettle/bank transfers
- Pain: chasing payments, manual admin, MTD compliance
- Pitch: "Stop chasing payments. Get paid automatically every Friday."

### Tier 2: Small schools (2-5 instructors) (months 6-12)
- ~2,000 schools
- Need multi-instructor coordination
- Pain: managing multiple diaries, splitting payments, tracking who's owed what
- Pitch: "One dashboard for your whole school. Every instructor paid automatically."

### Tier 3: Larger schools and franchises (months 12+)
- ~500 schools
- Need branded experience, reporting, enterprise features
- Pitch: "Your school, your brand, your booking system. We handle the payments."

---

## 5. Technical Implementation

### Approach: one codebase, two front doors

The Consciousness Council unanimously agreed: don't fork the codebase. InstructorBook and CoachCarter share everything except the presentation layer.

### What needs building

**1. Landing page (instructorbook.co.uk)**
- Single page: hero, features, pricing, social proof, CTA
- No signup wall to browse — show the product first
- Mobile-first (instructors browse on phones between lessons)

**2. Self-service signup flow**
- Currently school creation is superadmin-only via `/api/schools?action=create`
- Need public signup: name, email, phone → school created → set hours → get booking link
- 3 steps maximum. Under 2 minutes.
- Stripe Connect onboarding integrated into signup (or prompted on first payout setup)

**3. Feature flags per school**
- Add to `schools.config` JSONB: `{ "learnerbook_enabled": true/false }`
- CoachCarter (school_id=1): `learnerbook_enabled: true`
- New InstructorBook schools: `learnerbook_enabled: false`
- Sidebar navigation, bottom tabs, and page access respect this flag
- No code deletion — learning features are hidden, not removed

**4. MTD income export**
- New API action: `/api/connect?action=income-report`
- Returns all payments received in a date range with dates, amounts, learner names
- CSV and PDF download options
- Simple but essential for the compliance pitch

**5. Stripe trust branding**
- "Powered by Stripe" badge on all payment and payout screens
- "Your money is held by Stripe, the same company trusted by Amazon and Shopify"
- Stripe's security logos and compliance badges
- This resolves the #1 trust barrier for a solo-developer product

**6. Learner booking flow (simplified)**
- The existing slot feed works well
- For InstructorBook schools: strip learning nav, keep only booking + upcoming lessons + profile
- Learner experience: find slot → book → pay → done

### What already works (no changes needed)

- Multi-tenant architecture (school_id scoping)
- Stripe Connect payouts (weekly Friday cron)
- Instructor availability management
- Slot feed booking
- Travel time checking
- Lesson reminders
- Admin panel

---

## 6. Go-to-Market

### Launch strategy

1. **Soft launch to Fraser's network** — fellow instructors, local school contacts
2. **ADI Facebook groups** — not as ads, as genuine "I built this, try it free" posts from a fellow instructor
3. **Instructor-to-instructor referral** — "Free to use" makes it easy to recommend with no guilt
4. **MTD angle** — target accounting/tax content that ADIs search for around tax deadlines

### Key metric: payout activation rate

The single most important number is: **what % of free signups activate payouts?**

Everything else (signups, page views, session time) is vanity. Payout activation = revenue.

### Decision triggers

| Signal | When | Action |
|---|---|---|
| Payout activation >30% | First 3 months | Stay course, invest in growth |
| Payout activation <15% | After 6 months | Add Pro tier (£5-10/mo) as baseline revenue |
| Facebook backlash | Any time | Review fee, adjust messaging |
| School with 10+ instructors | Any time | Build enterprise pricing, prioritise their needs |
| Competitor copies payouts | Any time | Accelerate — first mover advantage matters |

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Instructors use free tools but don't activate payouts | Medium | Stripe branding for trust, case studies, in-app nudges showing "you could save X hours" |
| 0.75% margin too thin after Stripe fees | Medium | Phase 2 Pro tier adds subscription revenue; monitor unit economics monthly |
| MyDriveTime copies automated payouts | Low-Medium | They'd need to rebuild on Stripe Connect — 6-12 month head start |
| Solo developer can't support growing user base | Medium | Keep architecture simple, invest in reliability over features, hire support when revenue allows |
| ADI community backlash on pricing | Low | 0.75% is genuinely cheap and transparently communicated. No "gotcha" moment. |

---

## 8. Timeline

### Month 1: Launch foundations
- [ ] Landing page on instructorbook.co.uk
- [ ] Self-service signup flow
- [ ] Feature flags for learning tools
- [ ] Stripe trust branding
- [ ] MTD income export

### Month 2-3: Soft launch
- [ ] Invite 10-20 instructors from Fraser's network
- [ ] Collect feedback, fix friction
- [ ] First testimonial / case study
- [ ] Begin posting in ADI Facebook groups

### Month 4-6: Growth
- [ ] Public launch
- [ ] Track payout activation rate weekly
- [ ] Iterate on onboarding based on where users drop off
- [ ] Build school-specific features if demand appears

### Month 7-12: Scale
- [ ] Target 500 users, 150+ on payouts
- [ ] Evaluate Pro tier timing
- [ ] Begin React Native app planning
- [ ] Explore insurance/partnership opportunities

### Month 12-18: Monetise trust
- [ ] Launch Pro tier
- [ ] Consider LearnerBook as paid add-on for schools
- [ ] Evaluate hiring first support/marketing person

---

## 9. Marketplace Strategy (Phased)

InstructorBook will evolve toward a learner discovery marketplace — but only after the SaaS has proven product-market fit. Validated by Consciousness Council analysis (April 2026).

### Why not build the marketplace now?

- **Chicken-and-egg problem** — a marketplace with 3 instructors listed is worse than no marketplace
- **Channel conflict risk** — schools sign up for a tool, not to be listed next to competitors
- **Solo founder bandwidth** — marketplace requires SEO, review systems, search UX, moderation. Each is a multi-week project competing with core SaaS work
- **Historical precedent** — OpenTable, Treatwell, Mindbody all started as tools, added marketplace later. GoRoadie started marketplace-first and has thin supply and high fees as a result

### The phased approach

**Phase 1 — Pure SaaS (2026, 0-100 schools)**
- No marketplace. No public directory.
- Pitch: "We run your bookings, payments, and payouts. Your brand, your learners, your business."
- InstructorBook is invisible infrastructure — the Stripe model.

**Phase 2 — Lead-gen directory (2027, 100+ schools)**
- Add a simple "Find a driving school" page on instructorbook.co.uk
- Strictly **opt-in** — schools choose whether to be listed
- Shows: school name, area covered, link to THEIR booking page (on their own domain)
- No price comparison, no reviews, no booking through InstructorBook
- This is lead generation, not a marketplace
- Can be faked cheaply from existing school data (postcode search)

**Phase 3 — Marketplace evaluation (2028, 500+ schools)**
- Evaluate whether to build a real marketplace with reviews, comparison, and direct booking
- By then: real data on whether schools want it, whether learners use the directory, whether GoRoadie is still relevant
- **Decide with evidence, not speculation**

**Phase 4 — Full marketplace (if validated)**
- Shopify "Shop app" model: opt-in discovery layer, not a replacement for school identity
- Schools control their profile, their pricing, their brand
- Learners who book via marketplace become THAT SCHOOL'S customer, not InstructorBook's
- Position marketplace features for newly qualified ADIs who need clients (avoids threatening established instructors with full books)

### Key marketplace principles

1. **Always opt-in** — no school is ever listed without explicit consent
2. **School brand primary** — InstructorBook is infrastructure, not the storefront
3. **No price comparison without consent** — schools control what's visible
4. **Marketplace doesn't need to be a profit centre** — it can be a free customer acquisition channel for the SaaS (InstructorBook already earns from 0.75% payouts)
5. **Learners acquired via marketplace belong to the school** — InstructorBook never emails them, never redirects them, never claims the relationship

### Risks to watch

| Risk | Mitigation |
|---|---|
| Schools feel marketplace competes with them | Opt-in only, school controls profile, no price comparison by default |
| Marketplace attracts low-quality leads (price shoppers) | Position for new ADIs needing clients, not established instructors |
| "Who built InstructorBook?" reveals Fraser/CoachCarter connection | InstructorBook presented as independent platform, not tied to any school |
| UK GDPR implications of holding learner data across schools | Legal review before Phase 3; InstructorBook becomes data controller, not just processor |
| Marketplace makes schools feel like commodity supply (the Deliveroo problem) | Shopify model — schools keep their identity, marketplace is optional reach |

### The question to revisit at Phase 3

> *If InstructorBook's marketplace becomes the primary way learners find instructors, do the schools still need their own websites and brands — or have we accidentally made them redundant?*

The answer must be "yes, they still need their own brand" — otherwise we've become the problem, not the solution.
