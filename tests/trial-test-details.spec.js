const {test,expect}=require('@playwright/test');
const details=require('../api/_learner-test-details');
test('strict dates, optional states, month/day and school midnight boundaries',()=>{
  expect(details.normalise()).toEqual({booked:null,date:null,time:null,centre:null});
  for(const date of ['2026-02-29','2026-04-31','2026-1-01','nonsense'])expect(()=>details.normalise({booked:true,date})).toThrow();
  expect(details.normalise({booked:true,date:'2028-02-29'}).date).toBe('2028-02-29');
  expect(()=>details.normalise({booked:false,date:'2028-02-29'})).toThrow();
  expect(()=>details.normalise({booked:'true'})).toThrow();
  expect(()=>details.normalise({booked:true,centre:'x'.repeat(161)})).toThrow();
  expect(()=>details.normalise({booked:true,date:'2026-09-20'},{today:'2026-09-21'})).toThrow();
  expect(details.normalise({booked:true,date:'2026-09-21'},{today:'2026-09-21'}).date).toBe('2026-09-21');
  expect(details.localDate(new Date('2026-09-20T23:30:00Z'),'Europe/London')).toBe('2026-09-21');
});
test('profile presence rules preserve omitted legacy data, clear old time, and require modern version',()=>{
  const old={test_date:'legacy invalid date',test_time:'09:00',test_centre:'Centre'};
  expect(details.profilePatch({phone:'07123456789'},old)).toMatchObject({touched:false,date:'legacy invalid date'});
  expect(details.profilePatch({test_date:'2027-01-01'},{test_date:'2026-12-01',test_time:'09:00',test_centre:'Centre'})).toMatchObject({booked:true,time:null,centre:'Centre'});
  expect(details.profilePatch({test_details:{booked:false},test_details_updated_at:null},old)).toMatchObject({booked:false,date:null,time:null,centre:null});
  expect(()=>details.profilePatch({test_details:{booked:true}},old)).toThrow();
  expect(details.funnelContext({entry_page:'https://pii.invalid',campaign_key:'email@example.test',content_version:'date:2027-01-01'})).toMatchObject({entry_page:'unknown',campaign_key:null,content_version:null});
});
