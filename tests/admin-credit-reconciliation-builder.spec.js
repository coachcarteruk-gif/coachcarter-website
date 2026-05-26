// @ts-check
// Pure builder tests for future credit-reconciliation writer inputs.
//
// These tests do not touch Neon, Stripe, migrations, payout crons, live Stripe,
// Stripe mutations, or credit writers.

const { test, expect } = require('@playwright/test');
const {
  buildReconciliationGrantInput,
  creditsDeltaForReconciliationMinutes,
} = require('../api/_admin-credit-reconciliation');

function readyPreview(overrides = {}) {
  return {
    ok: true,
    ready: true,
    noop: false,
    status: 200,
    code: 'READY_TO_RECONCILE',
    message: 'Payment is ready for a reconciliation credit grant preview.',
    grant_preview: {
      source: 'reconciliation',
      type: 'admin_add',
      learner_id: 10,
      instructor_id: 4,
      school_id: 1,
      minutes: 600,
      effective_rate_pence_per_minute: 55,
      amount_pence: 33000,
      stripe_fee_pence: 514,
      absorbed_by: null,
      stripe_session_id: 'cs_builder',
      stripe_payment_intent_id: 'pi_builder',
      stripe_charge_id: 'ch_builder',
      ...(overrides.grant_preview || {}),
    },
    stripe: {
      session_id: 'cs_builder',
      payment_intent_id: 'pi_builder',
      charge_id: 'ch_builder',
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'grant_preview')
    ),
  };
}

test.describe('admin credit-reconciliation writer-input builder', () => {
  test('happy ready preview maps to exact future mutation args and audit details', () => {
    const result = buildReconciliationGrantInput({
      preview: readyPreview(),
      reason: '  webhook missed during deploy  ',
    });

    expect(result).toEqual({
      ok: true,
      mutationInput: {
        learnerId: 10,
        instructorId: 4,
        schoolId: 1,
        delta: 600,
        creditsDelta: 10,
        ledgerType: 'admin_add',
        reason: 'webhook missed during deploy',
        amountPence: 33000,
        stripeFeePence: 514,
        effectiveRatePencePerMinute: 55,
        source: 'reconciliation',
        absorbedBy: null,
        stripeSessionId: 'cs_builder',
        stripePaymentIntentId: 'pi_builder',
        stripeChargeId: 'ch_builder',
        allowOverdraft: false,
      },
      audit: {
        action: 'admin.credit_reconciliation',
        targetType: 'learner',
        targetId: 10,
        schoolId: 1,
        details: {
          learner_id: 10,
          instructor_id: 4,
          school_id: 1,
          minutes: 600,
          credits_delta: 10,
          reason: 'webhook missed during deploy',
          amount_pence: 33000,
          stripe_fee_pence: 514,
          effective_rate_pence_per_minute: 55,
          source: 'reconciliation',
          absorbed_by: null,
          stripe_session_id: 'cs_builder',
          stripe_payment_intent_id: 'pi_builder',
          stripe_charge_id: 'ch_builder',
        },
      },
    });
  });

  test('Stripe ids and Stripe fee are carried through from the preview', () => {
    const result = buildReconciliationGrantInput({
      preview: readyPreview({
        grant_preview: {
          stripe_session_id: 'cs_custom',
          stripe_payment_intent_id: 'pi_custom',
          stripe_charge_id: 'ch_custom',
          stripe_fee_pence: 777,
        },
      }),
      reason: 'webhook retry exhausted',
    });

    expect(result.ok).toBe(true);
    expect(result.mutationInput).toMatchObject({
      stripeSessionId: 'cs_custom',
      stripePaymentIntentId: 'pi_custom',
      stripeChargeId: 'ch_custom',
      stripeFeePence: 777,
    });
    expect(result.audit.details).toMatchObject({
      stripe_session_id: 'cs_custom',
      stripe_payment_intent_id: 'pi_custom',
      stripe_charge_id: 'ch_custom',
      stripe_fee_pence: 777,
    });
  });

  test('reason is required and normalized consistently with admin contracts', () => {
    expect(buildReconciliationGrantInput({
      preview: readyPreview(),
      reason: '   ',
    })).toEqual({
      ok: false,
      status: 400,
      code: 'INVALID_REASON',
      message: 'reason is required.',
    });

    const result = buildReconciliationGrantInput({
      preview: readyPreview(),
      reason: '\noperator confirmed missed webhook\t',
    });

    expect(result.ok).toBe(true);
    expect(result.mutationInput.reason).toBe('operator confirmed missed webhook');
    expect(result.audit.details.reason).toBe('operator confirmed missed webhook');
  });

  test('creditsDelta matches the goodwill convention', () => {
    expect(creditsDeltaForReconciliationMinutes(30)).toBe(1);
    expect(creditsDeltaForReconciliationMinutes(90)).toBe(2);

    const result = buildReconciliationGrantInput({
      preview: readyPreview({ grant_preview: { minutes: 90 } }),
      reason: 'manual reconciliation',
    });

    expect(result.ok).toBe(true);
    expect(result.mutationInput.creditsDelta).toBe(2);
  });

  test('no-op already reconciled cannot build mutation input', () => {
    const result = buildReconciliationGrantInput({
      preview: {
        ok: true,
        ready: false,
        noop: true,
        code: 'ALREADY_RECONCILED',
        existing_credit_transaction: { id: 42 },
      },
      reason: 'already handled',
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'RECONCILIATION_PREVIEW_NOOP',
      message: 'Credit reconciliation preview is a no-op; no mutation input can be built.',
    });
    expect(result).not.toHaveProperty('mutationInput');
    expect(result).not.toHaveProperty('audit');
  });

  test('conflict, manual-review, and reject previews cannot build mutation input', () => {
    const cases = [
      readyPreview({
        ok: false,
        ready: false,
        manual_review: true,
        code: 'PAYMENT_REFUNDED',
      }),
      readyPreview({
        ok: false,
        ready: false,
        conflict: true,
        code: 'RECONCILIATION_IDENTITY_CONFLICT',
      }),
      readyPreview({
        ready: false,
        code: 'NOT_READY',
      }),
    ];

    expect(buildReconciliationGrantInput({ preview: cases[0], reason: 'x' })).toMatchObject({
      ok: false,
      code: 'RECONCILIATION_PREVIEW_MANUAL_REVIEW',
      preview_code: 'PAYMENT_REFUNDED',
    });
    expect(buildReconciliationGrantInput({ preview: cases[1], reason: 'x' })).toMatchObject({
      ok: false,
      code: 'RECONCILIATION_PREVIEW_MANUAL_REVIEW',
      preview_code: 'RECONCILIATION_IDENTITY_CONFLICT',
    });
    expect(buildReconciliationGrantInput({ preview: cases[2], reason: 'x' })).toMatchObject({
      ok: false,
      code: 'RECONCILIATION_PREVIEW_NOT_READY',
      preview_code: 'NOT_READY',
    });
  });

  test('malformed preview cannot build mutation input', () => {
    const malformedCases = [
      null,
      {},
      readyPreview({ grant_preview: { learner_id: null } }),
      readyPreview({ grant_preview: { source: 'goodwill' } }),
      readyPreview({ grant_preview: { type: 'purchase' } }),
      readyPreview({ grant_preview: { absorbed_by: 'platform' } }),
      readyPreview({ grant_preview: { stripe_payment_intent_id: '' } }),
      readyPreview({ grant_preview: { amount_pence: -1 } }),
    ];

    for (const preview of malformedCases) {
      const result = buildReconciliationGrantInput({
        preview,
        reason: 'manual reconciliation',
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        code: 'RECONCILIATION_PREVIEW_MALFORMED',
        message: 'Credit reconciliation preview is missing required grant fields.',
      });
      expect(result).not.toHaveProperty('mutationInput');
      expect(result).not.toHaveProperty('audit');
    }
  });
});
