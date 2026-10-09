# Giveaway release review package — 9 October 2026

Status: local journey verified; **not approved or ready for public activation**.
Continue `codex/giveaway-nomination-flow`. This package records the current dirty
working tree without committing, staging, pushing or changing running previews.

Base: `91b3e07d8354c666ad92aa179328f4ae78e289eb` (locally recorded origin/main).
HEAD: `ad2004f476c2544f175714753add5ccebff21e79` plus the exact file bytes in
`giveaway-release-manifest.json`. No fresh remote-main comparison is claimed.
The local ZIP under `tmp/giveaway-release-review-20261009.zip` contains these
allowlisted files and the manifest. It is a review overlay on that base, **not a
standalone deployable build**. A clean release commit/build must be identified
before deployment approval; do not deploy this dirty checkout wholesale.

## Scope and exclusions

- Draft `public/giveaway/` pages/assets, disabled API, SQL repository, invitation,
  CRM, provisioning, privacy and cleanup modules under `tools/giveaway/`.
- Shared changes: giveaway export/deletion in `api/_gdpr.js` and `api/learner.js`,
  gated retention staging in `api/cron-retention.js`, and analytics exclusion in
  `public/posthog-loader.js`. Include their focused evidence and review them as
  shared production changes, even while public entry is disabled.
- Tests, fictional preview tooling and related repository documentation are
  source/review material. The fictional servers must never be deployed as API
  routes or used as production storage/authentication.
- Migrations 077 and 078 and the manifest are included. Migration 076 belongs to
  diary access: its unchanged file is included solely because the supplied
  manifest references it. It is **not giveaway migration authorization**. Resolve
  its ledger status independently before any ordered runner action.
- No `.env`, credentials, local agent data, node_modules, captured invitations,
  provider receipts, preview stores or other temporary files are packaged.

## Verified story and evidence

The production draft nomination form calls the real handler, writes a fictional
nomination and encrypted invitation job into PGlite, opens its private link,
submits two separate required answers, and displays them through authenticated
administrator review. The test extracts the link from the local outbox; it does
not send an invitation or prove provider delivery.

`node --test tools/giveaway/production-browser.test.cjs` passed in Edge with the
current CSP extracted from `middleware.js` and MIME enforcement. It checks cookie
consent, unauthorized review rejection, fragment removal, Secure/HttpOnly session
cookie, nominator privacy, unchecked optional boxes, required barriers, preserved
answers after a simulated 503, SQL persistence, refresh confirmation, both review
headings, original historical answer preservation and its legacy label, 320px
overflow, zero script errors/CSP violations/external requests/failed assets.
Admin authentication uses a short-lived fictional JWT with the real auth helper;
the hosted login/email-code process is not exercised.

The existing `browser.test.cjs` journey also passed. Seven offline suites passed
95 tests: domain, API, database, contact matching, contact provisioning,
HighLevel sync and provider cleanup. Combined: **97 passing tests**. Windows
sandbox restrictions prevented Edge startup initially; successful browser runs
used isolated temporary Edge profiles outside that sandbox.

`node scripts/migration-runner.js --check` passed (79 manifest entries; the known
026a/026b numbering is reported). This is a filesystem-only check, not production
ledger verification. Syntax and tracked whitespace checks passed.

Visual evidence: `tmp/giveaway-production-screenshots/application-mobile.png`
and `review-desktop.png`, inspected locally. The mobile capture includes the
intentional missing-answer validation state; its fixture deadline is relative to
the test clock, not campaign copy approval. The test starts and closes its own
ephemeral server/database; ports 61530 and 61531 are not restarted or reused.

Fix from this check: four public draft pages referenced missing `/branding.js`.
They now load the existing `/shared/branding.js`; asset failure checks guard the
nomination/application/review journey.

## Configuration and migration proposal — nothing applied

| Setting | Proposed state for an inert code release | Activation requirement |
| --- | --- | --- |
| `GIVEAWAY_API_ENABLED` | unset/false | Separate approval after schema and hosted verification |
| `GIVEAWAY_RETENTION_ENABLED` | unset/false | Approved winner/evidence disposition and cleanup operations |
| `POSTGRES_URL` | Existing managed secret; no value in package | Verify correct project/database/runtime role |
| `GIVEAWAY_ENCRYPTION_KEY` | Dedicated secret required before API enablement | 64 hexadecimal characters; preserve while links/jobs remain valid |
| school `config.giveaway` | No mutation proposed now | Trusted campaign key and exact HTTPS origin; enabled false during preparation |
| campaign row | No seed proposed now | Approved deadline/retain_until; enabled false until entry release |
| Provider workers/senders | Unwired/off | Separate reviewed hosting/composition and explicit bounded activation |

077 creates campaign, nomination, job and consent storage; 078 adds persistent
privacy/suppression support. Both answers use existing application JSON; the
two-question change needs no further schema migration. Before approved execution,
verify target fingerprint, runtime grants, current immutable ledger, prerequisite
status and exact checksums; rehearse the actual ordered path on an isolated branch.
Never invoke an aggregate migration or apply all pending files as a shortcut.
Follow `migration-governance.md`; this packet is not an execution command.

## Remaining release gates

The two questions and their equal weighting are settled. Do not ask to approve
them again. Preserve the latest owner direction in `giveaway-judged-award.md`:
Monday remains the intended review day; any extension depends on actual missed
follow-up, not a new automatic delay. Older random-draw notes are historical.

Before public launch, complete the existing unresolved work: final judging
participation/replacement procedure, treatment of existing Facebook nominations
and actual follow-up timing, invitation permission evidence and approved privacy
disposition, real worker composition including suppression and delivery failures,
controlled provider evidence, and hosted HTTPS/Neon/admin-login verification.
Integrations are wanted; a website-only launch with CRM deferred is not assumed.
The existing public copy remains visibly draft in index/apply/terms/privacy and
must be finalized consistently once those decisions are resolved.

Assign a release/monitoring operator and privacy/provider owner before activation;
none is appointed by this package. Monitor safe API error counts, nomination and
submission counts, authenticated integration status, queue age, uncertain jobs,
bounces/complaints and privacy requests. Never log narratives or invitation tokens.
Uncertain provider outcomes require investigation, not reset/replay.

After those gates, prepare a clean commit and hosted review build with the agreed
target team/project/environment, exact artifact and separate approvals for
migrations, deployment, entry enablement and invitation/provider activation.
No approval is requested for an unfinished launch package.

## Rollback

Stop provider dispatch and disable new entries at school and campaign gates.
Preserve API access for existing opt-outs, authenticated review and privacy work;
retain campaign origin/key and invitation encryption secret. Global shutdown is
an incident measure requiring the staffed privacy route. Quarantine uncertain
jobs; retain receipts and submissions. Do not delete records, roll back the
database, remove ledger rows or replay jobs. Revert only compatible application
code after checking retained schema and shared privacy hooks.
