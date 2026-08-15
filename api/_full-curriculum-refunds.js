'use strict';

const crypto = require('crypto');
const {
  calculateRefund,
  normaliseConsumerRightsConfig,
  sha256,
} = require('./_full-curriculum-consumer-rights');

function clientSqlTag(client) {
  return async (strings, ...values) => {
    const text = strings.reduce(
      (query, part, index) => query + (index === 0 ? '' : `$${index}`) + part,
      ''
    );
    return (await client.query(text, values)).rows;
  };
}

function makeError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function safeReason(value) {
  const reason = String(value || '').trim();
  return reason.length >= 2 && reason.length <= 1000 ? reason : null;
}

async function loadExistingCase(sql, schoolId, requestId) {
  const rows = await sql`
    SELECT c.*
      FROM full_curriculum_refund_cases c
     WHERE c.school_id = ${schoolId}
       AND c.termination_request_id = ${requestId}::uuid
     LIMIT 1
  `;
  return rows[0] || null;
}

async function requestProgrammeTermination({
  connectionString,
  schoolId,
  actorId,
  actorType,
  learnerId = null,
  enrolmentId,
  requestId,
  requestKind,
  channel,
  reason,
  receivedAt = new Date(),
  transactionRunner = null,
}) {
  if (!validUuid(requestId)) throw makeError('INVALID_TERMINATION_REQUEST_ID', 'A valid cancellation request identity is required', 400);
  if (!Number.isSafeInteger(Number(enrolmentId)) || Number(enrolmentId) <= 0) throw makeError('INVALID_ENROLMENT', 'A valid programme is required', 400);
  if (!['learner_cancellation', 'matching_failure', 'provider_nonfulfilment'].includes(requestKind)) {
    throw makeError('INVALID_TERMINATION_KIND', 'The cancellation reason category is not supported', 400);
  }
  if (!['self_service', 'email', 'post', 'phone', 'admin_recorded'].includes(channel)) {
    throw makeError('INVALID_TERMINATION_CHANNEL', 'A supported cancellation channel is required', 400);
  }
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime()) || received.getTime() > Date.now() + 60_000) {
    throw makeError('INVALID_TERMINATION_TIME', 'The cancellation received time is invalid', 400);
  }
  const cleanedReason = reason == null || String(reason).trim() === '' ? null : safeReason(reason);
  if (reason != null && String(reason).trim() !== '' && !cleanedReason) {
    throw makeError('INVALID_TERMINATION_REASON', 'The optional reason must be between 2 and 1000 characters', 400);
  }
  const run = transactionRunner || ((work) => {
    const { withNeonTransaction } = require('./_db-transaction');
    return withNeonTransaction(connectionString, async client => work(clientSqlTag(client)));
  });
  return run(async (sql) => {
    const existing = await loadExistingCase(sql, schoolId, requestId);
    if (existing) return { refundCase: existing, idempotent: true };

    const rows = await sql`
      SELECT e.*, p.attempt_id, p.amount_pence, p.currency, p.product_snapshot,
             p.customer_terms_version, p.stripe_payment_intent_id,
             COALESCE(NULLIF(attempt.eligibility_snapshot->>'timezone', ''), 'Europe/London') AS operational_timezone,
             evidence.early_start_requested AS evidenced_early_start,
             evidence.disclosure_version, evidence.refund_calculation_version,
             m.status AS matching_status
        FROM full_curriculum_enrolments e
        JOIN learner_package_purchases p
          ON p.id = e.purchase_id AND p.school_id = ${schoolId}
        JOIN package_purchase_attempts attempt
          ON attempt.id = p.attempt_id AND attempt.school_id = ${schoolId}
        LEFT JOIN full_curriculum_consumer_contract_evidence evidence
          ON evidence.attempt_id = p.attempt_id AND evidence.school_id = ${schoolId}
        LEFT JOIN full_curriculum_matching_records m
          ON m.enrolment_id = e.id AND m.school_id = ${schoolId}
       WHERE e.id = ${Number(enrolmentId)}
         AND e.school_id = ${schoolId}
         AND (${learnerId == null} OR e.learner_id = ${learnerId})
       FOR UPDATE OF e
    `;
    const programme = rows[0];
    if (!programme) throw makeError('PROGRAMME_NOT_FOUND', 'The Full Curriculum programme was not found in this school', 404);
    if (['completed', 'withdrawn'].includes(programme.status)) {
      throw makeError('PROGRAMME_NOT_CANCELLABLE', 'This programme is already completed or withdrawn');
    }
    const configResult = normaliseConsumerRightsConfig(programme.product_snapshot, programme.amount_pence);
    if (!configResult.ok || !programme.contract_formed_at || !programme.cooling_off_expires_at) {
      throw makeError('CONSUMER_CONTRACT_EVIDENCE_INCOMPLETE', 'The immutable consumer-contract evidence is incomplete; manual legal review is required');
    }
    if (requestKind === 'matching_failure') {
      if (received < new Date(programme.matching_deadline)
          || ['accepted', 'started'].includes(programme.matching_status)) {
        throw makeError('MATCHING_FAILURE_NOT_ESTABLISHED', 'The seven-day matching deadline has not failed on the recorded evidence');
      }
    }

    const [weeklyRows, assessmentRows, retakeRows, previousRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'used' AND updated_at <= ${received.toISOString()}::timestamptz)::int AS delivered_count,
          COUNT(*) FILTER (WHERE status = 'used_late_cancel' AND updated_at <= ${received.toISOString()}::timestamptz)::int AS late_cancelled_count
          FROM full_curriculum_weekly_opportunities
         WHERE school_id = ${schoolId} AND enrolment_id = ${Number(enrolmentId)}
      `,
      sql`
        SELECT COUNT(*)::int AS completed_count
          FROM full_curriculum_assessments
         WHERE school_id = ${schoolId} AND enrolment_id = ${Number(enrolmentId)}
           AND assessed_at <= ${received.toISOString()}::timestamptz
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE a.allocated_minutes = 90)::int AS delivered_90_count,
          COUNT(*) FILTER (WHERE a.allocated_minutes = 120)::int AS delivered_120_count
          FROM full_curriculum_booking_allocations a
          JOIN lesson_bookings b
            ON b.id = a.lesson_booking_id AND b.school_id = ${schoolId}
         WHERE a.school_id = ${schoolId}
           AND a.enrolment_id = ${Number(enrolmentId)}
           AND a.allocation_type = 'retake_lesson'
           AND b.status = 'chargeable'
           AND b.scheduled_date + b.end_time <= (
             ${received.toISOString()}::timestamptz AT TIME ZONE ${programme.operational_timezone}
           )
      `,
      sql`
        SELECT COALESCE(SUM(refund_due_pence), 0)::int AS refunded_pence
          FROM full_curriculum_refund_cases
         WHERE school_id = ${schoolId}
           AND purchase_id = ${programme.purchase_id}
           AND status = 'provider_succeeded'
      `,
    ]);
    const withinCoolingOff = received < new Date(programme.cooling_off_expires_at);
    const classification = requestKind === 'matching_failure'
      ? 'matching_failure'
      : requestKind === 'provider_nonfulfilment'
        ? 'provider_nonfulfilment'
        : withinCoolingOff ? 'cooling_off_cancellation' : 'voluntary_withdrawal';
    const calculation = calculateRefund({
      amountPence: Number(programme.amount_pence),
      previousRefundPence: Number(previousRows[0]?.refunded_pence || 0),
      classification,
      validEarlyStartRequest: programme.evidenced_early_start === true,
      baseDeliveredCount: Number(weeklyRows[0]?.delivered_count || 0),
      baseLateCancelledCount: Number(weeklyRows[0]?.late_cancelled_count || 0),
      retake90DeliveredCount: Number(retakeRows[0]?.delivered_90_count || 0),
      retake120DeliveredCount: Number(retakeRows[0]?.delivered_120_count || 0),
      assessmentCompletedCount: Number(assessmentRows[0]?.completed_count || 0),
      config: configResult.config,
    });
    if (!calculation.ok) throw makeError(calculation.code, 'The refund calculation could not be completed from trusted evidence');

    const terminationSnapshot = {
      request_id: requestId,
      enrolment_id: Number(enrolmentId),
      purchase_id: Number(programme.purchase_id),
      request_kind: requestKind,
      classification,
      channel,
      received_at: received.toISOString(),
      contract_formed_at: programme.contract_formed_at,
      cooling_off_expires_at: programme.cooling_off_expires_at,
      early_start_requested: programme.evidenced_early_start === true,
      matching_deadline: programme.matching_deadline,
      matching_status: programme.matching_status,
      counts: {
        base_delivered: Number(weeklyRows[0]?.delivered_count || 0),
        base_late_cancelled: Number(weeklyRows[0]?.late_cancelled_count || 0),
        retake_90_delivered: Number(retakeRows[0]?.delivered_90_count || 0),
        retake_120_delivered: Number(retakeRows[0]?.delivered_120_count || 0),
        assessments_completed: Number(assessmentRows[0]?.completed_count || 0),
      },
      calculation,
      manual_review_reasons: ['STRIPE_FEE_EVIDENCE_MISSING'],
    };
    const fingerprint = sha256(JSON.stringify(terminationSnapshot));
    const refundCaseId = crypto.randomUUID();
    const eventActorType = actorType === 'learner' ? 'system' : actorType;
    const eventActorId = actorType === 'learner' ? null : actorId;
    await sql`
      INSERT INTO full_curriculum_termination_requests (
        id, school_id, enrolment_id, learner_id, request_kind, channel,
        reason, actor_type, actor_id, received_at
      ) VALUES (
        ${requestId}::uuid, ${schoolId}, ${Number(enrolmentId)}, ${programme.learner_id},
        ${requestKind}, ${channel}, ${cleanedReason}, ${actorType}, ${actorId},
        ${received.toISOString()}::timestamptz
      )
    `;
    const caseRows = await sql`
      INSERT INTO full_curriculum_refund_cases (
        id, school_id, enrolment_id, purchase_id, learner_id,
        termination_request_id, classification, status, calculation_version,
        calculation_fingerprint, calculation_snapshot, original_payment_pence,
        previous_refund_pence, deduction_pence, refund_due_pence
      ) VALUES (
        ${refundCaseId}::uuid, ${schoolId}, ${Number(enrolmentId)},
        ${programme.purchase_id}, ${programme.learner_id}, ${requestId}::uuid,
        ${classification}, 'manual_review', ${calculation.calculation_version},
        ${fingerprint}, ${JSON.stringify(terminationSnapshot)}::jsonb,
        ${calculation.original_payment_pence}, ${calculation.previous_refund_pence},
        ${calculation.deduction_pence}, ${calculation.refund_due_pence}
      )
      RETURNING *
    `;
    for (let index = 0; index < calculation.lines.length; index += 1) {
      const line = calculation.lines[index];
      await sql`
        INSERT INTO full_curriculum_refund_lines (
          school_id, refund_case_id, line_number, line_type, quantity,
          unit_value_pence, cap_pence, deduction_pence, evidence_snapshot
        ) VALUES (
          ${schoolId}, ${refundCaseId}::uuid, ${index + 1}, ${line.line_type},
          ${line.quantity}, ${line.unit_value_pence}, ${line.cap_pence},
          ${line.deduction_pence}, ${JSON.stringify(line.detail || {})}::jsonb
        )
      `;
    }
    await sql`
      INSERT INTO full_curriculum_refund_case_events (
        school_id, refund_case_id, from_status, to_status, actor_type, actor_id, detail
      ) VALUES (
        ${schoolId}, ${refundCaseId}::uuid, NULL, 'manual_review',
        ${eventActorType}, ${eventActorId},
        ${JSON.stringify({ request_kind: requestKind, classification, received_at: received.toISOString() })}::jsonb
      )
    `;
    await sql`
      INSERT INTO full_curriculum_progress_events (
        school_id, enrolment_id, phase_number, event_type, actor_type, actor_id, detail
      ) VALUES (
        ${schoolId}, ${Number(enrolmentId)}, ${programme.current_phase}, 'withdrawn',
        ${eventActorType}, ${eventActorId},
        ${JSON.stringify({ termination_request_id: requestId, refund_case_id: refundCaseId, classification })}::jsonb
      )
    `;
    await sql`
      UPDATE full_curriculum_enrolments
         SET status = 'withdrawn', withdrawn_at = ${received.toISOString()}::timestamptz,
             updated_at = NOW()
       WHERE id = ${Number(enrolmentId)} AND school_id = ${schoolId}
    `;
    return { refundCase: caseRows[0], calculation, idempotent: false };
  });
}

async function listRefundCases(sql, schoolId, learnerId = null) {
  const rows = await sql`
    SELECT c.*, r.request_kind, r.channel, r.reason, r.received_at,
           lu.name AS learner_name, lu.email AS learner_email,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'line_type', line.line_type,
               'quantity', line.quantity,
               'unit_value_pence', line.unit_value_pence,
               'cap_pence', line.cap_pence,
               'deduction_pence', line.deduction_pence,
               'evidence', line.evidence_snapshot
             ) ORDER BY line.line_number)
               FROM full_curriculum_refund_lines line
              WHERE line.school_id = ${schoolId} AND line.refund_case_id = c.id
           ), '[]'::jsonb) AS lines
      FROM full_curriculum_refund_cases c
      JOIN full_curriculum_termination_requests r
        ON r.id = c.termination_request_id AND r.school_id = ${schoolId}
      LEFT JOIN learner_users lu
        ON lu.id = c.learner_id AND lu.school_id = ${schoolId}
     WHERE c.school_id = ${schoolId}
       AND (${learnerId == null} OR c.learner_id = ${learnerId})
     ORDER BY c.created_at DESC
     LIMIT 200
  `;
  return rows;
}

module.exports = {
  clientSqlTag,
  listRefundCases,
  requestProgrammeTermination,
  safeReason,
  validUuid,
};
