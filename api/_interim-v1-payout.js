'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAuditRequired } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');
const { classifyStripeError } = require('./_stripe-clients');
const { fetchSessionFundingEvidence } = require('./_stripe-fee');
const {
  CALCULATION_VERSION,
  calculateAuthoritativeLessonEarning,
} = require('./_authoritative-lesson-earning');

const ACTIONS = new Set([
  'interim-v1-payout-preview',
  'interim-v1-reconcile-funding-evidence',
  'interim-v1-record-funding-basis',
  'interim-v1-record-manual-settlement-boundary',
  'interim-v1-approve-first-run',
  'interim-v1-process-approved-payout',
  'interim-v1-reconcile-transfer',
]);
const MANUAL_BOUNDARY_CONFIRMATION = 'RECORD_INTERIM_V1_MANUAL_SETTLEMENT_BOUNDARY_CONFIRMED';
const APPROVE_CONFIRMATION = 'APPROVE_INTERIM_V1_FIRST_RUN_CONFIRMED';
const PROCESS_CONFIRMATION = 'PROCESS_INTERIM_V1_APPROVED_PAYOUT_CONFIRMED';
const RECONCILE_CONFIRMATION = 'RECONCILE_INTERIM_V1_TRANSFER_CONFIRMED';
const RECONCILE_FUNDING_CONFIRMATION = 'RECONCILE_INTERIM_V1_FUNDING_EVIDENCE_CONFIRMED';
const RECORD_FUNDING_BASIS_CONFIRMATION = 'RECORD_INTERIM_V1_FUNDING_BASIS_CONFIRMED';
const PLANNER_VERSION = 'interim-v1-payout/3';

class InterimV1PayoutError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'InterimV1PayoutError';
    this.status = status;
    this.code = code;
  }
}

function interimV1PayoutFailureResponse(error) {
  if (error instanceof InterimV1PayoutError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error?.code === '42501') {
    return {
      status: 503,
      code: 'INTERIM_V1_DATABASE_PERMISSION_REQUIRED',
      message: 'Interim v1 payout review is temporarily unavailable while database access is repaired',
    };
  }
  return {
    status: 500,
    code: error?.code || 'INTERIM_V1_PAYOUT_FAILED',
    message: 'Interim v1 payout operation failed',
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function instantIso(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateManualBoundaryDates(settledBeforeLocalDate, firstSystemPeriodEndLocalDate) {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    return utc;
  };
  const settled = parse(settledBeforeLocalDate);
  const periodEnd = parse(firstSystemPeriodEndLocalDate);
  if (!settled || !periodEnd) return { ok: false, code: 'INVALID_MANUAL_SETTLEMENT_DATES' };
  if (settled.getUTCDay() !== 5 || periodEnd.getUTCDay() !== 5) {
    return { ok: false, code: 'MANUAL_SETTLEMENT_BOUNDARIES_MUST_BE_FRIDAYS' };
  }
  if (periodEnd.getTime() - settled.getTime() !== 7 * 24 * 60 * 60 * 1000) {
    return { ok: false, code: 'MANUAL_SETTLEMENT_PERIOD_MUST_BE_SEVEN_DAYS' };
  }
  return {
    ok: true,
    settled_before_local_date: dateOnly(settledBeforeLocalDate),
    first_system_period_end_local_date: dateOnly(firstSystemPeriodEndLocalDate),
  };
}

function exactId(value, prefix) {
  return typeof value === 'string' && value.startsWith(`${prefix}_`) ? value : null;
}

function classifyFundingRow(row, now = new Date()) {
  const startDate = dateOnly(row.payouts_start_date);
  const bookingDate = dateOnly(row.scheduled_date);
  const paymentDate = dateOnly(row.stripe_payment_created_at);
  const reject = (reason) => ({ eligible: false, reason });

  if (row.status !== 'chargeable') return reject('BOOKING_NOT_CHARGEABLE');
  if (row.is_test_account === true) return reject('TEST_ACCOUNT');
  if (!startDate) return reject('START_DATE_MISSING');
  if (!bookingDate || bookingDate < startDate) return reject('BOOKING_BEFORE_START');
  const settledBeforeAt = instantIso(row.settled_before_at);
  const firstSystemPeriodEndAt = instantIso(row.first_system_period_end_at);
  const bookingEndsAt = instantIso(row.booking_ends_at);
  if (!settledBeforeAt || !firstSystemPeriodEndAt) return reject('MANUAL_SETTLEMENT_BOUNDARY_MISSING');
  if (!bookingEndsAt) return reject('BOOKING_END_INSTANT_MISSING');
  if (bookingEndsAt < settledBeforeAt) return reject('MANUALLY_SETTLED_BEFORE_CUTOFF');
  if (bookingEndsAt >= firstSystemPeriodEndAt) return reject('AFTER_FIRST_SYSTEM_PERIOD');
  if (!row.evidence_id) {
    if (row.bcs_count === 0) return reject('NO_FUNDING_SOURCE');
    if (row.ct_source !== 'stripe' || row.ct_payment_method !== 'card') return reject('EXTERNAL_OR_CREDIT_SOURCE');
    return reject('EXACT_STRIPE_EVIDENCE_MISSING');
  }
  if (row.provider_livemode !== true) return reject('TEST_MODE_STRIPE_SOURCE');
  if (row.evidence_status === 'pending') return reject('STRIPE_EVIDENCE_PENDING');
  if (row.evidence_status === 'contradictory') return reject('STRIPE_EVIDENCE_CONTRADICTORY');
  if (row.evidence_status !== 'complete') return reject('STRIPE_EVIDENCE_INCOMPLETE');
  if (row.payment_origin !== 'direct_slot') return reject('UNAPPROVED_PAYMENT_ORIGIN');
  if (!paymentDate || paymentDate < startDate) return reject('PAYMENT_BEFORE_START');
  if (!row.stripe_funds_available_at || new Date(row.stripe_funds_available_at) > now) return reject('FUNDS_NOT_AVAILABLE');
  if (Number(row.bcs_count) !== 1) return reject('FUNDING_SOURCE_NOT_ONE_TO_ONE');
  if (row.bcs_refunded_at) return reject('FUNDING_SOURCE_REFUNDED');
  if (row.bcs_absorbed_by === 'instructor') return reject('INSTRUCTOR_ABSORBED_REFUND');
  if (row.ct_type !== 'slot_purchase' || row.ct_source !== 'stripe' || row.ct_payment_method !== 'card') {
    return reject('UNAPPROVED_LEDGER_SOURCE');
  }
  const sessionId = exactId(row.stripe_checkout_session_id, 'cs');
  const paymentIntentId = exactId(row.stripe_payment_intent_id, 'pi');
  const chargeId = exactId(row.stripe_charge_id, 'ch');
  const balanceTransactionId = exactId(row.stripe_balance_transaction_id, 'txn');
  if (!sessionId || !paymentIntentId || !chargeId || !balanceTransactionId) return reject('STRIPE_IDENTITY_INCOMPLETE');
  if (row.stripe_payment_intent_status !== 'succeeded' || row.stripe_charge_paid !== true
    || row.stripe_charge_captured !== true || row.stripe_charge_payment_intent_id !== paymentIntentId
    || row.stripe_balance_transaction_source_id !== chargeId
    || row.stripe_balance_transaction_type !== 'charge'
    || !['available', 'pending'].includes(row.stripe_balance_transaction_status)) {
    return reject('STRIPE_PAYMENT_CHAIN_MISMATCH');
  }
  if (row.ct_session_id !== sessionId || row.ct_payment_intent_id !== paymentIntentId) return reject('LEDGER_IDENTITY_MISMATCH');
  const gross = Number(row.gross_collected_pence);
  const fee = Number(row.stripe_fee_pence);
  if (!Number.isSafeInteger(gross) || gross <= 0 || !Number.isSafeInteger(fee) || fee < 0 || fee > gross) {
    return reject('AMOUNT_EVIDENCE_INVALID');
  }
  if (row.currency !== 'gbp') return reject('CURRENCY_NOT_GBP');
  if (Number(row.stripe_balance_transaction_amount_pence) !== gross
    || row.stripe_balance_transaction_currency !== 'gbp') return reject('BALANCE_TRANSACTION_MISMATCH');
  if (Number(row.ct_amount_pence) !== gross || Number(row.bcs_contribution_pence) !== gross) return reject('GROSS_MISMATCH');
  if (Number(row.ct_stripe_fee_pence) !== fee || Number(row.bcs_stripe_fee_pence) !== fee) return reject('FEE_MISMATCH');
  if (row.claimed_payout_id) return reject('ALREADY_CLAIMED');

  return {
    eligible: true,
    reason: 'EXACT_DIRECT_SLOT_STRIPE',
    gross_pence: gross,
    stripe_fee_pence: fee,
    net_after_stripe_pence: gross - fee,
  };
}

function allocateInstructorAmounts(included, instructor) {
  const franchiseFee = instructor.weekly_franchise_fee_pence == null
    ? null : Number(instructor.weekly_franchise_fee_pence);
  const configuredRate = Number(instructor.commission_rate);
  const commissionRate = Number.isFinite(configuredRate) ? configuredRate : 0.85;
  const lines = included.map((line) => ({ ...line }));
  const grossKnown = lines.every((line) => Number.isSafeInteger(line.gross_pence));
  const feesKnown = lines.every((line) => Number.isSafeInteger(line.stripe_fee_pence));
  const gross = grossKnown ? lines.reduce((sum, line) => sum + line.gross_pence, 0) : null;
  const fees = feesKnown ? lines.reduce((sum, line) => sum + line.stripe_fee_pence, 0) : null;
  let proposed;
  if (franchiseFee != null) {
    if (!grossKnown || !feesKnown) {
      return {
        lines, gross_pence: gross, stripe_fees_pence: fees,
        weekly_franchise_fee_pence: franchiseFee, commission_rate: null,
        proposed_transfer_pence: null, insufficient_week: false,
        unresolved_total_basis: true,
      };
    }
    proposed = Math.max(0, gross - fees - franchiseFee);
    let remainingDeduction = Math.min(franchiseFee, gross - fees);
    for (const line of lines) {
      const net = line.net_after_stripe_pence;
      const deduction = Math.min(net, remainingDeduction);
      line.instructor_amount_pence = net - deduction;
      line.commission_rate = net > 0 ? line.instructor_amount_pence / net : 0;
      remainingDeduction -= deduction;
    }
  } else {
    for (const line of lines) {
      if (!Number.isSafeInteger(line.instructor_amount_pence)) {
        line.instructor_amount_pence = Math.max(
          0,
          Math.round(line.net_after_stripe_pence * commissionRate)
        );
      }
      line.commission_rate = line.commission_already_applied === true ? 1 : commissionRate;
    }
    proposed = lines.reduce((sum, line) => sum + line.instructor_amount_pence, 0);
  }
  return {
    lines,
    gross_pence: gross,
    stripe_fees_pence: fees,
    weekly_franchise_fee_pence: franchiseFee,
    commission_rate: franchiseFee == null ? commissionRate : null,
    proposed_transfer_pence: proposed,
    insufficient_week: proposed <= 0,
    unresolved_total_basis: false,
  };
}

function buildPreviewFromRows(instructor, rows, now = new Date()) {
  const included = [];
  const excluded = [];
  for (const row of rows) {
    const directObservation = row.direct_observation_status
      && row.direct_observation_json && typeof row.direct_observation_json === 'object'
      ? {
        ...row.direct_observation_json,
        evidence_id: row.direct_observation_id,
        evidence_status: row.direct_observation_status,
      }
      : {};
    const authoritativeRow = {
      ...row,
      ...directObservation,
      school_id: row.school_id ?? instructor.school_id,
      instructor_id: row.instructor_id ?? instructor.id,
    };
    const classification = calculateAuthoritativeLessonEarning(authoritativeRow, instructor, now);
    const identity = {
      booking_id: Number(row.booking_id),
      scheduled_date: dateOnly(row.scheduled_date),
      booking_ends_at: instantIso(row.booking_ends_at),
      learner_name: row.learner_name || null,
      checkout_session_id: authoritativeRow.stripe_checkout_session_id || null,
      payment_intent_id: authoritativeRow.stripe_payment_intent_id || null,
      charge_id: authoritativeRow.stripe_charge_id || null,
      balance_transaction_id: authoritativeRow.stripe_balance_transaction_id || null,
      funding_evidence_id: directObservation.evidence_id || row.evidence_id || null,
      audited_funding_basis_id: row.audited_basis_id || null,
    };
    if (classification.eligible) included.push({ ...identity, ...classification });
    else excluded.push({ ...identity, reason: classification.reason });
  }
  included.sort((a, b) => a.booking_id - b.booking_id);
  excluded.sort((a, b) => a.booking_id - b.booking_id);
  const totals = allocateInstructorAmounts(included, instructor);
  const blockers = [];
  if (!instructor.control_id) blockers.push('INTERIM_V1_CONTROL_MISSING');
  if (!instructor.stripe_account_id) blockers.push('CONNECT_ACCOUNT_MISSING');
  if (instructor.stripe_onboarding_complete !== true) blockers.push('CONNECT_ONBOARDING_INCOMPLETE');
  if (instructor.payouts_paused !== true) blockers.push('PAUSE_GUARD_NOT_SET');
  if (!instructor.payouts_start_date) blockers.push('START_DATE_MISSING');
  if (!instructor.manual_settlement_boundary_id) blockers.push('MANUAL_SETTLEMENT_BOUNDARY_MISSING');
  const unresolved = excluded.filter((line) => ![
    'MANUALLY_SETTLED_BEFORE_CUTOFF', 'AFTER_FIRST_SYSTEM_PERIOD',
    'TEST_ACCOUNT', 'ALREADY_CLAIMED',
  ].includes(line.reason));
  if (unresolved.length) blockers.push('UNRECONCILED_PAYABLE_LESSONS');
  if (totals.unresolved_total_basis) blockers.push('FRANCHISE_TOTAL_BASIS_UNAVAILABLE');
  if (!included.length) blockers.push('NO_ELIGIBLE_LESSONS');
  if (totals.insufficient_week) blockers.push('INSUFFICIENT_WEEK_MANUAL_HANDLING');
  const canonical = {
    planner_version: PLANNER_VERSION,
    school_id: Number(instructor.school_id),
    instructor_id: Number(instructor.id),
    payouts_start_date: dateOnly(instructor.payouts_start_date),
    manual_settlement_boundary: instructor.manual_settlement_boundary_id ? {
      settled_before_at: instantIso(instructor.settled_before_at),
      first_system_period_end_at: instantIso(instructor.first_system_period_end_at),
      time_zone: instructor.manual_settlement_time_zone,
    } : null,
    stripe_account_id: instructor.stripe_account_id || null,
    weekly_franchise_fee_pence: totals.weekly_franchise_fee_pence,
    commission_rate: totals.commission_rate,
    included: totals.lines.map((line) => ({
      booking_id: line.booking_id,
      scheduled_date: line.scheduled_date,
      booking_ends_at: line.booking_ends_at,
      funding_evidence_id: line.funding_evidence_id,
      checkout_session_id: line.checkout_session_id,
      payment_intent_id: line.payment_intent_id,
      charge_id: line.charge_id,
      balance_transaction_id: line.balance_transaction_id,
      gross_pence: line.gross_pence,
      stripe_fee_pence: line.stripe_fee_pence,
      instructor_amount_pence: line.instructor_amount_pence,
      value_semantics: line.value_semantics,
      calculation_version: line.calculation_version,
      funding_lines: line.funding_lines,
    })),
    excluded: excluded.map((line) => ({ booking_id: line.booking_id, reason: line.reason })),
    proposed_transfer_pence: totals.proposed_transfer_pence,
    blockers,
  };
  return {
    planner_version: PLANNER_VERSION,
    lesson_calculation_version: CALCULATION_VERSION,
    instructor: {
      id: Number(instructor.id), name: instructor.name, school_id: Number(instructor.school_id),
      payouts_start_date: dateOnly(instructor.payouts_start_date), payouts_paused: instructor.payouts_paused,
      stripe_account_id: instructor.stripe_account_id || null,
      stripe_onboarding_complete: instructor.stripe_onboarding_complete === true,
    },
    manual_settlement_boundary: instructor.manual_settlement_boundary_id ? {
      id: instructor.manual_settlement_boundary_id,
      settled_before_at: instantIso(instructor.settled_before_at),
      first_system_period_end_at: instantIso(instructor.first_system_period_end_at),
      time_zone: instructor.manual_settlement_time_zone,
      reason: instructor.manual_settlement_reason,
      evidence_reference: instructor.manual_settlement_evidence_reference,
      created_at: instantIso(instructor.manual_settlement_created_at),
    } : null,
    included: totals.lines,
    excluded,
    totals: {
      gross_pence: totals.gross_pence,
      stripe_fees_pence: totals.stripe_fees_pence,
      weekly_franchise_fee_pence: totals.weekly_franchise_fee_pence,
      commission_rate: totals.commission_rate,
      proposed_transfer_pence: totals.proposed_transfer_pence,
    },
    blockers,
    ready_for_approval: blockers.length === 0,
    preview_fingerprint: fingerprint(canonical),
  };
}

async function loadInterimV1Preview(sql, schoolId, instructorId, now = new Date()) {
  const [instructor] = await sql`
    SELECT i.id, i.school_id, i.name, i.commission_rate, i.weekly_franchise_fee_pence,
           i.stripe_account_id, i.stripe_onboarding_complete, i.payouts_paused,
           i.payouts_start_date, c.id AS control_id,
           mb.id AS manual_settlement_boundary_id, mb.settled_before_at,
           mb.first_system_period_end_at, mb.time_zone AS manual_settlement_time_zone,
           mb.reason AS manual_settlement_reason,
           mb.evidence_reference AS manual_settlement_evidence_reference,
           mb.created_at AS manual_settlement_created_at
      FROM instructors i
      LEFT JOIN interim_v1_instructor_controls c
        ON c.school_id = i.school_id AND c.instructor_id = i.id
      LEFT JOIN interim_v1_manual_settlement_boundaries mb
        ON mb.school_id = i.school_id AND mb.instructor_id = i.id
     WHERE i.id = ${instructorId} AND i.school_id = ${schoolId}
     LIMIT 1
  `;
  if (!instructor) throw new InterimV1PayoutError(404, 'NOT_FOUND', 'Instructor not found');
  const rows = await sql`
    SELECT lb.id AS booking_id, lb.school_id, lb.instructor_id, lb.learner_id,
           lb.scheduled_date, lb.status, lu.name AS learner_name,
           ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London') AS booking_ends_at,
           ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int AS duration_minutes,
           COALESCE(lu.is_test_account, FALSE) AS is_test_account,
           c.payouts_start_date, mb.settled_before_at, mb.first_system_period_end_at,
           e.id AS evidence_id, e.payment_origin,
           e.provider_livemode, e.stripe_checkout_session_id, e.stripe_payment_intent_id,
           e.stripe_payment_intent_status, e.stripe_charge_id, e.stripe_charge_paid,
           e.stripe_charge_captured, e.stripe_charge_payment_intent_id,
           e.stripe_balance_transaction_id, e.stripe_balance_transaction_source_id,
           e.stripe_balance_transaction_type, e.stripe_balance_transaction_amount_pence,
           e.stripe_balance_transaction_currency, e.stripe_balance_transaction_status,
           e.stripe_payment_created_at, e.stripe_funds_available_at,
           e.gross_collected_pence, e.stripe_fee_pence, e.currency, e.evidence_status,
           direct_observation.id AS direct_observation_id,
           direct_observation.evidence_status AS direct_observation_status,
           direct_observation.evidence_json AS direct_observation_json,
           bcs.id AS bcs_id, bcs.contribution_pence AS bcs_contribution_pence,
           bcs.stripe_fee_pence AS bcs_stripe_fee_pence, bcs.refunded_at AS bcs_refunded_at,
           bcs.absorbed_by AS bcs_absorbed_by, source_counts.bcs_count,
           ct.type AS ct_type, ct.source AS ct_source, ct.payment_method AS ct_payment_method,
           ct.amount_pence AS ct_amount_pence, ct.stripe_fee_pence AS ct_stripe_fee_pence,
           ct.stripe_session_id AS ct_session_id, ct.stripe_payment_intent_id AS ct_payment_intent_id,
           ct.instructor_id AS ct_instructor_id, ct.learner_id AS ct_learner_id,
           pli.payout_id AS claimed_payout_id,
           basis.id AS audited_basis_id, basis.funding_class, basis.value_semantics,
           basis.payment_processor, basis.gross_pence, basis.actual_processing_fee_pence,
           basis.net_pence, basis.final_instructor_payable_pence,
           basis.processing_fee_evidence_reference,
           COALESCE(flexible.flexible_sources, '[]'::jsonb) AS flexible_sources
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
      JOIN interim_v1_instructor_controls c
        ON c.school_id = lb.school_id AND c.instructor_id = lb.instructor_id
      LEFT JOIN interim_v1_manual_settlement_boundaries mb
        ON mb.school_id = lb.school_id AND mb.instructor_id = lb.instructor_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS bcs_count, MIN(id) AS only_bcs_id
          FROM booking_credit_sources
         WHERE school_id = lb.school_id AND booking_id = lb.id AND refunded_at IS NULL
      ) source_counts ON TRUE
      LEFT JOIN booking_credit_sources bcs
        ON bcs.id = source_counts.only_bcs_id AND source_counts.bcs_count = 1
      LEFT JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id AND ct.school_id = lb.school_id
      LEFT JOIN interim_v1_funding_evidence e
        ON e.school_id = lb.school_id AND e.booking_id = lb.id
      LEFT JOIN LATERAL (
        SELECT observation.*
          FROM payout_direct_evidence_observations observation
         WHERE observation.school_id = lb.school_id
           AND observation.booking_id = lb.id
           AND observation.instructor_id = lb.instructor_id
         ORDER BY CASE observation.evidence_status WHEN 'complete' THEN 0 ELSE 1 END,
                  observation.observed_at DESC, observation.id DESC
         LIMIT 1
      ) direct_observation ON TRUE
      LEFT JOIN payout_line_items pli
        ON pli.booking_id = lb.id AND pli.school_id = lb.school_id
      LEFT JOIN LATERAL (
        SELECT event.*
          FROM payout_funding_basis_events event
         WHERE event.school_id = lb.school_id
           AND event.booking_id = lb.id
           AND event.instructor_id = lb.instructor_id
         ORDER BY event.sequence_no DESC, event.id DESC
         LIMIT 1
      ) basis ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'allocation_id', allocation.id,
          'source_id', allocation.source_id,
          'units_allocated', allocation.units_allocated,
          'unit_minutes', allocation.unit_minutes,
          'contribution_pence', allocation.contribution_pence,
          'preceding_active_units', COALESCE((
            SELECT SUM(previous.units_allocated)
              FROM flexible_package_booking_allocations previous
             WHERE previous.school_id = allocation.school_id
               AND previous.source_id = allocation.source_id
               AND previous.id < allocation.id
               AND NOT EXISTS (
                 SELECT 1 FROM flexible_package_allocation_returns previous_return
                  WHERE previous_return.school_id = previous.school_id
                    AND previous_return.allocation_id = previous.id
               )
          ), 0),
          'initial_units', source.initial_units,
          'original_value_pence', source.original_value_pence,
          'legacy_conversion', source.legacy_conversion,
          'source_evidence_id', source_evidence.id,
          'evidence_status', source_evidence.evidence_status,
          'evidence_json', source_evidence.evidence_json
        ) ORDER BY allocation.source_id, allocation.id) AS flexible_sources
          FROM flexible_package_booking_allocations allocation
          JOIN flexible_package_sources source
            ON source.id = allocation.source_id
           AND source.school_id = allocation.school_id
          LEFT JOIN LATERAL (
            SELECT observation.*
              FROM payout_flexible_source_evidence observation
             WHERE observation.school_id = source.school_id
               AND observation.source_id = source.id
             ORDER BY CASE observation.evidence_status WHEN 'complete' THEN 0 ELSE 1 END,
                      observation.observed_at DESC, observation.id DESC
             LIMIT 1
          ) source_evidence ON TRUE
         WHERE allocation.school_id = lb.school_id
           AND allocation.booking_id = lb.id
           AND allocation.instructor_id = lb.instructor_id
           AND allocation.learner_id = lb.learner_id
           AND source.learner_id = lb.learner_id
           AND NOT EXISTS (
             SELECT 1 FROM flexible_package_allocation_returns returned
              WHERE returned.school_id = allocation.school_id
                AND returned.allocation_id = allocation.id
           )
      ) flexible ON TRUE
     WHERE lb.school_id = ${schoolId} AND lb.instructor_id = ${instructorId}
       AND lb.status = 'chargeable'
     ORDER BY lb.scheduled_date, lb.id
  `;
  return buildPreviewFromRows(instructor, rows, now);
}

function evidenceComplete(facts) {
  return facts.provider_livemode && exactId(facts.stripe_checkout_session_id, 'cs')
    && exactId(facts.stripe_payment_intent_id, 'pi') && exactId(facts.stripe_charge_id, 'ch')
    && facts.stripe_payment_intent_status === 'succeeded'
    && facts.stripe_charge_paid === true && facts.stripe_charge_captured === true
    && facts.stripe_charge_payment_intent_id === facts.stripe_payment_intent_id
    && exactId(facts.stripe_balance_transaction_id, 'txn')
    && facts.stripe_balance_transaction_source_id === facts.stripe_charge_id
    && facts.stripe_balance_transaction_type === 'charge'
    && facts.stripe_balance_transaction_amount_pence === facts.gross_collected_pence
    && facts.stripe_balance_transaction_currency === 'gbp'
    && ['available', 'pending'].includes(facts.stripe_balance_transaction_status)
    && facts.stripe_payment_created_at
    && facts.stripe_funds_available_at && Number.isSafeInteger(facts.gross_collected_pence)
    && facts.gross_collected_pence > 0 && Number.isSafeInteger(facts.stripe_fee_pence)
    && facts.stripe_fee_pence >= 0 && facts.stripe_fee_pence <= facts.gross_collected_pence
    && facts.currency === 'gbp';
}

function evidenceRecord({ schoolId, instructorId, learnerId, bookingId, creditTransactionId, bookingCreditSourceId, fundingEvidence, providerLivemode }) {
  const rawGross = Number.isSafeInteger(fundingEvidence.amountPence) && fundingEvidence.amountPence > 0
    ? fundingEvidence.amountPence : null;
  const rawFee = Number.isSafeInteger(fundingEvidence.feePence) && fundingEvidence.feePence >= 0
    && rawGross != null && fundingEvidence.feePence <= rawGross ? fundingEvidence.feePence : null;
  const facts = {
    school_id: Number(schoolId), instructor_id: Number(instructorId), learner_id: Number(learnerId),
    booking_id: Number(bookingId), credit_transaction_id: Number(creditTransactionId),
    booking_credit_source_id: Number(bookingCreditSourceId), payment_origin: 'direct_slot',
    provider_livemode: providerLivemode === true,
    stripe_checkout_session_id: fundingEvidence.checkoutSessionId || null,
    stripe_payment_intent_id: fundingEvidence.paymentIntentId || null,
    stripe_payment_intent_status: fundingEvidence.paymentIntentStatus || null,
    stripe_charge_id: fundingEvidence.chargeId || null,
    stripe_charge_paid: typeof fundingEvidence.chargePaid === 'boolean' ? fundingEvidence.chargePaid : null,
    stripe_charge_captured: typeof fundingEvidence.chargeCaptured === 'boolean' ? fundingEvidence.chargeCaptured : null,
    stripe_charge_payment_intent_id: fundingEvidence.chargePaymentIntentId || null,
    stripe_balance_transaction_id: fundingEvidence.balanceTransactionId || null,
    stripe_balance_transaction_source_id: fundingEvidence.balanceTransactionSourceId || null,
    stripe_balance_transaction_type: fundingEvidence.balanceTransactionType || null,
    stripe_balance_transaction_amount_pence: Number.isSafeInteger(fundingEvidence.balanceTransactionAmountPence)
      ? fundingEvidence.balanceTransactionAmountPence : null,
    stripe_balance_transaction_currency: fundingEvidence.balanceTransactionCurrency || null,
    stripe_balance_transaction_status: fundingEvidence.balanceTransactionStatus || null,
    stripe_payment_created_at: fundingEvidence.paymentCreatedAt || null,
    stripe_funds_available_at: fundingEvidence.fundsAvailableAt || null,
    gross_collected_pence: rawGross,
    stripe_fee_pence: rawFee,
    currency: typeof fundingEvidence.currency === 'string' && /^[a-z]{3}$/.test(fundingEvidence.currency)
      ? fundingEvidence.currency : null,
  };
  return { ...facts, evidence_status: evidenceComplete(facts) ? 'complete' : 'pending', evidence_fingerprint: fingerprint(facts) };
}

function comparableEvidenceValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function recordInterimV1FundingEvidence(sql, input) {
  let control;
  try {
    [control] = await sql`
      SELECT id FROM interim_v1_instructor_controls
       WHERE school_id = ${input.schoolId} AND instructor_id = ${input.instructorId}
    `;
  } catch (error) {
    if (error?.code === '42P01') return { recorded: false, reason: 'SCHEMA_NOT_INSTALLED' };
    throw error;
  }
  if (!control) return { recorded: false, reason: 'NOT_CONTROLLED' };
  const [bcs] = await sql`
    SELECT id FROM booking_credit_sources
     WHERE school_id = ${input.schoolId} AND booking_id = ${input.bookingId}
       AND credit_transaction_id = ${input.creditTransactionId} AND refunded_at IS NULL
  `;
  if (!bcs) throw new Error('INTERIM_V1_BCS_MISSING');
  const record = evidenceRecord({ ...input, bookingCreditSourceId: bcs.id });
  const [existing] = await sql`
    SELECT * FROM interim_v1_funding_evidence
     WHERE school_id = ${input.schoolId} AND booking_id = ${input.bookingId}
     LIMIT 1
  `;
  if (existing) {
    const comparedFields = [
      'provider_livemode', 'stripe_checkout_session_id', 'stripe_payment_intent_id',
      'stripe_payment_intent_status', 'stripe_charge_id', 'stripe_charge_paid',
      'stripe_charge_captured', 'stripe_charge_payment_intent_id',
      'stripe_balance_transaction_id', 'stripe_balance_transaction_source_id',
      'stripe_balance_transaction_type', 'stripe_balance_transaction_amount_pence',
      'stripe_balance_transaction_currency', 'stripe_balance_transaction_status', 'stripe_payment_created_at',
      'stripe_funds_available_at', 'gross_collected_pence', 'stripe_fee_pence', 'currency',
    ];
    const mismatch = comparedFields.find((field) => existing[field] != null && record[field] != null
      && comparableEvidenceValue(existing[field]) !== comparableEvidenceValue(record[field]));
    if (mismatch) {
      if (existing.evidence_status !== 'pending') throw new Error('INTERIM_V1_TERMINAL_EVIDENCE_CONTRADICTION');
      const contradictionFingerprint = fingerprint({
        schema: 'interim-v1-funding-contradiction/1',
        evidence_id: existing.id,
        field: mismatch,
        observed: record[mismatch],
      });
      const [contradictory] = await sql`
        UPDATE interim_v1_funding_evidence
           SET evidence_status = 'contradictory',
               contradiction_code = 'PROVIDER_EVIDENCE_CONTRADICTION',
               evidence_fingerprint = ${contradictionFingerprint}, updated_at = NOW()
         WHERE id = ${existing.id} AND school_id = ${input.schoolId}
           AND evidence_status = 'pending'
        RETURNING id, evidence_status
      `;
      return { recorded: true, ...contradictory };
    }
  }
  const [saved] = await sql`
    INSERT INTO interim_v1_funding_evidence (
      id, school_id, instructor_id, learner_id, booking_id, credit_transaction_id,
      booking_credit_source_id, payment_origin, provider_livemode,
      stripe_checkout_session_id, stripe_payment_intent_id, stripe_payment_intent_status,
      stripe_charge_id, stripe_charge_paid, stripe_charge_captured, stripe_charge_payment_intent_id,
      stripe_balance_transaction_id, stripe_balance_transaction_source_id,
      stripe_balance_transaction_type, stripe_balance_transaction_amount_pence,
      stripe_balance_transaction_currency, stripe_balance_transaction_status,
      stripe_payment_created_at, stripe_funds_available_at,
      gross_collected_pence, stripe_fee_pence, currency, evidence_status, evidence_fingerprint
    ) VALUES (
      ${crypto.randomUUID()}, ${record.school_id}, ${record.instructor_id}, ${record.learner_id},
      ${record.booking_id}, ${record.credit_transaction_id}, ${record.booking_credit_source_id},
      'direct_slot', ${record.provider_livemode}, ${record.stripe_checkout_session_id},
      ${record.stripe_payment_intent_id}, ${record.stripe_payment_intent_status},
      ${record.stripe_charge_id}, ${record.stripe_charge_paid}, ${record.stripe_charge_captured},
      ${record.stripe_charge_payment_intent_id}, ${record.stripe_balance_transaction_id},
      ${record.stripe_balance_transaction_source_id}, ${record.stripe_balance_transaction_type},
      ${record.stripe_balance_transaction_amount_pence}, ${record.stripe_balance_transaction_currency},
      ${record.stripe_balance_transaction_status}, ${record.stripe_payment_created_at},
      ${record.stripe_funds_available_at}, ${record.gross_collected_pence},
      ${record.stripe_fee_pence}, ${record.currency}, ${record.evidence_status},
      ${record.evidence_fingerprint}
    ) ON CONFLICT (school_id, booking_id) DO UPDATE SET
      stripe_checkout_session_id = COALESCE(interim_v1_funding_evidence.stripe_checkout_session_id, EXCLUDED.stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(interim_v1_funding_evidence.stripe_payment_intent_id, EXCLUDED.stripe_payment_intent_id),
      stripe_payment_intent_status = COALESCE(interim_v1_funding_evidence.stripe_payment_intent_status, EXCLUDED.stripe_payment_intent_status),
      stripe_charge_id = COALESCE(interim_v1_funding_evidence.stripe_charge_id, EXCLUDED.stripe_charge_id),
      stripe_charge_paid = COALESCE(interim_v1_funding_evidence.stripe_charge_paid, EXCLUDED.stripe_charge_paid),
      stripe_charge_captured = COALESCE(interim_v1_funding_evidence.stripe_charge_captured, EXCLUDED.stripe_charge_captured),
      stripe_charge_payment_intent_id = COALESCE(interim_v1_funding_evidence.stripe_charge_payment_intent_id, EXCLUDED.stripe_charge_payment_intent_id),
      stripe_balance_transaction_id = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_id, EXCLUDED.stripe_balance_transaction_id),
      stripe_balance_transaction_source_id = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_source_id, EXCLUDED.stripe_balance_transaction_source_id),
      stripe_balance_transaction_type = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_type, EXCLUDED.stripe_balance_transaction_type),
      stripe_balance_transaction_amount_pence = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_amount_pence, EXCLUDED.stripe_balance_transaction_amount_pence),
      stripe_balance_transaction_currency = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_currency, EXCLUDED.stripe_balance_transaction_currency),
      stripe_balance_transaction_status = COALESCE(interim_v1_funding_evidence.stripe_balance_transaction_status, EXCLUDED.stripe_balance_transaction_status),
      stripe_payment_created_at = COALESCE(interim_v1_funding_evidence.stripe_payment_created_at, EXCLUDED.stripe_payment_created_at),
      stripe_funds_available_at = COALESCE(interim_v1_funding_evidence.stripe_funds_available_at, EXCLUDED.stripe_funds_available_at),
      gross_collected_pence = COALESCE(interim_v1_funding_evidence.gross_collected_pence, EXCLUDED.gross_collected_pence),
      stripe_fee_pence = COALESCE(interim_v1_funding_evidence.stripe_fee_pence, EXCLUDED.stripe_fee_pence),
      currency = COALESCE(interim_v1_funding_evidence.currency, EXCLUDED.currency),
      evidence_status = CASE
        WHEN interim_v1_funding_evidence.evidence_status = 'pending'
         AND EXCLUDED.evidence_status = 'complete' THEN 'complete'
        ELSE interim_v1_funding_evidence.evidence_status
      END,
      evidence_fingerprint = CASE
        WHEN interim_v1_funding_evidence.evidence_status = 'pending'
         AND EXCLUDED.evidence_status = 'complete' THEN EXCLUDED.evidence_fingerprint
        ELSE interim_v1_funding_evidence.evidence_fingerprint
      END,
      updated_at = NOW()
    RETURNING id, evidence_status
  `;
  return saved ? { recorded: true, ...saved } : { recorded: false, reason: 'ALREADY_RECORDED' };
}

function directEvidenceObservation(input) {
  const record = evidenceRecord(input);
  const { evidence_fingerprint: ignoredFingerprint, ...facts } = record;
  return {
    school_id: Number(input.schoolId),
    instructor_id: Number(input.instructorId),
    booking_id: Number(input.bookingId),
    evidence_status: record.evidence_status,
    evidence_json: facts,
    evidence_fingerprint: fingerprint({
      schema: 'payout-direct-evidence-observation/1',
      school_id: Number(input.schoolId), instructor_id: Number(input.instructorId),
      booking_id: Number(input.bookingId), facts,
    }),
  };
}

function payoutLinePersistenceProjection(line) {
  const semantics = line?.value_semantics;
  const common = {
    attributable_gross_pence: Number.isSafeInteger(line?.gross_pence) ? line.gross_pence : null,
    actual_processing_fee_pence: Number.isSafeInteger(line?.stripe_fee_pence) ? line.stripe_fee_pence : null,
    net_attributable_revenue_pence: Number.isSafeInteger(line?.net_after_stripe_pence)
      ? line.net_after_stripe_pence : null,
    payout_value_semantics: semantics,
    payout_calculation_version: line?.calculation_version || CALCULATION_VERSION,
    funding_evidence_json: {
      funding_evidence_id: line?.funding_evidence_id || null,
      audited_funding_basis_id: line?.audited_funding_basis_id || null,
      funding_lines: line?.funding_lines || [],
    },
  };
  if (semantics === 'gross_customer_revenue') {
    if (!Number.isSafeInteger(common.attributable_gross_pence)
        || !Number.isSafeInteger(common.actual_processing_fee_pence)
        || !Number.isSafeInteger(common.net_attributable_revenue_pence)) {
      throw new InterimV1PayoutError(409, 'PAYOUT_LINE_EVIDENCE_INCOMPLETE', 'Gross payout basis cannot be persisted without exact gross, fee and net values');
    }
    return {
      ...common,
      price_pence: common.attributable_gross_pence,
      stripe_fee_pence: common.actual_processing_fee_pence,
      commission_rate: line.commission_rate,
    };
  }
  if (semantics === 'net_after_processing') {
    if (!Number.isSafeInteger(common.net_attributable_revenue_pence)) {
      throw new InterimV1PayoutError(409, 'PAYOUT_LINE_EVIDENCE_INCOMPLETE', 'Net payout basis cannot be persisted without its audited net value');
    }
    return {
      ...common,
      // Legacy compatibility columns express the amount to which commission is applied.
      // The authoritative columns retain that gross and actual fee are unknown.
      price_pence: common.net_attributable_revenue_pence,
      stripe_fee_pence: 0,
      commission_rate: line.commission_rate,
    };
  }
  if (semantics === 'final_instructor_payable') {
    if (!Number.isSafeInteger(line?.instructor_amount_pence)) {
      throw new InterimV1PayoutError(409, 'PAYOUT_LINE_EVIDENCE_INCOMPLETE', 'Final-payable basis cannot be persisted without its audited final amount');
    }
    return {
      ...common,
      // The old columns remain arithmetically coherent without pretending this is gross.
      // Semantic columns make the compatibility projection explicit.
      price_pence: line.instructor_amount_pence,
      stripe_fee_pence: 0,
      commission_rate: 1,
    };
  }
  throw new InterimV1PayoutError(409, 'PAYOUT_LINE_SEMANTICS_MISSING', 'Payout line has no authoritative value semantics');
}

async function recordDirectEvidenceObservation(sql, input) {
  const [source] = await sql`
    SELECT bcs.id AS booking_credit_source_id, bcs.credit_transaction_id,
           ct.stripe_session_id, ct.stripe_payment_intent_id
      FROM booking_credit_sources bcs
      JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id AND ct.school_id = bcs.school_id
     WHERE bcs.school_id = ${input.schoolId} AND bcs.booking_id = ${input.bookingId}
       AND bcs.id = ${input.bookingCreditSourceId} AND bcs.refunded_at IS NULL
       AND ct.type = 'slot_purchase' AND ct.source = 'stripe'
  `;
  if (!source || Number(source.credit_transaction_id) !== Number(input.creditTransactionId)) {
    throw new InterimV1PayoutError(409, 'DIRECT_FUNDING_IDENTITY_CHANGED', 'Direct funding identity changed during reconciliation');
  }
  const observation = directEvidenceObservation({ ...input, bookingCreditSourceId: source.booking_credit_source_id });
  const facts = observation.evidence_json;
  if (observation.evidence_status === 'complete' && (
    facts.stripe_checkout_session_id !== source.stripe_session_id
    || facts.stripe_payment_intent_id !== source.stripe_payment_intent_id
  )) observation.evidence_status = 'contradictory';
  const [terminal] = await sql`
    SELECT id, evidence_status, evidence_fingerprint
      FROM payout_direct_evidence_observations
     WHERE school_id = ${input.schoolId} AND booking_id = ${input.bookingId}
       AND evidence_status IN ('complete','contradictory')
     ORDER BY observed_at DESC, id DESC LIMIT 1
  `;
  if (terminal) {
    if (terminal.evidence_fingerprint === observation.evidence_fingerprint) {
      return { recorded: false, reused: true, ...terminal };
    }
    throw new InterimV1PayoutError(409, 'DIRECT_EVIDENCE_CONTRADICTION', 'A terminal direct Stripe observation already exists');
  }
  const [same] = await sql`
    SELECT id, evidence_status, evidence_fingerprint
      FROM payout_direct_evidence_observations
     WHERE school_id = ${input.schoolId} AND booking_id = ${input.bookingId}
       AND evidence_fingerprint = ${observation.evidence_fingerprint}
     LIMIT 1
  `;
  if (same) return { recorded: false, reused: true, ...same };
  const [saved] = await sql`
    INSERT INTO payout_direct_evidence_observations (
      id, school_id, instructor_id, booking_id, evidence_status, evidence_json,
      evidence_fingerprint, observed_by_admin_id
    ) VALUES (${crypto.randomUUID()}, ${input.schoolId}, ${input.instructorId},
      ${input.bookingId}, ${observation.evidence_status},
      ${JSON.stringify(observation.evidence_json)}::jsonb,
      ${observation.evidence_fingerprint}, ${input.adminId})
    RETURNING id, evidence_status, evidence_fingerprint
  `;
  return { recorded: true, reused: false, ...saved };
}

function flexibleEvidenceObservation({ schoolId, sourceId, fundingEvidence, providerLivemode }) {
  const facts = {
    ...fundingEvidence,
    providerLivemode: providerLivemode === true,
  };
  const complete = evidenceComplete({
    provider_livemode: facts.providerLivemode,
    stripe_checkout_session_id: facts.checkoutSessionId,
    stripe_payment_intent_id: facts.paymentIntentId,
    stripe_payment_intent_status: facts.paymentIntentStatus,
    stripe_charge_id: facts.chargeId,
    stripe_charge_paid: facts.chargePaid,
    stripe_charge_captured: facts.chargeCaptured,
    stripe_charge_payment_intent_id: facts.chargePaymentIntentId,
    stripe_balance_transaction_id: facts.balanceTransactionId,
    stripe_balance_transaction_source_id: facts.balanceTransactionSourceId,
    stripe_balance_transaction_type: facts.balanceTransactionType,
    stripe_balance_transaction_amount_pence: facts.balanceTransactionAmountPence,
    stripe_balance_transaction_currency: facts.balanceTransactionCurrency,
    stripe_balance_transaction_status: facts.balanceTransactionStatus,
    stripe_payment_created_at: facts.paymentCreatedAt,
    stripe_funds_available_at: facts.fundsAvailableAt,
    gross_collected_pence: facts.amountPence,
    stripe_fee_pence: facts.feePence,
    currency: facts.currency,
  });
  const evidenceStatus = complete ? 'complete' : 'pending';
  return {
    school_id: Number(schoolId),
    source_id: Number(sourceId),
    evidence_status: evidenceStatus,
    evidence_json: facts,
    evidence_fingerprint: fingerprint({
      schema: 'payout-flexible-source-evidence/1',
      school_id: Number(schoolId), source_id: Number(sourceId), facts,
    }),
  };
}

async function recordFlexibleSourceEvidence(sql, input) {
  const observation = flexibleEvidenceObservation(input);
  const [source] = await sql`
    SELECT s.id, s.original_value_pence, p.stripe_checkout_session_id,
           p.stripe_payment_intent_id
      FROM flexible_package_sources s
      JOIN flexible_package_purchases p
        ON p.id = s.purchase_id AND p.school_id = s.school_id
     WHERE s.id = ${input.sourceId} AND s.school_id = ${input.schoolId}
  `;
  if (!source) throw new InterimV1PayoutError(404, 'FLEXIBLE_SOURCE_NOT_FOUND', 'Flexible package source not found');
  const facts = observation.evidence_json;
  if (observation.evidence_status === 'complete' && (
    Number(facts.amountPence) !== Number(source.original_value_pence)
    || facts.checkoutSessionId !== source.stripe_checkout_session_id
    || facts.paymentIntentId !== source.stripe_payment_intent_id
  )) {
    observation.evidence_status = 'contradictory';
  }
  const [terminal] = await sql`
    SELECT id, evidence_status, evidence_fingerprint
      FROM payout_flexible_source_evidence
     WHERE school_id = ${input.schoolId} AND source_id = ${input.sourceId}
       AND evidence_status IN ('complete','contradictory')
     ORDER BY observed_at DESC, id DESC LIMIT 1
  `;
  if (terminal) {
    if (terminal.evidence_fingerprint === observation.evidence_fingerprint) {
      return { recorded: false, reused: true, ...terminal };
    }
    throw new InterimV1PayoutError(409, 'FLEXIBLE_SOURCE_EVIDENCE_CONTRADICTION', 'A terminal flexible source observation already exists');
  }
  const [same] = await sql`
    SELECT id, evidence_status, evidence_fingerprint
      FROM payout_flexible_source_evidence
     WHERE school_id = ${input.schoolId} AND source_id = ${input.sourceId}
       AND evidence_fingerprint = ${observation.evidence_fingerprint}
     LIMIT 1
  `;
  if (same) return { recorded: false, reused: true, ...same };
  const [saved] = await sql`
    INSERT INTO payout_flexible_source_evidence (
      id, school_id, source_id, evidence_status, evidence_json,
      evidence_fingerprint, observed_by_admin_id
    ) VALUES (${crypto.randomUUID()}, ${input.schoolId}, ${input.sourceId},
      ${observation.evidence_status}, ${JSON.stringify(observation.evidence_json)}::jsonb,
      ${observation.evidence_fingerprint}, ${input.adminId})
    RETURNING id, evidence_status, evidence_fingerprint
  `;
  return { recorded: true, reused: false, ...saved };
}

function validateAuditedFundingBasis(input) {
  const common = {
    funding_class: String(input.funding_class || '').trim(),
    value_semantics: String(input.value_semantics || '').trim(),
    payment_processor: String(input.payment_processor || '').trim(),
    gross_pence: input.gross_pence == null ? null : Number(input.gross_pence),
    actual_processing_fee_pence: input.actual_processing_fee_pence == null
      ? null : Number(input.actual_processing_fee_pence),
    net_pence: input.net_pence == null ? null : Number(input.net_pence),
    final_instructor_payable_pence: input.final_instructor_payable_pence == null
      ? null : Number(input.final_instructor_payable_pence),
    processing_fee_evidence_reference: String(input.processing_fee_evidence_reference || '').trim() || null,
    evidence_reference: String(input.evidence_reference || '').trim(),
    reason: String(input.reason || '').trim(),
  };
  if (!['manual','cash','bank','external','legacy','correction'].includes(common.funding_class)
      || !['gross_customer_revenue','net_after_processing','final_instructor_payable'].includes(common.value_semantics)
      || !['none','stripe','external'].includes(common.payment_processor)
      || !common.evidence_reference || !common.reason) {
    return { ok: false, code: 'INVALID_AUDITED_FUNDING_BASIS' };
  }
  const calculated = require('./_authoritative-lesson-earning').earningFromValueBasis(common, 10000);
  if (!calculated.ok) return { ok: false, code: calculated.reason };
  return { ok: true, basis: common };
}

function clientSqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    return (await client.query(text, values)).rows || [];
  };
}

async function recordTransferAttempt(sql, intent, outcome, extra = {}) {
  await sql`
    INSERT INTO interim_v1_transfer_attempts (
      id, school_id, instructor_id, transfer_intent_id, attempt_number, outcome,
      stripe_transfer_id, provider_request_id, error_class, error_code, evidence_json
    ) SELECT ${crypto.randomUUID()}, ${intent.school_id}, ${intent.instructor_id}, ${intent.id},
             COALESCE(MAX(attempt_number), 0) + 1, ${outcome}, ${extra.transferId || null},
             ${extra.requestId || null}, ${extra.errorClass || null}, ${extra.errorCode || null},
             ${JSON.stringify(extra.evidence || {})}
        FROM interim_v1_transfer_attempts
       WHERE school_id = ${intent.school_id} AND transfer_intent_id = ${intent.id}
  `;
}

async function finalizeTransfer(runTransaction, req, admin, intent, transfer, outcome) {
  return runTransaction(async (sql) => {
    await sql`
      UPDATE interim_v1_transfer_intents SET state = 'completed', stripe_transfer_id = ${transfer.id},
             completed_at = NOW(), updated_at = NOW()
       WHERE id = ${intent.id} AND school_id = ${intent.school_id}
         AND state = ANY(${['submitting', 'reconciling']}::text[])
    `;
    await sql`UPDATE instructor_payouts SET status = 'completed', stripe_transfer_id = ${transfer.id}, completed_at = NOW() WHERE id = ${intent.payout_id} AND school_id = ${intent.school_id}`;
    await sql`UPDATE interim_v1_payout_approvals SET state = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ${intent.approval_id} AND school_id = ${intent.school_id}`;
    await recordTransferAttempt(sql, intent, outcome, { transferId: transfer.id, evidence: { livemode: transfer.livemode === true } });
    await logAuditRequired(sql, {
      adminId: admin.id, adminEmail: admin.email, action: 'payout.interim_v1_transfer_completed',
      targetType: 'instructor', targetId: intent.instructor_id, schoolId: intent.school_id, req,
      details: { transfer_intent_id: intent.id, payout_id: intent.payout_id, stripe_transfer_id: transfer.id, amount_pence: intent.amount_pence, payouts_paused: true },
    });
    return transfer.id;
  });
}

function validateTransfer(transfer, intent) {
  if (!transfer || !exactId(transfer.id, 'tr') || transfer.livemode !== true
    || Number(transfer.amount) !== Number(intent.amount_pence) || transfer.currency !== 'gbp'
    || transfer.destination !== intent.destination_account_id
    || transfer.metadata?.cc_interim_v1_transfer_intent_id !== String(intent.id)) {
    throw new InterimV1PayoutError(409, 'INTERIM_V1_TRANSFER_IDENTITY_MISMATCH', 'Stripe transfer evidence does not match the durable intent');
  }
  return transfer;
}

function createInterimV1PayoutHandler({
  stripe,
  reconciliationStripe = stripe,
  connectionString = process.env.POSTGRES_URL,
  sql: injectedSql = null,
  transactionRunner,
} = {}) {
  const runTransaction = transactionRunner || ((work) => withNeonTransaction(connectionString, async (client) => work(clientSqlTag(client))));
  return async function handleInterimV1Payout(req, res) {
    const action = req.query?.action;
    if (!ACTIONS.has(action)) return false;
    const admin = requireAuth(req, { roles: ['superadmin'] });
    if (!admin) { res.status(401).json({ error: true, code: 'SUPERADMIN_REQUIRED', message: 'Platform owner authorization is required' }); return true; }
    const schoolId = getSchoolId(admin, req);
    const instructorId = Number(req.body?.instructor_id || req.query?.instructor_id);
    if (!Number.isSafeInteger(schoolId) || schoolId <= 0 || !Number.isSafeInteger(instructorId) || instructorId <= 0) {
      res.status(400).json({ error: true, code: 'INVALID_SCOPE', message: 'A valid school and instructor are required' }); return true;
    }
    try {
      const sql = injectedSql || (connectionString ? neon(connectionString) : null);
      if (!sql) throw new InterimV1PayoutError(500, 'INTERIM_V1_DATABASE_UNAVAILABLE', 'Interim v1 payout database access is unavailable');
      if (action === 'interim-v1-payout-preview') {
        if (req.method !== 'GET') throw new InterimV1PayoutError(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const preview = await loadInterimV1Preview(sql, schoolId, instructorId);
        res.json({ ok: true, preview }); return true;
      }
      if (req.method !== 'POST') throw new InterimV1PayoutError(405, 'METHOD_NOT_ALLOWED', 'POST required');

      if (action === 'interim-v1-reconcile-funding-evidence') {
        if (req.body?.operator_go !== RECONCILE_FUNDING_CONFIRMATION) {
          throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${RECONCILE_FUNDING_CONFIRMATION}`);
        }
        const bookingId = Number(req.body?.booking_id);
        if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
          throw new InterimV1PayoutError(400, 'BOOKING_ID_REQUIRED', 'A valid booking_id is required');
        }
        const [booking] = await sql`
          SELECT lb.id, lb.learner_id, lb.instructor_id, lb.school_id,
                 c.id AS control_id, i.payouts_paused
            FROM lesson_bookings lb
            JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = lb.school_id
            JOIN interim_v1_instructor_controls c
              ON c.instructor_id = lb.instructor_id AND c.school_id = lb.school_id
           WHERE lb.id = ${bookingId} AND lb.school_id = ${schoolId}
             AND lb.instructor_id = ${instructorId}
        `;
        if (!booking) throw new InterimV1PayoutError(404, 'BOOKING_NOT_FOUND', 'Controlled booking not found');
        if (booking.payouts_paused !== true) throw new InterimV1PayoutError(409, 'INTERIM_V1_PAUSE_GUARD_REQUIRED', 'Instructor must remain paused');
        const directRows = await sql`
          SELECT bcs.id AS booking_credit_source_id, bcs.credit_transaction_id,
                 ct.stripe_session_id, ct.stripe_payment_intent_id,
                 ct.source, ct.payment_method, ct.type
            FROM booking_credit_sources bcs
            JOIN credit_transactions ct
              ON ct.id = bcs.credit_transaction_id AND ct.school_id = bcs.school_id
           WHERE bcs.school_id = ${schoolId} AND bcs.booking_id = ${bookingId}
             AND bcs.refunded_at IS NULL
             AND ct.type = 'slot_purchase' AND ct.source = 'stripe'
        `;
        const flexibleRows = await sql`
          SELECT DISTINCT source.id AS source_id, purchase.stripe_checkout_session_id,
                 purchase.stripe_payment_intent_id
            FROM flexible_package_booking_allocations allocation
            JOIN flexible_package_sources source
              ON source.id = allocation.source_id AND source.school_id = allocation.school_id
            JOIN flexible_package_purchases purchase
              ON purchase.id = source.purchase_id AND purchase.school_id = source.school_id
           WHERE allocation.school_id = ${schoolId} AND allocation.booking_id = ${bookingId}
             AND NOT EXISTS (
               SELECT 1 FROM flexible_package_allocation_returns returned
                WHERE returned.school_id = allocation.school_id
                  AND returned.allocation_id = allocation.id
             )
           ORDER BY source.id
        `;
        if (directRows.length > 1) throw new InterimV1PayoutError(409, 'DIRECT_FUNDING_NOT_ONE_TO_ONE', 'Direct funding must have exactly one active source');
        if (!directRows.length && !flexibleRows.length) {
          throw new InterimV1PayoutError(409, 'RECONCILABLE_FUNDING_IDENTITY_MISSING', 'No exact Stripe funding identity is attached to this booking');
        }
        const observations = [];
        const fetchEvidence = async (candidate) => {
          let providerObject;
          if (candidate.stripe_session_id || candidate.stripe_checkout_session_id) {
            const sessionId = candidate.stripe_session_id || candidate.stripe_checkout_session_id;
            providerObject = await reconciliationStripe.checkout.sessions.retrieve(
              sessionId,
              { expand: ['payment_intent'] }
            );
          } else if (candidate.stripe_payment_intent_id) {
            providerObject = await reconciliationStripe.paymentIntents.retrieve(
              candidate.stripe_payment_intent_id,
              { expand: ['latest_charge.balance_transaction'] }
            );
          } else {
            throw new InterimV1PayoutError(409, 'STRIPE_PAYMENT_IDENTITY_MISSING', 'Stripe session or PaymentIntent identity is required');
          }
          return {
            providerObject,
            fundingEvidence: await fetchSessionFundingEvidence(
              providerObject,
              reconciliationStripe,
              { allowChargeListLookup: false }
            ),
          };
        };
        if (directRows[0]) {
          const fetched = await fetchEvidence(directRows[0]);
          observations.push({ kind: 'direct', row: directRows[0], ...fetched });
        }
        for (const source of flexibleRows) {
          observations.push({ kind: 'flexible', row: source, ...(await fetchEvidence(source)) });
        }
        const recorded = await runTransaction(async (txSql) => {
          await txSql`SELECT pg_advisory_xact_lock(${schoolId}, ${instructorId})`;
          const results = [];
          for (const observation of observations) {
            if (observation.kind === 'direct') {
              results.push(await recordDirectEvidenceObservation(txSql, {
                schoolId, instructorId, learnerId: Number(booking.learner_id), bookingId,
                bookingCreditSourceId: Number(observation.row.booking_credit_source_id),
                creditTransactionId: Number(observation.row.credit_transaction_id),
                fundingEvidence: observation.fundingEvidence,
                providerLivemode: observation.providerObject.livemode === true,
                adminId: admin.id,
              }));
            } else {
              results.push(await recordFlexibleSourceEvidence(txSql, {
                schoolId, sourceId: Number(observation.row.source_id),
                fundingEvidence: observation.fundingEvidence,
                providerLivemode: observation.providerObject.livemode === true,
                adminId: admin.id,
              }));
            }
          }
          await logAuditRequired(txSql, {
            adminId: admin.id, adminEmail: admin.email,
            action: 'payout.interim_v1_funding_evidence_reconciled',
            targetType: 'lesson_booking', targetId: bookingId, schoolId, req,
            details: {
              instructor_id: instructorId,
              observations: results.map((result, index) => ({
                kind: observations[index].kind,
                id: result.id || null,
                evidence_status: result.evidence_status || null,
                reused: result.reused === true,
              })),
              stripe_reads_only: true, payout_created: false, transfer_created: false,
            },
          });
          return results;
        });
        res.json({ ok: true, booking_id: bookingId, observations: recorded, stripe_reads_only: true });
        return true;
      }

      if (action === 'interim-v1-record-funding-basis') {
        if (req.body?.operator_go !== RECORD_FUNDING_BASIS_CONFIRMATION) {
          throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${RECORD_FUNDING_BASIS_CONFIRMATION}`);
        }
        const bookingId = Number(req.body?.booking_id);
        const requestId = String(req.body?.idempotency_key || '').trim();
        const validated = validateAuditedFundingBasis(req.body || {});
        if (!Number.isSafeInteger(bookingId) || bookingId <= 0 || !/^cc-payout-basis-[0-9a-f-]{36}$/.test(requestId)) {
          throw new InterimV1PayoutError(400, 'INVALID_FUNDING_BASIS_IDENTITY', 'A booking_id and cc-payout-basis UUID idempotency key are required');
        }
        if (!validated.ok) throw new InterimV1PayoutError(400, validated.code, 'The audited funding basis is invalid or incomplete');
        const result = await runTransaction(async (txSql) => {
          await txSql`SELECT pg_advisory_xact_lock(${schoolId}, ${instructorId})`;
          const [booking] = await txSql`
            SELECT lb.id, lb.learner_id, lb.instructor_id, lb.school_id,
                   i.payouts_paused, c.id AS control_id, pli.payout_id
              FROM lesson_bookings lb
              JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = lb.school_id
              JOIN interim_v1_instructor_controls c
                ON c.instructor_id = lb.instructor_id AND c.school_id = lb.school_id
              LEFT JOIN payout_line_items pli
                ON pli.booking_id = lb.id AND pli.school_id = lb.school_id
             WHERE lb.id = ${bookingId} AND lb.school_id = ${schoolId}
               AND lb.instructor_id = ${instructorId}
             FOR UPDATE OF lb
          `;
          if (!booking) throw new InterimV1PayoutError(404, 'BOOKING_NOT_FOUND', 'Controlled booking not found');
          if (booking.payouts_paused !== true) throw new InterimV1PayoutError(409, 'INTERIM_V1_PAUSE_GUARD_REQUIRED', 'Instructor must remain paused');
          if (booking.payout_id) throw new InterimV1PayoutError(409, 'BOOKING_ALREADY_CLAIMED', 'A claimed booking cannot receive a new funding basis');
          const basisFingerprint = fingerprint({
            schema: 'payout-funding-basis/1', school_id: schoolId,
            instructor_id: instructorId, booking_id: bookingId,
            ...validated.basis,
          });
          const [replay] = await txSql`
            SELECT id, basis_fingerprint FROM payout_funding_basis_events
             WHERE school_id = ${schoolId} AND idempotency_key = ${requestId}
          `;
          if (replay) {
            if (replay.basis_fingerprint !== basisFingerprint) {
              throw new InterimV1PayoutError(409, 'FUNDING_BASIS_IDEMPOTENCY_MISMATCH', 'The idempotency key is already bound to different evidence');
            }
            return { created: false, id: replay.id, basis_fingerprint: basisFingerprint };
          }
          const [prior] = await txSql`
            SELECT id, sequence_no FROM payout_funding_basis_events
             WHERE school_id = ${schoolId} AND booking_id = ${bookingId}
             ORDER BY sequence_no DESC, id DESC LIMIT 1
             FOR SHARE
          `;
          const [created] = await txSql`
            INSERT INTO payout_funding_basis_events (
              id, school_id, learner_id, instructor_id, booking_id, sequence_no,
              supersedes_event_id, funding_class, value_semantics, payment_processor,
              gross_pence, actual_processing_fee_pence, net_pence,
              final_instructor_payable_pence, processing_fee_evidence_reference,
              evidence_reference, reason, idempotency_key, basis_fingerprint,
              created_by_admin_id
            ) VALUES (${crypto.randomUUID()}, ${schoolId}, ${booking.learner_id},
              ${instructorId}, ${bookingId}, ${Number(prior?.sequence_no || 0) + 1},
              ${prior?.id || null}, ${validated.basis.funding_class},
              ${validated.basis.value_semantics}, ${validated.basis.payment_processor},
              ${validated.basis.gross_pence}, ${validated.basis.actual_processing_fee_pence},
              ${validated.basis.net_pence}, ${validated.basis.final_instructor_payable_pence},
              ${validated.basis.processing_fee_evidence_reference},
              ${validated.basis.evidence_reference}, ${validated.basis.reason}, ${requestId},
              ${basisFingerprint}, ${admin.id})
            RETURNING id, sequence_no, basis_fingerprint
          `;
          await logAuditRequired(txSql, {
            adminId: admin.id, adminEmail: admin.email,
            action: 'payout.funding_basis_recorded', targetType: 'lesson_booking',
            targetId: bookingId, schoolId, req,
            details: {
              instructor_id: instructorId, funding_basis_id: created.id,
              sequence_no: created.sequence_no, supersedes_event_id: prior?.id || null,
              funding_class: validated.basis.funding_class,
              value_semantics: validated.basis.value_semantics,
              evidence_reference: validated.basis.evidence_reference,
              basis_fingerprint: basisFingerprint,
            },
          });
          return { created: true, ...created };
        });
        res.status(result.created ? 201 : 200).json({ ok: true, funding_basis: result });
        return true;
      }

      if (action === 'interim-v1-record-manual-settlement-boundary') {
        if (req.body?.operator_go !== MANUAL_BOUNDARY_CONFIRMATION) {
          throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${MANUAL_BOUNDARY_CONFIRMATION}`);
        }
        const dates = validateManualBoundaryDates(
          req.body?.settled_before_local_date,
          req.body?.first_system_period_end_local_date,
        );
        if (!dates.ok) throw new InterimV1PayoutError(400, dates.code, 'The boundary must be two valid Fridays exactly seven days apart');
        const reason = String(req.body?.reason || '').trim();
        const evidenceReference = String(req.body?.evidence_reference || '').trim();
        if (!reason || !evidenceReference) {
          throw new InterimV1PayoutError(400, 'MANUAL_SETTLEMENT_EVIDENCE_REQUIRED', 'A reason and evidence_reference are required');
        }
        const result = await runTransaction(async (txSql) => {
          await txSql`SELECT pg_advisory_xact_lock(${schoolId}, ${instructorId})`;
          const [inst] = await txSql`
            SELECT i.id, i.school_id, i.payouts_paused, i.payouts_start_date,
                   c.id AS control_id, mb.id AS boundary_id, mb.settled_before_at,
                   mb.first_system_period_end_at, mb.time_zone, mb.reason, mb.evidence_reference,
                   mb.created_at
              FROM instructors i
              LEFT JOIN interim_v1_instructor_controls c
                ON c.school_id = i.school_id AND c.instructor_id = i.id
              LEFT JOIN interim_v1_manual_settlement_boundaries mb
                ON mb.school_id = i.school_id AND mb.instructor_id = i.id
             WHERE i.id = ${instructorId} AND i.school_id = ${schoolId}
             LIMIT 1
             FOR UPDATE OF i
          `;
          if (!inst) throw new InterimV1PayoutError(404, 'NOT_FOUND', 'Instructor not found');
          if (!inst.control_id) throw new InterimV1PayoutError(409, 'INTERIM_V1_CONTROL_MISSING', 'Instructor is not under interim v1 control');
          if (inst.payouts_paused !== true) throw new InterimV1PayoutError(409, 'INTERIM_V1_PAUSE_GUARD_REQUIRED', 'Instructor must remain paused');
          if (!dateOnly(inst.payouts_start_date)) throw new InterimV1PayoutError(409, 'START_DATE_MISSING', 'The immutable payout start date is missing');
          if (dateOnly(inst.payouts_start_date) > dates.settled_before_local_date) {
            throw new InterimV1PayoutError(409, 'MANUAL_SETTLEMENT_BEFORE_ORIGINAL_START', 'The manual handoff cannot precede the immutable payout start date');
          }
          const [instants] = await txSql`
            SELECT ((${dates.settled_before_local_date}::date + TIME '12:00') AT TIME ZONE 'Europe/London') AS settled_before_at,
                   ((${dates.first_system_period_end_local_date}::date + TIME '12:00') AT TIME ZONE 'Europe/London') AS first_system_period_end_at
          `;
          const wantedSettled = instantIso(instants?.settled_before_at);
          const wantedEnd = instantIso(instants?.first_system_period_end_at);
          if (!wantedSettled || !wantedEnd) throw new InterimV1PayoutError(400, 'INVALID_MANUAL_SETTLEMENT_DATES', 'Could not resolve the Europe/London payout boundary');
          if (inst.boundary_id) {
            if (instantIso(inst.settled_before_at) !== wantedSettled
              || instantIso(inst.first_system_period_end_at) !== wantedEnd
              || inst.time_zone !== 'Europe/London' || inst.reason !== reason
              || inst.evidence_reference !== evidenceReference) {
              throw new InterimV1PayoutError(409, 'MANUAL_SETTLEMENT_BOUNDARY_ALREADY_RECORDED', 'A different immutable manual-settlement boundary already exists');
            }
            return {
              created: false,
              boundary: {
                id: inst.boundary_id, settled_before_at: wantedSettled,
                first_system_period_end_at: wantedEnd, time_zone: inst.time_zone,
                reason: inst.reason, evidence_reference: inst.evidence_reference,
                created_at: instantIso(inst.created_at),
              },
            };
          }
          const [priorApproval] = await txSql`
            SELECT id FROM interim_v1_payout_approvals
             WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}
             LIMIT 1
          `;
          if (priorApproval) throw new InterimV1PayoutError(409, 'INTERIM_V1_APPROVAL_ALREADY_EXISTS', 'The manual boundary must be recorded before any interim v1 payout approval');
          const [overlappingClaim] = await txSql`
            SELECT pli.id
              FROM payout_line_items pli
              JOIN lesson_bookings lb ON lb.id = pli.booking_id
              JOIN instructor_payouts ip ON ip.id = pli.payout_id
             WHERE ip.school_id = ${schoolId} AND ip.instructor_id = ${instructorId}
               AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London') >= ${wantedSettled}::timestamptz
             LIMIT 1
          `;
          if (overlappingClaim) throw new InterimV1PayoutError(409, 'PAYOUT_CLAIM_ALREADY_EXISTS_AFTER_BOUNDARY', 'A payout claim already exists in or after the proposed system window');
          const boundaryId = crypto.randomUUID();
          const [created] = await txSql`
            INSERT INTO interim_v1_manual_settlement_boundaries (
              id, school_id, instructor_id, settled_before_at, first_system_period_end_at,
              time_zone, reason, evidence_reference, created_by_admin_id
            ) VALUES (${boundaryId}, ${schoolId}, ${instructorId}, ${wantedSettled}::timestamptz,
              ${wantedEnd}::timestamptz, 'Europe/London', ${reason}, ${evidenceReference}, ${admin.id})
            RETURNING id, settled_before_at, first_system_period_end_at, time_zone,
                      reason, evidence_reference, created_at
          `;
          await logAuditRequired(txSql, {
            adminId: admin.id, adminEmail: admin.email,
            action: 'payout.interim_v1_manual_settlement_boundary_recorded',
            targetType: 'instructor', targetId: instructorId, schoolId, req,
            details: {
              boundary_id: created.id,
              settled_before_at: instantIso(created.settled_before_at),
              first_system_period_end_at: instantIso(created.first_system_period_end_at),
              time_zone: created.time_zone, reason, evidence_reference: evidenceReference,
              payouts_paused: true, invitation_created: false, approval_created: false,
              payout_created: false, transfer_created: false,
            },
          });
          return {
            created: true,
            boundary: {
              ...created,
              settled_before_at: instantIso(created.settled_before_at),
              first_system_period_end_at: instantIso(created.first_system_period_end_at),
              created_at: instantIso(created.created_at),
            },
          };
        });
        res.status(result.created ? 201 : 200).json({
          ok: true, ...result, payouts_paused: true, invitation_created: false,
          approval_created: false, payout_created: false, transfer_created: false,
        });
        return true;
      }

      if (action === 'interim-v1-approve-first-run') {
        if (req.body?.operator_go !== APPROVE_CONFIRMATION) throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${APPROVE_CONFIRMATION}`);
        const reason = String(req.body?.reason || '').trim();
        const evidenceReference = String(req.body?.evidence_reference || '').trim();
        if (!reason || !evidenceReference) throw new InterimV1PayoutError(400, 'APPROVAL_EVIDENCE_REQUIRED', 'A reason and evidence_reference are required');
        const preview = await loadInterimV1Preview(sql, schoolId, instructorId);
        if (!preview.ready_for_approval) throw new InterimV1PayoutError(409, 'INTERIM_V1_PREVIEW_BLOCKED', `Preview is blocked: ${preview.blockers.join(', ')}`);
        if (req.body?.preview_fingerprint !== preview.preview_fingerprint || Number(req.body?.approved_amount_pence) !== preview.totals.proposed_transfer_pence) {
          throw new InterimV1PayoutError(409, 'INTERIM_V1_STALE_PREVIEW', 'Preview fingerprint or amount is stale');
        }
        const approval = await runTransaction(async (txSql) => {
          await txSql`SELECT pg_advisory_xact_lock(${schoolId}, ${instructorId})`;
          const lockedPreview = await loadInterimV1Preview(txSql, schoolId, instructorId);
          if (!lockedPreview.ready_for_approval || lockedPreview.preview_fingerprint !== preview.preview_fingerprint) {
            throw new InterimV1PayoutError(409, 'INTERIM_V1_STALE_PREVIEW', 'Preview evidence changed before approval');
          }
          const [priorCompleted] = await txSql`
            SELECT id FROM interim_v1_payout_approvals
             WHERE school_id = ${schoolId} AND instructor_id = ${instructorId} AND state = 'completed'
             LIMIT 1
          `;
          if (priorCompleted) throw new InterimV1PayoutError(409, 'INTERIM_V1_FIRST_RUN_ALREADY_COMPLETED', 'This milestone authorizes only the first reviewed payout; later runs require a separate reviewed activation');
          const [created] = await txSql`
            INSERT INTO interim_v1_payout_approvals (
              id, school_id, instructor_id, preview_fingerprint, approved_amount_pence,
              state, approved_by_admin_id, reason, evidence_reference
            ) VALUES (${crypto.randomUUID()}, ${schoolId}, ${instructorId}, ${preview.preview_fingerprint},
              ${preview.totals.proposed_transfer_pence}, 'approved', ${admin.id}, ${reason}, ${evidenceReference})
            RETURNING id, state, approved_amount_pence, preview_fingerprint
          `;
          await logAuditRequired(txSql, {
            adminId: admin.id, adminEmail: admin.email, action: 'payout.interim_v1_first_run_approved',
            targetType: 'instructor', targetId: instructorId, schoolId, req,
            details: { approval_id: created.id, preview_fingerprint: created.preview_fingerprint, approved_amount_pence: created.approved_amount_pence, reason, evidence_reference: evidenceReference, payouts_paused: true },
          });
          return created;
        });
        res.status(201).json({ ok: true, approval }); return true;
      }

      if (action === 'interim-v1-process-approved-payout') {
        if (req.body?.operator_go !== PROCESS_CONFIRMATION) throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${PROCESS_CONFIRMATION}`);
        const approvalId = String(req.body?.approval_id || '');
        const preview = await loadInterimV1Preview(sql, schoolId, instructorId);
        if (!preview.ready_for_approval) throw new InterimV1PayoutError(409, 'INTERIM_V1_PREVIEW_BLOCKED', `Preview is blocked: ${preview.blockers.join(', ')}`);
        const account = await stripe.accounts.retrieve(preview.instructor.stripe_account_id);
        if (account.livemode !== true || account.charges_enabled !== true || account.payouts_enabled !== true) {
          throw new InterimV1PayoutError(409, 'INTERIM_V1_CONNECT_NOT_READY', 'Live Connect account is not currently ready');
        }
        const prepared = await runTransaction(async (txSql) => {
          await txSql`SELECT pg_advisory_xact_lock(${schoolId}, ${instructorId})`;
          const [approval] = await txSql`SELECT * FROM interim_v1_payout_approvals WHERE id = ${approvalId} AND school_id = ${schoolId} AND instructor_id = ${instructorId} FOR UPDATE`;
          if (!approval || approval.state !== 'approved') throw new InterimV1PayoutError(409, 'INTERIM_V1_APPROVAL_NOT_OPEN', 'An open first-run approval is required');
          const [inst] = await txSql`SELECT * FROM instructors WHERE id = ${instructorId} AND school_id = ${schoolId} FOR UPDATE`;
          if (!inst || inst.payouts_paused !== true) throw new InterimV1PayoutError(409, 'INTERIM_V1_PAUSE_GUARD_REQUIRED', 'Instructor must remain paused');
          const lockedPreview = await loadInterimV1Preview(txSql, schoolId, instructorId);
          if (!lockedPreview.ready_for_approval || lockedPreview.preview_fingerprint !== approval.preview_fingerprint || lockedPreview.totals.proposed_transfer_pence !== Number(approval.approved_amount_pence)) {
            throw new InterimV1PayoutError(409, 'INTERIM_V1_STALE_APPROVAL', 'Approved evidence has changed; create a new reviewed approval');
          }
          const periodStart = lockedPreview.included[0].scheduled_date;
          const periodEnd = lockedPreview.included[lockedPreview.included.length - 1].scheduled_date;
          const persistenceLines = lockedPreview.included.map(payoutLinePersistenceProjection);
          const compatibilityValuePence = persistenceLines.reduce((sum, line) => sum + line.price_pence, 0);
          const compatibilityFeePence = persistenceLines.reduce((sum, line) => sum + line.stripe_fee_pence, 0);
          const semantics = new Set(persistenceLines.map(line => line.payout_value_semantics));
          const payoutValueSemantics = semantics.size === 1 ? [...semantics][0] : 'mixed';
          const authoritativeGrossPence = persistenceLines.every(line => Number.isSafeInteger(line.attributable_gross_pence))
            ? persistenceLines.reduce((sum, line) => sum + line.attributable_gross_pence, 0) : null;
          const authoritativeFeePence = persistenceLines.every(line => Number.isSafeInteger(line.actual_processing_fee_pence))
            ? persistenceLines.reduce((sum, line) => sum + line.actual_processing_fee_pence, 0) : null;
          const authoritativeNetPence = persistenceLines.every(line => Number.isSafeInteger(line.net_attributable_revenue_pence))
            ? persistenceLines.reduce((sum, line) => sum + line.net_attributable_revenue_pence, 0) : null;
          const [payout] = await txSql`
            INSERT INTO instructor_payouts (school_id, instructor_id, amount_pence, platform_fee_pence,
              franchise_fee_pence, stripe_fees_pence, period_start, period_end, status, shortfall_pence, deposit_deducted_pence,
              payout_calculation_version, payout_value_semantics, authoritative_gross_pence,
              authoritative_processing_fee_pence, authoritative_net_pence)
            VALUES (${schoolId}, ${instructorId}, ${lockedPreview.totals.proposed_transfer_pence},
              ${compatibilityValuePence - lockedPreview.totals.proposed_transfer_pence}, ${lockedPreview.totals.weekly_franchise_fee_pence},
              ${compatibilityFeePence}, ${periodStart}, ${periodEnd}, 'processing', 0, 0,
              ${CALCULATION_VERSION}, ${payoutValueSemantics}, ${authoritativeGrossPence},
              ${authoritativeFeePence}, ${authoritativeNetPence})
            RETURNING id
          `;
          for (let index = 0; index < lockedPreview.included.length; index += 1) {
            const line = lockedPreview.included[index];
            const persisted = persistenceLines[index];
            await txSql`INSERT INTO payout_line_items (
                school_id, payout_id, booking_id, price_pence, instructor_amount_pence,
                commission_rate, stripe_fee_pence, payout_value_semantics,
                attributable_gross_pence, actual_processing_fee_pence,
                net_attributable_revenue_pence, payout_calculation_version, funding_evidence_json
              ) VALUES (
                ${schoolId}, ${payout.id}, ${line.booking_id}, ${persisted.price_pence}, ${line.instructor_amount_pence},
                ${persisted.commission_rate}, ${persisted.stripe_fee_pence}, ${persisted.payout_value_semantics},
                ${persisted.attributable_gross_pence}, ${persisted.actual_processing_fee_pence},
                ${persisted.net_attributable_revenue_pence}, ${persisted.payout_calculation_version},
                ${JSON.stringify(persisted.funding_evidence_json)}::jsonb
              )`;
          }
          const intentId = crypto.randomUUID();
          const [intent] = await txSql`
            INSERT INTO interim_v1_transfer_intents (id, school_id, instructor_id, approval_id, payout_id,
              preview_fingerprint, amount_pence, currency, destination_account_id, idempotency_key, state)
            VALUES (${intentId}, ${schoolId}, ${instructorId}, ${approval.id}, ${payout.id}, ${lockedPreview.preview_fingerprint},
              ${lockedPreview.totals.proposed_transfer_pence}, 'gbp', ${inst.stripe_account_id}, ${`cc-interim-v1-transfer-${intentId}`}, 'submitting')
            RETURNING *
          `;
          await txSql`UPDATE interim_v1_payout_approvals SET state = 'submitting', updated_at = NOW() WHERE id = ${approval.id} AND school_id = ${schoolId}`;
          await logAuditRequired(txSql, {
            adminId: admin.id, adminEmail: admin.email, action: 'payout.interim_v1_transfer_requested', targetType: 'instructor', targetId: instructorId, schoolId, req,
            details: { approval_id: approval.id, transfer_intent_id: intent.id, payout_id: payout.id, amount_pence: intent.amount_pence, preview_fingerprint: intent.preview_fingerprint, payouts_paused: true },
          });
          return intent;
        });
        try {
          const transfer = validateTransfer(await stripe.transfers.create({
            amount: Number(prepared.amount_pence), currency: 'gbp', destination: prepared.destination_account_id,
            description: 'CoachCarter reviewed interim v1 payout',
            metadata: { cc_schema: PLANNER_VERSION, cc_interim_v1_transfer_intent_id: String(prepared.id), payout_id: String(prepared.payout_id), school_id: String(schoolId), instructor_id: String(instructorId) },
          }, { idempotencyKey: prepared.idempotency_key }), prepared);
          const transferId = await finalizeTransfer(runTransaction, req, admin, prepared, transfer, 'provider_succeeded');
          res.json({ ok: true, status: 'completed', transfer_id: transferId, payouts_paused: true }); return true;
        } catch (error) {
          const classification = classifyStripeError(error);
          const ambiguous = error instanceof InterimV1PayoutError || classification.retryable === true;
          await runTransaction(async (txSql) => {
            await recordTransferAttempt(txSql, prepared, ambiguous ? 'provider_ambiguous' : 'provider_failed_confirmed', {
              requestId: classification.requestId, errorClass: classification.category, errorCode: classification.code,
              evidence: { retryable: classification.retryable },
            });
            await txSql`UPDATE interim_v1_transfer_intents SET state = ${ambiguous ? 'reconciling' : 'failed_confirmed'}, last_provider_request_id = ${classification.requestId || null}, last_error_class = ${classification.category}, last_error_code = ${classification.code || null}, updated_at = NOW() WHERE id = ${prepared.id} AND school_id = ${schoolId}`;
            await txSql`UPDATE interim_v1_payout_approvals SET state = ${ambiguous ? 'reconciling' : 'failed_confirmed'}, updated_at = NOW() WHERE id = ${prepared.approval_id} AND school_id = ${schoolId}`;
            await txSql`UPDATE instructor_payouts SET status = 'failed', failure_reason = ${ambiguous ? 'Provider outcome ambiguous; reconcile same identity' : 'Provider rejected reviewed transfer'} WHERE id = ${prepared.payout_id} AND school_id = ${schoolId}`;
            await logAuditRequired(txSql, {
              adminId: admin.id, adminEmail: admin.email,
              action: ambiguous ? 'payout.interim_v1_transfer_ambiguous' : 'payout.interim_v1_transfer_failed_confirmed',
              targetType: 'instructor', targetId: instructorId, schoolId, req,
              details: { transfer_intent_id: prepared.id, payout_id: prepared.payout_id, error_class: classification.category, payouts_paused: true, claims_retained: true },
            });
          });
          res.status(ambiguous ? 202 : 502).json({ error: true, code: ambiguous ? 'INTERIM_V1_TRANSFER_RECONCILING' : 'INTERIM_V1_TRANSFER_FAILED_CONFIRMED', message: ambiguous ? 'Transfer outcome is uncertain; claims remain locked for same-identity reconciliation' : 'Stripe rejected the reviewed transfer; claims remain locked for operator review', payouts_paused: true }); return true;
        }
      }

      if (req.body?.operator_go !== RECONCILE_CONFIRMATION) throw new InterimV1PayoutError(400, 'OPERATOR_CONFIRMATION_REQUIRED', `operator_go must equal ${RECONCILE_CONFIRMATION}`);
      const intentId = String(req.body?.transfer_intent_id || '');
      const [intent] = await sql`SELECT * FROM interim_v1_transfer_intents WHERE id = ${intentId} AND school_id = ${schoolId} AND instructor_id = ${instructorId}`;
      if (!intent || intent.state !== 'reconciling') throw new InterimV1PayoutError(409, 'INTERIM_V1_TRANSFER_NOT_RECONCILING', 'A reconciling transfer intent is required');
      const matches = [];
      let startingAfter;
      for (let page = 0; page < 100; page += 1) {
        const params = { limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;
        const result = await stripe.transfers.list(params);
        for (const transfer of result.data || []) if (transfer?.metadata?.cc_interim_v1_transfer_intent_id === intent.id) matches.push(transfer);
        if (!result.has_more) break;
        startingAfter = result.data?.[result.data.length - 1]?.id;
        if (!startingAfter) throw new InterimV1PayoutError(409, 'INTERIM_V1_RECONCILIATION_INCOMPLETE', 'Transfer reconciliation could not advance safely');
      }
      if (matches.length === 1) {
        const transferId = await finalizeTransfer(runTransaction, req, admin, intent, validateTransfer(matches[0], intent), 'reconciled_existing');
        res.json({ ok: true, status: 'completed', transfer_id: transferId, payouts_paused: true }); return true;
      }
      await runTransaction(async (txSql) => {
        await recordTransferAttempt(txSql, intent, matches.length ? 'reconcile_multiple_matches' : 'reconcile_no_match', { evidence: { match_count: matches.length } });
        if (matches.length > 1) await txSql`UPDATE interim_v1_transfer_intents SET state = 'manual_review', updated_at = NOW() WHERE id = ${intent.id} AND school_id = ${schoolId} AND state = 'reconciling'`;
        await logAuditRequired(txSql, {
          adminId: admin.id, adminEmail: admin.email, action: 'payout.interim_v1_transfer_reconciliation_checked',
          targetType: 'instructor', targetId: instructorId, schoolId, req,
          details: { transfer_intent_id: intent.id, match_count: matches.length, replacement_submitted: false, payouts_paused: true },
        });
      });
      res.status(202).json({ ok: false, code: matches.length ? 'INTERIM_V1_TRANSFER_MANUAL_REVIEW' : 'INTERIM_V1_TRANSFER_RECONCILING', message: 'No replacement transfer was submitted', payouts_paused: true }); return true;
    } catch (error) {
      if (!(error instanceof InterimV1PayoutError)) {
        console.error('[interim-v1-payout] operation failed', {
          action,
          school_id: schoolId,
          instructor_id: instructorId,
          error_name: error?.name || 'Error',
          error_code: error?.code || null,
        });
      }
      const failure = interimV1PayoutFailureResponse(error);
      res.status(failure.status).json({ error: true, code: failure.code, message: failure.message });
      return true;
    }
  };
}

module.exports = {
  ACTIONS, MANUAL_BOUNDARY_CONFIRMATION, APPROVE_CONFIRMATION, PROCESS_CONFIRMATION,
  RECONCILE_CONFIRMATION, RECONCILE_FUNDING_CONFIRMATION, RECORD_FUNDING_BASIS_CONFIRMATION,
  InterimV1PayoutError, allocateInstructorAmounts, buildPreviewFromRows,
  classifyFundingRow, createInterimV1PayoutHandler, evidenceRecord, fingerprint,
  payoutLinePersistenceProjection,
  directEvidenceObservation, flexibleEvidenceObservation, recordDirectEvidenceObservation,
  recordFlexibleSourceEvidence, validateAuditedFundingBasis,
  interimV1PayoutFailureResponse,
  loadInterimV1Preview, recordInterimV1FundingEvidence, stableJson,
  validateManualBoundaryDates, validateTransfer,
};
