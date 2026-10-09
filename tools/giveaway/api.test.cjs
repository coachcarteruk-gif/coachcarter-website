const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'); const jwt=require('jsonwebtoken');
const {createDatabase,tagged,tokenVault}=require('./database.cjs'); const {createHandler}=require('../../api/_giveaway-handler');
test('scheduled integration requires cron auth and explicit activation before any database access',async()=>{
 const handler=require('../../api/cron-giveaway-integrations');
 const prior=process.env.CRON_SECRET,enabled=process.env.GIVEAWAY_WORKER_ENABLED;process.env.CRON_SECRET='fictional-cron-secret';delete process.env.GIVEAWAY_WORKER_ENABLED;
 const call=async(req)=>{const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler(req,res);return res;};
 try{
  assert.equal((await call({method:'POST',headers:{}})).code,405);
  assert.equal((await call({method:'GET',headers:{},query:{}})).code,401);
  const r=await call({method:'GET',headers:{authorization:'Bearer fictional-cron-secret'},query:{}});assert.equal(r.data.status,'disabled');
 }finally{if(prior===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prior;if(enabled===undefined)delete process.env.GIVEAWAY_WORKER_ENABLED;else process.env.GIVEAWAY_WORKER_ENABLED=enabled;}
});
test('real handler and SQL cover nomination, invitation session, application, withdrawal and admin boundaries',async t=>{
 const pg=new PGlite(); t.after(()=>pg.close());
 await pg.exec("CREATE TABLE schools(id INTEGER PRIMARY KEY,config JSONB,primary_host TEXT,slug TEXT,active BOOLEAN); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,request_count INTEGER,window_start TIMESTAMPTZ); INSERT INTO schools VALUES(1,'{}','giveaway.example.test','one',true),(2,'{}','other.example.test','two',true)");
 await pg.exec('CREATE TABLE audit_log(admin_id INTEGER,admin_email TEXT,action TEXT,target_type TEXT,target_id INTEGER,details JSONB,ip_address TEXT,school_id INTEGER)');
 await pg.exec(fs.readFileSync(path.resolve(__dirname,'../../db/migrations/077_giveaway_storage.sql'),'utf8'));
 await pg.exec(fs.readFileSync(path.resolve(__dirname,'../../db/migrations/078_giveaway_privacy.sql'),'utf8'));
 await pg.query("UPDATE schools SET config=$1::jsonb",[JSON.stringify({giveaway:{enabled:true,campaign_key:'api-test',origin:'https://giveaway.example.test'}})]);
 await pg.exec("INSERT INTO giveaway_campaigns(school_id,campaign_key,closes_at,retain_until,enabled) VALUES(1,'api-test',now()+interval '1 day',now()+interval '90 days',true),(2,'api-test',now()+interval '1 day',now()+interval '90 days',true)");
 const vault=tokenVault(crypto.randomBytes(32)),transaction=cb=>pg.transaction(client=>cb(tagged(client))),db=createDatabase({transaction,vault});
 let now=Date.now(),workerCalls=[]; const handler=createHandler({db,sql:tagged(pg),transaction,vault,enabled:true,now:()=>now,runIntegration:async config=>{workerCalls.push(config);return {status:'processed'};}});
 const csrf='a'.repeat(64); let session='';
 async function call(action,body={},overrides={}) {
  const req={query:{action},method:['config','review','integration-status'].includes(action)?'GET':'POST',url:'/api/giveaway',headers:{host:'giveaway.example.test',origin:'https://giveaway.example.test','content-type':'application/json','x-csrf-token':csrf,cookie:'cc_csrf='+csrf+(session?'; '+session:'')},body,...overrides};
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler(req,res); return res;
 }
 await t.test('config sets CSRF cookie; methods, origin and CSRF fail closed',async()=>{
  const config=await call('config',{}, {headers:{host:'giveaway.example.test'}}); assert.equal(config.code,200); assert.ok(config.headers['Set-Cookie'][0].startsWith('cc_csrf='));
  assert.equal((await call('nominate',{}, {method:'GET'})).code,405);
  assert.equal((await call('nominate',{}, {headers:{host:'giveaway.example.test',origin:'https://attacker.test','content-type':'application/json'}})).code,403);
  assert.equal((await call('apply',{}, {headers:{host:'giveaway.example.test',origin:'https://giveaway.example.test','content-type':'application/json'}})).code,403);
 });
 const body={submission_key:crypto.randomUUID(),nominee_name:'Alex',nominee_phone:'07700900123',nominee_email:'alex@example.test',nominator_name:'Jamie',nominator_phone:'07700900456',nominator_email:'jamie@example.test',reason:'Private reason',permission:true};
 await t.test('nomination reaches SQL exactly once on retry',async()=>{
  assert.equal((await call('nominate',body)).code,200); assert.equal((await call('nominate',body)).code,200);
  assert.equal((await pg.query('SELECT * FROM giveaway_nominations')).rows.length,1);
 });
 const row=(await pg.query('SELECT * FROM giveaway_nominations')).rows[0], job=(await pg.query("SELECT * FROM giveaway_jobs WHERE kind='invitation'")).rows[0];
 const token=vault.open(job.payload.sealed_token,`1:${row.id}`);
 await t.test('token exchange sets private cookie, excludes nominator PII, rejects wrong tenant and expired session',async()=>{
  const result=await call('invitation',{token}); assert.equal(result.code,200);
  const cookie=result.headers['Set-Cookie'][0]; assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/); assert.doesNotMatch(cookie,new RegExp(token));
  session=cookie.split(';')[0]; assert.doesNotMatch(JSON.stringify(result.data),/Private reason|jamie@example/);
  assert.equal((await call('invitation')).code,200);
  const headers={host:'other.example.test',origin:'https://giveaway.example.test','content-type':'application/json','x-csrf-token':csrf,cookie:'cc_csrf='+csrf+'; '+session};
  assert.equal((await call('invitation',{}, {headers})).code,401);
  now+=43200001; assert.equal((await call('invitation')).code,401); now-=43200001;
 });
 await t.test('application and withdrawal commit via session without resending token',async()=>{
  const answer={name:'Alex',meaning: 'My private story', barriers: 'Lesson costs are a barrier; free lessons would make learning possible.',hours:'0',test_booked:'no',practice_car:'no',address:'1 Fictional Road',postcode:'SW1A 1AA',employment:'prefer-not-to-say',contact_confirmed:true,marketing_email:true};
  assert.equal((await call('apply',answer)).code,200); assert.equal((await call('withdraw')).code,200);
  assert.ok((await pg.query("SELECT withdrawn_at FROM giveaway_consents WHERE channel='email'")).rows[0].withdrawn_at);
 });
 await t.test('review rejects fake login and unauthenticated callers; authentic school admin sees no tokens',async t=>{
  assert.equal((await call('preview-login')).code,404); assert.equal((await call('review')).code,401);
  const previous=process.env.JWT_SECRET; process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
  try {
   const auth=jwt.sign({id:1,role:'admin',isAdmin:true,school_id:1},process.env.JWT_SECRET,{expiresIn:'5m'});
   const result=await call('review',{}, {headers:{host:'giveaway.example.test',cookie:'cc_admin='+auth}});
   assert.equal(result.code,200); assert.equal(result.data.records.length,1); assert.doesNotMatch(JSON.stringify(result.data),/token_hash|sealed_token|claim_token/);
   const wrong=jwt.sign({id:2,role:'admin',isAdmin:true,school_id:2},process.env.JWT_SECRET,{expiresIn:'5m'});
   assert.equal((await call('review',{}, {headers:{host:'giveaway.example.test',cookie:'cc_admin='+wrong}})).code,401);
   const headers={host:'giveaway.example.test',origin:'https://giveaway.example.test','content-type':'application/json','x-csrf-token':csrf,cookie:'cc_admin='+auth+'; cc_csrf='+csrf};
   await t.test('integration actions require admin, CSRF, evidence and trusted scoped activation',async()=>{
    await db.nominate(1,'api-test',{...body,submission_key:crypto.randomUUID(),nominee_email:'worker@example.test',nominee_phone:'07700900781'});
    const id=(await pg.query("SELECT id FROM giveaway_nominations WHERE nomination->'nominee'->>'email'='worker@example.test'")).rows[0].id;
    const request={nomination_id:id,nominee_requested:true,verification_reference:'direct-request-123'};
    assert.equal((await call('record-invitation-request',request)).code,401);
    assert.equal((await call('record-invitation-request',request,{headers:{...headers,cookie:'cc_admin='+wrong+'; cc_csrf='+csrf}})).code,401);
    assert.equal((await call('record-invitation-request',request,{headers:{...headers,'x-csrf-token':'bad'}})).code,403);
    assert.equal((await call('record-invitation-request',{...request,nominee_requested:false},{headers})).code,400);
    assert.equal((await call('record-invitation-request',request,{headers})).data.ok,true);
    const evidence=(await pg.query('SELECT nomination FROM giveaway_nominations WHERE id=$1',[id])).rows[0].nomination.permission.invitation_request;
    assert.equal(evidence.reference,'direct-request-123');assert.equal(evidence.nomination_id,id);
    assert.equal((await call('run-integration',request,{headers})).code,409);assert.equal(workerCalls.length,0);
    await pg.exec("UPDATE schools SET config=jsonb_set(config,'{giveaway,integration}','{\"enabled\":true}') WHERE id=1");
    assert.equal((await call('run-integration',{...request,schoolId:2,campaignKey:'evil',invitation:{origin:'https://evil.test'}},{headers})).code,200);
    assert.equal(workerCalls[0].schoolId,1);assert.equal(workerCalls[0].campaignKey,'api-test');assert.equal(workerCalls[0].invitation.origin,'https://giveaway.example.test');
    assert.equal((await call('run-integration',{nomination_id:crypto.randomUUID()},{headers})).code,404);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM audit_log WHERE action='giveaway.run-integration'")).rows[0].n,1);
    await pg.query('DELETE FROM giveaway_nominations WHERE school_id=1 AND id=$1',[id]);
   });
   await t.test('integration status is read-only, admin-only and scoped to school and campaign',async()=>{
    assert.equal((await call('integration-status')).code,401);
    assert.equal((await call('integration-status',{}, {headers:{host:'giveaway.example.test',cookie:'cc_admin='+wrong}})).code,401);
    assert.equal((await call('integration-status',{}, {method:'POST',headers})).code,405);
    await db.nominate(2,'api-test',{...body,submission_key:crypto.randomUUID()});
    await pg.exec("INSERT INTO giveaway_campaigns VALUES(1,'other-campaign',now()+interval '1 day',now()+interval '90 days',true)");
    await db.nominate(1,'other-campaign',{...body,submission_key:crypto.randomUUID()});
    const claim=await db.claim(1,'invitation');
    await db.beginDispatch(1,claim.id,claim.claim_token);
    await pg.query("UPDATE giveaway_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",[claim.id]);
    const status=await call('integration-status',{}, {headers});
    assert.equal(status.code,200);
    assert.equal(status.headers['Cache-Control'],'no-store');
    assert.deepEqual(status.data.jobs,[{kind:'crm',state:'pending',count:2},{kind:'invitation',state:'uncertain',count:1},{kind:'suppression',state:'pending',count:1}]);
    assert.doesNotMatch(JSON.stringify(status.data),/alex@example|Private reason|claim_token|sealed_token|nomination_id/);
    assert.equal((await pg.query('SELECT state FROM giveaway_jobs WHERE id=$1',[claim.id])).rows[0].state,'dispatching');
   });
   const exported=await call('privacy-export',{verified_email:'alex@example.test',verification_reference:'case-001'},{headers});
   assert.equal(exported.code,200); assert.doesNotMatch(JSON.stringify(exported.data),/Private reason|jamie@example/);
   await pg.query("UPDATE schools SET config=jsonb_set(config,'{giveaway,enabled}','false') WHERE id=1");
   assert.equal((await call('config')).data.open,false);
   assert.equal((await call('integration-status',{}, {headers})).code,200);
   const closedReview=await call('review',{}, {headers});
   assert.equal(closedReview.code,200); assert.equal(closedReview.data.records.length,1);
   assert.equal((await call('review')).code,401);
   assert.equal((await call('review',{}, {headers:{host:'giveaway.example.test',cookie:'cc_admin='+wrong}})).code,401);
   assert.equal((await call('nominate',body)).code,404);
   assert.equal((await call('withdraw')).code,200);
   assert.equal((await call('apply',{})).code,404);
   assert.equal((await call('request-erasure',{nomination_id:row.id,verification_reference:'case-001'},{headers})).code,200);
   const queue=await call('privacy-queue',{}, {method:'GET',headers});
   assert.equal(queue.code,200);assert.equal(queue.data.records[0].id,row.id);
   assert.doesNotMatch(JSON.stringify(queue.data),/alex@example|token|Private reason/);
   assert.equal((await call('privacy-queue',{}, {method:'GET',headers:{host:'giveaway.example.test',cookie:'cc_admin='+wrong}})).code,401);
   assert.equal((await pg.query('SELECT * FROM audit_log')).rows.length,4);
   await pg.query("UPDATE schools SET config=jsonb_set(config,'{giveaway,enabled}','true') WHERE id=1");
   assert.equal((await call('invitation')).code,404);
  } finally { if(previous===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; }
 });
 await t.test('unknown host and query tenant override cannot expose records',async()=>{
  assert.equal((await call('config',{}, {headers:{host:'unknown.example.test'},query:{action:'config',school:'one'}})).code,404);
 });
 await t.test('Node-style inherited request headers resolve the correct school',async()=>{
  const req=Object.create({headers:{host:'giveaway.example.test'}}); req.query={action:'config'}; req.method='GET';
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.code=code;return this;},json(data){this.data=data;}};
  await handler(req,res); assert.equal(res.data.ok,true);
 });
});
test('production entry point is disabled without touching a database',async()=>{
 const before=process.env.GIVEAWAY_API_ENABLED; delete process.env.GIVEAWAY_API_ENABLED;
 try {const res={status(code){this.code=code;return this;},json(data){this.data=data;}}; await require('../../api/giveaway')({},res); assert.equal(res.code,404);}
 finally {if(before!==undefined)process.env.GIVEAWAY_API_ENABLED=before;}
});
