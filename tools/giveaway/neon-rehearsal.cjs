// Explicit, branch-bound rehearsal. Never loads the normal production environment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { fingerprint } = require('../../scripts/migration-runner');
const { createDatabase, poolTransactions, tokenVault } = require('./database.cjs');
async function main() {
  const url = new URL(process.env.GIVEAWAY_TEST_DATABASE_URL);
  if (url.hostname !== 'ep-cool-recipe-abk4bt80-pooler.eu-west-2.aws.neon.tech') throw Error('Wrong branch');
  url.hostname=url.hostname.replace('-pooler',''); url.searchParams.set('sslmode','verify-full');
  const connectionString=url.href, cwd=path.resolve(__dirname,'../..');
  const env={...process.env,POSTGRES_URL_NON_POOLING:connectionString,DATABASE_URL_UNPOOLED:connectionString,
    MIGRATION_RUNNER_APPLY:'approved',MIGRATION_RUNNER_TARGET_FINGERPRINT:fingerprint(connectionString)};
  const status=JSON.parse(execFileSync(process.execPath,['scripts/migration-runner.js','--status'],{cwd,env,encoding:'utf8'}));
  if (status.pending.some(id=>id!=='077')) throw Error('Unexpected pending migration');
  if (status.pending.length) execFileSync(process.execPath,['scripts/migration-runner.js','--apply-approved'],{cwd,env,stdio:'pipe'});
  const pool = new Pool({connectionString,max:12});
  try {
    const vault=tokenVault(crypto.randomBytes(32)), db=createDatabase({transaction:poolTransactions(pool),vault});
    const campaign='giveaway-rehearsal-'+crypto.randomUUID();
    await pool.query("INSERT INTO giveaway_campaigns(school_id,campaign_key,closes_at,retain_until,enabled) VALUES(1,$1,now()+interval '1 day',now()+interval '91 days',true)",[campaign]);
    const body={submission_key:crypto.randomUUID(),nominee_name:'Alex Fictional',nominee_email:'alex@example.test',nominee_phone:'07700900123',
      nominator_name:'Jamie Fictional',nominator_email:'jamie@example.test',nominator_phone:'07700900456',reason:'Isolated branch rehearsal',permission:true};
    await Promise.all(Array.from({length:12},()=>db.nominate(1,campaign,body)));
    const rows=(await pool.query('SELECT * FROM giveaway_nominations WHERE school_id=1 AND campaign_key=$1',[campaign])).rows;
    assert.equal(rows.length,1); const row=rows[0];
    const invitation=(await pool.query("SELECT * FROM giveaway_jobs WHERE school_id=1 AND nomination_id=$1 AND kind='invitation'",[row.id])).rows[0];
    const token=vault.open(invitation.payload.sealed_token,`1:${row.id}`);
    const application={name:'Alex Fictional',meaning: 'Fictional branch test', barriers: 'Lesson costs are a barrier; free lessons would make learning possible.',hours:'0',test_booked:'no',practice_car:'no',address:'1 Fictional Road',postcode:'SW1A 1AA',employment:'prefer-not-to-say',contact_confirmed:true};
    await Promise.all(Array.from({length:12},()=>db.apply(1,token,application)));
    assert.equal((await pool.query('SELECT * FROM giveaway_consents WHERE school_id=1 AND nomination_id=$1',[row.id])).rows.length,2);
    const claims=await Promise.all(Array.from({length:8},()=>db.claim(1,'invitation')));
    assert.equal(claims.filter(Boolean).length,1);
    const claimed=claims.find(Boolean);
    assert.equal(await db.beginDispatch(99999,claimed.id,claimed.claim_token),false);
    assert.equal(await db.beginDispatch(1,claimed.id,claimed.claim_token),true);
    assert.equal(await db.complete(1,claimed.id,claimed.claim_token,true),true);
    await assert.rejects(db.inspect(99999,token));
    const report={branch_id:'br-twilight-term-abtld5ie',migration:'077',result:'passed',concurrent_nominations:12,concurrent_applications:12,concurrent_claims:8,
      persisted_nominations:1,consent_records:2,winning_claims:1,provider_requests:0,campaign_key:campaign};
    fs.writeFileSync(path.join(cwd,'tmp/giveaway-neon-rehearsal.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await pool.end(); }
}
main().catch(error=>{console.error(JSON.stringify({result:'failed',code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'REHEARSAL_FAILED'}));process.exitCode=1;});
