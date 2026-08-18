# Learner Packages Product Decision Record

Status: Full Curriculum controlled-pilot foundation and owner-certified consumer-rights policy implemented in code; migrations/configuration not applied and purchasing remains disabled
Date: 2026-08-15
Proposed learner route: `/learner/packages.html`

This document records the product decisions from the learner Packages interview. The attached 13 August 2026 implementation request separately authorised the scoped production code, additive migration and tests in test mode only; it did not authorise migration execution, Stripe configuration, live payments, deployment or rollout.

### Revised Full Curriculum implementation record (2026-08-13)

Migration 046 and the application changes now implement the approved test-mode foundation:

- Phase 1/2/3 stable identities and historical versions are retained, while their product rows are prospectively inactive/hidden and the catalogue presents them only as internal Full Curriculum progress stages.
- Full Curriculum receives a new immutable Â£2,000 pilot version. Flexible 30 Hours and Manoeuvres remain visible but cannot checkout or fulfil in this slice.
- Learners supply only a future test date, time and centre. Admins manually verify or reject the record with an audited reason; no document upload, licence data, screenshot or booking-reference storage was added.
- Full Curriculum eligibility requires the verified same-school future first-test record and no active enrolment. Prices, product/version/terms, tenant, learner, Stripe mode, amount, currency, Checkout/PaymentIntent and dedicated Payment Method Configuration identities remain server/provider-authoritative.
- Verified paid webhook evidence atomically creates exactly one immutable purchase and one unstarted `paid_matching` enrolment with its seven-day matching deadline and original first-test evidence. It creates no programme weeks. A same-school instructor or admin separately records the agreed start, which begins the 24-week clock and creates the bounded weekly 90-minute opportunities. The success/return page only polls.
- School-scoped programme records cover actual booking allocations, weekly outcomes, independent assessments, test-date changes, audited extensions, one-retake activation, a movable DVSA/exception window and append-only 90/120-minute consumption capped at 600 minutes. No general Lesson Credit is created.
- Learner, admin and instructor surfaces expose the minimum test flow, and GDPR export/anonymisation covers the new learner-linked evidence.

Migration 047 adds the approved matching slice: webhook fulfilment creates a pending matching record; admins assign/reassign active same-school instructors; ordinary instructors can accept/assign only themselves; initial assignment is retained while rotations are append-only. Agreed recurring availability is stored as versioned weekday/local-time windows with an IANA timezone and no minimum window count. Start requires the current instructor plus an availability version for that instructor and atomically records the matching transition, programme boundary, weekly opportunities and progress evidence.

### Programme-start guardrail record (2026-08-15)

- Normal programme start requires acceptance by the current assigned instructor. Admin authority no longer silently treats `assigned` as equivalent to `accepted`.
- An authorised admin may use an exceptional override only by sending the exact Boolean `instructor_acceptance_override: true` with the required audit reason. The effective override is recorded in both the start audit and append-only programme progress evidence; ordinary instructors cannot request it.
- The 24-week cap, initial weekly opportunities and later extension weeks are generated in the school's validated IANA timezone. An agreed Monday 10:00 Europe/London boundary therefore remains 10:00 after the clocks change, even though the corresponding UTC instant changes.

### Consumer-rights and manual-refund record (2026-08-15)

- Migration 048 and the application code record versioned checkout disclosure, explicit unticked early-start choice, contract/cooling timestamps, cancellation requests and immutable refund calculations.
- Deferred-start purchases remain in `cooling_off_hold`; matching and the seven-day promise begin only after the exclusive 14-day boundary. A valid optional early-start request permits the existing matching/start workflow to begin sooner.
- Full Curriculum Checkout is additionally fail-closed until a prospective product version contains complete approved purchase-price allocations for base teaching, retake teaching and completed assessments. No values are inferred or hardcoded.
- Matching/admin and the original Stripe fee have zero learner-deductible value. CoachCarter absorbs the fee. The initial workflow requires first review, a different second approver, and manual original-payment-method execution in the Stripe Dashboard.
- The application does not call Stripe's refund API. It records a manual Refund identity/outcome for reconciliation and does not alter Lesson Credit, booking refund, BCS, earning, payout, Connect or platform-balance behaviour.
- The controlling specification is [`docs/full-curriculum-consumer-rights-refund-spec.md`](full-curriculum-consumer-rights-refund-spec.md). Fraser elected to proceed on cited official guidance without professional sign-off; the accepted values, below-VAT-threshold statement, retention policy and DPIA screen are recorded in [`docs/full-curriculum-owner-self-certification-v1.md`](full-curriculum-owner-self-certification-v1.md).

The implementation still creates no automatic/provider refund, instructor earning, Stripe Connect transfer, payout, flexible-hours fulfilment, Manoeuvres fulfilment/reward, test-document storage, automated DVSA verification, third-attempt protection or live Stripe behaviour. Both feature flags remain absent/off unless separately enabled. Migration 049 prospectively records the approved allocation, adult declaration and one-active-learner pilot gate; it is inert until separately applied and grants nobody access.

### Phase 1 implementation record (2026-08-13)

Phase 1 implements only the strict-feature-flagged catalogue and comparison surface described in section 9:

- `package_products` supplies stable school-owned identities, visibility, ordering, activation, and same-school prerequisite links;
- `package_product_versions` supplies immutable numbered prices and customer-facing catalogue content with effective dates;
- `/api/packages?action=catalogue` returns only active, visible, currently effective products for the resolved school when `schools.config.features.learner_packages_enabled === true`;
- admin controls create prospective versions and change product visibility/order/activation, with school scope and audit entries;
- `/learner/packages.html` is public comparison UI, while Phase 2 and Phase 3 show locked prerequisite explanations because no independent package-assessment evidence exists yet;
- all purchase buttons are disabled and the response declares `checkout_available: false`.

This slice creates no purchase attempts, Stripe Checkout, payment fulfilment, hour/session sources, course enrolments, assessments, booking allocations, refunds, Challenge evidence/rewards, earnings, or payout behaviour. The feature flag defaults off. Section 10 remains authoritative for later phases.

### Phase 2 implementation record (2026-08-13)

Phase 2 implements the durable test-payment boundary described in section 9:

- migration 045 adds school/learner/product-version-scoped `package_purchase_attempts`, durable signed-event receipts, and append-only status evidence with immutable commercial/provider identity;
- a second exact Boolean, `learner_package_purchasing_test_enabled`, defaults absent/off and must be enabled separately from catalogue visibility;
- verified same-school learners can create a server-priced Checkout attempt with only product identity and a browser client-request UUID; the database attempt exists before the single explicitly idempotent Stripe request;
- the package Stripe client fails closed unless its dedicated test restricted key and Payment Method Configuration are present, and automatic provider retries are disabled so ambiguous responses go to human review rather than creating a replacement;
- `/api/package-webhook` uses a separate signing secret, verifies raw bytes before database access, rejects live events, durably deduplicates event IDs, validates exact provider evidence, tolerates reordering and late success, and creates no fulfilment;
- the learner return flow only polls owned school-scoped attempt status; admin diagnostics are read-only and never guess or repair uncertain money state;
- retained attempt evidence is included in GDPR export and its learner link is one-way anonymised on deletion.

No Stripe Payment Method Configuration, restricted key, webhook endpoint, environment value, production flag, or database migration was created/applied as part of this repository implementation. Those remain explicit external operations. The purchasing flag therefore remains off and the code creates no package entitlement, hours, enrolment, booking allocation, assessment, refund, reward, earning, transfer, or payout. Phase 3+ and all live/production behaviour still require separate approval.

### Commercial revision (2026-08-13)

The interview subsequently simplified the guaranteed-course proposition:

- Phase 1, Phase 2, and Phase 3 are not separately purchasable products.
- They remain internal curriculum, progress, and independent-assessment stages within one Full Curriculum programme.
- The Full Curriculum programme starts at £2,000 and requires the learner to have a valid, verifiable DVSA practical car test booking.
- It provides one 90-minute lesson per programme week until the first test date recorded at enrolment, with an absolute maximum of 24 programme weeks.
- If the learner fails that first attempt, the programme provides up to 10 additional instructor-led lesson hours for preparation for one retake.
- A learner-requested postponement does not automatically extend the weekly entitlement. DVSA-caused changes and exceptional circumstances may receive a recorded admin-approved extension.

This revision supersedes the earlier phase-by-phase price, purchase, prerequisite, upgrade, and customer-facing locked-phase rules elsewhere in this record. Existing catalogue versions and implementation evidence are not deleted or silently repurposed; migration 046 prospectively deactivates the superseded phase products and creates the revised immutable Full Curriculum version.

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
- **Packages:** choose flexible prepaid hours, the structured Full Curriculum programme, or the Manoeuvres product.
- The two pages should link clearly to each other.
- An instructor may refer one learner to the standard Packages page from the existing offer modal. This is a catalogue referral, not a bespoke product offer: the instructor cannot choose or override a package price, terms, entitlement or checkout eligibility, and sharing the link creates no purchase attempt or financial row.

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
| Repeat purchases | Existing spendable Flexible Hours must reach zero before another Checkout can start |
| Transfer | Cannot be transferred or gifted to another learner |
| Refund | Unused hours refundable pro rata at the purchase's frozen £55 hourly rate, subject to statutory rights and final fee-policy review |

Although the learner sees hours, the safest internal unit is 30 minutes. One purchase creates 60 half-hour units. This avoids decimal arithmetic while enforcing the agreed product rule.

Purchases remain separate immutable sources. The ordinary purchase path requires the current spendable balance to reach zero first; the ledger still consumes FIFO so returned historical hours and late provider success remain safely reconstructable if exceptional sources coexist.

### 2.2 Full Curriculum programme

| Decision | Launch rule |
|---|---|
| Introductory pilot price | £2,000 |
| Entry requirement | A valid, verifiable DVSA practical car test booking belonging to the learner |
| Included weekly teaching | One 90-minute lesson per programme week |
| Base end date | The first-test date recorded and verified at enrolment |
| Absolute base limit | 24 programme weeks / 36 scheduled lesson hours |
| Instructor | CoachCarter may rotate eligible same-school instructors |
| Internal pathway | Phase 1, Phase 2, and Phase 3 progress stages with independent assessment gates |
| Retake protection | Up to 10 additional instructor-led lesson hours after a failed first attempt, for one retake |

Programme rules:

- The learner provides recurring availability before payment, but payment does not itself confirm exact lesson dates or a named instructor.
- After webhook-confirmed payment, the enrolment enters `paid_matching`. CoachCarter has seven calendar days to agree the initial schedule; otherwise the learner may accept alternatives or receive a full original-payment-method refund.
- Payment does not start or consume the programme. A same-school active instructor or admin records the agreed programme start after matching; that timestamp anchors programme week 1 and the 24-week cap.
- The normal cadence is one 90-minute lesson each programme week. Unused weekly opportunities do not accumulate into a freely spendable hour balance.
- The programme ends on the verified first-test date, or after 24 programme weeks if that occurs first.
- A learner-requested postponement does not automatically create further included weeks. An admin may record an extension for a DVSA cancellation or genuine exceptional circumstance.
- The programme is not instructor-specific. Reassignment and rotation are permitted within the learner's school.
- A learner cannot hold two active Full Curriculum enrolments.
- CoachCarter must verify test-booking evidence but must not book, change, or cancel the learner's practical car test.
- The 24-week boundary makes delivery finite; it is not an unlimited-until-pass guarantee.
- The £2,000 price is a deliberate introductory first-run price. Admins may create higher prospective price versions as delivery evidence develops; active and historical enrolments retain their purchased price and terms.

### 2.3 Phase progression and independent assessment

- The teaching instructor records `ready_for_assessment`.
- A different in-house instructor performs the assessment.
- Only the independent assessor's recorded approval completes the internal phase and moves the learner into the next stage.
- If the learner does not pass, the assessor records areas for improvement.
- Further teaching continues within the programme's remaining weekly entitlement; internal phase movement does not create a new purchase or extend the programme end date.
- Internal phases appear in progress views, not as customer-facing purchasable package cards.
- Assessment activity and assessor earnings are separate from ordinary teaching lessons.
- Assessment duration and payout rate remain unresolved and must not be inferred from customer value. The owner-certified refund allocation is £50 per completed assessment, capped at £150.

### 2.4 Full Curriculum Enrolment

Full Curriculum currently includes:

- one 90-minute lesson per programme week until the verified first-test date, capped at 24 programme weeks;
- internal teaching and progress through Phases 1, 2, and 3;
- Test Ready Manoeuvres;
- required independent assessments and reassessments;
- up to 10 additional instructor-led lesson hours after a failed first DVSA practical test, for preparation for a second attempt.

Second-attempt allowance rules:

- The learner must provide acceptable evidence of the failed first attempt and a valid booking for the second practical test.
- The allowance becomes schedulable no earlier than 28 days before the booked second test.
- It may be delivered in 90-minute or two-hour lessons, up to 10 hours in total, subject to instructor availability.
- Any unused allowance expires when the second test begins. It cannot be carried into preparation for a third attempt, refunded, transferred, or converted into ordinary Lesson Credit.
- If DVSA postpones the second test, the preparation window moves with it; hours already delivered remain used.
- A learner-requested postponement does not restore hours already used. Any exceptional extension requires a recorded admin decision.

It currently excludes:

- DVSA test fees;
- use of an instructor's car for the practical test;
- tuition beyond the base weekly entitlement and additional 10-hour second-attempt allowance;
- automatic extra weeks caused by a learner-requested test postponement.

A prior qualifying Manoeuvres Challenge reward may contribute £150 of non-cash programme credit. Refunded value cannot also reduce the price, and no payment or reward can be credited twice.

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
4. Full Curriculum shows its test-booking eligibility requirement; internal phases are explained as the programme structure, not offered for sale.
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

### 3.3 Full Curriculum

1. The learner selects Full Curriculum and signs in to the learner account that will own the programme.
2. The learner supplies test date, time, centre, appropriate proof of the booking, and recurring weekly availability.
3. The server verifies school scope, test eligibility, current product version, and absence of another active Full Curriculum enrolment.
4. The learner pays by bank before exact dates or instructors are confirmed.
5. On webhook-confirmed success, the enrolment enters `paid_matching` and the seven-day matching deadline begins.
6. After payment, a same-school instructor or admin agrees and records the programme start and initial weekly schedule with the learner. This starts programme week 1 and the 24-week clock.
7. Teaching proceeds in one 90-minute lesson per programme week from that agreed start, with same-school instructor rotation allowed.
8. A different in-house instructor records internal phase approvals or improvement areas; these stages do not trigger further checkout.
9. Base teaching ends at the recorded first-test date or 24 programme weeks, whichever comes first.
10. A failed first attempt, once evidenced, activates up to 10 additional lesson hours for preparation for one retake.

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

### 4.3 Full Curriculum programme

- `course_enrolments`: purchase, current internal phase/status, matching deadline, verified first-test date, base start/end dates, 24-week cap, current teaching context, completion/withdrawal timestamps.
- `course_test_booking_evidence`: learner-supplied booking facts, verification status, minimum necessary evidence reference, verifier, and timestamps; sensitive evidence must follow retention and access rules.
- `course_availability_preferences`: learner-supplied recurring windows, versioned when changed.
- `course_progress_events`: append-only readiness, improvement-plan, internal phase movement, pause, reassignment, test-date change, extension decision, completion, and admin decision events.
- `course_assessments`: assessor, phase, outcome, evidence/notes, timestamps; assessor must differ from the current teaching instructor.
- `course_booking_allocations`: links actual bookings to enrolment/phase and identifies teaching versus assessment activity.
- `programme_week_entitlements`: scheduled weekly opportunities and their booked, delivered, cancelled, missed, waived, or unused status; these are not general Lesson Credit.
- `programme_retake_allowances`: append-only activation and consumption of the post-failure 10-hour allowance.
- `programme_value_adjustments`: withdrawals, Challenge programme credits, and other non-hour value movements.

Accounting treatment:

- The course receipt is a school performance obligation, not learner hours.
- Teaching instructors earn per delivered/chargeable 90-minute course lesson at an admin-configured internal course payout basis.
- Assessors earn through a separately configured assessment rule.
- CoachCarter keeps the remaining course funds and bears overrun risk.
- At the maximum 24-week cadence, base delivery is 36 hours: £1,980 at the current £55 retail rate. The £2,000 introductory price intentionally provides little retail-value headroom before assessments, payment fees, overhead, or retake protection. This is an accepted pilot investment, not an accidental pricing assumption; actual delivery cost and outcomes must be measured to inform prospective price increases.
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

The owner-certified implementation policy, following the cited official guidance without professional sign-off, is:

- online service purchases receive a contractual 14-day cancellation period using the school timezone and an exclusive following-midnight boundary;
- no service begins by default; matching and its seven-day deadline begin after the boundary;
- an optional unticked early-start request is captured with exact disclosure, version, choice, learner actor, timestamp and hashes;
- cancellation during cooling-off is full unless valid early-start evidence exists and teaching or assessment was actually supplied;
- permitted deductions use only immutable purchase-price allocations; matching, admin, missed/late-cancelled cooling-off weeks and the original Stripe fee deduct £0.

See [`docs/full-curriculum-consumer-rights-refund-spec.md`](full-curriculum-consumer-rights-refund-spec.md) for the exact wording, scenario table, evidence and operator workflow.

### 6.3 Flexible package refunds

- Refund unused half-hour units at the purchase's frozen £55/hour rate.
- Lock sources during planning/execution so booking and refund cannot consume the same units.
- Write an additive source reduction and refund event; never edit the original purchase.
- The exact voluntary post-cooling-off treatment of the non-returned original Stripe fee needs final legal/commercial wording before automation.

### 6.4 Guaranteed-course withdrawal

- Learner voluntary withdrawal uses price paid minus delivered Full Curriculum teaching opportunities, valid post-cooling late-cancelled base opportunities and completed assessments at the frozen purchased allocations, floored at zero.
- Do not bill a withdrawing learner for a negative result.
- Migration 049 adds a prospective immutable owner-certified version with the approved base, retake and assessment customer-deduction values; payout values remain separate and unresolved.
- Failure to match within seven days permits a full original-method refund with CoachCarter absorbing the fee.
- CoachCarter/instructor non-fulfilment refunds all undelivered value, deducts no fee/admin/late-cancellation value and enters owner review where some service was delivered, subject to any stronger statutory remedy on the facts.

### 6.5 Manoeuvres refunds and rewards

- Each unused session is worth £50 for voluntary unused-value refunds.
- A session, cash refund, or Full Curriculum programme credit cannot consume the same value twice.
- A Challenge cash winner receives the advertised full £150 original-method refund; CoachCarter absorbs the original processing fee.
- Programme-credit reward is an append-only non-cash value adjustment.

### 6.6 Lesson cancellation

For Full Curriculum weekly bookings:

- With 48+ hours' learner notice, CoachCarter will try to rearrange the lesson within the same programme week, subject to availability.
- A rearrangement is not guaranteed and does not roll the weekly opportunity into a later week or extend the recorded programme end date.
- With under 48 hours' notice or a learner no-show, that programme week's lesson opportunity is treated as used and the instructor remains payable under the existing calendar rule.
- No additional late-cancellation fee is charged. Treating the weekly opportunity as used is the complete consequence; the learner is not penalised twice.
- If CoachCarter or the instructor cancels, the lesson must be rearranged. The programme may be extended when necessary to deliver that replacement, including beyond the recorded first-test date where the cancellation made earlier delivery impractical.
- Reasonable emergency exceptions remain available as recorded admin decisions during the pilot.
- Repeated disengagement is handled manually under the programme participation terms.

The exact late-cancellation consumption rule for the flexible 30-hour package remains to be confirmed. The existing Lesson Credit precedent would consume/forfeit the booked value under 48 hours, but this must be an explicit new-package decision before implementation.

### 6.7 Reconciliation

Reconciliation must compare, by `school_id`:

- Stripe Checkout/PaymentIntent/Charge and balance-transaction evidence;
- purchase attempts and successful purchases;
- granted versus remaining hour/session sources;
- booking allocations and returns;
- course teaching and assessment activity;
- refunds, promotional rewards, and programme credits;
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
4. Full Curriculum feature card showing the test-booking requirement, weekly cadence, 24-week boundary, internal assessment structure, and second-attempt protection.
6. Manoeuvres card with an Ordinary / Challenge choice and plain reward conditions.
7. How payment and confirmation work.
8. Refund, scheduling, transfer, and course-guarantee disclosures.
9. Link back to individual Lessons.

The page should avoid a dense pricing-table feel. It should answer three customer intents:

- `I want flexible hours` -> 30-hour package.
- `I want a structured route to my booked test` -> Full Curriculum.
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

Full Curriculum availability inputs should collect reusable weekly windows around the fixed one-lesson-per-week cadence. They are matching inputs, not guaranteed reservations.

### 7.4 States

The page/return flow needs clear, non-conflicting states:

- browsing;
- authentication required;
- Full Curriculum ineligible because test evidence is missing or invalid;
- ready for checkout;
- redirected to bank;
- confirming payment;
- payment review required;
- paid and matching;
- active;
- assessment pending;
- internal phase updated;
- programme completed;
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
- withdrawals, programme credits, rewards, and refunds;
- instructor and assessor earnings by enrolment/lesson;
- reconciliation warnings.

### 8.3 Instructor view

Instructors need only operational information:

- assigned course learners and actual bookings;
- programme week/current schedule;
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

- **Implemented in repository code (test only):** durable purchase attempts and product-specific Checkout creation.
- **Implemented in repository code (test only):** signed, idempotent webhook state processing and owned status endpoint; there is deliberately no activation/fulfilment yet.
- **Implemented in repository code (test only):** 24-hour review classification and read-only reconciliation diagnostics.
- **Implemented in automated tests:** success, unpaid/pending, failure, expiry, reordered events, late success, duplicates, ambiguous provider responses, signature/live-event rejection, tenant scope, return polling, and mobile accessibility.
- **External operation still required:** create and verify the separate test Lesson Packages Payment Method Configuration, restricted key and webhook endpoint, then supply the three dedicated environment values. No live configuration is approved.

### Phase 3: flexible 30-hour package

- Add half-hour source ledger, FIFO allocation, school-wide balance read model, and booking funding path.
- Add eligible return and pro-rata refund planning.
- Attribute chargeable bookings to the delivering instructor at the frozen package rate.
- Add source/balance/booking/refund reconciliation.

### Phase 4: Full Curriculum programme

- **Implemented in repository code, test mode only:** prospective Phase 1/2/3 product deactivation with historical identity/version retention and one revised Full Curriculum version.
- **Implemented in repository code, test mode only:** minimal test-booking facts/manual verification, immutable purchase/enrolment identity, payment-separated matching, instructor/admin-agreed programme start, bounded weekly opportunities, actual booking allocation, append-only progress/assessment, audited test/extension events and retake activation/consumption.
- **Implemented in repository code, test mode only:** signed-webhook-only transactional/idempotent fulfilment and learner/admin/instructor exercise surfaces.
- **Implemented in repository code, manual provider execution only:** cooling-off hold/early-start evidence, termination receipt, trusted server refund calculation, immutable lines/events, two-person review/approval and recording of a manually issued original-method Stripe refund.
- **Still deferred:** automatic matching/scheduling, durable confirmation delivery, teaching/assessment earning attribution, Stripe refund API execution and live rollout. Manual structured matching availability is implemented.

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
- duplicate-enrolment and verified test-booking eligibility blocks;
- server-only pricing and Challenge programme-credit calculations;
- Pay by Bank amount/currency/configuration contract;
- webhook signature, unpaid guard, idempotency, concurrent delivery, late success, failure and expiry;
- no browser-return fulfilment;
- multiple 30-hour sources, FIFO allocation, half-hour enforcement, cancellation/return, and pro-rata refund races;
- package lesson instructor attribution and payout eligibility;
- seven-day matching states and full matching-failure refund;
- instructor rotation and independent-assessor constraint;
- internal phase movement only after independent-assessor approval, without checkout or entitlement extension;
- 24-week cap, original-test-date anchoring, learner postponement, DVSA exception, first-attempt evidence, and 10-hour retake allowance;
- Manoeuvres unit refunds and cash-versus-programme-credit exclusivity;
- Challenge programme-credit anti-double-credit rules;
- GDPR export/anonymisation/retention for new learner and promotion data;
- responsive, accessible browser flows for public, logged-out, logged-in, locked, pending, success, and failure states.

## 10. Remaining decisions and launch blockers

These are the remaining product/operating decisions after the owner-certified consumer-rights policy. They do not reinstate a professional-sign-off requirement, but implementation must not guess unresolved payout values or broaden the pilot.

1. **Programme participation conditions:** concise fair conditions covering attendance, cooperation, practice, safety, missed weekly opportunities, and repeated disengagement without implying an unlimited-until-pass promise.
2. **Internal phase definition:** the minimum competency/progress record needed for Phase 1/2/3 assessment. The full curriculum content can remain deferred, but internal movement cannot be an undefined free-text decision.
3. **Assessment commercial values:** the customer deduction is resolved at £50 per completed assessment, capped at £150 in the owner-certified prospective version. Normal duration and separately configured assessor payout remain unresolved and must not be derived from that deduction.
4. **Course teaching payout:** exact admin-configurable per-lesson instructor rate and how existing commission/franchise rules consume it.
5. **CoachCarter non-fulfilment:** the owner accepts the approved default of refunding undelivered value with no fee/admin/late-cancellation deduction, subject to any stronger statutory remedy on the facts.
6. **Flexible-package late cancellation:** resolved. A learner cancellation/no-show under 48 hours consumes the exact source units allocated to that booking and leaves the booking scheduled/payable under the existing lifecycle. At 48+ hours the exact allocations return once.
7. **Voluntary refund fee treatment:** resolved for Full Curriculum and, separately in section 11, Flexible Hours: learner deduction is £0 and CoachCarter absorbs the original non-returned Stripe fee. Other products remain unresolved.
8. **Cooling-off implementation:** implemented for Full Curriculum with default hold, optional express early start, adult declaration, durable versioned evidence, awaited exact-terms confirmation and frozen delivered-service calculation. Disposable-database and email-delivery verification remain activation checks.
9. **Manoeuvres Challenge definition:** final hashtag, exact evidence, reflection criteria, any driving-performance criterion, deadlines, proof retention, registration-plate rule, reward turnaround, and eligibility exclusions.
10. **Under-18 Challenge safeguards:** final consent form, privacy notice, DPIA/safeguarding review, evidence retention, and learner withdrawal mechanism.
11. **Full Curriculum test evidence:** acceptable booking/failure evidence, evidence retention, and treatment when a scheduled first test is cancelled rather than failed. The 28-day retake window, 90-minute/two-hour lesson lengths, 10-hour cap, second-test expiry, and DVSA-postponement rule are decided.
12. **Availability form:** resolved for this slice: no minimum window count; store only agreed recurring local windows and timezone in append-only versions. Conflict resolution and automated scheduling remain deferred.
13. **Tax/accounting operation:** Fraser confirmed the business is not near the current VAT registration threshold and will monitor rolling taxable turnover. Revenue, refund liability, payment fees and delivery costs remain manual accounting records; the application makes no accounting classification.
14. **Marketing claims:** the owner-certified wording may be used for the controlled pilot. Do not introduce `guaranteed`, `win your money back` or materially different cancellation/refund claims without a new recorded review.

Commercial pricing is not a launch blocker: £2,000 is an intentionally lean introductory pilot price. Pilot reporting must still measure instructor and assessor cost, programme weeks used, first-test outcomes, retake-hour use, refunds, payment fees, and contribution margin before each prospective price review.

## 11. Flexible Hours implementation decision (2026-08-16)

Flexible Hours are a separate school-wide Learner Packages ledger, not Lesson Credit. The approved immutable offers are 15 hours for £810 (30 half-hour units at £27) and 30 hours for £1,590 (60 half-hour units at £26.50). They do not expire, cannot be transferred to another learner, and may fund a representable lesson with any active instructor in the learner's school.

Purchases remain separate immutable sources and are consumed FIFO. A learner cannot start another Flexible Hours Checkout while any spendable Flexible Hours remain; this prevents ordinary purchases at different prices from overlapping. The multi-source ledger remains necessary for returned historical allocations and valid late payment success. Every booking freezes its exact source allocations and pence contribution; the delivering instructor receives the normal booking-lifecycle attribution from that frozen value. Purchase/webhook fulfilment creates no instructor earning, transfer or payout by itself. Durations not divisible by 30 minutes, including the currently offered 165-minute lesson, fail closed pending an owner decision.

Each lesson uses exactly one funding method: school-wide Flexible Hours, instructor-scoped Lesson Credit, or Pay As You Go. Flexible Hours and Lesson Credit must never be combined on the same booking. A learner may reschedule a Flexible Hours booking with at least 48 hours' notice, including to another eligible same-school instructor. The old allocation is returned and an identical allocation is attached to the replacement booking in one transaction, preserving the original frozen value without repricing.

The statutory 14-day cancellation right is retained without a mandatory service hold. Hours become available immediately after verified payment. Checkout uses one combined terms acceptance containing the learner's express immediate-access request rather than a separate immediate-access checkbox, and stores both accepted facts in the attempt evidence. Used and properly late-cancelled units may be deducted; unused units remain refundable at each source's immutable rate. CoachCarter absorbs the original Stripe fee. Provider refunds remain manual and the application records source-scoped evidence only after the original-method refund has been completed.

Live purchasing is isolated behind exact Boolean `schools.config.features.learner_flexible_package_purchasing_live_enabled === true` and is additionally pinned to School 1. It defaults absent/false, has no admin setter, and uses dedicated live restricted-key, Pay-by-Bank-only Payment Method Configuration and webhook-secret environment identities. Browser return pages only poll owned status; a verified signed live webhook is the sole entitlement creator. See `docs/flexible-hours-packages-runbook.md`.

## 12. External payment and consumer guidance used

- Stripe Pay by Bank: <https://docs.stripe.com/payments/pay-by-bank>
- Stripe Payment Method Configurations: <https://docs.stripe.com/payments/payment-method-configurations>
- Stripe Checkout fulfilment: <https://docs.stripe.com/checkout/fulfillment>
- UK consumer-contract implementation guidance: <https://www.gov.uk/government/publications/consumer-contracts-information-cancellation-and-additional-charges-regulations-implementing-guidance>
- CMA fair-contract guidance: <https://www.gov.uk/guidance/writing-a-fair-contract-for-customers>
- ASA promotional marketing guidance: <https://www.asa.org.uk/advice-online/promotional-marketing-general.html>
- ICO children's information and marketing guidance: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/>
