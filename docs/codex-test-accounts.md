# Codex Test Accounts

Codex browser testing uses an isolated Neon test branch and seeded accounts that
can be reset safely. The seeder refuses to run unless `POSTGRES_URL_TEST` is set,
and it also refuses when `POSTGRES_URL_TEST === POSTGRES_URL`.

## Accounts

All accounts use:

```text
CodexTestPass!2026
```

Learners:

- `codex+learner-full@coachcarter.test` - credits, bookings, onboarding, progress-like data
- `codex+learner-empty@coachcarter.test` - clean empty-state learner
- `codex+learner-delete@coachcarter.test` - disposable learner for GDPR/deletion testing

Instructor:

- `codex+instructor@coachcarter.test` - active instructor with password login and availability

No admin test account is seeded by default.

## Reset Command

Run this from the repo root:

```powershell
npm run test:seed
```

Clean only:

```powershell
node scripts/seed-codex-test-data.js --clean
```

The script loads `.env.local` if present, but never writes to it.

Required reset environment:

```powershell
$env:POSTGRES_URL_TEST="postgresql://..."
```

Optional but recommended during reset:

```powershell
$env:POSTGRES_URL="postgresql://production-or-dev-url"
```

That lets the guard prove the test URL is not the production URL.

## Local Browser Smoke Flow

1. Reset the isolated Neon test branch:

```powershell
npm run test:seed
```

2. Start Vercel dev against the same isolated branch. The application APIs read
`POSTGRES_URL`, so the dev server must see `POSTGRES_URL` set to the test branch
after the reset has completed:

```powershell
$env:POSTGRES_URL=$env:POSTGRES_URL_TEST
$env:JWT_SECRET="local-test-secret"
npm run vercel:dev
```

Important: Vercel dev also loads `.env.local`. If `.env.local` contains a
different `POSTGRES_URL`, the dev server may use that value instead of the shell
override. For full browser smoke tests, run from a shell/session where the local
Vercel process is definitely using the isolated test URL, or temporarily change
the local-only `.env.local` `POSTGRES_URL` to match `POSTGRES_URL_TEST` and
change it back immediately after testing. Do not commit `.env.local`.

3. In a second shell, run the Codex smoke suite:

```powershell
$env:CC_TEST_API="1"
$env:CC_TEST_BASE_URL="http://localhost:3000"
$env:CC_TEST_LEARNER_EMAIL="codex+learner-full@coachcarter.test"
$env:CC_TEST_LEARNER_PASSWORD="CodexTestPass!2026"
$env:CC_TEST_INSTRUCTOR_EMAIL="codex+instructor@coachcarter.test"
$env:CC_TEST_INSTRUCTOR_PASSWORD="CodexTestPass!2026"
npm run test:smoke:codex
```

The existing `tests/fixtures/auth.js` fixture logs in through
`/api/learner-auth?action=login` and `/api/instructor-auth?action=login`, then
sets the httpOnly session cookies plus the display-only localStorage blobs.

## Endpoint

For local or protected preview use, the same reset logic is available at:

```text
GET /api/seed-test-data?secret=MIGRATION_SECRET
GET /api/seed-test-data?secret=MIGRATION_SECRET&action=clean
```

The endpoint also uses `POSTGRES_URL_TEST`, not `POSTGRES_URL`.

## Safety Rules

- Never set `POSTGRES_URL_TEST` to the production database.
- Never run the seed if the guard reports `POSTGRES_URL_TEST equals POSTGRES_URL`.
- Seed cleanup is scoped to Codex test emails and the legacy test emails from the old harness.
- All seeded learner rows are marked `is_test_account = TRUE`.
- Seeded credits use `learner_credit_balances`; `learner_users.balance_minutes`
  is only maintained as the aggregate display shadow.
- Seeded payment metadata is fake test data only. The harness does not call
  Stripe, execute refunds, create payouts, or mutate production money flows.
