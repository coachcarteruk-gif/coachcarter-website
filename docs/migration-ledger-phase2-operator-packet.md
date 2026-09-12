# Migration ledger Phase 2 operator approval packet

Status: **repository rehearsal complete; production operation not approved**

Date prepared: 2026-09-09

This packet covers only installation of `schema_migration_history` and the
reviewed 61-entry historical disposition and records migration 061 honestly as
pending numbered work. It does not approve migration 041 or 061, any numbered
or aggregate migration, any endpoint change, any production
configuration change, or any financial/data mutation.

## Reviewed artifacts

- DDL: `db/migration-governance/schema-migration-history.sql`
- baseline packet: `db/migration-governance/production-baseline.json`
- operator CLI: `scripts/migration-ledger-rehearsal.js`
- Phase 1 runner: `scripts/migration-runner.js`
- unit tests: `tests/migration-governance.spec.js` and
  `tests/migration-ledger-phase2.spec.js`
- disposable-database test:
  `tests/migration-ledger-phase2.integration.spec.js`

Before any future operation, record the reviewed Git commit, the DDL checksum,
the baseline-packet checksum, the manifest checksum, the operator, reviewer,
maintenance window, and exact target fingerprint. Any later repository change
to one of these artifacts voids the review until the focused tests and
rehearsal are repeated.

## Baseline meaning

The packet contains all 62 manifest identities, including `026a`, `026b`, and
pending numbered 061. It creates 60 successful `record_kind=baseline` receipts
and creates no row for 041 or 061.

The ledger is global migration infrastructure, not tenant-owned application
data, so it intentionally has no `school_id`. The DDL grants no access to the
application runtime or `PUBLIC`; only the separately approved direct database
owner performs ledger operations.

- 035, 039, and 060 are `exact_execution` because retained evidence supports
  that claim. Only proved historical timestamps are retained in their JSON
  evidence; 060 deliberately has no asserted historical execution timestamp.
- 014 and 021 are `intentionally_removed`. A successful baseline receipt means
  their reviewed retirement was recorded, not that their deleted objects are
  currently present or that the original file was proved to have run.
- the other 55 receipts are `structural_equivalence`. They do not claim exact
  file execution.
- 041 is `deferred`; it is omitted from the ledger rather than recorded as a
  false success.
- 061 is `pending_numbered`; it is omitted from the historical baseline and
  can run only through the separately approved numbered-migration gate.
- the ten legacy marker keys are exact evidence. Their real non-null
  `migration_markers.completed_at` values are read from the target during
  preflight and stored in the baseline context. The checked-in packet contains
  no invented marker timestamps.

Core `started_at`, `executed_at`, and `duration_ms` values on baseline rows are
database-generated timestamps for the baseline-recording statements. They are
not presented as historical migration execution times.

## Required target and connection

Production identity, if later approved:

- Neon project: `neon-green-elephant` (`falling-firefly-48751671`)
- protected/root branch: `main` (`br-summer-silence-abcpp6vw`)
- database: `neondb`

Use only a direct/non-pooled owner connection supplied by the approved secret
manager. The hostname must not contain `-pooler`. Never paste or echo the URL,
credentials, or API keys into a task, terminal transcript, evidence file, or
command. The CLI reads only `MIGRATION_LEDGER_DIRECT_URL`, connects with
`node-postgres` over the direct PostgreSQL endpoint, normalizes Neon's
`sslmode=require` connection parameter to explicit `sslmode=verify-full`, and
prints a SHA-256 target fingerprint, never connection material. Connection
failures must return the sanitized CLI error envelope with a non-zero exit; any
stack trace or connection detail in operator output is an incident boundary.

## Repository and rehearsal checks

Run from a clean checkout of the exact candidate commit:

```powershell
npm.cmd run migrations:check
$env:CC_TEST_BASE_URL='http://127.0.0.1:9'
npm.cmd test -- tests/migration-governance.spec.js tests/migration-ledger-phase2.spec.js
```

Expected results:

```text
Migration check: ok=true, migrations=62, collisions.026=[026a,026b]
Focused unit tests: all passed
```

The database rehearsal must be repeated against a fresh disposable database on
an explicitly confirmed non-production Neon branch or a fresh production
clone. The checked-in integration test creates and drops only
`cc_migration_ledger_phase2_rehearsal`; it refuses pooled, unconfirmed, or
production-equivalent targets.

```powershell
$env:CC_TEST_BASE_URL='http://127.0.0.1:9'
$env:CC_TEST_DB='1'
$env:CC_TEST_DB_CONFIRMED_NON_PRODUCTION='1'
$env:CC_TEST_DB_EXPECTED_HOSTNAME='<confirmed-direct-clone-hostname>'
npm.cmd test -- tests/migration-ledger-phase2.integration.spec.js
```

Expected result:

```text
5 passed
```

The test must prove rollback, 60-row installation, idempotency, append-only
guards, sanitized failed-attempt handling, duplicate-success enforcement,
checksum mismatch rejection, ordering-gap rejection, Phase 1 planner
compatibility, and final disposable cleanup.

## Production preflight — read-only

These commands are documentation only. Running them against production still
requires separate approval to access the production target, even though this
mode opens a read-only transaction.

After securely injecting the approved direct URL into the process environment:

```powershell
npm.cmd run migrations:ledger:preflight
```

No argument is also read-only preflight; `--dry-run` is an alias. Expected
sanitized JSON shape before installation:

```json
{
  "ok": true,
  "mode": "preflight",
  "targetFingerprint": "<64 lowercase hex characters>",
  "ledger": "absent",
  "manifestEntries": 62,
  "baselineRows": 0,
  "pendingNumbered": ["061"],
  "deferred": ["041"],
  "exactExecutionEvidence": ["035", "039", "060"],
  "legacyMarkers": ["<ten key/timestamp objects from production>"],
  "packetChecksum": "<64 lowercase hex characters>",
  "ledgerDdlChecksum": "<64 lowercase hex characters>",
  "next": "READY_FOR_SEPARATE_INSTALL_APPROVAL"
}
```

Stop unless:

- the repository manifest and packet validate exactly;
- the direct target fingerprint is independently matched to the approved
  production identity;
- the ledger is absent, or is already installed with the exact reviewed shape
  and complete baseline;
- all ten exact marker rows have real non-null timestamps;
- there are no unknown rows, duplicate successes, checksum/filename mismatches,
  ordering gaps, `running` attempts, or `failed` attempts;
- no other migration, schema operation, payout, refund, or financial repair is
  running.

Retain the sanitized preflight output. Do not retain private database logs in
the repository.

## Mandatory Neon snapshot and approval gate

Immediately before the future production transaction, create a named snapshot
from the root `main` branch and retain its returned `snap-...` identifier. Neon
documents snapshot creation and restore at
<https://neon.com/docs/ai/ai-database-versioning>. Confirm the snapshot is
listed and restorable before proceeding. Snapshot creation and any later
restore are separate Neon operations and require their own approval.

Only after the preflight reviewer and incident lead approve the exact commit,
target fingerprint, snapshot ID, and maintenance window may the operator set:

```powershell
$env:MIGRATION_LEDGER_TARGET_FINGERPRINT='<exact-preflight-fingerprint>'
$env:MIGRATION_LEDGER_TARGET_CLASS='production'
$env:MIGRATION_LEDGER_MUTATION_APPROVAL='INSTALL_BASELINE'
$env:MIGRATION_LEDGER_PRODUCTION_APPROVAL='SEPARATELY_APPROVED_PRODUCTION_BASELINE'
$env:MIGRATION_LEDGER_NEON_SNAPSHOT='<verified-snap-id>'
```

These variables are necessary gates, not approval by themselves. The human
approval record must separately identify the exact values and scope.

## Production install command and expected output

The separately approved command is:

```powershell
npm.cmd run migrations:ledger:install
```

Expected first-run JSON:

```json
{
  "ok": true,
  "mode": "install",
  "committed": true,
  "alreadyInstalled": false,
  "inserted": 60,
  "targetFingerprint": "<the approved fingerprint>"
}
```

The DDL and all baseline rows run in one transaction under the advisory lock
with 10-second lock, 10-minute statement, and 2-minute idle-transaction
timeouts. Any error rolls the entire transaction back.

The same exact approved command is idempotent. A deliberate second invocation
must return:

```json
{
  "ok": true,
  "mode": "install",
  "committed": true,
  "alreadyInstalled": true,
  "inserted": 0,
  "targetFingerprint": "<the approved fingerprint>"
}
```

Any other output is an incident boundary. Do not retry with changed inputs.

## Production postflight

Run immediately after a successful commit:

```powershell
npm.cmd run migrations:ledger:postflight
```

Expected output:

```json
{
  "ok": true,
  "mode": "postflight",
  "targetFingerprint": "<the approved fingerprint>",
  "rows": 60,
  "exactExecutionEvidence": ["035", "039", "060"],
  "structuralEquivalence": 55,
  "intentionallyRemoved": ["014", "021"],
  "deferred": ["041"],
  "pendingNumbered": ["061"],
  "status": "BASELINE_INSTALLED_AND_VALID"
}
```

Then prove compatibility with the Phase 1 runner using the same direct URL:

```powershell
$env:POSTGRES_URL_NON_POOLING=$env:MIGRATION_LEDGER_DIRECT_URL
node scripts/migration-runner.js --status
```

Expected values are `applied: 60` and `pending: ["061"]`. This does not run
the pending migration. Applying 061 remains a separate authorization boundary.

Retain the install and postflight outputs with the approval record, snapshot
ID, commit, reviewer, operator, and maintenance-window timestamps.

## Abort, rollback, and incident boundaries

Before commit, any checksum, target, marker, DDL, ordering, duplicate,
unresolved-attempt, advisory-lock, timeout, SQL, or postcondition error means
automatic transaction rollback and stop. Do not weaken a gate or hand-edit a
ledger row.

After commit, the ledger is inert and append-only. Production cleanup is
deliberately refused by the CLI. Leave the ledger in place unless it causes a
demonstrated material database incident. Snapshot restore is the only planned
post-commit recovery boundary, and it requires incident-lead approval after
assessing writes since the snapshot. Do not connect while Neon reports a
restore operation in progress. Baseline corrections must be additive reviewed
evidence; never `UPDATE`, `DELETE`, `TRUNCATE`, or drop production history.

The cleanup command exists only for an `isolated_rehearsal` target and requires
the exact `REMOVE_REHEARSAL_LEDGER` gate. It cannot be used against a target
classified as production.

## Unresolved decisions and explicitly deferred work

- Migration 041 remains deferred. Future choices are: keep it deferred; design
  an explicit skip disposition with matching DDL/runner semantics; or review
  and apply it separately. This package makes none of those decisions and
  cannot record a skipped or successful 041 row.
- No historical timestamp is available in the retained 060 evidence, so none
  is asserted.
- The historical migration-005 local ACL issue remains an operator-workstation
  concern. Read-only validation may use the exact Git index blob; no migration
  bytes are changed.
- Making the numbered runner authoritative, changing CI authority, replacing
  fresh-schema bootstrap, and changing or retiring any migration endpoint are
  Phase 3/4 work requiring separate approval.

## Explicit production approval statement

Merging this repository package does not approve running it against production.
Production preflight access, snapshot creation, ledger installation/baseline,
postflight access, any snapshot restore, and every decision about migration 041
each require separate explicit approval.
