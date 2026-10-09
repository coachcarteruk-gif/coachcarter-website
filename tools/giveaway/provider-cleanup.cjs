// Internal erasure worker: removes only the scoped giveaway object, never contacts.
const {digest,identity}=require('./highlevel-sync.cjs');
const {contactReferences}=require('./privacy-references.cjs');
const OBJECT='custom_objects.giveaway_nominations';
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const fail=code=>{const e=Error(code);e.code=code;throw e;};
function createCleanupStore({transaction,config}) {
 config=structuredClone(config);
 if(!Number.isSafeInteger(config.schoolId)||config.schoolId<1||!valid(config.locationId)||!valid(config.campaignKey)||!['production','rehearsal'].includes(config.environment))fail('invalid_scope');
 const prefix=`${config.environment}:${config.schoolId}:${config.locationId}:${config.campaignKey}`;
 async function inspect(sql,id){
  const [row]=await sql`SELECT id,nomination,crm_state,erasure_requested_at FROM giveaway_nominations
    WHERE school_id=${config.schoolId} AND campaign_key=${config.campaignKey} AND id=${id} FOR UPDATE`;
  if(!row?.erasure_requested_at)fail('cleanup_not_requested');
  const jobs=await sql`SELECT id FROM giveaway_jobs WHERE school_id=${config.schoolId} AND nomination_id=${id}
    AND state IN ('claimed','dispatching','uncertain')`;
  if(jobs.length)fail('cleanup_unresolved_work');
  const mappings=await sql`SELECT id,crm_state FROM giveaway_nominations WHERE school_id=${config.schoolId}`;
  const subjects=['nominee','nominator'].map(role=>digest(identity(row.nomination[role])));
  for(const anchor of mappings)for(const entry of Object.values(anchor.crm_state?.contact_provisioning||{})){
   if(entry.location_id===config.locationId && (subjects.includes(entry.identity_hash)||anchor.id===id||entry.requester_id===id) &&
      ['claimed','dispatching','uncertain'].includes(entry.state))fail('cleanup_unresolved_work');
  }
  const operations=row.crm_state?.operations||{};
  if(Object.values(operations).some(op=>op.status!=='done'))fail('cleanup_unresolved_work');
  // Do not infer ownership from an arbitrary object ID or from the public request.
  const record=operations[prefix+':record:'+id]?.result;
  if(record&&!valid(record))fail('cleanup_invalid_mapping');
  if(Object.keys(operations).some(key=>!key.startsWith(prefix+':')))fail('cleanup_scope_conflict');
  const contacts=[...new Map(['nominee','nominator'].flatMap(role=>contactReferences(mappings,row.nomination[role],config.schoolId))
    .map(contact=>[contact.location_id+':'+contact.contact_id,contact])).values()];
  const plan={nomination_id:id,location_id:config.locationId,record_id:record||null,
   reference:`${config.environment}:${config.schoolId}:${config.campaignKey}:${id}`,contacts_to_preserve:contacts};
  return {plan,fingerprint:digest(plan),receipt:row.crm_state?.provider_cleanup};
 }
 async function locked(cb){return transaction(async sql=>{
  if(!(await sql`SELECT id FROM schools WHERE id=${config.schoolId} FOR NO KEY UPDATE`).length)fail('invalid_scope');
  return cb(sql);
 });}
 const save=(sql,id,value)=>sql`UPDATE giveaway_nominations SET crm_state=jsonb_set(crm_state,'{provider_cleanup}',${JSON.stringify(value)}::jsonb)
   WHERE school_id=${config.schoolId} AND campaign_key=${config.campaignKey} AND id=${id}`;
 return {
  inspect:id=>locked(sql=>inspect(sql,id)),
  begin:(id,fingerprint)=>locked(async sql=>{
   const current=await inspect(sql,id);
   if(current.fingerprint!==fingerprint||current.receipt)fail('cleanup_state_changed');
   await save(sql,id,{state:'dispatching',fingerprint,record_id:current.plan.record_id,started_at:new Date().toISOString()});
  }),
  finish:(id,fingerprint,state)=>locked(async sql=>{
   if(!['verified_absent','uncertain'].includes(state))fail('invalid_cleanup_state');
   const current=await inspect(sql,id);
   if(current.fingerprint!==fingerprint||current.receipt?.fingerprint!==fingerprint||!['dispatching','uncertain'].includes(current.receipt.state))fail('cleanup_state_changed');
   await save(sql,id,{...current.receipt,state,checked_at:new Date().toISOString()});
  }),
 };
}
function createCleanupWorker({store,transport,enabled=false}) {
 return async id=>{
  if(!enabled)return {status:'disabled'};
  const {plan,fingerprint,receipt}=await store.inspect(id);
  if(receipt?.fingerprint&&receipt.fingerprint!==fingerprint)fail('cleanup_state_changed');
  if(receipt?.state==='verified_absent')return {status:'record_removed',contacts_to_preserve:plan.contacts_to_preserve};
  const base=`/objects/${OBJECT}/records/${plan.record_id}`;
  const read=()=>transport.request('GET',base+'?locationId='+plan.location_id);
  const absent=result=>result?.status===404;
  if(receipt){
   // Read-only reconciliation: absence proves deletion, never authorizes another DELETE.
   if(plan.record_id && !absent(await read()))fail('cleanup_uncertain');
   await store.finish(id,fingerprint,'verified_absent');
   return {status:'record_removed',contacts_to_preserve:plan.contacts_to_preserve};
  }
  const before=plan.record_id?await read():{status:404};
  if(!absent(before) && (before?.record?.id!==plan.record_id || before.record.locationId!==plan.location_id || before.record.properties?.nomination_reference!==plan.reference))fail('cleanup_identity_conflict');
  await store.begin(id,fingerprint);
  try {
   if(!absent(before)){
    const deleted=await transport.request('DELETE',base);
    if(deleted?.success!==true||deleted.id!==plan.record_id)fail('cleanup_uncertain');
    if(!absent(await read()))fail('cleanup_uncertain');
   }
   await store.finish(id,fingerprint,'verified_absent');
   return {status:'record_removed',contacts_to_preserve:plan.contacts_to_preserve};
  }catch{
   try{await store.finish(id,fingerprint,'uncertain');}catch{}
   fail('cleanup_uncertain');
  }
 };
}
module.exports={createCleanupStore,createCleanupWorker};

function createCleanupTransport({apiKey,locationId,enabled=false,fetchImpl=fetch}) {
 if(!valid(locationId))fail('invalid_scope');
 return {async request(method,path){
  if(!enabled||!apiKey)fail('cleanup_disabled');
  const base='/objects/'+OBJECT+'/records/';
  const suffix=method==='GET'?'?locationId='+locationId:'';
  const id=path.startsWith(base)?path.slice(base.length, suffix?-suffix.length:undefined):'';
  if(!['GET','DELETE'].includes(method)||!valid(id)||path!==base+id+suffix)fail('cleanup_invalid_request');
  try {
   const response=await fetchImpl('https://services.leadconnectorhq.com'+path,{method,
    headers:{Authorization:'Bearer '+apiKey,Version:'2023-02-21'},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(method==='GET'&&response.status===404)return {status:404};
   if(!response.ok)fail('cleanup_provider_failed');
   return await response.json();
  }catch{fail(method==='GET'?'cleanup_read_failed':'cleanup_uncertain');}
 }};
}
module.exports.createCleanupTransport=createCleanupTransport;
