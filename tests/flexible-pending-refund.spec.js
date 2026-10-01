'use strict';
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createBankDatabase } = require('./helpers/flexible-bank-database');
const { planFlexiblePackageFifo } = require('../api/_flexible-package-ledger');
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

let db, sourceId;
test.describe('pending Flexible Hours refund recording', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => { db = await createBankDatabase(); });
  test.afterAll(async () => { await db?.close(); });
  test.beforeEach(async () => {
    await db.exec('BEGIN');
    await db.query(`INSERT INTO flexible_package_purchase_attempts
      (id,school_id,learner_id,product_id,product_version_id,product_slug,product_snapshot,amount_pence,
       total_units,rate_pence_per_unit,customer_terms_version,disclosure_version,adult_age_confirmed,
       terms_accepted,immediate_access_requested,status,client_request_id,idempotency_key,stripe_payment_method_configuration_id)
      VALUES ($1,1,41,20,30,'flexible-15-hours','{}',81000,30,2700,'flexible-hours-v1',
       'flexible-hours-consumer-rights-v1',TRUE,TRUE,TRUE,'paid',$2,'refund-test','pmc_test')`,
      [crypto.randomUUID(),crypto.randomUUID()]);
    const purchase = await db.query(`INSERT INTO flexible_package_purchases
      (school_id,learner_id,attempt_id,product_id,product_version_id,product_slug,product_snapshot,
       amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,
       stripe_checkout_session_id,stripe_payment_intent_id,paid_at)
      SELECT school_id,learner_id,id,product_id,product_version_id,product_slug,product_snapshot,
       amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,
       'cs_test','pi_test',NOW() FROM flexible_package_purchase_attempts RETURNING id`);
    sourceId = Number((await db.query(`INSERT INTO flexible_package_sources
      (school_id,learner_id,purchase_id,initial_units,rate_pence_per_unit,original_value_pence,product_version_id,available_at)
      VALUES (1,41,$1,30,2700,81000,30,NOW()) RETURNING id`, [purchase.rows[0].id])).rows[0].id);
  });
  test.afterEach(async () => { await db.exec('ROLLBACK'); });
  const body = (overrides={}) => ({ source_id:sourceId, units:30, provider_status:'pending',
    provider_refund_id:'re_pending', evidence_reference:'Stripe refund record', reason:'Unused hours refund', ...overrides });
  const balance = async () => (await db.query('SELECT remaining_minutes,refundable_value_pence FROM flexible_package_balances WHERE school_id=1 AND learner_id=41')).rows[0];

  test('pending immediately removes all spendable hours; retry and success never deduct twice', async () => {
    const handler=databaseHandler(db);
    const first=await callHandler(handler,'record-refund-evidence',body());
    expect(first.statusCode).toBe(201);
    expect(first.body).toMatchObject({ok:true,provider_status:'pending',provider_call_made_by_application:false});
    expect(await balance()).toMatchObject({remaining_minutes:0,refundable_value_pence:0});
    const sources=(await db.query('SELECT source_id AS id,remaining_units,rate_pence_per_unit FROM flexible_package_source_remaining')).rows;
    expect(planFlexiblePackageFifo(sources,2).ok).toBe(false);
    expect((await callHandler(handler,'record-refund-evidence',body())).body.reused).toBe(true);
    const update={reduction_id:first.body.reduction.id,provider_status:'succeeded'};
    expect((await callHandler(handler,'record-refund-status',update)).body).toMatchObject({ok:true,reused:false});
    expect((await callHandler(handler,'record-refund-status',update)).body.reused).toBe(true);
    expect(await balance()).toMatchObject({remaining_minutes:0,refundable_value_pence:0});
    expect((await db.query('SELECT * FROM flexible_package_source_reductions')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM flexible_package_state_events')).rows).toHaveLength(2);
    expect((await db.query('SELECT * FROM audit_log')).rows).toHaveLength(2);
    expect((await db.query('SELECT balance_minutes FROM learner_users WHERE id=41')).rows[0].balance_minutes).toBe(0);
  });

  test('partial pending refund retains exact unrefunded balance and rejects duplicate conflicts and excess',async()=>{
    const handler=databaseHandler(db);
    expect((await callHandler(handler,'record-refund-evidence',body({units:8}))).body.reduction.learner_refund_pence).toBe(21600);
    expect(await balance()).toMatchObject({remaining_minutes:660,refundable_value_pence:59400});
    expect((await callHandler(handler,'record-refund-evidence',body({units:9}))).body.code).toBe('REFUND_EVIDENCE_CONFLICT');
    expect((await callHandler(handler,'record-refund-evidence',body({units:23,provider_refund_id:'re_excess'}))).body.code).toBe('REFUND_EXCEEDS_UNUSED_VALUE');
  });

  test('failed and canceled outcomes remain unspendable and cannot be silently overwritten',async()=>{
    const handler=databaseHandler(db);
    const first=await callHandler(handler,'record-refund-evidence',body());
    const reduction_id=first.body.reduction.id;
    expect((await callHandler(handler,'record-refund-status',{reduction_id,provider_status:'failed'})).body.ok).toBe(true);
    expect(await balance()).toMatchObject({remaining_minutes:0});
    expect((await callHandler(handler,'record-refund-status',{reduction_id,provider_status:'succeeded'})).body.code).toBe('REFUND_STATUS_REVIEW_REQUIRED');
  });

  test('school, role, method, CSRF and status guards prevent mutations',async()=>{
    const handler=databaseHandler(db);
    expect((await callHandler(handler,'record-refund-evidence',body(),{...admin,school_id:2})).statusCode).toBe(404);
    expect((await callHandler(handler,'record-refund-evidence',body(),{id:41,role:'learner',school_id:1})).statusCode).toBe(401);
    expect((await callHandler(handler,'record-refund-evidence',body(),admin,'GET')).statusCode).toBe(405);
    expect((await callHandler(handler,'record-refund-evidence',body({provider_status:'failed'}))).statusCode).toBe(400);
    const first=await callHandler(handler,'record-refund-evidence',body());
    const reduction_id=first.body.reduction.id;
    expect((await callHandler(handler,'record-refund-status',{reduction_id,provider_status:'succeeded'},{...admin,school_id:2})).statusCode).toBe(404);
    expect((await callHandler(handler,'record-refund-status',{reduction_id,provider_status:'pending'})).statusCode).toBe(400);
    const token=jwt.sign(admin,'refund-csrf-test');
    const old=process.env.JWT_SECRET;process.env.JWT_SECRET='refund-csrf-test';
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    try{await handler({method:'POST',query:{action:'record-refund-status'},body:{reduction_id,provider_status:'succeeded'},headers:{cookie:'cc_admin='+token+'; cc_csrf=expected'}},res);}finally{if(old===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old;}
    expect(res.statusCode).toBe(401);
  });

  test('already allocated hours cannot be refunded; legacy completed submissions remain compatible',async()=>{
    await db.query(`INSERT INTO flexible_package_booking_allocations
      (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,rate_pence_per_unit,contribution_pence)
      VALUES (1,41,$1,501,1,4,2700,10800)`,[sourceId]);
    const handler=databaseHandler(db);
    expect((await callHandler(handler,'record-refund-evidence',body())).body.code).toBe('REFUND_EXCEEDS_UNUSED_VALUE');
    const input=body({units:26});delete input.provider_status;
    const response=await callHandler(handler,'record-refund-evidence',input);
    expect(response.body).toMatchObject({ok:true,provider_status:'succeeded'});
    expect(await balance()).toMatchObject({remaining_minutes:0});
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(1);
  });

  test('canceled outcome is evidence only, and status audit failure rolls back',async()=>{
    const first=await callHandler(databaseHandler(db),'record-refund-evidence',body());
    const update={reduction_id:first.body.reduction.id,provider_status:'canceled'};
    const failing={query:async(sql,params)=>{if(sql.includes('INSERT INTO audit_log'))throw new Error('Audit unavailable');return db.query(sql,params);},exec:sql=>db.exec(sql)};
    expect((await callHandler(databaseHandler(failing),'record-refund-status',update)).statusCode).toBe(500);
    expect((await db.query('SELECT detail FROM flexible_package_state_events ORDER BY id DESC')).rows[0].detail.provider_status).toBe('pending');
    expect((await callHandler(databaseHandler(db),'record-refund-status',update)).body.ok).toBe(true);
    expect(await balance()).toMatchObject({remaining_minutes:0});
  });

  test('audit failure rolls back the balance reduction and event',async()=>{
    const failing={query:async(sql,params)=>{if(sql.includes('INSERT INTO audit_log'))throw new Error('Audit unavailable');return db.query(sql,params);},exec:sql=>db.exec(sql)};
    const response=await callHandler(databaseHandler(failing),'record-refund-evidence',body());
    expect(response.statusCode).toBe(500);
    expect(await balance()).toMatchObject({remaining_minutes:900});
    expect((await db.query('SELECT * FROM flexible_package_source_reductions')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM flexible_package_state_events')).rows).toHaveLength(0);
  });
});
