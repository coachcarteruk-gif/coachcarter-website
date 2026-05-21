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
    amount_pence: 12000,
    effective_rate_pence_per_minute: 100,
    stripe_fee_pence: 120,
    absorbed_by: 'platform',
    active_minutes_drawn: 0,
    active_contribution_pence: 0,
    active_stripe_fee_pence: 0,
    adjusted_minutes: 0,
    adjusted_pence: 0,
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
        source({ id: 2, created_at: '2026-07-01T10:00:00.000Z', minutes: 120, amount_pence: 9600, effective_rate_pence_per_minute: 80, stripe_fee_pence: 96 }),
        source({ id: 1, created_at: '2026-06-01T10:00:00.000Z', minutes: 90, amount_pence: 9000, effective_rate_pence_per_minute: 100, stripe_fee_pence: 90 }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows.map(r => [r.credit_transaction_id, r.minutes_drawn, r.contribution_pence]))
      .toEqual([[1, 90, 9000], [2, 60, 4800]]);
  });

  test('contribution is allocated from exact source amount, not rounded rate', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 60,
      sources: [
        source({
          id: 1,
          minutes: 90,
          amount_pence: 8250,
          effective_rate_pence_per_minute: 92,
        }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows[0]).toEqual(expect.objectContaining({
      rate_pence_per_minute: 92,
      contribution_pence: 5500,
    }));
    expect(plan.rows[0].contribution_pence)
      .not.toBe(plan.rows[0].minutes_drawn * plan.rows[0].rate_pence_per_minute);
  });

  test('final contribution draw takes remaining source remainder exactly', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 30,
      sources: [
        source({
          id: 1,
          minutes: 90,
          amount_pence: 8250,
          effective_rate_pence_per_minute: 92,
          active_minutes_drawn: 60,
          active_contribution_pence: 5500,
        }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows[0]).toEqual(expect.objectContaining({
      minutes_drawn: 30,
      rate_pence_per_minute: 92,
      contribution_pence: 2750,
    }));
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

  test('credit_source_adjustments pence reduce remaining contribution allocation', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 70,
      sources: [
        source({
          id: 1,
          minutes: 120,
          amount_pence: 12000,
          adjusted_minutes: 50,
          adjusted_pence: 5000,
        }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows[0]).toEqual(expect.objectContaining({
      minutes_drawn: 70,
      contribution_pence: 7000,
    }));
    expect(plan.rows[0].contribution_pence + 5000).toBe(12000);
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

  test('wrong-school sources are ignored', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 90,
      sources: [
        source({ id: 1, school_id: 2, minutes: 90, created_at: '2026-05-01T10:00:00.000Z' }),
        source({ id: 2, school_id: 1, minutes: 90, created_at: '2026-06-01T10:00:00.000Z' }),
      ],
    });

    expect(plan.ok).toBe(true);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].credit_transaction_id).toBe(2);
    expect(plan.rows[0].school_id).toBe(1);
    expect(plan.rows[0].minutes_drawn).toBe(90);
  });

  test('insufficient available minutes returns partial plan and shortage', () => {
    const plan = planFifoCreditDraw({
      schoolId: 1,
      minutes: 180,
      sources: [
        source({ id: 1, minutes: 90, active_minutes_drawn: 30, active_stripe_fee_pence: 30 }),
        source({ id: 2, minutes: 60, school_id: 2 }),
        source({ id: 3, minutes: 45, created_at: '2026-06-02T10:00:00.000Z' }),
      ],
    });

    expect(plan.ok).toBe(false);
    expect(plan.planned_minutes).toBe(105);
    expect(plan.shortage_minutes).toBe(75);
    expect(plan.rows.map(r => [r.credit_transaction_id, r.minutes_drawn]))
      .toEqual([[1, 60], [3, 45]]);
  });
});
