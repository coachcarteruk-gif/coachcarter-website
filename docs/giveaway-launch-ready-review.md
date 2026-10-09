# Giveaway production setup review — 9 October 2026

Preparation completed for review; public activation is not performed. This is the
current plan, superseding the old release package's status and unresolved-item
list where the dated evidence below resolves it.

## Verified destination and source

- Vercel team: `team_DXEEAusHmjcfcr6auPjqloL0`.
- Production project: `prj_ikyhcHbDHOR4jDQuZUeGFv3pw1Lk`, `coachcarter-website`.
- Both domains verified. `coachcarter.uk` redirects to `www.coachcarter.uk`.
  Public link: https://coachcarter.uk/giveaway/ ; trusted API origin must be
  `https://www.coachcarter.uk`. Explicit `/giveaway` and `/giveaway/` rewrites
  are included in the full-site configuration.
- Fresh `git fetch origin main`: live base and remote main both
  `91b3e07d8354c666ad92aa179328f4ae78e289eb`; no missing upstream commits.
- Current production/rollback deployment: `dpl_3HoyHKfLZf3q2bYdfKTPsbRzCRQW`.
- Neon production: project `falling-firefly-48751671`, branch
  `br-summer-silence-abcpp6vw`, database `neondb`, school 1, host
  `www.coachcarter.uk`. Read-only checks found successful 075/076 receipts and
  no giveaway tables/configuration. 077 and 078 still need approved execution.

## Concrete proposed production setup

1. Record a current database recovery point; validate the complete immutable
   migration ledger and exact target fingerprint with the governed runner.
   Require that the only new pending migrations are 077 and 078; do not apply
   unrelated migrations. Match manifest checksums before execution.
2. Apply those two additive migrations through the governed runner, verify
   tenant foreign keys/indexes and runtime grants, then create the disabled
   school/campaign configuration in `tools/giveaway/launch-config.example.json`.
   Merge only the `giveaway` school config key, preserving all other settings.
3. Provision a fresh production invitation encryption key and verified server
   provider credentials through secret storage. Never reuse rehearsal secrets,
   database, review account, invitation tokens or source bundles containing them.
4. Deploy the full tracked website source, retaining all existing routes/crons.
   The minimal 99-file rehearsal package is NOT a production website package.
   Keep all giveaway environment and school activation gates false. No new cron.
5. Confirm production API is disabled and existing website/login paths work.
   Keep the existing draft labels until the publication stage is ready.

This setup needs explicit production migration/deployment approval. It does not
authorize a bulk send, automatic worker, contact creation, selection or deletion.
Rollback disables giveaway entry and worker gates first; preserve data and
provider journals. Use the recorded Vercel rollback candidate if code rollback
is necessary; do not drop the additive storage or replay uncertain sends.

## Invitation operating sequence

Fraser personally messages Facebook nominators with the public nomination URL
after publication. They ask permission before entering someone else's details.
The existing sender additionally requires evidence that the nominee requested
the application email. A nomination checkbox alone does not release queued mail.
The admin records the separate request reference, then runs the bounded worker
once for that nomination after approved sender activation. Check delivery status;
provider acceptance alone is not delivery. Investigate uncertain outcomes without
replaying. Each nominee must submit before midnight at the end of Sunday 11 October.

Suggested personal message (draft only, not sent):

> Thanks for nominating someone for the free lessons. Please complete their
> nomination here: https://coachcarter.uk/giveaway/
> Before entering their details, please check they are happy for you to do so.
> Please also ask them to message me to request their private application link.
> They will need to finish their application by midnight at the end of Sunday
> 11 October. The nomination itself is not a completed application.

Live read-only Resend checks for the previously authorized test inbox passed
the exact suppression/unsubscribe adapter. No new email was sent. Earlier
single-inbox delivered mail and bounded real fictional-contact CRM receipts
remain valid historical evidence; current end-to-end tests use fictional
transports. New-contact provisioning stays gated pending current workflow review.
No promotional sender or external subscription enrollment is activated.

## Privacy and remaining publication decisions

The owner explicitly chose to keep automatic cleanup OFF. Keep
`GIVEAWAY_RETENTION_ENABLED=false`, even after launch. No new retention migration
is included. Approved policy remains: unsuccessful stories/entries deleted after
90 days, winner's necessary details retained during lessons, marketing contacts
handled separately. Manual review is due by `2027-01-09T23:00:00Z`. No reminder or
scheduled deletion was created. Before manual deletion preserve only legitimately
needed winner/contact/evidence records and complete provider cleanup; the current
campaign-wide cleanup must not erase those blindly. Post-lesson and promotional
retention periods remain unapproved; no 12-month/90-day-after-lessons proposal
was adopted.

Fraser handles privacy requests. Solo selection within published criteria is the
owner's recorded choice; applicability of CAP's independent-judging rule has not
been determined. Final controller/lawful-basis/provider notice details still need
resolution before removing the privacy draft notices. These are not technical
checks that a passing test can certify.

## Verification

110 domain, API, SQL, provider adapter, contact-matching/provisioning and cleanup
checks passed, plus two isolated browser checks for the real page-to-SQL journey
and cookie behavior. All 79 migration manifest entries pass checksum checks.
Current protected hosted pages and admin opt-out previously passed with fictional
data. No production writes, deployment, messages or cleanup occurred in this
preparation. A full tracked-source archive and SHA-256 receipt are generated in
ignored `tmp/` after the release-preparation commit; this is a source package,
not a claim that Vercel has compiled or deployed the production candidate.
