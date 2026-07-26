// @ts-check

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'payout-v2-shadow-admin-test-secret';
const adminHandler = require('../api/admin');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

function headers(payload) {
  return {
    cookie: `cc_admin=${jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' })}`,
  };
}

function readOnlySql({ franchise = false } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/(?:^|\n)\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(text)) {
      throw new Error(`Mutation SQL is forbidden in a shadow statement: ${text}`);
    }
    if (/FROM schools/i.test(text)) {
      return [{ id: 1, platform_fee_pct: 5, payout_engine_version: 'v1' }];
    }
    if (/FROM instructors/i.test(text)) {
      return [{
        id: 4,
        school_id: 1,
        commission_rate: 0.85,
        weekly_franchise_fee_pence: franchise ? 19_500 : null,
        payouts_start_date: null,
      }];
    }
    if (/COUNT\(\*\)::int AS payout_count[\s\S]*FROM instructor_payouts/i.test(text)) {
      return [{ payout_count: 0 }];
    }
    return [];
  };
  sql.calls = calls;
  return sql;
}

async function callShadow({ authHeaders, query = {}, sql = readOnlySql() }) {
  const req = {
    method: 'GET',
    query: {
      action: 'payout-v2-shadow-statement',
      payout_route: 'instructor_direct',
      instructor_id: '4',
      period_start: '2026-07-20',
      period_end: '2026-07-26',
      ...query,
    },
    headers: authHeaders,
    url: '/api/admin?action=payout-v2-shadow-statement',
    sql,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return { res, sql };
}

test.describe('admin Payout v2 shadow statement', () => {
  test('returns a read-only empty statement for an explicitly scoped admin', async () => {
    const { res, sql } = await callShadow({
      authHeaders: headers({
        id: 123,
        role: 'admin',
        isAdmin: true,
        school_id: 1,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      mode: 'read_only_shadow',
      school_id: 1,
      instructor_id: 4,
      payout_route: 'instructor_direct',
      totals: {
        gross_pence: 0,
        net_shadow_transfer_pence: 0,
      },
      comparison: { classification: 'matched' },
      mutation_guarantee: {
        claims_created: false,
        locks_taken: false,
        financial_rows_written: false,
        stripe_calls: false,
      },
    });
    expect(sql.calls.length).toBeGreaterThan(0);
  });

  test('requires auth before any query', async () => {
    const { res, sql } = await callShadow({ authHeaders: {} });
    expect(res.statusCode).toBe(401);
    expect(sql.calls).toHaveLength(0);
  });

  test('keeps first-payout vehicle deposits off-system without blocking the shadow', async () => {
    const { res } = await callShadow({
      authHeaders: headers({
        id: 123,
        role: 'admin',
        isAdmin: true,
        school_id: 1,
      }),
      sql: readOnlySql({ franchise: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      totals: { deposit_deducted_pence: 0 },
      v1_preview: {
        vehicle_deposit_pence: 25_000,
        unavailable_reason: null,
      },
    });
  });

  test('requires an explicit school for a superadmin instead of defaulting to school 1', async () => {
    const { res, sql } = await callShadow({
      authHeaders: headers({
        id: 124,
        role: 'superadmin',
        isAdmin: true,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_PAYOUT_V2_SHADOW_REQUEST');
    expect(sql.calls).toHaveLength(0);
  });
});
