const { test, expect } = require('@playwright/test');
const h = require('./helpers/trial-funnel-fixture');
const { randomUUID } = require('crypto');
const { loadReport } = require('../api/_trial-funnel-report');

test.describe('trial snapshots and report joins on isolated PostgreSQL', () => {
  test.skip(!process.env.TRIAL_FUNNEL_DB_TEST, 'Requires the dedicated loopback database.');
  test.describe.configure({ mode: 'serial' });
  let sql, pool, fixture, learnerId, trialType;
  test.beforeAll(async () => { await h.bootstrap(); ({ sql, pool } = h.installMocks()); });
  test.afterAll(async () => { await h.closeMocks(); });
  test.beforeEach(async () => {
    fixture = await h.seed(sql, randomUUID());
    const [learner] = await sql`INSERT INTO learner_users(name,email,school_id) VALUES ('Ledger fixture',${randomUUID()+'@example.invalid'},1) RETURNING id`;
    learnerId = learner.id;
    [trialType] = await sql`SELECT id FROM lesson_types WHERE school_id=1 AND slug='trial'`;
  });
  async function booking({ day='2026-01-05', created='2026-01-01T09:00:00Z', trial=false, end='10:00', parent=null, status='chargeable' }={}) {
    const [b] = await sql`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,start_time,end_time,status,created_at,lesson_type_id,rescheduled_from)
      VALUES (1,${learnerId},${fixture.instructorId},${day},'09:00',${end},${status},${created},${trial?trialType.id:null},${parent}) RETURNING *`;
    return b;
  }
  async function snapshot(b, { at='2026-01-01T09:00:00Z', date='2026-05-01', school=1 }={}) {
    const [t] = await sql`INSERT INTO trial_booking_intakes(school_id,booking_id,learner_id,instructor_id,booked_at,booking_local_date,school_timezone,test_booked,test_date_snapshot,segment,segment_version,entry_page,analytics_consent_at_booking)
      VALUES (${school},${b.id},${learnerId},${fixture.instructorId},${at},'2000-01-01','Europe/London',true,${date},'unknown','test_date_v1','test_booked',false) RETURNING *`;
    return t;
  }
  async function credit(b, minutes, suffix, returned=false, amount=3000) {
    const [ct] = await sql`INSERT INTO credit_transactions(school_id,learner_id,instructor_id,type,credits,minutes,amount_pence,stripe_session_id,created_at)
      VALUES (1,${learnerId},${fixture.instructorId},${amount?'purchase':'referral_bonus'},0,${minutes},${amount},${amount?'cs_fixture_'+randomUUID():null},'2026-01-10') RETURNING id`;
    await sql`INSERT INTO booking_credit_sources(school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,refunded_at)
      VALUES (1,${b.id},${ct.id},${minutes},50,${amount},${returned?'2026-01-20':null}::timestamptz)`;
    return ct;
  }
  test('database calendar-month boundaries, leap year and local midnight; duplicate and tenant guards', async () => {
    const cases = [
      ['2026-09-21T12:00:00Z','2027-01-21','within_4_calendar_months','2026-09-21'],
      ['2026-09-21T12:00:00Z','2027-01-22','over_4_calendar_months','2026-09-21'],
      ['2026-10-31T12:00:00Z','2027-02-28','within_4_calendar_months','2026-10-31'],
      ['2027-10-31T12:00:00Z','2028-02-29','within_4_calendar_months','2027-10-31'],
      ['2026-03-29T23:30:00Z','2026-07-30','within_4_calendar_months','2026-03-30']
    ];
    for (let i=0;i<cases.length;i++) {
      const [at,date,segment,day]=cases[i];
      const b=await booking({day:'2028-03-'+String(10+i).padStart(2,'0')});
      const row=await snapshot(b,{at,date});
      expect(row.segment).toBe(segment);expect(row.booking_local_date).toBe(day);
      await expect(snapshot(b,{at,date})).rejects.toThrow(/unique|duplicate/);
    }
    const b=await booking({day:'2028-04-01'});
    await expect(snapshot(b,{school:2})).rejects.toThrow(/association|foreign key/);
    await expect(snapshot(b,{date:'2025-12-31'})).rejects.toThrow(/check constraint|Invalid intake date/);
  });
  test('rescheduling preserves one original snapshot and transfers preparation access', async () => {
    const root=await booking({trial:true,status:'refunded'});const intake=await snapshot(root);
    const replacement=await booking({trial:true,parent:root.id,day:'2026-01-12',created:'2026-01-08'});
    const receiving=await h.seed(sql,randomUUID());
    await sql`UPDATE lesson_bookings SET instructor_id=${receiving.instructorId} WHERE school_id=1 AND id=${replacement.id}`;
    await sql`UPDATE learner_users SET primary_instructor_id=${receiving.instructorId} WHERE school_id=1 AND id=${learnerId}`;
    const {loadPreparation}=require('../api/_trial-preparation');
    expect((await loadPreparation(sql,1,fixture.instructorId,[learnerId])).size).toBe(0);
    expect((await loadPreparation(sql,1,receiving.instructorId,[learnerId])).get(learnerId).trial_intake.current_booking_id).toBe(replacement.id);
    expect(await sql`SELECT * FROM trial_booking_intakes WHERE school_id=1 AND learner_id=${learnerId}`).toEqual([intake]);
    await expect(snapshot(replacement)).rejects.toThrow('association');
  });
  test('multiple credit allocations and paid trial extension reconcile without multiplying duration; returns stay gross only', async () => {
    const trial=await booking({trial:true,end:'11:00'});await snapshot(trial);await credit(trial,60,'extension');
    const paid=await booking({day:'2026-01-15',created:'2026-01-10'});
    await credit(paid,30,'a');await credit(paid,30,'b');
    const returned=await booking({day:'2026-01-20',created:'2026-01-12',status:'refunded'});await credit(returned,60,'returned',true);
    const goodwill=await booking({day:'2026-01-22',created:'2026-01-14'});await credit(goodwill,60,'goodwill',false,0);
    const report=await loadReport(sql,{schoolId:1,from:'2026-01-01',to:'2026-02-01',instructorId:fixture.instructorId,asOf:new Date('2026-05-01')});
    expect(report.groups[0].final_session_continuation).toMatchObject({denominator:1,net_conversions:1,gross_conversions:1,cancelled_commitments:1,mean_paid_hours:1,paid_trial_extension_hours:1,chargeable_hours:1});
    expect(report.data_quality.unresolved_booking_count).toBe(0);
    expect(JSON.stringify(report)).not.toContain('Ledger fixture');
  });
  test('Flexible purchase without a booking is separate; allocated and returned units reconcile', async () => {
    const trial=await booking({trial:true});await snapshot(trial);
    const [product]=await sql`SELECT p.id AS product_id,v.id AS version_id,v.content FROM package_products p JOIN package_product_versions v ON v.product_id=p.id AND v.school_id=p.school_id WHERE p.school_id=1 AND p.slug='flexible-15-hours' LIMIT 1`;
    const uuid=randomUUID(),session='cs_fixture_'+uuid;
    await sql`INSERT INTO flexible_package_purchase_attempts(id,school_id,learner_id,product_id,product_version_id,product_slug,product_snapshot,amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,disclosure_version,adult_age_confirmed,terms_accepted,immediate_access_requested,stripe_mode,status,client_request_id,idempotency_key,stripe_payment_method_configuration_id,stripe_checkout_session_id,paid_at)
      VALUES (${uuid}::uuid,1,${learnerId},${product.product_id},${product.version_id},'flexible-15-hours',${JSON.stringify(product.content)}::jsonb,81000,'GBP',30,30,2700,'flexible-hours-v1','flexible-hours-consumer-rights-v1',true,true,true,'live','paid',${uuid}::uuid,${uuid},'pmc_fixture',${session},'2026-01-10')`;
    const [purchase]=await sql`INSERT INTO flexible_package_purchases(school_id,learner_id,attempt_id,product_id,product_version_id,product_slug,product_snapshot,amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,stripe_checkout_session_id,paid_at)
      VALUES (1,${learnerId},${uuid}::uuid,${product.product_id},${product.version_id},'flexible-15-hours',${JSON.stringify(product.content)}::jsonb,81000,'GBP',30,30,2700,'flexible-hours-v1',${session},'2026-01-10') RETURNING id`;
    const [source]=await sql`INSERT INTO flexible_package_sources(school_id,learner_id,purchase_id,product_version_id,initial_units,unit_minutes,rate_pence_per_unit,original_value_pence,available_at)
      VALUES (1,${learnerId},${purchase.id},${product.version_id},30,30,2700,81000,'2026-01-10') RETURNING id`;
    const options={schoolId:1,from:'2026-01-01',to:'2026-02-01',instructorId:fixture.instructorId,asOf:new Date('2026-05-01')};
    const before=await loadReport(sql,options);expect(before.groups[0].final_session_continuation.net_conversions).toBe(0);
    expect(before.purchases.find(p=>p.family==='flexible').purchase_count).toBe(1);
    for(let i=0;i<2;i++) {
      const b=await booking({day:'2026-01-'+(15+i),created:'2026-01-11',status:i?'refunded':'chargeable'});
      const [a]=await sql`INSERT INTO flexible_package_booking_allocations(school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
        VALUES (1,${learnerId},${source.id},${b.id},${fixture.instructorId},2,30,2700,5400) RETURNING id`;
      if(i)await sql`INSERT INTO flexible_package_allocation_returns(school_id,allocation_id,booking_id,units_returned,reason) VALUES (1,${a.id},${b.id},2,'learner_cancelled_48h_plus')`;
    }
    const after=await loadReport(sql,options);
    expect(after.groups[0].final_session_continuation).toMatchObject({denominator:1,net_conversions:1,mean_paid_hours:1,cancelled_commitments:1});
  });
  test('export includes snapshots; GDPR deletes them before anonymising the retained booking', async () => {
    const b=await booking({trial:true});await snapshot(b);
    const r=await h.request(require('../api/learner'),{action:'export-data',method:'POST',role:'learner',id:learnerId});
    expect(r.statusCode,JSON.stringify(r.body)).toBe(200);expect(r.body.trial_booking_intakes).toHaveLength(1);
    await require('../api/_gdpr').deleteLearnerCascade(sql,learnerId);
    expect(await sql`SELECT id FROM trial_booking_intakes WHERE school_id=1 AND learner_id=${learnerId}`).toHaveLength(0);
    const [retained]=await sql`SELECT learner_id,learner_anonymized FROM lesson_bookings WHERE school_id=1 AND id=${b.id}`;
    expect(retained).toEqual({learner_id:null,learner_anonymized:true});
  });
  test('existing retention worker expires only old snapshots and preserves bookings', async () => {
    const old=await booking({trial:true,day:'2023-02-01',created:'2023-01-01'});
    const recent=await booking({trial:true,day:'2026-02-01',created:'2026-01-01'});
    await snapshot(old,{at:'2023-01-01',date:'2023-03-01'});await snapshot(recent);
    process.env.CRON_SECRET='isolated-retention-only';
    const result=await h.request(require('../api/cron-retention'),{method:'GET',query:{key:process.env.CRON_SECRET}});
    expect(result.statusCode,JSON.stringify(result.body)).toBe(200);
    expect(await sql`SELECT id FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${old.id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${recent.id}`).toHaveLength(1);
    expect(await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND id=ANY(${[old.id,recent.id]}::int[])`).toHaveLength(2);
  });
});
