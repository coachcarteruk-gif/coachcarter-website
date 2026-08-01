const crypto = require('crypto');
const { withNeonTransaction } = require('./_db-transaction');
const {
  SOURCE_KINDS,
  buildStripeSourceRecord,
} = require('./_payout-v2-source-writer');

const LAUNCH_ACCOUNTING_VERSION = 'simon_launch_v1';
const PAYMENT_CONTRACT_SCHEMA_VERSION = 'simon_launch_payment_v1';
const SHADOW_WRITER_MODE = 'shadow';
const ACTIVE_BOOKING_STATUSES = Object.freeze(['scheduled', 'chargeable']);
const PAYMENT_ORIGINS = Object.freeze({
  DIRECT_SLOT: 'direct_slot',
  TEST_DATE_DIRECT: 'test_date_direct',
  ONE_OFF_OFFER: 'one_off_offer',
  CAPTURED_REQUEST: 'captured_request',
});
const PAYMENT_ORIGIN_VALUES = new Set(Object.values(PAYMENT_ORIGINS));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function launchError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function asIsoTimestamp(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function contractFingerprint(input) {
  const canonical = JSON.stringify({
    version: PAYMENT_CONTRACT_SCHEMA_VERSION,
    school_id: input.schoolId,
    candidate_id: input.candidateId,
    learner_id: input.learnerId,
    instructor_id: input.instructorId,
    origin: input.origin,
    stripe_payment_created_at: input.paymentCreatedAt,
    gross_amount_minor: input.grossAmountMinor,
    currency: input.currency,
    stripe_payment_intent_id: input.paymentIntentId,
    stripe_charge_id: input.chargeId,
  });
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

function isStripeLaunchSchemaUnavailable(err) {
  if (!['42P01', '42703', '42883'].includes(err?.code)) return false;
  return /stripe_connect_launch_configs|lesson_payment_contracts|payment_origin|evidence_completeness/i
    .test(String(err?.message || ''));
}

async function loadShadowLaunchConfig(sql, schoolId) {
  requirePositiveInteger(schoolId, 'schoolId');
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  try {
    const rows = await sql`
      SELECT id, school_id, cutover_at, accounting_version, mode
      FROM stripe_connect_launch_configs
      WHERE school_id = ${schoolId}
        AND accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
        AND mode = ${SHADOW_WRITER_MODE}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (err) {
    if (isStripeLaunchSchemaUnavailable(err)) return null;
    throw err;
  }
}

async function prepareLaunchPaymentCandidate({
  sql,
  schoolId,
  instructorId,
  origin,
  now = new Date(),
  randomUUID = crypto.randomUUID,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(instructorId, 'instructorId');
  if (!PAYMENT_ORIGIN_VALUES.has(origin)) {
    throw new TypeError('origin is not supported by the one-payment/one-lesson contract');
  }
  const config = await loadShadowLaunchConfig(sql, schoolId);
  if (!config) return {};

  const paymentTime = asIsoTimestamp(now);
  if (!paymentTime) throw new TypeError('now must be a valid timestamp');
  const agreements = await sql`
    SELECT a.id
    FROM instructor_payout_agreement_versions a
    JOIN instructors i
      ON i.id = a.instructor_id
     AND i.school_id = a.school_id
     AND i.active = TRUE
    WHERE a.school_id = ${schoolId}
      AND a.instructor_id = ${instructorId}
      AND a.status = 'active'
      AND a.starts_at <= ${paymentTime}::timestamptz
      AND (a.ends_at IS NULL OR a.ends_at > ${paymentTime}::timestamptz)
    ORDER BY a.version_number DESC
    LIMIT 2
  `;
  if (agreements.length !== 1) {
    throw launchError(
      'STRIPE_LAUNCH_ACTIVE_AGREEMENT_REQUIRED',
      'Shadow launch checkout requires one active same-school instructor agreement'
    );
  }

  const candidateId = randomUUID();
  if (!UUID_PATTERN.test(candidateId)) {
    throw new TypeError('randomUUID must return an RFC 4122 UUID');
  }
  return {
    payment_contract_candidate_id: candidateId.toLowerCase(),
    payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
    payment_origin: origin,
  };
}

function parseLaunchPaymentCandidate(metadata, expectedOrigin = null) {
  const candidateId = typeof metadata?.payment_contract_candidate_id === 'string'
    ? metadata.payment_contract_candidate_id.trim().toLowerCase()
    : '';
  const schemaVersion = typeof metadata?.payment_contract_schema_version === 'string'
    ? metadata.payment_contract_schema_version.trim()
    : '';
  const origin = typeof metadata?.payment_origin === 'string'
    ? metadata.payment_origin.trim()
    : '';
  if (!candidateId && !schemaVersion && !origin) return null;
  if (!UUID_PATTERN.test(candidateId)) {
    throw launchError('STRIPE_LAUNCH_CANDIDATE_INVALID', 'Payment contract candidate ID is invalid');
  }
  if (schemaVersion !== PAYMENT_CONTRACT_SCHEMA_VERSION) {
    throw launchError('STRIPE_LAUNCH_SCHEMA_VERSION_INVALID', 'Payment contract schema version is invalid');
  }
  if (!PAYMENT_ORIGIN_VALUES.has(origin) || (expectedOrigin && origin !== expectedOrigin)) {
    throw launchError('STRIPE_LAUNCH_ORIGIN_INVALID', 'Payment contract origin is invalid');
  }
  return { candidateId, schemaVersion, origin };
}

function buildLaunchEvidenceDecision({
  fundingEvidence,
  now = new Date(),
}) {
  const missing = [];
  const contradictory = [];
  const paymentCreatedAt = asIsoTimestamp(fundingEvidence?.paymentCreatedAt);
  const fundsAvailableAt = asIsoTimestamp(fundingEvidence?.fundsAvailableAt);
  const observedAt = asIsoTimestamp(now);

  if (!paymentCreatedAt) missing.push('missing_stripe_payment_created_at');
  if (!fundsAvailableAt) missing.push('missing_stripe_funds_available_at');
  if (!observedAt) throw new TypeError('now must be a valid timestamp');

  const reviewReasons = Array.isArray(fundingEvidence?.reviewReasons)
    ? fundingEvidence.reviewReasons
    : [];
  for (const reason of reviewReasons) {
    if (/contradict|exceeds|unsupported/i.test(reason)) contradictory.push(reason);
    else missing.push(reason);
  }

  const balanceStatus = typeof fundingEvidence?.balanceTransactionStatus === 'string'
    ? fundingEvidence.balanceTransactionStatus.trim().toLowerCase()
    : null;
  if (!balanceStatus) missing.push('missing_balance_transaction_status');
  else if (!['pending', 'available'].includes(balanceStatus)) {
    contradictory.push('unsupported_balance_transaction_status');
  }

  return {
    paymentCreatedAt,
    fundsAvailableAt,
    observedAt,
    balanceTransactionStatus: balanceStatus,
    missing: [...new Set(missing)],
    contradictory: [...new Set(contradictory)],
    fundsAvailable: Boolean(
      fundsAvailableAt &&
      balanceStatus === 'available' &&
      new Date(fundsAvailableAt).getTime() <= new Date(observedAt).getTime()
    ),
  };
}

function assertSourceMatches(existing, expected) {
  const comparisons = [
    ['school_id', Number(existing.school_id), expected.school_id],
    ['learner_id', existing.learner_id == null ? null : Number(existing.learner_id), expected.learner_id],
    ['instructor_id', Number(existing.instructor_id), expected.instructor_id],
    ['credit_transaction_id', Number(existing.credit_transaction_id), expected.credit_transaction_id],
    ['funding_class', existing.funding_class, expected.funding_class],
    ['stripe_payment_intent_id', existing.stripe_payment_intent_id || null, expected.stripe_payment_intent_id],
    ['stripe_charge_id', existing.stripe_charge_id || null, expected.stripe_charge_id],
    ['stripe_balance_transaction_id', existing.stripe_balance_transaction_id || null, expected.stripe_balance_transaction_id],
    ['currency', existing.currency, expected.currency],
    ['gross_collected_pence', Number(existing.gross_collected_pence), expected.gross_collected_pence],
    ['stripe_fee_pence', Number(existing.stripe_fee_pence), expected.stripe_fee_pence],
    ['payable_pool_pence', Number(existing.payable_pool_pence), expected.payable_pool_pence],
    ['refundable_pool_pence', Number(existing.refundable_pool_pence), expected.refundable_pool_pence],
    ['source_fingerprint', existing.source_fingerprint, expected.source_fingerprint],
  ];
  const mismatch = comparisons.find(([, actual, wanted]) => actual !== wanted);
  if (mismatch) {
    throw launchError(
      'STRIPE_LAUNCH_SOURCE_CONFLICT',
      `Existing funding source contradicts launch evidence at ${mismatch[0]}`
    );
  }
}

function forceManualReview(record, reasons) {
  return {
    ...record,
    funding_class: 'manual_review',
    payable_pool_pence: 0,
    refundable_pool_pence: 0,
    source_status: 'manual_review',
    metadata: {
      ...record.metadata,
      review_reasons: [...new Set([...(record.metadata.review_reasons || []), ...reasons])],
    },
  };
}

async function materializeLaunchPaymentContract({
  connectionString,
  schoolId,
  creditTransactionId,
  bookingId,
  metadata,
  expectedOrigin,
  fundingEvidence,
  eventContext = {},
  now = new Date(),
  transactionRunner = withNeonTransaction,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(creditTransactionId, 'creditTransactionId');
  requirePositiveInteger(bookingId, 'bookingId');
  const candidate = parseLaunchPaymentCandidate(metadata, expectedOrigin);

  return transactionRunner({ connectionString }, async (client) => {
    const configResult = await client.query(
      `SELECT id, cutover_at, accounting_version, mode
         FROM stripe_connect_launch_configs
        WHERE school_id = $1
          AND accounting_version = $2
          AND mode = $3
        FOR SHARE`,
      [schoolId, LAUNCH_ACCOUNTING_VERSION, SHADOW_WRITER_MODE]
    );
    const config = configResult.rows[0];
    if (!config) return { enabled: false, candidate: Boolean(candidate), materialized: false };
    if (!candidate) {
      const uncandidatedPaymentCreatedAt = asIsoTimestamp(fundingEvidence?.paymentCreatedAt);
      if (
        uncandidatedPaymentCreatedAt
        && new Date(uncandidatedPaymentCreatedAt).getTime() < new Date(config.cutover_at).getTime()
      ) {
        return {
          enabled: true,
          candidate: false,
          materialized: false,
          reason: 'pre_cutover_payment_without_candidate',
        };
      }
      throw launchError(
        'STRIPE_LAUNCH_CANDIDATE_MISSING',
        'Post-cutover shadow payment is missing its immutable contract candidate metadata'
      );
    }

    const sourceResult = await client.query(
      `SELECT ct.id, ct.school_id, ct.learner_id, ct.instructor_id, ct.type,
              ct.amount_pence, ct.stripe_fee_pence, ct.stripe_session_id,
              ct.stripe_payment_intent_id, ct.created_at, i.active AS instructor_active
         FROM credit_transactions ct
         JOIN instructors i
           ON i.id = ct.instructor_id AND i.school_id = ct.school_id
         JOIN learner_users lu
           ON lu.id = ct.learner_id AND lu.school_id = ct.school_id
        WHERE ct.id = $1 AND ct.school_id = $2
        FOR SHARE OF ct, i, lu`,
      [creditTransactionId, schoolId]
    );
    const sourceRow = sourceResult.rows[0];
    if (!sourceRow) {
      throw launchError('STRIPE_LAUNCH_SOURCE_SCOPE_MISMATCH', 'Funding source is not in the requested school');
    }
    if (sourceRow.type !== 'slot_purchase') {
      throw launchError('STRIPE_LAUNCH_SOURCE_TYPE_MISMATCH', 'Launch contract requires a slot_purchase source');
    }

    const bookingResult = await client.query(
      `SELECT b.id, b.school_id, b.learner_id, b.instructor_id, b.status,
              b.booking_purpose, b.lesson_payment_contract_id,
              bcs.contribution_pence, bcs.stripe_fee_pence AS bcs_stripe_fee_pence,
              bcs.refunded_at
         FROM lesson_bookings b
         JOIN booking_credit_sources bcs
           ON bcs.booking_id = b.id
          AND bcs.school_id = b.school_id
          AND bcs.credit_transaction_id = $1
        WHERE b.id = $2 AND b.school_id = $3
        FOR UPDATE OF b`,
      [creditTransactionId, bookingId, schoolId]
    );
    const booking = bookingResult.rows[0];
    if (!booking || Number(booking.learner_id) !== Number(sourceRow.learner_id)
      || Number(booking.instructor_id) !== Number(sourceRow.instructor_id)) {
      throw launchError('STRIPE_LAUNCH_BOOKING_SCOPE_MISMATCH', 'Booking does not match the school-scoped payment source');
    }

    const mappingResult = await client.query(
      `SELECT b.id, b.status, bcs.refunded_at
         FROM booking_credit_sources bcs
         JOIN lesson_bookings b
           ON b.id = bcs.booking_id AND b.school_id = bcs.school_id
        WHERE bcs.school_id = $1
          AND bcs.credit_transaction_id = $2
        ORDER BY b.id
        FOR SHARE OF bcs, b`,
      [schoolId, creditTransactionId]
    );
    const activeMappings = mappingResult.rows.filter((row) =>
      ACTIVE_BOOKING_STATUSES.includes(row.status) && row.refunded_at == null
    );

    const baseRecord = buildStripeSourceRecord({
      sourceRow,
      schoolId,
      sourceKind: SOURCE_KINDS.DIRECT_BOOKING,
      stripeEvidence: fundingEvidence,
      eventContext,
    });
    const evidence = buildLaunchEvidenceDecision({
      fundingEvidence: {
        ...fundingEvidence,
        reviewReasons: baseRecord.metadata.review_reasons,
      },
      now,
    });
    if (evidence.missing.length > 0) {
      throw launchError(
        'STRIPE_LAUNCH_EVIDENCE_INCOMPLETE',
        `Payment evidence is incomplete: ${evidence.missing.join(',')}`
      );
    }

    const contradictions = [...evidence.contradictory];
    if (activeMappings.length !== 1 || Number(activeMappings[0]?.id) !== bookingId) {
      contradictions.push('payment_does_not_map_to_exactly_one_active_lesson');
    }
    if (Number(booking.contribution_pence) !== Number(sourceRow.amount_pence)) {
      contradictions.push('booking_contribution_amount_contradiction');
    }
    if (Number(sourceRow.stripe_fee_pence) !== Number(fundingEvidence?.feePence)) {
      contradictions.push('credit_transaction_stripe_fee_contradiction');
    }
    if (Number(booking.bcs_stripe_fee_pence) !== Number(fundingEvidence?.feePence)) {
      contradictions.push('booking_contribution_stripe_fee_contradiction');
    }
    if (candidate.origin === PAYMENT_ORIGINS.TEST_DATE_DIRECT && booking.booking_purpose !== 'test_date') {
      contradictions.push('test_date_origin_booking_purpose_contradiction');
    }
    if (candidate.origin !== PAYMENT_ORIGINS.TEST_DATE_DIRECT && booking.booking_purpose === 'test_date') {
      contradictions.push('non_test_origin_booking_purpose_contradiction');
    }

    const paymentCreatedAt = evidence.paymentCreatedAt;
    const regime = new Date(paymentCreatedAt).getTime() >= new Date(config.cutover_at).getTime()
      ? 'launch'
      : 'legacy';
    const agreementResult = await client.query(
      `SELECT id, split_bps
         FROM instructor_payout_agreement_versions
        WHERE school_id = $1
          AND instructor_id = $2
          AND status = 'active'
          AND starts_at <= $3::timestamptz
          AND (ends_at IS NULL OR ends_at > $3::timestamptz)
        ORDER BY version_number DESC
        LIMIT 2
        FOR SHARE`,
      [schoolId, sourceRow.instructor_id, paymentCreatedAt]
    );
    const agreement = agreementResult.rows.length === 1 ? agreementResult.rows[0] : null;

    let evidenceStatus;
    let ineligibilityCode = null;
    let contradictionCode = null;
    if (contradictions.length > 0) {
      evidenceStatus = 'contradictory';
      contradictionCode = [...new Set(contradictions)].sort().join('|').slice(0, 500);
    } else if (regime === 'legacy') {
      evidenceStatus = 'ineligible';
      ineligibilityCode = 'pre_cutover_payment';
    } else if (sourceRow.instructor_active !== true) {
      evidenceStatus = 'ineligible';
      ineligibilityCode = 'instructor_not_active_at_materialization';
    } else if (!agreement) {
      evidenceStatus = 'ineligible';
      ineligibilityCode = 'no_active_agreement_at_payment_creation';
    } else {
      evidenceStatus = evidence.fundsAvailable ? 'complete' : 'pending';
    }

    let sourceRecord = baseRecord;
    if (evidenceStatus === 'contradictory') {
      sourceRecord = forceManualReview(baseRecord, contradictionCode.split('|'));
    }
    const sourceMetadata = {
      ...sourceRecord.metadata,
      launch_accounting_version: LAUNCH_ACCOUNTING_VERSION,
      payment_contract_candidate_id: candidate.candidateId,
      payment_contract_schema_version: candidate.schemaVersion,
      payment_origin: candidate.origin,
      evidence_status: evidenceStatus,
      stripe_payment_created_at: paymentCreatedAt,
      stripe_funds_available_at: evidence.fundsAvailableAt,
      stripe_balance_transaction_status: evidence.balanceTransactionStatus,
    };

    let fundingSource;
    {
      const inserted = await client.query(
        `INSERT INTO payout_funding_sources (
           school_id, learner_id, instructor_id, funding_class,
           credit_transaction_id, stripe_checkout_session_id,
           stripe_payment_intent_id, stripe_charge_id,
           stripe_balance_transaction_id, currency, gross_collected_pence,
           stripe_fee_pence, payable_pool_pence, refundable_pool_pence,
           source_status, source_fingerprint, occurred_at, metadata,
           stripe_payment_created_at, stripe_funds_available_at,
           payment_origin, source_booking_id, evidence_completeness,
           contradiction_code
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,
           $19,$20,$21,$22,$23,$24
         )
         ON CONFLICT (school_id, source_fingerprint) DO NOTHING
         RETURNING *`,
        [
          sourceRecord.school_id, sourceRecord.learner_id, sourceRecord.instructor_id,
          sourceRecord.funding_class, sourceRecord.credit_transaction_id,
          sourceRecord.stripe_checkout_session_id, sourceRecord.stripe_payment_intent_id,
          sourceRecord.stripe_charge_id, sourceRecord.stripe_balance_transaction_id,
          sourceRecord.currency, sourceRecord.gross_collected_pence,
          sourceRecord.stripe_fee_pence, sourceRecord.payable_pool_pence,
          sourceRecord.refundable_pool_pence, sourceRecord.source_status,
          sourceRecord.source_fingerprint, sourceRecord.occurred_at,
          JSON.stringify(sourceMetadata), paymentCreatedAt, evidence.fundsAvailableAt,
          candidate.origin, bookingId,
          evidenceStatus === 'contradictory' ? 'contradictory' : (evidenceStatus === 'pending' ? 'pending' : 'complete'),
          contradictionCode,
        ]
      );
      fundingSource = inserted.rows[0] || null;
    }
    if (!fundingSource) {
      const existing = await client.query(
        `SELECT * FROM payout_funding_sources
          WHERE school_id = $1 AND credit_transaction_id = $2
          FOR UPDATE`,
        [schoolId, creditTransactionId]
      );
      fundingSource = existing.rows[0];
    }
    if (!fundingSource) {
      throw launchError('STRIPE_LAUNCH_SOURCE_CONFLICT', 'Funding source identity conflict did not resolve in the requested school');
    }
    assertSourceMatches(fundingSource, sourceRecord);

    const sourceLaunchFacts = {
      stripe_payment_created_at: paymentCreatedAt,
      stripe_funds_available_at: evidence.fundsAvailableAt,
      payment_origin: candidate.origin,
      source_booking_id: bookingId,
      lesson_payment_contract_id: candidate.candidateId,
    };
    for (const [field, value] of Object.entries(sourceLaunchFacts)) {
      const actual = field.endsWith('_at') ? asIsoTimestamp(fundingSource[field]) : String(fundingSource[field]);
      const wanted = field.endsWith('_at') ? asIsoTimestamp(value) : String(value);
      if (fundingSource[field] != null && actual !== wanted) {
        throw launchError('STRIPE_LAUNCH_SOURCE_CONFLICT', `Funding source launch fact changed: ${field}`);
      }
    }

    const fingerprint = contractFingerprint({
      schoolId,
      candidateId: candidate.candidateId,
      learnerId: Number(sourceRow.learner_id),
      instructorId: Number(sourceRow.instructor_id),
      origin: candidate.origin,
      paymentCreatedAt,
      grossAmountMinor: Number(sourceRow.amount_pence),
      currency: sourceRecord.currency,
      paymentIntentId: sourceRecord.stripe_payment_intent_id,
      chargeId: sourceRecord.stripe_charge_id,
    });
    const completedAt = evidenceStatus === 'complete' ? evidence.observedAt : null;
    let contract;
    let contractCreated = false;
    {
      const inserted = await client.query(
        `INSERT INTO lesson_payment_contracts (
           id, school_id, learner_id, instructor_id, funding_source_id,
           origin, regime, stripe_payment_created_at, gross_amount_minor,
           stripe_fee_minor, currency, split_bps, agreement_version_id,
           stripe_payment_intent_id, stripe_charge_id,
           stripe_balance_transaction_id, stripe_funds_available_at,
           evidence_status, ineligibility_code, contradiction_code,
           created_at, completed_at, fingerprint
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          candidate.candidateId, schoolId, sourceRow.learner_id, sourceRow.instructor_id,
          fundingSource.id, candidate.origin, regime, paymentCreatedAt,
          sourceRow.amount_pence, sourceRecord.stripe_fee_pence, sourceRecord.currency,
          agreement?.split_bps ?? null, agreement?.id ?? null,
          sourceRecord.stripe_payment_intent_id, sourceRecord.stripe_charge_id,
          sourceRecord.stripe_balance_transaction_id, evidence.fundsAvailableAt,
          evidenceStatus, ineligibilityCode, contradictionCode,
          evidence.observedAt, completedAt, fingerprint,
        ]
      );
      contract = inserted.rows[0] || null;
      contractCreated = Boolean(contract);
    }
    if (!contract) {
      const existing = await client.query(
        `SELECT * FROM lesson_payment_contracts
          WHERE id = $1 OR stripe_payment_intent_id = $2 OR stripe_charge_id = $3
          FOR UPDATE`,
        [candidate.candidateId, sourceRecord.stripe_payment_intent_id, sourceRecord.stripe_charge_id]
      );
      if (existing.rows.length !== 1) {
        throw launchError('STRIPE_LAUNCH_CONTRACT_CONFLICT', 'Stripe payment identity is already bound to another contract');
      }
      contract = existing.rows[0];
      const immutableMatch = Number(contract.school_id) === schoolId
        && contract.id === candidate.candidateId
        && Number(contract.funding_source_id) === Number(fundingSource.id)
        && contract.fingerprint === fingerprint;
      if (!immutableMatch) {
        throw launchError('STRIPE_LAUNCH_CONTRACT_CONFLICT', 'Contract replay contradicted immutable payment identity');
      }
      if (contract.evidence_status === 'pending' && contract.evidence_status !== evidenceStatus) {
        const updated = await client.query(
          `UPDATE lesson_payment_contracts
              SET evidence_status = $1,
                  ineligibility_code = $2,
                  contradiction_code = $3,
                  completed_at = $4
            WHERE id = $5 AND school_id = $6 AND evidence_status = 'pending'
            RETURNING *`,
          [evidenceStatus, ineligibilityCode, contradictionCode, completedAt, candidate.candidateId, schoolId]
        );
        contract = updated.rows[0] || contract;
      } else if (contract.evidence_status !== evidenceStatus) {
        throw launchError('STRIPE_LAUNCH_CONTRACT_CONFLICT', 'Terminal contract classification changed on replay');
      }
    }

    const desiredCompleteness = evidenceStatus === 'contradictory'
      ? 'contradictory'
      : (evidenceStatus === 'pending' ? 'pending' : 'complete');
    const updatedSource = await client.query(
      `UPDATE payout_funding_sources
          SET stripe_payment_created_at = COALESCE(stripe_payment_created_at, $1),
              stripe_funds_available_at = COALESCE(stripe_funds_available_at, $2),
              payment_origin = COALESCE(payment_origin, $3),
              source_booking_id = COALESCE(source_booking_id, $4),
              lesson_payment_contract_id = COALESCE(lesson_payment_contract_id, $5),
              evidence_completeness = CASE
                WHEN evidence_completeness IS NULL THEN $6
                WHEN evidence_completeness = 'pending' THEN $6
                ELSE evidence_completeness
              END,
              contradiction_code = CASE
                WHEN evidence_completeness IS NULL OR evidence_completeness = 'pending' THEN $7
                ELSE contradiction_code
              END
        WHERE id = $8 AND school_id = $9
        RETURNING *`,
      [paymentCreatedAt, evidence.fundsAvailableAt, candidate.origin, bookingId,
        candidate.candidateId, desiredCompleteness, contradictionCode,
        fundingSource.id, schoolId]
    );
    if (!updatedSource.rows[0]) {
      throw launchError('STRIPE_LAUNCH_SOURCE_CONFLICT', 'Funding source could not be linked to its contract');
    }

    const updatedBooking = await client.query(
      `UPDATE lesson_bookings
          SET lesson_payment_contract_id = COALESCE(lesson_payment_contract_id, $1)
        WHERE id = $2 AND school_id = $3
          AND (lesson_payment_contract_id IS NULL OR lesson_payment_contract_id = $1)
        RETURNING id`,
      [candidate.candidateId, bookingId, schoolId]
    );
    if (!updatedBooking.rows[0]) {
      throw launchError('STRIPE_LAUNCH_BOOKING_CONFLICT', 'Booking is already linked to another payment contract');
    }

    return {
      enabled: true,
      candidate: true,
      materialized: true,
      created: contractCreated,
      contract,
      source: updatedSource.rows[0],
    };
  });
}

module.exports = {
  LAUNCH_ACCOUNTING_VERSION,
  PAYMENT_CONTRACT_SCHEMA_VERSION,
  SHADOW_WRITER_MODE,
  PAYMENT_ORIGINS,
  loadShadowLaunchConfig,
  prepareLaunchPaymentCandidate,
  parseLaunchPaymentCandidate,
  buildLaunchEvidenceDecision,
  materializeLaunchPaymentContract,
  isStripeLaunchSchemaUnavailable,
};
