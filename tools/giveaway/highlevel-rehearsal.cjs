// Full nomination -> application -> withdrawal -> restart rehearsal. No live fetch or env loading.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createService } = require('./domain.cjs');
const { createSync, createHttpTransport, digest, identity } = require('./highlevel-sync.cjs');
async function rehearse() {
  const output = fs.mkdtempSync(path.resolve(__dirname, '../../tmp/giveaway-crm-rehearsal-'));
  const statePath = path.join(output, 'fictional-state.json');
  const store = { data: { nominations: [], outbox: [], consents: [] }, async save() {
    fs.writeFileSync(statePath + '.new', JSON.stringify(this.data, null, 2)); fs.renameSync(statePath + '.new', statePath);
  } };
  const config = { enabled: true, environment: 'rehearsal', schoolId: 1, locationId: 'fake-location', campaignKey: 'october-2026',
    reviewUrl: 'https://example.test/review', associations: { nominee: { id: 'fake-nominee', first: 'nomination' }, nominator: { id: 'fake-nominator', first: 'nomination' } } };
  const now = () => new Date('2026-10-09T10:00:00Z');
  const service = createService(store, { now });
  await service.nominate(1, { submission_key: randomUUID(), nominee_name: 'Alex Fictional', nominee_email: 'alex@example.test', nominee_phone: '07700900123',
    nominator_name: 'Jamie Fictional', nominator_email: 'jamie@example.test', nominator_phone: '07700900456', reason: 'Fictional nomination for this rehearsal.', relationship: 'Friend', permission: true });
  const row = store.data.nominations[0], token = store.data.outbox[0].token;
  const contacts = new Map(), records = new Map(), calls = [];
  const fakeFetch = async (url, options) => {
    const parsed = new URL(url), method = options.method, body = options.body ? JSON.parse(options.body) : null;
    assert.equal(parsed.origin, 'https://services.leadconnectorhq.com');
    calls.push({ method, path: parsed.pathname });
    let response;
    if (parsed.pathname === '/contacts/' && method === 'POST') {
      const contact = { ...body, id: 'fake-contact-' + (contacts.size + 1) }; contacts.set(contact.id, contact); response = { contact };
    } else if (parsed.pathname.startsWith('/contacts/') && method === 'GET') response = { contact: contacts.get(parsed.pathname.split('/')[2]) };
    else if (parsed.pathname.endsWith('/records') && method === 'POST') {
      const record = { ...body, id: 'fake-record-1' }; records.set(record.id, record); response = { record };
    } else if (parsed.pathname.includes('/records/')) {
      const record = records.get(parsed.pathname.split('/').pop());
      if (method === 'PUT') record.properties = body.properties;
      response = { record };
    } else if (parsed.pathname === '/associations/relations') response = { id: 'fake-relation-' + calls.length };
    else throw Error('Unexpected mock endpoint');
    return { ok: true, json: async () => structuredClone(response) };
  };
  const transport = createHttpTransport({ apiKey: 'fictional-never-a-real-key', locationId: config.locationId,
    associationIds: ['fake-nominee', 'fake-nominator'], writeEnabled: true, fetchImpl: fakeFetch });
  const plans = Object.fromEntries(['nominee', 'nominator'].map(role => [role, { kind: 'new_reviewed', schoolId: 1, locationId: config.locationId,
    identityHash: digest(identity(row[role])), duplicateAndWorkflowReview: true }]));
  const worker = () => createSync({ store, transport, config, now });
  await worker().run(row.id, plans);
  assert.equal(records.get('fake-record-1').properties.application_status, 'awaiting_application');
  await service.apply(1, token, { name: 'Alex Fictional', meaning: 'Fictional application.', barriers: 'Lesson costs are a barrier; free lessons would make learning possible.', hours: '0', test_booked: 'no', practice_car: 'no',
    address: '1 Fictional Road', postcode: 'SW1A 1AA', employment: 'prefer-not-to-say', contact_confirmed: true, marketing_email: true });
  await worker().run(row.id, plans);
  assert.equal(records.get('fake-record-1').properties.application_status, 'submitted');
  await service.withdraw(1, token);
  const writesBeforeRestart = calls.filter(call => call.method !== 'GET').length;
  store.data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  await worker().run(row.id, plans);
  assert.equal(calls.filter(call => call.method !== 'GET').length, writesBeforeRestart);
  assert.equal(contacts.size, 2); assert.equal(records.size, 1);
  assert.ok(store.data.consents.find(consent => consent.channel === 'email').withdrawn_at);
  assert.ok([...contacts.values()].every(contact => contact.dnd === true));
  const report = { mode: 'fictional HTTP simulation; no network calls', result: 'passed',
    scenarios: ['nomination sync', 'application updates same record', 'withdrawal retains application and DND', 'disk reload without duplicate writes'],
    contacts: contacts.size, nominations: records.size, relations: calls.filter(call => call.path === '/associations/relations').length,
    writes: writesBeforeRestart, crm_projection: records.get('fake-record-1').properties, requests: calls };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: 'passed', report: path.join(output, 'report.json'), real_network_calls: 0 }, null, 2));
}
rehearse().catch(() => { console.error('Fictional CRM rehearsal failed. No live requests were made.'); process.exitCode = 1; });
