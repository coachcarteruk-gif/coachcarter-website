const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createDatabase, tagged, tokenVault } = require('./database.cjs');
const { processOne, crmHandler } = require('./database-worker.cjs');
const { identity, digest } = require('./highlevel-sync.cjs');
const { invitationHandler, resendTransport } = require('./invitation.cjs');
const { createContactMatcher } = require('./contact-matching.cjs');
const { createBoundedWorker } = require('./bounded-worker.cjs');
const { runIntegration, runNextIntegration, resendPermission, requested } = require('./integration.cjs');
const { subjectHash, privacyReady, exportGiveaway, learnerErasureQueries } = require('../../api/_giveaway-privacy');
const nominate = () => ({ submission_key: crypto.randomUUID(), nominee_name: 'Alex', nominee_email: 'alex@example.test', nominee_phone: '07700900123',
  nominator_name: 'Jamie', nominator_email: 'jamie@example.test', nominator_phone: '07700900456', reason: 'Private nomination reason', relationship: 'Friend', permission: true });
const apply = () => ({ name: 'Alex', meaning: 'Private application reason', barriers: 'Lesson costs are a barrier; free lessons would make learning possible.', hours: '0', test_booked: 'no', practice_car: 'no', address: '1 Fictional Road',
  postcode: 'SW1A 1AA', employment: 'prefer-not-to-say', contact_confirmed: true, marketing_email: true });
async function setup(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE schools(id INTEGER PRIMARY KEY); INSERT INTO schools VALUES (1),(2);');
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../../db/migrations/077_giveaway_storage.sql'), 'utf8'));
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../../db/migrations/078_giveaway_privacy.sql'), 'utf8'));
  await pg.exec("INSERT INTO giveaway_campaigns(school_id,campaign_key,closes_at,retain_until,enabled) VALUES (1,'test',now()+interval '1 day',now()+interval '91 days',true),(2,'test',now()+interval '1 day',now()+interval '91 days',true)");
  const transaction = callback => pg.transaction(client => callback(tagged(client)));
  const vault = tokenVault(crypto.randomBytes(32));
  const db = createDatabase({ transaction, vault });
  async function seeded() {
    await db.nominate(1, 'test', nominate());
    const { rows: [row] } = await pg.query('SELECT * FROM giveaway_nominations');
    const { rows: [job] } = await pg.query("SELECT * FROM giveaway_jobs WHERE kind='invitation'");
    return { row, token: vault.open(job.payload.sealed_token, `1:${row.id}`) };
  }
  return { pg, transaction, vault, db, seeded };
}

function bounded(f, id, overrides={}) {
  const config={schoolId:1,campaignKey:'test',nominationId:id,enabled:true,
    invitation:{enabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test',testOnly:true,testRecipient:'alex@example.test'},
    crm:{enabled:true,environment:'rehearsal',locationId:'fake-location',reviewUrl:'https://example.test/review',
      associations:{nominee:{id:'fake-nominee',first:'nomination'},nominator:{id:'fake-nominator',first:'contact'}}}};
  return createBoundedWorker({db:f.db,vault:f.vault,config,invitationRequested:async()=>true,
    providerAllowsInvitation:async()=>true,...overrides});
}

test('SQL nomination cutoff rejects new entries while existing nominees can still apply',async t=>{
 const f=await setup(t);const {row,token}=await f.seeded();
 const cutoff=new Date(Date.now()-1000).toISOString();
 await assert.rejects(f.db.nominate(1,'test',{...nominate(),nominee_email:'new@example.test'},{nominationDeadline:cutoff}),{status:410});
 assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM giveaway_nominations')).rows[0].count,1);
 assert.equal((await f.db.inspect(1,token)).completed,false);
 await f.db.apply(1,token,apply());assert.equal((await f.db.inspect(1,token)).completed,true);
 await f.pg.exec("UPDATE giveaway_campaigns SET closes_at=now()-interval '1 second' WHERE school_id=1");
 assert.equal((await f.db.inspect(1,token)).completed,true);
 await assert.rejects(f.db.nominate(1,'test',nominate(),{nominationDeadline:new Date(Date.now()+86400000).toISOString()}),{status:410});
});

test('automatic nomination invitation commits before sending and sends exactly once without a manual request',async t=>{
  const f=await setup(t),body=nominate();let callbacks=0,sends=0;
  const afterCreated=async nominationId=>{
    callbacks++;
    const config={enabled:true,schoolId:1,campaignKey:'test',nominationId,
      invitation:{enabled:true,permissionMode:'nomination',origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test',testOnly:true,testRecipient:'alex@example.test'},crm:{enabled:false}};
    const providers={providerAllowsInvitation:async()=>true,invitationTransport:{send:async message=>{sends++;assert.deepEqual(message.to,['alex@example.test']);assert.match(message.text,/giveaway\/apply.html#/);return {accepted:true,id:'fake-auto-email'};}}};
    const result=await runIntegration({...f,sql:tagged(f.pg),config,providers});
    assert.equal(result.invitation.status,'succeeded');
    await runIntegration({...f,sql:tagged(f.pg),config,providers});
  };
  assert.deepEqual(await f.db.nominate(1,'test',body,{afterCreated}),{ok:true});
  await f.db.nominate(1,'test',body,{afterCreated});
  await f.db.nominate(1,'test',{...body,submission_key:crypto.randomUUID()},{afterCreated});
  assert.equal(callbacks,1);assert.equal(sends,1);
  const row=(await f.pg.query('SELECT nomination FROM giveaway_nominations')).rows[0];
  assert.equal(row.nomination.permission.invitation_request,undefined);
  assert.equal(row.nomination.nominator_consents.every(c=>c.granted===false),true);
});

test('automatic invitation permission requires the recorded confirmation wording and time',()=>{
  const {nominationPermitsInvitation}=require('./integration.cjs'),{WORDING}=require('./domain.cjs');
  const permission={version:'giveaway-v1',wording:WORDING.permission,accepted_at:new Date().toISOString()};
  assert.equal(nominationPermitsInvitation({nomination:{permission}}),true);
  for(const change of [{version:'unknown'},{wording:'different'},{accepted_at:null},{accepted_at:'invalid'}])
    assert.equal(nominationPermitsInvitation({nomination:{permission:{...permission,...change}}}),false);
});

test('nominator confirmation has its own recipient, receipt and idempotency key, sharing the same private link',async t=>{
  const f=await setup(t),body=nominate(),messages=[],keys=[];
  await f.db.nominate(1,'test',body,{confirmNominator:true});
  const row=(await f.pg.query('SELECT * FROM giveaway_nominations')).rows[0];
  const config={enabled:true,schoolId:1,campaignKey:'test',nominationId:row.id,
    invitation:{enabled:true,permissionMode:'nomination',confirmationEnabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},crm:{enabled:false}};
  const providers={providerAllowsInvitation:async()=>true,invitationTransport:{send:async(message,key)=>{messages.push(message);keys.push(key);return {accepted:true,id:'receipt-'+messages.length};}}};
  const result=await runIntegration({...f,sql:tagged(f.pg),config,providers});
  assert.equal(result.invitation.status,'succeeded');assert.equal(result.confirmation.status,'succeeded');
  assert.deepEqual(messages.map(m=>m.to[0]),['alex@example.test','jamie@example.test']);
  assert.notEqual(keys[0],keys[1]);
  assert.equal(messages[0].text.match(/https:\/\/example.test\/giveaway\/apply.html#[\w-]+/)[0],messages[1].text.match(/https:\/\/example.test\/giveaway\/apply.html#[\w-]+/)[0]);
  assert.match(messages[1].text,/Your nomination for Alex has been submitted/);
  assert.match(messages[1].text,/We have also emailed your nominee/);
  assert.doesNotMatch(messages[1].text,/Private nomination reason/);
  await f.db.nominate(1,'test',body,{confirmNominator:true});
  await runIntegration({...f,sql:tagged(f.pg),config,providers});assert.equal(messages.length,2);
  const jobs=(await f.pg.query("SELECT event_key,state,payload FROM giveaway_jobs WHERE kind='invitation' ORDER BY event_key")).rows;
  assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.state==='succeeded' && !j.payload.sealed_token));
});

test('suppressed nominator confirmation cannot prevent the nominee invitation',async t=>{
  const f=await setup(t),body=nominate();await f.db.nominate(1,'test',body,{confirmNominator:true});
  const row=(await f.pg.query('SELECT * FROM giveaway_nominations')).rows[0];let sends=0;
  const config={enabled:true,schoolId:1,campaignKey:'test',nominationId:row.id,
    invitation:{enabled:true,permissionMode:'nomination',confirmationEnabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},crm:{enabled:false}};
  const result=await runIntegration({...f,sql:tagged(f.pg),config,providers:{providerAllowsInvitation:async source=>source.event_key!=='nominator-confirmation',invitationTransport:{send:async()=>{sends++;return {accepted:true,id:'nominee-only'};}}}});
  assert.equal(result.invitation.status,'succeeded');assert.equal(result.confirmation.status,'deferred');assert.equal(sends,1);
});

test('composed SQL integration sends once, provisions suppressed contacts, syncs application and preserves withdrawal',async t=>{
  const f=await setup(t),{row,token}=await f.seeded();
  const contacts=[],records=new Map(),writes=[];let sends=0;
  const config={enabled:true,schoolId:1,campaignKey:'test',nominationId:row.id,
    invitation:{enabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test',testOnly:true,testRecipient:'alex@example.test'},
    crm:{enabled:true,environment:'rehearsal',locationId:'fake-location',reviewUrl:'https://example.test/review',associations:{nominee:{id:'fake-nominee',first:'contact'},nominator:{id:'fake-nominator',first:'contact'}}},
    provisioning:{enabled:true,creationApproved:true,reviewReference:'fictional-review'}};
  const providers={providerAllowsInvitation:async()=>true,invitationTransport:{send:async()=>{sends++;return {accepted:true,id:'fake-email'};}},
    search:async({field,value})=>{const found=contacts.filter(c=>c[field]===value);return {contacts:found,total:found.length};},
    crmTransport:{async request(method,path,body){
      if(method!=='GET')writes.push({method,path,body});
      if(method==='POST'&&path==='/contacts/'){const contact={...body,id:'contact-'+contacts.length};contacts.push(contact);return {contact};}
      if(method==='GET'&&path.startsWith('/contacts/'))return {contact:contacts.find(c=>c.id===path.split('/')[2])};
      if(method==='POST'&&path.endsWith('/records')){const record={...body,id:'record-1'};records.set(record.id,record);return {record};}
      if(path.includes('/records/')){const record=records.get(path.split('/records/')[1].split('?')[0]);if(method==='PUT')record.properties=body.properties;return {record};}
      if(method==='POST'&&path==='/associations/relations')return {id:'relation-'+writes.length};
      throw Error('Unexpected provider operation');
    }}};
  const run=()=>runIntegration({...f,sql:tagged(f.pg),config,providers});
  assert.equal((await runIntegration({...f,sql:tagged(f.pg),config:{...config,enabled:false},providers})).status,'disabled');
  assert.equal((await runIntegration({...f,sql:tagged(f.pg),config:{...config,schoolId:2},providers})).status,'unavailable');
  assert.equal(await f.db.recordInvitationRequest(2,'test',row.id,'request-case'),false);
  assert.equal(await f.db.recordInvitationRequest(1,'test',row.id,'request-case'),true);
  const first=await run();assert.equal(first.invitation.status,'succeeded');assert.equal(first.crm.status,'succeeded');
  assert.equal(sends,1);assert.equal(contacts.length,2);assert.ok(contacts.every(c=>c.dnd===true));
  await f.db.apply(1,token,apply());
  for(let i=0;i<3;i++)await run();
  assert.equal(sends,1);assert.equal(contacts.length,2);assert.equal(records.size,1);
  assert.equal(records.get('record-1').properties.application_status,'submitted');
  await f.db.withdraw(1,token);assert.equal(await f.db.invitationUnblocked(1,row.id),false);await run();
  assert.ok(contacts.every(c=>c.dnd===true));assert.doesNotMatch(JSON.stringify(writes),/Private application reason|Private nomination reason|sealed_token|tags/);
});

test('composed provider ambiguity stops before any CRM lookup or mutation',async t=>{
  const f=await setup(t),{row}=await f.seeded();await f.db.recordInvitationRequest(1,'test',row.id,'case-123');let sends=0,lookups=0;
  const config={enabled:true,schoolId:1,campaignKey:'test',nominationId:row.id,invitation:{enabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},crm:{enabled:true}};
  const result=await runIntegration({...f,sql:tagged(f.pg),config,providers:{providerAllowsInvitation:async()=>true,invitationTransport:{send:async()=>{sends++;throw Error('timeout');}},search:async()=>{lookups++;},crmTransport:{}}});
  assert.equal(result.status,'review_required');assert.equal(sends,1);assert.equal(lookups,0);
  const held=await runIntegration({...f,sql:tagged(f.pg),config});assert.equal(held.status,'review_required');assert.equal(sends,1);
});

test('queue tick skips unrequested email and selects only the configured school and campaign',async t=>{
 const f=await setup(t),{row}=await f.seeded();await f.db.nominate(2,'test',nominate());
 const config={enabled:true,schoolId:1,campaignKey:'test',invitation:{enabled:true,origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'}};
 let sends=0;const options={...f,sql:tagged(f.pg),config,providers:{providerAllowsInvitation:async()=>true,invitationTransport:{send:async()=>{sends++;return {accepted:true,id:'tick-email'};}}}};
 assert.equal((await runNextIntegration(options)).status,'idle');
 await f.db.recordInvitationRequest(1,'test',row.id,'case-queue');
 assert.equal((await runNextIntegration(options)).invitation.status,'succeeded');assert.equal(sends,1);
 assert.equal((await runNextIntegration(options)).status,'idle');
 assert.ok((await f.pg.query('SELECT state FROM giveaway_jobs WHERE school_id=2')).rows.every(j=>j.state==='pending'));
});

test('Resend permission rejects suppression, opt-out, malformed and failed lookup; evidence is identity-bound',async()=>{
  const source={school_id:1,campaign_key:'test',id:crypto.randomUUID(),nomination:{nominee:{email:'alex@example.test'},permission:{accepted_at:new Date().toISOString()}}};
  assert.equal(requested(source),false);
  for(const responses of [
    [{status:200,body:{email:'alex@example.test'}}],
    [{status:404,body:{name:'not_found',message:'wrong resource'}}],
    [{status:403,body:{}}],
    [{status:404,body:{name:'not_found',message:'Suppression not found'}},{status:200,body:{email:'alex@example.test',unsubscribed:true}}]
  ]){
    let i=0;const check=resendPermission({apiKey:'fake',fetchImpl:async()=>{const r=responses[i++];return {status:r.status,json:async()=>r.body};}});
    assert.equal(await check(source),false);
  }
  let n=0;assert.equal(await resendPermission({apiKey:'fake',fetchImpl:async()=>({status:404,json:async()=>({name:'not_found',message:++n===1?'Suppression not found':'Contact not found'})})})(source),true);
  assert.equal(await resendPermission({apiKey:'fake',fetchImpl:async()=>{throw Error('timeout');}})(source),false);
});

test('bounded runner requires both activation gates and never claims another tenant/campaign/nomination',async t=>{
  const f=await setup(t),{row}=await f.seeded();
  await f.db.nominate(2,'test',nominate());
  await f.db.nominate(1,'test',{...nominate(),nominee_email:'other@example.test',nominee_phone:'07700900789'});
  let calls=0;
  const transport={send:async()=>{calls++;return {accepted:true,id:'bounded'};}};
  const base={schoolId:1,campaignKey:'test',nominationId:row.id};
  for (const config of [base,{...base,enabled:true,invitation:{enabled:false}}])
    assert.equal((await bounded(f,row.id,{config}).run('invitation')).status,'disabled');
  for (const config of [{...base,schoolId:2},{...base,campaignKey:'other'},{...base,nominationId:crypto.randomUUID()}])
    assert.equal(await f.db.claim(config.schoolId,'invitation',config),null);
  assert.equal((await bounded(f,row.id,{invitationTransport:transport}).run('invitation')).status,'succeeded');
  assert.equal((await bounded(f,row.id,{invitationTransport:transport}).run('invitation')).status,'idle');
  assert.equal(calls,1);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM giveaway_jobs WHERE kind='invitation' AND state='pending'")).rows[0].n,2);
});

test('bounded invitation denies missing request evidence, provider opt-out and persistent suppression before dispatch',async t=>{
  const f=await setup(t),{row}=await f.seeded();let sends=0;
  const invitationTransport={send:async()=>{sends++;return {accepted:true,id:'unexpected'};}};
  for (const override of [{invitationRequested:undefined},{invitationRequested:async()=>false},
    {providerAllowsInvitation:async()=>false},{providerAllowsInvitation:async()=>{throw Error('unavailable');}}]) {
    assert.equal((await bounded(f,row.id,{invitationTransport,...override}).run('invitation')).status,'deferred');
    await f.pg.exec("UPDATE giveaway_jobs SET available_at=now() WHERE state='pending'");
  }
  await f.pg.query("INSERT INTO giveaway_marketing_suppressions(school_id,channel,subject_hash) VALUES (1,'email',$1)",[subjectHash('email','alex@example.test')]);
  assert.equal((await bounded(f,row.id,{invitationTransport}).run('invitation')).status,'deferred');
  assert.equal(sends,0);
  assert.equal((await f.pg.query("SELECT state FROM giveaway_jobs WHERE kind='invitation'")).rows[0].state,'pending');
});

test('bounded invitation rechecks permission at dispatch and never retries ambiguous acceptance',async t=>{
  const f=await setup(t),{row}=await f.seeded();let checks=0,sends=0;
  assert.equal((await bounded(f,row.id,{providerAllowsInvitation:async()=>++checks===1,
    invitationTransport:{send:async()=>{sends++;}}}).run('invitation')).status,'uncertain');
  assert.equal(checks,2);assert.equal(sends,0);
  assert.equal((await bounded(f,row.id).run('invitation')).status,'idle');
  // A different nomination exercises a provider timeout after a possible send.
  await f.db.nominate(1,'test',{...nominate(),nominator_email:'second@example.test',nominator_phone:'07700900789'});
  const other=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[row.id])).rows[0].id;
  const worker=bounded(f,other,{invitationTransport:{send:async()=>{sends++;throw Error('timeout');}}});
  assert.equal((await worker.run('invitation')).status,'uncertain');
  assert.equal((await worker.run('invitation')).status,'idle');assert.equal(sends,1);
});

test('bounded CRM uses exact existing contacts, persists receipts and does not duplicate records',async t=>{
  const f=await setup(t),{row}=await f.seeded();
  const contacts=Object.values(row.nomination).filter(x=>x?.email).map((person,i)=>({...identity(person),id:'contact-'+i,locationId:'fake-location'}));
  const calls=[],records=new Map();
  const crmTransport={async request(method,path,body){
    calls.push({method,path,body});
    if(method==='GET' && path.startsWith('/contacts/'))return {contact:contacts.find(c=>c.id===path.split('/')[2])};
    if(method==='POST' && path.endsWith('/records')){const record={...body,id:'record-1'};records.set(record.id,record);return {record};}
    if(method==='GET' && path.includes('/records/'))return {record:records.get(path.split('/records/')[1].split('?')[0])};
    if(method==='POST' && path==='/associations/relations')return {id:'relation-'+calls.length};
    throw Error('Unexpected mutation');
  }};
  const search=async({field,value})=>{const found=contacts.filter(c=>c[field]===value);return {contacts:found,total:found.length};};
  const worker=bounded(f,row.id,{search,crmTransport});
  assert.equal((await worker.run('crm')).status,'succeeded');
  assert.equal((await worker.run('crm')).status,'idle');
  assert.equal(calls.filter(c=>c.method==='POST').length,3);
  assert.doesNotMatch(JSON.stringify(calls),/Private nomination reason|sealed_token|customFields|tags/);
});

test('bounded CRM defers absent contacts without creating or dispatching them',async t=>{
  const f=await setup(t),{row}=await f.seeded();let writes=0;
  const result=await bounded(f,row.id,{search:async()=>({contacts:[],total:0}),crmTransport:{request:async()=>{writes++;}}}).run('crm');
  assert.equal(result.status,'deferred');assert.equal(result.reason,'contact_not_found');assert.equal(writes,0);
});

test('bounded recovery quarantines only the selected expired dispatch',async t=>{
  const f=await setup(t),{row}=await f.seeded();
  await f.db.nominate(2,'test',nominate());
  await f.db.nominate(1,'test',{...nominate(),nominee_email:'other@example.test',nominee_phone:'07700900789'});
  await f.pg.exec("UPDATE giveaway_jobs SET state='dispatching',lease_until=now()-interval '1 minute'");
  assert.equal(await f.db.claim(1,'invitation',{campaignKey:'test',nominationId:row.id}),null);
  const jobs=(await f.pg.query('SELECT school_id,nomination_id,kind,state FROM giveaway_jobs')).rows;
  assert.equal(jobs.filter(j=>j.state==='uncertain').length,1);
  assert.ok(jobs.every(j=>j.state===(j.school_id===1 && j.nomination_id===row.id && j.kind==='invitation'?'uncertain':'dispatching')));
});

test('invitation outbox captures correct private link, retains receipt and never replays', async t => {
  const f=await setup(t), {token}=await f.seeded();let calls=0,message;
  const handler=invitationHandler({config:{schoolId:1,campaignKey:'test',origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},vault:f.vault,maySend:async()=>true,
    transport:resendTransport({apiKey:'fictional',enabled:true,fetchImpl:async(url,options)=>{
      calls++;assert.equal(url,'https://api.resend.com/emails');assert.match(options.headers['Idempotency-Key'],/^giveaway-[a-f0-9]{64}$/);
      message=JSON.parse(options.body);return {ok:true,json:async()=>({id:'provider-test-1'})};
    }})});
  const args={db:f.db,schoolId:1,kind:'invitation',enabled:true,handler};
  assert.equal((await processOne(args)).status,'succeeded');assert.equal((await processOne(args)).status,'idle');assert.equal(calls,1);
  assert.deepEqual(message.to,['alex@example.test']);assert.ok(message.text.includes('/giveaway/apply.html#'+token));
  assert.ok(message.text.includes('https://example.test/giveaway/privacy.html'));
  assert.ok(message.html.includes('href="https://example.test/giveaway/privacy.html"'));
  assert.ok(!message.text.includes('Private nomination reason'));assert.ok(!message.text.includes('jamie@example.test'));
  const receipt=(await f.pg.query("SELECT payload FROM giveaway_jobs WHERE kind='invitation'")).rows[0].payload;
  assert.deepEqual(receipt,{provider:'resend',id:'provider-test-1'});
  assert.equal((await f.db.inspect(1,token)).completed,false);
  await f.db.apply(1,token,apply());assert.equal((await f.db.inspect(1,token)).completed,true);
});

test('invitation provider ambiguity blocks replay and retains encrypted token', async t=>{
  const f=await setup(t);await f.seeded();let calls=0;
  const handler=invitationHandler({config:{schoolId:1,campaignKey:'test',origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},vault:f.vault,maySend:async()=>true,
    transport:resendTransport({apiKey:'fake',enabled:true,fetchImpl:async()=>{calls++;throw Error('timeout');}})});
  const args={db:f.db,schoolId:1,kind:'invitation',enabled:true,handler};
  assert.equal((await processOne(args)).status,'uncertain');assert.equal((await processOne(args)).status,'idle');assert.equal(calls,1);
  assert.ok((await f.pg.query("SELECT payload FROM giveaway_jobs WHERE kind='invitation'")).rows[0].payload.sealed_token);
});

test('invitation validation blocks wrong tenant, closed campaign, completed application and suppression', async t=>{
 const f=await setup(t);await f.seeded();const job=await f.db.claim(1,'invitation');await f.db.beginDispatch(1,job.id,job.claim_token);
 const source=await f.db.loadDispatch(1,job.id,job.claim_token);let calls=0;
 const options={config:{schoolId:1,campaignKey:'test',origin:'https://example.test',from:'hello@example.test',replyTo:'hello@example.test'},vault:f.vault,maySend:async()=>true,transport:{send:async()=>{calls++;return {accepted:true,id:'fake'};}}};
 for(const override of [{school_id:2},{campaign_enabled:false},{closes_at:'2000-01-01'},{application:{}},{erasure_requested_at:new Date()}]) await assert.rejects(invitationHandler(options)({...source,...override}));
 await assert.rejects(invitationHandler({...options,maySend:async()=>false})(source));
 await assert.rejects(invitationHandler({...options,config:{...options.config,testOnly:true,testRecipient:'someone@example.test'}})(source));
 assert.equal(calls,0);
 await assert.rejects(resendTransport({apiKey:'fake',fetchImpl:()=>{calls++;}}).send({},'key'));assert.equal(calls,0);
});
test('atomic intake and duplicate keys/pairs persist exactly one nomination and two jobs', async t => {
  const f = await setup(t), body = nominate();
  await f.db.nominate(1, 'test', body); await f.db.nominate(1, 'test', body); await f.db.nominate(1, 'test', nominate());
  assert.equal((await f.pg.query('SELECT * FROM giveaway_nominations')).rows.length, 1);
  assert.equal((await f.pg.query('SELECT * FROM giveaway_jobs')).rows.length, 2);
  const failing = createDatabase({ transaction: f.transaction, vault: { seal() { throw Error('key unavailable'); } } });
  await assert.rejects(failing.nominate(2, 'test', nominate()));
  assert.equal((await f.pg.query('SELECT * FROM giveaway_nominations WHERE school_id=2')).rows.length, 0);
});

test('withdrawal survives other nominations, new consent and final erasure without affecting another school',async t=>{
 const f=await setup(t),first=await f.seeded();await f.db.apply(1,first.token,apply());
 assert.equal(await f.db.mayMarket(1,first.row.id,'email'),true);
 await f.db.withdraw(1,first.token);await f.db.withdraw(1,first.token);
 assert.equal(await f.db.mayMarket(1,first.row.id,'email'),false);
 assert.equal((await f.pg.query('SELECT * FROM giveaway_marketing_suppressions')).rows.length,2);
 await f.db.nominate(1,'test',{...nominate(),nominator_email:'other@example.test'});
 const second=(await f.pg.query('SELECT * FROM giveaway_nominations WHERE id<>$1',[first.row.id])).rows[0];
 const pending=(await f.pg.query("SELECT payload FROM giveaway_jobs WHERE nomination_id=$1 AND kind='invitation'",[second.id])).rows[0];
 const token=f.vault.open(pending.payload.sealed_token,`1:${second.id}`);await f.db.apply(1,token,apply());
 assert.equal(await f.db.mayMarket(1,second.id,'email'),false);
 await f.db.nominate(2,'test',nominate());const other=(await f.pg.query('SELECT * FROM giveaway_nominations WHERE school_id=2')).rows[0];
 const otherJob=(await f.pg.query("SELECT payload FROM giveaway_jobs WHERE school_id=2 AND kind='invitation'")).rows[0];
 await f.db.apply(2,f.vault.open(otherJob.payload.sealed_token,`2:${other.id}`),apply());
 assert.equal(await f.db.mayMarket(2,other.id,'email'),true);
 await f.db.requestErasure(1,first.row.id);await f.db.eraseAfterProviderCleanup(1,first.row.id,true);
 assert.equal(await f.db.mayMarket(1,second.id,'email'),false);
 assert.equal(subjectHash('sms','+44 7700 900123'),subjectHash('sms','07700900123'));
});

test('shared export and atomic learner deletion staging scope identities and preserve remote evidence',async t=>{
 const f=await setup(t),first=await f.seeded();await f.db.apply(1,first.token,apply());
 await f.db.nominate(2,'test',nominate());
 await f.pg.exec("CREATE TABLE learner_users(id INTEGER PRIMARY KEY,school_id INTEGER,email TEXT); INSERT INTO learner_users VALUES(9,1,'ALEX@example.test')");
 const sql=tagged(f.pg);assert.equal(await privacyReady(sql),true);
 const exported=await exportGiveaway(sql,1,'alex@example.test');assert.equal(exported.length,1);
 assert.ok(!JSON.stringify(exported).includes('Private nomination reason'));assert.ok(!JSON.stringify(exported).includes(first.token));
 await f.pg.query('UPDATE giveaway_nominations SET crm_state=$1::jsonb WHERE school_id=1',[JSON.stringify({record_id:'provider-evidence'})]);
 // Build lazy tagged query promises, as used by the Neon HTTP transaction API.
 const statements=[];const lazy=(parts,...values)=>{const q={text:parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values};statements.push(q);return q;};
 learnerErasureQueries(lazy,9);
 await f.pg.transaction(async tx=>{for(const q of statements)await tx.query(q.text,q.values);await tx.query('DELETE FROM learner_users WHERE id=9');});
 const rows=(await f.pg.query('SELECT * FROM giveaway_nominations ORDER BY school_id')).rows;
 assert.ok(rows[0].erasure_requested_at);assert.equal(rows[0].crm_state.record_id,'provider-evidence');assert.equal(rows[1].erasure_requested_at,null);
 assert.equal((await f.pg.query("SELECT * FROM giveaway_jobs WHERE school_id=1 AND state<>'cancelled'")).rows.length,0);
 assert.equal((await f.pg.query('SELECT * FROM giveaway_marketing_suppressions WHERE school_id=1')).rows.length,2);
 await assert.rejects(f.db.inspect(1,first.token));
});

test('privacy compatibility supports absent schema but rejects partial rollout',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());const sql=tagged(pg);
 assert.equal(await privacyReady(sql),false);assert.deepEqual(await exportGiveaway(sql,1,'a@example.test'),[]);
 await pg.exec('CREATE TABLE giveaway_nominations(id INTEGER)');await assert.rejects(privacyReady(sql),/migration required/);
});

test('shared deletion helper includes giveaway staging before learner deletion and rolls it back on failure',async t=>{
 const f=await setup(t),first=await f.seeded();
 await f.pg.exec("CREATE TABLE learner_users(id INTEGER PRIMARY KEY,school_id INTEGER,email TEXT); INSERT INTO learner_users VALUES(9,1,'alex@example.test')");
 let captured=[];
 const sql=(parts,...values)=>{
   const query=parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');
   const rows=query.includes('AS ready')?[{present:true,ready:true}]:[{}];
   const promise=Promise.resolve(rows);promise.query=query;promise.values=values;return promise;
 };
 sql.transaction=async queries=>{captured=queries;await f.pg.transaction(async tx=>{
   for(const q of queries.filter(q=>q.query.includes('giveaway_')))await tx.query(q.query,q.values);
   throw Error('Simulated later deletion failure');
 });};
 await assert.rejects(require('../../api/_gdpr').deleteLearnerCascade(sql,9,{email:'alex@example.test'}),/later deletion failure/);
 assert.ok(captured.some(q=>q.query.includes('giveaway_marketing_suppressions')));
 assert.match(captured.at(-1).query,/DELETE FROM learner_users/);
 assert.equal((await f.pg.query('SELECT erasure_requested_at FROM giveaway_nominations WHERE id=$1',[first.row.id])).rows[0].erasure_requested_at,null);
 assert.equal((await f.pg.query('SELECT * FROM giveaway_marketing_suppressions')).rows.length,0);
});
test('token encryption binds school and nomination, storage never contains plaintext invitation', async t => {
  const f = await setup(t), { row, token } = await f.seeded();
  const { rows: [job] } = await f.pg.query("SELECT * FROM giveaway_jobs WHERE kind='invitation'");
  assert.throws(() => f.vault.open(job.payload.sealed_token, `2:${row.id}`));
  assert.doesNotMatch(JSON.stringify(row), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(job), new RegExp(token));
  await assert.rejects(f.db.inspect(2, token), { status: 404 });
  const inspect = await f.db.inspect(1, token); assert.equal(inspect.nominator_name, 'Jamie'); assert.equal(inspect.reason, undefined);
});
test('application, channel evidence and CRM event commit together; repeated applications are immutable', async t => {
  const f = await setup(t), { token } = await f.seeded();
  await f.db.apply(1, token, apply()); await f.db.apply(1, token, { ...apply(), name: 'Overwrite' });
  const { rows: [row] } = await f.pg.query('SELECT * FROM giveaway_nominations');
  assert.equal(row.application.name, 'Alex');
  assert.equal((await f.pg.query('SELECT * FROM giveaway_consents')).rows.length, 2);
  assert.equal((await f.pg.query("SELECT * FROM giveaway_jobs WHERE event_key='application'")).rows.length, 1);
  await f.db.withdraw(1, token); await f.db.withdraw(1, token);
  assert.ok((await f.pg.query("SELECT * FROM giveaway_consents WHERE channel='email'")).rows[0].withdrawn_at);
  assert.equal((await f.pg.query("SELECT * FROM giveaway_jobs WHERE kind='suppression'")).rows.length, 1);
});
test('a queue insert failure rolls back application and consent evidence', async t => {
  const f = await setup(t), { token } = await f.seeded();
  await f.pg.exec("CREATE FUNCTION fail_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_key='application' THEN RAISE EXCEPTION 'test fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fault BEFORE INSERT ON giveaway_jobs FOR EACH ROW EXECUTE FUNCTION fail_job()");
  await assert.rejects(f.db.apply(1, token, apply()));
  assert.equal((await f.pg.query('SELECT application FROM giveaway_nominations')).rows[0].application, null);
  assert.equal((await f.pg.query('SELECT * FROM giveaway_consents')).rows.length, 0);
});
test('database deadline and campaign gate block new work while completed confirmation and withdrawal remain accessible', async t => {
  const f = await setup(t), { token } = await f.seeded(); await f.db.apply(1, token, apply());
  await f.pg.exec("UPDATE giveaway_campaigns SET enabled=false,closes_at=now()-interval '1 second'");
  await assert.rejects(f.db.nominate(1, 'test', nominate()), { status: 410 });
  assert.equal((await f.db.inspect(1, token)).completed, true); await f.db.withdraw(1, token);
});
test('claim fencing, tenant isolation and dispatch receipts reject stale workers', async t => {
  const f = await setup(t); await f.seeded(); const job = await f.db.claim(1, 'invitation');
  assert.ok(job); assert.equal(await f.db.claim(1, 'invitation'), null);
  assert.equal(await f.db.beginDispatch(2, job.id, job.claim_token), false);
  assert.equal(await f.db.beginDispatch(1, job.id, crypto.randomUUID()), false);
  assert.equal(await f.db.complete(1, job.id, job.claim_token, true), false);
  assert.equal(await f.db.beginDispatch(1, job.id, job.claim_token), true);
  assert.equal(await f.db.complete(1, job.id, job.claim_token, true), true);
  assert.deepEqual((await f.pg.query('SELECT payload FROM giveaway_jobs WHERE id=$1', [job.id])).rows[0].payload, {});
  assert.equal(await f.db.claim(1, 'invitation'), null);
});
test('expired pre-dispatch lease can be reclaimed but expired dispatch is uncertain and blocks newer CRM work', async t => {
  const f = await setup(t), { token } = await f.seeded(); const first = await f.db.claim(1, 'crm');
  await f.pg.query("UPDATE giveaway_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [first.id]);
  const next = await f.db.claim(1, 'crm'); assert.equal(next.id, first.id); assert.notEqual(next.claim_token, first.claim_token);
  assert.equal(await f.db.beginDispatch(1, first.id, first.claim_token), false);
  await f.db.beginDispatch(1, next.id, next.claim_token);
  await f.pg.query("UPDATE giveaway_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [next.id]);
  await f.db.apply(1, token, apply()); assert.equal(await f.db.claim(1, 'crm'), null);
  assert.equal((await f.pg.query('SELECT state FROM giveaway_jobs WHERE id=$1', [next.id])).rows[0].state, 'uncertain');
});
test('exports separate nominee and nominator data and never expose token or CRM state', async t => {
  const f = await setup(t), { token } = await f.seeded(); await f.db.apply(1, token, apply());
  const nominee = await f.db.exportForEmail(1, 'alex@example.test');
  assert.doesNotMatch(JSON.stringify(nominee), /Private nomination reason|jamie@example|sealed_token|token_hash|crm_state/);
  const nominator = await f.db.exportForEmail(1, 'jamie@example.test');
  assert.doesNotMatch(JSON.stringify(nominator), /Private application reason|Fictional Road|alex@example/);
  assert.deepEqual(await f.db.exportForEmail(2, 'alex@example.test'), []);
});
test('erasure stops access and dispatch; cleanup gate and cascades remove local records', async t => {
  const f = await setup(t), { row, token } = await f.seeded(); await f.db.apply(1, token, apply());
  assert.equal(await f.db.requestErasure(2, row.id), false);
  await f.db.requestErasure(1, row.id); await assert.rejects(f.db.inspect(1, token), { status: 404 });
  assert.equal(await f.db.claim(1, 'invitation'), null);
  await assert.rejects(f.db.eraseAfterProviderCleanup(1, row.id, false));
  assert.equal(await f.db.eraseAfterProviderCleanup(1, row.id, true), true);
  for (const table of ['giveaway_nominations','giveaway_jobs','giveaway_consents']) assert.equal((await f.pg.query('SELECT count(*) FROM ' + table)).rows[0].count, 0);
});
test('retention marks only due same-school campaigns, preserving provider cleanup evidence', async t => {
  const f = await setup(t), { row } = await f.seeded();
  await f.db.nominate(2, 'test', nominate());
  await f.pg.exec("UPDATE giveaway_campaigns SET closes_at=now()-interval '2 days',retain_until=now()-interval '1 day'");
  assert.deepEqual(await f.db.requestRetention(1), [row.id]);
  assert.equal((await f.pg.query('SELECT erasure_requested_at FROM giveaway_nominations WHERE school_id=2')).rows[0].erasure_requested_at, null);
});
test('composite foreign keys reject cross-school job associations', async t => {
  const f = await setup(t), { row } = await f.seeded();
  await assert.rejects(f.pg.query("INSERT INTO giveaway_jobs(school_id,id,nomination_id,kind,event_key) VALUES(2,$1,$2,'crm','invalid')", [crypto.randomUUID(),row.id]));
});
test('database-backed CRM worker persists operation receipts across application update and worker recreation', async t => {
  const f = await setup(t), { row, token } = await f.seeded();
  const config = { enabled: true, environment: 'rehearsal', schoolId: 1, locationId: 'fake-location', campaignKey: 'test', reviewUrl: 'https://example.test/review',
    deadline: '2000-01-01T00:00:00Z', associations: { nominee: { id: 'nominee-link', first: 'nomination' }, nominator: { id: 'nominator-link', first: 'nomination' } } };
  const contacts = Object.fromEntries(['nominee','nominator'].map(role => [role, { id: role, locationId: config.locationId, ...identity(row.nomination[role]), dnd: true }]));
  const plans = Object.fromEntries(['nominee','nominator'].map(role => [role, { kind: 'existing', id: role, schoolId: 1, locationId: config.locationId, identityHash: digest(identity(contacts[role])) }]));
  let record, writes=0;
  const transport = { async request(method, url, body) {
    if (url.startsWith('/contacts/')) return { contact: contacts[url.split('/')[2]] };
    if (method !== 'GET') writes++;
    if (url.endsWith('/records')) { record = { id: 'fake-record', ...body }; return { record }; }
    if (url.includes('/records/')) { if (method === 'PUT') record.properties = body.properties; return { record }; }
    return { id: 'fake-relation-' + writes };
  } };
  const run = () => processOne({ db: f.db, schoolId: 1, kind: 'crm', enabled: true, handler: crmHandler({ config, transport, plansFor: async () => plans }) });
  assert.equal((await run()).status, 'succeeded'); assert.equal(writes,3);
  assert.equal(record.properties.application_status,'awaiting_application'); // SQL campaign date overrides a stale fallback.
  await f.db.apply(1, token, apply()); assert.equal((await run()).status, 'succeeded'); assert.equal(writes,4);
  assert.equal(record.properties.application_status,'submitted'); assert.equal((await run()).status,'idle');
  const state = (await f.pg.query('SELECT crm_state FROM giveaway_nominations')).rows[0].crm_state;
  assert.equal(Object.keys(state.operations).length,4);
});
test('worker failure after possible provider acceptance remains uncertain and never automatically reruns', async t => {
  const f = await setup(t); await f.seeded(); let calls=0;
  const handler = async () => { calls++; throw Error('provider accepted but response lost'); };
  const args = { db:f.db,schoolId:1,kind:'invitation',enabled:true,handler };
  assert.equal((await processOne(args)).status,'uncertain'); assert.equal((await processOne(args)).status,'idle'); assert.equal(calls,1);
});
test('erasure cancels a claimed worker before dispatch', async t => {
  const f = await setup(t), { row } = await f.seeded(); const job = await f.db.claim(1,'crm');
  await f.db.requestErasure(1,row.id);
  assert.equal(await f.db.beginDispatch(1,job.id,job.claim_token),false);
  assert.equal(await f.db.eraseAfterProviderCleanup(1,row.id,true),true);
});

test('contact matching defers before dispatch, then resolves and syncs without contact creation',async t=>{
 const f=await setup(t),{row}=await f.seeded();
 const config={enabled:true,environment:'rehearsal',schoolId:1,locationId:'fake-location',campaignKey:'test',reviewUrl:'https://example.test/review',
  associations:{nominee:{id:'n-link',first:'contact'},nominator:{id:'r-link',first:'contact'}}};
 const contacts=Object.fromEntries(['nominee','nominator'].map(role=>[role,{id:role,locationId:config.locationId,...identity(row.nomination[role])}]));
 let found=false,writes=0;
 const plansFor=createContactMatcher({config,enabled:true,search:async({field,value})=>{
  const results=found?Object.values(contacts).filter(c=>c[field]===value):[];return {contacts:results,total:results.length};
 }});
 const transport={async request(method,path,body){
  if(method==='GET' && path.startsWith('/contacts/'))return {contact:contacts[path.split('/')[2]]};
  assert.notEqual(path,'/contacts/');writes++;
  if(path.endsWith('/records'))return {record:{id:'record-one',...body}};
  return {id:'relation-'+writes};
 }};
 const run=()=>processOne({db:f.db,schoolId:1,kind:'crm',enabled:true,handler:crmHandler({config,transport,plansFor})});
 const result=await run();assert.equal(result.status,'deferred');assert.equal(result.reason,'contact_not_found');assert.equal(writes,0);
 const job=(await f.pg.query('SELECT * FROM giveaway_jobs WHERE id=$1',[result.job_id])).rows[0];
 assert.equal(job.state,'pending');assert.equal(job.claim_token,null);assert.equal(job.lease_until,null);
 assert.ok(new Date(job.available_at)>new Date());assert.equal((await run()).status,'idle');
 found=true;await f.pg.query('UPDATE giveaway_jobs SET available_at=now() WHERE id=$1',[job.id]);
 assert.equal((await run()).status,'succeeded');assert.equal(writes,3);
});

test('claim preflight and deferral reject foreign, stale, dispatched and erased work',async t=>{
 const f=await setup(t),{row}=await f.seeded();const job=await f.db.claim(1,'crm');
 await assert.rejects(f.db.loadClaim(2,job.id,job.claim_token));
 await assert.rejects(f.db.loadClaim(1,job.id,crypto.randomUUID()));
 assert.equal(await f.db.deferClaim(2,job.id,job.claim_token),false);
 assert.equal(await f.db.deferClaim(1,job.id,crypto.randomUUID()),false);
 assert.equal((await f.db.loadClaim(1,job.id,job.claim_token)).id,row.id);
 await f.db.beginDispatch(1,job.id,job.claim_token);
 assert.equal(await f.db.deferClaim(1,job.id,job.claim_token),false);
 await f.db.complete(1,job.id,job.claim_token,false);
 assert.equal(await f.db.deferClaim(1,job.id,job.claim_token),false);
 const invitation=await f.db.claim(1,'invitation');
 await f.db.requestErasure(1,row.id);
 await assert.rejects(f.db.loadClaim(1,invitation.id,invitation.claim_token));
 assert.equal(await f.db.deferClaim(1,invitation.id,invitation.claim_token),false);
});

test('erasure during read-only matching prevents CRM dispatch',async t=>{
 const f=await setup(t),{row}=await f.seeded();let writes=0;
 const config={enabled:true,schoolId:1,campaignKey:'test'};
 const handler=crmHandler({config,transport:{request:async()=>{writes++;}},plansFor:async()=>{
  await f.db.requestErasure(1,row.id);return {nominee:{kind:'existing'},nominator:{kind:'existing'}};
 }});
 assert.equal((await processOne({db:f.db,schoolId:1,kind:'crm',enabled:true,handler})).status,'claim_lost');assert.equal(writes,0);
});

test('separate judging answers survive SQL storage and nominee export only',async t=>{
 const f=await setup(t),{row,token}=await f.seeded();
 await f.db.apply(1,token,{...apply(),meaning:'Work access',barriers:'Lesson costs'});
 const nominee=await f.db.exportForEmail(1,'alex@example.test');
 assert.equal(nominee[0].application.meaning,'Work access');assert.equal(nominee[0].application.barriers,'Lesson costs');
 assert.ok(!(await f.db.exportForEmail(1,'jamie@example.test'))[0].application);
 assert.deepEqual(await f.db.exportForEmail(2,'alex@example.test'),[]);
});

test('nominator consent is optional, role-scoped, exportable and withdrawal survives later nominations',async t=>{
 const f=await setup(t),body={...nominate(),nominator_marketing_email:true};
 await f.db.nominate(1,'test',body);await f.db.nominate(2,'test',body);
 let row=(await f.pg.query('SELECT * FROM giveaway_nominations WHERE school_id=1')).rows[0];
 assert.equal(row.nomination.nominator_consents[0].granted,true);assert.equal(row.nomination.nominator_consents[1].granted,false);
 assert.ok(row.nomination.nominator_consents[0].recorded_at);assert.match(row.nomination.nominator_consents[0].wording,/nominate someone/);
 assert.equal(await f.db.mayMarket(1,row.id,'email','nominator'),true);assert.equal(await f.db.mayMarket(1,row.id,'email'),false);
 const other=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE school_id=2')).rows[0];
 await f.db.nominate(1,'test',{...body,nominator_marketing_email:false});
 assert.equal(await f.db.mayMarket(1,row.id,'email','nominator'),true);
 const nominee=await f.db.exportForEmail(1,body.nominee_email);assert.equal(nominee[0].consents.length,0);assert.doesNotMatch(JSON.stringify(nominee),/giveaway-nominator-v1/);
 await f.db.withdrawForEmail(1,body.nominator_email);await f.db.withdrawForEmail(1,body.nominator_email);
 assert.equal(await f.db.mayMarket(1,row.id,'email','nominator'),false);assert.equal(await f.db.mayMarket(2,other.id,'email','nominator'),true);
 assert.equal(await f.db.invitationUnblocked(1,row.id),true);
 const exported=(await f.db.exportForEmail(1,body.nominator_email))[0];assert.ok(exported.consents[0].withdrawn_at);assert.equal(exported.suppression.length,2);assert.equal(exported.reason,body.reason);assert.equal(exported.application,undefined);
 await f.db.nominate(1,'test',{...body,submission_key:crypto.randomUUID(),nominee_email:'second@example.test',nominator_marketing_sms:true});
 const later=(await f.pg.query("SELECT id FROM giveaway_nominations WHERE school_id=1 AND nomination->'nominee'->>'email'='second@example.test'")).rows[0];
 assert.equal(await f.db.mayMarket(1,later.id,'email','nominator'),false);assert.equal(await f.db.mayMarket(1,later.id,'sms','nominator'),false);
 await f.db.requestErasure(1,row.id);assert.equal(await f.db.mayMarket(1,row.id,'email','nominator'),false);
});
test('missing and string nominator choices never grant consent',async t=>{
 const f=await setup(t);await f.db.nominate(1,'test',{...nominate(),nominator_marketing_email:'true'});
 const row=(await f.pg.query('SELECT * FROM giveaway_nominations')).rows[0];assert.ok(row.nomination.nominator_consents.every(c=>c.granted===false));
 assert.equal(await f.db.mayMarket(1,row.id,'email','nominator'),false);
});

test('scheduled CRM drains other entries after identity conflict and preserves opt-outs without sending or cleanup',async t=>{
 const f=await setup(t),{row:blocked}=await f.seeded();
 const body={...nominate(),nominee_email:'second@example.test',nominee_phone:'07700900789',nominator_email:'second-nominator@example.test',nominator_phone:'07700900987'};
 await f.db.nominate(1,'test',body);await f.db.nominate(2,'test',nominate());
 const second=(await f.pg.query("SELECT * FROM giveaway_nominations WHERE school_id=1 AND id<>$1",[blocked.id])).rows[0];
 const invitation=(await f.pg.query("SELECT payload FROM giveaway_jobs WHERE school_id=1 AND nomination_id=$1 AND kind='invitation'",[second.id])).rows[0];
 const token=f.vault.open(invitation.payload.sealed_token,'1:'+second.id);await f.db.apply(1,token,apply());await f.db.withdraw(1,token);
 const before=(await f.pg.query("SELECT * FROM giveaway_consents ORDER BY school_id,nomination_id,channel")).rows;
 const {scheduledCrmConfig}=require('./integration.cjs');
 const config=scheduledCrmConfig({campaign_key:'test',integration:{enabled:true,
  invitation:{enabled:true,confirmationEnabled:true},provisioning:{enabled:true,creationApproved:true,reviewReference:'test-approved'},
  crm:{enabled:true,environment:'rehearsal',locationId:'fake-location',reviewUrl:'https://example.test/review',associations:{nominee:{id:'nominee',first:'contact'},nominator:{id:'nominator',first:'contact'}}}}},1);
 const contacts=[],writes=[];let record;
 const providers={invitationTransport:{send:async()=>{throw Error('No scheduled email allowed');}},search:async({field,value})=>{
  if(value===blocked.nomination.nominee.phone.replace(/^0/,'+44'))return {total:1,contacts:[{id:'conflict',locationId:'fake-location',email:'unrelated@example.test',phone:value}]};
  const found=contacts.filter(c=>c[field]===value);return {total:found.length,contacts:found};
 },crmTransport:{request:async(method,path,body)=>{
  if(method!=='GET')writes.push({method,path,body});
  if(method==='POST'&&path==='/contacts/'){const contact={...body,id:'created-'+contacts.length};contacts.push(contact);return {contact};}
  if(method==='GET'&&path.startsWith('/contacts/'))return {contact:contacts.find(c=>c.id===path.split('/')[2])};
  if(method==='POST'&&path.endsWith('/records')){record={...body,id:'record'};return {record};}
  if(method==='POST'&&path==='/associations/relations')return {id:'relation-'+writes.length};
  throw Error('Unexpected provider operation');
 }}};
 const run=()=>runNextIntegration({...f,sql:tagged(f.pg),config,providers});
 assert.equal((await run()).crm.status,'provisioning_review_required');
 assert.equal(writes.length,0);
 assert.equal((await run()).crm.status,'succeeded');
 assert.equal((await run()).crm.status,'succeeded');
 assert.equal((await run()).status,'idle');
 assert.equal(writes.length,5);assert.equal(record.properties.application_status,'submitted');assert.ok(contacts.every(c=>c.dnd===true));
 assert.ok((await f.pg.query("SELECT state FROM giveaway_jobs WHERE kind IN ('invitation','suppression') OR school_id=2")).rows.every(j=>j.state==='pending'));
 assert.deepEqual((await f.pg.query('SELECT * FROM giveaway_consents ORDER BY school_id,nomination_id,channel')).rows,before);
 assert.equal(await f.db.mayMarket(1,second.id,'email'),false);assert.equal(await f.db.mayMarket(1,second.id,'sms'),false);
 assert.doesNotMatch(JSON.stringify(writes),/Private application reason|Private nomination reason|tags|DELETE/);
});
