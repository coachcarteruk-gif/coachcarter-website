// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  CALCULATION_VERSION,
  allocatePenceToUnitRange,
  calculateAuthoritativeLessonEarning,
  earningFromValueBasis,
  roundBasisPoints,
} = require('../api/_authoritative-lesson-earning');
const {
  buildPreviewFromRows,
  directEvidenceObservation,
  flexibleEvidenceObservation,
  payoutLinePersistenceProjection,
  recordDirectEvidenceObservation,
  validateAuditedFundingBasis,
} = require('../api/_interim-v1-payout');
const { fetchSessionFundingEvidence } = require('../api/_stripe-fee');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const instructor = {
  id: 6, school_id: 1, name: 'Simon', commission_rate: '0.9000',
  weekly_franchise_fee_pence: null, stripe_account_id: 'acct_live_simon',
  stripe_onboarding_complete: true, payouts_paused: true,
  payouts_start_date: '2026-08-14', control_id: 'control-simon',
  manual_settlement_boundary_id: 'boundary-simon',
  settled_before_at: '2026-09-04T11:00:00.000Z',
  first_system_period_end_at: '2026-09-11T11:00:00.000Z',
  manual_settlement_time_zone: 'Europe/London',
};

function baseRow(overrides = {}) {
  return {
    booking_id: 1, school_id: 1, instructor_id: 6,
    scheduled_date: '2026-09-04', booking_ends_at: '2026-09-04T12:00:00.000Z',
    settled_before_at: instructor.settled_before_at,
    first_system_period_end_at: instructor.first_system_period_end_at,
    status: 'chargeable', is_test_account: false, claimed_payout_id: null,
    duration_minutes: 60, flexible_sources: [],
    ...overrides,
  };
}

function directRow(overrides = {}) {
  const bookingId = Number(overrides.booking_id || 1);
  const gross = Number(overrides.gross_collected_pence || 5500);
  const fee = Number(overrides.stripe_fee_pence || (gross === 8250 ? 155 : 103));
  return baseRow({
    booking_id: bookingId,
    learner_id: 7, ct_learner_id: 7, ct_instructor_id: 6,
    evidence_id: `evidence-${bookingId}`, payment_origin: 'direct_slot', provider_livemode: true,
    stripe_checkout_session_id: `cs_live_${bookingId}`,
    stripe_payment_intent_id: `pi_live_${bookingId}`,
    stripe_payment_intent_status: 'succeeded', stripe_charge_id: `ch_live_${bookingId}`,
    stripe_charge_paid: true, stripe_charge_captured: true,
    stripe_charge_payment_intent_id: `pi_live_${bookingId}`,
    stripe_balance_transaction_id: `txn_live_${bookingId}`,
    stripe_balance_transaction_source_id: `ch_live_${bookingId}`,
    stripe_balance_transaction_type: 'charge', stripe_balance_transaction_amount_pence: gross,
    stripe_balance_transaction_currency: 'gbp', stripe_balance_transaction_status: 'available',
    stripe_payment_created_at: '2026-09-01T10:00:00.000Z',
    stripe_funds_available_at: '2026-09-03T10:00:00.000Z',
    gross_collected_pence: gross, stripe_fee_pence: fee, currency: 'gbp',
    evidence_status: 'complete', bcs_count: 1, bcs_contribution_pence: gross,
    bcs_stripe_fee_pence: fee, bcs_refunded_at: null, bcs_absorbed_by: null,
    ct_type: 'slot_purchase', ct_source: 'stripe', ct_payment_method: 'card',
    ct_amount_pence: gross, ct_stripe_fee_pence: fee,
    ct_session_id: `cs_live_${bookingId}`, ct_payment_intent_id: `pi_live_${bookingId}`,
    ...overrides,
  });
}

function auditedRow(bookingId, learnerName, finalPence, overrides = {}) {
  return baseRow({
    booking_id: bookingId, learner_name: learnerName,
    audited_basis_id: `basis-${bookingId}`, funding_class: 'legacy',
    value_semantics: 'final_instructor_payable', payment_processor: 'none',
    gross_pence: null, actual_processing_fee_pence: null, net_pence: null,
    final_instructor_payable_pence: finalPence,
    ...overrides,
  });
}

function exactPackageEvidence(gross, fee, suffix = 'package') {
  return {
    source: 'balance_transaction', providerLivemode: true,
    checkoutSessionId: `cs_${suffix}`, paymentIntentId: `pi_${suffix}`,
    paymentIntentStatus: 'succeeded', chargeId: `ch_${suffix}`,
    chargePaid: true, chargeCaptured: true, chargePaymentIntentId: `pi_${suffix}`,
    balanceTransactionId: `txn_${suffix}`, balanceTransactionSourceId: `ch_${suffix}`,
    balanceTransactionType: 'charge', balanceTransactionAmountPence: gross,
    balanceTransactionCurrency: 'gbp', balanceTransactionStatus: 'available',
    paymentCreatedAt: '2026-09-01T10:00:00.000Z',
    fundsAvailableAt: '2026-09-03T10:00:00.000Z',
    amountPence: gross, feePence: fee, currency: 'gbp',
  };
}

function exactPaymentObjectPackageEvidence(gross, fee, suffix = 'package-payment') {
  return {
    ...exactPackageEvidence(gross, fee, suffix),
    evidenceSchema: 'payout-flexible-source-evidence/2',
    paymentObjectType: 'payment',
    chargeId: `py_${suffix}`,
    balanceTransactionSourceId: `py_${suffix}`,
    balanceTransactionType: 'payment',
  };
}

function exactDirectFundingEvidence(bookingId, gross = 5500, fee = 103) {
  return {
    checkoutSessionId: `cs_live_${bookingId}`, paymentIntentId: `pi_live_${bookingId}`,
    paymentIntentStatus: 'succeeded', chargeId: `ch_live_${bookingId}`,
    chargePaid: true, chargeCaptured: true,
    chargePaymentIntentId: `pi_live_${bookingId}`,
    balanceTransactionId: `txn_live_${bookingId}`,
    balanceTransactionSourceId: `ch_live_${bookingId}`,
    balanceTransactionType: 'charge', balanceTransactionAmountPence: gross,
    balanceTransactionCurrency: 'gbp', balanceTransactionStatus: 'available',
    paymentCreatedAt: '2026-09-01T10:00:00.000Z',
    fundsAvailableAt: '2026-09-03T10:00:00.000Z',
    amountPence: gross, feePence: fee, currency: 'gbp',
  };
}

test.describe('authoritative lesson earning', () => {
  test('rounds (gross minus actual fee) times commission in integer pence', () => {
    expect(roundBasisPoints(5500 - 103, 9000)).toBe(4857);
    expect(calculateAuthoritativeLessonEarning(directRow(), instructor,
      new Date('2026-09-11T10:00:00Z'))).toMatchObject({
      eligible: true, gross_pence: 5500, stripe_fee_pence: 103,
      net_after_stripe_pence: 5397, instructor_amount_pence: 4857,
      calculation_version: CALCULATION_VERSION,
    });
  });

  test('missing and pending direct evidence block visibly and never become fee zero', () => {
    expect(calculateAuthoritativeLessonEarning(baseRow({ bcs_count: 1 }), instructor).reason)
      .toBe('EXACT_STRIPE_EVIDENCE_MISSING');
    expect(calculateAuthoritativeLessonEarning(directRow({ evidence_status: 'pending', stripe_fee_pence: null }), instructor).reason)
      .toBe('STRIPE_EVIDENCE_PENDING');
    const missingFee = directRow();
    missingFee.stripe_fee_pence = null;
    missingFee.ct_stripe_fee_pence = null;
    missingFee.bcs_stripe_fee_pence = null;
    expect(calculateAuthoritativeLessonEarning(missingFee, instructor).reason)
      .toBe('AMOUNT_EVIDENCE_INVALID');
    expect(earningFromValueBasis({
      value_semantics: 'gross_customer_revenue', payment_processor: 'none',
      gross_pence: 5500, actual_processing_fee_pence: null,
    }, 9000).reason).toBe('AUDITED_GROSS_BASIS_INVALID');
  });

  test('append-only direct observation deterministically supersedes provisional evidence', () => {
    const input = {
      schoolId: 1, instructorId: 6, learnerId: 7, bookingId: 8,
      creditTransactionId: 9, bookingCreditSourceId: 10,
      fundingEvidence: exactDirectFundingEvidence(8), providerLivemode: true,
    };
    const first = directEvidenceObservation(input);
    const second = directEvidenceObservation(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ evidence_status: 'complete' });
    const oldPending = directRow({
      booking_id: 8, evidence_id: 'old-pending', evidence_status: 'pending',
      stripe_charge_id: 'py_provisional',
      direct_observation_id: 'new-observation',
      direct_observation_status: 'complete', direct_observation_json: first.evidence_json,
    });
    const preview = buildPreviewFromRows(instructor, [oldPending], new Date('2026-09-11T10:00:00Z'));
    expect(preview.included).toHaveLength(1);
    expect(preview.included[0]).toMatchObject({
      funding_evidence_id: 'new-observation', instructor_amount_pence: 4857,
    });
  });

  test('direct reconciliation observation writer is idempotent and append-only', async () => {
    let terminal = null;
    const sql = async (strings) => {
      const query = strings.join('?');
      if (query.includes('SELECT bcs.id AS booking_credit_source_id')) {
        return [{ booking_credit_source_id: 10, credit_transaction_id: 9,
          stripe_session_id: 'cs_live_8', stripe_payment_intent_id: 'pi_live_8' }];
      }
      if (query.includes("evidence_status IN ('complete','contradictory')")) {
        return terminal ? [terminal] : [];
      }
      if (query.includes('evidence_fingerprint =')) return [];
      if (query.includes('INSERT INTO payout_direct_evidence_observations')) {
        const observation = directEvidenceObservation({
          schoolId: 1, instructorId: 6, learnerId: 7, bookingId: 8,
          creditTransactionId: 9, bookingCreditSourceId: 10,
          fundingEvidence: exactDirectFundingEvidence(8), providerLivemode: true,
        });
        terminal = { id: 'observation-1', evidence_status: observation.evidence_status,
          evidence_fingerprint: observation.evidence_fingerprint };
        return [terminal];
      }
      throw new Error(`Unexpected query: ${query}`);
    };
    const input = {
      schoolId: 1, instructorId: 6, learnerId: 7, bookingId: 8,
      creditTransactionId: 9, bookingCreditSourceId: 10,
      fundingEvidence: exactDirectFundingEvidence(8), providerLivemode: true, adminId: 1,
    };
    await expect(recordDirectEvidenceObservation(sql, input)).resolves.toMatchObject({
      recorded: true, reused: false, id: 'observation-1', evidence_status: 'complete',
    });
    await expect(recordDirectEvidenceObservation(sql, input)).resolves.toMatchObject({
      recorded: false, reused: true, id: 'observation-1', evidence_status: 'complete',
    });
  });

  test('controlled reconciliation never lists Charges when the exact PaymentIntent lacks a ch_ identity', async () => {
    let listCalls = 0;
    const stripeClient = {
      paymentIntents: {
        retrieve: async () => ({
          id: 'pi_exact_only', object: 'payment_intent', status: 'succeeded',
          amount_received: 5500, currency: 'gbp', latest_charge: {
            id: 'py_not_a_charge', object: 'payment', paid: true, captured: true,
            payment_intent: 'pi_exact_only', balance_transaction: null,
          },
        }),
      },
      charges: {
        list: async () => {
          listCalls += 1;
          return { data: [{ id: 'ch_heuristic_match' }] };
        },
      },
    };
    const evidence = await fetchSessionFundingEvidence(
      { id: 'pi_exact_only', object: 'payment_intent' },
      stripeClient,
      { allowChargeListLookup: false, includePaymentObjectType: true }
    );
    expect(listCalls).toBe(0);
    expect(evidence).toMatchObject({
      paymentIntentId: 'pi_exact_only', paymentObjectType: 'payment', chargeId: 'py_not_a_charge',
      balanceTransactionId: null, feePence: null, source: null,
    });
    expect(read('api/_interim-v1-payout.js')).toContain('allowChargeListLookup: false');
  });

  test('allocates one package gross and fee exactly once across immutable units', () => {
    const gross = Array.from({ length: 30 }, (_, unit) => allocatePenceToUnitRange(81000, 30, unit, 1));
    const fees = Array.from({ length: 30 }, (_, unit) => allocatePenceToUnitRange(421, 30, unit, 1));
    expect(gross.reduce((sum, value) => sum + value, 0)).toBe(81000);
    expect(fees.reduce((sum, value) => sum + value, 0)).toBe(421);
    expect(new Set(fees)).toEqual(new Set([14, 15]));
  });

  test('uses package allocation value rather than a stale booking list price', () => {
    const row = baseRow({
      duration_minutes: 60, list_price_pence: 8100,
      flexible_sources: [{
        allocation_id: 10, source_id: 20, units_allocated: 2, unit_minutes: 30,
        preceding_active_units: 0, initial_units: 30, contribution_pence: 5400,
        original_value_pence: 81000, legacy_conversion: null,
        source_evidence_id: 'package-evidence', evidence_status: 'complete',
        evidence_json: exactPackageEvidence(81000, 420),
      }],
    });
    expect(calculateAuthoritativeLessonEarning(row, instructor)).toMatchObject({
      eligible: true, gross_pence: 5400, stripe_fee_pence: 28,
      instructor_amount_pence: 4835, reason: 'EXACT_FLEXIBLE_PACKAGE_ALLOCATION',
    });
  });

  test('accepts only versioned exact py_/payment package evidence', () => {
    const evidence = exactPaymentObjectPackageEvidence(81000, 425);
    const flexibleSource = {
      allocation_id: 10, source_id: 3, units_allocated: 2, unit_minutes: 30,
      preceding_active_units: 0, initial_units: 30, contribution_pence: 5400,
      original_value_pence: 81000, legacy_conversion: null,
      source_evidence_id: 'package-payment-evidence', evidence_status: 'complete',
      evidence_json: evidence,
    };
    expect(calculateAuthoritativeLessonEarning(baseRow({
      duration_minutes: 60, flexible_sources: [flexibleSource],
    }), instructor)).toMatchObject({
      eligible: true, gross_pence: 5400, stripe_fee_pence: 30,
      instructor_amount_pence: 4833, reason: 'EXACT_FLEXIBLE_PACKAGE_ALLOCATION',
    });
    for (const invalidEvidence of [
      { ...evidence, evidenceSchema: undefined },
      { ...evidence, paymentObjectType: 'charge' },
      { ...evidence, balanceTransactionType: 'charge' },
      { ...evidence, balanceTransactionSourceId: 'py_other' },
    ]) {
      expect(calculateAuthoritativeLessonEarning(baseRow({
        duration_minutes: 60,
        flexible_sources: [{ ...flexibleSource, evidence_json: invalidEvidence }],
      }), instructor).reason).toBe('FLEXIBLE_SOURCE_EVIDENCE_INVALID');
    }
    expect(flexibleEvidenceObservation({
      schoolId: 1, sourceId: 3, fundingEvidence: evidence,
      providerLivemode: true, allowPaymentObjectEvidence: true,
    }).evidence_status).toBe('complete');
  });

  test('requires an audited classification for legacy and applies commission at most once', () => {
    expect(calculateAuthoritativeLessonEarning(baseRow({ flexible_sources: [{
      allocation_id: 1, source_id: 1, units_allocated: 2, unit_minutes: 30,
      preceding_active_units: 0, initial_units: 20, contribution_pence: 4700,
      original_value_pence: 47000, legacy_conversion: { request_id: 'legacy' },
    }] }), instructor).reason).toBe('LEGACY_VALUE_CLASSIFICATION_REQUIRED');
    expect(earningFromValueBasis({
      value_semantics: 'final_instructor_payable', final_instructor_payable_pence: 7050,
    }, 9000)).toMatchObject({ instructor_amount_pence: 7050, commission_already_applied: true });
    expect(earningFromValueBasis({ value_semantics: 'net_after_processing', net_pence: 7050 }, 9000))
      .toMatchObject({ instructor_amount_pence: 6345 });
  });

  test('persists gross, net and final evidence without inventing unknown fee facts', () => {
    const gross = payoutLinePersistenceProjection({
      value_semantics: 'gross_customer_revenue', gross_pence: 5500,
      stripe_fee_pence: 103, net_after_stripe_pence: 5397,
      instructor_amount_pence: 4857, commission_rate: 0.9,
    });
    expect(gross).toMatchObject({
      price_pence: 5500, stripe_fee_pence: 103,
      attributable_gross_pence: 5500, actual_processing_fee_pence: 103,
      net_attributable_revenue_pence: 5397, commission_rate: 0.9,
    });
    const net = payoutLinePersistenceProjection({
      value_semantics: 'net_after_processing', gross_pence: null,
      stripe_fee_pence: null, net_after_stripe_pence: 5220,
      instructor_amount_pence: 4698, commission_rate: 0.9,
    });
    expect(net).toMatchObject({
      price_pence: 5220, stripe_fee_pence: 0,
      attributable_gross_pence: null, actual_processing_fee_pence: null,
      net_attributable_revenue_pence: 5220, commission_rate: 0.9,
    });
    const finalAmount = payoutLinePersistenceProjection({
      value_semantics: 'final_instructor_payable', gross_pence: null,
      stripe_fee_pence: null, net_after_stripe_pence: null,
      instructor_amount_pence: 4700, commission_rate: 1,
    });
    expect(finalAmount).toMatchObject({
      price_pence: 4700, stripe_fee_pence: 0,
      attributable_gross_pence: null, actual_processing_fee_pence: null,
      net_attributable_revenue_pence: null, commission_rate: 1,
    });
  });

  test('cash/manual gross basis has no invented Stripe fee', () => {
    expect(earningFromValueBasis({
      value_semantics: 'gross_customer_revenue', payment_processor: 'none',
      gross_pence: 5500, actual_processing_fee_pence: 0,
    }, 9000)).toMatchObject({ instructor_amount_pence: 4950, processing_fee_pence: 0 });
    expect(earningFromValueBasis({
      value_semantics: 'gross_customer_revenue', payment_processor: 'stripe',
      gross_pence: 5500, actual_processing_fee_pence: 0,
    }, 9000).reason).toBe('ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING');
    expect(validateAuditedFundingBasis({
      funding_class: 'external', value_semantics: 'gross_customer_revenue',
      payment_processor: 'external', gross_pence: 5500,
      actual_processing_fee_pence: 50,
      evidence_reference: 'bank-statement:line-1', reason: 'Reviewed external receipt',
    })).toMatchObject({ ok: false, code: 'ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING' });
  });

  test('enforces Friday-noon half-open boundaries, chargeable state, claims, and school scope', () => {
    expect(calculateAuthoritativeLessonEarning(directRow({ booking_ends_at: '2026-09-04T10:59:59.999Z' }), instructor).reason)
      .toBe('MANUALLY_SETTLED_BEFORE_CUTOFF');
    expect(calculateAuthoritativeLessonEarning(directRow({ booking_ends_at: '2026-09-04T11:00:00.000Z' }), instructor).eligible).toBe(true);
    expect(calculateAuthoritativeLessonEarning(directRow({ booking_ends_at: '2026-09-11T11:00:00.000Z' }), instructor).reason)
      .toBe('AFTER_FIRST_SYSTEM_PERIOD');
    expect(calculateAuthoritativeLessonEarning(directRow({ status: 'refunded' }), instructor).reason)
      .toBe('BOOKING_NOT_CHARGEABLE');
    expect(calculateAuthoritativeLessonEarning(directRow({ claimed_payout_id: 9 }), instructor).reason)
      .toBe('ALREADY_CLAIMED');
    expect(calculateAuthoritativeLessonEarning(directRow({ school_id: 2 }), instructor).reason)
      .toBe('PAYOUT_SCOPE_MISMATCH');
  });

  test('blocks a Viba-style duration edit with excess package units', () => {
    const result = calculateAuthoritativeLessonEarning(baseRow({
      duration_minutes: 60,
      flexible_sources: [{
        allocation_id: 10, source_id: 20, units_allocated: 3, unit_minutes: 30,
        preceding_active_units: 0, initial_units: 30, contribution_pence: 8100,
        original_value_pence: 81000, legacy_conversion: null,
        evidence_status: 'complete', evidence_json: exactPackageEvidence(81000, 420),
      }],
    }), instructor);
    expect(result).toMatchObject({ eligible: false, reason: 'FLEXIBLE_ALLOCATION_DURATION_MISMATCH' });
  });

  test('reproduces the reviewed 22-lesson £1,131.02 statement from evidence', () => {
    let id = 0;
    const at = (date, row) => ({ ...row, scheduled_date: date, booking_ends_at: `${date}T15:00:00.000Z` });
    const direct = (date, name, gross = 5500, fee = gross === 8250 ? 155 : 103, duration = 60) =>
      at(date, directRow({ booking_id: ++id, learner_name: name, duration_minutes: duration,
        gross_collected_pence: gross, stripe_fee_pence: fee }));
    const final = (date, name, amount) => at(date, auditedRow(++id, name, amount));
    const viba = () => at('2026-09-10', baseRow({
      booking_id: ++id, learner_name: 'Viba', duration_minutes: 60,
      flexible_sources: [{ allocation_id: 10, source_id: 20, units_allocated: 2,
        unit_minutes: 30, preceding_active_units: 0, initial_units: 30,
        contribution_pence: 5400, original_value_pence: 81000, legacy_conversion: null,
        source_evidence_id: 'package-evidence', evidence_status: 'complete',
        evidence_json: exactPackageEvidence(81000, 420) }],
    }));
    const rows = [
      final('2026-09-04', 'Laura', 4950), direct('2026-09-04', 'Emilie Bishop'), direct('2026-09-04', 'Jaimie-Lea'),
      final('2026-09-05', 'Giovanni', 4677),
      direct('2026-09-07', 'Jasmine'), direct('2026-09-07', 'Daniela'), final('2026-09-07', 'Laura', 4950),
      direct('2026-09-07', 'Maria'), final('2026-09-07', 'Giovanni', 4677),
      direct('2026-09-08', 'Jasmine'), direct('2026-09-08', 'Louisa'),
      direct('2026-09-09', 'Shannon'), final('2026-09-09', 'Lily', 4700), direct('2026-09-09', 'Jasmine'),
      final('2026-09-09', 'Esha', 7016), direct('2026-09-09', 'Maria'),
      viba(), direct('2026-09-10', 'Shannon', 8250, 155, 90), direct('2026-09-10', 'Jasmine'),
      final('2026-09-10', 'Lily', 7050), direct('2026-09-10', 'Louisa'),
      final('2026-09-10', 'Giovanni', 4677),
    ];
    const preview = buildPreviewFromRows(instructor, rows, new Date('2026-09-11T10:00:00Z'));
    expect(preview.included).toHaveLength(22);
    expect(preview.excluded).toHaveLength(0);
    expect(preview.totals.proposed_transfer_pence).toBe(113102);
    expect(preview.ready_for_approval).toBe(true);
    const dateTotals = Object.fromEntries(Object.entries(preview.included.reduce((totals, line) => {
      totals[line.scheduled_date] = (totals[line.scheduled_date] || 0) + line.instructor_amount_pence;
      return totals;
    }, {})).sort());
    expect(dateTotals).toEqual({
      '2026-09-04': 14664,
      '2026-09-05': 4677,
      '2026-09-07': 24198,
      '2026-09-08': 9714,
      '2026-09-09': 26287,
      '2026-09-10': 33562,
    });
    expect(preview.included.map(line => [
      line.scheduled_date, line.learner_name, line.instructor_amount_pence,
    ])).toEqual([
      ['2026-09-04', 'Laura', 4950], ['2026-09-04', 'Emilie Bishop', 4857],
      ['2026-09-04', 'Jaimie-Lea', 4857], ['2026-09-05', 'Giovanni', 4677],
      ['2026-09-07', 'Jasmine', 4857], ['2026-09-07', 'Daniela', 4857],
      ['2026-09-07', 'Laura', 4950], ['2026-09-07', 'Maria', 4857],
      ['2026-09-07', 'Giovanni', 4677], ['2026-09-08', 'Jasmine', 4857],
      ['2026-09-08', 'Louisa', 4857], ['2026-09-09', 'Shannon', 4857],
      ['2026-09-09', 'Lily', 4700], ['2026-09-09', 'Jasmine', 4857],
      ['2026-09-09', 'Esha', 7016], ['2026-09-09', 'Maria', 4857],
      ['2026-09-10', 'Viba', 4835], ['2026-09-10', 'Shannon', 7286],
      ['2026-09-10', 'Jasmine', 4857], ['2026-09-10', 'Lily', 7050],
      ['2026-09-10', 'Louisa', 4857], ['2026-09-10', 'Giovanni', 4677],
    ]);
  });

  test('all Simon payout read models and the processor consume one preview authority', () => {
    const instructorApi = read('api/instructor.js');
    const adminApi = read('api/admin.js');
    const interim = read('api/_interim-v1-payout.js');
    expect(instructorApi.match(/loadInterimV1Preview\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(adminApi).toContain('loadInterimV1Preview(sql, schoolId, inst.id)');
    expect(interim).toContain('const lockedPreview = await loadInterimV1Preview(txSql, schoolId, instructorId)');
    expect(interim).toContain('calculateAuthoritativeLessonEarning');
  });

  test('future duration edits and instructor reschedules preserve flexible units', () => {
    const source = read('api/instructor.js');
    expect(source).toContain("code: 'FLEXIBLE_DURATION_EDIT_REQUIRES_REBOOKING'");
    expect(source).toContain('moveFlexiblePackageBookingAllocations(client, {');
    expect(source).toContain("'FLEXIBLE_RESCHEDULE_VALUE_CONTRADICTION'");
    expect(source).toContain('JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = lb.school_id');
    expect(source).toContain('JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = lb.school_id');
    expect(source).toContain('LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND lt.school_id = lb.school_id');
    expect(source).toMatch(/FROM payout_line_items\s+WHERE booking_id = \$\{booking_id\}\s+AND school_id = \$\{schoolId\}/);
  });
});
