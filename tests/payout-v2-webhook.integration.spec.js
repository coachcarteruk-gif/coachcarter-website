// @ts-check
// Rollback-only Neon verification for inactive Payout v2 Slice 5.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-webhook.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const {
  ingestSignedPayoutV2Webhook,
} = require('../api/_payout-v2-webhook');
const {
  readPayoutV2BankVisibility,
} = require('../api/_payout-v2-bank-visibility');

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
  path.resolve(
    __dirname,
    '..',
    'db',
    'migrations',
    '035_payout_v2_ledger_foundation.sql'
  ),
  'utf8'
);
const diagnosticSql = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    'db',
    'diagnostics',
    'payout-v2-bank-payout-visibility.sql'
  ),
  'utf8'
);
const signingSecret = 'whsec_payout_v2_slice5_fixture';
// Test-only signing helper: it never makes a Stripe request and intentionally
// exercises stripe-node's local webhook-signature implementation directly.
const stripeVerifier = new Stripe('sk_test_payout_v2_slice5_fixture');

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function signedEvent(event) {
  const payload = JSON.stringify(event);
  const signature = stripeVerifier.webhooks.generateTestHeaderString({
    payload,
    secret: signingSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });
  return { payload, signature };
}

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 signed webhook and bank visibility database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let schoolId;
  let instructorId;
  let learnerId;
  let savepoint = 0;
  let nested = 0;

  async function runNested(callback) {
    nested += 1;
    const name = `payout_v2_webhook_nested_${nested}`;
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

  async function createFixture({
    suffix = 'a',
    amountPence = 8250,
    stripeTransferId = null,
    batchId = null,
  } = {}) {
    const planFingerprint = hash(suffix === 'a' ? 'f' : 'e');
    const source = await client.query(
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
         $4, $5, $6, 'gbp',
         $7, 0, $7,
         $7, 'available', $8,
         NOW(), '{}'::jsonb
       )
       RETURNING id`,
      [
        schoolId,
        learnerId,
        instructorId,
        `pi_slice5_${suffix}`,
        `ch_slice5_${suffix}`,
        `txn_source_slice5_${suffix}`,
        amountPence,
        hash(suffix),
      ]
    );
    let resolvedBatchId = batchId;
    if (!resolvedBatchId) {
      const batch = await client.query(
        `INSERT INTO payout_batches (
           school_id, instructor_id, destination_school_id, payout_route,
           period_start, period_end, currency, gross_pence,
           stripe_fees_pence, platform_fee_pence, franchise_fee_pence,
           instructor_amount_pence, shortfall_pence, deposit_deducted_pence,
           recovery_deducted_pence, state, calculation_version,
           plan_fingerprint, plan_json, created_by_type
         )
         VALUES (
           $1, $2, NULL, 'instructor_direct',
           DATE '2099-01-01', DATE '2099-01-07', 'gbp', $3,
           0, 0, 0,
           $3, 0, 0,
           0, 'transferred', 'payout-v2-earning-planner-v1',
           $4, $5::jsonb, 'system'
         )
         RETURNING id`,
        [
          schoolId,
          instructorId,
          amountPence,
          planFingerprint,
          JSON.stringify({
            calculation_version: 'payout-v2-earning-planner-v1',
            school_id: schoolId,
          }),
        ]
      );
      resolvedBatchId = Number(batch.rows[0].id);
    }
    const logical = hash(suffix === 'a' ? 'a' : 'b');
    const idempotencyKey = `payout-v2:slice5-${suffix}`;
    const transferGroup = `payout-v2-slice5-${suffix}`;
    const transfer = await client.query(
      `INSERT INTO payout_transfers (
         school_id, payout_batch_id, instructor_id, destination_school_id,
         stripe_destination_account_id, stripe_source_charge_id,
         amount_pence, currency, idempotency_key, transfer_group,
         plan_fingerprint, logical_transfer_fingerprint, stripe_transfer_id,
         state, request_created_at, stripe_created_at, metadata
       )
       VALUES (
         $1, $2, $3, NULL,
         'acct_payout_v2_slice5', $4,
         $5, 'gbp', $6, $7,
         $8, $9, $10,
         'transferred', NOW(), NOW(), $11::jsonb
       )
       RETURNING *`,
      [
        schoolId,
        resolvedBatchId,
        instructorId,
        `ch_slice5_${suffix}`,
        amountPence,
        idempotencyKey,
        transferGroup,
        planFingerprint,
        logical,
        stripeTransferId,
        JSON.stringify({
          school_id: String(schoolId),
          payout_batch_id: String(resolvedBatchId),
          plan_fingerprint: planFingerprint,
          logical_transfer_fingerprint: logical,
          stripe_idempotency_key: idempotencyKey,
          source_group: `stripe-charge:ch_slice5_${suffix}`,
        }),
      ]
    );
    await client.query(
      `INSERT INTO payout_transfer_sources (
         school_id, payout_transfer_id, funding_source_id,
         amount_pence, source_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        schoolId,
        transfer.rows[0].id,
        source.rows[0].id,
        amountPence,
        hash(suffix === 'a' ? 'c' : 'd'),
      ]
    );
    return {
      batchId: resolvedBatchId,
      transfer: transfer.rows[0],
      stripeTransfer: {
        id: stripeTransferId || `tr_slice5_${suffix}`,
        object: 'transfer',
        amount: amountPence,
        currency: 'gbp',
        destination: 'acct_payout_v2_slice5',
        source_transaction: `ch_slice5_${suffix}`,
        transfer_group: transferGroup,
        metadata: {
          school_id: String(schoolId),
          payout_batch_id: String(resolvedBatchId),
          plan_fingerprint: planFingerprint,
          payout_v2_logical_transfer_fingerprint: logical,
          payout_v2_idempotency_key: idempotencyKey,
          source_group: `stripe-charge:ch_slice5_${suffix}`,
        },
        created: 1784970000,
        livemode: false,
      },
    };
  }

  async function ingest(event, stripeReader = null) {
    const signed = signedEvent(event);
    return ingestSignedPayoutV2Webhook({
      rawBody: signed.payload,
      signature: signed.signature,
      webhookSecret: signingSecret,
      constructEvent: stripeVerifier.webhooks.constructEvent.bind(
        stripeVerifier.webhooks
      ),
      runInTransaction: runNested,
      stripeReader,
    });
  }

  function payoutReader(payoutId, fixtures) {
    const transfers = new Map(
      fixtures.map((fixture) => [fixture.stripeTransfer.id, fixture.stripeTransfer])
    );
    return {
      async listPayoutBalanceTransactions() {
        return fixtures.map((fixture, index) => ({
          id: `txn_payout_slice5_${index}_${payoutId}`,
          object: 'balance_transaction',
          type: 'transfer',
          amount: Number(fixture.transfer.amount_pence),
          currency: 'gbp',
          source: fixture.stripeTransfer.id,
          payout: payoutId,
          created: 1784970100 + index,
        }));
      },
      async retrieveTransfer({ stripeTransferId }) {
        return transfers.get(stripeTransferId);
      },
    };
  }

  function payoutEvent({
    id,
    type = 'payout.paid',
    status = type === 'payout.failed' ? 'failed' : 'paid',
    amount = 8250,
    created = 1784970200,
  }) {
    return {
      id: `evt_${id}`,
      type,
      account: 'acct_payout_v2_slice5',
      livemode: false,
      created,
      data: {
        object: {
          id: `po_${id}`,
          object: 'payout',
          amount,
          currency: 'gbp',
          status,
          created: 1784970000,
          arrival_date: 1785056400,
          automatic: true,
          method: 'standard',
          type: 'bank_account',
          failure_code: status === 'failed' ? 'account_closed' : null,
          failure_message: status === 'failed' ? 'The bank rejected the payout.' : null,
          livemode: false,
        },
      },
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
    await client.query(`SAVEPOINT payout_v2_webhook_${savepoint}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      `INSERT INTO payout_v2_connected_account_scopes (
         school_id, stripe_account_id, owner_type, instructor_id,
         destination_school_id, evidence_json
       )
       VALUES (
         $1, 'acct_payout_v2_slice5', 'instructor', $2, NULL,
         '{"fixture":true}'::jsonb
       )`,
      [schoolId, instructorId]
    );
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_webhook_${savepoint}`);
    await client.query(`RELEASE SAVEPOINT payout_v2_webhook_${savepoint}`);
  });

  test.afterAll(async () => {
    if (!ENABLED || !client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  test('valid signed transfer event attaches before the local success write and deduplicates replay', async () => {
    const fixture = await createFixture({ suffix: 'a', stripeTransferId: null });
    const event = {
      id: 'evt_transfer_before_write',
      type: 'transfer.created',
      account: 'acct_payout_v2_slice5',
      livemode: false,
      created: 1784970200,
      data: { object: fixture.stripeTransfer },
    };
    const first = await ingest(event);
    expect(first.ok).toBe(true);
    expect(first.status).toBe('transfer_observed');
    const stored = await client.query(
      `SELECT stripe_transfer_id, state
       FROM payout_transfers
       WHERE school_id = $1 AND id = $2`,
      [schoolId, fixture.transfer.id]
    );
    expect(stored.rows[0]).toMatchObject({
      stripe_transfer_id: 'tr_slice5_a',
      state: 'transferred',
    });
    const duplicate = await ingest(event);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.status).toBe('duplicate_processed');
    const receipts = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM stripe_event_receipts
       WHERE school_id = $1 AND stripe_event_id = $2`,
      [schoolId, event.id]
    );
    expect(Number(receipts.rows[0].count)).toBe(1);
  });

  test('paid event can arrive before created and one bank payout links multiple transfers exactly', async () => {
    const first = await createFixture({
      suffix: 'a',
      amountPence: 8250,
      stripeTransferId: 'tr_slice5_a',
    });
    const second = await createFixture({
      suffix: 'b',
      amountPence: 5500,
      stripeTransferId: 'tr_slice5_b',
    });
    const paid = payoutEvent({
      id: 'multi_paid',
      amount: 13750,
      created: 1784970200,
    });
    const reader = payoutReader('po_multi_paid', [first, second]);
    const paidResult = await ingest(paid, reader);
    expect(paidResult.ok).toBe(true);
    expect(paidResult.matched_transfer_ids.sort()).toEqual([
      Number(first.transfer.id),
      Number(second.transfer.id),
    ].sort());
    const duplicatePaid = await ingest(paid, reader);
    expect(duplicatePaid).toMatchObject({
      duplicate: true,
      status: 'duplicate_processed',
    });
    const created = payoutEvent({
      id: 'multi_paid_created',
      type: 'payout.created',
      status: 'pending',
      amount: 13750,
      created: 1784970300,
    });
    created.data.object.id = 'po_multi_paid';
    const createdResult = await ingest(created, reader);
    expect(createdResult.ok).toBe(true);
    const payout = await client.query(
      `SELECT state, amount_pence
       FROM connected_bank_payouts
       WHERE school_id = $1 AND stripe_payout_id = 'po_multi_paid'`,
      [schoolId]
    );
    expect(payout.rows[0]).toMatchObject({ state: 'paid', amount_pence: 13750 });
    const links = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM connected_bank_payout_transfer_links
       WHERE school_id = $1`,
      [schoolId]
    );
    expect(Number(links.rows[0].count)).toBe(2);
    const batches = await client.query(
      `SELECT state
       FROM payout_batches
       WHERE school_id = $1 AND id IN ($2, $3)
       ORDER BY id`,
      [schoolId, first.batchId, second.batchId]
    );
    expect(batches.rows.map((row) => row.state)).toEqual([
      'bank_paid',
      'bank_paid',
    ]);
  });

  test('failed connected payout marks bank failure without erasing the Connect transfer', async () => {
    const fixture = await createFixture({
      suffix: 'a',
      stripeTransferId: 'tr_slice5_a',
    });
    const event = payoutEvent({
      id: 'failed',
      type: 'payout.failed',
      status: 'failed',
    });
    const result = await ingest(event, payoutReader('po_failed', [fixture]));
    expect(result.ok).toBe(true);
    const transfer = await client.query(
      `SELECT state, stripe_transfer_id
       FROM payout_transfers
       WHERE school_id = $1 AND id = $2`,
      [schoolId, fixture.transfer.id]
    );
    expect(transfer.rows[0]).toMatchObject({
      state: 'transferred',
      stripe_transfer_id: 'tr_slice5_a',
    });
    const batch = await client.query(
      `SELECT state FROM payout_batches WHERE school_id = $1 AND id = $2`,
      [schoolId, fixture.batchId]
    );
    expect(batch.rows[0].state).toBe('bank_payout_failed');
  });

  test('transfer reversal and source refund are append-only review evidence with no automatic correction', async () => {
    const fixture = await createFixture({
      suffix: 'a',
      stripeTransferId: 'tr_slice5_a',
    });
    const reversedTransfer = {
      ...fixture.stripeTransfer,
      reversed: true,
      amount_reversed: 8250,
    };
    const reversalEvent = {
      id: 'evt_transfer_reversed',
      type: 'transfer.reversed',
      account: 'acct_payout_v2_slice5',
      livemode: false,
      created: 1784970200,
      data: { object: reversedTransfer },
    };
    const reversal = await ingest(reversalEvent);
    expect(reversal).toMatchObject({
      ok: false,
      status: 'transfer_reversal_recorded',
      operator_review_required: true,
      stripe_mutation_called: false,
    });
    const refundEvent = {
      id: 'evt_charge_refunded',
      type: 'charge.refunded',
      livemode: false,
      created: 1784970300,
      data: {
        object: {
          id: 'ch_slice5_a',
          object: 'charge',
          amount: 8250,
          amount_refunded: 8250,
          currency: 'gbp',
          refunded: true,
          created: 1784970000,
          metadata: { school_id: String(schoolId) },
          livemode: false,
        },
      },
    };
    const refund = await ingest(refundEvent);
    expect(refund).toMatchObject({
      ok: false,
      status: 'negative_source_evidence_recorded',
      operator_review_required: true,
      automatic_adjustment_created: false,
      stripe_mutation_called: false,
    });
    const transfer = await client.query(
      `SELECT state, stripe_transfer_id
       FROM payout_transfers
       WHERE school_id = $1 AND id = $2`,
      [schoolId, fixture.transfer.id]
    );
    expect(transfer.rows[0]).toMatchObject({
      state: 'reversed',
      stripe_transfer_id: 'tr_slice5_a',
    });
    const evidence = await client.query(
      `SELECT relationship
       FROM payout_v2_stripe_evidence_transfer_links
       WHERE school_id = $1
       ORDER BY relationship`,
      [schoolId]
    );
    expect(evidence.rows.map((row) => row.relationship)).toEqual([
      'source_refund',
      'transfer_reversal',
    ]);
    const adjustments = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM payout_adjustments
       WHERE school_id = $1`,
      [schoolId]
    );
    expect(Number(adjustments.rows[0].count)).toBe(0);
  });

  test('uncorrelated connected payout is retained for operator review without guessing', async () => {
    const event = payoutEvent({ id: 'uncorrelated', amount: 9900 });
    const reader = {
      async listPayoutBalanceTransactions() {
        return [{
          id: 'txn_uncorrelated',
          type: 'charge',
          amount: 9900,
          currency: 'gbp',
          source: 'ch_unrelated',
          payout: 'po_uncorrelated',
          created: 1784970000,
        }];
      },
      async retrieveTransfer() {
        throw new Error('should not retrieve');
      },
    };
    const result = await ingest(event, reader);
    expect(result.ok).toBe(false);
    expect(result.operator_review_required).toBe(true);
    expect(result.reasons).toContain('unmatched_non_transfer_payout_balance_transaction');
    const payout = await client.query(
      `SELECT stripe_payout_id
       FROM connected_bank_payouts
       WHERE school_id = $1 AND stripe_payout_id = 'po_uncorrelated'`,
      [schoolId]
    );
    expect(payout.rowCount).toBe(1);
    const receipt = await client.query(
      `SELECT processing_status
       FROM stripe_event_receipts
       WHERE school_id = $1 AND stripe_event_id = $2`,
      [schoolId, event.id]
    );
    expect(receipt.rows[0].processing_status).toBe('manual_review');
  });

  test('partial processing failure records retryable receipt and retry resumes safely', async () => {
    const fixture = await createFixture({
      suffix: 'a',
      stripeTransferId: 'tr_slice5_a',
    });
    const event = payoutEvent({ id: 'retry' });
    let attempts = 0;
    const reader = payoutReader('po_retry', [fixture]);
    const flakyReader = {
      ...reader,
      async listPayoutBalanceTransactions(args) {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary Stripe read failure');
        return reader.listPayoutBalanceTransactions(args);
      },
    };
    await expect(ingest(event, flakyReader)).rejects.toMatchObject({
      code: 'PAYOUT_V2_WEBHOOK_PROCESSING_FAILED',
      retryable: true,
    });
    const failed = await client.query(
      `SELECT processing_status
       FROM stripe_event_receipts
       WHERE school_id = $1 AND stripe_event_id = $2`,
      [schoolId, event.id]
    );
    expect(failed.rows[0].processing_status).toBe('failed');
    const retried = await ingest(event, flakyReader);
    expect(retried.ok).toBe(true);
    const processed = await client.query(
      `SELECT processing_status
       FROM stripe_event_receipts
       WHERE school_id = $1 AND stripe_event_id = $2`,
      [schoolId, event.id]
    );
    expect(processed.rows[0].processing_status).toBe('processed');
  });

  test('unknown and cross-school connected scope is rejected before receipt claiming', async () => {
    const unknown = payoutEvent({ id: 'unknown' });
    unknown.account = 'acct_unknown_slice5';
    await expect(ingest(unknown, payoutReader('po_unknown', []))).rejects.toMatchObject({
      code: 'PAYOUT_V2_CONNECTED_ACCOUNT_UNKNOWN',
    });

    const fixture = await createFixture({ suffix: 'a', stripeTransferId: null });
    fixture.stripeTransfer.metadata.school_id = String(schoolId + 999);
    const crossSchool = {
      id: 'evt_cross_school',
      type: 'transfer.created',
      account: 'acct_payout_v2_slice5',
      livemode: false,
      created: 1784970200,
      data: { object: fixture.stripeTransfer },
    };
    await expect(ingest(crossSchool)).rejects.toMatchObject({
      code: 'PAYOUT_V2_TRANSFER_SCHOOL_CONTRADICTION',
    });
    const receipts = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM stripe_event_receipts
       WHERE school_id = $1
         AND stripe_event_id IN ('evt_unknown', 'evt_cross_school')`,
      [schoolId]
    );
    expect(Number(receipts.rows[0].count)).toBe(0);
  });

  test('read model and same-day diagnostic report visibility without mutation', async () => {
    await createFixture({
      suffix: 'a',
      stripeTransferId: 'tr_slice5_a',
    });
    const before = await client.query(
      `SELECT COUNT(*)::int AS count FROM payout_batches WHERE school_id = $1`,
      [schoolId]
    );
    const result = await readPayoutV2BankVisibility({
      client,
      schoolId,
      now: new Date('2099-01-08T12:00:00.000Z'),
    });
    expect(result.mode).toBe('inactive_read_only');
    expect(result.transferred_without_downstream_visibility).toHaveLength(1);
    expect(result.operator_review_required).toBe(true);
    const after = await client.query(
      `SELECT COUNT(*)::int AS count FROM payout_batches WHERE school_id = $1`,
      [schoolId]
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);

    const diagnostic = diagnosticSql.replaceAll(
      ":'school_id'",
      String(schoolId)
    );
    await client.query(diagnostic);
  });
});
