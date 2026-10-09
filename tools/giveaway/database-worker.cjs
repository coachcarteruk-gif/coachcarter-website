const { createSync } = require('./highlevel-sync.cjs');
// Call only from a scoped server worker. No environment flags, timers or sends on import.
async function processOne({ db, schoolId, kind, handler, enabled = false }) {
  if (!enabled) return { status: 'disabled' };
  if (typeof handler !== 'function') throw new Error('A reviewed handler is required');
  const job = await db.claim(schoolId, kind);
  if (!job) return { status: 'idle' };
  let prepared;
  if (typeof handler.prepare === 'function') {
    // Trusted preparation MUST be read-only. No provider mutation before dispatch.
    try { prepared = await handler.prepare(await db.loadClaim(schoolId,job.id,job.claim_token)); }
    catch (error) {
      const allowed=['contact_matching_disabled','contact_not_found','contact_multiple_matches','contact_identity_conflict','contact_lookup_failed'];
      const reason=allowed.includes(error.code)?error.code:'contact_review_required';
      const deferred=await db.deferClaim(schoolId,job.id,job.claim_token);
      return {status:deferred?'deferred':'claim_lost',reason,job_id:job.id};
    }
  }
  if (!await db.beginDispatch(schoolId, job.id, job.claim_token)) return { status: 'claim_lost' };
  try {
    const source = await db.loadDispatch(schoolId, job.id, job.claim_token);
    const result = await handler(source, state => db.saveCrmState(schoolId, job.id, job.claim_token, state), prepared);
    // Handlers explicitly confirm acceptance; an arbitrary successful return is not proof.
    const accepted = result?.accepted === true;
    const saved = await db.complete(schoolId, job.id, job.claim_token, accepted, result?.receipt);
    return { status: saved && accepted ? 'succeeded' : 'uncertain', job_id: job.id };
  } catch {
    // A storage error may prevent this receipt; the expired dispatch then stays uncertain.
    try { await db.complete(schoolId, job.id, job.claim_token, false); } catch { /* never replay */ }
    return { status: 'uncertain', job_id: job.id };
  }
}
function crmHandler({ config, transport, plansFor, now }) {
  config=structuredClone(config);
  const prepare=async source=>{
    if (source.kind !== 'crm' || source.school_id !== config.schoolId || source.campaign_key !== config.campaignKey) throw new Error('CRM scope mismatch');
    if(config.enabled!==true) throw new Error('CRM disabled');
    const plans = await plansFor(source);
    // Persistent journals are per nomination. Until a shared contact-provisioning queue
    // exists, require reviewed existing IDs so two nominations cannot create one person twice.
    if (!['nominee', 'nominator'].every(role => plans?.[role]?.kind === 'existing')) throw new Error('Reviewed existing CRM contacts required');
    return plans;
  };
  const handler=async (source, persist, prepared) => {
    if (source.kind !== 'crm' || source.school_id !== config.schoolId || source.campaign_key !== config.campaignKey) throw new Error('CRM scope mismatch');
    const plans=prepared || await prepare(source);
    const store = { data: {
      nominations: [{ ...source.nomination, id: source.id, school_id: source.school_id, application: source.application }],
      outbox: [{ nomination_id: source.id, school_id: source.school_id, status: source.invitation_status }],
      giveaway_crm: source.crm_state.operations ? source.crm_state : { operations: {}, contacts: {} },
    }, async save() { await persist(this.data.giveaway_crm); } };
    const result = await createSync({ store, config, transport, now }).run(source.id, plans);
    return { accepted: result.status === 'synced' };
  };
  handler.prepare=prepare;
  return handler;
}
module.exports = { processOne, crmHandler };
