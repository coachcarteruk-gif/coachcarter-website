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
