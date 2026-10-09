const { Pool } = require('pg');
const { createDatabase, poolTransactions, tagged, tokenVault } = require('../tools/giveaway/database.cjs');
const { createHandler } = require('./_giveaway-handler');
const { reportError } = require('./_error-alert');
const { runIntegration } = require('../tools/giveaway/integration.cjs');
let handler;
module.exports = async (req,res) => {
  if (process.env.GIVEAWAY_API_ENABLED !== 'true') return res.status(404).json({error:true,code:'DISABLED',message:'This giveaway is not available.'});
  try {
    if (!handler) {
      if (!/^[0-9a-f]{64}$/i.test(process.env.GIVEAWAY_ENCRYPTION_KEY || '')) throw Error('Missing encryption key');
      const pool = new Pool({connectionString:process.env.POSTGRES_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
      const transaction = poolTransactions(pool), vault = tokenVault(Buffer.from(process.env.GIVEAWAY_ENCRYPTION_KEY,'hex'));
      const db=createDatabase({transaction,vault}),sql=tagged(pool);
      handler = createHandler({db,sql,vault,enabled:true,onError:error=>reportError('/api/giveaway',error),
        runIntegration:async config=>{
          if(process.env.GIVEAWAY_WORKER_ENABLED!=='true')return {status:'disabled'};
          return runIntegration({db,sql,transaction,vault,config,credentials:{resend:process.env.RESEND_API_KEY,highlevel:process.env.HIGHLEVEL_GIVEAWAY_API_KEY}});
        }});
    }
    return await handler(req,res);
  } catch {
    return res.status(503).json({error:true,code:'UNAVAILABLE',message:'The giveaway is temporarily unavailable.'});
  }
};
