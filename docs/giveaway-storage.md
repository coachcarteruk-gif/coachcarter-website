# Giveaway storage and queue — 9 October 2026

## Latest: real API and isolated Neon rehearsal

`api/giveaway.js` now connects the repository to the deployed-style runtime,
behind `GIVEAWAY_API_ENABLED=true` and school `config.giveaway.enabled=true`.
The school config supplies `campaign_key` and an exact trusted `origin`.
`POSTGRES_URL` and a dedicated 64-hex-character `GIVEAWAY_ENCRYPTION_KEY` are
server-only settings; none were configured in production. GET `config` supplies
the shared CSRF cookie. Nomination, invitation exchange, application and withdrawal
use POST JSON with exact-origin and shared CSRF checks. Invitation sessions are
encrypted, purpose/school-bound, Secure/HttpOnly/SameSite=Strict and expire after
12 hours. There is no fictional admin-login action in this API.

GET `review` uses existing school-admin auth and paginates 50 records at a time,
excluding token hashes, ciphertext and worker journals. POST `privacy-export`
and `request-erasure` require the same admin scope, CSRF and an identity-verification
case reference. The shared required audit logger records the authorized request
before action. These staff tools do not replace shared learner export/deletion/
retention integration or provider-cleanup verification; those remain launch gates.

Deployable draft pages are in `public/giveaway`. They use this API and the shared
cookie consent loader. PostHog exits before initialization on all giveaway paths.
The separate local SQL/API preview is at `http://127.0.0.1:61531/giveaway/index.html`;
it uses only fictional PGlite data and ephemeral encryption keys. Restarting it
resets its data and sessions. The original preview at port 61530 is unchanged.
`tools/giveaway/api-preview.cjs` is never a production server.

Migration reconciliation found that live 076 already names
`076_fraser_diary_preview_access.sql`. Its exact ledger-matching source was restored
from the handover; the existing 072 source also matches its ledger checksum. The
unapplied giveaway migration was renumbered **077**. Historical receipts were not
modified. The current manifest has 78 entries, including deferred 041.

Using the authoritative runner, 077 was applied only on new test branch
`codex-giveaway-api-20261009` / `br-twilight-term-abtld5ie` in project
`falling-firefly-48751671`. It is a normal production-derived branch; inherited
personal records were not queried or exported. Only fictional giveaway fixtures
were used. Compute suspends after five minutes; the branch expires 16 October
2026 at 08:00 UTC. The ignored `.env.giveaway-test.local` holds only its connection
string. The rehearsal script pins the test endpoint and refuses another host.

Evidence: 54 automated tests pass; governed migration checks pass. Independent
Neon connections submitted 12 duplicate nominations, 12 duplicate applications
and eight competing claims: exactly one nomination, two channel consent rows
and one winning claim resulted. No provider calls occurred. The browser separately
verified form submission, session exchange, application and withdrawal against
the real handler with local SQL. The initially missing Node request headers were
fixed and now have regression coverage. Live-role grants and a full browser-to-
Neon deployed preview are not yet verified.

The receipt is in ignored `tmp/giveaway-neon-rehearsal.json`; browser evidence is
in `tmp/giveaway-api-browser-proof.jpg`. Do not infer production rollout from
test-branch migration success.

## Earlier database package (superseded where noted above)

Implemented locally on `codex/giveaway-nomination-flow`. Migration 077 is additive,
registered in the manifest and initially not applied to Neon. No production campaign is seeded or
enabled. The current browser preview still uses its original local JSON store.

## Ownership and implementation

CoachCarter owns nominations, original application answers, deadlines, invitation
access and consent evidence. HighLevel receives the small CRM projection and
reviewed contact associations described in `tools/giveaway/README.md`.

`tools/giveaway/database.cjs` exposes an injected-transaction repository. Its
tagged, parameterized queries run with a `pg` Pool through `poolTransactions`,
or PGlite transactions in tests. Importing it does not load credentials or connect
to a database. Production handlers must inject the existing approved connection
and authorized school scope; this package does not add a new public endpoint.

Migration `077_giveaway_storage.sql` creates school-scoped campaigns, nominations,
channel consent records and jobs. Composite foreign keys prevent cross-school
associations. Submission keys and normalized nominee/nominator pairs are unique
per campaign. Nomination plus invitation/CRM jobs commit atomically. Application,
both consent decisions and the application CRM event also commit atomically.
Row locking makes repeated application submissions preserve the first answers.
Campaign opening and deadlines use the database clock, not browser input.

Invitation lookup stores SHA-256 of a random 256-bit token. Only the invitation
job contains recoverable token material, encrypted with AES-256-GCM and bound to
the school and nomination ID. A dedicated server-side 32-byte key is injected;
production key storage, rotation/versioning and operational recovery are required
before launch. Successful delivery acceptance clears the encrypted job payload.
No token or CRM journal is included in personal exports.

## Queue contract

`pending → claimed → dispatching → succeeded` is the normal path. Claims use
`FOR UPDATE SKIP LOCKED`, an opaque claim token and a two-minute lease. An expired
claim may be reclaimed only before dispatch starts. Expired dispatches and
ambiguous provider outcomes become `uncertain`; they cannot be auto-retried.
An uncertain job blocks newer jobs of the same kind for that nomination.

The worker must commit `beginDispatch` before the first provider side effect.
Only its claim token can persist progress or complete the job. An expired worker
cannot write CRM progress, preventing it from continuing to subsequent provider
writes after losing its lease. There is no lease heartbeat or uncertainty-reset
command. Configure bounded provider calls and stop on lost ownership. A late
success receipt may complete its original dispatch if no recovery has marked it
uncertain; it cannot complete a reclaimed claim.

`database-worker.cjs` bridges the tested CRM adapter to the persisted nomination
journal. Operation intents and receipts save through the claim fence. Production
contact provisioning is deliberately excluded: this bridge requires reviewed
existing contact IDs with matching email and phone. The earlier offline CRM
rehearsal can simulate new contacts, but per-nomination journals alone cannot
deduplicate contact creation across separate nominations. A shared provisioning
queue or reviewed existing mappings are required before accepting live entries.

Invitation and suppression jobs have injectable handlers. Neither a real email
sender nor a marketing enrolment handler is implemented or activated. Handlers
must explicitly return provider acceptance; arbitrary successful returns are
not treated as proof. Invitation acceptance queues a CRM status refresh and is
never called delivery. All normal sync calls load current source state rather
than putting private answers or stale application snapshots in queue payloads.

## Privacy and release boundaries

`exportForEmail` is for an already identity-verified request. A nominee receives
their own contact/application/consent data, excluding the nomination paragraph
and the nominator's contact details. A nominator receives their own contact,
paragraph, relationship and permission evidence, excluding applicant answers.

Authorized `requestErasure` blocks access, cancels pending/pre-dispatch jobs and
clears their encrypted payloads. Dispatching/uncertain jobs require reconciliation;
they cannot disappear while a provider write might be in progress. The final
local cascade requires confirmed external cleanup and no unresolved worker.
No automated provider cleanup or evidence-verification UI exists yet. The trusted
caller must verify evidence before setting that internal confirmation argument.
An erasure request affecting two people's nomination must be reviewed before
calling the whole-record erasure operation; it is not a self-service endpoint.

Retention uses an explicitly configured campaign `retain_until`, not a hardcoded
new policy. It marks due rows for the same cleanup process and never silently
drops the remote mappings. Winners/fulfilment and ongoing marketing evidence need
their own approved retention disposition before setting campaign retention.

Before activation: wire these operations to existing learner/admin export and
shared deletion/retention paths, including identity-verified non-account requests
and shared audit logging. Build a provider-cleanup/reconciliation process and
shared marketing suppression. Until those integrations are complete this remains
an isolated repository package, not production privacy coverage.

## Validation and deployment prerequisites

Run `node --test tools/giveaway/database.test.cjs` and `npm run migrations:check`.
The database tests execute the actual migration/queries in isolated PGlite
PostgreSQL, including fault-triggered transaction rollback, tenancy, duplicates,
claim fencing, uncertain writes, encryption, personal exports, retention and
erasure. The worker test runs nomination/application CRM updates through the SQL
journal and an injected fake transport. No live credentials or network writes
are used. PGlite serializes transactions; these tests do **not** establish races
between independent production connections.

Before requesting rollout approval:

1. Reconcile migration number/checksum with latest main and the live ledger.
2. Rehearse migration and independent-connection races on an isolated Neon branch;
   verify runtime-role grants. No grants or production migration were applied here.
3. Add the real authenticated API, feature gates, rate limits, CSRF checks,
   existing privacy hooks and transactional worker scheduling. Wire the preview UI
   only after those handlers exist; do not expose its fictional admin login.
4. Configure campaign terms, retention, trusted review URL and encryption key.
5. Verify HighLevel association IDs/direction, contact mappings, workflow effects
   and live write compatibility with a bounded approved test.
6. Implement/test invitations and shared suppression, then request launch approval.

No production migration, deployment, real contact creation, workflow enrolment or
message sending occurred in this implementation.

### Bounded live CRM verification — 9 October 2026

Subsequently, Fraser approved a fictional live HighLevel test. The adapter made
exactly six successful writes: two fictional DND contacts, one nomination, two
role-specific associations and one update of that nomination from
`awaiting_application` to `submitted`. API readback confirmed both DND flags,
the nominee/nominator identities and `invitation_status=suppressed`. The saved
record was also verified in the HighLevel UI. No message endpoint was called.

The ten published workflows were inspected before contact creation: six use
Service Booking triggers, three Order Submitted, and one the Free Trial Sign Up
form. The other eight workflows, including all six marketing workflows, were
drafts. No workflow configuration, enrolment, payment or booking was changed.
Both fictional email addresses and reserved test mobile numbers returned no
duplicate before creation.

Non-secret IDs and results are in
`tools/giveaway/highlevel-configuration.json`. The original operation journal,
provider receipts and screenshot remain in ignored `tmp/giveaway-live-pilot-*`
and `tmp/giveaway-highlevel-live-proof.jpg`; never reset or replay the pilot.
The test review URL is a local placeholder: this fixture is not present in the
preview database. This proves live adapter compatibility, not full website-to-CRM
deployment. Automatic sync and live sending remain disabled. Invitation delivery,
privacy/suppression integration, campaign terms and release approval remain gates.

### Invitation delivery — 9 October 2026

`tools/giveaway/invitation.cjs` implements a scoped Resend handler for the durable
worker. It checks school/campaign, open deadline, permission, application/erasure
state and a required trusted suppression callback before decrypting the link.
Only the nominee contact and nominator name enter the message. It sends both text
and escaped HTML, with the token in the URL fragment. Test mode restricts the
recipient and explicitly labels localhost links. Provider activation defaults off.

The worker persists the provider ID on acceptance and clears the encrypted token
payload. Acceptance is not inbox delivery. A failed/ambiguous dispatch remains
uncertain and is never automatically retried; the provider's 24-hour idempotency
key adds protection but does not release that gate. Pre-send validation failures
also stay held for operator review in this conservative version.

All 57 focused tests passed, including real SQL nomination -> captured invitation
-> application, receipt persistence, repeat suppression, provider timeout and
cross-school/closed/completed/suppressed rejection. A separately authorized single
fictional email was then sent using the existing CoachCarter Resend credential.
Provider ID `01a11fbd-7a7d-7603-9e3d-1a009e3c8d85` was reported `delivered` at
08:18 UTC. Private recipient/receipt evidence is in ignored
`tmp/giveaway-mail-live-receipt.json` and `tmp/giveaway-mail-delivery.json`.
Do not reset or replay that send. The email uses the current local preview link;
it is not a deployed public application link. No cron, public sending or automatic
CRM sync was activated. Shared suppression/privacy integration and launch gates
remain outstanding.

### Shared privacy integration — 9 October 2026

Migration 078 adds school/channel-scoped giveaway marketing suppression hashes.
Withdrawals persist both channels atomically with the consent withdrawal/outbox.
`mayMarket` requires positive consent, no erasure request and no suppression.
New nominations cannot remove an opt-out; suppression survives nomination deletion.
Hashes remain pseudonymous personal data, with retention/purpose approval pending.
This is the giveaway marketing boundary, not account-wide GHL DND.

`api/_giveaway-privacy.js` connects role-separated data to learner exports. All
three shared learner deletion callers now stage matching same-school giveaway
records, suppress the verified subject and cancel queued jobs in the existing
atomic transaction before deleting the learner. Original financial operations
retain their order. Provider mappings and unresolved work remain for cleanup.
Matching uses current verified email; historical contact changes need staff review.
The school-admin `privacy-queue` endpoint exposes paginated pending case references
without contact details/tokens. No public hard-delete endpoint was added.

Retention stages expired campaign records only with the independent
`GIVEAWAY_RETENTION_ENABLED=true` gate (default off), using configured `retain_until`.
Disabling campaign entries preserves existing-applicant opt-out and admin privacy
actions; the API service itself must remain available after campaign closure.

Validation: 61 focused tests across database/API/domain/CRM, including suppression
across submissions/deletion, tenancy, safe exports, shared-cascade rollback and
closed-campaign opt-out. The 79-entry migration manifest passes. Migration 078
subsequently passed the isolated Neon rehearsal described below. No production
migration, new email, deployment or sender/cron activation occurred.

Remaining gates: require `mayMarket`
immediately before every future giveaway marketing send; prove scoped GHL
suppression/cleanup that preserves shared contacts and operational communications;
resolve uncertain provider work before final erasure. The internal boolean
cleanup-confirmation argument is not proof by itself. Final privacy wording,
identity verification, retention and campaign terms still require owner approval.
This is draft implementation, not production-complete privacy coverage.


### Privacy and cleanup rehearsal — 9 October 2026

`tools/giveaway/neon-privacy-rehearsal.cjs` applied 078 through the governed runner
only to `br-twilight-term-abtld5ie`. Eight concurrent opt-outs passed; both
channels were suppressed, wrong-school export was empty, private answers and
tokens were excluded, queued jobs were cancelled and the no-provider fixture
was erased while suppression survived. No provider request was made. Receipt:
ignored `tmp/giveaway-neon-privacy-rehearsal.json`. Production was not changed.

A separate disposable HighLevel nomination and two associations were created
against the existing fictional DND contacts. The first DELETE was explicitly
rejected with HTTP 422 (`property locationId should not exist`). This validation
receipt was resolved by one corrected DELETE without the query parameter,
which returned 200 with `success:true`. Readback confirmed 404 for that record,
zero relations, both original contacts present with DND unchanged, and the
original pilot nomination intact. The correction is not a policy for replaying
ambiguous timeouts. See ignored `tmp/giveaway-cleanup-rehearsal.json` and
`tmp/giveaway-cleanup-correction.json`; never replay these mutation scripts.
The [official delete endpoint](https://marketplace.gohighlevel.com/docs/ghl/objects/delete-object-record/)
accepts schema key and record ID, unlike GET which uses a location query.

This proves bounded object cleanup compatibility, not an automated erasure or
marketing dispatcher. Shared-contact suppression integration, evidence-based
operator cleanup, retention choices and release gates remain outstanding.

### Campaign wording review — 9 October 2026

Owner confirmed one-hour weekly lessons, Reading residency, age 17+, provisional
licence with no driving disqualification, learner-paid test bookings and 1.5 hours
of test-day car use. Added these to the landing page and `public/giveaway/terms.html`.
Selection method/date, response period, exact service boundary, lesson scheduling,
promoter address remain visibly marked for review.
Privacy draft links the existing controller/contact policy and explains storage,
optional consent, withdrawal and non-account rights requests. Proposed lawful
bases, indirect invitation rules, provider transfer safeguards and retention
remain unapproved; the draft must not be treated as launch-ready.

References reviewed: [CAP promotional rules](https://www.asa.org.uk/type/non_broadcast/code_section/08.html),
[ICO collecting information and leads](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/collect-information-and-generate-leads/),
and [ICO consent](https://ico.org.uk/consent).


### Lesson-start condition confirmed — 9 October 2026

The owner confirmed that the selected winner must have passed their theory test
and booked a practical driving test in Reading before free weekly lessons start.
CoachCarter can advise on completing these steps. This is a lesson-start condition,
not a requirement to have completed both steps when nominated or applying.
The included 1.5 hours of test-day car use covers every attempt; the learner pays
for test bookings. Updated the landing page, application guidance and draft terms.
No new booking validation, prize activation or live eligibility decision was added.


### Giveaway cancellation terms confirmed — 9 October 2026

Learner cancellations require at least 48 hours before the lesson start. Whether
to carry a learner-cancelled lesson into a future week is the instructor's
discretion. Instructor-cancelled hours are carried forward into future lessons.
On the third learner cancellation with less than 48 hours' notice during the
prize, entitlement to the remaining giveaway ends. Instructor cancellations do
not count. Exactly 48 hours meets the notice requirement.

Added the full terms and a visible summary beside the prize details on the landing
and application pages. This is campaign copy only: no ordinary booking policy,
financial ledger, cancellation counter or automated forfeiture was changed.


### Selection method confirmed — 9 October 2026

Fraser will review the applications and choose the nominee he considers most
appropriate. Recorded in the draft terms. Specific judging criteria, independent
judging arrangements, selection/contact date and response period remain open.
No winner was selected or contacted.


### Prize eligibility and selection revision — 9 October 2026

Main-prize residence is now restricted to exact outward postcode districts RG1,
RG2, RG5 and RG6. Other districts remain able to submit for planned runner-up
prizes. No backend submission exclusion was added. Runner-up prize quantities,
descriptions, other eligibility rules and selection method remain unconfirmed.
Main-prize lesson-start and cancellation conditions are labelled separately.

Owner is considering a random draw with a private filter. Removed the superseded
subjective-selection commitment and left random selection from all published-rule
eligible entries as a proposal only. No undisclosed shortlist or draw implemented.
CAP 8.17 requires significant eligibility conditions; 8.24 requires chance-based
selection with verifiable randomness or independent supervision. Resolve method,
all entry criteria and prize details before launch.
Reference: https://www.asa.org.uk/type/non_broadcast/code_section/08.html


### Final selection direction — 9 October 2026

Owner chose application review and selection of one eligible main-prize winner,
superseding the proposed random draw. Updated landing, application and terms copy.
No hidden filter or random selection promise is implemented. Judging criteria,
independent judging arrangements (CAP 8.26), selection/contact dates and runner-up
prize details remain to be confirmed before launch.


### Random main-prize draw confirmed — 9 October 2026

Owner supersedes application-review selection with a random draw from all eligible
completed applications received by the deadline. Exact outward postcode districts
RG1, RG2, RG5 and RG6 are published main-prize eligibility conditions; no subjective
story scoring or hidden shortlist. Other districts may apply for planned runner-up
prizes. Updated landing, application and terms. Draw date, verifiable randomness
arrangements, notification/response period and runner-up details remain open.
This changes draft copy only; no draw was run or selection automation activated.


### Draw date and promotional offers clarified — 9 October 2026

Owner confirms main-prize draw and private winner contact on Monday 12 October
2026. Earlier runner-up prizes were clarified as private promotional offers to
nominees. Removed runner-up prize promises from landing/application/terms and
kept out-of-area submissions possible with explicit main-prize ineligibility.
The offer itself is not advertised or invented. No messages were sent or scheduled.

Electronic promotional offers must respect the existing optional channel-specific
marketing consent and suppression checks; nomination/invitation permission is
not marketing permission. Do not enrol every nominee, bypass mayMarket, or attach
promotions to operational result notices sent to non-consenting recipients.
Provider sending remains disabled. The offer content/channel, winner contact
method/response deadline and verifiable draw arrangements remain unconfirmed.
Reference: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/


### Weekly-lesson cancellation scope clarified — 9 October 2026

Owner clarified cancellation wording refers to regular weekly lessons rather
than the main prize itself. Landing/application/terms now describe weekly-lesson
cancellations and ending free weekly lessons after three late cancellations.
Removed whole-prize forfeiture wording. No general paid-lesson policy, test-day
car-use term or runtime booking/eligibility logic was changed.


### Nominee page title and value — 9 October 2026

Owner requested “Lifelong Learner Pass” Giveaway and retail value £2,000 on the
nominee application hero. Added title and value badge; kept the one-hour weekly
lessons-until-practical-pass description directly below. This is a campaign name,
not a new lifetime entitlement or £2,000 benefit cap. The owner-supplied retail
valuation requires supporting calculation before publication; none was invented.
No checkout, pricing configuration, prize scope or backend behavior changed.


### Nominee page structure — 9 October 2026

Reordered the application introduction: branded Pass hero and requested nomination
subtitle, potential everyday benefits, three concrete inclusions, eligibility and
dates, then the unchanged application form. Uses site brand orange #f58321 on a
dark hero for contrast. Immediate chance-to-win clarification accompanies the
nomination wording. Weekly cancellation detail uses an expandable section before
the form; conditions remain in full terms. No new prize promises or form fields.
Owner-supplied £2,000 valuation still awaits supporting calculation before launch.


### Nominee copy and logo refinements — 9 October 2026

Personalised invitation now names the first Lifelong Learner Pass. Test-day
benefit explicitly says learner pays test bookings with DVSA. Removed vague
marketing phrase from postcode guidance and clarified beside opt-ins that emails
and texts are not required to enter and do not affect chances. Consent handling
is unchanged. Reused existing public/Logo.png in the nominee page header.


### Application navigation — 9 October 2026

Renamed nominee date label to “Draw and Winner Announcement”. Added fixed Start
Application CTA, shown only while an application form is available. Click scrolls
to form and moves keyboard focus to its heading, respecting reduced motion.
Bottom spacing protects form/footer content. No winner publicity or sending was
activated; this is a label/navigation update.


### Application CTA becomes heading — 9 October 2026

As the form heading reaches the reading area, the floating CTA transitions into
the Start Application heading. Natural scroll and button scroll share the same
threshold. The bar becomes inert/hidden from assistive technology while docked,
returns above the form, and respects reduced motion. Existing success/error
visibility gates remain. No submission or API behavior changed.


### Winner response period — 9 October 2026

Owner confirmed five days to respond. Terms specify five calendar days (120 hours)
from winner notification; landing and application summaries include the window.
Contact remains planned for Monday 12 October. No exact notification time or
automatic forfeiture/redraw rule was invented; non-response handling remains
marked for confirmation. No contact or scheduling action performed.


### Non-response redraw handled manually — 9 October 2026

Owner confirmed another random draw from remaining eligible applicants after
five days without a winner response, explicitly managed manually by Fraser.
Added the outcome to draft terms and removed the unresolved non-response item.
Do not implement an automatic timer, forfeiture, redraw, task or notification.
No runtime changes or external actions were made.


### Campaign consistency and valuation — 9 October 2026

Owner approved nomination-page and email alignment with Lifelong Learner Pass.
Updated nomination hero/logo/benefit copy, invitation subject and HTML/text copy;
kept sender gates and idempotency unchanged. Winner contact confirmed by email
and phone. £2,000 is now explicitly an estimate: 24 hours (£1,320) plus an assumed
12 additional hours (£660) = £1,980, rounded. This is an owner planning estimate,
not measured average outcomes, a fixed retail price or a 36-hour/£2,000 prize cap.
Test-day car use is additional to the lesson-based calculation. Terms state the
basis and variability. No new email sent, provider activated or public deployment.


### Fixed Pass price clarification — 9 October 2026

Owner clarified £2,000 is the chosen selling price for the Lifelong Learner Pass,
not an estimated lesson value. Supersedes the previous valuation interpretation.
Changed both page badges, terms and invitation to Pass price £2,000 and removed
the 36-hour calculation from customer copy. Winner receives the Pass free; no
cash balance or lesson cap introduced. This is campaign copy only, not checkout
creation, pricing configuration, a claim of previous sales or product activation.

### Launch-readiness audit — 9 October 2026

Prepared [the release assessment, manual draw proposal and owner decisions](giveaway-launch-readiness.md).
The implementation is not launch-ready: worker hosting/composition, invitation
permission evidence, CRM contact provisioning, integrated provider cleanup and
winner-aware retention remain distinct gaps. Pair-level deduplication does not
implement one chance per person; age/licence verification is not captured yet.
The draft does not reopen settled price, prize, selection or cancellation choices.

Fixed admin review being blocked by the school campaign's entry-disable gate.
Authenticated same-school review now survives closure; anonymous/wrong-school
access stays denied and new entry remains disabled. Added direct campaign privacy
links to both invitation formats. Sending remains disabled; no message was resent.
These links do not settle the invitation's lawful basis or approve the draft notice.

Validation: all 30 database/API tests passed, including closed-campaign admin
review boundaries and captured invitation privacy links. No preview restarted,
production migration, provider mutation, activation, commit or merge performed.

### Judged award direction confirmed — 9 October 2026

Owner now confirms that a judged award better matches the intention to read the
applications and choose the most deserving nominee. This supersedes the earlier
random-draw direction. Owner asks why independent judging is required; no judge,
judging criteria or replacement-winner procedure has yet been agreed. CAP 8.26
requires an independent judge or a panel including an independent member for
subjective selection. Fraser may participate in that panel. This requirement is
structural, not a finding that Fraser is biased.

The existing public draft pages/email and launch-readiness random-draw procedure
still need alignment after judging arrangements are settled; do not publish them
as the current selection promise. Do not carry the old random redraw into a judged
award without resolving replacement selection. No selection or external action.

### Existing Facebook nomination post disclosed — 9 October 2026

Owner reports the promotion has already started via a post from his personal
Facebook account in a local residential group. The supplied text invites people
to tag someone who could benefit, asks them not to disclose private circumstances
in comments, says Fraser will message the nominator, leaves the post open until
Sunday 11 October, and offers the nominated person one free one-hour lesson each
week until practical-test pass. This is user-supplied evidence; the live post and
comments have not been inspected and no one has been contacted by this agent.

The supplied post does not promise randomness, specify judging criteria, clearly
state one recipient, specify 22:00 closing, require a separate completed application
or state the later postcode/licence/lesson-start/cancellation conditions. Do not
assume existing respondents agreed to the unpublished website terms. The earlier
claim that nothing has launched was incorrect: only the website/API remain draft.
Do not retrospectively exclude existing nominations or silently move them to a
new entry process. Preserve the original announcement and assess how clarification
and fair handling of existing responses can work before publishing any revision.

A personal account alone does not establish exemption from CAP; own-service
promotions can be within remit. Assess the actual business/promotional connection
without presenting it as a settled legal classification of this particular post.
The owner-approved judged direction remains; no external clarification posted.

### Judged community award preparation and local area — 9 October 2026

Prepared `giveaway-judged-award.md`: two proposed judging questions (benefit to
everyday life and barriers to learning), genuine independent participation,
manual ranked-reserve proposal, Facebook clarification and private follow-up
drafts. Owner has not yet approved the detailed criteria or reserve procedure.
Public website/email drafts now remove random-selection promises, preserve the
prize and clearly leave judging arrangements unfinished. No draw automation.

Owner confirms no respondents have yet been told the postcode restriction or a
Sunday application requirement. Original post was in an Earley residents' group;
RG1/RG2/RG5 were included alongside RG6 to cover surrounding areas. Owner requires
protection against distant nominees. Retain the exact local service boundary and
explain it promptly and prominently; group membership is not residence evidence.
No nationwide entitlement or additional prize is agreed. Existing out-of-area
nominations need a direct, fair explanation rather than silent rejection.

Sunday nomination closing and Sunday 22:00 completed-application closing remain
different. Backend cutoff unchanged; resolving a fair follow-up opportunity before
release remains necessary. No post edited, message sent, preview restarted,
production configuration changed or provider activated.

### Monday review timing clarified — 9 October 2026

Owner agrees with honouring timely nominations and reasonable opportunity to
complete submissions, and clarifies that when submissions are in by the deadline,
he intends to review them by the end of Monday 12 October. Retain Monday as the
intended selection day; do not assume an extension is necessary. Any missed
follow-up opportunity must be resolved fairly. This does not approve an earlier
Facebook nomination cutoff, a new application deadline or sole-judge arrangements.
Backend deadlines and external communications unchanged.

### Judging criteria approved; review preference — 9 October 2026

Owner approves the two equally weighted criteria: difference driving would make
to everyday life, and barriers the free lessons could help overcome. He prefers
to review applications himself because of time constraints. Initial reading by
Fraser is compatible with preparing assessments, but no independent panel member
or compliant final judging arrangement has been agreed. Do not describe the time
constraint as an exemption from CAP 8.26 or claim that sole judging has been
verified as compliant. No new submission access, selection, sending or activation.

### Agreed criteria, private review and integration visibility — 9 October 2026

Both public pages, terms and invitation now state the two equally weighted
criteria. The existing story field prompts for both benefit and barriers in one
answer, with plain-language/sensitive-data guidance. No schema or new PII field.

The school-admin review page now leads with the nomination and applicant stories;
secondary contact/details remain expandable, with no automatic score or selection.
It counts loaded records, warns when pages remain, and distinguishes records from
people. It still requires manual person-level reconciliation and final judging.

New GET `/api/giveaway?action=integration-status` returns aggregate job-kind/state
counts for the authenticated school and configured campaign only. It stays
available after entry closure. Expired dispatches display as uncertain without
changing persisted state. Counts include erasure-pending work, expose no contacts,
tokens or journals, and do not prove worker activation or email delivery. The
review page shows these counts on demand; no retry/reset/activation controls.

Validation: 10 API tests passed, including school/campaign isolation, anonymous
and wrong-school rejection, GET-only access, closed entries and read-only expired
dispatch reporting; the captured invitation SQL test passed separately. Syntax
and diff checks passed. CUA could not connect to the separate local fictional
review fixture (connection timeout), so visual/browser interaction verification
is outstanding. The temporary fixture server was stopped; the original SQL/API
and invitation previews were not restarted or modified in memory.

CRM code review confirms reviewed existing contact IDs are still required by the
persistent worker. Shared new-contact provisioning, runtime hosting, provider
suppression/cleanup and end-to-end activation evidence are not solved by this
read-only status view. No provider request, send, migration or activation occurred.

### CRM exact-contact matching — 9 October 2026

Implemented `tools/giveaway/contact-matching.cjs`. Each nominee and nominator is
matched by two exact lookups: email and normalized UK mobile. Both must uniquely
identify the same provider contact in the trusted school/location/campaign scope.
Shared details, different counterpart identifiers, multiple results, partial pages,
invalid responses and wrong-location contacts fail closed. Repeated nominations
reuse an existing contact ID; name similarity never determines a match. Search
results are not retained and unrelated returned PII is discarded. No new schema.

The dedicated search transport defaults disabled and supports only the fixed GHL
`POST /contacts/search` read endpoint, bounded exact queries and sanitized failures.
It never calls upsert, contact creation, profile mutation, messages or workflows.
The current GHL v3 exact lookup documentation describes an OAuth-only endpoint;
it is not assumed compatible with this project's private integration credential.
The legacy official contact OpenAPI specifies 2021-07-28 for search but does not
fully specify filter/response properties. The implemented `eq` filters and numeric
`total` contract are therefore explicitly subject to approved provider rehearsal;
malformed/unsupported responses stop the match. No live lookup occurred here.
Sources reviewed: [search endpoint](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/index.html),
[official OpenAPI](https://github.com/GoHighLevel/highlevel-api-docs/blob/main/apps/contacts.json),
[v3 lookup](https://marketplace.gohighlevel.com/docs/ghl/contacts/lookup-contact/index.html).

`crmHandler.prepare` obtains existing-contact plans while the durable job is only
claimed. Preparation is required to be read-only. `loadClaim` checks school,
token, lease and erasure state. `deferClaim` can return only its own unexpired
pre-dispatch claim to pending with a five-minute delay; it cannot touch dispatched,
uncertain, cancelled, foreign or stale-token work. A no-match or search failure
returns a sanitized deferred reason instead of falsely indicating an ambiguous
provider mutation. Once dispatch starts, the original uncertainty/journal rules
apply. Current identities are revalidated by the existing CRM adapter before writes.
Erasure during matching prevents dispatch. Missing contacts still require reviewed
provisioning; automatic contact creation has not been added or enabled.

Validation: 48 matcher/database/CRM tests passed, followed by four targeted SQL
checks including three new preflight/deferral/erasure cases (51 distinct tests
across these suites). Syntax and diff checks passed. Matching remained fictional;
no provider calls, migrations, live configuration changes or preview restarts.

## 9 October: verified search and durable contact provisioning

This entry supersedes the preceding local-only search compatibility caveat.
A bounded live read-only rehearsal verified both email and phone searches for
two existing fictional contacts, plus two absent identifiers (six successful
checks, zero provider mutations). The ignored local receipt is
`tmp/giveaway-contact-search-verification.json`.

`contact-provisioning.cjs` now implements a separately gated, trusted-server
provisioning step before read-only CRM preparation. Same-school/location identity
reservations are shared across nominations/campaigns in existing
`crm_state.contact_provisioning`; short school-row locks serialize changes without
holding a transaction during network calls. Identity/channel hashes, contact IDs,
requesting nomination ID, claim token, review reference and timestamps are stored;
raw names/email/phone are not copied into this ledger. Hashes remain personal data.
An unexpired claim blocks competing workers. Expired pre-dispatch claims can be
reclaimed with a new token; persisted dispatch or uncertainty blocks retries
across nominations and process restarts. Successful creation is revalidated with
fresh exact searches before reuse. Existing contacts are never modified.

Normal CRM saves preserve provisioning evidence. Erasure before dispatch stops
creation. A late successful receipt is retained for provider cleanup. Final local
erasure rejects unresolved provisioning on either the anchor or requesting
nomination. Provider cleanup must inspect shared identity mappings across all
same-school nominations, preserve unrelated CRM records, and settle uncertainty
before deleting an anchor. Automated provider cleanup/reconciliation is still a
release prerequisite; there is deliberately no uncertainty-reset command.

Creation defaults disabled; no production endpoint/scheduler wiring was added.
The trusted creationApproved and reviewReference inputs record a caller's review;
they do not replace workflow/duplicate-setting review. Reservations coordinate
our own workers, not other provider writers, so no provider-wide exactly-once
guarantee is claimed. No migration, live contact creation, workflow change,
message send or preview restart was performed in this follow-up.

Validation for this follow-up: all 71 tests across contact provisioning, exact
matching, database/worker, CRM adapter and real API-handler suites passed. The ten
provisioning tests include duplicate/restarted callers, existing-contact reuse,
lost responses/receipts, identity conflicts, disabled/scope/erasure gates, stale
claim fencing, shared-requester erasure, late receipts and preservation during CRM
journal saves. These use fictional provider adapters and local PGlite; they do
not establish real-provider creation behaviour or independent-connection race
behaviour. Syntax and tracked diff whitespace checks passed. Browser QA was not
rerun and existing previews were left running.

## 9 October: workflow review and privacy cleanup integration

Live read-only UI inspection reconfirmed the same ten published workflows, last
updated 25/26 September, and eight drafts; all six marketing workflows are drafts.
This is an inventory/date recheck against the earlier same-day trigger inspection,
not a new audit of every action. Business Profile shows Allow Duplicate Contact
OFF, with Email first and Phone second. No settings/workflows were changed.
The giveaway adapter does not apply tags, submit those forms or enrol workflows.
These settings do not replace the journal's uncertainty protections.

`privacy-references.cjs` now adds `provider_contacts` to each role's existing
identity-verified export. It finds same-school mappings across nominations using
both normalized identifiers, including a mapping anchored on another nomination.
Only provider/location/contact references are exported, never reservation tokens,
review references or another person's identity. Existing learner export reuses
this repository path; no new public route was added.

`provider-cleanup.cjs` implements disabled-by-default, server-only cleanup with
`createCleanupStore({transaction,config})`, `createCleanupTransport(...)` and
`createCleanupWorker({store,transport,enabled})`. The caller supplies trusted
school/location/campaign/environment scope and a nomination already marked for
erasure. The store rejects unresolved jobs/provisioning and derives the record ID
from its scoped journal. The worker checks the provider's exact location and
nomination reference before recording a durable intent and deleting only that
custom object. Its DELETE transport cannot target contacts. Successful deletion
requires a readback 404. Failed/ambiguous results remain uncertain; later runs may
only read to establish absence, never repeat DELETE. Intent/receipt persistence
uses the existing nomination journal, with no new migration.

Normal CRM saves preserve `provider_cleanup`. Final local erasure now requires
verified absence for a journalled provider record and refuses unfinished cleanup.
The existing explicit cleanup-confirmation argument is still required: an object
removal does NOT settle the person's wider CRM/contact erasure request. Returned
`contacts_to_preserve` references require a separate identity-verified review of
shared customer history and retention. This worker intentionally cannot delete
whole contacts or alter DND. No automatic contact deletion, retention scheduling,
production route, live activation or message sending was introduced.

The new HTTP reader was verified against the original fictional pilot and the
previously deleted disposable record: matching ID/location/reference and 404 for
the deleted fixture, zero provider mutations. Receipt:
`tmp/giveaway-cleanup-read-verification.json` (ignored). Provider DELETE shape
continues to use the earlier bounded rehearsal; no deletion was repeated today
in this follow-up.

Validation: 50 tests passed across API, database, provisioning/export and cleanup
suites, followed by all seven cleanup tests including two additional concurrency
and persistence/readback-failure checks (52 distinct tests this follow-up).
PGlite and fictional transports were used for mutation tests; this is not an
independent-connection production race test. Syntax and diff checks passed.
The live transport check made two read requests and no mutations. No production
migration, deployment, invitation, contact creation/deletion or preview restart.

## 9 October: separate judging questions

The nominee form now asks two required questions: the difference driving would
make to everyday life, and the barriers free lessons would help overcome. Both
have a 3,000-character limit and equal weighting. `meaning` retains the first
answer; `barriers` holds the second. The shared server validator requires both
for new submissions. Existing completed applications are not rewritten or
revalidated; review labels a missing historical `barriers` field as the earlier
combined answer. Production draft and fictional form/review sources are updated.

Both answers stay in the existing application JSON, so nominee export and staged
erasure/retention cover them without a schema migration. Nominator exports do not
include the applicant's answers. CRM projection remains unchanged and excludes
both narrative answers. No production deployment or preview restart performed.

## 9 October: final local browser check and review package

The production draft journey now passes against the real handler and isolated
PGlite: nomination, private invitation exchange, two separate answers, persisted
confirmation and authenticated administrator review. Historical combined answers
keep their original value and label. The check enforces the repository CSP,
checks 320px overflow, asset failures and external requests, and uses no providers.
Fixed the missing branding script reference on four draft pages.

Both browser journeys and 95 offline tests passed (97 total). Migration manifest
and syntax/whitespace checks passed. Hosted HTTPS/Neon/login and provider delivery
remain unverified. See giveaway-release-package.md and its exact hash manifest
for the local review bundle, config proposal, operational gates and rollback.
No production migration, deployment, invitation, integration activation or live
record mutation occurred. Existing previews and uncommitted work were preserved.
