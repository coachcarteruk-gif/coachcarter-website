# Booking and offer maintenance contracts

Read the relevant sections before changing booking creation, slot holds, offers, requests, extensions or cancellation behavior. These rules were consolidated from `CLAUDE.md` on 29 September 2026; this move does not certify deployment or authorise activation. Also read [booking statuses](booking-statuses.md), and the applicable funding contract from the [reading map](README.md).

## Instructor availability enforcement

New instructor bookings and fixed/broadcast offers may override normal hours and busy blocks only after a proposal-specific `SCHEDULE_OVERRIDE_REQUIRED` warning and explicit `schedule_override_token` confirmation. Busy blocks and ordinary availability remain unchanged. Blackouts, external events, existing lessons and held slots remain blocking; full overlaps are checked. Pencilled offers persist the exact reviewed busy-block snapshot for their database guard and payment fulfilment (migration 075 required, not applied by this task). Time edits retain their availability guard. Lesson extensions retain their narrower normal-hours-only `normal_hours_override_token` policy. Legacy `availability_override` and `force` do not bypass these checks. Availability reductions show newly uncovered existing lessons for acknowledgement and leave those bookings intact. See `docs/instructor-availability-policy.md`.

## Advance Booking Window

**July 2026 policy reversal** (deliberate, Fraser-requested — supersedes the old 4-week cap): `instructors.max_booking_days_ahead` (1–84 days, DB default 84) **is** the learner-facing window. The platform ceiling is 84 days — `MAX_DAYS_AHEAD = 84` in `api/slots.js`, `PLATFORM_MAX_DAYS = 84` in `public/learner/book.js`. Each instructor sets their window from the instructor profile ("How far ahead learners can book"). The ceiling covers `?action=available` (outer bounds; still max 31 days per request — the learner feed fetches in ≤31-day chunks), `?action=book`, `?action=checkout-slot`, `?action=checkout-slot-guest`, `?action=reschedule`, `?action=book-free-trial`, `?action=create-offer` (first-slot date), and the lesson-request paths. Per-instructor window enforcement is `isDateWithinBookingWindow()` beside each outer guard. The learner feed window is the chosen instructor's window, or the widest window in the school under "All instructors" (the server filters each slot by its own instructor's window); the book.html date grid initially shows seven dates, with the rest behind a "Show later dates" button (display-only; the full permitted window still loads).

The historical `bookOfferSeries()` path in `api/offers.js` can create bookings past the 84-day ceiling only for an offer accepted while the school's incompatible-product retirement state is inactive. Slice 3 retires new repeat offers for enabled schools; do not present the historical series path as a new-booking workaround. Existing series records and in-flight pre-retirement Stripe sessions must still settle and remain manageable.

Don't add paths that bypass the 84-day platform ceiling for ordinary learner self-serve booking.

Free-trial self-service is capped at **28 days**, or the instructor's shorter
`max_booking_days_ahead` setting. The free-trial picker, trial availability,
`book-free-trial`, and learner trial rescheduling use this same inclusive cap.
Ordinary paid booking windows remain unchanged.

## Simon Slice 3 retired products

`schools.config.features.retire_incompatible_products === true` is the only active retirement value; missing, malformed, string, numeric, or false values are inactive. The state is always loaded by exact authenticated/offer `school_id`. When active, server routes must return `410 PRODUCT_CREATION_RETIRED` before any insert, credit mutation, hold, notification, or Stripe call for learner repeats, Reserved Weekly Slot creation, flexible offers, or repeating offers. UI hiding is defence-in-depth, not authority.

Do not gate grandfathered Lesson Credit balance reads/spending/returns, existing series/status/move/cancel management, historical ledgers, or webhook settlement for Stripe sessions created before activation. Retired/legacy-funded lessons remain £0 automated Simon-launch earnings. Production activation is a separate communication/readiness decision and is not implied by merging the implementation.

## Broadcast offers

> Full plan: see DEVELOPMENT-ROADMAP.md entry 2.55

The `lesson_offers` table supports two `kind`s:

- **`'manual'`** — instructor-initiated 1:1 offer (the existing "Offer a lesson" feature). Per-slot uniqueness enforced via partial index `uq_offer_slot_manual`.
- **`'broadcast'`** — 1:many fan-out where multiple learners receive simultaneous single-use offer tokens. First to accept wins; siblings get marked `'superseded'` and receive a "no longer available" follow-up. Many pending broadcast rows can exist for the same slot — the partial index excludes them.

Hard rules:

1. New code creating offers MUST set `kind` explicitly (default `'manual'` is preserved for backwards compatibility but new flows should be deliberate).
2. Broadcasts MUST share a `batch_id` (UUID) so sibling supersession finds them.
3. Broadcasts MUST set `trigger` (`'cancellation'` or `'instructor_manual'`) so messaging templates can render the right framing.
4. Sibling supersession lives in `api/_notify-availability.js::supersedeBroadcastSiblings()`. Call it from any path that books a slot (Stripe webhook for offer acceptance, slots.js `?action=book`, webhook `handleSlotBooking` for guest checkout). It is idempotent. Keep best-effort notification failure handling separate from the committed booking result, and await asynchronous work before returning the API response. Historical unawaited call sites are not a pattern for new code; runtime fixes require their own scoped change.
5. The `instructors.broadcast_offers_enabled` toggle defaults to `FALSE`. Cancellation-driven broadcasts only fire when this is `TRUE` and the cancellation is <48h before lesson start. Toggle UI lives on `/instructor/profile.html` ("Last-minute broadcasts" card).
6. Instructor-triggered manual broadcasts (`trigger='instructor_manual'`) are not gated by the toggle — the toggle only affects auto-cancellation broadcasts. Manual broadcasts always go through `?action=create-broadcast-offer` and require an explicit `learner_ids` array.

## Lesson requests (request-to-book, July 2026)

> Full reference: [`LESSON-REQUEST-PLAN.md`](../LESSON-REQUEST-PLAN.md). Shared lifecycle helpers: `api/_lesson-requests.js`.

Per-instructor `instructors.request_to_book` toggle: learners request slots instead of instant-booking them; payment is **held, never taken up front** (Stripe manual-capture authorization for cards, `request_hold`/`request_refund` credit_transactions pair for credits). Hard rules:

1. **Pending `lesson_requests` rows block their slot** exactly like pending `lesson_offers`. Any NEW booking-creation or slot-holding path must add the pending-request conflict check (mirror the pending-offer check beside it). The slot lock is the partial unique index `uq_request_slot`.
2. **Never charge before accept.** Card requests use `payment_intent_data.capture_method='manual'` — capture on accept, cancel otherwise. Don't add request paths that charge-then-refund.
3. **Hold release is exactly-once**, keyed on `lesson_requests.released_at`. Route all releases through `releaseRequestHold()` — never write ad-hoc refund/cancel logic. Every status transition away from `pending` must be an atomic claim (`UPDATE … WHERE status='pending'`).
4. The `request_hold`/`request_refund` ledger pair must always net zero per request — the divergence cron counts them in ΣCT. Neither type may ever be added to `CREDIT_BOOKING_SOURCE_TYPES` (they are not drawable FIFO sources).
5. Requests expire at min(created + 48h, lesson start − 2h) — inside Stripe's ~7-day auth-hold window. Don't extend past 5 days without rethinking the card path.
6. Declined/expired guest emails must state the card was never charged (only authorised).
7. No weekly repeats and no social-video discount on requests (v1 — deliberate).

## Paid and free lesson extensions (September 2026)

Flexible Hours extensions use the same request
and token acceptance surface, but the learner must explicitly choose
`payment_method='flexible_package'`. Only an already fully package-funded booking
is eligible. Its zero offer cash price is not a free extension: acceptance appends
extra FIFO allocations and increases booking minutes and frozen value atomically,
without LCB/CT/BCS or Stripe changes. Preserve the original allocation evidence,
reject mixed funding or mismatches, and use the dedicated [delivered-duration correction contract](delivered-duration-corrections.md) for eligible completed-lesson corrections rather than relaxing ordinary edit paths.

An extension offer is a `lesson_offers` row with `extension_booking_id` and `extension_minutes`; it must mutate the existing lesson rather than create a second adjacent booking. A positive price charges only the added time and fulfils after a verified paid webhook. An explicit zero price is a free extension: learner acceptance bypasses Stripe and atomically changes only the booking end time and offer status, leaving `minutes_deducted`, list price, BCS, credit balances, refunds and payout value unchanged. Extension requests follow the [normal-hours warning and explicit token-confirmation policy](instructor-availability-policy.md), including paid, free and Flexible Hours requests. Preserve the existing travel-buffer treatment and payment-settlement boundaries; real overlaps with bookings, busy blocks, pending offers/requests, reservations and external events remain blocking. Paid fulfilment must remain school/instructor/learner scoped, metadata checked, Stripe-session idempotent, and atomic across the `slot_purchase`, appended BCS attribution, booking end/minutes/list-price update, and offer acceptance. Editing/cancelling the source booking or cancelling/expiring the extension closes open Checkout sessions; if payment wins that race, the webhook records an idempotent `booking_extension_unfulfilled` refund intent and returns the full extension charge through Stripe, with failures retained as `manual_review`. Do not enable promotion codes or weekly repeats for extensions, and do not broaden refunds or payout engines beyond that race compensation.
