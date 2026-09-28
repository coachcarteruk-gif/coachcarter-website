# Historical shortened-lesson credit repair — 28 September 2026

Production repair completed, audit **815**. Giovanni's spendable Lesson Credit
now matches his displayed **300 minutes** with instructor 6. No learner balance,
booking duration/status, historical credit transaction, cash value, refund or
payout record was changed.

## Cause and audit coverage

The old edit path changed `minutes_deducted` and LCB and appended a positive
`edit_adjustment`, but retained the original `booking_credit_sources` (BCS)
allocation. FIFO excludes edit markers, so returned minutes appeared in the
balance but remained allocated to the old booking.

Reviewed all existing school-1 credit-funded bookings for active BCS versus
deducted minutes, including rescheduled bookings, the historical edit-adjustment
cohort, and Flexible Hours allocation discrepancies. This is not every shortened
lesson: Viba's Flexible Hours and Emilie's credit corrections were already
reconciled. Free-trial funding rows were classified separately because their
allocated minutes legitimately differ from paid `minutes_deducted`.

| Learner | Booking IDs | Excess allocation repaired | Remaining credit |
| --- | --- | --- | --- |
| Giovanni (39), instructor 6 | 386, 389, 414, 440, 458, 495, 496, 497 | 270 minutes | 300 minutes |
| Lleiz (134), instructor 4 | 539, rescheduled from 532 | 30 minutes | 0 minutes |

Lleiz's zero balance is intentional: owner cleanup audit **707** explicitly
removed the 30 remaining minutes on 19 September. This repair preserves that
instruction. It does not grant another 30 minutes.

The postflight query found no remaining non-trial **over-allocation**. Its sole
remaining duration mismatch is Lily's **lengthened** booking 286: 90 minutes
deducted, 60 allocated. That is a separate under-allocation, not repaired here.
A refunded Flexible Hours booking 574 retaining an active allocation is also a
separate cancellation case; no cancellation or payout policy was changed.

## Exact changes

- Supersede original BCS IDs 147, 150, 177, 203, 222, 258, 259, 260 and 291 using
  the existing `refunded_at` replacement-history convention; retain those rows.
- Append corrected BCS IDs **422–430**, with the same original source, rate,
  absorption, zero contribution and zero fee. Giovanni's rows become 60 minutes;
  Lleiz's row becomes 90 minutes.
- Append adjustments **22–30** against Giovanni's nine historical edit markers
  (270 minutes total). Releasing BCS now represents those returns, so leaving the
  positive edit markers unadjusted would count the return twice in the journal.
  These marker adjustments remove no FIFO-spendable credit and change no LCB.
- Preserve adjustment 17 against Lleiz's edit marker 321. Append adjustment
  **31**, 30 minutes against original source 317, to preserve the owner's cleared
  entitlement after releasing the excess allocation.
- Preserve Giovanni's earlier 180-minute source correction (adjustment 21).
- Write required audit 815 with operator, reviewed fingerprint, backup reference,
  original/replacement IDs and before/after spendability. Everything commits in
  one serializable transaction; an audit failure rolls it all back.

The three existing manual settlement claims on Giovanni's bookings 414, 458 and
495, and Lleiz's zero-value payout line 214, remain byte-for-byte unchanged.
No new payout eligibility, payment execution or financial repricing is introduced.
This narrow repair is safe for these settled rows because it changes only stale
zero-value source minutes; it is not permission to edit settled lesson duration.

## Prevention and verification

The current admin/instructor delivered-duration correction flow already updates
LCB and allocations together. Ordinary duration edits are blocked for credit and
Flexible Hours bookings. Corrections reject inconsistent funding, future lessons,
and payout-claimed lessons. See [delivered-duration-corrections.md](delivered-duration-corrections.md).
No additional production API deployment was required for this historical repair.
The live `www.coachcarter.uk` alias was verified READY on production deployment
`dpl_9zBcKas2oYvxmSEenzWJ9UCERkn6`, commit `91902d2` (PR 490), which contains
the current correction flow.

Verification completed:

- Nine focused PostgreSQL tests: exact source repair, five sequential one-hour
  draws, sixth draw refused, repeat-run safety, wrong-school operator, stale
  fingerprint, cash/refund/evidence guards, and full rollback on audit failure.
- Nineteen existing duration-correction/API/UI regression tests passed.
- Actual production-schema rehearsal on isolated branch
  `br-crimson-wind-abxtto5v`, including apply/replay and complete rollback.
- Backup `snap-lingering-paper-abbb1qk3`, created before production apply.
- Fresh production preview fingerprint
  `e695406a60b3d3d4506db3ddbb6d253b03b7ae5798564bc1d56825b638a896ee`.
- Read-only production postflight: Giovanni FIFO and journal both 300 minutes;
  Lleiz FIFO and journal both zero. The real divergence checker, run with alerts
  disabled, reports neither learner as drifting. Preserved records were compared
  against the pre-apply snapshot. No real learner booking was created for testing.

## Operator entry point

`node scripts/shortened-lesson-credit-repair.js` defaults to a read-only preview
using a direct `POSTGRES_URL_UNPOOLED`. It is restricted to production branch
`br-summer-silence-abcpp6vw`, database `neondb`, school 1 and the exact reviewed
targets. Apply additionally requires the `SHORTENED_LESSON_REPAIR_ENABLED=REVIEWED`
environment gate, `--mode=apply`, `--confirm=APPLY_SHORTENED_LESSON_REPAIR`,
`--reviewed-fingerprint=...`, `--admin-id=1`, `--operator-identity=...`, and
`--evidence-reference=...`. A receipt makes subsequent runs a no-op. This tool is
not a reusable bulk correction facility; unexpected state fails closed.
