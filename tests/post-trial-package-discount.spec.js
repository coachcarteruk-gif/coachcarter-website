// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { planFlexiblePackageFifo } = require('../api/_flexible-package-ledger');
const {
  discountedConsumerRightsSnapshot,
  normaliseConsumerRightsConfig,
} = require('../api/_full-curriculum-consumer-rights');
const {
  validateProviderObject,
  buildPackageCheckoutParams,
} = require('../api/_learner-package-payments');
const {
  validateFlexibleProviderObject,
  buildFlexiblePackageCheckoutParams,
} = require('../api/_flexible-package-payments');
const { preprocessPostTrialWebhook } = require('../api/_post-trial-webhook');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

function loadPackageWebhookWithPostTrial(preprocessPostTrialWebhook) {
  const helperPath = require.resolve('../api/_post-trial-webhook');
  const webhookPath = require.resolve('../api/package-webhook');
  const oldHelper = require.cache[helperPath];
  const oldWebhook = require.cache[webhookPath];
  require.cache[helperPath] = { exports: { preprocessPostTrialWebhook } };
  delete require.cache[webhookPath];
  const loaded = require('../api/package-webhook')._test;
  if (oldHelper) require.cache[helperPath] = oldHelper; else delete require.cache[helperPath];
  if (oldWebhook) require.cache[webhookPath] = oldWebhook; else delete require.cache[webhookPath];
  return loaded;
}

function packageSessionEvent(type, attempt, paymentStatus) {
  return {
    id: `evt_${type}_${paymentStatus}`, type, created: 1789552800, livemode: false,
    data: { object: {
      id: 'cs_test_post_trial', livemode: false, mode: 'payment', payment_status: paymentStatus,
      amount_total: attempt.amount_pence, currency: 'gbp', payment_intent: 'pi_post_trial',
      payment_method_configuration_details: { id: attempt.stripe_payment_method_configuration_id },
      metadata: {
        payment_type: 'learner_package_test', package_attempt_id: attempt.id,
        school_id: String(attempt.school_id), learner_id: String(attempt.learner_id),
        package_product_id: String(attempt.product_id), package_product_version_id: String(attempt.product_version_id),
        amount_pence: String(attempt.amount_pence), currency: attempt.currency,
        customer_terms_version: attempt.customer_terms_version, stripe_mode: 'test',
        full_curriculum_test_booking_id: String(attempt.full_curriculum_test_booking_id),
        payment_method_configuration_id: attempt.stripe_payment_method_configuration_id,
        post_trial_quote_id: attempt.post_trial_quote_id,
      },
    } },
  };
}

function rightsContent() {
  return {
    name: 'Full Curriculum',
    consumer_rights: {
      policy_version: 'full-curriculum-consumer-rights-v1',
      disclosure_version: 'full-curriculum-checkout-disclosure-v1',
      refund_calculation_version: 'full-curriculum-refund-v1',
      valuation_basis: 'purchase_price_allocation',
      rounding_rule: 'whole_pence_deductions_down',
      cooling_off_days: 14,
      matching_admin_deduction_pence: 0,
      stripe_fee_customer_deduction_pence: 0,
      teaching_deductions: {
        base_90_minutes_pence: 6000, base_cap_pence: 144000,
        retake_90_minutes_pence: 6000, retake_120_minutes_pence: 8000,
        retake_cap_pence: 40000,
      },
      assessment_deductions: { each_completed_pence: 5000, cap_pence: 15000 },
    },
  };
}

test.describe('post-trial package discounts', () => {
  test('scales Full Curriculum refund caps to actual paid cash while retaining valid protections', () => {
    const snapshot = discountedConsumerRightsSnapshot(rightsContent(), 200000, 180000);
    expect(snapshot.consumer_rights.teaching_deductions).toMatchObject({
      base_90_minutes_pence: 5400,
      base_cap_pence: 129600,
      retake_120_minutes_pence: 7200,
      retake_cap_pence: 36000,
    });
    expect(snapshot.consumer_rights.assessment_deductions).toEqual({
      each_completed_pence: 4500,
      cap_pence: 13500,
    });
    expect(normaliseConsumerRightsConfig(snapshot, 180000).ok).toBe(true);
    expect(rightsContent().consumer_rights.teaching_deductions.base_cap_pence).toBe(144000);
  });

  test('conserves arbitrary discounted source pennies across non-last returns and final drain', () => {
    const rate = 100 / 3;
    const first = planFlexiblePackageFifo([{ id: 1, remaining_units: 3, remaining_value_pence: 100, rate_pence_per_unit: rate }], 1);
    const second = planFlexiblePackageFifo([{ id: 1, remaining_units: 2, remaining_value_pence: 67, rate_pence_per_unit: rate }], 1);
    expect(first.contribution_pence).toBe(33);
    expect(second.contribution_pence).toBe(34);

    // Return the first allocation: its exact 33p and one unit re-enter the pool.
    const replacement = planFlexiblePackageFifo([{ id: 1, remaining_units: 2, remaining_value_pence: 66, rate_pence_per_unit: rate }], 1);
    const drain = planFlexiblePackageFifo([{ id: 1, remaining_units: 1, remaining_value_pence: 33, rate_pence_per_unit: rate }], 1);
    expect(replacement.contribution_pence).toBe(33);
    expect(drain.contribution_pence).toBe(33);
    expect(second.contribution_pence + replacement.contribution_pence + drain.contribution_pence).toBe(100);
  });

  test('puts frozen quote metadata on both package Checkout families and rejects mismatch', () => {
    const metadata = {
      post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174000',
      post_trial_final_amount_pence: '9000',
      post_trial_checkout_expires_at: '2099-09-16T12:30:00.000Z',
    };
    const packageAttempt = {
      id: '123e4567-e89b-42d3-a456-426614174001', school_id: 1, learner_id: 2,
      product_id: 3, product_version_id: 4, product_slug: 'full-curriculum',
      product_name: 'Full Curriculum', product_description: '', amount_pence: 9000,
      currency: 'GBP', customer_terms_version: 'terms', stripe_mode: 'test',
      stripe_payment_method_configuration_id: 'pmc_test', post_trial_quote: { metadata },
    };
    const packageParams = buildPackageCheckoutParams({
      attempt: packageAttempt, learnerEmail: 'a@example.test',
      returnBaseUrl: 'https://example.test', paymentMethodConfiguration: 'pmc_test',
    });
    expect(packageParams.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60);
    expect(packageParams.expires_at).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 31 * 60 + 1);
    const packageObject = {
      id: 'cs_test_x', livemode: false, mode: 'payment', amount_total: 9000,
      currency: 'gbp', payment_intent: null,
      payment_method_configuration_details: { id: 'pmc_test' },
      metadata: { ...packageParams.metadata, post_trial_final_amount_pence: '9001' },
    };
    expect(validateProviderObject(packageAttempt, packageObject).contradictions)
      .toContain('post_trial_final_amount_pence_mismatch');

    const flexibleAttempt = {
      id: '123e4567-e89b-42d3-a456-426614174002', school_id: 1, learner_id: 2,
      product_id: 5, product_version_id: 6, product_slug: 'flexible-10-hours',
      product_snapshot: { name: '10 Flexible Hours' }, amount_pence: 49500,
      currency: 'GBP', total_units: 20, unit_minutes: 30, rate_pence_per_unit: 2475,
      customer_terms_version: 'flexible-hours-v1', disclosure_version: 'flexible-hours-consumer-rights-v1',
      stripe_payment_method_configuration_id: 'pmc_live', post_trial_quote: { metadata },
    };
    const flexibleParams = buildFlexiblePackageCheckoutParams({
      attempt: flexibleAttempt, learnerEmail: 'a@example.test', returnBaseUrl: 'https://example.test',
    });
    expect(flexibleParams.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60);
    const flexibleObject = {
      id: 'cs_live_x', livemode: true, mode: 'payment', amount_total: 49500,
      currency: 'gbp', payment_intent: null,
      payment_method_configuration_details: { id: 'pmc_live' }, metadata: flexibleParams.metadata,
    };
    expect(validateFlexibleProviderObject(flexibleAttempt, flexibleObject).ok).toBe(true);

    expect(buildPackageCheckoutParams({
      attempt: { ...packageAttempt, post_trial_quote: {} }, learnerEmail: 'a@example.test',
      returnBaseUrl: 'https://example.test', paymentMethodConfiguration: 'pmc_test',
    }).expires_at).toBeUndefined();
    expect(buildFlexiblePackageCheckoutParams({
      attempt: { ...flexibleAttempt, post_trial_quote: {} }, learnerEmail: 'a@example.test',
      returnBaseUrl: 'https://example.test',
    }).expires_at).toBeUndefined();
  });

  test('package webhook retries reversed async delivery, then settles once signed initiation arrives', async () => {
    const calls = [];
    const retryEvent = packageSessionEvent('checkout.session.async_payment_succeeded', {
      id: '123e4567-e89b-42d3-a456-426614174010', school_id: 7, learner_id: 41,
      product_id: 91, product_version_id: 9101, full_curriculum_test_booking_id: 701,
      stripe_payment_method_configuration_id: 'pmc_package_test', amount_pence: 180000,
      currency: 'GBP', customer_terms_version: 'terms-v1',
      post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174011',
    }, 'paid');
    const actualRetry = await preprocessPostTrialWebhook(async (strings) => {
      if (strings.join('?').includes('SELECT payment_type')) return [];
      if (strings.join('?').includes('SELECT *')) return [{
        id: '123e4567-e89b-42d3-a456-426614174011', school_id: 7, learner_id: 41,
        trial_booking_id: null,
        base_amount_pence: 200000, discount_pct: 10, discount_pence: 20000, final_amount_pence: 180000,
        payment_type: 'learner_package_test', payment_identity: 'cs_test_post_trial',
        created_at: '2026-09-16T12:00:00.000Z', checkout_expires_at: '2026-09-16T12:30:00.000Z',
        provider_initiated_at: null,
      }];
      return [];
    }, { event: retryEvent, schoolId: 7, learnerId: 41, paymentType: 'learner_package_test', paymentIdentity: 'cs_test_post_trial' });
    expect(actualRetry).toMatchObject({ retryable: true, code: 'POST_TRIAL_INITIATION_HISTORY_REQUIRED' });
    const webhook = loadPackageWebhookWithPostTrial(async (_sql, input) => {
      calls.push(input.event.type);
      if (input.event.type === 'checkout.session.async_payment_succeeded' && calls.length === 1) {
        return actualRetry;
      }
      return { hasQuote: true, ok: true, fulfill: input.event.data.object.payment_status === 'paid',
        quote: { provider_initiated_at: '2026-09-16T12:00:00.000Z' } };
    });
    const attempt = {
      id: '123e4567-e89b-42d3-a456-426614174010', school_id: 7, learner_id: 41,
      product_id: 91, product_version_id: 9101, product_slug: 'full-curriculum',
      full_curriculum_test_booking_id: 701, stripe_payment_method_configuration_id: 'pmc_package_test',
      amount_pence: 180000, currency: 'GBP', customer_terms_version: 'terms-v1', status: 'submitting',
      post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174011', post_trial_quote: { metadata: {
        post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174011',
      } },
    };
    const state = { attempt: { ...attempt }, transitions: [] };
    const sql = async (strings, ...values) => {
      const statement = strings.join('?');
      if (/SET post_trial_provider_initiated_at/.test(statement)) {
        state.attempt = { ...state.attempt, post_trial_provider_initiated_at: values[0] };
        return [state.attempt];
      }
      if (/WITH previous AS/.test(statement)) {
        const allowed = values[2]; const target = values[3];
        if (allowed.includes(state.attempt.status)) {
          state.transitions.push([state.attempt.status, target]);
          state.attempt = { ...state.attempt, status: target };
          return [state.attempt];
        }
        return [];
      }
      if (/SELECT \* FROM package_purchase_attempts/.test(statement)) return [state.attempt];
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const asyncSuccess = packageSessionEvent('checkout.session.async_payment_succeeded', attempt, 'paid');
    await expect(webhook.processPackageEvent(sql, { event: asyncSuccess, attempt: state.attempt }))
      .rejects.toMatchObject({ code: 'POST_TRIAL_INITIATION_HISTORY_REQUIRED' });
    const completed = packageSessionEvent('checkout.session.completed', attempt, 'unpaid');
    await webhook.processPackageEvent(sql, { event: completed, attempt: state.attempt });
    expect(state.attempt.status).toBe('pending');
    await webhook.processPackageEvent(sql, { event: asyncSuccess, attempt: state.attempt });
    expect(state.attempt.status).toBe('paid');
    expect(state.transitions).toEqual([['submitting', 'pending'], ['pending', 'paid']]);
  });

  test('package webhook rejects cross-tenant and amount-tampered signed objects before quote fulfilment', async () => {
    let quoteCalls = 0;
    const webhook = loadPackageWebhookWithPostTrial(async () => { quoteCalls += 1; return { ok: true, fulfill: true }; });
    const base = {
      id: '123e4567-e89b-42d3-a456-426614174020', school_id: 7, learner_id: 41,
      product_id: 91, product_version_id: 9101, product_slug: 'full-curriculum',
      full_curriculum_test_booking_id: 701, stripe_payment_method_configuration_id: 'pmc_package_test',
      amount_pence: 180000, currency: 'GBP', customer_terms_version: 'terms-v1', status: 'submitting',
      post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174021', post_trial_quote: { metadata: {
        post_trial_quote_id: '123e4567-e89b-42d3-a456-426614174021',
      } },
    };
    for (const override of [{ amount_total: 180001 }, { metadata: {
      ...packageSessionEvent('checkout.session.completed', base, 'paid').data.object.metadata,
      school_id: '8',
    } }]) {
      const state = { attempt: { ...base } };
      const sql = async (strings, ...values) => {
        const statement = strings.join('?');
        if (/WITH previous AS/.test(statement)) {
          state.attempt = { ...state.attempt, status: values[3], failure_code: values[6] };
          return [state.attempt];
        }
        if (/SELECT \* FROM package_purchase_attempts/.test(statement)) return [state.attempt];
        throw new Error(`Unexpected SQL: ${statement}`);
      };
      const event = packageSessionEvent('checkout.session.completed', base, 'paid');
      Object.assign(event.data.object, override);
      await webhook.processPackageEvent(sql, { event, attempt: state.attempt });
      expect(state.attempt.status).toBe('review_required');
    }
    expect(quoteCalls).toBe(0);
  });

  test('migration freezes base snapshots and replaces hardcoded Flexible Hours amount constraints', () => {
    const migration = read('db/migrations/068_post_trial_package_snapshots.sql');
    expect(migration).toContain('base_product_snapshot JSONB');
    expect(migration).toContain('post_trial_quote_id UUID');
    expect(migration).toContain('amount_pence = ROUND(total_units * rate_pence_per_unit)');
    expect(migration).toContain('s.original_value_pence');
    expect(migration).toContain('SUM(a.contribution_pence)');
    expect(migration).toContain('SUM(r.gross_refund_pence)');
    expect(read('api/flexible-packages.js')).toContain('source.original_value_pence - COALESCE(reduced.value_pence, 0)');
  });

  test('existing purchase eligibility and product gates remain in place', () => {
    const flexible = read('api/flexible-packages.js');
    const packages = read('api/packages.js');
    expect(flexible).toContain('FLEXIBLE_BALANCE_MUST_BE_USED_FIRST');
    expect(flexible).toContain('isFlexiblePackageLivePurchasingEnabled');
    expect(packages).toContain('isLearnerPackagePurchasingEnabled');
    expect(packages).toContain('CONTROLLED_PILOT_ACCESS_REQUIRED');
    expect(read('api/package-webhook.js')).toContain('quoteValidation.retryable === true');
    expect(read('api/flexible-package-webhook.js')).toContain('quoteValidation.retryable === true');
  });
});
