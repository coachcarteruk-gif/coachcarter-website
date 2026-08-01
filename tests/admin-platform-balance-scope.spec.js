// @ts-check
// Regression coverage for admin platform-balance school scoping.
//
// These tests exercise the real admin request/auth path with the expensive
// read-model dependencies mocked at the boundary. They do not run Stripe, Neon,
// payout, refund, booking, cancellation, or credit mutation code.

const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');
const Module = require('module');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-platform-balance-scope-test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_platform_balance_scope';
process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://platform-balance-scope.test/db';

const originalLoad = Module._load;
const computeCalls = [];
const sqlSentinel = async () => [];
const stripeSentinel = {
  balance: {
    retrieve: async () => ({
      available: [{ currency: 'gbp', amount: 0 }],
      pending: [],
    }),
  },
};

function patchedLoad(request, parent, isMain) {
  const parentFile = parent?.filename || '';

  if (request === '@neondatabase/serverless') {
    return { neon: () => sqlSentinel };
  }

  if (request === 'stripe') {
    return function StripeFixture() { return stripeSentinel; };
  }

  if (request === './_platform-balance' && parentFile.endsWith(`${path.sep}api${path.sep}admin.js`)) {
    return {
      computePlatformBalance: async (sql, stripe, options = {}) => {
        computeCalls.push({ sql, stripe, options });
        return {
          school_id: options.schoolId,
          available_pence: 0,
          pending_pence: 0,
          payout_preview: [],
          total_payout_pence: 0,
          balance_after_payout_pence: 0,
          excluded_instructors: [],
          exact_refund_exposure_pence: 0,
          exact_refund_exposure: { school_id: options.schoolId },
          exact_refund_exposure_basis: {},
          legacy_advisory_refund_exposure_pence: 0,
          legacy_advisory_refund_exposure_basis: {},
          refund_exposure_pence: 0,
          refund_exposure_basis: {},
          status: 'green',
        };
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
}

let adminHandler;
test.beforeAll(() => {
  const adminPath = require.resolve('../api/admin');
  delete require.cache[adminPath];
  Module._load = patchedLoad;
  try {
    adminHandler = require(adminPath);
  } finally {
    Module._load = originalLoad;
  }
});

test.afterAll(() => {
  Module._load = originalLoad;
  delete require.cache[require.resolve('../api/admin')];
});

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

function adminCookie(payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `cc_admin=${encodeURIComponent(token)}`;
}

async function callPlatformBalance({ payload, query = {} }) {
  const req = {
    method: 'GET',
    query: { action: 'platform-balance', ...query },
    body: {},
    headers: {
      cookie: adminCookie(payload),
    },
    url: `/api/admin?action=platform-balance${query.school_id ? `&school_id=${query.school_id}` : ''}`,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

test.describe('admin platform-balance school scoping', () => {
  test.beforeEach(() => {
    computeCalls.length = 0;
  });

  test('normal admin with school_id 2 cannot override scope via ?school_id=1', async () => {
    const res = await callPlatformBalance({
      payload: {
        id: 202,
        email: 'school-2-admin@example.test',
        role: 'admin',
        isAdmin: true,
        school_id: 2,
      },
      query: { school_id: '1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, school_id: 2 });
    expect(computeCalls).toHaveLength(1);
    expect(computeCalls[0].options).toEqual({ schoolId: 2 });
  });

  test('normal admin with omitted query uses their JWT school scope', async () => {
    const res = await callPlatformBalance({
      payload: {
        id: 203,
        email: 'school-2-admin@example.test',
        role: 'admin',
        isAdmin: true,
        school_id: 2,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, school_id: 2 });
    expect(computeCalls).toHaveLength(1);
    expect(computeCalls[0].options).toEqual({ schoolId: 2 });
  });

  test('superadmin can intentionally target ?school_id=1', async () => {
    const res = await callPlatformBalance({
      payload: {
        id: 301,
        email: 'superadmin@example.test',
        role: 'superadmin',
        isAdmin: true,
      },
      query: { school_id: '1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, school_id: 1 });
    expect(computeCalls).toHaveLength(1);
    expect(computeCalls[0].options).toEqual({ schoolId: 1 });
  });

  test('superadmin with omitted query keeps current default school behavior', async () => {
    const res = await callPlatformBalance({
      payload: {
        id: 302,
        email: 'superadmin@example.test',
        role: 'superadmin',
        isAdmin: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, school_id: 1 });
    expect(computeCalls).toHaveLength(1);
    expect(computeCalls[0].options).toEqual({ schoolId: 1 });
  });
});
