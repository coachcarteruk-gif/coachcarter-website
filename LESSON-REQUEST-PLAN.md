# Lesson Request System ("Request to Book") — Plan

**Status: DRAFT — 2026-07-10. Not yet implemented.**

## Problem

Simon sometimes has other work and can't keep his diary fully up to date, but still wants
learners to be able to ask him about slots. Today a visible slot is instantly bookable, so
he either hides availability (loses bookings) or risks double-booking himself.

## Solution shape (decisions agreed 2026-07-10)

- Per-instructor **"Request to book"** toggle. When ON, learners see the instructor's slots
  as normal but must *request* a slot instead of instantly booking it. The instructor
  accepts or declines each request.
- **Payment is held, not taken.** Card payments use a Stripe **authorization hold**
  (`capture_method: 'manual'`): captured on accept, cancelled on decline/expiry — the
  learner's card is never charged for a declined request. Credit-funded requests deduct
  credits at request time and refund them in full on decline/expiry.
  - Rationale: charging then refunding as platform credit is shaky under UK consumer
    rights, eats Stripe fees on the round trip, and feels coercive to new learners.
- **A pending request blocks the slot** for everyone else. Expiry keeps slots from being
  held hostage.
- **Auto-expiry**: a request expires at `min(request_time + 48h, lesson_start − 2h)`.
  48h sits comfortably inside Stripe's ~7-day auth-hold window.
- **Notifications**: WhatsApp (`api/_whatsapp.js`) + email to the instructor on new
  request; learner notified on accept (normal booking confirmation) and on
  decline/expiry. Guest decline email must state explicitly: **"your card was not
  charged"** (they see a pending auth on their statement that will drop off).
- **Approval UI lives on the instructor dashboard** (pending-requests card with
  accept/decline), not a new page. The WhatsApp nudge is the primary surface; the card is
  where the action happens.
- **Reuse the offers system's *patterns*, not its rows.** `lesson_offers` is the same
  machine in reverse (tokenized pending-lesson row, expiry cron, webhook-driven booking
  creation), but its column semantics (instructor-initiated, pay-at-accept, discount_pct)
  and status flow don't fit. New `lesson_requests` table, same architectural patterns.

## Schema (`db/migration.sql`)

```sql
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS request_to_book BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS lesson_requests (
  id                 SERIAL PRIMARY KEY,
  school_id          INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
  instructor_id      INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  learner_id         INTEGER REFERENCES learner_users(id) ON DELETE SET NULL,
  -- guest requests: no learner_id; identity captured from Stripe checkout
  guest_email        TEXT,
  guest_name         TEXT,
  guest_phone        TEXT,
  scheduled_date     DATE NOT NULL,
  start_time         TIME NOT NULL,
  end_time           TIME NOT NULL,
  lesson_type_id     INTEGER REFERENCES lesson_types(id),
  pickup_address     TEXT,
  payment_method     TEXT NOT NULL CHECK (payment_method IN ('card_hold','credit')),
  stripe_session_id  TEXT,            -- card_hold path
  payment_intent_id  TEXT,            -- card_hold path: the uncaptured PI
  amount_pence       INTEGER,         -- card_hold path: held amount
  credits_minutes    INTEGER,         -- credit path: minutes deducted at request time
  list_price_pence   INTEGER,         -- price snapshot at request time
  list_price_source  TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  booking_id         INTEGER REFERENCES lesson_bookings(id),
  decline_reason     TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_instructor ON lesson_requests(instructor_id);
CREATE INDEX IF NOT EXISTS idx_requests_learner    ON lesson_requests(learner_id);
CREATE INDEX IF NOT EXISTS idx_requests_school     ON lesson_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_requests_booking    ON lesson_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_requests_lesson_type ON lesson_requests(lesson_type_id);
CREATE INDEX IF NOT EXISTS idx_requests_expiry     ON lesson_requests(expires_at) WHERE status = 'pending';
-- one pending request per slot — this is the slot lock
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_slot
  ON lesson_requests(instructor_id, scheduled_date, start_time) WHERE status = 'pending';
```

Notes:
- `status='withdrawn'` = learner cancelled their own pending request.
- `lesson_bookings` is untouched — a request only becomes a booking row on accept, so the
  3-state booking model (`scheduled`/`chargeable`/`refunded`) is not modified.
- Follows GDPR rule 1 (school_id), security rule 6 (FK indexes).
- Diagnostics: `db/diagnostics/lesson-requests-{pre,post}-migration.sql` per convention.

## Slot blocking

A pending request must block the slot exactly like a `BLOCKING_STATUSES` booking. Two
layers:

1. **Feed**: `slots.js ?action=available` (and `durations-for-slot`) exclude/clash any
   window overlapping a `lesson_requests` row with `status='pending'` for that instructor.
2. **Booking guards**: every path that creates a booking or a pending hold on a slot adds
   a pending-request overlap check alongside the existing booking-clash check:
   `book`, `checkout-slot`, `checkout-slot-guest`, `book-free-trial`, `reschedule`,
   `create-offer` / `create-broadcast-offer` (instructor.js), test-date booking paths,
   `bookOfferSeries` week-clash logic in `offers.js` (skip weeks with a pending request),
   and Setmore sync is unaffected (imports don't check clashes; instructor accepting a
   request for a slot Setmore later imports over is the same conflict that exists today).

Suggested implementation: one shared helper (e.g. `api/_request-clash.js` or a function
exported from the new `api/requests.js`) `hasPendingRequestClash(sql, instructorId, date,
startTime, endTime)` so the guard isn't copy-pasted nine times.

Race protection: the `uq_request_slot` partial unique index makes two simultaneous
requests for the same slot impossible; the booking-side guards close the
request-vs-instant-book race for the same slot on instructors who later toggle OFF
(pending requests from the ON period must still be honoured — decisions still work after
the toggle changes).

## Payment flows

### Card (logged-in learner without enough credit, or guest)

1. Learner picks slot in the booking modal → `POST /api/requests?action=checkout-request`
   (mirrors `checkout-slot` / `checkout-slot-guest`): validates availability, clash,
   28-day cap, travel warnings, then creates a Stripe Checkout session with
   `payment_intent_data: { capture_method: 'manual' }` and request metadata
   (same metadata-freezing pattern as offers).
2. Webhook `checkout.session.completed` (new `handleRequestHold` branch in
   `api/webhook.js`): re-check the slot is still free **and** no pending request row
   exists → insert `lesson_requests` row (`pending`, PI id, expiry) → notify instructor
   (WhatsApp + email, awaited — never fire-and-forget on Vercel). If the slot was taken
   between checkout-start and webhook, immediately `paymentIntents.cancel()` and send the
   learner a "slot no longer available, you were not charged" email.
3. **Accept** → `stripe.paymentIntents.capture(pi)` → create the booking (reuse the
   booking-insert path used by `handleSlotBooking`, snapshotting `list_price_pence` from
   the request row) → set `status='accepted'`, `booking_id` → booking confirmation to
   learner. If capture fails (card died during the hold window): decline the request with
   a distinct learner message ("payment could not be completed — please request again").
4. **Decline / expire / withdraw** → `stripe.paymentIntents.cancel(pi)` → learner
   notified. Guest email explicitly: card never charged, pending authorization drops off
   in a few days.

Stripe constraint: uncaptured PIs auto-expire ~7 days after authorization. Our 48h expiry
is well inside this. `CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES` may need extending — some
payment methods (e.g. certain bank redirects) don't support manual capture; card does.
**Verify at implementation time which methods the account offers support manual capture,
and restrict the request-checkout session to those.**

### Credits (the majority path)

1. `POST /api/requests?action=request-slot` (auth: learner): validate slot + clash + cap,
   then deduct credits via `lockBalanceAndMutate` (per-instructor scoped balance) with a
   matching `credit_transactions` row, then insert the `lesson_requests` row in the same
   transaction.
2. **Accept** → create booking (credit-funded booking insert; credits already deducted, so
   the accept step must NOT deduct again — the request row carries `credits_minutes` as
   the record of what was taken).
3. **Decline / expire / withdraw** → refund credits via `lockBalanceAndMutate` + matching
   CT row.

⚠️ **Money-path discipline applies** (`feedback_implementation_protocol_money_paths`):
- Every LCB mutation needs its matching `credit_transactions` row or the divergence cron
  gets louder (`feedback_lcb_reshape_needs_matching_ct`).
- **Check the divergence cron's expected-balance formula** — it reconciles CT rows against
  LCB. A deduct-at-request + refund-at-decline pair is net-zero and self-consistent, but a
  *pending* request (deducted, no booking yet) must not read as drift. Audit the cron's
  formula and the CT `type` values it recognizes before choosing type names (suggest
  `request_hold` / `request_refund`, but **verify against the live CHECK constraint on
  `credit_transactions.type`** — it was live-patched in prod on 2026-05-10 and may be
  stricter than `db/migration.sql` shows).
- Real-DB integration tests for the deduct/refund/accept transitions (Neon test branch
  pattern, `tests/credit-grant.integration.spec.js` as reference).

## API surface

New file `api/requests.js` (follows `?action=` routing, `{ ok: true }` / machine-readable
error envelope):

| Action | Auth | Purpose |
|---|---|---|
| `request-slot` | learner | credit-funded request (deduct + insert) |
| `checkout-request` | learner or guest | card path → Stripe session with manual capture |
| `my-requests` | learner | learner's pending/decided requests |
| `withdraw-request` | learner | cancel own pending request (release hold / refund credits) |
| `list-requests` | instructor | pending (+ recent decided) requests for dashboard card |
| `accept-request` | instructor | capture/convert → booking |
| `decline-request` | instructor | cancel hold / refund credits, optional reason |
| `expire-requests` | CRON_SECRET | bulk-expire stale pending requests (withCronLock) |

Instructor actions verify `instructor_id` + `school_id` ownership of the request row.
Accept must re-validate the slot immediately before booking (instructor may have gained a
Setmore-imported booking or blackout since the request landed) — if clashed, surface the
clash to the instructor rather than silently double-booking; they decline instead.

Cron: add `{ "path": "/api/requests?action=expire-requests", "schedule": "30 * * * *" }`
to `vercel.json` (same hourly cadence as `expire-offers`).

## Frontend

**Learner (`public/learner/book.html` / `book.js`)** — slot-first UX unchanged:
- `?action=available` response gains `request_to_book: true` per instructor; slot cards
  show an "On request" badge and their action reads **"Request this slot"** instead of
  "Book this slot" (decision: visible in feed, not just modal).
- Booking modal: primary button becomes **"Request this slot"**; copy under it: "Simon
  confirms requests personally — you won't be charged unless he accepts. Held for up to
  48 hours." Same wording for credit path ("your credits are returned if he can't make
  it").
- Guest modal: same, via `checkout-request` (guest variant), keeping the existing
  `#claimTrialCta` behaviour.
- `my-bookings` view (or profile): pending requests listed with status + withdraw button.
- No inline `<script>` — logic in the external `.js` files (CSP rule).

**Instructor**:
- `public/instructor/profile.html/js`: "Request to book" toggle card, modelled on the
  "Last-minute broadcasts" card, writing `instructors.request_to_book`.
- `public/instructor/dashboard.html/js`: "Pending requests" card at the top when any
  exist — learner name, date/time, duration, expiry countdown, Accept / Decline buttons
  (decline opens optional-reason prompt). Pages already include `sidebar.js` +
  `branding.js`.

**Notifications** (all awaited before `res.json()`):
- New request → instructor: WhatsApp + email with slot details and dashboard link.
- Accept → learner: standard booking confirmation path.
- Decline/expiry → learner: WhatsApp (if known) + email; guest email must say the card
  was never charged.
- Expiry warning (nice-to-have, phase 2): nudge instructor at T-12h if still pending.

## Compliance / platform checklist

- **GDPR**: `lesson_requests` holds PII → add to `handleExportData()` (learner.js), add to
  `deleteLearnerCascade()` in `api/_gdpr.js` (learner_id FK is `ON DELETE SET NULL`; the
  cascade should also null/blank guest fields tied to a deleted learner where linked), add
  retention cleanup for old decided requests to `cron-retention.js` (suggest: purge
  decided requests after 12 months; nothing financial lives here once
  accepted — the booking row carries the money record).
- **Multi-tenancy**: every query filters `school_id`; toggle read via the same instructor
  fetch the feed already does.
- **Security**: `checkout-request` (guest-accessible, creates Stripe sessions) must be
  rate-limited like `checkout-slot-guest`; no dynamic SQL; errors via
  `reportError()` + generic client message.
- **28-day cap**: `MAX_DAYS_AHEAD` applies to `request-slot` and `checkout-request` — a
  request is ordinary self-serve booking, not an offers-style exception.
- **Docs on ship**: PROJECT.md (new API actions + table), DEVELOPMENT-ROADMAP.md entry,
  MIGRATION-PLAN.md (new table + route), CLAUDE.md (request-to-book convention + the
  "pending requests block slots" rule), this file → mark SHIPPED.

## Edge cases

- **Toggle flipped OFF with requests pending**: existing pending requests remain valid and
  decidable; new bookings go instant. No migration needed.
- **Instructor accepts after learner's credit was already spent elsewhere**: impossible on
  credit path (deducted at request time) — this is the main reason to deduct rather than
  soft-earmark.
- **Learner reschedule/cancel of an accepted request-booking**: it's a normal booking;
  existing 48h rules apply unchanged.
- **Offer created by instructor for a slot with a pending request**: blocked by the guard
  (instructor sees why — they should answer the request instead).
- **Request for a slot the instructor then blacks out**: request survives until decision;
  accept re-validation catches the clash and steers to decline.
- **Multiple pending requests per learner**: allowed (different slots). Credit path
  naturally limits by balance; consider a soft cap (e.g. 3 pending card-hold requests per
  learner/guest email) to stop hold-spam locking Simon's diary.

## Decisions (Fraser, 2026-07-10)

1. **Expiry window: fixed 48h** for v1. No instructor configurability until someone asks
   (franchise principle 7).
2. **Request-only status is visible in the feed, not just the modal**: slot cards for a
   request-to-book instructor read **"Request this slot"** where instant-book slots read
   "Book this slot" (plus the "On request" badge treatment described above).

## Implementation-time verification (not user decisions)

- **CT `type` names**: before using `request_hold` / `request_refund`, inspect the LIVE
  prod CHECK constraint on `credit_transactions.type` (hot-patched 2026-05-10; may be
  stricter than `db/migration.sql`) and extend it in the same migration. Also confirm the
  divergence cron's expected-balance formula treats the hold/refund pair as net-zero and
  a pending (deducted, unbooked) request as non-drift.

## Suggested delivery order

1. Schema + migration + diagnostics (schema-migration session).
2. `api/requests.js` credit path end-to-end (request → accept/decline/expire → notify),
   with real-DB integration tests — this is the majority path and has the money-discipline
   risk.
3. Slot-blocking guards (shared helper wired into all nine paths) + feed changes.
4. Card path (manual-capture checkout + webhook branch + capture/cancel).
5. Frontend: learner modal + instructor dashboard card + profile toggle.
6. Cron + notifications polish + docs.

Feature branch + PR (this is well past "small fix"). Steps 2 and 4 each get the
three-round adversarial review treatment if they touch anything the divergence cron
reconciles.
