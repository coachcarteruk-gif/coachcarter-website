# Simon payout reconciliation plan — period ending 11 September 2026

Status: implementation and review plan only. It does not authorise a deployment, Production mutation, payout approval, unpause, Stripe refund, payout, or transfer.

## Fixed authority

- School and instructor scope must match Simon's stored interim-v1 control.
- Simon remains paused throughout reconciliation and review.
- The payout interval is the stored Europe/London half-open interval `[2026-09-04 12:00, 2026-09-11 12:00)`, classified by lesson end instant.
- Every candidate must be unpaid, non-test and `chargeable`. `refunded`, early-cancelled and already-claimed bookings are excluded. Late learner cancellations which remain `chargeable` remain payable.
- Every positive amount must come from immutable provider/ledger evidence or a versioned operator funding-basis event. Unknown value blocks the entire approval; it is never replaced with a current price or zero.

## Reconciliation sequence

1. Deploy and verify the reviewed code and migration separately. Confirm the three new evidence tables exist, retain append-only triggers, and contain no seeded rows. Do not change Simon's pause or payout controls.
2. Capture the controlled preview and retain its fingerprint, included lines, excluded reasons and total. Expect unresolved funding blockers until the steps below are complete.
3. For each direct Stripe candidate, use `interim-v1-reconcile-funding-evidence` once with the booking's exact stored Checkout Session or PaymentIntent identity. The operation is allowed to read Stripe and append evidence/audit rows only. Review livemode, succeeded/paid/captured chain, `ch_` charge, `txn_` balance transaction, gross, currency, actual fee, status and `available_on`. A pending or contradictory result remains blocked. Never substitute a zero fee.
4. For each Flexible Hours source used in the period, run the same read-only reconciliation. Confirm original source gross equals the Stripe transaction gross and record the single actual package fee. The planner must allocate both values over all source units with deterministic remainder pennies; it must not deduct a new transaction fee per lesson.
5. Review Laura's two missing sources and Giovanni's three `absorbed_by='instructor'` goodwill rows against bank/cash/customer/audit evidence. If they are genuinely payable, append one `payout_funding_basis_events` classification per booking with explicit `gross_customer_revenue`, `net_after_processing`, or `final_instructor_payable` semantics. A non-Stripe gross basis has fee zero. A positive processing fee requires its own evidence reference. Do not alter BCS or historical credit rows.
6. Review Esha's £70.16 allocation contribution and Lily's £72.00/£70.50 evidence against the originating package transaction and any confirmed prior payout basis. If the stored value is already instructor-payable, classify it as `final_instructor_payable`; if it is net customer revenue, classify it as `net_after_processing`; if it is gross customer revenue, supply the actual attributable fee. Do not infer the semantics from the learner name, booking list price, or target statement.
7. Resolve Viba before approval as described below. Until resolved, the three-unit/60-minute mismatch must remain a visible blocker.
8. Re-run the controlled preview. Review all 22 source trails and verify the derived, non-hardcoded acceptance total is exactly 113,102 pence. The instructor next-payout preview, admin overview, and controlled owner preview must have the same fingerprint/total; calendar-week lesson lines must use the same per-lesson amounts.
9. Only after a separate explicit owner authorisation may an approval be created against that exact fingerprint and amount. Transfer execution requires another separate explicit authorisation. Keep Simon paused after success.

## Viba append-only repair design

Root cause: instructor edit-in-place could change a Flexible Hours booking from 90 to 60 minutes. It updated the booking duration but treated any `minutes_deducted > 0` row as ordinary Lesson Credit and never changed the three immutable 30-minute Flexible Hours allocation units. The instructor-managed reschedule path also did not move Flexible Hours allocations.

Future behaviour is fixed: Flexible Hours duration edits are refused, and instructor-managed reschedules move allocation returns/replacements inside the booking transaction and verify the exact minute count before terminalising the old booking.

Do not update or delete Viba's allocation. The current ledger only permits a full allocation return; it cannot express a one-unit correction safely because an exact-return trigger and `(school_id, source_id, booking_id)` uniqueness forbid a corrected replacement on the same booking. Prepare a separate reviewed repair migration/tool with this shape:

1. Add an append-only allocation-correction relation keyed to the original allocation, school, booking and source, with signed unit/value effect, stable idempotency key, reason, external evidence reference, operator identity and audit event.
2. Constrain cumulative corrections so effective units remain between zero and the original units; lock the source, booking and allocation in one transaction.
3. Update the remaining-unit and payout read models to use original allocation plus corrections. For Viba, append exactly `-1` unit and the corresponding immutable source value; do not recalculate from a lesson type.
4. Prove after the transaction that effective booking units are two, effective minutes are 60, the returned source balance increases by one unit, package gross/fee conservation still holds, and no payout/refund/transfer row changed.
5. Rehearse on an isolated clone, obtain review, then request separate explicit Production repair authorisation. This task intentionally does not implement or run that Production repair.

An interim payout funding-basis classification may not be used to conceal the entitlement error. The allocation mismatch must be repaired or explicitly accepted through a separately reviewed accounting correction before approval.
