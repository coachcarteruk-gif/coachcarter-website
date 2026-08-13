// @ts-check
// Pure/static verification only. This suite does not call Stripe, Neon, Vercel,
// email, migrations, payout controllers, or any deployed environment.

const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  buildAccountCreateParams,
  findReconciliationMatches,
  makeCreationCommand,
  validateProviderAccount,
} = require('../api/_connect-v1-interim');
const {
  buildPreviewFromRows,
  classifyFundingRow,
  createInterimV1PayoutHandler,
  evidenceRecord,
  validateTransfer,
} = require('../api/_interim-v1-payout');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function fundingRow(overrides = {}) {
  return {
    booking_id: 501,
    scheduled_date: '2026-09-08',
    status: 'chargeable',
    learner_name: 'Reviewed learner',
    is_test_account: false,
    payouts_start_date: '2026-09-01',
    evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payment_origin: 'direct_slot',
    provider_livemode: true,
    stripe_checkout_session_id: 'cs_live_exact',
    stripe_payment_intent_id: 'pi_live_exact',
    stripe_payment_intent_status: 'succeeded',
    stripe_charge_id: 'ch_live_exact',
    stripe_charge_paid: true,
    stripe_charge_captured: true,
    stripe_charge_payment_intent_id: 'pi_live_exact',
    stripe_balance_transaction_id: 'txn_live_exact',
    stripe_balance_transaction_source_id: 'ch_live_exact',
    stripe_balance_transaction_type: 'charge',
    stripe_balance_transaction_amount_pence: 5500,
    stripe_balance_transaction_currency: 'gbp',
    stripe_balance_transaction_status: 'available',
    stripe_payment_created_at: '2026-09-02T09:00:00.000Z',
    stripe_funds_available_at: '2026-09-03T09:00:00.000Z',
    gross_collected_pence: 5500,
    stripe_fee_pence: 103,
    currency: 'gbp',
    evidence_status: 'complete',
    bcs_count: 1,
    bcs_contribution_pence: 5500,
    bcs_stripe_fee_pence: 103,
    bcs_refunded_at: null,
    bcs_absorbed_by: null,
    ct_type: 'slot_purchase',
    ct_source: 'stripe',
    ct_payment_method: 'card',
    ct_amount_pence: 5500,
    ct_stripe_fee_pence: 103,
    ct_session_id: 'cs_live_exact',
    ct_payment_intent_id: 'pi_live_exact',
    claimed_payout_id: null,
    ...overrides,
  };
}

function instructor(overrides = {}) {
  return {
    id: 19,
    school_id: 7,
    name: 'Target instructor',
    commission_rate: '0.85',
    weekly_franchise_fee_pence: 1000,
    stripe_account_id: 'acct_live_exact',
    stripe_onboarding_complete: true,
    payouts_paused: true,
    payouts_start_date: '2026-09-01',
    control_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ...overrides,
  };
}

test.describe('Simon interim v1 Connect identity', () => {
  test('uses stable school/instructor identity and stable provider idempotency', () => {
    const command = makeCreationCommand({
      schoolId: 7,
      instructorId: 19,
      payoutsStartDate: '2026-09-01',
      intentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(command.stableIdentity).toBe('cc:connect-v1:7:19:live:express');
    expect(command.idempotencyKey).toBe('cc-connect-v1-11111111-1111-4111-8111-111111111111');
    expect(command.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const params = buildAccountCreateParams({
      schoolId: 7,
      instructor: { id: 19, email: 'instructor@example.test' },
      intent: { id: '11111111-1111-4111-8111-111111111111', stable_identity: command.stableIdentity },
    });
    expect(params).toMatchObject({
      type: 'express',
      country: 'GB',
      metadata: {
        cc_connect_v1_intent_id: '11111111-1111-4111-8111-111111111111',
        cc_stable_identity: 'cc:connect-v1:7:19:live:express',
        cc_school_id: '7',
        cc_instructor_id: '19',
      },
    });
  });

  test('refuses test-mode or cross-scope provider evidence', () => {
    const facts = {
      schoolId: 7, instructorId: 19,
      intentId: '11111111-1111-4111-8111-111111111111',
      stableIdentity: 'cc:connect-v1:7:19:live:express',
    };
    const account = {
      id: 'acct_exact', livemode: false,
      metadata: {
        cc_connect_v1_intent_id: facts.intentId,
        cc_stable_identity: facts.stableIdentity,
        cc_school_id: '7', cc_instructor_id: '19',
      },
    };
    expect(() => validateProviderAccount(account, facts)).toThrow(/test-mode/i);
    expect(() => validateProviderAccount({ ...account, livemode: true, metadata: { ...account.metadata, cc_school_id: '8' } }, facts)).toThrow(/ownership/i);
  });

  test('bounded reconciliation finds exact metadata and never creates', async () => {
    let listCalls = 0;
    let createCalls = 0;
    const stripe = {
      accounts: {
        list: async () => {
          listCalls += 1;
          return { data: [{ id: 'acct_other', metadata: {} }, { id: 'acct_match', metadata: { cc_stable_identity: 'stable' } }], has_more: false };
        },
        create: async () => { createCalls += 1; },
      },
    };
    await expect(findReconciliationMatches(stripe, { stableIdentity: 'stable' })).resolves.toHaveLength(1);
    expect(listCalls).toBe(1);
    expect(createCalls).toBe(0);
  });
});

test.describe('Simon interim v1 exact funding and preview', () => {
  test('accepts only exact live direct-slot evidence', () => {
    expect(classifyFundingRow(fundingRow(), new Date('2026-09-04T00:00:00Z'))).toMatchObject({
      eligible: true, gross_pence: 5500, stripe_fee_pence: 103,
    });
    const cases = [
      [{ evidence_id: null, bcs_count: 0 }, 'NO_FUNDING_SOURCE'],
      [{ provider_livemode: false }, 'TEST_MODE_STRIPE_SOURCE'],
      [{ payment_origin: 'offer' }, 'UNAPPROVED_PAYMENT_ORIGIN'],
      [{ evidence_status: 'pending' }, 'STRIPE_EVIDENCE_PENDING'],
      [{ evidence_status: 'contradictory' }, 'STRIPE_EVIDENCE_CONTRADICTORY'],
      [{ stripe_payment_created_at: '2026-08-31T23:59:59Z' }, 'PAYMENT_BEFORE_START'],
      [{ bcs_count: 2 }, 'FUNDING_SOURCE_NOT_ONE_TO_ONE'],
      [{ stripe_charge_payment_intent_id: 'pi_other' }, 'STRIPE_PAYMENT_CHAIN_MISMATCH'],
      [{ stripe_balance_transaction_amount_pence: 5499 }, 'BALANCE_TRANSACTION_MISMATCH'],
      [{ ct_source: 'cash', ct_payment_method: 'cash' }, 'UNAPPROVED_LEDGER_SOURCE'],
      [{ is_test_account: true }, 'TEST_ACCOUNT'],
      [{ claimed_payout_id: 99 }, 'ALREADY_CLAIMED'],
    ];
    for (const [patch, reason] of cases) {
      expect(classifyFundingRow(fundingRow(patch), new Date('2026-09-04T00:00:00Z'))).toEqual({ eligible: false, reason });
    }
  });

  test('excludes the known £55/£1.03 shape when its payment predates the start boundary', () => {
    const result = classifyFundingRow(fundingRow({ stripe_payment_created_at: '2026-08-01T09:00:00Z' }), new Date('2026-09-04T00:00:00Z'));
    expect(result).toEqual({ eligible: false, reason: 'PAYMENT_BEFORE_START' });
  });

  test('uses current configured weekly fee and conserves exact gross/fee', () => {
    const preview = buildPreviewFromRows(instructor({ weekly_franchise_fee_pence: 1000 }), [fundingRow()], new Date('2026-09-04T00:00:00Z'));
    expect(preview.totals).toEqual({
      gross_pence: 5500,
      stripe_fees_pence: 103,
      weekly_franchise_fee_pence: 1000,
      commission_rate: null,
      proposed_transfer_pence: 4397,
    });
    expect(preview.included[0].instructor_amount_pence).toBe(4397);
    expect(preview.ready_for_approval).toBe(true);
    const changed = buildPreviewFromRows(instructor({ weekly_franchise_fee_pence: 9000 }), [fundingRow()], new Date('2026-09-04T00:00:00Z'));
    expect(changed.totals.proposed_transfer_pence).toBe(0);
    expect(changed.blockers).toContain('INSUFFICIENT_WEEK_MANUAL_HANDLING');
    expect(changed.preview_fingerprint).not.toBe(preview.preview_fingerprint);
  });

  test('writer records incomplete provider evidence as pending, never fee zero', () => {
    const pending = evidenceRecord({
      schoolId: 7, instructorId: 19, learnerId: 31, bookingId: 501,
      creditTransactionId: 601, bookingCreditSourceId: 701,
      providerLivemode: true,
      fundingEvidence: { checkoutSessionId: 'cs_live_exact', paymentIntentId: 'pi_live_exact', feePence: null },
    });
    expect(pending.evidence_status).toBe('pending');
    expect(pending.stripe_fee_pence).toBeNull();
  });
});

test.describe('Simon interim v1 authority, isolation, and preservation', () => {
  test('unrelated admin actions do not initialize the interim database client', async () => {
    expect(() => createInterimV1PayoutHandler({
      stripe: {},
      connectionString: 'deliberately-not-a-database-url',
    })).not.toThrow();

    const handler = createInterimV1PayoutHandler({
      stripe: {},
      connectionString: 'deliberately-not-a-database-url',
    });
    await expect(handler({ query: { action: 'list-instructors' } }, {})).resolves.toBe(false);
  });

  test('generic v1 payout selection excludes controlled instructors', () => {
    const source = read('api/_payout-helpers.js');
    expect(source).toContain('INTERIM_V1_DEDICATED_PATH_REQUIRED');
    expect(source.match(/NOT EXISTS \(\s*SELECT 1 FROM interim_v1_instructor_controls/g)).toHaveLength(2);
    expect(read('api/admin.js')).toContain('INTERIM_V1_UNPAUSE_FORBIDDEN');
  });

  test('approval and movement require separate exact confirmations and retain pause', () => {
    const source = read('api/_interim-v1-payout.js');
    expect(source).toContain('APPROVE_INTERIM_V1_FIRST_RUN_CONFIRMED');
    expect(source).toContain('PROCESS_INTERIM_V1_APPROVED_PAYOUT_CONFIRMED');
    expect(source).toContain('INTERIM_V1_STALE_APPROVAL');
    expect(source).toContain('INTERIM_V1_FIRST_RUN_ALREADY_COMPLETED');
    expect(source).not.toContain('payouts_paused = FALSE');
  });

  test('admin UI labels legacy bulk payout and gates interim controls to platform owner', () => {
    const html = read('public/admin/portal.html');
    const script = read('public/admin/portal.js');
    expect(html).toContain('Process Legacy Payouts');
    expect(html).toContain('owner-reviewed first payout');
    expect(script).toContain("role === 'superadmin'");
    expect(script).toContain('isPlatformOwner && i.interim_v1_controlled');
    expect(script).toContain('Approval does not move money');
    expect(script).toContain('instructor remains paused');
  });

  test('transfer validation is exact and live', () => {
    const intent = {
      id: '22222222-2222-4222-8222-222222222222',
      amount_pence: 4397,
      destination_account_id: 'acct_live_exact',
    };
    const transfer = {
      id: 'tr_live_exact', livemode: true, amount: 4397, currency: 'gbp', destination: 'acct_live_exact',
      metadata: { cc_interim_v1_transfer_intent_id: intent.id },
    };
    expect(validateTransfer(transfer, intent)).toBe(transfer);
    expect(() => validateTransfer({ ...transfer, amount: 4398 }, intent)).toThrow(/does not match/i);
  });

  test('migration is additive/inert and v2 evidence is not mutated', () => {
    const migration = read('db/migrations/043_simon_interim_v1_hardening.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS interim_v1_instructor_controls');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS interim_v1_funding_evidence');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS interim_v1_transfer_intents');
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(interim_v1|connect_v1)/i);
    expect(migration).not.toMatch(/(UPDATE|DELETE\s+FROM)\s+(connect_v2|payout_v2|stripe_launch)/i);
  });

  test('protected specifications retain their approved LF-normalized hashes', () => {
    const hashes = {
      'docs/stripe-connect-simon-launch-product-spec.md': '5D2E956C94A88D496265DCBDDBC85BC2E5F92FFCE262463C978081805302BED3',
      'docs/stripe-connect-simon-launch-technical-implementation-plan.md': 'C1C76E9DB3450D22C83B0CE3D9D47D835244CF9F51A73B120B3E3E7344851A2A',
    };
    for (const [relative, expected] of Object.entries(hashes)) {
      const normalized = read(relative).replace(/\r\n/g, '\n');
      const actual = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
      expect(actual).toBe(expected);
    }
  });
});
