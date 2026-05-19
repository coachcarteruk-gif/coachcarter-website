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

## Password auth (May 2026)

All three roles use email + password sign-in. Magic-link login was retired entirely. Magic-link infrastructure survives only for the SMS code flow, learner password-reset codes, and a one-time email-code migration path for learner accounts created before passwords shipped.

**Per-role auth model:**
- **Learner** — self-serve signup + login + forgot-password (code-based reset). `api/learner-auth.js`.
- **Instructor** — invite-only (no public signup). Admin sets/resets password via the admin portal; instructor is forced through change-password screen on first login. No self-serve forgot-password — instructors contact the admin. `api/instructor-auth.js`.
- **Admin** — password login (predates this module, lives in `api/admin.js`). Self-serve forgot-password via 6-digit code added May 2026.

**Hard rules:**
1. **Use `api/_password.js`** for all hash/verify/validate/lockout in new code. `api/admin.js` keeps its own `bcrypt` calls (predates the shared module — left alone deliberately).
2. **All password mutations must be audit-logged** via `api/_audit.js`. Action names: `learner.signup`, `learner.password_set`, `learner.password_reset`, `instructor.password_change`, `admin.instructor_password_set`, `admin.password_reset`.
3. **No password-set or login endpoint may leak account existence.** Generic "Email or password is incorrect" / "If that email matches an account, we've sent a code." Only the learner `signup` endpoint may return `account_exists` (since the user just typed it).
4. **Email-code flows for the PWA**: any "magic" that needs to land back inside an installed PWA must use a 6-digit code, not a clickable link. The link goes to the OS browser, breaking session continuity. See `magic-link.js?action=send-email-code` / `verify-email-code`, and `admin.js?action=request-reset` / `reset-password`.
5. **`*.password_hash` is nullable** — accounts created before May 2026 (or via SMS-only signup) have no password until they migrate. Login APIs must handle the null case gracefully (return invalid_credentials; route the UI into migration if applicable).
6. **Verification tickets** (5-minute JWT, `audience: 'password-set'`) bridge learner `verify-email-code` → `set-password`. Don't issue a session JWT until the password is actually saved.
7. **Admin-set instructor passwords** mark `instructors.must_change_password = TRUE`. The instructor login flow checks this on success and forces a change-password screen before the dashboard. Cleared on successful change.

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
- Login wall on `/learner/book.html` (removed April 2026 — page is spectator-mode for guests; the existing `?action=checkout-slot-guest` path lets them pay without an account, and a `#claimTrialCta` inside the guest modal links to `/free-trial.html?instructor_id=…&date=…` when the school has `slug='trial'`. Auth is required only for credit-pay, reschedule, and cancel actions.)
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
- Hour-slot time grid on instructor daily calendar (replaced with compact lesson list — April 2026)
- Daily view tab on instructor calendar (removed April 2026 — agenda absorbs its function)
- "Weekdays" and "Cancelled" filter buttons on instructor calendar (removed April 2026 — weekends always shown, cancelled always hidden)
- Waitlist feature entirely (removed May 2026 — `waitlist` table, `api/waitlist.js`, learner profile "My Waitlist" card, and waitlist join form on `book.html` all deleted. Replaced by `learner_availability` driving cancellation notifications via `api/_notify-availability.js`. Weekly availability is now the single primitive for "ping me when something opens up". Do not re-add.)

## Advance booking cap (12 weeks)

Self-serve learner bookings cap at 84 days (12 weeks) ahead — `MAX_DAYS_AHEAD = 84` in `api/slots.js`, `FEED_MAX_DAYS = 84` in `public/learner/book.js`. The cap covers `?action=available`, `?action=book`, `?action=checkout-slot`, `?action=reschedule`, `?action=book-free-trial`, and `?action=create-offer` (first-slot date).

The **only** path that may legitimately create bookings past this cap is `bookOfferSeries()` in `api/offers.js`, called from `api/webhook.js handleOfferBooking` and `handleFreeOffer`. An instructor sets `lesson_offers.max_repeat_weeks` (1–18) when creating the offer; the learner picks 1..max on the accept page; the webhook fans out a weekly series with `series_id`, skipping clashed weeks (existing booking, blackout, no DoW availability) and rolling to the next free week up to an 18-week lookahead from the original date. Pricing is per-lesson × N (Stripe `quantity`); if we can't fill all weeks, Stripe is partially refunded for the unused ones.

Don't add a per-instructor advance-window setting. Don't add other paths that bypass the 12-week cap. If an instructor wants to book a learner further out, they use the offer-with-repeats flow.

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
