# Qualifying questionnaire and two-route trial funnel

Implemented on `codex/qualifying-trial-questionnaire`, 21 September 2026. Production migration, deployment, feature activation, messages, campaigns and automation are **not authorised or executed**. The existing VSL manifest remains disabled and requires approved footage, poster, captions and transcript.

## Baseline and changed decision

Latest main fetched at the start was `005f687`. Earlier implementation `cb68108` was not on main; it was cherry-picked as `8901b10`, preserving both roadmap entries in the only conflict. The untracked original `test-date-free-trial-funnel-plan.md` was preserved without modification. This document supersedes the original optional-question/direct-booking decision **only for schools enabling the new questionnaire**. The earlier implementation document remains the reference for current-profile editing, instructor permissions and the funded-hours read model; its old activation instructions are superseded below.

## Routing and experience

`/free` loads school configuration before showing a route. A failed configuration request shows a retry action, never an unchecked booking form. Three screens always apply: practical Yes/No; practical details or theory Yes/No with conditional details; budget. Theory date/time are within Question 2, so every conditional route truthfully shows three questions. Back preserves relevant values; changing the practical branch clears the other branch, changing theory to No clears its date/time, and leaving Other clears its free text. Native radio/input keyboard behaviour, focused headings and reduced-motion animation are supported. Personal drafts stay in page memory, not URLs or local storage.

| Practical test | Centre | Budget answer | Route |
|---|---|---|---|
| Booked | Reading, Greenham, Farnborough or Basingstoke | Money set aside, pay as you go, or around £50/hr | Live booking |
| Booked | Any supported centre | Around £45/hr | Request |
| Booked | Other | Any | Request |
| Not booked | Not asked | Any; either theory answer | Request |

There is no four-month routing cutoff. Dates/times must be real, future school-local instants; impossible dates, invalid times and nonexistent DST local times fail validation. Practical Yes requires date, time and a configured centre or Other text. Theory Yes requires date/time. These are self-reported details, not verification of a DVSA booking. Budget is a preference, never a price or discount.

The eligible route uses the unchanged live slot picker, trial duration, availability, travel, transmission, scheduling and money logic. It carries the questionnaire without re-asking it. “No suitable time? Request a trial” is available even when the feed is empty or unavailable and carries any entered contact details. No video is required. `/test-booked` enters this questionnaire and retains useful static fallback content.

Requests collect name, UK mobile, email, postcode **outward area** (e.g. RG1), and one or more Monday–Sunday morning/afternoon/evening preferences. White buttons toggle green with a tick and `aria-pressed`. A saved request neither creates a learner account nor a booking, slot hold, payment or message. Success says the team will contact them to arrange a trial, without a response deadline.

## Configuration

`schools.config.trial_questionnaire` contains:

```json
{
  "enabled": true,
  "supported_centres": ["Reading", "Greenham", "Farnborough", "Basingstoke"],
  "maximum_hourly_pence": 5500,
  "lower_budget_pence": 5000,
  "lowest_budget_pence": 4500
}
```

These values are seeded **only in the loopback test fixture**. Migration 071 contains no configuration seed and changes no prices. Missing or non-Boolean `enabled` disables the questionnaire; enabled but malformed settings fail closed. `_trial-qualification.js` returns an allowlisted public configuration; it does not expose the school's other JSON. Amounts must be positive integers in descending order; supported centres are bounded unique text values. Other is always the additional option.

Staff edit settings in **Admin → Learner Controls → Trial requests and questionnaire settings → Questionnaire settings**. `POST /api/trial-requests?action=configure` atomically changes only this configuration key and writes `trial_questionnaire.configure` audit evidence. Authentication and CSRF use existing helpers and the JWT school; a body school ID cannot redirect the write. Activation is a production action and remains unperformed.

`test_date_trial_funnel_enabled` remains the separate campaign/legacy optional-intake flag. Enable both flags for the intended CoachCarter rollout. When the questionnaire is enabled, it requires qualification and creates immutable intake even if the legacy flag is false. Other schools keep their prior behaviour unless explicitly configured.

## API and evidence

`book-free-trial` receives `questionnaire` with these fields:

```json
{
  "practical_booked": true,
  "practical_date": "2027-12-10",
  "practical_time": "10:30",
  "centre_choice": "Reading",
  "other_centre": "",
  "theory_booked": null,
  "theory_date": "",
  "theory_time": "",
  "budget": "saved"
}
```

Stable budget keys are `saved`, `payg`, `lower`, `lowest`. The server discards irrelevant branch data, validates current school settings and recomputes the route before any booking writes. Client route, configuration, segment and school claims cannot grant eligibility. Old/missing questionnaire payloads are rejected only in enabled schools. The browser cannot bypass this by opening `free-trial.html`, instructor/date hints, or submitting directly to the API. Existing `book`, `request-slot`, `checkout-slot`, `checkout-slot-guest` and `checkout-request` reject the trial type; staff manual bookings and authorised fixed trial offers retain their existing permissions. Rescheduling a real existing trial does not re-qualify it.

Migration **071**, after **070**, adds:

| Evidence | Meaning |
|---|---|
| `trial_requests` | Immutable questionnaire/configuration/source snapshot, postcode area, availability, reason, submission UUID and hashed school/email duplicate key; school-bound FK to the existing enquiry contact record. |
| `enquiries.enquiry_type='trial-request'` | Existing school-scoped name, email, phone and review status infrastructure. No duplicate contact columns in the snapshot. |
| `trial_request_bookings` | Immutable school-bound one-to-one association with the original manually arranged trial. No booking mutation. |
| `trial_booking_intakes.questionnaire` and `test_time_snapshot` | Immutable qualified answers and practical time, committed in the booking CTE; nullable for previous intakes. |

`POST /api/trial-requests?action=submit` accepts contact fields, `postcode_area`, `availability` (e.g. `1:morning`, `7:evening`), a v4 `submission_key`, questionnaire and existing allowlisted `funnel_context`. The API resolves the tenant from host/slug, uses the existing rate-limit pattern (10/IP/school/hour), validates bounded input and accepts a honeypot. No external notifications or automatic marketing are invoked. Snapshot plus enquiry are one SQL statement; a racing duplicate rolls the whole statement back. A retry or another tab using the same normalised email gets the same generic success and cannot overwrite the original. There is one retained request per email per school; staff handle changed preferences through the existing enquiry conversation, preserving submission evidence. Correcting contact data or retrying after identity-verified erasure is a staff process. Duplicate responses do not reveal account existence.

The reason is server-derived: `qualification` for an ineligible direct route, otherwise `no_suitable_slots`. The latter means the person chose the fallback; it is not proof that every instructor's feed was empty. Direct-booking eligibility rejections use generic account-safe copy.

## Staff workflow and request conversion

1. Open the Trial requests panel above the learner list. It paginates 50 requests and shows contact, practical/theory details, budget with the submitted amounts, availability, reasons and original source. All personal text is escaped or rendered through `textContent`.
2. Contact the person manually using established processes. Check actual instructor, area, transmission and schedule suitability. Budget preferences do not authorise a discounted price.
3. Arrange the trial using the existing manual admin/instructor booking process. This implementation does not send messages or schedule automatically.
4. Enter the **original** booking ID and choose **Link existing booking**. `link-booking` requires an authenticated same-school admin, an original trial created after the request and the same learner email. It rejects other schools, unrelated emails, non-trials, unrelated cancellations and bookings that already have intake evidence. A repeat of the same link is idempotent. The intake insert, immutable association and audit row commit together; the booking, learner profile and money rows are untouched.
5. The copied intake retains the request's exact questionnaire, configuration and coarse source. Four-month **reporting** segmentation uses the original request's school-local submission day, while actual booking timestamps stay booking timestamps. Reschedules continue to resolve from the original root without rewriting evidence. Current learner profile data stays separate. Assigned instructors can see current versus original preparation details, including practical time; authenticated learners can explicitly review/apply their historical practical answer.

Admin API reads are `list` (optional `before` cursor), `export&id=…`, and `settings`; writes are `configure`, `link-booking`, and `delete`. All are scoped by authenticated school and return no-store. There is no public request lookup. The existing enquiry view can see the contact/type and points staff to structured review in Learner Controls. This is not the removed waitlist or another calendar.

## Privacy, retention and analytics

Learner export includes request evidence matched by school/email or immutable linked booking (including after an email change). Account deletion removes request/enquiry and intake PII before anonymising financial bookings. For a person without an account, staff verify identity using existing support processes, then use the request export/delete controls. Request deletion also removes its copied booking intake, if linked; it preserves booking/financial records and audit evidence. Historical submissions are never edited in place.

The existing retention worker removes request/enquiry PII and snapshots before 24 months with a seven-day scheduling margin. A linked intake uses its original captured date for this ceiling, so later booking does not restart retention. No cron is added or enabled; operators must monitor the existing worker. The public privacy notice documents the new fields and routing use.

Consented browser events add `trial_questionnaire_started`, `trial_questionnaire_step_1_completed` through `_3_completed`, `trial_questionnaire_booking_route`, `trial_questionnaire_request_route`, and `trial_request_submitted`. No pre-consent history is queued. Every send rechecks consent; SDK `before_send` strips all but static source/version/placement enums and anonymous SDK identifiers. No contact details, exact tests, postcode, budget answer, free text, raw URL or application identity is sent. The private admin review page disables automatic tracking, recordings and all outgoing PostHog events. Request success never fires the booking-confirmed event or Meta Lead.

The existing admin report/CSV now displays authoritative request counts and linked booking counts **separately** from booking cohorts and paid outcomes. Progress is explicitly labelled as consented browser-event data available in PostHog, not an operational database denominator; this change does not query PostHog or fabricate visitor counts. Browser receipt events may repeat after retries/reloads; database requests are deduplicated. Requests use submission-date bounds; bookings use original booking-date bounds. Instructor filters omit unassigned requests. Report definition `trial_funnel_v2_qualification_credit_flexible` splits cohorts by form version and direct/request origin in addition to original segment, source and media version. Old optional-form cohorts are not pooled with qualified cohorts. Purchase counts, funded booked hours, chargeable hours and unknown attendance remain distinct. Existing funding limitations and large-range rehearsal requirements remain.

## Isolated verification and preview

The dedicated `trial_funnel_test` database is on loopback port 55432; the fixture refuses remote targets or another database name. It never loads `.env.local`. It bootstraps the historical aggregate locally, then rehearses 070 and 071. External fetches/Stripe fail closed; email and WhatsApp are mocked. The Vercel preview wraps real route modules, middleware and clean-URL configuration in an OS-temp workspace with crons removed. It must never be deployed.

```powershell
$env:TRIAL_FUNNEL_DB_TEST = '1'
$env:CC_TEST_BASE_URL = 'http://localhost:3108'
npx playwright test tests/trial-questionnaire.integration.spec.js tests/trial-funnel-ledger.integration.spec.js tests/trial-test-details.integration.spec.js tests/trial-test-details.spec.js tests/trial-funnel-report.spec.js --workers=1
node scripts/prepare-trial-funnel-preview.js
vercel dev --yes --listen 3107 --cwd "$env:TEMP/coachcarter-trial-funnel-preview"
```

In another shell, run the complete real-API journeys:

```powershell
$env:TRIAL_FUNNEL_PREVIEW = '1'
$env:CC_TEST_BASE_URL = 'http://localhost:3107'
npx playwright test tests/trial-questionnaire-preview.spec.js tests/trial-funnel-preview.spec.js --workers=1
```

The original preview test deliberately verifies a school with the questionnaire disabled. Rerun `prepare-trial-funnel-preview.js` afterwards to restore the enabled review fixture. The current local preview is [questionnaire](http://localhost:3107/free), [campaign](http://localhost:3107/test-booked), and [admin review](http://localhost:3107/admin/learner-controls.html). Browser tests inject local fixture-only signed-in cookies; real email-code delivery/sign-in is not exercised. Static tests separately cover routing matrix, conditional branches, keyboard/Back/reduced motion, date/time boundaries, fallback, retries and consent, but are not claimed as proof of API or persistence.

The PC shut down during work; repository edits survived, and the isolated database and preview were restarted. Final verification on 21 September 2026 passed **132 focused tests**:

- 96 browser/behaviour/regression checks, including every routing combination, conditional theory details, keyboard/Back/reduced motion, request fallback/retry, consent, private admin analytics, XSS rendering and existing booking behaviour.
- 31 isolated PostgreSQL/helper/report checks, including atomic duplicate prevention, server bypass attempts, tenant/profile protection, immutable evidence, late request conversion, rescheduling, export/deletion/retention and audited configuration.
- 5 complete real-API preview journeys: both new routes at 375px and 1365px, plus the existing learner-profile/instructor/report journey. Screenshots were visually inspected at both widths; mobile weekday labels and admin panel positioning were corrected before the final run.

`npm run check:syntax` passed for 269 JavaScript files; `npm run migrations:check` passed for all 72 manifest entries; `git diff --check` passed. No production connection or mutation was needed. Real provider delivery/sign-in, production-scale report performance and production rollout remain unverified, as described above.

Canonical LF SHA-256 migration checksums for review:

- 070: `4f220073eff55ae3d6087b776912a24f3016508382a5e45981fb8eef822b7185`
- 071: `3d11006e3b7758aec8d3a016c8d3534d1958fd2bfc222bc7b235d2c6f7f5d0db`

## Exact production rollout checklist — not executed

1. Review the branch, original-commit incorporation, routing table, privacy/retention purpose, staff capacity and manual workflow. Confirm that both flags target the verified CoachCarter school only. Obtain separate authorisation for schema, code and activation. Footage, messages, campaign traffic and automation each remain separate work.
2. Fetch latest main, reconcile migration numbering without changing deployed history, and rerun `npm run migrations:check`, `npm run check:syntax`, the focused tests and real local journeys. Review representative large-range report performance before broad reporting use; the existing small loopback rehearsal is not a production load test.
3. Under migration governance, record an approved recovery snapshot. Supply the approved direct URL through `POSTGRES_URL_NON_POOLING` or `DATABASE_URL_UNPOOLED` securely. Run `node scripts/migration-runner.js --status` read-only; verify the target fingerprint. Expected new pending entries are **070 and 071 only** (or just 071 if 070 has independently been applied with the exact manifest checksum). Stop on any other pending entry, mismatch or different school/project identity. Compare both canonical LF SHA-256 values with `db/migrations/manifest.json`.
4. Only with schema approval, set `MIGRATION_RUNNER_APPLY=approved` and `MIGRATION_RUNNER_TARGET_FINGERPRINT` to the reviewed value, then run `node scripts/migration-runner.js --apply-approved`. This applies all pending entries, hence the preflight restriction. Unset both variables immediately, retain the receipt and rerun `--status`. Verify both request tables, composite FKs/indexes, immutable guards, new intake columns, original-date validation and runtime read/insert/delete/sequence privileges. Never invoke `/api/migrate` or apply the aggregate to production.
5. Only with deployment approval, deploy the reviewed commit with the schema already present and both school flags false/absent. Verify clean URLs and CSP/asset loading, no private config in public-config, 401 on unauthenticated request-list/report calls, and authorised read-only admin/profile/report access. Do not create a production booking/request or send notifications as a smoke test.
6. With activation approval, use existing school configuration controls to enable strict Boolean `test_date_trial_funnel_enabled` for the verified school, preserving all other JSON. In the new authenticated questionnaire settings form enter the exact agreed centres and £55/£50/£45 values above, tick Enable, and save. Verify its `trial_questionnaire.configure` audit row and school ID. Actual lesson prices must remain unchanged. Inspect `/test-booked` → `/free`, all three questions, the £45/Other/no-test request routes and eligible live route **without submitting production personal data or bookings**. Keep VSL disabled.
7. Record activation time, form/media versions, current offers and staffed request-review responsibility. Observe errors, duplicate handling, request backlog and retention-worker health after separately authorised traffic. Treat new qualified cohorts separately from the earlier optional form. Do not claim attendance, all-product paid hours or causal uplift.

## Rollback checklist

1. Save current settings and record rollback time/affected schools. In the authenticated questionnaire settings, untick Enable and save. Disable the separate campaign flag if the campaign should return to `/freetrial`. Stop separately managed traffic only through its authorised process.
2. Confirm public-config returns a disabled questionnaire, `/free` uses its prior booking contract, and staff can still review/export/delete retained requests and snapshots. Disabling qualification deliberately restores the old general booking route; it does not cancel booked lessons.
3. For a code/privacy fault, roll back to the reviewed prior deployment through the normal authorised deployment process. Leave additive 070/071 schema in place. Never drop tables, rewrite original answers/segments, unlink money rows or undo real bookings as a feature rollback. Check the retention worker remains able to purge both request and intake evidence after a code rollback; use an approved targeted retention remedy if the old worker lacks 071 support.
4. Preserve the reporting coverage/activation gap and audit evidence. A feature flag alone does not remove already loaded browser assets or replace a code rollback. VSL footage and every production action remain unperformed by this task.
