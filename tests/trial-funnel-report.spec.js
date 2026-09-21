const {test,expect}=require('@playwright/test');
const r=require('../api/_trial-funnel-report');
function booking(id,patch={}) {return {id,school_id:1,learner_id:1,instructor_id:1,created_at:'2026-01-01T09:00:00Z',scheduled_date:'2026-01-05',start_time:'09:00',end_time:'10:00',status:'chargeable',is_trial:false,...patch};}
function intake(patch={}) {return {booking_id:1,learner_id:1,booked_at:'2026-01-01T09:00:00Z',segment:'within_4_calendar_months',entry_page:'test_booked',school_timezone:'Europe/London',...patch};}
function build(bookings,intakes=[intake()],asOf='2026-05-01T00:00:00Z') {return r.buildReport({bookings,intakes,asOf,timezone:'Europe/London',cohortBounds:r.bounds('2026-01-01','2026-02-01')});}
test('reschedule origins retain commitment time; windows use calendar days across DST',()=>{
  const trial=booking(1,{is_trial:true});
  const old=booking(2,{created_at:'2026-01-04T10:00:00Z',credit_gross:60,status:'refunded'});
  const replacement=booking(3,{created_at:'2026-01-10T10:00:00Z',scheduled_date:'2026-01-15',rescheduled_from:2,credit_gross:60,credit_net:60});
  const stats=build([trial,old,replacement]).groups[0].final_session_continuation;
  expect(stats).toMatchObject({net_conversions:0,early_commitments:1,mean_paid_hours:1,paid_hours_booked_before_t0:1});
  const spring=booking(4,{scheduled_date:'2026-03-20',end_time:'10:00'});
  expect((r.sessionAt(spring,'Europe/London',true,56)-r.sessionAt(spring,'Europe/London',true))/3600000).toBe(56*24-1);
});
test('zero-inclusive means, immature exclusions and paid trial extensions stay separate',()=>{
  const trial=booking(1,{is_trial:true,end_time:'11:00',credit_gross:60,credit_net:60});
  const paid=booking(2,{created_at:'2026-01-10T10:00:00Z',scheduled_date:'2026-01-15',credit_gross:60,credit_net:60});
  const noPaid=booking(3,{learner_id:2,is_trial:true});
  const report=build([trial,paid,noPaid],[intake(),intake({learner_id:2,booking_id:3})]);
  expect(report.groups[0].final_session_continuation).toMatchObject({denominator:2,net_conversions:1,mean_paid_hours:0.5,median_paid_hours:0.5,paid_trial_extension_hours:1});
  expect(build([trial,paid],undefined,'2026-01-20T00:00:00Z').groups[0].final_session_continuation).toMatchObject({denominator:0,immature:1,mean_paid_hours:null});
});
test('branching/cycles/missing roots excluded, cancellations retained and chargeable is not attendance',()=>{
  const trial=booking(1,{is_trial:true,cancelled_at:'2026-01-04',status:'refunded'});
  expect(build([trial]).groups[0]).toMatchObject({booking_count:1,exceptions:1,all_booked_original_end:{count:1},elapsed_without_recorded_exception:{count:0}});
  const graph=r.resolveChains([booking(1,{rescheduled_from:2}),booking(2,{rescheduled_from:1}),booking(3,{rescheduled_from:99})]);
  expect(graph.get(1).error).toBe('cycle');expect(graph.get(3).error).toBe('missing_or_mismatched_origin');
  expect(r.resolveChains([booking(1),booking(2,{rescheduled_from:1}),booking(3,{rescheduled_from:1})]).get(1).error).toBe('branching');
});
test('unresolved packages, goodwill, test days, repeat trials and pre-existing paid customers are not new paid conversion',()=>{
  const trial=booking(1,{is_trial:true});
  const pkg=booking(2,{created_at:'2026-01-08',scheduled_date:'2026-01-15',curriculum_count:1});
  expect(build([trial,pkg]).groups[0].final_session_continuation).toMatchObject({denominator:0,unresolved_learners:1});
  const goodwill=booking(3,{created_at:'2026-01-08',scheduled_date:'2026-01-15'});
  expect(build([trial,goodwill]).groups[0].final_session_continuation.net_conversions).toBe(0);
  const testDay=booking(4,{created_at:'2026-01-08',scheduled_date:'2026-01-15',booking_purpose:'test_date',credit_gross:60,credit_net:60});
  expect(build([trial,testDay]).groups[0].final_session_continuation).toMatchObject({net_conversions:0,test_day_bookings:1,mean_paid_hours:0});
  const prior=booking(5,{created_at:'2025-12-01',credit_gross:60});expect(build([trial,prior]).data_quality.existing_paid_customer).toBe(1);
  expect(()=>r.bounds('2026-01-01','2028-01-01')).toThrow();
});
