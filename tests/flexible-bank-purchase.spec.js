'use strict';

const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createBankDatabase } = require('./helpers/flexible-bank-database');
const { validateBankPurchase, recordBankPurchase, bankProductTerms } = require('../api/_flexible-bank-purchase');
const { planFlexiblePackageFifo } = require('../api/_flexible-package-ledger');
const { calculateFlexibleFunding } = require('../api/_authoritative-lesson-earning');

const validBody = (overrides = {}) => ({
  client_request_id: crypto.randomUUID(), learner_id: 41, product_version_id: 30, amount_pence: 81000,
  received_on: '2026-09-24', bank_reference: 'BANK-TRANSACTION-12345',
  consent_evidence_reference: 'Agreement archive entry 15', reason: 'Bank-paid package',
  funds_received_confirmed: true, adult_age_confirmed: true, consumer_terms_accepted: true,
  immediate_access_requested: true, disclosure_version: 'flexible-hours-consumer-rights-v1', ...overrides,
});
const admin = { id: 1, school_id: 1, role: 'admin', email: 'admin@example.test' };
function databaseHandler(db, overrides = {}) {
  const paths = ['@neondatabase/serverless','../api/_db-transaction','../api/flexible-packages', ...Object.keys(overrides)];
  const saved = paths.map(name => { const key=require.resolve(name);require(name);return [key,require.cache[key]]; });
  const replace = (name, exports) => { const key=require.resolve(name);require.cache[key]={...require.cache[key],exports}; };
  const sql=async(strings,...values)=>(await db.query(strings.reduce((query,part,index)=>query+(index?'$'+index:'')+part,''),values)).rows;
  replace('@neondatabase/serverless',{...require('@neondatabase/serverless'),neon:()=>sql});
  replace('../api/_db-transaction',{withNeonTransaction:async(_connection,callback)=>{
    await db.exec('SAVEPOINT http_call');
    try {const result=await callback(db);await db.exec('RELEASE SAVEPOINT http_call');return result;}
    catch(error){await db.exec('ROLLBACK TO SAVEPOINT http_call; RELEASE SAVEPOINT http_call');throw error;}
  }});
  for(const [name,exports] of Object.entries(overrides))replace(name,{...require(name),...exports});
  delete require.cache[require.resolve('../api/flexible-packages')];
  const handler=require('../api/flexible-packages');
  for(const [key,value] of saved)require.cache[key]=value;
  return handler;
}

async function callHandler(handler, action, body, identity = admin, method = 'POST', query = {}) {
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='bank-api-test-secret';
  try {
    const cookie=identity.role==='learner'?'cc_learner':'cc_admin';
    const token=jwt.sign(identity,process.env.JWT_SECRET);
    const req={method,query:{action,...query},body,headers:{cookie:cookie+'='+token+'; cc_csrf=bank-test','x-csrf-token':'bank-test'}};
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await handler(req,res);
    return res;
  } finally {if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
}
let db;
test.describe('bank-transfer Flexible Hours on PostgreSQL', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => { db = await createBankDatabase(); });
  test.afterAll(async () => { await db?.close(); });
  test.beforeEach(async () => { await db.exec('BEGIN'); });
  test.afterEach(async () => { await db.exec('ROLLBACK'); });

  async function record(body = validBody(), scope = {}) {
    return recordBankPurchase(db, { input: validateBankPurchase(body), schoolId: 1, admin, req: { headers: {} }, ...scope });
  }

  test('records exactly 900 minutes, frozen value and audit; does not manufacture Stripe identities', async () => {
    const body = validBody();
    const result = await record(body);
    expect(result).toMatchObject({ ok: true, reused: false, minutes_added: 900, amount_pence: 81000 });
    expect((await db.query('SELECT * FROM flexible_package_balances')).rows[0]).toMatchObject({ remaining_minutes: 900, refundable_value_pence: 81000 });
    expect((await db.query('SELECT * FROM flexible_package_purchases')).rows[0]).toMatchObject({
      payment_provider: 'bank_transfer', attempt_id: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null,
      rate_pence_per_unit: 2700, total_units: 30,
    });
    expect((await db.query('SELECT * FROM flexible_package_sources')).rows[0]).toMatchObject({ original_stripe_fee_pence: 0, original_value_pence: 81000 });
    expect((await db.query('SELECT * FROM audit_log')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM flexible_package_purchase_attempts')).rows).toHaveLength(0);
    expect((await db.query('SELECT balance_minutes FROM learner_users WHERE id=41')).rows[0].balance_minutes).toBe(0);
    expect(await record(body)).toMatchObject({ reused: true, purchase_id: result.purchase_id });
    expect(await record({ ...body, client_request_id: crypto.randomUUID(), bank_reference: '  bank-transaction-12345  ' })).toMatchObject({ reused: true });
    expect((await db.query('SELECT * FROM flexible_package_sources')).rows).toHaveLength(1);
  });

  test('rejects altered retries, another learner reusing a reference, and cross-school identities', async () => {
    const body = validBody();
    await record(body);
    await expect(record({ ...body, amount_pence: 81001 })).rejects.toMatchObject({ code: 'BANK_RECEIPT_CONFLICT' });
    await expect(record({ ...body, client_request_id: crypto.randomUUID(), learner_id: 42 })).rejects.toMatchObject({ code: 'BANK_RECEIPT_CONFLICT' });
    await expect(record(validBody({ learner_id: 99 }))).rejects.toMatchObject({ code: 'LEARNER_NOT_FOUND' });
    await expect(record(validBody({ bank_reference: 'OTHER-REF', product_version_id: 31 }))).rejects.toMatchObject({ code: 'PACKAGE_VERSION_CHANGED' });
    expect((await db.query('SELECT * FROM flexible_package_sources')).rows).toHaveLength(1);
  });

  test('rejects amount mismatch, unverified learners, unavailable products and disabled school gate', async () => {
    await expect(record(validBody({ amount_pence: 80000 }))).rejects.toMatchObject({ code: 'BANK_AMOUNT_MISMATCH' });
    await db.exec('UPDATE learner_users SET email_verified=FALSE WHERE id=41');
    await expect(record()).rejects.toMatchObject({ code: 'VERIFIED_LEARNER_REQUIRED' });
    await db.exec('UPDATE learner_users SET email_verified=TRUE WHERE id=41; UPDATE package_products SET active=FALSE WHERE id=20');
    await expect(record()).rejects.toMatchObject({ code: 'PACKAGE_VERSION_CHANGED' });
    await db.exec("UPDATE schools SET config='{}' WHERE id=1");
    await expect(record()).rejects.toMatchObject({ code: 'FLEXIBLE_PACKAGE_LIVE_PURCHASING_DISABLED' });
    expect((await db.query('SELECT * FROM flexible_package_bank_receipts')).rows).toHaveLength(0);
  });

  test('rolls the entire receipt and entitlement back if audit insertion fails', async () => {
    await db.exec('SAVEPOINT receipt');
    const client = { query: (sql, params) => {
      if (sql.includes('INSERT INTO audit_log')) throw new Error('Simulated audit failure');
      return db.query(sql, params);
    } };
    await expect(recordBankPurchase(client, { input: validateBankPurchase(validBody()), schoolId: 1, admin, req: {} })).rejects.toThrow('Simulated audit failure');
    await db.exec('ROLLBACK TO SAVEPOINT receipt');
    for (const table of ['flexible_package_bank_receipts','flexible_package_purchases','flexible_package_sources','flexible_package_state_events']) {
      expect((await db.query('SELECT COUNT(*)::int AS count FROM ' + table)).rows[0].count).toBe(0);
    }
  });

  test('unresolved online checkout prevents a separate bank grant', async () => {
    await db.query(`INSERT INTO flexible_package_purchase_attempts
      (id,school_id,learner_id,product_id,product_version_id,product_slug,product_snapshot,amount_pence,
       total_units,rate_pence_per_unit,customer_terms_version,disclosure_version,adult_age_confirmed,
       terms_accepted,immediate_access_requested,status,client_request_id,idempotency_key,stripe_payment_method_configuration_id)
      VALUES ($1,1,41,20,30,'flexible-15-hours','{}',81000,30,2700,'flexible-hours-v1',
       'flexible-hours-consumer-rights-v1',TRUE,TRUE,TRUE,'pending',$2,'online-test','pmc_test')`,
    [crypto.randomUUID(),crypto.randomUUID()]);
    await expect(record()).rejects.toMatchObject({ code: 'OPEN_FLEXIBLE_CHECKOUT' });
    expect((await db.query('SELECT * FROM flexible_package_bank_receipts')).rows).toHaveLength(0);
  });

  test('a genuinely separate received payment adds a new source without replacing existing hours', async () => {
    await record();
    await record(validBody({ bank_reference:'BANK-TRANSACTION-SECOND' }));
    expect((await db.query('SELECT * FROM flexible_package_sources')).rows).toHaveLength(2);
    expect((await db.query('SELECT * FROM flexible_package_balances')).rows[0].remaining_minutes).toBe(1800);
  });

  test('same bank source funds bookings and exact returns without ordinary credit or Stripe payout eligibility', async () => {
    const result = await record();
    const sources = await db.query('SELECT source_id AS id, remaining_units, rate_pence_per_unit FROM flexible_package_source_remaining WHERE school_id=1 AND learner_id=41');
    const plan = planFlexiblePackageFifo(sources.rows, 3);
    expect(plan).toMatchObject({ ok: true, contribution_pence: 8100 });
    const allocation = (await db.query(`INSERT INTO flexible_package_booking_allocations
      (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,rate_pence_per_unit,contribution_pence)
      VALUES (1,41,$1,501,1,3,2700,8100) RETURNING id`, [result.source_id])).rows[0];
    expect((await db.query('SELECT * FROM flexible_package_balances')).rows[0]).toMatchObject({ remaining_minutes: 810, refundable_value_pence: 72900 });
    expect(calculateFlexibleFunding([{ source_id: result.source_id, initial_units: 30, units_allocated: 3,
      unit_minutes: 30, preceding_active_units: 0, original_value_pence: 81000, contribution_pence: 8100 }],90,8000)).toMatchObject({ ok: false, reason: 'FLEXIBLE_SOURCE_EVIDENCE_INCOMPLETE' });
    await db.query(`INSERT INTO flexible_package_allocation_returns
      (school_id,allocation_id,booking_id,units_returned,reason) VALUES (1,$1,501,3,'learner_cancelled_48h_plus')`,[allocation.id]);
    expect((await db.query('SELECT * FROM flexible_package_balances')).rows[0].remaining_minutes).toBe(900);
  });

  test('retains financial facts but permits only the exact GDPR removal of receipt personal data', async () => {
    await record();
    await db.exec('SAVEPOINT immutable');
    await expect(db.exec('UPDATE flexible_package_bank_receipts SET amount_pence=1')).rejects.toMatchObject({ code: '55000' });
    await db.exec('ROLLBACK TO SAVEPOINT immutable');
    await db.exec('UPDATE flexible_package_bank_receipts SET learner_id=NULL,bank_reference=NULL,consent_evidence_reference=NULL,reason=NULL WHERE school_id=1 AND learner_id=41');
    expect((await db.query('SELECT * FROM flexible_package_bank_receipts')).rows[0]).toMatchObject({ learner_id: null, bank_reference: null, amount_pence: 81000 });
  });

  test('database prevents fake Stripe origin and duplicate bank receipts', async () => {
    await record();
    await db.exec('SAVEPOINT constraint_check');
    await expect(db.exec(`INSERT INTO flexible_package_purchases
      (school_id,learner_id,product_id,product_version_id,product_slug,product_snapshot,amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,paid_at)
      VALUES (1,41,20,30,'flexible-15-hours','{}',81000,'GBP',30,30,2700,'flexible-hours-v1',NOW())`)).rejects.toMatchObject({ code: '23514' });
    await db.exec('ROLLBACK TO SAVEPOINT constraint_check');
  });

  test('authenticated API records atomically and exposes the actual learner balance and bank history', async () => {
    const handler=databaseHandler(db);
    const body=validBody({school_id:2});
    const result=await callHandler(handler,'record-bank-purchase',body,admin,'POST',{school_id:'2'});
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ok:true,minutes_added:900});
    const balance=await callHandler(handler,'balance',{}, {id:41,school_id:1,role:'learner'},'GET');
    expect(balance.body).toMatchObject({remaining_minutes:900,refundable_value_pence:81000});
    const overview=await callHandler(handler,'admin-overview',{},admin,'GET');
    expect(overview.statusCode).toBe(200);
    expect(overview.body.purchases[0]).toMatchObject({payment_provider:'bank_transfer',bank_reference:body.bank_reference});
    const replay=await callHandler(handler,'record-bank-purchase',body);
    expect(replay.body).toMatchObject({reused:true,purchase_id:result.body.purchase_id});
    const crossSchool=await callHandler(handler,'record-bank-purchase',validBody({learner_id:99}));
    expect(crossSchool.statusCode).toBe(404);
    const noScope=await callHandler(handler,'record-bank-purchase',validBody(),{id:1,role:'superadmin'});
    expect(noScope.statusCode).toBe(400);
  });

  test('online Checkout rechecks a bank grant that arrives after its initial balance read', async () => {
    let stripeCalls=0;
    const handler=databaseHandler(db,{
      '../api/_flexible-package-payments':{
        createFlexiblePackageLiveStripeClient:()=>({checkout:{sessions:{create:()=>{stripeCalls++;throw new Error('Unexpected Stripe call');}}}}),
        getFlexiblePackageLivePaymentConfiguration:()=> 'pmc_test',
      },
      '../api/_post-trial-discount':{quotePostTrialPrice:async()=>{
        await record();
        return {pricePence:81000,quoteId:null};
      }},
    });
    const response=await callHandler(handler,'create-checkout',{
      product_id:20,client_request_id:crypto.randomUUID(),adult_age_confirmed:true,
      consumer_terms_accepted:true,immediate_access_requested:true,disclosure_version:'flexible-hours-consumer-rights-v1',
    },{id:41,school_id:1,role:'learner'});
    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe('FLEXIBLE_BALANCE_MUST_BE_USED_FIRST');
    expect(stripeCalls).toBe(0);
    expect((await db.query('SELECT * FROM flexible_package_purchase_attempts')).rows).toHaveLength(0);
  });
});

test('validates dates, integer pence and explicit evidence before opening a transaction', () => {
  for (const received_on of ['2026-02-30', '2099-01-01', '2026-2-1']) expect(() => validateBankPurchase(validBody({ received_on }))).toThrow();
  for (const key of ['funds_received_confirmed','adult_age_confirmed','consumer_terms_accepted','immediate_access_requested']) {
    expect(() => validateBankPurchase(validBody({ [key]: 'true' }))).toThrow();
  }
  expect(() => validateBankPurchase(validBody({ amount_pence: 81000.5 }))).toThrow();
  expect(bankProductTerms({})).toBeNull();
});

test('HTTP handler rejects missing auth, learner auth, missing CSRF, and wrong methods', async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'bank-purchase-tests-only';
  const handler = require('../api/flexible-packages');
  try {
    for (const scenario of [
      { method: 'POST', role: null, csrf: true, status: 401 },
      { method: 'POST', role: 'learner', csrf: true, status: 401 },
      { method: 'POST', role: 'admin', csrf: false, status: 401 },
      { method: 'GET', role: 'admin', csrf: true, status: 405 },
    ]) {
      const token = scenario.role ? jwt.sign({ id: 1, role: scenario.role, school_id: 1 }, process.env.JWT_SECRET) : '';
      const req = { method: scenario.method, query: { action: 'record-bank-purchase' }, body: validBody(),
        headers: { cookie: 'cc_admin='+token+'; cc_csrf=test-csrf', ...(scenario.csrf ? { 'x-csrf-token': 'test-csrf' } : {}) } };
      const res = { statusCode: 200, status(code) { this.statusCode=code;return this; }, json(body) { this.body=body;return this; } };
      await handler(req,res);
      expect(res.statusCode).toBe(scenario.status);
    }
  } finally { if(originalSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret; }
});
