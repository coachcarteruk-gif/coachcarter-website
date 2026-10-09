// Internal privacy helpers. Callers provide authenticated school scope.
const {identity,digest}=require('./highlevel-sync.cjs');
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
function contactReferences(rows,person,school) {
 const who=identity(person),subject=digest(who),found=new Map();
 for(const row of rows){
  for(const entry of Object.values(row.crm_state?.contact_provisioning||{})){
   if(entry.identity_hash!==subject||!valid(entry.contact_id)||!valid(entry.location_id))continue;
   found.set(entry.location_id+':'+entry.contact_id,{provider:'HighLevel',location_id:entry.location_id,contact_id:entry.contact_id});
  }
  for(const [key,entry] of Object.entries(row.crm_state?.contacts||{})){
   const [environment,owner,location]=key.split(':');
   if(!['rehearsal','production'].includes(environment)||owner!==String(school)||!valid(location)||!key.endsWith(':'+subject)||
      entry.email_hash!==digest(who.email)||entry.phone_hash!==digest(who.phone)||!valid(entry.id))continue;
   found.set(location+':'+entry.id,{provider:'HighLevel',location_id:location,contact_id:entry.id});
  }
 }
 return [...found.values()];
}
module.exports={contactReferences};
