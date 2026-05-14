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

### Step 1 — Stripe Connect health check + banner (~2–3 hours)

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
6. **Step 4** — Phase 2 Thread A. Ship within the same week instructor #2 onboards, so backfill happens once for a known signed-spec.

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
