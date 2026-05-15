// @ts-check
const { test, expect } = require('@playwright/test');
const {
  SCHEDULED,
  CHARGEABLE,
  REFUNDED,
  ALL_STATUSES,
  LIVE_STATUSES,
  BLOCKING_STATUSES,
  PAYABLE_STATUSES,
  isLive,
  isChargeable,
  blocksSlot,
  isTerminal,
} = require('../api/_booking-status');

// Three-state booking lifecycle (May 2026 — see BOOKING-STATUS-RESTRUCTURE-PLAN.md
// and docs/booking-statuses.md). Collapsed from seven states.
//
// What this file regression-locks:
//   1. The string values of SCHEDULED / CHARGEABLE / REFUNDED. These ARE the
//      DB enum values (lesson_bookings_status_check) and ARE in payload
//      contracts. Renaming any of them is a migration, not a code change.
//   2. The membership of BLOCKING_STATUSES and PAYABLE_STATUSES. The payout
//      filter (api/_payout-helpers.js) and slot-clash queries (api/slots.js)
//      both pivot on these sets. Adding `scheduled` to PAYABLE_STATUSES, or
//      dropping `chargeable` from BLOCKING_STATUSES, would silently double-pay
//      or release-blocked-slots — exactly the kind of regression that's
//      invisible in code review.
//   3. The predicate semantics. `isChargeable` and `blocksSlot` are imported
//      by call sites that pre-date this module; their truth tables are part
//      of the public contract.
//
// What this file deliberately does NOT cover:
//   - The full E2E late-cancel flow (create booking → cancel <48h → cron flip
//     → chargeable). That needs DB seeding to put a real booking past the
//     1-hour cron buffer, which this Playwright suite has no fixture for.
//     Scaffold + open task lives at the bottom of the file.

test.describe('booking status — three-state contract', () => {
  test('string values are pinned (renames need a migration)', () => {
    expect(SCHEDULED).toBe('scheduled');
    expect(CHARGEABLE).toBe('chargeable');
    expect(REFUNDED).toBe('refunded');
  });

  test('ALL_STATUSES enumerates exactly the three states', () => {
    expect(ALL_STATUSES).toEqual(['scheduled', 'chargeable', 'refunded']);
  });

  test('LIVE_STATUSES = [scheduled] — the only pre-resolution state', () => {
    expect(LIVE_STATUSES).toEqual([SCHEDULED]);
  });

  test('BLOCKING_STATUSES = [scheduled, chargeable] — both still occupy the slot', () => {
    // scheduled blocks because the lesson is happening.
    // chargeable blocks because we use it for historical-overlap detection
    // (don't let a new booking overlap a past lesson on the same slot).
    expect(BLOCKING_STATUSES).toEqual([SCHEDULED, CHARGEABLE]);
    expect(BLOCKING_STATUSES).not.toContain(REFUNDED);
  });

  test('PAYABLE_STATUSES = [chargeable] only', () => {
    // This is the load-bearing payout filter (api/_payout-helpers.js Step 5).
    // If `scheduled` ever leaks in here, instructors get paid before the
    // 1-hour cron buffer can let admin flip a disputed lesson to refunded.
    expect(PAYABLE_STATUSES).toEqual([CHARGEABLE]);
    expect(PAYABLE_STATUSES).not.toContain(SCHEDULED);
    expect(PAYABLE_STATUSES).not.toContain(REFUNDED);
  });

  test('predicates: isLive', () => {
    expect(isLive(SCHEDULED)).toBe(true);
    expect(isLive(CHARGEABLE)).toBe(false);
    expect(isLive(REFUNDED)).toBe(false);
  });

  test('predicates: isChargeable', () => {
    expect(isChargeable(CHARGEABLE)).toBe(true);
    expect(isChargeable(SCHEDULED)).toBe(false);
    expect(isChargeable(REFUNDED)).toBe(false);
  });

  test('predicates: blocksSlot', () => {
    expect(blocksSlot(SCHEDULED)).toBe(true);
    expect(blocksSlot(CHARGEABLE)).toBe(true);
    expect(blocksSlot(REFUNDED)).toBe(false);
  });

  test('predicates: isTerminal', () => {
    expect(isTerminal(REFUNDED)).toBe(true);
    expect(isTerminal(SCHEDULED)).toBe(false);
    expect(isTerminal(CHARGEABLE)).toBe(false);
  });

  test('retired status names are not present anywhere in the module surface', () => {
    // Belt-and-braces: if anyone re-introduces a constant for the old
    // vocabulary (confirmed/completed/cancelled/awaiting_confirmation/
    // disputed/no_show/rescheduled), this catches it at the public API.
    const retired = [
      'confirmed',
      'completed',
      'cancelled',
      'awaiting_confirmation',
      'disputed',
      'no_show',
      'rescheduled',
    ];
    for (const r of retired) {
      expect(ALL_STATUSES).not.toContain(r);
      expect(BLOCKING_STATUSES).not.toContain(r);
      expect(PAYABLE_STATUSES).not.toContain(r);
    }
  });
});

// ── Late-cancel E2E (DB-seeded; not yet wired) ───────────────────────────────
// The plan (BOOKING-STATUS-RESTRUCTURE-PLAN.md Step 6a) asks for a flow test:
//
//   late-cancel (<48h)
//     → booking stays `scheduled` with credit_forfeited = TRUE, no credit returned
//     → after cron flip (end_time + 1h), status becomes `chargeable`
//
// This needs:
//   (a) A learner with a positive credit balance.
//   (b) A booking whose start_time is < 48h from now (for the late-cancel
//       branch) AND whose end_time is < NOW() - 1 hour (so the cron flips it).
//       Those two conditions are mutually exclusive without time travel — the
//       booking must already be "ended an hour ago" before cancel runs, so the
//       test has to either seed a row directly or stub `NOW()` server-side.
//   (c) The cron secret to trigger /api/cron-auto-complete.
//
// None of this is available to the current Playwright suite. Tracked as a
// follow-up — see the open task spawned during Step 6.
//
// test.describe('late-cancel → chargeable end-to-end', () => {
//   test.skip('DB-seeded fixture required — see open task');
// });
