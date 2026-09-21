const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  cancelFlexiblePackageBookingWithClient,
} = require('../api/_flexible-package-ledger');
const {
  TARGET,
  applyVibaRepair,
  buildVibaRepairPreview,
} = require('../api/_viba-flexible-ledger-repair');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function result(rows) {
  return { rows, rowCount: rows.length };
}

function makeFlexibleCancellationClient({
  learnerId = 143,
  instructorId = 6,
  schoolId = 1,
  bookingId = 900,
  status = 'scheduled',
  minutes = 90,
  units = 3,
  mixedFunding = false,
} = {}) {
  const state = {
    booking: { id: bookingId, status, instructor_id: instructorId, minutes_deducted: minutes, cancelled_at: null, credit_forfeited: false },
    allocations: [{ id: 700, units_allocated: units, unit_minutes: 30 }],
    returned: new Set(),
    calls: [],
    lcbMutationCalls: 0,
  };
  return {
    state,
    async query(text, params = []) {
      const sql = String(text);
      state.calls.push({ sql, params });
      if (/SELECT id, status, instructor_id, minutes_deducted/.test(sql)) {
        const scoped = Number(params[0]) === bookingId && Number(params[1]) === learnerId
          && Number(params[2]) === schoolId && (params[3] == null || Number(params[3]) === instructorId);
        return result(scoped ? [{ ...state.booking }] : []);
      }
      if (/SELECT a\.id, a\.units_allocated, a\.unit_minutes/.test(sql)) {
        const scoped = Number(params[0]) === bookingId && Number(params[1]) === schoolId && Number(params[2]) === learnerId;
        return result(scoped ? state.allocations.map(row => ({ ...row, returned: state.returned.has(row.id) })) : []);
      }
      if (/FROM booking_credit_sources/.test(sql)) return result(mixedFunding ? [{ '?column?': 1 }] : []);
      if (/UPDATE lesson_bookings/.test(sql)) {
        state.booking.status = 'refunded';
        state.booking.cancelled_at = new Date().toISOString();
        state.booking.credit_forfeited = false;
        return result([{ id: bookingId }]);
      }
      if (/INSERT INTO flexible_package_allocation_returns/.test(sql)) {
        state.returned.add(Number(params[1]));
        return result([{ id: state.returned.size }]);
      }
      if (/INSERT INTO flexible_package_state_events/.test(sql)) return result([{ id: 1 }]);
      if (/FROM flexible_package_source_remaining/.test(sql)) {
        const returnedUnits = state.allocations.filter(row => state.returned.has(row.id))
          .reduce((sum, row) => sum + row.units_allocated, 0);
        return result([{ remaining_units: returnedUnits }]);
      }
      if (/learner_credit_balances|UPDATE learner_users/.test(sql)) state.lcbMutationCalls += 1;
      throw new Error(`Unexpected SQL in flexible cancellation test: ${sql}`);
    },
  };
}

function previewEvidenceClient(overrides = {}) {
  const identity = {
    learner_id: 143, learner_name: 'Viba Balaji', instructor_id: 6, instructor_name: 'Simon Edwards',
    lcb_minutes: 210, source_id: 3, initial_units: 30, unit_minutes: 30,
    rate_pence_per_unit: 2700, original_value_pence: 81000,
    purchase_amount_pence: 81000, purchase_total_units: 30,
    purchase_unit_minutes: 30, purchase_rate_pence_per_unit: 2700,
    ...(overrides.identity || {}),
  };
  const allocations = TARGET.allocations.map(row => ({
    id: row.id, booking_id: row.bookingId, learner_id: 143, instructor_id: 6,
    source_id: 3, units_allocated: row.units, unit_minutes: 30,
    rate_pence_per_unit: 2700, contribution_pence: row.units * 2700,
    status: row.status, minutes_deducted: row.durationMinutes, return_id: null,
  }));
  const transactions = [334, 371].map(id => ({
    id, learner_id: 143, instructor_id: 6, school_id: 1,
    type: 'edit_adjustment', minutes: 30, adjusted_minutes: 0,
  }));
  const totals = {
    remaining_units: 3, active_units: 27, active_chargeable_units: 19,
    active_refunded_units: 5, future_booking_units: 3,
    mixed_funding_rows: 0, duration_mismatch_rows: 2,
    ...(overrides.totals || {}),
  };
  return {
    async query(text) {
      const sql = String(text);
      if (sql.includes('viba-repair:identity')) return result(identity ? [identity] : []);
      if (sql.includes('viba-repair:allocations')) return result(overrides.allocations || allocations);
      if (sql.includes('viba-repair:transactions')) return result(overrides.transactions || transactions);
      if (sql.includes('viba-repair:totals')) return result(totals ? [totals] : []);
      if (sql.includes('viba-repair:schema')) return result([{ replacement_allocation_supported: overrides.schemaReady !== false }]);
      if (sql.includes('viba-repair:marker')) return result(overrides.marker ? [overrides.marker] : []);
      throw new Error(`Unexpected preview SQL: ${sql}`);
    },
  };
}

function applyClient({ invalidPostcondition = false } = {}) {
  const previewClient = previewEvidenceClient();
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      const sql = String(text);
      calls.push(sql);
      if (sql.includes('viba-repair:')) {
        if (sql.includes('viba-repair:postconditions')) {
          return result([{
            lcb_minutes: invalidPostcondition ? 30 : 0,
            remaining_units: 10, remaining_pence: 27000,
            delivered_units: 17, refunded_active_units: 0,
            booking_536_units: 2, booking_537_units: 0,
            booking_568_units: 2, booking_569_units: 0, booking_611_units: 3,
            corrected_edit_minutes: 60, mixed_funding_rows: 0, duration_mismatch_rows: 0,
          }]);
        }
        return previewClient.query(text, params);
      }
      if (/pg_advisory_xact_lock/.test(sql)) return result([{ locked: true }]);
      if (/SELECT id, email FROM admin_users/.test(sql)) return result([{ id: 1, email: 'admin@coachcarter.test' }]);
      if (/INSERT INTO flexible_package_allocation_returns/.test(sql)) {
        return result([7, 8, 9, 10].map(allocation_id => ({ allocation_id })));
      }
      if (/INSERT INTO flexible_package_booking_allocations/.test(sql)) {
        return result([{ id: 107, booking_id: 536 }, { id: 109, booking_id: 568 }]);
      }
      if (/UPDATE learner_credit_balances/.test(sql)) return result([{ balance_minutes: 0 }]);
      if (/INSERT INTO credit_source_adjustments/.test(sql)) {
        return result([{ id: 201, credit_transaction_id: 334 }, { id: 202, credit_transaction_id: 371 }]);
      }
      if (/INSERT INTO flexible_package_state_events/.test(sql)) return result([{ id: 301 }]);
      if (/INSERT INTO audit_log/.test(sql)) return result([{ id: 401 }]);
      throw new Error(`Unexpected apply SQL: ${sql}`);
    },
  };
}

test.describe('Viba Flexible Hours prevention and repair', () => {
  test('operator cancellation returns Flexible Hours once and never mutates ordinary LCB', async () => {
    const client = makeFlexibleCancellationClient();
    const first = await cancelFlexiblePackageBookingWithClient(client, {
      learnerId: 143, instructorId: 6, schoolId: 1, bookingId: 900,
      eligibleReturn: true, returnReason: 'admin_eligible_cancellation',
      eventType: 'operator_eligible_cancellation_returned',
    });
    const second = await cancelFlexiblePackageBookingWithClient(client, {
      learnerId: 143, instructorId: 6, schoolId: 1, bookingId: 900,
      eligibleReturn: true, returnReason: 'admin_eligible_cancellation',
      eventType: 'operator_eligible_cancellation_returned',
    });

    expect(first).toMatchObject({ ok: true, idempotent: false, units: 3, minutesReturned: 90 });
    expect(second).toMatchObject({ ok: true, idempotent: true, units: 3, minutesReturned: 90 });
    expect(client.state.returned.size).toBe(1);
    expect(client.state.booking.status).toBe('refunded');
    expect(client.state.lcbMutationCalls).toBe(0);
  });

  test('fails closed when active allocation minutes do not equal the booking duration', async () => {
    const client = makeFlexibleCancellationClient({ minutes: 60, units: 3 });
    await expect(cancelFlexiblePackageBookingWithClient(client, {
      learnerId: 143, instructorId: 6, schoolId: 1, bookingId: 900,
      eligibleReturn: true, returnReason: 'admin_eligible_cancellation',
    })).rejects.toMatchObject({ result: { code: 'FLEXIBLE_ALLOCATION_DURATION_CONTRADICTION' } });
    expect(client.state.booking.status).toBe('scheduled');
    expect(client.state.returned.size).toBe(0);
    expect(client.state.lcbMutationCalls).toBe(0);
  });

  test('enforces school, learner and instructor scope before any return', async () => {
    for (const scopedArgs of [
      { learnerId: 999, instructorId: 6, schoolId: 1 },
      { learnerId: 143, instructorId: 999, schoolId: 1 },
      { learnerId: 143, instructorId: 6, schoolId: 2 },
    ]) {
      const client = makeFlexibleCancellationClient();
      await expect(cancelFlexiblePackageBookingWithClient(client, {
        ...scopedArgs, bookingId: 900, eligibleReturn: true,
        returnReason: 'admin_eligible_cancellation',
      })).rejects.toMatchObject({ result: { code: 'BOOKING_NOT_FOUND' } });
      expect(client.state.returned.size).toBe(0);
    }
  });

  test('admin and instructor duration edits reject both increases and decreases before LCB mutation', () => {
    const admin = read('api/admin.js');
    const instructor = read('api/instructor.js');
    const offers = read('api/offers.js');
    const webhook = read('api/webhook.js');
    const adminHandler = admin.slice(admin.indexOf('async function handleEditBooking'), admin.indexOf('async function loadAdminRescheduleBooking'));
    const instructorHandler = instructor.slice(instructor.indexOf('async function handleEditBooking'), instructor.indexOf('async function createInstructorCreditBookingTransaction'));

    for (const handler of [adminHandler, instructorHandler]) {
      expect(handler).toContain("code: 'FLEXIBLE_DURATION_EDIT_REQUIRES_REBOOKING'");
      expect(handler.indexOf('FLEXIBLE_DURATION_EDIT_REQUIRES_REBOOKING'))
        .toBeLessThan(handler.indexOf('lockBalanceAndMutate'));
    }
    expect(adminHandler).toContain('requestedDurationDelta !== 0');
    expect(instructorHandler).toContain('requestedDurationDelta !== 0');
    // Package-funded extensions now append exact units through the dedicated
    // acceptance transaction (covered by flexible-booking-extension.spec.js).
    // Ordinary edits and free/cash extensions must still reject duration changes.
    expect(offers).toContain("code: 'FLEXIBLE_DURATION_EDIT_REQUIRES_REBOOKING'");
    expect(webhook).toContain("requireRefund('flexible_package_duration_change_requires_rebooking')");
  });

  test('operator routes use the dedicated transaction while ordinary Lesson Credit behaviour remains present', () => {
    const instructor = read('api/instructor.js');
    const slots = read('api/slots.js');
    const cancel = instructor.slice(instructor.indexOf('async function handleCancelBooking'), instructor.indexOf('async function handleMarkNotDelivered'));
    const notDelivered = instructor.slice(instructor.indexOf('async function handleMarkNotDelivered'), instructor.indexOf('async function handleRescheduleBooking'));
    const learnerCancel = slots.slice(slots.indexOf('async function handleCancel'), slots.indexOf('async function handleReservedPolicyMove'));
    expect(cancel).toContain('cancelFlexiblePackageBookingTransaction({');
    expect(cancel).toContain('await lockBalanceAdjustLCB(sql, {');
    expect(notDelivered).toContain('cancelFlexiblePackageBookingWithClient(client, {');
    expect(notDelivered).toContain('await lockBalanceAdjustLCB(txSql, {');
    expect(learnerCancel).toContain("flexibleUnits > 0 || booking.payment_method === 'flexible_package'");
    expect(learnerCancel).toContain("seriesBookings.some(row => row.payment_method === 'flexible_package'");
    expect(learnerCancel).toContain("code: 'FLEXIBLE_PACKAGE_SINGLE_BOOKING_ONLY'");
  });

  test('every standard and reserved reschedule path preserves Flexible Hours allocations', () => {
    const admin = read('api/admin.js');
    const slots = read('api/slots.js');
    const instructor = read('api/instructor.js');
    const adminStandard = admin.slice(admin.indexOf('async function handleAdminRescheduleBooking'), admin.indexOf('// -- POST /api/admin?action=reserved-goodwill-move'));
    const adminReserved = admin.slice(admin.indexOf('async function handleReservedGoodwillMove'));
    const learnerReserved = slots.slice(slots.indexOf('async function handleReservedPolicyMove'), slots.indexOf('async function handleReschedule'));
    const learnerStandard = slots.slice(slots.indexOf('async function handleReschedule'));
    const instructorStandard = instructor.slice(instructor.indexOf('async function handleRescheduleBooking'), instructor.indexOf('async function loadInstructorRescheduleBooking'));

    for (const handler of [adminStandard, adminReserved, learnerReserved, learnerStandard, instructorStandard]) {
      expect(handler).toContain('moveFlexiblePackageBookingAllocations');
    }
    for (const reservedHandler of [adminReserved, learnerReserved]) {
      expect(reservedHandler).toContain("booking.payment_method === 'flexible_package'");
      expect(reservedHandler).toContain('FLEXIBLE_RESCHEDULE_VALUE_CONTRADICTION');
    }
  });

  test('builds the exact read-only, approval-ready Viba repair preview', async () => {
    const preview = await buildVibaRepairPreview(previewEvidenceClient());
    expect(preview).toMatchObject({
      mode: 'dry-run', mutation_performed: false, status: 'ready', ready: true,
      before: {
        ordinary_lcb_minutes: 210,
        flexible_remaining_units: 3,
        flexible_remaining_minutes: 90,
        total_unused_entitlement_minutes: 300,
      },
      expected_after: {
        ordinary_lcb_minutes: 0,
        flexible_remaining_units: 10,
        flexible_remaining_minutes: 300,
        flexible_remaining_gross_pence: 27000,
        delivered_units: 17,
        future_units: 3,
      },
    });
    expect(preview.preconditions.every(row => row.ok)).toBe(true);
    expect(preview.proposed_changes.allocation_returns).toHaveLength(4);
    expect(preview.proposed_changes.replacement_allocations).toHaveLength(2);
    expect(preview.proposed_changes.source_adjustments).toEqual([
      expect.objectContaining({ credit_transaction_id: 334, kind: 'admin_correction', minutes_adjusted: 30 }),
      expect.objectContaining({ credit_transaction_id: 371, kind: 'admin_correction', minutes_adjusted: 30 }),
    ]);
    expect(preview.plan_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('dry-run blocks on any observed balance or allocation drift', async () => {
    const preview = await buildVibaRepairPreview(previewEvidenceClient({ totals: { remaining_units: 4 } }));
    expect(preview).toMatchObject({ mode: 'dry-run', mutation_performed: false, status: 'blocked', ready: false });
    expect(preview.preconditions.filter(row => !row.ok).map(row => row.name)).toContain('current source totals');
  });

  test('apply uses the reviewed fingerprint and verifies every required postcondition', async () => {
    const preview = await buildVibaRepairPreview(previewEvidenceClient());
    const client = applyClient();
    const applied = await applyVibaRepair(client, {
      reviewedFingerprint: preview.plan_fingerprint,
      adminId: 1,
      operatorIdentity: 'admin@coachcarter.test',
      evidenceReference: 'docs/fraser-simon-stripe-balance-reconciliation-2026-09-13.md',
    });
    expect(applied).toMatchObject({
      mode: 'apply', mutation_performed: true, idempotent: false,
      state_event_id: 301, audit_id: 401,
      after: { lcb_minutes: 0, remaining_units: 10, remaining_pence: 27000, delivered_units: 17 },
    });
    expect(applied.postconditions.every(row => row.ok)).toBe(true);
    expect(client.calls.findIndex(sql => /INSERT INTO audit_log/.test(sql)))
      .toBeLessThan(client.calls.findIndex(sql => sql.includes('viba-repair:postconditions')));
  });

  test('apply fails before commit when a required postcondition is wrong', async () => {
    const preview = await buildVibaRepairPreview(previewEvidenceClient());
    await expect(applyVibaRepair(applyClient({ invalidPostcondition: true }), {
      reviewedFingerprint: preview.plan_fingerprint,
      adminId: 1,
      operatorIdentity: 'admin@coachcarter.test',
      evidenceReference: 'test',
    })).rejects.toMatchObject({ code: 'VIBA_REPAIR_POSTCONDITION_FAILED' });
  });

  test('repair runner defaults to dry-run and has independent apply gates', () => {
    const script = read('scripts/viba-flexible-ledger-repair.js');
    expect(script).toContain("const mode = String(args.mode || 'dry-run')");
    expect(script).toContain("VIBA_FLEXIBLE_LEDGER_REPAIR_ENABLED");
    expect(script).toContain("APPLY_VIBA_FLEXIBLE_LEDGER_REPAIR");
    expect(script).toContain("requiredText(args, 'reviewed-fingerprint')");
    expect(script).toContain("await client.query('ROLLBACK')");
  });
});
