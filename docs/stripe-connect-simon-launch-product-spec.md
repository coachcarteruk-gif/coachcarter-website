# Stripe Connect, Refund and Instructor Payout Product Specification

**Status:** Owner-agreed product specification; interim v1 launch direction approved; hardening not yet implemented
**Decision dates:** full target 1 August 2026; v2 MVP boundary 11 August 2026; interim v1 rebaseline 13 August 2026
**Owner:** Fraser Carter  
**Initial live instructors:** Fraser and Simon  
**Scope:** Simon's hardened interim v1 onboarding and reviewed payouts, plus the preserved long-term Accounts v2/payout-v2 target

## 1. Purpose and authority

This document records the product and accounting policy for Simon's launch and the preserved long-term CoachCarter payout architecture. Its immediate purpose is to onboard and initially pay Simon through a hardened, human-controlled version of the existing v1 Express payout path without allowing historical, legacy-credit, manually paid or otherwise unfunded lessons into an automatic transfer.

This is a planning and implementation specification. It does not itself authorise a production deployment, database mutation, Stripe transfer, refund, Connect account creation or payout-engine cutover.

The repository's current documentation describes the live version-one behaviour. The 13 August 2026 owner decision keeps the school on payout engine v1 for the interim period, but it does not declare the current invite or payout implementation safe for Simon. The focused interim hardening in section 2.1 must be implemented, reviewed and merged before any separately authorised Simon account or payout operation.

Accounts v2, source-backed transfers and payout v2 remain the long-term target. They are inactive, deferred work and are no longer prerequisites for Simon's initial account onboarding or a separately approved, reviewed v1 payout. Their retained test-mode accounts, intents, attempts and evidence remain historical audit records and must not be deleted, replaced, mapped to Production or reinterpreted.

The following 1 August full-target policies apply only after a future separately authorised payout-v2 cutover; they do not control Simon's interim v1 route:

- automatic conversion of past calendar lessons into payout-eligible lessons;
- the absence of instructor delivery confirmation;
- credit returns as the normal cancellation remedy for new payments;
- franchise fee and commission being alternative fee models;
- automatic payout eligibility for legacy-credit-funded lessons;
- Friday payout timing;
- repeat offers and Reserved Weekly Slots;
- already-paid direct bookings being ineligible for automatic original-method refund solely because they have been paid out.

Historical financial rows must remain immutable. Superseding a policy does not authorise rewriting old Stripe charges, transfers, payouts, booking credit sources, credit adjustments, refund events or refund-event lines.

## 2. Product principles

1. Every automated instructor payment must be traceable to a successful CoachCarter Stripe payment for one exact lesson.
2. No platform-funded, admin-invented, manually paid, off-system or legacy-credit value may silently enter an automated payout.
3. Instructor pay is calculated from actual money received, not list price, current pricing or a fallback estimate.
4. Stripe's actual fee evidence is used. Missing or contradictory money evidence blocks automation.
5. The three-state booking lifecycle remains authoritative: `chargeable` is required for payout, but Simon's interim automatic eligibility also requires approved, exact CoachCarter Stripe funding evidence.
6. No routine instructor or learner outcome confirmation is required. The existing pre-payout `mark-not-delivered` exception remains available.
7. Friday noon remains the deferred payout-v2 batch boundary. Interim v1 timing is part of each separately reviewed operation and must not enable unattended execution.
8. Stripe transfers are idempotent and reconciled. An ambiguous Stripe response must never be treated as permission to retry with a new identity.
9. All money records are school-scoped, append-only and auditable.
10. Simon starts paused and human-controlled. Account onboarding, the first reviewed payout and any later unattended operation are three separate decisions, each requiring its own authority.

### 2.1 Controlling interim v1 launch boundary

Fraser's 13 August 2026 decision explicitly supersedes the 11 August direction that the narrow beta must use Accounts v2 and payout v2 rather than putting Simon on the legacy engine. CoachCarter remains school-wide on `payout_engine_version='v1'` during the interim period. Simon may use the existing Express/v1 family only after a tightly scoped **Simon interim v1 hardening** change is reviewed and merged.

The interim route must satisfy all of the following before account onboarding can be authorised:

1. Account creation and invitation remain authenticated, tenant-scoped and audit-logged.
2. Account creation is recoverable after ambiguous provider success. A retry reconciles the original durable identity and cannot silently create a second account.
3. Simon's `payouts_start_date` is set deliberately before he can enter eligibility, preventing historical chargeable lessons from being swept into his first payout.
4. Simon begins with `payouts_paused=true` and stays paused through onboarding.
5. The weekly fee comes from the existing admin-editable `weekly_franchise_fee_pence` value. Simon's agreed starting value is £90, but payout logic must not hardcode £90.
6. Fraser receives a read-only preview before any unpause or transfer. It shows the exact lessons, funding evidence, Stripe fees, configured weekly-fee deduction and proposed transfer.
7. Positive automatic Simon eligibility is limited to lessons after the agreed start boundary for which CoachCarter can prove receipt through an approved, exact Stripe-funded source.
8. Cash, Setmore/external payments, historic credit, pre-start lessons, ambiguous sources and test accounts produce no automatic Simon transfer. They remain manual or £0 in the reviewed calculation.
9. `chargeable` remains required but is not sufficient without the approved funding evidence. The existing three-state lifecycle and 48-hour rule remain authoritative.
10. Negative or insufficient weeks remain human-handled during the year-one franchise relationship. No automated invoice, Bacs collection or deferred debt automation is introduced.
11. Fraser explicitly approves Simon's first eligible run. Missing evidence leaves Simon paused.
12. Accounts v2 reconciliation, two payout-v2 shadow Fridays, school-wide v2 cutover and four v2 live-run approvals are not prerequisites for Simon's interim v1 account or a separately approved reviewed v1 payout.
13. Successful onboarding or one reviewed payout does not enable ongoing unattended Simon payouts. That requires a later explicit decision.

The existing v1 invite and payout routes do not yet satisfy this boundary. This document authorises planning and documentation only; it does not authorise account creation, onboarding, unpausing, payout calculation against production data, transfer, cutover or any A8/A9/controller operation.

### 2.2 Superseded 11 August payout-v2 MVP boundary (historical target)

The remainder of this subsection records the prior payout-v2 MVP direction. It is preserved for history and for the long-term target, but it no longer blocks Simon's interim v1 account or first reviewed payout.

Fraser approved a narrower payout-v2 launch on 11 August 2026. It was the controlling boundary until the 13 August interim-v1 rebaseline above. Its safeguards remain long-term design requirements, but its sequence is no longer an immediate Simon launch blocker.

The superseded MVP kept the new source-backed architecture and its safety model rather than putting Simon onto the legacy engine. That sequencing decision is historical; section 2.1 now controls.

The MVP includes:

- Accounts v2 recipient onboarding and exact reconciliation for Fraser and Simon, using hosted onboarding, Express access, stable identity, current capability/requirements evidence, immutable agreements and restricted keys where supported;
- one immutable school-wide cutover and engine boundary, with version-one payout mutation disabled before version-two money movement;
- only the standard direct single-slot CoachCarter Stripe checkout as an automated payment origin;
- exact one-payment/one-lesson evidence, actual amount and Stripe fee, funds availability, school scope, explicit instructor outcome and immutable reschedule continuity;
- the agreed post-fee percentage split, Simon's £90 weekly obligation and carry-forward, Fraser's £0 weekly fee, append-only statements and protected-cash checks;
- durable source-linked transfer intents, stable Stripe idempotency, ambiguity reconciliation and accurate “Transferred to Stripe” wording;
- two accepted shadow Fridays before cutover; and
- explicit Fraser approval for every live Friday run during the beta, with the first four live runs each receiving a manual reconciliation and signed review before any move toward unattended operation.

For the MVP:

- Friday noon remains the immutable economic cutoff and Friday 14:00 remains the intended transfer window, but a privileged operator initiates the reviewed commands; no automatic catch-up, cron-created batch or unattended transfer is enabled;
- automatic refund submission is disabled. Existing school-scoped operator refund procedures handle supported cases after review, and a refund, pending refund or ambiguous refund blocks the affected lesson from a new earning/transfer;
- automated learner issue reporting, outcome-notification emails, daily outcome reminders, dispute ingestion/actions, deadline reminders and post-loss recovery are deferred. Any reported issue, chargeback or unclear payment state is handled as a manual hold; it cannot be waived into eligibility by an ordinary admin;
- an issue or dispute discovered before lock blocks the affected lesson. If discovered after transfer, new Simon runs pause until Fraser records the reviewed resolution or append-only correction; locked history is never edited;
- statement generation and storage are required, but automatic email delivery and bank-arrival correlation may remain manual/read-only during the beta; and
- practical-test-date, instructor-offer and captured request-to-book origins remain manual/£0 automated until each is separately implemented, tested and activated.

The MVP does not weaken tenancy, auth, audit, agreement, source evidence, protected-balance, idempotency, reconciliation, cutover isolation or no-replacement-account controls. A blocker produces a pause or £0/held disposition, never an estimate, alternate account, legacy payout fallback or improvised manual eligibility override.

## 3. Current-state audit that prompted the redesign

The following findings are a point-in-time audit and must be rechecked immediately before implementation and cutover.

### 3.1 Simon

- Simon is instructor ID 6 in school ID 1 and is active.
- His recorded commission rate is 90%.
- He does not currently have a Stripe connected account.
- Stripe onboarding is incomplete.
- His payouts are paused.
- His payout start date is unset.
- Fourteen historical lessons were capable of appearing as chargeable without payout lines.
- The current version-one fallback calculation could have treated those historical lessons as approximately £633.30 payable from a £715.00 base less approximately £10.20 of fees.
- Fraser confirmed that all of Simon's historical lessons have been handled manually. They must never be swept into the new automated system.

### 3.2 Known Simon bookings and payments

- The Simon lesson paid for by Laura Thomas and scheduled for 15 August 2026 was a genuine direct Stripe payment even though local legacy labelling resembles credit usage.
- That payment was £55.00 gross, with a recorded £1.03 Stripe fee and £53.97 net proceeds.
- It succeeded on 20 July 2026 and has no automated payout line.
- Because it predates the new-system cutover, Fraser will handle Simon's payment for it manually.
- Four Simon bookings on 3, 10, 17 and 24 September 2026 came from one active legacy Reserved Weekly Slot block. Their combined recorded value is £330.00, but the block used legacy Lesson Credit rather than a new one-payment-per-lesson Stripe source. The bookings remain on the calendar and Fraser will handle Simon's payment manually.

The wider retired-product inventory found during the audit was:

- one repeated offer, already cancelled;
- 21 credit purchases in the preceding 90 days, with the latest recorded on 10 July 2026;
- no requirement to cancel valid existing Lesson Credit balances or bookings when the creation paths are disabled.

### 3.3 Version-one safety gaps to remove

- Connect onboarding does not reliably set an immutable payout-start boundary.
- A transfer request lacks a Stripe idempotency key.
- On a transfer error, version one can release local booking claims, which creates duplicate-payment risk after an ambiguous network outcome.
- The live Stripe webhook is not configured to receive connected-account events, so account-status changes can be missed.
- Manual admin payout execution does not share a sufficiently strong global lock with the cron path.
- The cron can be invoked by an ordinary admin and processes a global payment scope.
- The integration currently uses a broad live secret key. The replacement should use restricted keys with the minimum required permissions where Stripe supports them.
- The current application uses Stripe SDK 14.25 and the inspected webhook used API version `2024-11-20`. The SDK and API version must be upgraded and deliberately pinned during implementation; current Stripe guidance identifies `2026-05-27.dahlia` as the latest API version at the time of this specification.
- New Connect accounts should use Stripe Accounts v2 with explicit responsibility, fee-payer, dashboard and requirement-collection settings. Compatibility with the existing platform flow must be verified before Simon's account is created.
- Focused tests for Connect onboarding, connected-account webhooks, idempotent transfers, ambiguous outcomes and reconciliation are required.
- The audit found four high-severity production dependency findings. They must be reviewed and resolved or explicitly risk-accepted before launch.
- Fraser's existing connected account was healthy during the inspection, and no orphan connected accounts were found.

### 3.4 Previous verification

The audit's existing focused suite passed 68 tests and syntax checking passed across 187 JavaScript files. That provides regression context but does not prove the new behaviour, which requires new focused tests.

## 4. Controlled cutover and historical boundary

### 4.1 Clean start

The new system uses one immutable deployment cutover timestamp.

- Eligibility is based on the Stripe payment's creation timestamp, not the lesson date, booking creation date or later reschedule date.
- Only supported Stripe payments created at or after the cutover timestamp can enter the new automated payout and refund model.
- All payments created before the cutover remain manual for instructor payout and refund handling.
- No historical payout liability, recovery, legacy credit value or ambiguous source is imported automatically.
- The cutover does not rewrite historical rows.
- Any pre-cutover lesson rescheduled into a post-cutover date remains pre-cutover and manual because its payment was created before cutover.
- The previously discussed 4 August start date for Simon is not a second eligibility rule. If launch occurs then, the exact cutover timestamp on that date is authoritative; if launch moves, the timestamp moves with the approved deployment.

### 4.2 Engine isolation

- Version-one payout mutation must be disabled for the cut-over school before version two can transfer money.
- Version one must not be re-enabled as an informal fallback after version two claims or transfers begin.
- If version two is frozen, claims and financial evidence remain intact while reconciliation continues.
- Rollback never deletes claims, invents new idempotency keys or rewrites completed financial history.

### 4.3 First live run

- The first live new-engine batch includes both Fraser and Simon.
- The previous inactive-plan concept of a Fraser-only £10 first-live cap is superseded. The reviewed first batch contains the complete eligible post-cutover Fraser-and-Simon calculation and is never silently truncated.
- The first batch creates a final preview for Fraser's explicit approval before any Stripe transfer.
- During the approval-controlled MVP, the first four live Friday runs each require Fraser's explicit approval, exact post-transfer reconciliation and signed review. Automatic weekly execution is a separately approved post-MVP change, not an automatic consequence of the first success.
- Simon receives his Stripe onboarding invitation only when the new system is ready.
- Simon remains payout-paused until onboarding is complete, his commercial agreement is activated and Fraser approves the first batch.
- Fraser will handle every pre-cutover Simon payment manually.

## 5. Supported payment model

### 5.1 One payment, one lesson

The future learner payment model is one successful Stripe payment tied to one exact lesson.

- Direct single-session pay-and-book is the standard supported path.
- The server calculates the payable amount from trusted booking, instructor, learner and pricing data.
- Client-submitted price, fee, rate, discount, payment identity or school scope is never trusted.
- The payment record must preserve the booking identity, school, learner, instructor, gross amount, currency, PaymentIntent, Charge, balance transaction, processing fee and creation timestamp.
- A payment must be succeeded and its funds available before its lesson can enter a transfer batch.
- Discounts and promotions use the actual amount paid, never the undiscounted list price.

The full target supports direct slot checkout, practical driving-test-date checkout, a single-lesson instructor offer and a captured request-to-book payment. The approval-controlled MVP enables only direct single-slot checkout. The other origins remain manual/£0 automated until separately implemented, tested and activated. When later activated, every entry point must produce the same one-payment-to-one-lesson evidence and none weakens any eligibility rule.

### 5.2 Removed payment and booking surfaces

- Learner-facing prepaid credit and package purchases are retired.
- Credit-purchase APIs are disabled server-side, not merely hidden in the user interface.
- A learner cannot bypass the removal by making a direct API request.
- Existing Lesson Credit balance reads and spending remain available only for grandfathered balances.
- Instructor offers are limited to one lesson. Repeated-series offers are removed.
- Reserved Weekly Slots are removed for new use.
- Existing bookings created by a legacy repeated offer or Reserved Weekly Slot are preserved as calendar records and handled manually where required.

### 5.3 Excluded funding sources

The following never create an automated instructor earning:

- legacy Lesson Credit of any source classification;
- `legacy_grandfather` value;
- `admin_add` or other administrator-created value;
- platform-funded goodwill;
- cash, bank transfer or payment made outside CoachCarter's Stripe account;
- a manually marked payment;
- Setmore or other external calendar data without an exact supported Stripe payment;
- a pre-cutover Stripe payment;
- a payment that cannot be tied unambiguously to one exact lesson;
- a payment with missing or contradictory Stripe fee or settlement evidence.

Excluded lessons remain visible to admin with their reason. They are not silently dropped or estimated from current lesson prices.

## 6. Grandfathered Lesson Credit

### 6.1 Continued learner use

- Learners who already hold Lesson Credit may continue to spend it with the instructor to whom that balance belongs.
- No new learner is given access to buy credits.
- No new credit package is created.
- An eligible cancellation of a grandfathered-credit lesson returns the original entitlement to the same learner/instructor credit balance.
- A reschedule carries the same credit entitlement and instructor forward without creating a new purchase or payout source.

### 6.2 Payout treatment

- Every lesson funded from legacy or grandfathered credit is presumed manually settled for automated-payout purposes.
- Its automated payout contribution is exactly £0.00.
- This applies platform-wide, not only to Simon.
- Fraser may pay the relevant instructor manually after reviewing the underlying history.
- The system must not infer a payable amount from the credit's current value, original price, lesson list price or an administrator-entered rate.
- A cancellation return is a legitimate restoration of learner entitlement, but it does not convert the legacy source into an automated Stripe-backed instructor earning.

This blanket rule supersedes the earlier idea of tracing old credits to their historical purchase price for automated instructor payout. Source attribution remains valuable for refund exposure and audit, but not for creating a new automated payout from legacy credit.

## 7. Lesson lifecycle and pre-payout exception

### 7.1 Controlling interim v1 rule

For Simon's interim v1 route, the existing three-state lifecycle remains authoritative. The instructor is paid for every lesson on their calendar unless the learner gave at least 48 hours' notice that it would not happen. The hourly transition to `chargeable` remains the normal lifecycle; there is no routine "did the lesson happen?" prompt and no learner/instructor dual-confirmation workflow.

- `chargeable` is required but is not sufficient for Simon: the hardening must also prove an approved exact CoachCarter Stripe-funded source after `payouts_start_date`.
- Before payout, Simon may use the existing `mark-not-delivered` exception for his own past `scheduled` or unpaid `chargeable` lesson. That changes the booking to `refunded` under the existing audited credit/refund behaviour.
- Cash, Setmore/external, historic-credit, pre-start, ambiguous and test-account lessons remain manual or £0 even if `chargeable`.
- Once a payout has been recorded, historical payout and line-item evidence remains immutable; corrections are human-reviewed and append-only.

### 7.2 Superseded payout-v2 outcome model (deferred)

The following explicit-outcome model was approved for the long-term payout-v2 target on 1 August 2026. It is deferred and is not an interim Simon prerequisite:

The instructor chooses exactly one outcome:

1. **Lesson delivered** — payable when all payment and batch safeguards pass.
2. **Learner cancelled late or did not attend** — payable; no learner refund is due under the under-48-hour rule.
3. **Not delivered due to instructor** — not payable; the learner receives a full original-method refund and CoachCarter absorbs the original processing fee.
4. **Rescheduled by agreement** — not payable on the old slot; the instructor must choose the replacement date and time immediately.

“Rescheduled by agreement” cannot be saved without a real replacement slot. If no replacement date and time is chosen, the instructor must use the cancelled/full-refund outcome.

### 7.3 Deferred reminder schedule

The following reminder schedule belongs to the deferred payout-v2 outcome model and must not be implemented as an interim v1 launch blocker:

- At 9pm Europe/London time each day, instructors receive one email listing all ended lessons still awaiting confirmation.
- Unconfirmed lessons remain in each nightly email until resolved.
- Confirmation reminders do not use SMS at launch.

## 8. Rescheduling

### 8.1 General rules

- Learners and instructors can reschedule within their permitted workflows.
- A learner cannot use an under-48-hour self-service action to obtain a refund or unilateral move that defeats the late-cancellation rule.
- Within 48 hours, an instructor may record “Rescheduled by agreement” after an off-platform agreement with the learner.
- Instructor-initiated rescheduling does not require a separate learner approval step.
- A replacement date and time are mandatory.
- Reserved Weekly Slot replacements remain with the same instructor.
- An ordinary learner reschedule may switch to another active same-school instructor when the selected slot passes a fresh availability check. The already-paid entitlement moves without another charge, and the replacement instructor becomes the delivery and payout instructor.

### 8.2 Immutable commercial basis

Rescheduling preserves:

- the original Stripe source and actual paid amount, while an explicit instructor-transfer ledger pair records any change of delivery instructor;
- lesson duration;
- actual amount paid;
- Stripe PaymentIntent, Charge and balance-transaction evidence;
- attributed Stripe processing fee;
- percentage split;
- instructor payout basis;
- funding and cutover classification.

A rescheduled lesson does not reprice when current rates, discounts, commission or franchise settings change.

### 8.3 Notifications

An instructor reschedule triggers immediate email and SMS to the learner showing:

- the original date and time;
- the replacement date and time;
- that the change was made by the instructor;
- the instructor's name;
- a “Report an issue” link.

## 9. Cancellation and refund policy

### 9.1 Learner cancellation with at least 48 hours' notice

For a supported post-cutover direct Stripe payment, the learner chooses one of two outcomes:

- reschedule to a real replacement date and time; or
- cancel and receive an automatic refund to the original Stripe payment method.

The learner's refund is:

```text
actual lesson amount paid
minus the exact attributed, non-returned Stripe processing fee
= amount returned to the learner
```

Before confirmation, the interface shows the lesson amount, exact processing fee and exact refund amount.

### 9.2 Learner cancellation under 48 hours or no-show

- No refund is due.
- The instructor remains payable after recording “Learner cancelled late or did not attend.”
- The learner receives an immediate notification and can report an error, but their approval is not required.
- An agreed move within the 48-hour window must be recorded by the instructor as “Rescheduled by agreement” with the replacement date and time.

### 9.3 Instructor or CoachCarter cancellation

- The learner receives the full actual lesson amount paid.
- CoachCarter absorbs the non-returned Stripe processing fee.
- The instructor receives no earning for the cancelled lesson.
- The refund returns to the original Stripe payment method automatically where Stripe permits it.

### 9.4 Refund timing and customer copy

The agreed customer wording is:

> Your refund of £X should appear in your account within 5–10 business days, depending on your bank.

Do not add a separate “initiated within 24 hours” promise and do not mention that the original charge may disappear. Stripe's current UK guidance supports the 5–10-business-day expectation for ordinary card refunds.

### 9.5 Refund execution safety

- Every automatic refund uses one stable Stripe idempotency key bound to its immutable refund plan.
- A clean replay returns the original result.
- A refund is never retried with a new key merely because the first response was ambiguous.
- If Stripe clearly rejects the refund before money moves, the lesson remains cancelled and the slot is released; the refund is marked pending manual resolution and Fraser is alerted.
- If Stripe may have succeeded but the local ledger is incomplete, the system blocks further execution and reconciles the original Stripe identity before any retry or repair.
- The learner-facing 5–10-business-day message remains the same while Fraser resolves an internal failure.
- Manual bank transfer remains an admin-operated last resort, not a learner-selectable refund method.
- All refund actions, failures, evidence and repairs are school-scoped and audit-logged.

## 10. Instructor payout calculation

### 10.1 Per-lesson formula

For each eligible lesson:

```text
actual Stripe amount paid
minus actual attributed Stripe processing fee
= net lesson proceeds

net lesson proceeds
multiplied by instructor's snapshotted percentage
= instructor lesson share

net lesson proceeds
minus instructor lesson share
= CoachCarter percentage share
```

The percentage split is applied after Stripe's processing fee. It is always based on the actual paid amount.

Example using the Laura payment as a mathematical illustration only:

```text
£55.00 actual payment
− £1.03 Stripe processing fee
= £53.97 net lesson proceeds

£53.97 × 90%
= £48.57 instructor share after penny rounding

£53.97 − £48.57
= £5.40 CoachCarter percentage share
```

The Laura payment itself remains pre-cutover and manual.

### 10.2 Rounding

- Stripe values and all ledger values are stored in integer pence.
- The instructor share is rounded once using one documented platform-wide rule.
- The CoachCarter share is the remainder, ensuring the two shares equal net lesson proceeds exactly.
- Rounding never creates or removes a penny from the total.

### 10.3 Interim v1 eligibility and preview

The Simon hardening must produce a read-only, school-scoped preview from the same trusted calculation that a later reviewed v1 payout would use. The preview shows every included and excluded lesson, exact approved Stripe source identity/evidence, gross received, attributed Stripe fee, the current admin-managed `weekly_franchise_fee_pence` deduction and proposed transfer.

A Simon lesson may contribute positive automatic value only when it is `chargeable`, is on or after the deliberately recorded `payouts_start_date`, has not already been paid, is not a test-account lesson, and has one approved exact CoachCarter Stripe-funded source proving the platform received the corresponding money. Cash, external/Setmore, historic credit, pre-start, ambiguous or contradictory funding remains manual or £0. A missing predicate blocks; it is never replaced with list price, a zero-fee assumption or an ordinary-admin override.

Simon remains `payouts_paused=true` while Fraser reviews this evidence. The first unpause/run needs separate explicit authority, and the route must return to or remain paused if evidence is incomplete. A successful reviewed run does not authorise unattended future runs.

### 10.4 Deferred payout-v2 eligibility checklist

The following checklist applies to the preserved long-term payout-v2 target, not the interim v1 milestone.

A lesson can enter a payout batch only when all conditions are true:

- the booking belongs to the same authenticated school and instructor;
- the payment was created at or after the cutover timestamp;
- one supported CoachCarter Stripe payment maps to the exact lesson;
- the PaymentIntent and Charge succeeded;
- the money is available in the platform Stripe balance;
- the gross amount and currency match local immutable evidence;
- the exact Stripe processing fee is available from the balance transaction;
- the lesson has ended;
- the instructor selected a payable outcome;
- the confirmation occurred before the relevant Friday noon cutoff;
- the lesson has not already been paid or claimed by another batch;
- no refund, pre-cutoff learner issue report, pre-payout dispute or financial ambiguity blocks it;
- the instructor's payouts and commercial agreement are active;
- the payout engine is version two for the school.

Failure of any check blocks that lesson rather than estimating or falling back.

Connect readiness is a transfer condition, not an economic-earning condition. If every condition above passes but the instructor's connected account is temporarily unable to receive transfers, the earning is locked as an explicit held payable under section 14.2.

## 11. Interim weekly franchise fee and deferred debt ledger

### 11.0 Interim v1 handling

Simon's interim reviewed calculation reads the current value from `instructors.weekly_franchise_fee_pence`; the agreed starting configuration is £90 per week. The amount is not hardcoded in payout logic. Negative or insufficient weeks remain human-handled by Fraser during the year-one relationship. The automated carry-forward, invoicing, Bacs collection and obligation-ledger behaviour below remains part of the deferred long-term target and is not required for Simon's interim v1 route.

### 11.1 Fee model

The franchise fee is separate from the percentage split.

The weekly calculation is:

```text
sum of instructor lesson shares
minus current weekly franchise fee
minus older outstanding adjustments according to allocation priority
= amount transferred to the instructor's Stripe connected balance
```

- The franchise fee is a fixed weekly amount configured per instructor/agreement in admin.
- It is charged regardless of lessons, earnings, sickness, holiday or other lack of work while the agreement is active.
- No VAT is added under the current owner-provided accounting rule.
- Simon starts at £90.00 per week.
- Fraser, as owner, has a £0.00 weekly franchise fee.
- The fee is not hardcoded in application logic.

### 11.2 Activation and weekly period

- A fee starts only when Fraser explicitly activates that instructor's commercial agreement in admin.
- It does not accrue merely because the instructor account exists, Connect onboarding has started or payouts are paused.
- For an existing instructor at launch, activation occurs when the new system and their agreement are live.
- For a future instructor, activation occurs when their agreement is activated.
- The first partial week still charges the normal full weekly fee.
- Each fee period runs from Friday noon Europe/London time to the following Friday noon.
- At Friday noon, the system snapshots whatever weekly fee is currently configured. A change made during the week therefore applies to that week's statement if it exists at the cutoff.
- Once snapshotted into the locked statement, the fee is immutable. Later correction uses an adjustment, not editing the statement.

### 11.3 Insufficient earnings and carry-forward

- An instructor transfer can never be negative.
- If earnings are lower than the weekly franchise fee, the transfer is £0.00 and the shortfall carries forward.
- A week with no earnings still creates the full franchise fee and adds it to the outstanding balance.
- Carry-forward is automatic by default.
- Fraser can record a manual repayment or clearance for some or all of the balance.
- A manual clearance records amount, date, payment method, evidence/reference and an admin note.
- Manual clearance is audit-logged and cannot delete the original fee or debt row.

### 11.4 Allocation priority

- Available instructor earnings and manual repayments clear the oldest outstanding debt first.
- If two debts share the same effective timestamp, a lost-dispute recovery is cleared before a franchise-fee debt.
- Each application is recorded so the statement can explain which debts were reduced and what remains.

### 11.5 Record supplied to instructors

The weekly payout statement is the only franchise-fee record generated at launch. No separate franchise-fee invoice is created.

## 12. Deferred payout-v2 Friday batch schedule

This section describes the long-term payout-v2 schedule. Simon's interim v1 route has no authority for an unattended schedule.

### 12.1 Times

All business cutoffs use `Europe/London` with explicit daylight-saving handling.

- **Friday 12:00 noon:** confirmation cutoff and hard batch lock.
- **Friday 2:00pm:** transfer run to instructors' Stripe connected balances.

The current 09:00 UTC payout cron must not be reused unchanged.

### 12.2 Hard-lock behaviour

- Confirmations completed after Friday noon enter the following week's batch.
- Learner issue reports received before Friday noon block that lesson from the current batch.
- A learner issue report received after Friday noon does not alter the locked 2pm transfer.
- Reports received after the lock are manually reviewed. If correction is required after payment, it is applied to a future payout through an explicit adjustment.
- Resolving a blocked lesson after the lock cannot insert it into the locked batch; it waits until the following week.

### 12.3 Transfer semantics

- The 2pm action transfers money from the CoachCarter platform Stripe balance to the instructor's connected Stripe balance.
- The status and customer copy say **“Transferred to Stripe.”**
- The system does not call this “paid to your bank.”
- Stripe controls the connected account's subsequent bank-payout schedule.
- A bank-paid status requires separate exact Stripe payout evidence if it is ever displayed.

## 13. Deferred payout-v2 preview and weekly statement

This full statement model remains long-term. The smaller controlling interim preview is defined in section 10.3.

### 13.1 Live preview

Before Friday, each instructor can see a live provisional breakdown containing:

- each confirmed eligible lesson;
- learner and lesson date/time context;
- actual amount paid;
- attributed Stripe processing fee;
- net lesson proceeds;
- instructor percentage;
- instructor lesson share;
- CoachCarter percentage share;
- current provisional weekly franchise fee;
- brought-forward debts and adjustments;
- expected transfer amount;
- blocked or excluded items with non-sensitive reasons.

The preview makes clear that the franchise fee and eligibility remain provisional until Friday noon.

### 13.2 Friday statement

Every instructor with an active commercial agreement receives a weekly statement email after the Friday run, including instructors whose transfer is £0.00.

The statement includes:

- weekly period start and end;
- batch and statement identity;
- each included lesson and calculation;
- actual payment and Stripe fee;
- percentage split and both parties' shares;
- fixed franchise fee;
- brought-forward debt;
- debt applications and manual clearances;
- dispute or correction adjustments;
- closing outstanding balance;
- total transferred to Stripe;
- any amount held because Stripe Connect is not currently ready;
- Stripe transfer identity when a transfer occurred;
- clear £0.00 reasoning when no transfer occurred.

## 14. Deferred payout-v2 transfer execution and reconciliation

### 14.1 Idempotency

- Every instructor transfer has one deterministic Stripe idempotency key derived from immutable batch and instructor identities.
- The local claim, reviewed plan fingerprint and Stripe request identity are persisted before the Stripe call.
- A retry reuses the same idempotency key and exact amount.
- A different amount or plan requires a new reviewed adjustment or batch, never reuse of the old key.

### 14.2 Outcomes

**Connect temporarily not ready at Friday lock:**

- the instructor's eligible earnings, percentage split, weekly franchise fee and debt applications are calculated and locked normally;
- the resulting payable amount receives the explicit disposition `held_connect_not_ready`;
- the instructor's transfer for that amount is £0.00 until readiness returns;
- other ready instructors and batches continue normally;
- the amount remains a protected platform liability and is not platform revenue, franchise debt or forfeited instructor earnings;
- the statement shows the held amount and reason;
- after current Connect readiness is proven, a later run releases the same locked amount without repricing, recalculation or lesson reconfirmation.

**Definite Stripe rejection before transfer:**

- confirmation and earning evidence remain recorded;
- the earning remains unpaid;
- the transfer is marked failed with the exact reason;
- it may be retried with the same identity after the cause is resolved;
- the instructor does not reconfirm the lesson.

**Ambiguous network or server outcome:**

- the transfer and its claims enter a reconciling state;
- the claims are not released;
- no second transfer is attempted until Stripe is queried by idempotency key, transfer identity and balance evidence;
- reconciliation either attaches the existing Stripe transfer or proves no transfer occurred before a same-key retry.

**Successful Stripe transfer:**

- the transfer identity, amount, balance transaction and local line items reconcile exactly;
- the earning becomes immutable and cannot be claimed again;
- the status is “Transferred to Stripe.”

### 14.3 Concurrency

- Cron, admin approval and manual recovery paths share one batch/transfer locking authority.
- Only the named authorised operator can approve the first live batch.
- An ordinary school admin cannot start a global payout run.
- Database uniqueness prevents one earning or booking from entering more than one payout batch.

## 15. Deferred payout-v2 learner notifications and issue reports

### 15.1 Outcome notifications

Every instructor-recorded outcome sends the learner a clear notification:

- lesson delivered;
- learner cancelled late or did not attend;
- rescheduled by agreement;
- cancelled by instructor and refunded.

The message explains the practical result and includes a **“Report an issue”** link. It informs the learner; it does not ask them to approve the outcome.

### 15.2 Report form

- The link opens a secure, pre-filled support form containing the lesson identity and non-sensitive lesson details.
- The learner supplies their concern without being able to change trusted booking, payment, school or instructor fields.
- The endpoint is rate-limited and uses a short-lived or otherwise appropriately scoped signed token where the learner is not already authenticated.
- A report received before the batch lock blocks only that lesson.
- A report received after the batch lock does not change the current week's transfer and enters manual review.

### 15.3 Communication

The learner receives this acknowledgement:

> We’ve received your report about your lesson on [date and time]. We’ll review the details and contact you if we need any further information.

The acknowledgement does not say the lesson or payment has been paused.

- Fraser receives the report and controls any further communication.
- The instructor is not automatically notified.
- Private learner comments are not exposed to the instructor.
- If the report is upheld after the instructor has already been paid, any correction is manual and may be applied to a future instructor payout.
- Every resolution records the admin, reason, evidence, outcome and any linked financial adjustment.

## 16. Deferred payout-v2 Stripe disputes and chargebacks

### 16.1 Before instructor payout

- A Stripe dispute opened before payout blocks that lesson automatically.
- The lesson is sent to Fraser for manual review.
- No payout occurs while the dispute remains open. After Stripe resolves it, Fraser reviews the evidence and outcome before the lesson can be released or adjusted.

### 16.2 After instructor payout

- Opening a dispute after the instructor has been paid does not create a temporary withholding from future payouts.
- CoachCarter submits evidence and expects a genuinely delivered, confirmed lesson to be defensible, while recognising that the cardholder's bank makes the final decision.
- If CoachCarter wins, the instructor's original payout remains untouched.
- CoachCarter absorbs Stripe's dispute fees.
- If CoachCarter loses, only the instructor's original lesson share is recoverable from their future payouts.
- CoachCarter absorbs its own percentage impact, the original processing-fee impact and all dispute fees.
- No money is automatically pulled from the instructor's bank or existing Stripe connected balance.
- A lost-dispute recovery carries forward if future instructor earnings are insufficient.
- A won dispute restores any instructor amount only if a future implementation had already applied a recovery in error; under the agreed launch rule, no temporary recovery occurs while the dispute is merely open.

For a partial final loss, recovery is proportional to the instructor's original share:

```text
partial recovery
= round_half_up(original instructor share × final disputed principal lost ÷ original gross payment)
```

The recovery is capped at the original instructor share. Stripe dispute fees are excluded from this formula and remain entirely CoachCarter's responsibility. For example, a 50% principal loss on an original £48.57 instructor share creates a £24.29 recovery after half-up penny rounding.

### 16.3 Evidence and operator workflow

When a dispute opens, the system prepares an evidence pack containing:

- booking identity and school scope;
- learner and instructor identities appropriate for evidence submission;
- PaymentIntent, Charge and balance-transaction references;
- actual payment and fee evidence;
- scheduled lesson date, time, duration and location context where appropriate;
- instructor confirmation and timestamp;
- recorded outcome;
- reschedule history and notifications;
- relevant system communication delivery evidence;
- learner issue-report history, if any.

Fraser manually decides whether and how to submit the response in Stripe. The system does not auto-submit dispute evidence at launch.

### 16.4 Alerts and deadlines

- Fraser receives an immediate dispute email.
- The dispute remains prominently flagged in the admin dashboard until resolved.
- The dashboard shows Stripe's response deadline.
- If unresolved, email reminders are sent three days and 24 hours before the deadline.
- Fraser receives an outcome email when Stripe marks the dispute won or lost.
- The outcome email shows Stripe amounts, fees and any instructor adjustment.
- Dispute webhook processing is idempotent and duplicate/out-of-order events cannot apply an adjustment twice.

## 17. Simon's launch configuration

For the interim v1 route:

- CoachCarter remains on payout engine v1;
- Simon uses one hardened Express/v1 identity created or recovered through the reviewed school-scoped route;
- the retained Accounts v2 test account shell and all intents, attempts and evidence are preserved, inactive and never reused as the Production v1 identity;
- `payouts_start_date` is set deliberately before eligibility and `payouts_paused=true` is set before onboarding;
- weekly franchise fee is read from `weekly_franchise_fee_pence`, initially configured by admin as £90;
- only post-start `chargeable` lessons with approved exact CoachCarter Stripe funding evidence may contribute positive automatic value;
- the first preview and any first transfer require Fraser's separate explicit approval; and
- onboarding, one reviewed payout and unattended future payouts are separate authority boundaries.

The following configuration is preserved for a future payout-v2 agreement activation:

- instructor: Simon;
- commission/instructor share: 90% of net lesson proceeds;
- CoachCarter share: 10% of net lesson proceeds;
- weekly franchise fee: £90.00;
- franchise VAT: none under the current owner-provided rule;
- automated payment eligibility: supported Stripe payments created at or after the production cutover timestamp only;
- Connect status: must complete hosted onboarding and have the required transfer capability;
- Stripe dashboard access: Express;
- payout status: remains paused until the first live batch is reviewed and approved;
- pre-cutover and legacy-credit lessons: manual payment by Fraser;
- Laura Thomas 15 August lesson: manual;
- existing September Reserved Weekly Slot lessons: manual.

Simon should not accumulate the weekly franchise fee before Fraser activates his agreement, even if his user account or Stripe onboarding already exists.

## 18. Fraser's launch configuration

- Fraser remains an ordinary instructor in the payout calculation and participates in the first live batch.
- His instructor percentage continues to come from his admin-managed commercial configuration.
- His weekly franchise fee is £0.00 because he is the owner.
- His payments and earnings remain subject to the same post-cutover payment evidence, confirmation, cutoff, idempotency and reconciliation controls.
- Owner status does not permit unfunded, legacy or pre-cutover lessons into automation.

## 19. Admin controls and audit trail

Admin must be able to:

- set and view each instructor's percentage split;
- set and view the current fixed weekly franchise fee;
- activate and deactivate the commercial agreement;
- pause and resume payouts;
- send and monitor Stripe onboarding;
- view Connect capabilities and requirements;
- preview weekly earnings, fee and debt calculations;
- approve the first live batch;
- view exclusions and blockers;
- view and resolve learner issue reports;
- view disputes, evidence packs and response deadlines;
- record manual debt repayments or clearances;
- view payout, refund, transfer and reconciliation history.

Every money-affecting admin action records:

- school;
- admin identity;
- instructor and learner where relevant;
- booking, payment, earning, statement, adjustment and transfer identities;
- before and after values;
- amount and currency;
- reason and note;
- evidence reference;
- idempotency key or immutable action identity;
- timestamp.

No admin interface may directly edit historical payout, refund, transfer, fee or debt ledger rows.

## 20. Data and ledger requirements

The implementation must maintain distinct append-only concepts for:

- Stripe payment source evidence;
- lesson earning and its confirmation;
- earning exclusion/block reason;
- weekly payout batch and immutable plan;
- batch line item;
- Stripe transfer attempt and reconciliation;
- weekly franchise fee assessment;
- carried debt;
- debt application;
- manual repayment/clearance;
- learner issue report and resolution;
- Stripe dispute and evidence state;
- payout recovery adjustment;
- refund event and lines;
- notification delivery evidence.

Required invariants:

- every tenant-scoped row includes `school_id`;
- every query and unique financial identity enforces school scope;
- one lesson earning can be paid at most once;
- one weekly fee is assessed at most once per active instructor and weekly period;
- one debt application cannot exceed its source earning or target debt;
- no transfer exceeds the locked payable amount;
- no recovery makes an instructor transfer negative;
- all totals reconcile in integer pence;
- local and Stripe identities are never inferred from free text;
- historical financial rows are never deleted to repair a mismatch.

## 21. Notifications summary

| Event | Recipient | Channel | Timing |
|---|---|---|---|
| Connect onboarding invitation | Instructor | Email | When system is ready and Fraser initiates onboarding |
| Unconfirmed ended lessons | Instructor | Email | Daily at 9pm Europe/London until resolved |
| Instructor reschedule | Learner | Email and SMS | Immediately |
| Instructor outcome recorded | Learner | Email | Immediately |
| Learner issue report received | Fraser | Admin alert/email | Immediately |
| Learner issue acknowledgement | Learner | Email/on-screen | Immediately |
| Learner issue report | Instructor | None automatically | Fraser controls communication |
| Automatic refund | Learner | Email | After the refund request is accepted locally/at Stripe |
| Refund failure or ambiguity | Fraser | Alert/email | Immediately |
| Payout statement | Instructor | Email | After Friday processing, including £0 weeks |
| Transfer failure | Fraser and affected instructor | Alert/email | Promptly, with accurate status |
| Stripe dispute opened | Fraser | Email/dashboard | Immediately |
| Unresolved dispute | Fraser | Email | Three days and 24 hours before deadline |
| Stripe dispute decided | Fraser | Email | When the Stripe outcome arrives |

## 22. Accounting and reporting

- The internal source-backed ledger is the primary accounting record for product decisions.
- Stripe is the external money-movement evidence and reconciliation source.
- QuickBooks is deferred until the internal system is operating correctly.
- A future QuickBooks integration may provide an independent detective control and help Fraser's accountant review where money moved.
- QuickBooks must not decide payout eligibility, calculate instructor earnings, create the source of truth or automatically repair discrepancies.
- When added, accounting export should use immutable payment, refund, fee, transfer, franchise-fee, debt and adjustment rows rather than recomputing from live bookings.

## 23. Security and Stripe integration requirements

- Use Stripe-hosted onboarding for Simon rather than collecting identity or bank information in CoachCarter.
- For new Connect-account work, use Accounts v2 with explicit responsibility configuration unless a documented Stripe compatibility constraint requires a reviewed alternative.
- Configure Accounts v2 recipient accounts with Express dashboard access for Simon and future instructors. This gives the instructor a limited Stripe-hosted view of balances, bank payouts and payout details while CoachCarter retains the agreed platform responsibility model.
- Preserve one Connect charge model across the system. The existing planned model is separate charges and transfers; do not mix it with direct or destination charges casually.
- Use Checkout Sessions for new on-session single-lesson payment collection unless an existing reviewed flow requires PaymentIntents.
- Do not use the legacy Charges API.
- Do not hardcode `payment_method_types`; manage supported methods through Stripe's dynamic payment-method settings or a payment method configuration.
- Verify every Stripe webhook signature.
- Configure the webhook to receive the connected-account events required for onboarding, capability, transfer and payout visibility.
- Store Stripe secrets only in the deployment secret store.
- Prefer separate restricted API keys with least privilege for payment, refund, Connect and reconciliation duties where operationally practical.
- Never expose a secret key, webhook secret, raw Stripe error, stack trace or environment variable to a client.
- Rate-limit public learner issue-report and payment-creating endpoints.
- Derive tenant scope and money values server-side.

## 24. Implementation sequence

### Immediate milestone — Simon interim v1 hardening

- Make Express/v1 account creation and invitation school-scoped, audit-logged and recoverable after ambiguous success without duplicate-account creation.
- Atomically establish deliberate `payouts_start_date` and `payouts_paused=true` safeguards before onboarding can make Simon eligible.
- Restrict Simon's positive v1 eligibility to post-start `chargeable` lessons with approved exact CoachCarter Stripe funding evidence; classify cash, external/Setmore, historic credit, ambiguous, pre-start and test sources as manual or £0.
- Add a read-only Fraser preview showing exact lesson/source evidence, Stripe fees, the current `weekly_franchise_fee_pence` deduction and proposed transfer.
- Preserve human handling for negative/insufficient weeks and require separate authority for onboarding, the first reviewed payout and any unattended operation.
- Add focused tenant, ambiguity, funding-classification, start-boundary, pause, preview and first-run approval tests. Do not operate the route as part of implementation.

The payout-v2 phases below remain the long-term sequence. They are inactive and are not prerequisites for the interim milestone.

### Phase 1 — Reconcile specification and current version-two groundwork

- Map each agreed rule to the existing inactive Payout v2 schema and modules.
- Identify where existing Payout v2 assumptions conflict with this specification.
- Update the technical implementation plan before production code changes.
- Preserve useful source-ingestion, fingerprint, protected-balance, idempotency and reconciliation groundwork.
- Replace conflicting earning, credit, confirmation, franchise-fee, dispute and cutoff assumptions explicitly.

### Phase 2 — Disable retired creation paths

- Disable credit/package purchase endpoints server-side.
- Remove repeated-series offer creation.
- Remove Reserved Weekly Slot creation.
- Preserve existing bookings and grandfathered credit spending.
- Add focused tests proving UI and direct API calls cannot create retired products.

### Phase 3 — Source-backed single-lesson payment ingestion

- Make every post-cutover direct payment write exact immutable Stripe evidence.
- Enforce one payment to one lesson.
- Classify pre-cutover, manual, admin-added, platform-funded and legacy-credit sources as zero-automated-payable.
- Add reconciliation and school-scope tests.

### Phase 4 — Outcome, reschedule, cancellation and refund workflow

- Build instructor outcome confirmation after lesson end.
- Add 9pm reminder digest.
- Add mandatory replacement-slot rescheduling.
- Add immediate learner notifications and issue reports.
- Implement new direct-payment cancellation/refund policy and exact customer copy.
- Preserve grandfathered-credit return behaviour only for grandfathered-credit lessons.

### Phase 5 — Percentage split, franchise fee and debt ledger

- Apply actual-fee-then-percentage calculation.
- Add franchise fee on top of the percentage split.
- Add agreement activation, Friday-noon snapshot, carry-forward and manual clearance.
- Apply oldest-debt-first allocation with dispute priority on timestamp ties.
- Produce live previews and full weekly statements.

### Phase 6 — Durable transfer, webhook and reconciliation

- Add deterministic Stripe idempotency keys.
- Persist claims before the Stripe call.
- Implement definite-failure and ambiguous-outcome state machines.
- Add connected-account webhooks and capability monitoring.
- Add first-batch approval and later automatic execution.

### Phase 7 — Disputes

- Block pre-payout disputed lessons.
- Add post-payout manual-response workflow.
- Build evidence packs, dashboard flags and deadline reminders.
- Apply lost-dispute recovery only after Stripe's final loss outcome.
- Keep dispute fees with CoachCarter.

### Phase 8 — Shadow, preflight and live cutover

- Run at least two distinct accepted shadow Friday calculations against fresh evidence.
- Reconcile every included and excluded lesson.
- Confirm Simon onboarding and agreement activation.
- Confirm Fraser and Simon configurations.
- Lock the cutover timestamp.
- Disable version-one mutation.
- Generate the first live preview.
- Obtain Fraser's explicit approval.
- Transfer, reconcile and issue statements.
- Keep all residual platform cash protected during the controlled first cycles.

## 25. Acceptance criteria

### 25.0 Interim v1 acceptance

The implementation milestone is complete only when focused tests and review prove every section 2.1 safeguard, including durable ambiguity recovery, exact school scope/audit, deliberate start date, paused-by-default onboarding, source-restricted eligibility, the read-only Fraser preview, admin-managed weekly fee, human handling of insufficient weeks and a non-bypassable first-run approval boundary. Implementation success does not itself authorise an account, invite, unpause, preview against production data or transfer.

### 25.0a Superseded payout-v2 MVP acceptance (deferred)

The following acceptance gate belongs to the preserved long-term payout-v2 beta and no longer blocks Simon's interim v1 route.

The MVP may enter the controlled beta only when all of the following are true:

- Fraser and Simon each have one exact, school-scoped Accounts v2 recipient identity with current readiness evidence and an immutable active agreement; ambiguity never creates a replacement account.
- Only post-cutover direct single-slot payments can produce a positive automated earning. Every other source or origin is deterministically £0/manual or blocked.
- An explicit eligible instructor outcome, exact payment/fee/availability evidence and all normal tenancy/auth predicates are required before lock.
- The split, Simon £90 weekly fee, Fraser £0 fee, carry-forward, £0/held statements and protected-cash calculation reconcile in integer pence.
- Refunds, issues, disputes and ambiguous money states cannot be auto-executed or waived into eligibility; the affected lesson/run follows the documented manual hold and review procedure.
- A privileged operator can generate the Friday-noon plan, Fraser can approve its exact fingerprint, and the same locked plan can be submitted at the intended Friday transfer window without recalculation.
- Transfer intent, claim and idempotency evidence exists before Stripe; definite failure and ambiguity retain the original identity and cannot cause a duplicate.
- Version-one mutation hard-refuses for the cut-over school while version-two is active.
- Two distinct shadow Fridays are accepted before cutover, and the first four live Friday runs require explicit Fraser approval, exact reconciliation and signed review.
- Focused money/auth/tenancy/browser tests, full regression, migration diagnostics, pause/rollback rehearsal and staging test-mode end-to-end evidence are green with no unresolved mismatch.

Sections 25.1–25.8 describe the full target acceptance. Criteria relating only to deferred origins, automatic refund submission, learner issue automation, automated dispute lifecycle, automatic reminders/delivery, bank-arrival correlation or unattended scheduling are post-MVP acceptance criteria.

### 25.1 Payment and source safety

- A post-cutover £55 payment with a £1.03 fee and 90% instructor share produces £48.57 instructor share and £5.40 CoachCarter share.
- A discount uses the actual discounted Stripe amount.
- A current rate change cannot alter an existing payment or rescheduled lesson.
- A pre-cutover payment produces no automated earning.
- Every legacy-credit lesson produces no automated earning.
- Admin-added, platform-funded and off-system payments produce no automated earning.
- Missing fee evidence blocks rather than assuming zero.
- A direct API call cannot buy new credit, create a repeated offer or create a Reserved Weekly Slot.
- A practical test-date Stripe checkout is eligible only when it proves one payment to one 90-minute lesson and passes every normal predicate.

### 25.2 Confirmation and lifecycle

- Confirmation is unavailable before lesson end.
- An unconfirmed lesson remains unpaid across any number of weeks.
- A confirmation after Friday noon enters the following week.
- Delivered and late-cancel/no-show outcomes are payable.
- Instructor-caused non-delivery creates no earning and a full refund.
- Reschedule requires a real replacement date and time and keeps the same instructor and original financial basis.
- No learner approval is required.

### 25.3 Refunds

- A 48-hour-or-more learner cancellation refunds actual paid price less the exact attributed Stripe fee.
- An under-48-hour learner cancellation creates no refund and remains payable.
- An instructor cancellation refunds the full actual payment and CoachCarter absorbs the fee.
- The learner sees the exact gross, fee and refund before confirming.
- Customer copy says 5–10 business days and contains neither the 24-hour promise nor reversal wording.
- A repeated refund request cannot create a second Stripe refund.
- An ambiguous result blocks and reconciles with the same identity.

### 25.4 Learner issue reports

- Every instructor outcome notifies the learner and includes a report link.
- Reporting does not become an approval step.
- A pre-noon Friday report blocks the lesson.
- A post-noon Friday report does not alter the locked batch.
- The learner receives the agreed acknowledgement without “paused” wording.
- The instructor receives no automatic report notification.
- The report and resolution are school-scoped and auditable.

### 25.5 Franchise fee

- Simon is charged £90 per active agreement week, including a partial first week and zero-earning weeks.
- Fraser is charged £0.
- A Friday-noon configuration value is snapshotted and cannot be edited historically.
- A £30 instructor share against a £90 fee transfers £0 and carries £60.
- Oldest debt is cleared first; a same-time dispute debt wins the tie.
- Manual clearances capture amount, date, method, evidence and note.
- Every instructor with an active commercial agreement receives a statement even when the transfer is £0.

### 25.6 Transfer durability

- Duplicate cron/admin requests cannot create duplicate batches or transfers.
- A definite rejection leaves earnings claimed and unpaid for same-key retry.
- An ambiguous response never releases claims or generates a new transfer identity.
- Reconciliation attaches an existing Stripe transfer when one exists.
- A successful transfer is labelled “Transferred to Stripe,” not bank paid.
- One earning and one booking can appear in at most one completed payout.
- A temporarily unready instructor account creates a protected held payable and does not block ready instructors.
- Releasing a held payable uses the original locked amount without repricing or reconfirmation.

### 25.7 Disputes

- A pre-payout dispute blocks the lesson.
- A post-payout open dispute does not temporarily reduce the instructor's next payout.
- A won dispute leaves the instructor payment untouched.
- A lost dispute creates at most the instructor's original share as a future-payout recovery.
- A partial final loss recovers the half-up rounded proportional part of the original instructor share, never the disputed gross amount by itself.
- CoachCarter absorbs all Stripe dispute fees.
- Evidence, immediate alert, dashboard deadline, three-day reminder, 24-hour reminder and outcome email are produced exactly once despite webhook replays.

### 25.8 Tenancy, security and audit

- Every source, booking, earning, statement, debt, refund, dispute and transfer read/write is scoped by authenticated `school_id`.
- Cross-school identifiers are rejected.
- Webhook signatures are verified before mutation.
- Client amounts and Stripe identities cannot override server evidence.
- All financial mutations are audit-logged.
- Historical ledger rows cannot be edited or deleted through admin APIs.

## 26. Production preflight checklist

Before any separately authorised Simon interim v1 onboarding or payout operation:

- [ ] The focused v1 hardening code and tests are reviewed and merged.
- [ ] Account creation ambiguity cannot create a second identity; the retained v2 test shell is untouched and is not the Production v1 identity.
- [ ] Exact school scope and audit evidence pass for account/invite operations.
- [ ] Simon has a deliberate `payouts_start_date` and remains `payouts_paused=true`.
- [ ] The preview classifies cash, external/Setmore, historic credit, pre-start, ambiguous and test sources as manual or £0.
- [ ] Every positive line proves exact approved CoachCarter Stripe funding and `chargeable` status.
- [ ] The preview shows exact lessons, funding, Stripe fees, current `weekly_franchise_fee_pence` and proposed transfer.
- [ ] Fraser gives separate explicit authority for the exact operation. First-run approval does not enable unattended payouts.

Before a future payout-v2 beta, the deferred checklist below applies:

- [ ] The approval-controlled MVP boundary in section 2.1 is reflected in runtime gates and operator runbooks; every deferred mutation path is disabled.
- [ ] Only direct single-slot payment origins are allowed into automated MVP earnings.
- [ ] Automatic refund, issue, dispute, reminder, statement-delivery, bank-correlation and unattended scheduling gates are disabled or absent.
- [ ] A manual hold procedure exists for refunds, issues, disputes and ambiguous payment/transfer evidence, with no ordinary-admin eligibility override.
- [ ] Fraser approval is required for every beta run and cannot be bypassed by cron or a generic admin action.
- [ ] The first four live-run review records and the separate post-MVP automation decision are represented explicitly; success of one run does not enable automation.

For the beta, unchecked items below that relate solely to a capability explicitly deferred in section 2.1 do not block launch. They become mandatory before that capability is later enabled; all shared safety, accounting, Connect, transfer, cutover and regression items remain mandatory.

- [ ] Latest `main` and production schema have been inspected.
- [ ] This product specification and the technical Payout v2 plan agree.
- [ ] All conflicting old rules are explicitly migrated or disabled.
- [ ] New credit purchase APIs are server-disabled.
- [ ] Repeated offers and Reserved Weekly Slot creation are disabled.
- [ ] Existing legacy-credit balances remain spendable and returnable.
- [ ] Cutover timestamp is recorded immutably.
- [ ] Version-one payout mutation is disabled for the cut-over school.
- [ ] All pre-cutover and legacy sources calculate £0 automated earning.
- [ ] Simon's pre-cutover Laura and September lessons are marked for manual handling without editing historical financial rows.
- [ ] Simon's Connect account uses reviewed responsibility settings and is fully onboarded.
- [ ] Simon and future instructor recipients use Express dashboard access.
- [ ] Simon's agreement is activated with 90% share and £90 weekly franchise fee.
- [ ] Fraser's weekly franchise fee is £0.
- [ ] Friday noon and 2pm schedules have Europe/London DST tests.
- [ ] Payment, fee and funds-availability evidence reconciles with Stripe.
- [ ] Webhook endpoint receives and verifies platform and required connected-account events.
- [ ] Restricted-key permissions and secret storage have been reviewed.
- [ ] Transfer idempotency and ambiguous-response drills pass.
- [ ] Connect-not-ready held-payable creation and later release drills pass without blocking ready instructors.
- [ ] Refund idempotency and Stripe-success/local-ledger-failure drills pass.
- [ ] Learner issue-report cutoff tests pass.
- [ ] Dispute webhook replay and deadline-reminder tests pass.
- [ ] Weekly franchise-fee, carry-forward and manual-clearance tests pass.
- [ ] At least two distinct Friday shadow comparisons have been accepted.
- [ ] No unresolved transfer, refund, dispute or reconciliation incident exists.
- [ ] The first Fraser-and-Simon batch preview has been reviewed.
- [ ] Fraser gives explicit approval before the first live transfer.
- [ ] Post-transfer local and Stripe reconciliation passes before automatic weekly runs are enabled.

## 27. Deferred scope

The following are deliberately deferred:

- QuickBooks integration;
- automatic submission of Stripe dispute evidence;
- automatic direct debit or bank collection of instructor debt;
- a separate franchise-fee invoice;
- learner approval of instructor outcomes;
- a second admin-specific confirmation override;
- instructor-facing learner dispute messages or private report content;
- instructor self-service payout discrepancy flags;
- new learner credit purchases or packages;
- repeated-series offers;
- new Reserved Weekly Slots;
- cross-instructor rescheduling;
- bank-paid status without exact Stripe payout evidence;
- retrospective automation of pre-cutover, manually paid or legacy-credit lessons.

The following full-target capabilities are additionally deferred from the approval-controlled MVP, while their design remains in this specification:

- automatic original-method refund submission and refund reconciliation;
- learner self-service issue reporting and automated outcome notifications;
- daily unresolved-outcome reminders;
- automated dispute ingestion, deadline reminders, evidence workflow and final-loss recovery;
- unattended Friday lock/transfer cron and automatic catch-up;
- automatic statement email delivery and connected-bank-arrival correlation;
- practical-test-date, single-offer and captured-request automated earning origins;
- polished end-user operational dashboards beyond the minimum safe readiness, outcome, statement, approval and reconciliation surfaces; and
- any automatic weekly execution after the four-run approval-controlled beta.

## 28. Reference documents

- [`docs/payout-v2-implementation-plan.md`](payout-v2-implementation-plan.md) — existing inactive technical groundwork; must be reconciled with this newer product specification.
- [`docs/payout-v2-cutover-runbook.md`](payout-v2-cutover-runbook.md) — existing controlled-cutover safeguards.
- [`docs/payout-v2-rollback-incident-runbook.md`](payout-v2-rollback-incident-runbook.md) — rollback and ambiguous-movement handling.
- [`docs/booking-statuses.md`](booking-statuses.md) — authoritative three-state lifecycle and 48-hour/calendar payout rule for the interim v1 route.
- [`docs/stripe-connect.md`](stripe-connect.md) — current live Connect and payout reference; conflicting fee/refund/timing rules are superseded only after approved cutover.
- [`docs/per-instructor-credits-audit.md`](per-instructor-credits-audit.md) — current grandfathered credit implementation and safety context.
- [`docs/refund-operator-runbook.md`](refund-operator-runbook.md) — current live refund operation; must be revised alongside the new automatic direct-payment refund flow.
- [`FRANCHISE-MODEL-PLAN.md`](../FRANCHISE-MODEL-PLAN.md) — prior franchise plan; its pure-franchise-fee model is superseded by the agreed percentage split plus fixed weekly fee for this implementation.
- [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers?locale=en-GB)
- [Stripe disputes on Connect](https://docs.stripe.com/connect/disputes?locale=en-GB)
- [Stripe refunds](https://docs.stripe.com/refunds?locale=en-GB)
- [Stripe UK pricing](https://stripe.com/gb/pricing)
