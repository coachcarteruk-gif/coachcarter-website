const { planAdminRefundPreview, validateRefundPreviewRequest } = require('./_refund-planner');
const { lockBalanceAdjustLCB } = require('./_credit-grant');
const { logAudit } = require('./_audit');
const { withNeonTransaction } = require('./_db-transaction');

const EXECUTE_OPERATOR_GO = 'EXECUTE_REFUND_CONFIRMED';

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function validateRefundExecuteRequest(body = {}, { schoolId } = {}) {
  const validated = validateRefundPreviewRequest(body, { schoolId });
  if (!validated.ok) return validated;

  const idempotencyKey = cleanText(body.idempotency_key);
  if (!idempotencyKey || idempotencyKey.length > 180) {
    return validationError('IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key is required and must be 180 characters or fewer.');
  }

  if (body.operator_go !== EXECUTE_OPERATOR_GO) {
    return validationError(
      'OPERATOR_GO_REQUIRED',
      `execute-refund requires operator_go="${EXECUTE_OPERATOR_GO}".`,
      409
    );
  }

  return {
    ok: true,
    input: {
      ...validated.input,
      idempotencyKey,
      operatorGo: body.operator_go,
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

function stripeRefundParams(plan) {
  const ids = normalizeStripeIds(plan);
  if (plan.net_refund_pence <= 0) {
    return validationError('ZERO_NET_REFUND', 'Net Stripe refund amount must be greater than zero.', 409);
  }
  if (!ids.stripePaymentIntentId && !ids.stripeChargeId) {
    return validationError('STRIPE_REFUND_TARGET_MISSING', 'Stripe payment intent or charge is required for automatic refund execution.', 409);
  }

  return {
    ok: true,
    params: {
      amount: plan.net_refund_pence,
      ...(ids.stripePaymentIntentId
        ? { payment_intent: ids.stripePaymentIntentId }
        : { charge: ids.stripeChargeId }),
      metadata: {
        refund_type: plan.refund_type,
        gross_refund_pence: String(plan.gross_refund_pence),
        processing_fee_withheld_pence: String(plan.processing_fee_withheld_pence),
      },
    },
    ids,
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

function isCompleteRefundEvent(event) {
  if (!event || event.status !== 'executed') return false;
  const lines = Array.isArray(event.lines) ? event.lines : [];
  if (lines.length < 1) return false;
  return lines.every((line) => {
    if (line.credit_transaction_id && Number(line.minutes_adjusted || 0) > 0) {
      return Boolean(line.credit_source_adjustment_id);
    }
    return true;
  });
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

function normalizeRefundId(refund) {
  return cleanText(refund && refund.id);
}

function normalizeBalanceTransactionId(refund, fallback) {
  if (typeof refund?.balance_transaction === 'string') return refund.balance_transaction;
  if (refund?.balance_transaction && typeof refund.balance_transaction.id === 'string') {
    return refund.balance_transaction.id;
  }
  return fallback || null;
}

function csaCandidateLines(plan) {
  return (plan.lines || []).filter((line) =>
    line.credit_transaction_id
      && !line.booking_credit_source_id
      && Number(line.minutes_adjusted || 0) > 0
      && Number(line.gross_pence_removed || 0) > 0
  );
}

async function insertCreditSourceAdjustment(sql, { line, plan, stripeRefundId, admin }) {
  const rows = await sql`
    INSERT INTO credit_source_adjustments
      (credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason, stripe_refund_id, created_by)
    VALUES
      (${line.credit_transaction_id}, 'cash_refund', ${line.minutes_adjusted},
       ${line.gross_pence_removed}, ${plan.reason}, ${stripeRefundId}, ${admin.id})
    ON CONFLICT (stripe_refund_id) DO NOTHING
    RETURNING id
  `;
  if (rows[0]) return { id: rows[0].id, inserted: true };

  const existing = await sql`
    SELECT id
      FROM credit_source_adjustments
     WHERE stripe_refund_id = ${stripeRefundId}
       AND credit_transaction_id = ${line.credit_transaction_id}
     LIMIT 1
  `;
  return { id: existing[0]?.id || null, inserted: false };
}

async function writeRefundLedger(sql, {
  plan,
  input,
  admin,
  stripeRefund,
  stripeIds,
  adjustCreditBalance,
  connectionString,
  transactionRunner,
}) {
  const stripeRefundId = normalizeRefundId(stripeRefund);
  if (!stripeRefundId) {
    return validationError('STRIPE_REFUND_ID_MISSING', 'Stripe refund response did not include a refund id.', 502);
  }

  const learnerId = (plan.lines || []).find((line) => line.learner_id)?.learner_id || null;
  const stripeBalanceTransactionId = normalizeBalanceTransactionId(stripeRefund, stripeIds.stripeBalanceTransactionId);

  const csaByLine = new Map();
  const csaLines = csaCandidateLines(plan);
  if (csaLines.length > 1) {
    return validationError('MULTI_LINE_CSA_UNSUPPORTED', 'Automatic credit-source refunds currently support one credit source adjustment per Stripe refund.', 409);
  }

  try {
    return await runLedgerTransaction({ sql, connectionString, transactionRunner }, async (txSql) => {
      const eventRows = await txSql`
        INSERT INTO refund_events
          (school_id, learner_id, created_by, refund_type, status,
           gross_refund_pence, processing_fee_withheld_pence, net_refund_pence,
           stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
           stripe_balance_transaction_id, idempotency_key, reason, metadata)
        VALUES
          (${input.schoolId}, ${learnerId}, ${admin.id}, ${plan.refund_type}, 'executed',
           ${plan.gross_refund_pence}, ${plan.processing_fee_withheld_pence}, ${plan.net_refund_pence},
           ${stripeIds.stripePaymentIntentId}, ${stripeIds.stripeChargeId}, ${stripeRefundId},
           ${stripeBalanceTransactionId}, ${input.idempotencyKey}, ${plan.reason},
           ${JSON.stringify({
             fee_evidence: plan.fee_evidence || null,
             warnings: plan.warnings || [],
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
        if (isCompleteRefundEvent(existing)) {
          return {
            ok: true,
            idempotent_replay: true,
            refund_executed: false,
            refund_event: existing,
          };
        }
        return validationError(
          'INCOMPLETE_REFUND_LEDGER',
          'A prior refund event exists for this idempotency key but its ledger lines are incomplete; manual repair is required.',
          409
        );
      }

      for (const line of csaLines) {
        const balanceResult = await adjustCreditBalance(txSql, {
          learnerId: line.learner_id,
          instructorId: line.instructor_id,
          schoolId: input.schoolId,
          delta: -Number(line.minutes_adjusted || 0),
          creditsDelta: -Math.ceil(Number(line.minutes_adjusted || 0) / 60),
          allowOverdraft: false,
        });
        if (!balanceResult || !balanceResult.ok) {
          const err = new Error('credit balance adjustment failed');
          err.refundResult = {
            ok: false,
            status: 409,
            code: balanceResult?.code || 'CREDIT_BALANCE_ADJUST_FAILED',
            message: 'Stripe refund succeeded but credit balance adjustment failed; manual review is required.',
            stripe_refund_id: stripeRefundId,
          };
          throw err;
        }

        const csa = await insertCreditSourceAdjustment(txSql, {
          line,
          plan,
          stripeRefundId,
          admin,
        });
        csaByLine.set(line, csa.id);
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
             ${line.booking_credit_source_id}, ${line.lesson_booking_id}, ${csaByLine.get(line) || null},
             ${line.gross_pence_removed}, ${line.source_fee_pence_used}, ${line.fee_withheld_pence},
             ${line.net_refund_pence}, ${line.minutes_adjusted || 0})
        `;
      }

      return {
        ok: true,
        idempotent_replay: false,
        refund_executed: true,
        refund_event: await fetchExistingRefund(txSql, {
          schoolId: input.schoolId,
          idempotencyKey: input.idempotencyKey,
        }),
      };
    });
  } catch (err) {
    if (err && err.refundResult) return err.refundResult;
    throw err;
  }
}

async function executeAdminRefund({
  sql,
  stripe,
  admin,
  input,
  req,
  planner = planAdminRefundPreview,
  adjustCreditBalance = lockBalanceAdjustLCB,
  auditLogger = logAudit,
  connectionString,
  transactionRunner,
} = {}) {
  if (!sql) throw new Error('sql client required');
  if (!stripe) throw new Error('stripe client required');
  if (!admin) throw new Error('admin required');
  if (!input) throw new Error('input required');

  const existing = await fetchExistingRefund(sql, {
    schoolId: input.schoolId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    if (!isCompleteRefundEvent(existing)) {
      return validationError(
        'INCOMPLETE_REFUND_LEDGER',
        'A prior refund event exists for this idempotency key but its ledger lines are incomplete; manual repair is required.',
        409
      );
    }
    return {
      ok: true,
      idempotent_replay: true,
      refund_executed: false,
      refund_event: existing,
    };
  }

  const plan = await planner({ sql, stripe, input });
  if (!plan.ok) return plan;
  if (plan.blocked || plan.manual_review_required) {
    return {
      ...plan,
      ok: false,
      status: plan.status || 409,
      refund_executed: false,
      code: plan.code || 'REFUND_BLOCKED',
      message: plan.message || 'Refund requires manual review.',
    };
  }
  if ((plan.lines || []).some((line) => line.booking_credit_source_id)) {
    return validationError('BCS_EXECUTE_NOT_ENABLED', 'Automatic execution for booking-credit-source lines is not enabled in this slice.', 409);
  }
  if (csaCandidateLines(plan).length > 1) {
    return validationError('MULTI_LINE_CSA_UNSUPPORTED', 'Automatic credit-source refunds currently support one credit source adjustment per Stripe refund.', 409);
  }

  const refundTarget = stripeRefundParams(plan);
  if (!refundTarget.ok) return refundTarget;

  let stripeRefund;
  try {
    stripeRefund = await stripe.refunds.create(refundTarget.params, {
      idempotencyKey: input.idempotencyKey,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: 'STRIPE_REFUND_FAILED',
      message: 'Stripe refund failed before ledger mutation.',
      refund_executed: false,
    };
  }

  const written = await writeRefundLedger(sql, {
    plan,
    input,
    admin,
    stripeRefund,
    stripeIds: refundTarget.ids,
    adjustCreditBalance,
    connectionString,
    transactionRunner,
  });
  if (!written.ok) return written;

  if (written.refund_executed) {
    await auditLogger(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'admin.execute_refund',
      targetType: 'refund_event',
      targetId: written.refund_event?.id || null,
      schoolId: input.schoolId,
      req,
      details: {
        refund_type: plan.refund_type,
        idempotency_key: input.idempotencyKey,
        gross_refund_pence: plan.gross_refund_pence,
        processing_fee_withheld_pence: plan.processing_fee_withheld_pence,
        net_refund_pence: plan.net_refund_pence,
        stripe_refund_id: written.refund_event?.stripe_refund_id || normalizeRefundId(stripeRefund),
      },
    });
  }

  return written;
}

module.exports = {
  EXECUTE_OPERATOR_GO,
  executeAdminRefund,
  validateRefundExecuteRequest,
};
