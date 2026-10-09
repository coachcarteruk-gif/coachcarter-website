# Automatic nomination invitations — 9 October 2026

The owner explicitly corrected the initial manual-request workflow: submitting
a permission-confirmed nomination must automatically email the nominee their
private application link. A separate email to Fraser is not required.

The school invitation setting `permissionMode: "nomination"` selects the stored
nomination confirmation (exact version, wording and accepted timestamp) as the
invitation permission policy. This records the nominator's confirmation; it does
not pretend the nominee made a direct request or subscribe them to marketing.
The existing manual-request mode remains the default for other configurations.

Public submission commits the nomination and queued jobs, then awaits a bounded
invitation run for the newly created ID. The public response never exposes that
ID. On the owner's request, newly created nominations return the private
application URL to the submitting nominator for direct sharing. Repeated
submission keys and repeated nominator/nominee pairs do
not dispatch again. No public request can choose a school, campaign, origin or
permission mode. Public dispatch explicitly disables CRM and provisioning.

Provider suppression checks, local withdrawal/erasure checks, campaign cutoff,
durable claims, provider idempotency and uncertain-delivery protection remain.
If sending fails, the successful nomination stays saved and its job remains
available for staff review. Never replay an uncertain delivery without checking
provider evidence. No new cron or automatic retries are enabled. Historical
pending nominations are not silently dispatched by the configuration change.

The public page, success message, terms and privacy notice describe automatic
invitations. Optional promotional consent remains separate and unchecked.
Automatic cleanup and marketing sending remain off. The previous assessment's
direct-request safeguard no longer describes this workflow; permission is the
nominator's recorded confirmation, with nominee notice included in the email.

Validation covers real SQL commit before dispatch, one invitation across retries,
stored permission validation, public handler scoping, persistence after provider
failure, existing suppression and tenancy boundaries, and browser form flow.

## Deployment receipt

Commit `133d9ba49c5b8bc89ee64bd3f24dceab7f5b0d93` deployed to production as
`dpl_5wUHBvgzDMmtbmWP7UmsBpTqbSAc`, READY with www.coachcarter.uk assigned.
School 1's invitation permissionMode is `nomination`; invitation sending remains
enabled and CRM/provisioning remain false. No environment secrets or cron
schedules changed. There were zero nominations before and after release, so no
backfill was needed or performed.

52 API/database tests and the isolated browser test passed. Live checks verified
automatic-email wording, visible mobile form, unchecked optional consent, open
entry config, the Sunday midnight deadline, unauthenticated review rejection and
CSRF rejection. No production test nomination or message was created: actual
inbox delivery remains unverified pending the first genuine nomination.

## Nominator sharing

The submission confirmation shows a read-only personal link and Copy link button,
with manual selection as a clipboard fallback. Only a newly created nomination
receives a link: reusing contact details or a submission key cannot retrieve an
existing nominee's link. It is the same token as the automatic email, returned
in a no-store response, and is never placed in analytics, logs or local storage.
The privacy notice explains the nominator receives it and it must be shared only
with the nominee. Automated API and browser tests cover link access, duplicate
non-disclosure and copying/fallback. Automatic email behaviour is unchanged.

## Nominator confirmation email

The owner approved a transactional confirmation containing the nominee's name,
the same private application link, the deadline and a private-sharing reminder.
No promotional content or consent grant is included. The school setting
`integration.invitation.confirmationEnabled` controls creation and dispatch.
Only new submissions enqueue it; old nominations are not backfilled.

It uses the existing invitation job kind with event `nominator-confirmation`,
its own encrypted token envelope, fenced claim, recipient suppression checks,
provider idempotency key and receipt. Nominee workers claim only `nomination`
events; confirmation workers claim only the confirmation event. Both cascade
with nomination erasure and strip token envelopes after confirmed acceptance.
No schema change is required. A confirmation receipt cannot mark the nominee
invitation accepted or enqueue its CRM acceptance event. Ambiguous sends stop
for review and are never automatically replayed.

The confirmation says the nominee was emailed only when the nominee invitation
has a recorded provider acceptance; otherwise it supplies the shareable link
without claiming delivery. Inbox delivery itself is not guaranteed by acceptance.
