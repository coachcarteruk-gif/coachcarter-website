const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAudit } = require('./_audit');

const HEADERS = ['First Name', 'Last Name', 'Email', 'Phone', 'Tags', 'Address1', 'City', 'State', 'Postal Code', 'Country', 'Source'];
const text = value => String(value == null ? '' : value).trim();

function normalisePhone(value) {
  const raw = text(value);
  // Keep unrecognised numbers for manual review; never remove extensions or letters.
  if (!/^[+\d\s().-]+$/.test(raw)) return raw;
  let phone = raw.replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (/^\+440\d{10}$/.test(phone)) phone = '+44' + phone.slice(4);
  if (/^0\d{10}$/.test(phone)) phone = '+44' + phone.slice(1);
  else if (/^44\d{10}$/.test(phone)) phone = '+' + phone;
  else if (/^7\d{9}$/.test(phone)) phone = '+44' + phone;
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : raw;
}

function csvCell(value, isPhone = false) {
  let cell = text(value);
  // Preserve valid E.164 phone numbers for import, neutralise executable formulas.
  if (/^[=+@-]/.test(cell) && !(isPhone && /^\+[1-9]\d{6,14}$/.test(cell))) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
}

function buildContacts(rows) {
  const contacts = new Map();
  for (const row of rows) {
    const email = text(row.email).toLowerCase();
    const phone = normalisePhone(row.phone);
    const name = text(row.name).replace(/\s+/g, ' ');
    if (!name && !email && !phone) continue;
    // Different email addresses may belong to family members sharing a phone.
    const key = email ? 'email:' + email : phone ? 'phone:' + phone : row.kind + ':' + row.id;
    let contact = contacts.get(key);
    if (!contact) {
      contact = { name: '', email, phone: '', address: '', source: '', tags: new Set() };
      contacts.set(key, contact);
    }
    // Query order prefers current account details, then newest submissions.
    contact.name ||= name;
    contact.phone ||= phone;
    contact.address ||= text(row.address);
    contact.tags.add(row.kind);
    if (row.active === false) contact.tags.add('inactive ' + row.kind);
    const source = text(row.source);
    if (source && (!contact.source || contact.source === 'website')) contact.source = source;
  }
  return [...contacts.values()].map(contact => {
    const [firstName, ...lastName] = contact.name.split(' ');
    if (!firstName) contact.tags.add('name needs review');
    if (contact.phone && !/^\+[1-9]\d{6,14}$/.test(contact.phone)) contact.tags.add('phone needs review');
    const postcode = contact.address.match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
    const compactPostcode = postcode ? postcode[0].replace(/\s/g, '').toUpperCase() : '';
    return [firstName || 'Unknown', lastName.join(' '), contact.email, contact.phone,
      [...contact.tags].join(', '), contact.address, '', '',
      compactPostcode ? compactPostcode.slice(0, -3) + ' ' + compactPostcode.slice(-3) : '',
      'GB', contact.source];
  });
}

function contactsCsv(contacts) {
  return '\uFEFF' + [HEADERS, ...contacts].map(row => row.map((cell, index) => csvCell(cell, index === 3)).join(',')).join('\r\n') + '\r\n';
}

async function loadContacts(sql, schoolId) {
  // Only contact fields: no credentials, private notes, payment or questionnaire data.
  // Trial requests reference enquiries, so they are already covered without requiring
  // the optional trial questionnaire migration. Waitlist entries reference learners.
  return sql`
    SELECT * FROM (
      SELECT id, name, email, phone, pickup_address AS address, 'learner' AS kind,
             NULL::boolean AS active, 'website' AS source, 1 AS priority
        FROM learner_users WHERE school_id = ${schoolId}
      UNION ALL
      SELECT id, name, email, phone, NULL, 'instructor', active, NULL, 2
        FROM instructors WHERE school_id = ${schoolId}
      UNION ALL
      SELECT id, name, email, NULL, NULL, 'administrator', active, NULL, 3
        FROM admin_users WHERE school_id = ${schoolId}
      UNION ALL
      SELECT id, name, email, phone, NULL, 'enquiry', NULL,
             COALESCE(NULLIF(BTRIM(utm_source), ''), 'website'), 4
        FROM enquiries WHERE school_id = ${schoolId}
      UNION ALL
      SELECT id, guest_name, guest_email, guest_phone, pickup_address, 'lesson request', NULL, 'website', 5
        FROM lesson_requests WHERE school_id = ${schoolId} AND learner_id IS NULL
      UNION ALL
      SELECT id, learner_name, learner_email, NULL, NULL, 'lesson offer', NULL, 'website', 6
        FROM lesson_offers WHERE school_id = ${schoolId} AND learner_id IS NULL
      UNION ALL
      SELECT id, NULL, NULL, guest_phone, NULL, 'guest booking', NULL, 'website', 7
        FROM lesson_bookings WHERE school_id = ${schoolId}
          AND learner_id IS NULL AND learner_anonymized IS NOT TRUE
    ) contacts ORDER BY priority, id DESC
  `;
}

async function handleExportContacts(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = getSchoolId(admin, req);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Select a school to export contacts.' });
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const contacts = buildContacts(await loadContacts(sql, schoolId));
    const csv = contactsCsv(contacts);
    await logAudit(sql, {
      adminId: admin.role === 'instructor' ? null : admin.id,
      adminEmail: admin.email, action: 'admin.contacts_export', targetType: 'school', targetId: schoolId,
      details: { format: 'gohighlevel', contact_count: contacts.length }, schoolId, req,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gohighlevel-contacts-school-${schoolId}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Contact-Count', String(contacts.length));
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Contact export failed:', error.message);
    return res.status(500).json({ error: 'Unable to export contacts. Please try again.' });
  }
}

module.exports = { handleExportContacts, buildContacts, contactsCsv, normalisePhone, loadContacts };
