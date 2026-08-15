# Full Curriculum consumer-rights and manual-refund specification

Status: Fraser owner-certified product policy; repository implementation only; activation remains a separate controlled action

Policy version: `full-curriculum-consumer-rights-v1`

Disclosure version: `full-curriculum-checkout-disclosure-v1`

Calculation version: `full-curriculum-refund-v1`
Reviewed against official sources: 15 August 2026

This is an implementation and operating specification, not formal legal, tax or data-protection advice. Fraser has elected to follow the cited official guidance without professional sign-off and has recorded that decision in [`full-curriculum-owner-self-certification-v1.md`](full-curriculum-owner-self-certification-v1.md).

## 1. Launch decisions

The approved default is:

- Give the learner a contractual 14-day cancellation period calculated in the school's IANA timezone. It ends at the end of the fourteenth day after the contract day; the stored database timestamp is the following local midnight as an exclusive boundary.
- Default to no service during that period. Matching starts after it and the seven-day matching promise runs from then.
- Offer an optional, unticked request to start during the cancellation period. Record the exact disclosure, terms and policy versions, selected choice, timestamp and learner actor in durable, hashed evidence.
- Value only evidenced teaching opportunities and completed assessments. Matching, administration and the original Stripe fee have zero customer-deductible value.
- Freeze all teaching and assessment values in the immutable purchased product version. Never use current catalogue values or client input for a refund.
- Refund to the original payment method. CoachCarter absorbs the non-returned original Stripe processing fee.
- Keep provider execution manual in the Stripe Dashboard for the first pilot. The application calculates, reviews, approves and records the result, but never calls Stripe's Refund API.
- Require two different authorised admins for financial review and approval. All actions are school-scoped, append-only or additively corrected, audited and idempotent.
- Restrict the initial pilot to adults and one explicitly allowlisted verified learner. Send an awaited durable confirmation containing the exact purchased terms before matching can begin.

Purchasing remains fail-closed until the owner-certified prospective Full Curriculum version and controlled-pilot access requirements are present. Existing purchases or synthetic pilot evidence must never be rewritten.

## 2. Confirmed legal baseline

The implementation follows this statutory baseline, while recognising that only a court can determine disputed facts:

- A distance service contract normally has a 14-day cancellation period. Under regulation 30 of the Consumer Contracts (Information, Cancellation and Additional Payments) Regulations 2013, it ends 14 days after the contract is entered into.
- Service should not start during that period without the consumer's express request. If the consumer cancels after a properly requested early start, regulation 36 permits a proportionate payment for what was supplied up to cancellation, calculated from the total agreed price unless that price is excessive.
- If the required cancellation/cost information or valid early-start request is absent, the consumer does not bear that early-service cost. Full performance can end the cancellation right only after the required request and acknowledgement.
- Reimbursement is generally due without undue delay and no later than 14 days after the trader is informed, using the same payment method unless the consumer expressly agrees otherwise, and without a consumer fee (regulation 34).
- Services must be performed with reasonable care and skill under section 49 of the Consumer Rights Act 2015. Statutory remedies cannot be removed by these commercial rules.
- Terms and notices must be fair and transparent. The CMA warns against disproportionate exit charges, keeping prepayments where no benefit was received, and preventing cancellation where the trader is in breach.

These are the system's minimum protections, not a limit on any stronger statutory remedy that applies to the facts.

## 3. Approved commercial policy

| Situation at effective cancellation time | Classification | Customer deduction | Refund result |
|---|---|---|---|
| Before matching; no early-start request; still in cooling-off | Cooling-off cancellation | None | All unrefunded purchase money |
| Matching began on a valid early-start request; no teaching/assessment supplied; still in cooling-off | Cooling-off cancellation | None | All unrefunded purchase money |
| Teaching or assessment supplied on a valid early-start request; still in cooling-off | Cooling-off cancellation | Frozen value of evidenced supplied teaching and completed assessments only | Remaining purchase money |
| A learner misses or cancels a week during cooling-off | Cooling-off cancellation | Do not treat the missed/late-cancelled week as supplied service | As above, based only on actually supplied services |
| Seven-day matching deadline expires without an accepted match/start | Matching failure | None, including no admin or fee deduction | All unrefunded purchase money |
| CoachCarter/instructor cannot fulfil before any delivery | Provider non-fulfilment | None | All unrefunded purchase money |
| CoachCarter/instructor cannot fulfil after some delivery | Provider non-fulfilment | Frozen value of evidenced delivered teaching/completed assessments only; manual fairness/remedy review | Remaining money, subject to any stronger legal remedy |
| Learner withdraws after cooling-off, before delivery | Voluntary withdrawal | None | All unrefunded purchase money |
| Learner withdraws after teaching begins | Voluntary withdrawal | Frozen delivered values plus valid post-cooling late-cancelled base opportunities | Remaining money |
| Learner withdraws after assessment activity | Voluntary withdrawal | Completed assessments only; readiness/admin activity has no value | Remaining money |
| Evidence, ownership, chronology, amount or provider outcome is inconsistent | Manual review/dispute | No automated assumption | Stop and investigate |

A standard delivered base opportunity is one recorded 90-minute Full Curriculum weekly opportunity with trusted `used` evidence. A post-cooling learner cancellation under the existing 48-hour rule uses `used_late_cancel` and consumes that opportunity; CoachCarter owes no replacement. A cancellation with at least 48 hours' notice releases the opportunity according to the existing programme rules. This does not alter Lesson Credit, booking, BCS, earnings or payout behaviour.

Retake teaching uses the evidenced 90- or 120-minute allocated booking duration and the existing bounded retake allowance. An assessment is deductible only when a same-school assessment row has a completed `assessed_at` fact. Matching, availability collection, administration, readiness review and incomplete assessment activity are always £0 deductions.

## 4. Frozen valuation and arithmetic

Every prospective product version must provide positive, explicitly approved pence values for:

- base teaching per 90 minutes and a base-teaching cap;
- retake teaching per 90 and 120 minutes and a combined retake cap;
- each completed assessment and an assessment cap.

All component caps must fit within the price actually paid, and their sum must not exceed that price. Matching/admin and Stripe-fee customer deductions must be exactly zero.

For owner-certified version `full-curriculum-owner-certified-v1`, the values are £60 per base 90 minutes capped at £1,440; retake teaching at £60 per 90 minutes or £80 per 120 minutes capped at £400; and £50 per completed assessment capped at £150. Total maximum deductions are £1,990.

The server calculates:

`refund due = price actually paid - earlier successful refunds - permitted frozen deductions`

The result is floored at zero. Values are integer pence. Each line is quantity multiplied by its immutable unit value and then limited by its immutable component cap; the final total is limited by the remaining cash. There are no client-side money inputs and no floating-point pounds. The request-time evidence counts, calculation inputs, lines, caps, version, result and SHA-256 fingerprint are retained.

The first review must compare the calculation with Stripe's original PaymentIntent and fee evidence. The fee is recorded for reconciliation only and must not reduce the learner's refund.

## 5. Customer wording

Checkout acknowledgement:

> I have read the Full Curriculum terms, cancellation policy and withdrawal calculation supplied at checkout.

Adult declaration, separate and unticked:

> I confirm that I am 18 or over.

Default start choice:

> I want matching to begin after my 14-day cancellation period. The seven-day matching deadline will run from that date.

Optional early-start request:

> I expressly ask CoachCarter to begin matching and, if arranged, provide teaching and assessment services during my 14-day cancellation period. I understand that if I cancel after services have been supplied, CoachCarter may deduct the proportionate value of those services using the values in my purchased terms. Matching, administration and Stripe fees have no deductible value. I lose my cancellation right only if the entire programme is fully performed during that period.

The early-start option must be unticked by default and separate from terms acceptance. The final payment control must state `Pay £[exact amount] and enrol`.

Cancellation/withdrawal receipt wording:

> We have recorded your cancellation or withdrawal immediately and stopped further programme activity. We will calculate any refund from your purchased terms and the teaching and assessment evidence recorded when we received your request. Matching, administration and Stripe fees are not deducted. A team member will review the calculation and contact you. Any refund will normally go to the original payment method.

## 6. Evidence and application contract

Migrations 048-049 add school-scoped evidence for:

- the checkout disclosure and hashes, immutable terms/policy/calculation versions, early-start choice, actor and acknowledgement time;
- contract formation, cooling-off boundary and earliest service time;
- cancellation/withdrawal request identity, source channel, received time and reason;
- immutable refund calculation snapshot and fingerprint, append-only lines and status events;
- reviewer, different approver, actual Stripe fee evidence and manually recorded provider result.
- adult declaration, one-active-learner pilot access and durable-confirmation delivery evidence containing hashes rather than the email address.

The API:

- blocks catalogue Checkout eligibility when the current Full Curriculum version lacks a valid consumer-rights allocation;
- rejects Checkout without an active same-school pilot grant, adult declaration, explicit terms acceptance, an explicit Boolean start choice and the current disclosure version;
- puts deferred-start enrolments in `cooling_off_hold`; assignment, cooling-off release and start require durable-confirmation delivery evidence and the applicable service date;
- accepts a UUID cancellation request idempotently and terminates programme activity in the same database transaction as the refund case;
- validates matching-failure timing from trusted matching evidence;
- requires a different second admin to approve;
- records a manual Stripe refund ID and success/failure, but contains no Stripe refund execution path.

This data is not Lesson Credit and must not enter `learner_credit_balances`, credit ledgers, BCS, booking-refund execution, earnings, transfers, payouts or platform-balance calculations.

## 7. Initial manual operator workflow

1. Receive a self-service, email, post or phone request and record the true received timestamp once. Reuse the same UUID for retries.
2. Confirm school, learner, programme and original PaymentIntent match. Do not retry a payment or webhook.
3. Confirm the classification, cooling/matching boundary and immutable terms version.
4. Check each teaching, late-cancellation, retake and assessment evidence line as at the received time. Escalate any inconsistency; never edit historical evidence to make it fit.
5. First admin records the actual original Stripe fee and review reason. The fee is absorbed by CoachCarter.
6. A different admin approves the exact pence amount.
7. That operator issues the exact approved partial/full refund in the Stripe Dashboard against the original payment. Do not use a different destination unless the original-method refund fails and legal/finance approve a documented exception.
8. Record the Stripe `re_...` identifier and provider success/failure in the admin page. Do not mark success from a browser return.
9. Reconcile case amount, Refund object/status, PaymentIntent, Stripe balance movement and school scope. A failed Pay by Bank refund returns funds to the Stripe balance and requires a separately approved alternative-payment process.
10. Keep purchasing disabled and escalate duplicates, amount drift, missing consent, cross-school facts, previous refunds, closed bank accounts, complaints, threatened claims or any request near the statutory deadline.

## 8. GDPR retention and minimisation

Retain the minimum facts needed to prove the contract, consent, calculation, refund, accounting and legal-claims history. Do not retain IP address, device fingerprint, raw Stripe payload, bank credentials or free-text notes in consent evidence. Restrict free-text reasons to relevant operational facts.

The learner export includes their consumer-contract, termination and refund evidence. On an approved deletion cascade, direct learner links and learner actor IDs are anonymised while financial and contract facts remain. Append-only financial evidence is not hard-deleted. Contract, consent, cancellation and refund evidence is retained for seven years from contract closure under the existing CoachCarter financial-record policy. Pilot-access records are deleted with the learner. Retention is reviewed annually. The documented low-risk DPIA screen must be revisited before minors, identity documents, profiling, automated refund decisions or a materially broader cohort are introduced.

## 9. Controlled rollout and owner checks

Fraser has accepted the owner-managed legal, tax and data-protection risk, confirmed the business is not near the VAT registration threshold, approved the customer-deduction values, and recorded the retention/DPIA decisions in the owner self-certification. Instructor/assessor payout values remain deliberately unresolved and separate from customer deductions.

Before a controlled purchase, Fraser must still verify:

- named first reviewer/second approver operators, access control and complaint/escalation ownership;
- a tested durable confirmation delivery path and a successful disposable-database migration rehearsal;
- controlled Sandbox cases for deferred start, early start, cooling cancellation, matching failure, partial voluntary withdrawal and failed manual refund recording.
- the dedicated test webhook/restricted Stripe configuration, monitored reply mailbox and one deliberately granted adult learner.

Feature activation, access grant, Checkout creation and any production migration remain separate deliberate operations. Automatic Stripe refunds remain a later, separately designed phase.

## 10. Authoritative references

- Consumer Contracts Regulations 2013: <https://www.legislation.gov.uk/uksi/2013/3134/contents>
- GOV.UK implementation guidance: <https://www.gov.uk/government/publications/consumer-contracts-information-cancellation-and-additional-charges-regulations-implementing-guidance>
- Consumer Rights Act 2015: <https://www.legislation.gov.uk/ukpga/2015/15/contents>
- CMA unfair contract terms guidance, updated 22 July 2026: <https://www.gov.uk/government/publications/unfair-contract-terms-cma37>
- CMA fair-contract summary, updated 22 July 2026: <https://www.gov.uk/guidance/writing-a-fair-contract-for-customers>
- Stripe Pay by Bank refund behaviour: <https://docs.stripe.com/payments/pay-by-bank?locale=en-GB>
- ICO storage limitation: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/>
- GOV.UK VAT registration threshold: <https://www.gov.uk/register-for-vat/when-register-for-vat>
- ICO DPIA screening: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/>
