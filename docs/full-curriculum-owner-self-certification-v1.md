# Full Curriculum owner self-certification v1

Status: approved policy for implementation; migration, deployment and purchasing activation remain separate controlled actions

Owner: Fraser / CoachCarter

Recorded: 15 August 2026

This record documents the owner's informed commercial and compliance decisions for the initial Full Curriculum controlled pilot. It is not legal, accounting or data-protection advice and does not claim professional approval.

## Owner decisions

- CoachCarter contracts with the learner as principal supplier for the Full Curriculum programme.
- The first pilot is adults only. Checkout requires a separate, unticked declaration that the signed-in learner is 18 or over; the pilot access list is limited to one active, verified learner per school.
- Contract formation is recorded when the signed test-mode payment is confirmed. An awaited email then supplies the exact purchased terms and cancellation information on a durable medium. Matching, cooling-off release and programme start remain blocked until delivery evidence is recorded.
- The default is to wait until the 14-day cancellation period ends. Early service requires a separate express request.
- Matching and administration have no customer-deductible value. CoachCarter absorbs the original Stripe fee.
- Refunds remain manually reviewed, approved by a different admin and issued to the original payment method in Stripe. The application does not issue a Stripe refund.
- CoachCarter is not currently VAT registered and Fraser confirmed on 15 August 2026 that taxable turnover is not near the registration threshold. The current GOV.UK threshold is £90,000. Rolling 12-month taxable turnover and the next-30-day forecast must be checked monthly and before any material sales expansion.

## Frozen customer-deduction values

These are purchase-price allocations for refunds, not instructor or assessor payout rates:

| Component | Frozen value | Cap |
|---|---:|---:|
| Base teaching opportunity | £60 per evidenced 90 minutes | £1,440 |
| Retake teaching | £60 per 90 minutes; £80 per 120 minutes | £400 combined |
| Completed independent assessment | £50 each | £150 |
| Matching and administration | £0 | £0 |
| Original Stripe fee | £0 customer deduction | £0 |

Maximum permitted deductions are £1,990, preserving at least a £10 refund from a £2,000 purchase before any earlier successful refund. The server uses immutable purchased terms and integer pence only.

## Data-protection decision

The lawful purposes are contract performance, legal obligation where applicable, and legitimate interests in proving consent, handling complaints and reconciling refunds. The flow does not collect date of birth, identity documents, IP/device fingerprints, bank credentials, raw Stripe payloads or special-category data for this evidence.

Contract, consent, purchase, cancellation and refund evidence is retained for seven years from contract closure, consistent with CoachCarter's existing financial-record policy. Learner-facing exports include the evidence. An approved deletion request removes or anonymises direct learner links and actor identifiers where they are no longer required, while the minimum financial and contract facts remain append-only. Pilot-access records are operational and are deleted with the learner. Retention is reviewed annually and after any complaint or law change.

A documented DPIA screen concluded that this one-adult, one-learner pilot is not likely to create high-risk processing: it uses ordinary account/contract facts, no special-category data, no systematic monitoring and no solely automated legal decision. Re-screen before allowing minors, broader cohorts, identity documents, profiling, automated refund decisions or materially new data sharing.

## Remaining activation checks

Before granting access or enabling purchasing, the owner must verify the migration rehearsal, focused tests, dedicated test webhook, restricted test Stripe configuration, email delivery and reply mailbox, named first reviewer/second approver, and the manual refund/reconciliation procedure. Enabling either feature flag, granting a learner access, creating Checkout or applying a production migration requires its own deliberate operation.

Official references: [GOV.UK VAT registration threshold](https://www.gov.uk/register-for-vat/when-register-for-vat), [ICO storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/), [ICO DPIA screening](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/).
