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

## 10 October: submitted production test synced

Owner removed the conflicting older HighLevel contact after reviewing its linked
history. Exact email and phone searches then returned no contacts for either test
identity. The existing bounded integration runner was enabled in the operator's
configuration for school 1 and nomination
`6090a9d2-97ab-421f-8d2d-963324c84535` only. School-wide CRM/provisioning flags
were not changed; this is not campaign-wide automatic sync activation.

The run completed at 09:01 UTC with exactly five HighLevel writes: two new
DND-enabled contacts, one giveaway object, and two role associations:

- Nominee contact: `FfEHQoaEvQQwrKRyHDWv`.
- Nominator contact: `lFI1yIpTPdMYZosePqpu`.
- Giveaway record: `6ac9fed6552c329ceffa980e`.
- Nominee relation: `6ac9fed7668d8db57cb1ebd6`.
- Nominator relation: `6ac9fed71f895c120b0c2585`.

Provider readback verified exact identities, both DND flags, application status
`submitted`, invitation status `accepted_by_provider`, and the website review
link. All three pending CRM jobs succeeded and a repeat run was idle. The newly
created contacts initially were not yet visible in exact search; preparation
safely deferred before object dispatch. The normal five-minute backoff was
honoured, with no resetting of claims or uncertain operations.

The nominee's email withdrawal and SMS suppression remain effective. Consent
rows and both successful invitation job receipts were unchanged. The suppression
outbox remains pending; it was not falsely marked processed. No invitation was
resent, no marketing workflow was enabled, and automatic cleanup remains off.
Current workflow inventory/dates matched the earlier trigger review and all six
marketing workflows remained drafts. Detailed application answers remain on the
website; the CRM object contains only the existing six-field projection.

Execution and readback receipt: ignored
`tmp/submitted-test-sync-receipt-v2.json`. An earlier pre-dispatch audit-format
failure made no provider writes and its receipt is retained separately. Required
operator audit entries identify the nomination in JSON details (the audit table's
`target_id` column is numeric). No production code, schema or deployment changed.

## 10 October: automatic CRM schedule

The owner approved automatic HighLevel syncing for all giveaway entries while
keeping marketing opt-outs and automatic cleanup off. The deployment now schedules
`/api/cron-giveaway-integrations` every minute. The endpoint builds an explicitly
CRM-only configuration: nominee and nominator invitation sending are disabled
for cron invocations, and no Resend credential is supplied. Existing public
invitation dispatch remains separate. This worker never processes suppression or
cleanup jobs, changes subscriptions, removes DND, or sends marketing.

The activation requires production `GIVEAWAY_AUTOMATION_ENABLED=true`, existing
worker enablement, fixed school 1, and the school campaign's CRM/provisioning
flags. `GIVEAWAY_RETENTION_ENABLED=false` remains the cleanup gate. Each tick
handles at most one queued CRM job for the configured campaign; the queue also
covers later applications and drains existing pending CRM work. Identity clashes
are deferred for review and cannot block unrelated entries indefinitely. Held or
uncertain provider writes retain their existing fences and are never reset.
New contacts start with DND enabled; matching existing contacts are not overwritten.
Website consent and persistent suppression remain authoritative. Enabling CRM
sync does not enable marketing, even for entrants who checked optional consent.

Validation: 92 existing focused API/SQL/contact/CRM checks passed, followed by
the new SQL-backed scheduled-CRM test and cron-auth check. The new test proves
that a contact conflict does not starve a later entry, withdrawn consent is
preserved, another school is untouched, and no invitation/suppression/cleanup
work is dispatched. Production activation evidence is recorded below after
release verification.

### Production activation verified

Deployment `dpl_Hv5EDbcD2hWsRryzAsAo6n3Q2ymL` is READY on the production domains,
from release commit `d5a4cf6b77187cc0766c73c43a1fda924babea01`; main was not merged.
Vercel's Cron Jobs page confirms the enabled every-minute giveaway schedule.
Production flags were read back: API/WORKER/AUTOMATION true, worker school 1,
RETENTION false. School 1 CRM and contact provisioning are enabled with review
reference `owner-approved-auto-sync-20261010`; invitation settings were preserved.
Activation was audited atomically with the scoped configuration update.

An explicitly named `automation-verification-20261010` CRM job for the existing
submitted test was queued at 09:41:08 UTC. The hosted scheduler completed it at
09:41:45 UTC on its first attempt, without a manual worker invocation after
activation. Its ID is `c9e6dc5b-8450-46e7-ad3b-c34d6a7e4c96`. The existing three
provider operations and their timestamps were unchanged: no duplicate object,
association or contact write. Both contacts remain DND-enabled, both nominee
marketing channels are blocked, original invitation receipts are unchanged,
and the separate suppression job remains pending. There were no other pending
CRM entries at activation. A later authenticated HTTP check returned `idle`;
unauthenticated cron access returned 401 and public giveaway routes returned 200.

The post-deploy runtime scan found only the existing pg SSL-mode compatibility
warning, not an execution failure. No drain or separate alerting automation was
added. Identity conflicts and uncertain outcomes still require operator review;
activation does not promise that an ambiguous identity can be silently merged.
Private verification evidence: ignored `tmp/giveaway-auto-sync-postflight.json`
and `tmp/giveaway-auto-sync-http-idle.json`. Automatic cleanup remains OFF.
