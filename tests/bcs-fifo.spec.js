// @ts-check
// Pure unit tests for the Step 5 read-only BCS FIFO planner.

const { test, expect } = require('@playwright/test');
const { planFifoCreditDraw } = require('../api/_bcs-fifo');

function source(overrides = {}) {
  return {
    id: 1,
    created_at: '2026-06-01T10:00:00.000Z',
    school_id: 1,
    minutes: 120,
    effective_rate_pence_per_minute: 100,
    stripe_fee_pence: 120,
    absorbed_by: 'platform',
    active_minutes_drawn: 0,
    active_stripe_fee_pence: 0,
    adjusted_minutes: 0,
    ...overrides,
  };
}

test.describe('planFifoCreditDraw', () => {
  test('single source plans one BCS row', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 60,
      sources: [source()],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows).toEqual([{
      credit_transaction_id: 1,
      minutes_drawn: 60,
      rate_pence_per_minute: 100,
      contribution_pence: 6000,
      stripe_fee_pence: 60,
      absorbed_by: 'platform',
      school_id: 1,
    }]);
  });

  test('multi-source FIFO drains oldest source first', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 150,
      sources: [
        source({ id: 2, created_at: '2026-07-01T10:00:00.000Z', minutes: 120, effective_rate_pence_per_minute: 80, stripe_fee_pence: 96 }),
        source({ id: 1, created_at: '2026-06-01T10:00:00.000Z', minutes: 90, effective_rate_pence_per_minute: 100, stripe_fee_pence: 90 }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows.map(r => [r.credit_transaction_id, r.minutes_drawn, r.contribution_pence]))
      .toEqual([[1, 90, 9000], [2, 60, 4800]]);
  });

  test('identical created_at values use id as deterministic tie-breaker', () => {
    const ts = '2026-06-01T10:00:00.000Z';
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 90,
      sources: [
        source({ id: 11, created_at: ts, minutes: 60 }),
        source({ id: 10, created_at: ts, minutes: 60 }),
      ],
    });

    expect(plan.rows.map(r => r.credit_transaction_id)).toEqual([10, 11]);
    expect(plan.rows.map(r => r.minutes_drawn)).toEqual([60, 30]);
  });

  test('partially consumed source only exposes remaining active minutes', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 80,
      sources: [
        source({ id: 1, minutes: 120, active_minutes_drawn: 90, active_stripe_fee_pence: 90 }),
        source({ id: 2, created_at: '2026-06-02T10:00:00.000Z', minutes: 120 }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows.map(r => [r.credit_transaction_id, r.minutes_drawn]))
      .toEqual([[1, 30], [2, 50]]);
  });

  test('credit_source_adjustments reduce available source minutes', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 80,
      sources: [
        source({ id: 1, minutes: 120, adjusted_minutes: 50 }),
        source({ id: 2, created_at: '2026-06-02T10:00:00.000Z', minutes: 120 }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows.map(r => [r.credit_transaction_id, r.minutes_drawn]))
      .toEqual([[1, 70], [2, 10]]);
  });

  test('final draw takes remaining fee remainder exactly', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 200,
      sources: [
        source({
          id: 1,
          minutes: 600,
          stripe_fee_pence: 850,
          active_minutes_drawn: 400,
          active_stripe_fee_pence: 566,
        }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows[0].stripe_fee_pence).toBe(284);
  });

  test('instructor-absorbed source propagates absorbed_by to planned BCS row', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 60,
      sources: [source({ absorbed_by: 'instructor' })],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows[0].absorbed_by).toBe('instructor');
  });
});
