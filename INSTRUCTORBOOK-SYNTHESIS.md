# InstructorBook Launch Synthesis

> Consolidated from four independent analyses: Critical Thinking Evaluation, Hypothesis Generation, Distribution Brainstorming, and What-If Scenario Analysis.
> Date: April 2026

---

## 1. Where All Four Reports Agree

These findings emerged independently across all analyses. Treat them as high-confidence.

**The real competitor is inertia, not software.** WhatsApp + Google Calendar + bank transfers is "good enough" for most instructors. Every report concluded that the battle is habit change, not feature comparison. Marketing must address why an instructor would change what already works, not why InstructorBook is better than MyDriveTime.

**The MVP must be the full booking-to-payout loop.** A payouts-only product fails (Report 4: 75% failure probability). Learners need to book and pay through the platform before there is anything to pay out. The automated payout is the hook, but the booking system is the prerequisite. This is already built — CoachCarter has the complete loop running in production.

**Zero customer validation has been done.** Every report flagged this as the single biggest gap. The strategy is internally coherent but untested against real instructor opinions. No interviews, no surveys, no letters of intent. The plan is arithmetic dressed as a forecast. This must be fixed before any launch investment.

**Fraser's bandwidth is the binding constraint.** Teaching 30+ hours per week leaves roughly 10-15 hours for everything else. Every timeline, feature scope, and support commitment must be filtered through this reality. The reports converge on: do less, but do it with real people.

**The 0.75% pricing model is the right call.** All four reports support keeping it. It creates a category of one (no UK competitor uses this model), eliminates the adoption barrier, and aligns revenue with value delivery. Report 1 flags that the real margin is ~0.50% after Stripe's cut, which is worth knowing but does not change the decision. Report 4 gives 90% confidence. Keep it.

**Friends and personal network first, not Facebook groups.** Cold posts in ADI Facebook groups are high-risk (mod removal, low trust, no social proof). The reliable path is: people who already trust Fraser, then their referrals, then public channels with testimonials in hand. Report 4 puts friend-of-friend referrals at 60% success vs Facebook posts at 30%.

---

## 2. Where the Reports Disagree or Add Tension

### Tension 1: Concealment vs Transparency

**The disagreement:** The existing plan says hide the CoachCarter connection because competing schools will not trust a rival instructor's platform. Reports 1, 3, and 4 all push back on this.

**Resolution: Be transparent, but phase it.**

The concealment strategy is fragile. Report 4 gives 80% probability that transparency is better. Report 1 notes that "built by a working instructor" could be stronger positioning than "anonymous SaaS." Report 3 argues that at 0-50 users, Fraser IS the credibility — there is no team, no brand equity, nothing else to trust.

The practical answer: Fraser only directly competes with roughly 50 instructors in the Sunderland area. For the other 42,950+ ADIs nationally, he is a colleague who built something useful, not a competitor. Discovery of concealment would create a far worse narrative than upfront honesty.

**Action:** Lead with "I'm a working instructor, I built this for myself, now I'm sharing it." Use the CoachCarter connection as proof it works in production. Revisit brand separation at 100+ users if school owners express concern.

### Tension 2: "Automated payouts are unique" — How Defensible Is This?

**The disagreement:** The existing plan treats automated payouts as a durable moat. Report 1 says the barrier to copying is low and asks: why has no one done this already? Report 4 gives 25-35% probability a competitor copies it within 6 months.

**Resolution: The payout feature is a hook, not a moat.**

The real defensibility comes from things that are harder to copy: personal relationships with early users, white-label branding quality, the "free" positioning (incumbents with subscription revenue cannot easily drop to 0.75%), and the trust built over months of reliable Friday payouts. Stripe Connect integration is a weekend of work for any funded competitor.

**Action:** Do not over-index on payouts in marketing. Position InstructorBook as "the free platform that handles everything — including paying you automatically." The full package matters more than any single feature.

### Tension 3: Pricing Framing — Percentage vs Flat Equivalent

**The disagreement:** Report 1 flags that "0.75% feels invisible" is selective framing. Part-time instructors pay ~£18/month. Full-timers pay ~£30/month. Percentage fees trigger loss aversion more than flat subscriptions in behavioural economics research. Report 2 proposes testing this directly.

**Resolution: Test the framing, but keep the model.**

The 0.75% model is correct. The question is how to present it. Some instructors will calculate the monthly cost and compare it to £10/month flat-fee competitors. The pitch needs to preempt this: "Yes, it works out to about £7 a week for a full diary. But you pay nothing when you're quiet, nothing to get started, and we only take our cut when we've already put the money in your account."

**Action:** Run the H3 pricing framing test (two versions of the pitch) during the survey phase. Use the results to write the landing page copy.

### Tension 4: What "Model E" (Flat Fee + Payouts) Would Look Like

**The disagreement:** Report 1 says the pricing comparison was rigged because it did not consider a flat monthly fee (say £10) that also includes automated payouts. This hybrid could beat pure 0.75% on perceived value for high-volume instructors.

**Resolution: Acknowledge but defer.**

Model E is worth considering at scale (500+ users) as a "Pro" tier option. But introducing pricing complexity before product-market fit is a distraction. One price, one model, no decisions for the user. If high-volume instructors complain about the percentage later, that is a good problem to have — it means there are enough users to justify a second tier.

**Action:** Note Model E as a future Pro tier option. Do not implement now.

---

## 3. Five Critical Questions Fraser Must Answer Before Building

These are drawn from the kill criteria across all four reports. Each has a specific test and a specific threshold.

### Q1: Do instructors actually want automated payouts enough to switch?

**Test:** Google Form survey posted in 3 ADI Facebook groups. Ask: "Rank these in order of importance: online booking, automated payments to your bank, learner management, diary/calendar, branded booking page." Also ask current tools and whether they accept card payments.

**Kill criterion:** Fewer than 25% of card-accepting respondents rank payouts in their top 3. If this fails, the entire value proposition needs rethinking.

**Why this matters:** If instructors who already take card payments do not care about automated payouts, the hook does not work. If most instructors are cash/bank-transfer-only (Report 2, H2), then InstructorBook needs to solve payment collection first — a much harder problem.

### Q2: Will instructors in Facebook groups engage, or will posts get removed?

**Test:** Post a "research question" (not a product pitch) in 3 groups. "I'm a Sunderland-based ADI building a free booking tool. Before I share it, I want to know what features matter most to you. 2-minute survey: [link]."

**Kill criterion:** Post removed from 2 out of 3 groups, or fewer than 5 interested responses total. If Facebook groups are hostile to this, the primary distribution channel is dead and you need a completely different go-to-market.

### Q3: Does the CoachCarter connection help or hurt?

**Test:** Show two versions of the pitch to 5-10 instructor acquaintances. Version A: "InstructorBook, a new platform for driving instructors." Version B: "I built this for my own school (CoachCarter), and now I'm making it available to everyone." Ask which they would be more likely to try.

**Kill criterion:** If Version B scores equal or higher with 7+ out of 10 people, drop the concealment strategy permanently. If Version A scores meaningfully higher, maintain separation.

### Q4: Will free users activate payouts within 60 days?

**Test:** Track during soft launch with first 10 users. Count how many connect their Stripe account and receive at least one payout.

**Kill criterion:** Fewer than 2 out of 10 activate payouts within 90 days. If users take the free booking system but never connect Stripe, InstructorBook has no revenue model.

### Q5: Can Fraser actually support paying users while teaching full-time?

**Test:** During soft launch, log every support request and the time spent on it. Calculate: at 50 users with this support-per-user rate, how many hours per week would support consume?

**Kill criterion:** If 10 users generate more than 5 hours per week of support, the solo-operator model breaks before reaching revenue that could fund help. Either automate aggressively or plan to hire part-time support earlier than expected.

---

## 4. The 90-Day Action Plan

### Guiding principle

Do not write a single line of InstructorBook-specific code until Q1 and Q2 are answered. The platform already works (CoachCarter is live). The risk is not technical — it is whether anyone wants it.

### Phase 1: Validate (Weeks 1-4)

**Week 1 (2-3 hours total)**

- Write the Google Form survey (15-20 questions). Include: current tools, card payment acceptance, feature ranking, switching triggers, willingness to try a free tool, and the open-ended "What would make you switch from what you use now?"
- Write two versions of a 150-word pitch (concealment test). Print or save to phone for in-person tests.
- Design the Friday payout notification screen. Make it visually satisfying and screenshot-worthy. This is marketing material even before launch.

**Week 2 (2-3 hours total)**

- Post the survey in 3 ADI Facebook groups using the "I'm building this, help me get it right" framing. Be honest about being an ADI. Do not mention CoachCarter by name unless asked.
- Show the two pitch versions to 5-10 instructor acquaintances (in person, at test centres, at training sessions). Record which version they prefer and why.
- Ask 3 non-instructor friends to spend 10 minutes googling "who built InstructorBook" to test discoverability of the CoachCarter connection.

**Week 3 (1-2 hours)**

- Collect survey results. Minimum viable sample: 30 responses. If fewer, extend by one week or try additional groups.
- Tally the concealment test results.
- Score against kill criteria for Q1, Q2, and Q3.

**Week 4 (decision point)**

- **If Q1 and Q2 pass:** Proceed to Phase 2.
- **If Q1 fails (payouts not valued):** Stop. Reassess the entire value proposition. Consider whether a different hook exists in the survey data.
- **If Q2 fails (groups hostile):** Pivot distribution to accountant channel and ADI trainer pipeline (see Phase 2 alternatives). Do not rely on Facebook.
- **If Q3 shows transparency wins:** Update all planned marketing to lead with Fraser's identity.

### Phase 2: Prepare and Seed (Weeks 5-8)

This phase only happens if Phase 1 passes.

**Week 5 (3-4 hours)**

- Set up instructorbook.co.uk landing page. Single page: headline, three benefit bullets, screenshot of the payout notification, "Join the first 10 instructors" CTA with email capture. No login, no app — just a waiting list.
- Create the onboarding flow: what happens when someone clicks "get started"? Map out the 5-minute path from signup to first booking page live. Write it down step by step. Identify where Fraser needs to manually help vs where it is self-service.

**Week 6 (3-4 hours)**

- Write and send personal messages to 5-10 instructors from the survey who expressed interest. "You said you'd try a free booking tool — I've built one. Can I set you up this week? Takes 10 minutes."
- Goal: 3-5 confirmed soft launch users who are not Fraser's direct competitors (i.e., outside Sunderland or in non-overlapping areas).

**Week 7 (2-3 hours)**

- Onboard the first 2-3 users with white-glove support. Be on WhatsApp or phone. Walk them through everything. Log every friction point and every question.
- Email 10 accountants who specialise in driving instructors (findable via Google: "accountant driving instructor tax"). Pitch: "Your clients get automated MTD-ready income reports. No more carrier bags of receipts." Ask if they would mention it to clients.

**Week 8 (2 hours)**

- Onboard remaining soft launch users.
- First Friday payout. Verify it works. Ask users to screenshot and share if they are happy with it.
- Log support time spent so far (feeds Q5).

### Phase 3: Grow or Stop (Weeks 9-12)

**Week 9-10 (2-3 hours)**

- Collect first testimonials from soft launch users. Even a one-line WhatsApp message works.
- If Q4 is passing (users activating payouts): write the "I Built This for Myself" Facebook post. Use real numbers: "X instructors using it, Y lessons booked this month, Z paid out automatically last Friday." Include a testimonial.
- If Q4 is failing (users not connecting Stripe): pause public marketing. Talk to the non-activators. Find out why.

**Week 10-11 (2-3 hours)**

- Post in Facebook groups WITH social proof (testimonials, real usage numbers). This is a fundamentally different post than a cold pitch.
- Contact 3-5 ADI trainers. Offer a "New Instructor Starter Kit" PDF (free, genuinely useful) that mentions InstructorBook as the recommended booking platform. New instructors have zero switching cost — they have not built habits yet.

**Week 12 (decision point)**

- Count: how many users? How many activated payouts? How much support time?
- Score against all five kill criteria.
- Make the continue/pivot/stop decision (see Section 5).

---

## 5. Decision Triggers

### Week 4 Gate (after survey)

| Signal | Action |
|---|---|
| 25%+ rank payouts top 3, Facebook posts stayed up, 30+ responses | Proceed to Phase 2 |
| Payouts ranked low but another feature ranked high | Pivot messaging to that feature, re-test |
| Posts removed from 2/3 groups | Pivot distribution to accountants + trainers, skip Facebook |
| Fewer than 15 total responses after 2 weeks | The market is not reachable via this channel. Try in-person at test centres or instructor meetups before giving up |

### Week 8 Gate (after soft launch)

| Signal | Action |
|---|---|
| 3+ users onboarded, first payout successful, support load manageable | Proceed to Phase 3 |
| Users signed up but did not book any learners through the platform | Investigate — is the booking flow broken, or do they not have learners willing to book online? |
| Could not find 3 willing soft launch users despite survey interest | The gap between "I'd try it" and actually trying it is too wide. Investigate friction. |

### Week 12 Gate (go/no-go)

| Signal | Action |
|---|---|
| 10+ users, 50%+ payout activation, under 3 hrs/week support, at least 1 organic referral | Continue. InstructorBook has legs. Plan for 50 users by month 6. |
| 5-10 users but low payout activation | The free booking tool has value but the revenue model does not work. Consider: flat fee, or accept this is a long funnel where payouts activate over months, not weeks. |
| Fewer than 5 users despite effort | Talk to the people who said no. If the reason is "not right now" (timing), wait. If the reason is "I don't need this" (product), stop. |
| Support consuming 5+ hrs/week at 10 users | Automate the top 3 support requests before growing further. If they cannot be automated, hire part-time help or cap user growth. |

### The Hard Stop

If, at week 12, Fraser has fewer than 5 active users AND cannot identify a specific fixable reason, the honest answer is: shelf InstructorBook, keep CoachCarter running as a single-school platform, and revisit in 6 months when more data exists. The opportunity cost of building without traction is roughly 750 pounds per week in foregone teaching income plus the burnout risk of running two things badly.

---

## Summary for Fraser

The product is built. The pricing is right. The code works. What is missing is proof that anyone outside your own school wants it badly enough to actually switch. That proof costs zero pounds and about 10 hours over 4 weeks. Get it before doing anything else.

The most likely path to your first 10 users is not a Facebook ad or a landing page — it is you, personally, helping 5 instructors you already know get set up and seeing their reaction when the first Friday payout lands. If that moment does not create excitement, no amount of marketing will fix it.
