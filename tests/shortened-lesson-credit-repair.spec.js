'use strict';
const {test,expect} = require('@playwright/test');
const {PGlite} = require('@electric-sql/pglite');
const {TARGETS,buildPreview,applyRepair,readEvidence} = require('../scripts/lib/shortened-lesson-credit-repair');
const {loadFifoCreditSources,planFifoCreditDraw} = require('../api/_bcs-fifo');
let db;
const options = fingerprint => ({reviewedFingerprint:fingerprint,adminId:1,operatorIdentity:'Fixture operator',evidenceReference:'Fixture approval'});
const sql = async (parts,...values) => (await db.query(parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
async function apply(extra={}) {
  const preview=await buildPreview(db);
  await db.exec('SAVEPOINT repair');
  try {const result=await applyRepair(db,{...options(preview.fingerprint),...extra});await db.exec('RELEASE SAVEPOINT repair');return result;}
  catch(e){await db.exec('ROLLBACK TO SAVEPOINT repair');throw e;}
}
test.describe('historical shortened lesson source repair',()=>{
  test.describe.configure({mode:'serial'});
  test.beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      CREATE TABLE admin_users(id int,school_id int);
      CREATE TABLE learner_users(id int,school_id int,balance_minutes int,credit_balance int);
      CREATE TABLE learner_credit_balances(id int,school_id int,learner_id int,instructor_id int,balance_minutes int);
      CREATE TABLE lesson_bookings(id int,school_id int,learner_id int,instructor_id int,status text,payment_method text,
        minutes_deducted int,list_price_pence int,start_time time,end_time time,cancelled_at timestamptz,
        credit_returned boolean,credit_forfeited boolean,lesson_payment_contract_id uuid,rescheduled_from int);
      CREATE TABLE credit_transactions(id int PRIMARY KEY,school_id int,learner_id int,instructor_id int,type text,minutes int,
        amount_pence int DEFAULT 0,stripe_fee_pence int DEFAULT 0,effective_rate_pence_per_minute int DEFAULT 0,
        absorbed_by text,created_at timestamptz DEFAULT NOW());
      CREATE TABLE booking_credit_sources(id serial PRIMARY KEY,school_id int,booking_id int,credit_transaction_id int REFERENCES credit_transactions(id),
        minutes_drawn int,rate_pence_per_minute int,contribution_pence int,stripe_fee_pence int,absorbed_by text,refunded_at timestamptz,created_at timestamptz DEFAULT NOW());
      CREATE UNIQUE INDEX active_source ON booking_credit_sources(booking_id,credit_transaction_id) WHERE refunded_at IS NULL;
      CREATE TABLE credit_source_adjustments(id serial PRIMARY KEY,credit_transaction_id int REFERENCES credit_transactions(id),kind text,
        minutes_adjusted int,pence_adjusted int,reason text,created_by int,created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_log(id serial PRIMARY KEY,school_id int,admin_id int,action text,target_type text,target_id int,details jsonb,ip_address text);
      CREATE TABLE payout_line_items(id int,school_id int,booking_id int,price_pence int,instructor_amount_pence int,stripe_fee_pence int);
      CREATE TABLE interim_v1_manual_payout_settlement_bookings(school_id int,booking_id int);
      CREATE TABLE payout_funding_basis_events(id int,school_id int,booking_id int);
      CREATE TABLE booking_earnings(id int,school_id int,booking_id int);
      CREATE TABLE school_payouts(id int,school_id int);
      CREATE TABLE school_payout_line_items(id int,school_payout_id int,booking_id int);
      CREATE TABLE interim_v1_funding_evidence(id int,school_id int,booking_id int);
      CREATE TABLE booking_earning_sources(id int,school_id int,booking_credit_source_id int);
      CREATE TABLE refund_event_lines(id int,school_id int,lesson_booking_id int,booking_credit_source_id int);
    `);
  });
  test.afterAll(async()=>db.close());
  test.beforeEach(async()=>{
    await db.exec(`BEGIN;
      INSERT INTO admin_users VALUES(1,1);
      INSERT INTO learner_users VALUES(39,1,300,0),(134,1,0,0),(999,2,600,0);
      INSERT INTO learner_credit_balances VALUES(1,1,39,6,300),(2,1,134,4,0),(3,2,999,6,600);
      INSERT INTO credit_transactions(id,school_id,learner_id,instructor_id,type,minutes) VALUES
        (117,1,39,6,'admin_add',1710),(132,1,39,6,'admin_add',30),(317,1,134,4,'admin_add',120),
        (321,1,134,4,'edit_adjustment',30),(400,1,39,6,'edit_adjustment',270);
      INSERT INTO booking_credit_sources(school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
        VALUES(1,999,117,780,92,0,0,'instructor');
      INSERT INTO credit_source_adjustments(id,credit_transaction_id,kind,minutes_adjusted,pence_adjusted) VALUES
        (17,321,'admin_correction',30,0),(21,117,'admin_correction',180,0);
      INSERT INTO audit_log(id,school_id,action,details) VALUES(707,1,'owner.confirmed_legacy_credit_cleanup',
        '{"changes":[{"id":134,"source":321,"minutes":30,"new_minutes":0,"source_adjustment_id":17}]}');
      INSERT INTO payout_line_items VALUES(214,1,539,0,0,0);
      INSERT INTO interim_v1_manual_payout_settlement_bookings VALUES(1,414),(1,458),(1,495);
    `);
    for(const t of TARGETS){
      await db.query(`INSERT INTO lesson_bookings(id,school_id,learner_id,instructor_id,status,payment_method,minutes_deducted,list_price_pence,start_time,end_time,rescheduled_from)
        VALUES($1,1,$2,$3,'chargeable','credit',$4,0,'10:00',$5,$6)`,[t.bookingId,t.learnerId,t.instructorId,t.after,t.after===60?'11:00':'11:30',t.bookingId===539?532:null]);
      await db.query(`INSERT INTO booking_credit_sources(id,school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
        VALUES($1,1,$2,$3,$4,$5,0,0,$6)`,[t.bcsId,t.bookingId,t.sourceId,t.before,t.learnerId===39?92:0,t.learnerId===39?'instructor':'platform']);
    }
    await db.exec("SELECT setval('booking_credit_sources_id_seq',1000); SELECT setval('credit_source_adjustments_id_seq',100); SELECT setval('audit_log_id_seq',1000)");
  });
  test.afterEach(async()=>db.exec('ROLLBACK'));
  test('restores five one-hour draws, preserves balances and settled financial records, and replays safely',async()=>{
    const before=await readEvidence(db);
    expect((await buildPreview(db)).before[0]).toMatchObject({minutes:30,oneHour:false});
    const result=await apply();
    expect(result.after).toEqual([{learnerId:39,instructorId:6,minutes:300,oneHour:true},{learnerId:134,instructorId:4,minutes:0,oneHour:false}]);
    const after=await readEvidence(db);
    for(const key of ['balances','learners','credits','bookings','payouts','settlements']) expect(after[key]).toEqual(before[key]);
    expect(after.adjustments.filter(a=>a.credit_transaction_id===321).reduce((n,a)=>n+a.minutes_adjusted,0)).toBe(30);
    expect(after.adjustments.filter(a=>a.credit_transaction_id===400).reduce((n,a)=>n+a.minutes_adjusted,0)).toBe(270);
    expect(after.adjustments.filter(a=>a.credit_transaction_id===317).reduce((n,a)=>n+a.minutes_adjusted,0)).toBe(30);
    for(const t of TARGETS) expect(after.allocations.find(s=>s.id===t.bcsId).refunded_at).toBeTruthy();
    expect((await apply()).status).toBe('already_applied');
    expect(await readEvidence(db)).toEqual(after);
    const sources=await loadFifoCreditSources(sql,{learnerId:39,instructorId:6,schoolId:1,creditTransactionTypes:['admin_add']});
    for(let i=0;i<5;i++){
      const draw=planFifoCreditDraw({sources,minutes:60,schoolId:1});expect(draw.ok).toBe(true);
      for(const row of draw.rows) sources.find(s=>s.id===row.credit_transaction_id).active_minutes_drawn+=row.minutes_drawn;
    }
    expect(planFifoCreditDraw({sources,minutes:60,schoolId:1}).ok).toBe(false);
  });
  test('stale fingerprint cannot mutate rows',async()=>{
    const before=await readEvidence(db);
    await expect(apply({reviewedFingerprint:'stale'})).rejects.toThrow('fingerprint');
    expect(await readEvidence(db)).toEqual(before);
  });
  test('required audit failure rolls back every replacement and adjustment',async()=>{
    await db.exec(`ALTER TABLE audit_log ADD CONSTRAINT reject_repair CHECK (action <> 'credits.shortened_lesson_source_repair_20260928')`);
    const before=await readEvidence(db);
    await expect(apply()).rejects.toThrow();
    expect(await readEvidence(db)).toEqual(before);
  });
  test('wrong-school operator cannot mutate rows',async()=>{
    await db.exec('UPDATE admin_users SET school_id=2');
    const before=await readEvidence(db);
    await expect(apply()).rejects.toThrow('Wrong-school');
    expect(await readEvidence(db)).toEqual(before);
  });
  for(const [name,change] of [
    ['cash contribution','UPDATE booking_credit_sources SET contribution_pence=1 WHERE id=147'],
    ['missing owner clearance',"UPDATE audit_log SET details='{}' WHERE id=707"],
    ['cross-school booking','UPDATE lesson_bookings SET school_id=2 WHERE id=386'],
    ['new refund evidence','INSERT INTO refund_event_lines VALUES(1,1,386,147)'],
    ['changed balance','UPDATE learner_credit_balances SET balance_minutes=360 WHERE learner_id=39'],
  ]) test(`refuses ${name}`,async()=>{
    await db.exec(change);const before=await readEvidence(db);
    await expect(apply()).rejects.toThrow();expect(await readEvidence(db)).toEqual(before);
  });
});
