# Private hosted rehearsal — 9 October 2026

## Latest copy and deadline revision

Owner requested 18:00 UK on Sunday 11 October (17:00 UTC), plus selection of
a new winner if the first winner has not responded within five days. Source,
email template, terms and the isolated campaign deadline now agree. The revised
protected Preview is `dpl_6TMzPoQdNMKRod9NpcoEQe6rTFDY`:
https://coachcarter-giveaway-rehearsal-3wm4pgevc.vercel.app/giveaway/index.html
The rehearsal school's trusted origin now points to this preview; use it instead
of earlier deployment URLs. All three hosted pages and the API deadline were
verified, and 15 domain tests passed including the precise closing boundary.
The previously delivered email is unchanged; no replacement email was sent.
Earlier evidence below describes the previous artifact.

The owner authorized the private test deployment and isolated database setup.
The full hosted journey passed at 14:11 UK time on 9 October. Public launch,
real invitations, provider activation and production migrations remain unapproved.

## Exact target and source

- Team: `team_DXEEAusHmjcfcr6auPjqloL0`.
- New, separate Vercel project: `coachcarter-giveaway-rehearsal`,
  `prj_dMAQfAC2VM1Q0sjoV6ZpQgoUd3Id`.
- Verified preview: `dpl_GgFjGYsKeX8c73JJ7EseBE22bTx4`, READY, target null
  (Preview), Node 22. Runtime logs confirm London execution.
- [Open the private nomination preview](https://coachcarter-giveaway-rehearsal-djlb70dil.vercel.app/giveaway/index.html).
  Vercel team authentication is required. Anonymous access was verified to redirect
  to Vercel login. Project SSO protection remains enabled for all deployments.
- Application source: commit `69dd7efb89a46b3ba509cb1618faa5a65706ea67`.
  `giveaway-hosted-source-manifest.json` records the 91 uploaded files and hashes.
  Application files are unchanged. The generated rehearsal-only `vercel.json`
  retains middleware and API/static routing, selects London, redirects `/` to the
  giveaway and `/admin/portal.html` to giveaway review. It contains no cron jobs.
  Only giveaway, existing admin and config endpoints plus their dependencies and
  required public assets are packaged; this is not a full-site deployment.

The first project build (`dpl_xGPijkVCsr6ikztoprfdCARJSvDp`) was labelled production
by Vercel. It received no database/API-enable credentials, which are Preview-only.
The project-level default domains point to that inert build, not the verified
preview. Two intervening Preview builds exposed setup gaps; use the exact final
URL above. The live CoachCarter Vercel project was never changed or promoted.

## Data, permissions and configuration

The existing isolated Neon test branch `br-twilight-term-abtld5ie` in project
`falling-firefly-48751671` contains inherited data. A separate **empty** database,
`giveaway_hosted_rehearsal`, was created there and verified to have zero public
tables before setup. No inherited personal rows were read or copied.

Only small fictional schools/admin/rate-limit/audit/cookie-consent fixture tables
and the exact giveaway 077/078 schema were created in that empty database. This
was a test fixture setup, not an ordered migration-ledger rehearsal or production
upgrade. Production ledger, grants and migration prerequisites still need their
own approved execution plan. The branch expires 16 October 2026 at 09:00 UK time.

Runtime role `cc_giveaway_hosted` has no superuser, role-creation, database-creation
or inherited-role privileges. A metadata-only check found zero accessible public
tables in the inherited `neondb`. Runtime grants cover the fictional giveaway
tables, rate limits, consent logging and read-only school/admin lookups.
`UPDATE(enabled)` on `giveaway_campaigns` is additionally necessary for the
repository's `SELECT ... FOR SHARE` lock. Omitting it caused a safe API 500 during
the initial test; adding that column grant resolved nomination. Review this lock
requirement when preparing the real runtime grants.

Preview environment has only the isolated DB URL, fresh JWT/encryption secrets,
API enabled, retention disabled, CSRF enforced, and a deliberately invalid Stripe
test placeholder with test mode. The placeholder is not a real provider key: the
existing admin module initializes payout/reconciliation clients even for login
and otherwise throws before reaching authentication. No payment code was changed
or payment endpoint called. No SMTP, Resend, HighLevel or other live provider
credential was installed. No provider worker or scheduler is deployed.

School and campaign gates are enabled only in the fictional database and bound to
the exact final preview origin. The fixture deadline is two days from setup and
is not approved campaign timing. Enter fictional details only. The agreed public
campaign deadline and Facebook follow-up reconciliation were not changed.

## Verification evidence

The hosted Edge browser test confirmed:

- Protected HTTPS, cookie-consent flow and unauthenticated review rejection.
- Nomination through the real API into Neon with a pending invitation job.
- Private link extracted locally from that fictional job; fragment removal and
  encrypted Secure/HttpOnly invitation cookie. No email was sent.
- Required second answer, separate SQL `meaning` and `barriers` values, completed
  confirmation after refresh, and no horizontal overflow at 320px.
- Existing `/admin/login.html` and `/api/admin?action=login` with a fictional
  database-backed reviewer; Secure/HttpOnly admin cookie and authenticated review
  showing both narrative answers separately. No JWT injection or test login route.
- No browser page errors. Final queue readback: three pending invitations and six
  pending CRM jobs from the fictional attempts, with no dispatched/completed jobs.
- Anonymous preview access returns 302 to Vercel login. One-hour deployment-scoped
  share tokens were used only for automated checks; protection was not disabled.

The package initially omitted `/api/config?action=record-consent`; the existing
endpoint and dependency were added unchanged, with a fictional consent table.
This fixes the rehearsal package rather than modifying production application code.

Local ignored evidence: `tmp/giveaway-hosted-receipt.json`,
`tmp/giveaway-hosted-review.png`, `tmp/hosted-browser.cjs`, and the source manifest.
The screenshot was visually inspected. `tmp/hosted-secrets.json` holds only test
access material and must never be committed, uploaded with source or shared.
The signed-in test reviewer is `reviewer@example.test`; its random password is
kept in that ignored file, not in this document. Local previews were untouched.

## Remaining work

Hosted entry and administrator review are now evidenced. Real invitation delivery,
CRM/consent/suppression composition, controlled provider activation, final public
copy/privacy disposition and outstanding judging/Facebook handling gates remain.
The questions and equal weighting are settled. The prior release-package hash
manifest is the pre-deployment snapshot; this document records subsequent hosting
evidence without rewriting that historical package.

Before a real release, reconcile with latest main and prepare a clean full-site
build with the approved target, immutable ledger checks and real runtime grants.
Do not reuse the fictional database, admin password, JWT secret, encryption key,
Stripe placeholder or rehearsal deadline for live entries. No production launch
approval is implied by this successful rehearsal.
