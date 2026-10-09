const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createContactMatcher,createContactSearch}=require('./contact-matching.cjs');
const config={schoolId:1,locationId:'location-one',campaignKey:'campaign-one'};
const person={email:'alex@example.test',phone:'07700900123'};
const source=()=>({kind:'crm',school_id:1,campaign_key:'campaign-one',nomination:{permission:{accepted_at:'2026-10-09'},nominee:person,nominator:{email:'jamie@example.test',phone:'07700900456'}}});
const contacts=[{id:'alex',locationId:'location-one',email:'alex@example.test',phone:'+447700900123',dnd:true},
  {id:'jamie',locationId:'location-one',email:'jamie@example.test',phone:'+447700900456',dnd:false}];
const lookup=async ({field,value})=>{const found=contacts.filter(c=>c[field]===value);return {contacts:found,total:found.length};};

test('new nominations for the same people reuse the same exact existing contact IDs without mutations',async()=>{
 const before=structuredClone(contacts),match=createContactMatcher({config,search:lookup,enabled:true});
 const [a,b]=await Promise.all([match(source()),match(source())]);
 assert.deepEqual(a,b);assert.equal(a.nominee.id,'alex');assert.equal(a.nominator.id,'jamie');
 assert.ok(Object.values(a).every(p=>p.kind==='existing'));assert.deepEqual(contacts,before);
});
test('same person as nominator and nominee uses one match within the call',async()=>{
 let count=0;const match=createContactMatcher({config,enabled:true,search:async q=>{count++;return lookup(q);}});
 const row=source();row.nomination.nominator=person;
 const plans=await match(row);assert.deepEqual(plans.nominee,plans.nominator);assert.equal(count,2);
});
test('disabled, wrong-school, wrong-campaign, erased and permissionless sources perform no lookups',async()=>{
 let calls=0;const search=async()=>{calls++;return {contacts:[],total:0};};
 await assert.rejects(createContactMatcher({config,search})(source()),{code:'contact_matching_disabled'});
 const match=createContactMatcher({config,search,enabled:true});
 for(const change of [{school_id:2},{campaign_key:'other'},{erasure_requested_at:'today'},{nomination:{...source().nomination,permission:{}}}])
  await assert.rejects(match({...source(),...change}),{code:'invalid_match_scope'});
 assert.equal(calls,0);
});
test('no match never authorizes contact creation',async()=>{
 await assert.rejects(createContactMatcher({config,enabled:true,search:async()=>({contacts:[],total:0})})(source()),{code:'contact_not_found'});
});
test('multiple matches including truncated pages always stop',async()=>{
 for(const result of [{contacts:[contacts[0]],total:2},{contacts:[contacts[0],contacts[0]],total:2},{contacts:[],total:3}])
  await assert.rejects(createContactMatcher({config,enabled:true,search:async()=>result})(source()),{code:'contact_multiple_matches'});
});
test('one-sided match, split contacts, shared identifiers and wrong location stop',async()=>{
 const cases=[
  async q=>q.field==='email'?{contacts:[contacts[0]],total:1}:{contacts:[],total:0},
  async q=>({contacts:[{...contacts[0],id:q.field}],total:1}),
  async()=>({contacts:[{...contacts[0],phone:'+447700900999'}],total:1}),
  async()=>({contacts:[{...contacts[0],email:'other@example.test'}],total:1}),
  async()=>({contacts:[{...contacts[0],locationId:'foreign'}],total:1}),
 ];
 for(const search of cases)await assert.rejects(createContactMatcher({config,search,enabled:true})(source()),{code:'contact_identity_conflict'});
});
test('malformed, incomplete and failed lookups never become no-match results',async()=>{
 for(const result of [{contacts:[]},{contacts:[],total:1},{contacts:[contacts[0]],total:0},{contacts:[],total:'0'},null])
  await assert.rejects(createContactMatcher({config,enabled:true,search:async()=>result})(source()),{code:'contact_lookup_failed'});
 await assert.rejects(createContactMatcher({config,enabled:true,search:async()=>{throw Error('secret provider body');}})(source()),{code:'contact_lookup_failed'});
});
test('fresh matching detects a contact changed after an earlier job',async()=>{
 let changed=false;const match=createContactMatcher({config,enabled:true,search:async q=>{
  const r=await lookup(q);return changed?{total:1,contacts:[{...contacts[0],phone:'+447700900999'}]}:r;
 }});
 await match(source());changed=true;await assert.rejects(match(source()),{code:'contact_identity_conflict'});
});
test('search transport is separately gated and fixed to read-only exact searches',async()=>{
 const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({total:1,contacts:[{...contacts[0],address:'PRIVATE'}]})};};
 const q={locationId:config.locationId,field:'email',value:person.email};
 await assert.rejects(createContactSearch({apiKey:'fake',locationId:config.locationId,fetchImpl})(q));assert.equal(calls.length,0);
 const search=createContactSearch({apiKey:'fake',locationId:config.locationId,enabled:true,fetchImpl});
 for(const bad of [{...q,locationId:'other'},{...q,field:'name'},{...q,value:'bad\nemail'}])await assert.rejects(search(bad));
 assert.equal(calls.length,0);const result=await search(q);
 assert.equal(calls[0].url,'https://services.leadconnectorhq.com/contacts/search');
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Version,'2021-07-28');
 assert.deepEqual(JSON.parse(calls[0].options.body),{locationId:config.locationId,page:1,pageLimit:2,filters:[{field:'email',operator:'eq',value:person.email}]});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|address|dnd/);
});
test('search HTTP errors and timeouts are sanitized read failures',async()=>{
 for(const fetchImpl of [async()=>({ok:false}),async()=>{throw Error('credential leaked by provider');},async()=>({ok:true,json:async()=>({contacts:[]})})]){
  const search=createContactSearch({apiKey:'fake',locationId:config.locationId,enabled:true,fetchImpl});
  await assert.rejects(search({locationId:config.locationId,field:'phone',value:'+447700900123'}),{code:'contact_lookup_failed'});
 }
});
