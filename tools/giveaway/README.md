# Giveaway morning review — 9 October 2026

## Status

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
- A single service deadline: `2026-10-11T21:00:00.000Z`, which is Sunday
  11 October 2026 at 10pm Europe/London. The service accepts a deadline setting;
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
