const { planAdminRefundPreview, validateRefundPreviewRequest } = require('./_refund-planner');
const { logAudit } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');

const MANUAL_BANK_OPERATOR_GO = 'RECORD_MANUAL_BANK_REFUND_CONFIRMED';

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function validateManualBankRefundRequest(body = {}, { schoolId } = {}) {
  const validated = validateRefundPreviewRequest(body, { schoolId });
  if (!validated.ok) return validated;

  const idempotencyKey = cleanText(body.idempotency_key);
  if (!idempotencyKey || idempotencyKey.length > 180) {
    return validationError('IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required and must be 180 characters or fewer.');
  }

  const reason = cleanText(body.reason);
  if (!reason || reason.length > 1000) {
    return validationError('MANUAL_REASON_REQUIRED', 'A manual bank refund reason is required and must be 1000 characters or fewer.');
  }

  const manualBankReference = cleanText(body.manual_bank_reference);
  if (!manualBankReference || manualBankReference.length > 180) {
    return validationError('MANUAL_BANK_REFERENCE_REQUIRED', 'manual_bank_reference is required and must be 180 characters or fewer.');
  }

  const operatorNote = cleanText(body.operator_note);
  if (operatorNote && operatorNote.length > 1000) {
    return validationError('MANUAL_OPERATOR_NOTE_TOO_LONG', 'operator_note must be 1000 characters or fewer.');
  }

  const evidenceReference = cleanText(body.evidence_reference);
  if (evidenceReference && evidenceReference.length > 500) {
    return validationError('MANUAL_EVIDENCE_REFERENCE_TOO_LONG', 'evidence_reference must be 500 characters or fewer.');
  }

  if (body.operator_go !== MANUAL_BANK_OPERATOR_GO) {
    return validationError(
      'OPERATOR_GO_REQUIRED',
      `record-manual-bank-refund requires operator_go="${MANUAL_BANK_OPERATOR_GO}".`,
      409
    );
  }

  return {
    ok: true,
    input: {
      ...validated.input,
      reason,
      idempotencyKey,
      operatorGo: body.operator_go,
      manualBankReference,
      operatorNote,
      evidenceReference,
    },
  };
}

function normalizeStripeIds(plan = {}) {
  const stripe = plan.stripe || {};
  const evidence = plan.fee_evidence || {};
  return {
    stripePaymentIntentId: stripe.stripePaymentIntentId || stripe.paymentIntentId || evidence.paymentIntentId || null,
    stripeChargeId: stripe.stripeChargeId || stripe.chargeId || evidence.chargeId || null,
    stripeSessionId: stripe.stripeSessionId || stripe.sessionId || null,
    stripeBalanceTransactionId: evidence.balanceTransactionId || null,
  };
}

async function fetchExistingRefund(sql, { schoolId, idempotencyKey }) {
  const rows = await sql`
    SELECT id, school_id, learner_id, created_by, refund_type, status,
           gross_refund_pence, processing_fee_withheld_pence, net_refund_pence,
           stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
           stripe_balance_transaction_id, idempotency_key, reason, metadata,
           created_at
      FROM refund_events
     WHERE school_id = ${schoolId}
       AND idempotency_key = ${idempotencyKey}
     LIMIT 1
  `;
  const event = rows[0] || null;
  if (!event) return null;

  const lines = await sql`
    SELECT id, school_id, refund_event_id, credit_transaction_id,
           booking_credit_source_id, lesson_booking_id,
           credit_source_adjustment_id, gross_pence_removed,
           source_fee_pence_used, fee_withheld_pence, net_refund_pence,
           minutes_adjusted, created_at
      FROM refund_event_lines
     WHERE school_id = ${schoolId}
       AND refund_event_id = ${event.id}
     ORDER BY id ASC
  `;
  return { ...event, lines };
}

function isCompleteManualBankEvent(event) {
  if (!event || event.status !== 'executed') return false;
  const metadata = event.metadata || {};
  if (metadata.refund_channel !== 'manual_bank') return false;
  const lines = Array.isArray(event.lines) ? event.lines : [];
  return lines.length > 0;
}

function manualBankRequestFingerprint(input = {}) {
  return normalizeManualBankRequestFingerprint({
    school_id: input.schoolId || null,
    refund_type: input.refundType || null,
    credit_transaction_id: input.creditTransactionId || null,
    booking_credit_source_id: input.bookingCreditSourceId || null,
    lesson_booking_id: input.lessonBookingId || null,
    gross_refund_pence: input.grossRefundPence == null ? null : input.grossRefundPence,
    refunded_minutes: input.refundedMinutes == null ? null : input.refundedMinutes,
    reason: input.reason || null,
    manual_bank_reference: input.manualBankReference || null,
    operator_note: input.operatorNote || null,
    evidence_reference: input.evidenceReference || null,
  });
}

function normalizeManualBankRequestFingerprint(value = {}) {
  return {
    school_id: value.school_id || null,
    refund_type: value.refund_type || null,
    credit_transaction_id: value.credit_transaction_id || null,
    booking_credit_source_id: value.booking_credit_source_id || null,
    lesson_booking_id: value.lesson_booking_id || null,
    gross_refund_pence: value.gross_refund_pence == null ? null : value.gross_refund_pence,
    refunded_minutes: value.refunded_minutes == null ? null : value.refunded_minutes,
    reason: value.reason || null,
    manual_bank_reference: value.manual_bank_reference || null,
    operator_note: value.operator_note || null,
    evidence_reference: value.evidence_reference || null,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

function manualBankRequestMatches(event, input) {
  if (!isCompleteManualBankEvent(event)) return false;
  const metadata = event.metadata || {};
  if (!metadata.manual_bank_request) return false;
  return stableStringify(normalizeManualBankRequestFingerprint(metadata.manual_bank_request)) === stableStringify(manualBankRequestFingerprint(input));
}

function clientSqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const result = await client.query(text, values);
    return result.rows || [];
  };
}

async function runLedgerTransaction({ sql, connectionString, transactionRunner }, callback) {
  if (transactionRunner) return transactionRunner(callback);
  if (connectionString) {
    return withNeonTransaction(connectionString, async (client) => callback(clientSqlTag(client)));
  }
  return callback(sql);
}

function manualBankBlockReason(plan) {
  if (!plan || !plan.ok) return plan || validationError('REFUND_PREVIEW_FAILED', 'Refund preview could not be prepared.');
  if (plan.recommended_operator_action === 'execute_eligible' && !plan.blocked && !plan.manual_review_required) {
    return validationError('MANUAL_BANK_NOT_ALLOWED_FOR_CLEAN_PREVIEW', 'Clean original-method refunds must use execute-refund, not manual bank recording.', 409);
  }
  if (Number(plan.net_refund_pence || 0) <= 0) {
    return validationError('ZERO_NET_REFUND', 'Manual bank refund records require a positive returned amount.', 409);
  }
  if (!Array.isArray(plan.lines) || plan.lines.length < 1) {
    return validationError('PREVIEW_LINES_REQUIRED', 'Manual bank refund records require preview ledger line evidence.', 409);
  }
  return null;
}

async function writeManualBankLedger(sql, { plan, input, admin, connectionString, transactionRunner }) {
  const learnerId = (plan.lines || []).find((line) => line.learner_id)?.learner_id || null;
  const stripeIds = normalizeStripeIds(plan);

  return runLedgerTransaction({ sql, connectionString, transactionRunner }, async (txSql) => {
    const eventRows = await txSql`
      INSERT INTO refund_events
        (school_id, learner_id, created_by, refund_type, status,
         gross_refund_pence, processing_fee_withheld_pence, net_refund_pence,
         stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
         stripe_balance_transaction_id, idempotency_key, reason, metadata)
      VALUES
        (${input.schoolId}, ${learnerId}, ${admin.id}, ${plan.refund_type}, 'executed',
         ${plan.gross_refund_pence}, ${plan.processing_fee_withheld_pence}, ${plan.net_refund_pence},
         ${stripeIds.stripePaymentIntentId}, ${stripeIds.stripeChargeId}, ${null},
         ${stripeIds.stripeBalanceTransactionId}, ${input.idempotencyKey}, ${input.reason},
         ${JSON.stringify({
           refund_channel: 'manual_bank',
           manual_bank_reference: input.manualBankReference,
           operator_note: input.operatorNote || null,
           evidence_reference: input.evidenceReference || null,
           fee_evidence: plan.fee_evidence || null,
           manual_bank_request: manualBankRequestFingerprint(input),
           warnings: plan.warnings || [],
           preview_code: plan.code || null,
           preview_message: plan.message || null,
           recommended_operator_action: plan.recommended_operator_action || null,
           stripe_session_id: stripeIds.stripeSessionId || null,
         })})
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING id
    `;

    const refundEventId = eventRows[0]?.id;
    if (!refundEventId) {
      const existing = await fetchExistingRefund(txSql, {
        schoolId: input.schoolId,
        idempotencyKey: input.idempotencyKey,
      });
      if (manualBankRequestMatches(existing, input)) {
        return {
          ok: true,
          idempotent_replay: true,
          manual_bank_recorded: false,
          refund_event: existing,
        };
      }
      return validationError(
        'IDEMPOTENCY_KEY_COLLISION',
        'A prior refund event exists for this idempotency key but does not match the current manual bank request; manual investigation is required.',
        409
      );
    }

    for (const line of plan.lines || []) {
      await txSql`
        INSERT INTO refund_event_lines
          (school_id, refund_event_id, credit_transaction_id,
           booking_credit_source_id, lesson_booking_id, credit_source_adjustment_id,
           gross_pence_removed, source_fee_pence_used, fee_withheld_pence,
           net_refund_pence, minutes_adjusted)
        VALUES
          (${input.schoolId}, ${refundEventId}, ${line.credit_transaction_id},
           ${line.booking_credit_source_id}, ${line.lesson_booking_id}, ${null},
           ${line.gross_pence_removed}, ${line.source_fee_pence_used}, ${line.fee_withheld_pence},
           ${line.net_refund_pence}, ${line.minutes_adjusted || 0})
      `;
    }

    return {
      ok: true,
      idempotent_replay: false,
      manual_bank_recorded: true,
      refund_event: await fetchExistingRefund(txSql, {
        schoolId: input.schoolId,
        idempotencyKey: input.idempotencyKey,
      }),
    };
  });
}

async function recordManualBankRefund({
  sql,
  stripe,
  admin,
  input,
  req,
  planner = planAdminRefundPreview,
  auditLogger = logAudit,
  connectionString,
  transactionRunner,
} = {}) {
  if (!sql) throw new Error('sql client required');
  if (!admin) throw new Error('admin required');
  if (!input) throw new Error('input required');

  const existing = await fetchExistingRefund(sql, {
    schoolId: input.schoolId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    if (!manualBankRequestMatches(existing, input)) {
      return validationError(
        'IDEMPOTENCY_KEY_COLLISION',
        'A prior manual bank refund event exists for this idempotency key but does not match the current request; manual investigation is required.',
        409
      );
    }
    return {
      ok: true,
      idempotent_replay: true,
      manual_bank_recorded: false,
      refund_event: existing,
    };
  }

  const plan = await planner({ sql, stripe, input });
  const blockReason = manualBankBlockReason(plan);
  if (blockReason) {
    return {
      ...blockReason,
      ok: false,
      manual_bank_recorded: false,
    };
  }

  const written = await writeManualBankLedger(sql, {
    plan,
    input,
    admin,
    connectionString,
    transactionRunner,
  });
  if (!written.ok) return written;

  if (written.manual_bank_recorded) {
    await auditLogger(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.record_manual_bank_refund',
      targetType: 'refund_event',
      targetId: written.refund_event?.id || null,
      schoolId: input.schoolId,
      req,
      details: {
        refund_type: plan.refund_type,
        idempotency_key: input.idempotencyKey,
        manual_bank_reference: input.manualBankReference,
        operator_note: input.operatorNote || null,
        evidence_reference: input.evidenceReference || null,
        gross_refund_pence: plan.gross_refund_pence,
        processing_fee_withheld_pence: plan.processing_fee_withheld_pence,
        net_refund_pence: plan.net_refund_pence,
        preview_code: plan.code || null,
        recommended_operator_action: plan.recommended_operator_action || null,
      },
    });
  }

  return written;
}

module.exports = {
  MANUAL_BANK_OPERATOR_GO,
  recordManualBankRefund,
  validateManualBankRefundRequest,
};
