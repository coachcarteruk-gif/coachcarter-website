# Instructor Experience Plan

**Companion to [FRANCHISE-MODEL-PLAN.md](FRANCHISE-MODEL-PLAN.md).** That document covers schema and code. This one covers the human relationship and commercial reality. The Council critique surfaced that schema correctness alone doesn't make a multi-instructor business work — instructor experience does.

This plan is for **instructor #2's first 90 days**. Patterns from doing it once will inform what's needed at instructor #5.

---

## The success criteria

By end of instructor #2's first 90 days, all of the following should be true. Any failure is a signal that something in either this plan or the technical plan is wrong.

- [ ] They have ≥ 8 regular learners.
- [ ] Their weekly lesson revenue covers the franchise fee in 8+ of 12 weeks.
- [ ] They have not accumulated more than 2 weeks of franchise-fee debt.
- [ ] They report (informally, in conversation) feeling supported, not exploited.
- [ ] They would refer another instructor to CoachCarter.

---

## The cold-start problem

Instructor #2 starts week 1 with zero CoachCarter learners. They pay the franchise fee from day one. Without a deliberate mechanism to route learners to them, every existing learner books Fraser by default and the new instructor pays for nothing for weeks.

**The franchise pitch only works if CoachCarter actually delivers learners.** This is the single most important commercial reality that the technical plan was missing.

### Sources of learners for the new instructor

1. **Net-new learners** signing up via `/free-trial.html`, `book.html`, marketing.
2. **Fraser's overflow** — learners trying to book Fraser when he has no slots.
3. **Geographic-fit learners** — learners in postcodes the new instructor covers better.

### Lead-allocation mechanisms (none currently exist)

In rough priority order:

#### A. Fraser's-overflow routing (highest priority — build first)

When a learner tries to book Fraser and he has no slots in the next 7 days, surface the new instructor's slots with framing like:

> *"Fraser is fully booked this week. Sarah has slots available — would you like to see them?"*

This is the most truthful pitch CoachCarter can make to a new instructor: *"we'll route the learners we can't take to you."* It's also the easiest to build.

**Implementation sketch** (post-MVP, but keep simple):
- On `book.html`, when the chosen-instructor slot feed returns 0 slots in the next 7 days, fetch slots for other active instructors.
- Show as a secondary section: "Other instructors available."
- Do NOT auto-redirect or hide Fraser — the learner still chose Fraser; offer alternatives, don't override.

#### B. New-instructor highlight on `/free-trial.html`

For their first 60-90 days, new instructors get pinned/highlighted on the free-trial signup page with framing like *"now welcoming new learners."*

This converts free-trial signups disproportionately to the new instructor at the moment they have the lowest income.

#### C. Postcode-default routing

If a learner's pickup address is in a postcode area better covered by the new instructor (different town, different cluster), default the booking to them.

This needs `instructors.coverage_postcodes` or similar, plus learner pickup-postcode data which already exists.

#### D. Manual referral by Fraser

Fraser personally introduces learners to the new instructor when his diary is full. Already possible in principle (verbal/email referral); could be formalised into an in-app "refer this learner to another instructor" admin action.

### Recommendation

**Build A (Fraser's overflow) before instructor #2 starts paying franchise fees.** It's the most truthful pitch and the easiest to build. The other three can be done after, or never, depending on how the first instructor's experience plays out.

This is **net-new work not currently in [FRANCHISE-MODEL-PLAN.md](FRANCHISE-MODEL-PLAN.md)**. It should be added as a Phase 2.5 or as a precondition of onboarding instructor #2.

---

## The three crunch moments

Three moments in the first 90 days will shape whether instructor #2 stays. Each is technically handled but must be *humanly* handled.

### Moment 1 — Day of signing

The new instructor reads the franchise agreement and sees the fee structure, the no-debt-cap clause, the contractual commitment, the lack of employment protection. This is the moment of greatest doubt.

**What goes wrong if mishandled**: instructor reads the agreement, gets cold feet, walks away. Or signs but holds resentment that surfaces later.

**Mitigation**:
- A frank pre-signing conversation walking through:
  - **The tier choice**: Full Franchise £195/week with car + decals + dual control, OR Part Franchise £70/week with decals + dual control if you bring your own car. 12-month contract either way.
  - **Break-even reality**: at Full, you need ~3.5 hours/week to cover the fee. At Part, ~1.3 hours/week. To make a £500/week net living, you need ~12-13 hours of delivered lessons at Full, ~10-11 at Part.
  - What "fees accrue regardless of work delivered" means in practice. Sick weeks. Holiday weeks. Quiet weeks. The fee still applies. Admin can override at discretion but doesn't have to.
  - What CoachCarter does for them: lead routing (we'll route learners we can't take to you), marketing, brand, booking system, payment processing, plus the car if you're on Full.
  - Why this isn't employment, and what they keep in return: control of hours, flexibility, growth potential, the ability to leave at end of contract.
  - **Your hourly rate**: "Default school rate is £55/hour. We can set your rate higher or lower based on your experience and what you're comfortable with — senior instructors with strong track records often charge £58-£62; newer instructors building reputation might prefer £50-£53. The rate you set is what your learners pay. We can review this annually."
  - **The bulk-tier opt-in decision**: "You can choose to offer 12h/24h/36h packages at 2.5%/5%/7.5% off. If you opt in, you absorb the discount on those purchases — at £55/hr that's an effective rate of ~£53.63/£52.25/£50.88 depending on package size. At a £60 rate it's ~£58.50/£57.00/£55.50. In exchange, bulk packages typically convert better and lock learners in long-term. Most learners who buy 24+ hour packages stick with their instructor through their test. Your call — and you can change your mind any time, but in-flight credits keep their original rate."
  - **Late cancellations**: a learner cancels 47+ hours before, gets a full refund, your slot was blocked. You don't get paid. Industry average is 5-8% of bookings — for someone doing 10 lessons a week, that's £40-65/week of variance.
- A sample week-by-week earnings projection showing realistic best-case, expected-case, and worst-case scenarios for the first 12 weeks — for both tier options and both bulk-tier opt-in choices.
- Explicit acknowledgment: "the first month is hard; here's what we'll do together to get through it."
- Time to read the agreement at home and ask questions before signing.

### Moment 2 — First negative-payout week

Their lessons in week N didn't cover the franchise fee. Standard automated invoicing would feel cold and transactional.

**What goes wrong if mishandled**: instructor receives a Stripe Invoice email. Feels like a parking ticket. Realises this is a business that automatically debits them when they're already having a bad week. Resentment compounds.

**Mitigation — Year-one rule: no automated invoicing.**
- Fraser personally messages or calls the instructor mid-week if it looks like they'll be short.
- Conversation focuses on: "how's the week going? what's making it hard? what can we do to help?"
- The shortfall is paid by manual bank transfer or a Stripe Payment Link sent personally — not via auto-DD.
- Once paid, it's logged in a notes file. No public-facing "you owe X" dashboard.

This is the Empath's point: automating the human moments is wrong in year one.

### Moment 3 — First tricky cancellation/refund

Learner cancels 47 hours before. Full refund returned to learner. Instructor's slot was blocked from being rebooked. They lose income through no fault of theirs.

**What goes wrong if mishandled**: instructor sees the platform paying a learner back at their expense. Feels exploited. Doesn't trust the rules.

**Mitigation**:
- Communicate this upfront in the franchise agreement and the pre-signing conversation. Show real numbers: *"on average X% of bookings cancel late; here's how that affects weekly earnings; we don't make you absorb the cost via clawback, but we don't compensate either — that's the deal."*
- When it happens for the first time, Fraser proactively reaches out: *"I saw the cancellation. That's annoying. Anything we can do to backfill it from waitlist/availability/etc?"*
- Surface an admin-side notification when a tier-1 instructor (i.e., new instructor, first 90 days) has a late cancellation, so Fraser can intervene.

---

## Fraser's role with instructor #2 onboard

This is worth being explicit about. Fraser is now wearing three hats simultaneously:

1. **Instructor**: his own learners, his own teaching, his own diary.
2. **Mentor / advocate**: instructor #2's go-to person for questions, problems, business advice. In the franchise model the franchisor is supposed to *help the franchisee succeed*.
3. **Platform admin**: marketing, pricing, override decisions, payouts, system maintenance.

These compete for time. The risk: instructor #2 hits a problem in week 4, can't reach Fraser (he's teaching), problem festers, instructor leaves.

**Mitigation — deliberate slack in Fraser's teaching diary for instructor #2's first 90 days.**

Concretely: Fraser blocks one half-day per week as "instructor support time." Used for:
- Checking in on the new instructor.
- Reviewing the previous week's payout together.
- Helping with operational issues.
- Onboarding marketing pushes.
- Just being available.

If unused, fine — that's OK time. If used, it was the most important time of the week. **The cost of this slack is real (one fewer half-day of Fraser's teaching revenue per week, ~£200-300/week) and should be priced into the franchise tier fees.**

---

## What to track during the 90 days

Light-touch metrics. Not a dashboard. A weekly check-in.

| Week | Lessons delivered | Revenue | Franchise fee | Net | Notes |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| ... | | | | | |
| 12 | | | | | |

Plus a qualitative log:
- What's going well?
- What's frustrating them?
- Have they had any "I thought about quitting" moments?
- Are learners speaking positively about them?

A spreadsheet is fine. The point is to *notice* drift, not to build dashboards.

---

## Decision points during the 90 days

Pre-decided trigger points so you don't have to re-think them under pressure:

| Week | If... | Then... |
|---|---|---|
| 4 | They have <3 regular learners | Increase lead-allocation effort. Consider temporary franchise fee reduction. |
| 8 | They have <6 regular learners | Have a frank conversation about whether the fit is right. Don't let it drift. |
| 12 | Any of the success criteria failed | Review what went wrong before considering instructor #3. |

The point: *don't onboard instructor #3 until you've done a clean post-mortem of instructor #2's first 90 days.*

---

## What this plan deliberately does NOT include

- Schema or code (lives in [FRANCHISE-MODEL-PLAN.md](FRANCHISE-MODEL-PLAN.md)).
- Year-2+ scaling. This is for instructor #2 only.
- A specific marketing plan. The lead-allocation mechanism (section A above) is the structural change; specific marketing tactics emerge from running it.
- Post-90-day reviews of the broader franchise model. Those happen after instructor #2's 90 days, informed by what actually happened.

---

## Reciprocal trigger conditions

These conditions, observed during instructor #2's first 90 days, trigger building deferred technical phases (see Alternatives Appendix in [FRANCHISE-MODEL-PLAN.md](FRANCHISE-MODEL-PLAN.md)):

| Trigger observed | Build |
|---|---|
| ≥3 manual shortfall invoices for instructor #2 | Automated debt tracking + Bacs DD invoicing |
| Fraser is manually adjusting `weekly_franchise_fee_pence` >once/quarter | `franchise_fee_overrides` table + admin UI |
| You want to run a **time-bound campaign promo** (e.g. spring sale) where instructor #2 participates | `marketing_promos` (with `starts_at`/`ends_at`) + `instructor_promo_optins` |
| Instructor #2 wants their own bulk tiers (e.g. 20h package at 3% off) different from CoachCarter's standard 12/24/36 | Per-instructor custom bulk-tier definitions (extends MVP's `bulk_tiers_enabled` toggle into a structured config) |
| Instructor #2 wants to charge a different hourly rate than £55 | (Already in MVP — admin can set per-instructor `hourly_rate_pence` via instructor edit form. Configurable from day one.) |
| Tier-A car management starts being a spreadsheet hassle | `vehicles` table |
| Onboarding instructor #3 means tracking 3 contracts | `contract_end_date` + `contract_term_months` columns |

The point: **defer until pain. Build when pain shows up.**
