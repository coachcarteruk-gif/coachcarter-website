const {test,expect}=require('@playwright/test');
const {randomUUID}=require('crypto');
const h=require('./helpers/trial-funnel-fixture');
test.describe('qualifying funnel real isolated PostgreSQL',()=>{
  test.skip(!process.env.TRIAL_FUNNEL_DB_TEST,'Dedicated local database required');test.describe.configure({mode:'serial'});
  let sql,fixture,slots,requests,state,serial=0;
  test.beforeAll(async()=>{await h.bootstrap();({sql,state}=h.installMocks());slots=require('../api/slots');requests=require('../api/trial-requests');});
  test.afterAll(async()=>h.closeMocks());
  test.beforeEach(async()=>{fixture=await h.seed(sql,randomUUID());await h.enableQuestionnaire(sql);await sql`DELETE FROM rate_limits`;state.messages.length=0;});
  function q(patch={}){return {practical_booked:true,practical_date:'2027-12-10',practical_time:'10:30',centre_choice:'Reading',budget:'saved',...patch};}
  function contact(){serial++;return {name:'Questionnaire fixture',email:randomUUID()+'@example.invalid',phone:'079'+String(Date.now()+serial).slice(-8),postcode_area:'RG1',availability:['1:morning','7:evening'],submission_key:randomUUID(),questionnaire:q({practical_booked:false,theory_booked:false}),funnel_context:{entry_page:'test_booked',campaign_key:'test_booked_v1',content_version:'text_v1'}};}
  function booking(c=contact()){return {instructor_id:fixture.instructorId,date:fixture.date,start_time:'10:00',end_time:'11:00',guest_name:c.name,guest_email:c.email,guest_phone:c.phone,guest_pickup_address:'Isolated pickup',questionnaire:q(),funnel_context:c.funnel_context};}
  const call=(action,body,extra={})=>h.request(requests,{action,body,...extra});
  test('server rejects missing, tampered, Other, no-test and lowest-budget direct routes',async()=>{
    for(const answer of [undefined,q({route:'booking',budget:'lowest'}),q({centre_choice:'Other',other_centre:'Oxford'}),q({practical_booked:false,theory_booked:true,theory_date:'2027-01-01',theory_time:'10:00'}),q({practical_time:'invalid'})]){
      const r=await h.request(slots,{action:'book-free-trial',body:{...booking(),questionnaire:answer}});expect(r.statusCode,JSON.stringify(r.body)).toBe(400);
    }
    expect(await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND instructor_id=${fixture.instructorId}`).toHaveLength(0);
  });
  test('eligible direct booking persists immutable questionnaire and time without replacing an existing profile',async()=>{
    const body=booking();const [lu]=await sql`INSERT INTO learner_users(name,email,school_id,test_date,test_time,test_centre,test_booked) VALUES('Existing',${body.guest_email},1,'2028-01-01','12:00','Keep',true) RETURNING id`;
    const r=await h.request(slots,{action:'book-free-trial',body});expect(r.statusCode,JSON.stringify(r.body)).toBe(200);
    const [t]=await sql`SELECT * FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${r.body.booking_id}`;expect(t.questionnaire.route).toBe('booking');expect(t.test_time_snapshot).toBe('10:30');expect(t.segment).toBe('over_4_calendar_months');
    const [p]=await sql`SELECT test_date,test_time,test_centre FROM learner_users WHERE school_id=1 AND id=${lu.id}`;expect(p).toEqual({test_date:'2028-01-01',test_time:'12:00',test_centre:'Keep'});
    await expect(sql`UPDATE trial_booking_intakes SET questionnaire='{}' WHERE school_id=1 AND id=${t.id}`).rejects.toThrow('immutable');
  });
  test('request persistence, concurrent duplicates, generic response, no account/booking/message and admin visibility',async()=>{
    const c=contact();const results=await Promise.all([call('submit',c),call('submit',c)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(results[0].body).toEqual(results[1].body);
    expect(await sql`SELECT id FROM enquiries WHERE school_id=1 AND email=${c.email}`).toHaveLength(1);expect(await sql`SELECT id FROM learner_users WHERE school_id=1 AND email=${c.email}`).toHaveLength(0);
    expect(await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND instructor_id=${fixture.instructorId}`).toHaveLength(0);expect(state.messages).toHaveLength(0);
    const [row]=await sql`SELECT r.* FROM trial_requests r JOIN enquiries e ON e.school_id=1 AND e.id=r.enquiry_id WHERE r.school_id=1 AND e.email=${c.email}`;
    const list=await call('export',null,{method:'GET',role:'admin',id:1,query:{id:row.id}});expect(list.body.requests[0]).toMatchObject({email:c.email,availability:c.availability,reason:'qualification'});
    expect((await call('list',null,{method:'GET'})).statusCode).toBe(401);
    const crossed=await call('export',null,{method:'GET',role:'admin',id:1,schoolId:2,query:{id:row.id}});expect(crossed.body.requests).toEqual([]);
    await expect(sql`UPDATE trial_requests SET questionnaire='{}' WHERE id=${row.id} AND school_id=1`).rejects.toThrow('immutable');
    const again=await call('submit',{...c,submission_key:randomUUID(),name:'Changed duplicate'});expect(again.body).toEqual(results[0].body);
    expect((await call('export',null,{method:'GET',role:'admin',id:1,query:{id:row.id}})).body.requests[0].name).toBe(c.name);
  });
  test('manual linking preserves original answers, source and segment across rescheduling and feeds report separately',async()=>{
    const c=contact();c.questionnaire=q({budget:'lowest'});expect((await call('submit',c)).statusCode).toBe(200);
    const [r]=await sql`SELECT r.* FROM trial_requests r JOIN enquiries e ON e.id=r.enquiry_id AND e.school_id=1 WHERE r.school_id=1 AND e.email=${c.email}`;
    const [lu]=await sql`INSERT INTO learner_users(name,email,school_id) VALUES(${c.name},${c.email},1) RETURNING id`;
    const [lt]=await sql`SELECT id FROM lesson_types WHERE school_id=1 AND slug='trial'`;
    const [b]=await sql`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,start_time,end_time,status,lesson_type_id,created_by,payment_method)
      VALUES(1,${lu.id},${fixture.instructorId},${fixture.date},'10:00','11:00','scheduled',${lt.id},'admin','free') RETURNING id`;
    const extra={role:'admin',id:1};const link=await call('link-booking',{request_id:r.id,booking_id:b.id},extra);expect(link.statusCode,JSON.stringify(link.body)).toBe(200);
    expect((await call('link-booking',{request_id:r.id,booking_id:b.id},extra)).statusCode).toBe(200);
    const [intake]=await sql`SELECT * FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${b.id}`;expect(intake.questionnaire).toEqual(r.questionnaire);expect(intake.entry_page).toBe('test_booked');
    await sql`UPDATE lesson_bookings SET status='refunded',credit_returned=true WHERE id=${b.id} AND school_id=1`;
    const [child]=await sql`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,start_time,end_time,status,lesson_type_id,rescheduled_from)
      VALUES(1,${lu.id},${fixture.instructorId},${fixture.date},'12:00','13:00','scheduled',${lt.id},${b.id}) RETURNING id`;
    const prep=await require('../api/_trial-preparation').loadPreparation(sql,1,fixture.instructorId,[lu.id]);expect(prep.get(lu.id).trial_intake.current_booking_id).toBe(child.id);expect(prep.get(lu.id).trial_intake.questionnaire.budget).toBe('lowest');
    const today=new Date().toISOString().slice(0,10),to=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const report=await require('../api/_trial-funnel-report').loadReport(sql,{schoolId:1,from:today,to});expect(report.trial_requests.some(x=>x.linked_confirmed_bookings>0)).toBe(true);expect(JSON.stringify(report)).not.toContain(c.email);
    const exported=await h.request(require('../api/learner'),{action:'export-data',role:'learner',id:lu.id});expect(exported.statusCode,JSON.stringify(exported.body)).toBe(200);
    expect(JSON.stringify(exported.body)).toContain('trial_requests');expect(JSON.stringify(exported.body)).toContain('lowest');
    expect(report.groups.some(g=>g.route==='request_to_booking' && g.form_version==='qualification_v1')).toBe(true);
    await sql`UPDATE learner_users SET email=${randomUUID()+'@example.invalid'} WHERE school_id=1 AND id=${lu.id}`;
    const changedEmail=await h.request(require('../api/learner'),{action:'export-data',role:'learner',id:lu.id});
    expect(changedEmail.body.trial_requests.some(t=>t.email===c.email)).toBe(true);
    await require('../api/_gdpr').deleteLearnerCascade(sql,lu.id,{email:c.email});expect(await sql`SELECT id FROM trial_requests WHERE school_id=1 AND id=${r.id}`).toHaveLength(0);
  });
  test('configuration is scoped and audited, fallback reason and deletion support non-account enquiries',async()=>{
    const save=await call('configure',{configuration:h.questionnaireConfig},{role:'admin',id:1});expect(save.statusCode,JSON.stringify(save.body)).toBe(200);
    expect((await sql`SELECT id FROM audit_log WHERE school_id=1 AND action='trial_questionnaire.configure'`).length).toBeGreaterThan(0);
    const c=contact();c.questionnaire=q();await call('submit',c);
    const [r]=await sql`SELECT r.* FROM trial_requests r JOIN enquiries e ON e.id=r.enquiry_id AND e.school_id=1 WHERE r.school_id=1 AND e.email=${c.email}`;expect(r.reason).toBe('no_suitable_slots');
    expect((await call('delete',{request_id:r.id},{role:'admin',id:1,schoolId:2})).statusCode).toBe(404);
    expect((await call('delete',{request_id:r.id},{role:'admin',id:1})).statusCode).toBe(200);expect(await sql`SELECT id FROM enquiries WHERE school_id=1 AND email=${c.email}`).toHaveLength(0);
  });
  test('alternate paid booking paths reject trial lesson type before any payment',async()=>{
    const c=contact(),body=booking(c);const [lu]=await sql`INSERT INTO learner_users(name,email,school_id) VALUES(${c.name},${c.email},1) RETURNING id`;
    const [lt]=await sql`SELECT id FROM lesson_types WHERE school_id=1 AND slug='trial'`;
    for(const action of ['book','checkout-slot','checkout-slot-guest','checkout-request','request-slot']){
      await sql`DELETE FROM rate_limits`;
      const result=await h.request(slots,{action,body:{...body,lesson_type_id:lt.id},role:'learner',id:lu.id});expect(result.statusCode,action+JSON.stringify(result.body)).toBe(400);expect(result.body.error).toBe('Use the free trial page to book a trial.');
    }
    expect(await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND learner_id=${lu.id}`).toHaveLength(0);
  });
  test('retention removes old non-account requests and their contact data, retaining recent requests',async()=>{
    const old=contact(),recent=contact();await call('submit',recent);
    const [e]=await sql`INSERT INTO enquiries(name,email,phone,enquiry_type,school_id) VALUES(${old.name},${old.email},${old.phone},'trial-request',1) RETURNING id`;
    await sql`INSERT INTO trial_requests(school_id,enquiry_id,submission_key,contact_key,submitted_at,postcode_area,availability,questionnaire,funnel_context,reason)
      VALUES(1,${e.id},${old.submission_key},${randomUUID()},'2023-01-01','RG1','["1:morning"]','{}','{}','qualification')`;
    process.env.CRON_SECRET='isolated-retention-only';
    const result=await h.request(require('../api/cron-retention'),{method:'GET',query:{key:process.env.CRON_SECRET}});expect(result.statusCode).toBe(200);
    expect(await sql`SELECT id FROM enquiries WHERE school_id=1 AND email=${old.email}`).toHaveLength(0);
    expect(await sql`SELECT id FROM enquiries WHERE school_id=1 AND email=${recent.email}`).toHaveLength(1);
  });
  test('public config is minimal; school spoofing and changed configuration cannot bypass routing',async()=>{
    const schools=require('../api/schools');const publicConfig=await h.request(schools,{action:'public-config',method:'GET'});
    expect(publicConfig.body.trial_questionnaire).toEqual({...h.questionnaireConfig,version:'qualification_v1'});expect(publicConfig.body.config).toBeUndefined();
    await sql`UPDATE schools SET config=jsonb_set(config,'{trial_questionnaire,supported_centres}','["Farnborough"]') WHERE id=1`;
    const r=await h.request(slots,{action:'book-free-trial',body:{...booking(),school_id:2,questionnaire:{...q(),route:'booking',config_snapshot:h.questionnaireConfig}}});expect(r.statusCode).toBe(400);
    const c=contact();c.questionnaire=q({practical_booked:false,theory_booked:false});
    const result=await call('submit',{...c,school_id:2});expect(result.statusCode).toBe(200);
    const [row]=await sql`SELECT school_id FROM enquiries WHERE email=${c.email} AND school_id=1`;expect(row.school_id).toBe(1);
  });
  test('late request conversion freezes the original segment instead of reclassifying by booking day',async()=>{
    const c=contact();const original=require('../api/_trial-qualification').qualify(q({budget:'lowest',practical_date:'2026-09-01'}),{trial_questionnaire:h.questionnaireConfig},new Date('2026-04-01T10:00:00Z'));
    const [e]=await sql`INSERT INTO enquiries(name,email,phone,enquiry_type,school_id) VALUES(${c.name},${c.email},${c.phone},'trial-request',1) RETURNING id`;
    const [r]=await sql`INSERT INTO trial_requests(school_id,enquiry_id,submission_key,contact_key,submitted_at,postcode_area,availability,questionnaire,funnel_context,reason)
      VALUES(1,${e.id},${c.submission_key},${randomUUID()},'2026-04-01T10:00:00Z','RG1','["1:morning"]',${JSON.stringify(original)}::jsonb,${JSON.stringify({entry_page:'test_booked',campaign_key:'test_booked_v1',content_version:'text_v1',analytics_consent_at_booking:false})}::jsonb,'qualification') RETURNING id`;
    const [lu]=await sql`INSERT INTO learner_users(name,email,school_id) VALUES(${c.name},${c.email},1) RETURNING id`;
    const [lt]=await sql`SELECT id FROM lesson_types WHERE school_id=1 AND slug='trial'`;
    const [b]=await sql`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,start_time,end_time,status,lesson_type_id,created_at)
      VALUES(1,${lu.id},${fixture.instructorId},${fixture.date},'10:00','11:00','scheduled',${lt.id},'2026-09-15T10:00:00Z') RETURNING id`;
    const linked=await call('link-booking',{request_id:r.id,booking_id:b.id},{role:'admin',id:1});expect(linked.statusCode,JSON.stringify(linked.body)).toBe(200);
    const [intake]=await sql`SELECT segment,booking_local_date::text,questionnaire FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${b.id}`;
    expect(intake.segment).toBe('over_4_calendar_months');expect(intake.booking_local_date).toBe('2026-09-15');expect(intake.questionnaire.captured_local_date).toBe('2026-04-01');
    const removed=await call('delete',{request_id:r.id},{role:'admin',id:1});expect(removed.statusCode).toBe(200);
    expect(await sql`SELECT id FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${b.id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND id=${b.id}`).toHaveLength(1);
  });
});
