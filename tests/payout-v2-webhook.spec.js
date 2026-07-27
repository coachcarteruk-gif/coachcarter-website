// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  immutableTransferEvidence,
  immutablePayoutEvidence,
  payoutState,
  transferIdentityReasons,
  ingestSignedPayoutV2Webhook,
} = require('../api/_payout-v2-webhook');
const {
  PAYOUT_V2_STATE_COPY,
} = require('../api/_payout-v2-bank-visibility');

const root = path.resolve(__dirname, '..');

function localTransfer() {
  return {
    id: 1,
    school_id: 7,
    payout_batch_id: 19,
    amount_pence: 8250,
    currency: 'gbp',
    stripe_destination_account_id: 'acct_destination',
    stripe_source_charge_id: 'ch_source',
    idempotency_key: 'payout-v2:idempotency',
    transfer_group: 'payout-v2-b19-source',
    plan_fingerprint: `sha256:${'a'.repeat(64)}`,
    logical_transfer_fingerprint: `sha256:${'b'.repeat(64)}`,
    stripe_transfer_id: 'tr_slice5',
  };
}

function stripeTransfer(overrides = {}) {
  const local = localTransfer();
  return {
    id: local.stripe_transfer_id,
    object: 'transfer',
    amount: local.amount_pence,
    currency: local.currency,
    destination: local.stripe_destination_account_id,
    source_transaction: local.stripe_source_charge_id,
    transfer_group: local.transfer_group,
    metadata: {
      school_id: String(local.school_id),
      payout_batch_id: String(local.payout_batch_id),
      plan_fingerprint: local.plan_fingerprint,
      payout_v2_logical_transfer_fingerprint:
        local.logical_transfer_fingerprint,
      payout_v2_idempotency_key: local.idempotency_key,
      source_group: 'stripe-charge:ch_source',
    },
    created: 1784970000,
    livemode: false,
    ...overrides,
  };
}

test('signature rejection occurs before database or Stripe read work', async () => {
  let transactionCalls = 0;
  let stripeReadCalls = 0;
  await expect(ingestSignedPayoutV2Webhook({
    rawBody: '{}',
    signature: 'bad',
    webhookSecret: 'whsec_test',
    constructEvent() {
      throw new Error('invalid signature');
    },
    runInTransaction: async () => {
      transactionCalls += 1;
    },
    stripeReader: {
      async listPayoutBalanceTransactions() {
        stripeReadCalls += 1;
        return [];
      },
    },
  })).rejects.toMatchObject({
    code: 'PAYOUT_V2_WEBHOOK_SIGNATURE_INVALID',
  });
  expect(transactionCalls).toBe(0);
  expect(stripeReadCalls).toBe(0);
});

test('missing signature is rejected before verifier invocation', async () => {
  let verifierCalls = 0;
  await expect(ingestSignedPayoutV2Webhook({
    rawBody: '{}',
    signature: '',
    webhookSecret: 'whsec_test',
    constructEvent() {
      verifierCalls += 1;
      return {};
    },
    runInTransaction: async () => {},
  })).rejects.toMatchObject({
    code: 'PAYOUT_V2_WEBHOOK_SIGNATURE_REQUIRED',
  });
  expect(verifierCalls).toBe(0);
});

test('verified unsupported events are ignored without a database claim', async () => {
  let transactionCalls = 0;
  const result = await ingestSignedPayoutV2Webhook({
    rawBody: '{}',
    signature: 'valid',
    webhookSecret: 'whsec_test',
    constructEvent() {
      return {
        id: 'evt_ignored',
        type: 'customer.created',
        livemode: false,
        data: { object: { id: 'cus_ignored' } },
      };
    },
    runInTransaction: async () => {
      transactionCalls += 1;
    },
  });
  expect(result.status).toBe('ignored_verified_event');
  expect(transactionCalls).toBe(0);
});

test('transfer evidence retains only immutable non-PII identity fields', () => {
  const evidence = immutableTransferEvidence({
    ...stripeTransfer(),
    description: 'Learner Name',
    metadata: {
      ...stripeTransfer().metadata,
      learner_email: 'private@example.test',
    },
  });
  expect(evidence.id).toBe('tr_slice5');
  expect(evidence.metadata.school_id).toBe('7');
  expect(JSON.stringify(evidence)).not.toContain('private@example.test');
  expect(JSON.stringify(evidence)).not.toContain('Learner Name');
});

test('transfer identity matcher names each immutable contradiction', () => {
  const baseline = immutableTransferEvidence(stripeTransfer());
  expect(transferIdentityReasons(localTransfer(), baseline, 7)).toEqual([]);

  const cases = [
    [{ amount: 1 }, 'amount_mismatch'],
    [{ currency: 'usd' }, 'currency_mismatch'],
    [{ destination: 'acct_other' }, 'destination_mismatch'],
    [{ source_transaction: 'ch_other' }, 'source_transaction_mismatch'],
    [{ transfer_group: 'other' }, 'transfer_group_mismatch'],
    [{ metadata: { ...stripeTransfer().metadata, plan_fingerprint: `sha256:${'c'.repeat(64)}` } }, 'plan_fingerprint_mismatch'],
    [{ metadata: { ...stripeTransfer().metadata, payout_v2_logical_transfer_fingerprint: `sha256:${'d'.repeat(64)}` } }, 'logical_transfer_fingerprint_mismatch'],
    [{ metadata: { ...stripeTransfer().metadata, payout_v2_idempotency_key: 'other' } }, 'idempotency_metadata_mismatch'],
  ];
  for (const [override, reason] of cases) {
    const evidence = immutableTransferEvidence(stripeTransfer(override));
    expect(transferIdentityReasons(localTransfer(), evidence, 7)).toContain(reason);
  }
});

test('connected payout evidence excludes bank destination details and secrets', () => {
  const evidence = immutablePayoutEvidence({
    id: 'po_slice5',
    object: 'payout',
    amount: 15000,
    currency: 'gbp',
    status: 'paid',
    created: 1784970000,
    arrival_date: 1785056400,
    destination: 'ba_secret_bank_account',
    metadata: { learner_email: 'private@example.test' },
  });
  expect(evidence.id).toBe('po_slice5');
  expect(JSON.stringify(evidence)).not.toContain('ba_secret');
  expect(JSON.stringify(evidence)).not.toContain('private@example.test');
});

test('bank payout state mapping is explicit and terminal evidence wins', () => {
  expect(payoutState('payout.created', 'pending')).toBe('pending');
  expect(payoutState('payout.updated', 'in_transit')).toBe('in_transit');
  expect(payoutState('payout.paid', 'pending')).toBe('paid');
  expect(payoutState('payout.failed', 'pending')).toBe('failed');
});

test('read copy never overstates Connect transfer as bank paid', () => {
  expect(PAYOUT_V2_STATE_COPY.transferred).toContain('connected Stripe balance');
  expect(PAYOUT_V2_STATE_COPY.transferred).toContain('bank arrival is not yet confirmed');
  expect(PAYOUT_V2_STATE_COPY.bank_paid).toContain('bank payout was paid');
  expect(PAYOUT_V2_STATE_COPY.bank_payout_failed).toContain('Connect transfer still exists');
});

test('Slice 5 remains inactive and contains no Stripe mutation/client fallback', () => {
  const webhookSource = fs.readFileSync(
    path.join(root, 'api', '_payout-v2-webhook.js'),
    'utf8'
  );
  const adminSource = fs.readFileSync(path.join(root, 'api', 'admin.js'), 'utf8');
  const liveWebhookSource = fs.readFileSync(
    path.join(root, 'api', 'webhook.js'),
    'utf8'
  );
  const vercelSource = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  expect(webhookSource).not.toMatch(/require\(['"]stripe['"]\)/);
  expect(webhookSource).not.toMatch(/transfers\.create|refunds\.create|payouts\.create|reversals\.create/);
  expect(webhookSource).not.toMatch(/lesson_types|custom_hourly_rate|bulk_hourly|list_price_pence/);
  expect(adminSource).not.toContain("_payout-v2-webhook");
  expect(liveWebhookSource).not.toContain("_payout-v2-webhook");
  expect(vercelSource).not.toContain('payout-v2-bank');
  expect(vercelSource).not.toContain('payout-v2-webhook');
});

test('receipt claim is concurrency-safe and never deletes financial or claim rows', () => {
  const webhookSource = fs.readFileSync(
    path.join(root, 'api', '_payout-v2-webhook.js'),
    'utf8'
  );
  expect(webhookSource).toContain('ON CONFLICT (school_id, stripe_event_id)');
  expect(webhookSource).toContain(
    "stripe_event_receipts.processing_status IN ('received', 'failed')"
  );
  expect(webhookSource).toContain(
    "stripe_event_receipts.processing_status = 'processing'"
  );
  expect(webhookSource).not.toMatch(
    /DELETE\s+FROM\s+(stripe_event_receipts|payout_batch_earnings|booking_earnings|payout_batches|payout_transfers|payout_transfer_sources)/i
  );
});

test('schema provides global event/payout/balance identities and append-only evidence', () => {
  const schema = fs.readFileSync(
    path.join(root, 'db', 'migrations', '035_payout_v2_ledger_foundation.sql'),
    'utf8'
  );
  expect(schema).toContain('UNIQUE (stripe_event_id)');
  expect(schema).toContain('UNIQUE (stripe_payout_id)');
  expect(schema).toContain('UNIQUE (stripe_balance_transaction_id)');
  expect(schema).toContain('payout_v2_stripe_evidence_events_append_only');
  expect(schema).toContain('connected_bank_payout_transfer_links_append_only');
  expect(schema).toContain('UNIQUE (stripe_account_id)');
});

test('bank visibility diagnostic is read-only and explicitly school-scoped', () => {
  const diagnostic = fs.readFileSync(
    path.join(root, 'db', 'diagnostics', 'payout-v2-bank-payout-visibility.sql'),
    'utf8'
  );
  expect(diagnostic).toContain(":'school_id'::integer");
  expect(diagnostic).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b(?![^\n]*--)/i);
  expect(diagnostic).toContain('payout_engine_version');
});
