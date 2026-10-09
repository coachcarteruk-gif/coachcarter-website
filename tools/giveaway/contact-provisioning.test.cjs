const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createDatabase,tagged,tokenVault}=require('./database.cjs');
const {createProvisioningStore,createContactProvisioner}=require('./contact-provisioning.cjs');
const config={schoolId:1,locationId:'fictional-location',campaignKey:'test'};
async function setup(t){
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec('CREATE TABLE schools(id INTEGER PRIMARY KEY); INSERT INTO schools VALUES(1),(2)');
 for(const file of ['077_giveaway_storage.sql','078_giveaway_privacy.sql'])await pg.exec(fs.readFileSync(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
 await pg.exec("INSERT INTO giveaway_campaigns VALUES(1,'test',now()+interval '1 day',now()+interval '90 days',true),(2,'test',now()+interval '1 day',now()+interval '90 days',true)");
 const transaction=cb=>pg.transaction(client=>cb(tagged(client))),db=createDatabase({transaction,vault:tokenVault(crypto.randomBytes(32))});
 const body={submission_key:crypto.randomUUID(),nominee_name:'Fictional Alex',nominee_email:'alex@example.test',nominee_phone:'07700900123',nominator_name:'Fictional Jamie',nominator_email:'jamie@example.test',nominator_phone:'07700900456',reason:'Fictional',permission:true};
 await db.nominate(1,'test',body);const id=(await pg.query('SELECT id FROM giveaway_nominations')).rows[0].id;
 const store=createProvisioningStore({transaction}),contacts=[],calls=[];
 const search=async({field,value,locationId})=>{const found=contacts.filter(c=>c.locationId===locationId&&c[field]===value);return {contacts:found,total:found.length};};
 const transport={async request(method,url,payload){assert.equal(method,'POST');assert.equal(url,'/contacts/');calls.push(payload);const contact={...payload,id:'contact-'+calls.length};contacts.push(contact);return {contact};}};
 const options={config,store,search,transport,enabled:true,creationApproved:true,reviewReference:'fictional-reviewed-case'};
 const run=()=>createContactProvisioner(options)({nominationId:id,role:'nominee'});
 return {pg,db,body,id,store,contacts,calls,options,run};
}
test('duplicate nominations and restarted provisioners share one durable creation',async t=>{
 const f=await setup(t);await f.db.nominate(1,'test',{...f.body,submission_key:crypto.randomUUID(),nominator_email:'other@example.test',nominator_phone:'07700900789'});
 const second=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[f.id])).rows[0].id;
 const results=await Promise.allSettled([f.run(),createContactProvisioner(f.options)({nominationId:second,role:'nominee'})]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.calls.length,1);
 const plan=await createContactProvisioner(f.options)({nominationId:second,role:'nominee'});assert.equal(plan.id,'contact-1');assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].dnd,true);assert.equal(f.calls[0].email,'alex@example.test');
 const journal=(await f.pg.query('SELECT crm_state FROM giveaway_nominations WHERE id=$1',[f.id])).rows[0].crm_state;
 assert.doesNotMatch(JSON.stringify(journal),/alex@example|077009|Fictional Alex/);
});
test('already existing contact is recorded and reused without creation or DND changes',async t=>{
 const f=await setup(t);f.contacts.push({id:'existing',locationId:config.locationId,email:'alex@example.test',phone:'+447700900123',dnd:false});
 assert.equal((await f.run()).id,'existing');assert.equal(f.calls.length,0);assert.equal(f.contacts[0].dnd,false);
});
test('provider acceptance then timeout blocks every nomination, including restart',async t=>{
 const f=await setup(t);const original=f.options.transport.request;
 f.options.transport={request:async(...args)=>{await original(...args);throw Error('lost response');}};
 await assert.rejects(f.run(),{code:'provisioning_uncertain'});
 await f.db.nominate(1,'test',{...f.body,submission_key:crypto.randomUUID(),nominator_email:'other@example.test'});
 const second=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[f.id])).rows[0].id;
 await assert.rejects(createContactProvisioner(f.options)({nominationId:second,role:'nominee'}),{code:'provisioning_uncertain'});
 assert.equal(f.calls.length,1);
 await f.db.requestErasure(1,f.id);assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),false);
});
test('lost success receipt leaves durable uncertainty and never repeats creation',async t=>{
 const f=await setup(t);f.options.store={...f.store,finish:async()=>{throw Error('storage unavailable');}};
 await assert.rejects(f.run(),{code:'provisioning_uncertain'});await assert.rejects(f.run(),{code:'provisioning_uncertain'});assert.equal(f.calls.length,1);
});
test('shared identifiers with changed counterpart are blocked across nominations',async t=>{
 const f=await setup(t);await f.run();await f.db.nominate(1,'test',{...f.body,submission_key:crypto.randomUUID(),nominee_phone:'07700900999',nominator_email:'other@example.test'});
 const second=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[f.id])).rows[0].id;
 await assert.rejects(createContactProvisioner(f.options)({nominationId:second,role:'nominee'}),{code:'contact_identity_conflict'});assert.equal(f.calls.length,1);
});
test('disabled creation, wrong scope and erasure perform no writes',async t=>{
 const f=await setup(t);
 for(const overrides of [{enabled:false},{creationApproved:false},{reviewReference:''},{config:{...config,schoolId:2}},{config:{...config,campaignKey:'other'}}])
  await assert.rejects(createContactProvisioner({...f.options,...overrides})({nominationId:f.id,role:'nominee'}));
 await f.db.requestErasure(1,f.id);await assert.rejects(f.run());assert.equal(f.calls.length,0);
});
test('erasure during lookup stops creation before dispatch',async t=>{
 const f=await setup(t);let once=false;f.options.search=async()=>{if(!once){once=true;await f.db.requestErasure(1,f.id);}return {contacts:[],total:0};};
 await assert.rejects(f.run(),{code:'provisioning_ownership_lost'});assert.equal(f.calls.length,0);
 assert.equal(await f.db.eraseAfterProviderCleanup(1,f.id,true),true);
});
test('normal CRM journal persistence cannot overwrite contact provisioning evidence',async t=>{
 const f=await setup(t);await f.run();const job=await f.db.claim(1,'crm');await f.db.beginDispatch(1,job.id,job.claim_token);
 await f.db.saveCrmState(1,job.id,job.claim_token,{operations:{},contacts:{},contact_provisioning:{forged:'bad'}});
 const state=(await f.pg.query('SELECT crm_state FROM giveaway_nominations WHERE id=$1',[f.id])).rows[0].crm_state;
 assert.equal(Object.values(state.contact_provisioning)[0].contact_id,'contact-1');assert.equal(state.contact_provisioning.forged,undefined);
});

test('expired pre-dispatch reservations are fenced and shared erasure retains uncertainty',async t=>{
 const f=await setup(t);const args={...config,nominationId:f.id,role:'nominee',reviewReference:'fictional-review'};
 const old=await f.store.reserve(args);
 await f.pg.query("UPDATE giveaway_nominations SET crm_state=jsonb_set(crm_state,ARRAY['contact_provisioning',$1,'lease_until'],to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$2",[old.key,f.id]);
 await f.db.nominate(1,'test',{...f.body,submission_key:crypto.randomUUID(),nominator_email:'other@example.test'});
 const second=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[f.id])).rows[0].id;
 const current=await f.store.reserve({...args,nominationId:second});
 assert.equal(current.owner_id,f.id);assert.notEqual(current.token,old.token);
 await assert.rejects(f.store.begin(1,old),{code:'provisioning_ownership_lost'});
 await f.store.begin(1,current);await f.store.uncertain(1,current);
 await f.db.requestErasure(1,second);assert.equal(await f.db.eraseAfterProviderCleanup(1,second,true),false);
});

test('receipt arriving after erasure remains available for provider cleanup',async t=>{
 const f=await setup(t);const original=f.options.transport.request;
 f.options.transport={request:async(...args)=>{const result=await original(...args);await f.db.requestErasure(1,f.id);return result;}};
 assert.equal((await f.run()).id,'contact-1');
 const state=(await f.pg.query('SELECT crm_state FROM giveaway_nominations WHERE id=$1',[f.id])).rows[0].crm_state;
 assert.equal(Object.values(state.contact_provisioning)[0].contact_id,'contact-1');
 await assert.rejects(f.run());assert.equal(f.calls.length,1);
});

test('privacy exports include shared contact references without other people or internal tokens',async t=>{
 const f=await setup(t);await f.run();
 await f.db.nominate(1,'test',{...f.body,submission_key:crypto.randomUUID(),nominee_email:'other@example.test',nominee_phone:'07700900789'});
 const exported=await f.db.exportForEmail(1,'alex@example.test');
 assert.deepEqual(exported[0].provider_contacts,[{provider:'HighLevel',location_id:config.locationId,contact_id:'contact-1'}]);
 assert.equal(JSON.stringify(exported).includes('fictional-reviewed-case'),false);
 assert.equal(JSON.stringify(exported).includes('lease_until'),false);
 const nominator=await f.db.exportForEmail(1,'jamie@example.test');
 assert.ok(nominator.every(row=>row.provider_contacts.length===0));
 assert.deepEqual(await f.db.exportForEmail(2,'alex@example.test'),[]);
 // The mapping can be anchored on another nomination than the exported person's row.
 const anchor=(await f.pg.query('SELECT id FROM giveaway_nominations WHERE id<>$1',[f.id])).rows[0].id;
 const state=(await f.pg.query('SELECT crm_state FROM giveaway_nominations WHERE id=$1',[f.id])).rows[0].crm_state;
 await f.pg.query('UPDATE giveaway_nominations SET crm_state=$1 WHERE id=$2',[state,anchor]);
 await f.pg.query("UPDATE giveaway_nominations SET crm_state='{}' WHERE id=$1",[f.id]);
 assert.equal((await f.db.exportForEmail(1,'alex@example.test'))[0].provider_contacts[0].contact_id,'contact-1');
});
