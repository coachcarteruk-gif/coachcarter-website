'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAuditRequired } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');
const { classifyStripeError } = require('./_stripe-clients');

const ACTIONS = new Set([
  'interim-v1-payout-preview',
  'interim-v1-approve-first-run',
  'interim-v1-process-approved-payout',
  'interim-v1-reconcile-transfer',
]);
const APPROVE_CONFIRMATION = 'APPROVE_INTERIM_V1_FIRST_RUN_CONFIRMED';
const PROCESS_CONFIRMATION = 'PROCESS_INTERIM_V1_APPROVED_PAYOUT_CONFIRMED';
const RECONCILE_CONFIRMATION = 'RECONCILE_INTERIM_V1_TRANSFER_CONFIRMED';
const PLANNER_VERSION = 'interim-v1-payout/1';

class InterimV1PayoutError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'InterimV1PayoutError';
    this.status = status;
    this.code = code;
  }
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
  const commissionRate = Number(instructor.commission_rate) || 0.85;
  const lines = included.map((line) => ({ ...line }));
  const gross = lines.reduce((sum, line) => sum + line.gross_pence, 0);
  const fees = lines.reduce((sum, line) => sum + line.stripe_fee_pence, 0);
  let proposed;
  if (franchiseFee != null) {
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
      line.instructor_amount_pence = Math.max(0, Math.round(line.gross_pence * commissionRate) - line.stripe_fee_pence);
      line.commission_rate = commissionRate;
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
  };
}

function buildPreviewFromRows(instructor, rows, now = new Date()) {
  const included = [];
  const excluded = [];
  for (const row of rows) {
    const classification = classifyFundingRow(row, now);
    const identity = {
      booking_id: Number(row.booking_id),
      scheduled_date: dateOnly(row.scheduled_date),
      learner_name: row.learner_name || null,
      checkout_session_id: row.stripe_checkout_session_id || null,
      payment_intent_id: row.stripe_payment_intent_id || null,
      charge_id: row.stripe_charge_id || null,
      balance_transaction_id: row.stripe_balance_transaction_id || null,
      funding_evidence_id: row.evidence_id || null,
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
  if (!included.length) blockers.push('NO_ELIGIBLE_LESSONS');
  if (totals.insufficient_week) blockers.push('INSUFFICIENT_WEEK_MANUAL_HANDLING');
  const canonical = {
    planner_version: PLANNER_VERSION,
    school_id: Number(instructor.school_id),
    instructor_id: Number(instructor.id),
    payouts_start_date: dateOnly(instructor.payouts_start_date),
    stripe_account_id: instructor.stripe_account_id || null,
    weekly_franchise_fee_pence: totals.weekly_franchise_fee_pence,
    commission_rate: totals.commission_rate,
    included: totals.lines.map((line) => ({
      booking_id: line.booking_id,
      scheduled_date: line.scheduled_date,
      funding_evidence_id: line.funding_evidence_id,
      checkout_session_id: line.checkout_session_id,
      payment_intent_id: line.payment_intent_id,
      charge_id: line.charge_id,
      balance_transaction_id: line.balance_transaction_id,
      gross_pence: line.gross_pence,
      stripe_fee_pence: line.stripe_fee_pence,
      instructor_amount_pence: line.instructor_amount_pence,
    })),
    excluded: excluded.map((line) => ({ booking_id: line.booking_id, reason: line.reason })),
    proposed_transfer_pence: totals.proposed_transfer_pence,
    blockers,
  };
  return {
    planner_version: PLANNER_VERSION,
    instructor: {
      id: Number(instructor.id), name: instructor.name, school_id: Number(instructor.school_id),
      payouts_start_date: dateOnly(instructor.payouts_start_date), payouts_paused: instructor.payouts_paused,
      stripe_account_id: instructor.stripe_account_id || null,
      stripe_onboarding_complete: instructor.stripe_onboarding_complete === true,
    },
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
           i.payouts_start_date, c.id AS control_id
      FROM instructors i
      LEFT JOIN interim_v1_instructor_controls c
        ON c.school_id = i.school_id AND c.instructor_id = i.id
     WHERE i.id = ${instructorId} AND i.school_id = ${schoolId}
     LIMIT 1
  `;
  if (!instructor) throw new InterimV1PayoutError(404, 'NOT_FOUND', 'Instructor not found');
  const rows = await sql`
    SELECT lb.id AS booking_id, lb.scheduled_date, lb.status, lu.name AS learner_name,
           COALESCE(lu.is_test_account, FALSE) AS is_test_account,
           c.payouts_start_date, e.id AS evidence_id, e.payment_origin,
           e.provider_livemode, e.stripe_checkout_session_id, e.stripe_payment_intent_id,
           e.stripe_payment_intent_status, e.stripe_charge_id, e.stripe_charge_paid,
           e.stripe_charge_captured, e.stripe_charge_payment_intent_id,
           e.stripe_balance_transaction_id, e.stripe_balance_transaction_source_id,
           e.stripe_balance_transaction_type, e.stripe_balance_transaction_amount_pence,
           e.stripe_balance_transaction_currency, e.stripe_balance_transaction_status,
           e.stripe_payment_created_at, e.stripe_funds_available_at,
           e.gross_collected_pence, e.stripe_fee_pence, e.currency, e.evidence_status,
           bcs.id AS bcs_id, bcs.contribution_pence AS bcs_contribution_pence,
           bcs.stripe_fee_pence AS bcs_stripe_fee_pence, bcs.refunded_at AS bcs_refunded_at,
           bcs.absorbed_by AS bcs_absorbed_by, source_counts.bcs_count,
           ct.type AS ct_type, ct.source AS ct_source, ct.payment_method AS ct_payment_method,
           ct.amount_pence AS ct_amount_pence, ct.stripe_fee_pence AS ct_stripe_fee_pence,
           ct.stripe_session_id AS ct_session_id, ct.stripe_payment_intent_id AS ct_payment_intent_id,
           pli.payout_id AS claimed_payout_id
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
      JOIN interim_v1_instructor_controls c
        ON c.school_id = lb.school_id AND c.instructor_id = lb.instructor_id
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
      LEFT JOIN payout_line_items pli ON pli.booking_id = lb.id
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

function createInterimV1PayoutHandler({ stripe, connectionString = process.env.POSTGRES_URL, sql: injectedSql = null, transactionRunner } = {}) {
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
          const [payout] = await txSql`
            INSERT INTO instructor_payouts (school_id, instructor_id, amount_pence, platform_fee_pence,
              franchise_fee_pence, stripe_fees_pence, period_start, period_end, status, shortfall_pence, deposit_deducted_pence)
            VALUES (${schoolId}, ${instructorId}, ${lockedPreview.totals.proposed_transfer_pence},
              ${lockedPreview.totals.gross_pence - lockedPreview.totals.proposed_transfer_pence}, ${lockedPreview.totals.weekly_franchise_fee_pence},
              ${lockedPreview.totals.stripe_fees_pence}, ${periodStart}, ${periodEnd}, 'processing', 0, 0)
            RETURNING id
          `;
          for (const line of lockedPreview.included) {
            await txSql`INSERT INTO payout_line_items (payout_id, booking_id, price_pence, instructor_amount_pence, commission_rate, stripe_fee_pence)
              VALUES (${payout.id}, ${line.booking_id}, ${line.gross_pence}, ${line.instructor_amount_pence}, ${line.commission_rate}, ${line.stripe_fee_pence})`;
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
      const status = error instanceof InterimV1PayoutError ? error.status : 500;
      res.status(status).json({ error: true, code: error.code || 'INTERIM_V1_PAYOUT_FAILED', message: error instanceof InterimV1PayoutError ? error.message : 'Interim v1 payout operation failed' });
      return true;
    }
  };
}

module.exports = {
  ACTIONS, APPROVE_CONFIRMATION, PROCESS_CONFIRMATION, RECONCILE_CONFIRMATION,
  InterimV1PayoutError, allocateInstructorAmounts, buildPreviewFromRows,
  classifyFundingRow, createInterimV1PayoutHandler, evidenceRecord, fingerprint,
  loadInterimV1Preview, recordInterimV1FundingEvidence, stableJson, validateTransfer,
};
