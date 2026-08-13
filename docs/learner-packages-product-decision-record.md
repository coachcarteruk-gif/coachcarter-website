# Learner Packages Product Decision Record

Status: Phase 1 inert catalogue implemented; payment and entitlement phases remain unapproved
Date: 2026-08-13
Proposed learner route: `/learner/packages.html`

This document records the product decisions from the learner Packages interview. It authorises no production code, database migration, live Stripe change, or rollout by itself.

### Phase 1 implementation record (2026-08-13)

Phase 1 implements only the strict-feature-flagged catalogue and comparison surface described in section 9:

- `package_products` supplies stable school-owned identities, visibility, ordering, activation, and same-school prerequisite links;
- `package_product_versions` supplies immutable numbered prices and customer-facing catalogue content with effective dates;
- `/api/packages?action=catalogue` returns only active, visible, currently effective products for the resolved school when `schools.config.features.learner_packages_enabled === true`;
- admin controls create prospective versions and change product visibility/order/activation, with school scope and audit entries;
- `/learner/packages.html` is public comparison UI, while Phase 2 and Phase 3 show locked prerequisite explanations because no independent package-assessment evidence exists yet;
- all purchase buttons are disabled and the response declares `checkout_available: false`.

This slice creates no purchase attempts, Stripe Checkout, payment fulfilment, hour/session sources, course enrolments, assessments, booking allocations, refunds, Challenge evidence/rewards, earnings, or payout behaviour. The feature flag defaults off. Section 10 remains authoritative for later phases.

## 1. Product boundary

Packages is a deliberate new product family. It must not reactivate the retired learner self-serve Lesson Credit checkout.

Current boundaries to preserve:

- `/learner/buy-credits.html` remains a read-only view of historical Lesson Credit.
- Existing Lesson Credit remains instructor-scoped and continues to use `learner_credit_balances` and its existing ledgers.
- The new 30-hour package is school-wide and therefore needs a separate entitlement and accounting model. It must not be inserted into an arbitrary instructor's Lesson Credit balance.
- Historical credit, booking, refund, payout, offer, and Reserved Weekly Slot records remain immutable.
- Existing in-flight historical Stripe sessions continue to settle through their compatibility handlers.
- The Reserved Weekly Slot Payment Method Configuration `pmc_1TggYZIqhTSdZedSRi8AgRVd` remains isolated and unchanged.

Packages and Lessons are separate customer journeys:

- **Lessons:** choose a lesson and Pay As You Go or use eligible existing value.
- **Packages:** choose flexible prepaid hours, an outcome-guaranteed course, Full Curriculum, or the Manoeuvres product.
- The two pages should link clearly to each other.

## 2. Product decision record

All prices and commercial rules below are starting values. School admins can change future offers without changing existing purchases.

### 2.1 Flexible 30-hour package

| Decision | Launch rule |
|---|---|
| Starting price | £1,650 (£55 per hour) |
| Entitlement | 30 school-wide lesson hours |
| Instructor | Usable with any eligible active instructor in the learner's school |
| Assignment | Not permanently assigned to an instructor |
| Lesson sizes | Ordinary paid lessons in half-hour increments only |
| Consumption | Exact half-hour units used by the booked lesson |
| Custom learner rate | Does not apply; custom rates remain instructor-specific Pay As You Go rules |
| Expiry | No expiry at launch |
| Repeat purchases | Allowed without a balance threshold |
| Transfer | Cannot be transferred or gifted to another learner |
| Refund | Unused hours refundable pro rata at the purchase's frozen £55 hourly rate, subject to statutory rights and final fee-policy review |

Although the learner sees hours, the safest internal unit is 30 minutes. One purchase creates 60 half-hour units. This avoids decimal arithmetic while enforcing the agreed product rule.

Multiple purchases remain separate immutable sources. Booking consumption should be FIFO from the oldest eligible source so used and refundable value can always be reconstructed.

### 2.2 Outcome-guaranteed courses

| Product | Starting price | Outcome |
|---|---:|---|
| Phase 1 Fundamental Driving Course | £750 | Completion of Phase 1 |
| Phase 2 Intermediate Driving Course | £450 | Completion of Phase 2 |
| Phase 3 Independent Driving Course | £300 | Completion of Phase 3 |
| Full Curriculum Enrolment | £2,000 | Phases 1–3, Manoeuvres, assessments/reassessments, and second-attempt protection |

Course rules:

- The learner is buying the defined outcome, not a fixed number of hours.
- Necessary teaching continues until the learner passes the applicable independent assessment, subject to fair participation conditions.
- Normal teaching sessions are 90 minutes.
- The learner indicates a preferred pace of one or two lessons per week. This informs planning but is not an unconditional weekly guarantee.
- The learner provides several recurring availability windows before payment.
- Payment occurs before final instructor assignment or exact scheduling.
- After payment, the enrolment is `paid_matching`; no lesson is represented as confirmed yet.
- CoachCarter has seven calendar days to agree an instructor/schedule. If it cannot, the learner may accept alternatives or receive a full original-payment-method refund. CoachCarter absorbs the original Stripe fee in this CoachCarter-failure case.
- The initial schedule aims to provide up to 12 weeks of diary security. It is not a fixed course duration or a permanent claim to one slot.
- If the phase continues beyond the first 12 weeks, scheduling normally continues in the same pattern but can flex by agreement.
- CoachCarter may rotate or reassign teaching instructors. The learner is paying for the outcome, not a named instructor.
- The course does not expire automatically at launch. Genuine pauses and disengagement are handled relationally while the pilot establishes a natural policy.
- A learner cannot buy the same active guaranteed course twice.
- An active Full Curriculum enrolment blocks separate purchases for outcomes already included in it.

CoachCarter bears the cost risk if a guaranteed outcome takes longer than expected and retains the margin benefit if it is completed efficiently.

### 2.3 Phase progression and independent assessment

- The teaching instructor records `ready_for_assessment`.
- A different in-house instructor performs the assessment.
- Only the independent assessor's recorded pass completes the phase and unlocks the next phase for purchase.
- If the learner does not pass, the assessor records areas for improvement.
- Further necessary teaching and reassessments remain included without a fixed attempt limit, subject to participation conditions.
- Locked phases remain visible on the Packages page but are disabled with an explanation.
- Assessment activity and assessor earnings are separate from ordinary teaching lessons.
- Exact assessment duration, internal value, payout rate, and refund treatment are deliberately unresolved and must not be inferred as £82.50.

### 2.4 Full Curriculum Enrolment

Full Curriculum currently includes:

- guaranteed completion of Phases 1, 2, and 3;
- Test Ready Manoeuvres;
- required independent assessments and reassessments;
- up to 10 additional instructor-led lesson hours after a failed first DVSA practical test, for preparation for a second attempt.

It currently excludes:

- DVSA test fees;
- use of an instructor's car for the practical test;
- tuition beyond the additional 10-hour second-attempt allowance.

Payments for eligible individual phases count toward a later Full Curriculum upgrade. A prior Manoeuvres purchase can contribute up to £150. Refunded value cannot also reduce the upgrade price, and no payment or reward can be credited twice.

### 2.5 Test Ready Manoeuvres and Manoeuvres Challenge

Both variants start at £150 and include three directly booked one-hour specialist sessions.

The learner chooses before payment between:

- **Manoeuvres:** three sessions with no promotional obligations; or
- **Manoeuvres Challenge:** the same three sessions plus frozen qualifying tasks and a possible reward.

Current intended Challenge ingredients include:

- a photo of the CoachCarter car before or after each session, with no people visible;
- posting the photo to the learner's public story using the campaign hashtag and an appropriate reward/advertising disclosure;
- completing a reflection log after each session;
- any additional criteria finalised before launch and frozen into the purchase version.

Challenge rules:

- Participation is optional and is not required to receive the three lessons.
- The learner can stop promotional participation without losing lessons, but then cannot claim the reward.
- An ordinary Manoeuvres purchase cannot be made retroactively eligible after sessions begin without an explicit admin-reviewed reset.
- The task must not require positive praise, a scripted endorsement, or a misleading review.
- Posts must not reveal pickup addresses, regular lesson locations, test dates, or other sensitive information. Vehicle-registration treatment must be finalised in the campaign rules.
- CoachCarter cannot reuse the learner's content in its own advertising without separate permission.
- Under-18 Challenge participation requires written parent/guardian consent and the learner's affirmative choice to participate. Final safeguarding/privacy review remains required.

Every learner who meets the published criteria qualifies. There is no random winner selection.

The qualifying learner chooses one reward:

- a full £150 refund to the original payment method, with CoachCarter absorbing the original Stripe processing fee; or
- £150 non-cash payment credit toward an eligible larger CoachCarter programme.

The programme credit is not lesson-hour credit, cannot be withdrawn as cash, and can be used only once. The reward must be idempotent so cash and programme credit cannot both be claimed.

For voluntary unused-value refunds, the purchase contains three immutable £50 session units.

### 2.6 Access, ownership, and transfers

- Anyone can browse and compare Packages.
- Checkout requires a verified learner account using the existing passwordless email-code flow.
- A learner may pass their device to a parent or guardian to authorise Pay by Bank; no parent account type is required at launch.
- The entitlement belongs to the signed-in learner identified in the checkout summary.
- Refunds return to the original payment method.
- Entitlements cannot be transferred between learners.
- A wholly unused wrong-account purchase can be corrected only through a controlled, audited admin exception; otherwise refund and repurchase is the safe route.

### 2.7 Configuration and versioning

Only school admins can change package products and commercial rules. Instructors can see the applicable terms and manage teaching/progress but cannot change the school's promise.

Every successful purchase snapshots at least:

- `school_id`, learner, product, and product-version identity;
- product name and description;
- price and currency;
- flexible hours/units or guaranteed outcome;
- standard hourly basis used for package accounting and withdrawal calculations;
- prerequisite and included products;
- refund basis;
- matching and scheduling promise;
- assessment requirement;
- promotional criteria and reward choices;
- the customer-facing terms version.

Admin edits are prospective. Existing purchases never silently reprice or change entitlement. Products can be deactivated without deleting historical versions or active enrolments.

## 3. Proposed customer journeys

### 3.1 Packages discovery

1. The visitor opens `/learner/packages.html` publicly.
2. The page distinguishes Pay As You Go Lessons from Packages and links to `/learner/book.html`.
3. Products are loaded from a school-scoped server catalogue.
4. Locked phases remain visible with the assessment prerequisite.
5. The learner selects a product and sees its exact current version, price, key conditions, refund basis, and payment method.
6. A logged-out visitor completes passwordless authentication and returns to the selected product.

### 3.2 Flexible 30-hour package

1. The server revalidates the learner, school, product availability, and version.
2. Checkout shows 30 hours, £1,650 starting price, school-wide use, no expiry, transfer restriction, half-hour increments, and refund basis.
3. The learner completes Pay by Bank.
4. The return page says `Confirming your bank payment`; it does not grant hours.
5. A verified success webhook activates 60 half-hour units exactly once.
6. The learner books ordinary eligible lessons with any eligible same-school instructor.
7. Each booking consumes units from immutable sources and attributes delivery to the actual instructor.

### 3.3 Guaranteed phase or Full Curriculum

1. The learner selects the product and supplies several weekly availability windows plus a preferred one- or two-lesson pace.
2. The server enforces prerequisite and active-enrolment rules.
3. The learner pays by bank before exact dates/instructor are confirmed.
4. On webhook success the enrolment enters `paid_matching`, and the seven-day matching deadline begins.
5. Admin/instructors agree the initial schedule with the learner and create the actual bookings.
6. Teaching continues in 90-minute sessions, with instructor rotation allowed.
7. The teaching instructor requests assessment when ready.
8. A different instructor records pass or improvement areas.
9. A pass completes/unlocks the phase; a non-pass returns the learner to included teaching and later reassessment.

### 3.4 Manoeuvres

1. The learner chooses ordinary or Challenge before payment.
2. Challenge participants see and accept the frozen criteria and any required guardian-consent step.
3. Webhook success creates three one-hour session units.
4. The learner books the sessions directly rather than entering course matching.
5. Challenge evidence is recorded per session.
6. On successful completion the learner chooses cash refund or programme credit.
7. The reward is issued and recorded exactly once.

## 4. Recommended data model and accounting treatment

Names below are recommendations, not approved migrations.

### 4.1 Catalogue and purchase identity

- `package_products`: school-owned stable product identity, type, display order, active state, prerequisite relationship.
- `package_product_versions`: immutable commercial and customer-term snapshot; price, entitlement JSON, refund basis, promotion definition, effective dates.
- `package_purchase_attempts`: durable intent created before Stripe; learner/school/product version, expected GBP amount, idempotency key, status, Checkout/PaymentIntent identities, timestamps.
- `learner_package_purchases`: one paid/refunded/withdrawn purchase identity linked to the attempt and immutable version.

Every tenant-scoped table must contain `school_id`, enforce same-school foreign-key relationships where practical, and be queried with authenticated school scope.

### 4.2 Flexible hours

- `package_hour_sources`: original 60 half-hour units and frozen £55/hour value for each paid 30-hour purchase.
- `package_hour_movements`: append-only grants, booking consumption, eligible returns, cash-refund reductions, and corrections.
- `package_booking_allocations`: immutable attribution between a lesson booking and one or more package sources, including half-hour units, pence contribution, delivering instructor, and source value.

Do not reuse `learner_credit_balances` as the school-wide balance. A cached aggregate may be maintained for display only if it reconciles to the append-only source ledger.

Accounting treatment:

- A £1,650 payment creates 60 half-hour units and an unused-value liability.
- No instructor earning is created at purchase.
- When a package-funded lesson becomes chargeable, its delivering instructor receives gross lesson attribution at the frozen package rate: £55/hour, £82.50/90 minutes, £110/two hours at the starting version.
- Existing instructor commission/franchise payout rules then operate on that attributed booking value.
- Unused refundable value remains protected until consumed or refunded.
- Multiple sources are consumed FIFO.

### 4.3 Guaranteed courses

- `course_enrolments`: purchase, current phase/status, matching deadline, preferred pace, current teaching context, completion/withdrawal timestamps.
- `course_availability_preferences`: learner-supplied recurring windows, versioned when changed.
- `course_progress_events`: append-only readiness, improvement-plan, pause, reassignment, completion, and admin decision events.
- `course_assessments`: assessor, phase, outcome, evidence/notes, timestamps; assessor must differ from the current teaching instructor.
- `course_booking_allocations`: links actual bookings to enrolment/phase and identifies teaching versus assessment activity.
- `programme_value_adjustments`: upgrades, withdrawals, programme credits, and other non-hour value movements.

Accounting treatment:

- The course receipt is a school performance obligation, not learner hours.
- Teaching instructors earn per delivered/chargeable 90-minute course lesson at an admin-configured internal course payout basis.
- Assessors earn through a separately configured assessment rule.
- CoachCarter keeps the remaining course funds and bears overrun risk.
- Voluntary withdrawal refund starts as: `price actually paid - delivered instructor-led hours at the purchase's frozen standard Pay As You Go rate`, floored at zero.
- Assessment deductions must not be invented until the assessment valuation decision is made.
- CoachCarter-caused non-fulfilment and statutory cancellations use their own more learner-protective rules.

### 4.4 Manoeuvres and reward evidence

- `manoeuvres_session_units`: three £50 units per purchase, linked to bookings as used.
- `promotion_participations`: frozen Challenge version, consent evidence, eligibility and final status.
- `promotion_evidence_events`: reflection/social evidence metadata and reviewed outcome. Store the minimum personal data necessary.
- `promotion_rewards`: mutually exclusive cash-refund or programme-credit identity, idempotency key, amount and provider/ledger references.

### 4.5 Immutable financial evidence

Do not silently mutate historical purchase, allocation, refund, reward, or payout rows. Corrections are additive adjustments with reason, operator, timestamp, and audit evidence.

Existing `refund_events` and `refund_event_lines` should be extended or integrated only after the refund planner explicitly understands the new source types. Do not force new products through an old refund path by disguising their source identity.

## 5. Stripe Checkout, configuration, and webhook design

### 5.1 Checkout

- Use one-time Stripe-hosted Checkout Sessions in GBP.
- Use a new Payment Method Configuration named conceptually `Lesson Packages`.
- Configure it as Pay by Bank-only in Stripe Dashboard.
- Pass its `payment_method_configuration` ID from a product-specific environment variable.
- Do not pass `payment_method_types` in production Checkout creation.
- Do not reuse or modify the Reserved Weekly Slot configuration.
- Do not enable Stripe Bank Transfers. They are a different asynchronous/invoice product requiring customer balances and reconciliation that is outside launch scope.
- Server calculates and freezes the amount; browser sends only trusted product-selection and availability/choice inputs.
- Server rejects an unavailable, cross-school, inactive, duplicated guaranteed-course, or prerequisite-ineligible purchase before Stripe.
- Server enforces the supported amount range and blocks anything above the approved Pay by Bank limit. All starting products are below £10,000.
- Checkout metadata should contain compact trusted identifiers such as purchase-attempt ID, product-version ID, learner ID, and school ID. The database remains the full contract authority.

### 5.2 Confirmation

Customer expectation:

> Bank confirmation is normally received straight away, but please allow up to 24 hours. Your package or course activates only after Stripe confirms the payment.

The success URL never grants entitlement. It reads purchase status from CoachCarter and displays one of:

- confirming payment;
- active / paid and matching;
- payment failed or expired;
- payment review required after 24 hours.

If payment is unresolved after 24 hours:

- alert support/admin;
- tell the learner not to pay again;
- reconcile the exact Checkout Session and PaymentIntent;
- grant nothing until provider success is proven;
- permit a fresh checkout only after failure/expiry is proven.

### 5.3 Webhook fulfilment

- Verify Stripe webhook signatures against the raw request body.
- Record/claim event and purchase identities idempotently before fulfilment.
- Treat `checkout.session.completed` as fulfilment-capable only when `payment_status` proves payment.
- Also support `checkout.session.async_payment_succeeded` through the same idempotent handler.
- Handle async failure, PaymentIntent failure, and Checkout expiry without creating an entitlement.
- Re-read the trusted purchase attempt and verify mode, currency, amount, learner, school, product version, Stripe identities, and payment state.
- Activate the entitlement and financial source inside one transaction.
- A retry or concurrent success signal must return a no-op result after the first successful activation.
- A late proven success is honoured at its snapshotted product version even if the live catalogue has since changed, unless that exact payment has already been refunded.

## 6. Failure, cancellation, refund, and reconciliation behaviour

### 6.1 Payment failures

- Failed or expired Checkout creates no entitlement.
- An abandoned purchase attempt remains historical evidence and can expire without deleting it.
- Learners receive a safe retry path only after failure/expiry is known.
- Never accept a bank screenshot as payment proof.
- Never retry an ambiguous Stripe mutation under a new idempotency identity.

### 6.2 Statutory cooling-off

Final terms require legal review. The current design assumption is:

- online service purchases receive the applicable 14-day cancellation rights;
- a wholly unstarted purchase cancelled within the applicable period receives the legally required refund without deducting a Stripe fee;
- learners can request that services start during the cooling-off period, with that request recorded in a durable form;
- if services begin following that request, legally permitted delivered-service deductions may apply.

The product direction is to let learners start promptly. Implementation must provide compliant disclosure/evidence without making the learner wait by default through ambiguous wording.

### 6.3 Flexible package refunds

- Refund unused half-hour units at the purchase's frozen £55/hour rate.
- Lock sources during planning/execution so booking and refund cannot consume the same units.
- Write an additive source reduction and refund event; never edit the original purchase.
- The exact voluntary post-cooling-off treatment of the non-returned original Stripe fee needs final legal/commercial wording before automation.

### 6.4 Guaranteed-course withdrawal

- Learner voluntary withdrawal uses course price paid minus completed instructor-led teaching at the frozen standard Pay As You Go rate, floored at zero.
- Do not bill a withdrawing learner for a negative result.
- Assessment deductions remain unresolved until assessment value is configured.
- Failure to match within seven days permits a full original-method refund with CoachCarter absorbing the fee.
- Policy for CoachCarter becoming unable to fulfil after teaching begins remains a launch blocker requiring a fair, learner-protective rule.

### 6.5 Manoeuvres refunds and rewards

- Each unused session is worth £50 for voluntary unused-value refunds.
- A session, cash refund, programme credit, or Full Curriculum upgrade credit cannot consume the same value twice.
- A Challenge cash winner receives the advertised full £150 original-method refund; CoachCarter absorbs the original processing fee.
- Programme-credit reward is an append-only non-cash value adjustment.

### 6.6 Lesson cancellation

For guaranteed-course bookings, the agreed launch policy is deliberately relational:

- 48+ hours' learner notice: rearrange where practical, with no late charge.
- Under 48 hours or no-show: the instructor remains payable under the existing calendar rule.
- CoachCarter may manually request 50% of the standard Pay As You Go price for the booked duration (starting example: £41.25 for 90 minutes).
- No automated invoice, debt balance, collection workflow, or scheduling lock is built at launch.
- Admin can waive the charge for emergencies, recovered slots, or other reasonable circumstances.
- The course guarantee remains, with repeated disengagement handled manually during the pilot.

The exact late-cancellation consumption rule for the flexible 30-hour package remains to be confirmed. The existing Lesson Credit precedent would consume/forfeit the booked value under 48 hours, but this must be an explicit new-package decision before implementation.

### 6.7 Reconciliation

Reconciliation must compare, by `school_id`:

- Stripe Checkout/PaymentIntent/Charge and balance-transaction evidence;
- purchase attempts and successful purchases;
- granted versus remaining hour/session sources;
- booking allocations and returns;
- course teaching and assessment activity;
- refunds, promotional rewards, and upgrade credits;
- instructor earning/payout attribution.

Contradiction, missing fee evidence, cross-school identity, amount mismatch, duplicate reward, negative balance, or provider/local disagreement blocks automated mutation and enters manual review.

## 7. Page-level UX specification

### 7.1 Navigation

- Add **Packages** as a top-level learner sidebar item.
- Keep the fixed mobile bottom navigation unchanged.
- Add a prominent Packages link from Lessons.
- Add a prominent Pay As You Go Lessons link from Packages.
- Do not add the old generic Pricing nav item and do not repurpose `buy-credits.html`.

### 7.2 Page structure

Recommended order:

1. Header: `Choose how you want to learn`.
2. Short comparison between Pay As You Go and Packages.
3. Flexible card: 30 hours, school-wide, £1,650 starting version, no expiry.
4. Guaranteed pathway: Phase 1–3 cards with visible locked/unlocked states.
5. Full Curriculum feature card showing inclusions and second-attempt protection.
6. Manoeuvres card with an Ordinary / Challenge choice and plain reward conditions.
7. How payment and confirmation work.
8. Refund, scheduling, transfer, and course-guarantee disclosures.
9. Link back to individual Lessons.

The page should avoid a dense pricing-table feel. It should answer three customer intents:

- `I want flexible hours` -> 30-hour package.
- `I want a guaranteed stage/result` -> phase or Full Curriculum.
- `I want focused manoeuvre practice` -> Manoeuvres.

### 7.3 Product detail and checkout summary

Before checkout, show prominently:

- exact learner receiving the purchase;
- product version, price, and Pay by Bank-only method;
- what is and is not included;
- whether dates/instructor are confirmed;
- seven-day course matching promise where relevant;
- no-transfer rule;
- expiry rule (none for 30-hour package);
- refund calculation summary;
- 24-hour confirmation expectation;
- course participation/assessment rules;
- Challenge criteria and reward choice where selected;
- applicable cooling-off/start-service request.

Availability inputs for guaranteed courses should use reusable weekly windows and a one/two-lessons preferred-pace selector. They are matching inputs, not guaranteed reservations.

### 7.4 States

The page/return flow needs clear, non-conflicting states:

- browsing;
- authentication required;
- phase locked;
- ready for checkout;
- redirected to bank;
- confirming payment;
- payment review required;
- paid and matching;
- active;
- assessment pending;
- phase completed;
- withdrawn/refunded.

### 7.5 Existing frontend requirements

When implementation is approved, the page must follow current project rules:

- vanilla HTML/CSS/JS;
- `sidebar.js` and `branding.js`;
- `cookie-consent.js` and `posthog-loader.js`;
- no inline production script under the current CSP;
- server-side business rules and thin client rendering;
- accessible buttons, disabled-state explanations, focus management, and mobile-safe touch targets.

## 8. Admin and instructor operations

### 8.1 Admin configuration

Admin can create/deactivate future product versions and manage price, display, prerequisites, included outcomes, Challenge definition, and customer disclosure versions. Every mutation is audit-logged.

### 8.2 Admin reporting minimum

- purchase list by product, learner, date, amount, and payment state;
- payment confirmation exceptions and 24-hour review queue;
- course matching queue and seven-day deadline;
- active phase, teaching history, assessment readiness/results;
- remaining package/session sources and refundable unused value;
- withdrawals, upgrades, rewards, and refunds;
- instructor and assessor earnings by enrolment/lesson;
- reconciliation warnings.

### 8.3 Instructor view

Instructors need only operational information:

- assigned course learners and actual bookings;
- preferred pace/current schedule;
- applicable product terms (read-only);
- progress/readiness action;
- assessment assignments and outcome form where acting as assessor.

Instructors cannot edit prices, refund rules, guarantees, or product versions.

## 9. Phased implementation and testing plan

No phase starts until implementation is explicitly approved.

### Phase 0: commercial, legal, and accounting closeout

- Finalise the blockers in section 10.
- Obtain consumer-contract review for guarantees, cooling-off, withdrawal, late-cancellation, and refunds.
- Obtain privacy/safeguarding/promotions review for the Challenge.
- Confirm tax/VAT treatment and revenue/liability accounting.
- Set internal course-teaching and assessment payout rates.

### Phase 1: inert foundation and catalogue

- Add feature-flagged, school-scoped catalogue/version schema.
- Add admin-only version management and audit logs.
- Add public read-only catalogue and eligibility response.
- Build `/learner/packages.html` comparison UX without checkout.
- Keep old credit and retired-product routes unchanged.

### Phase 2: payment foundation

- Create the separate test/live Lesson Packages Payment Method Configuration through an approved Stripe operation.
- Add durable purchase attempts and product-specific Checkout creation.
- Add signed, idempotent webhook activation and status endpoint.
- Add 24-hour review queue and reconciliation diagnostics.
- Test success, failure, expiry, late success, duplicate events, and ambiguous responses in Stripe test mode.

### Phase 3: flexible 30-hour package

- Add half-hour source ledger, FIFO allocation, school-wide balance read model, and booking funding path.
- Add eligible return and pro-rata refund planning.
- Attribute chargeable bookings to the delivering instructor at the frozen package rate.
- Add source/balance/booking/refund reconciliation.

### Phase 4: guaranteed courses

- Add enrolment, availability preferences, matching queue, actual scheduling, instructor rotation, progress, assessment and phase-unlock flows.
- Add course lesson earning attribution using configured internal rates.
- Add withdrawals and Full Curriculum upgrades after their accounting rules are final.

### Phase 5: Manoeuvres and promotion

- Add three £50 session units and direct one-hour booking.
- Add Ordinary/Challenge version selection, consent/evidence, deterministic qualification, and mutually exclusive reward execution.
- Add programme-credit application to Full Curriculum.

### Phase 6: controlled rollout

- Enable only for CoachCarter school via a new strict Boolean feature flag such as `learner_packages_enabled`.
- Do not disable or bypass `retire_incompatible_products`; new product endpoints must have their own explicit authority and identities.
- Start with named operators and manual review of every refund/reward.
- Reconcile Stripe cash, entitlements, bookings, and instructor earnings daily during the pilot.
- Review conversion, matching success, lesson pace, course overrun, late cancellation, refund, and Challenge behaviour before widening access or automating relational policies.

### Test coverage

At minimum:

- school/learner/instructor scope and cross-school rejection;
- admin-only product mutation and immutable version snapshots;
- phase prerequisites and duplicate-enrolment blocks;
- server-only pricing and upgrade calculations;
- Pay by Bank amount/currency/configuration contract;
- webhook signature, unpaid guard, idempotency, concurrent delivery, late success, failure and expiry;
- no browser-return fulfilment;
- multiple 30-hour sources, FIFO allocation, half-hour enforcement, cancellation/return, and pro-rata refund races;
- package lesson instructor attribution and payout eligibility;
- seven-day matching states and full matching-failure refund;
- instructor rotation and independent-assessor constraint;
- phase unlock only after assessor pass;
- Manoeuvres unit refunds and cash-versus-programme-credit exclusivity;
- Full Curriculum upgrade anti-double-credit rules;
- GDPR export/anonymisation/retention for new learner and promotion data;
- responsive, accessible browser flows for public, logged-out, logged-in, locked, pending, success, and failure states.

## 10. Remaining decisions and launch blockers

These are deliberately unresolved. Implementation must not guess them.

1. **Guarantee participation conditions:** concise fair conditions covering attendance, cooperation, practice, safety, and repeated disengagement without undermining the outcome promise.
2. **Phase definition:** the minimum competency/outcome record needed for Phase 1/2/3 assessment. The full curriculum content can remain deferred, but a pass cannot be an undefined free-text decision.
3. **Assessment commercial rule:** normal duration, assessor payout, course accounting value, and whether/how it affects voluntary-withdrawal calculations.
4. **Course teaching payout:** exact admin-configurable per-lesson instructor rate and how existing commission/franchise rules consume it.
5. **CoachCarter non-fulfilment after teaching starts:** fair refund/transfer/remedy policy.
6. **Flexible-package late cancellation:** whether an under-48-hour cancellation consumes the full booked package units, a different amount, or another rule.
7. **Voluntary refund fee treatment:** final lawful wording and automation rule for non-returned Stripe fees outside statutory/CoachCarter-fault/Challenge refunds.
8. **Cooling-off implementation:** final disclosure, durable early-start request, cancellation channel, and delivered-service calculation.
9. **Manoeuvres Challenge definition:** final hashtag, exact evidence, reflection criteria, any driving-performance criterion, deadlines, proof retention, registration-plate rule, reward turnaround, and eligibility exclusions.
10. **Under-18 Challenge safeguards:** final consent form, privacy notice, DPIA/safeguarding review, evidence retention, and learner withdrawal mechanism.
11. **Full Curriculum second-attempt protection:** evidence of first test failure, when the 10 hours become available, permitted lesson durations, and any reasonable participation/time conditions.
12. **Availability form:** minimum number of recurring windows and how conflicts/changes are handled during the seven-day matching period.
13. **Tax/accounting review:** VAT status, revenue recognition, protected unused-value liability, course guarantee reserves, promotional refund treatment, and instructor earning classification.
14. **Final customer terms and marketing claims:** solicitor/consumer-law review before using `guaranteed`, `win your money back`, cancellation charges, or refund-fee wording publicly.

## 11. External payment and consumer guidance used

- Stripe Pay by Bank: <https://docs.stripe.com/payments/pay-by-bank>
- Stripe Payment Method Configurations: <https://docs.stripe.com/payments/payment-method-configurations>
- Stripe Checkout fulfilment: <https://docs.stripe.com/checkout/fulfillment>
- UK consumer-contract implementation guidance: <https://www.gov.uk/government/publications/consumer-contracts-information-cancellation-and-additional-charges-regulations-implementing-guidance>
- CMA fair-contract guidance: <https://www.gov.uk/guidance/writing-a-fair-contract-for-customers>
- ASA promotional marketing guidance: <https://www.asa.org.uk/advice-online/promotional-marketing-general.html>
- ICO children's information and marketing guidance: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/>
