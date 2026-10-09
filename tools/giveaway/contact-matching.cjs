const { identity, digest } = require('./highlevel-sync.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
class ContactMatchError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ContactMatchError(code); };

// Search is a read-only, exact-field lookup returning {contacts, total}.
// Do not use GHL upsert/duplicate lookup: either can prefer one identifier.
function createContactMatcher({ config, search, enabled = false }) {
  config = structuredClone(config);
  if (!Number.isSafeInteger(config.schoolId) || config.schoolId < 1 ||
      !validId(config.locationId) || !validId(config.campaignKey) || typeof search !== 'function') fail('invalid_match_scope');
  return async source => {
    if (!enabled) fail('contact_matching_disabled');
    if (source.kind !== 'crm' || source.school_id !== config.schoolId || source.campaign_key !== config.campaignKey ||
        source.erasure_requested_at || !source.nomination?.permission?.accepted_at) fail('invalid_match_scope');
    const plans = {};
    // Per-call only; never reuse a stale cache across jobs or tenants.
    const matched = new Map();
    for (const role of ['nominee','nominator']) {
      let person;
      try { person = identity(source.nomination[role]); } catch { fail('contact_identity_conflict'); }
      const subject = digest(person);
      if (matched.has(subject)) { plans[role] = { ...matched.get(subject) }; continue; }
      const results = [];
      for (const field of ['email','phone']) {
        let result;
        try { result = await search({ locationId:config.locationId, field, value:person[field] }); }
        catch { fail('contact_lookup_failed'); }
        // Truncated, malformed and ambiguous results are never an absence proof.
        if (!result || !Array.isArray(result.contacts) || !Number.isSafeInteger(result.total) || result.total < 0) fail('contact_lookup_failed');
        if (result.total > 1 || result.contacts.length > 1) fail('contact_multiple_matches');
        if (result.total !== result.contacts.length) fail('contact_lookup_failed');
        const contact = result.contacts[0];
        if (contact) {
          if (!validId(contact.id) || contact.locationId !== config.locationId) fail('contact_identity_conflict');
          let actual;
          try { actual = identity(contact); } catch { fail('contact_identity_conflict'); }
          if (digest(actual) !== subject) fail('contact_identity_conflict');
        }
        results.push(contact);
      }
      if (!results[0] && !results[1]) fail('contact_not_found');
      if (!results[0] || !results[1] || results[0].id !== results[1].id) fail('contact_identity_conflict');
      const plan = {kind:'existing',id:results[0].id,schoolId:config.schoolId,locationId:config.locationId,identityHash:subject};
      plans[role] = plan; matched.set(subject,plan);
    }
    // One provider contact cannot represent two different submitted identities.
    if (plans.nominee.id === plans.nominator.id && plans.nominee.identityHash !== plans.nominator.identityHash) fail('contact_identity_conflict');
    return plans;
  };
}

// Separate, bounded read-only transport. No environment loading or writes.
// Provider search filter/total response compatibility must be rehearsed before release.
function createContactSearch({ apiKey, locationId, enabled = false, fetchImpl = fetch }) {
  if (!validId(locationId)) fail('invalid_match_scope');
  return async ({locationId:requestedLocation,field,value}) => {
    if (!enabled || !apiKey) fail('contact_matching_disabled');
    if (requestedLocation !== locationId || !['email','phone'].includes(field) || typeof value !== 'string' ||
        (field === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length>254 : !/^\+447\d{9}$/.test(value))) fail('invalid_match_scope');
    try {
      const response = await fetchImpl('https://services.leadconnectorhq.com/contacts/search', {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${apiKey}`,Version:'2021-07-28','Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({locationId,page:1,pageLimit:2,filters:[{field,operator:'eq',value}]}),
      });
      if (!response.ok) fail('contact_lookup_failed');
      const result = await response.json();
      if (!Array.isArray(result.contacts) || !Number.isSafeInteger(result.total) || result.total<0) fail('contact_lookup_failed');
      // Discard unrelated provider PII immediately; never log response bodies.
      return {total:result.total,contacts:result.contacts.map(c=>({id:c.id,locationId:c.locationId,email:c.email,phone:c.phone}))};
    } catch { fail('contact_lookup_failed'); }
  };
}
module.exports = { createContactMatcher, createContactSearch, ContactMatchError };
