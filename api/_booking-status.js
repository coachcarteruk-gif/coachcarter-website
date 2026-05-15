/**
 * Booking status constants and predicates.
 *
 * The three-state lifecycle:
 *   scheduled  → live, not yet resolved. Blocks slot. Instructor not yet paid.
 *   chargeable → past lesson, instructor will be paid. Blocks slot (historical-overlap detection).
 *   refunded   → killed booking, credit returned to learner. Does not block slot. Terminal.
 *
 * Load-bearing principle: the instructor is paid for every lesson on their
 * calendar unless the learner gave 48h+ notice that it wouldn't happen.
 *
 * Late-cancel under 48h: status stays `scheduled` until the hourly cron flips
 * it to `chargeable`. The new `lesson_bookings.credit_forfeited` flag records
 * that no credit was returned. Instructor is still paid.
 *
 * Never inline these strings — import the constants or predicates.
 * See BOOKING-STATUS-RESTRUCTURE-PLAN.md and docs/booking-statuses.md.
 */

const SCHEDULED  = 'scheduled';
const CHARGEABLE = 'chargeable';
const REFUNDED   = 'refunded';

const ALL_STATUSES      = [SCHEDULED, CHARGEABLE, REFUNDED];
const LIVE_STATUSES     = [SCHEDULED];
const BLOCKING_STATUSES = [SCHEDULED, CHARGEABLE];
const PAYABLE_STATUSES  = [CHARGEABLE];

function isLive(s)       { return s === SCHEDULED; }
function isChargeable(s) { return s === CHARGEABLE; }
function blocksSlot(s)   { return s === SCHEDULED || s === CHARGEABLE; }
function isTerminal(s)   { return s === REFUNDED; }

module.exports = {
  SCHEDULED, CHARGEABLE, REFUNDED,
  ALL_STATUSES, LIVE_STATUSES, BLOCKING_STATUSES, PAYABLE_STATUSES,
  isLive, isChargeable, blocksSlot, isTerminal
};
