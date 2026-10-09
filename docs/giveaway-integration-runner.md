# Giveaway integration runner — 9 October 2026

The server now composes invitation permission checks, the durable invitation
queue, exact HighLevel contact matching, separately gated contact provisioning
and CRM projection. `tools/giveaway/integration.cjs` provides a one-nomination
runner and a queue selector for scheduled invocation. Each run processes at most
one invitation and one CRM job. Claims and provider journals fence concurrent
workers; uncertain work is held for investigation and never reset automatically.

## Permission and administration

`POST /api/giveaway?action=record-invitation-request` requires school-admin auth,
same-origin CSRF, `nomination_id`, `nominee_requested: true`, and a short
`verification_reference`. The administrator must have actual evidence that the
nominee requested the email; the nomination checkbox alone is insufficient.
The action is audited before recording identity-bound evidence in the existing
nomination JSON. Evidence is included in the nominee's privacy export and removed
with the nomination. It does not clear any suppression or send an email.

`POST /api/giveaway?action=run-integration` requires the same auth and CSRF,
accepts only a nomination ID, and takes all provider/campaign settings from the
school's trusted configuration. It is audited before dispatch. Controls are in
the administrator review page. No public submission can choose an origin,
school, provider location, sender or activation setting.

Invitations check local persistent email suppression, recorded request evidence,
Resend suppression and Resend contact unsubscribe status before dispatch and
again before sending. Unavailable or malformed provider checks deny sending.
Provider acceptance is not delivery. This is not a marketing sender and does not
process the separate marketing-suppression outbox into provider subscriptions.
Existing HighLevel DND is preserved; reviewed new contacts start with DND enabled.
Campaign-wide bounce/complaint monitoring still needs an appointed operator.

## Activation settings — not enabled by this change

The environment gate `GIVEAWAY_WORKER_ENABLED=true` and school
`config.giveaway.integration.enabled=true` are both required for admin dispatch.
The trusted integration object contains:

- `invitation`: `enabled`, `from`, `replyTo`, `testOnly`, `testRecipient`.
  Origin is taken from `config.giveaway.origin`.
- `crm`: `enabled`, `environment`, `locationId`, `reviewUrl`, and the two
  verified association IDs/directions.
- `provisioning`: separate `enabled`, `creationApproved`, `reviewReference`.
  Keep off unless contact creation and current workflow/duplicate behaviour
  have been specifically reviewed.

Credentials are server-only `RESEND_API_KEY`, `HIGHLEVEL_GIVEAWAY_API_KEY`,
`POSTGRES_URL`, and `GIVEAWAY_ENCRYPTION_KEY`. No credentials were added to the
hosted rehearsal by this change.

`GET /api/cron-giveaway-integrations` also requires the shared cron authentication,
`GIVEAWAY_AUTOMATION_ENABLED=true`, and a fixed `GIVEAWAY_WORKER_SCHOOL_ID`.
It uses the existing cron lock infrastructure and selects only that school's
configured campaign. Unrequested email and held nominations are skipped. No cron
schedule has been installed; release must approve frequency, schema/grants,
credentials, monitoring and activation. Existing 077/078 storage suffices for
request evidence; the cron uses the existing `cron_locks` infrastructure.

## Verification and live rehearsal

SQL-backed fictional-provider checks cover the combined nomination → invitation
→ contact provisioning → CRM → application update → withdrawal flow, default-off
gates, tenant/campaign isolation, request evidence, suppressed/unknown provider
responses, timeout holds and repeat execution. API tests cover admin/CSRF and
trusted configuration, audit evidence and scheduled-worker authentication.

The bounded real HighLevel test on 9 October at 16:25 UTC used the two existing
`TEST DO NOT CONTACT` contacts in location `RFUEKcQDtlsBSCVBJsMs`. It created one
fictional record, two role associations and one application-status update (four
writes total). Repeating the runner was idle. Both contacts remained DND-enabled;
no contacts were created and no email was sent. Record ID:
`6ac91580bf9fc0125b4ad381`. The isolated SQL nomination is
`178f9684-863f-4715-bfdc-1da3ec316773`. Private execution evidence is in the ignored
`tmp/combined-crm-rehearsal-receipt.json`. Keep this evidence; do not replay it.

The earlier single-inbox email rehearsal remains the delivery evidence. The
combined lifecycle with simulated email and real SQL is distinct from this real
CRM-only rehearsal; neither implies a newly delivered end-to-end live campaign.

The protected preview build is `dpl_CsczLUoXed274k2aqJxZzCh2amV7` at
https://coachcarter-giveaway-rehearsal-7d8tl6nz5.vercel.app. It contains the admin
controls and unscheduled cron entry point, with all hosted integration activation
gates off. The existing public form-to-admin browser journey and disabled-control
check passed locally. Across the offline suite and subsequent targeted reruns,
107 tests passed; the browser journey also passed after the admin UI change.
