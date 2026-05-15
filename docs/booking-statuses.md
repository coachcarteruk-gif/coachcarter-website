# Booking Statuses

The three-state lifecycle for `lesson_bookings.status`. Replaces the seven-state model retired in May 2026. See [`BOOKING-STATUS-RESTRUCTURE-PLAN.md`](../BOOKING-STATUS-RESTRUCTURE-PLAN.md) for the migration record.

## Load-bearing principle

> **The instructor is paid for every lesson on their calendar, unless the learner gave 48h+ notice that it wouldn't happen.**

This is the rule the three-state model exists to encode. If you find yourself adding a "did the lesson happen?" prompt, you're reintroducing the dual-confirmation flow that was deleted on purpose. Read this doc first.

## States

| Status | Meaning | Blocks slot? | Instructor paid? |
|---|---|---|---|
| `scheduled` | On the calendar, not yet resolved | Yes | Not yet |
| `chargeable` | Past lesson, instructor will be paid | Yes (for historical-overlap detection) | Yes |
| `refunded` | Killed booking, credit returned to learner | No | No |

## State diagram

```
       (book)
          │
          ▼
     scheduled ─────────────────► chargeable
          │     (end_time +1h, cron)     │
          │                              │
          ▼                              ▼
      refunded ◄─────── (admin override only) ──┘
```

## Transitions

| From | To | Trigger | Who |
|---|---|---|---|
| (new) | `scheduled` | Booking created | `slots.js`, `webhook.js`, `setmore-sync.js`, `admin.js` |
| `scheduled` | `chargeable` | `(scheduled_date + end_time) < NOW() - INTERVAL '1 hour'` | Hourly cron (`api/cron-auto-complete.js`) |
| `scheduled` | `refunded` | Learner cancels ≥48h ahead | `slots.js?action=cancel` |
| `scheduled` | `refunded` | Instructor cancels their own slot (any time) | `instructor.js?action=cancel-booking` |
| `scheduled` | `refunded` | Instructor cancels on learner's behalf (any time) | `instructor.js?action=cancel-booking` |
| `scheduled` | `refunded` | Admin cancels (any time) | `admin.js?action=cancel-booking` |
| `scheduled` | `refunded` | Reschedule — old row terminates here, new row born as `scheduled` | `slots.js?action=reschedule` |
| `chargeable` | `refunded` | Admin manual override (goodwill, retroactive dispute, post-payout correction) | `admin.js` |
| `refunded` | — | Terminal — no transitions out | — |

## Late-cancel under 48h

The learner-side `slots.js?action=cancel` path:

1. If cancel is ≥48h before `scheduled_date + start_time`: status → `refunded`, credits returned.
2. If cancel is <48h: status **stays** `scheduled`, `lesson_bookings.credit_forfeited = TRUE` is set. Credits are *not* returned. The hourly cron flips to `chargeable` after end-time +1h as normal. Instructor is paid.

Why not just set `chargeable` immediately on the late-cancel? Because the calendar UI would render a "chargeable" badge on a future-dated lesson, which is incoherent. The `credit_forfeited` flag is the informational signal until the cron runs.

## Who sets each status

**`scheduled` (writes):**
- `api/slots.js` — book, reschedule (new row), checkout-slot, checkout-slot-guest
- `api/webhook.js` — `handleSlotBooking`, `handleOfferBooking`, `handleFreeOffer`
- `api/setmore-sync.js` — imported bookings
- `api/admin.js` — admin-created bookings
- `api/offers.js` — offer-series bookings

**`chargeable` (writes):**
- `api/cron-auto-complete.js` — only writer; hourly batch flip
- Manual admin override (rare, for retroactive corrections)

**`refunded` (writes):**
- `api/slots.js` — cancel (≥48h), reschedule (old row)
- `api/instructor.js` — instructor-side cancel
- `api/admin.js` — admin cancel, admin retroactive refund (`chargeable → refunded`)

**`credit_forfeited = TRUE` (writes):**
- `api/slots.js` — learner cancel <48h (only writer)

## Payout implications

`api/_payout-helpers.js` includes a booking in the payout total when `status = 'chargeable'`. No grace period — the 1-hour buffer on `scheduled → chargeable` already absorbs clock skew and last-minute reschedule races, and there's no confirmation step that could stall.

Risk window: a Thursday-evening lesson is flipped to `chargeable` at the 20:30 cron run, leaving ~12 hours for an admin to manually flip it to `refunded` before the Friday 09:00 UTC payout cron. Rare; handled by retroactive admin refund + out-of-band Stripe transfer if it surfaces post-payout.

A booking flipped to `refunded` *after* its payout has already been recorded leaves the `payout_line_items` row intact for accounting. The Stripe transfer is not unwound automatically — Fraser handles the goodwill refund out-of-band.

## Don't inline status strings

Import from `api/_booking-status.js`:

```javascript
const { SCHEDULED, CHARGEABLE, REFUNDED, BLOCKING_STATUSES, isChargeable } = require('./_booking-status');

// good
await sql`UPDATE lesson_bookings SET status = ${REFUNDED} WHERE id = ${id}`;
await sql`SELECT 1 FROM lesson_bookings WHERE status = ANY(${BLOCKING_STATUSES}::text[]) AND ...`;

// bad
await sql`UPDATE lesson_bookings SET status = 'cancelled' WHERE id = ${id}`;  // wrong status name AND inlined string
```

Frontend code (status badge colour maps, filter labels) reads the strings directly — they're untrusted display data, not control flow.

## History of change

- **May 2026** — collapsed from seven states (`confirmed`, `awaiting_confirmation`, `completed`, `no_show`, `disputed`, `cancelled`, `rescheduled`) to three. Deleted the dual-confirmation email flow, the `_confirmation-resolver.js` module, the `prompt-confirmations` and `auto-confirm` crons, and the admin `resolve-dispute` endpoint. The 48h-rule branches in `slots.js` are unchanged; the only behavioural shift is that late-cancel under 48h now sets `credit_forfeited = TRUE` instead of leaving the booking with status `cancelled`. See `BOOKING-STATUS-RESTRUCTURE-PLAN.md`.

## Related

- [`BOOKING-STATUS-RESTRUCTURE-PLAN.md`](../BOOKING-STATUS-RESTRUCTURE-PLAN.md) — migration plan + rationale
- [`INSTRUCTOR-PAYMENTS-PLAN.md`](../INSTRUCTOR-PAYMENTS-PLAN.md) Step 4 — `list_price_pence` snapshot at booking
- [`docs/stripe-connect.md`](stripe-connect.md) — payout filter reads `chargeable`
- [`docs/setmore-sync.md`](setmore-sync.md) — imports write `scheduled`; cancellations write `refunded`
