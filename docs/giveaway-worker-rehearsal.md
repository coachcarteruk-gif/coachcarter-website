# Bounded worker preparation — 9 October 2026

`tools/giveaway/bounded-worker.cjs` composes the durable SQL queue with the
invitation sender and CRM matcher/sync. Each instance requires a trusted school,
campaign and nomination UUID. Each call processes at most one invitation or CRM
job. Both the global and kind-specific `enabled` values must explicitly be true.
There is no route, cron, environment loading or provider activity on import.

Invitations require three independent checks: no persistent local email
suppression, affirmative nominee-request evidence supplied by the operator's
adapter, and affirmative current provider permission/suppression status. Missing
adapters, unknown results and failures block dispatch. These checks run before
dispatch and again immediately before sending. A nominator's sharing checkbox
does not substitute for nominee-request evidence. Pre-dispatch refusal defers
the job for five minutes; a failure after dispatch starts stays uncertain and
must be reconciled, even when the local check prevented the actual send.

CRM preparation uses read-only exact email and phone matching. Missing or
conflicting contacts defer without provider mutation. Any contact creation must
first use the existing, separately reviewed durable contact-provisioning worker.
This runner does not grant marketing consent, clear DND, add tags or enroll
contacts into workflows. Queue claim and expired-dispatch recovery are both
restricted to the chosen scope and job kind.

## Verification

All 101 offline tests passed on 9 October, including six new bounded-worker
cases. JavaScript syntax and whitespace checks passed. Browser tests were not
rerun for this worker-only change; hosted evidence refers to the earlier artifact.

SQL-backed tests use an ephemeral PGlite database and fictional provider
transports. Coverage includes disabled gates, tenant/campaign/nomination bounds,
scoped expired-dispatch recovery, missing request evidence, provider refusal and
lookup failure, local suppression, a changed permission at dispatch, provider
timeout without replay, successful invitation receipts, exact-contact CRM
projection without duplicate writes, and missing-contact deferral. Existing
provisioning, privacy and queue tests remain part of the offline suite.

## Next controlled provider test

Before running against real providers, record the exact isolated database,
school/campaign/nomination, HTTPS origin, sender/reply-to, one operator-controlled
recipient, HighLevel location and matching fictional contact IDs. Require
`testOnly: true` and the exact `testRecipient` for the invitation rehearsal.
Supply reviewed request-evidence and provider suppression adapters; do not use
the unconditional test callbacks from the unit tests. Review provider receipts
and the resulting CRM object/associations before any further call. Acceptance
means accepted by the email provider, not delivered to the inbox.

Real-provider sending, contact creation, hosted scheduling and campaign-wide
activation remain off. Bounce/complaint ingestion, evidence adapters and the
separate launch/privacy gates still need operational completion before live
nominee invitations. This preparation changes no hosted configuration or data.
