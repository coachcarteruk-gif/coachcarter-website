# Instructor-Scoped Payments Plan

The plan for getting CoachCarter ready to take learner payments and assign them to specific instructors, in preparation for instructor #2 onboarding.

> **Companion document**: [`FRANCHISE-MODEL-PLAN.md`](FRANCHISE-MODEL-PLAN.md) — the full franchise architecture. This document is the **sequenced, near-term execution plan** for the payments/credits portion of that work, plus the Stripe Connect onboarding banner and public instructor profile pages.

## Goal in one sentence

A learner lands on an instructor's public profile → pays for credits with that specific instructor → those credits can only be spent with that instructor → the instructor sees a "set up payments" banner if they haven't connected Stripe yet → payout cron pays each instructor for the lessons they delivered.

## Current state (as of session start)

### Payouts — already per-instructor

`api/_payout-helpers.js` already does the right thing:

- Picks every active instructor with `stripe_onboarding_complete = TRUE`.
- Sums `lesson_bookings` rows where `instructor_id = X` and status is `completed` (or `confirmed` ≥3 days past), filtered by `UNIQUE(booking_id)` in `payout_line_items`.
- Computes price live from `instructor_learner_notes.custom_hourly_rate_pence` → `lesson_types.price_pence` → 8250 fallback.
- Two payout models:
  - **Franchise-fee**: `payout = gross − franchise_fee − £250 week-1 deposit (Full only) − prior unrecovered shortfall`. Records shortfall, full-or-nothing recovery.
  - **Commission**: `payout = gross × commission_rate` (default 0.85).
- Stripe Connect transfer to `instructors.stripe_account_id`.

### Credits — pooled per learner, not yet per-instructor

`webhook.js` `handleCreditPurchase` and `handleSlotBooking` write to `learner_users.balance_minutes` (single pool). `slots.js` deducts from the same pool on booking. No `instructor_id` on credit rows, no `effective_rate_pence_per_minute` snapshot.

This works with one instructor because everyone implicitly belongs to Fraser. It breaks the moment instructor #2 exists.

### Stripe Connect — API ready, UI missing

`api/connect.js` has `create-account`, `onboarding-link`, `connect-status`, `dashboard-link`, admin invite, dismiss. `instructors.stripe_account_id` and `stripe_onboarding_complete` columns exist. But the instructor profile page shows no banner prompting onboarding, and the admin portal has no payment-readiness column.

## What this plan deliberately is NOT

- A package-tracking system on credits. Credits store the per-minute rate they were bought at, and they're locked to the instructor they were bought from. The "package" (bulk vs. standard) only matters at purchase time to compute the rate.
- A shared-credit-pool system. Decision 7 of the franchise plan is final: credits are scoped to a specific instructor at purchase time. If a learner wants lessons with someone else, they buy credits from that instructor's page.

## Steps

### Step 0 — Symmetric Connect onboarding + Stripe schedule cutover (~1–2 hours) — **prerequisite for Step 4**

> **History note:** the original Step 0 (drafted 2026-05-16, PR #129) specced a `cron-platform-sweep.js` that paid the full platform Stripe balance to Fraser's bank every Friday at 09:30. That approach was **rejected on 2026-05-15** after a follow-up discussion. The reasoning is preserved at the end of this section under "Why the sweep cron was rejected"; the rest of this section is the replacement plan.

**Why this exists.** Discovered 2026-05-16 during Step 1's audit. The Friday payout cron architecture (`api/cron-payouts.js` → `_payout-helpers.js`) assumes the platform Stripe balance is escrow between purchase and lesson delivery. The platform account is currently configured **Stripe Dashboard → Business → Payouts → Schedule: Automatic Daily**, which empties the balance every day. By the time the cron tries `stripe.transfers.create({ destination: instructor.stripe_account_id })`, the funds have already been auto-paid to Fraser's bank. The transfer would fail with `insufficient_funds`.

Additionally, Fraser's instructor row has `stripe_account_id = NULL` and `payouts_paused = TRUE` (a historical dismiss-button artefact, dismiss UI removed in PR #130). This means his row is currently *invisible* to the Friday payouts cron. Once instructor #2 onboards, this asymmetry becomes a maintenance liability — Fraser-the-special-case vs everyone-else-symmetric.

**Data confirming the failure mode:**
- 49 unpaid chargeable bookings on Fraser's row, total £3,842.50 (May 2026)
- April 2026 payout reconciliation: £676.50 in, £645.07 out, ending balance £0.00
- Platform balance has been £0 at end-of-period for the entire trading history

**Without Step 0, Step 4 cannot ship.** Instructor #2's first Friday cron run would fail silently because the Stripe balance is empty. This is a financial-plumbing prerequisite, not an optional polish step.

**The architecture in one sentence.** Fraser becomes a normal instructor on the existing payouts cron, paid via his own Connect account for delivered lessons. The platform Stripe account stops auto-paying-out, keeps both escrow for undelivered credit *and* platform revenue commingled, and Fraser triggers manual Stripe payouts to his sole-trader bank when he wants to draw down cashflow.

**0a. Pre-flight check — verify Stripe supports the shape.**

Before any code, confirm via Stripe docs or Stripe Dashboard support chat that:
1. A sole trader can be both the platform account holder *and* hold a Connect Express account under the same legal identity (same name, DOB, UTR). Read is "yes, common pattern" but Step 0 depends on it.
2. "Separate charges and transfers" remains the supported architecture — money lands in the platform balance, sits there until `stripe.transfers.create({ destination })` moves it. (This is what `_payout-helpers.js` already does; just confirming nothing in Stripe's current model breaks the assumption.)

If either comes back "no" or "requires manual KYC review", **stop and replan** before continuing.

**0b. Switch Stripe platform payout schedule from Automatic Daily → Manual.**

One click in the Stripe Dashboard (Settings → Business → Payouts → Schedule). Reversible. No code change. Effect: Stripe stops auto-paying-out the platform balance — it accumulates until *Fraser* manually triggers a payout in the Stripe Dashboard when he wants cashflow.

**0c. Onboard Fraser through `api/connect.js` as a normal instructor.**

Fraser walks through Stripe Connect Express onboarding under his sole-trader identity, identically to how instructor #2 will onboard later. This creates a *new* Connect account (separate from the platform account `acct_1QUssNIqhTSdZedS`) and populates `instructors.stripe_account_id` on his row (id=4).

**0d. Restore Fraser's row — with `payouts_start_date` defence.**

After onboarding, update Fraser's instructor row:
- `stripe_account_id` ← his new Connect account ID (populated by 0c)
- `payouts_paused` ← `FALSE`
- `stripe_onboarding_complete` ← `TRUE` (once Stripe confirms `charges_enabled && payouts_enabled`)
- **`payouts_start_date` ← `<go-live date>`** — load-bearing. Per `_payout-helpers.js`, the cron has no built-in date floor; without `payouts_start_date`, the first Friday cron run will sweep his entire historical chargeable backlog (49 bookings, £3,842.50 as of 2026-05-16) in one transfer. The `payouts_start_date` column is the braces; `payouts_paused` was the belt. (Lesson from PR #124, captured in `feedback_payout_date_floor.md`.) **Test on staging or a single instructor before flipping the production switch.**

**0e. Confirm State 6 "Payouts Active" on the earnings banner.**

After 0c + 0d, Fraser visits `earnings.html` and the connect-status banner should resolve to State 6 (green "Payouts Active"). State 1 (hidden, legacy platform-owner) no longer applies and that branch of `renderConnectBanner` in `public/instructor/earnings.js` may eventually be deleted — but leave it in place for Step 0 so a rollback is clean. Removal is a separate small PR after Step 0 settles.

**0f. Update docs.**

- `docs/stripe-connect.md` Rules section: remove "Platform owner (Fraser) has `payouts_paused = TRUE` and `stripe_account_id = NULL` — revenue stays in platform account, paid out to bank via Stripe's normal payout schedule." Replace with a note that Fraser is symmetric with other instructors post-Step-0; the platform Stripe account is on Manual schedule and serves as escrow + platform-revenue holding pot.
- `CLAUDE.md` if any references to the platform-owner-special-case need updating.

**Acceptance:**
- Stripe Dashboard schedule confirmed Manual on `acct_1QUssNIqhTSdZedS`.
- Fraser's instructor row has populated `stripe_account_id`, `payouts_paused = FALSE`, `payouts_start_date` set to deploy date.
- First Friday after deploy: `cron-payouts.js` runs at 09:00, picks up Fraser as it would any instructor, transfers only his share of lessons delivered *since `payouts_start_date`* — not the £3,842.50 backlog — to his new Connect account. His Connect account then pays out to his sole-trader bank on its own schedule.
- Platform Stripe balance no longer empties to zero — it accumulates undelivered-credit escrow + platform revenue. Fraser triggers Stripe Dashboard payouts manually when he wants cashflow.
- After instructor #2 onboards (post-Step-4): the same Friday cron pays both of them via the same code path. No special cases.

**Risks:**

| Risk | Mitigation |
|---|---|
| Stripe rejects the same-legal-entity-as-platform-and-Connect onboarding | Step 0a pre-flight; replan before code if needed |
| First Friday cron picks up £3,842.50 backlog and transfers it all to Fraser's new Connect account | `payouts_start_date` is the defence; verify the eligibility filter in `_payout-helpers.js` honours it; test on a single instructor first |
| Stripe schedule accidentally flipped back to Automatic Daily | Document in `docs/stripe-connect.md` that Manual is load-bearing; consider a small admin-dashboard health check that reads the schedule via Stripe API |
| Fraser forgets the platform Stripe balance is now refundable-credit + platform-revenue commingled and over-draws | Out of scope for Step 0; addressed by the post-Step-0 "outstanding credit liability vs platform balance" admin dashboard (see "Operational follow-on" below) |

**Trade-offs Fraser explicitly accepts** (quoted for the record):
- **Refundable-credit money commingles with platform revenue in the platform Stripe account, by design.** "I've thought about it and the cashflow is genuinely worth more to me than the structural refund-safety." Refund-safety becomes a discipline-and-visibility problem (see operational follow-on), not an architectural guarantee.
- **No separate platform-revenue Connect account.** Considered and rejected — the existing platform Stripe account does both jobs (escrow + platform revenue), Fraser draws cashflow manually when he wants to. Don't re-propose splitting these unless Fraser raises it.
- **Stripe payouts to Fraser's sole-trader bank are now manual, not automatic.** Fraser presses "Pay out" in Stripe Dashboard when he wants money out. The trade-off is real because earlier he flagged "things should run without my manual involvement" — but the manual press is now the *deliberate decision moment* where he chooses how much cashflow to take vs. leave as refundable escrow. That's a feature, not friction.

**Operational follow-on (not in Step 0's scope, but load-bearing soon after):**

A small admin-dashboard widget that displays, in real time:
- Platform Stripe balance (`stripe.balance.retrieve()`)
- Total outstanding learner-credit liability (sum of `learner_users.balance_minutes` × rate paid, or per-instructor equivalent post-Step-4)
- Headroom between them (cashflow safely available to draw)

Under the old architecture this would have been nice-to-have. Under this one it's the safety net for refund-safety. Spec: ~50-line admin page or banner. Plan as a small standalone PR after Step 0 settles, before instructor #2 onboards.

**Why the sweep cron was rejected** (preserved for posterity):

The original Step 0 (PR #129) added `cron-platform-sweep.js` to fire every Friday at 09:30, calling `stripe.payouts.create` for the full available platform balance. Two problems surfaced in the 2026-05-15 follow-up discussion:

1. **Wrong abstraction.** "Fraser is a special case paid via balance sweep" is harder to maintain than "Fraser is just another instructor row." The dismiss-button artefact (`stripe_account_id = NULL`) was the bug, not the architecture. Restoring his row + onboarding a Connect account uses the same code path that already serves instructor #2 — net negative complexity vs. adding a new cron.
2. **Sweep takes everything, including escrow.** A naive full-balance sweep also drains money for undelivered credit into Fraser's bank, commingling it with personal spend. The PR #129 plan acknowledged this on line 91 ("Bank balance still commingles prepayments with earned revenue") but treated it as an accepted trade-off. In the follow-up discussion, the cleaner shape (escrow stays in Stripe, Fraser manually draws cashflow when he wants) won out.

**Why not destination charges instead** (the Outsider's Option C from the Council deliberation): destination charges split funds at *purchase* time. That conflicts with refundable credits (we'd have to claw back from the instructor's Connect account on refund) and with the planned per-instructor FIFO credit model (Step 4g). Defer until a concrete reason to revisit appears.

**Why not a third "platform-revenue" Connect account.** Briefly considered in the 2026-05-15 discussion — keep `acct_1QUssNIqhTSdZedS` as pure escrow, add a third Connect account for franchise fees / commission cuts. Fraser rejected on cashflow grounds: the prepaid-credit cashflow is genuinely useful to the business and ringfencing it removes a working-capital lever he wants to keep. Recorded so the question doesn't get reopened automatically.

**Deferred:** none specific to Step 0 — the dismiss-button UI was removed in PR #130 (separate from this plan). The `handleDismissConnect` API handler still exists in `api/connect.js` but is no longer called from any UI; safe to leave or remove in a future cleanup PR.

**Related memory:** `project_platform_owner_payout_model.md` — current decision + architectural rationale, supersedes the original 2026-05-16 sweep-cron framing.

---

### Step 1 — Stripe Connect health check + banner (~2–3 hours) ✅ Shipped 2026-05-16

**Health check (1a) finding:** Fraser's own Connect account had three past-due requirements (external account, representative, ToS) silently blocking payouts. Stripe Dashboard remediation in-progress; the banner work proceeds independently since the new UI is designed to render the exact failure state Fraser is currently in.

**Shipped slice differs from the plan as written in two ways** (both safer):

1. **No banner on `profile.html`.** A banner already existed on `earnings.html` (the natural home for payouts UI). Adding a second renderer on `profile.html` would have meant two divergent state machines for the same data. Instead, the existing earnings banner was *upgraded* to surface the new state, and `dashboard.html` got a one-line clickable alert that links to the earnings page when there's a problem.
2. **Admin Payments column is DB-only.** Original plan implied per-row live Stripe state. The shipped version reads three DB columns (`stripe_account_id IS NOT NULL`, `stripe_onboarding_complete`, `payouts_paused`) — accurate enough for the "who's set up at all" triage view, avoids N+1 Stripe round-trips on admin pageload, and self-heals when each instructor next visits their own earnings page. See `docs/stripe-connect.md` for the trade-off note.

See DEVELOPMENT-ROADMAP entry 2.99 for the shipped commit history.

---

### Step 1 — Stripe Connect health check + banner (~2–3 hours) [original spec]

**1a. Verify Fraser's own Connect account is healthy.**
Run `connect-status` against Fraser's instructor row. Confirm `charges_enabled = true`, `payouts_enabled = true`, and `requirements.currently_due` is empty. If any of those are off, fix that *first* — nothing downstream matters if the platform's own payout pipeline is broken.

**1b. Banner on instructor profile + dashboard.**
- New banner card at the top of `public/instructor/profile.html` and a one-line alert on the instructor dashboard.
- On page load: `GET /api/connect?action=connect-status`.
- Three visual states:
  - **No `stripe_account_id`** → red banner: "Set up payments to receive learner payments." Button: "Start Stripe setup" → `POST ?action=create-account`, redirect to returned `url`.
  - **Account exists, `charges_enabled=false` or `payouts_enabled=false`, or requirements pending** → amber banner: "Finish your Stripe setup — Stripe needs more info before you can be paid." Button: "Continue setup" → `GET ?action=onboarding-link`, redirect.
  - **Both true, no requirements** → small green check or quiet "Payments connected" line in account settings.

**1c. Admin portal column.**
Instructor list in admin portal gets a "Payments" column: ✅ / ⚠️ / ❌. So Fraser can see at a glance who's stuck and nudge them.

**Acceptance:**
- Fraser's own profile shows the green "connected" state.
- Faking `stripe_onboarding_complete = false` on a test instructor renders the red banner with a working button.
- Admin portal column reflects reality for all instructors.

---

### Step 2 — Public instructor profile pages (~4–6 hours)

The learner-facing storefront for each instructor. Useful immediately even with one instructor — makes CoachCarter look like a real platform when prospects browse, and becomes the foundational landing page for any "Sarah's lessons" link (referrals, Google, marketing).

**2a. Route and data.**
- New page: `/instructor.html?slug=<slug>` (or `?id=<id>`). Public, no auth needed.
- Add `instructors.slug TEXT UNIQUE` column. Backfill from name (e.g. `fraser-carter`). Admin edit form lets it be changed.
- New `api/instructor.js?action=public-profile&slug=<slug>` endpoint returning only safe fields: `name, slug, photo_url, area, bio, hourly_rate_pence (effective, from school default or override), bulk_tiers_enabled, bulk_discount_tiers (only if enabled), school_id`. **Never returns** email, phone, stripe_account_id, franchise fee, commission rate, etc.

**2b. Page content.**
- Hero: photo + name + area + "Book now" CTA.
- Rate card: "£55/hour" or whatever the effective rate is. If `bulk_tiers_enabled`, render the bulk ladder: "Save 2.5% on 12h, 5% on 24h, 7.5% on 36h."
- Bio / about / qualifications.
- Two primary CTAs:
  - **Book now** → `/learner/book.html?instructor_id=<id>` (slot feed pre-filtered to this instructor).
  - **Buy credits with [name]** → `/learner/buy-credits.html?instructor_id=<id>` (purchase flow pre-anchored to this instructor — wired up in Step 4).
- "What you get": optional list of tier inclusions if you want to surface them (decals, dual control, etc.) — sourced from `franchise_tiers.inclusions` once Step 3 ships.

**2c. Navigation.**
- Homepage gets a small "Our instructors" section linking to each profile.
- Admin portal can show the public URL on each instructor row ("View public profile").

**Acceptance:**
- Visiting `/instructor.html?slug=fraser-carter` while logged out renders Fraser's profile, rate, and a working "Book now" button.
- "Buy credits with Fraser" goes somewhere sensible (deferred actual instructor-scoping to Step 4 — for now it can land on the existing buy-credits page with the instructor query param ignored).
- A second instructor seeded into the DB renders correctly without code changes.
- No PII or financial config leaks via the public endpoint (manually check response payload).

---

### Step 3 — Phase 1 schema groundwork (~4–6 hours)

From `FRANCHISE-MODEL-PLAN.md` Phase 1. No behavioural change — pure schema + backfill so Step 4 has something to write to.

**3a. Migration in `db/migration.sql`.**

```sql
-- Tier definitions (admin-editable, not hardcoded)
CREATE TABLE IF NOT EXISTS franchise_tiers (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  weekly_fee_pence INTEGER NOT NULL,
  inclusions JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, slug)
);

-- Per-instructor tier + opt-ins + rate override
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS franchise_tier_id INTEGER REFERENCES franchise_tiers(id);
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS contract_start_date DATE;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS bulk_tiers_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS hourly_rate_pence INTEGER;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS slug TEXT;

-- Per-instructor credit scoping
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id);
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS effective_rate_pence_per_minute INTEGER;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_pence INTEGER;

CREATE TABLE IF NOT EXISTS learner_credit_balances (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  school_id INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  balance_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (learner_id, instructor_id)
);
CREATE INDEX IF NOT EXISTS idx_lcb_learner ON learner_credit_balances(learner_id);
CREATE INDEX IF NOT EXISTS idx_lcb_instructor ON learner_credit_balances(instructor_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_instructor ON credit_transactions(instructor_id);
CREATE INDEX IF NOT EXISTS idx_franchise_tiers_school ON franchise_tiers(school_id) WHERE active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructors_slug ON instructors(slug) WHERE slug IS NOT NULL;
```

**3b. Seeds.**

```sql
INSERT INTO franchise_tiers (school_id, name, slug, weekly_fee_pence, inclusions, sort_order)
VALUES
  (1, 'Full Franchise', 'full', 19500,
   '["Car", "Decals", "Dual Control", "12-month contract"]'::jsonb, 1),
  (1, 'Part Franchise', 'part', 7000,
   '["Decals", "Dual Control (your own car)", "12-month contract"]'::jsonb, 2)
ON CONFLICT (school_id, slug) DO NOTHING;
```

**3c. Backfill.**

- `learner_users.balance_minutes` → one `learner_credit_balances` row per learner, `instructor_id = Fraser`.
- `instructors.contract_start_date` → CoachCarter launch date for Fraser.
- `instructors.franchise_tier_id` → NULL for Fraser (school owner, not a franchisee).
- `instructors.bulk_tiers_enabled = TRUE` for Fraser only (grandfather).
- `instructors.hourly_rate_pence` → NULL for everyone (inherit school default).
- `instructors.slug` → generated from name (`LOWER(REPLACE(name, ' ', '-'))`), uniqueness-checked.
- `credit_transactions.effective_rate_pence_per_minute = ROUND(amount_pence / NULLIF(minutes, 0))` for existing rows. Legacy rows where minutes=0 stay NULL.
- `lesson_bookings.list_price_pence` backfilled from existing pricing logic: `COALESCE(iln.custom_hourly_rate_pence × duration / 60, lesson_types.price_pence, 8250)`.

**Acceptance (with Empiricist's pence-exact rule):**
- Migration applies cleanly via `GET /api/migrate?secret=...`.
- Full Playwright suite passes (no behaviour change).
- `franchise_tiers` shows two seeded rows.
- **For every learner**: `learner_credit_balances.balance_minutes` (summed across their rows) equals `learner_users.balance_minutes` **to the minute**, not "within tolerance."
- For 50 sampled `credit_transactions` with non-zero minutes: `effective_rate_pence_per_minute × minutes` reconciles to `amount_pence` within ±1p (rounding only).
- Every `lesson_bookings` row has non-null `list_price_pence`.
- Fraser's `bulk_tiers_enabled = TRUE`; every other instructor (if any) `FALSE`.
- Fraser's `slug` populated and unique.

**Dual-write safety net during transition:** while Step 4 is mid-deploy, `learner_users.balance_minutes` and `learner_credit_balances` both exist. Add a `balance_audit` trigger or shim so any path updating one updates the other, to catch the legacy/free-trial/referral entry points that haven't been migrated yet.

---

### Step 4 — Phase 2 Thread A: per-instructor credit scoping (~8–14 hours)

The behavioural change. This makes the credit side match the payout side.

**4a. Purchase paths require `instructor_id`.**
- `api/credits.js` checkout: require `instructor_id` in the request. Compute `effective_rate_pence_per_minute` server-side using the chosen instructor's effective rate (Step 4 uses school default; full three-level fallback ships with Phase 2B later). Pass both into Stripe metadata.
- `api/webhook.js handleCreditPurchase`: write `credit_transactions.instructor_id` and `effective_rate_pence_per_minute`. Upsert `learner_credit_balances(learner_id, instructor_id)`. Keep writing to legacy `learner_users.balance_minutes` for the grandfather path during transition.
- `api/webhook.js handleSlotBooking`: same scoping. Snapshot `lesson_bookings.list_price_pence` from the slot price.

**4b. Booking paths read per-instructor balances.**
- `api/slots.js` book action: deduct from `learner_credit_balances` for the *chosen* instructor. Refuse with a clear, instructor-aware error: "You have 12 hours of credits with Fraser but none with Sarah. [Buy credits with Sarah](link)."
- Cancellation refund: return minutes to the same `(learner_id, instructor_id)` row.
- Set `lesson_bookings.list_price_pence` at book time from the credit's `effective_rate_pence_per_minute × duration_minutes`.

**4c. Payout cron uses snapshots.**
- `api/_payout-helpers.js`: switch the live price lookup to read `lesson_bookings.list_price_pence` instead of joining `lesson_types`/`instructor_learner_notes`. Fall back to live computation only when `list_price_pence IS NULL` (legacy rows pre-migration).

**4d. Learner UI.**
- `public/learner/buy-credits.html` and `book.js`: derive `instructor_id` from the URL query (`?instructor_id=X`) — set by the "Buy credits with [name]" CTA on the instructor profile page from Step 2. If no instructor_id and the learner has only one instructor with credits, default to them. Otherwise require explicit selection.
- `public/learner/profile.html`: render per-instructor balances as separate rows ("12h with Fraser", "6h with Sarah") instead of a single pooled number.
- `api/credits.js?action=balance`: returns array of per-instructor balances.

**4e. Other entry points to audit (Architect's seams list).**
- Free-trial flow
- Referral-rewards flow
- Admin manual credit-adjustment flow
- Guest checkout for a specific slot
- Legacy `learner_users.balance_minutes` (read-only, consumed first when booking with originally-allocated instructor — Fraser)

Each of these writes to credits today. Each needs `instructor_id` plumbed through.

**Acceptance criteria:**
- New credit purchase from Fraser's profile page → `credit_transactions` row has `instructor_id = Fraser` and non-null `effective_rate_pence_per_minute`.
- `learner_credit_balances` row for `(learner, Fraser)` incremented by purchased minutes.
- Booking with Fraser deducts from the right row and snapshots `list_price_pence`.
- **Cross-instructor refusal test**: learner has credits with Fraser only; attempts to book Sarah → clear error message with link to Sarah's buy-credits page.
- 48-hour cancellation returns minutes to the same `(learner_id, instructor_id)` row.
- Existing learner with legacy `balance_minutes` can still book Fraser; legacy column drains first until zero.
- Guest-checkout slot booking lands in the correct per-instructor balance with rate snapshot.
- Payout cron uses `list_price_pence`. Test with one bulk-purchased lesson and one ad-hoc lesson; pence-exact match.
- Playwright: buy → book → cancel → re-book scoped to one instructor passes.
- Playwright: refused cross-instructor booking passes.
- **Money reconciliation**: for the test week, `SUM(credit_transactions.amount_pence)` for new rows matches Stripe Dashboard's reported gross within 0.01%.

---

### Step 4g — FIFO credit consumption + cross-source booking attribution (~4–6 hours, lands as part of Step 4)

A learner can hold multiple `credit_transactions` rows for the same `(learner_id, instructor_id)` pair at different `effective_rate_pence_per_minute` values. Example: a 12-hour pack bought at the 2.5% bulk-tier (89p/min) followed two weeks later by a 24-hour top-up at the 5% tier (87p/min). When the learner books a lesson, which row drains? When they cancel, which rate refunds? The plan as written doesn't say, so Step 4g locks the rule in.

**The rule: FIFO by `credit_transactions.created_at` ascending.**

Older credits drain first. Refunds (cancel ≥48h) return minutes to the *same source row(s)* they were drawn from, at the source row's `effective_rate_pence_per_minute`. The booking carries an audit trail of which row(s) funded it.

**Why FIFO and not the alternatives** (recorded so future-Claude doesn't reopen this):

- **FIFO (chronological)** — Chosen. Matches the learner's mental model ("use my older credits before my newer ones"). Preserves a 1:1-ish mapping between a booking and its funding credit row, which Step 4f's Stripe-fee attribution relies on. Audit-friendly: every booking points at exactly which purchase paid for it.
- **LIFO (newest first)** — Rejected. Creates a perverse incentive where every top-up defers the older credits; if the learner leaves or the credits expire, they lose the more expensive ones. Feels generous in the moment, hostile on aggregate.
- **Weighted-average blended rate** — Rejected. Recomputing a blended `balance_minutes`-rate on every top-up dilutes the discount tier the learner paid for, loses the per-purchase audit trail, and breaks Step 4f (Stripe-fee attribution needs to point at *a* charge, not a blend of charges).

**Cross-source bookings (decided: split attribution).**

A booking can straddle two credit_transactions rows when the older row has fewer minutes left than the booking duration. With both 60- and 90-min lessons legal, splits *will* happen routinely. The booking's funding is split across two (or rarely more) source rows, each contribution recorded with its own rate snapshot.

**Why split rather than promote-to-newest or auto-refund stranded minutes** (recorded):

- **Split attribution** — Chosen. Correct accounting: the learner used some of pack A and some of pack B, and that's exactly what the data says. Refunds are exact. Generalises cleanly to Stripe-fee attribution (each source contributes proportionally). Small schema cost (one join table).
- **Promote-to-newest** — Rejected. Creates "orphan minutes" stranded on the older pack that the UI has to explain ("you have 60 min left at the older rate" — confusing). Pushes the awkwardness onto the learner.
- **Auto-refund stranded minutes** — Rejected. Adds Stripe refund volume for tiny amounts, complicates GDPR retention on credit_transactions, and surprises the learner ("why did I get 60p back?").

**4g.a. Schema.**

New join table — the audit trail of which credit_transactions row(s) funded each booking:

```sql
CREATE TABLE IF NOT EXISTS booking_credit_sources (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
  minutes_drawn INTEGER NOT NULL CHECK (minutes_drawn > 0),
  rate_pence_per_minute INTEGER NOT NULL,         -- snapshotted from credit_transactions at draw time
  contribution_pence INTEGER NOT NULL,            -- = minutes_drawn × rate_pence_per_minute (with rounding rule)
  stripe_fee_pence INTEGER NOT NULL DEFAULT 0,    -- Step 4f: proportional share of source row's Stripe fee
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bcs_booking ON booking_credit_sources(booking_id);
CREATE INDEX IF NOT EXISTS idx_bcs_credit_tx ON booking_credit_sources(credit_transaction_id);
```

`lesson_bookings.list_price_pence` (from Step 4) becomes the **sum** of `booking_credit_sources.contribution_pence` across the booking's sources. Likewise `lesson_bookings.stripe_fee_pence` (Step 4f) becomes the sum of `booking_credit_sources.stripe_fee_pence`. The join table is the source of truth; the booking columns are denormalised summaries kept for query performance.

**4g.b. Booking-time draw logic** in `api/slots.js?action=book`:

```javascript
async function drawFifo(sql, learnerId, instructorId, bookingId, minutesNeeded) {
  // Lock the rows we're about to mutate (FOR UPDATE) inside a transaction
  const sources = await sql`
    SELECT id, effective_rate_pence_per_minute, stripe_fee_pence, minutes,
           remaining_minutes  -- materialised view OR computed via subtraction below
      FROM credit_transactions
     WHERE learner_id = ${learnerId}
       AND instructor_id = ${instructorId}
       AND remaining_minutes > 0
     ORDER BY created_at ASC
     FOR UPDATE
  `;

  let remaining = minutesNeeded;
  const draws = [];
  for (const src of sources) {
    if (remaining === 0) break;
    const take = Math.min(remaining, src.remaining_minutes);
    const rate = src.effective_rate_pence_per_minute;
    const contributionPence = Math.round(take * rate);
    const feeShare = src.stripe_fee_pence != null
      ? Math.round(src.stripe_fee_pence * take / src.minutes)  // banker's rounding in real impl
      : 0;
    draws.push({ creditTxId: src.id, take, rate, contributionPence, feeShare });
    remaining -= take;
  }
  if (remaining > 0) throw insufficientCreditsError(...);  // instructor-aware message from Step 4b

  // Persist
  for (const d of draws) {
    await sql`INSERT INTO booking_credit_sources (booking_id, credit_transaction_id, minutes_drawn, rate_pence_per_minute, contribution_pence, stripe_fee_pence)
              VALUES (${bookingId}, ${d.creditTxId}, ${d.take}, ${d.rate}, ${d.contributionPence}, ${d.feeShare})`;
  }
  // Denormalise onto booking
  const totalContribution = draws.reduce((a, d) => a + d.contributionPence, 0);
  const totalFee = draws.reduce((a, d) => a + d.feeShare, 0);
  await sql`UPDATE lesson_bookings
               SET list_price_pence = ${totalContribution},
                   stripe_fee_pence = ${totalFee}
             WHERE id = ${bookingId}`;
  // Decrement learner_credit_balances
  await sql`UPDATE learner_credit_balances
               SET balance_minutes = balance_minutes - ${minutesNeeded}
             WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}`;
}
```

`credit_transactions.remaining_minutes` is `credit_transactions.minutes − SUM(booking_credit_sources.minutes_drawn WHERE NOT refunded)`. Either store it as a denormalised column maintained by triggers, or compute it on demand — pick at implementation time based on read frequency. Recommend denormalised + trigger for performance, with a daily reconcile cron that catches drift.

**4g.c. Cancellation refund logic** in `api/slots.js?action=cancel`:

≥48h cancellation:

```javascript
// Find every credit_transactions row that funded this booking, return minutes at original rate
const sources = await sql`SELECT * FROM booking_credit_sources WHERE booking_id = ${bookingId}`;
for (const src of sources) {
  await sql`UPDATE credit_transactions
               SET remaining_minutes = remaining_minutes + ${src.minutes_drawn}
             WHERE id = ${src.credit_transaction_id}`;
}
await sql`UPDATE learner_credit_balances
             SET balance_minutes = balance_minutes + ${totalMinutesRefunded}
           WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}`;
// Mark the booking_credit_sources rows as refunded for audit (don't delete — keep history)
await sql`UPDATE booking_credit_sources SET refunded_at = NOW() WHERE booking_id = ${bookingId}`;
```

(Adds a `refunded_at TIMESTAMPTZ` column to `booking_credit_sources`. NULL = active draw, non-NULL = reversed by a refund.)

<48h cancellation: `credit_forfeited = TRUE` on `lesson_bookings` (booking-status restructure), `booking_credit_sources` rows untouched (the learner used those credits, even though the lesson didn't happen). Instructor still paid via the booking's snapshotted `list_price_pence`. Aligned with the "instructor paid unless 48h+ notice" principle.

**4g.d. Concurrency.**

Two bookings happening simultaneously for the same learner must serialise around the credit draw. Wrap the booking transaction in `SELECT ... FOR UPDATE` on the relevant `credit_transactions` rows (shown in 4g.b). Without this lock, two concurrent bookings could both observe `remaining_minutes = 90` on the same row and both draw 90 minutes, overdrafting. Postgres row locks are sufficient; no need for a Redis mutex.

**4g.e. Migration of in-flight balances.**

Existing learners with `learner_users.balance_minutes` (the legacy pooled column) already get a backfill in Step 3 that creates one `learner_credit_balances` row per learner with `instructor_id = Fraser`. Step 4g adds: backfill one synthetic `booking_credit_sources` row *per existing chargeable booking*, pointing at the closest-matching `credit_transactions` row by date. For bookings that pre-date any credit purchase (free-trial, referral reward, admin-granted), insert a `booking_credit_sources` row with `credit_transaction_id = NULL` and `rate_pence_per_minute = list_price_pence / duration_minutes`. NULL credit_tx_id means "not refundable to a specific purchase" — the booking still has a known rate, just no source row.

Schema tweak to allow this:

```sql
ALTER TABLE booking_credit_sources ALTER COLUMN credit_transaction_id DROP NOT NULL;
-- credit_transaction_id IS NULL = booking funded by a non-Stripe source (free trial, referral, admin grant)
```

**4g.f. Refund-a-purchase (out of scope, but flagged).**

Distinct from refund-a-booking: a learner might ask for a cash refund of an unused (or partially-used) top-up purchase, regardless of FIFO. This is handled via Stripe's original-charge refund mechanism and only the *unused* portion is refundable in cash. The remaining_minutes on the credit_transactions row must reach zero before the Stripe refund settles, otherwise the learner has both the money back and unbookable credits. Deferred to a follow-up plan when first requested — manual admin SQL until then.

**Acceptance criteria:**

1. **Single-source booking**: learner has only credit_tx #1 with 720 min at 89p/min → books a 90-min lesson → one `booking_credit_sources` row, 90 min @ 89p, contribution_pence = 8010p. `lesson_bookings.list_price_pence` = 8010p.
2. **Cross-source split**: learner has credit_tx #1 with 60 min remaining at 89p, credit_tx #2 with 1440 min at 87p → books a 90-min lesson → two `booking_credit_sources` rows (60 min @ 89p = 5340p, 30 min @ 87p = 2610p). `lesson_bookings.list_price_pence` = 7950p, sum matches.
3. **FIFO order verified**: same learner books five more 90-min lessons → credit_tx #1 fully drained (remaining_minutes = 0), credit_tx #2 partially drawn. No booking touches #2 while #1 still has minutes.
4. **Refund returns to source**: cancel cross-source booking from (2) ≥48h → credit_tx #1.remaining_minutes += 60, credit_tx #2.remaining_minutes += 30. `learner_credit_balances.balance_minutes` += 90. `booking_credit_sources.refunded_at` set on both rows.
5. **Late-cancel does not refund**: same booking cancelled <48h → `credit_forfeited = TRUE`, no credit_tx rows touched, `booking_credit_sources.refunded_at` stays NULL, instructor still paid `list_price_pence = 7950p` at the next payout.
6. **Concurrency**: two parallel `?action=book` requests for the same learner with exactly enough minutes for one booking → exactly one succeeds, the other returns insufficient-credits.
7. **Step 4f integration**: a 24-hour pack with `stripe_fee_pence = 220p` drained over 16× 90-min bookings → `SUM(booking_credit_sources.stripe_fee_pence WHERE credit_transaction_id = X) = 220p` exactly (with banker's rounding + carry-the-remainder).
8. **Backfill**: post-migration, every existing chargeable booking has at least one `booking_credit_sources` row; `SUM(booking_credit_sources.contribution_pence) = lesson_bookings.list_price_pence` for every booking; `SUM(booking_credit_sources.minutes_drawn) = lesson_bookings.duration_minutes` for every booking.

**Risks:**

| Risk | Mitigation |
|---|---|
| `remaining_minutes` denormalisation drifts from the truth (`minutes − SUM(non-refunded draws)`) | Daily reconcile cron compares the two; alerts on any mismatch; nightly job, low traffic window |
| Concurrent booking double-spend | `SELECT ... FOR UPDATE` on the credit_transactions row inside the booking transaction |
| Backfill picks the wrong source row for a historical booking | The pre-Step-4 world had a single pooled balance; any "wrong" attribution is internally consistent within the pre-migration period. Pence sums still reconcile. Document the heuristic in the migration commit message. |
| UI for "credits remaining" needs to surface multiple rates | `api/credits.js?action=balance` returns array of per-credit-tx remaining rows (count, rate, expiry if any); learner profile shows the aggregate; a "show breakdown" link expands |
| Stranded sub-lesson-length minutes on an older pack | Will happen rarely once FIFO is fully active (the next booking just draws across both rows). For the truly stranded edge case (one min left on an old pack, learner never books again), the remainder ages out with the row — no special handling |
| Refund returns minutes to a credit_tx row whose source charge has since been Stripe-refunded | Edge case (would require a refund-a-purchase to have run first). Guardrail: `?action=cancel` refuses to credit-back to a `credit_transactions` row where the underlying charge is fully refunded — the booking cancellation still proceeds but credits don't restore. Logged for admin follow-up. |

**Open questions:**

1. **Should `booking_credit_sources` rows be GDPR-anonymised when a learner is deleted?** Yes — cascade via `lesson_bookings.learner_id` anonymisation. Add to the cascade list in `handleConfirmDeletion()` and `cron-retention.js` (CLAUDE.md rule).
2. **Credit expiry** — not in scope today. If introduced, FIFO order naturally favours draining nearly-expired credits first, which is the right behaviour with no code change needed.
3. **Cross-instructor admin override** (open question 1 from Step 4) — a one-off SQL conversion from Sarah-credits to Mark-credits would create new `credit_transactions` rows for Mark and zero out Sarah's. The `booking_credit_sources` history on past bookings stays intact (those rows already drew from the Sarah-charge); the converted-forward balance is a fresh purchase from Mark's perspective. No mechanic change.

---

### Step 4f — Stripe-fee pass-through (~6–10 hours, lands after Step 4)

The instructor — not the platform — absorbs the Stripe processing fee on each payment they receive. Under the franchise model, the franchise fee is sized to cover platform costs (servers, support, marketing); under the commission model, the platform's commission percentage already accounts for its own operating costs. Either way, payment-processing cost is a *per-transaction* cost incurred by the instructor's revenue line — it should reduce *their* take-home, not eat into the platform's margin.

This step implements **A3: net-of-Stripe at the booking level**. Stripe's fee is snapshotted on each booking row at the moment Stripe reports it, and the payout pipeline reads `list_price_pence − stripe_fee_pence` as the instructor's contribution from that booking. There is no separate "fee debt" ledger and no interaction with the franchise shortfall column.

**Why A3 and not the alternatives** (recorded so future-Claude doesn't reopen this):

- **A1 (platform absorbs)** — Rejected. Stripe fees on UK domestic cards (~1.5% + 20p) compound across volume; on £55/hour bookings that's ~£1.03/lesson. With instructor #2 at 20 lessons/week that's £20/week the platform eats forever. The franchise fee was not sized for this; the commission rate was not sized for this.
- **A2 (booking-level surcharge to learner)** — Rejected. Surfacing a "card-processing surcharge" line item at checkout is friction the competitive set doesn't have. CoachCarter pricing is round-pound deliberately.
- **A3 (net-of-Stripe at booking)** — Chosen. Clean per-booking accounting, no separate ledgers, snapshot survives refunds, identical mechanic across franchise and commission models, instructor's earnings report explains exactly where the difference between list and take-home came from.
- **A4 (weekly aggregate fee deduction)** — Rejected. Works for franchise (deduct alongside the weekly franchise fee) but doesn't generalise to commission cleanly, and obscures per-booking traceability.

**Three decisions are locked in** (from prior session, do not re-litigate):

1. **Commission model uses Option A**: commission applied to **gross** (i.e. `list_price_pence × commission_rate`), Stripe fee deducted from the instructor's share as a *separate line*. This means the mechanic is identical across franchise and commission models — both subtract the booking's `stripe_fee_pence` from the instructor contribution after gross is established. The instructor's payout summary shows three lines: gross from bookings → minus Stripe fees → minus franchise fee (or × commission) → net.

2. **Stripe-fee handling uses A3**: net-of-Stripe at the booking level via a new column `lesson_bookings.stripe_fee_pence INTEGER` (nullable; NULL = unknown/not-yet-reported, treated as zero by payout code). The instructor contribution for the booking is `list_price_pence - COALESCE(stripe_fee_pence, 0)`. No special "fee debt" tracking, no shortfall interactions, no separate fee ledger.

3. **Refund-orphaned Stripe fees** (cancellation ≥48h, Stripe keeps the fee since the September 2022 policy change): **platform absorbs.** Documented as expected cost of doing business — typical volume is low enough that a per-week orphan-fee tally is fine as a watchlist metric, not an action item. **Chargebacks: out of scope for Step 4f**, separate problem to be handled if/when one occurs.

**4f.a. Schema migration.**

```sql
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER;
ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS stripe_fee_source TEXT;
-- stripe_fee_source: 'balance_transaction' (canonical, from Stripe API) | 'estimated' (computed at book time, awaiting reconciliation) | NULL (no fee, e.g. credit-redemption with no fresh charge)
```

`stripe_fee_pence` on `credit_transactions` is the **canonical** source-of-truth row for a Stripe payment. `lesson_bookings.stripe_fee_pence` is the *attributed share* — for single-lesson bookings it equals the credit_transaction's fee; for bulk-pack purchases the fee is split across the booked lessons as they're consumed (see 4f.c).

**4f.b. Capture the fee at webhook time.**

`api/webhook.js` already receives `payment_intent.succeeded` / `checkout.session.completed`. Augment each handler to fetch the associated `balance_transaction` and extract `balance_transaction.fee` (always in pence for GBP):

```javascript
// In handleCreditPurchase, handleSlotBooking, handleOfferBooking, handleFreeOffer
const charge = await stripe.charges.retrieve(paymentIntent.latest_charge, {
  expand: ['balance_transaction']
});
const stripeFeePence = charge.balance_transaction?.fee ?? null;
```

Store on `credit_transactions.stripe_fee_pence`. The `balance_transaction` is typically available within seconds of `payment_intent.succeeded` but isn't guaranteed; if `null`, write NULL and reconcile in 4f.e.

**4f.c. Attribute the fee to bookings — defers to Step 4g.**

Step 4g (FIFO consumption + cross-source attribution) owns the booking-to-credit-tx mapping via `booking_credit_sources`. Step 4f's job is just to snapshot the *source row's* Stripe fee at webhook time; the per-booking attribution falls out of 4g's draw logic for free.

Two cases:

- **Direct slot booking** (`handleSlotBooking`, `handleOfferBooking`, `handleFreeOffer`): one charge → one credit_transactions row → one booking, drawn immediately. The 4g draw logic creates a single `booking_credit_sources` row with `stripe_fee_pence` equal to the full source-row fee. `lesson_bookings.stripe_fee_pence` (denormalised summary) = same value. Set `stripe_fee_source = 'balance_transaction'`.
- **Bulk credit pack** (`handleCreditPurchase`): one charge → N future bookings drawn over time. The fee is split *pro-rata by minutes* by 4g's draw logic: for each draw, `booking_credit_sources.stripe_fee_pence = ROUND(credit_tx.stripe_fee_pence × minutes_drawn / credit_tx.minutes)`. Cross-source bookings (4g) accumulate fees from each source naturally — `lesson_bookings.stripe_fee_pence` is the SUM across source rows.

**Rounding rule** (lives in 4g's draw logic, repeated here for the fee accounting context): banker's rounding (half-to-even) at each snapshot. Any sub-penny drift accumulates onto the *final* draw from a credit_transactions row — when that row's `remaining_minutes` hits zero, the last `booking_credit_sources.stripe_fee_pence` row receives the leftover pence so that `SUM(booking_credit_sources.stripe_fee_pence WHERE credit_transaction_id = X)` exactly equals `credit_transactions.stripe_fee_pence`. Pence-exact, no orphan pence.

**4f.d. Payout helper change.**

`api/_payout-helpers.js getEligibleBookings`: change the price column from `price_pence` to `contribution_pence`:

```sql
COALESCE(lb.list_price_pence, <existing live-compute fallback>) - COALESCE(lb.stripe_fee_pence, 0) AS contribution_pence
```

Then in `processPayoutForInstructor`:

```javascript
let totalGrossPence = 0;
let totalStripeFeesPence = 0;
for (const b of bookings) {
  totalGrossPence += parseInt(b.list_price_pence);  // new column from Step 4
  totalStripeFeesPence += parseInt(b.stripe_fee_pence || 0);
}
const totalNetOfStripe = totalGrossPence - totalStripeFeesPence;

// Franchise model:
// payout = totalNetOfStripe - franchiseFee - depositDeducted - priorShortfallPence
//
// Commission model:
// instructorShare = totalGrossPence × commissionRate    // commission on gross, per locked-in Decision 1
// payout = instructorShare - totalStripeFeesPence       // Stripe fees deducted from instructor's share
```

Persist `stripe_fees_pence` on `instructor_payouts` as a new column so the breakdown is queryable historically. Add to migration:

```sql
ALTER TABLE instructor_payouts ADD COLUMN IF NOT EXISTS stripe_fees_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payout_line_items ADD COLUMN IF NOT EXISTS stripe_fee_pence INTEGER NOT NULL DEFAULT 0;
```

**4f.e. Reconciliation cron for late `balance_transaction` data.**

A small daily cron (`api/cron-reconcile-stripe-fees.js`, runs 04:00 UTC) finds any `credit_transactions` row from the last 7 days where `stripe_fee_pence IS NULL`, re-fetches the `balance_transaction`, and backfills. If the row has already been partially drawn (some bookings have NULL `stripe_fee_pence` from this row), it updates those bookings using the same pro-rata rule. Hardens against transient webhook race conditions where `balance_transaction` wasn't ready at `payment_intent.succeeded` time.

If a booking flips to `chargeable` (post booking-status restructure) before its `stripe_fee_pence` is reconciled, the payout cron treats NULL as zero — instructor is overpaid by the fee amount for that one booking. The reconcile cron must catch this *before* Friday 09:00 UTC payout. A guardrail check in `_payout-helpers.js`: if any eligible booking has `stripe_fee_pence IS NULL` and `created_at > NOW() - 48h`, log a warning and either (a) include with fee=0 + alert, or (b) hold the booking until next week. Default: (a) — getting the instructor paid on time outweighs a one-week pence drift that future payouts will swallow.

**4f.f. Instructor earnings UI.**

`public/instructor/earnings.html` payout breakdown:

```
Gross from lessons:    £550.00
Stripe fees:           − £10.34
Franchise fee:         − £195.00
Prior shortfall:       − £0.00
─────────────────────────────
Net payout:            £344.66
```

Tooltip on the Stripe fees row: *"Card-processing fee charged by Stripe on payments your learners made. Typically 1.5% + 20p per UK card payment."*

**4f.g. Refund-orphaned fees — watchlist metric.**

Add a one-line admin dashboard counter: "Orphan Stripe fees this month: £X.XX" — sum of `credit_transactions.stripe_fee_pence` for transactions where the corresponding bookings have all been refunded with no instructor payout drawn from them. Pure information, no action. If this number gets uncomfortable (target: <£20/month at instructor #2 scale; >£50/month sustained is a flag), revisit the absorption decision.

**4f.h. Backfill historical data.**

For all `credit_transactions` rows with non-null `stripe_payment_intent_id` and null `stripe_fee_pence`: one-shot script that paginates through and back-fills via `stripe.charges.retrieve(..., {expand: ['balance_transaction']})`. Set `stripe_fee_source = 'balance_transaction'`. Then attribute to existing bookings using the same pro-rata rule.

For very-old rows where the charge has been archived past Stripe's retrieval window: leave `stripe_fee_pence = NULL`. The payout pipeline treats NULL as zero — historical payouts already happened with the old model, so this only matters if Fraser does a retroactive payout for a stale booking, which is an edge case handled manually.

**Acceptance criteria:**

1. **Live webhook captures fees**: a fresh £55 GBP card payment via webhook end-to-end → `credit_transactions.stripe_fee_pence` populated within 60s, value matches Stripe Dashboard's reported fee to the penny.
2. **Single-lesson booking attribution**: book → `lesson_bookings.stripe_fee_pence` equals the credit_transaction's fee (pence-exact).
3. **Bulk-pack attribution sums correctly**: buy a 12-hour pack → book six 90-min lessons → cancel two with ≥48h notice → `SUM(lesson_bookings.stripe_fee_pence)` across the four remaining bookings + any refund-reversed amounts equals the original `credit_transactions.stripe_fee_pence` exactly.
4. **Franchise payout maths**: dry-run the payout for an instructor with mixed bookings → manually compute `gross − stripe_fees − franchise_fee − prior_shortfall` → pence-exact match against the cron's `instructor_payouts.amount_pence`.
5. **Commission payout maths**: same exercise on a commission-model test instructor → `gross × commission_rate − stripe_fees` → pence-exact match.
6. **Reconciliation cron catches gaps**: simulate a webhook race (NULL `stripe_fee_pence`) → next-day cron backfills correctly → if any bookings funded by that transaction already chargeable, their `stripe_fee_pence` is also corrected.
7. **Refund-orphan tally renders**: cancel ≥48h on a paid booking → orphan-fees counter increments by that booking's `stripe_fee_pence`.
8. **Earnings UI shows the breakdown**: instructor earnings page renders the four-line breakdown with the Stripe-fees row populated.
9. **Backfill script reconciles to Stripe Dashboard**: post-backfill, total `SUM(credit_transactions.stripe_fee_pence)` for the last calendar month matches Stripe Dashboard "Fees" report for the same period within 0.01%.

**What this interacts with:**

- **`BOOKING-STATUS-RESTRUCTURE-PLAN.md`** — prerequisite. The `chargeable` status is the signal that a booking is eligible for payout, and the 1-hour buffer after `end_time` is the window in which the reconcile cron must have fired. If status restructure isn't done, the eligibility filter is fuzzier and the reconcile timing harder to reason about.
- **Step 4 (per-instructor credit scoping)** — prerequisite. `list_price_pence` is the gross-contribution column added in Step 4; Step 4f layers `stripe_fee_pence` on top.
- **Step 4g (FIFO + cross-source attribution)** — prerequisite. The `booking_credit_sources` join table is where Stripe fees are split across source rows; 4f's webhook capture writes the *source-row* fee, and 4g's draw logic distributes it. If 4g isn't done, 4f can't correctly attribute fees on bulk-pack purchases.
- **`FRANCHISE-MODEL-PLAN.md` shortfall column** — explicitly does *not* interact. `stripe_fee_pence` is a per-booking deduction, not a debt; a low-fee week doesn't accumulate into a future high-fee week.
- **`docs/stripe-connect.md`** — needs a new section: "Fee attribution model (Step 4f)" documenting A3, the pro-rata rule, and the reconciliation cron.

**Risks:**

| Risk | Mitigation |
|---|---|
| `balance_transaction` is NULL at webhook time and reconcile cron hasn't fired before Friday payout | Guardrail in `_payout-helpers.js` treats NULL as zero with a logged warning; instructor paid on time, fee absorbed for that one booking (rare, low-£) |
| Stripe pricing changes (currently ~1.5% + 20p) and historical bookings have stale rates baked in | We snapshot the actual fee, not a rate, so changes are transparent — historical bookings reflect what was actually charged |
| Bulk-pack pro-rata splitting creates fractional pence drift | Banker's rounding + carry-the-remainder-to-final-booking rule guarantees pence-exact reconciliation per credit_transactions row |
| Instructor confusion when Stripe-fee line appears on their first payout | Earnings UI tooltip explains it; one-time email at rollout for existing instructors before the first post-deploy Friday payout |
| Refund-orphan tally creeps higher than expected and erodes platform margin | Watchlist metric; revisit absorption decision (move to A4 weekly aggregate or A2 learner surcharge) if sustained >£50/month |
| Backfill script can't retrieve very-old charges from Stripe | Leave NULL; documented as historical-only, no behavioural impact going forward |

**Open questions:**

1. **3D Secure / Klarna / non-card payment fees** — Stripe's `balance_transaction.fee` is the canonical figure regardless of payment method, so the mechanic generalises. But fee structures differ (Klarna ~5%+). No code change needed; just be aware that the per-booking fee may be larger than the typical 1.5%+20p on those rare bookings.
2. **VAT on Stripe fees** — Stripe issues a VAT invoice monthly. We're snapshotting the gross fee (inc. VAT). When CoachCarter Ltd is VAT-registered, the reclaim is at the company level, not per-booking — no code change.
3. **International cards (~2.5% + 20p)** — same mechanic; the snapshot captures the actual fee. Instructor takes the hit on those bookings. If complaints arise, consider a small platform absorption for international-card-flagged bookings, but defer until pain shows up.

---

## Suggested sequencing

### Today (this session)
1. **Step 1a** — verify Fraser's own Connect account is healthy. ~30 min.
2. **Step 1b + 1c** — Stripe Connect banner + admin column. ~2 hours.
3. **Step 2** — public instructor profile pages. ~4–6 hours.

End-of-session artefact: Fraser has a public profile page with a Book Now button, the dashboard shows green "payments connected," and admin portal shows who's payment-ready at a glance.

### This week (draft PR, not merged)
4. **Step 3** — Phase 1 schema migration with pence-exact reconciliation tests. Open the PR; leave it sitting for review.

### When instructor #2 signs the agreement
5. **Merge Step 3.**
6. **Step 4 + Step 4g** — Phase 2 Thread A, shipped together. Step 4g (FIFO + `booking_credit_sources`) is the consumption-side counterpart of Step 4's purchase-side scoping; splitting them across PRs would leave the schema half-wired. Ship within the same week instructor #2 onboards so backfill happens once for a known signed-spec.

### After Step 4/4g lands and BOOKING-STATUS-RESTRUCTURE has merged
7. **Step 4f** — Stripe-fee pass-through (A3: net-of-Stripe at booking level). Depends on `lesson_bookings.list_price_pence` (Step 4), `booking_credit_sources` (Step 4g), and the `chargeable` status (booking-status restructure). Migrate, deploy, backfill historical fees, then enable the new payout maths in a follow-up PR so the cron change is isolated from the schema change.

## Why this order

Three independent reasons converged:

- **Pragmatist's point**: shipping the schema + behavioural change today bets on a spec (the franchise agreement) that's still in solicitor review. Strategist's point: the agreement already changed once during drafting (Decision 4 — Stripe fees), it may change again.
- **Empiricist's point**: money bugs are silent; pence-exact reconciliation is the only acceptance test that catches them. That's harder to do well under time pressure.
- **Architect's point**: schema migration is cheapest while row count is low. The draft PR lets us do the work *now* (cheap) without merging *now* (risky).

The banner and profile pages have none of these risks — they're decoupled from credits, useful with one instructor, and a marketing surface in their own right.

## What we deliberately defer

| Deferred | Why | Trigger to revisit |
|---|---|---|
| Phase 2B (bulk-tier opt-in, per-instructor rate logic, three-level fallback) | All instructors charge £55 today; nothing surfaces differently to learners yet | When the *first* instructor wants a different rate or different bulk-tier opt-in to Fraser |
| Phase 2C (tier admin UI, instructor-rate admin UI) | Two seeded tiers are enough for instructor #2; tiers can be edited via direct DB or migration until then | When a third tier is wanted, or when admin needs to toggle instructor rates from the UI rather than SQL |
| Package tracking on credits | The instructor scoping already locks credits to a provider; the rate snapshot already remembers what they were worth. Package identity adds bookkeeping with no behavioural payoff | If a learner-facing "redeem your bulk pack" feature is ever wanted as a distinct concept from "credits with Sarah" |
| Lead-floor reduction-cap automation | Manual SQL adjustment of `weekly_franchise_fee_pence` is fine for instructor #2's first 13-week period | When a second franchised instructor exists, OR when Fraser is manually computing reductions more than once a quarter |
| Automated debt invoicing | Fraser personally invoices via Stripe Payment Link for shortfall weeks | ≥3 manual debt invoices in a quarter, OR ≥3 active franchised instructors |
| Per-week franchise-fee override table | Admin updates `instructors.weekly_franchise_fee_pence` directly for one week then sets it back | Manual adjustments >once a quarter |
| Vehicle/fleet management | Spreadsheet | ≥2 tier-Full instructors with CoachCarter-provided cars |

## Risks

| Risk | Mitigation |
|---|---|
| Fraser's own Connect account is in a bad state and we don't notice until instructor #2 launch | Step 1a runs the health check explicitly, today |
| Backfill mis-allocates credits (Empiricist's silent-money-bug risk) | Pence-exact reconciliation acceptance test, run in a transaction with dry-run output before commit |
| Free-trial / referral / admin-adjustment paths miss the `instructor_id` plumbing | Architect's seams checklist (Step 4e); each path explicitly audited; dual-write safety net during transition |
| The signed franchise agreement changes the spec after Step 3 ships | Draft PR not merged until agreement signed; merge happens within the same week as instructor #2 onboarding |
| Public profile page leaks PII or financial config | Manual check of `?action=public-profile` response payload; whitelist of returned fields, not blacklist |
| Cross-instructor refusal error confuses learners | Error message is instructor-aware and links directly to the correct buy-credits page; copy reviewed before ship |
| Stranded credits when an instructor leaves | Accepted: documented in T&Cs that credits are scoped to an instructor; admin tool to convert at Fraser's discretion (deferred, manual SQL until needed) |

## Open questions

1. **Cross-instructor admin override** — if Sarah is sick for two weeks, can an admin convert a learner's Sarah credits into Mark credits as a one-off? Default: yes, via SQL only, no UI until pain shows up. Mention in the franchise agreement that this is at the platform's discretion.
2. **What does the "Buy credits with Sarah" CTA show if Sarah hasn't opted into bulk tiers?** Just her hourly rate with no ladder. The bulk ladder section of the profile page only renders if `bulk_tiers_enabled = TRUE`.
3. **Should the instructor profile page show their Stripe Connect status?** No. That's instructor-facing only (Step 1b). The public profile only needs to show whether they're accepting bookings, which is a separate `accepting_bookings` flag (already exists in some form via `instructors.active`).

## Docs to update after each step ships

- `PROJECT.md` — new API actions (`?action=public-profile`), new tables (`franchise_tiers`, `learner_credit_balances`), new columns.
- `DEVELOPMENT-ROADMAP.md` — feature entry with date.
- `MIGRATION-PLAN.md` — new tables and API routes flagged for the React Native port.
- `CLAUDE.md` — if any new convention is introduced (e.g. "all credit writes must specify `instructor_id`").
- `docs/navigation.md` — public instructor profile route added to the page inventory.
- `FRANCHISE-MODEL-PLAN.md` — mark Phase 1 / Phase 2A as shipped when they land; keep this file as the execution log.
