// @ts-check
// Unit tests for the three-level pricing fallback in api/_pricing-helpers.js —
// Step 3b of PER-INSTRUCTOR-CREDITS-PLAN.md.
//
// Pure-function tests against a mocked `sql` tag. No real database needed;
// the helper makes at most three SELECTs (pair → instructor → school), each
// matched by a substring of the query text. Run with:
//   npx playwright test pricing-helpers
//
// What this covers (the three-level fallback contract):
//   1. Per-pair rate wins when present (level 1).
//   2. Per-pair zero / null falls through to level 2.
//   3. Per-pair query is skipped when learnerId is absent.
//   4. Per-instructor rate wins when present (level 2).
//   5. Per-instructor null falls through to level 3.
//   6. School default wins when neither override is set (level 3).
//   7. school_id is included in the per-pair WHERE clause (defence in depth).
//   8. getEffectiveRatePencePerMinute returns banker's-rounded integer.
//   9. calcBulkTotal is backwards-compatible (3-arg call = today's behaviour).
//  10. calcBulkTotal honours the optional { instructorId, learnerId } shape
//      AND still applies bulk discount tiers on top of the effective rate.

const { test, expect } = require('@playwright/test');
const {
  calcDirectLessonPrice,
  getEffectiveHourlyPence,
  getEffectiveRatePencePerMinute,
  calcBulkTotal,
} = require('../api/_pricing-helpers');

// ─── Mock sql tag ───────────────────────────────────────────────────────────
// Each test configures one or more canned responses by query-substring match.
// Records every call so tests can assert which queries fired.
function makeMockSql(canned) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    for (const entry of canned) {
      if (text.includes(entry.match)) {
        return Promise.resolve(entry.rows);
      }
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

// Default school config row used by getBulkPricing's first SELECT.
function schoolRow(bulkHourlyPence, tiers) {
  return {
    config: {
      pricing: {
        bulk_hourly_pence: bulkHourlyPence,
        bulk_discount_tiers: tiers || [
          { min_hours: 20, discount_pct: 7.5 },
          { min_hours: 10, discount_pct: 5 },
          { min_hours: 5,  discount_pct: 2.5 },
        ],
      },
    },
  };
}

// ─── Level 1: per-pair rate ────────────────────────────────────────────────

test('level 1 wins: per-pair custom rate > 0 returned, instructors not queried',
  async () => {
    const { sql, calls } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 6500 }] },
      { match: 'FROM instructors',          rows: [{ hourly_rate_pence: 9999 }] }, // should not fire
      { match: 'FROM schools',              rows: [schoolRow(5500)] },
    ]);
    const result = await getEffectiveHourlyPence(sql, {
      schoolId: 1, instructorId: 7, learnerId: 42,
    });
    expect(result).toBe(6500);
    expect(calls.some(c => c.text.includes('FROM instructors'))).toBe(false);
    expect(calls.some(c => c.text.includes('FROM schools'))).toBe(false);
  });

test('level 1 skipped when per-pair = 0: falls through to level 2', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 0 }] },
    { match: 'FROM instructors',          rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'FROM schools',              rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, {
    schoolId: 1, instructorId: 7, learnerId: 42,
  });
  expect(result).toBe(6000);
  expect(calls.some(c => c.text.includes('FROM instructors'))).toBe(true);
});

test('level 1 skipped when per-pair = NULL: falls through to level 2', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: null }] },
    { match: 'FROM instructors',          rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'FROM schools',              rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, {
    schoolId: 1, instructorId: 7, learnerId: 42,
  });
  expect(result).toBe(6000);
});

test('level 1 skipped when learnerId absent: query never runs', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 6500 }] },
    { match: 'FROM instructors',          rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'FROM schools',              rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, {
    schoolId: 1, instructorId: 7, // no learnerId
  });
  expect(result).toBe(6000);
  expect(calls.some(c => c.text.includes('instructor_learner_notes'))).toBe(false);
});

// ─── Level 2: per-instructor rate ──────────────────────────────────────────

test('level 2 wins when level 1 absent: per-instructor rate returned', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'FROM instructors',          rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'FROM schools',              rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, {
    schoolId: 1, instructorId: 7, learnerId: 42,
  });
  expect(result).toBe(6000);
});

test('level 2 skipped when per-instructor = NULL: falls through to level 3', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'FROM instructors',          rows: [{ hourly_rate_pence: null }] },
    { match: 'FROM schools',              rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, {
    schoolId: 1, instructorId: 7, learnerId: 42,
  });
  expect(result).toBe(5500);
});

// ─── Level 3: school default ───────────────────────────────────────────────

test('level 3 fallback when no instructor/learner given: school default', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'FROM schools', rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveHourlyPence(sql, { schoolId: 1 });
  expect(result).toBe(5500);
  expect(calls.some(c => c.text.includes('instructor_learner_notes'))).toBe(false);
  expect(calls.some(c => c.text.includes('FROM instructors'))).toBe(false);
});

// ─── Defence in depth: school_id is filtered in the per-pair query ─────────

test('per-pair query includes school_id in the WHERE clause', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 6500 }] },
  ]);
  await getEffectiveHourlyPence(sql, {
    schoolId: 3, instructorId: 7, learnerId: 42,
  });
  const pairCall = calls.find(c => c.text.includes('instructor_learner_notes'));
  expect(pairCall).toBeTruthy();
  expect(pairCall.text).toMatch(/school_id/);
  // Values are bound positionally — 3 == schoolId should appear in the values.
  expect(pairCall.values).toContain(3);
});

// ─── Pence-per-minute variant ──────────────────────────────────────────────

test('getEffectiveRatePencePerMinute banker-rounds the hourly value', async () => {
  // 5500 / 60 = 91.666... → 92
  const { sql } = makeMockSql([
    { match: 'FROM schools', rows: [schoolRow(5500)] },
  ]);
  const result = await getEffectiveRatePencePerMinute(sql, { schoolId: 1 });
  expect(result).toBe(92);
});

// ─── calcBulkTotal backwards-compat + new optional shape ───────────────────

test('calcBulkTotal 3-arg call is backwards-compatible (school default only)',
  async () => {
    const { sql } = makeMockSql([
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);
    // 10 hours at £55/hr, 5% discount tier matches → £495 total.
    const result = await calcBulkTotal(sql, 1, 10);
    expect(result.pricePerHourPence).toBe(5500);
    expect(result.fullPence).toBe(55000);
    expect(result.discountPct).toBe(5);
    expect(result.discountAmt).toBe(2750);
    expect(result.totalPence).toBe(52250);
  });

test('calcBulkTotal with { instructorId, learnerId } uses level-1 rate AND applies tier discount',
  async () => {
    // Per-pair rate £65/hr (6500p), 10 hours → £650 full, 5% tier → £617.50.
    const { sql } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 6500 }] },
      { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: true }] },
      // getBulkPricing also gets called once more inside calcBulkTotal to pull the tiers.
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);
    const result = await calcBulkTotal(sql, 1, 10, { instructorId: 7, learnerId: 42 });
    expect(result.pricePerHourPence).toBe(6500);
    expect(result.fullPence).toBe(65000);
    expect(result.discountPct).toBe(5);
    expect(result.discountAmt).toBe(3250);
    expect(result.totalPence).toBe(61750);
  });

test('calcBulkTotal with bulk_tiers_enabled=false applies no discount even when school tiers exist', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: false }] },
    { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 12, discount_pct: 5 }])] },
  ]);

  const result = await calcBulkTotal(sql, 1, 12, { instructorId: 8, learnerId: 42 });

  expect(result.pricePerHourPence).toBe(6000);
  expect(result.bulkTiersEnabled).toBe(false);
  expect(result.discountTiers).toEqual([]);
  expect(result.discountPct).toBe(0);
  expect(result.discountAmt).toBe(0);
  expect(result.totalPence).toBe(72000);
});

test('calcBulkTotal with bulk_tiers_enabled=true applies school tier percentages to effective rate', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: true }] },
    { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 24, discount_pct: 5 }])] },
  ]);

  const result = await calcBulkTotal(sql, 1, 24, { instructorId: 8, learnerId: 42 });

  expect(result.pricePerHourPence).toBe(6000);
  expect(result.bulkTiersEnabled).toBe(true);
  expect(result.discountTiers).toEqual([{ min_hours: 24, discount_pct: 5 }]);
  expect(result.fullPence).toBe(144000);
  expect(result.discountPct).toBe(5);
  expect(result.discountAmt).toBe(7200);
  expect(result.totalPence).toBe(136800);
});

test('Sarah at 60/hr bulk off: 1.5 hours is 90 pounds and checkout ppm is 100', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: false }] },
    { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 1.5, discount_pct: 5 }])] },
  ]);

  const result = await calcBulkTotal(sql, 1, 1.5, { instructorId: 8, learnerId: 42 });

  expect(result.totalPence).toBe(9000);
  expect(Math.round(result.totalPence / 90)).toBe(100);
});

test('custom learner rate wins over instructor rate', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 5200 }] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: false }] },
    { match: 'FROM schools', rows: [schoolRow(5500)] },
  ]);

  const result = await calcBulkTotal(sql, 1, 1.5, { instructorId: 8, learnerId: 42 });

  expect(result.pricePerHourPence).toBe(5200);
  expect(result.rateSource).toBe('custom_learner_rate');
  expect(result.totalPence).toBe(7800);
});

test('instructor rate and bulk queries include school_id filters', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: false }] },
    { match: 'FROM schools', rows: [schoolRow(5500)] },
  ]);

  await calcBulkTotal(sql, 3, 1.5, { instructorId: 8, learnerId: 42 });

  const rateCall = calls.find(c => c.text.includes('SELECT hourly_rate_pence'));
  const bulkCall = calls.find(c => c.text.includes('SELECT bulk_tiers_enabled'));
  expect(rateCall.text).toMatch(/school_id/);
  expect(rateCall.values).toContain(3);
  expect(bulkCall.text).toMatch(/school_id/);
  expect(bulkCall.values).toContain(3);
});

test('calcDirectLessonPrice uses school default without bulk discounts: 55/hr x 90 = 8250', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: null }] },
    { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 1.5, discount_pct: 50 }])] },
  ]);

  const result = await calcDirectLessonPrice(sql, {
    schoolId: 3,
    instructorId: 8,
    learnerId: 42,
    durationMinutes: 90,
  });

  expect(result.pricePence).toBe(8250);
  expect(result.hourlyPence).toBe(5500);
  expect(result.source).toBe('school_default');
  expect(calls.some(c => c.text.includes('SELECT bulk_tiers_enabled'))).toBe(false);
  expect(calls.find(c => c.text.includes('SELECT hourly_rate_pence')).values).toContain(3);
});

test('calcDirectLessonPrice uses instructor override: 60/hr x 90 = 9000', async () => {
  const { sql, calls } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: true }] },
    { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 1.5, discount_pct: 50 }])] },
  ]);

  const result = await calcDirectLessonPrice(sql, {
    schoolId: 1,
    instructorId: 8,
    learnerId: 42,
    durationMinutes: 90,
  });

  expect(result.pricePence).toBe(9000);
  expect(result.hourlyPence).toBe(6000);
  expect(result.source).toBe('instructor_rate');
  expect(calls.some(c => c.text.includes('SELECT bulk_tiers_enabled'))).toBe(false);
});

test('calcDirectLessonPrice custom learner rate wins: 52/hr x 90 = 7800', async () => {
  const { sql } = makeMockSql([
    { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 5200 }] },
    { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
    { match: 'FROM schools', rows: [schoolRow(5500)] },
  ]);

  const result = await calcDirectLessonPrice(sql, {
    schoolId: 1,
    instructorId: 8,
    learnerId: 42,
    durationMinutes: 90,
  });

  expect(result.pricePence).toBe(7800);
  expect(result.hourlyPence).toBe(5200);
  expect(result.source).toBe('custom_learner_rate');
});
