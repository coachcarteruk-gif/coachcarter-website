// @ts-check
// Pure unit tests for splitting a total FIFO plan across booking rows.

const { test, expect } = require('@playwright/test');
const { splitFifoPlanAcrossBookings } = require('../api/_bcs-booking-plan');

function row(overrides = {}) {
  return {
    credit_transaction_id: 10,
    minutes_drawn: 90,
    rate_pence_per_minute: 92,
    contribution_pence: 8250,
    stripe_fee_pence: 144,
    absorbed_by: 'platform',
    school_id: 1,
    ...overrides,
  };
}

test.describe('splitFifoPlanAcrossBookings', () => {
  test('single booking passthrough', () => {
    const rows = splitFifoPlanAcrossBookings({
      plannedRows: [row()],
      bookingTargets: [{ booking_id: 501, minutes: 90 }],
    });

    expect(rows).toEqual([{
      school_id: 1,
      booking_id: 501,
      credit_transaction_id: 10,
      minutes_drawn: 90,
      rate_pence_per_minute: 92,
      contribution_pence: 8250,
      stripe_fee_pence: 144,
      absorbed_by: 'platform',
    }]);
  });

  test('recurring split across bookings preserves source FIFO order', () => {
    const rows = splitFifoPlanAcrossBookings({
      plannedRows: [
        row({ credit_transaction_id: 1, minutes_drawn: 90, contribution_pence: 9000, stripe_fee_pence: 90 }),
        row({ credit_transaction_id: 2, minutes_drawn: 90, contribution_pence: 7200, stripe_fee_pence: 72 }),
      ],
      bookingTargets: [
        { booking_id: 601, minutes: 60 },
        { booking_id: 602, minutes: 60 },
        { booking_id: 603, minutes: 60 },
      ],
    });

    expect(rows.map(r => [r.booking_id, r.credit_transaction_id, r.minutes_drawn]))
      .toEqual([
        [601, 1, 60],
        [602, 1, 30],
        [602, 2, 30],
        [603, 2, 60],
      ]);
  });

  test('contribution and fee pence totals are conserved', () => {
    const plannedRows = [
      row({ credit_transaction_id: 1, minutes_drawn: 100, contribution_pence: 9999, stripe_fee_pence: 147 }),
      row({ credit_transaction_id: 2, minutes_drawn: 80, contribution_pence: 6401, stripe_fee_pence: 83 }),
    ];
    const rows = splitFifoPlanAcrossBookings({
      plannedRows,
      bookingTargets: [
        { booking_id: 701, minutes: 90 },
        { booking_id: 702, minutes: 90 },
      ],
    });

    expect(rows.reduce((sum, r) => sum + r.minutes_drawn, 0)).toBe(180);
    expect(rows.reduce((sum, r) => sum + r.contribution_pence, 0)).toBe(16400);
    expect(rows.reduce((sum, r) => sum + r.stripe_fee_pence, 0)).toBe(230);
  });

  test('last booking/source slice takes pence remainder', () => {
    const rows = splitFifoPlanAcrossBookings({
      plannedRows: [
        row({ credit_transaction_id: 1, minutes_drawn: 3, contribution_pence: 100, stripe_fee_pence: 10 }),
      ],
      bookingTargets: [
        { booking_id: 801, minutes: 1 },
        { booking_id: 802, minutes: 1 },
        { booking_id: 803, minutes: 1 },
      ],
    });

    expect(rows.map(r => [r.booking_id, r.contribution_pence, r.stripe_fee_pence]))
      .toEqual([
        [801, 33, 3],
        [802, 33, 3],
        [803, 34, 4],
      ]);
  });

  test('absorbed_by and school_id propagate to every split row', () => {
    const rows = splitFifoPlanAcrossBookings({
      plannedRows: [
        row({
          credit_transaction_id: 77,
          minutes_drawn: 120,
          contribution_pence: 0,
          stripe_fee_pence: 0,
          absorbed_by: 'instructor',
          school_id: 3,
        }),
      ],
      bookingTargets: [
        { booking_id: 901, minutes: 45 },
        { booking_id: 902, minutes: 75 },
      ],
    });

    expect(rows).toHaveLength(2);
    for (const split of rows) {
      expect(split.credit_transaction_id).toBe(77);
      expect(split.absorbed_by).toBe('instructor');
      expect(split.school_id).toBe(3);
    }
  });

  test('throws if booking minutes do not match planned minutes', () => {
    expect(() => splitFifoPlanAcrossBookings({
      plannedRows: [row({ minutes_drawn: 90 })],
      bookingTargets: [{ booking_id: 1001, minutes: 60 }],
    })).toThrow(/booking target minutes \(60\) must match planned minutes \(90\)/);
  });
});
