const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const cancellation = require('../api/_lesson-credit-cancellation-repair');
const emilie = require('../api/_emilie-duration-ledger-repair');
const runner = require('../scripts/lib/targeted-ledger-repair-runner');

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function cancellationFixture(key) {
  const target = cancellation.TARGETS[key];
  const isLloyd = key === 'lloyd';
  return {
    identity: {
      school_id: 1, school_name: target.schoolName,
      learner_id: target.learnerId, learner_name: target.learnerName,
      aggregate_minutes: 90, aggregate_credits: 0,
      instructor_id: 4, instructor_name: 'Fraser Carter', payouts_paused: false,
      lcb_id: target.lcbId, lcb_minutes: 90, grandfathered_at: null,
      updated_at: target.lcbUpdatedAt, lcb_updated_at_exact: target.lcbUpdatedAt,
    },
    booking: {
      id: target.bookingId, learner_id: target.learnerId, instructor_id: 4, school_id: 1,
      status: 'refunded', created_by: target.bookingCreatedBy, payment_method: 'free', minutes_deducted: 0,
      list_price_pence: target.bookingListPricePence, list_price_source: target.bookingListPriceSource,
      credit_returned: true, credit_forfeited: false, cancelled_at: target.bookingCancelledAt,
      cancelled_at_exact: target.bookingCancelledAt, edited_at: null, edited_at_exact: null,
      scheduled_date: target.bookingScheduledDate,
      start_time: target.bookingStartTime, end_time: target.bookingEndTime,
    },
    bcs: target.expectedBcs.map(row => ({
      id: row.id, booking_id: row.bookingId, credit_transaction_id: row.creditTransactionId,
      minutes_drawn: row.minutes, rate_pence_per_minute: row.rate,
      contribution_pence: row.contributionPence, stripe_fee_pence: row.stripeFeePence,
      absorbed_by: row.absorbedBy, refunded_at: row.refundedAt, refunded_at_exact: row.refundedAt,
    })),
    transactions: target.expectedCreditTransactions.map(row => ({
      id: row.id, learner_id: target.learnerId, instructor_id: 4, school_id: 1,
      type: row.type, minutes: row.minutes, amount_pence: row.amountPence,
      payment_method: row.paymentMethod, stripe_fee_pence: row.stripeFeePence,
      effective_rate_pence_per_minute: row.effectiveRate, source: row.source, absorbed_by: row.absorbedBy,
    })),
    audits: target.expectedBalanceAudits.map(row => ({
      id: row.id, learner_id: target.learnerId, old_balance_minutes: row.oldMinutes,
      new_balance_minutes: row.newMinutes, delta_minutes: row.deltaMinutes, created_at: row.createdAt,
    })),
    payouts: target.expectedPayouts.map(row => ({
      id: row.id, payout_id: row.payoutId, booking_id: row.bookingId,
      price_pence: row.pricePence, instructor_amount_pence: row.instructorAmountPence,
      commission_rate: row.commissionRate, stripe_fee_pence: row.stripeFeePence,
      payout_status: row.payoutStatus,
    })),
    reconciliation: {
      purchase_minutes: isLloyd ? 90 : 60,
      active_bcs_minutes: isLloyd ? 90 : 0,
      adjustment_minutes: 0, unattributed_booking_minutes: 0,
      computed_minutes: isLloyd ? 0 : 60,
    },
  };
}

class CancellationClient {
  constructor(key, { marker = false, failShadow = false } = {}) {
    this.key = key;
    this.fixture = cancellationFixture(key);
    this.marker = marker;
    this.failShadow = failShadow;
    this.applied = marker;
    this.calls = [];
  }

  async query(text) {
    this.calls.push(text);
    if (/pg_advisory_xact_lock/.test(text)) return result([{ pg_advisory_xact_lock: null }]);
    if (/cancellation-credit-repair:identity/.test(text)) return result([this.fixture.identity]);
    if (/cancellation-credit-repair:booking/.test(text)) return result([this.fixture.booking]);
    if (/cancellation-credit-repair:bcs/.test(text)) return result(this.fixture.bcs);
    if (/cancellation-credit-repair:credit-transactions/.test(text)) return result(this.fixture.transactions);
    if (/cancellation-credit-repair:balance-audit/.test(text)) return result(this.fixture.audits);
    if (/cancellation-credit-repair:payouts/.test(text)) return result(this.fixture.payouts);
    if (/cancellation-credit-repair:contradictions/.test(text)) return result([{ source_adjustments: 0, refund_lines: 0, flexible_allocations: 0 }]);
    if (/cancellation-credit-repair:reconciliation/.test(text)) return result([this.fixture.reconciliation]);
    if (/cancellation-credit-repair:marker/.test(text)) return result(this.marker || this.applied ? [{ id: 701, details: {} }] : []);
    if (/SELECT id,email FROM admin_users/.test(text)) return result([{ id: 1, email: 'admin@example.test' }]);
    if (/UPDATE booking_credit_sources SET refunded_at = NULL/.test(text)) return result([{ id: 91 }]);
    if (/UPDATE lesson_bookings SET credit_returned=FALSE/.test(text)) return result([{ id: cancellation.TARGETS[this.key].bookingId }]);
    if (/UPDATE learner_credit_balances SET balance_minutes=0/.test(text)) return result([{ id: cancellation.TARGETS[this.key].lcbId }]);
    if (/INSERT INTO audit_log/.test(text)) { this.applied = true; return result([{ id: 701 }]); }
    if (/cancellation-credit-repair:postconditions/.test(text)) return result([{
      lcb_minutes: 0, aggregate_minutes: this.failShadow ? 90 : 0, aggregate_credits: 0,
      status: 'refunded', credit_returned: false, minutes_deducted: 0,
      bcs_refunded_at: null, marker_count: 1, refund_lines: 0, target_booking_payout_lines: 0,
    }]);
    if (/WITH purchases AS/.test(text)) return result([{ computed_minutes: 0 }]);
    throw new Error(`Unexpected cancellation repair SQL: ${text}`);
  }
}

function emilieFixture({ schemaReady = true } = {}) {
  return {
    schema: { legacy_pair_constraints: schemaReady ? 0 : 1, active_pair_indexes: schemaReady ? 1 : 0 },
    identity: {
      school_id: 1, school_name: 'CoachCarter Driving School', learner_id: 144, learner_name: 'Emilie Bishop',
      aggregate_minutes: 0, aggregate_credits: 0, instructor_id: 6, instructor_name: 'Simon Edwards',
      payouts_paused: true, lcb_id: 386, lcb_minutes: 0, grandfathered_at: null,
      updated_at: emilie.TARGET.lcbUpdatedAt, lcb_updated_at_exact: emilie.TARGET.lcbUpdatedAt,
    },
    bookings: Object.entries(emilie.TARGET.bookings).map(([id, row]) => ({
      id: Number(id), learner_id: 144, instructor_id: 6, school_id: 1,
      status: row.status, payment_method: 'credit', minutes_deducted: 90,
      list_price_pence: row.beforePence, list_price_source: 'stripe_metadata',
      credit_returned: false, credit_forfeited: false, cancelled_at: null, cancelled_at_exact: null,
      edited_at: row.editedAt, edited_at_exact: row.editedAt, scheduled_date: row.scheduledDate,
      start_time: row.startTime, end_time: row.endTime,
    })),
    bcs: emilie.TARGET.originalBcs.map(row => ({
      id: row.id, booking_id: row.bookingId, credit_transaction_id: row.creditTransactionId,
      minutes_drawn: row.minutes, rate_pence_per_minute: row.rate,
      contribution_pence: row.contributionPence, stripe_fee_pence: row.stripeFeePence,
      absorbed_by: null, refunded_at: null,
    })),
    transactions: emilie.TARGET.creditTransactions.map(row => ({
      id: row.id, learner_id: 144, instructor_id: 6, school_id: 1,
      type: row.type, minutes: row.minutes, amount_pence: row.amountPence,
      payment_method: row.paymentMethod, stripe_fee_pence: row.stripeFeePence,
      effective_rate_pence_per_minute: row.effectiveRate, source: row.source, absorbed_by: null,
    })),
    evidence: emilie.TARGET.fundingEvidence.map(row => ({
      id: row.id, booking_id: row.bookingId, credit_transaction_id: row.creditTransactionId,
      booking_credit_source_id: row.bookingCreditSourceId, evidence_status: row.status,
      gross_collected_pence: row.grossPence, stripe_fee_pence: row.feePence,
      evidence_fingerprint: row.fingerprint,
    })),
  };
}

class EmilieClient {
  constructor({ schemaReady = true, marker = false, postFailure = false } = {}) {
    this.fixture = emilieFixture({ schemaReady });
    this.marker = marker;
    this.applied = marker;
    this.postFailure = postFailure;
    this.calls = [];
  }

  async query(text) {
    this.calls.push(text);
    if (/pg_advisory_xact_lock/.test(text)) return result([{}]);
    if (/emilie-duration-repair:schema/.test(text)) return result([this.fixture.schema]);
    if (/emilie-duration-repair:identity/.test(text)) return result([this.fixture.identity]);
    if (/emilie-duration-repair:bookings/.test(text)) return result(this.fixture.bookings);
    if (/emilie-duration-repair:bcs/.test(text)) return result(this.fixture.bcs);
    if (/emilie-duration-repair:credit-transactions/.test(text)) return result(this.fixture.transactions);
    if (/emilie-duration-repair:funding-evidence/.test(text)) return result(this.fixture.evidence);
    if (/emilie-duration-repair:contradictions/.test(text)) return result([{ source_adjustments: 0, refund_lines: 0, payout_lines: 0, manual_claims: 0, direct_observations: 0, flexible_allocations: 0 }]);
    if (/emilie-duration-repair:reconciliation/.test(text)) return result([{ transaction_minutes: 180, active_bcs_minutes: 180, active_bcs_pence: 16500, adjustment_minutes: 0, computed_minutes: 0 }]);
    if (/emilie-duration-repair:marker/.test(text)) return result(this.marker || this.applied ? [{ id: 801, details: {} }] : []);
    if (/SELECT id,email FROM admin_users/.test(text)) return result([{ id: 1, email: 'admin@example.test' }]);
    if (/UPDATE booking_credit_sources SET refunded_at=NOW/.test(text)) return result([{ id: 287, refunded_at: '2026-09-14T08:00:00.000Z' }]);
    if (/INSERT INTO booking_credit_sources/.test(text)) return result([{ id: 401, booking_id: 533, credit_transaction_id: 318 }, { id: 402, booking_id: 585, credit_transaction_id: 318 }]);
    if (/UPDATE lesson_bookings SET list_price_pence/.test(text)) return result([{ id: 533 }, { id: 585 }]);
    if (/INSERT INTO audit_log/.test(text)) { this.applied = true; return result([{ id: 801 }]); }
    if (/emilie-duration-repair:postconditions/.test(text)) return result([{
      lcb_minutes: 0, aggregate_minutes: 0, marker_count: 1, original_287_retired: 1,
      booking_585_active_sources: 2, source_318_minutes: 120, source_318_pence: 11000,
      source_354_minutes: 60, source_354_pence: 5500,
      booking_533_pence: this.postFailure ? 11000 : 8250, booking_585_pence: 8250,
      payout_lines: 0, refund_lines: 0,
    }]);
    throw new Error(`Unexpected Emilie repair SQL: ${text}`);
  }
}

test('Lloyd and Limkholwe previews are separately fingerprinted and ready only on exact evidence', async () => {
  const lloyd = await cancellation.buildCancellationCreditRepairPreview(new CancellationClient('lloyd'), 'lloyd');
  const limkholwe = await cancellation.buildCancellationCreditRepairPreview(new CancellationClient('limkholwe'), 'limkholwe');
  expect(lloyd.status).toBe('ready');
  expect(limkholwe.status).toBe('ready');
  expect(lloyd.plan_fingerprint).not.toBe(limkholwe.plan_fingerprint);
  expect(lloyd.proposed_changes.learner_credit_balance.after_minutes).toBe(0);
  expect(limkholwe.proposed_changes.booking_credit_source.refunded_at_after).toBeNull();
});

test('cancellation repair rejects the wrong fingerprint before any write', async () => {
  const client = new CancellationClient('lloyd');
  await expect(cancellation.applyCancellationCreditRepair(client, 'lloyd', {
    reviewedFingerprint: 'sha256:wrong', adminId: 1, operatorIdentity: 'Fraser', evidenceReference: 'review/test',
  })).rejects.toMatchObject({ code: 'CANCELLATION_CREDIT_REPAIR_FINGERPRINT_MISMATCH' });
  expect(client.calls.some(sql => /UPDATE lesson_bookings|INSERT INTO audit_log/.test(sql))).toBe(false);
});

test('Limkholwe apply restores the free-trial source and relies on the LCB sync trigger for the shadow', async () => {
  const client = new CancellationClient('limkholwe');
  const output = await cancellation.applyCancellationCreditRepair(client, 'limkholwe', {
    reviewedFingerprint: cancellation.planFingerprint(cancellation.TARGETS.limkholwe),
    adminId: 1, operatorIdentity: 'Fraser', evidenceReference: 'review/test',
  });
  expect(output.mutation_performed).toBe(true);
  expect(client.calls.some(sql => /UPDATE booking_credit_sources SET refunded_at = NULL/.test(sql))).toBe(true);
  expect(client.calls.some(sql => /UPDATE learner_credit_balances SET balance_minutes=0/.test(sql))).toBe(true);
  expect(client.calls.some(sql => /UPDATE learner_users SET balance_minutes=0/.test(sql))).toBe(false);
  expect(client.calls.some(sql => /refund_events|stripe\.refunds|payouts_paused\s*=/.test(sql))).toBe(false);
});

test('a failed shadow-sync postcondition fails the enclosing transaction closed', async () => {
  const client = new CancellationClient('lloyd', { failShadow: true });
  await expect(cancellation.applyCancellationCreditRepair(client, 'lloyd', {
    reviewedFingerprint: cancellation.planFingerprint(cancellation.TARGETS.lloyd),
    adminId: 1, operatorIdentity: 'Fraser', evidenceReference: 'review/test',
  })).rejects.toMatchObject({ code: 'CANCELLATION_CREDIT_REPAIR_POSTCONDITION_FAILED' });
});

test('Emilie preview blocks until migration 064 is present', async () => {
  const preview = await emilie.buildEmilieRepairPreview(new EmilieClient({ schemaReady: false }));
  expect(preview.status).toBe('blocked');
  expect(preview.preconditions.find(row => row.name.includes('migration 064')).ok).toBe(false);
});

test('Emilie apply retires history, appends two attributions and conserves minutes and pence', async () => {
  const client = new EmilieClient();
  const output = await emilie.applyEmilieRepair(client, {
    reviewedFingerprint: emilie.planFingerprint(), adminId: 1,
    operatorIdentity: 'Fraser', evidenceReference: 'review/test',
  });
  expect(output.mutation_performed).toBe(true);
  expect(client.calls.some(sql => /UPDATE booking_credit_sources SET refunded_at=NOW/.test(sql))).toBe(true);
  expect(client.calls.some(sql => /VALUES \(\$1,533,318,90,92,8250,0,NULL\),\(\$1,585,318,30,92,2750,0,NULL\)/.test(sql))).toBe(true);
  expect(output.after.source_318_minutes).toBe(120);
  expect(output.after.source_318_pence).toBe(11000);
  expect(output.after.booking_585_active_sources).toBe(2);
});

test('Emilie postcondition mismatch fails closed', async () => {
  const client = new EmilieClient({ postFailure: true });
  await expect(emilie.applyEmilieRepair(client, {
    reviewedFingerprint: emilie.planFingerprint(), adminId: 1,
    operatorIdentity: 'Fraser', evidenceReference: 'review/test',
  })).rejects.toMatchObject({ code: 'EMILIE_REPAIR_POSTCONDITION_FAILED' });
});

test('repair runner rejects pooled URLs and pins the exact production database', () => {
  expect(() => runner.validateDirectUrl('postgresql://u:p@example-pooler.test/neondb')).toThrow(/direct non-pooler/);
  expect(() => runner.validateDirectUrl('postgresql://u:p@example.test/other')).toThrow(/Database must be neondb/);
  expect(() => runner.validateDirectUrl('postgresql://u:p@example.test/neondb')).not.toThrow();
  expect(runner.PRODUCTION_BRANCH_ID).toBe('br-summer-silence-abcpp6vw');
});

test('migration 064 and live writers use active-row uniqueness safely', () => {
  const root = path.resolve(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/064_booking_credit_source_replacement_history.sql'), 'utf8');
  expect(migration).toContain("pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (booking_id, credit_transaction_id)'");
  expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_bcs_active_booking_source');
  expect(migration).toContain('WHERE refunded_at IS NULL');
  for (const file of ['api/_bcs-refund-marker.js', 'api/_lesson-requests.js', 'api/admin.js', 'api/instructor.js', 'api/slots.js', 'api/webhook.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    expect(source).not.toContain('ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING');
  }
});

test('recurrence guards cover all zero-credit free cancellations and ordinary credit duration edits', () => {
  const root = path.resolve(__dirname, '..');
  const instructor = fs.readFileSync(path.join(root, 'api/instructor.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'api/admin.js'), 'utf8');
  expect(instructor).toContain('function isZeroCreditFreeBooking(booking)');
  expect(instructor).toContain('credit_returned = ${!isZeroCreditFree}');
  expect(instructor).toContain("code: 'LESSON_CREDIT_DURATION_EDIT_REQUIRES_REBOOKING'");
  expect(admin).toContain("code: 'LESSON_CREDIT_DURATION_EDIT_REQUIRES_REBOOKING'");
});
