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
- `POST /api/admin?action=record-manual-bank-refund` is ledger-only. It requires a refund preview, admin auth, `operator_go: "RECORD_MANUAL_BANK_REFUND_CONFIRMED"`, a stable `idempotency_key`, and a `manual_bank_reference`.
- Manual bank recording writes `refund_events(status='executed')` and `refund_event_lines` with `metadata.refund_channel = "manual_bank"`. It does not call `stripe.refunds.create`, change booking status, edit payout rows, create credit-source adjustments, or mutate learner credit.

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
- The current backend says the source is unsupported for execution.

Manual bank refund recording in the refund ledger is available only through the approved admin path. Do not invent ledger rows or edit `refund_events` manually.

Before recording:

- Run the latest refund preview.
- Confirm the case is not clean `execute_eligible`; clean original-method refunds should use the automatic execute path.
- Confirm the bank refund has been approved and completed outside Stripe.
- Enter the real bank reference in the admin form.
- Use the generated manual-bank idempotency key once for that learner/source/amount/reason.

## Post-Refund Verification Checklist

After an automatic execute result:

- Stripe refund exists where applicable and its ID matches the execute response.
- `refund_events` has one executed event for the idempotency key.
- `refund_event_lines` exist and match the preview/execute amount breakdown.
- Any backend-created `credit_source_adjustments` row is linked from the event line when the execute response indicates one was needed.
- Booking status is unchanged unless a separate reviewed workflow intentionally changed it.
- Payout rows are unchanged.
- Learner credits were not manually edited. If the supported execute path created a backend-controlled credit-source adjustment, verify it matches the refund ledger.
- Admin/operator evidence is captured using current system capabilities.
- Learner communication uses the ledger amount, not an estimate from memory.

After a manual bank record result:

- The bank transfer/reference exists outside Stripe and matches `metadata.manual_bank_reference`.
- `refund_events` has one executed event for the idempotency key with `metadata.refund_channel = "manual_bank"` and no `stripe_refund_id`.
- `refund_event_lines` exist and match the preview amount breakdown.
- Booking status is unchanged.
- Payout rows are unchanged.
- Learner credits were not manually edited by the record path.
- Learner communication uses the ledger amount and bank evidence, not an estimate from memory.

Current tooling does not provide a dedicated operator-note trail for refunds beyond reason text, audit log entries for executed automatic refunds, and ledger metadata. Keep external evidence until an admin notes/audit trail slice exists.

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
- Do not manually insert `refund_events` or `refund_event_lines`.
- Do not manually edit booking status, payout rows, or credits.
- Ask Fraser to decide the repair path.

If the backend reports `INCOMPLETE_REFUND_LEDGER`:

- A prior refund event exists for the idempotency key, but the ledger is incomplete.
- Do not retry blindly and do not use a different idempotency key to bypass the blocker.
- Stop for manual investigation.

## Future Implementation Notes

These are non-operative notes for later slices:

- Enrich preview responses with clearer operator labels for supported execute vs manual-review cases.
- Build an execute UI that preserves preview evidence, requires the exact confirmation phrase, and generates/stores a stable idempotency key.
- Extend manual bank recording only if future cases need richer evidence fields or a dedicated incident workflow.
- Add admin refund notes and stronger audit trail affordances.
- Add a dedicated incident/repair workflow for Stripe-success/local-ledger-failure cases.
