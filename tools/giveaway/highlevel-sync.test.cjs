const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSync, createHttpTransport, projection, identity, digest } = require('./highlevel-sync.cjs');

function fixture() {
  const row = { id: 'nomination-1', school_id: 1, permission: { accepted_at: '2026-10-09' },
    nominee: { name: 'Alex Fictional', email: 'alex@example.test', phone: '07700900123' },
    nominator: { name: 'Jamie Fictional', email: 'jamie@example.test', phone: '07700900456' },
    reason: 'PRIVATE', token_hash: 'SECRET', relationship: 'Friend', application: null };
  const config = { enabled: true, environment: 'rehearsal', schoolId: 1, locationId: 'fake-location', campaignKey: 'october-2026',
    reviewUrl: 'https://example.test/review', associations: { nominee: { id: 'fake-nominee', first: 'nomination' }, nominator: { id: 'fake-nominator', first: 'contact' } } };
  const store = { data: { nominations: [row], outbox: [{ nomination_id: row.id, school_id: 1, status: 'captured' }] },
    persisted: null, async save() { this.persisted = structuredClone(this.data); } };
  const calls = [], records = new Map(), contacts = new Map();
  const transport = { async request(method, path, body) {
    calls.push({ method, path, body: structuredClone(body) });
    if (method === 'POST' && path === '/contacts/') {
      const contact = { ...body, id: 'contact-' + (contacts.size + 1) }; contacts.set(contact.id, contact); return { contact };
    }
    if (method === 'GET' && path.startsWith('/contacts/')) return { contact: contacts.get(path.split('/')[2]) };
    if (method === 'POST' && path.endsWith('/records')) {
      const record = { ...body, id: 'record-' + (records.size + 1) }; records.set(record.id, record); return { record };
    }
    if (path.includes('/records/')) {
      const id = path.split('/records/')[1].split('?')[0], record = records.get(id);
      if (method === 'PUT') record.properties = body.properties;
      return { record };
    }
    if (path === '/associations/relations') return { id: 'relation-' + calls.length };
    throw Error('unexpected request');
  } };
  const plans = Object.fromEntries(['nominee', 'nominator'].map(role => [role, {
    schoolId: 1, locationId: config.locationId, identityHash: digest(identity(row[role])), kind: 'new_reviewed', duplicateAndWorkflowReview: true,
  }]));
  const worker = () => createSync({ store, transport, config, now: () => new Date('2026-10-09T10:00:00Z') });
  return { row, config, store, calls, records, contacts, transport, plans, worker };
}
test('projection excludes answers, tokens, addresses and marketing; captured is not delivered', () => {
  const f = fixture(); f.row.application = { address: 'PRIVATE', meaning: 'PRIVATE', marketing: { email: true } };
  const p = projection(f.row, f.store.data.outbox[0], f.config);
  assert.equal(p.application_status, 'submitted'); assert.equal(p.invitation_status, 'suppressed');
  assert.equal(Object.keys(p).length, 6); assert.doesNotMatch(JSON.stringify(p), /PRIVATE|SECRET|@|marketing/);
  assert.match(p.website_review_url, /nomination_id=nomination-1$/);
});
test('happy path creates two suppressed contacts, one record, role-specific links; repeat and concurrency do not duplicate writes', async () => {
  const f = fixture(); await Promise.all([f.worker().run(f.row.id, f.plans), f.worker().run(f.row.id, f.plans)]);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 5);
  assert.ok([...f.contacts.values()].every(c => c.dnd === true && !c.tags && !c.customFields));
  const links = f.calls.filter(c => c.path === '/associations/relations');
  assert.equal(links[0].body.firstRecordId, 'record-1'); assert.equal(links[1].body.secondRecordId, 'record-1');
});
test('application submission updates the same record, with no contact mutation or marketing enrolment', async () => {
  const f = fixture(); await f.worker().run(f.row.id, f.plans);
  f.row.application = { name: 'Changed', marketing: { email: true } };
  await f.worker().run(f.row.id, f.plans); await f.worker().run(f.row.id, f.plans);
  assert.equal(f.records.size, 1); assert.equal(f.records.get('record-1').properties.application_status, 'submitted');
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 1);
  assert.ok(f.calls.filter(c => c.method === 'PUT').every(c => c.path.includes('/records/')));
});
test('same nominee from another nominator reuses contact but creates a distinct nomination', async () => {
  const f = fixture(); await f.worker().run(f.row.id, f.plans);
  const second = structuredClone(f.row); second.id = 'nomination-2'; second.nominator = { name: 'Sam', email: 'sam@example.test', phone: '07700900789' };
  f.store.data.nominations.push(second);
  const plans = structuredClone(f.plans); plans.nominator.identityHash = digest(identity(second.nominator));
  await f.worker().run(second.id, plans);
  assert.equal(f.contacts.size, 3); assert.equal(f.records.size, 2);
});
test('tenant/location mismatches and unreviewed contacts stop before any writes', async () => {
  for (const mutate of [f => { f.row.school_id = 2; }, f => { f.plans.nominee.locationId = 'other'; }, f => { f.plans.nominee.duplicateAndWorkflowReview = false; }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.worker().run(f.row.id, f.plans)); assert.equal(f.calls.length, 0);
  }
});
test('existing contact must match location, email AND phone; its DND is never changed', async () => {
  const f = fixture(); const contact = { id: 'existing', locationId: f.config.locationId, ...identity(f.row.nominee), dnd: true };
  f.contacts.set(contact.id, contact); f.plans.nominee = { ...f.plans.nominee, kind: 'existing', id: contact.id };
  await f.worker().run(f.row.id, f.plans); assert.equal(f.contacts.get('existing').dnd, true);
  contact.phone = '+447700900999';
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'contact_identity_conflict' });
});
test('provider acceptance followed by timeout blocks all later writes, even after restart or changed answers', async () => {
  const f = fixture(), request = f.transport.request;
  f.transport.request = async (...args) => { await request(...args); throw Error('connection lost after acceptance'); };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'write_uncertain' });
  assert.equal(f.contacts.size, 1);
  f.store.data = structuredClone(f.store.persisted); f.transport.request = request;
  f.store.data.nominations[0].application = { submitted_at: 'now' };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'unresolved_write' }); assert.equal(f.calls.length, 1);
});
test('crash marker blocks replay; failed journal persistence performs no HTTP write', async () => {
  const f = fixture(); f.store.save = async () => { throw Error('disk full'); };
  await assert.rejects(f.worker().run(f.row.id, f.plans)); assert.equal(f.calls.length, 0);
  f.store.save = async () => {};
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'unresolved_write' });
});
test('failed post-acceptance receipt save leaves uncertain operation, never replays', async () => {
  const f = fixture(); let saves = 0;
  f.store.save = async () => { if (++saves === 2) throw Error('disk full'); f.store.persisted = structuredClone(f.store.data); };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'write_uncertain' });
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'unresolved_write' }); assert.equal(f.contacts.size, 1);
});
test('read failure is safely retryable without repeating completed writes', async () => {
  const f = fixture(); await f.worker().run(f.row.id, f.plans);
  const request = f.transport.request; f.transport.request = async () => { throw Error('offline'); };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'read_failed' });
  f.transport.request = request; await f.worker().run(f.row.id, f.plans);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 5);
});
test('ambiguous failure in relation stage does not recreate contacts or records', async () => {
  const f = fixture(), request = f.transport.request;
  f.transport.request = async (...args) => { const result = await request(...args); if (args[1] === '/associations/relations') throw Error('timeout'); return result; };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'write_uncertain' });
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'unresolved_write' });
  assert.equal(f.contacts.size, 2); assert.equal(f.records.size, 1);
});
test('unexpected provider response is uncertain and secrets in errors never escape', async () => {
  const f = fixture(); f.transport.request = async () => { throw Error('Bearer SECRET person@example.test'); };
  await assert.rejects(f.worker().run(f.row.id, f.plans), error => error.message === 'write_uncertain');
  assert.doesNotMatch(JSON.stringify(f.store.data.giveaway_crm), /SECRET|person@example/);
});
test('closed incomplete state, invitation scope, unsafe URLs and disabled default', async () => {
  const f = fixture(); assert.equal(projection(f.row, null, f.config, new Date('2026-10-12')).application_status, 'closed_incomplete');
  assert.throws(() => projection(f.row, { school_id: 2 }, f.config), { code: 'invitation_mismatch' });
  assert.throws(() => projection(f.row, null, { ...f.config, reviewUrl: 'https://example.test/?token=SECRET' }));
  delete f.config.enabled; assert.deepEqual(await f.worker().run(f.row.id, f.plans), { status: 'disabled' }); assert.equal(f.calls.length, 0);
});
test('real HTTP adapter defaults to read-only, rejects foreign paths and redirects, uses fixed official origin', async () => {
  const calls = []; const http = createHttpTransport({ apiKey: 'fake', locationId: 'fake-location', fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ ok: true }) }; } });
  await assert.rejects(http.request('POST', '/contacts/', {}), { code: 'operation_not_allowed' });
  await assert.rejects(http.request('GET', '//attacker.test/contacts/x'), { code: 'operation_not_allowed' });
  await http.request('GET', '/contacts/fake'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://services.leadconnectorhq.com/contacts/fake'); assert.equal(calls[0][1].redirect, 'error');
});
test('write-enabled HTTP adapter rejects other locations, unknown associations and DND changes', async () => {
  const calls = []; const http = createHttpTransport({ apiKey: 'fake', locationId: 'fake-location', writeEnabled: true, associationIds: ['fake-nominee'],
    fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ id: 'fake' }) }; } });
  await assert.rejects(http.request('POST', '/contacts/', { locationId: 'other', dnd: true }), { code: 'tenant_mismatch' });
  await assert.rejects(http.request('POST', '/contacts/', { locationId: 'fake-location', dnd: false }), { code: 'operation_not_allowed' });
  await assert.rejects(http.request('POST', '/associations/relations', { locationId: 'fake-location', associationId: 'other', firstRecordId: 'one', secondRecordId: 'two' }));
  await http.request('POST', '/contacts/', { locationId: 'fake-location', dnd: true, email: 'fake@example.test' });
  assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0][1].body).dnd, true);
});
test('wrong-account existing contacts and records cannot be linked or updated', async () => {
  const f = fixture(); f.contacts.set('foreign', { id: 'foreign', locationId: 'other', ...identity(f.row.nominee) });
  f.plans.nominee = { ...f.plans.nominee, kind: 'existing', id: 'foreign' };
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'contact_identity_conflict' });
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
  const g = fixture(); await g.worker().run(g.row.id, g.plans);
  g.row.application = { submitted_at: 'now' }; g.records.get('record-1').locationId = 'other';
  await assert.rejects(g.worker().run(g.row.id, g.plans), { code: 'record_identity_conflict' });
  assert.equal(g.calls.filter(call => call.method === 'PUT').length, 0);
});
test('malformed create response remains uncertain instead of recording success', async () => {
  const f = fixture(); f.transport.request = async () => ({ contact: { id: 'wrong' } });
  await assert.rejects(f.worker().run(f.row.id, f.plans), { code: 'write_uncertain' });
  assert.ok(Object.values(f.store.data.giveaway_crm.operations).every(op => op.status === 'uncertain'));
});
