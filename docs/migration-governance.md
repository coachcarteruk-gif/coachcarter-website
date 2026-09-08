# Migration governance audit and phased cleanup

Status: **Phase 1 repository groundwork only**

Audit date: 2026-09-08

Production target inspected read-only: Neon project `neon-green-elephant`
(`falling-firefly-48751671`), protected/default branch `main`
(`br-summer-silence-abcpp6vw`), database `neondb`.

This document is the migration-system source of truth. It does not authorise a
production migration, a ledger bootstrap/backfill, a legacy endpoint change,
or any financial/data mutation.

## Confirmed file sequence

`db/migrations/` contains 61 SQL files:

- one file for every prefix from 001 through 025;
- two independent files with prefix 026;
- one file for every prefix from 027 through 060.

The duplicate prefix is historical, not duplicate content:

| Ledger ID | Filename | Introduced | Purpose |
|---|---|---|---|
| `026a` | `026_public_tenant_resolution.sql` | commit `1b756bc`, 2026-06-03 | `schools.primary_host`, host uniqueness and the school-create tenant-resolution guard |
| `026b` | `026_weekly_availability_transmission.sql` | commit `482d135`, 2026-06-17 | recurring instructor-availability transmission type/backfill/constraint |

The files were created fourteen days apart by unrelated changes that both used
the next remembered number. Renaming either file now would break historical
references without changing the database. The manifest therefore preserves
both filenames and assigns the stable unique IDs `026a` and `026b`, ordered by
their actual introduction. New duplicate prefixes are forbidden.

The complete authoritative repository inventory and canonical LF-normalised
SHA-256 values are in `db/migrations/manifest.json`. All current entries are
`baseline` except 041, which is `deferred`; none of the historical files is
automatically replayed by Phase 1.

## Production receipt: what can and cannot be proved

There was no numbered-migration checksum ledger before this audit. It is
therefore impossible to prove which exact file bytes or which execution path
produced most of the current production schema. Idempotent objects may have
arrived from the aggregate, a numbered file, a one-off endpoint, or manual SQL.
Current object presence is evidence of the terminal schema, not proof that a
particular historical file ran.

The following evidence is authoritative enough to state exact execution:

- Migration 035: repository apply/postflight evidence records an atomic
  production apply on 2026-07-26, checksum
  `7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749`.
- Migration 039: repository apply/postflight evidence records an atomic
  production apply on 2026-08-01. Its canonical LF checksum is
  `edb7d36a06535fd2e4e11633a6568ae2372efa70076839546ab1b2f64b2df9b8`.
- Migration 060: the operator record supplied for this cleanup identifies the
  production apply, pre-migration snapshot `snap-tiny-lake-ab6utko4`, and READY
  deployment `dpl_E4EzYUi9G5RBF3m1cnSHfbynBPgF`. The read-only catalog audit
  confirmed all three extension columns, both validated constraints, and both
  indexes. Its canonical LF checksum is
  `fdcc1684800e6c88a69efd75fa9008470f09c3949da586a2765782f1a350a4f5`.
- Ten data-migration marker rows prove the successful one-off operations listed
  below, with timestamps from 2026-05-20 through 2026-05-21.

Read-only catalog probes confirmed representative terminal effects for
001-013, 015, 017-020, 022-040, and 042-060, with these exceptions and
qualifications:

- 014 (`qa_*`) and 021 (`waitlist`) are absent because those product surfaces
  were deliberately retired and later dropped.
- 016 is seed DML; current review rows cannot prove that exact seed file ran.
- 041 (`connect_v2_account_creation_intents` and related Accounts v2 readiness
  objects) is absent from production. Later migrations are present, so the
  production history is deliberately non-contiguous. The file remains deferred.
- 042 and 052 were initially probed with obsolete names; corrected probes
  confirmed `credit_transactions.instructor_transfer_group_id`, function
  `trg_balance_audit()`, and trigger `balance_audit_trigger` are present.
- 055 and 059 effects were confirmed through the active production runtime
  role's SELECT privileges. Migration 058's operator function and legacy-source
  column are present. Migration 057's table is present even though the numbered
  file currently contains a stray leading `+` and is not safe to replay.

This is the strongest honest conclusion: production has received the terminal
effects of every current production-applicable area through 060, except the
intentionally removed 014/021 objects and intentionally absent 041 objects;
exact numbered-file receipt is recoverable only for 035, 039, 060 and the ten
marked one-off operations.

## Migration execution inventory

### General and controlled runners

| Path | Current role | Safety findings |
|---|---|---|
| `api/migrate.js` | Legacy aggregate runner for `db/migration.sql` | GET and POST both mutate; splits SQL heuristically; runs statements separately; continues after errors; no encompassing transaction, lock, ordering check, checksum, or ledger; returns raw per-statement SQL error messages. It must not be used for new migrations. |
| `scripts/payout-v2-schema-apply.js` | Controlled migration 035 rehearsal/apply | One migration, advisory lock, transaction, timeouts, checksum/manifest and postconditions. Uses the configured URL named `POSTGRES_URL`, so future common tooling should require an explicitly direct URL. |
| `scripts/booking-extension-migration-060.js` | Controlled migration 060 rehearsal/preflight/apply/postflight | One migration, direct/runtime identity comparison, approved target fingerprint, advisory lock, transaction, timeouts and postconditions. Its raw-byte checksum changes with Git line-ending conversion; the new manifest uses canonical LF bytes. |
| `scripts/stripe-launch-schema-foundation-review.js` | Static/evidence review for 039 | Checks canonical migration bytes and retained rollout evidence; it is not an apply runner. |
| `scripts/stripe-launch-slice-2-rollout-review.js` | Static review for 040 | Reviews the forward fix; it is not a general runner. |
| `scripts/payout-v2-schema-preflight.js` / `postflight.js` | 035 read-only diagnostics | Production-specific evidence checks. |
| `scripts/migration-runner.js` | Phase 1 candidate authoritative numbered runner | Repository check is live. Status/apply fail if the ledger is absent. Apply additionally requires a direct URL, exact target fingerprint, explicit approval env, an advisory lock, a contiguous ledger plan, and `execution=numbered`. No current historical migration is runnable through it. |

`db/rollouts/` contains retained manifests and sanitized rehearsal, preflight,
apply, postflight, and recovery evidence for 035 and 039. `db/diagnostics/`
contains pre/post checks for the credits one-offs, aggregate-era changes, 035,
039, and related repairs. Integration tests apply the aggregate or selected
numbered files to isolated test databases; these are test paths, not production
runners.

### Legacy one-off API migrations

All eleven API migration routes use `MIGRATION_SECRET`. The ten feature-specific
routes treat GET as preview and POST as mutation; the general route is the
dangerous exception where GET mutates.

| Endpoint | Marker / dependency | Atomicity and retirement dependency |
|---|---|---|
| `migrate-step-1c` | writes `per_instructor_credits_step_1c_backfill` | Multiple updates and marker are separate statements. Docs/diagnostics still describe it. |
| `migrate-step-2a` | requires 1c; writes `per_instructor_credits_step_2a` | Multiple DDL statements and marker are separate. |
| `migrate-step-2b` | requires 2a; writes `per_instructor_credits_step_2b` | Backfill, NOT NULL and marker are separate. |
| `migrate-step-2c` | requires 2b; writes `per_instructor_credits_step_2c` | Multiple DDL/DML statements and marker are separate. |
| `migrate-step-2-5` | requires 2c; writes `per_instructor_credits_step_2_5` | DROP/ADD constraint and marker are separate. |
| `migrate-step-2c-grandfather` | requires 2c; writes `per_instructor_credits_step_2c_grandfather` | GET is not strictly read-only: it executes `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` before returning preview. The current runtime role cannot own that table, which exposed the defect during this audit. The later DML+marker is one CTE statement. |
| `migrate-step-2c-reattribute` | requires grandfather; writes `per_instructor_credits_step_2c_reattribute` | Constraint replacement is separate from the atomic CTE data/marker operation. |
| `migrate-step-2c-no-lcb-backfill` | requires reattribute; writes `per_instructor_credits_step_2c_no_lcb_backfill` | Data+marker is one CTE statement. |
| `migrate-credit-returned-retro-fix` | writes `credits_credit_returned_retro_fix` | Data+marker is one CTE statement. |
| `migrate-step-4` | requires 2c; writes `per_instructor_credits_step_4` | Function, trigger, checks and marker are separate statements. |
| `migrate` | no marker | Aggregate execution described above; no durable history. |

Production contains all ten marker rows. Marker timestamps and schema probes
mean these endpoints must not simply be deleted: their tests, diagnostics,
runbooks, prerequisite explanations, and any recovery procedure that reads the
markers must first be redirected to retained historical records or the new
ledger. The marker rows themselves are historical operational evidence and
must be preserved.

### Documented execution paths and contradictions

The following paths were found in `CLAUDE.md`, `PROJECT.md`,
`MIGRATION-PLAN.md`, `.claude/commands/schema-migration.md`, diagnostics,
runbooks, rollout reviews, tests, and `scripts/verify-post-merge.mjs`:

1. run the aggregate via `GET /api/migrate?secret=...`;
2. run a legacy one-off GET preview then POST mutation;
3. execute a reviewed numbered file atomically with a controlled script or
   database operator (035, 039, 060);
4. apply the aggregate directly in fresh-schema integration tests;
5. apply selected numbered files directly in feature integration tests;
6. run manual operator SQL/functions for tightly controlled financial repairs.

The first path contradicts the 035/039 controls and current safety rules. Phase
1 changes the top-level guidance to describe it as legacy-only, while retaining
the endpoint unchanged pending explicit production approval.

## Replay and adoption blockers

- The numbered directory is not a linear production plan: 041 is absent while
  later migrations are present; 014/021 are later reversed.
- `057_interim_v1_manual_settlement_boundary.sql` begins with `+--`, which is
  invalid SQL for a strict runner. Preserve it until an approved compatibility
  decision; do not silently rewrite historical evidence.
- 056 embeds `BEGIN`/`COMMIT`. A common runner must reject transaction control
  inside future runnable migrations so it owns the atomic boundary.
- 059 contains the same grant-repair block twice. It is idempotent but shows why
  checksums must freeze reviewed bytes.
- Early files contain seed/backfill/destructive statements and do not all
  represent the current desired terminal schema. Fresh installs still depend on
  `db/migration.sql` and `tests/migration-fresh-schema.integration.spec.js`.
- The aggregate and numbered files overlap but are not a mechanically verified
  mirror. Existing tests often assert that selected fragments exist in both.
- Runtime grant migrations depend on discovered production roles and inherited
  privileges, not merely table shape.
- Production needs a reviewed historical baseline before a numbered runner can
  distinguish “already applied” from “schema happens to look equivalent.”
- The local checkout currently denies direct reads of tracked migration 005.
  Repository checks and read-only status use the exact Git index blob as a
  fallback; apply mode refuses unreadable files.

## Authoritative ledger design

The proposed append-only `schema_migration_history` table has one row per
attempt:

| Field | Contract |
|---|---|
| `attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Stable attempt identity |
| `migration_id TEXT NOT NULL` | Stable manifest ID (`026a`/`026b` resolve the legacy collision) |
| `filename TEXT NOT NULL` | Exact reviewed filename |
| `checksum CHAR(64) NOT NULL` | Canonical `sha256-lf-v1` checksum |
| `status TEXT NOT NULL` | `running`, `succeeded`, or `failed` |
| `started_at TIMESTAMPTZ NOT NULL` | Attempt start |
| `executed_at TIMESTAMPTZ` | Completion/failure timestamp |
| `duration_ms BIGINT` | Non-negative elapsed duration |
| `error_code TEXT` | Sanitized SQLSTATE or `MIGRATION_ERROR`; never raw SQL text |
| `execution_context JSONB` | Optional non-secret Git/operator/target evidence |

A partial unique index on `migration_id WHERE status='succeeded'` prevents two
successful applications. A second constraint requires completion time and
duration for terminal rows, and an append-only trigger forbids UPDATE/DELETE
except the runner's narrowly scoped `running` to terminal transition. The
runner writes `running` first, then executes the migration and success update in
one transaction. On error it rolls back the migration, records only a sanitized
failure code in a separate statement, and stops. A lost connection leaves
`running`, which blocks every later run until reviewed.

The ledger schema and production baseline are deliberately not installed in
Phase 1. Their DDL, privileges, append-only trigger, baseline rows, exact
checksums/evidence classes, and recovery snapshot require a separate review and
explicit production approval.

## Fail-closed runner contract

The Phase 1 runner/checker now blocks on:

- duplicate migration IDs or filenames;
- undeclared duplicate numeric prefixes;
- manifest order changes or out-of-order ledger success;
- missing/extra files or checksum drift (LF/CRLF canonicalized);
- unknown ledger entries, duplicate successes, failed/running attempts,
  filename/checksum mismatch, or a historical baseline gap;
- pooled database URLs, missing ledger, missing explicit apply approval, or a
  target fingerprint mismatch;
- transaction control embedded in future `execution=numbered` files;
- any migration SQL error, timeout, or post-start failure.

CLI output is sanitized and never includes database URLs, secrets, or raw SQL
errors.

## Phased cleanup and rollback

### Phase 1 — completed in this branch

- Freeze the 61-file inventory and canonical checksums in a manifest.
- Encode 026a/026b and mark 041 deferred.
- Add fail-closed manifest/ledger planning and transactional execution logic.
- Add focused tests and replace top-level “GET aggregate is authoritative”
  guidance with this document.
- Make no database, endpoint, financial, tenancy, or production behavior change.

Rollback: revert the repository commit. No database rollback is needed.

### Phase 2 — requires explicit approval

1. Resolve the migration-005 filesystem ACL outside the runner.
2. Review ledger DDL/privileges and test it on an isolated production clone.
3. Define a signed production baseline packet. Record exact apply evidence for
   035/039/060 and marker operations; label structural-only evidence honestly.
4. Decide the permanent 041 disposition (`deferred`, explicitly skipped, or a
   separately approved apply). Do not fake a success row.
5. Install the ledger and baseline in one controlled transaction with snapshot,
   direct connection, advisory lock, timeouts, pre/postflight and retained
   evidence.
6. Mark only new, reviewed migrations `execution=numbered`; rehearse the runner
   on a production clone and add it to CI.

Rollback before commit is transaction rollback. After commit, leave the inert
ledger in place unless it causes a demonstrated incident; restore from the
recorded Neon snapshot only with incident-lead approval. Baseline corrections
must be additive evidence, never silent UPDATE/DELETE.

### Phase 3 — requires explicit approval and a production deployment

- Make the numbered runner authoritative for new migrations.
- Remove aggregate migration instructions from remaining diagnostics/tests and
  replace fresh-schema bootstrap with a tested, explicit strategy.
- Change the generic endpoint to non-mutating/disabled behavior only after all
  callers and runbooks are proven migrated.

Rollback by redeploying the prior application commit; do not roll back already
committed schema by deleting ledger rows.

### Phase 4 — requires explicit approval

- Retire one-off endpoints only after marker consumers, recovery procedures,
  tests, and documentation have durable replacements.
- Preserve `migration_markers` and rollout artifacts as historical evidence.
- Consider removing the aggregate only after clean-database and upgrade-path
  tests both use the authoritative system.

Rollback is endpoint restoration from Git. No historical marker or ledger row
is deleted.

## Production actions still requiring approval

- install or baseline `schema_migration_history`;
- apply, skip, or otherwise resolve migration 041;
- run any numbered or aggregate migration;
- change, disable, or delete `api/migrate.js` or any one-off migration endpoint;
- rewrite/repair a historical SQL file;
- change production Vercel/Neon configuration or restore from a snapshot.
