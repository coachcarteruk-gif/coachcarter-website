// @ts-check
// Rollback-only Neon contracts for inactive Payout v2 source ingestion.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-source-ingestion.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const {
  SOURCE_KINDS,
  writeStripeFundingSource,
  writeLegacyFundingSource,
} = require('../api/_payout-v2-source-writer');
const {
  claimStripeEventReceipt,
  markStripeEventProcessed,
  markStripeEventFailed,
} = require('../api/_stripe-event-receipts');
const {
  writeOpeningRecoveryAdjustment,
} = require('../api/_payout-v2-recovery');
const {
  loadHistoricalCandidates,
  candidateSnapshotFingerprint,
  assertCandidateSnapshotUnchanged,
} = require('../api/_payout-v2-historical-import');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '035_payout_v2_ledger_foundation.sql'),
  'utf8'
);

function makeSqlTag(client) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    const result = await client.query(text, values);
    return result.rows;
  };
}

function exactEvidence(suffix, overrides = {}) {
  return {
    checkoutSessionId: `cs_${suffix}`,
    paymentIntentId: `pi_${suffix}`,
    paymentIntentStatus: 'succeeded',
    chargeId: `ch_${suffix}`,
    chargePaid: true,
    chargeCaptured: true,
    chargePaymentIntentId: `pi_${suffix}`,
    balanceTransactionId: `txn_${suffix}`,
    balanceTransactionSourceId: `ch_${suffix}`,
    balanceTransactionType: 'charge',
    balanceTransactionAmountPence: 8250,
    balanceTransactionCurrency: 'gbp',
    amountPence: 8250,
    currency: 'gbp',
    feePence: 250,
    source: 'balance_transaction',
    ...overrides,
  };
}

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 source ingestion database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let sql;
  let schoolId;
  let instructorId;
  let learnerId;
  let secondSchoolId;
  let secondSchoolExists = false;
  let savepointNumber = 0;
  let fixtureNumber = 0;

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL &&
      process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) {
      throw new Error('Refusing Payout v2 integration tests: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    await client.query(migrationSql);
    sql = makeSqlTag(client);

    const fixture = await client.query(`
      SELECT lu.school_id, lu.id AS learner_id, i.id AS instructor_id
      FROM learner_users lu
      JOIN instructors i ON i.school_id = lu.school_id
      ORDER BY lu.id, i.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Neon test branch needs one same-school learner/instructor fixture');
    }
    ({
      school_id: schoolId,
      learner_id: learnerId,
      instructor_id: instructorId,
    } = fixture.rows[0]);

    const secondSchool = await client.query(`
      SELECT id
      FROM schools
      WHERE id <> $1
      ORDER BY id
      LIMIT 1
    `, [schoolId]);
    secondSchoolExists = secondSchool.rowCount === 1;
    secondSchoolId = secondSchoolExists
      ? secondSchool.rows[0].id
      : Number(schoolId) + 1_000_000;
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepointNumber += 1;
    await client.query(`SAVEPOINT payout_v2_source_${savepointNumber}`);
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_source_${savepointNumber}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function insertCreditTransaction({
    type = 'purchase',
    amountPence = 8250,
    stripeFeePence = 250,
  } = {}) {
    fixtureNumber += 1;
    const suffix = `payoutv2${fixtureNumber}`;
    const result = await client.query(`
      INSERT INTO credit_transactions (
        learner_id, instructor_id, school_id, type, credits, minutes,
        amount_pence, payment_method, stripe_session_id,
        stripe_payment_intent_id, stripe_fee_pence, source
      )
      VALUES ($1, $2, $3, $4, 1, 90, $5, 'card', $6, $7, $8, $9)
      RETURNING id
    `, [
      learnerId,
      instructorId,
      schoolId,
      type,
      amountPence,
      type === 'legacy_grandfather' ? null : `cs_${suffix}`,
      type === 'legacy_grandfather' ? null : `pi_${suffix}`,
      stripeFeePence,
      type === 'legacy_grandfather' ? 'reconciliation' : 'stripe',
    ]);
    return { id: result.rows[0].id, suffix };
  }

  async function insertCompletedPayoutEvidence(amountPence = 41_400, { legacy = true } = {}) {
    const booking = await client.query(`
      SELECT lb.id, lb.school_id, lb.instructor_id, lb.learner_id
      FROM lesson_bookings lb
      LEFT JOIN payout_line_items pli
        ON pli.booking_id = lb.id
       AND pli.school_id = lb.school_id
      WHERE lb.school_id = $1
        AND pli.id IS NULL
      ORDER BY lb.id
      LIMIT 1
    `, [schoolId]);
    if (booking.rowCount !== 1) {
      throw new Error('Neon test branch needs one booking not already claimed by a v1 payout');
    }
    const payout = await client.query(`
      INSERT INTO instructor_payouts (
        instructor_id, amount_pence, platform_fee_pence,
        stripe_transfer_id, period_start, period_end,
        status, completed_at, school_id
      )
      VALUES (
        $1, $2, 0, $3, CURRENT_DATE, CURRENT_DATE,
        'completed', NOW(), $4
      )
      RETURNING id
    `, [
      booking.rows[0].instructor_id,
      amountPence,
      `tr_recovery_fixture_${++fixtureNumber}`,
      schoolId,
    ]);
    await client.query(`
      INSERT INTO payout_line_items (
        payout_id, booking_id, price_pence,
        instructor_amount_pence, commission_rate, school_id
      )
      VALUES ($1, $2, $3, $3, 0, $4)
    `, [payout.rows[0].id, booking.rows[0].id, amountPence, schoolId]);
    if (legacy) {
      const legacySource = await client.query(`
        INSERT INTO credit_transactions (
          learner_id, instructor_id, school_id, type, credits, minutes,
          amount_pence, payment_method, stripe_fee_pence, source
        )
        VALUES ($1, $2, $3, 'legacy_grandfather', 1, 90, 0,
                'migration', 0, 'reconciliation')
        RETURNING id
      `, [
        booking.rows[0].learner_id,
        booking.rows[0].instructor_id,
        schoolId,
      ]);
      await client.query(`
        INSERT INTO booking_credit_sources (
          booking_id, credit_transaction_id, school_id, minutes_drawn,
          rate_pence_per_minute, contribution_pence, stripe_fee_pence
        )
        VALUES ($1, $2, $3, 90, 0, 0, 0)
      `, [booking.rows[0].id, legacySource.rows[0].id, schoolId]);
    }
    return {
      id: Number(payout.rows[0].id),
      instructor_id: Number(booking.rows[0].instructor_id),
      line_amount_pence: amountPence,
      booking_ids: [Number(booking.rows[0].id)],
    };
  }

  test('writer is idempotent on one school-scoped immutable source', async () => {
    const tx = await insertCreditTransaction();
    const first = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    const second = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM payout_funding_sources WHERE school_id = $1 AND credit_transaction_id = $2',
      [schoolId, tx.id]
    );
    expect(count.rows[0].count).toBe(1);
  });

  test('cross-tenant source lookup is refused', async () => {
    const tx = await insertCreditTransaction();
    await expect(writeStripeFundingSource({
      sql,
      schoolId: secondSchoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_SOURCE_SCOPE_MISMATCH' });
  });

  test('missing evidence persists manual_review with zero payable value', async () => {
    const tx = await insertCreditTransaction();
    const result = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix, {
        chargeId: null,
        balanceTransactionId: null,
        feePence: null,
      }),
    });
    expect(result.source.funding_class).toBe('manual_review');
    expect(Number(result.source.payable_pool_pence)).toBe(0);
    expect(Number(result.source.refundable_pool_pence)).toBe(0);
  });

  test('contradictory replay cannot rewrite an immutable source', async () => {
    const tx = await insertCreditTransaction();
    await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    await expect(writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix, { amountPence: 8249 }),
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_SOURCE_CONFLICT' });
  });

  test('positive legacy history is forced to zero payout value', async () => {
    const tx = await insertCreditTransaction({
      type: 'legacy_grandfather',
      amountPence: 41400,
      stripeFeePence: 0,
    });
    const result = await writeLegacyFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
    });
    expect(result.source.funding_class).toBe('legacy_pre_connect_settled');
    expect(Number(result.source.gross_collected_pence)).toBe(41400);
    expect(Number(result.source.stripe_fee_pence)).toBe(0);
    expect(Number(result.source.payable_pool_pence)).toBe(0);
  });

  test('duplicate processed Stripe event is a database-backed no-op', async () => {
    const eventId = `evt_payoutv2${++fixtureNumber}`;
    const first = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_event${fixtureNumber}`,
    });
    expect(first.claimed).toBe(true);
    await markStripeEventProcessed({ sql, schoolId, stripeEventId: eventId });
    const duplicate = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_event${fixtureNumber}`,
    });
    expect(duplicate.claimed).toBe(false);
    expect(duplicate.receipt.processing_status).toBe('processed');
  });

  test('same Stripe event cannot be reassigned across tenants', async () => {
    test.skip(!secondSchoolExists, 'Neon test branch has no second pre-existing school fixture');
    const eventId = `evt_tenantguard${++fixtureNumber}`;
    await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
    });
    await expect(claimStripeEventReceipt({
      sql,
      schoolId: secondSchoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_EVENT_RECEIPT_CONFLICT' });
  });

  test('same-school Stripe event cannot contradict immutable object evidence', async () => {
    const eventId = `evt_evidenceguard${++fixtureNumber}`;
    await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_original${fixtureNumber}`,
    });
    await expect(claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_contradiction${fixtureNumber}`,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_EVENT_RECEIPT_CONFLICT' });
  });

  test('partial failure retries the receipt and keeps one source row', async () => {
    const tx = await insertCreditTransaction();
    const eventId = `evt_partial${++fixtureNumber}`;
    const firstClaim = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
    });
    expect(firstClaim.claimed).toBe(true);
    await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    await markStripeEventFailed({
      sql,
      schoolId,
      stripeEventId: eventId,
      error: Object.assign(new Error('injected post-source failure'), { code: 'INJECTED' }),
    });

    const retryClaim = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
    });
    expect(retryClaim.claimed).toBe(true);
    const replay = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    expect(replay.created).toBe(false);
    await markStripeEventProcessed({ sql, schoolId, stripeEventId: eventId });

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM payout_funding_sources
          WHERE school_id = $1 AND credit_transaction_id = $2) AS source_count,
        (SELECT COUNT(*)::int FROM stripe_event_receipts
          WHERE school_id = $1 AND stripe_event_id = $3
            AND processing_status = 'processed') AS processed_receipt_count
    `, [schoolId, tx.id, eventId]);
    expect(counts.rows[0]).toEqual({
      source_count: 1,
      processed_receipt_count: 1,
    });
  });

  test('an old failed receipt retry establishes a fresh processing lease', async () => {
    const eventId = `evt_retrylease${++fixtureNumber}`;
    await client.query(`
      INSERT INTO stripe_event_receipts (
        school_id, stripe_event_id, event_type, livemode, object_id,
        processing_status, received_at, last_error
      )
      VALUES ($1, $2, 'checkout.session.completed', FALSE, $3,
              'failed', NOW() - INTERVAL '10 minutes', 'injected failure')
    `, [schoolId, eventId, `cs_retrylease${fixtureNumber}`]);

    const firstRetry = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_retrylease${fixtureNumber}`,
    });
    expect(firstRetry.claimed).toBe(true);
    expect(firstRetry.receipt.processing_status).toBe('processing');
    expect(firstRetry.receipt.processed_at).not.toBeNull();

    const concurrentRetry = await claimStripeEventReceipt({
      sql,
      schoolId,
      stripeEventId: eventId,
      eventType: 'checkout.session.completed',
      livemode: false,
      objectId: `cs_retrylease${fixtureNumber}`,
    });
    expect(concurrentRetry.claimed).toBe(false);
    expect(concurrentRetry.receipt.processing_status).toBe('processing');
  });

  test('reviewed historical candidate snapshot refuses plan drift', async () => {
    const before = await loadHistoricalCandidates(sql, { schoolId });
    const plan = {
      school_id: Number(schoolId),
      candidate_snapshot_fingerprint: candidateSnapshotFingerprint(before, Number(schoolId)),
    };
    await expect(assertCandidateSnapshotUnchanged(sql, plan)).resolves.toBeUndefined();
    await insertCreditTransaction();
    await expect(assertCandidateSnapshotUnchanged(sql, plan))
      .rejects.toMatchObject({ code: 'PAYOUT_V2_IMPORT_PLAN_DRIFT' });
  });

  test('interrupted historical source write rolls back and resumes idempotently', async () => {
    const tx = await insertCreditTransaction();
    await client.query('SAVEPOINT payout_v2_import_interruption');
    const first = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    expect(first.created).toBe(true);
    await client.query('ROLLBACK TO SAVEPOINT payout_v2_import_interruption');

    const afterRollback = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM payout_funding_sources
      WHERE school_id = $1
        AND credit_transaction_id = $2
    `, [schoolId, tx.id]);
    expect(afterRollback.rows[0].count).toBe(0);

    const resumed = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    const replay = await writeStripeFundingSource({
      sql,
      schoolId,
      creditTransactionId: tx.id,
      sourceKind: SOURCE_KINDS.CREDIT_PURCHASE,
      stripeEvidence: exactEvidence(tx.suffix),
    });
    expect(resumed.created).toBe(true);
    expect(replay.created).toBe(false);
  });

  test('opening recovery writer is idempotent and preserves completed payout evidence', async () => {
    const evidence = await insertCompletedPayoutEvidence();
    const args = {
      sql,
      schoolId,
      instructorId: Number(evidence.instructor_id),
      amountPence: Number(evidence.line_amount_pence),
      sourcePayoutId: Number(evidence.id),
      legacyBookingIds: evidence.booking_ids.map(Number),
      evidenceReference: 'test:payout-v2:operator-reviewed-recovery',
      operatorId: 1,
    };
    const first = await writeOpeningRecoveryAdjustment(args);
    const replay = await writeOpeningRecoveryAdjustment(args);
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(Number(first.adjustment.amount_pence)).toBe(-args.amountPence);
    expect(first.adjustment.adjustment_type).toBe('recovery');
  });

  test('opening recovery evidence cannot cross tenant scope', async () => {
    const evidence = await insertCompletedPayoutEvidence();
    await expect(writeOpeningRecoveryAdjustment({
      sql,
      schoolId: secondSchoolId,
      instructorId: Number(evidence.instructor_id),
      amountPence: Number(evidence.line_amount_pence),
      sourcePayoutId: Number(evidence.id),
      legacyBookingIds: evidence.booking_ids.map(Number),
      evidenceReference: 'test:payout-v2:cross-tenant-recovery',
      operatorId: 1,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_RECOVERY_EVIDENCE_MISMATCH' });
  });

  test('opening recovery refuses payout lines without legacy funding evidence', async () => {
    const evidence = await insertCompletedPayoutEvidence(41_400, { legacy: false });
    await expect(writeOpeningRecoveryAdjustment({
      sql,
      schoolId,
      instructorId: Number(evidence.instructor_id),
      amountPence: Number(evidence.line_amount_pence),
      sourcePayoutId: Number(evidence.id),
      legacyBookingIds: evidence.booking_ids.map(Number),
      evidenceReference: 'test:payout-v2:non-legacy-recovery-refused',
      operatorId: 1,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_RECOVERY_EVIDENCE_MISMATCH' });
  });
});
