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
    deadline: new Date(Date.now()+86400000).toISOString(), associations: { nominee: { id: 'nominee-link', first: 'nomination' }, nominator: { id: 'nominator-link', first: 'nomination' } } };
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
