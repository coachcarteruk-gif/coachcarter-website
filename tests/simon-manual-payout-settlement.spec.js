// @ts-check
// Local/static contracts only. This suite does not call Stripe, Neon, Vercel,
// email, a deployed API, or any Production environment.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  buildPreviewFromRows,
  assertAuthorizedManualPayoutSettlementScope,
  fingerprint,
  manualPayoutSettlementCanonical,
  validateManualPayoutSettlementInput,
} = require('../api/_interim-v1-payout');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const settlementId = 'be1a44e4-4b70-4149-9611-54cd0bfd2575';
const boundaryId = '8716617e-0549-4d14-b9be-c2d37a1e0266';
const coveredBookingIds = [
  414, 458, 495, 528, 530, 534, 540, 550, 555, 559, 560,
  563, 564, 565, 566, 567, 568, 570, 571, 575, 579, 588,
];
const evidenceReference = 'owner-authorisation:2026-09-12;bank-transfer:2026-09-11';
const reason = 'Owner confirms GBP 1,041.02 manually paid for every obligation in the exact interval after one GBP 90.00 franchise fee deduction; GBP 1,131.02 must not be transferred.';

function canonical() {
  return manualPayoutSettlementCanonical({
    schoolId: 1,
    instructorId: 6,
    boundaryId,
    periodStartAt: '2026-09-04T11:00:00.000Z',
    periodEndAt: '2026-09-11T11:00:00.000Z',
    timeZone: 'Europe/London',
    authoritativeEarningPence: 113102,
    franchiseFeeDeductedPence: 9000,
    bankPaymentPence: 104102,
    paidLocalDate: '2026-09-11',
    bankReference: '4th sept-11th sept',
    coveredBookingIds,
    evidenceReference,
    reason,
  });
}

function requestBody() {
  return {
    settlement_id: settlementId,
    manual_settlement_boundary_id: boundaryId,
    idempotency_key: `cc-interim-v1-manual-settlement-${settlementId}`,
    settlement_fingerprint: fingerprint(canonical()),
    authoritative_earning_pence: 113102,
    franchise_fee_deducted_pence: 9000,
    bank_payment_pence: 104102,
    paid_local_date: '2026-09-11',
    bank_reference: '4th sept-11th sept',
    covered_booking_ids: coveredBookingIds,
    evidence_reference: evidenceReference,
    reason,
  };
}

function instructor() {
  return {
    id: 6,
    school_id: 1,
    name: 'Simon',
    commission_rate: '0.90',
    weekly_franchise_fee_pence: 9000,
    stripe_account_id: 'acct_live_reviewed',
    stripe_onboarding_complete: true,
    payouts_paused: true,
    payouts_start_date: '2026-03-01',
    control_id: '11111111-1111-4111-8111-111111111111',
    manual_settlement_boundary_id: boundaryId,
    settled_before_at: '2026-09-04T11:00:00.000Z',
    first_system_period_end_at: '2026-09-11T11:00:00.000Z',
    manual_settlement_time_zone: 'Europe/London',
    manual_payout_settlement_id: settlementId,
    manual_payout_period_start_at: '2026-09-04T11:00:00.000Z',
    manual_payout_period_end_at: '2026-09-11T11:00:00.000Z',
    manual_payout_time_zone: 'Europe/London',
    manual_payout_authoritative_earning_pence: 113102,
    manual_payout_franchise_fee_pence: 9000,
    manual_payout_bank_payment_pence: 104102,
    manual_payout_currency: 'gbp',
    manual_payout_paid_local_date: '2026-09-11',
    manual_payout_bank_reference: '4th sept-11th sept',
    manual_payout_covered_booking_count: 22,
    manual_payout_evidence_reference: evidenceReference,
    manual_payout_reason: reason,
    manual_payout_idempotency_key: `cc-interim-v1-manual-settlement-${settlementId}`,
    manual_payout_settlement_fingerprint: fingerprint(canonical()),
    manual_payout_created_at: '2026-09-12T10:00:00.000Z',
  };
}

function coveredRow(bookingId, index) {
  return {
    booking_id: bookingId,
    school_id: 1,
    instructor_id: 6,
    scheduled_date: `2026-09-${String(4 + (index % 7)).padStart(2, '0')}`,
    booking_ends_at: new Date(Date.UTC(2026, 8, 4 + (index % 7), 12, index)).toISOString(),
    status: 'chargeable',
    learner_name: `Reviewed learner ${bookingId}`,
    is_test_account: false,
    payouts_start_date: '2026-03-01',
    settled_before_at: '2026-09-04T11:00:00.000Z',
    first_system_period_end_at: '2026-09-11T11:00:00.000Z',
    evidence_id: null,
    bcs_count: 0,
    claimed_payout_id: null,
    manual_payout_settlement_id: settlementId,
  };
}

test.describe('Simon append-only manual payout settlement', () => {
  test('binds the reviewed amount, interval, evidence and exact booking set to one fingerprint', () => {
    const body = requestBody();
    expect(body.settlement_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(validateManualPayoutSettlementInput(body)).toMatchObject({
      settlementId,
      boundaryId,
      authoritativeEarningPence: 113102,
      franchiseFeeDeductedPence: 9000,
      bankPaymentPence: 104102,
      coveredBookingIds,
    });
    expect(assertAuthorizedManualPayoutSettlementScope({
      schoolId: 1, instructorId: 6, boundaryId,
    })).toBe(true);
    expect(() => assertAuthorizedManualPayoutSettlementScope({
      schoolId: 1, instructorId: 7, boundaryId,
    })).toThrow(/not authorized/i);
    expect(() => validateManualPayoutSettlementInput({
      ...body,
      bank_payment_pence: 113102,
    })).toThrow(/reconcile exactly/i);
    expect(() => validateManualPayoutSettlementInput({
      ...body,
      covered_booking_ids: [...coveredBookingIds, coveredBookingIds[0]],
    })).toThrow(/unique/i);
  });

  test('read model preserves source diagnostics while closing the interval at zero payable', () => {
    const rows = coveredBookingIds.map(coveredRow);
    const preview = buildPreviewFromRows(instructor(), rows, new Date('2026-09-12T10:00:00Z'));
    expect(preview.included).toEqual([]);
    expect(preview.excluded).toEqual([]);
    expect(preview.manually_settled.map((row) => row.booking_id)).toEqual(coveredBookingIds);
    expect(new Set(preview.manually_settled.map((row) => row.source_diagnostic_reason)))
      .toEqual(new Set(['NO_FUNDING_SOURCE']));
    expect(preview.manual_payout_settlement).toMatchObject({
      status: 'complete',
      authoritative_earning_pence: 113102,
      franchise_fee_deducted_pence: 9000,
      bank_payment_pence: 104102,
      remaining_payable_pence: 0,
    });
    expect(preview.totals).toMatchObject({
      weekly_franchise_fee_pence: 0,
      proposed_transfer_pence: 0,
      manually_settled_bank_payment_pence: 104102,
      remaining_payable_pence: 0,
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.ready_for_approval).toBe(false);
  });

  test('fails closed if even one interval booking lacks a matching coverage claim', () => {
    const rows = coveredBookingIds.map(coveredRow);
    rows[0].manual_payout_settlement_id = null;
    const preview = buildPreviewFromRows(instructor(), rows, new Date('2026-09-12T10:00:00Z'));
    expect(preview.manual_payout_settlement.status).toBe('incomplete');
    expect(preview.blockers).toContain('MANUAL_PAYOUT_SETTLEMENT_INCOMPLETE');
    expect(preview.totals.remaining_payable_pence).toBeNull();
    expect(preview.ready_for_approval).toBe(false);
  });

  test('migration is append-only, amountless at booking level and guards every payout claim route', () => {
    const migration = read('db/migrations/062_interim_v1_manual_payout_settlements.sql');
    const bookingTable = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS interim_v1_manual_payout_settlement_bookings'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_interim_v1_manual_payout_booking_scope'),
    );
    expect(bookingTable).not.toMatch(/amount|pence|fee|currency/i);
    expect(migration).toContain('interim_v1_manual_payout_settlements_append_only');
    expect(migration).toContain('interim_v1_manual_payout_bookings_append_only');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('payout_line_items_manual_settlement_guard');
    expect(migration).toContain('school_payout_line_items_manual_settlement_guard');
    expect(migration).toContain('booking_earnings_manual_settlement_guard');
    expect(migration).toContain('stripe_launch_booking_earnings_manual_settlement_guard');
    expect(migration).not.toMatch(/INSERT\s+INTO\s+interim_v1_manual_payout_settlements/i);
    const aggregate = read('db/migration.sql');
    expect(aggregate).toContain('CREATE TABLE IF NOT EXISTS interim_v1_manual_payout_settlements');
    expect(aggregate).toContain('stripe_launch_booking_earnings_manual_settlement_guard');
  });

  test('dedicated operation writes only the two settlement tables plus the required audit', () => {
    const source = read('api/_interim-v1-payout.js');
    const start = source.indexOf("if (action === 'interim-v1-record-manual-payout-settlement')");
    const end = source.indexOf("if (action === 'interim-v1-approve-first-run')", start);
    const branch = source.slice(start, end);
    expect(branch).toContain('MANUAL_PAYOUT_SETTLEMENT_CONFIRMATION');
    expect(branch).toContain('MANUAL_PAYOUT_SETTLEMENT_BOOKING_SET_CHANGED');
    expect(branch).toContain('MANUAL_PAYOUT_SETTLEMENT_POSTFLIGHT_FAILED');
    expect(branch).toContain('INSERT INTO interim_v1_manual_payout_settlements');
    expect(branch).toContain('INSERT INTO interim_v1_manual_payout_settlement_bookings');
    expect(branch).toContain("action: 'payout.interim_v1_manual_payout_settlement_recorded'");
    expect(branch).not.toContain('stripe.');
    expect(branch).not.toMatch(/INSERT INTO (interim_v1_payout_approvals|instructor_payouts|payout_line_items|interim_v1_transfer|refund)/);
    expect(branch).not.toMatch(/UPDATE\s+(interim_v1_manual_settlement_boundaries|booking_credit_sources|credit_transactions|flexible_package_booking_allocations|instructors)/i);
  });

  test('all current payout selectors and instructor correction path recognize the manual claim', () => {
    expect(read('api/_payout-helpers.js')).toContain('interim_v1_manual_payout_settlement_bookings');
    expect(read('api/_payout-v2-shadow.js')).toContain('has_manual_payout_settlement_claim');
    expect(read('api/_payout-v2-earning-planner.js')).toContain('booking_already_settled_external_manual_payout');
    expect(read('api/instructor.js')).toContain('booking.already_paid_out || booking.manually_settled');
  });
});
