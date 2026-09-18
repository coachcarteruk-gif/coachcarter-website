const { test, expect } = require('@playwright/test');

const {
  FUNDING,
  PayoutCalculationError,
  truncatePence,
  calculateLessonPayout,
  buildPayoutSummary,
  formatRowDate,
  formatDescription,
} = require('../api/_payout-summary');

// docs/payout/PAYOUT-SUMMARY-SPEC.md §3.2. These are the numbers the business
// owner confirmed; payout_renderer.py asserts the same values.
const STANDARD_PRICE = 5500; // £55.00/hr
const SHARE = 0.90;

function lesson(overrides = {}) {
  return {
    lesson_id: 1,
    pupil_id: 100,
    pupil_name: 'Test Pupil',
    date: '2026-09-11',
    start_time: '13:00',
    duration_minutes: 60,
    funding: FUNDING.STANDARD,
    price_pence_per_hour: STANDARD_PRICE,
    share_rate: SHARE,
    stripe_fee_pence: 103, // 5500 * 0.015 + 20
    ...overrides,
  };
}

test.describe('truncatePence', () => {
  test('truncates, never rounds', () => {
    expect(truncatePence(7015.4999)).toBe(7015);
    expect(truncatePence(7015.9999)).toBe(7015);
    expect(truncatePence(4857.0)).toBe(4857);
  });

  test('survives float representation error', () => {
    // 46.77 * 1.5 = 70.15499999999999 in IEEE-754. Spec §3.2 requires £70.15.
    expect(truncatePence(4677 * 1.5)).toBe(7015);
  });

  test('refuses negative and non-finite amounts', () => {
    expect(() => truncatePence(-1)).toThrow(PayoutCalculationError);
    expect(() => truncatePence(Number.NaN)).toThrow(PayoutCalculationError);
  });
});

test.describe('spec §3.2 fixtures — standard Stripe lessons at £55/hr, share 0.90', () => {
  // Fee is the real balance-transaction fee for a single charge (spec §4,
  // confirmed against 18 production bookings): gross * 0.015 + 20p.
  const cases = [
    { minutes: 60, fee: 103, expected: 4857 },  // £48.57
    { minutes: 90, fee: 144, expected: 7295 },  // £72.95  <- the §4 open decision
    { minutes: 120, fee: 185, expected: 9733 }, // £97.33
  ];

  for (const c of cases) {
    test(`${c.minutes} min pays £${(c.expected / 100).toFixed(2)}`, () => {
      const result = calculateLessonPayout(lesson({
        duration_minutes: c.minutes,
        stripe_fee_pence: c.fee,
      }));
      expect(result.payout_pence).toBe(c.expected);
    });
  }

  test('1.5hr is £72.95 — one charge, not two and not pro-rated', () => {
    const oneCharge = calculateLessonPayout(lesson({ duration_minutes: 90, stripe_fee_pence: 144 }));
    expect(oneCharge.payout_pence).toBe(7295);
    // Two charges (20p twice) would be 164p and yield £72.77; pro-rating would
    // be 154p and yield £72.86. Both appeared in historic hand-built sheets.
    expect(calculateLessonPayout(lesson({ duration_minutes: 90, stripe_fee_pence: 164 })).payout_pence).toBe(7277);
    expect(calculateLessonPayout(lesson({ duration_minutes: 90, stripe_fee_pence: 154 })).payout_pence).toBe(7286);
  });
});

test.describe('spec §3.2 fixtures — direct payment, no Stripe fee', () => {
  const cases = [
    { minutes: 60, expected: 4950 },  // £49.50
    { minutes: 90, expected: 7425 },  // £74.25
    { minutes: 120, expected: 9900 }, // £99.00
  ];

  for (const c of cases) {
    test(`${c.minutes} min pays £${(c.expected / 100).toFixed(2)}`, () => {
      const result = calculateLessonPayout(lesson({
        duration_minutes: c.minutes,
        funding: FUNDING.DIRECT,
        stripe_fee_pence: null,
      }));
      expect(result.payout_pence).toBe(c.expected);
    });
  }

  test('direct takes neither the percentage nor the fixed fee (spec §3.1 rule 6)', () => {
    // Modelling direct as "zero fixed fees" but still deducting 1.5% would give
    // £48.75 instead of £49.50 — a silent underpayment of 75p per hour.
    const result = calculateLessonPayout(lesson({ funding: FUNDING.DIRECT, stripe_fee_pence: null }));
    expect(result.payout_pence).toBe(4950);
    expect(result.stripe_fee_pence).toBe(0);
  });
});

test.describe('spec §3.2 fixtures — trial, package, legacy', () => {
  test('free trial is a flat hourly rate with no deductions', () => {
    const result = calculateLessonPayout(lesson({
      funding: FUNDING.TRIAL,
      flat_rate_pence_per_hour: 3000,
      price_pence_per_hour: 0,
      stripe_fee_pence: null,
    }));
    expect(result.payout_pence).toBe(3000);
    expect(result.share_rate).toBeNull();
  });

  test('package 1.5hr at £46.77/hr is £70.15 (70.155 truncated)', () => {
    const result = calculateLessonPayout(lesson({
      duration_minutes: 90,
      funding: FUNDING.PACKAGE,
      price_pence_per_hour: 4677,
      share_rate: 1,
      stripe_fee_pence: null,
    }));
    expect(result.payout_pence).toBe(7015);
  });

  test('legacy off-platform pays flat, no share and no fee', () => {
    // Giovanni: 29hr bought off-platform in March at £46.77/hr.
    const result = calculateLessonPayout(lesson({
      duration_minutes: 90,
      funding: FUNDING.LEGACY,
      flat_rate_pence_per_hour: 4677,
      price_pence_per_hour: 0,
      stripe_fee_pence: null,
    }));
    expect(result.payout_pence).toBe(7015);
    expect(result.stripe_fee_pence).toBe(0);
  });

  test('legacy at Esha rate £49.8325/hr for 1.5hr', () => {
    // £1214.40 for 24hr, less the £18.42 actual Stripe fee = £1195.98 net,
    // = 4983.25 pence/hr. Flat, per Fraser's decision.
    const result = calculateLessonPayout(lesson({
      duration_minutes: 90,
      funding: FUNDING.LEGACY,
      flat_rate_pence_per_hour: 4983.25,
      price_pence_per_hour: 0,
      stripe_fee_pence: null,
    }));
    expect(result.payout_pence).toBe(7474); // 74.74875 truncated
  });
});

test.describe('the specific bug this replaces — never multiply a derived rate', () => {
  test('same duration and price always yields the same amount', () => {
    // Spec §1: the same lesson length produced £72.86 / £72.95 / £72.96 / £73.02
    // across four weeks purely from rounding order.
    const amounts = new Set();
    for (let i = 0; i < 50; i += 1) {
      amounts.add(calculateLessonPayout(lesson({
        lesson_id: i, duration_minutes: 90, stripe_fee_pence: 144,
      })).payout_pence);
    }
    expect(amounts.size).toBe(1);
    expect([...amounts][0]).toBe(7295);
  });

  test('computing from a pre-derived hourly rate would give a different answer', () => {
    // Guards the rule rather than the code: £48.57/hr × 1.5 = £72.85, which is
    // 10p short of the correct £72.95. This is why the derived rate is never stored.
    const derivedRateApproach = Math.floor(4857 * 1.5) / 1;
    expect(derivedRateApproach).toBe(7285);
    expect(calculateLessonPayout(lesson({ duration_minutes: 90, stripe_fee_pence: 144 })).payout_pence).toBe(7295);
  });
});

test.describe('spec §5 validation — blocks', () => {
  test('missing pupil price throws rather than defaulting to £55', () => {
    for (const missing of [null, undefined, 0]) {
      expect(() => calculateLessonPayout(lesson({ price_pence_per_hour: missing })))
        .toThrow(/Pupil hourly price/);
    }
  });

  test('missing duration throws rather than defaulting to 90 minutes', () => {
    expect(() => calculateLessonPayout(lesson({ duration_minutes: null })))
      .toThrow(/Lesson duration/);
  });

  test('Stripe-funded lesson without fee evidence throws', () => {
    expect(() => calculateLessonPayout(lesson({ stripe_fee_pence: null })))
      .toThrow(/no verified processing fee/);
  });

  test('NULL fee evidence is never coerced to a zero fee', () => {
    // Number(null) === 0 and passes Number.isSafeInteger, so a naive check lets
    // a NULL stripe_fee_pence through as "no fee" and pays £49.50 instead of
    // £48.57 — a silent 93p overpayment per hour. NULL means "unknown", never
    // "there was no fee". Production still has 9 such bookings.
    for (const missing of [null, undefined, '']) {
      expect(() => calculateLessonPayout(lesson({ stripe_fee_pence: missing })))
        .toThrow(/no verified processing fee/);
    }
    // A genuine zero, explicitly stated, is still allowed.
    expect(calculateLessonPayout(lesson({ stripe_fee_pence: 0 })).payout_pence).toBe(4950);
  });

  test('duplicate lesson_id blocks', () => {
    expect(() => buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [lesson({ lesson_id: 7 }), lesson({ lesson_id: 7 })],
    })).toThrow(/Duplicate lesson_id/);
  });

  test('same pupil at two different prices in one week blocks', () => {
    expect(() => buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 1, pupil_id: 100, price_pence_per_hour: 5500 }),
        lesson({ lesson_id: 2, pupil_id: 100, price_pence_per_hour: 5400 }),
      ],
    })).toThrow(/two different hourly prices/);
  });

  test('pupils are keyed on id, so two pupils may legitimately differ', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 1, pupil_id: 100, price_pence_per_hour: 5500 }),
        lesson({ lesson_id: 2, pupil_id: 200, pupil_name: 'Other', price_pence_per_hour: 5400, stripe_fee_pence: 101 }),
      ],
    });
    expect(summary.earnings).toHaveLength(2);
  });
});

test.describe('spec §5 validation — warnings', () => {
  test('unusual duration warns but does not block', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [lesson({ duration_minutes: 75, stripe_fee_pence: 123 })],
    });
    expect(summary.warnings.map((w) => w.code)).toContain('UNUSUAL_DURATION');
    expect(summary.earnings).toHaveLength(1);
  });

  test('same pupil over 2.5hr in one day warns', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 1, duration_minutes: 120, stripe_fee_pence: 185 }),
        lesson({ lesson_id: 2, duration_minutes: 120, stripe_fee_pence: 185 }),
      ],
    });
    expect(summary.warnings.map((w) => w.code)).toContain('PUPIL_DAY_OVER_2_5_HOURS');
  });
});

test.describe('totals reconcile or refuse to render (spec §9 rule 9)', () => {
  test('subtotal equals the sum of rendered lines exactly', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 1, duration_minutes: 60, stripe_fee_pence: 103 }),
        lesson({ lesson_id: 2, pupil_id: 101, duration_minutes: 90, stripe_fee_pence: 144 }),
        lesson({ lesson_id: 3, pupil_id: 102, duration_minutes: 120, stripe_fee_pence: 185 }),
      ],
      deductions: [{ label: 'Franchise fee', amount_pence: 9000 }],
    });
    const sumOfLines = summary.earnings.reduce((a, l) => a + l.amount_pence, 0);
    expect(summary.totals.subtotal_pence).toBe(sumOfLines);
    expect(summary.totals.subtotal_pence).toBe(4857 + 7295 + 9733);
    expect(summary.totals.net_pence).toBe(sumOfLines - 9000);
  });

  test('net is subtotal minus deductions', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [lesson()],
      deductions: [{ label: 'Franchise fee', amount_pence: 9000 }],
    });
    expect(summary.totals.net_pence).toBe(4857 - 9000);
  });
});

test.describe('presentation (spec §6.5)', () => {
  test('dates are abbreviated day and month with no year', () => {
    expect(formatRowDate('2026-09-11')).toBe('Fri 11 Sep');
    expect(formatRowDate('2026-09-17')).toBe('Thu 17 Sep');
  });

  test('descriptions use an en dash and drop a trailing .0', () => {
    expect(formatDescription('Daniela', 1)).toBe('Daniela – 1 hr');
    expect(formatDescription('Esha', 1.5)).toBe('Esha – 1.5 hr');
  });

  test('rate notes let the instructor reproduce the total', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 1 }),
        lesson({ lesson_id: 2, pupil_id: 101, funding: FUNDING.TRIAL, flat_rate_pence_per_hour: 3000, price_pence_per_hour: 0, stripe_fee_pence: null }),
        lesson({ lesson_id: 3, pupil_id: 102, funding: FUNDING.LEGACY, flat_rate_pence_per_hour: 4677, price_pence_per_hour: 0, stripe_fee_pence: null }),
        lesson({ lesson_id: 4, pupil_id: 103, funding: FUNDING.DIRECT, stripe_fee_pence: null }),
      ],
    });
    const notes = summary.earnings.map((l) => l.note);
    expect(notes[0]).toBe('£55.00/hr pupil price');
    expect(notes[1]).toBe('Free trial');
    expect(notes[2]).toBe('Legacy rate £46.77/hr');
    expect(notes[3]).toBe('Direct payment £49.50/hr');
  });

  test('rows are ordered chronologically', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [
        lesson({ lesson_id: 2, date: '2026-09-17', start_time: '07:00' }),
        lesson({ lesson_id: 1, pupil_id: 101, date: '2026-09-11', start_time: '13:00' }),
        lesson({ lesson_id: 3, pupil_id: 102, date: '2026-09-11', start_time: '14:30' }),
      ],
    });
    expect(summary.earnings.map((l) => l.lesson_id)).toEqual([1, 3, 2]);
  });
});

test.describe('emitted basis supports dispute resolution (spec §8)', () => {
  test('every line carries the inputs that produced it', () => {
    const summary = buildPayoutSummary({
      instructor: { id: 6, name: 'Simon Edwards' },
      periodStart: '2026-09-11', periodEnd: '2026-09-18',
      lessons: [lesson({ duration_minutes: 90, stripe_fee_pence: 144 })],
    });
    const [line] = summary.earnings;
    expect(line.lesson_id).toBe(1);
    expect(line.basis).toMatchObject({
      funding: FUNDING.STANDARD,
      hours: 1.5,
      gross_pence: 8250,
      stripe_fee_pence: 144,
      share_rate: 0.9,
    });
    // The line reconciles from its own basis: (8250 - 144) * 0.9 = 7295.4 -> 7295
    expect(Math.floor((line.basis.gross_pence - line.basis.stripe_fee_pence) * line.basis.share_rate))
      .toBe(line.amount_pence);
  });
});
