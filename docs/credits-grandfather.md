# Credits — Grandfather & Rollback Playbook

Operational runbook for the per-instructor credits migration (`PER-INSTRUCTOR-CREDITS-PLAN.md`). Two things live here:

1. **PITR rollback procedure** — how to roll a bad Step 4+ credits deploy back to a known-good state using Neon's point-in-time branching. The credits plan's load-bearing rollback story is "stop deploys, restore from PITR snapshot" (plan L599). This doc proves PITR works and codifies the exact dashboard clicks.
2. **Grandfather scenarios** — the four cases from GPT-flaw #18 (Fraser inactive, Fraser leaves, learner switches primary instructor, learner converts credit). **Currently empty — Step 6 deliverable** (plan L1100–1104). Will be filled in after Steps 4 + 5 + 5.5 ship.

This file expands as the plan progresses. Today (2026-05-20) the PITR procedure is the only complete section.

---

## PITR rollback procedure

**When to invoke:** within 6 hours of deploying a credits-touching change that corrupts ledger state (wrong amount granted, double-grant, BCS rows referencing wrong instructor, sync trigger writing wrong totals). The window is dictated by Neon's Free tier history retention — see "Retention window risk" below.

**What it does:** creates a Neon branch forked from prod state at a chosen past timestamp, exposes it on its own connection string. You then either (a) point the Vercel app at the scratch branch (effective rollback, prod data is left untouched), or (b) selectively copy rows from the scratch branch back into prod via SQL.

**What it doesn't do:** it does NOT modify the main branch in place. Neon's "Restore from history" affordance on the **Backup & Restore** page DOES restore main in place — that is a different, more destructive operation. Do not use it for credits rollback unless you fully understand what gets overwritten.

### Step 1 — Decide the target timestamp

The target is **a moment before the bad deploy went out** (or before the first corrupt row was written, if the deploy succeeded but a later cron caused the corruption).

Sources for the right timestamp:
- Vercel deployment list (`vercel.com → coachcarter-website → Deployments`) shows the exact UTC timestamp of each prod deploy.
- `git log --format='%ai %h %s' origin/main` for the commit times.
- `SELECT MIN(created_at) FROM credit_transactions WHERE [corrupt-row predicate]` to find the first corrupt row.

Pick a timestamp 1–5 minutes before the boundary you identify.

**Timezone note:** Neon's dialog displays times in your browser's local timezone (BST in May = UTC+1). Postgres `created_at` columns return UTC. Convert before pasting — `2026-05-20 10:31:47 UTC` in the DB equals `11:31:47` in the Neon dialog during BST.

### Step 2 — Create the scratch branch

1. Open <https://console.neon.tech> → `neon-green-elephant` project → **Branches** in the left sidebar.
2. Click **New Branch** (top right).
3. Fill in:
   - **Name:** `pitr-rollback-YYYY-MM-DD` (date of the incident, not of the target timestamp).
   - **Auto-delete:** `After 1 day` (extend manually if the incident takes longer to resolve).
   - **Parent branch:** `main`.
   - **Radio:** "Branch data and schema from a past point in time."
   - **Date/time:** the target timestamp from Step 1, in local timezone (the dialog shows GMT+01:00 / Europe/London during BST).
4. Click **Create**.

The dialog returns a connection string of the form:
```
postgresql://neondb_owner:<password>@ep-<endpoint>-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Copy it. This connection string is the scratch branch's only access — losing it means rotating the role password to recover.

### Step 3 — Verify the scratch branch has the data you expect

In Neon's **SQL Editor**, switch the branch dropdown (top of the editor, next to "Save") from `main` to your new branch name. Run a verification query targeting a row that **should** exist at the target timestamp but **should not** exist if the timestamp is wrong.

Example (used during the 2026-05-20 drill — adapt for your incident):
```sql
SELECT
  ct.id AS credit_tx_id,
  ct.type,
  ct.instructor_id,
  ct.absorbed_by,
  ct.learner_id,
  ct.created_at::text AS ct_created_at,
  bcs.id AS bcs_id,
  bcs.booking_id,
  bcs.minutes_drawn,
  bcs.absorbed_by AS bcs_absorbed_by
FROM credit_transactions ct
LEFT JOIN booking_credit_sources bcs ON bcs.credit_transaction_id = ct.id
WHERE ct.id = 81;
```

Do not proceed past this step if the verification query returns unexpected results.

### Step 4 — Choose your rollback strategy

**Strategy A — Branch swap (full rollback, near-zero downtime).** Update Vercel's `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` env vars to the scratch branch's connection string. Trigger a redeploy. All app reads + writes now hit the scratch branch. Prod (`main`) is frozen, untouched, recoverable.

- **Use when:** the corruption is broad (many rows, multiple tables) and you need to stop the bleeding immediately.
- **Cost:** all writes since the target timestamp are abandoned. You lose any legitimate bookings that came in after the bad deploy went out. Document the lost-window for downstream reconciliation.
- **Recovery path:** once root-caused, you can either keep the scratch branch as the new `main` (promote via Neon dashboard) or replay legitimate writes from the abandoned window manually.

**Strategy B — Selective restore (targeted rollback).** Leave Vercel pointing at `main`. Connect to the scratch branch via `psql` or the Neon SQL Editor and `SELECT` the rows you need to recover. Then connect to `main` and `UPDATE` / `INSERT` the corrected values. Audit-log every change.

- **Use when:** the corruption is narrow (a single cron run, a handful of bookings) and you don't want to abandon legitimate writes since the bad deploy.
- **Cost:** slower, more SQL, more risk of operator error. Each row touched must be audit-logged in `audit_events` via `logAudit()` for GDPR (CLAUDE.md hard rule).
- **Recovery path:** delete the scratch branch when done.

### Step 5 — Post-rollback

1. Drop the scratch branch (Neon → Branches → row menu → Delete), or let auto-delete expire it.
2. Update the relevant 🏁 memory entry with: incident timestamp, target timestamp, strategy chosen, rows affected, deploy that was rolled back.
3. File a follow-up to root-cause the deploy that caused the rollback.
4. If Strategy A was used, run the reconciliation cron (`api/cron-credit-reconcile.js`, exists from Step 5 onward) and resolve any flagged rows.

---

## Retention window risk

Neon Free tier retains 6 hours of history. The first PITR drill (2026-05-20) confirmed this in the **Backup & Restore** page: "Restore from history — 6 hour history window."

**Implications for Step 4 (Phase 2A behavioural cutover):**

- A corruption not noticed within 6 hours is unrecoverable via PITR alone.
- The post-deploy monitoring window must be **active** (someone watching, not "we'll check tomorrow morning") for the first 6 hours.
- Recommended deploy timing: **weekday morning UK time, before 11:00 BST**, so the 6-hour window lands entirely in waking hours of the operator on call.
- The divergence-check cron (plan §Step 4 Phase B, ~L585) reduces but does not eliminate this risk — it catches scoped-vs-pooled drift, not all corruption shapes.

**Mitigations not currently in place (deferred until they're warranted):**
- Neon Launch tier ($19/mo) buys 7-day retention. Acceptable upgrade trigger: instructor #2 onboarding within 30 days OR LCB writers handling >£100/day.
- Daily logical backups to S3. Acceptable upgrade trigger: first PITR rollback that fails because we missed the window.

---

## Drill record

| Date | Operator | Outcome |
|------|----------|---------|
| 2026-05-20 | Fraser | ✅ Created `pitr-drill-2026-05-20` from main @ 2026-05-20 10:49 UTC. Verified `credit_transactions.id=81` + `booking_credit_sources.id=1` present with expected shape. Branch auto-expires 2026-05-21 11:52 BST. |

Add a row after every drill or real incident. Annual cadence minimum.

---

## Mechanical grandfathering (the `grandfathered_at` column)

Shipped 2026-05-21 as Plan A in response to the first prod fire of the divergence cron (`memory/project_step_4_5_shipped.md`). Distinct from the Step 6 four-scenario policy below — this is purely an operational mark for legacy LCB rows whose Step 2c `balance_minutes`-copy backfill happened before any per-pair `credit_transactions` rows existed.

### What it is

`learner_credit_balances.grandfathered_at TIMESTAMPTZ`. NULL = ordinary row, subject to full drift detection. Non-NULL = legacy origin; the divergence cron conditionally suppresses these rows only when there are NO per-pair ledger rows in any source CTE (purchases, booking draws, BCS, CSA).

### Truth table the cron implements

| `lcb.grandfathered_at` | Per-pair ledger rows exist? | Result |
|---|---|---|
| NULL | no  | (not drift — LCB and ledger both empty/matching) |
| NULL | yes | flag if LCB drifts from ledger |
| non-NULL | no  | **SUPPRESS** (this is what Plan A buys) |
| non-NULL | yes | **flag** (the load-bearing branch — see C18, C22) |

The SQL predicate, identical in all three reconcile modes:

```sql
AND (lcb.grandfathered_at IS NULL
     OR l.learner_id IS NOT NULL)  -- l.learner_id IS NULL ⇔ no ledger CTE
                                   -- produced a row for this pair
```

The "any per-pair ledger rows" condition — not "ledger nets to non-zero" — is the load-bearing semantics. A grandfathered pair that lands +60 purchase AND -60 booking deduction nets to zero expected balance, but still has ledger rows; the cron MUST flag it, because the legacy LCB (e.g. 1860 minutes) is still unaccounted-for and the drift is real.

C22 is the discriminator test for this: it forces the predicate to distinguish "no rows" from "rows net to zero". A naive `expected_balance_minutes = 0` suppression would fail C22 silently. Keeping `grandfathered_at` set forever (rather than clearing it when new CT rows land) preserves the audit trail that the row originated from legacy backfill; the truth table handles future activity.

### Which rows get the flag (and which don't)

The backfill predicate (in `/api/migrate-step-2c-grandfather`) is:

```sql
WHERE lcb.school_id        = 1
  AND lcb.balance_minutes  > 0
  AND lcb.grandfathered_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
     WHERE ct.school_id     = lcb.school_id
       AND ct.learner_id    = lcb.learner_id
       AND ct.instructor_id = lcb.instructor_id
  )
```

The pair-scoped `NOT EXISTS` is the load-bearing definition of "pure-legacy". An LCB row qualifies iff there is no per-pair `credit_transactions` row at all. The Step 2c marker timestamp is reported as supporting evidence in the dry-run output but is NOT in the predicate — the Step 2c migration's INSERT and marker-write were two separately-awaited statements with no explicit BEGIN, so `updated_at ≈ marker.completed_at` is a correlation clue, not a transactional guarantee.

**Mixed-state rows are deliberately not grandfathered** by this mechanical pass. If a learner has LCB > 0 AND any per-pair `credit_transactions` row, they fall outside Plan A's scope and continue to surface in the divergence cron's drift report. The operator resolves each one manually (typically by reconciling the LCB against the ledger then deciding whether the residual is legitimately legacy — in which case set `grandfathered_at = NOW()` by hand).

### Operator workflow

**Backfill (one-shot):**

1. Dry-run: `GET /api/migrate-step-2c-grandfather?secret=$MIGRATION_SECRET`. Eyeball the `candidates_sample` (learner_id, instructor_id, balance_minutes, grandfathered_at, lcb_updated_at, scoped_ct_count, scoped_ct_minutes) and compare `marker_window_match_count` against `candidate_count` — a near-1:1 ratio confirms these are indeed Step 2c artefacts.
2. Run `db/diagnostics/step-2c-grandfather-pre-migration.sql` for fuller context.
3. POST the endpoint: `POST /api/migrate-step-2c-grandfather?secret=...`.
4. Verify via `db/diagnostics/step-2c-grandfather-post-migration.sql` and the next cron-credit-reconcile dry-run — `drift_count` should drop, `grandfathered_count` should approximately match `rows_updated`.

**Manually marking a single row (post-incident):**

```sql
UPDATE learner_credit_balances
   SET grandfathered_at = NOW()
 WHERE learner_id = $1
   AND instructor_id = $2
   AND grandfathered_at IS NULL;
-- Audit-log via api/_audit.js: action 'admin.lcb_grandfathered'
```

**Un-marking (rare — operator decided the row isn't legacy after all):**

```sql
UPDATE learner_credit_balances
   SET grandfathered_at = NULL
 WHERE learner_id = $1
   AND instructor_id = $2;
-- Audit-log: action 'admin.lcb_ungrandfathered'
```

### Operational signal: `grandfathered_count`

The divergence cron's JSON response now includes `grandfathered_count`: how many LCB rows are in the suppression branch right now (legacy-origin + zero-ledger + non-zero LCB). Operationally useful as a movement indicator:

- **Spikes upward** between runs: a newly-grandfathered row's ledger just became zero (e.g. its only CT was deleted). Worth investigating.
- **Drops** between runs: a previously-suppressed row's ledger went non-zero. The row should now appear in `drift_count`. Cross-check.
- **Static**: nominal — pure-legacy rows in steady state.

### What this is NOT

- **NOT auto-correction.** The cron stays read-only. Grandfathering changes which rows alert, not the values.
- **NOT a policy for what happens when an instructor leaves, a learner switches instructors, or credit converts** — that's the Step 6 four-scenario work below, currently still TODO and gated on Steps 4 + 5 + 5.5.
- **NOT the fix for Group B (cross-instructor) drift.** Plan A only addresses Group A (pure-legacy, no per-pair ledger). Plan B1 — see next section — re-attributes the grandfathered LCB rows from the seed instructor to Fraser's real account and backfills synthetic CT rows that make the per-instructor ledger internally coherent.

### Schema-aware degradation

The cron's `probeSchemaMode` checks both the Step 5 BCS/CSA tables (existing) and the `grandfathered_at` column (Plan A). If the column doesn't yet exist — the window between Vercel deploying the Plan A code and the operator running `/api/migrate` — every reconcile function emits a non-suppressing variant, `grandfathered_count` short-circuits to 0, and `has_grandfathered_at: false` appears in the cron's JSON response. Cron degrades to "alert on all drift" — the conservative direction. No `column does not exist` crash.

### Rerunning the migration

The endpoint refuses POST once its `per_instructor_credits_step_2c_grandfather` marker is present, regardless of how many new pure-legacy-looking rows exist. Rationale: a row that newly looks pure-legacy (LCB > 0, no per-pair CT) on a system that's been running Phase-2A writers is more likely a writer regression we want the divergence cron to alert on than a true legacy artefact.

To force a rerun (e.g. after a deliberate PITR rollback of the Step 2c backfill window):

```sql
DELETE FROM migration_markers WHERE key = 'per_instructor_credits_step_2c_grandfather';
-- Audit-log via api/_audit.js: action 'admin.migration_marker_cleared'
-- Then re-POST /api/migrate-step-2c-grandfather
```

This is deliberately friction-laden. The GET dry-run still works after the marker lands, so inspection-without-mutation is always available.

---

## Re-attribution + synthetic-CT backfill (Plan B1)

Shipped 2026-05-21 alongside Plan A. Fixes the wrong-instructor target Step 2c's mechanical backfill chose, AND makes the per-instructor ledger internally coherent so the divergence cron returns drift = 0 for re-attributed pairs.

### The original mistake

`/api/migrate-step-2c.js:39` hardcoded `GRANDFATHER_INSTRUCTOR_ID = 1` with the comment "Fraser is the only instructor when this runs". That assumption was wrong:

- **instructors.id = 1** is a "James Carter" seed fixture row from `db/migration.sql` initial data — never used, zero bookings, zero CT rows, no Stripe Connect account.
- **instructors.id = 4** is Fraser's real account — 106 of 121 recent bookings, Stripe Connect linked, `payouts_start_date = 2026-05-15`.

Step 2c backfilled 21 LCB rows (12,810 minutes / 213.5 hours of grandfathered legacy pool) to instructor=1. The bookings keep being delivered by instructor=4. The per-instructor ledger therefore says "Fraser=4 has zero LCB and one CT" while the bookings table says "Fraser=4 has delivered 106 lessons" — a structural mismatch the divergence cron correctly reports as Group B drift.

### What Plan B1 does

A single endpoint, `/api/migrate-step-2c-reattribute`, that wraps four operations atomically:

1. Widens `credit_transactions_type_check` to allow `'legacy_grandfather'`.
2. Moves every grandfathered LCB row from `(learner, 1)` to `(learner, 4)`, deleting the source row.
3. Inserts ONE synthetic `credit_transactions` row per moved learner with:
   - `type = 'legacy_grandfather'`, `source = 'reconciliation'`, `payment_method = 'migration'`
   - `instructor_id = 4`, `school_id = (preserved)`
   - `minutes = (moved LCB balance) + (active draw minutes at (L, 4))`  ← **Shape B math**
   - `amount_pence = 0`, `credits = 0`
4. Writes the `per_instructor_credits_step_2c_reattribute` migration marker.

The conflict policy on `(learner_id, instructor_id = 4)` LCB collisions:
- `balance_minutes` — SUM (legacy pool stacks on top of any active Phase-2A balance).
- `grandfathered_at` — NULL if either side was NULL (watched-stays-watched). Encoded via CASE rather than LEAST() because PG's `LEAST(NULL, ts)` returns `ts`, which would promote an active row to grandfathered — wrong direction.

### Why a synthetic CT exists at all

Re-attribution alone makes the cron drift LOUDER, not quieter. Moving LCB from (L, 1) to (L, 4) bumps `actual_lcb(L, 4)` from 0 → balance_minutes, but `expected = ΣCT − Σmin_deducted` at (L, 4) still has no purchases — so expected swings more negative and drift inflates.

The synthetic CT is the structural answer: the legacy pool IS a real credit source for the per-instructor ledger; it just predates per-instructor tracking. Recording it as such lines up with Step 5 BCS work, which will treat every booking deduction as drawn from a specific credit source.

### Shape B math (the load-bearing part)

The synthetic CT must represent the **original legacy pool size at the target instructor**, not the current remaining balance:

```
original_legacy_pool_at_target = remaining_grandfathered_lcb_at_target
                              + already_spent_active_draws_at_target
```

Then the cron's reconcile becomes:

```
actual_lcb(L, 4) = remaining_grandfathered_lcb
expected         = ΣCT − Σmin_deducted
                 = synthetic_ct.minutes − active_draws
                 = (remaining + draws) − draws
                 = remaining
drift            = actual_lcb − expected = 0
```

Drift = 0 by construction. The `IS DISTINCT FROM` clause in the cron's outer `WHERE` then drops the pair from `drift_summary` entirely.

**Cron-predicate mirroring is load-bearing.** The migration's `active_draws` subquery mirrors `api/cron-credit-reconcile.js`'s `booking_draws` CTE byte-for-byte (per schema mode). If the two ever diverge, the migration manufactures a new drift class. The handler probes `information_schema` for `booking_credit_sources` and picks the matching variant — same shape as the cron's `probeSchemaMode`.

### What stays visible after Plan B1

Cross-instructor cases — a learner whose legacy pool was spent on a lesson delivered by a DIFFERENT instructor — are deliberately NOT covered by Shape B. The draws subquery is scoped to `(learner_id, instructor_id = 4)`, so:

- (Learner L, instructor=4): Shape B reconciles to drift = 0.
- (Learner L, instructor=6 or other): cron still flags drift = +N, where N is the cross-instructor booking minutes.

On current prod data this surfaces ONE pair — `(learner 11, instructor 6, +90 min)` — Laura Thomas's Simon=6 lesson funded from Fraser's legacy pool. That's a deliberate residual representing a real cross-instructor consumption question. Resolution is a deliberate human decision: transfer 90 minutes from Fraser's legacy CT to a new Simon-attributed entry, or leave as a tracked imbalance until Step 5 BCS arrives with proper attribution semantics. **Not the migration's job to silently silence.**

### Operator workflow

1. Run `db/diagnostics/step-2c-reattribute-pre-migration.sql`. Eyeball the per-learner Shape B breakdown table — confirm `synthetic_ct_minutes = moved_balance + active_draw_minutes_at_4` for every row, no surprises.
2. Dry-run: `GET /api/migrate-step-2c-reattribute?secret=$MIGRATION_SECRET`. The JSON response includes `candidates_breakdown` (per-learner Shape B preview), `total_minutes_to_move`, `total_active_draw_minutes_at_target`, `total_synthetic_ct_minutes`, and `conflicts`.
3. POST the endpoint: `POST /api/migrate-step-2c-reattribute?secret=...`.
4. Verify via `db/diagnostics/step-2c-reattribute-post-migration.sql` — the per-learner reconciliation check should show every row as `CLEAN ✓`.
5. Next cron-credit-reconcile dry-run: `drift_count` should drop by the number of pre-Plan-B1 Group B pairs whose only drift source was wrong-instructor attribution. Cross-instructor pairs remain.

### Rerunning

The endpoint refuses POST once its `per_instructor_credits_step_2c_reattribute` marker is present. Same friction-laden pattern as Plan A:

```sql
DELETE FROM migration_markers WHERE key = 'per_instructor_credits_step_2c_reattribute';
-- Audit-log via api/_audit.js: action 'admin.migration_marker_cleared'
-- Then re-POST /api/migrate-step-2c-reattribute
```

GET dry-run is always available.

### What Plan B1 explicitly does NOT do

- **Does NOT delete the seed instructor #1 row.** That's Plan B2 (separate PR) after the four hardcoded `instructor_id = 1` fallbacks in `api/_credit-grant.js` and `api/admin.js` are removed/replaced. Deleting the seed row first would risk FK violations or silent default-routing into a deleted row.
- **Does NOT widen Plan A's suppression.** Suppression is a monitoring escape hatch; synthetic CT makes the ledger internally coherent. That's the healthier mechanism.
- **Does NOT touch the reschedule-bypasses-LCB latent bug** (`api/instructor.js:1048`, `api/slots.js:2616`). Separate follow-up.
- **Does NOT install the missing `trg_sync_pooled_balance` trigger** (`/api/migrate-step-4` marker not present on prod). Separate follow-up — the move keeps `SUM(LCB per learner)` mathematically unchanged, so the pooled shadow stays accurate without the trigger.

### Cross-references

- `api/migrate-step-2c-reattribute.js` — the handler itself, with full header forensic.
- `tests/migrate-step-2c-reattribute.integration.spec.js` — 10 tests (R0-R8 + dry-run sanity) against Neon test branch.
- `db/diagnostics/step-2c-reattribute-{pre,post}-migration.sql` — operator companions.
- `memory/project_step_4_5_shipped.md` — Plan A ship record and Group B forensic.

---

## No-LCB synthetic CT backfill (Plan B3)

### Why Plan B3

After Plan B1 shipped on 2026-05-21 the cron reported drift_count = 4 (down from 13 after Plan A, then 13 → 4 after B1). All four pairs are pre-cutover learners with **no LCB row at any instructor**, only pooled `instructor_id IS NULL` CTs the cron deliberately excludes from its purchases CTE. Plan A requires `balance_minutes > 0` on an existing LCB row; Plan B1 requires a grandfathered LCB row to re-attribute. These learners have neither.

**Important course-correction (2026-05-21 dry-run):** The first PR #185 dry-run surfaced that the four pairs split into two distinct shapes:

1. **Three are clean Group C** — pre-cutover legacy pool drift, no shenanigans:
   - `(learner=73, instructor=4, +180)` — 2 scheduled bookings
   - `(learner=92, instructor=4,  +90)` — 1 scheduled booking
   - `(learner=55, instructor=4)` — 8 of 9 bookings are clean scheduled/chargeable (720 min)
2. **Two pairs include refund-bug residual** — bookings with `status='refunded'` AND `credit_returned=FALSE`:
   - `(learner=11, instructor=6, +90)` — booking #117, the ENTIRE +90 is bug
   - `(learner=55, instructor=4)` — booking #133, +90 of the +810 is bug

The bug-bookings are the exact target of chip #3 (reschedule paths setting `credit_returned=TRUE`). **B3 must not grandfather them** — that would silently bury chip #3's bug and create opposite-sign drift the moment chip #3 lands and flips `credit_returned`.

### What Plan B3 does

A single endpoint, `/api/migrate-step-2c-no-lcb-backfill`, that inserts one synthetic `legacy_grandfather` CT per qualifying `(learner, instructor)` pair. No LCB writes.

Candidate predicate (per pair):
- `school_id = 1`
- `NOT EXISTS (LCB row for learner L at any instructor)` — gates out Plan B1's cohort
- `NOT EXISTS (credit_transactions at (L, I) with instructor_id NOT NULL)` — defensive belt-and-braces
- Sum of **clean** active draws `> 0` at `(L, I)`, where "clean" applies the cron's `booking_draws` predicate **plus** `lb.status != 'refunded'`. The cron itself doesn't filter status; the tightening is B3-specific.

For each qualifying pair, INSERT one CT with `type='legacy_grandfather'`, `source='reconciliation'`, `payment_method='migration'`, `minutes = SUM(clean draws at the pair)`, `amount_pence = 0`, `credits = 0`.

### Why no LCB write (vs Plan B1)

These learners have spent their entire legacy pool. Clean draws AT THE PAIR equal the original pool legitimately consumed at that instructor. There is no remaining balance to grandfather. Adding an LCB row at balance=0 would be a no-op for the cron and would just create stale state for Step 5 to ignore. The simpler answer: make the per-pair ledger coherent without manufacturing fake state.

Math per pair `(L, I)` — drift reconciles for the CLEAN portion, refund-bug residual stays visible:
```
Let D_clean = SUM(draws WHERE status != 'refunded')
    D_bug   = SUM(draws WHERE status  = 'refunded' AND credit_returned = FALSE)
    D_total = D_clean + D_bug = the cron's booking_draws view

Before B3:
  actual_lcb(L, I)  = 0
  ΣCT(L, I)         = 0
  cron sees Σdraws  = D_total
  expected          = -D_total
  drift             = +D_total                    (cron flag, today's drift)

After B3 inserts synthetic CT(L, I, minutes=D_clean):
  actual_lcb(L, I)  = 0                            (NO LCB write)
  ΣCT(L, I)         = D_clean
  cron sees Σdraws  = D_total                      (unchanged — cron still counts refunded)
  expected          = D_clean - D_total = -D_bug
  drift             = +D_bug                       (residual = bug only)

When chip #3 flips credit_returned=TRUE on the refunded bookings,
the cron's booking_draws stops counting them:
  cron sees Σdraws  = D_clean
  expected          = D_clean - D_clean = 0
  drift             = 0  ✓
```

### Expected prod impact

| learner | instructor | total draws | clean (synthetic CT) | stale-refund residual |
|---|---|---|---|---|
| 55 (Martin Hicks) | 4 (Fraser) | 810 | 720 | +90 (booking #133) |
| 73 (Imani Harrison) | 4 (Fraser) | 180 | 180 | 0 |
| 92 (Jay Sharma) | 4 (Fraser) | 90 | 90 | 0 |
| 11 (Laura Thomas) | 6 (Simon) | 90 | 0 (excluded by HAVING) | +90 (booking #117) |

After B3 lands, cron `drift_count` drops from 4 → 2. After chip #3 flips `credit_returned=TRUE` on bookings #117 and #133, the cron's `drift_count` drops 2 → 0 without manufacturing any opposite-sign drift.

### What stays visible after Plan B3

Refund-bug residual: pairs whose drift came from `status='refunded'` AND `credit_returned=FALSE` bookings stay flagged. On current prod data that's `(55, 4)+90` (booking #133) and `(11, 6)+90` (booking #117). The cron flagging these is the right behaviour — they're chip #3's targets.

### Operator workflow

1. Run `db/diagnostics/step-2c-no-lcb-backfill-pre-migration.sql`. Eyeball the candidate-pairs table — confirm `clean_draws_minutes` per row matches expectation and `stale_refund_draws_at_pair` shows the predicted residual.
2. Dry-run: `GET /api/migrate-step-2c-no-lcb-backfill?secret=$MIGRATION_SECRET`. JSON response includes `candidates_breakdown` (per-pair preview with `synthetic_ct_minutes`, `stale_refund_draws_at_pair`, `expected_residual_cron_drift_after_b3`, and `pooled_ct_minutes_for_learner` context).
3. Compare the candidate count + per-pair `synthetic_ct_minutes` against the pre-migration SQL. Must match exactly. If they don't, halt.
4. POST the endpoint.
5. Verify via `db/diagnostics/step-2c-no-lcb-backfill-post-migration.sql` — reconcile check should show drift = `stale_refund_draws_at_pair` per backfilled pair (NOT zero), and the "no LCB created" check should return zero rows.
6. Next cron-credit-reconcile dry-run: `drift_count` should equal the count of pairs that had stale-refund residual (2 on current prod data, both targets of chip #3).

### Rerunning

Same friction-laden marker pattern. DELETE `migration_markers WHERE key = 'per_instructor_credits_step_2c_no_lcb_backfill'`, then re-POST. The `NOT EXISTS CT` predicate provides secondary protection so a rerun doesn't double-insert.

### What Plan B3 explicitly does NOT do

- **Does NOT touch LCB.** Read this twice. No LCB rows added, modified, or deleted. If the post-migration verification query (5) above returns any row, the migration has a bug — investigate immediately.
- **Does NOT widen `credit_transactions_type_check`.** Plan B1 already widened it in PR #184.
- **Does NOT fix the refund-without-credit-return bug.** Refunded bookings with `credit_returned = FALSE` stay visible to the cron as residual drift — that's chip #3's job, not B3's. Burying them under `legacy_grandfather` would silently hide the bug and create opposite-sign drift the moment chip #3 lands.

### Cross-references

- `api/migrate-step-2c-no-lcb-backfill.js` — handler with full header forensic.
- `tests/migrate-step-2c-no-lcb-backfill.integration.spec.js` — 11 tests (B0-B10 + dry-run sanity) against Neon test branch.
- `db/diagnostics/step-2c-no-lcb-backfill-{pre,post}-migration.sql` — operator companions.
- `memory/project_step_4_5_shipped.md` — Group C diagnosis (the table with the four residuals).
- `memory/feedback_lcb_reshape_needs_matching_ct.md` — the structural lesson B3 directly inherits.

---

## Grandfather scenarios (Step 6 — currently TODO)

The credits plan (L1100–1104) commits this file to cover four scenarios from GPT-flaw #18:

1. Fraser inactive (paused payouts, on holiday) — what happens to learners trying to spend with him?
2. Fraser leaves the platform entirely — do his learners' credits convert to another instructor? Refund? Forfeit?
3. Learner switches primary instructor — do existing credits transfer? Stay with old instructor as locked balance? Refund partial?
4. Learner explicitly asks to convert credit to a different instructor — admin-only? Self-serve? Cash refund + repurchase?

Each scenario needs: detection (how the situation is identified), policy (what happens by default), operator action (admin SQL recipe or endpoint), audit trail.

**Why empty today:** this section is Step 6 in the plan, which sequences after Steps 4 + 5 + 5.5. Writing it now would commit to policies that depend on schema (per-instructor balances, BCS attribution, `credit_source_adjustments`) that doesn't yet exist on prod. Filling it in prematurely is a planning trap.

When Step 5.5 ships, return here and complete this section before Step 6 closes.

---

## Cross-references

- `PER-INSTRUCTOR-CREDITS-PLAN.md` — source of truth for the migration.
- `docs/operations/credential-rotation.md` — pattern for operational runbooks.
- `CLAUDE.md` "GDPR rules" — audit-log requirements for any admin data mutation done as part of a rollback.
- `feedback_implementation_protocol_money_paths.md` — discipline for any change that touches money-correctness paths (including rollbacks).
