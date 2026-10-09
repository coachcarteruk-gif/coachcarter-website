// Local fictional SQL preview of the real API. Never loads any .env file.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'); const {createDatabase,tagged,tokenVault}=require('./database.cjs'); const {createHandler}=require('../../api/_giveaway-handler');
async function start(){
 const root=path.resolve(__dirname,'../..'),pg=new PGlite(),port=61531,origin=`http://127.0.0.1:${port}`;
 await pg.exec("CREATE TABLE schools(id INTEGER PRIMARY KEY,config JSONB,primary_host TEXT,slug TEXT,active BOOLEAN); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,request_count INTEGER,window_start TIMESTAMPTZ)");
 await pg.exec(fs.readFileSync(path.join(root,'db/migrations/077_giveaway_storage.sql'),'utf8'));
 await pg.exec(fs.readFileSync(path.join(root,'db/migrations/078_giveaway_privacy.sql'),'utf8'));
 await pg.query('INSERT INTO schools VALUES(1,$1::jsonb,$2,$3,true)',[JSON.stringify({giveaway:{enabled:true,campaign_key:'fictional',origin}}),'127.0.0.1','coachcarter']);
 await pg.exec("INSERT INTO giveaway_campaigns(school_id,campaign_key,closes_at,retain_until,enabled) VALUES(1,'fictional','2026-10-11T21:00:00Z','2027-01-09T21:00:00Z',true)");
 const vault=tokenVault(crypto.randomBytes(32)),transaction=cb=>pg.transaction(client=>cb(tagged(client))),db=createDatabase({transaction,vault});
 await db.nominate(1,'fictional',{submission_key:crypto.randomUUID(),nominee_name:'Alex Fictional',nominee_phone:'07700900123',nominee_email:'alex@example.test',nominator_name:'Jamie Fictional',nominator_phone:'07700900456',nominator_email:'jamie@example.test',reason:'Fictional API preview nomination.',permission:true});
 const job=(await pg.query("SELECT * FROM giveaway_jobs WHERE kind='invitation'")).rows[0];
 const token=vault.open(job.payload.sealed_token,`1:${job.nomination_id}`);
 fs.writeFileSync(path.join(root,'tmp/giveaway-api-invitation.txt'),origin+'/giveaway/apply.html#'+token);
 const handler=createHandler({db,sql:tagged(pg),vault,enabled:true});
 http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end();}
  const url=new URL(req.url,origin); res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(url.pathname==='/api/giveaway'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>20000){res.writeHead(413);return res.end();}}
   try{req.body=body?JSON.parse(body):{};}catch{res.writeHead(400);return res.end();}
   req.query=Object.fromEntries(url.searchParams);res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res;};
   return handler(req,res);
  }
  const publicRoot=path.join(root,'public'), filename=path.resolve(publicRoot,'.'+(url.pathname==='/'?'/giveaway/index.html':url.pathname));
  if(!filename.startsWith(publicRoot+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(filename)]||'application/octet-stream');fs.createReadStream(filename).pipe(res);
 }).listen(port,'127.0.0.1',()=>console.log('Fictional SQL/API preview: '+origin+'/giveaway/index.html'));
}
start().catch(()=>{console.error('SQL API preview could not start');process.exitCode=1;});
