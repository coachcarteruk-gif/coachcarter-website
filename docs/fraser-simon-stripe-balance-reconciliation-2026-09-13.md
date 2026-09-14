# Fraser and Simon Stripe balance reconciliation

**Prepared:** 13 September 2026<br>
**Last live refresh:** approximately 13:44 Europe/London, 13 September 2026<br>
**Historical payout correction:** updated 13 September 2026 from the owner's lesson-level manual-payment evidence.<br>
**Purpose:** Read-only financial handover and decision record.<br>
**Scope:** CoachCarter's production Stripe platform balance, Simon Edwards's six manually paid weeks, Fraser Carter's payout position, and known learner/instructor obligations.

## Executive conclusion

The six Simon bank payments supplied by Fraser total **£3,004.20**. A lesson-by-lesson review shows that Fraser did apply Simon's 90% commission treatment to the ordinary lessons in the three disputed weeks. The earlier conclusion that Simon was overpaid £132.15 was based on an unsupported residual assumption and is withdrawn.

The corrected position is:

- **Cash actually advanced to Simon:** £3,004.20.
- **Previously alleged overpayment:** £0.00; the £132.15 finding is no longer supported.
- **Confirmed Laura Thomas underpayment:** £2.16.
- **Cash cost after correcting Laura:** £3,006.36, assuming no other line correction.
- **Esha Sharma legacy rate:** agreed at **£46.77 per hour**, including future lessons funded from that legacy purchase.
- **Six weekly franchise fees:** £540.00.
- **Genuine 10% commission:** £218.77.
- **Esha legacy-rate margin:** approximately £4.59.
- **Ten free-trial delivery payments:** £300.00.
- **CoachCarter contribution after those free-trial costs:** approximately £463.36, before tax and other operating expenses.
- **Free-trial cohort result to date:** 7 of 10 learners converted; 27.0 paid hours were delivered; the cohort produced **£145.59 of realized CoachCarter commission** against its £300 acquisition cost, so cohort payback is **48.5%** and the realized campaign contribution is **-£154.41**. This cohort-only result excludes the six £90 franchise fees.
- **Amount currently certified safe to reimburse or withdraw:** £0.00 because the protected-balance preflight remains blocked.

The three disputed bank payments reconcile to the lesson-level calculation within 5p, 7p, and 18p respectively. Those penny differences are consistent with historical fee allocation or manual rounding and do not establish an omitted commission.

The current Stripe cash balance was **£4,790.44**. Reimbursing the £3,004.20 already advanced would leave **£1,786.24**, which is £114.89 below the known minimum protection requirement of £1,901.13. If the same account also pays Simon the £2.16 Laura correction and is then reimbursed £3,006.36 in total, £1,784.08 would remain, £117.05 below that known minimum.

No money should be moved on the strength of this document alone.

## Confirmed Simon commercial policy

The **£90 weekly fee is in addition to the 90/10 commission split**. It is not an alternative to the commission.

For an ordinary Stripe-funded lesson:

```text
ordinary lesson net = actual learner receipt - actual Stripe processing cost
Simon lesson share  = 90% of ordinary lesson net, rounded in integer pence per lesson
CoachCarter share   = ordinary lesson net - Simon lesson share
```

For an ordinary direct-to-bank lesson with no payment-processing cost:

```text
Simon lesson share = 90% of the learner payment attributable to the lesson
```

The agreed exceptions and manual rates are:

- **Giovanni Calvia legacy bulk purchase:** £1,403 for 30 hours, paid to Simon at the full rounded legacy rate of **£46.77 per hour**, with no commission deducted.
- **Esha Sharma legacy bulk purchase:** £1,214.40 less £18.42 Stripe fees = £1,195.98 net across 24 hours, or £49.8325 net per hour. The owner has agreed Simon's rate is nevertheless fixed at **£46.77 per hour**, prorated by lesson duration and rounded to the nearest penny. The approximately £3.06 per-hour difference is CoachCarter's agreed legacy spread, not the standard 10% commission. For Esha's 90-minute lesson this produces **£70.16** for Simon and approximately **£4.59** retained by CoachCarter.
- **Confirmed free-trial delivery payments:** £30 per lesson for ten lessons from 4 August to 3 September: Viba Balaji, Emilie Bishop, Megan Hickey, Maria Angela Ribeiro, Qurrat Ul Ain, Shannon Savage, Becky Kingston, Daniela Campos, Charlotte Edwards, and Ramya Ketharnath. Total instructor acquisition cost: **£300**.
- A separately audited legacy/manual credit carrying a `final_instructor_payable` value pays that final value directly and must not be commissioned again.

At the weekly level:

```text
Simon earnings before fee
  = sum(90% ordinary lesson shares)
  + agreed legacy-rate lesson amounts
  + fixed free-trial delivery payments
  + audited final-payable amounts

Simon weekly payout
  = Simon earnings before fee
  - £90 weekly fee
```

The protected Simon launch specification also describes the fixed fee as separate from the percentage split.

## Six-week bank-payment control

| Covered payout period | Actual bank payment | Current reconciliation status |
|---|---:|---|
| 31 Jul–7 Aug | £417.00 | Accepted historical control; not independently itemised |
| 8–15 Aug | £100.15 | Accepted historical control; not independently itemised |
| 17–21 Aug | £253.34 | Reconstructs to £253.29 using 90% ordinary pay, £46.77 Giovanni and confirmed £30 free trial; 5p difference |
| 21–28 Aug | £423.93 | Reconstructs to £423.86 using 90% ordinary pay, £46.77 Giovanni and confirmed £30 free trial; 7p difference |
| 28 Aug–4 Sep | £768.76 | Reconstructs to approximately £768.94 after correcting two duration/source anomalies; 18p difference |
| 4–11 Sep | £1,041.02 | Independently itemised and settled |
| **Total** | **£3,004.20** | No £132.15 overpayment established |

The 5p, 7p, and 18p differences require the original manual worksheet to close exactly, but they are consistent with per-line processing-fee allocation and manual rounding.

### Ordinary lessons: 17–21 August

| Lesson | Gross/source | Processing fee | Net | Simon 90% | CoachCarter |
|---|---:|---:|---:|---:|---:|
| 18 Aug, Sophia White, 15:00–16:30 (#485) | £82.50 | £1.44 | £81.06 | £72.95 | £8.11 |
| 18 Aug, Laura Thomas, 19:00–20:00 (#478) | £55.00 | £1.03 | £53.97 | £48.57 | £5.40 |
| 19 Aug, Viba Balaji, 08:00–09:30 (#488) | £81.00 | £0.44 | £80.56 | £72.50 | £8.06 |
| 20 Aug, Viba Balaji, 08:30–10:00 (#487) | £81.00 | £0.45 | £80.55 | £72.50 | £8.05 |
| **Total** | **£299.50** | **£3.36** | **£296.14** | **£266.52** | **£29.62** |

Adding Giovanni at £46.77 and the confirmed £30 Shannon free-trial payment gives £343.29 before the fee and £253.29 after it, versus £253.34 actually paid.

### Ordinary lessons: 21–28 August

| Lesson | Gross/source | Processing fee | Net | Simon 90% | CoachCarter |
|---|---:|---:|---:|---:|---:|
| 23 Aug, Laura Thomas, 07:00–09:00 (#493) | £110.00 | £1.85 | £108.15 | £97.34 | £10.81 |
| 24 Aug, Emilie Bishop, 16:00–17:00 (#451) | £55.00 | £1.03 | £53.97 | £48.57 | £5.40 |
| 25 Aug, Sophia White, 13:00–14:30 (#489) | £82.50 | £1.44 | £81.06 | £72.95 | £8.11 |
| 26 Aug, Shannon Savage, 11:00–12:00 (#494) | £55.00 | £1.03 | £53.97 | £48.57 | £5.40 |
| 26 Aug, Maria Angela Ribeiro, 16:00–17:00 (#483) | £55.00 | £1.03 | £53.97 | £48.57 | £5.40 |
| 26 Aug, Becky Kingston, 20:00–21:00 (#511) | £55.00 | £1.03 | £53.97 | £48.57 | £5.40 |
| 27 Aug, Viba Balaji, 10:00–11:30 (#519) | £81.00 | £0.42 | £80.58 | £72.52 | £8.06 |
| **Total** | **£493.50** | **£7.83** | **£485.67** | **£437.09** | **£48.58** |

Adding Giovanni at £46.77 and the confirmed £30 Becky free-trial delivery payment gives £513.86 before the fee and £423.86 after it, versus £423.93 actually paid.

### Lessons: 28 August–4 September

The present source ledger overstates two lesson contributions relative to their booked durations:

- Viba booking #536 is 60 minutes but presently carries a 90-minute/£81 flexible allocation.
- Emilie booking #533 is 90 minutes but presently carries a 120-minute/£110 source.

Using the actual lesson durations reduces the ordinary Simon total from the raw-ledger £485.44 to approximately **£436.88**.

| Additional/manual lesson | Agreed Simon treatment | Simon amount |
|---|---|---:|
| Daniela Campos free trial, 28 Aug (#508) | Fixed delivery payment | £30.00 |
| Giovanni Calvia, 29 Aug (#506) | £46.77/hour legacy rate | £46.77 |
| Giovanni Calvia, 31 Aug (#497) | £46.77/hour legacy rate | £46.77 |
| Esha Sharma, 1 Sep, 90 minutes (#535) | £46.77/hour agreed legacy rate | £70.16 |
| Giovanni Calvia, 1 Sep (#440) | £46.77/hour legacy rate | £46.77 |
| Charlotte Edwards free trial, 2 Sep (#499) | Fixed delivery payment | £30.00 |
| Laura Thomas, 2 Sep, 90 minutes (#525) | Direct-bank payment; actual amount paid | £73.02 |
| Ramya Ketharnath free trial, 3 Sep (#517) | Fixed delivery payment | £30.00 |
| Laura Thomas, 3 Sep, 60 minutes (#526) | Direct-bank payment; actual amount paid | £48.57 |
| **Additional/manual total** |  | **£422.06** |

```text
Duration-corrected ordinary Simon shares    approximately £436.88
+ additional/manual lesson payments                       £422.06
= reconstructed earnings before weekly fee                £858.94
- separate weekly fee                                      £90.00
= reconstructed bank payment                              £768.94

Actual bank payment                                       £768.76
Difference                                                  £0.18
```

### Confirmed Laura correction

Laura paid Fraser's bank account £275 for five hours, equivalent to £55 per hour, with no processing fee. Simon's correct 90% rate was therefore £49.50 per hour:

| Lesson | Paid to Simon | Correct Simon pay | Underpayment |
|---|---:|---:|---:|
| 2 Sep, 90 minutes | £73.02 | £74.25 | £1.23 |
| 3 Sep, 60 minutes | £48.57 | £49.50 | £0.93 |
| **Total** | **£121.59** | **£123.75** | **£2.16** |

The £2.16 remains payable to Simon unless separately settled. It is not CoachCarter revenue.

### Why the former £132.15 conclusion was invalid

The former method subtracted 100% of reconstructed ordinary lesson net from each bank control and labelled the result a 100%-paid legacy residual. Because the five older weeks have no itemised settlement headers, that residual was not independently known. Assuming 100% ordinary pay in order to test whether 100% ordinary pay occurred was circular and mechanically produced the 10% difference.

The lesson-level evidence instead shows that the bank payments are compatible with Fraser having retained the ordinary 10% commission. No Simon receivable should be recognised for £132.15.

Production still has no immutable, itemised settlement headers for the first five payments. It contains only the general boundary saying applicable Simon lessons before 4 September at 12:00 Europe/London were manually settled. Bank statements and the original manual worksheet remain necessary to close the small residual differences exactly.

## Latest period: independently itemised settlement

The latest period, **[4 September 2026 12:00, 11 September 2026 12:00) Europe/London**, is the only period with an explicit append-only production settlement header and 22 linked claims.

```text
Ordinary lesson net                         £782.31
- CoachCarter 10% commission                 £78.26
= Simon ordinary 90% share                  £704.05
+ audited legacy final payable at 100%       £426.97
= Simon earnings before weekly fee         £1,131.02
- separate weekly fee                        £90.00
= bank payment                             £1,041.02
```

The settlement records £1,131.02 earnings, £90.00 fee, £1,041.02 paid, and £0.00 remaining. The £426.97 legacy value must not be commissioned again.

## Reimbursement and revenue treatment

Three figures must remain separate:

1. **£3,004.20 actually advanced**<br>
   This is the potential reimbursement claim of whichever personal or company account made the six payments. The database does not identify that bank account, so bank statements are required.

2. **£2.16 confirmed but not yet evidenced as paid**<br>
   This is the Laura correction still payable to Simon. It becomes an additional reimbursement claim only after the paying account actually advances it. If the same account pays it, the combined cash outlay becomes £3,006.36.

3. **£0.00 established Simon overpayment**<br>
   The former £132.15 apparent overpayment is withdrawn. It must not be recorded as a Simon receivable, recovered, or deducted from the paying account's reimbursement.

Currently identified commercial retention represented by these six weeks is:

| Retention component | Amount |
|---|---:|
| Ordinary 10% commission, after correcting the two duration/source anomalies | £205.02 |
| Correct commission on Laura's two direct-bank lessons | £13.75 |
| Agreed Esha legacy spread for the 90-minute lesson | approximately £4.59 |
| Six weekly fees at £90 | £540.00 |
| **Currently identified retention** | **approximately £763.36** |

The components should be presented separately:

| CoachCarter economic view | Amount |
|---|---:|
| Franchise-fee income | **£540.00** |
| Genuine 10% commission: £205.02 ordinary plus £13.75 Laura | **£218.77** |
| Esha agreed legacy-rate margin | approximately £4.59 |
| **Gross identified retention** | **approximately £763.36** |
| Ten free-trial payments at £30 | **-£300.00** |
| **Contribution after free-trial cost** | **approximately £463.36** |

The £300 free-trial acquisition cost is allocated across the manually paid periods as follows:

| Covered period | Free-trial learners | Cost |
|---|---|---:|
| 31 Jul–7 Aug | Viba Balaji; Emilie Bishop | £60.00 |
| 8–15 Aug | Megan Hickey; Maria Angela Ribeiro; Qurrat Ul Ain | £90.00 |
| 17–21 Aug | Shannon Savage | £30.00 |
| 21–28 Aug | Becky Kingston | £30.00 |
| 28 Aug–4 Sep | Daniela Campos; Charlotte Edwards; Ramya Ketharnath | £90.00 |
| **Total** | **10 free trials** | **£300.00** |

Comparing the cost with period-level earnings:

```text
Genuine 10% commission                         £218.77
- free-trial delivery cost                     £300.00
= amount not recovered by commission alone     -£81.23

Commission recovery of free-trial cost           72.9%
```

Including the Esha legacy spread, commission/margin totals approximately £223.36, recovering approximately 74.5% of the £300 cost and leaving £76.64 unrecovered before franchise fees. Including the £540 franchise fees produces the £463.36 positive contribution shown above.

This is a period-level comparison, not a free-trial cohort return-on-investment calculation. The £218.77 commission arose from all relevant paid lessons, not necessarily from later purchases by the ten free-trial learners. A true free-trial return requires tracing each of those learners' subsequent paid purchases and the CoachCarter commission generated from them.

The £2.16 accidentally retained from Laura is excluded because it remains payable to Simon. Free-trial payments are operating/acquisition costs, so £463.36 is not final accounting profit. Some direct-bank and historical amounts are outside the pooled Stripe account. None of this proves the amount is currently withdrawable.

## Live Stripe position

At approximately 11:40 Europe/London on 13 September 2026:

| Account | Available | Pending | Total |
|---|---:|---:|---:|
| CoachCarter platform | £4,252.81 | £537.63 | **£4,790.44** |
| Simon connected account `acct_1U3pyqIjVkzjlvAE` | £0.00 | £0.00 | **£0.00** |

Stripe showed a £0 connected-account reserve. Simon has received no Connect transfers.

The last successful platform bank payout was £162.12, arriving 15 May 2026. Activity since that payout reconciles exactly:

| Movement since last platform bank payout | Amount |
|---|---:|
| Learner receipts | £11,373.51 |
| Stripe fees | -£205.78 |
| Customer refunds | -£137.50 |
| 13 instructor Connect transfers | -£6,239.79 |
| **Current platform Stripe balance** | **£4,790.44** |

The £205.78 Stripe-fee total comprises £125.45 attached to charges, £60.86 attached to payment objects, and £19.47 in separate fee entries.

All 13 instructor transfers went to Fraser's connected account `acct_1THXFyIAf6hvFTx9`. Simon's off-Stripe payments therefore left matching pooled cash in the platform account, but pooled cash is not a segregated Simon wallet.

## Production database position for Simon

- Instructor ID 6, school ID 1.
- `commission_rate = 0.900`.
- `weekly_franchise_fee_pence IS NULL`.
- `payouts_paused = true`.
- The latest settlement is fully claimed with £0 remaining.
- A controlled preview classified 54 older chargeable bookings as `MANUALLY_SETTLED_BEFORE_CUTOFF`.
- Four later chargeable Simon bookings were present after the first system period. Their positive stored contribution totals £219.00 and one of the four has zero stored contribution.
- Under the clarified 90/10 treatment, the £219.00 produces a provisional Simon ordinary share of £196.85 and CoachCarter commission of £22.15. If exactly one £90 fee applies when that period properly closes, the provisional net would be £106.85. This is not a final payable amount.
- The owner-agreed Esha legacy rate of £46.77 per hour is documented here but is not yet represented as an authoritative production funding-basis/configuration rule.
- Simon remains paused, which is appropriate until the fee/commission implementation and historical evidence are resolved.

## Important implementation mismatch

The current product state does not safely encode the confirmed cumulative policy:

- Simon's live row contains the 90% commission but no configured weekly fee.
- In `api/_interim-v1-payout.js`, `allocateInstructorAmounts` treats the configured weekly-fee route as an alternative to the commission route, so enabling a fee under the present implementation would bypass the 90/10 split.
- Admin and instructor payout read models likewise describe a payout as either `franchise` or `commission`.
- The latest manual settlement is correct only because its lesson shares were calculated using commission and its £90 fee was then separately supplied to the settlement header.
- The system also needs an auditable, admin-managed way to apply Esha's £46.77-per-hour legacy rate without turning it into a global hardcoded exception. The two mismatched historical source allocations on bookings #536 and #533 must not become future payout authority.

Do not unpause Simon or merely populate the missing fee column. A separately authorised code/configuration change, focused tests, production preview, and reviewed rollout are needed.

## Fraser payout position

- Fraser's latest £276.41 connected-account bank payout was already in transit and expected on 14 September 2026.
- Fraser's connected balance was £0 available / £0 pending after that payout was initiated.
- Four newer chargeable Fraser lessons have combined gross/source value of £208.13.
- £136.13 is evidenced.
- Booking 609 contributes the unresolved £72.00. It is labelled Flexible Hours but has no matching BCS/flexible allocation and no exact Stripe identity/fee evidence. A later £55 payment funded Simon booking 570, not booking 609.
- A separate historical audit identified £911.75 of unresolved Fraser recovery: £909.00 legacy/double-pay evidence plus £2.75 additional booking-level overpayment.
- No `payout_adjustments` row has applied that recovery.

The £911.75 recovery exceeds the entire £208.13 newer Fraser gross/source amount. No additional net Fraser payout should be made until the recovery policy and booking 609 evidence are formally reviewed.

## Future bookings and learner-credit protection

The latest production snapshot had **33 scheduled bookings** with **£1,559.13** of stored contribution value:

| Instructor | Scheduled booking count | Stored contribution |
|---|---:|---:|
| Fraser | 7 | £323.13 |
| Simon | 26 | £1,236.00 |
| **Total** | **33** | **£1,559.13** |

One zero-value Simon booking had transitioned out since the preceding 34-booking snapshot; total stored contribution remained £1,559.13.

Fraser booking 577 has a Flexible Hours label and £49.83 list price but no BCS/flexible allocation. It is not included in the £1,559.13 stored-contribution total and remains an additional unresolved exposure.

Known-valued unused credit sources total **£593.16**:

| Unused-credit classification | Amount |
|---|---:|
| Stripe cash-backed | £314.40 |
| Platform goodwill | £27.60 |
| **Platform-backed refundable exposure** | **£342.00** |
| Instructor-absorbed | £251.16 |
| **Total known-valued unused sources** | **£593.16** |

Live learner balances were:

- Fraser-scoped learners: 2,580 minutes / 43 hours
- Simon-scoped learners: 960 minutes / 16 hours
- Demo-instructor learner: 3 minutes

The source ledger also contains **2,880 minutes / 48 hours** of unvalued or unattributed credit. Therefore, £342.00 is only the known platform-backed unused-credit floor, not the full possible liability.

The current known minimum cash protection is:

```text
Scheduled stored contribution             £1,559.13
+ known platform-backed unused exposure     £342.00
= known minimum protection                £1,901.13
```

True protection is at least £1,901.13 plus the value of unresolved/unpriced credits, booking 577, any required risk reserve, and other evidence gaps.

## Reimbursement scenarios against the live balance

| Scenario | Stripe cash left | Difference from £1,901.13 known minimum | Current conclusion |
|---|---:|---:|---|
| No reimbursement | £4,790.44 | +£2,889.31 | Cash remains pooled and protected pending reconciliation |
| Reimburse full £3,004.20 actually advanced | £1,786.24 | **-£114.89** | Below known minimum; not safe |
| After Laura is corrected, reimburse combined £3,006.36 outlay | £1,784.08 | **-£117.05** | Below known minimum; not safe |

These comparisons do not authorise a transfer. There is no established £132.15 Simon overpayment to offset.

## Protected-balance blockers

The production protected-balance preflight remained blocked by:

- `LCB_SOURCE_RECONCILIATION_MISMATCH`
- `LEGACY_UNPRICED`
- `UNATTRIBUTED_LCB_MINUTES`
- `MANUAL_REVIEW_EVIDENCE`
- `MISSING_RISK_RESERVE_CONFIGURATION`

Additional observations:

- Three funding sources require manual evidence review.
- No protected-balance risk-reserve configuration exists.
- No rows were present in `refund_events` or `refund_event_lines`.
- No `payout_adjustments` rows were present.
- No open payout-v2 booking earnings were present.
- Payout v2 was inactive.

Until those blockers are cleared, the certified safe reimbursement/withdrawal amount remains **£0.00**, even though an accounting reimbursement claim exists.

## Evidence needed before any money movement

1. Bank statements proving all six Simon payments and identifying whether Fraser personally or CoachCarter Ltd funded each one.
2. The original manual lesson worksheet, to close the remaining 5p, 7p, and 18p historical differences. All ten free-trial delivery payments are now owner-confirmed at £30 each.
3. Evidence that the £2.16 Laura correction has been paid before adding it to any reimbursement claim.
4. Separately approved execution of the Viba flexible-package repair proposed below, plus resolution of Emilie bookings #533/#585.
5. Resolution and valuation of the 48 hours of unpriced/unattributed credit.
6. Resolution of bookings 577 and 609.
7. A reviewed risk-reserve policy/configuration.
8. A separately authorised implementation/configuration change so Simon's 90% ordinary commission, separate £90 weekly fee, and Esha's £46.77-per-hour legacy rate can all apply auditably, with focused tests and a read-only production preview before unpausing.

## Recommended continuation prompt

> Continue the read-only CoachCarter Stripe reconciliation using `docs/fraser-simon-stripe-balance-reconciliation-2026-09-13.md`. Re-verify the live Stripe and production database figures. The former £132.15 Simon-overpayment conclusion has been withdrawn: Fraser's historical payments did apply the ordinary 90% commission. Keep the £540 of six weekly fees separate from £218.77 genuine period-level 10% commission and the approximately £4.59 Esha legacy spread. The ten owner-confirmed £30 free trials cost £300. Their isolated cohort has seven paid purchasers, 27 delivered paid hours, £145.59 realized CoachCarter commission and a current campaign contribution of -£154.41; keep future and unused cash out of realized ROI. Viba's apparent 3.5-hour ordinary-credit balance is now traced as a duplicate ledger effect: her correct remaining entitlement is five flexible-package hours, with no ordinary-credit balance. Apply Giovanni's no-commission legacy rate and Esha's owner-agreed £46.77-per-hour legacy rate. Reconcile the original manual worksheet, the £2.16 Laura underpayment, execute the separately approved Viba repair if authorised, resolve Emilie #533/#585, and clear the remaining protected-balance blockers. Do not transfer money, refund, mutate financial records, alter production configuration, deploy, or unpause payouts without separate explicit approval.

## Safety and provenance

This work used read-only Stripe retrievals and read-only production Neon queries inside a read-only transaction. It did not create or update Stripe transfers, payouts, refunds, customers, or balances. It did not mutate database rows, financial ledgers, production configuration, or application code, and it did not deploy or unpause payouts.

## Free-trial cohort reconciliation

This section isolates the ten owner-confirmed free trials from the wider Simon reconciliation. Each completed trial cost CoachCarter £30 and is excluded from learner revenue. The cohort acquisition cost is therefore **£300**. Simon's six separate £90 weekly franchise fees, totalling £540, are shown elsewhere in this document and are **not attributed to this campaign**.

The cohort labels below preserve the names supplied by the owner. The production records for Megan Hickey and Qurrat Ul Ain now display updated names; they were matched by stable learner ID without exposing contact details.

### Timestamped evidence note — 13 September 2026

- Fresh school-scoped production Neon reads were executed through the deployed production admin read endpoints at **13:04–13:10 Europe/London**. The evidence included learner/instructor credit balances, Simon booking rows, booking-credit-source links, flexible-package purchases and allocations, credit transactions, payout-preview rows, refund-exposure sources and reconciliation warnings.
- Live Stripe PaymentIntents, charges, balance transactions, refunds and Checkout Sessions were retrieved at **approximately 13:01 Europe/London**. The actual balance-transaction fee was used for each successful payment.
- The platform Stripe balance remained **£4,252.81 available + £537.63 pending = £4,790.44**. That pooled balance is not treated as cohort revenue.
- All activity was read-only. No Stripe object, database row, financial ledger, production setting, deployment or payout state was changed.

### Learner-by-learner booking lifecycle

Dates are lesson dates. `C` means completed/chargeable paid work, `R` means refunded or otherwise non-chargeable, and `F` means future scheduled. Hours exclude the free trial itself.

| Learner | Completed free trial | Subsequent chargeable Simon bookings | Subsequent refunded/non-chargeable Simon bookings | Future scheduled Simon bookings | Paid hours delivered | Future hours | Conversion and first paid activity |
|---|---|---|---|---|---:|---:|---|
| Viba Balaji | 4 Aug, **#423**, 1h | C: #488 19 Aug 1.5h; #487 20 Aug 1.5h; #519 27 Aug 1.5h; #522 28 Aug 1h; #536 2 Sep 1h; #568 10 Sep 1h; #582 12 Sep 1h | R: #537 3 Sep 1.5h; #569 11 Sep 1h | F: #611 3 Oct 1.5h | **8.5** | **1.5** | **Yes** — purchase 18 Aug; first paid lesson 19 Aug |
| Emilie Bishop | 5 Aug, **#438**, 1h | C: #451 24 Aug 1h; #531 2 Sep 1.5h; #533 3 Sep 1.5h; #534 4 Sep 1h; #584 11 Sep 2h | R: #514 28 Aug 1h | F: #585 14 Sep 1.5h; only 1h has proven funding | **7.0** | **1.5** | **Yes** — purchase 7 Aug; first paid lesson 24 Aug |
| Megan Hickey | 14 Aug, **#466**, 1h | None | R: #500 28 Aug 1h; #501 5 Sep 1h; #510 5 Sep 1h | None | **0.0** | **0.0** | **Yes, purchase-only** — purchase 17 Aug; no chargeable paid lesson yet |
| Maria Angela Ribeiro | 15 Aug, **#449**, 1h | C: #483 26 Aug 1h; #559 7 Sep 1h; #560 9 Sep 1h | R: #597 15 Sep 1h; #598 21 Sep 1h | F: #604 1 Oct 1h; #605 5 Oct 1h | **3.0** | **2.0** | **Yes** — purchase 17 Aug; first paid lesson 26 Aug |
| Qurrat Ul Ain | 15 Aug, **#476**, 1h | None | None after the completed trial | None | **0.0** | **0.0** | **No** |
| Shannon Savage | 18 Aug, **#479**, 1h | C: #494 26 Aug 1h; #558 3 Sep 1h; #564 9 Sep 1h; #565 10 Sep 1.5h | R: #521 4 Sep 1h; #548 5 Sep 1.5h | None | **4.5** | **0.0** | **Yes** — Simon purchase 19 Aug; first paid lesson 26 Aug |
| Becky Kingston | 22 Aug, **#446**, 1h | C: #511 26 Aug 1h; #524 2 Sep 1h | None | F: #576 16 Sep 1h | **2.0** | **1.0** | **Yes** — purchase 22 Aug; first paid lesson 26 Aug |
| Daniela Campos | 28 Aug, **#508**, 1h | C: #540 7 Sep 1h; #572 11 Sep 1h | R: #541 8 Sep 1h | F: #615 16 Sep 1h | **2.0** | **1.0** | **Yes** — purchase 29 Aug; first paid lesson 7 Sep |
| Charlotte Edwards | 2 Sep, **#499**, 1h | None | None | None | **0.0** | **0.0** | **No** — one open unpaid £55 Checkout Session is not a payment |
| Ramya Ketharnath | 3 Sep, **#517**, 1h | None | None | None | **0.0** | **0.0** | **No** |

Earlier refunded free-trial placeholders — #436 for Emilie, #424 for Maria, #469/#474 for Qurrat, #470 for Shannon and #445 for Becky — were not counted as additional trials. The completed chargeable trial row shown above is the single £30 acquisition event for each learner.

The paid lifecycle totals are **27.0 delivered hours**, **12.0 refunded/non-chargeable booking hours**, and **7.0 future scheduled hours**. Only **6.5 of the 7.0 future hours have proven funding** because booking #585 is 90 minutes but its linked successful payment proves only £55/one hour.

### Every attributable successful payment

`Net cash` means gross cash less the actual Stripe balance-transaction fee and actual cash refunds. It is not automatically earned revenue. All 23 listed charges were successful and had **£0.00 actually refunded in Stripe**.

| Learner | Paid | Stripe PaymentIntent | Funding | Gross | Actual Stripe fee | Cash refund | Net cash |
|---|---|---|---|---:|---:|---:|---:|
| Viba Balaji | 18 Aug | `pi_3U5lPSIqhTSdZedS2X54LUx8` | 15h flexible package, pay-by-bank through Stripe | £810.00 | £4.25 | £0.00 | £805.75 |
| Emilie Bishop | 7 Aug | `pi_3U1uuGIqhTSdZedS0mdpw7xr` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Emilie Bishop | 24 Aug | `pi_3U80QMIqhTSdZedS3jQ5U5Je` | Booking credit, later reused after #514 | £55.00 | £1.03 | £0.00 | £53.97 |
| Emilie Bishop | 29 Aug | `pi_3U9hf0IqhTSdZedS3yrYNCN7` | Booking credit | £82.50 | £1.44 | £0.00 | £81.06 |
| Emilie Bishop | 29 Aug | `pi_3U9oBRIqhTSdZedS372Tcias` | Booking credit; £27.50 over the duration value of #533 is unresolved | £110.00 | £1.85 | £0.00 | £108.15 |
| Emilie Bishop | 7 Sep | `pi_3UD83UIqhTSdZedS1ZXPQYyS` | Booking credit | £110.00 | £1.85 | £0.00 | £108.15 |
| Emilie Bishop | 7 Sep | `pi_3UD85iIqhTSdZedS0jUcdu7c` | Booking credit; proves only 1h of future #585 | £55.00 | £1.03 | £0.00 | £53.97 |
| Megan Hickey | 17 Aug | `pi_3U5VOdIqhTSdZedS0eJHYVvH` | 15h flexible package, pay-by-bank through Stripe | £810.00 | £4.25 | £0.00 | £805.75 |
| Maria Angela Ribeiro | 17 Aug | `pi_3U5OrJIqhTSdZedS0wkZWVXZ` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Maria Angela Ribeiro | 3 Sep | `pi_3UBUzoIqhTSdZedS1aiNz5ZX` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Maria Angela Ribeiro | 3 Sep | `pi_3UBV1xIqhTSdZedS1STgMZt2` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Maria Angela Ribeiro | 8 Sep | `pi_3UDUcmIqhTSdZedS2wOgEVPL` | Booking credit reused from #597 to future #604 | £55.00 | £1.03 | £0.00 | £53.97 |
| Maria Angela Ribeiro | 8 Sep | `pi_3UDUguIqhTSdZedS0CrPjw0f` | Booking credit reused from #598 to future #605 | £55.00 | £1.03 | £0.00 | £53.97 |
| Shannon Savage | 19 Aug | `pi_3U6GfeIqhTSdZedS26foGXwW` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Shannon Savage | 27 Aug | `pi_3U93jFIqhTSdZedS1Ac0F3Po` | Direct card booking; reused after #521 | £55.00 | £1.03 | £0.00 | £53.97 |
| Shannon Savage | 31 Aug | `pi_3UAbDnIqhTSdZedS2PGIsKey` | Booking credit; reused after #548 | £82.50 | £1.44 | £0.00 | £81.06 |
| Shannon Savage | 4 Sep | `pi_3UBvteIqhTSdZedS2urQKOZj` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Becky Kingston | 22 Aug | `pi_3U7M6SIqhTSdZedS35opnSFe` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Becky Kingston | 27 Aug | `pi_3U9BfLIqhTSdZedS3aJHuTlY` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Becky Kingston | 7 Sep | `pi_3UD46QIqhTSdZedS2GREOh4B` | Booking credit for future #576 | £55.00 | £1.03 | £0.00 | £53.97 |
| Daniela Campos | 29 Aug | `pi_3U9tyjIqhTSdZedS1Jt1McDA` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| Daniela Campos | 30 Aug | `pi_3UA8ZAIqhTSdZedS0Qp3UfPP` | Booking credit reused from #541 to future #615 | £55.00 | £1.03 | £0.00 | £53.97 |
| Daniela Campos | 7 Sep | `pi_3UCzf9IqhTSdZedS36DGrmCD` | Booking credit | £55.00 | £1.03 | £0.00 | £53.97 |
| **Total** |  |  |  | **£2,940.00** | **£32.59** | **£0.00** | **£2,907.41** |

The canceled £110 Emilie PaymentIntent `pi_3UD7qUIqhTSdZedS2ikMuOxW` received £0.00 and is excluded. Shannon also made a successful £55 payment on 7 September whose production metadata names instructor #4, not Simon (#6); it is excluded from Simon cohort attribution rather than reassigned. Charlotte's open £55 Checkout Session is unpaid and excluded.

### Learner-by-learner economics

Actual Stripe fees are allocated to the immutable 30-minute source units where those exist. For direct booking credits, the actual fee follows the payment that funded the booking; where a payment covered more time than the booking duration, only the duration-consistent share is earned and the excess is left unresolved. Simon's share is rounded in integer pence per lesson and CoachCarter receives the remainder, preventing penny leakage.

| Learner | Collected gross / fee / net cash | Delivered gross / fee / earned net | Simon realized | CoachCarter realized 10% | Proven future gross / fee / protected net | Potential future commission | Live unused credit | Unresolved/unclassified collected cash |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| Viba Balaji | £810.00 / £4.25 / £805.75 | £459.00 / £2.43 / £456.57 | **£410.92** | **£45.65** | £81.00 / £0.42 / £80.58 | £8.06 | **5h correct package entitlement**, £270.00 gross/£268.60 net; production currently misclassifies 3.5h in LCB and shows only 1.5h in the package source | £0.00 after the traced reclassification; production repair is not yet applied |
| Emilie Bishop | £467.50 / £8.23 / £459.27 | £385.00 / £6.74 / £378.26 | **£340.43** | **£37.83** | £55.00 / £1.03 / £53.97; funds 1h of a 1.5h booking | £5.40 | 0h | £27.50 gross/£27.04 net from the duration mismatch on #533 |
| Megan Hickey | £810.00 / £4.25 / £805.75 | £0.00 / £0.00 / £0.00 | **£0.00** | **£0.00** | £0.00 / £0.00 / £0.00 | £0.00 | 2h, source-priced at £108.00 gross/£107.43 net | £702.00 gross/£698.32 net; source ledger says 13h remain while live balance says 2h |
| Maria Angela Ribeiro | £275.00 / £5.15 / £269.85 | £165.00 / £3.09 / £161.91 | **£145.71** | **£16.20** | £110.00 / £2.06 / £107.94 | £10.80 | 0h | £0.00 |
| Qurrat Ul Ain | £0.00 / £0.00 / £0.00 | £0.00 / £0.00 / £0.00 | **£0.00** | **£0.00** | £0.00 / £0.00 / £0.00 | £0.00 | 0h | £0.00 |
| Shannon Savage | £247.50 / £4.53 / £242.97 | £247.50 / £4.53 / £242.97 | **£218.66** | **£24.31** | £0.00 / £0.00 / £0.00 | £0.00 | 0h | £0.00 |
| Becky Kingston | £165.00 / £3.09 / £161.91 | £110.00 / £2.06 / £107.94 | **£97.14** | **£10.80** | £55.00 / £1.03 / £53.97 | £5.40 | 0h | £0.00 |
| Daniela Campos | £165.00 / £3.09 / £161.91 | £110.00 / £2.06 / £107.94 | **£97.14** | **£10.80** | £55.00 / £1.03 / £53.97 | £5.40 | 0h | £0.00 |
| Charlotte Edwards | £0.00 / £0.00 / £0.00 | £0.00 / £0.00 / £0.00 | **£0.00** | **£0.00** | £0.00 / £0.00 / £0.00 | £0.00 | 0h | £0.00 |
| Ramya Ketharnath | £0.00 / £0.00 / £0.00 | £0.00 / £0.00 / £0.00 | **£0.00** | **£0.00** | £0.00 / £0.00 / £0.00 | £0.00 | 0h | £0.00 |
| **Total** | **£2,940.00 / £32.59 / £2,907.41** | **£1,476.50 / £20.91 / £1,455.59** | **£1,310.00** | **£145.59** | **£356.00 / £5.57 / £350.43** | **£35.06** | **7h; £378.00 gross/£376.03 net is priced** | **£729.50 gross/£725.36 net** |

Viba's flexible-package purchase is proven. The follow-up trace below establishes that the apparent £189 unresolved amount is all part of her original package and should be reclassified as five hours of unused flexible credit. The production ledgers have not yet been changed. Emilie's #533 is still 90 minutes but linked to a £110/two-hour source; £82.50 is recognized as delivered value and £27.50 remains unresolved.

### Viba flexible-package trace and proposed repair — 13:44 Europe/London

The extra balance is now explained exactly. It is a duplicate-ledger classification problem, not a new or unpaid entitlement:

| Event | Flexible ledger result | Ordinary LCB result |
|---|---:|---:|
| #536 shortened from 90 to 60 minutes at 13:50 on 2 Sep | Original three-unit allocation remained active; one unit should have been released | Credit transaction #334 added 30 minutes |
| #537 cancelled on 3 Sep | Three-unit allocation remained active; no allocation-return row exists | Generic cancellation returned 90 minutes |
| #568 shortened from 90 to 60 minutes at 09:26 on 10 Sep | Original three-unit allocation remained active; one unit should have been released | Credit transaction #371 added 30 minutes |
| #569 cancelled on 11 Sep | Two-unit allocation remained active; no allocation-return row exists | Generic cancellation returned 60 minutes |
| **Misclassified total** | **Seven 30-minute units/3.5h missing from flexible availability** | **210 minutes/3.5h incorrectly present in ordinary credit** |

The two `edit_adjustment` rows occurred within milliseconds of the `edited_at` timestamps for #536 and #568. The two cancelled bookings have `credit_returned = true`, while the dedicated flexible-package cancellation path records allocation returns and deliberately does not credit ordinary LCB. This, together with the exact 30 + 90 + 30 + 60 = 210-minute match, closes the causal trace.

The correct commercial position is:

```text
Original package                         15.0h / 30 units / £810.00
Delivered after the trial                8.5h / 17 units / £459.00
Future booking #611                      1.5h /  3 units /  £81.00
Correct unused flexible entitlement      5.0h / 10 units / £270.00
Correct ordinary Simon LCB               0.0h
```

The proposed repair must be one atomic, idempotent, school-scoped transaction after separate approval:

Do **not** use the generic admin credit-adjustment control for this repair. It would change ordinary LCB without repairing the flexible allocations and could leave the reconciliation in a worse state.

1. Assert learner #143, Simon #6, school #1, source #3, the £810 purchase identity, current LCB 210 minutes, the four exact allocation IDs and the absence of existing return rows.
2. Return all three units from cancelled allocation #8/booking #537 and both units from cancelled allocation #10/booking #569.
3. Preserve the immutable originals for #536 and #568 by returning their existing three-unit allocations (#7 and #9), then insert replacement two-unit/£54 allocations for each 60-minute booking. This releases one unit from each without rewriting history.
4. Remove the duplicate 210 minutes from Viba's ordinary LCB, account for credit transactions #334/#371 with `admin_correction` source adjustments, and write a specific audit event explaining the 150 cancellation minutes that were previously returned through the wrong ledger.
5. Verify postconditions: ordinary LCB **0 minutes**; flexible source **10 units/300 minutes/£270 remaining**; no duration/allocation mismatch on #536/#568; no active allocation on refunded #537/#569; total learner entitlement remains **five hours** before and after the repair.
6. Run the read-only credit reconciliation, protected-balance preview and Simon payout preview before considering any payout-state change.

The generic admin duration-edit path currently adjusts ordinary LCB without first rejecting or reallocating flexible-package bookings. The instructor cancellation path can likewise return a flexible booking into ordinary LCB. Those paths require a separate code fix and focused regression tests to prevent recurrence; no code or production data was changed during this trace.

### Viba prevention and approval-ready repair implementation — 13 September 2026

Implementation findings:

- `api/admin.js?action=edit-booking` was the unsafe duration writer. It now applies the same rule as the instructor editor: a Flexible Hours duration increase or decrease returns `409 FLEXIBLE_DURATION_EDIT_REQUIRES_REBOOKING` before any LCB read or mutation. Date/time-only edits with an unchanged duration remain available.
- The paid/free lesson-extension flow was another duration-increase path. New extension offers are now rejected for Flexible Hours before Checkout exists. Transaction-time guards cancel a stale free offer without changing the booking and route a stale paid acceptance through the existing durable unfulfilled-extension compensation path before any booking or credit-ledger mutation.
- `api/instructor.js?action=cancel-booking` and `action=mark-not-delivered` were the unsafe operator return paths. They now use the shared Flexible Hours transaction, append exact `flexible_package_allocation_returns`, leave `credit_returned = false`, and never add ordinary LCB minutes. Admin support cancellations use this instructor-management route; there is no separate `api/admin.js?action=cancel-booking` writer.
- The shared cancellation transaction now enforces school, learner and (when supplied) instructor scope; rejects active Lesson Credit/Flexible Hours mixed funding; requires active allocation minutes to equal `lesson_bookings.minutes_deducted`; and treats a fully returned refunded booking as an idempotent repeat. A refunded booking with any active allocation fails closed as `BOOKING_RETURN_CONTRADICTION`.
- Standard learner, instructor and admin rescheduling already used the dedicated Flexible Hours allocation move transaction. The audit also found two reserved-weekly variants—learner `reserved-policy-move` and admin `reserved-goodwill-move`—that copied ordinary credit-source rows without checking Flexible Hours. Both now move package allocations atomically, verify allocation minutes against both bookings and the reserved duration, and retain the ordinary path unchanged. Every audited cancellation/reschedule route treats `payment_method='flexible_package'` as authoritative enough to enter the package path, so missing allocation evidence blocks rather than falling through to LCB.
- Preserving allocations #7 and #9 while inserting same-source replacements exposed a schema restriction: migration 050's unique `(school_id, source_id, booking_id)` constraint prohibited append-only replacement history. Numbered migration 063 removes only that unique constraint and retains a non-unique lookup index. `UNIQUE(allocation_id)` still makes each allocation return exactly once.

The repair is implemented as `scripts/viba-flexible-ledger-repair.js`, backed by `api/_viba-flexible-ledger-repair.js`. It is dry-run by default. Apply mode requires a reviewed plan fingerprint, an exact confirmation phrase, a dedicated environment gate, an in-scope admin identity and evidence reference. Apply runs at `SERIALIZABLE` isolation under an advisory lock; every mutation, the state-event marker, the audit record and all postcondition checks are inside one transaction. Any failed assertion or postcondition throws before commit and the runner issues `ROLLBACK`. The tool never calls Stripe.

#### Exact evidence-backed dry-run preview

After migration 063 was rehearsed and applied through the governed migration runner, a fresh production dry run returned `ready`. All preconditions passed and the live plan fingerprint matched `sha256:df6ae0aab5c7c6e071beb2f0bf6508495114961b1d132886daa54312e2e6b19f` before repair approval.

```json
{
  "mode": "dry-run",
  "mutation_performed": false,
  "status": "ready",
  "plan_fingerprint": "sha256:df6ae0aab5c7c6e071beb2f0bf6508495114961b1d132886daa54312e2e6b19f",
  "before": {
    "ordinary_lcb_minutes": 210,
    "flexible_remaining_units": 3,
    "flexible_remaining_minutes": 90,
    "total_unused_entitlement_minutes": 300
  },
  "allocation_returns": [
    { "allocation_id": 7, "booking_id": 536, "units_returned": 3 },
    { "allocation_id": 8, "booking_id": 537, "units_returned": 3 },
    { "allocation_id": 9, "booking_id": 568, "units_returned": 3 },
    { "allocation_id": 10, "booking_id": 569, "units_returned": 2 }
  ],
  "replacement_allocations": [
    { "original_allocation_id": 7, "booking_id": 536, "source_id": 3, "units_allocated": 2, "unit_minutes": 30, "rate_pence_per_unit": 2700, "contribution_pence": 5400 },
    { "original_allocation_id": 9, "booking_id": 568, "source_id": 3, "units_allocated": 2, "unit_minutes": 30, "rate_pence_per_unit": 2700, "contribution_pence": 5400 }
  ],
  "ordinary_lcb_delta_minutes": -210,
  "source_adjustments": [
    { "credit_transaction_id": 334, "kind": "admin_correction", "minutes_adjusted": 30, "pence_adjusted": 0 },
    { "credit_transaction_id": 371, "kind": "admin_correction", "minutes_adjusted": 30, "pence_adjusted": 0 }
  ],
  "cancellation_minutes_explained_in_audit": 150,
  "audit_action": "credits.viba_flexible_ledger_repair",
  "state_event": "viba_flexible_ledger_repair_2026_09_13"
}
```

Expected before/after state:

| State | Before | After the repair |
|---|---:|---:|
| Ordinary Simon LCB | 210 minutes | **0 minutes** |
| Flexible source #3 available | 3 units / 90 minutes / £81 | **10 units / 300 minutes / £270** |
| Booking #536 active allocation | 3 units / £81 | **2 units / £54** |
| Booking #537 active allocation | 3 units / £81 | **0** |
| Booking #568 active allocation | 3 units / £81 | **2 units / £54** |
| Booking #569 active allocation | 2 units / £54 | **0** |
| Future booking #611 | 3 units / 90 minutes | **unchanged** |
| Delivered package use | 19 active chargeable units before correction | **17 units / 510 minutes** |
| Total unused entitlement | 300 minutes across both ledgers | **300 minutes, entirely Flexible Hours** |

The in-transaction postflight requires: zero active units on refunded bookings; zero active allocation-duration mismatches; zero active Lesson Credit/Flexible Hours mixed-funding rows; 60 minutes of additive `admin_correction` evidence across credit transactions #334/#371; and the exact per-booking/source totals above. All checks passed in production. The operational credit-reconciliation, exact-refund-exposure, protected-balance and Simon payout previews were then rerun read-only. Viba appears in none of their remaining warnings or blockers; the two remaining LCB drifts belong to learners #27 and #126, and the protected-balance result remains operator-review-only for unrelated legacy/policy blockers.

Tests run:

- `npx playwright test tests/viba-flexible-ledger-repair.spec.js` — **11 passed**. Covers both edit directions, cancellation return, repeated cancellation idempotency, refunded/no-active allocation, unchanged ordinary LCB, mixed-ledger/duration refusal, tenant/learner/instructor scope, all standard/reserved reschedule paths, exact repair preview, apply postconditions and rollback-triggering failure.
- Expanded Flexible Hours, extension, reserved-move, payout and migration regression selection — **99 passed**.
- `npm run check:syntax` — **241 files passed**; `npm run check:c1` — **323 files passed**; `npm run migrations:check` — **64 migrations valid**.
- Full `npx playwright test --reporter=dot` run — **1,331 passed, 310 skipped, 4 failed** across 1,645 tests. The four failures are pre-existing source-text assertions outside this change: three payment-link assertions against unchanged frontend files and one schedule-override indentation assertion against an unchanged block already present on `origin/main`.
- Database-backed cancellation coverage remains conditional on an isolated `POSTGRES_URL_TEST`; those six tests were skipped locally because no approved isolated branch was configured. Existing ordinary-credit cancellation assertions were not changed.

Deployment status: the preventive code and both dry-run-first repair runners were deployed through PR #460 on 13 September 2026 after the affected regression suite and repository CI passed. Migration 063 was then rehearsed on a production-derived branch and applied transactionally to production fingerprint `32c8e09a13fff240b0e1af6bb4c063bce1ca02ec09b801242e9232c824123008`; pre-migration snapshot `snap-summer-haze-abng8a8r` remains available. After Fraser's separate explicit approval, Viba's fingerprinted production repair committed successfully under admin ID 1. It appended returns #4-#7 for allocations #7-#10, replacement allocations #18/#19 for bookings #536/#568, state event #25 and audit row #650; it reduced the Simon LCB from 210 to zero while preserving 300 total unused minutes as Flexible Hours. An immediate dry run returned `already_applied`. Neither approval authorized or caused a Stripe mutation, transfer, refund, payout unpausing or booking-status change.

### Megan Flexible Hours trace and approval-ready repair implementation — 13 September 2026

The production admin read models identify the current learner as **Megan Cridland (#151)**; the earlier cohort worksheet used the name Megan Hickey for the same free-trial/purchase sequence. Source #1 is the £810 15-hour Flexible Hours purchase with 30 immutable 30-minute units at £27 per unit. The current split is 26 source units/780 minutes plus 120 minutes in Simon's ordinary LCB, preserving 900 total minutes but placing two hours in the wrong ledger.

The three post-purchase lessons (#500, #501 and #510) are each refunded 60-minute Flexible Hours bookings. The live SQL dry run confirmed that #500 and #501 each have one active two-unit/£54 allocation from source #1, while replacement booking #510 has no allocation and no return row. Booking #510 was created at the same timestamp that #501 was cancelled, so its absent allocation is asserted as part of the historical replacement-booking shape rather than invented during repair. Source #1's 26-unit remainder is exactly explained by the four active units on #500/#501. The repair refuses to proceed if any of the three booking rows, the two allocation IDs, statuses, values, source totals, LCB balance, or tenant identities differ.

The target-specific repair is `scripts/megan-flexible-ledger-repair.js`, backed by `api/_megan-flexible-ledger-repair.js`. Dry run is the default. Its reviewed plan fingerprint includes the exact two active allocation IDs discovered from production. Apply additionally requires a dedicated environment gate, exact confirmation phrase, in-school admin ID, operator identity, evidence reference and a direct `POSTGRES_URL_UNPOOLED` connection. It runs inside a `SERIALIZABLE` transaction under an advisory lock.

Expected state after a separately reviewed successful apply:

| State | Before | After |
|---|---:|---:|
| Ordinary Simon LCB | 120 minutes | **0 minutes** |
| Flexible source #1 available | 26 units / 780 minutes / £702 | **30 units / 900 minutes / £810** |
| Active units on refunded #500/#501/#510 | 4 units total | **0** |
| Total unused entitlement | 900 minutes | **900 minutes** |

The transaction appends only the two missing `flexible_package_allocation_returns`, reduces the current school/learner/instructor LCB row from exactly 120 to zero, and appends a source state event and audit record. It does not create an allocation for #510, update or delete historical allocation rows, change any booking status, alter payout/refund ledgers, or call Stripe. In-transaction postconditions require both target allocations to have return evidence, exactly two allocations across #500/#501/#510, no allocation on #510, source #1 to expose 30 units/£810, no active refunded allocation, no active mixed funding or duration mismatch, and unchanged 900-minute total entitlement.

The first credential-backed production dry run returned `blocked`, as designed, because the earlier read-model inference expected an allocation/return pair on #510 that does not exist. Direct booking/allocation/event evidence established the actual two-allocation shape above; the repair guardrails and tests were tightened to assert it. The corrected live dry run then returned `ready` with reviewed fingerprint `sha256:407982655e43abbf6a280b19964de73b78f03f791e5eedd37c328027c250f995`: all 16 preconditions passed, and the exact plan returns allocations #3/#4 for bookings #500/#501 and removes 120 ordinary LCB minutes. `npx playwright test tests/megan-flexible-ledger-repair.spec.js --reporter=line` passes all eight focused tests.

After Fraser's explicit production approval, the fingerprinted repair committed successfully under admin ID 1. It inserted allocation returns #2/#3 for allocations #3/#4, reduced Simon's ordinary LCB row from 120 to 0 minutes, and recorded Flexible Hours state event #24 plus audit row #646. Every in-transaction postcondition passed: source #1 exposes 30 units/900 minutes/£810, no active package units remain, exactly two target allocations exist and both are returned, #510 remains unallocated, and total unused entitlement remains 900 minutes. An immediate follow-up dry run returned `already_applied` with marker #24, confirming the repair is idempotently sealed. Stripe, booking statuses, refund ledgers and payout records were not changed.

### Cohort cash partition and totals

The cash partition reconciles exactly and does not double-count reused credit sources:

| Cash state | Gross | Allocated Stripe fee | Net | CoachCarter commission status |
|---|---:|---:|---:|---|
| Delivered chargeable lessons — earned | £1,476.50 | £20.91 | **£1,455.59** | **£145.59 realized** |
| Proven future bookings — protected, not earned | £356.00 | £5.57 | **£350.43** | **£35.06 potential**, not realized |
| Live unused credit with proven price — liability | £378.00 | £1.97 | **£376.03** | None earned |
| Collected cash not safely classifiable because ledgers conflict | £729.50 | £4.14 | **£725.36** | None recognized |
| **Total collected** | **£2,940.00** | **£32.59** | **£2,907.41** |  |

The cash-partition table above is the pre-repair reconciliation snapshot and must not be used as a current balance partition without recalculation. Megan's £702 source-ledger conflict and Viba's Flexible Hours conflict have now been repaired and sealed by additive production evidence. Emilie's £27.50 duration mismatch remains unresolved; refresh the complete cohort partition before relying on its liability or ROI totals.

| Cohort metric | Verified result |
|---|---:|
| Learners converting through a successful paid purchase or paid lesson | **7 of 10 (70.0%)** |
| Converted learners with a delivered paid lesson | **6 of 10 (60.0%)** |
| Paid lesson hours delivered by Simon | **27.0h** |
| Future paid hours booked with Simon | **7.0h scheduled; 6.5h funding-proven** |
| Gross learner cash collected | **£2,940.00** |
| Actual Stripe fees | **£32.59** |
| Actual Stripe cash refunds | **£0.00** |
| Net collected cash | **£2,907.41** |
| Net revenue earned through chargeable lessons | **£1,455.59** |
| Simon's realized earnings from subsequent lessons | **£1,310.00** |
| CoachCarter's realized 10% commission | **£145.59** |
| Potential future commission protected, not earned | **£35.06** |
| Unused-credit liability | **7h; £378.00 gross/£376.03 net priced — Viba 5h and Megan 2h** |
| Free-trial acquisition cost | **£300.00** |
| Commission payback | **48.5%** (£145.59 ÷ £300) |
| Net campaign contribution | **-£154.41** (£145.59 − £300) |
| Realized earned-net-revenue/acquisition-cost ratio | **4.85×** (£1,455.59 ÷ £300) |
| Gross-cash-collected/acquisition-cost multiple | **9.80×**, not an ROI measure because much of the cash is future, unused or unresolved |
| Average realized commission per converted learner | **£20.80** |
| Break-even status | **Not broken even; £154.41 more realized commission is required** |
| Position if all currently proven future work becomes chargeable | £180.65 cumulative commission; still **£119.35 short** of acquisition cost |

### Lloyd, Limkholwe and Emilie approval-ready repairs — 14 September 2026

Fresh direct, read-only production queries replaced the earlier endpoint-only
limitation for these three cases. Lloyd #27 and Limkholwe #126 each received a
90-minute cancellation return for a booking that consumed zero ordinary Lesson
Credit. The exact repairs remove those manufactured 90 minutes, correct the
booking return flags, and—for Limkholwe only—restore the original £0 free-trial
source attribution. Expected LCB/shadow values are 90→0 for each learner;
minutes and pence in their legitimate paid sources remain unchanged.

Emilie's two source payments total 180 minutes and £165, and her two bookings
also total 180 minutes. The mismatch is attribution, not missing cash: #533
currently carries 120 minutes/£110 for a 90-minute lesson while #585 carries
60 minutes/£55 for another 90-minute lesson. The append-only correction prices
each lesson at £82.50, retires BCS #287, attaches 90 minutes/£82.50 of source
#318 to #533, and attaches the remaining 30 minutes/£27.50 of source #318 beside
the existing 60 minutes/£55 source #354 on #585. It neither calls Stripe nor
creates a refund, payout or transfer.

Migration 064 and all three transactions passed on production-derived branch
`br-square-cherry-abf7b30s`; the repair transactions were deliberately rolled
back. After Fraser's separate approvals and creation of recovery snapshot
`snap-quiet-queen-ab2pxnei`, migration 064 committed as successful receipt #64.
Lloyd's fingerprint
`sha256:d9859cacefaedaa33e1b1f9e61786d197d0aaa858339b080ea3964acd5fad2fe`
then committed successfully: LCB/shadow 90→0, booking #249 corrected, balance
audit #579 and audit log #652. Limkholwe's fingerprint
`sha256:b2a158b0d502a0d73f3676e1af3792be77928572826434497b1fd6f5a8cc1fba`
also committed: LCB/shadow 90→0, booking #331 corrected, BCS #91 restored,
balance audit #580 and audit log #653. Both replay checks returned
`already_applied`.

Emilie's fresh post-migration production dry run returned `ready` with no failed
checks. After her separate approval, fingerprint
`sha256:e982e5d8087d2e7f9fe0eadac59081797a90b66d0c7af78053aafad1817441e5`
committed successfully as audit #654. Historical BCS #287 is retired; corrected
BCS #362 attaches 90 minutes/£82.50 of source #318 to #533 and BCS #363 attaches
the remaining 30 minutes/£27.50 to #585 beside BCS #329's 60 minutes/£55. Both
bookings now carry £82.50, while source totals remain 180 minutes/£165 and both
balances remain zero. Every postcondition passed and the immediate dry run
returned `already_applied`. Simon's payouts and all withdrawals remain paused.

The read-only database postflight did not call Stripe. None of Lloyd,
Limkholwe, Emilie #533 or Emilie #585 appears in the remaining exact-refund or
Simon payout reconciliation warnings. Four unrelated LCB/source mismatches
remain: learner/instructor #20/#4 (90 vs 450 minutes), #36/#4 (360 vs 420),
#39/#6 (390 vs 1680), and #136/#5 (3 vs 63). Simon's payout simulation remains
fail-closed on missing immutable fee/gross evidence for bookings #473, #488,
#487, #519, #522, #536, #525, #526 and #582. The existing legacy/manual-review
and missing risk-reserve blockers are unchanged, so this repair does not
authorize or unpause any payout or withdrawal.

### Evidence limitations

- The original cohort refresh used deployed, school-scoped read and preview endpoints. The 14 September Lloyd/Limkholwe/Emilie follow-up used a fresh authenticated direct, non-pooler Neon connection and exact raw ledger columns without retaining credentials.
- A booking status of `refunded` does not itself prove that cash went back to the learner. Live Stripe showed no cash refunds on the 23 successful cohort charges; several refunded booking sources were reused for later bookings.
- Viba's production repair is sealed by state event #25 and audit #650: the ordinary LCB is zero and the flexible source exposes the correct 300 unused minutes.
- Megan's production repair is sealed by state event #24 and audit #646: the ordinary LCB is zero and the flexible source exposes the correct 900 unused minutes.
- Emilie #533/#585 are now reconciled in production by audit #654 and replacement BCS #362/#363; neither booking appears in the current Simon payout planner's funding-reconciliation blockers.
- Scheduled bookings and balances can change after the evidence timestamp. No future amount becomes earned until the booking reaches `chargeable` under the three-state lifecycle.

### Plain-English verdict

The campaign has produced real conversion and meaningful paid work: seven learners paid, six have already taken paid lessons, and Simon delivered 27 paid hours after the trials. But CoachCarter has realized only **£145.59 of genuine commission** against the **£300 acquisition cost**. The campaign is therefore **not yet profitable** on realized commission: it is **£154.41 below break-even** and has recovered **48.5%** of its acquisition cost.

The £35.06 of commission attached to proven future bookings improves the outlook but does not change today's verdict because it is protected, not earned. Even if all of it becomes chargeable, the cohort would still be £119.35 short. The remaining Stripe cash cannot close that gap merely by sitting in the platform balance; a substantial part is unused-credit liability or unresolved pooled cash, not CoachCarter revenue.
