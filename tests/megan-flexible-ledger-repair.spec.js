const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  TARGET,
  applyMeganRepair,
  buildMeganRepairPreview,
} = require('../api/_megan-flexible-ledger-repair');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function result(rows) {
  return { rows, rowCount: rows.length };
}

function evidenceClient(overrides = {}) {
  const identity = {
    learner_id: 151,
    learner_name: 'Megan Cridland',
    instructor_id: 6,
    instructor_name: 'Simon Edwards',
    lcb_minutes: 120,
    source_id: 1,
    initial_units: 30,
    unit_minutes: 30,
    rate_pence_per_unit: 2700,
    original_value_pence: 81000,
    purchase_amount_pence: 81000,
    purchase_total_units: 30,
    purchase_unit_minutes: 30,
    purchase_rate_pence_per_unit: 2700,
    ...(overrides.identity || {}),
  };
  const allocations = [
    { id: 1, booking_id: 500, return_id: null, return_units: null, credit_returned: true },
    { id: 2, booking_id: 501, return_id: null, return_units: null, credit_returned: true },
  ].map(row => ({
    learner_id: 151,
    instructor_id: 6,
    source_id: 1,
    units_allocated: 2,
    unit_minutes: 30,
    rate_pence_per_unit: 2700,
    contribution_pence: 5400,
    status: 'refunded',
    minutes_deducted: 60,
    payment_method: 'flexible_package',
    ...row,
  }));
  const bookings = [500, 501, 510].map(id => ({
    id,
    learner_id: 151,
    instructor_id: 6,
    status: 'refunded',
    minutes_deducted: 60,
    payment_method: 'flexible_package',
    credit_returned: true,
  }));
  const totals = {
    remaining_units: 26,
    remaining_pence: 70200,
    active_units: 4,
    active_chargeable_units: 0,
    active_refunded_units: 4,
    target_active_units: 4,
    reduced_units: 0,
    mixed_funding_rows: 0,
    duration_mismatch_rows: 0,
    ...(overrides.totals || {}),
  };
  return {
    async query(text) {
      const sql = String(text);
      if (sql.includes('megan-repair:identity')) return result(identity ? [identity] : []);
      if (sql.includes('megan-repair:bookings')) return result(overrides.bookings || bookings);
      if (sql.includes('megan-repair:allocations')) return result(overrides.allocations || allocations);
      if (sql.includes('megan-repair:totals')) return result(totals ? [totals] : []);
      if (sql.includes('megan-repair:marker')) return result(overrides.marker ? [overrides.marker] : []);
      throw new Error(`Unexpected preview SQL: ${sql}`);
    },
  };
}

function applyClient({ invalidPostcondition = false } = {}) {
  const previewClient = evidenceClient();
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      const sql = String(text);
      calls.push(sql);
      if (sql.includes('megan-repair:postconditions')) {
        return result([{
          lcb_minutes: invalidPostcondition ? 30 : 0,
          remaining_units: 30,
          remaining_pence: 81000,
          active_units: 0,
          refunded_active_units: 0,
          target_active_units: 0,
          target_returned_allocations: 2,
          target_total_allocations: 2,
          unallocated_booking_allocations: 0,
          reduced_units: 0,
          mixed_funding_rows: 0,
          duration_mismatch_rows: 0,
        }]);
      }
      if (sql.includes('megan-repair:')) return previewClient.query(text, params);
      if (/pg_advisory_xact_lock/.test(sql)) return result([{ locked: true }]);
      if (/SELECT id, email FROM admin_users/.test(sql)) return result([{ id: 1, email: 'admin@coachcarter.test' }]);
      if (/INSERT INTO flexible_package_allocation_returns/.test(sql)) {
        return result([{ allocation_id: 1, booking_id: 500 }, { allocation_id: 2, booking_id: 501 }]);
      }
      if (/UPDATE learner_credit_balances/.test(sql)) return result([{ balance_minutes: 0 }]);
      if (/INSERT INTO flexible_package_state_events/.test(sql)) return result([{ id: 301 }]);
      if (/INSERT INTO audit_log/.test(sql)) return result([{ id: 401 }]);
      throw new Error(`Unexpected apply SQL: ${sql}`);
    },
  };
}

test.describe('Megan Flexible Hours historical repair', () => {
  test('builds an exact dry-run plan from the two still-active refunded allocations', async () => {
    const preview = await buildMeganRepairPreview(evidenceClient());
    expect(preview).toMatchObject({
      mode: 'dry-run',
      mutation_performed: false,
      status: 'ready',
      ready: true,
      target: {
        schoolId: 1,
        learnerId: 151,
        learnerName: 'Megan Cridland',
        sourceId: 1,
        refundedBookingIds: [500, 501, 510],
        allocatedBookingIds: [500, 501],
        unallocatedBookingIds: [510],
      },
      before: {
        ordinary_lcb_minutes: 120,
        flexible_remaining_units: 26,
        flexible_remaining_minutes: 780,
        total_unused_entitlement_minutes: 900,
      },
      expected_after: {
        ordinary_lcb_minutes: 0,
        flexible_remaining_units: 30,
        flexible_remaining_minutes: 900,
        flexible_remaining_gross_pence: 81000,
        active_units: 0,
        unused_entitlement_minutes: 900,
      },
    });
    expect(preview.preconditions.every(row => row.ok)).toBe(true);
    expect(preview.proposed_changes.allocation_returns).toEqual([
      { allocation_id: 1, booking_id: 500, units_returned: 2, reason: 'admin_eligible_cancellation' },
      { allocation_id: 2, booking_id: 501, units_returned: 2, reason: 'admin_eligible_cancellation' },
    ]);
    expect(preview.proposed_changes.previously_returned_allocations).toEqual([]);
    expect(preview.plan_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('binds the reviewed fingerprint to the live allocation IDs', async () => {
    const original = await buildMeganRepairPreview(evidenceClient());
    const changed = await buildMeganRepairPreview(evidenceClient({
      allocations: [
        { id: 9, booking_id: 500, learner_id: 151, instructor_id: 6, source_id: 1, units_allocated: 2, unit_minutes: 30, rate_pence_per_unit: 2700, contribution_pence: 5400, status: 'refunded', minutes_deducted: 60, payment_method: 'flexible_package', credit_returned: true, return_id: null, return_units: null },
        { id: 2, booking_id: 501, learner_id: 151, instructor_id: 6, source_id: 1, units_allocated: 2, unit_minutes: 30, rate_pence_per_unit: 2700, contribution_pence: 5400, status: 'refunded', minutes_deducted: 60, payment_method: 'flexible_package', credit_returned: true, return_id: null, return_units: null },
      ],
    }));
    expect(changed.ready).toBe(true);
    expect(changed.plan_fingerprint).not.toBe(original.plan_fingerprint);
  });

  test('blocks if balance, package totals, booking shape or return evidence drifts', async () => {
    const cases = [
      evidenceClient({ identity: { lcb_minutes: 60 } }),
      evidenceClient({ totals: { remaining_units: 27 } }),
      evidenceClient({ allocations: [] }),
    ];
    for (const client of cases) {
      const preview = await buildMeganRepairPreview(client);
      expect(preview).toMatchObject({ status: 'blocked', ready: false, mutation_performed: false });
      expect(preview.preconditions.some(row => !row.ok)).toBe(true);
    }
  });

  test('applies only the fingerprinted returns, removes exactly 120 LCB minutes and verifies postconditions', async () => {
    const preview = await buildMeganRepairPreview(evidenceClient());
    const client = applyClient();
    const applied = await applyMeganRepair(client, {
      reviewedFingerprint: preview.plan_fingerprint,
      adminId: 1,
      operatorIdentity: 'admin@coachcarter.test',
      evidenceReference: 'docs/fraser-simon-stripe-balance-reconciliation-2026-09-13.md',
    });
    expect(applied).toMatchObject({
      mode: 'apply',
      mutation_performed: true,
      idempotent: false,
      state_event_id: 301,
      audit_id: 401,
      after: { lcb_minutes: 0, remaining_units: 30, remaining_pence: 81000, active_units: 0 },
    });
    expect(applied.postconditions.every(row => row.ok)).toBe(true);
    expect(client.calls.findIndex(sql => /INSERT INTO audit_log/.test(sql)))
      .toBeLessThan(client.calls.findIndex(sql => sql.includes('megan-repair:postconditions')));
  });

  test('rejects a stale fingerprint before any ledger write', async () => {
    const client = applyClient();
    await expect(applyMeganRepair(client, {
      reviewedFingerprint: 'sha256:stale',
      adminId: 1,
      operatorIdentity: 'admin@coachcarter.test',
      evidenceReference: 'test',
    })).rejects.toMatchObject({ code: 'MEGAN_REPAIR_FINGERPRINT_MISMATCH' });
    expect(client.calls.some(sql => /INSERT INTO flexible_package_allocation_returns/.test(sql))).toBe(false);
  });

  test('fails inside the transaction if any required postcondition is wrong', async () => {
    const preview = await buildMeganRepairPreview(evidenceClient());
    await expect(applyMeganRepair(applyClient({ invalidPostcondition: true }), {
      reviewedFingerprint: preview.plan_fingerprint,
      adminId: 1,
      operatorIdentity: 'admin@coachcarter.test',
      evidenceReference: 'test',
    })).rejects.toMatchObject({ code: 'MEGAN_REPAIR_POSTCONDITION_FAILED' });
  });

  test('runner defaults to read-only and requires independent direct-connection apply gates', () => {
    const script = read('scripts/megan-flexible-ledger-repair.js');
    expect(script).toContain("const mode = String(args.mode || 'dry-run')");
    expect(script).toContain('POSTGRES_URL_UNPOOLED');
    expect(script).toContain('MEGAN_FLEXIBLE_LEDGER_REPAIR_ENABLED');
    expect(script).toContain('MEGAN_FLEXIBLE_LEDGER_REPAIR_REVIEWED');
    expect(script).toContain('APPLY_MEGAN_FLEXIBLE_LEDGER_REPAIR');
    expect(script).toContain("requiredText(args, 'reviewed-fingerprint')");
    expect(script).toContain("await client.query('ROLLBACK')");
  });

  test('target constants remain exact and cannot be supplied by the caller', () => {
    expect(TARGET).toEqual(expect.objectContaining({
      schoolId: 1,
      learnerId: 151,
      instructorId: 6,
      sourceId: 1,
      ordinaryBalanceMinutes: 120,
      refundedBookingIds: [500, 501, 510],
      allocatedBookingIds: [500, 501],
      unallocatedBookingIds: [510],
    }));
    const script = read('scripts/megan-flexible-ledger-repair.js');
    expect(script).not.toContain("requiredText(args, 'learner-id')");
    expect(script).not.toContain("requiredText(args, 'source-id')");
  });
});
