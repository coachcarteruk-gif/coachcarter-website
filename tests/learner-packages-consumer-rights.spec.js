'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  CHECKOUT_ACKNOWLEDGEMENT,
  CONSUMER_RIGHTS_DISCLOSURE_VERSION,
  EARLY_START_REQUEST,
  buildConsumerContractSnapshot,
  calculateRefund,
  coolingOffExpiresAt,
  normaliseConsumerRightsConfig,
} = require('../api/_full-curriculum-consumer-rights');
const { sendFullCurriculumDurableConfirmation } = require('../api/_full-curriculum-confirmation');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function content(overrides = {}) {
  return {
    consumer_rights: {
      policy_version: 'full-curriculum-consumer-rights-v1',
      disclosure_version: 'full-curriculum-checkout-disclosure-v1',
      refund_calculation_version: 'full-curriculum-refund-v1',
      cooling_off_days: 14,
      valuation_basis: 'purchase_price_allocation',
      rounding_rule: 'whole_pence_deductions_down',
      matching_admin_deduction_pence: 0,
      stripe_fee_customer_deduction_pence: 0,
      teaching_deductions: {
        base_90_minutes_pence: 6000,
        base_cap_pence: 144000,
        retake_90_minutes_pence: 6000,
        retake_120_minutes_pence: 8000,
        retake_cap_pence: 40000,
      },
      assessment_deductions: {
        each_completed_pence: 5000,
        cap_pence: 15000,
      },
      ...overrides,
    },
  };
}

function config() {
  const result = normaliseConsumerRightsConfig(content(), 200000);
  expect(result.ok).toBe(true);
  return result.config;
}

test.describe('Full Curriculum consumer-rights and manual-refund policy', () => {
  test('requires a complete purchase-price allocation with zero admin and Stripe deductions', () => {
    expect(normaliseConsumerRightsConfig(content(), 200000).ok).toBe(true);
    expect(normaliseConsumerRightsConfig({}, 200000)).toMatchObject({ ok: false, code: 'CONSUMER_RIGHTS_CONFIG_MISSING' });
    expect(normaliseConsumerRightsConfig(content({ matching_admin_deduction_pence: 1 }), 200000))
      .toMatchObject({ ok: false, code: 'CONSUMER_RIGHTS_CONFIG_INVALID' });
    expect(normaliseConsumerRightsConfig(content({
      assessment_deductions: { each_completed_pence: 5000, cap_pence: 50000 },
    }), 200000)).toMatchObject({ ok: false, code: 'CONSUMER_RIGHTS_CONFIG_INVALID' });
  });

  test('uses the end of fourteen days after the contract day across GMT and BST', () => {
    expect(coolingOffExpiresAt('2027-01-01T15:00:00Z', 'Europe/London').toISOString())
      .toBe('2027-01-16T00:00:00.000Z');
    expect(coolingOffExpiresAt('2027-08-01T14:00:00Z', 'Europe/London').toISOString())
      .toBe('2027-08-15T23:00:00.000Z');
  });

  test('freezes exact disclosure, terms and explicit early-start evidence', () => {
    const snapshot = buildConsumerContractSnapshot({
      amountPence: 200000,
      customerTermsVersion: 'full-curriculum-consumer-v1',
      config: config(),
      earlyStartRequested: true,
      adultAgeConfirmed: true,
    });
    expect(snapshot.snapshot).toMatchObject({
      disclosure_version: CONSUMER_RIGHTS_DISCLOSURE_VERSION,
      checkout_acknowledgement: CHECKOUT_ACKNOWLEDGEMENT,
      early_start_requested: true,
      adult_age_confirmed: true,
      start_request_text: EARLY_START_REQUEST,
      matching_admin_deduction_pence: 0,
      stripe_fee_customer_deduction_pence: 0,
    });
    expect(snapshot.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.startRequestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(buildConsumerContractSnapshot({
      amountPence: 200000,
      customerTermsVersion: 'full-curriculum-consumer-v1',
      config: config(),
      earlyStartRequested: false,
      adultAgeConfirmed: false,
    })).toBeNull();
  });

  test('gives a full cooling-off refund when valid early-start evidence is absent', () => {
    const result = calculateRefund({
      amountPence: 200000,
      previousRefundPence: 0,
      classification: 'cooling_off_cancellation',
      validEarlyStartRequest: false,
      baseDeliveredCount: 2,
      baseLateCancelledCount: 1,
      assessmentCompletedCount: 1,
      config: config(),
    });
    expect(result).toMatchObject({ refund_due_pence: 200000, deduction_pence: 0 });
  });

  test('cooling-off early start deducts delivered service but not a missed lesson or fees', () => {
    const result = calculateRefund({
      amountPence: 200000,
      previousRefundPence: 0,
      classification: 'cooling_off_cancellation',
      validEarlyStartRequest: true,
      baseDeliveredCount: 2,
      baseLateCancelledCount: 1,
      assessmentCompletedCount: 1,
      config: config(),
    });
    expect(result).toMatchObject({ deduction_pence: 17000, refund_due_pence: 183000 });
    expect(result.lines.find(line => line.line_type === 'matching_admin').deduction_pence).toBe(0);
    expect(result.lines.find(line => line.line_type === 'stripe_fee').deduction_pence).toBe(0);
  });

  test('voluntary withdrawal counts post-cooling late cancellation and enforces component caps', () => {
    const result = calculateRefund({
      amountPence: 200000,
      previousRefundPence: 0,
      classification: 'voluntary_withdrawal',
      validEarlyStartRequest: true,
      baseDeliveredCount: 30,
      baseLateCancelledCount: 2,
      retake90DeliveredCount: 8,
      retake120DeliveredCount: 2,
      assessmentCompletedCount: 10,
      config: config(),
    });
    expect(result.lines.find(line => line.line_type === 'base_teaching').deduction_pence).toBe(144000);
    expect(result.lines.find(line => line.line_type === 'retake_teaching').deduction_pence).toBe(40000);
    expect(result.lines.find(line => line.line_type === 'completed_assessment').deduction_pence).toBe(15000);
    expect(result).toMatchObject({ remaining_cash_pence: 200000, deduction_pence: 199000, refund_due_pence: 1000 });
  });

  test('awaits a durable exact-terms confirmation and records only hashed delivery evidence', async () => {
    const statements = [];
    const sql = async (strings) => {
      const statement = strings.join('?');
      statements.push(statement);
      if (/SELECT id FROM full_curriculum_contract_events/.test(statement)) return [];
      if (/FROM package_purchase_attempts attempt/.test(statement)) return [{
        attempt_id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab',
        product_name: 'Full Curriculum',
        product_snapshot: { consumer_rights: { policy_version: 'v1' } },
        amount_pence: 200000,
        currency: 'GBP',
        customer_terms_version: 'full-curriculum-owner-certified-v1',
        purchase_id: 11,
        enrolment_id: 12,
        contract_formed_at: '2026-08-15T10:00:00.000Z',
        cooling_off_expires_at: '2026-08-30T00:00:00.000Z',
        service_may_start_at: '2026-08-30T00:00:00.000Z',
        matching_deadline: '2026-09-06T00:00:00.000Z',
        policy_version: 'full-curriculum-consumer-rights-v1',
        disclosure_version: CONSUMER_RIGHTS_DISCLOSURE_VERSION,
        refund_calculation_version: 'full-curriculum-refund-v1',
        disclosure_snapshot: { exact: true },
        early_start_requested: false,
        adult_age_confirmed: true,
        start_request_text: 'Do not start until my cancellation period ends.',
        acknowledged_at: '2026-08-15T09:59:00.000Z',
        learner_id: 41,
        learner_name: 'Learner',
        email: 'learner@example.test',
        school_name: 'CoachCarter',
      }];
      if (/INSERT INTO full_curriculum_contract_events/.test(statement)) return [];
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const messages = [];
    const result = await sendFullCurriculumDurableConfirmation({
      sql,
      attemptId: '018f47b0-1a2b-4c3d-8e9f-0123456789ab',
      schoolId: 1,
      createMailer: () => ({ sendMail: async options => messages.push(options) }),
    });
    expect(result).toEqual({ delivered: true, reused: false });
    expect(messages).toHaveLength(1);
    expect(messages[0].attachments[0].content).toContain('purchased_product_terms');
    expect(statements.some(statement => statement.includes("'durable_confirmation_delivered'"))).toBe(true);
    expect(JSON.stringify(statements)).not.toContain('learner@example.test');
  });

  test('matching failure is always full original-method value remaining', () => {
    const result = calculateRefund({
      amountPence: 200000,
      previousRefundPence: 25000,
      classification: 'matching_failure',
      validEarlyStartRequest: true,
      baseDeliveredCount: 3,
      assessmentCompletedCount: 1,
      config: config(),
    });
    expect(result).toMatchObject({ remaining_cash_pence: 175000, deduction_pence: 0, refund_due_pence: 175000 });
  });

  test('schema is tenant-scoped, append-only and manual-only', () => {
    for (const source of [read('db/migration.sql'), read('db/migrations/048_full_curriculum_consumer_rights.sql')]) {
      for (const table of [
        'full_curriculum_consumer_contract_evidence',
        'full_curriculum_contract_events',
        'full_curriculum_termination_requests',
        'full_curriculum_refund_cases',
        'full_curriculum_refund_lines',
        'full_curriculum_refund_case_events',
      ]) expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(source).toContain('Full Curriculum refund calculation evidence is immutable');
      expect(source).toContain('Full Curriculum refund approval requires a second admin');
      expect(source).toContain('cooling_off_hold');
      expect(source).not.toContain('INSERT INTO learner_credit_balances');
    }
    const api = read('api/_full-curriculum-api.js');
    const refunds = read('api/_full-curriculum-refunds.js');
    expect(api).toContain('reviewed_by_admin_id IS DISTINCT FROM ${scope.actor.id}');
    expect(api).toContain('provider_call_made_by_application: false');
    expect(refunds).not.toContain('stripe.refunds.create');
    expect(api).not.toContain('stripe.refunds.create');
  });

  test('learner copy uses an unambiguous payment button and optional early start', () => {
    const learner = read('public/learner/packages.js');
    expect(learner).toContain("Pay ' + escapeHtml(formatPrice(product.price_pence, product.currency)) + ' and enrol");
    expect(learner).toContain('Begin matching after my 14-day cancellation period');
    expect(learner).toContain('Begin matching now');
    expect(learner).toContain('consumer_terms_accepted');
    expect(learner).toContain('adult_age_confirmed');
  });
});
