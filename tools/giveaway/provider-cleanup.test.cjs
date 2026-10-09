const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createDatabase,tagged,tokenVault}=require('./database.cjs');
const {createCleanupStore,createCleanupWorker,createCleanupTransport}=require('./provider-cleanup.cjs');
async function setup(t){
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec('CREATE TABLE schools(id INTEGER PRIMARY KEY); INSERT INTO schools VALUES(1),(2)');
 for(const name of ['077_giveaway_storage.sql','078_giveaway_privacy.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'../../db/migrations',name),'utf8'));
 await pg.exec("INSERT INTO giveaway_campaigns VALUES(1,'test',now()+interval '1 day',now()+interval '90 days',true)");
 const transaction=cb=>pg.transaction(c=>cb(tagged(c))),db=createDatabase({transaction,vault:tokenVault(crypto.randomBytes(32))});
 await db.nominate(1,'test',{submission_key:crypto.randomUUID(),nominee_name:'Alex',nominee_email:'alex@example.test',nominee_phone:'07700900123',nominator_name:'Jamie',nominator_email:'jamie@example.test',nominator_phone:'07700900456',reason:'Fictional',permission:true});
 const id=(await pg.query('SELECT id FROM giveaway_nominations')).rows[0].id;
 const config={schoolId:1,locationId:'location',campaignKey:'test',environment:'rehearsal'};
 const state={operations:{['rehearsal:1:location:test:record:'+id]:{status:'done',result:'record-1'}}};
 await pg.query('UPDATE giveaway_nominations SET crm_state=$1 WHERE id=$2',[state,id]);
 await db.requestErasure(1,id);
 let present=true;const calls=[];
 const transport={async request(method,url){calls.push({method,url});if(method==='DELETE'){present=false;return {success:true,id:'record-1'};}
  return present?{record:{id:'record-1',locationId:'location',properties:{nomination_reference:'rehearsal:1:test:'+id}}}:{status:404};}};
 const store=createCleanupStore({transaction,config});return {pg,db,id,config,transaction,store,transport,calls};
}
test('cleanup verifies exact scoped record, preserves contacts, and never repeats deletion',async t=>{
 const f=await setup(t);assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),false);
 const run=createCleanupWorker({...f,enabled:true});assert.equal((await run(f.id)).status,'record_removed');
 await run(f.id);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);
 assert.ok(f.calls.every(x=>!x.url.includes('/contacts/')));
 assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),true);
});
test('wrong-school, disabled and record mismatch prevent provider mutations',async t=>{
 const f=await setup(t);assert.equal((await createCleanupWorker(f)(f.id)).status,'disabled');assert.equal(f.calls.length,0);
 await assert.rejects(createCleanupStore({...f,config:{...f.config,schoolId:2}}).inspect(f.id),{code:'cleanup_not_requested'});
 const worker=createCleanupWorker({...f,enabled:true,transport:{request:async()=>({record:{id:'record-1',locationId:'other'}})}});
 await assert.rejects(worker(f.id),{code:'cleanup_identity_conflict'});assert.equal(f.calls.length,0);
});
test('ambiguous DELETE is never replayed, absence can be reconciled read-only',async t=>{
 const f=await setup(t),base=f.transport.request;
 const worker=createCleanupWorker({...f,enabled:true,transport:{async request(...args){const result=await base(...args);if(args[0]==='DELETE')throw Error('lost receipt');return result;}}});
 await assert.rejects(worker(f.id),{code:'cleanup_uncertain'});assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),false);
 assert.equal((await worker(f.id)).status,'record_removed');assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);
});
test('unknown provisioning outcomes block cleanup before any provider call',async t=>{
 const f=await setup(t);await f.pg.query("UPDATE giveaway_nominations SET crm_state=crm_state || $1::jsonb WHERE id=$2",[{contact_provisioning:{x:{location_id:'location',state:'uncertain'}}},f.id]);
 await assert.rejects(createCleanupWorker({...f,enabled:true})(f.id),{code:'cleanup_unresolved_work'});assert.equal(f.calls.length,0);
});
test('cleanup transport rejects contacts, foreign locations, redirects and disabled calls',async()=>{
 const calls=[];const args={apiKey:'fictional',locationId:'location',fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:false,status:404};}};
 await assert.rejects(createCleanupTransport(args).request('DELETE','/objects/custom_objects.giveaway_nominations/records/id'),{code:'cleanup_disabled'});
 const transport=createCleanupTransport({...args,enabled:true});
 for(const [method,url] of [['DELETE','/contacts/id'],['GET','/objects/custom_objects.giveaway_nominations/records/id?locationId=foreign']])await assert.rejects(transport.request(method,url),{code:'cleanup_invalid_request'});
 assert.deepEqual(await transport.request('GET','/objects/custom_objects.giveaway_nominations/records/id?locationId=location'),{status:404});
 assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'error');
});

test('competing cleanup workers dispatch one deletion and preserve the receipt',async t=>{
 const f=await setup(t);const a=createCleanupWorker({...f,enabled:true}),b=createCleanupWorker({...f,enabled:true});
 const results=await Promise.allSettled([a(f.id),b(f.id)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);
 assert.equal((await f.store.inspect(f.id)).receipt.state,'verified_absent');
});

test('failed intent persistence prevents deletion and failed readback retains evidence',async t=>{
 const f=await setup(t);
 const blocked=createCleanupWorker({...f,enabled:true,store:{...f.store,begin:async()=>{throw Error('storage unavailable');}}});
 await assert.rejects(blocked(f.id));assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);
 const original=f.transport.request;let removed=false;
 const worker=createCleanupWorker({...f,enabled:true,transport:{async request(method,url){
  if(method==='GET'&&removed)throw Error('readback unavailable');
  const result=await original(method,url);if(method==='DELETE')removed=true;return result;
 }}});
 await assert.rejects(worker(f.id),{code:'cleanup_uncertain'});
 assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),false);
 await assert.rejects(worker(f.id));assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);
});
