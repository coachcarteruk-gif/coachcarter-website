// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  buildControlledPayoutOverviewEstimate,
  buildLegacyPayoutOverviewEstimate,
  buildUnavailableControlledPayoutOverviewEstimate,
} = require('../api/_payout-overview');

const instructor = {
  id: 6,
  name: 'Controlled Instructor',
  commission_rate: '0.900',
  weekly_franchise_fee_pence: null,
  payouts_paused: true,
};

test.describe('payout overview manual-settlement boundary', () => {
  test('controlled estimate uses the exact controlled preview and excludes the legacy backlog', () => {
    const preview = {
      manual_settlement_boundary: {
        id: '8716617e-0549-4d14-b9be-c2d37a1e0266',
        settled_before_at: '2026-09-04T11:00:00.000Z',
        first_system_period_end_at: '2026-09-11T11:00:00.000Z',
        time_zone: 'Europe/London',
      },
      included: [{ booking_id: 9001 }],
      excluded: [
        { booking_id: 8001, reason: 'MANUALLY_SETTLED_BEFORE_CUTOFF' },
        { booking_id: 8002, reason: 'MANUALLY_SETTLED_BEFORE_CUTOFF' },
        { booking_id: 9002, reason: 'EXTERNAL_OR_CREDIT_SOURCE' },
      ],
      totals: { proposed_transfer_pence: 5175 },
      blockers: [],
    };

    expect(buildControlledPayoutOverviewEstimate(instructor, preview)).toMatchObject({
      instructor_id: 6,
      eligible_lessons: 1,
      estimated_pence: 5175,
      payout_path: 'interim_v1_controlled',
      manually_settled_lessons: 2,
      manual_settlement_boundary: preview.manual_settlement_boundary,
      estimate_unavailable: false,
    });
  });

  test('legacy instructors retain the existing commission estimate', () => {
    expect(buildLegacyPayoutOverviewEstimate(instructor, [
      { price_pence: 5500 },
      { price_pence: 8250 },
    ])).toMatchObject({
      eligible_lessons: 2,
      estimated_pence: 12375,
      payout_path: 'legacy',
      manually_settled_lessons: 0,
    });
  });

  test('a failed controlled preview is never rendered as a zero-value payout', () => {
    const result = buildUnavailableControlledPayoutOverviewEstimate({
      ...instructor,
      manual_settlement_boundary_id: '8716617e-0549-4d14-b9be-c2d37a1e0266',
      settled_before_at: '2026-09-04T11:00:00.000Z',
      first_system_period_end_at: '2026-09-11T11:00:00.000Z',
      manual_settlement_time_zone: 'Europe/London',
    });

    expect(result).toMatchObject({
      estimated_pence: null,
      estimate_unavailable: true,
      blockers: ['CONTROLLED_PREVIEW_UNAVAILABLE'],
      manual_settlement_boundary: {
        settled_before_at: '2026-09-04T11:00:00.000Z',
        first_system_period_end_at: '2026-09-11T11:00:00.000Z',
        time_zone: 'Europe/London',
      },
    });
  });

  test('admin read model and UI use the recorded boundary for controlled instructors', () => {
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin.js'), 'utf8');
    const portalSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'portal.js'), 'utf8');

    expect(adminSource).toContain('LEFT JOIN interim_v1_manual_settlement_boundaries mb');
    expect(adminSource).toContain('loadInterimV1Preview(sql, schoolId, inst.id)');
    expect(adminSource).toContain('buildControlledPayoutOverviewEstimate(inst, preview)');
    expect(portalSource).toContain('paid manually before');
    expect(portalSource).toContain('historical lessons excluded');
    expect(portalSource).toContain('Controlled — owner review required');
  });
});
