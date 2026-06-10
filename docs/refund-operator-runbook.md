# Refund Operator Runbook

This runbook is for admin/operator handling of approved learner booking and credit refunds in CoachCarter / InstructorBook.

It explains how to use the current refund preview and gated execute backend safely, when to move to manual bank handling, what to verify afterwards, and when to stop and ask Fraser before proceeding.

This is an operational guide only. It does not authorise UI changes, API changes, database migrations, manual production SQL, live Stripe dashboard mutations, or edits to refund ledger tables.

## Golden Rules

1. Preview first. Every refund discussion that might become an action starts with a refund preview.
2. Do not take live Stripe or dashboard action unless this runbook explicitly says the case belongs there.
3. Do not execute blocked or `manual_review_required` previews.
4. Do not mutate booking status, payout rows, learner credits, `refund_events`, or `refund_event_lines` to make the numbers work.
5. Keep evidence: booking/source IDs, preview output, Stripe references, decision reason, and idempotency key.
6. Use one stable idempotency key per approved automatic refund attempt. Never reuse a key for a different learner, source, amount, or reason.
7. Stop and escalate on ambiguity.

## Current Backend Surface

- `POST /api/admin?action=refund-preview` is read-only. It is admin-authenticated, school-scoped, and returns gross refund value, processing fee withheld, net amount returned, itemised lines, fee evidence, Stripe references, warnings, and blocked/manual-review flags.
- `POST /api/admin?action=execute-refund` is gated. It requires admin auth, `operator_go: "EXECUTE_REFUND_CONFIRMED"`, an `idempotency_key`, and a trusted server-side planner rerun before any Stripe mutation.
- Execute rejects blocked/manual-review plans before Stripe.
- Execute calls Stripe only after planner blockers clear.
- Execute writes `refund_events(status='executed')` and `refund_event_lines` only after Stripe succeeds.
- Execute must not be used to change booking status or payout rows.
- For supported unused credit-source refunds, the current backend may also create a `credit_source_adjustments` row and apply its locked balance decrement as part of the execute transaction. Treat that as backend-controlled accounting, not an operator instruction to edit credits manually.
- Automatic execution for booking-credit-source lines is not enabled in this slice; those cases may preview but must not be forced through by hand.
- Already-paid-out direct bookings and missing fee evidence are blocked/manual-review cases, not automatic refunds.
- `POST /api/admin?action=record-manual-bank-refund` is ledger-only. It requires a refund preview, admin auth, `operator_go: "RECORD_MANUAL_BANK_REFUND_CONFIRMED"`, a stable `idempotency_key`, and a `manual_bank_reference`. Optional `evidence_reference` and `operator_note` are stored in refund ledger metadata.
- Manual bank recording writes `refund_events(status='executed')` and `refund_event_lines` with `metadata.refund_channel = "manual_bank"`. It does not call `stripe.refunds.create`, change booking status, edit payout rows, create credit-source adjustments, or mutate learner credit.
- `GET /api/admin?action=refund-events` is read-only refund-event discovery/detail. It is admin-authenticated and school-scoped. Operators can search recent refund events by event ID, idempotency key, Stripe refund/payment references, learner ID/name/email, refund type/status, and date window. Detail loads the event metadata, ledger lines, and notes timeline.
- `GET /api/admin?action=refund-incident-readiness&refund_event_id=...` is a read-only incident readiness classifier. It is admin-authenticated and school-scoped. It reads only local `refund_events`, `refund_event_lines`, stored Stripe reference columns, event metadata, and `refund_event_notes`; it does not call Stripe and does not mutate refund, booking, payout, CSA, BCS, credit-transaction, or learner-credit tables. It classifies the local record as `complete`, `incomplete`, or `needs_manual_decision`.
- The admin portal Refund Operations event detail now displays incident readiness from that endpoint. The panel is visibility-only: it shows classification, evidence, incomplete/manual-decision reasons, stop conditions, and the allowed next step. It has no repair, execute, Stripe, booking, payout, credit, CSA, BCS, or ledger mutation controls.
- `GET /api/admin?action=refund-notes&refund_event_id=...` and `POST /api/admin?action=add-refund-note` provide an admin-only notes timeline for operator context, evidence references, incidents, and repair decisions. Notes are context-only; they do not repair, mutate, or rebalance refund accounting.

## Refund Decision Flow

1. Find the admin context:
   - Confirm the school/tenant.
   - Find the learner, booking, credit transaction, or booking credit source involved.
   - Confirm whether the case is a credit purchase/source refund, repeat-offer unused value, direct slot, direct offer, or out-of-model/manual case.

2. Run refund preview in the admin portal:
   - Use the Refund Preview view or the booking row's "Refund preview" entry point where available.
   - Enter the relevant source ID and a clear reason.
   - Do not contact the learner with final figures before reviewing the preview.

3. Review the preview:
   - Gross refund value.
   - Processing fee withheld.
   - Net amount returned.
   - Payment source and Stripe references.
   - Fee evidence source.
   - Itemised lines.
   - Warnings, `blocked`, `manual_review_required`, `code`, and `message`.

4. Decide:
   - Clean/automatic preview: eligible for the approved execute path once an execute UI exists, or via a reviewed backend/operator tool.
   - `blocked: true`: do not execute.
   - `manual_review_required: true`: do not execute automatically.
   - Already-paid-out direct booking: stop for manual review; only use approved manual bank handling after Fraser signs off, not automatic Stripe refund.
   - Original-method Stripe refund fails, cannot be funded from the Stripe balance, cannot return to the original payment method, or is otherwise blocked: stop automatic handling and move only to approved manual bank handling after Fraser signs off.
   - Out-of-model/manual case: stop until a reviewed process exists.

5. Execute only when allowed:
   - Use only the approved admin/backend path.
   - Include `operator_go: "EXECUTE_REFUND_CONFIRMED"`.
   - Include the stable idempotency key already recorded with the decision evidence.
   - Confirm the execute result matches the preview before communicating final completion to the learner.

## When To Preview

Run preview:

- Before any refund discussion becomes an operational action.
- Before contacting the learner with final amounts.
- Before any manual bank refund decision.
- After resolving any uncertainty about booking, payment, source, or payout state.
- Again if any relevant state changed since the last preview.

Preview does not issue a refund, write refund ledger rows, change bookings, change payouts, mutate credits, or call `stripe.refunds.create`.

## When Automatic Execute Is Allowed

Automatic execute is allowed only when all of these are true:

- The latest preview is clean: `blocked` is false and `manual_review_required` is false.
- The payment source and fee evidence are clear.
- The refund amount is expected and has been reviewed.
- The case is supported by the current backend execute path.
- The operator has explicit approval to run execute.
- The request uses `operator_go: "EXECUTE_REFUND_CONFIRMED"`.
- The request uses a stable idempotency key that is unique to this approved refund.
- The execution goes through the approved admin/backend path.

Do not use the Stripe dashboard as a substitute for execute. The only exception is an explicitly directed incident response from Fraser, with the reason and evidence recorded separately.

## When Manual Bank Refund Is Required Or Likely

These cases require manual review and may only proceed via approved manual bank handling:

- A direct booking has already appeared in `payout_line_items`.
- Stripe processing-fee evidence is missing.
- Preview is `blocked` or `manual_review_required`.
- The payment source is unclear.
- Money has moved outside the current automatic refund model.
- Stripe cannot be the original-method refund target.
- A Stripe original-method refund attempt fails, cannot be funded from the Stripe balance, cannot return to the original method, or is otherwise blocked.
- The current backend says the source is unsupported for execution.

Manual bank refund recording in the refund ledger is available only through the approved admin path. Do not invent ledger rows or edit `refund_events` manually.

Manual bank transfer is the last-resort operator path for an already-approved refund. It is not a learner self-serve option, and it does not broaden automatic Stripe refund execution. The operator completes the bank transfer outside Stripe, then records it through `POST /api/admin?action=record-manual-bank-refund` with the real bank reference, preserved evidence/reference, and concise operator notes.

Before recording:

- Run the latest refund preview.
- Confirm the case is not clean `execute_eligible`; clean original-method refunds should use the automatic execute path.
- Confirm the bank refund has been approved and completed outside Stripe.
- Enter the real bank reference in the admin form.
- Add the bank statement/screenshot/approval reference and any concise operator note when available.
- Use the generated manual-bank idempotency key once for that learner/source/amount/reason.

## Post-Refund Verification Checklist

After an automatic execute result:

- Use Refund Operations search if you need to find the event by idempotency key, Stripe reference, learner, type/status, or recent date range.
- Stripe refund exists where applicable and its ID matches the execute response.
- `refund_events` has one executed event for the idempotency key.
- `refund_event_lines` exist and match the preview/execute amount breakdown.
- Any backend-created `credit_source_adjustments` row is linked from the event line when the execute response indicates one was needed.
- Any follow-up operator evidence, incident, or repair-decision context is attached through the refund notes timeline.
- Booking status is unchanged unless a separate reviewed workflow intentionally changed it.
- Payout rows are unchanged.
- Learner credits were not manually edited. If the supported execute path created a backend-controlled credit-source adjustment, verify it matches the refund ledger.
- Admin/operator evidence is captured using current system capabilities.
- Learner communication uses the ledger amount, not an estimate from memory.

After a manual bank record result:

- Use Refund Operations search if you need to find the event by bank-record idempotency key, learner, type/status, or recent date range.
- The bank transfer/reference exists outside Stripe and matches `metadata.manual_bank_reference`.
- Any captured bank evidence reference and operator note are present in `metadata.evidence_reference` and `metadata.operator_note`.
- `refund_events` has one executed event for the idempotency key with `metadata.refund_channel = "manual_bank"` and no `stripe_refund_id`.
- `refund_event_lines` exist and match the preview amount breakdown.
- Any follow-up operator evidence, incident, or repair-decision context is attached through the refund notes timeline.
- Booking status is unchanged.
- Payout rows are unchanged.
- Learner credits were not manually edited by the record path.
- Learner communication uses the ledger amount and bank evidence, not an estimate from memory.

Current tooling stores manual-bank evidence reference and operator note in ledger metadata, and refund events now have a dedicated notes timeline for follow-up context. It still does not provide an automated incident-repair workflow. Keep external source evidence until any required repair path is complete.

## Incident Repair Readiness

This section designs the next repair workflow but does not authorise repair mutation.

Use readiness when there is already a local refund event and an operator needs to decide whether the event is complete, incomplete, or blocked on a human decision. The readiness endpoint is a local classifier only. It does not prove that Stripe money moved; it only reports what the CoachCarter ledger currently knows.

Current UI visibility:

- Open Refund Preview -> Refund Operations, search for the refund event, and open the event detail.
- The Incident Readiness panel loads from `GET /api/admin?action=refund-incident-readiness&refund_event_id=...`.
- The panel may prefill an `incident` or `repair_decision` note, but saving still goes through the existing `add-refund-note` endpoint and records context only.
- There is still no repair mutation. If readiness is `incomplete` or `needs_manual_decision`, record evidence and stop for review.

Readiness classifications:

- `complete`: the event is `executed`, has at least one ledger line, line totals match event gross/fee/net totals, automatic Stripe credit-source lines have their CSA link where required, and there is no open incident note or missing required local reference.
- `incomplete`: the event is structurally incomplete, such as missing `refund_event_lines`, line totals not matching the event totals, or a Stripe automatic credit-source refund line missing its `credit_source_adjustment_id`.
- `needs_manual_decision`: the local ledger is not structurally incomplete, but the operator must decide before any future repair path is considered. Examples include non-`executed` event status, missing local Stripe refund reference for a non-manual-bank returned amount, missing manual-bank reference on a manual-bank event, or an open/watching incident note.

Repairable later, subject to a separate reviewed mutation slice:

- Stripe-success/local-ledger-failure cases where Stripe refund evidence exists, the event belongs to the same school, the event is `executed`, the idempotency key matches the original approved attempt, and the only defect is missing or incomplete local refund ledger/accounting rows.
- Incomplete local ledger cases where the original trusted preview, admin identity, school, learner/source IDs, Stripe refund ID, Stripe payment references, idempotency key, amount breakdown, and failure timestamp can be tied together without ambiguity.
- Automatic credit-source refund incidents where the intended future repair can write the missing CSA and LCB adjustment only if the source, learner, instructor, school, minutes, amount, and Stripe refund ID match the original approved plan exactly.

Explicitly not repairable by an automated repair path:

- Cross-school events or any case where school scope is uncertain.
- Cases without Stripe refund evidence for an original-method refund.
- Events with a reused or ambiguous idempotency key.
- Amount, learner, instructor, source, booking, or payment-reference mismatches.
- Disputes, chargebacks, cash repayments, partial external repayments, or money movement outside the model.
- Clean manual-bank ledger records that only need evidence review, not accounting repair.
- Booking status changes, payout reversals, learner-credit goodwill, or commercial decisions disguised as repair.

Required evidence before any future repair mutation is designed:

- Refund event ID, school ID, learner ID, refund type, status, and created admin.
- Original idempotency key and the exact request body, excluding secrets.
- Trusted preview output used for approval.
- Stripe refund ID, payment intent or charge ID, and balance transaction ID where applicable.
- Event metadata, existing ledger lines, and notes timeline.
- Failure response, timestamp, admin identity, and any platform logs.
- Clear operator note or repair-decision note explaining why the case is considered repairable.

Stop conditions:

- Readiness returns `needs_manual_decision`.
- Readiness returns `incomplete` but there is no Stripe refund ID or the idempotency key is ambiguous.
- The event is not in the authenticated school.
- Any evidence item above is missing or contradictory.
- Any proposed fix requires changing booking status, payout rows, learner balances, historical BCS rows, or historical refund event values.

School scope:

- Every readiness and future repair query must filter by authenticated `school_id`.
- A repair design must never accept caller-supplied school, learner, instructor, booking, source, amount, or Stripe values as trusted. They must be derived from the school-scoped refund event, trusted preview evidence, and existing ledger/source rows.

Idempotency rules:

- The original refund idempotency key remains the anchor for Stripe-success/local-ledger-failure repair.
- A future repair mutation may have its own repair idempotency key, but it must be bound to one refund event, one school, one Stripe refund ID, and one exact repair plan fingerprint.
- Never use a new refund execution idempotency key to bypass an incomplete ledger blocker.

Audit requirements for a future mutation slice:

- Audit-log every repair attempt, success, no-op replay, and refusal.
- Include admin identity, school ID, refund event ID, original refund idempotency key, repair idempotency key, Stripe refund ID, evidence reference, before/after affected row IDs, and refusal reason where applicable.
- Add a `repair_decision` refund note before or during the reviewed repair path so the operator timeline explains why the mutation occurred.

Allowed future repair writes, only after a separate reviewed implementation:

- Missing `refund_event_lines` for the existing school-scoped refund event.
- Missing `credit_source_adjustments` for a supported automatic credit-source refund.
- The paired `learner_credit_balances` decrement required by that CSA, using the existing locked LCB mutation helper and the trusted learner/instructor/school tuple.
- `refund_event_notes` and `audit_log` context for repair decisions and outcomes.

Forbidden mutations unless separately reviewed:

- Manual editing of existing `refund_events` values.
- Manual editing of existing `refund_event_lines` values.
- Any `booking_credit_sources` historical mutation.
- Any `credit_transactions` historical mutation.
- Any booking status mutation.
- Any payout row mutation.
- Any Stripe refund broadening or dashboard-only Stripe action.
- Any learner credit mutation not paired to a reviewed CSA repair plan.

## Stop Conditions

Stop and ask Fraser before proceeding if:

- Preview is blocked.
- Preview is `manual_review_required`.
- The payment source is unclear.
- The booking appears already paid out.
- Stripe fee evidence is missing.
- The amount does not match expectation.
- Duplicate refund risk exists.
- The idempotency key or prior result is unclear.
- A prior event exists but the backend reports `INCOMPLETE_REFUND_LEDGER`.
- Any production DB edit or manual SQL seems necessary.
- Any live Stripe dashboard mutation seems necessary.
- Any change to booking status, payout rows, or learner credits seems necessary to make the refund work.
- GDPR deletion or anonymisation touches the learner/payment records involved.
- The case involves a dispute, chargeback, partial external repayment, cash payment, or any money movement outside the automatic model.

## Incident Notes

If execute fails before Stripe succeeds:

- The backend returns an error such as `STRIPE_REFUND_FAILED`.
- The intended behavior is no refund ledger write, no credit-source adjustment, no balance adjustment, and no audit entry for execution.
- Record the preview, request body excluding secrets, idempotency key, response code/message, and Stripe/booking/source context.
- Do not retry with a different idempotency key until the failure mode is understood.

If Stripe succeeds but ledger/accounting write fails:

- The backend may return a 500 or a specific manual-review error such as `CREDIT_BALANCE_ADJUST_FAILED` with `stripe_refund_id`.
- Treat this as an incident: money may have moved but the local ledger may be incomplete.
- Record the Stripe refund ID, idempotency key, request body excluding secrets, preview, backend response, timestamp, admin identity, and affected learner/source IDs.
- Add an `incident` refund note where a refund event exists; otherwise keep the evidence externally until Fraser chooses the repair path.
- Do not manually insert `refund_events` or `refund_event_lines`.
- Do not manually edit booking status, payout rows, or credits.
- Ask Fraser to decide the repair path.

If the backend reports `INCOMPLETE_REFUND_LEDGER`:

- A prior refund event exists for the idempotency key, but the ledger is incomplete.
- Do not retry blindly and do not use a different idempotency key to bypass the blocker.
- Add an `incident` or `repair_decision` refund note to the existing event after investigation.
- Stop for manual investigation.

## Future Implementation Notes

These are non-operative notes for later slices:

- Enrich preview responses with clearer operator labels for supported execute vs manual-review cases.
- Keep refund-event discovery/search stable and extend only if operators need additional read-only filters.
- Add a dedicated repair workflow for Stripe-success/local-ledger-failure cases.
