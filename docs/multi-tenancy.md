# Multi-tenancy (April 2026)

## Tenant maintenance rules

1. Every new tenant-scoped table MUST have `school_id INTEGER NOT NULL REFERENCES schools(id)` with `DEFAULT 1`
2. Every query on tenant-scoped data MUST constrain it to the effective authorised `school_id`, including joined records
3. Every new JWT must include `school_id` in the payload
4. Use `requireAuth` from `api/_auth.js`, not local auth functions
5. New public endpoints use `api/_tenant.js` and the resolution contract below. Legacy `?school_id=` compatibility is not authority to add client-selected tenant IDs to new endpoints.

> Read this contract for tenant-scoped features, school resolution or branding. Shared repository rules live in [AGENTS.md](../AGENTS.md).

The platform is multi-tenant. Each driving school is an isolated tenant with their own instructors, learners, bookings, lesson types, pricing, and branding.

## Key tables

- `schools` — school profile, branding (colours, logo), Stripe Connect account, config JSONB
- `school_payouts` — platform-to-school payment transfers

## Roles

- `superadmin` — platform owner (Fraser). Can see all schools, create schools, manage school admins. JWT has `school_id: null`.
- `admin` — school admin. Scoped to their `school_id`. Can manage their school's instructors, learners, bookings, payouts.
- `instructor` — belongs to one school. JWT has `school_id`.
- `learner` — belongs to one school. JWT has `school_id` and `role: 'learner'`.

## Auth module (`api/_auth.js`)

- `requireAuth(req, { roles })` — validates JWT, returns payload with normalised `school_id`
- `getSchoolId(payload, req)` — returns effective school_id. Superadmins can override via `?school_id=X`.
- Old JWTs without `school_id` default to `school_id = 1` (CoachCarter).

## Branding

- `public/shared/branding.js` — loaded on all pages. Fetches school branding from API, caches in localStorage, applies CSS custom properties (`--brand-primary`, `--brand-secondary`, `--brand-accent`).
- `GET /api/schools?action=branding&school_id=X` — public endpoint returning school name, colours, logo.
- HTML elements with `data-brand-name` and `data-brand-logo` attributes are auto-updated.

## Public tenant resolution

- Public endpoints should use `api/_tenant.js` instead of silently defaulting to `school_id = 1`.
- Resolution order is host / `x-forwarded-host` via `schools.primary_host`, then `?school=<slug>`, then local development / Vercel preview fallback to CoachCarter.
- Existing public endpoints may temporarily allow legacy `?school_id=` while they are being converted. New public endpoints should not accept client-submitted `school_id`.
- Authenticated endpoints remain JWT-scoped. They derive `school_id` from the session token, not from host/query public tenant resolution.
- The migration guard on `schools` blocks creating non-default schools until the `public_endpoints_tenant_resolved` marker is inserted after the legacy public endpoint sweep.

## Stripe payment flow

- Learner pays → platform Stripe account → weekly cron transfers to school's Stripe Connect (minus platform fee) → school handles instructor payments externally.
- CoachCarter (school #1) retains the legacy per-instructor payout system alongside.

## School onboarding

- Superadmin creates school via `/api/schools?action=create`
- Superadmin creates school admin via `/api/schools?action=create-admin`
- School admin creates instructors via `/api/admin?action=create-instructor` (sends invite email)
- Admin/instructor invites learners via `/api/admin?action=invite-learner`

## Future plans (documented, not yet built)

- Marketplace model (learners browse across schools) — phased for 2027+ (see `INSTRUCTORBOOK-PLAN.md` section 9)
- Custom domains per school
- Embeddable booking widget (like Setmore)
- Self-service school signup — priority for InstructorBook launch
- Multi-school instructors
- Per-school content (videos, quizzes)

## InstructorBook and school branding

> Full strategy: [`INSTRUCTORBOOK-PLAN.md`](../INSTRUCTORBOOK-PLAN.md)

- **One codebase, two front doors** — InstructorBook and CoachCarter share API, database, and backend. Different presentation layers.
- **InstructorBook is invisible to learners** — learners on coachcarter.uk (or any school) never see "InstructorBook." School brands are primary.
- **InstructorBook is independent** — not publicly tied to Fraser or CoachCarter. Competing schools must trust it as a neutral platform.
- **Feature flags per school** — `schools.config` JSONB controls which features are enabled (e.g., `learnerbook_enabled`). CoachCarter has everything; new InstructorBook schools get booking/payments only.
- **Commercial strategy** — the Model D proposal and its 0.75% payout fee remain in `INSTRUCTORBOOK-PLAN.md`. This documentation consolidation does not change or activate pricing; verify the applicable commercial decision and configured values before pricing work.
