# Giveaway morning review — 9 October 2026

## Status

Latest contact matching: `contact-matching.cjs` performs separately gated,
read-only email and mobile searches. It emits an existing-contact plan only when
both exact lookups uniquely identify the same location-scoped contact. Missing,
ambiguous or conflicting contacts do not authorize creation. CRM preparation now
runs before dispatch; lookup failures defer a live claim for five minutes without
resetting uncertain writes. The bounded live read-only search rehearsal passed on 9 October; runtime
activation remains disabled. See the latest storage-contract entry.

Server composition (trusted configuration/dependencies only; no environment is
loaded by these modules):

```js
const { createContactMatcher, createContactSearch } = require('./contact-matching.cjs');
const search = createContactSearch({
  apiKey, locationId: config.locationId, enabled: matchingEnabled,
});
const plansFor = createContactMatcher({config, search, enabled: matchingEnabled});
const handler = crmHandler({config, transport, plansFor});
// processOne({db, schoolId:config.schoolId, kind:'crm', handler, enabled:syncEnabled})
```

`plansFor` must be read-only: no upsert, creation, DND change, workflow enrolment
or contact mutation. Do not give it a mutation-capable provider client. Existing
operator-supplied mappings remain supported; dispatch still rechecks contacts.
Observe `deferred` result reasons (`contact_not_found`, `contact_multiple_matches`,
`contact_identity_conflict`, `contact_lookup_failed`, `contact_matching_disabled`)
in a sanitized operator log when hosting is implemented. Neither missing contacts
nor an empty search result is approval for creation. New-contact provisioning now has a separate durable implementation below;
its live release remains gated.

Latest API follow-up: real, disabled-by-default `api/giveaway.js` and draft pages
in `public/giveaway` are implemented. The new fictional SQL/API preview runs at
`http://127.0.0.1:61531/giveaway/index.html`; the original 61530 preview is unchanged.
54 automated checks and independent-connection races on an isolated Neon branch
passed. Giveaway migration is now 077 because 076 already belonged to diary
access. No production settings, provider sends or live CRM records changed.
See [current evidence and remaining gates](../../docs/giveaway-storage.md).
See the [9 October launch assessment and manual draw proposal](../../docs/giveaway-launch-readiness.md)
for current blockers, release/rollback sequencing and consolidated owner decisions.

9 October HighLevel follow-up: created the empty Giveaway Nominations custom
object, unique Nomination Reference, five additional review fields and separate
Nominee/Nominator contact associations in the Coach Carter Driving School
account. See `highlevel-configuration.json` for exact observed keys and limits.
No contacts or nominations were uploaded, no workflows were changed, and no
messages were sent. The separate CoachCarter Giveaway CRM integration was created
after explicit approval. A read-only API check verified the correct account,
nomination object and all six fields. Its credential is stored in the ignored
local .env.giveaway.local file; live sync remains disabled.
The preview still saves only locally. The CRM adapter and offline rehearsal are
now implemented (see below). The PostgreSQL repository, migration and durable
worker are also implemented locally; see [storage contract](../../docs/giveaway-storage.md).
Production route/privacy integration, consent suppression and live provider
compatibility testing remain outstanding. The browser preview is not switched over.

## Shared contact provisioning (local implementation)

`contact-provisioning.cjs` runs separately before CRM preparation. Compose
`createProvisioningStore({transaction})` with the existing database transaction
adapter, then `createContactProvisioner({config, store, search, transport,
enabled, creationApproved, reviewReference})`. Invoke with `{nominationId, role}`;
only trusted server configuration may supply the gates and review reference.
No public endpoint, scheduler or environment activation has been added.

Reservations are shared across same-school/location nominations and campaigns in
`crm_state.contact_provisioning`. A short school-row lock serializes reservation
changes; provider calls occur outside transactions. Expired pre-dispatch claims
can be reclaimed; dispatching or uncertain writes cannot. Confirmed creation is
reused only after fresh exact identity checks. New contacts have DND enabled;
existing contacts are not modified. Ordinary CRM journal saves preserve this
ledger. No schema migration is required.

Creation is disabled by default and still needs live duplicate-setting and
workflow review, controlled provider rehearsal, privacy cleanup and hosted
integration before release. DND is not proof that workflows cannot trigger.
The reservation coordinates our workers; it cannot prevent a different provider
writer from creating a contact between search and POST. Do not claim provider-wide
exactly-once creation. Never clear an uncertain journal to retry.

The 9 October read-only rehearsal checked email/mobile searches for two existing
fictional contacts and two absent identifiers: six checks passed, zero mutations.
The ignored receipt is `tmp/giveaway-contact-search-verification.json`.

## HighLevel sync implementation — 9 October

`highlevel-sync.cjs` projects only the six configured nomination fields and links
the nominee and nominator as separate contact roles. Original answers, addresses,
employment, invitation tokens and consent evidence stay on the website. It does
not send invitations, enrol workflows, apply marketing tags or modify existing
contact profiles/DND. New reviewed contacts are created with DND enabled; this is
not proof that every existing workflow is harmless, so live trigger review is
still required. Marketing grants/withdrawals do not turn DND off or subscribe
anyone; production suppression integration remains a separate launch dependency.

The worker requires trusted, school/location-bound contact plans. Existing
contacts must match both email and mobile. New contacts require an explicit
duplicate/workflow review marker. Plans must never come from the public form.
Matching conflicts stop for staff review; automatic contact discovery and
approval UI are not implemented. Association IDs and direction must be verified
from the real account before live use; rehearsal IDs are deliberately fictional.

Each write has a persisted intent marker and response receipt. Confirmed writes
are reused across retries and process restarts. Failed reads may be retried;
timeouts, rejected/malformed write responses and incomplete receipts block further
writes in that campaign scope. There is no automatic uncertain-write recovery or
reset command. Do not clear the journal or infer permission to retry from a GET.
One process serializes this local store. Production requires transactional intake
and outbox persistence, database claims and cross-process locking; do not use the
preview JSON file as a production queue. Provider errors cannot roll back the
already committed website submission: run sync separately from form transactions.

The HTTP adapter fixes the official API origin, rejects redirects and limits
methods, paths and payload fields. It defaults to read-only; neither importing
it nor supplying credentials enables writes. No preview endpoint imports it,
and no production handler, cron, migration or environment flag was activated.
The saved real key is never loaded by the rehearsal or tests.

Run from this worktree:

```powershell
node --test tools/giveaway/domain.test.cjs tools/giveaway/highlevel-sync.test.cjs
node tools/giveaway/highlevel-rehearsal.cjs
```

The rehearsal uses the actual nomination/application/withdrawal service and HTTP
adapter with a fake fetch implementation. It saves a separate fictional state and
report under `tmp/giveaway-crm-rehearsal-*`, then reloads that state to check duplicate
suppression. It does not read or change the current browser preview's records.
Tests cover tenancy, contact conflicts, duplicate submissions, write uncertainty,
journal persistence failures, record updates and default-disabled network writes.

API contracts consulted: [create contact](https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/contacts/create-contact/),
[create record](https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/objects/create-object-record/),
[update record](https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/objects/update-object-record/index.html),
and [create relation](https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/associations/create-relation/).
These establish the draft request shapes, not successful live write compatibility.
In particular, the update body and relation response require a bounded provider
pilot before launch. The authenticated production review route must also exist
before configuring a real review URL; rehearsal uses example.test.

A working **local draft**, with nomination, captured email, linked application,
confirmation, marketing withdrawal and fictional admin review. It is not a
production-ready integration. All new files are under `tools/giveaway`; no existing
website route, navigation, database, environment file or operational sender was
changed. This deliberately keeps the draft outside Vercel's `public`/`api` routes.

The branch `codex/giveaway-nomination-flow` starts from freshly fetched
`origin/main` at `91b3e07`. Its worktree is `giveaway-preview`, with Git metadata
in `giveaway-repository`, both inside the laptop handover directory. The handover
snapshot has no Git history. Its source and running previews were preserved;
the named instructor-diary checkout was not available here and was not touched.
No merge, push, deployment, migration or live send occurred.

## Open and try it

The current preview address is saved in `tmp/giveaway-preview-url.txt`.
Open `/` for the nomination form or `/review` for the review desk. Click
**Open fictional review session**, then **See my nomination and apply** in the
captured invitation for Alex Taylor, nominated by Jamie Morgan. This seeded
application has been left unfinished for your review. Tests use a separate store.

Use fictional data only. All addresses are examples, and no provider credentials
are loaded. Nothing is sent to real people. New nominations also appear in the
review desk after refreshing. Captured emails and records survive restarts in
`tmp/giveaway-preview-state.json`; invitation/admin sessions expire after 12 hours
or a server restart. Reopen the invitation or fictional login after restarting.

To restart, from this worktree run:

```powershell
node tools/giveaway/server.cjs
```

It chooses a fresh loopback port, without stopping or taking over other previews.
The parent handover folder currently supplies installed Node dependencies. For a
standalone checkout, install the repository's dependencies with `npm ci` first.
Closing the terminal/server ends the preview, not its saved fictional records.

## Implemented in the draft

- Welcoming CoachCarter typography, orange accent, responsive layouts and a single
  primary action per form. Desktop and 320px layouts checked visually.
- All requested nomination/application fields, conditional practical-test details,
  zero/approximate driving hours, editable name, read-only nominated contacts and
  explicit correction guidance. No silent contact changes.
- Client and server validation, inline errors, focused error summary, keyboard
  access, preserved answers after failed submissions and clear confirmations.
- Nominator permission wording stored with timestamp. Only their name is shown
  to nominees; their contact details and nomination paragraph remain private.
  Optional relationship to the nominee is saved for campaign review only, with
  the same nomination retention/export/deletion requirements as the other fields.
- Cryptographically random 256-bit invitation tokens, hashed lookup, fragments
  rather than query strings, immediate fragment removal and HttpOnly session
  cookies. Opening an invitation does not consume or submit it. No third-party
  scripts, analytics, access/body logging or localStorage secrets.
- School-scoped domain lookups and review, repository tenant/auth helpers,
  same-origin POST checks, loopback/host restrictions, bounded request sizes,
  honeypot and local IP rate limits.
- Atomic local JSON persistence for nomination plus outbox, capture retry with
  stable outbox ID, duplicate nomination-pair protection and immutable completed
  application. This is single-process local storage, not a Neon substitute.
- Optional unchecked learning interests. Separate email/SMS consent evidence
  with exact wording, version, timestamp and withdrawal; no enrolment or sender.
- A single service deadline: `2026-10-11T23:00:00.000Z`, which is Sunday
  11 October 2026 at midnight, end of day, Europe/London. The service accepts a deadline setting;
  tests inject a clock. Both submissions close at the boundary; completed
  confirmation stays available. The normal preview obeys the real deadline.
- Fictional review session uses an isolated JWT key and existing `requireAuth`
  school scope. The local login shortcut is explicitly not production auth.

## Verification performed

```powershell
node --test tools/giveaway/domain.test.cjs
node --test tools/giveaway/browser.test.cjs
```

14 service tests passed. One full Edge/Playwright browser test passed, covering
the journey through nomination, captured email, application, review and reload.
The browser test checks unauthenticated review rejection, cross-origin POST
rejection, mobile overflow, keyboard skip link/error focus, failure preservation,
conditional test fields, all optional boxes initially unchecked, invalid links,
completed-link confirmation, no JavaScript page errors and no external requests.
Edge needed an unsandboxed test run on this laptop. No production resource was
accessed. Screenshots are local temporary output in `tmp/giveaway-screenshots`.

These results do not prove production auth/CSRF, concurrent database transactions,
real provider retry safety, accessibility with a screen reader, retention or
GDPR integration. The local admin shortcut and JSON store must not be deployed.

## Decisions needed before publication

No existing campaign terms were found. Please confirm weekly lesson duration,
eligible area, any age/licence requirements, selection method and decision date,
what (if anything) is included for practical/theory test fees and test-day car
use, and any other prize conditions. No such conditions were invented.

Review the campaign privacy draft. Proposed retention is deletion of unsuccessful
nomination/application data 90 days after closing; winner fulfilment information
and marketing evidence/suppression need separate approved policies. No retention
policy has been activated. Confirm the appropriate contact route for corrections
and identity-verified access/erasure requests, including non-account applicants.

## Production work still required (before a launch approval request)

1. Move the approved UI into the real public pages, include existing branding,
   sidebar and consent loaders, and explicitly suppress analytics on the private
   application and admin screens before loading any tracker. Add no navigation
   destinations without reviewing the current navigation contract. Remove the
   preview banner, review link and fictional login from public delivery.
2. Add governed, manifest-checked Neon migrations for campaign configuration,
   nominations, applications, delivery outbox and consent events. Use school
   foreign keys/indexes, transactionally saved nomination/outbox, unique retry
   keys and per-nomination application uniqueness. Persist opaque token hashes;
   protect any recoverable token material needed by the delivery worker.
3. Implement the production `?action=` API using repository auth/tenant helpers,
   shared rate limits, production CSRF checks and safe error reporting. Validate
   configured school/campaign/sender and trusted link origin server-side. Add a
   disabled-by-default campaign flag and an independent live-sending flag.
4. Integrate the existing Resend provider with a durable claimed outbox worker,
   backoff, duplicate protection, bounded provider idempotency and explicit
   handling of uncertain send outcomes. Do not blindly retry beyond the provider
   guarantee window. Test with capture adapter before any live sender is enabled.
   No production sender or cron has been implemented by this local draft.
5. Replace the fictional review login with existing authenticated school admin
   navigation. Add paginated review and identity-verified scoped export/erasure
   actions with audit records. Never expose tokens in admin data exports.
6. Integrate giveaway data with learner export, shared deletion and retention
   workflows, matching by authorised school and verified identity/email while
   accounting for contact changes and non-account nominators/nominees. Avoid
   disclosing one person's private data in another person's export.
7. Connect marketing consent and withdrawal to a real shared suppression system
   for both email and SMS. The repository's existing enquiry marketing flag is
   not a complete subscription/withdrawal system; the draft does not subscribe
   anyone. Preserve evidence and suppress promptly on withdrawal. Confirm how
   campaign applicants without learner accounts use that system.
8. Rehearse database races, worker crash/retry boundaries, tenant isolation,
   authenticated admin/export/delete, shared consent withdrawal, contact
   corrections and retention in an isolated database; repeat browser tests on
   the production adapters and production CSP.

Only then seek approval for the exact migration/release packet, approved terms
and privacy wording, production configuration, deployment, campaign activation
and live invitation sending. None is authorised merely by this draft or its tests.

## Privacy cleanup composition (9 October follow-up)

Use `createCleanupStore({transaction,config})` and the separately gated
`createCleanupTransport({apiKey,locationId,enabled})` with
`createCleanupWorker({store,transport,enabled})`; invoke it with a nomination ID
already staged for erasure. All configuration is trusted server configuration.
No HTTP endpoint or schedule activates this module. It deletes only the exact
journalled giveaway object after a scoped provider read. Persisted intent and
readback verification protect retries; uncertainty never retries DELETE.

`record_removed` means only that the giveaway object is absent. Review returned
`contacts_to_preserve` separately for the person's wider request and shared CRM
history before calling `eraseAfterProviderCleanup(...,true)`. That confirmation
must represent completed contact/privacy review, not simply the worker's result.
Subject exports now include their own cross-nomination `provider_contacts` without
exposing internal claim tokens or another person's contact mapping.
