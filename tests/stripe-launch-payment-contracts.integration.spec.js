// @ts-check
// Rollback-only Slice 2 contract tests. Nothing persists, and the suite is
// triple-gated to a caller-confirmed non-production database.

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
  || 'sk_test_stripe_launch_payment_contracts_integration';

const {
  PAYMENT_CONTRACT_SCHEMA_VERSION,
  PAYMENT_ORIGINS,
  materializeLaunchPaymentContract,
} = require('../api/_stripe-launch-payment-contracts');

const ENABLED = process.env.CC_TEST_DB === '1'
  && !!process.env.POSTGRES_URL_TEST
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1';
const root = path.resolve(__dirname, '..');
const migrationSql = fs.readFileSync(
  path.join(root, 'db', 'migrations', '039_stripe_launch_schema_foundation.sql'),
  'utf8'
);
const payoutSourceGuardFixSql = fs.readFileSync(
  path.join(root, 'db', 'migrations', '040_stripe_launch_payout_source_fill_once_fix.sql'),
  'utf8'
);
const hash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

test.describe.configure({ mode: 'serial' });
test.describe('Stripe launch Slice 2 database contracts', () => {
  test.skip(
    !ENABLED,
    'Requires CC_TEST_DB=1, POSTGRES_URL_TEST, and CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1'
  );

  let client;
  let schoolId;
  let instructorId;
  let learnerId;
  let adminId;
  let savepoint = 0;
  let fixtureNumber = 0;

  const transactionRunner = async (_options, callback) => callback(client);

  function uuid() {
    fixtureNumber += 1;
    return `10000000-0000-4000-8000-${String(fixtureNumber).padStart(12, '0')}`;
  }

  function evidence(suffix, overrides = {}) {
    return {
      checkoutSessionId: `cs_launch_${suffix}`,
      paymentIntentId: `pi_launch_${suffix}`,
      paymentIntentStatus: 'succeeded',
      chargeId: `ch_launch_${suffix}`,
      chargePaid: true,
      chargeCaptured: true,
      chargePaymentIntentId: `pi_launch_${suffix}`,
      balanceTransactionId: `txn_launch_${suffix}`,
      balanceTransactionSourceId: `ch_launch_${suffix}`,
      balanceTransactionType: 'charge',
      balanceTransactionAmountPence: 5500,
      balanceTransactionCurrency: 'gbp',
      balanceTransactionStatus: 'available',
      paymentCreatedAt: '2026-08-01T10:00:00.000Z',
      fundsAvailableAt: '2026-08-03T10:00:00.000Z',
      amountPence: 5500,
      currency: 'gbp',
      feePence: 103,
      source: 'balance_transaction',
      ...overrides,
    };
  }

  function metadata(candidateId, origin = PAYMENT_ORIGINS.DIRECT_SLOT) {
    return {
      payment_contract_candidate_id: candidateId,
      payment_contract_schema_version: PAYMENT_CONTRACT_SCHEMA_VERSION,
      payment_origin: origin,
    };
  }

  async function insertPaymentFixture({
    suffix = `f${fixtureNumber + 1}`,
    amountPence = 5500,
    feePence = 103,
    bookingPurpose = 'lesson',
    secondActiveBooking = false,
    rescheduled = false,
  } = {}) {
    fixtureNumber += 1;
    const bcsFeePence = feePence === null ? 0 : feePence;
    const sessionId = `cs_launch_${suffix}`;
    const paymentIntentId = `pi_launch_${suffix}`;
    const tx = await client.query(`
      INSERT INTO credit_transactions (
        learner_id, instructor_id, school_id, type, credits, minutes,
        amount_pence, payment_method, stripe_session_id,
        stripe_payment_intent_id, stripe_fee_pence, source
      ) VALUES ($1, $2, $3, 'slot_purchase', 1, 60, $4, 'card', $5, $6, $7, 'stripe')
      RETURNING id
    `, [learnerId, instructorId, schoolId, amountPence, sessionId, paymentIntentId, feePence]);

    const baseDay = 1 + (fixtureNumber % 25);
    const original = await client.query(`
      INSERT INTO lesson_bookings (
        learner_id, instructor_id, school_id, scheduled_date, start_time,
        end_time, status, minutes_deducted, created_by, payment_method,
        list_price_pence, list_price_source, booking_purpose
      ) VALUES ($1, $2, $3, make_date(2040, 1, $4), '09:00', '10:00',
        $5, 60, 'learner', 'card', $6, 'stripe_metadata', $7)
      RETURNING id
    `, [learnerId, instructorId, schoolId, baseDay,
      rescheduled ? 'refunded' : 'scheduled', amountPence, bookingPurpose]);
    await client.query(`
      INSERT INTO booking_credit_sources (
        booking_id, credit_transaction_id, school_id, minutes_drawn,
        rate_pence_per_minute, contribution_pence, stripe_fee_pence, refunded_at
      ) VALUES ($1, $2, $3, 60, $4, $5, $6, $7)
    `, [original.rows[0].id, tx.rows[0].id, schoolId,
      Math.floor(amountPence / 60), amountPence, bcsFeePence,
      rescheduled ? new Date('2026-08-02T00:00:00.000Z') : null]);

    let bookingId = original.rows[0].id;
    if (rescheduled || secondActiveBooking) {
      const replacement = await client.query(`
        INSERT INTO lesson_bookings (
          learner_id, instructor_id, school_id, scheduled_date, start_time,
          end_time, status, minutes_deducted, created_by, payment_method,
          list_price_pence, list_price_source, booking_purpose,
          rescheduled_from
        ) VALUES ($1, $2, $3, make_date(2040, 2, $4), '11:00', '12:00',
          'scheduled', 60, 'learner', 'card', $5, 'stripe_metadata', $6, $7)
        RETURNING id
      `, [learnerId, instructorId, schoolId, baseDay, amountPence,
        bookingPurpose, rescheduled ? original.rows[0].id : null]);
      await client.query(`
        INSERT INTO booking_credit_sources (
          booking_id, credit_transaction_id, school_id, minutes_drawn,
          rate_pence_per_minute, contribution_pence, stripe_fee_pence
        ) VALUES ($1, $2, $3, 60, $4, $5, $6)
      `, [replacement.rows[0].id, tx.rows[0].id, schoolId,
        Math.floor(amountPence / 60), amountPence, bcsFeePence]);
      bookingId = replacement.rows[0].id;
    }
    return {
      creditTransactionId: Number(tx.rows[0].id),
      bookingId: Number(bookingId),
      originalBookingId: Number(original.rows[0].id),
      suffix,
    };
  }

  async function materialize(fixture, options = {}) {
    const candidateId = options.candidateId || uuid();
    const origin = options.origin || PAYMENT_ORIGINS.DIRECT_SLOT;
    return materializeLaunchPaymentContract({
      connectionString: process.env.POSTGRES_URL_TEST,
      schoolId,
      creditTransactionId: fixture.creditTransactionId,
      bookingId: fixture.bookingId,
      metadata: metadata(candidateId, origin),
      expectedOrigin: origin,
      fundingEvidence: options.evidence || evidence(fixture.suffix),
      eventContext: {
        stripeEventId: `evt_${fixture.suffix}`,
        stripeEventType: 'checkout.session.completed',
      },
      now: new Date('2026-08-04T00:00:00.000Z'),
      transactionRunner,
    });
  }

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL
      && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('Refusing Slice 2 tests: test URL equals production URL');
    }
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    const baseSchema = await client.query(
      "SELECT to_regclass('public.payout_funding_sources') AS funding_sources, "
      + "to_regclass('public.lesson_bookings') AS bookings"
    );
    if (!baseSchema.rows[0].funding_sources || !baseSchema.rows[0].bookings) {
      test.skip(true, 'Configured test database does not contain the production-shaped base schema');
    }
    const schema = await client.query(
      "SELECT to_regclass('public.lesson_payment_contracts') AS relation"
    );
    if (!schema.rows[0].relation) await client.query(migrationSql);
    await client.query(payoutSourceGuardFixSql);

    const fixture = await client.query(`
      SELECT s.id AS school_id, i.id AS instructor_id, lu.id AS learner_id,
             a.id AS admin_id
      FROM schools s
      JOIN instructors i ON i.school_id = s.id AND i.active = TRUE
      JOIN learner_users lu ON lu.school_id = s.id
      JOIN admin_users a ON a.school_id = s.id
      WHERE NOT EXISTS (
        SELECT 1 FROM stripe_connect_launch_configs cfg WHERE cfg.school_id = s.id
      )
        AND NOT EXISTS (
          SELECT 1 FROM instructor_payout_agreement_versions av
          WHERE av.school_id = s.id AND av.instructor_id = i.id
        )
      ORDER BY s.id, i.id, lu.id, a.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Test database needs one unconfigured school with active instructor, learner and admin');
    }
    ({
      school_id: schoolId,
      instructor_id: instructorId,
      learner_id: learnerId,
      admin_id: adminId,
    } = fixture.rows[0]);

    await client.query(`
      INSERT INTO stripe_connect_launch_configs (
        id, school_id, cutover_at, accounting_version, mode,
        created_by_admin_id, created_at
      ) VALUES ($1, $2, '2026-07-31T00:00:00Z', 'simon_launch_v1',
        'shadow', $3, '2026-07-30T00:00:00Z')
    `, [uuid(), schoolId, adminId]);
    await client.query(`
      INSERT INTO instructor_payout_agreement_versions (
        id, school_id, instructor_id, version_number, starts_at, status,
        split_bps, weekly_franchise_fee_minor, currency, accepted_at,
        acceptance_evidence_reference, document_version,
        created_by_admin_id, approved_by_admin_id, created_at, approved_at,
        agreement_fingerprint
      ) VALUES ($1, $2, $3, 1, '2026-07-01T00:00:00Z', 'active',
        9000, 9000, 'gbp', '2026-07-01T00:00:00Z',
        'test:slice-2:accepted', 'test-slice-2-v1', $4, $4,
        '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', $5)
    `, [uuid(), schoolId, instructorId, adminId, hash(`slice2:${schoolId}:${instructorId}`)]);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepoint += 1;
    await client.query(`SAVEPOINT stripe_launch_slice_2_${savepoint}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT stripe_launch_slice_2_${savepoint}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  test('materializes one exact launch contract and replays idempotently without earnings or transfers', async () => {
    const fixture = await insertPaymentFixture({ suffix: 'exact' });
    const contractId = uuid();
    const first = await materialize(fixture, { candidateId: contractId });
    const replay = await materialize(fixture, { candidateId: contractId });
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);

    const result = await client.query(`
      SELECT c.evidence_status, c.regime, c.gross_amount_minor,
             c.stripe_fee_minor, c.split_bps,
             s.evidence_completeness, s.source_booking_id,
             b.lesson_payment_contract_id,
             (SELECT COUNT(*)::int FROM stripe_launch_booking_earnings
               WHERE school_id = c.school_id AND payment_contract_id = c.id) AS earnings,
             (SELECT COUNT(*)::int FROM stripe_launch_transfer_intents
               WHERE school_id = c.school_id AND source_payment_contract_id = c.id) AS transfers
      FROM lesson_payment_contracts c
      JOIN payout_funding_sources s ON s.id = c.funding_source_id AND s.school_id = c.school_id
      JOIN lesson_bookings b ON b.id = s.source_booking_id AND b.school_id = s.school_id
      WHERE c.id = $1 AND c.school_id = $2
    `, [contractId, schoolId]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      evidence_status: 'complete',
      regime: 'launch',
      evidence_completeness: 'complete',
      lesson_payment_contract_id: contractId,
      earnings: 0,
      transfers: 0,
    });
    expect(Number(result.rows[0].gross_amount_minor)).toBe(5500);
    expect(Number(result.rows[0].stripe_fee_minor)).toBe(103);
    expect(Number(result.rows[0].split_bps)).toBe(9000);
    expect(Number(result.rows[0].source_booking_id)).toBe(fixture.bookingId);
  });

  test('classifies pre-cutover payment creation as permanently ineligible', async () => {
    const fixture = await insertPaymentFixture({ suffix: 'precutover' });
    const result = await materialize(fixture, {
      evidence: evidence('precutover', {
        paymentCreatedAt: '2026-07-30T23:59:59.999Z',
      }),
    });
    expect(result.contract).toMatchObject({
      regime: 'legacy',
      evidence_status: 'ineligible',
      ineligibility_code: 'pre_cutover_payment',
    });
  });

  test('missing Stripe fee evidence preserves a retryable origin without guessing a contract', async () => {
    const fixture = await insertPaymentFixture({ suffix: 'missingfee' });
    const pending = await materialize(fixture, {
      evidence: evidence('missingfee', { feePence: null, source: null }),
    });
    expect(pending).toMatchObject({ materialized: false, status: 'pending' });
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM payout_funding_sources
          WHERE school_id = $1 AND credit_transaction_id = $2) AS sources,
        (SELECT COUNT(*)::int FROM lesson_payment_contracts
          WHERE school_id = $1 AND stripe_payment_intent_id = $3) AS contracts
    `, [schoolId, fixture.creditTransactionId, 'pi_launch_missingfee']);
    expect(counts.rows[0]).toEqual({ sources: 0, contracts: 0 });
  });

  test('provisional legacy zero fee is unknown, while a known fee mismatch stays contradictory', async () => {
    const provisional = await insertPaymentFixture({ suffix: 'provisionalfee', feePence: null });
    const recovered = await materialize(provisional, {
      evidence: evidence('provisionalfee', { feePence: 199 }),
    });
    expect(recovered.contract.evidence_status).toBe('complete');
    expect(Number(recovered.contract.stripe_fee_minor)).toBe(199);

    const known = await insertPaymentFixture({ suffix: 'knownfeemismatch', feePence: 198 });
    const mismatch = await materialize(known, {
      evidence: evidence('knownfeemismatch', { feePence: 199 }),
    });
    expect(mismatch.contract.evidence_status).toBe('contradictory');
    expect(mismatch.contract.contradiction_code).toContain('credit_transaction_stripe_fee_contradiction');
  });

  test('materializes all four approved payment origins', async () => {
    for (const origin of Object.values(PAYMENT_ORIGINS)) {
      const suffix = `origin_${origin}`;
      const fixture = await insertPaymentFixture({
        suffix,
        bookingPurpose: origin === PAYMENT_ORIGINS.TEST_DATE_DIRECT ? 'test_date' : 'lesson',
      });
      const result = await materialize(fixture, { origin });
      expect(result.contract.origin).toBe(origin);
      expect(result.contract.evidence_status).toBe('complete');
    }
  });

  test('amount/currency contradictions and one-to-many mappings never become complete', async () => {
    const amountFixture = await insertPaymentFixture({ suffix: 'amount' });
    const amount = await materialize(amountFixture, {
      evidence: evidence('amount', {
        amountPence: 5400,
        balanceTransactionAmountPence: 5400,
        currency: 'usd',
        balanceTransactionCurrency: 'usd',
      }),
    });
    expect(amount.contract.evidence_status).toBe('contradictory');
    expect(amount.source.evidence_completeness).toBe('contradictory');
    expect(Number(amount.source.payable_pool_pence)).toBe(0);

    const manyFixture = await insertPaymentFixture({ suffix: 'onetomany', secondActiveBooking: true });
    const many = await materialize(manyFixture);
    expect(many.contract.evidence_status).toBe('contradictory');
    expect(many.contract.contradiction_code).toContain('payment_does_not_map_to_exactly_one_active_lesson');
  });

  test('links a rescheduled replacement only when it is the sole active lesson', async () => {
    const fixture = await insertPaymentFixture({ suffix: 'reschedule', rescheduled: true });
    const result = await materialize(fixture);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect(result.contract.evidence_status).toBe('complete');
    const links = await client.query(`
      SELECT id, status, lesson_payment_contract_id
      FROM lesson_bookings
      WHERE id = ANY($1::integer[])
      ORDER BY id
    `, [[fixture.originalBookingId, fixture.bookingId]]);
    expect(links.rows.find((row) => Number(row.id) === fixture.originalBookingId)
      .lesson_payment_contract_id).toBeNull();
    expect(links.rows.find((row) => Number(row.id) === fixture.bookingId)
      .lesson_payment_contract_id).toBe(result.contract.id);
  });

  test('rejects a booking outside the source school/learner/instructor contract', async () => {
    const fixture = await insertPaymentFixture({ suffix: 'scope' });
    await expect(materializeLaunchPaymentContract({
      connectionString: process.env.POSTGRES_URL_TEST,
      schoolId,
      creditTransactionId: fixture.creditTransactionId,
      bookingId: fixture.bookingId + 999999,
      metadata: metadata(uuid()),
      expectedOrigin: PAYMENT_ORIGINS.DIRECT_SLOT,
      fundingEvidence: evidence('scope'),
      transactionRunner,
    })).rejects.toMatchObject({ code: 'STRIPE_LAUNCH_BOOKING_SCOPE_MISMATCH' });
  });
});
