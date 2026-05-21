// @ts-check
// Unit tests for api/_pence-allocator.js — Step 0.5 of
// PER-INSTRUCTOR-CREDITS-PLAN.md.
//
// Pure-function tests. No browser, no DB, no network. Uses the Playwright
// test runner as the only test harness installed in this repo. Run with:
//   npx playwright test pence-allocator
//
// What this covers:
//   1. Plan acceptance criteria (the two documented examples).
//   2. Sum-equals-input invariant across a range of total/weight combos.
//   3. Determinism — repeated calls produce identical arrays.
//   4. Tie-break rule: lowest index wins. This is load-bearing for
//      api/offers.js, which depends on the remainder concentrating at the
//      front of the array (booked lessons, not orphaned unbooked weeks).
//   5. Edge cases: totalPence === 0, single weight, weight of zero,
//      negative pence (future-use, Step 5 refund deltas), large totals.
//   6. Input validation rejects malformed inputs.

const { test, expect } = require('@playwright/test');
const { allocate } = require('../api/_pence-allocator');

test.describe('allocate() — plan acceptance criteria', () => {
  test('allocate(100, [1, 1, 1]) → [34, 33, 33]', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  test('allocate(100, [2, 1]) → [67, 33]', () => {
    expect(allocate(100, [2, 1])).toEqual([67, 33]);
  });

  test('allocate(100, [1, 2]) → [33, 67] (weights drive the split, not index)', () => {
    expect(allocate(100, [1, 2])).toEqual([33, 67]);
  });
});

test.describe('allocate() — sum invariant', () => {
  // The single load-bearing property: sum(output) === input. Without this
  // the FIFO fee math in Step 4g cannot reconcile pence-exactly.
  const cases = [
    { total: 100, weights: [1, 1, 1] },
    { total: 100, weights: [1, 1, 1, 1, 1, 1, 1] },
    { total: 99,  weights: [1, 1, 1] },
    { total: 1,   weights: [1, 1, 1] },
    { total: 7,   weights: [1, 1, 1, 1] },
    { total: 1234,weights: [3, 5, 2] },
    { total: 9999,weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }, // 18-week offer series cap
    { total: 0,   weights: [1, 1, 1] },
    { total: 50,  weights: [1] },
  ];

  for (const { total, weights } of cases) {
    test(`allocate(${total}, [${weights.join(',')}]) sums to ${total}`, () => {
      const out = allocate(total, weights);
      expect(out).toHaveLength(weights.length);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      for (const v of out) expect(Number.isInteger(v)).toBe(true);
    });
  }
});

test.describe('allocate() — documented hostile pence splits', () => {
  test('one penny across five equal draws concentrates on the first draw', () => {
    const out = allocate(1, [120, 120, 120, 120, 120]);
    expect(out).toEqual([1, 0, 0, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1);
  });

  test('850p across three equal 200-minute draws is pence-exact', () => {
    const out = allocate(850, [200, 200, 200]);
    expect(out).toEqual([284, 283, 283]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(850);
  });

  test('1100p across two equal 600-minute draws splits evenly', () => {
    expect(allocate(1100, [600, 600])).toEqual([550, 550]);
  });
});

test.describe('allocate() — determinism', () => {
  test('repeated calls produce identical results', () => {
    const a = allocate(100, [1, 1, 1]);
    const b = allocate(100, [1, 1, 1]);
    const c = allocate(100, [1, 1, 1]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

test.describe('allocate() — tie-break: lowest index wins', () => {
  // This is the rule api/offers.js relies on. When equal weights produce a
  // tie on remainders, the leftover pence MUST land at the front of the
  // array. If this regresses, offers.js will start orphaning remainder
  // pence onto unbooked weeks instead of attributing them to booked
  // lessons.
  test('three equal weights, +1 leftover → first index gets it', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  test('three equal weights, +2 leftover → first two indices get it', () => {
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33]);
  });

  test('five equal weights, +4 leftover → first four indices get it', () => {
    expect(allocate(104, [1, 1, 1, 1, 1])).toEqual([21, 21, 21, 21, 20]);
  });

  test('offers.js scenario — repeatWeeks=3, totalFee=100', () => {
    // Mirrors the current inline behaviour in api/offers.js:
    //   perWeekFee = floor(100/3) = 33, remainder = 100 - 33*3 = 1
    //   booked[0] gets 33, booked[1] gets 33+1 = 34 if it's the last booked.
    // After replacement with allocate(), the per-week split is
    // [34, 33, 33]; offers.js takes the first booked.length entries.
    // For booked.length = 2, booked total = 34 + 33 = 67 (matches current
    // inline code's booked total of 33 + 34 = 67). The orphan share is
    // 33 (matches current's orphan of 33). Byte-for-byte equivalent
    // sum-wise; only the *order* within booked is different and offers.js
    // doesn't depend on which booked lesson absorbs the remainder.
    const split = allocate(100, [1, 1, 1]);
    expect(split).toEqual([34, 33, 33]);
    const bookedTotal = split[0] + split[1];
    expect(bookedTotal).toBe(67);
  });
});

test.describe('allocate() — edge cases', () => {
  test('totalPence === 0 returns all zeros', () => {
    expect(allocate(0, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(allocate(0, [3, 5, 2])).toEqual([0, 0, 0]);
  });

  test('single weight returns the full total', () => {
    expect(allocate(100, [1])).toEqual([100]);
    expect(allocate(0, [1])).toEqual([0]);
    expect(allocate(1, [5])).toEqual([1]);
  });

  test('zero weight gets zero share', () => {
    const out = allocate(100, [1, 0, 1]);
    expect(out[1]).toBe(0);
    expect(out[0] + out[2]).toBe(100);
  });

  test('large total stays exact (within Number.MAX_SAFE_INTEGER headroom)', () => {
    // 1 million pounds in pence × 18 weights — well within 2^53 = 9e15.
    const total = 100_000_000;
    const out = allocate(total, new Array(18).fill(1));
    expect(out.reduce((a, b) => a + b, 0)).toBe(total);
    expect(out).toHaveLength(18);
  });

  test('negative pence handled symmetrically (future-use for refund deltas)', () => {
    // Not used in Step 0.5 callers but the implementation supports it so
    // Step 5's refund-rebook fee delta logic can reuse the same helper.
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-100);
  });
});

test.describe('allocate() — input validation', () => {
  test('non-integer totalPence throws', () => {
    expect(() => allocate(100.5, [1, 1])).toThrow(/integer/);
    expect(() => allocate('100', [1, 1])).toThrow(/integer/);
    expect(() => allocate(NaN, [1, 1])).toThrow(/integer/);
  });

  test('empty or non-array weights throws', () => {
    expect(() => allocate(100, [])).toThrow(/non-empty/);
    expect(() => allocate(100, null)).toThrow(/non-empty/);
    expect(() => allocate(100, 'x')).toThrow(/non-empty/);
  });

  test('non-integer or negative weight throws', () => {
    expect(() => allocate(100, [1, 1.5])).toThrow(/non-negative integer/);
    expect(() => allocate(100, [1, -1])).toThrow(/non-negative integer/);
    expect(() => allocate(100, [1, 'x'])).toThrow(/non-negative integer/);
  });

  test('all-zero weights throws', () => {
    expect(() => allocate(100, [0, 0, 0])).toThrow(/at least one positive/);
  });
});
