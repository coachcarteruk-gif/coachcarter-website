# Multi-tenancy (April 2026)

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when working on tenant-scoped features, auth, or school branding.

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
