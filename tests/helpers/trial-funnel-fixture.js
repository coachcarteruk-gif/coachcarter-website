const { Pool, types } = require('pg');
const path = require('path');
const fs = require('fs');
// Preserve database timestamps exactly for optimistic concurrency assertions.
types.setTypeParser(1184, value => value);
types.setTypeParser(1082, value => value);
const DEFAULT_URL = 'postgresql://postgres@127.0.0.1:55432/trial_funnel_test';
function database() {
  const connectionString = process.env.TRIAL_FUNNEL_DB_URL || DEFAULT_URL;
  const url = new URL(connectionString);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/trial_funnel_test') throw new Error('Only the dedicated loopback trial_funnel_test database is allowed');
  const pool = new Pool({ connectionString });
  function sql(parts, ...values) {
    const text = typeof parts === 'string' ? parts : parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');
    const args = typeof parts === 'string' ? (values[0] || []) : values;
    return { text, values:args, then(resolve,reject) { return pool.query(text,args).then(r=>r.rows).then(resolve,reject); } };
  }
  sql.transaction = async (queries) => {
    const client=await pool.connect();try{await client.query('BEGIN');const rows=[];for(const q of queries)rows.push((await client.query(q.text,q.values)).rows);await client.query('COMMIT');return rows;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  };
  return {pool,sql};
}
let installed;
function installMocks() {
  if(installed)return installed;
  const db=database();
  process.env.POSTGRES_URL=DEFAULT_URL;
  process.env.JWT_SECRET='isolated-trial-funnel-fixture-secret';
  process.env.STRIPE_SECRET_KEY='sk_test_isolated_no_provider';
  process.env.SMTP_HOST='invalid'; process.env.SMTP_PASS='invalid';
  const Module=require('module'), original=Module._load;
  const state={messages:[],errors:[],failEmail:false};
  Module._load=function(request,parent,isMain){
    if(request==='@neondatabase/serverless')return {neon:()=>db.sql};
    if(request==='nodemailer')return {createTransport:()=>({sendMail:async m=>{state.messages.push(m);if(state.failEmail)throw new Error('Mock email failure');return {messageId:'fixture'};}})};
    if(request.endsWith('/_whatsapp') || request==='./_whatsapp')return {sendWhatsApp:async()=>({mocked:true})};
    if(request.endsWith('/_error-alert') || request==='./_error-alert')return {reportError:(_path,e)=>state.errors.push({path:_path,code:e.code,message:e.message})};
    if(request.endsWith('/_stripe-clients') || request==='./_stripe-clients')return {createPlatformStripeClient:()=>new Proxy({}, {get(){throw new Error('Stripe forbidden in trial fixture');}}),STRIPE_CLIENT_PURPOSES:{PAYMENTS:'payments'}};
    return original.apply(this,arguments);
  };
  const originalFetch=global.fetch;
  global.fetch=async function(url,...args){if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(String(url)))throw new Error('External network disabled in isolated trial preview');return originalFetch(url,...args);};
  installed={...db,state,restore(){Module._load=original;global.fetch=originalFetch;}};return installed;
}
async function closeMocks() {
  if(!installed)return;
  const active=installed;installed=null;active.restore();
  const apiRoot=path.resolve(__dirname,'../../api')+path.sep;
  for(const filename of Object.keys(require.cache))if(filename.startsWith(apiRoot))delete require.cache[filename];
  await active.pool.end();
}
async function bootstrap() {
  const {pool}=database();
  try {
    // The aggregate assigns its audit trigger to Neon's owner role. Recreate only
    // its required privileges in this dedicated local database.
    await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='neondb_owner') THEN CREATE ROLE neondb_owner; END IF; END $$");
    const present=await pool.query("SELECT to_regclass('public.trial_booking_intakes') AS t");
    if(!present.rows[0].t)await pool.query(fs.readFileSync(path.join(__dirname,'../../db/migration.sql'),'utf8'));
    else await pool.query(fs.readFileSync(path.join(__dirname,'../../db/migrations/070_trial_booking_intakes.sql'),'utf8'));
    await pool.query('GRANT INSERT ON balance_audit TO neondb_owner');
    await pool.query('GRANT USAGE ON SEQUENCE balance_audit_id_seq TO neondb_owner');
  } finally {await pool.end();}
}
async function seed(sql, suffix = Date.now().toString()) {
  await sql`UPDATE schools SET config=jsonb_set(COALESCE(config,'{}'),'{test_date_trial_funnel_enabled}','true') WHERE id=1`;
  const [instructor]=await sql`INSERT INTO instructors(name,email,school_id,active,min_booking_notice_hours,buffer_minutes,offered_lesson_types)
    VALUES ('Trial fixture instructor',${'instructor-'+suffix+'@example.invalid'},1,true,0,0,'["trial","standard"]'::jsonb) RETURNING id`;
  for(let day=0;day<7;day++)await sql`INSERT INTO instructor_availability(instructor_id,school_id,day_of_week,start_time,end_time,transmission_type)
    VALUES (${instructor.id},1,${day},'08:00','20:00','manual')`;
  const [type]=await sql`SELECT id FROM lesson_types WHERE school_id=1 AND slug='trial'`;
  if(type)await sql`UPDATE lesson_types SET active=true,duration_minutes=60 WHERE id=${type.id} AND school_id=1`;
  else await sql`INSERT INTO lesson_types(slug,name,duration_minutes,price_pence,school_id,active) VALUES ('trial','Free trial',60,0,1,true)`;
  const date=new Date();date.setUTCDate(date.getUTCDate()+7);
  return {instructorId:instructor.id,date:date.toISOString().slice(0,10),suffix};
}
function request(handler,{action,body={},query={},role=null,id=null,schoolId=1,method='POST'}) {
  const jwt=require('jsonwebtoken');const headers={host:'localhost','x-forwarded-for':'127.0.0.1'};
  if(role){headers.cookie=`cc_${role}=${jwt.sign({id,role,school_id:schoolId},process.env.JWT_SECRET)}; cc_csrf=fixture`;headers['x-csrf-token']='fixture';}
  const req={method,url:'/api/test',query:{action,...query},body,headers,socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},setHeader(k,v){this.headers[k]=v;},on(){},send(b){this.body=b;return this;},redirect(n,v){this.statusCode=n;this.headers.Location=v;return this;}};
  return Promise.resolve(handler(req,res)).then(()=>res);
}
module.exports={database,installMocks,closeMocks,bootstrap,seed,request};
