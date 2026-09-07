const { test, expect } = require('@playwright/test');
const { planFlexiblePackageFifo, unitsForDuration } = require('../api/_flexible-package-ledger');

test('legacy purchase rates survive booking with another instructor', () => {
  const lily = planFlexiblePackageFifo([{ id: 1, remaining_units: 6, rate_pence_per_unit: 2400 }], 3);
  expect(lily.ok).toBe(true);
  expect(lily.contribution_pence).toBe(7200);
  const maisie = planFlexiblePackageFifo([{ id: 2, remaining_units: 424 / 30, rate_pence_per_unit: 2491.625 }], 3);
  expect(maisie.ok).toBe(true);
  expect(maisie.contribution_pence).toBe(7475);
  expect(maisie.allocations[0].units * 30).toBe(90);
});

test('legacy remainder cannot round up into a free half-hour', () => {
  const result = planFlexiblePackageFifo([{ id: 2, remaining_units: 29 / 30, rate_pence_per_unit: 2491.625 }], 1);
  expect(result.ok).toBe(false);
  expect(result.shortage_units * 30).toBe(1);
  expect(unitsForDuration(4)).toBeNull();
});

test('a four-minute remainder combines with the next source without losing minutes', () => {
  const result = planFlexiblePackageFifo([
    { id: 2, remaining_units: 4 / 30, rate_pence_per_unit: 2491.625 },
    { id: 3, remaining_units: 4, rate_pence_per_unit: 2700 },
  ], 3);
  expect(result.ok).toBe(true);
  expect(result.allocations.map(a => Math.round(a.units * 30))).toEqual([4, 86]);
  expect(result.contribution_pence).toBe(332 + 7740);
});

test('ordinary package integer rates remain unchanged', () => {
  expect(planFlexiblePackageFifo([{ id: 1, remaining_units: 20, rate_pence_per_unit: 2750 }], 3).contribution_pence).toBe(8250);
});
