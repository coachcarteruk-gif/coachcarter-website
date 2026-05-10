# Franchise Plan of Action — 2026-05-09

> **Recent activity (most recent first)** — fresh sessions read this first to land soft.
>
> **2026-05-10 (evening)** — **1.2 shipped.** Overflow lead routing on `book.html`. When a chosen instructor has zero slots in the full 84-day window AND the school has more than one active instructor, the empty state is replaced with heading + subhead + a slot-feed of alternatives from the school's other instructors. Eager 84-day fetch on chosen-instructor selection (needed to know they're truly empty before declaring overflow); alternatives cached by `${ltId}|${postcode}`; chosen-instructor mode now hides "load more" since 84 days render at once. No API changes. Verified visually across four states (overflow-with-alternatives, overflow-no-alternatives, single-instructor-school fallback, healthy diary). Mobile heading wraps cleanly to 2 lines even with long first names. DEVELOPMENT-ROADMAP entry 2.67 has the full picture.
>
> **2026-05-10 (PM)** — **1.3 + 2.10 shipped.** Three columns added to `instructor_payouts` (`shortfall_pence`, `shortfall_recovered_from_payout_id`, `deposit_deducted_pence`) plus partial index. Payout helper now reads prior unrecovered shortfall, applies full-or-nothing recovery, week-1 + Full-Franchise heuristic deducts £250 (partial-amount tolerant). Zero-payout case skips Stripe (rejects amount=0) but still marks completed and applies recovery. Statement email reframed as "Weekly Statement" on £0 weeks with deposit/recovery/shortfall sub-lines. Earnings page shows outstanding-balance banner + per-payout sub-rows. DEVELOPMENT-ROADMAP entry 2.66 has the full picture.
>
> **2026-05-10** — Tier 1 cleared by 5 items in one drafting marathon: 1.4 (decal £200), 1.5 (privacy rewrite — CCL-specific, company number 16897166), 1.6 (12-week earnings projection), 1.8 (Schedule E for content arrangement), 1.9 (LIA). Plus 1.2 design pass complete (spec at `docs/franchise/spec-overflow-routing-book-html.md`). Decision-locked: 1.3 = column-based shortfall (not spreadsheet); 2.10 promoted from Tier 3 to Tier 2 because earnings projection surfaced that £250 deposit means £0 net to instructor in week 1 of every scenario; 1.3 + 2.10 bundled (same file, same migration). New plan items added: 2.11 (jump-to-next-slot button, Tier 2 post-launch), 3.9 (direct booking from instructor profile, Tier 3).
>
> **2026-05-09** — audit + plan + £195 economics + content arrangement scope (home-PC storage, spreadsheet-based published-clips register, manual SAR/retention).
>
> **2026-05-10 (late evening)** — **1.7 rehearsal DONE.** Full report at `FRANCHISE-REHEARSAL-2026-05-10.md`. Walked phase A (worst-case week 1: £0 payout, £362.50 shortfall, no deposit deductible) → phase A2 (week 2 recovery: £20 to instructor, prior shortfall fully recovered, real test-Stripe transfer fired, recovery linkage written). Pre-signing-day Tier 1 stack passes end-to-end. Three findings — none signing-day blockers; one operational, one new Tier 3 item (3.10), one Tier 4. Tier 3 deferrals (B3.3 / B3.4 / B3.5 / email path) confirmed can wait until month 2.
>
> **Tier 1 is COMPLETE.** Pre-signing-day platform stack is ready. Outstanding pre-signing items now off-keyboard only: solicitor review (C10.1, C10.2). And the new Tier 3 plan item 3.10 surfaced by the rehearsal.
>
> **Pre-deploy reminders before instructor #2's first payout:**
> - **CRITICAL — 1.3 + 2.10 migration must run** via `GET /api/migrate?secret=MIGRATION_SECRET` after deploying commit d0452ea. Without this, the next Friday cron at 09:00 UTC crashes with `column "shortfall_pence" does not exist` for every instructor and zero payouts go out (rehearsal finding 1).
> - **1.2 overflow routing**: pure frontend, no migration. Worth manually confirming with a real chosen-empty instructor before signing day.
> - **Email-path re-rehearsal** (~15 min) worth doing — exercise the `cron-payouts.js` endpoint via curl with admin auth to confirm statement email renders new deposit/shortfall/recovery sub-lines correctly. Not done in 1.7 because we called the helper directly to skip auth setup.
>
> **New plan item from rehearsal — see Tier 3 below.**
>
> ---


Sequenced action plan from `FRANCHISE-AUDIT-2026-05-09.md`. Written for Fraser to read end-to-end and decide from. Constants: instructor #2 onboarding "a couple of months out from May 2026" (CLAUDE.md). Phasing of technical work follows `FRANCHISE-MODEL-PLAN.md` as source of truth — this document only sequences *when* each phase fires relative to signing day, Start Date, and the first quarterly checkpoint.

Audit confidence note: H9.4 (overflow routing) was flagged medium-confidence in the audit because grep was narrow. Cross-checked here against `book.js` and `slots.js` — no matches for overflow / alternative-instructor patterns in either. Confidence now high. Genuinely absent.

**2026-05-09 update — content-licensing arrangement added.** Instructor #2 has verbally agreed to a content-facilitation arrangement: £35/wk fee netted against the franchise fee (instructor receives £35/wk for facilitating dashcam-footage social-media content, separately terminable from the franchise contract). Learners with active social-media consent receive 5% off lessons (CCL absorbs, not instructor). After scope refinement (home-PC storage, spreadsheet-based published-clip register, manual SAR/retention), the active build is **~3.5 sessions pre-go-live** beyond the original franchise scope: 1.8/1.9 (Schedule E + LIA — drafting), 2.5 (DoB column + privacy + sticker), 2.6 (consent table + UI + DoB inline + email-on-withdrawal), 2.7 (pricing column folded into Phase 1 migration). Items 2.8 / 2.9 / 3.7 / 3.8 collapsed (operational discipline replaces them). Eyes-open commercial decision: total CCL cost £3,000–5,000/yr in cash + build cost + ongoing manual admin time, justified if the social-media presence drives ≥1 instructor signing or ~10 learner acquisitions per ~2 years.

**Hard-locked decisions** (do not re-litigate):
- Vehicle owned outright by CCL, £17,500 Toyota Yaris Hybrid, 6-yr operational horizon, 3-yr price-justification horizon. £195/wk fee verified ✅. Real cost £66/wk (6yr) / £81/wk (3yr); margin holds in every scenario including content-deal-active.
- Instructor pays insurance — CCL has no insurance line in cost model.
- Two consents are legally distinct: **dashcam recording = legitimate interests (no consent needed, but disclosure + LIA required)**; **social-media publication = explicit opt-in consent (specific, informed, withdrawable)**.
- Social-media consent UI is **adults-only at launch**. Under-18 parental-consent flow deferred to Tier 4. Requires DoB collection (currently not captured anywhere — confirmed by grep against `db/migration.sql`).
- 5% lesson discount for active social-media consent: applied at checkout, **CCL absorbs** (instructor's payout calculated against un-discounted snapshot rate). Multiplicative with any per-learner custom rate.
- **Footage storage: home-PC only (locked 2026-05-09).** Workflow is dashcam SD card → Fraser's home PC → edit → post to social → delete (or archive briefly). Footage never touches CCL platform. No R2, no Stream, no upload UI. Platform's only role: consent state + published-clips spreadsheet for takedown. Aggressive deletion is Fraser's preferred discipline — he wants footage cleared once clips are found, to avoid clutter.
- **Published-clips tracking: spreadsheet** at `docs/operations/published-clips.xlsx` (or equivalent). Columns: `clip_id (filename), date_published, platforms (URLs), source_lesson_id, appearing_learners, takedown_status`. Defer database table to Tier 4 trigger (≥10 clips/wk consistently).
- **No automatic backup of footage.** Aligns with retention discipline — short-lived on home PC by design.

---

## Tier 1 — Pre-signing-day must-ship

The bar: without these, instructor #2 cannot truthfully sign because the pitch isn't true, the agreement numbers might be wrong, or week-1 has a known-bad outcome.

### 1.1 — £195 economics verification (C10.3)
- **What**: Spreadsheet exercise — real lease + insurance + servicing + admin per-week cost vs the £195 Full-Franchise weekly fee. If real cost ≥ £160, raise to £210–220 and amend `FRANCHISE-AGREEMENT-DRAFT.md` + tier-seed values before signing.
- **Why this tier**: The agreement is signed on a number. Discovering after signing that CCL absorbs £15/week per Full-Franchise instructor with no decision is the kind of mistake that's cheap to prevent and expensive to renegotiate.
- **Files to touch**: `FRANCHISE-AGREEMENT-DRAFT.md` (only if number changes), `FRANCHISE-COMMITMENT-REGISTER.md` C10.3 entry. No code.
- **Scope**: <1 session, mostly off-keyboard.
- **Dependencies**: none.
- **Open decisions**: What does "real cost" include? Lease, fully comp insurance with named-driver provisions, scheduled servicing amortised, MOT, road tax, breakdown cover. Does it include any allowance for accident excess / write-off risk? Decide the methodology before pricing.

### ~~1.2~~ ✅ DONE 2026-05-10 — H9.4 overflow lead routing (book.html + book.js; see DEVELOPMENT-ROADMAP.md entry 2.67 for files-changed)

**Original spec preserved below for reference.**

### 1.2 — H9.4 overflow lead routing (book.html + book.js)
- **Design pass**: ✅ DONE 2026-05-10. Full spec at `docs/franchise/spec-overflow-routing-book-html.md`. Eight design questions resolved (trigger threshold, visual placement, scope, alternative-set, pagination, click behaviour, heading text, mobile fit).
- **Decisions locked**:
  - **Trigger**: chosen instructor has 0 slots across full 84-day window (not 7 days — protects instructors who book ahead).
  - **Render**: replace empty state entirely with overflow section.
  - **Scope**: only fires when a specific instructor is selected (not when filter is empty).
  - **Alternatives**: drop `instructor_id` from the query, return all active instructors (chosen one self-excludes via emptiness).
  - **Pagination**: same load-more pattern as today.
  - **Click**: opens booking modal with alternative instructor; dropdown filter stays on chosen instructor.
  - **Heading**: "No slots with [FirstName] in the next 12 weeks." → subhead "Slots with our other instructors:" → existing slot-feed below.
  - **Mobile**: first-name-only avoids wrapping issues with long names.
- **Implementation pending**: ~1 session. ~150–250 lines across `public/learner/book.js` (`fetchFeedSlots` + `renderFeed`) and `public/learner/book.html` (CSS for overflow section). **No API changes** — `?action=available` already supports the no-`instructor_id`-filter case.
- **Why this tier**: Platform-side delivery of the Lead Floor commitment (AGT 4.4). Sign without this and the pitch is structurally untrue in instructor #2's first weeks.
- **Dependencies**: none. Does NOT depend on Phase 1 schema. Uses existing `instructors.active` and existing slot-feed query.

### ~~1.3~~ ✅ DONE 2026-05-10 — B3.6 negative-payout shortfall: column-based tracking (bundled with 2.10; see DEVELOPMENT-ROADMAP.md entry 2.66 for files-changed)
- **Decision**: column-based, not spreadsheet. Fraser's reasoning: "one less thing for me to think about" — week-to-week mental load matters more than the small code investment.
- **What**: Add `instructor_payouts.shortfall_pence INTEGER NOT NULL DEFAULT 0` column. Update `_payout-helpers.js processPayoutForInstructor`: when `franchiseFee > totalGrossPence`, store the difference in `shortfall_pence` on the new payout row (positive value = amount owed to CCL). On the next payout for the same instructor, read the most recent unrecovered shortfall, deduct it from the current week's positive payout amount, mark it recovered (e.g. add a `shortfall_recovered_from_payout_id` column or `shortfall_status` enum). Display running shortfall balance on `/instructor/earnings.html` so instructor #2 has visibility — no surprise conversations.
- **Why this tier**: Break-even for Full Franchise £195 at £55/lesson is ~3.5 lessons/week. Instructor #2's first 4–6 weeks are when low-revenue weeks are most likely. Without tracking, today's `Math.min(franchiseFee, totalGrossPence)` silently truncates and the £85 / £140 / etc just disappears from the system. With the column, the running balance is automatic and visible to instructor.
- **Files to touch**: `db/migration.sql` (add `shortfall_pence` and recovery-tracking columns to `instructor_payouts`; `idx_instructor_payouts_unrecovered_shortfall` partial index for finding outstanding balance per instructor), `api/_payout-helpers.js` (write shortfall on truncation, read+deduct+recover on next positive payout, ensure rounding works against the existing line-item fix-up logic), `public/instructor/earnings.html` (running balance display + per-payout shortfall row), `api/cron-payouts.js` (statement email body shows shortfall recovery line if applicable).
- **Scope**: 1 session for the migration + payout-helper change + earnings UI. Plus ~30 minutes of payout-rehearsal once shipped to verify two-week sequences (week 1 truncates → week 2 positive recovers → week 3 fully clear).
- **Dependencies**: none. Independent of Phase 1.
- **Risk to flag**: payout-helper is already a Tier 3 rewrite target (B3.3 snapshot reads, B3.4 Stripe-fee passthrough, B3.5 statement itemisation). Three options for sequencing: (i) ship 1.3 now as a small targeted change; (ii) wait and bundle into Tier 3 rewrite; (iii) ship 1.3 now and accept that the Tier 3 rewrite will touch the same code. **Recommend (i)** — pre-signing-day priority outweighs the small risk of double-touching the file. The shortfall logic is also the simplest of the four payout changes; landing it first means the bigger Tier 3 rewrite has working shortfall tracking to *preserve*, not to *introduce*.

### ~~1.4~~ ✅ DONE 2026-05-10 — Decal-removal early-exit fee set to £200
- **Resolution**: clause 3.3 placeholder replaced with £200. Solicitor checklist item 2 marked resolved.

### 1.5 — C10.9 privacy policy focused re-read
- **What**: Read `public/privacy.html` end-to-end against AGT 6.x data-handling clauses. Verify franchisee-as-self-employed-data-processor framing is present and consistent. Edit if not.
- **Why this tier**: Audit confidence on C10.9 is low — keyword grep only. If the framing is wrong, signing day exposes a GDPR mismatch between agreement and public privacy notice. Cheap to verify, expensive to discover later.
- **Files to touch**: `public/privacy.html`, possibly `FRANCHISE-AGREEMENT-DRAFT.md` clause 6.x if alignment requires changes there instead.
- **Scope**: <1 session. 15-minute read + edits.
- **Dependencies**: none.

### 1.6 — C10.7 sample week-by-week earnings projection
- **What**: A worked example showing instructor #2 on Full Franchise £195 across weeks 1–6, with realistic ramp from 5 lessons/week to 20, showing weekly fee deduction, shortfall weeks (and where the shortfall is recorded — see 1.3), Stripe fee impact (passthrough exists in the agreement even though B3.4 isn't built yet), Lead Floor pro-rata calculation appearing at week 13.
- **Why this tier**: `INSTRUCTOR-EXPERIENCE-PLAN.md` calls this out as "Moment 1" pre-signing material. Without it, instructor #2 signs against a fee structure they haven't seen modelled against their own likely first 6 weeks. That's the highest-regret signing scenario.
- **Files to touch**: New file in repo (recommend `docs/franchise/sample-earnings-projection.md` or a printable PDF). Referenced from the conversation script.
- **Scope**: 1 session.
- **Dependencies**: 1.1 (number must be locked first), 1.3 (so the projection can show shortfall handling consistently with whatever was decided).

### ~~1.7~~ ✅ DONE 2026-05-10 — Pre-signing rehearsal pass (full report at FRANCHISE-REHEARSAL-2026-05-10.md)

**Outcome:** pre-signing-day Tier 1 stack passes end-to-end. Worst-case week 1 → £0 payout, £362.50 shortfall recorded. Week 2 with adequate revenue → £20 to instructor, prior shortfall fully recovered, real test-Stripe transfer fired. Recovery linkage written. Failure rollback path verified (when Stripe transfer fails, line items deleted and prior shortfall NOT marked recovered — clean retry).

**Three findings, none signing-day blockers**:
1. Migration must run after deploy (operational checklist, not code) — see pre-deploy reminders above.
2. Stripe platform balance can be insufficient in edge cases → new Tier 3 plan item 3.10 below.
3. `platform_fee_pence` column semantics drift in mixed cases — Tier 4, low priority.

**Tier 3 deferrals confirmed can wait**: B3.3 (snapshot reads), B3.4 (Stripe-fee passthrough), B3.5 (statement itemisation), email-path re-rehearsal.

---

### Original 1.7 spec (retained for reference)

### 1.7 — Pre-signing rehearsal pass (audit cross-cutting risk #5)
- **What**: A dry-run of "instructor #2's first payout day" using a test Stripe Connect account, with Phase 1 columns faked by hand or in a scratch branch. Walk through: Friday cron fires, gross calculated, franchise fee deducted, Stripe fee status (currently NOT deducted — that's fine for the rehearsal, the point is to discover that it's not), payout email goes to the right inbox, instructor sees the right thing in `/instructor/earnings.html`, shortfall path triggers correctly (per the 1.3 decision).
- **Why this tier**: Per audit cross-cutting risk #5 — instructor #2's first real payout exercises B3.4, B3.5, B3.6, B3.14 all at once, and none of those are built. A rehearsal isn't building them; it's discovering which gaps are tolerable for week 1 vs which need filling first. Likely outcome: confirms B3.4/B3.5 (Stripe fee passthrough + itemisation) can wait until Tier 3, but surfaces something specific to fix before signing.
- **Files to touch**: None modified. Test data setup only.
- **Scope**: 1 session.
- **Dependencies**: 1.3 must be decided; nothing else.

### 1.8 — Content-licensing schedule + £35 facilitation fee in agreement
- **What**: Draft a new schedule (Schedule E) for `FRANCHISE-AGREEMENT-DRAFT.md` covering (a) compulsory dashcam-disclosure — recording is operational, framed as legitimate interests, separate from social-media use; (b) £35/wk content-facilitation fee paid to instructor, netted against franchise fee, separately terminable on 1 month's notice on either side; (c) IP ownership — CCL owns footage; instructor licenses their appearance for the duration of the content arrangement; learners license theirs via the consent flow; (d) takedown obligations when a learner withdraws; (e) which platforms / editing scope are licensed; (f) what happens to existing published clips if the content arrangement terminates (CCL retains right to keep clips already published, no new clips after termination); (g) instructor opt-out from any specific clip during admin triage.
- **Why this tier**: Instructor #2 has verbally agreed; signing day depends on the deal being in writing. Without the schedule, instructor #2 either signs trusting you to draft something fair later, or signs without it and starts the relationship with a side-deal — both bad.
- **Files to touch**: `FRANCHISE-AGREEMENT-DRAFT.md` (new Schedule E), `FRANCHISE-COMMITMENT-REGISTER.md` (new Section 13).
- **Scope**: 1 session, mostly drafting against the principles above.
- **Dependencies**: 1.9 (LIA must exist before agreement references it). Solicitor review (C10.2) extends to cover this schedule.
- **Open decisions**: separately-terminable notice period (1 mo recommended); does instructor have approval rights over which clips of *them* are published, or only flag-during-triage; what's "reasonable efforts" timescale on takedown (recommend 14 days) — these go to solicitor.

### 1.9 — Legitimate Interests Assessment (LIA) for dashcam recording
- **What**: Internal ~1-page document recording the legitimate-interests basis for compulsory dashcam recording in CCL vehicles. Three sections per ICO template: (a) **Purpose** — safety, quality assurance, instructor coaching, insurance evidence; (b) **Necessity** — why dashcam is the only practical way to achieve those purposes; (c) **Balancing test** — weighed against learner privacy interests, with mitigating measures (sticker disclosure, 30-day retention, restricted access, SAR process, no public publication without separate consent). Stored at `docs/compliance/dashcam-LIA.md`. Reviewed annually.
- **Why this tier**: Required *before* dashcam goes live in any vehicle (per ICO guidance for legitimate-interests processing). Vehicle is bought a month before instructor #2's Start Date — so technically LIA only needs to exist before the car is operational, not before signing. But it's referenced from Schedule E (item 1.8), so cleaner to have both ready for solicitor review together.
- **Files to touch**: New file `docs/compliance/dashcam-LIA.md`.
- **Scope**: <1 session, off-keyboard. ICO has templates; this is a fill-in exercise.
- **Dependencies**: none.
- **Open decisions**: retention period — 30 days recommended; flag-and-keep override for incidents / training clips selected for review.

---

## Tier 2 — Pre-go-live must-ship

The bar: needed before instructor #2's Start Date (first lesson under the agreement), but not before they sign. Buffer of 2–4 weeks here.

### 2.1 — Phase 1 schema migration (S1.1, S1.2, S1.3, S1.4, S1.5, S1.6, S1.9, S1.10, S1.11, S1.12, S1.13, S1.15)
- **What**: The single migration that creates `franchise_tiers`, seeds two tiers, adds `instructors.franchise_tier_id` / `contract_start_date` / `bulk_tiers_enabled` / `hourly_rate_pence`, adds `credit_transactions.instructor_id` / `effective_rate_pence_per_minute`, adds `lesson_bookings.list_price_pence`, creates `learner_credit_balances`, runs the backfill, sets Fraser's `bulk_tiers_enabled = TRUE`, indexes new FKs.
- **Why this tier**: Phase 2A (per-instructor credit scoping) is required behaviour for instructor #2's first credit purchase to land in the right (learner_id, instructor_id) row. Phase 2A blocks on this migration. So this must ship before Start Date even though it's not required for signing — signing happens on the agreement, not on database state.
- **Files to touch**: `db/migration.sql`, new file under `db/migrations/`.
- **Scope**: 1 session for the migration itself + backfill verification (audit T8.7–T8.9 still need running against live DB).
- **Dependencies**: 1.1 (so seeded tier values are correct).
- **Open decisions**: Sequencing of backfill vs `bulk_tiers_enabled` default. Audit quick-win #4 is correct: column defaults FALSE; Fraser's row needs explicit TRUE; do it in the same migration in the right order (seed tiers → add columns → backfill `bulk_tiers_enabled = TRUE WHERE id = <fraser>` → verify). Document in the migration file.

### 2.2 — Phase 2A: per-instructor credit scoping (P2.9, P2.10, P2.13 snapshot path, L7.1, L7.2, L7.3, L7.4, L7.7, L7.8, L7.10, L7.11, T8.5, T8.6)
- **What**: Webhook writes per-instructor credit rows. Slot booking decrements the right balance. Cross-instructor booking refused. 48h refund returns to the right `(learner_id, instructor_id)` row. Legacy grandfather rule (consume legacy first when booking originally-allocated instructor). Buy-credits flow has an instructor-anchor step. Learner profile shows per-instructor balances.
- **Why this tier**: Day one of instructor #2 taking lessons, a learner buys credits with them. If this hasn't shipped, that purchase pollutes the pooled `balance_minutes` — and once the migration to per-instructor lands later, the backfill becomes lossy because there's no instructor anchor on those rows. So Phase 2A must ship before the first instructor #2 credit purchase, which means before Start Date.
- **Files to touch**: `api/webhook.js` (`handleCreditPurchase`, `handleSlotBooking`), `api/credits.js` (checkout accepts instructor_id), `api/slots.js` (booking + refund paths), `public/learner/buy-credits.html` + buy-credits.js (instructor-anchor step), `public/learner/profile.html` (per-instructor balance display).
- **Scope**: Multi-session workstream. 3–4 sessions: webhook + slots + UI + verification. Audit cross-cutting risk #1 is correct — don't budget this as one cleanup pass.
- **Dependencies**: 2.1.
- **Open decisions**: Buy-credits UX — does the learner pick instructor up front, or does the page default to "your usual instructor" if there's exactly one in their booking history? Recommend the latter for Fraser's existing learners (who have only ever booked Fraser) so they don't see a confusing new step that didn't exist before.

### 2.3 — B3.1 payout cron timing
- **What**: One-line `vercel.json` change from `0 9 * * 5` to whatever final agreement clause 4.3 specifies (likely `0 14 * * 5` or `0 15 * * 5`).
- **Why this tier**: Must align before instructor #2's first Friday. Defer until after solicitor review (C10.2) so it doesn't change twice.
- **Files to touch**: `vercel.json:10`.
- **Scope**: <1 session, 5-minute change.
- **Dependencies**: C10.1/C10.2 (solicitor review — out of Fraser's hands but on the critical path).

### 2.4 — C10.5 Learner Vehicle Standards policy
- **What**: Draft and publish the standards document referenced by the agreement.
- **Why this tier**: Referenced by the agreement; needs to exist by Start Date so instructor #2 has the standards they're contractually held to.
- **Files to touch**: New file (recommend `public/learner-vehicle-standards.html` linked from privacy/terms).
- **Scope**: 1 session, mostly drafting.
- **Dependencies**: none.

### 2.5 — DoB column + privacy policy + dashcam disclosure (`pii-change`)
- **What**: (a) Add `learner_users.date_of_birth DATE` (nullable). Confirmed 2026-05-09: no learner currently has age info captured anywhere. New signups ask DoB on signup form. Existing learners: DoB asked *only* at the moment they engage with consent UI in 2.6 — no standalone profile prompt, no booking-flow prompt. The DoB field exists primarily to gate the consent UI; nothing else reads it. (b) Privacy policy (`public/privacy.html`) updated to disclose dashcam processing under legitimate interests, retention period ("kept only as long as needed for safety/quality review, typically days, not exceeding 30 days unless flagged for content editing or incident investigation"), **storage location: footage stored on Fraser's secured home computer, never uploaded to CCL platform infrastructure or third-party cloud services**, learner rights (SAR, deletion, objection), separate social-media-consent process. (c) Order physical dashcam-disclosure stickers ("This vehicle is fitted with a recording device — footage may be used for safety, quality and training purposes. See coachcarter.uk/privacy for details.") for fitting at vehicle prep. (d) First-lesson briefing script updated to mention dashcam.
- **Why this tier**: Privacy policy + sticker must exist before the dashcam goes live in the vehicle (one month before instructor #2's Start Date). DoB column ships in same migration as Phase 1 to avoid a separate `learner_users` migration. The DoB *collection UX* is bundled into 2.6.
- **Files to touch**: `db/migration.sql` (DoB column added to Phase 1 migration), `api/learner-auth.js` (signup flow asks DoB on new signups only), `public/privacy.html` (dashcam section). No profile-prompt UI; no booking-flow change. **No storage code at all** — footage isn't on the platform.
- **Scope**: <1 session.
- **Dependencies**: 2.1 (Phase 1 migration — bundle DoB column).
- **Open decisions**: ~~under-18 booking gate?~~ Resolved: DoB is best-effort, never a booking gate. ~~storage decision?~~ Resolved 2026-05-09: home-PC only.

### 2.6 — Social-media consent infrastructure (incl. inline DoB collection)
- **What**: New table `learner_content_consents (id, learner_id, school_id, consent_type, granted_at, withdrawn_at, scope JSONB, created_at)`. `consent_type = 'social_media_publication'` initially; schema future-proofed for other consent types. Scope JSONB records what they consented to (platforms, editing rights, retention horizon — populated from the consent UI). Learner profile UI: "Help us tell your story — and get 5% off lessons" toggle with full informed-consent UI (platforms listed individually as checkboxes; editing scope explained; "withdraw any time, we'll take down published clips within 14 days" reassurance; explicit reasonable-efforts caveat for reshares). **DoB inline-collection flow**: when a DoB-unknown learner clicks the consent toggle, an inline "Before you can opt in, please confirm your date of birth" prompt appears. On submit, server checks age. If <18, message changes to "This feature is for 18+ only — your DoB has been saved for future" and consent is NOT granted. If ≥18, full consent UI appears for them to grant. Existing under-18 learners (DoB known and <18) never see the toggle. **Withdrawal flow**: endpoint marks consent withdrawn, then sends an email to Fraser containing the learner's name + ID + last 12 months of lessons (date + instructor). Fraser cross-references the published-clips spreadsheet manually to find affected clips, takes down within 14 days, marks status in spreadsheet. No platform-side takedown automation — footage isn't on the platform.
- **Why this tier**: No social-media publication can occur until this exists. Must ship before instructor #2's first lesson — but realistically before the dashcam vehicle goes live (1 month pre-Start-Date) so that learners booking lessons in that window already have the option to consent. Bundling DoB collection into the consent flow (rather than a separate profile prompt in 2.5) puts the friction at the point where it's actually justified — only learners who *want* the consent feature pay the DoB cost.
- **Files to touch**: `db/migration.sql` (new table, indexed on learner_id + consent_type, school_id FK), `api/learner.js` (or new `api/learner-content-consent.js`) for grant/withdraw + inline-DoB-update endpoints, `public/learner/profile.html` (consent UI + inline DoB prompt), GDPR cascade hookups in `api/learner.js` and `api/cron-retention.js` per CLAUDE.md GDPR rules 3 + 4.
- **Scope**: 2 sessions (schema + API + DoB-aware UI flow; then withdrawal flow + email hookup using existing `createTransporter()` pattern).
- **Dependencies**: 2.5 (DoB column must exist).
- **Open decisions**: list of platforms in the consent scope (TikTok, Instagram Reels, YouTube Shorts, CoachCarter website + paid Meta/Google ads — confirm exhaustive list); editing scope wording (recommend: "we may crop, slow-mo, add captions/music/voiceover, splice with other footage, post compilations"); duration ("until withdrawn" rather than fixed-term); transferability (recommend: not transferable to a successor business without re-consent — this is GDPR-safer).

### 2.7 — Consent-discount pricing (folds into 2.1 + 2.2)
- **What**: Add `lesson_bookings.amount_paid_pence INTEGER` to the Phase 1 migration (item 2.1) so the column exists from day one. Pricing flow checks active social-media consent for the learner at checkout time; if active, applies 5% off the effective rate (computed via three-level fallback). Snapshots both `list_price_pence` (un-discounted, for instructor payout) and `amount_paid_pence` (discounted, what the learner actually paid via Stripe). Difference goes to CCL absorption — surfaces in school-payout reconciliation as a discount line, not in instructor payout.
- **Why this tier**: If bolted on after Phase 1 lands, requires a second migration on hot tables. Cheaper to add the column up front. Forces the architectural decision (snapshot full price separately from paid price) into Phase 1 where it belongs.
- **Files to touch**: `db/migration.sql` (column added to Phase 1 migration, item 2.1), `api/_pricing-helpers.js` (consent-discount layer on top of three-level fallback — `getEffectivePriceForBooking(sql, schoolId, instructorId, learnerId)` returns `{listPence, paidPence, consentDiscountPct}`), `api/webhook.js` (snapshots both columns on `handleSlotBooking`), `api/credits.js`, `api/slots.js`, `api/_payout-helpers.js` (uses `list_price_pence` not `amount_paid_pence`).
- **Scope**: +1 session of incremental work over 2.1 / 2.2 scope.
- **Dependencies**: 2.6 (consent state must be queryable). Bundles into 2.1 migration timing.
- **Open decisions**: when consent is granted *after* a booking but *before* the lesson — does the existing booking get retro-discounted? Recommend no (booking-time snapshot is final) — keeps the maths simple.

### ~~2.8 — Footage-pipeline admin UI (Flow A — content triage)~~ — REMOVED 2026-05-09
- **Status**: not built. Footage-storage decision (home-PC only) means there's no platform-side triage UI to build. Fraser reviews clips on home PC by opening files. The consent state queried in 2.6 is the *output* his offline workflow consumes. If clip volume ever grows past a manual-review threshold (≥10 clips/wk consistently), revisit — Tier 4 trigger.

### 2.9 (revised) — Published-clips spreadsheet
- **What**: Spreadsheet at `docs/operations/published-clips.xlsx` (private, not committed to repo — this is operational data, not code). Columns: `clip_filename, date_published, tiktok_url, instagram_url, youtube_url, other_platform_url, source_lesson_id, source_lesson_date, appearing_learner_names, appearing_learner_ids, takedown_status (live | partially_taken_down | fully_taken_down | n/a)`. Updated by Fraser at publication time and on takedown. When a withdrawal email lands (from 2.6), Fraser searches the spreadsheet for the learner's ID, takes down affected clips within 14 days, updates takedown_status.
- **Why this tier**: The withdrawal obligation exists from the moment the first clip is published. The spreadsheet has to exist before the first publication — but it's a 5-minute setup task, not a session.
- **Files to touch**: New file (operational, on Fraser's machine, not committed). Documented path referenced from `FRANCHISE-COMMITMENT-REGISTER.md` M13.10.
- **Scope**: <1 session, off-keyboard.
- **Dependencies**: none.
- **Trigger to convert to a database table (Tier 4)**: ≥10 clips/wk published consistently OR first time the spreadsheet lookup-on-withdrawal misses a clip and a learner's footage stays live past 14 days.

---

## Tier 3 — Month 1 of instructor #2's operation

The bar: needed before the first quarterly checkpoint (week 13, ~month 3) or the first payout cycle that exercises Stripe fee passthrough — not before they start.

### 3.1 — Phase 2B: bulk-tier opt-in + three-level rate logic (P2.1, P2.2, P2.3, P2.4, P2.5, L7.5, L7.6, I6.1, I6.2, I6.3, I6.4)
- **What**: `getEffectiveHourlyPence(sql, schoolId, instructorId, learnerId?)` helper. Bulk discount applies to effective rate. Bulk-tier UI conditional on `bulk_tiers_enabled`. In-flight credits unaffected by opt-out (snapshot wiring from 2.2 already enables this). Instructor profile shows tier + rate + bulk-package toggle. `?action=set-bulk-tiers` endpoint.
- **Why this tier**: Instructor #2 can sign and start without their profile page showing tier inclusions. They can take lessons at the school default rate while bulk packages remain default-on (Fraser's grandfathered behaviour). The cost of deferring is that instructor #2 has no UI affordance to opt out of bulk tiers in their first weeks — which is fine as long as Fraser knows this and doesn't promise it pre-signing. Worth confirming this matches what's in the conversation script (1.6).
- **Files to touch**: `api/_pricing-helpers.js`, `api/instructor.js`, `public/instructor/profile.html`, `public/learner/buy-credits.html`.
- **Scope**: Multi-session workstream. 2–3 sessions.
- **Dependencies**: 2.1, 2.2.
- **Open decisions**: Default `bulk_tiers_enabled` value for new instructors at admin-create time — TRUE or FALSE? FALSE is the conservative default (instructor opts in deliberately) and matches "instructor absorbs the discount" framing. Recommend FALSE; Fraser's row is the explicit exception.

### 3.2 — Phase 2C: tier admin UI (A5.1, A5.2, A5.3)
- **What**: Admin can CRUD `franchise_tiers`. Edit instructor form has a tier dropdown that copies the tier's fee into `weekly_franchise_fee_pence` on save. Admin can set/clear `instructors.hourly_rate_pence`.
- **Why this tier**: Phase 2A/2B ship without this — Fraser sets values via direct SQL or via the existing manual-fee field (A5.4 already works). UI is convenience, not blocker. Worth doing before instructor #3 onboards (per H9.10 that's not until instructor #2's 90-day post-mortem) because by then the manual SQL becomes annoying.
- **Files to touch**: `public/admin/portal.html`, `api/admin.js`.
- **Scope**: 2 sessions.
- **Dependencies**: 2.1.

### 3.3 — Payout-helper rewrite: B3.3, B3.4, B3.5
- **What**: `_payout-helpers.js processPayoutForInstructor` reads `lesson_bookings.list_price_pence` snapshot instead of live `lesson_types.price_pence`. Stripe fees deducted from instructor's payout at cost. Stripe fees itemised on the weekly statement email and on `instructor/earnings.html`.
- **Why this tier**: Per audit cross-cutting risk #3, this is a deliberate refactor not a bolt-on. Payout-helper currently does live price lookup, franchise/commission branching, rounding fix-up, Stripe transfer, failure rollback — adding three more concerns mid-flight is how rounding bugs ship. Must land before the first payout cycle that the agreement says includes Stripe fee passthrough — but Fraser can confirm verbally with instructor #2 in week 1 that "Stripe fee passthrough kicks in from week 4" or similar. Doesn't block Start Date.
- **Files to touch**: `api/_payout-helpers.js`, `api/cron-payouts.js` (statement email body), `public/instructor/earnings.html`.
- **Scope**: Multi-session workstream. 2 sessions: one for the snapshot-read refactor (depends on 2.2 having populated `list_price_pence` on new bookings), one for fee deduction + itemisation.
- **Dependencies**: 2.1, 2.2.
- **Open decisions**: Cut-off behaviour — when does Stripe fee passthrough start? Lessons booked after Phase 2A ships have `list_price_pence` snapshotted; lessons booked before don't. Decide whether the rewrite handles "no snapshot → fall back to live lookup" (gradual transition) or "all bookings from date X onward use snapshot" (clean cut). Recommend gradual — `COALESCE(list_price_pence, live_lookup)` — to avoid an artificial cut-off date that confuses everyone.

### 3.4 — B3.2 payout window enforcement
- **What**: Restrict `getEligibleBookings` to a rolling 7-day window ending at 12:00 Friday cut-off, instead of "any unpaid completed lesson."
- **Why this tier**: Audit notes the current behaviour is broader than agreement spec but "every lesson eventually gets paid." That's true today with one instructor. With instructor #2 it's still true; the bug only matters if a lesson somehow stays unpaid for >7 days, in which case under the strict rule it'd be excluded forever. Worth tightening before that edge case fires, but not week 1.
- **Files to touch**: `api/_payout-helpers.js`.
- **Scope**: 1 session.
- **Dependencies**: 3.3 (do it as part of the same payout-helper refactor session — same file, same mental model).

### 2.11 — "Jump to next available slot" button on book.html (added 2026-05-10)
- **What**: Button on `book.html` that, when the chosen instructor has slots but the first one is far out, jumps the feed view to the date of the first available slot — saves the learner clicking "load more" through empty weeks. Button text: "Sarah's next slot is on [date] — jump there?"
- **Why this tier**: Not pre-signing-blocker (the agreement's Lead Floor commits to slot routing, not to UX polish around discovery). But it materially improves instructor #2's mid-ramp weeks where they have sparse near-term availability — exactly when overflow routing (1.2) does NOT fire because they have *some* slots. Complementary to 1.2; together they cover both "zero slots" and "slots, but far out."
- **Why separate from 1.2**: different trigger condition (instructor has slots vs zero slots), different action (jump within instructor vs surface other instructors), different test fixtures, different rollback risk. Bundling risks shipping a half-baked version of either.
- **Files to touch**: `public/learner/book.js` (compute earliest slot from `slotCache`, render button when first slot is >7 days out), `public/learner/book.html` (button markup + styles).
- **Scope**: 1 session.
- **Dependencies**: none.
- **Open decisions**: button copy ("jump to date" vs "see Sarah's next slot"); threshold for showing the button (>7 days out? >14?); behaviour when no slots at all (overflow routing 1.2 takes over — these don't conflict).

### ~~3.5 → 2.10~~ ✅ DONE 2026-05-10 — B3.14 £250 vehicle deposit deduction (bundled with 1.3; see DEVELOPMENT-ROADMAP.md entry 2.66 for files-changed)
- **Why promoted**: Instructor #2 is confirmed Full Franchise (see 1.6 projection). The deposit deduction lands in week 1 regardless of scenario — without this code, week 1 payout maths is wrong. Must be in place by Start Date, not month 3.
- **What**: First payout to a Full-Franchise instructor automatically deducts £250 (recorded as line item or column on `instructor_payouts`). Combined with the 1.3 shortfall logic — if revenue + Effective Fee > deposit, payout positive minus £250; if revenue can't cover Effective Fee + deposit, the shortfall captures the difference and rolls forward.
- **Files to touch**: `api/_payout-helpers.js` (week-1 detection + £250 deduction line), `db/migration.sql` (deposit-tracking column on `instructor_payouts` or new `instructor_deposits` mini-table — recommend column for v1 simplicity), `public/instructor/earnings.html` (deposit line on first-week statement), agreement clause 5.5 already specifies the mechanic.
- **Scope**: 1 session, bundled with 1.3 if convenient (same file, same payout-helper change set, same statement-email impact).
- **Dependencies**: 1.3 (shortfall logic must exist; deposit deduction relies on the shortfall mechanism to roll forward when revenue can't cover deposit).
- **Open decisions**: refundable-on-end-of-contract logic — defer to Tier 4 (handled manually for first instructor anyway, since it only fires at contract termination 12+ months out).

### 3.9 — Direct booking from instructor profile page (added 2026-05-10)
- **What**: Each instructor's public profile page gets a "Book a lesson" / "Buy credits" CTA. Clicking enters a booking flow scoped to that instructor — no dropdown, no overflow, no ambiguity. Credits purchased via this flow auto-anchor to that instructor (via Phase 2A scoping). Learner becomes "Sarah's learner" by virtue of entering through Sarah's page.
- **Why this tier**: Two complementary entry surfaces. Profile-page booking serves "I've already chosen Sarah" (commit to instructor up-front, simplest UX). Current `/learner/book.html` serves "I haven't picked yet, show me what's available" (browse-then-decide UX). Both are real use cases. Profile-page booking is the natural endpoint of the per-instructor credit model — but only useful once Phase 2A is shipped and stable.
- **Why deferred from Tier 2**: instructor #2 can launch fine on the existing dropdown-based flow with 1.2 (overflow) and 2.11 (jump-to-next). Profile-page booking is a UX iteration, not a launch blocker.
- **Files to touch**: instructor profile page template (existing or new), `api/credits.js` (accept `instructor_id` already part of Phase 2A scope), `public/learner/buy-credits.*` (entry path may bypass instructor-pick step when arriving from profile page).
- **Scope**: 1–2 sessions. Full UX brief deferred until you actually want to start it.
- **Dependencies**: 2.2 (Phase 2A credit scoping must be stable). Likely also 2.6 (consent UI) so the profile-page experience is complete.
- **Trigger**: Phase 2A in production for ≥4 weeks without per-instructor credit issues.

### 3.10 — Pre-payout Stripe balance check (added 2026-05-10 from rehearsal finding 2)
- **What**: At the top of `processAllPayouts()` in `_payout-helpers.js`, query `stripe.balance.retrieve()` and compare available GBP balance against the estimated sum of payouts about to fire. If insufficient, abort the entire run and email Fraser instead of doing partial fan-out where some instructors get paid and others fail mid-cycle.
- **Why this tier**: Discovered during plan 1.7 rehearsal. Single-instructor today (Fraser) means partial fan-out is impossible — there's only one transfer per Friday. The risk only bites with multiple instructors AND an edge case where the platform balance is tied up in pending Stripe holds (first-time customers, refund-prone activity, large Klarna delays). Both conditions need to be true simultaneously, which is unlikely in instructor #2's first month but compounds as instructor count grows.
- **Why not Tier 1/2**: doesn't bite single-instructor today. Belongs in the same payout-helper rewrite session as the other Tier 3 items (B3.3 / B3.4 / B3.5) since it's the same file and same mental model.
- **Files to touch**: `api/_payout-helpers.js` (`processAllPayouts` — pre-flight check), `api/cron-payouts.js` (handle the abort case — email instead of crashing).
- **Scope**: <1 session, bundled with the Tier 3 payout rewrite.
- **Dependencies**: bundle into the same session as B3.3 / B3.4 / B3.5.
- **Trigger**: address when adding instructor #3 (multi-instructor amplifies partial-fan-out risk). For instructor #2 onboarding, accept the risk (one transfer per cycle, partial fan-out impossible).

### 3.6 — H9.5 new-instructor highlight on free-trial.html
- **What**: Per-instructor highlight markup so a learner landing on `/free-trial.html?instructor_id=…` sees the chosen instructor framed correctly.
- **Why this tier**: Post-signing nice-to-have. Useful in instructor #2's first month for any leads Fraser personally routes to them via free trial. Not blocking.
- **Files to touch**: `public/free-trial.html`.
- **Scope**: 1 session.
- **Dependencies**: none.

### ~~3.7 — Dashcam retention auto-deletion cron~~ — REMOVED 2026-05-09
- **Status**: not built. Footage on home PC; Fraser deletes systematically once clips are found (his preferred discipline). 30-day ceiling becomes a personal rule + LIA documentation, not a cron job. Tier 4 trigger: footage volume genuinely grows past Fraser's manual delete habit (unlikely given his stated preference for aggressive clearance).

### ~~3.8 — Subject access request (SAR) workflow for dashcam footage~~ — Becomes manual process
- **Status**: 🔵 Process. SAR for footage handled manually: learner requests footage of themselves; Fraser searches home PC by date range using existing `handleExportData()` (which exports lesson dates per learner) as the index; finds matching clip files; sends to learner. 30-day SAR deadline is generous for low volume. **Tier 4 trigger**: ≥3 SARs in any 6-month window, or first SAR Fraser can't fulfil within 30 days.

---

## Tier 4 — Defer until triggered

Per CLAUDE.md hard rule 5 — these are deferred deliberately. Listed with audit-confirmed trigger conditions; not recommended for build.

| Item | Register ID | Trigger condition |
|------|-------------|-------------------|
| `instructor_lead_floor_periods` | S1.17 | First quarterly Lead Floor evaluation needs to be auditable (i.e., manual spreadsheet has caused a dispute or near-dispute). |
| `instructors.lead_floor_per_week`, `lead_floor_max_reduction_pence` | S1.18 | Same trigger as S1.17. |
| `lesson_bookings.is_payout_eligible` + filter | S1.19 | First insurance lapse forces an exclusion that's currently done by manual SQL — frequency makes the SQL annoying (≥2 lapses across active instructors). |
| `franchise_fee_debts` | S1.20 | ≥3 active franchised instructors (per FRANCHISE-MODEL-PLAN deferred-table trigger), or first time the spreadsheet from Tier 1.3 becomes unwieldy. |
| `franchise_fee_overrides` | S1.21 | First time a one-week override needs an audit trail (today: edit `weekly_franchise_fee_pence`, edit it back). |
| `marketing_promos`, `instructor_promo_optins` | S1.22 | First promo campaign that needs per-instructor opt-in tracking. |
| `vehicles` table | S1.23 | First instructor with multiple vehicles, or first time vehicle-assignment matters for routing. |
| `contract_end_date` / term_months columns | S1.24 | First contract renewal cycle (instructor #2's month 12). |
| Bacs DD auto-invoicing | B3.7 | Never automatic per CC6 in year one. Reconsider after instructor #5+ when manual invoicing genuinely doesn't scale. |
| Post-termination 30-day settlement automation | B3.8 | First termination. |
| `is_suspended` flag for precautionary suspension | L4.8 | First suspension event, or pre-emptively if the manual workaround (instructor + Fraser both stop creating slots) is leaking edge cases. |
| Postcode-default routing (`coverage_postcodes`) | H9.6 | ≥3 active instructors with non-overlapping geography. With instructor #2 alone there's no routing to do. |
| Parental-consent flow for under-18 social-media consent | NEW | Content strategy demonstrably wants under-18 footage AND adults-only volume isn't enough. Revisit at month 6 or after 50 published clips. Build adds: parent-email collection on under-18 booking, email-token verification flow, parental withdrawal-on-behalf endpoint. |
| Platform-side footage handling (cloud storage + triage UI + retention cron + SAR automation) | NEW | Manual home-PC workflow becomes infeasible. Triggers: clip volume ≥10/wk consistently, OR ≥3 SARs in 6 months, OR a takedown miss attributable to spreadsheet lookup, OR Fraser explicitly wants to hand off content ops. Build adds: items previously scoped as 2.8 + 3.7 + 3.8 + the published_clips DB table. Storage decision (Cloudflare R2 vs Stream) revisited at that point. |
| Per-clip instructor approval rights | NEW | Instructor objects to a clip CCL approved. Until triggered, instructor has informal flag-with-Fraser rights only (per item 1.8 schedule). |

---

## Tier 5 — Out of scope (flag for separate sessions)

The audit surfaced these but they're not franchise-critical. Don't bundle into franchise work.

- **Audit-day register backfill verification (T8.7–T8.9)** — needs a live DB connection; was deferred from the audit itself. Pull into the Phase 1 migration session (2.1) — it's the same workstream.
- **Playwright suite run against migrated state (T8.11)** — wider regression infrastructure; spawn as its own session post-Phase 2A.
- **`HARD_FALLBACK_HOURLY_PENCE = 5500` hardcode in `_pricing-helpers.js:19`** — flagged in CC1 hard-rule check as acceptable per current policy but worth a separate config-discipline session if Fraser ever wants the school-defaults-config-only invariant strictly enforced.
- **`api/admin.js` keeps its own `bcrypt` calls** — noted in CLAUDE.md as deliberate. Not franchise scope. Mention only if a separate auth-cleanup session ever happens.

---

## Risks of this sequencing

1. **Phase 1 ships without Phase 2A in the same sprint.** This is the single biggest sequencing risk. Between 2.1 landing and 2.2 landing, the website runs with `learner_credit_balances` table existing but empty (well — backfilled from legacy pooled balance), while production code still reads/writes `learner_users.balance_minutes`. Two sources of truth for credit balance, in production, until 2.2 ships. Mitigation: ship 2.1 and 2.2 in the same release window, ideally same week. If they have to split, the Phase 1 migration leaves the legacy column in active use (S1.14 ✅) so the divergence is bounded — `learner_credit_balances` is dormant until 2.2 starts writing to it.

2. **Lock-in from Phase 2A's instructor-anchor step in `buy-credits.html`.** Once shipped, all of Fraser's existing learners see a new step in checkout that didn't exist before. If the UX is wrong, it directly affects Fraser's revenue. Recommend the "default to usual instructor for existing learners" treatment in Tier 2.2 to minimise disruption.

3. **B3.6 spreadsheet drift.** If 1.3 resolves as "spreadsheet, not column", the spreadsheet must actually exist at the documented path before signing. A documented-but-empty spreadsheet is worse than a column would be. Make this concrete on signing day.

4. **The £195 number could move.** If 1.1 surfaces a real cost ≥ £160 and Fraser raises Full Franchise to £210–220, every downstream document referencing £195 needs updating: agreement, register, sample earnings projection (1.6), tier seed values in the migration (2.1). Audit C10.3 has the right list. Don't seed `franchise_tiers` until 1.1 is locked.

5. **Solicitor review (C10.2) gates 2.3 (cron timing).** If the solicitor pushes back on payout timing in clause 4.3, the cron change is wasted. Defer 2.3 until after solicitor sign-off.

6. **Phase 2C (admin UI) deferred to Tier 3 means Fraser sets tier values via SQL during Phase 2A's first week.** Acceptable for instructor #2 onboarding (Fraser is the only admin user and is comfortable with SQL). Becomes a problem if instructor #2 onboarding gets handed off or if instructor #3 starts before 3.2 ships. Audit H9.10 says no instructor #3 until #2's 90-day post-mortem, so 3.2 has roughly 90 days of runway from instructor #2 Start Date. Comfortable.

7. **Content-arrangement infrastructure (2.5, 2.6, 2.7) is a coupled workstream — don't ship pieces independently.** Sequence is rigid: 2.5 (DoB column + privacy + sticker) → 2.6 (consent table + UI, depends on DoB) → 2.7 (pricing column, bundles into 2.1 migration). 2.8/2.9/3.7/3.8 collapsed away by the home-PC storage decision — those concerns moved to operational discipline (spreadsheet, manual deletion, manual SAR). Mitigation if the consent infrastructure slips: separately-terminable clause in 1.8 schedule lets either party park the content arrangement without affecting the franchise contract.

8. **Storage decision: locked 2026-05-09 → home-PC only.** Footage flows dashcam SD card → home PC → social media. Never on CCL platform. £0/mo storage cost. No upload/transcoding/storage code. Tradeoffs Fraser accepted: aggressive manual deletion (his preferred discipline anyway), spreadsheet-based published-clip register, manual SAR fulfilment, no automatic backup. Cloud-storage path (R2 + triage UI + retention cron + SAR automation) parked as a single Tier 4 entry with explicit triggers. Risk to be eyes-open about: if Fraser's home PC fails before clips are published, the footage is gone — which aligns with his stated preference for ephemerality but is worth saying out loud.

---

## Single highest-leverage next session

**~~1.1~~ ✅ DONE 2026-05-09.** £195 verified at £66/wk real cost (6yr horizon) / £81/wk (3yr horizon). Margin holds in every scenario including content-deal-active. No agreement amendment needed.

**~~1.8~~ ✅ DONE 2026-05-09.** Schedule E drafted into `FRANCHISE-AGREEMENT-DRAFT.md`: 9 sub-clauses (E.1–E.9) covering facilitation fee, instructor's duties, CCL's licence, learner-consent gating, instructor's appearance + per-clip takedown right, learner-initiated takedown, termination (1mo notice, separately terminable), IP ownership, LIA reference. Cross-referenced from new clause 4.11. Solicitor checklist item 7 added covering five specific concerns for legal review.

**~~1.9~~ ✅ DONE 2026-05-09.** Legitimate Interests Assessment written to `docs/compliance/dashcam-LIA.md`. Three sections (purpose / necessity / balancing), four purposes (safety, quality, coaching, insurance), interior + forward-facing scope justified, right-to-object resolves to cancel-tuition, retention 30d standard / 12mo incident, content creation explicitly walled off as a separate consent-based basis. Annual review scheduled 2027-05-09.

**~~1.6~~ ✅ DONE 2026-05-10.** Sample 12-week earnings projection written to `docs/franchise/sample-earnings-projection.md`. Three scenarios (best/expected/worst) with 18-lesson steady state, 8/10/12-week ramps, 0/1/2 down weeks. 12-week totals: £10,800 / £8,773 / £6,947 (gross, pre-tax). **Surfaced finding**: £250 vehicle deposit deduction in week 1 means net £0 to instructor in week 1 across *every* scenario (not just worst case). This bumps **B3.14 (£250 deposit deduction code) from Tier 3 to Tier 2** because instructor #2 is on Full Franchise — the deposit logic must be in place by Start Date. Updated below.

**Updated highest-leverage next session: 1.2 — Fraser's-overflow lead routing on book.html.** Last remaining pre-signing-day blocker. Two sessions: (a) UX design pass (interleaved vs sectioned, geographic filter, click behaviour); (b) implementation. Other Tier 1 items remaining: 1.3 (shortfall tracking — recommend spreadsheet), 1.4 (decal figure — fitter quote), 1.5 (privacy re-read), 1.6 (sample earnings projection — depends on 1.3), 1.7 (rehearsal — depends on 1.3).

---

## What can run in parallel

Items in different tiers that don't share files and could be picked up by different sessions concurrently.

- **1.2 (overflow routing)** ‖ **1.3 (shortfall tracking decision)** ‖ **1.5 (privacy re-read)** — three Tier 1 items, three disjoint file sets (`book.html`/`book.js`/`slots.js` vs `_payout-helpers.js`/spreadsheet vs `privacy.html`). Could all run in the same week.
- **1.1 (economics)** ‖ **1.5 (privacy)** ‖ **1.4 (decal figure)** — all off-keyboard / spreadsheet / single-edit, fully independent.
- **2.4 (Vehicle Standards policy)** can run any time before Start Date, independent of the schema/credit work in 2.1/2.2. Ideal filler for a session where the Phase 1 migration is mid-review.
- **3.6 (free-trial highlight)** is independent of the Phase 2 workstream and can slot in at any low-priority point in month 1.
- **1.7 (rehearsal)** can run in parallel with 2.1's preparation — the rehearsal uses faked Phase 1 columns, so it doesn't compete with the real migration work.
- **1.8 (content schedule) ‖ 1.9 (LIA)** — both drafting work in different documents. Could be done in one session.
- ~~3.7 ‖ 3.8~~ — both removed from active scope.

What CANNOT run in parallel: anything in 2.x against anything else in 2.x or 3.x — the Phase 1 → 2A → 2B → payout-helper-rewrite chain is sequential by file overlap on `_pricing-helpers.js`, `_payout-helpers.js`, `slots.js`, `webhook.js`, and the credit/balance schema. **Also 2.5 → 2.6 → 2.7 is rigidly sequential** — each depends on the previous one's schema or state. (2.8/2.9/3.7/3.8 dependencies dropped after home-PC storage decision.)
