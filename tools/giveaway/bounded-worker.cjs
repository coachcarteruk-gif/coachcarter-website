const { processOne, crmHandler } = require('./database-worker.cjs');
const { invitationHandler } = require('./invitation.cjs');
const { createContactMatcher } = require('./contact-matching.cjs');

// Operator composition, one nomination and one job per call. No environment reads,
// credentials, routes, schedules or activation on import. Inject reviewed providers.
function createBoundedWorker({ db, config, vault, invitationTransport, crmTransport,
  search, invitationRequested, providerAllowsInvitation, now }) {
  config=structuredClone(config);
  if (!Number.isSafeInteger(config.schoolId) || config.schoolId<1 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(config.campaignKey || '') ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(config.nominationId || ''))
    throw Error('A bounded worker scope is required');
  const claimScope={campaignKey:config.campaignKey,nominationId:config.nominationId};
  const scope={schoolId:config.schoolId,campaignKey:config.campaignKey};
  const authorized=async source => {
    if (source.school_id!==scope.schoolId || source.campaign_key!==scope.campaignKey || source.id!==config.nominationId) return false;
    // Sharing permission is not an invitation request. Both external checks must
    // return an explicit fresh true; missing adapters, failures and unknowns block.
    if (typeof invitationRequested!=='function' || typeof providerAllowsInvitation!=='function') return false;
    return await db.invitationUnblocked(scope.schoolId,source.id)===true &&
      await invitationRequested(source)===true && await providerAllowsInvitation(source)===true;
  };
  return Object.freeze({async run(kind) {
    if (!['invitation','crm'].includes(kind)) throw Error('Unsupported worker kind');
    if (config.enabled!==true || config[kind]?.enabled!==true) return {status:'disabled'};
    let handler;
    if (kind==='invitation') {
      handler=invitationHandler({config:{...config.invitation,...scope},vault,transport:invitationTransport,maySend:authorized,now});
      handler.prepare=async source=>{
        if (await authorized(source)!==true) {
          const error=Error('Invitation not authorized');error.code='invitation_not_authorized';throw error;
        }
      };
    } else {
      const crmConfig={...config.crm,...scope};
      handler=crmHandler({config:crmConfig,transport:crmTransport,now,
        plansFor:createContactMatcher({config:crmConfig,search,enabled:true})});
    }
    return processOne({db,schoolId:scope.schoolId,kind,handler,enabled:true,claimScope});
  }});
}
module.exports={createBoundedWorker};
