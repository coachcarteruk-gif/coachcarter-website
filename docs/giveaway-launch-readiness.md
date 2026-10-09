# Lifelong Learner Pass: release assessment — 9 October 2026

**Public announcement already exists:** the owner has supplied the text of an
existing personal-account Facebook nomination post. Only the website is unlaunched.
The post did not promise randomness or state many of the draft entry restrictions.
Existing responses need fair treatment; do not impose the unpublished application
deadline/process or exclusions retrospectively. See the latest storage-document
entry before using the original pre-launch sequence below.

**Later owner direction:** a judged award now supersedes the random draw described
below. The random-draw procedure is historical preparation, not the release plan
for selection. Judging criteria, independent panel member and replacement-winner
handling remain unresolved; public draft copy now describes judged selection.
See [the current community-award proposal](giveaway-judged-award.md) and the
latest entry in `giveaway-storage.md`. Other release gates remain applicable.

Status: **not ready for public entry or invitation sending**. This is preparation,
not release authorization or a legal compliance certification. Continue on
`codex/giveaway-nomination-flow`; preserve the existing dirty implementation.
Later entries in [giveaway-storage.md](giveaway-storage.md) remain authoritative
for the owner's decisions. Website/Neon owns entries, consent and eligibility;
HighLevel is a CRM projection. No financial or booking entitlement changes.

Later technical update: local exact email/mobile contact matching now prepares
existing-contact plans before CRM dispatch. Missing/conflicting matches defer
without provider writes. This advances matching in the CRM row below; shared
new-contact provisioning and provider search compatibility verification remain
outstanding. See the latest `giveaway-storage.md` entry for tests and limitations.

## Settled campaign contract

- One winner receives the Lifelong Learner Pass free. Owner-set Pass price £2,000;
  no claim of previous sales, estimated retail value, cash balance or lesson cap.
- One free one-hour automatic lesson weekly until practical-test pass; 1.5 hours
  of test-day car use on every attempt. Learner pays DVSA bookings.
- Main-prize residence: exact outward districts RG1, RG2, RG5, RG6; age 17+,
  valid provisional licence, no driving disqualification. RG10 is not RG1.
  Out-of-area applications are allowed but cannot win the main prize.
- Theory pass and a practical test booked in Reading are required before lessons
  begin, not before applying. No story scoring or hidden shortlist.
- Close: 11 October 2026, 22:00 Europe/London / 21:00 UTC. Random draw and winner
  email plus phone contact: 12 October. Response period: 120 hours from notification.
  Fraser manually arranges a further random draw after non-response; no timer.
- At least 48 hours' learner cancellation notice; learner rollover discretionary;
  instructor-cancelled hours carried forward. Three late learner cancellations end
  free weekly lessons, not the whole prize.
- No runner-up prizes. Private offers need the corresponding marketing opt-in and
  current suppression checks. No marketing or messages authorized by this document.

## What the code and evidence actually establish

| Area | Implemented or separately evidenced | Still needed before the relevant release |
| --- | --- | --- |
| Public intake | `api/giveaway.js`, real SQL repository, exact origin/CSRF, rate limiting, tenant gates, encrypted invitation sessions, atomic application/consent | Hosted browser-to-Neon verification with runtime role, real HTTPS origin and final terms |
| Invitations | Injectable Resend adapter; durable acceptance receipt; one earlier authorized fictional delivered message | Production worker composition, invitation permission evidence, actual suppression callback, bounce/complaint handling and deployment proof |
| Queue | Claim leases, dispatch intent, persistence fencing, uncertain states | No deployed giveaway worker route or schedule found; no operator reconciliation interface; no safe automatic reset |
| CRM | Adapter and bounded fictional live compatibility test | Runtime contact mapping/provisioning: `crmHandler` accepts reviewed existing contacts only. Nomination-level journals cannot deduplicate creation of the same contact across entries |
| Privacy | Role-separated exports; shared learner deletion staging; persistent school/channel suppression; gated retention staging | Evidence-backed remote cleanup, non-account corrections/opt-outs procedure, provider suppression integration, approved retention disposition |
| Provider erasure | Disposable GHL object cleanup rehearsal preserved shared contacts | Not an integrated erasure worker. `eraseAfterProviderCleanup(..., true)` is a trusted internal argument, not verified evidence |
| Review/draw | Paginated admin API; closed-campaign review repaired in this audit | No production draw tool or eligibility register. Review returns nomination stories and applications; do not use those stories to select candidates |
| Eligibility | UI publishes postcode/age/licence rules; input accepts valid UK postcodes | No age/licence attestations or verification fields. Out-of-area acceptance is intentional. Final pool must use objective published rules |
| Duplicate entries | Unique submission key and nominee/nominator pair per campaign | Different nominators can create multiple completed records for one nominee. One chance per person is not implemented or yet agreed |
| Retention | `retain_until` required by schema; staging cancels pending work | Staging includes every nomination: no winner/fulfilment exemption. Do not enable until winner and evidence disposition is implemented and tested |

Historical evidence: isolated Neon 077/078 rehearsals and GHL/Resend receipts are
recorded in `giveaway-storage.md` and ignored `tmp/giveaway-*` files. They are not
fresh production verification. Do not replay the sends, cleanup scripts or journals.
The test branch expires 16 October 2026 at 08:00 UTC. No inherited PII is needed.

Local fixes in this audit: authenticated school-admin review remains accessible
when entries are disabled; unauthenticated and wrong-school review stay denied.
Invitations now link directly to the campaign privacy notice in text and HTML.
These changes do not establish lawful invitation permission or activate sending.

## Invitation basis and privacy preparation

The current branded invitation promotes a commercial Pass and a prize draw.
Treat it as potentially direct marketing; calling it an administrative invitation
does not settle its classification. The nominator checkbox records permission to
share contact details, not demonstrable nominee consent to this promotional email.
Do not assume the existing-customer soft opt-in applies to new nominees.

Recommended release condition: either retain invitations only after a documented
assessment and evidence of the nominee's specific request/permission for this
CoachCarter email, or redesign entry so the nominee initiates it directly. The
latter needs owner agreement and implementation. Asking nominators to forward a
promotional email is not an automatic workaround: instigated forwarding can also
fall within PECR. No such redesign or communication is activated here.

Prepare a legitimate-interests assessment covering purpose, necessity, expectations,
impact, safeguards and objections for campaign administration. Consent for future
email and SMS remains separate. Review whether mandatory employment, experience,
test details, full address and private stories are necessary for a random draw;
these must never influence chances. Minimise collection or document the distinct
purpose before approving the final privacy notice. Do not solicit health details.

For each of Neon, Vercel, Resend and HighLevel, the release packet needs the actual
account's processor agreement/version, processing region, subprocessor record,
transfer mechanism and assessment where applicable, deletion/log/backup periods,
access owner and evidence date. No account-specific safeguard is inferred from
a provider's marketing website. Store agreements and evidence privately.

Proposed retention for owner review: unsuccessful/incomplete campaign data removed
90 days after closing (9 January 2027 at 21:00 UTC), subject to a documented dispute
hold; minimum winner data separately retained through fulfilment and an approved
complaint period. Consent evidence and suppression need their own justified
period/review rule. Do not apply the 90-day nomination cascade to the winner or
delete opt-out evidence while still relying on it. Do not enable retention yet.

Non-account rights procedure: log a school-scoped case, verify control of the
relevant contact using proportionate evidence, then use authenticated staff tools.
A case-reference string is not identity verification by itself. Avoid unnecessary
ID copies. Corrections and email/phone changes need reviewed handling; present
matching uses the current email. A request by one party must not silently erase
the other party's answers. Do not send verification messages without authorization.

Cleanup evidence packet: case/school/nomination identifiers; verified subject and
scope; outstanding job dispositions; actual mapped provider IDs; operation intent;
provider terminal receipt; object/association absence readback; confirmation that
shared contacts and their operational communications were preserved; Resend message,
log and backup disposition; operator/date and approved residual retention.
Only then may the internal final-erasure call be considered. A 404 read alone does
not resolve an uncertain prior mutation. No blanket contact deletion or DND reset.

Sources checked 9 October 2026:
[ICO electronic mail guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/)
(including viral marketing; page notes guidance is under review), and
[ICO indirect collection guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/collect-information-and-generate-leads/).
The latter requires privacy information within the applicable timeframe, including
at first communication where earlier. The new email link supports transparency;
it does not cure unapproved notice content or missing permission.

## Proposed manual random-draw procedure

This procedure is a draft for approval, not executable selection automation.
Recommended arrangement: Fraser operates the draw in the presence of a named
independent observer, who checks the full pool and signs the record. This avoids
claiming that an unreviewed random-number script is independently verifiable.
[CAP rules 8.24 and 8.28](https://www.asa.org.uk/type/non_broadcast/code_section/08.html)
cover chance selection, entry restrictions and winner information.

1. Before opening, publish the entry limit, objective eligibility verification,
   award-information/publicity policy and any fulfilment restrictions. Freeze a
   dated terms copy. Proposed limit is one chance per person regardless of number
   of nominators; this requires approval, published wording and implementation.
2. After closing, take a read-only, school/campaign-scoped snapshot of every
   completed application submitted before `2026-10-11T21:00:00Z`. Keep the original
   snapshot private and hash its exact bytes. Reconcile every page/count. Never
   substitute the first 50 review results for the whole campaign.
3. Build an eligibility register with opaque entry IDs, objective checks and
   reasons for every exclusion or duplicate merge. Remove whitespace from a valid
   full UK postcode, then take everything before its final three characters to
   obtain the outward district; compare exact membership in RG1/RG2/RG5/RG6.
   RG10, RG20, RG50 and RG60 must fail. Theory/test-booking status, preferences,
   employment, story content and marketing choices are not draw filters.
4. Complete the approved checks consistently. Do not equate missing age/licence
   data with ineligibility or invent a retrospective condition. Resolve the
   verification method before entries open. Observer reconciles total completed =
   eligible chances + documented exclusions/duplicate records, with no silent loss.
5. Freeze the sorted opaque-ID pool and its SHA-256 digest before selecting. Keep
   personal details in a separate restricted mapping. Record operator, observer,
   UTC/UK time, pool count/digest and agreed random method. If using computer
   selection, use a uniform cryptographic random integer in `[0, count)` with no
   modulo bias, observed once; retain the raw index and receipt. A hash freezes
   the pool but does not by itself prove the draw was random. Stop if pool is empty.
6. Record the selected ID without rerunning for a preferred outcome. No story
   scoring, test-readiness filter, sales preference or discretionary shortlist.
   Use the approved objective verification/invalid-winner procedure if needed.
7. Fraser sends the authorized email and makes the authorized phone contact on
   12 October. Record both attempts and the notification timestamp used to begin
   the 120-hour period. Proposed convention: a confirmed email delivery timestamp,
   with a phone attempt recorded; resolve bounce/failure manually, not as silence.
   This convention still needs owner agreement in the final terms.
8. After 120 hours without a response, Fraser records that fact and manually
   authorizes a new draw from the remaining eligible pool. Preserve the old pool,
   receipt, reason for removal and new pool digest. Repeat the same observed method.
   No automatic timer, task, winner contact or redraw is added.

Recommended award information: make minimal surname/county evidence available on
request, tell entrants before entry and allow objections or reduced disclosure.
No compulsory filming or publicity. A public announcement on 12 October should
not expose an unverified winner; agree its wording and any delayed identification.

## Concrete release sequence and rollback

1. Resolve the owner decisions below and publish-ready terms/privacy copy locally.
   Keep DRAFT labels until approval. Do not silently shift the closing date if the
   preparation cannot finish; return to the owner before opening.
2. Prepare a scoped change set preserving unrelated dirty files, including restored
   historical migration sources. Reconcile with latest main and the live ledger
   at release time; no historical migration edits or aggregate migration endpoint.
3. Proposed runtime: existing Vercel website/API and an authenticated, bounded
   server worker calling `processOne`. Implement and test its composition first:
   trusted school/campaign scope, sender/sync gates, current suppression, existing
   CRM mappings or shared deduplicated provisioning, bounded execution, monitoring
   and operator handling of uncertain states. No worker route/schedule currently
   exists. Hosting choice need not become another owner questionnaire.
4. Use the existing canonical school HTTPS host as the proposed public origin;
   verify its actual value from release configuration. Align exact origin, tenant
   host, invitation URLs and authenticated review URL. No localhost links. Verify
   Vercel dependency bundling and database TLS/role grants, rather than relying on
   local SQL success. Keep encrypted keys server-only with access/recovery ownership.
5. With explicit deployment/migration authorization, apply only the approved 077/
   078 packet using the governed direct-connection runner after fingerprint and
   ledger checks. Seed reviewed campaign configuration disabled. Runtime uses the
   approved pooled URL. Confirm schema/grants and shared GDPR compatibility before
   enabling the API. Existing test-branch receipts are not production approval.
6. On an isolated hosted preview, verify nomination → captured invitation → HTTPS
   token exchange → application → consent → admin review/export → withdrawal →
   suppression → staged cleanup, including wrong-school, duplicates, deadline,
   disabled entries, failure/timeout and browser refresh. No live provider calls
   until separately authorized with named fictional recipients and bounded budgets.
7. If live GHL release is intended, prove source-to-provider consent/suppression,
   shared-contact preservation and cleanup with the actual composed worker. Retain
   the original pilot. Otherwise explicitly approve deferring CRM projection and
   leave its worker off; do not imply new entrants will sync automatically.
8. Release packet includes exact commit/files, migration plan, config diff, final
   copy, worker evidence, privacy disposition, monitoring owner and rollback steps.
   Request explicit release authorization only after these are reviewable. Enable
   API/campaign/invitations in the approved order. Marketing and retention remain
   separate releases; enabling entry does not authorize them.

Rollback/closure: stop worker dispatch and disable campaign entries at both school
and campaign gates. Keep the API available for existing opt-outs, authenticated
review and privacy actions. Preserve campaign key/origin and invitation encryption
key while those links are needed. Do not use the global API kill switch as ordinary
campaign closure. For a security incident requiring global shutdown, provide the
approved staffed privacy route. Quarantine dispatching/uncertain jobs; retain
receipts and submissions. Never replay them, delete migration ledger rows, drop
tables or restore an old database as routine rollback. Roll back compatible code
only after checking shared privacy hooks still work against the retained schema.

## Consolidated owner decisions

### Owner response — 9 October 2026

Confirmed one entry/chance per person regardless of the number of nominators.
Added this to the landing page, application page and terms. This is the agreed
draw rule; existing pair-level database deduplication still requires person-level
reconciliation before a draw and must not be described as full enforcement.

The owner supplied 39 Culver Lane, RG6 1DX as the correspondence address; added
to draft terms. Integrations are wanted rather than deferred. Continue reversible
integration preparation; this is not permission to send or activate providers.

The owner requested plain-language explanations of draw supervision, fulfilment
and invitation/privacy choices. Those choices are not approved by silence.
Keep the already agreed eligibility and lesson-start rules. Do not introduce
extra exclusions, a start-by deadline or prize limitations merely to fill a
checklist. The earlier list below is retained as audit context, not six unanswered
questions: entry limit, address and integration direction are now settled.

1. **Entry fairness:** approve one chance per person regardless of nominations;
   confirm any staff/family exclusions and the age/residence/licence verification
   method. Suggested approach: minimal eligibility declaration at application,
   documentary checks for the selected winner under published rules.
2. **Draw and award information:** name the independent observer; approve minimal
   award information on request with objections respected; settle the notification
   timestamp convention and the 12 October announcement before winner acceptance.
3. **Fulfilment:** confirm weekly scheduling/start arrangements and any genuine
   test-readiness/car-availability conditions, transfer/cash-alternative rules and
   how long the winner may take to meet lesson-start requirements. Do not add a cap.
4. **Promoter:** supply the correspondence address for Coach Carter Ltd.
5. **Invitation/data policy:** choose evidenced nominee-requested invitations or a
   direct-entry redesign; approve the administration assessment, necessary form
   fields and retention schedule, with a named privacy/provider-contract owner.
6. **CRM timing:** require CRM projection at entry launch (needs contact provisioning
   and end-to-end proof), or launch website intake with CRM/marketing deferred once
   the invitation and other release gates pass.

These decisions do not themselves authorize publishing, merges, production
migrations, provider mutations, sending, CRM activation or retention activation.

### Contact provisioning follow-up — 9 October 2026

Read-only HighLevel search compatibility is now verified using existing fictional
contacts and absent identifiers (six checks, zero mutations). Shared durable
contact provisioning is implemented locally, separately gated and not wired to a
live worker. Its journal protects retries across nominations and process restarts;
uncertain writes require reconciliation. Live creation/workflow/duplicate review,
shared-mapping privacy cleanup/export integration and hosted activation remain
release gates. See the latest storage-contract entry for the precise guarantees
and limitation concerning other provider writers.

### Workflow and privacy follow-up — 9 October

Current HighLevel inventory matches the earlier trigger review: ten published,
eight draft, all six marketing flows draft. Duplicate contacts are disabled;
matching preferences are Email then Phone. Settings were inspected, not changed.
Shared contact references are now included in role-scoped exports, and a local
object-cleanup worker has durable intent/readback safeguards. It preserves contacts
for separate privacy review. Production composition, full contact-erasure review,
terms/sender decisions and controlled activation remain governed by the release
packet; this follow-up did not activate any service.

## 9 October: current verification and release review package

Local production-page browser verification passed, including the two approved,
equally weighted answers and their separate administrator review. Both browser
journeys plus 95 offline tests passed. The four broken branding-script references
are fixed. See [the exact release review package](giveaway-release-package.md)
for evidence, file hashes, migration prerequisites, disabled configuration and
remaining launch gates. This supersedes older technical-status rows above where
those describe missing local components; it does not authorize public activation.
