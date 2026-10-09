const {randomUUID}=require('node:crypto');
const {identity,digest}=require('./highlevel-sync.cjs');
const {createContactMatcher}=require('./contact-matching.cjs');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const fail=code=>{const e=new Error(code);e.code=code;throw e;};

// Durable shared identity reservations live in existing crm_state, never in memory.
// Brief school-row locks serialize reservations across nominations/campaigns.
// No network work takes place inside a transaction.
function createProvisioningStore({transaction}) {
 const lock=async(sql,school)=>{
  if(!Number.isSafeInteger(school)||school<1)fail('invalid_scope');
  if(!(await sql`SELECT id FROM schools WHERE id=${school} FOR NO KEY UPDATE`).length)fail('invalid_scope');
 };
 const save=async(sql,school,id,key,entry)=>sql`UPDATE giveaway_nominations
  SET crm_state=jsonb_set(crm_state,'{contact_provisioning}',COALESCE(crm_state->'contact_provisioning','{}'::jsonb)||${JSON.stringify({[key]:entry})}::jsonb)
  WHERE school_id=${school} AND id=${id}`;
 async function owned(sql,school,reservation) {
  const [row]=await sql`SELECT crm_state,erasure_requested_at FROM giveaway_nominations WHERE school_id=${school} AND id=${reservation.owner_id} FOR UPDATE`;
  const entry=row?.crm_state?.contact_provisioning?.[reservation.key];
  if(!entry || entry.token!==reservation.token)fail('provisioning_ownership_lost');
  return {row,entry};
 }
 return {
  async reserve({schoolId,locationId,campaignKey,nominationId,role,reviewReference}) {
   if(!validId(locationId)||!validId(campaignKey)||!['nominee','nominator'].includes(role))fail('invalid_scope');
   return transaction(async sql=>{
    await lock(sql,schoolId);
    const [source]=await sql`SELECT nomination,campaign_key,erasure_requested_at FROM giveaway_nominations WHERE school_id=${schoolId} AND id=${nominationId} FOR UPDATE`;
    if(!source||source.campaign_key!==campaignKey||source.erasure_requested_at||!source.nomination.permission?.accepted_at)fail('provisioning_unavailable');
    const person=identity(source.nomination[role]),subject=digest(person),key=digest({locationId,subject});
    const [{now}]=await sql`SELECT clock_timestamp() AS now`;
    const rows=await sql`SELECT id,crm_state->'contact_provisioning' AS ledger,erasure_requested_at FROM giveaway_nominations
      WHERE school_id=${schoolId} AND crm_state ? 'contact_provisioning' FOR UPDATE`;
    let ownerId=nominationId,previous;
    for(const row of rows)for(const [storedKey,entry] of Object.entries(row.ledger||{})){
     if(entry.location_id!==locationId)continue;
     if(entry.identity_hash!==subject && (entry.email_hash===digest(person.email)||entry.phone_hash===digest(person.phone)))fail('contact_identity_conflict');
     if(storedKey===key){
      if(previous)fail('provisioning_journal_conflict');
      previous=entry;ownerId=row.id;
      if(row.erasure_requested_at)fail('provisioning_privacy_hold');
     }
    }
    const base={key,owner_id:ownerId,requester_id:nominationId,person,name:String(source.nomination[role].name||'').slice(0,160)};
    if(previous?.state==='succeeded')return {...base,status:'existing',contact_id:previous.contact_id};
    if(previous && previous.state!=='claimed')fail('provisioning_uncertain');
    if(previous && Date.parse(previous.lease_until)>new Date(now).getTime())fail('provisioning_busy');
    const entry={location_id:locationId,identity_hash:subject,email_hash:digest(person.email),phone_hash:digest(person.phone),
     state:'claimed',requester_id:nominationId,token:randomUUID(),review_reference:reviewReference,lease_until:new Date(new Date(now).getTime()+120000).toISOString()};
    await save(sql,schoolId,ownerId,key,entry);
    return {...base,status:'claimed',token:entry.token};
   });
  },
  async begin(school,reservation) {
   return transaction(async sql=>{
    await lock(sql,school);const {row,entry}=await owned(sql,school,reservation);
    const [requester]=await sql`SELECT erasure_requested_at FROM giveaway_nominations WHERE school_id=${school} AND id=${reservation.requester_id} FOR UPDATE`;
    const [{now}]=await sql`SELECT clock_timestamp() AS now`;
    if(!requester||requester.erasure_requested_at||row.erasure_requested_at||entry.state!=='claimed'||Date.parse(entry.lease_until)<=new Date(now).getTime())fail('provisioning_ownership_lost');
    entry.state='dispatching';entry.started_at=new Date(now).toISOString();
    await save(sql,school,reservation.owner_id,reservation.key,entry);
   });
  },
  async finish(school,reservation,contactId,matched=false) {
   if(!validId(contactId))fail('invalid_contact_receipt');
   return transaction(async sql=>{
    await lock(sql,school);const {row,entry}=await owned(sql,school,reservation);
    const [{now}]=await sql`SELECT clock_timestamp() AS now`;
    if(entry.state!==(matched?'claimed':'dispatching') || (matched && (row.erasure_requested_at||Date.parse(entry.lease_until)<=new Date(now).getTime())))fail('provisioning_ownership_lost');
    entry.state='succeeded';entry.contact_id=contactId;entry.outcome=matched?'matched_existing':'created';entry.completed_at=new Date(now).toISOString();
    // A late receipt remains evidence even if erasure was requested during creation.
    await save(sql,school,reservation.owner_id,reservation.key,entry);
   });
  },
  async uncertain(school,reservation) {
   return transaction(async sql=>{
    await lock(sql,school);const {entry}=await owned(sql,school,reservation);
    if(entry.state!=='dispatching')return false;
    entry.state='uncertain';await save(sql,school,reservation.owner_id,reservation.key,entry);return true;
   });
  },
 };
}

// Run separately BEFORE the read-only CRM preparation, never inside plansFor.
// Both gates are explicit. Caller must have reviewed duplicate/workflow behaviour.
function createContactProvisioner({config,store,search,transport,enabled=false,creationApproved=false,reviewReference}) {
 config=structuredClone(config);
 if(!Number.isSafeInteger(config.schoolId)||config.schoolId<1||!validId(config.locationId)||!validId(config.campaignKey))fail('invalid_scope');
 const match=createContactMatcher({config,search,enabled:true});
 return async({nominationId,role})=>{
  if(!enabled||!creationApproved||typeof reviewReference!=='string'||!/^[A-Za-z0-9 _.-]{3,100}$/.test(reviewReference))fail('provisioning_disabled');
  const r=await store.reserve({...config,nominationId,role,reviewReference});
  const source={kind:'crm',school_id:config.schoolId,campaign_key:config.campaignKey,
   nomination:{permission:{accepted_at:'verified-in-reservation'},nominee:r.person,nominator:r.person}};
  let plan;
  try {plan=(await match(source)).nominee;}
  catch(e){if(e.code!=='contact_not_found')throw e;}
  if(r.status==='existing'){
   if(!plan||plan.id!==r.contact_id)fail('contact_identity_conflict');
   return plan;
  }
  if(plan){await store.finish(config.schoolId,r,plan.id,true);return plan;}
  await store.begin(config.schoolId,r);
  try {
   const {contact}=await transport.request('POST','/contacts/',{locationId:config.locationId,name:r.name,...r.person,dnd:true,source:'CoachCarter giveaway'});
   if(!contact||!validId(contact.id)||contact.locationId!==config.locationId||digest(identity(contact))!==digest(r.person)||contact.dnd!==true)fail('invalid_contact_receipt');
   await store.finish(config.schoolId,r,contact.id);
   return {kind:'existing',id:contact.id,schoolId:config.schoolId,locationId:config.locationId,identityHash:digest(r.person)};
  }catch{
   try {await store.uncertain(config.schoolId,r);}catch{/* Persisted dispatch intent still blocks all retries. */}
   fail('provisioning_uncertain');
  }
 };
}
module.exports={createProvisioningStore,createContactProvisioner};
