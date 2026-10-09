# Production setup receipt — 9 October 2026

The owner explicitly approved migrations 077/078 and deployment with entry and
sending disabled. Automatic cleanup remains off at the owner's request.

## Database

Target: Neon project `falling-firefly-48751671`, production branch
`br-summer-silence-abcpp6vw`, database `neondb`. Direct owner fingerprint:
`32c8e09a13fff240b0e1af6bb4c063bce1ca02ec09b801242e9232c824123008`.

Recovery snapshot `snap-lucky-thunder-abn4fwoy` was created at 17:23:40 UTC before
mutation. The governed runner validated the complete ledger: 76 applied, only
077/078 pending. It applied exactly those two immutable manifest entries and
postflight found 78 applied, no pending migrations. Six validated foreign keys
were checked across nomination, consent and job storage.

School 1's other configuration was preserved. Its new giveaway config and the
`lifelong-learner-pass-2026-10` campaign are disabled. Deadline is
`2026-10-11T23:00:00Z`, midnight at the end of Sunday in the UK. `retain_until`
is `2027-01-09T23:00:00Z`; it is not an instruction to run cleanup.

Existing runtime role `cc_prod_runtime_20260830` received SELECT and
UPDATE(enabled) on campaigns (the latter supports row locking), plus
SELECT/INSERT/UPDATE/DELETE on the four new nomination, consent, job and
suppression tables. A direct runtime-role connection verified campaign row
locking and all grants without inserting or changing entries. An initial attempt
to SET ROLE from the owner connection was denied; the verification used the
runtime connection instead, without broadening role membership.

## Deployment and secrets

Production project `prj_ikyhcHbDHOR4jDQuZUeGFv3pw1Lk`, team
`team_DXEEAusHmjcfcr6auPjqloL0`. Full Git source commit:
`648672083c0bc185b4d76ddfee6577ce71f31252` on `codex/giveaway-nomination-flow`.
The release branch was pushed; main was not merged or changed.

Initial deployment `dpl_DLwcfYghRQVBRAf39joPiWbsnAU8` reached READY and the live
domain checks passed. Final deployment incorporating the prepared provider
credential: `dpl_FjxRk55cwVWCqfjumufTe78Qgqru`, READY with the real domains assigned.
Rollback candidate before this work: `dpl_3HoyHKfLZf3q2bYdfKTPsbRzCRQW`.

Production API, worker, automation and retention flags are explicitly false.
Worker school is fixed to 1. A fresh production invitation encryption key was
created as a sensitive variable. The verified HighLevel location credential is
stored as a sensitive variable; the existing Resend production credential was
preserved and passed read-only suppression/contact checks. No secret values are
included in tracked files. No provider messages, subscriptions or contact writes
were performed. No new cron schedule was installed.

## Verification and remaining scope

Both initial and final live GET checks returned 200 for homepage, administrator sign-in and all
four giveaway public pages. Giveaway config returned 404/DISABLED. The apex
giveaway URL redirects to the canonical www host. Draft labels remain visible.
Database campaign and school entry/integration gates remain false.

Final production environment readback confirmed all four enablement flags false;
the production database has zero giveaway nominations. Temporary production
connection strings, provider-key copy and generated-key file were removed after
verification; managed Vercel secrets remain installed.

This is inert production setup, not public opening. Privacy notice finalization,
invitation operating approval and bounded worker activation remain separate.
Do not blindly enable retention: winner/contact separation and remaining
retention periods are unresolved. Preserve the deployed branch when planning
future main-based releases; main does not yet include the giveaway changes.

Ignored receipts under `tmp/` contain preflight, migration/postflight, grants,
HTTP verification and provider read-check metadata. Credential files in that
directory are secrets and must never be published or attached.
