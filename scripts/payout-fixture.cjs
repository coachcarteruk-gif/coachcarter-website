'use strict';

/**
 * The 11–18 Sep 2026 reference week, exactly as docs/payout/reference-output.png
 * renders it.
 *
 * This is the VISUAL fixture: it reproduces the hand-built sheet's figures so
 * the HTML renderer can be compared against the reference image pixel for pixel.
 * It is deliberately NOT what production data says that week actually was —
 * regenerating it from the database gives £1,059.46 / £969.46 across 17 lines,
 * because the hand-built sheet logged two 90-minute lessons as 1 hour and priced
 * one pupil at another pupil's rate.
 *
 * Keeping both matters. This fixture proves the renderer draws correctly; the
 * database proves the numbers. Conflating them would mean a layout change could
 * hide behind a calculation change, or vice versa.
 */

const { FUNDING } = require('../api/_payout-summary');

/**
 * Lines are given as pre-computed amounts rather than funding inputs, because
 * the point is to reproduce the reference image's figures, not to re-derive
 * them. The calculation module is tested separately against spec §3.2.
 */
function referenceWeek() {
  const earnings = [
    ['Fri 11 Sep', 'Daniela – 1 hr', '£48.57/hr', 4857],
    ['Fri 11 Sep', 'Emilie – 2 hr', '£55/hr pupil price', 9733],
    ['Sat 12 Sep', 'Viba – 1 hr', '£48.35/hr', 4835],
    ['Sat 12 Sep', 'Giovanni – 1 hr', '£46.77/hr', 4677],
    ['Mon 14 Sep', 'Emilie – 1 hr', '£48.57/hr', 4857],
    ['Mon 14 Sep', 'Jasmine – 2 hr', '£55/hr pupil price', 9733],
    ['Mon 14 Sep', 'Georgie – 1 hr', 'Free trial', 3000],
    ['Mon 14 Sep', 'Sophia White – 1 hr', '£48.57/hr', 4857],
    ['Tue 15 Sep', 'Esha – 1.5 hr', 'Package rate £46.77/hr', 7015],
    ['Tue 15 Sep', 'Shannon – 1.5 hr', '£55/hr pupil price', 7295],
    ['Tue 15 Sep', 'Shannon – 1.5 hr', '£55/hr pupil price', 7295],
    ['Tue 15 Sep', 'Amelie – 1 hr', 'Free trial', 3000],
    ['Wed 16 Sep', 'Daniela – 1 hr', '£48.57/hr', 4857],
    ['Wed 16 Sep', 'Jasmine – 2 hr', '£55/hr pupil price', 9733],
    ['Wed 16 Sep', 'Rahil – 1 hr', 'Free trial', 3000],
    ['Wed 16 Sep', 'Becky – 1 hr', '£48.57/hr', 4857],
    ['Thu 17 Sep', 'Morgan – 1.5 hr', '£55/hr pupil price', 7295],
  ].map(([date, description, note, amount_pence], i) => ({
    lesson_id: i + 1,
    pupil_id: i + 1,
    date,
    description,
    note,
    amount_pence,
    basis: { funding: FUNDING.STANDARD, minutes: 60 },
  }));

  const deductions = [
    { date: 'Weekly', description: 'Franchise fee', note: '', amount_pence: 9000 },
  ];

  const subtotal = earnings.reduce((sum, l) => sum + l.amount_pence, 0);
  const deducted = deductions.reduce((sum, l) => sum + l.amount_pence, 0);

  return {
    periodStart: '2026-09-11',
    periodEnd: '2026-09-18',
    summary: {
      calculation_version: 'reference-fixture',
      instructor: { id: 6, name: 'Simon Edwards' },
      period: { start: '2026-09-11', end: '2026-09-18' },
      earnings,
      deductions,
      totals: {
        subtotal_pence: subtotal,
        deducted_pence: deducted,
        net_pence: subtotal - deducted,
      },
      counts: { lessons: 17, hours: 22 },
      blocked: [],
      warnings: [],
    },
  };
}

module.exports = { referenceWeek };
