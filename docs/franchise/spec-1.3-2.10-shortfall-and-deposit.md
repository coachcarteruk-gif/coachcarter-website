# Spec — Shortfall Tracking + £250 Vehicle Deposit Deduction (plan items 1.3 + 2.10, bundled)

**Drafted:** 2026-05-10
**Plan refs:** `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md` items 1.3 (shortfall) and 2.10 (deposit, promoted from 3.5)
**Audit refs:** `FRANCHISE-AUDIT-2026-05-09.md` B3.6 (shortfall) and B3.14 (deposit)
**Pre-go-live:** yes (1.3 was originally pre-signing-day; 2.10 was Tier 3 promoted to Tier 2 on 2026-05-10 after earnings projection surfaced that £0 week-1 net is universal across scenarios)

This spec is self-contained. Implementation can start from this document alone. Bundles 1.3 and 2.10 because they touch the same file (`api/_payout-helpers.js`), the same schema table (`instructor_payouts`), and the same statement-email surface.

---

## Goal in one sentence

Track negative-payout shortfalls in the database (rolling forward to next week's payout per agreement clause 4.2), and deduct the £250 vehicle deposit from the Full-Franchise instructor's week-1 payout calculation per agreement clause 5.5 — both visible to the instructor on `/instructor/earnings.html` so there are no surprise conversations.

---

## Why this exists

**1.3 (shortfall):** The agreement (clause 4.2) commits CCL to rolling forward negative-payout shortfalls. Today's `_payout-helpers.js:55-60` truncates negative payouts to zero via `Math.min(franchiseFee, totalGrossPence)` — the negative amount silently disappears. Without recording it, instructor #2 has a great week 4 → gets full payout → "wait, you owed £85 from week 3" awkward conversation weeks later. Decision was column-based (not spreadsheet-based) because Fraser explicitly chose "one less thing for me to think about" in week-to-week mental load.

**2.10 (£250 deposit):** The earnings projection (`docs/franchise/sample-earnings-projection.md`) surfaced that the £250 deposit deduction lands in week 1 *regardless of scenario* and produces £0 net to instructor in every case. Without code, Fraser would have to manually compute and adjust the first payout — fragile and error-prone, and the kind of thing that creates "did I do that right?" anxiety on the first Friday.

These are bundled because:
- Same file (`api/_payout-helpers.js`)
- Same schema table (`instructor_payouts`)
- Same statement-email surface (`api/cron-payouts.js`)
- Same instructor-facing UI surface (`public/instructor/earnings.html`)
- Same rehearsal target (1.7 will exercise both)

---

## Schema changes

Add to `db/migration.sql`:

```sql
-- Plan item 1.3: shortfall tracking
ALTER TABLE instructor_payouts
  ADD COLUMN IF NOT EXISTS shortfall_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instructor_payouts
  ADD COLUMN IF NOT EXISTS shortfall_recovered_from_payout_id INTEGER
    REFERENCES instructor_payouts(id);

-- Plan item 2.10: vehicle deposit deduction (Full Franchise only)
ALTER TABLE instructor_payouts
  ADD COLUMN IF NOT EXISTS deposit_deducted_pence INTEGER NOT NULL DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_unrecovered_shortfall
  ON instructor_payouts (instructor_id, period_end)
  WHERE shortfall_pence > 0 AND shortfall_recovered_from_payout_id IS NULL;
```

**Semantics:**
- `shortfall_pence` is **positive** for "instructor owes CCL this much from this period." Default 0.
- `shortfall_recovered_from_payout_id` is **NULL** until the shortfall is recovered. When a later positive payout deducts this row's shortfall, set it to the recovering payout's `id`.
- `deposit_deducted_pence` is the £250 (= 25000 pence) deducted from week-1 Full-Franchise payouts. Default 0. Records the actual amount deducted (so partial deductions work correctly when revenue can't cover the full £250).

**Why three columns not a separate table:**
- One row per payout already exists. Adding columns is cheaper than joining a new mini-table.
- Recovery is a 1:1 relationship (one shortfall recovers from one payout). Doesn't need many-to-many.
- Defer mini-table to Tier 4 if multiple instructors with complex multi-week rolling shortfalls become a thing.

---

## Code changes

### `api/_payout-helpers.js::processPayoutForInstructor()`

Current logic (lines 41–161): calculates `totalGrossPence`, applies franchise-fee truncation via `Math.min(franchiseFee, totalGrossPence)`, builds line items, fires Stripe transfer, marks payout `completed`.

Add three pieces of logic, in order:

**A — Read prior unrecovered shortfall.**

After computing `totalGrossPence` but BEFORE truncation:

```javascript
const [priorShortfall] = await sql`
  SELECT id, shortfall_pence
    FROM instructor_payouts
   WHERE instructor_id = ${instructor.id}
     AND shortfall_pence > 0
     AND shortfall_recovered_from_payout_id IS NULL
   ORDER BY period_end DESC
   LIMIT 1
`;
const priorShortfallPence = priorShortfall ? parseInt(priorShortfall.shortfall_pence) : 0;
const priorShortfallId    = priorShortfall ? priorShortfall.id : null;
```

**B — Detect week-1 deposit eligibility.**

Detect whether this is the instructor's first payout AND tier is Full Franchise:

```javascript
const [hasPriorPayout] = await sql`
  SELECT 1 FROM instructor_payouts
   WHERE instructor_id = ${instructor.id}
     AND status = 'completed'
   LIMIT 1
`;
const isWeekOne = !hasPriorPayout;
const isFullFranchise = instructor.franchise_tier_slug === 'full-franchise'
  || instructor.weekly_franchise_fee_pence === 19500;  // fallback heuristic until Phase 1 ships franchise_tier_id
const depositEligible = isWeekOne && isFullFranchise;
const depositAmount = depositEligible ? 25000 : 0;
```

**Note**: the `franchise_tier_slug` lookup assumes Phase 1 has shipped `franchise_tiers` table + `instructors.franchise_tier_id`. Until then, fall back to the heuristic on `weekly_franchise_fee_pence`. After Phase 1: replace heuristic with the proper join.

**C — Compute the new payout maths.**

Replace the existing truncation with:

```javascript
// Effective deduction = franchise fee + this week's deposit + prior unrecovered shortfall
const totalDeductionPence = franchiseFee + depositAmount + priorShortfallPence;

let totalInstructorPence;
let actualFranchiseFee = franchiseFee;
let depositDeducted = 0;
let shortfallThisWeek = 0;
let shortfallRecoveryId = null;

if (totalGrossPence >= totalDeductionPence) {
  // Positive payout — all deductions applied
  totalInstructorPence = totalGrossPence - totalDeductionPence;
  depositDeducted = depositAmount;
  // Recover prior shortfall: mark it recovered when this payout completes
  if (priorShortfallPence > 0) shortfallRecoveryId = priorShortfallId;
} else {
  // Cannot cover all deductions — payout is zero, shortfall captures the gap
  totalInstructorPence = 0;
  // What we COULD cover: franchise fee + as much deposit as gross allows + as much prior shortfall as remains
  const coveredAfterFee = Math.max(0, totalGrossPence - franchiseFee);
  depositDeducted = Math.min(depositAmount, coveredAfterFee);
  const coveredAfterDeposit = coveredAfterFee - depositDeducted;
  // Prior shortfall is partially recovered if anything's left
  if (priorShortfallPence > 0 && coveredAfterDeposit > 0) {
    // Partial recovery is rare. Simpler: only mark fully recovered if the full prior shortfall is covered.
    // Otherwise leave it unrecovered and let it roll forward unchanged.
    if (coveredAfterDeposit >= priorShortfallPence) {
      shortfallRecoveryId = priorShortfallId;
    }
  }
  // This week's shortfall = uncovered remainder
  shortfallThisWeek = totalDeductionPence - totalGrossPence
    - (priorShortfallPence > 0 && shortfallRecoveryId === null ? priorShortfallPence : 0);
  // ^ if prior shortfall isn't being recovered, don't double-count it in this week's shortfall
}
```

**Edge case**: partial recovery (where week's revenue covers some but not all of the prior shortfall) is intentionally *not* implemented. The prior shortfall either fully recovers or rolls forward unchanged. Reasoning: simpler to reason about, simpler to display to the instructor, simpler to test. If multi-week complex partial-recovery becomes a real pattern, revisit with mini-table.

**D — Persist the new fields on the `instructor_payouts` row.**

Update the existing INSERT at line 98–102 to include the new columns:

```javascript
const [payout] = await sql`
  INSERT INTO instructor_payouts (
    instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence,
    period_start, period_end, status,
    shortfall_pence, deposit_deducted_pence
  )
  VALUES (
    ${instructor.id}, ${totalInstructorPence}, ${totalGrossPence - totalInstructorPence},
    ${actualFranchiseFee}, ${periodStart}, ${periodEnd}, 'processing',
    ${shortfallThisWeek}, ${depositDeducted}
  )
  RETURNING id
`;
```

After the Stripe transfer succeeds and status is updated to `completed`, **also update the prior shortfall row** if recovery applies:

```javascript
if (shortfallRecoveryId !== null) {
  await sql`
    UPDATE instructor_payouts
       SET shortfall_recovered_from_payout_id = ${payout.id}
     WHERE id = ${shortfallRecoveryId}
  `;
}
```

This goes inside the existing `try { transfer = await stripe.transfers.create... }` block, after the success-status update.

**E — Update the return shape** to include shortfall + deposit fields so cron-payouts.js + earnings UI can use them:

```javascript
return {
  payout_id: payout.id,
  instructor_id: instructor.id,
  // ... existing fields ...
  shortfall_pence: shortfallThisWeek,
  deposit_deducted_pence: depositDeducted,
  prior_shortfall_recovered_pence: shortfallRecoveryId ? priorShortfallPence : 0,
};
```

### `api/cron-payouts.js`

Update the email body (lines 43–50 area). Add three optional lines if the relevant fields are non-zero:

```javascript
const lines = [];
lines.push(`<p>Lessons: ${payout.lesson_count}</p>`);
lines.push(`<p>Net to your account: <strong>${amountStr}</strong></p>`);
if (payout.deposit_deducted_pence > 0) {
  lines.push(`<p>Vehicle deposit (week 1): <strong>−£${(payout.deposit_deducted_pence/100).toFixed(2)}</strong> (refundable at end of contract per clause 5.5)</p>`);
}
if (payout.prior_shortfall_recovered_pence > 0) {
  lines.push(`<p>Recovered from prior shortfall: <strong>−£${(payout.prior_shortfall_recovered_pence/100).toFixed(2)}</strong></p>`);
}
if (payout.shortfall_pence > 0) {
  lines.push(`<p>This week's shortfall (rolls forward): <strong>£${(payout.shortfall_pence/100).toFixed(2)}</strong>. This will be deducted from your next positive payout.</p>`);
}
```

Existing email styling preserved — just additional `<p>` rows in the body div.

### `public/instructor/earnings.html` + `instructor/earnings.js`

Find the existing payouts list rendering. For each `instructor_payouts` row, add:
- Subtle deposit-deduction row when `deposit_deducted_pence > 0`: e.g. small grey text "− £250 vehicle deposit (refundable at end of contract)".
- Shortfall-this-week row when `shortfall_pence > 0`: e.g. amber text "£85.76 carries forward to next week's payout".
- Shortfall-recovery row when this row recovered a prior shortfall: e.g. small grey text "Recovered £85.76 from previous week".

Plus a **running balance** at the top of the list:

```javascript
const runningShortfallPence = payouts
  .filter(p => p.shortfall_pence > 0 && p.shortfall_recovered_from_payout_id === null)
  .reduce((sum, p) => sum + p.shortfall_pence, 0);
```

Rendered as:
- £0 → don't render the balance line at all.
- > £0 → "Outstanding from prior weeks: **£85.76** — will be deducted from your next positive payout."

The point is: **no surprises**. Instructor sees the running balance every time they open the page, before any difficult conversation with Fraser.

### `api/instructor.js` (or wherever earnings data is fetched)

The endpoint that returns payout history needs to include the new columns in its response. Specifically `shortfall_pence`, `shortfall_recovered_from_payout_id`, `deposit_deducted_pence`. Trivial change.

---

## Edge cases

| Case | Behaviour |
|------|-----------|
| Week 1, instructor on Full Franchise, revenue ≥ £445 (£195 fee + £250 deposit + ~£0 stripe) | Positive payout. £250 recorded as `deposit_deducted_pence`. No shortfall. |
| Week 1, instructor on Full Franchise, revenue < £445 | £0 payout. Deposit partially or fully deducted up to revenue minus fee. Shortfall captures the rest. |
| Week 1, instructor on Part Franchise (£70 fee, no deposit) | No deposit logic fires. Standard shortfall logic only. |
| Week 2+, no prior shortfall, revenue ≥ fee | Standard payout, no shortfall, no recovery. Existing behaviour. |
| Week 2+, no prior shortfall, revenue < fee | New shortfall row. No recovery. |
| Week 2+, prior shortfall exists, revenue ≥ fee + prior shortfall | Positive payout. Prior shortfall fully recovered. |
| Week 2+, prior shortfall exists, revenue < fee + prior shortfall | £0 payout. Prior shortfall NOT recovered (rolls forward unchanged). New shortfall row captures this week's gap. |
| Two prior unrecovered shortfalls (theoretically possible if recovery logic ever skips one) | Query returns most recent only via `ORDER BY period_end DESC LIMIT 1`. Older one stays unrecovered. Manual intervention if this ever happens (shouldn't given the current logic). |
| Stripe transfer fails | Existing rollback: payout marked `failed`, line items deleted. **Also**: shortfall row is created but recovery NOT applied (prior shortfall stays unrecovered). When the next attempt runs, prior shortfall is still findable. |
| Instructor has `weekly_franchise_fee_pence = NULL` (commission model, not franchise) | Skip all this logic. `weekly_franchise_fee_pence` is the gating signal: NULL → existing commission-rate logic. Non-NULL → franchise + new shortfall + (if Full) deposit. |

---

## Acceptance criteria

The implementation is done when:

- [ ] Migration adds `shortfall_pence`, `shortfall_recovered_from_payout_id`, `deposit_deducted_pence` to `instructor_payouts` plus partial index on unrecovered shortfalls.
- [ ] `processPayoutForInstructor()` reads prior unrecovered shortfall, detects week-1 deposit eligibility, computes the new maths, persists new fields.
- [ ] When a positive payout recovers a prior shortfall, the prior row's `shortfall_recovered_from_payout_id` is updated only after the Stripe transfer succeeds.
- [ ] Email body includes deposit / shortfall / recovery lines when the relevant fields are non-zero.
- [ ] `/instructor/earnings.html` shows running balance + per-payout deposit/shortfall/recovery rows.
- [ ] Stripe transfer failure rolls back cleanly without leaving the prior shortfall in an inconsistent state.
- [ ] Existing commission-model instructors are unaffected (NULL `weekly_franchise_fee_pence` skips all new logic).
- [ ] Two-week rehearsal: week 1 with sub-deduction revenue creates shortfall + zero payout + £250 deposit attempt. Week 2 with positive revenue recovers the prior shortfall. Earnings page balance returns to £0.
- [ ] All admin mutations (manual payout trigger from admin portal) are audit-logged via `api/_audit.js` per CC GDPR rule 6.
- [ ] Migration is idempotent (`IF NOT EXISTS` guards on every ALTER and CREATE INDEX).

---

## Implementation notes for the next session

**Order of work in the session:**

1. Migration first (`db/migration.sql` + run via `GET /api/migrate?secret=…`).
2. `_payout-helpers.js` changes — most of the logic. Hardest part is the partial-coverage maths in the negative-payout branch. The simpler approach (don't partial-recover) was deliberately chosen here for correctness; resist the temptation to add partial-recovery cleverness.
3. `cron-payouts.js` email body.
4. Earnings page UI.
5. Test in dev DB by manually creating an instructor + bookings and triggering a payout.
6. Pair this implementation with item 1.7 rehearsal IMMEDIATELY after — same dev DB state, same instructor, same test bookings. Avoid setting it all up twice.

**Slash command**: `/schema-migration` is the right starting point (it's primarily a migration with code follow-on).

**Approximate scope**: 1 session. ~250–350 lines of changes across migration + 4 code files. Migration is small; payout-helper logic is the meat.

**Do NOT add**:
- Partial recovery of prior shortfalls (deliberately simpler — full or nothing).
- A separate `instructor_deposits` mini-table (use the column on `instructor_payouts`).
- A "deposit returned at contract end" code path (deferred — manual until first contract end).
- B3.4 Stripe-fee passthrough (Tier 3 — separate item).
- B3.5 Stripe-fee statement itemisation (Tier 3 — separate item).
- B3.3 `list_price_pence` snapshot reads (Tier 3 — depends on Phase 1 schema).
- Any change to the existing commission-model code path.

---

## What this spec deliberately does NOT cover

- **`list_price_pence` snapshot reads** at payout time — Tier 3 (B3.3). Existing live `lesson_types.price_pence` lookup continues until Phase 1 ships.
- **Stripe fee passthrough** — Tier 3 (B3.4).
- **Stripe fee itemisation** — Tier 3 (B3.5).
- **Lead Floor pro-rata reduction** — manual via direct edits to `weekly_franchise_fee_pence` until S1.17/S1.18 ship (deferred).
- **Insurance-gated payout exclusion** — manual SQL until S1.19 ships (deferred).
- **Deposit return at contract end** — manual process until first instructor leaves with a CCL-supplied vehicle.
