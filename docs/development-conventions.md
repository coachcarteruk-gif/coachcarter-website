# Development conventions

Read relevant sections for API, page, architecture or deployment work. The shared entry point is [AGENTS.md](../AGENTS.md); this is not a prerequisite for unrelated tasks.

## API and page integration

- API routes use `?action=` routing. Keep business logic server-side and the frontend focused on fetching and rendering.
- Auth uses httpOnly `cc_learner`, `cc_instructor` and `cc_admin` cookies; localStorage copies are untrusted display data. Frontend auth uses `window.ccAuth` from shared auth scripts. Follow [security](security.md) for auth changes.
- New pages include `sidebar.js` and `branding.js`, plus the shared consent and tracking loaders. Follow [navigation](navigation.md), [school branding](multi-tenancy.md) and [GDPR](gdpr.md). Public-page logic goes in external scripts compatible with production CSP.
- Phone numbers are stored in UK format (07xxx) and converted to +447xxx at send time.
- Use `api/_error-alert.js::reportError()` for API 500 reporting; `ERROR_ALERT_EMAIL` and other environment configuration belong in `PROJECT.md`. Log diagnostics server-side and send safe messages to clients.

## Database changes

Follow [migration governance](migration-governance.md), including `npm run migrations:check`. New foreign keys need indexes. The aggregate `/api/migrate` route is a legacy compatibility path, not authority for new migrations; do not invoke or retire it without explicit production approval.

## Native portability

> Full plan: [`MIGRATION-PLAN.md`](../MIGRATION-PLAN.md)

For architectural/API changes, consider: "Will this be straightforward to port to React Native?"

1. **Keep logic server-side** — API routes should do the heavy lifting. Frontend should be a thin display layer that fetches and renders. Don't put business logic in HTML/JS that will need rewriting.
2. **Use `?action=` routing consistently** — every new API endpoint must follow the existing pattern. The app will use the same endpoints.
3. **Don't add web-only dependencies** — avoid new libraries that only work in browsers (e.g. DOM-specific, canvas-only). If you must, isolate them so the data layer is reusable.
4. **Keep `competency-config.js` as the single source of truth** — this will be ported to TypeScript for the app. Any skill/category changes must happen here first.
5. **Standardise API responses** — new endpoints should return `{ ok: true, ...data }` for success and `{ error: true, code: 'MACHINE_READABLE', message: '...' }` for errors.
6. **No new auth patterns** — use `requireAuth` from `api/_auth.js` with the appropriate role and tenant checks. `_shared.js::verifyAuth()` is a compatibility wrapper, not the entry point for new auth code. Don't create alternative auth flows.

Update the relevant part of `MIGRATION-PLAN.md` when a change affects native portability or the shared API contract. Do not prepend unrelated feature history merely because a file or table was added.

## Documentation maintenance

Update the topic document whose contract changed. Update `PROJECT.md` for API/schema/flow reference changes and `DEVELOPMENT-ROADMAP.md` for substantial feature deliveries, without duplicating the complete contract in both. Keep rollout evidence dated and distinguish implementation, deployment, activation and operational permission.

Update `AGENTS.md` only for cross-cutting rules or reading triggers. Keep `CLAUDE.md` as the shared-rulebook entry point. Put environment variables, product details and rollout notes in their area documents. Historical plans and receipts are evidence, not current status or permission to execute them.
