# CoachCarter Platform

Multi-tenant driving school SaaS platform. Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres. Originally built for CoachCarter (coachcarter.uk), now supports multiple driving schools. Being launched nationally as **InstructorBook** (instructorbook.co.uk) — one codebase, two front doors.

> **This file contains hard rules only.** Reference material lives in `docs/` and the top-level plan files. Load those on demand when working in that area.

## IMPORTANT: Before starting ANY work

1. **Always start from latest main**: `git checkout main && git pull origin main`
2. **Never continue on an old feature branch** from a previous session — create a fresh branch from main
3. **Never re-add removed features** — if something looks "missing" from navigation or pages, check this file first. It was probably removed intentionally.

## Key conventions

- API routes use `?action=` routing (e.g. `/api/slots?action=book`)
- Auth: JWT stored in localStorage (`cc_learner`, `cc_instructor`, `cc_admin`)
- Frontend auth via `window.ccAuth` from shared auth JS files
- All new pages must include `sidebar.js` and `branding.js`
- Phone numbers stored as UK format (07xxx), converted to +447xxx at send time
- Always `await` async operations before `res.json()` — Vercel kills functions after response
- **Every SQL query on tenant-scoped tables MUST filter by `school_id`**

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
3. **New PII fields must be included in data export**: If you add a new table or column containing personal data, update `handleExportData()` in `api/learner.js` to include it.
4. **New PII tables must be included in deletion cascade**: If you add a table referencing `learner_users`, add it to the deletion cascade in both `handleConfirmDeletion()` (learner.js) and `cron-retention.js`.
5. **New tenant-scoped GDPR tables need school_id**: Cookie consents, audit logs, and deletion requests are all scoped by `school_id`.
6. **Admin data mutations must be audit-logged**: Any new admin action that creates, modifies, or deletes user data must call `logAudit()` from `api/_audit.js`.
7. **Credit/financial records must never be hard-deleted**: Always anonymize (`learner_id = NULL, anonymized = true`) instead. 7-year legal retention.
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
- **Valid booking statuses:** `confirmed`, `completed`, `cancelled`, `rescheduled`, `awaiting_confirmation`, `disputed`, `no_show`. The `lesson_bookings_status_check` CHECK constraint enforces this. If adding a new status, update the constraint in `db/migration.sql`.
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

**Area reference (load on demand):**
- [`docs/multi-tenancy.md`](docs/multi-tenancy.md) — schools, roles, auth module, branding, school onboarding
- [`docs/gdpr.md`](docs/gdpr.md) — what's in place, GDPR tables, key files
- [`docs/security.md`](docs/security.md) — headers, CORS, rate limiting, DB performance & indexes
- [`docs/stripe-connect.md`](docs/stripe-connect.md) — payouts, cron, fee models (commission / franchise)
- [`docs/setmore-sync.md`](docs/setmore-sync.md) — sync flow, service mapping, email mismatches, cancellation, welcome emails, transition plan
- [`docs/travel-time.md`](docs/travel-time.md) — postcodes.io slot filter, OpenRouteService booking warnings
- [`docs/navigation.md`](docs/navigation.md) — learner/instructor sidebar + bottom tabs, booking page structure
