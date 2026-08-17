# Paid booking fulfilment recovery

This guardrail covers the narrow state where Stripe Checkout is paid and a
tenant-scoped `credit_transactions.type='slot_purchase'` row exists, but the
intended one-off booking was not created. It supports direct lesson slots and
single, slot-pinned instructor offers only. Repeating, flexible and test-date
payments remain operator-reviewed.

The webhook must not return success for a confirmed orphan. Recovery runs in a
serializable transaction and locks booking creation while it validates:

- exact school, learner, instructor, Checkout session and PaymentIntent scope;
- complete immutable amount, minutes, effective rate, Stripe fee and provider
  charge/balance-transaction identity evidence;
- no exact terminal or contradictory booking;
- no overlapping booking, active reservation, offer, request, recurring hold,
  busy block, external event, blackout or unavailable override; and
- the learner/instructor balance against the same CT/BCS/CSA formula used by
  the read-only credit reconciliation job.

If the orphan payment was never staged into spendable credit, recovery performs
an audited add/deduct net-zero cycle. If an earlier attempt staged the exact
credit, recovery consumes it once. Any other balance state is drift and stops
automatic fulfilment. The transaction then creates one scheduled booking, one
idempotent BCS attribution, accepts the matching offer when applicable, and
removes only reservations belonging to the same Checkout session.

Concurrent unique-key races return an error so Stripe retries after the winning
handler becomes visible. Existing exact booking/BCS pairs are idempotent no-ops.
No recovery path creates charges, refunds, transfers, payouts or notifications.
