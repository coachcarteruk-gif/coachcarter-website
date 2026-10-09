const {createBoundedWorker}=require('./bounded-worker.cjs');
const {createContactProvisioner,createProvisioningStore}=require('./contact-provisioning.cjs');
const {createContactSearch}=require('./contact-matching.cjs');
const {createHttpTransport}=require('./highlevel-sync.cjs');
const {resendTransport}=require('./invitation.cjs');
const {subjectHash}=require('../../api/_giveaway-privacy');
const {WORDING}=require('./domain.cjs');

// No automatic retries or writes on import. A failed lookup never authorizes email.
function resendPermission({apiKey,fetchImpl=fetch}) {
  return async source=>{
    if (!apiKey) return false;
    const email=source.nomination.nominee.email.trim().toLowerCase();
    async function read(path) {
      const r=await fetchImpl('https://api.resend.com'+path,{headers:{Authorization:'Bearer '+apiKey},
        redirect:'error',signal:AbortSignal.timeout(10000)});
      return {status:r.status,body:await r.json()};
    }
    try {
      const suppression=await read('/suppressions/'+encodeURIComponent(email));
      if (suppression.status!==404 || suppression.body.name!=='not_found' || suppression.body.message!=='Suppression not found') return false;
      const contact=await read('/contacts/'+encodeURIComponent(email));
      return contact.status===404 && contact.body.name==='not_found' && contact.body.message==='Contact not found' ||
        contact.status===200 && contact.body.email===email && contact.body.unsubscribed===false;
    } catch {return false;}
  };
}
function requested(source) {
  const evidence=source.nomination.permission?.invitation_request;
  return !!evidence && evidence.school_id===source.school_id && evidence.campaign_key===source.campaign_key &&
    evidence.nomination_id===source.id && evidence.email_hash===subjectHash('email',source.nomination.nominee.email) &&
    Number.isFinite(Date.parse(evidence.requested_at)) && typeof evidence.reference==='string' && evidence.reference.length>=3;
}
function nominationPermitsInvitation(source) {
  const permission=source.nomination.permission;
  return permission?.version==='giveaway-v1' && permission.wording===WORDING.permission &&
    Number.isFinite(Date.parse(permission.accepted_at));
}

async function runIntegration({db,sql,transaction,vault,config,credentials={},providers={}}) {
  config=structuredClone(config);
  if (config.enabled!==true) return {status:'disabled'};
  const {schoolId,campaignKey,nominationId}=config;
  // Validate the fixed scope before performing SQL or contacting any provider.
  if (!Number.isSafeInteger(schoolId)||schoolId<1||!/^[A-Za-z0-9_-]{1,100}$/.test(campaignKey||'')||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(nominationId||'')) throw Error('Invalid integration scope');
  const [source]=await sql`SELECT id FROM giveaway_nominations WHERE school_id=${schoolId} AND campaign_key=${campaignKey}
    AND id=${nominationId} AND erasure_requested_at IS NULL`;
  if (!source) return {status:'unavailable'};
  const held=await sql`SELECT state FROM giveaway_jobs WHERE school_id=${schoolId} AND nomination_id=${nominationId}
    AND (state IN ('uncertain','dispatching') OR (state='claimed' AND lease_until>clock_timestamp()))`;
  if(held.length)return {status:held.some(j=>j.state!=='claimed')?'review_required':'busy'};
  const crmConfig={...config.crm,schoolId,campaignKey};
  let search,crmTransport;
  if (config.crm?.enabled===true) {
    if (!providers.search && !credentials.highlevel) return {status:'configuration_required'};
    search=providers.search || createContactSearch({apiKey:credentials.highlevel,locationId:crmConfig.locationId,enabled:true});
    crmTransport=providers.crmTransport || createHttpTransport({apiKey:credentials.highlevel,locationId:crmConfig.locationId,
      associationIds:Object.values(crmConfig.associations||{}).map(a=>a.id),writeEnabled:true});
  }
  if (config.invitation?.enabled===true && !providers.invitationTransport && !credentials.resend) return {status:'configuration_required'};
  const worker=createBoundedWorker({db,config,vault,search,crmTransport,
    invitationRequested:config.invitation?.permissionMode==='nomination'?nominationPermitsInvitation:requested,
    invitationTransport:providers.invitationTransport || resendTransport({apiKey:credentials.resend,enabled:config.invitation?.enabled===true}),
    providerAllowsInvitation:providers.providerAllowsInvitation || resendPermission({apiKey:credentials.resend})});
  const invitation=await worker.run('invitation');
  // Stop on ambiguity; do not proceed to other mutations when operator review is needed.
  if (['uncertain','claim_lost'].includes(invitation.status)) return {status:'review_required',invitation};
  if (config.crm?.enabled===true && config.provisioning?.enabled===true) {
    const provision=createContactProvisioner({config:crmConfig,store:createProvisioningStore({transaction}),search,transport:crmTransport,
      enabled:true,creationApproved:config.provisioning.creationApproved===true,reviewReference:config.provisioning.reviewReference});
    try {for (const role of ['nominee','nominator']) await provision({nominationId,role});}
    catch {return {status:'review_required',invitation,crm:{status:'provisioning_review_required'}};}
  }
  const crm=await worker.run('crm');
  return {status:[invitation,crm].some(r=>['uncertain','claim_lost'].includes(r.status))?'review_required':'processed',invitation,crm};
}
async function runNextIntegration(options) {
  const {sql,config}=options;
  if(config.enabled!==true)return {status:'disabled'};
  const {schoolId,campaignKey}=config;
  if(!Number.isSafeInteger(schoolId)||schoolId<1||!/^[A-Za-z0-9_-]{1,100}$/.test(campaignKey||''))throw Error('Invalid integration scope');
  // Skip held work rather than letting one uncertain nomination starve the queue.
  const [next]=await sql`SELECT n.id FROM giveaway_jobs j JOIN giveaway_nominations n ON n.school_id=j.school_id AND n.id=j.nomination_id
    WHERE n.school_id=${schoolId} AND n.campaign_key=${campaignKey} AND n.erasure_requested_at IS NULL
    AND (j.state='pending' OR (j.state='claimed' AND j.lease_until<clock_timestamp())) AND j.available_at<=clock_timestamp()
    AND ((j.kind='crm' AND ${config.crm?.enabled===true}) OR (j.kind='invitation' AND ${config.invitation?.enabled===true}
      AND n.application IS NULL AND n.nomination->'permission'->'invitation_request' IS NOT NULL))
    AND NOT EXISTS(SELECT 1 FROM giveaway_jobs held WHERE held.school_id=n.school_id AND held.nomination_id=n.id
      AND (held.state IN ('dispatching','uncertain') OR (held.state='claimed' AND held.lease_until>clock_timestamp())))
    ORDER BY j.available_at,j.created_at,j.id LIMIT 1`;
  return next?runIntegration({...options,config:{...config,nominationId:next.id}}):{status:'idle'};
}
module.exports={runIntegration,runNextIntegration,resendPermission,requested,nominationPermitsInvitation};
