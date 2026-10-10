const {verifyCronAuth}=require('./_auth');
const {withCronLock}=require('./_cron-lock');
const {Pool}=require('pg');
const {createDatabase,poolTransactions,tagged,tokenVault}=require('../tools/giveaway/database.cjs');
const {runNextIntegration,scheduledCrmConfig}=require('../tools/giveaway/integration.cjs');

// CRM-only worker, one nomination/job per tick. Explicit environment and school
// gates are required even when the deployment installs the cron schedule.
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:true,code:'METHOD'});
  if(!verifyCronAuth(req))return res.status(401).json({error:true,code:'AUTH'});
  if(process.env.GIVEAWAY_WORKER_ENABLED!=='true'||process.env.GIVEAWAY_AUTOMATION_ENABLED!=='true')return res.json({ok:true,status:'disabled'});
  const schoolId=Number(process.env.GIVEAWAY_WORKER_SCHOOL_ID);
  if(!Number.isSafeInteger(schoolId)||schoolId<1||!/^[a-f0-9]{64}$/i.test(process.env.GIVEAWAY_ENCRYPTION_KEY||''))return res.status(503).json({error:true,code:'CONFIGURATION'});
  return withCronLock(req,res,'giveaway.integrations.'+schoolId,600,async()=>{
    const pool=new Pool({connectionString:process.env.POSTGRES_URL,max:3,connectionTimeoutMillis:10000});
    try{
      const sql=tagged(pool),transaction=poolTransactions(pool),vault=tokenVault(Buffer.from(process.env.GIVEAWAY_ENCRYPTION_KEY,'hex'));
      const [row]=await sql`SELECT config->'giveaway' AS giveaway FROM schools WHERE id=${schoolId}`;
      const settings=row?.giveaway;
      if(settings?.integration?.enabled!==true)return {ok:true,status:'disabled'};
      const config=scheduledCrmConfig(settings,schoolId);
      const result=await runNextIntegration({db:createDatabase({transaction,vault}),sql,transaction,vault,config,
        credentials:{highlevel:process.env.HIGHLEVEL_GIVEAWAY_API_KEY}});
      return {ok:true,...result};
    }finally{await pool.end();}
  });
};
