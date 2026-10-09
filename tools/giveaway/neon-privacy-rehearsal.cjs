// Only the pre-existing isolated giveaway branch; no production env loading.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {Pool}=require('pg');
const {fingerprint}=require('../../scripts/migration-runner');
const {createDatabase,poolTransactions,tokenVault}=require('./database.cjs');
async function main(){
 const url=new URL(process.env.GIVEAWAY_TEST_DATABASE_URL);
 assert.equal(url.hostname,'ep-cool-recipe-abk4bt80-pooler.eu-west-2.aws.neon.tech');
 url.hostname=url.hostname.replace('-pooler','');url.searchParams.set('sslmode','verify-full');
 const connectionString=url.href,cwd=path.resolve(__dirname,'../..');
 const env={...process.env,POSTGRES_URL_NON_POOLING:connectionString,DATABASE_URL_UNPOOLED:connectionString,MIGRATION_RUNNER_APPLY:'approved',MIGRATION_RUNNER_TARGET_FINGERPRINT:fingerprint(connectionString)};
 const status=JSON.parse(execFileSync(process.execPath,['scripts/migration-runner.js','--status'],{cwd,env,encoding:'utf8'}));
 assert.ok(status.pending.every(id=>id==='078'),'Unexpected migration');
 if(status.pending.length)execFileSync(process.execPath,['scripts/migration-runner.js','--apply-approved'],{cwd,env,stdio:'pipe'});
 const pool=new Pool({connectionString,max:10});
 try{
  const vault=tokenVault(crypto.randomBytes(32)),db=createDatabase({transaction:poolTransactions(pool),vault});
  const campaign='privacy-rehearsal-'+crypto.randomUUID(),email=campaign+'@example.invalid';
  await pool.query("INSERT INTO giveaway_campaigns(school_id,campaign_key,closes_at,retain_until,enabled) VALUES(1,$1,now()+interval '1 day',now()+interval '91 days',true)",[campaign]);
  await db.nominate(1,campaign,{submission_key:crypto.randomUUID(),nominee_name:'Privacy Test',nominee_email:email,nominee_phone:'07700900891',nominator_name:'Fictional Friend',nominator_email:campaign+'-friend@example.invalid',nominator_phone:'07700900892',reason:'Disposable privacy rehearsal',permission:true});
  const row=(await pool.query('SELECT id FROM giveaway_nominations WHERE school_id=1 AND campaign_key=$1',[campaign])).rows[0];
  const job=(await pool.query("SELECT payload FROM giveaway_jobs WHERE school_id=1 AND nomination_id=$1 AND kind='invitation'",[row.id])).rows[0];
  const token=vault.open(job.payload.sealed_token,`1:${row.id}`);
  await db.apply(1,token,{name:'Privacy Test',meaning: 'Fictional test', barriers: 'Lesson costs are a barrier; free lessons would make learning possible.',hours:0,test_booked:'no',practice_car:'no',address:'1 Fictional Road',postcode:'SW1A 1AA',employment:'prefer-not-to-say',contact_confirmed:true,marketing_email:true,marketing_sms:true});
  await Promise.all(Array.from({length:8},()=>db.withdraw(1,token)));
  assert.equal(await db.mayMarket(1,row.id,'email'),false);assert.equal(await db.mayMarket(1,row.id,'sms'),false);
  assert.deepEqual(await db.exportForEmail(99999,email),[]);
  const exported=await db.exportForEmail(1,email);assert.equal(exported.length,1);assert.equal(exported[0].suppression.length,2);
  assert.ok(!JSON.stringify(exported).includes('Disposable privacy rehearsal'));
  assert.ok(!JSON.stringify(exported).includes(token));
  await db.requestErasure(1,row.id);await assert.rejects(db.inspect(1,token));
  const jobs=(await pool.query('SELECT state FROM giveaway_jobs WHERE school_id=1 AND nomination_id=$1',[row.id])).rows;
  assert.ok(jobs.every(j=>j.state==='cancelled'));
  // This isolated fixture never dispatched to any provider; there is no remote data to purge.
  assert.equal(await db.eraseAfterProviderCleanup(1,row.id,true),true);
  const {subjectHash}=require('../../api/_giveaway-privacy');
  assert.equal((await pool.query("SELECT 1 FROM giveaway_marketing_suppressions WHERE school_id=1 AND channel='email' AND subject_hash=$1",[subjectHash('email',email)])).rows.length,1);
  const report={result:'passed',branch_id:'br-twilight-term-abtld5ie',migration:'078',concurrent_withdrawals:8,suppression_channels:2,wrong_school_export:'empty',private_answers_and_tokens:'excluded',erasure:'fixture removed after no-provider evidence',suppression_after_erasure:'retained',provider_requests:0,campaign_key:campaign};
  fs.writeFileSync(path.join(cwd,'tmp/giveaway-neon-privacy-rehearsal.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(JSON.stringify({result:'failed',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'PRIVACY_REHEARSAL_FAILED'}));process.exitCode=1;});
