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
- **NOT a permanent solution for cross-instructor leakage (Group B from the first prod fire).** Plan C will audit `lockBalanceAdjustLCB`'s writer behaviour. Plan A only addresses the Group A (pure-legacy) shape.

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
