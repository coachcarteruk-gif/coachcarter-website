# Planned Work Register

Last audited: 2026-05-29

This is a living product and engineering roadmap distilled from the tracked
Markdown documentation in this repository. It is meant to answer:

- What has been planned?
- What is already shipped?
- What is partially shipped?
- What matters most next?
- Which docs look stale or contradictory?

When a slice ships, update the status, completion estimate, evidence, and next
slice. If a plan is deliberately abandoned, mark it as deprecated / superseded
instead of deleting the row immediately.

## Audit Scope

Main source of truth: tracked `*.md` files in the repo.

Code/test evidence was used only as a light spot-check where docs were unclear.
No production behaviour was verified during this audit.

Untracked docs excluded from the main audit:

- `.agents/skills/launch-readiness-audit/SKILL.md`
- `.agents/skills/launch-readiness-audit/references/report-template.md`
- `.agents/skills/ui-ux-pro-max/SKILL.md`
- `tmp/plan-c-brief.md`
- `tmp/plan-c-handoff-for-gpt55.md`

## Status Labels

- `shipped`: materially complete and no longer greenfield roadmap work.
- `partially shipped`: meaningful foundation exists, but planned scope remains.
- `planned / not started`: described in docs, little or no implementation found.
- `deprecated / superseded`: plan is no longer the intended direction.
- `unclear`: docs conflict or implementation was not verified enough to judge.

## Planned Work Register

| Area | Planned Work | Status | Completion % | Priority | Confidence | Why It Matters | Evidence | Recommended Next Slice |
|---|---|---:|---:|---:|---|---|---|---|
| Refunds | Refund preview, ledger, and tightly gated execution | shipped | 90% | P0 | high | Live-money safety: bad refunds create cash, payout, trust, and accounting damage. | `DEVELOPMENT-ROADMAP.md:3-19`, `docs/refund-operator-runbook.md:19-31`; PR #264 / merge `d3a3ae1` added admin execute UI from preview, backend execute eligibility guards, and BCS/manual-review refusal coverage. | Keep stable; optional stale-preview UI cleanup only. Remaining refund roadmap is tracked by the manual bank-refund ledger-only row. |
| Refunds | Manual bank-refund ledger-only flow | shipped | 90% | P1 | high | Paid-out bookings and missing-fee evidence need a clean audit trail instead of spreadsheet memory. | `docs/refund-operator-runbook.md:93-141`, `api/_refund-manual-bank.js`, `public/admin/portal.js`; branch `codex/manual-bank-refund-ledger` added ledger-only admin recording, bank reference capture, idempotency mismatch protection, and no-Stripe/no-booking/no-payout/no-credit-mutation tests. | Keep stable; next work is tracked by the manual refund evidence/admin-notes polish row. |
| Refunds | Manual refund evidence, notes, and incident-repair polish | planned / not started | 10% | P2 | medium | The safe ledger path exists, but richer evidence capture would reduce reliance on external notes during awkward refunds or repair incidents. | `docs/refund-operator-runbook.md:188-191`; manual bank records currently store reason, bank reference, preview metadata, and audit log only. | Add optional admin refund notes/evidence fields and a dedicated repair workflow for Stripe-success/local-ledger-failure cases. |
| Credits / Bookings | Booking credit source attribution, FIFO, and CSA-aware edge cases | partially shipped | 80% | P0 | high | This is the spine for refund correctness, instructor payout fairness, and per-instructor credit trust. | `docs/per-instructor-credits-audit.md:23-99`, `memory/current-state.md:42-55`, `memory/prod-facts.md:98-107`. | Finish partial repeat-offer CSA-aware writer and any remaining non-BCS booking paths. |
| Credits | Remove hardcoded `instructor_id = 1` fallback and seed-instructor assumptions | partially shipped | 25% | P1 | medium | Fine for one school; dangerous for InstructorBook, multi-school, and native checkout attribution. | `memory/chips.md:9-21`, `docs/per-instructor-credits-audit.md:76-99`. | Add a migration gate: reject missing instructor metadata after a cutoff, with an explicit legacy-only handler. |
| Credits | Grandfathering scenarios and operator policy | partially shipped | 70% | P1 | medium | The mechanics shipped, but the human rules for weird historic balances are still not clear enough. | `docs/credits-grandfather.md:449-462` still says Step 6 TODO. | Fill the scenario table and link it from admin credit tooling. |
| Platform Balance | Exact refund-exposure valuation | partially shipped | 80% | P1 | medium | The exact read model appears present, but policy/display decisions decide whether operators trust it. | `docs/refund-exposure-valuation-audit.md:146-183`; current code exposes `exact_refund_exposure_pence`. | Decide whether exact exposure replaces advisory in alerts, then add isolated tests and UI copy. |
| Admin Ops | Credit reconciliation writer and apply workflow | partially shipped | 75% | P1 | high | Failed webhooks and manual corrections need an audited operator path. | `DEVELOPMENT-ROADMAP.md:53-69`; docs say backend writer shipped and UI remains inspection-only. | Add a gated "apply reconciliation" UI with reason, preview, audit log, and idempotency. |
| Multi-tenancy | Tenant resolver for public endpoints and second-school gate | planned / not started | 10% | P0 before school #2 | high | Public APIs defaulting to school 1 is the biggest multi-school trust risk. | `LEARNER-INSTRUCTOR-SELECTION-PLAN.md:38-90`; audit did not find `api/_tenant.js`. | Ship `api/_tenant.js`, `schools.primary_host`, and one no-behaviour-change public endpoint conversion. |
| Public Learner Flow | `/instructors` index and `/instructor/:slug` profile booking/purchase flow | planned / not started | 10% | P1 | medium | Unlocks instructor choice, multi-instructor conversion, and future InstructorBook onboarding. | `LEARNER-INSTRUCTOR-SELECTION-PLAN.md:123-218`, `481-524`. | Start only after tenant helper: list-public/profile APIs plus a thin `/instructors` page. |
| Franchise | Instructor #2 lead allocation and overflow routing | planned / not started | 10% | P1 | high | The franchise promise depends on actually supplying the new instructor with learners. | `INSTRUCTOR-EXPERIENCE-PLAN.md:21-70`, `196-205`. | Build the simplest Fraser-overflow routing path before instructor #2 starts paying. |
| Franchise | Tier/pricing admin UI and franchise tier config | partially shipped | 50% | P1 | medium | Rates and fees must be admin-editable, not deploy-time engineering work. | `FRANCHISE-MODEL-PLAN.md:31-75`, `235-297`; `FRANCHISE-COMMITMENT-REGISTER.md` still has TBD status. | Audit actual schema/admin modal, then add missing pricing/tier controls only where used. |
| Franchise | Legal/economic readiness for instructor #2 | planned / not started | 35% | P0/P1 | medium | Contract, insurance, lease, and VAT clarity are business launch gates, not polish. | `FRANCHISE-MODEL-PLAN.md:133-143`, `INSTRUCTOR-EXPERIENCE-PLAN.md:78-121`. | Finish solicitor/accountant/economics checklist before automating more franchise machinery. |
| InstructorBook | Validate market before building more SaaS-specific product | planned / not started | 15% | P1 | high | The synthesis says customer validation is the biggest unknown, not code volume. | `INSTRUCTORBOOK-SYNTHESIS.md:8-23`, `72-107`, `110-225`. | Run the validation script/pitch tests before building self-service signup. |
| InstructorBook | Launch foundations: landing, signup, feature flags, MTD export, and trust branding | planned / not started | 20% | P2 until validation passes | medium | Important for national launch, but only after the product promise is validated. | `INSTRUCTORBOOK-PLAN.md:150-192`, `244-274`. | Landing/email capture first; defer self-service school signup until validation. |
| Native App | React Native / Expo migration prep | partially shipped | 20% | P2 | high | Native app is future leverage, but API consistency must come first. | `MIGRATION-PLAN.md:235-310`, `PROJECT.md:390-398`; PaymentIntent endpoint exists. | Write the API contract/error-shape spec and normalize one learner API family. |
| Native Payments | Stripe PaymentIntent prep for PaymentSheet credit purchases | shipped | 85% | P1 | high | Major app-readiness foundation for native credit purchases. | `PROJECT.md:390-398`, `api/credits.js?action=create-payment-intent`. | Keep it stable; next work is client/app integration, not backend invention. |
| Notifications | Push notifications | planned / not started | 10% | P2 | medium | Useful for app retention and reminders, but below money/tenant correctness. | `DEVELOPMENT-ROADMAP.md:901-904`, `MIGRATION-PLAN.md:281-296`, `597-613`. | Defer until API standardization; then add subscription table and opt-in endpoints. |
| Reminders | Automated lesson reminders | unclear | 40% | P2 | low | Docs disagree; missing reminders create no-shows/support pain, duplicate reminders create trust pain. | `PROJECT.md:1005-1014` says still to build; other docs mention reminders/cron as existing. | Do a focused reminder audit: current cron, templates, opt-outs, and delivery logs. |
| Booking UX | Instructor booking-flow polish from audit | partially shipped | 40% | P2 | medium | Reduces day-to-day instructor friction and support requests. | `BOOKING-FLOW-AUDIT.md:22-75`; shared booking action code exists. | Re-run a narrow UX audit and ship the top three remaining defects. |
| Launch Quality | Accessibility, tablet layout, and SEO canonicals | unclear / partially shipped | 40% | P1/P2 | medium | Launch audit found no blockers, but trust suffers if core pages feel broken. | `LAUNCH-AUDIT-REPORT.md:28-50`, `98-139`. | Verify current pages, then fix labels/H1/canonicals/tablet regressions in one PR. |
| Setmore | Retire Setmore sync once all clients are on CoachCarter | planned / not started | 20% | P3 | medium | Reduces legacy operational risk, but only after migration is truly complete. | `docs/setmore-sync.md:44-46`. | Define exit criteria; do not remove until no live dependency remains. |
| Deferred Franchise Automation | Debt tracking, weekly overrides, promos, vehicle/fleet, insurance payout gates | planned / not started | 0-10% | P3 until triggers fire | high | Real future needs, but premature automation would add complexity. | `FRANCHISE-MODEL-PLAN.md:394-449`, `INSTRUCTOR-EXPERIENCE-PLAN.md:196-205`. | Keep manual; revisit only when documented trigger thresholds are hit. |
| Marketplace / Widgets | Marketplace, custom domains, embeddable booking widget, multi-school instructors | planned / not started | 0-10% | P3 | high | Strategic later-stage features, not current launch-critical work. | `docs/multi-tenancy.md:43-49`, `INSTRUCTORBOOK-PLAN.md:278-335`. | Leave parked until InstructorBook has validated demand. |
| PWA | Dark mode, background sync, share target, Capacitor wrapper | deprecated / superseded | 30% | P3 | medium | Some PWA polish is useful; Capacitor direction is superseded by Expo/React Native. | `PWA_ROADMAP.md:277-370`, `MIGRATION-PLAN.md:703-707`. | Do not start Capacitor; only fix PWA items that help current users. |

## Top 5 Recommended Next Slices

### 1. Manual Bank Refund Ledger-Only Flow

What to do:

- Backend/admin path exists: `record-manual-bank-refund`.
- It is ledger-only: no Stripe refund call, no booking-status mutation, no payout-row mutation, and no credit mutation.
- It requires preview evidence, operator reason, bank reference, confirmation phrase, and duplicate/idempotency protection.
- Future polish is tracked separately: richer evidence capture, admin notes, and incident repair tooling.

Why now:

- Highest remaining refund operator gap after PR #264 shipped clean automatic execute from preview.
- Paid-out bookings, missing-fee evidence, and unsupported refund targets still need a clean audit trail instead of spreadsheet memory.

Smallest safe PR:

- Keep this shipped slice stable.
- Staging/prod-smoke one reviewed already-paid-out or manual-review preview.
- Leave automatic Stripe execution and BCS execution unchanged.

Risks and edge cases:

- Duplicate refunds.
- Recording a ledger event before the real bank transfer is approved/completed.
- Confusing manual ledger recording with automatic Stripe execution.
- Paid-out direct bookings and missing Stripe fee evidence.

Likely files:

- `api/admin.js`
- `api/_refund-planner.js`
- new or existing refund ledger helper
- `public/admin/portal.html`
- `public/admin/portal.js`
- refund-related tests

### 2. Close BCS/FIFO Attribution Edges

What to do:

- Finish partial repeat-offer CSA-aware attribution.
- Find and close any remaining booking paths without source attribution.

Why now:

- Refunds, cancellations, and payouts all depend on credit-source attribution being correct.

Smallest safe PR:

- One writer path at a time, with drift assertions.

Risks and edge cases:

- Double-crediting.
- Orphan source rows.
- Partial-series refunds.
- Existing paid-out bookings.

Likely files:

- `api/_bcs-booking-plan.js`
- `api/_bcs-fifo.js`
- `api/_bcs-repeat-offer-plan.js`
- `api/offers.js`
- `api/webhook.js`
- `api/slots.js`
- BCS/FIFO tests

### 3. Ship Tenant Resolver Before More Public InstructorBook Work

What to do:

- Implement `api/_tenant.js`.
- Add `schools.primary_host`.
- Convert one public read endpoint with no behaviour change.

Why now:

- Public default-to-school-1 behaviour is acceptable only before real multi-school traffic.

Smallest safe PR:

- Helper, migration, tests, and one converted endpoint.

Risks and edge cases:

- Custom domains.
- Vercel preview deployments.
- Old links with `school_id`.
- Host/query precedence.

Likely files:

- `api/_tenant.js`
- `db/migration.sql`
- public API route selected for first conversion
- `LEARNER-INSTRUCTOR-SELECTION-PLAN.md`

### 4. Remove Legacy Instructor-1 Credit Assumptions

What to do:

- Turn missing-instructor credit metadata into an explicit legacy path with a cutoff.
- Stop silently crediting instructor 1 in new flows.

Why now:

- Prevents future InstructorBook/native payments from crediting the wrong instructor.

Smallest safe PR:

- Add warnings/tests first.
- Enforce only after a documented cutoff.

Risks and edge cases:

- Old Stripe sessions.
- Grandfathered users.
- Admin manual grants.
- Webhook replay safety.

Likely files:

- `api/credits.js`
- `api/_credit-grant.js`
- `api/webhook.js`
- `docs/credits-grandfather.md`

### 5. Instructor #2 Readiness Slice

What to do:

- Finish the minimum lead-allocation/overflow path.
- Audit franchise pricing admin controls.

Why now:

- The franchise promise is operational before it is technical.

Smallest safe PR:

- Fraser overflow routing or instructor highlight only.
- No marketplace/search system.

Risks and edge cases:

- Lead fairness.
- Learner confusion.
- Hidden pricing differences.
- Free-trial routing.

Likely files:

- `public/learner/book.html`
- `public/learner/book.js`
- future public instructor pages
- instructor/admin API routes
- admin instructor modal files

## Contradictions / Stale Docs

- `INSTRUCTORBOOK-PLAN.md` says InstructorBook should be independent and not publicly tied to CoachCarter; `INSTRUCTORBOOK-SYNTHESIS.md` argues for transparency: "built by a working instructor" and using CoachCarter proof.
- `INSTRUCTOR-PAYMENTS-PLAN.md` still describes pooled credits and missing Connect UI in places; current credit and Connect docs say those foundations shipped.
- `FRANCHISE-MODEL-PLAN.md` still has old unchecked per-instructor credit tasks that are mostly superseded by `docs/per-instructor-credits-audit.md`.
- `PROJECT.md` "still to build" includes waiting list and referral system; waitlist was intentionally deleted, and referral appears historically shipped.
- `PROJECT.md` has stale booking language: calendar/lesson-type flow and `confirmed` free-trial status conflict with the slot-first / `scheduled` three-state model.
- `docs/navigation.md` says max booking range is 90 days; current rule is 84 days.
- `docs/setmore-sync.md` still uses old cancellation/status language that conflicts with the three-state booking model.
- `docs/per-instructor-credits-audit.md` internally conflicts: older sections say exact platform-balance valuation is deferred, while the latest section says exact fields now exist.
- `docs/credits-grandfather.md` still says Step 6 scenarios are TODO even though later credit slices shipped.
- `REMEDIATION_PLAN_TRIAGED.md` is useful historically, but many clusters appear already shipped and need a refreshed remaining-only view.

## Big Unknowns

- The repository had recently been in a local workshop-main state. Audit conclusions should be checked against the branch used for implementation before opening a PR.
- Production behaviour was not verified.
- Stripe webhook and refund execution behaviour were not exercised.
- Reminder status is unclear because docs disagree.
- Launch audit fixes may have been partly completed after the report.
- Franchise tier schema/admin UI needs a focused code audit before calling it shipped or not shipped.
- Exact refund exposure policy is still a business decision: advisory-only, alert input, or operator source of truth.

## Already Shipped But Important

These are major foundations that should not be treated as greenfield roadmap work:

- Password auth for all three roles.
- Multi-tenant `school_id` foundation.
- Branding/front-door split.
- Three-state booking model.
- Stripe Checkout.
- Stripe Connect payouts.
- Manual platform Stripe schedule.
- Per-instructor credit balances.
- Stripe PaymentIntent prep.
- Direct booking pricing alignment.
- Offer pricing alignment.
- Booking credit source attribution foundations.
- Refund preview, ledger, gated execute backend foundation, and admin execute UI.
- GDPR consent, export, deletion, and audit foundations.
- Cron locks.
- Notification log.
- Service worker auth carveout.
- Retirement of unsafe legacy checkout endpoints.

## Suggested Documentation Cleanup

1. Update `PROJECT.md`, `docs/navigation.md`, and `docs/setmore-sync.md` first because they are core reference docs with stale operational rules.
2. Make `docs/per-instructor-credits-audit.md` the canonical current-state credit doc.
3. Mark stale sections in `PER-INSTRUCTOR-CREDITS-PLAN.md`, `INSTRUCTOR-PAYMENTS-PLAN.md`, and `FRANCHISE-MODEL-PLAN.md` as historical.
4. Fill `docs/credits-grandfather.md` Step 6.
5. Refresh or archive `REMEDIATION_PLAN_TRIAGED.md`.
6. Resolve the InstructorBook transparency-vs-independence contradiction before building more SaaS-facing copy or signup flows.
7. Keep this file updated whenever one of the top-five slices ships or is deliberately deferred.
