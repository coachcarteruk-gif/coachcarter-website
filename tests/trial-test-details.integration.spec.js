const {test,expect}=require('@playwright/test');
const h=require('./helpers/trial-funnel-fixture');
test.describe('trial intake real loopback PostgreSQL',()=>{
  test.describe.configure({mode:'serial'});
  test.skip(!process.env.TRIAL_FUNNEL_DB_TEST,'Set TRIAL_FUNNEL_DB_TEST=1; only the dedicated loopback database is accepted.');
  let sql,pool,state,slots,learner,fixture,counter=0;
  test.beforeAll(async()=>{await h.bootstrap();({sql,pool,state}=h.installMocks());slots=require('../api/slots');learner=require('../api/learner');});
  test.afterAll(async()=>{await h.closeMocks();});
  test.beforeEach(async()=>{fixture=await h.seed(sql,Date.now()+'-'+counter++);await sql`DELETE FROM rate_limits`;state.failEmail=false;state.errors.length=0;});
  function body(answer, time='10:00') {
    const n=String(Date.now()).slice(-7)+String(counter++%10);
    return {instructor_id:fixture.instructorId,date:fixture.date,start_time:time,end_time:String(Number(time.slice(0,2))+1).padStart(2,'0')+':00',
      guest_name:'Intake fixture',guest_email:n+'@example.invalid',guest_phone:'079'+n,guest_pickup_address:'Isolated fixture address',
      ...(answer===undefined?{}:{test_details:answer}),funnel_context:{entry_page:'test_booked',campaign_key:'test_booked_v1',content_version:'text_v1'}};
  }
  for(const answer of [undefined,{booked:null},{booked:false},{booked:true}])test('old/optional client books '+JSON.stringify(answer),async()=>{
    const r=await h.request(slots,{action:'book-free-trial',body:body(answer)});expect(r.statusCode,JSON.stringify(r.body)).toBe(200);
    const [row]=await sql`SELECT * FROM trial_booking_intakes WHERE booking_id=${r.body.booking_id} AND school_id=1`;
    expect(row.segment).toBe(answer?.booked===false?'not_booked':'unknown');
  });
  test('valid intake survives email failure; public existing-account booking does not overwrite profile',async()=>{
    const payload=body({booked:true,date:fixture.date,centre:'Self-reported <centre>'});
    const [account]=await sql`INSERT INTO learner_users(name,email,school_id,test_date,test_centre,test_booked)
      VALUES ('Existing',${payload.guest_email},1,'2027-12-01','Keep this centre',true) RETURNING id`;
    state.failEmail=true;
    const r=await h.request(slots,{action:'book-free-trial',body:payload});expect(r.statusCode).toBe(200);
    const [profile]=await sql`SELECT test_date,test_centre FROM learner_users WHERE school_id=1 AND id=${account.id}`;
    expect(profile).toMatchObject({test_date:'2027-12-01',test_centre:'Keep this centre'});
    const {loadPreparation}=require('../api/_trial-preparation');
    const prep=await loadPreparation(sql,1,fixture.instructorId,[account.id]);
    expect(prep.get(account.id).trial_intake.test_centre_snapshot).toBe('Self-reported <centre>');
    expect((await loadPreparation(sql,1,fixture.instructorId+9999,[account.id])).size).toBe(0);
    expect((await loadPreparation(sql,2,fixture.instructorId,[account.id])).size).toBe(0);
  });
  test('invalid details and conflicting/duplicate submissions create no partial pair',async()=>{
    const bad=await h.request(slots,{action:'book-free-trial',body:body({booked:true,date:'2026-02-30'})});expect(bad.statusCode).toBe(400);
    const payload=body({booked:true,date:fixture.date});
    const results=await Promise.all([h.request(slots,{action:'book-free-trial',body:payload}),h.request(slots,{action:'book-free-trial',body:payload})]);
    expect(results.filter(r=>r.statusCode===200)).toHaveLength(1);
    const [counts]=await sql`SELECT count(*)::int AS bookings,count(t.id)::int AS intakes FROM lesson_bookings b
      LEFT JOIN trial_booking_intakes t ON t.booking_id=b.id AND t.school_id=1 WHERE b.school_id=1 AND b.instructor_id=${fixture.instructorId}`;
    expect(counts).toEqual({bookings:1,intakes:1});
  });
  test('snapshot failure rolls back booking and new-account profile initialisation',async()=>{
    await sql`CREATE OR REPLACE FUNCTION reject_trial_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture snapshot failure'; END $$`;
    await sql`CREATE TRIGGER reject_trial_fixture BEFORE INSERT ON trial_booking_intakes FOR EACH ROW EXECUTE FUNCTION reject_trial_fixture()`;
    const payload=body({booked:true,date:fixture.date});
    try {
      const r=await h.request(slots,{action:'book-free-trial',body:payload});expect(r.statusCode).toBe(500);
      const rows=await sql`SELECT id FROM lesson_bookings WHERE school_id=1 AND instructor_id=${fixture.instructorId}`;expect(rows).toHaveLength(0);
      const [account]=await sql`SELECT test_booked,test_date FROM learner_users WHERE school_id=1 AND email=${payload.guest_email}`;
      expect(account).toMatchObject({test_booked:null,test_date:null});
    } finally {await sql`DROP TRIGGER reject_trial_fixture ON trial_booking_intakes`;await sql`DROP FUNCTION reject_trial_fixture()`;}
  });
  test('profile CAS rejects stale edits; No clears fields and snapshot stays immutable',async()=>{
    const r=await h.request(slots,{action:'book-free-trial',body:body({booked:true,date:fixture.date,centre:'Centre'})});expect(r.statusCode).toBe(200);
    const [intake]=await sql`SELECT * FROM trial_booking_intakes WHERE booking_id=${r.body.booking_id} AND school_id=1`;
    const read=await h.request(learner,{action:'profile',method:'GET',role:'learner',id:intake.learner_id});expect(read.statusCode).toBe(200);
    const version=read.body.profile.test_details_updated_at;
    const change={test_details:{booked:false},test_details_updated_at:version};
    const saved=await h.request(learner,{action:'update-profile',role:'learner',id:intake.learner_id,body:change});expect(saved.statusCode,JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.profile).toMatchObject({test_booked:false,test_date:null,test_time:null,test_centre:null});
    const conflict=await h.request(learner,{action:'update-profile',role:'learner',id:intake.learner_id,body:change});expect(conflict.statusCode).toBe(409);
    await expect(sql`UPDATE trial_booking_intakes SET segment='not_booked' WHERE school_id=1 AND id=${intake.id}`).rejects.toThrow('immutable');
    const [unchanged]=await sql`SELECT segment FROM trial_booking_intakes WHERE id=${intake.id} AND school_id=1`;expect(unchanged.segment).toBe('within_4_calendar_months');
  });
  test('feature disabled keeps old API contract and captures no intake',async()=>{
    await sql`UPDATE schools SET config=jsonb_set(config,'{test_date_trial_funnel_enabled}','false') WHERE id=1`;
    const r=await h.request(slots,{action:'book-free-trial',body:body({booked:'invalid ignored while disabled'})});expect(r.statusCode).toBe(200);
    expect(await sql`SELECT id FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${r.body.booking_id}`).toHaveLength(0);
    const schools=require('../api/schools');const entry=await h.request(schools,{action:'test-booked-page',method:'GET'});expect(entry.statusCode).toBe(302);expect(entry.headers.Location).toBe('/freetrial');
  });
  test('unrelated legacy writes preserve current and historical dates; authenticated apply is explicit and tenant scoped',async()=>{
    const result=await h.request(slots,{action:'book-free-trial',body:body({booked:true,date:fixture.date,centre:'Current centre'})});
    const [intake]=await sql`SELECT * FROM trial_booking_intakes WHERE school_id=1 AND booking_id=${result.body.booking_id}`;
    const id=intake.learner_id;
    const before=await h.request(learner,{action:'profile',method:'GET',role:'learner',id});
    const saved=await h.request(learner,{action:'update-profile',role:'learner',id,body:{pickup_address:'New pickup only'}});
    expect(saved.statusCode).toBe(200);expect(saved.body.profile.test_date).toBe(fixture.date);
    expect(saved.body.profile.test_details_updated_at).toBe(before.body.profile.test_details_updated_at);
    const crossed=await h.request(learner,{action:'profile',method:'GET',role:'learner',id,schoolId:2});expect(crossed.statusCode).toBe(404);
    await sql`INSERT INTO instructor_learner_notes(school_id,instructor_id,learner_id,test_date) VALUES (1,${fixture.instructorId},${id},'2025-01-01')
      ON CONFLICT(instructor_id,learner_id) DO UPDATE SET test_date='2025-01-01'`;
    const notes=await h.request(require('../api/instructor'),{action:'update-learner-notes',role:'instructor',id:fixture.instructorId,body:{learner_id:id,notes:'Only the note changed'}});
    expect(notes.statusCode).toBe(200);
    const [old]=await sql`SELECT test_date FROM instructor_learner_notes WHERE school_id=1 AND learner_id=${id} AND instructor_id=${fixture.instructorId}`;expect(old.test_date).toBe('2025-01-01');
    const malformed=await h.request(learner,{action:'update-profile',role:'learner',id,body:{test_details:{booked:false},test_details_updated_at:'bad timestamp'}});expect(malformed.statusCode).toBe(400);
    expect(before.body.trial_intake.test_centre_snapshot).toBe('Current centre');
    const admin=require('../api/admin');
    const category=await h.request(admin,{action:'update-learner',role:'admin',id:1,body:{id,learner_category:'regular'}});
    expect(category.statusCode,JSON.stringify(category.body)).toBe(200);expect(category.body.learner.test_date).toBe(fixture.date);
    expect(category.body.learner.test_details_updated_at).toBe(before.body.profile.test_details_updated_at);
    const change={id,test_details:{booked:false},test_details_updated_at:before.body.profile.test_details_updated_at};
    expect((await h.request(admin,{action:'update-learner',role:'admin',id:1,body:change})).statusCode).toBe(200);
    const stale=await h.request(admin,{action:'update-learner',role:'admin',id:1,body:change});expect(stale.statusCode).toBe(409);expect(stale.body.profile.test_booked).toBe(false);
    expect(await sql`SELECT id FROM audit_log WHERE school_id=1 AND target_id=${id} AND action='admin.update_learner'`).toHaveLength(2);
  });
});
