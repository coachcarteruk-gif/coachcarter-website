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
ID or token. Repeated submission keys and repeated nominator/nominee pairs do
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
