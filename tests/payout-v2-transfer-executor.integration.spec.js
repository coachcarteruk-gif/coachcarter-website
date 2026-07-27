// @ts-check
// Rollback-only Neon verification for inactive Payout v2 Slice 4.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-transfer-executor.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const {
  planPayoutV2Earnings,
} = require('../api/_payout-v2-earning-planner');
const {
  materializePayoutV2ShadowPlanInTransaction,
} = require('../api/_payout-v2-materializer');
const {
  preparePayoutV2TransferIntentsInTransaction,
  beginSubmission,
  executePayoutV2Batch,
  reconcilePayoutV2Transfer,
  reconcilePayoutV2SameDay,
} = require('../api/_payout-v2-transfer-executor');
const { CHARGEABLE } = require('../api/_booking-status');

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
const transferDiagnosticSql = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    'db',
    'diagnostics',
    'payout-v2-transfer-reconciliation.sql'
  ),
  'utf8'
);

function fakeStripeTransfer(params, key, id) {
  return {
    id,
    object: 'transfer',
    amount: params.amount,
    currency: params.currency,
    destination: params.destination,
    source_transaction: params.source_transaction || null,
    transfer_group: params.transfer_group,
    metadata: params.metadata,
    created: 1784970000,
    livemode: false,
    lastResponse: { requestId: `req_${id}` },
    _idempotency_key: key,
  };
}

function createFakeStripe() {
  const byKey = new Map();
  const calls = [];
  let behavior = 'success';
  let sequence = 0;
  const client = {
    payoutV2AuthoritativeTransferGroupLookup: true,
    setBehavior(next) {
      behavior = next;
    },
    calls,
    transfers: {
      async create(params, options) {
        calls.push({ params, options });
        if (byKey.has(options.idempotencyKey)) return byKey.get(options.idempotencyKey);
        if (behavior === 'confirmed_failure') {
          const error = new Error('fake confirmed refusal');
          error.code = 'fake_refused';
          error.confirmedNoTransfer = true;
          throw error;
        }
        sequence += 1;
        const transfer = fakeStripeTransfer(
          params,
          options.idempotencyKey,
          `tr_fake_${sequence}`
        );
        byKey.set(options.idempotencyKey, transfer);
        if (behavior === 'timeout_after_success') {
          const error = new Error('fake timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return transfer;
      },
      async retrieve(id) {
        return [...byKey.values()].find((row) => row.id === id) || null;
      },
      async list({ transfer_group }) {
        return {
          data: [...byKey.values()].filter(
            (row) => row.transfer_group === transfer_group
          ),
          has_more: false,
        };
      },
    },
  };
  return client;
}

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 durable transfer executor database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let schoolId;
  let instructorId;
  let learnerId;
  let savepoint = 0;
  let nested = 0;

  async function runNested(callback) {
    nested += 1;
    const name = `payout_v2_transfer_nested_${nested}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const result = await callback(client);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }

  async function materializeFixture({
    commissionRateBps = 10000,
    payoutRoute = 'instructor_direct',
  } = {}) {
    const bookingResult = await client.query(
      `INSERT INTO lesson_bookings (
         learner_id, instructor_id, scheduled_date, start_time, end_time,
         status, payment_method, created_by, minutes_deducted, school_id,
         list_price_pence, list_price_source
       )
       VALUES (
         $1, $2, DATE '2099-12-30', TIME '09:00', TIME '10:30',
         $3, 'credit', 'learner', 90, $4,
         999999, 'live_compute_insert'
       )
       RETURNING id`,
      [learnerId, instructorId, CHARGEABLE, schoolId]
    );
    const bookingId = Number(bookingResult.rows[0].id);
    const sourceFingerprint =
      `sha256:${bookingId.toString(16).padStart(64, '0')}`;
    const sourceResult = await client.query(
      `INSERT INTO payout_funding_sources (
         school_id, learner_id, instructor_id, funding_class,
         stripe_payment_intent_id, stripe_charge_id,
         stripe_balance_transaction_id, currency,
         gross_collected_pence, stripe_fee_pence, payable_pool_pence,
         refundable_pool_pence, source_status, source_fingerprint,
         occurred_at, metadata
       )
       VALUES (
         $1, $2, $3, 'stripe_backed',
         $4, $5,
         $6, 'gbp',
         10000, 300, 9700,
         9700, 'available', $7,
         NOW(), '{"fee_evidence":"stripe_balance_transaction"}'::jsonb
       )
       RETURNING id`,
      [
        schoolId,
        learnerId,
        instructorId,
        `pi_slice4_${bookingId}`,
        `ch_slice4_${bookingId}`,
        `txn_slice4_${bookingId}`,
        sourceFingerprint,
      ]
    );
    const sourceId = Number(sourceResult.rows[0].id);
    const snapshotAt = '2026-07-25T09:00:00.000Z';
    const input = {
      schoolId,
      payoutRoute,
      destinationInstructorId:
        payoutRoute === 'instructor_direct' ? instructorId : undefined,
      periodStart: '2099-12-30',
      periodEnd: '2099-12-30',
      policy: payoutRoute === 'instructor_direct'
        ? {
            kind: 'commission',
            commissionRateBps,
            evidenceReference: `test:instructor:${instructorId}:commission`,
            snapshottedAt: snapshotAt,
          }
        : {
            kind: 'school_platform_fee',
            platformFeeBps: 0,
            evidenceReference: `test:school:${schoolId}:platform-fee`,
            snapshottedAt: snapshotAt,
          },
      recoveries: [],
      bookings: [
        {
          bookingId,
          schoolId,
          instructorId,
          status: CHARGEABLE,
          scheduledDate: '2099-12-30',
          earnedAt: '2099-12-30T10:30:00.000Z',
          payoutRoute,
          isTestAccount: false,
          existingV2Earning: false,
          existingV1Routes: [],
          fundingSources: [
            {
              fundingSourceId: sourceId,
              bookingCreditSourceId: null,
              schoolId,
              instructorId,
              fundingClass: 'stripe_backed',
              sourceStatus: 'available',
              sourceFingerprint,
              grossContributionPence: 10000,
              stripeFeeContributionPence: 300,
              payablePoolPence: 9700,
              alreadyAllocatedPence: 0,
              evidence: {
                stripe_payment_intent_id: `pi_slice4_${bookingId}`,
                stripe_charge_id: `ch_slice4_${bookingId}`,
                stripe_balance_transaction_id: `txn_slice4_${bookingId}`,
              },
            },
          ],
        },
      ],
    };
    const plan = planPayoutV2Earnings(input);
    const materialized = await materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId,
      reviewedPlan: plan,
      reloadInput: async () => input,
    });
    return {
      bookingId,
      sourceId,
      plan,
      batchId: materialized.batch_id,
    };
  }

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL &&
      process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) {
      throw new Error('Refusing Payout v2 integration tests: test and production URLs match');
    }
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    await client.query(migrationSql);
    const fixture = await client.query(`
      SELECT lu.school_id, lu.id AS learner_id, i.id AS instructor_id
      FROM learner_users lu
      JOIN instructors i ON i.school_id = lu.school_id
      WHERE COALESCE(lu.is_test_account, FALSE) = FALSE
      ORDER BY lu.id, i.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Neon test branch needs a same-school learner/instructor fixture');
    }
    schoolId = Number(fixture.rows[0].school_id);
    learnerId = Number(fixture.rows[0].learner_id);
    instructorId = Number(fixture.rows[0].instructor_id);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepoint += 1;
    await client.query(`SAVEPOINT payout_v2_transfer_${savepoint}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      `UPDATE instructors
          SET stripe_account_id = 'acct_payout_v2_fake',
              stripe_onboarding_complete = TRUE,
              payouts_paused = FALSE
        WHERE school_id = $1
          AND id = $2`,
      [schoolId, instructorId]
    );
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_transfer_${savepoint}`);
    await client.query(`RELEASE SAVEPOINT payout_v2_transfer_${savepoint}`);
  });

  test.afterAll(async () => {
    if (!ENABLED || !client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  test('success persists one source-linked intent before fake Stripe and settles separately', async () => {
    const fixture = await materializeFixture();
    const fakeStripe = createFakeStripe();
    const result = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(result.ok).toBe(true);
    expect(fakeStripe.calls).toHaveLength(1);
    expect(fakeStripe.calls[0].options.idempotencyKey).toMatch(/^payout-v2:/);
    expect(fakeStripe.calls[0].params.source_transaction)
      .toBe(`ch_slice4_${fixture.bookingId}`);

    const rows = await client.query(
      `SELECT pt.state, pt.stripe_transfer_id, pb.state AS batch_state,
              COUNT(pts.id)::int AS source_count,
              COALESCE(SUM(pts.amount_pence), 0)::int AS source_total
         FROM payout_transfers pt
         JOIN payout_batches pb
           ON pb.id = pt.payout_batch_id AND pb.school_id = pt.school_id
         LEFT JOIN payout_transfer_sources pts
           ON pts.payout_transfer_id = pt.id AND pts.school_id = pt.school_id
        WHERE pt.school_id = $1 AND pt.payout_batch_id = $2
        GROUP BY pt.id, pb.id`,
      [schoolId, fixture.batchId]
    );
    expect(rows.rows[0]).toMatchObject({
      state: 'transferred',
      batch_state: 'transferred',
      source_count: 1,
    });
    expect(Number(rows.rows[0].source_total)).toBe(fixture.plan.totals.net_shadow_transfer_pence);
    await client.query(
      transferDiagnosticSql.replaceAll(":'school_id'", String(schoolId))
    );
  });

  test('concurrent executor calls serialize to one submit and one reconciliation path', async () => {
    const fixture = await materializeFixture();
    const prepared = await preparePayoutV2TransferIntentsInTransaction({
      client,
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
    });
    const transferId = Number(prepared.transfer_intents[0].id);
    let transactionGate = Promise.resolve();
    const serializedBegin = () => {
      const result = transactionGate.then(
        () => beginSubmission(client, schoolId, transferId)
      );
      transactionGate = result.then(() => undefined, () => undefined);
      return result;
    };
    const actions = await Promise.all([serializedBegin(), serializedBegin()]);
    expect(actions.map((row) => row.action).sort()).toEqual(['reconcile', 'submit']);
    const count = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM payout_transfers
        WHERE school_id = $1 AND payout_batch_id = $2`,
      [schoolId, fixture.batchId]
    );
    expect(count.rows[0].count).toBe(1);
  });

  test('school route persists only the same-school destination and source-linked transfer', async () => {
    await client.query(
      `UPDATE schools
          SET stripe_account_id = 'acct_payout_v2_school_fake',
              stripe_onboarding_complete = TRUE
        WHERE id = $1`,
      [schoolId]
    );
    const fixture = await materializeFixture({ payoutRoute: 'school' });
    const fakeStripe = createFakeStripe();
    const result = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(result.ok).toBe(true);
    expect(fakeStripe.calls[0].params.destination).toBe('acct_payout_v2_school_fake');
    const transfer = (await client.query(
      `SELECT instructor_id, destination_school_id, state
         FROM payout_transfers
        WHERE school_id = $1
          AND payout_batch_id = $2`,
      [schoolId, fixture.batchId]
    )).rows[0];
    expect(transfer).toMatchObject({
      instructor_id: null,
      destination_school_id: schoolId,
      state: 'transferred',
    });
  });

  test('timeout after Stripe success keeps claims and reconciles the lost response idempotently', async () => {
    const fixture = await materializeFixture();
    const fakeStripe = createFakeStripe();
    fakeStripe.setBehavior('timeout_after_success');
    const result = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(result.transfer_results[0]).toMatchObject({
      state: 'reconciling',
      operator_review_required: true,
    });
    const before = await client.query(
      `SELECT
         (SELECT state FROM payout_transfers
           WHERE school_id = $1 AND payout_batch_id = $2) AS transfer_state,
         (SELECT COUNT(*)::int FROM payout_batch_earnings
           WHERE school_id = $1 AND payout_batch_id = $2) AS claim_count`,
      [schoolId, fixture.batchId]
    );
    expect(before.rows[0]).toMatchObject({
      transfer_state: 'reconciling',
      claim_count: 1,
    });

    const transferId = Number((await client.query(
      `SELECT id FROM payout_transfers
        WHERE school_id = $1 AND payout_batch_id = $2`,
      [schoolId, fixture.batchId]
    )).rows[0].id);
    const sameDay = await reconcilePayoutV2SameDay({
      schoolId,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(sameDay).toMatchObject({
      mode: 'inactive_same_day_reconciliation',
      checked_transfer_count: 1,
      production_cron_connected: false,
    });
    expect(sameDay.results[0].status).toBe('reconciled_transferred');
    expect((await reconcilePayoutV2Transfer({
      schoolId,
      transferId,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    })).status).toBe('already_reconciled');
  });

  test('confirmed failure retries the same intent and idempotency key', async () => {
    const fixture = await materializeFixture();
    const fakeStripe = createFakeStripe();
    fakeStripe.setBehavior('confirmed_failure');
    const first = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(first.transfer_results[0].state).toBe('failed_confirmed');
    const firstKey = fakeStripe.calls[0].options.idempotencyKey;

    fakeStripe.setBehavior('success');
    const retry = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(retry.transfer_results[0].state).toBe('transferred');
    expect(fakeStripe.calls[1].options.idempotencyKey).toBe(firstKey);
  });

  test('authoritative same-day not-found is distinguished as safe to retry', async () => {
    const fixture = await materializeFixture();
    const prepared = await preparePayoutV2TransferIntentsInTransaction({
      client,
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
    });
    const transferId = Number(prepared.transfer_intents[0].id);
    expect((await beginSubmission(client, schoolId, transferId)).action).toBe('submit');
    const fakeStripe = createFakeStripe();
    const reconciled = await reconcilePayoutV2Transfer({
      schoolId,
      transferId,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(reconciled).toMatchObject({
      status: 'not_found_safe_retry',
      safe_to_retry: true,
      operator_review_required: false,
      idempotency_key_reused: true,
    });
    expect((await client.query(
      `SELECT state FROM payout_transfers WHERE school_id = $1 AND id = $2`,
      [schoolId, transferId]
    )).rows[0].state).toBe('failed_confirmed');
  });

  test('Stripe success followed by local write failure remains reconcilable', async () => {
    const fixture = await materializeFixture();
    const fakeStripe = createFakeStripe();
    const failed = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
      beforePersistSuccess: () => {
        throw Object.assign(new Error('injected local failure'), { code: 'INJECTED' });
      },
    });
    expect(failed.transfer_results[0]).toMatchObject({
      state: 'reconciling',
      reason: 'stripe_success_local_write_failed',
    });
    const transferId = Number((await client.query(
      `SELECT id FROM payout_transfers
        WHERE school_id = $1 AND payout_batch_id = $2`,
      [schoolId, fixture.batchId]
    )).rows[0].id);
    expect((await reconcilePayoutV2Transfer({
      schoolId,
      transferId,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    })).status).toBe('reconciled_transferred');
  });

  test('zero final amount creates no transfer and never calls fake Stripe', async () => {
    const fixture = await materializeFixture({ commissionRateBps: 0 });
    expect(fixture.plan.totals.net_shadow_transfer_pence).toBe(0);
    const fakeStripe = createFakeStripe();
    const result = await executePayoutV2Batch({
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      stripeClient: fakeStripe,
      runInTransaction: runNested,
    });
    expect(result).toMatchObject({
      ok: true,
      zero_transfer: true,
      stripe_called: false,
    });
    expect(fakeStripe.calls).toHaveLength(0);
    expect(Number((await client.query(
      `SELECT COUNT(*)::int AS count FROM payout_transfers
        WHERE school_id = $1 AND payout_batch_id = $2`,
      [schoolId, fixture.batchId]
    )).rows[0].count)).toBe(0);
  });

  test('scope, reviewed fingerprint, and partial transaction rollback fail closed', async () => {
    const fixture = await materializeFixture();
    await expect(preparePayoutV2TransferIntentsInTransaction({
      client,
      schoolId: schoolId + 999999,
      batchId: fixture.batchId,
      expectedPlanFingerprint: fixture.plan.plan_fingerprint,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_TRANSFER_SCOPE_MISMATCH' });
    await expect(preparePayoutV2TransferIntentsInTransaction({
      client,
      schoolId,
      batchId: fixture.batchId,
      expectedPlanFingerprint: `sha256:${'f'.repeat(64)}`,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_TRANSFER_PLAN_DRIFT' });

    await expect(runNested(async (nestedClient) => {
      await preparePayoutV2TransferIntentsInTransaction({
        client: nestedClient,
        schoolId,
        batchId: fixture.batchId,
        expectedPlanFingerprint: fixture.plan.plan_fingerprint,
      });
      throw new Error('injected rollback');
    })).rejects.toThrow('injected rollback');
    const after = await client.query(
      `SELECT
         (SELECT state FROM payout_batches WHERE school_id = $1 AND id = $2) AS state,
         (SELECT COUNT(*)::int FROM payout_transfers
           WHERE school_id = $1 AND payout_batch_id = $2) AS transfer_count`,
      [schoolId, fixture.batchId]
    );
    expect(after.rows[0]).toMatchObject({
      state: 'planned',
      transfer_count: 0,
    });
  });
});
