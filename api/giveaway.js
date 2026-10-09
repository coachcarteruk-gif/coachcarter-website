const { Pool } = require('pg');
const { createDatabase, poolTransactions, tagged, tokenVault } = require('../tools/giveaway/database.cjs');
const { createHandler } = require('./_giveaway-handler');
const { reportError } = require('./_error-alert');
let handler;
module.exports = async (req,res) => {
  if (process.env.GIVEAWAY_API_ENABLED !== 'true') return res.status(404).json({error:true,code:'DISABLED',message:'This giveaway is not available.'});
  try {
    if (!handler) {
      if (!/^[0-9a-f]{64}$/i.test(process.env.GIVEAWAY_ENCRYPTION_KEY || '')) throw Error('Missing encryption key');
      const pool = new Pool({connectionString:process.env.POSTGRES_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
      const transaction = poolTransactions(pool), vault = tokenVault(Buffer.from(process.env.GIVEAWAY_ENCRYPTION_KEY,'hex'));
      handler = createHandler({db:createDatabase({transaction,vault}),sql:tagged(pool),vault,enabled:true,onError:error=>reportError('/api/giveaway',error)});
    }
    return await handler(req,res);
  } catch {
    return res.status(503).json({error:true,code:'UNAVAILABLE',message:'The giveaway is temporarily unavailable.'});
  }
};
