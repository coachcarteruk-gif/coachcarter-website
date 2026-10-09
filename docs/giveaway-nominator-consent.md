# Nominator promotional consent — 9 October 2026

The nomination form has separate optional, unchecked email and SMS choices for
CoachCarter offers and future giveaways where the nominator can nominate someone.
These are the nominator's own choices. They neither grant nominee consent nor
affect entry or judging. Only boolean true grants consent; omitted/string values
do not. Existing records without this evidence remain unconsented.

The server records channel, grant, exact server-owned wording, version,
database timestamp and withdrawal timestamp in `nomination.nominator_consents`.
This uses existing JSONB storage, requiring no schema migration. Retries preserve
the original evidence. Role-separated identity exports include only that person's
consent and suppression records. Existing nomination erasure and campaign
retention cover this evidence; erasure vetoes both roles' marketing.

Nominators can email fraser@coachcarter.uk to withdraw. The authenticated review
page provides a staff control backed by POST `withdraw-marketing`, requiring
same-school admin authentication, exact-origin CSRF and an identity-verification
reference. The request is audited before mutation. It records email/phone vetoes
across matching nominations and both roles for the verified email, marks granted
evidence withdrawn and queues suppression work without deleting any application.
It remains available after entry closure. No public email lookup was added.

`mayMarket(school,id,channel,role)` defaults to the existing nominee role; the
explicit nominator role checks its own evidence. Persistent identity vetoes
override subsequent ticks, including repeat nominations and changed phone numbers
under a withdrawn email. This consent check is a prerequisite for any future
marketing sender, not a sender or provider-subscription activation.

External marketing-list suppression dispatch remains gated and unimplemented;
staff must honour queued opt-outs before sending via external lists. This change
does not clear HighLevel DND, subscribe contacts, send emails/texts or activate
campaign workers. Marketing activation and the campaign's retention/controller
decisions remain separate launch work.

Verification covers optional defaults, strict booleans, duplicate preservation,
role and tenant separation, export, repeated withdrawal, persistent vetoes,
admin/CSRF/audit boundaries, and the browser form through SQL storage and staff
withdrawal while preserving the application.
