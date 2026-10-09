// Isolated giveaway CRM adapter. No preview route imports this module and no env is loaded.
const { createHash } = require('node:crypto');
const { DEADLINE } = require('./domain.cjs');
const OBJECT = 'custom_objects.giveaway_nominations';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
class SyncError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new SyncError(code); };
function identity(person) {
  const email = String(person?.email || '').trim().toLowerCase();
  const phone = String(person?.phone || '').replace(/[\s()-]/g, '').replace(/^0/, '+44');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+447\d{9}$/.test(phone)) fail('invalid_contact');
  return { email, phone };
}
function configuration(config) {
  if (!Number.isSafeInteger(config.schoolId) || config.schoolId < 1 ||
      !validId(config.locationId) || !validId(config.campaignKey) ||
      !['rehearsal', 'production'].includes(config.environment)) fail('invalid_scope');
  const review = new URL(config.reviewUrl);
  if (review.username || review.password || review.search || review.hash ||
      (review.protocol !== 'https:' && !(config.environment === 'rehearsal' && review.hostname === '127.0.0.1'))) fail('invalid_review_url');
  for (const role of ['nominee', 'nominator']) {
    const association = config.associations?.[role];
    if (!validId(association?.id) || !['contact', 'nomination'].includes(association.first)) fail('missing_association_mapping');
  }
}
function projection(row, invitation, config, now = new Date()) {
  configuration(config);
  if (row.school_id !== config.schoolId || !validId(row.id)) fail('tenant_mismatch');
  if (!row.permission?.accepted_at) fail('missing_contact_permission');
  if (invitation && (invitation.school_id !== row.school_id || invitation.nomination_id !== row.id)) fail('invitation_mismatch');
  const status = invitation?.status || 'queued';
  // Captured preview mail is not provider acceptance or delivery.
  if (!['queued', 'accepted_by_provider', 'failed', 'uncertain', 'suppressed', 'captured'].includes(status)) fail('invalid_invitation_status');
  const review = new URL(config.reviewUrl);
  review.searchParams.set('nomination_id', row.id);
  return {
    nomination_reference: `${config.environment}:${config.schoolId}:${config.campaignKey}:${row.id}`,
    campaign_key: config.campaignKey,
    application_status: row.application ? 'submitted' : now.getTime() >= Date.parse(config.deadline || DEADLINE) ? 'closed_incomplete' : 'awaiting_application',
    invitation_status: status === 'captured' ? 'suppressed' : status,
    website_review_url: review.href,
    relationship_to_nominee: String(row.relationship || '').slice(0, 160),
  };
}

// Persist journal markers BEFORE writes. A failed/ambiguous write is never retried automatically.
// The caller must provide an exclusive store; this mutex also serializes users of that store here.
const locks = new WeakMap();
function createSync({ store, transport, config, now = () => new Date() }) {
  config = structuredClone(config);
  configuration(config);
  const scope = `${config.environment}:${config.schoolId}:${config.locationId}:${config.campaignKey}`;
  const save = () => store.save();
  async function execute(nominationId, plans) {
    if (config.enabled !== true) return { status: 'disabled' };
    const row = store.data.nominations.find(n => n.school_id === config.schoolId && n.id === nominationId);
    if (!row) fail('nomination_not_found');
    const invitation = store.data.outbox.find(o => o.school_id === config.schoolId && o.nomination_id === row.id);
    const properties = projection(row, invitation, config, now());
    store.data.giveaway_crm ||= { operations: {}, contacts: {} };
    const crm = store.data.giveaway_crm;
    // Any unresolved side effect in this scope blocks newer writes too, including changed payloads.
    if (Object.entries(crm.operations).some(([key, op]) => key.startsWith(scope + ':') && op.status !== 'done')) fail('unresolved_write');
    const request = async (method, path, body) => {
      try { return await transport.request(method, path, body); }
      catch { fail(method === 'GET' ? 'read_failed' : 'write_uncertain'); }
    };
    async function write(key, method, path, body, extract) {
      const operationKey = scope + ':' + key;
      const fingerprint = digest({ method, path, body });
      const prior = crm.operations[operationKey];
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('operation_conflict');
        return prior.result;
      }
      const op = { status: 'in_flight', fingerprint, started_at: now().toISOString() };
      crm.operations[operationKey] = op;
      // If this save fails, no HTTP request occurs. The process must stop and inspect storage.
      await save();
      try {
        const result = extract(await request(method, path, body));
        if (!validId(result)) fail('invalid_provider_response');
        op.result = result; op.status = 'done'; op.completed_at = now().toISOString();
        await save();
        return result;
      } catch {
        op.status = 'uncertain'; delete op.result;
        await save();
        fail('write_uncertain');
      }
    }
    const contacts = {};
    // Plans come from a trusted operator mapping, never from an application POST.
    // Both identifiers must agree; no email-only upsert or overwriting existing contacts/DND.
    for (const role of ['nominee', 'nominator']) {
      const person = row[role], ids = identity(person);
      const subject = digest(ids), mappingKey = `${scope}:${subject}`;
      const plan = plans?.[role];
      const mapped = crm.contacts[mappingKey];
      if (!mapped && (!plan || plan.schoolId !== config.schoolId || plan.locationId !== config.locationId ||
          plan.identityHash !== subject || !['existing', 'new_reviewed'].includes(plan.kind))) fail('contact_review_required');
      // A shared email or mobile with different counterpart identifiers needs human review.
      if (Object.entries(crm.contacts).some(([key, item]) => key.startsWith(scope + ':') && key !== mappingKey &&
          (item.email_hash === digest(ids.email) || item.phone_hash === digest(ids.phone)))) fail('contact_identity_conflict');
      let contactId = mapped?.id;
      if (!contactId && plan.kind === 'existing') contactId = plan.id;
      if (contactId) {
        if (!validId(contactId)) fail('invalid_contact_mapping');
        const contact = (await request('GET', `/contacts/${contactId}`)).contact;
        if (!contact || contact.id !== contactId || contact.locationId !== config.locationId || digest(identity(contact)) !== subject) fail('contact_identity_conflict');
      } else {
        // Approval of new contact creation includes duplicate and workflow-trigger review.
        if (plan.duplicateAndWorkflowReview !== true) fail('contact_review_required');
        contactId = await write(`contact:${subject}`, 'POST', '/contacts/', {
          locationId: config.locationId, name: String(person.name).slice(0, 160), ...ids,
          dnd: true, source: 'CoachCarter giveaway',
        }, response => {
          const contact = response.contact;
          if (!contact || contact.locationId !== config.locationId || digest(identity(contact)) !== subject) fail('invalid_provider_response');
          return contact.id;
        });
      }
      crm.contacts[mappingKey] = { id: contactId, email_hash: digest(ids.email), phone_hash: digest(ids.phone) };
      await save();
      contacts[role] = contactId;
    }
    const base = `/objects/${OBJECT}/records`;
    const createKey = `${scope}:record:${row.id}`;
    let recordId = crm.operations[createKey]?.result;
    if (!recordId) {
      recordId = await write(`record:${row.id}`, 'POST', base, { locationId: config.locationId, properties }, response => {
        const record = response.record;
        if (record?.properties?.nomination_reference !== properties.nomination_reference ||
            record.locationId && record.locationId !== config.locationId) fail('invalid_provider_response');
        return record.id;
      });
      crm.operations[createKey].projection_hash = digest(properties);
      await save();
    } else if (crm.operations[createKey].projection_hash !== digest(properties)) {
      const path = `${base}/${recordId}?locationId=${config.locationId}`;
      const record = (await request('GET', path)).record;
      if (!record || record.id !== recordId || record.properties?.nomination_reference !== properties.nomination_reference ||
          record.locationId && record.locationId !== config.locationId) fail('record_identity_conflict');
      // Sequence key permits A -> B -> A updates while still suppressing identical retries.
      const revision = (crm.operations[createKey].revision || 0) + 1;
      await write(`update:${row.id}:${revision}`, 'PUT', path, { properties }, response => response.record?.id === recordId ? recordId : null);
      crm.operations[createKey].projection_hash = digest(properties);
      crm.operations[createKey].revision = revision;
      await save();
    }
    for (const role of ['nominee', 'nominator']) {
      const association = config.associations[role];
      const pair = association.first === 'contact' ? [contacts[role], recordId] : [recordId, contacts[role]];
      await write(`relation:${row.id}:${role}`, 'POST', '/associations/relations', {
        locationId: config.locationId, associationId: association.id,
        firstRecordId: pair[0], secondRecordId: pair[1],
      }, response => response.id);
    }
    return { status: 'synced', nomination_id: row.id, record_id: recordId };
  }
  return {
    run(nominationId, plans) {
      const task = (locks.get(store) || Promise.resolve()).then(() => execute(nominationId, plans));
      locks.set(store, task.catch(() => {}));
      return task;
    },
  };
}

// No arbitrary host, redirect, credentials in URL, body logging, or implicit retry.
// Merely importing this module or supplying a key cannot activate writes.
function createHttpTransport({ apiKey, locationId, associationIds = [], fetchImpl = fetch, writeEnabled = false }) {
  if (!validId(locationId)) fail('invalid_scope');
  return { async request(method, path, body) {
    const recordBase = `/objects/${OBJECT}/records`;
    const recordPath = new RegExp(`^${recordBase}/[A-Za-z0-9_-]+\\?locationId=${locationId}$`);
    const allowedRead = method === 'GET' && (/^\/contacts\/[A-Za-z0-9_-]+$/.test(path) || recordPath.test(path));
    const allowedWrite = writeEnabled === true && (
      (method === 'POST' && path === '/contacts/' && body?.dnd === true &&
        Object.keys(body).every(key => ['locationId', 'name', 'email', 'phone', 'dnd', 'source'].includes(key))) ||
      (method === 'POST' && path === '/associations/relations' && associationIds.includes(body?.associationId) &&
        validId(body.firstRecordId) && validId(body.secondRecordId) &&
        Object.keys(body).every(key => ['locationId', 'associationId', 'firstRecordId', 'secondRecordId'].includes(key))) ||
      ((method === 'POST' && path === recordBase || method === 'PUT' && recordPath.test(path)) &&
        body?.properties && Object.keys(body.properties).length === 6 &&
        Object.keys(body.properties).every(key => ['nomination_reference', 'campaign_key', 'application_status', 'invitation_status', 'website_review_url', 'relationship_to_nominee'].includes(key)) &&
        Object.keys(body).every(key => ['locationId', 'properties'].includes(key)))
    );
    if (!allowedRead && !allowedWrite) fail('operation_not_allowed');
    if (method === 'POST' && body?.locationId !== locationId) fail('tenant_mismatch');
    if (method === 'PUT' && body?.locationId && body.locationId !== locationId) fail('tenant_mismatch');
    try {
      const response = await fetchImpl('https://services.leadconnectorhq.com' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${apiKey}`, Version: '2023-02-21', Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) fail('provider_request_failed');
      return await response.json();
    } catch { fail(method === 'GET' ? 'provider_read_failed' : 'write_uncertain'); }
  } };
}
module.exports = { createSync, createHttpTransport, projection, identity, digest, SyncError };
