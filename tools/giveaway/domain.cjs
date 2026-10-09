const crypto = require('node:crypto');
const DEADLINE = '2026-10-11T23:00:00.000Z'; // Midnight at the end of Sunday 11 October, Europe/London (BST).
const WORDING = Object.freeze({
  email: 'Email me about future giveaways, updates and promotions.',
  sms: 'Text me about future giveaways, updates and promotions.',
  permission: 'I have permission to provide this person’s contact details so CoachCarter can invite them to apply.',
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
class InputError extends Error {
  constructor(fields, status = 400, message = 'Please check the highlighted answers.') { super(message); this.fields = fields; this.status = status; }
}
function clean(value, max) { return typeof value === 'string' && value.trim().length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value.trim() : ''; }
function nomination(body) {
  const out = {}, errors = {};
  for (const who of ['nominee', 'nominator']) {
    out[who] = {};
    for (const field of ['name', 'email', 'phone']) {
      let value = clean(body[who + '_' + field], field === 'email' ? 254 : 160);
      if (field === 'email') value = value.toLowerCase();
      if (field === 'phone') value = value.replace(/[\s()-]/g, '').replace(/^\+44/, '0');
      if (!value || (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || (field === 'phone' && !/^07\d{9}$/.test(value))) errors[who + '_' + field] = field === 'phone' ? 'Enter a UK mobile number, for example 07700 900123.' : 'Enter a valid ' + field + '.';
      out[who][field] = value;
    }
  }
  out.reason = clean(body.reason, 3000);
  out.relationship = clean(body.relationship, 160);
  if (body.relationship != null && body.relationship !== '' && !out.relationship) errors.relationship = 'Enter your relationship in up to 160 characters, or leave this blank.';
  if (!out.reason) errors.reason = 'Tell us why you are nominating this person (up to 3,000 characters).';
  if (body.permission !== true) errors.permission = 'Please confirm you have their permission.';
  if (!/^[0-9a-f-]{36}$/i.test(body.submission_key || '')) errors.form = 'Refresh this page and try again.';
  if (Object.keys(errors).length) throw new InputError(errors);
  return out;
}
function application(body) {
  const out = {}, errors = {};
  for (const [field, max] of Object.entries({ name: 160, meaning: 3000, barriers: 3000, address: 500, postcode: 10 })) {
    out[field] = clean(body[field], max);
    if (!out[field]) errors[field] = 'Please complete this answer (maximum ' + max + ' characters).';
  }
  out.postcode = out.postcode.toUpperCase();
  if (!/^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/.test(out.postcode)) errors.postcode = 'Enter a full UK postcode.';
  out.hours = Number(body.hours);
  if (body.hours === '' || body.hours == null || !Number.isFinite(out.hours) || out.hours < 0 || out.hours > 10000) errors.hours = 'Enter zero or an approximate number of hours (up to 10,000).';
  for (const field of ['test_booked', 'practice_car']) {
    if (!['yes', 'no'].includes(body[field])) errors[field] = 'Choose Yes or No.';
    out[field] = body[field];
  }
  if (out.test_booked === 'yes') {
    out.test_date = clean(body.test_date, 10); out.test_time = clean(body.test_time, 5); out.test_location = clean(body.test_location, 160);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.test_date) || Number.isNaN(Date.parse(out.test_date)) || new Date(out.test_date).toISOString().slice(0, 10) !== out.test_date) errors.test_date = 'Enter a valid test date.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.test_time)) errors.test_time = 'Enter your test time.';
    if (!out.test_location) errors.test_location = 'Enter your test centre.';
  }
  if (!['employed', 'self-employed', 'student', 'seeking-work', 'not-working', 'retired', 'other', 'prefer-not-to-say'].includes(body.employment)) errors.employment = 'Choose an option, including Prefer not to say.';
  out.employment = body.employment;
  if (body.contact_confirmed !== true) errors.contact_confirmed = 'Please check the nominated contact details.';
  out.preferences = {};
  for (const key of ['zoom', 'shared', 'filmed', 'filmed_blurred']) out.preferences[key] = body[key] === true;
  out.marketing = { email: body.marketing_email === true, sms: body.marketing_sms === true };
  if (Object.keys(errors).length) throw new InputError(errors);
  return out;
}
function createService(store, options = {}) {
  const now = options.now || (() => new Date());
  const deadline = options.deadline || DEADLINE;
  const open = () => now().getTime() < Date.parse(deadline);
  const checkOpen = () => { if (!open()) throw new InputError({}, 410, 'Applications have closed. Thank you for your interest.'); };
  const find = (schoolId, token) => store.data.nominations.find(n => n.school_id === schoolId && n.token_hash === hash(String(token || '')));
  return {
    config: () => ({ deadline, open: open(), prize: 'One free automatic driving lesson per week until the winner passes their practical driving test.' }),
    async nominate(schoolId, body) {
      checkOpen();
      if (body.website) return { ok: true };
      const data = nomination(body);
      // One invitation per nominee/nominator pair. The public response never reveals duplicates.
      const duplicate = store.data.nominations.some(n => n.school_id === schoolId && (n.submission_key === body.submission_key || (n.nominee.email === data.nominee.email && n.nominator.email === data.nominator.email)));
      if (duplicate) return { ok: true };
      const token = crypto.randomBytes(32).toString('base64url');
      const row = { id: crypto.randomUUID(), school_id: schoolId, submission_key: body.submission_key, ...data, token_hash: hash(token), created_at: now().toISOString(), permission: { wording: WORDING.permission, version: 'giveaway-v1', accepted_at: now().toISOString() }, application: null };
      // Nomination and outbox persist together before delivery is attempted.
      store.data.nominations.push(row);
      store.data.outbox.push({ id: crypto.randomUUID(), school_id: schoolId, nomination_id: row.id, token, status: 'queued', attempts: 0, recipient: row.nominee.email, created_at: now().toISOString() });
      await store.save();
      return { ok: true };
    },
    inspect(schoolId, token) {
      const row = find(schoolId, token);
      if (!row) throw new InputError({}, 404, 'This invitation is unavailable. Please check the full link in your email or contact CoachCarter.');
      if (row.application) return { ok: true, completed: true, submitted_at: row.application.submitted_at };
      checkOpen();
      return { ok: true, completed: false, nominator_name: row.nominator.name, nominee: row.nominee };
    },
    async apply(schoolId, token, body) {
      const row = find(schoolId, token);
      if (!row) throw new InputError({}, 404, 'This invitation is unavailable. Please check the link in your email.');
      if (row.application) return { ok: true, completed: true };
      checkOpen();
      const data = application(body), submitted_at = now().toISOString();
      row.application = { ...data, submitted_at };
      for (const channel of ['email', 'sms']) store.data.consents.push({ school_id: schoolId, nomination_id: row.id, channel, granted: data.marketing[channel], wording: WORDING[channel], version: 'giveaway-v1', recorded_at: submitted_at, withdrawn_at: null });
      await store.save();
      return { ok: true, completed: true };
    },
    async withdraw(schoolId, token) {
      const row = find(schoolId, token);
      if (!row) throw new InputError({}, 404, 'This invitation is unavailable.');
      for (const consent of store.data.consents.filter(c => c.school_id === schoolId && c.nomination_id === row.id && c.granted && !c.withdrawn_at)) consent.withdrawn_at = now().toISOString();
      await store.save(); return { ok: true };
    },
    review(schoolId) { return store.data.nominations.filter(n => n.school_id === schoolId).map(({ token_hash, submission_key, ...n }) => ({ ...n, invitation: store.data.outbox.filter(o => o.school_id === schoolId && o.nomination_id === n.id).map(({ status, attempts }) => ({ status, attempts })), consents: store.data.consents.filter(c => c.school_id === schoolId && c.nomination_id === n.id) })); },
    async deliver(capture) {
      for (const item of store.data.outbox.filter(o => o.status === 'queued')) {
        item.attempts++;
        try { await capture(item); item.status = 'captured'; } catch { item.status = 'queued'; }
        await store.save();
      }
    },
  };
}
module.exports = { createService, InputError, nomination, application, WORDING, DEADLINE };
