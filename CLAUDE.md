# CoachCarter Platform

Multi-tenant driving school SaaS platform. Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres. Originally built for CoachCarter (coachcarter.uk), now supports multiple driving schools. Being launched nationally as **InstructorBook** (instructorbook.co.uk) — one codebase, two front doors.

> **This file contains hard rules only.** Reference material lives in `docs/` and the top-level plan files. Load those on demand when working in that area.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Key conventions

- API routes use `?action=` routing (e.g. `/api/slots?action=book`)
- Auth: JWT in httpOnly cookies (`cc_learner`, `cc_instructor`, `cc_admin`); display-only blob in localStorage at the same key. Never put auth material in localStorage — it's untrusted.
- Frontend auth via `window.ccAuth` from shared auth JS files
- All new pages must include `sidebar.js` and `branding.js`
- Phone numbers stored as UK format (07xxx), converted to +447xxx at send time
- Always `await` async operations before `res.json()` — Vercel kills functions after response
- **Every SQL query on tenant-scoped tables MUST filter by `school_id`**
- **Don't inline booking-status string literals.** Use the constants and predicates in `api/_booking-status.js` (`SCHEDULED`, `CHARGEABLE`, `REFUNDED`, `BLOCKING_STATUSES`, `isChargeable()`, …). Frontend display code may read the strings directly since they're untrusted display data, not control flow. See [`docs/booking-statuses.md`](docs/booking-statuses.md).
- **Instructor is paid for every lesson on their calendar unless the learner gave 48h+ notice.** This is the load-bearing principle behind the three-state booking model. Late-cancel under 48h sets `lesson_bookings.credit_forfeited = TRUE` and leaves the booking `scheduled` until the cron flips it to `chargeable`. Don't reintroduce a "did the lesson happen?" prompt — the dual-confirmation flow was deleted in May 2026.

## Authentication (passwordless user sign-in, July 2026)

Learner and instructor user-facing sign-in uses a 6-digit email code. Admins retain password authentication. Legacy learner/instructor password columns and endpoints remain for compatibility with old accounts, password-reset links, and accepted-offer flows, but must not be reintroduced into the primary learner or instructor login UI.

**Per-role auth model:**
- **Learner** — existing accounts sign in with an email code. People whose lesson/trial was arranged outside the system create a zero-credit account by verifying their email code; they do not choose a password and do not receive another trial entitlement. `api/magic-link.js`, `api/learner-auth.js`.
- **Instructor** — invite-only (no public signup); the current login UI uses an email code. Legacy admin-set password support remains compatibility-only.
- **Admin** — password login in `api/admin.js`, with code-based self-serve password reset.

**Hard rules:**
1. **Do not add password fields to learner or instructor signup/sign-in UI.** Use `send-email-code` / `verify-email-code`; retain legacy password endpoints only while old flows still depend on them.
2. **Keep login enumeration-safe.** Existing-account code requests always return generic copy. Account creation may return `account_exists` because the person explicitly chose the signup path.
3. **Purpose-bind verification.** Existing-account `purpose: 'login'` verification may issue the session directly. New learner `purpose: 'signup'` verification returns a 5-minute `audience: 'learner-signup'` ticket, which `signup-with-code` consumes before creating the account and session.
4. **Offline lesson/trial signup grants zero credit.** It must not insert a free-trial credit transaction or silently create another trial entitlement.
5. **Use 6-digit codes inside the PWA**, not clickable login links; links open in the OS browser and break session continuity.
6. **Auth state mutations are audit-logged.** This includes passwordless learner account creation (`learner.signup`, method `email_code`) and every retained password mutation.
7. **Use `api/_password.js` for retained password operations.** Never roll a local password hash or lockout implementation.
8. **Admin support access to instructor accounts uses impersonation, not passwords.** Do not reveal, reuse, or reset an instructor password just so admin can access their portal.

## Multi-tenancy rules

> Full reference: [`docs/multi-tenancy.md`](docs/multi-tenancy.md)

1. Every new tenant-scoped table MUST have `school_id INTEGER NOT NULL REFERENCES schools(id)` with `DEFAULT 1`
2. Every new SQL query MUST include `WHERE school_id = ${schoolId}`
3. Every new JWT must include `school_id` in the payload
4. Use `requireAuth` from `api/_auth.js`, not local auth functions
5. Public endpoints that need school context accept `?school_id=X` or `?school=slug`

## GDPR rules

> Full reference: [`docs/gdpr.md`](docs/gdpr.md)

1. **New pages MUST include cookie consent**: Every HTML page must load `cookie-consent.js` and `posthog-loader.js` instead of inline PostHog. Never add inline PostHog scripts.
2. **Never load analytics without consent**: PostHog, or any future tracking, must only load after the user accepts analytics cookies. Use the `posthog-loader.js` pattern.
3. **New PII fields must be included in data export**: If you add a new table or column containing personal data, update `handleExportData()` in `api/learner.js` to include it. Long-lived user-facing secrets (`calendar_token`, similar future tokens) must ship with a rotation endpoint and a `*_rotated_at` timestamp — see `api/calendar.js?action=rotate-token` for the pattern.
4. **New PII tables must be included in deletion cascade**: If you add a table referencing `learner_users`, add the cleanup to `deleteLearnerCascade()` in `api/_gdpr.js` — the single shared helper used by learner self-delete (`api/learner.js`), admin delete (`api/admin.js`), and retention cron (`api/cron-retention.js`). Do not maintain per-call-site cascade lists.
5. **New tenant-scoped GDPR tables need school_id**: Cookie consents, audit logs, and deletion requests are all scoped by `school_id`.
6. **Admin data mutations must be audit-logged**: Any new admin action that creates, modifies, or deletes user data must call `logAudit()` from `api/_audit.js`.
7. **Credit/financial records must never be hard-deleted**: Always anonymise instead. `credit_transactions` uses `learner_id = NULL, anonymized = true`; `lesson_bookings` uses `learner_id = NULL, learner_anonymized = true` (FK is `ON DELETE SET NULL`, May 2026). 7-year legal retention.
8. **New third-party services**: If integrating a new service that processes personal data, update `public/privacy.html` to list it, and consider whether it needs consent.
9. **Cookie consent categories**: Currently only "Necessary" (login tokens) and "Analytics" (PostHog). If adding marketing cookies or new tracking, add a new category to `cookie-consent.js`.
10. **Data retention**: New tables with PII should have a retention policy. Add cleanup logic to `api/cron-retention.js` if data has a defined lifetime.

## Database & API security rules

> Full reference: [`docs/security.md`](docs/security.md)

1. **Never use dynamic SQL identifiers**: No `` sql(`DELETE FROM ${tableName}`) ``. Always write explicit queries with tagged template literals.
2. **Never add per-file CORS headers**: CORS is handled centrally in `middleware.js`. If a new origin needs access, add it to `ALLOWED_ORIGINS` in middleware.js.
3. **Rate-limit sensitive public endpoints**: Any new unauthenticated endpoint that sends emails, SMS, or costs money must be rate-limited.
4. **Don't expose error internals**: Never send `err.stack` or raw SQL errors to clients. Use `{ error: 'Human message', details: err.message }` at most.
5. **Keep security headers in middleware.js**: Don't set or override security headers in individual API files.
6. **Index all new FK columns**: Every new foreign key column must have a corresponding `CREATE INDEX IF NOT EXISTS` in `db/migration.sql`.
7. **No inline `<script>` tags on public pages**: Production CSP `script-src` does not allow `'unsafe-inline'` (verify in `middleware.js`). Inline `<script>foo()</script>` blocks are silently dropped in production but run fine in local preview — easy to ship a regression. Put logic in an external `.js` file and have it auto-detect placeholder elements on load.

## InstructorBook principles

> Full strategy: [`INSTRUCTORBOOK-PLAN.md`](INSTRUCTORBOOK-PLAN.md)

- **One codebase, two front doors** — InstructorBook and CoachCarter share API, database, and backend. Different presentation layers.
- **InstructorBook is invisible to learners** — learners on coachcarter.uk (or any school) never see "InstructorBook." School brands are primary.
- **InstructorBook is independent** — not publicly tied to Fraser or CoachCarter. Competing schools must trust it as a neutral platform.
- **Feature flags per school** — `schools.config` JSONB controls which features are enabled (e.g., `learnerbook_enabled`). CoachCarter has everything; new InstructorBook schools get booking/payments only.
- **Pricing: Model D** — free to use, 0.75% fee on automated weekly payouts.

## Setmore sync — hard "do NOT" rules

> Full reference: [`docs/setmore-sync.md`](docs/setmore-sync.md)

- Do NOT delete or modify the `setmore_key` column or `idx_bookings_setmore_key` index
- Do NOT add CHECK constraints on lesson_bookings duration — multiple lesson types exist (60, 90, 120, 165 min). A `chk_booking_90_min` constraint was removed in April 2026 because it blocked non-standard durations.
- **Valid booking statuses:** `scheduled`, `chargeable`, `refunded`. The `lesson_bookings_status_check` CHECK constraint enforces this. Collapsed from seven states in May 2026 — see [`docs/booking-statuses.md`](docs/booking-statuses.md) and `BOOKING-STATUS-RESTRUCTURE-PLAN.md`. If adding a new status, update the constraint in `db/migration.sql` AND the constants in `api/_booking-status.js`.
- Do NOT send notifications for imported bookings (the sync deliberately skips this)
- Imported bookings block slots automatically — no changes needed in `slots.js`
- The service mapping in `setmore-sync.js` is hardcoded to Fraser's Setmore account — update if services change
- Do NOT clear `setmore_key` when editing a booking — the sync needs it to find and skip the booking (edit protection uses `edited_at`)

## Booking page — do NOT re-add

> Full reference: [`docs/navigation.md`](docs/navigation.md)

`book.html` uses a "next available" slot feed with **slot-first** UX (lesson length picked inside the modal after slot click — *not* a pill bar at the top). Do NOT re-add:
- Calendar views (weekly/monthly/daily were intentionally removed)
- View toggles, date navigation arrows, or cursor state
- Empty-hour grids
- Login wall on `/learner/book.html` (removed April 2026 — page is spectator-mode for guests; the existing `?action=checkout-slot-guest` path lets them pay without an account, and a `#claimTrialCta` inside the guest modal links to `/free?instructor_id=…&date=…` when the school has `slug='trial'`. Auth is required only for credit-pay, reschedule, and cancel actions.)
- The lesson-type **pill bar** at the top of the page (`.lesson-type-pills` / `.lt-pill` / `renderLessonTypePills` / `selectLessonType` were all retired April 2026 when slot-first shipped). Lesson length is picked via `<select id="mdLessonTypeSelect">` inside the booking modal after slot click. The slot feed always renders at the smallest active duration via `?action=available&min_duration_only=1`. Per-duration fits/clash/travel checks happen in `?action=durations-for-slot` when the modal opens.

## Navigation — intentionally removed (do NOT re-add)

> Full structural reference: [`docs/navigation.md`](docs/navigation.md)

- Pricing page / tab
- Lesson Advisor
- Privacy Policy tab (page still exists, just not in nav)
- Terms tab (page still exists, just not in nav)
- Q&A feature entirely (removed April 2026 — learner/instructor Q&A pages, API handlers, `qa_questions`/`qa_answers` tables, and daily digest cron all deleted. Feature saw zero real-world use. Do not re-add.)
- Old `.site-nav` dark top bar on any page (sidebar.js handles all nav)
- Old `.bottom-nav` inline bottom bar on any page (sidebar.js handles all nav)
- Old `.sub-tabs` on learner booking/buy-credits pages (sidebar handles navigation)
- Quick-access pill row and action cards on instructor dashboard (sidebar duplicates these)
- Calendar sync banner on booking/dashboard pages (accessible via profile or success modal)
- Menu/hamburger as a bottom tab (sidebar opened via top header hamburger instead)
- Videos in Learn section navigation (page still exists at `/learner/videos.html`, just not in nav — April 2026)
- Hour-slot time grid on instructor calendar (the current selected-date schedule is a chronological list, never an empty-hour grid)
- Daily view tab and monthly/weekly/agenda toggles on instructor calendar (replaced July 2026 by one learner-style month date selector + selected-day chronological list)
- "Weekdays" and "Cancelled" filter buttons on instructor calendar (removed April 2026 — weekends always shown, cancelled always hidden)
- Waitlist feature entirely (removed May 2026 — `waitlist` table, `api/waitlist.js`, learner profile "My Waitlist" card, and waitlist join form on `book.html` all deleted. Replaced by `learner_availability` driving cancellation notifications via `api/_notify-availability.js`. Weekly availability is now the single primitive for "ping me when something opens up". Do not re-add.)

## Advance Booking Window

**July 2026 policy reversal** (deliberate, Fraser-requested — supersedes the old 4-week cap): `instructors.max_booking_days_ahead` (1–84 days, DB default 84) **is** the learner-facing window. The platform ceiling is 84 days — `MAX_DAYS_AHEAD = 84` in `api/slots.js`, `PLATFORM_MAX_DAYS = 84` in `public/learner/book.js`. Each instructor sets their window from the instructor profile ("How far ahead learners can book"). The ceiling covers `?action=available` (outer bounds; still max 31 days per request — the learner feed fetches in ≤31-day chunks), `?action=book`, `?action=checkout-slot`, `?action=checkout-slot-guest`, `?action=reschedule`, `?action=book-free-trial`, `?action=create-offer` (first-slot date), and the lesson-request paths. Per-instructor window enforcement is `isDateWithinBookingWindow()` beside each outer guard. The learner feed window is the chosen instructor's window, or the widest window in the school under "All instructors" (the server filters each slot by its own instructor's window); the book.html date grid collapses past 6 weeks behind a "Show later dates" button.

The historical `bookOfferSeries()` path in `api/offers.js` can create bookings past the 84-day ceiling only for an offer accepted while the school's incompatible-product retirement state is inactive. Slice 3 retires new repeat offers for enabled schools; do not present the historical series path as a new-booking workaround. Existing series records and in-flight pre-retirement Stripe sessions must still settle and remain manageable.

Don't add paths that bypass the 84-day platform ceiling for ordinary learner self-serve booking.

## Simon Slice 3 retired products

`schools.config.features.retire_incompatible_products === true` is the only active retirement value; missing, malformed, string, numeric, or false values are inactive. The state is always loaded by exact authenticated/offer `school_id`. When active, server routes must return `410 PRODUCT_CREATION_RETIRED` before any insert, credit mutation, hold, notification, or Stripe call for learner repeats, Reserved Weekly Slot creation, flexible offers, or repeating offers. UI hiding is defence-in-depth, not authority.

Do not gate grandfathered Lesson Credit balance reads/spending/returns, existing series/status/move/cancel management, historical ledgers, or webhook settlement for Stripe sessions created before activation. Retired/legacy-funded lessons remain £0 automated Simon-launch earnings. Production activation is a separate communication/readiness decision and is not implied by merging the implementation.

## Broadcast offers

## Learner Packages test-mode Full Curriculum boundary

`schools.config.features.learner_packages_enabled === true` is the only enabled value for the catalogue. Test purchasing additionally requires the separate exact Boolean `schools.config.features.learner_package_purchasing_test_enabled === true`; missing, malformed, string, numeric, and false values disable their respective surface. Only Full Curriculum may use this test Checkout/fulfilment path. Phase 1/2/3 are internal progress stages, while Flexible 30 Hours and Manoeuvres remain visible but have no fulfilment in this slice. Browser return URLs are display/polling only; only verified signed Stripe test webhook evidence may atomically create one immutable purchase and an unstarted Full Curriculum enrolment. An explicit unticked early-start request enters `paid_matching` and starts the seven-day deadline at payment; the default enters `cooling_off_hold`, with matching and its seven-day deadline starting only after the exclusive 14-day boundary. A later same-school instructor/admin start action may anchor the 24-week clock and create weekly opportunities only on or after `service_may_start_at`.

Full Curriculum matching is explicit and school-scoped. A webhook-created enrolment begins with a pending matching record, but assignment is forbidden while the enrolment is in `cooling_off_hold`. Admins may assign/reassign only active same-school instructors; ordinary instructors may assign only themselves and may see, accept, update availability for, or start only their current assignment. Initial assignment is immutable, rotations are append-only events, and each availability change creates a new version of structured local weekly windows plus its IANA timezone. Zero windows is a valid explicit record; availability is never a booking, hold, credit, earning or payout. Start requires the current assignment, that instructor's acceptance and an availability version for that instructor, remains after `service_may_start_at` and before the original verified first test, and atomically creates exactly one boundary/week set. Only an authorised admin may bypass missing acceptance, using the exact Boolean `instructor_acceptance_override: true`; the effective override and reason must be audit/progress evidence. Programme and extension week boundaries use the school's validated IANA timezone so the agreed local wall-clock time remains stable across DST.

Full Curriculum Checkout also fails closed unless the immutable current product version has a complete valid `consumer_rights` purchase-price allocation. The controlled pilot additionally requires an active same-school owner-certification grant for one verified adult learner. Checkout must capture the adult declaration, exact disclosure version, terms acknowledgement and explicit Boolean early-start choice in durable evidence. A paid contract must receive an awaited durable exact-terms confirmation before matching, cooling-off release or programme start. Refund planning uses only the purchased snapshot plus trusted school-scoped delivery evidence. Matching/admin and original Stripe-fee customer deductions are always zero. The first-pass workflow may create termination/refund-case evidence, require two different admins, and record a manually issued original-method Stripe refund; it must never call Stripe's refund API or treat the app record as provider success. See [`docs/full-curriculum-consumer-rights-refund-spec.md`](docs/full-curriculum-consumer-rights-refund-spec.md) and [`docs/full-curriculum-owner-self-certification-v1.md`](docs/full-curriculum-owner-self-certification-v1.md).

Package Checkout must use only `STRIPE_PACKAGES_TEST_RESTRICTED_KEY`, the dedicated `STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION`, and the separate `STRIPE_PACKAGES_TEST_WEBHOOK_SECRET`. Never fall back to shared/live Stripe credentials, the legacy webhook, or the Reserved Weekly Slot configuration. A provider timeout/ambiguous response becomes `review_required`; do not automatically create a replacement Checkout Session.

The new package family is not Lesson Credit. Do not route it through `learner_credit_balances`, reactivate `api/credits?action=checkout`, repurpose `/learner/buy-credits.html`, or reuse Reserved Weekly Slot tables/routes/Payment Method Configuration. Product versions and paid terms are immutable and prospective; visibility/activation live on the stable same-school product identity. Full Curriculum booking allocations link actual same-school `lesson_bookings` directly to weekly or retake records. Apart from the isolated manual consumer-rights case/evidence workflow above, this foundation must not broaden existing refunds or create rewards, instructor earnings, transfers, payouts, or live payment behaviour. See [`docs/learner-packages-product-decision-record.md`](docs/learner-packages-product-decision-record.md).

## Broadcast offers

> Full plan: see DEVELOPMENT-ROADMAP.md entry 2.55

The `lesson_offers` table supports two `kind`s:
- **`'manual'`** — instructor-initiated 1:1 offer (the existing "Offer a lesson" feature). Per-slot uniqueness enforced via partial index `uq_offer_slot_manual`.
- **`'broadcast'`** — 1:many fan-out where multiple learners receive simultaneous single-use offer tokens. First to accept wins; siblings get marked `'superseded'` and receive a "no longer available" follow-up. Many pending broadcast rows can exist for the same slot — the partial index excludes them.

Hard rules:
1. New code creating offers MUST set `kind` explicitly (default `'manual'` is preserved for backwards compatibility but new flows should be deliberate).
2. Broadcasts MUST share a `batch_id` (UUID) so sibling supersession finds them.
3. Broadcasts MUST set `trigger` (`'cancellation'` or `'instructor_manual'`) so messaging templates can render the right framing.
4. Sibling supersession lives in `api/_notify-availability.js::supersedeBroadcastSiblings()`. Call it from any path that books a slot (Stripe webhook for offer acceptance, slots.js `?action=book`, webhook `handleSlotBooking` for guest checkout). It is fire-and-forget and idempotent.
5. The `instructors.broadcast_offers_enabled` toggle defaults to `FALSE`. Cancellation-driven broadcasts only fire when this is `TRUE` and the cancellation is <48h before lesson start. Toggle UI lives on `/instructor/profile.html` ("Last-minute broadcasts" card).
6. Instructor-triggered manual broadcasts (`trigger='instructor_manual'`) are not gated by the toggle — the toggle only affects auto-cancellation broadcasts. Manual broadcasts always go through `?action=create-broadcast-offer` and require an explicit `learner_ids` array.

## Lesson requests (request-to-book, July 2026)

> Full reference: [`LESSON-REQUEST-PLAN.md`](LESSON-REQUEST-PLAN.md). Shared lifecycle helpers: `api/_lesson-requests.js`.

Per-instructor `instructors.request_to_book` toggle: learners request slots instead of instant-booking them; payment is **held, never taken up front** (Stripe manual-capture authorization for cards, `request_hold`/`request_refund` credit_transactions pair for credits). Hard rules:

1. **Pending `lesson_requests` rows block their slot** exactly like pending `lesson_offers`. Any NEW booking-creation or slot-holding path must add the pending-request conflict check (mirror the pending-offer check beside it). The slot lock is the partial unique index `uq_request_slot`.
2. **Never charge before accept.** Card requests use `payment_intent_data.capture_method='manual'` — capture on accept, cancel otherwise. Don't add request paths that charge-then-refund.
3. **Hold release is exactly-once**, keyed on `lesson_requests.released_at`. Route all releases through `releaseRequestHold()` — never write ad-hoc refund/cancel logic. Every status transition away from `pending` must be an atomic claim (`UPDATE … WHERE status='pending'`).
4. The `request_hold`/`request_refund` ledger pair must always net zero per request — the divergence cron counts them in ΣCT. Neither type may ever be added to `CREDIT_BOOKING_SOURCE_TYPES` (they are not drawable FIFO sources).
5. Requests expire at min(created + 48h, lesson start − 2h) — inside Stripe's ~7-day auth-hold window. Don't extend past 5 days without rethinking the card path.
6. Declined/expired guest emails must state the card was never charged (only authorised).
7. No weekly repeats and no social-video discount on requests (v1 — deliberate).

## Multi-instructor franchise model

> Full plans: [`FRANCHISE-MODEL-PLAN.md`](FRANCHISE-MODEL-PLAN.md), [`INSTRUCTOR-EXPERIENCE-PLAN.md`](INSTRUCTOR-EXPERIENCE-PLAN.md)

CoachCarter is moving from single-instructor (Fraser) to a multi-instructor franchise model. Instructor #2 onboarding planned a couple of months out from May 2026. Read both plan docs before doing any franchise/payout/credit/pricing work.

Hard rules:

1. **Numbers live in admin-editable config, never hardcoded.** £55/hour, £195/£70 franchise tier fees, 2.5%/5%/7.5% bulk discounts, 12-month contracts, tier inclusions — all live in DB columns or JSONB. Adding a tier or changing a fee is an admin action, not a deploy. The pricing infrastructure is `schools.config.pricing.bulk_hourly_pence`, `schools.config.pricing.bulk_discount_tiers`, `franchise_tiers` table (planned), `instructors.weekly_franchise_fee_pence`, `instructors.hourly_rate_pence` (planned).
2. **Per-instructor credit scoping is required for new credit work.** Once Phase 2 ships, learner credits will scope to a specific instructor at purchase via `learner_credit_balances(learner_id, instructor_id)`. Don't write code that assumes the legacy pooled `learner_users.balance_minutes` model — that's read-only legacy after Phase 2.
3. **Three-level pricing fallback** (most-specific wins): per-learner-pair custom rate (`instructor_learner_notes.custom_hourly_rate_pence`) → per-instructor rate (`instructors.hourly_rate_pence`) → school default (`schools.config.pricing.bulk_hourly_pence`). Bulk discount percentages always apply to the *effective* rate from this fallback.
4. **Bulk-tier discounts are per-instructor opt-in. The instructor absorbs the discount.** `instructors.bulk_tiers_enabled` flag (planned). Their payout uses the snapshotted effective rate from `lesson_bookings.list_price_pence`, not the school list rate.
5. **Don't re-add deferred phases without checking trigger conditions.** `franchise_fee_debts`, `franchise_fee_overrides`, `marketing_promos`, `instructor_promo_optins`, automated Bacs DD invoicing, vehicle/fleet management — all deliberately deferred. Trigger conditions for each are in the plan's Alternatives Appendix. Until then: manual workarounds (Fraser personally invoices, spreadsheet for debts, admin tweaks `weekly_franchise_fee_pence` for one-week overrides).
6. **Year-one franchise relationships are human, not automated.** Negative-payout weeks are personally handled by Fraser, not auto-invoiced via Bacs DD. This is deliberate.
7. **Configurability discipline**: don't add columns "for future flexibility" if no active code path reads them. Exception is justified only when the user has a specific commercial reason to set the value at onboarding.

### Simon interim payout direction (13 August 2026)

Simon does **not** need Accounts v2 or payout v2 before initial onboarding/payment. CoachCarter remains school-wide on v1 while a focused, human-controlled Express/v1 path is hardened: durable ambiguity-safe account creation, exact tenant/audit scope, deliberate `payouts_start_date`, `payouts_paused=true`, exact approved CoachCarter Stripe funding in addition to `chargeable`, an itemised Fraser preview, and explicit first-run approval. The weekly fee comes from `weekly_franchise_fee_pence`; negative/insufficient weeks stay human-handled. Do not add routine lesson-outcome confirmation—the three-state/48-hour calendar rule and `mark-not-delivered` exception remain authoritative. Preserve all Accounts v2 test/A8 evidence as inactive long-term work; never reuse it as the Production v1 identity. Onboarding, first payout and unattended later payouts require separate authority.

## Payout v2 controlled-cutover safety (inactive)

Migration 035 was applied schema-only on 26 July 2026 and remains inactive.
Its deployment evidence is under `db/rollouts/035-payout-v2-schema-only.*`;
postflight confirmed all 25 v2 tables were empty, all 39 guard triggers were
present, and every school remained payout engine `v1`. The source-ingestion
application rollout is prepared for review but is not approved or deployed.
Do not import
`_payout-v2-cutover.js` into a live route, switch an engine, apply an import or
opening recovery, or execute a batch without a future explicit production
authorization and the evidence in `docs/payout-v2-cutover-runbook.md`.

Cutover is per school, fingerprint-bound, and owner-approved. It requires two
distinct accepted shadow Fridays, exact route/reserve/protected/external-cash/
Setmore evidence, one named superadmin or scoped operator, and a hard first-live
cap. An over-cap plan blocks; never truncate or split it. Ordinary school admins
cannot cut over or perform global payout operations. After a future school
transition to v2, all v1 mutation for that school must refuse before claims,
writes, or Stripe calls.
The cash authority must be an explicit current global protected-balance/reserve
fingerprint; a per-school readiness record must not relabel undivided platform
Stripe cash as school-owned free cash.

After any possible Stripe movement, rollback means freeze new batches, preserve
claims and append-only evidence, and continue webhooks/reconciliation. Never
release ambiguous claims, invent a new idempotency key, delete financial rows,
or blindly re-enable v1. A Connect transfer is not connected-bank settlement.
See `docs/payout-v2-rollback-incident-runbook.md`.

## React Native migration principles

> Full plan: [`MIGRATION-PLAN.md`](MIGRATION-PLAN.md)

Before any architectural decision, consider: "Will this be straightforward to port to React Native?"

1. **Keep logic server-side** — API routes should do the heavy lifting. Frontend should be a thin display layer that fetches and renders. Don't put business logic in HTML/JS that will need rewriting.
2. **Use `?action=` routing consistently** — every new API endpoint must follow the existing pattern. The app will use the same endpoints.
3. **Don't add web-only dependencies** — avoid new libraries that only work in browsers (e.g. DOM-specific, canvas-only). If you must, isolate them so the data layer is reusable.
4. **Keep `competency-config.js` as the single source of truth** — this will be ported to TypeScript for the app. Any skill/category changes must happen here first.
5. **Standardise API responses** — new endpoints should return `{ ok: true, ...data }` for success and `{ error: true, code: 'MACHINE_READABLE', message: '...' }` for errors.
6. **No new auth patterns** — use the existing `verifyAuth()` from `_shared.js`. Don't create alternative auth flows.

When making structural changes (new tables, new API routes, new shared modules, competency changes), update `MIGRATION-PLAN.md` to reflect the current state.

## Working practices

- Small fixes: commit directly to main
- Bigger features: feature branch + PR
- Never commit .env files or secrets
- DB migrations: run via `GET /api/migrate?secret=MIGRATION_SECRET`
- **Before pushing to main**, update the relevant docs for any non-trivial change:
  - `PROJECT.md` — API actions, DB table descriptions, flow docs
  - `DEVELOPMENT-ROADMAP.md` — new feature entry with date, description, files changed
  - `MIGRATION-PLAN.md` — if new tables, API routes, or shared modules were added
  - `CLAUDE.md` — if new conventions, env vars, or important design decisions were introduced
  - `docs/<area>.md` — if reference material for a specific area (tenancy, GDPR, security, Stripe, Setmore, travel, navigation) changes

## Error alerting

`api/_error-alert.js` sends email on 500 errors. All API files call `reportError()` before `res.status(500)`. Requires `ERROR_ALERT_EMAIL` env var. For full env var list, see `PROJECT.md`.

## Docs index

**Top-level plans:**
- `PROJECT.md` — complete project reference (APIs, tables, flows, env vars, design system)
- `DEVELOPMENT-ROADMAP.md` — full feature history, roadmap, and competitor differentiators
- `DESIGN-REVIEW.md` — UI/UX design principles, style guide, component standards
- `MIGRATION-PLAN.md` — React Native app migration plan (keep updated)
- `INSTRUCTORBOOK-PLAN.md` — InstructorBook national SaaS strategy, pricing, competitive analysis, marketplace phasing
- `FRANCHISE-MODEL-PLAN.md` — multi-instructor franchise expansion: schema, code, configurability, legal-status research, MVP scope, deferred phases with trigger conditions
- `INSTRUCTOR-EXPERIENCE-PLAN.md` — non-software companion to FRANCHISE-MODEL-PLAN: cold-start lead allocation, three crunch moments, signing-day conversation, 90-day success criteria for instructor #2
- `PER-INSTRUCTOR-CREDITS-PLAN.md` — revised delivery sequencing (2026-05-19) for per-instructor credit scoping. Supersedes `INSTRUCTOR-PAYMENTS-PLAN.md` Steps 3–4g sequencing; adds transactional refactor (Step 0), in-flight-checkout legacy branch, `list_price_source` honesty tag, and hoists pricing fallback ahead of Phase 2A.
- `LEARNER-INSTRUCTOR-SELECTION-PLAN.md` — DRAFT learner-UX plan (2026-05-19) for the multi-instructor front door: `/instructors` index, per-instructor profile pages, retiring `book.html` + `buy-credits.html`. Ships AFTER `PER-INSTRUCTOR-CREDITS-PLAN.md` Steps 0–5. Coupling-impact review against credits plan still outstanding.

**Area reference (load on demand):**
- [`docs/multi-tenancy.md`](docs/multi-tenancy.md) — schools, roles, auth module, branding, school onboarding
- [`docs/gdpr.md`](docs/gdpr.md) — what's in place, GDPR tables, key files
- [`docs/security.md`](docs/security.md) — headers, CORS, rate limiting, DB performance & indexes
- [`docs/stripe-connect.md`](docs/stripe-connect.md) — payouts, cron, fee models (commission / franchise)
- [`docs/setmore-sync.md`](docs/setmore-sync.md) — sync flow, service mapping, email mismatches, cancellation, welcome emails, transition plan
- [`docs/booking-statuses.md`](docs/booking-statuses.md) — three-state booking lifecycle (`scheduled`/`chargeable`/`refunded`), transitions, late-cancel rule, payout implications
- [`docs/travel-time.md`](docs/travel-time.md) — postcodes.io slot filter, OpenRouteService booking warnings
- [`docs/navigation.md`](docs/navigation.md) — learner/instructor sidebar + bottom tabs, booking page structure
- [`docs/franchise-benefits.md`](docs/franchise-benefits.md) — CoachCarter franchise pack: live + pipeline benefits, CoachCarter-vs-InstructorBook split
- [`docs/credits-grandfather.md`](docs/credits-grandfather.md) — PITR rollback procedure for credits migration + drill record + (TODO) grandfather scenarios for Step 6
