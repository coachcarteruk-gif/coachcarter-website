'use strict';
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
async function request(action) { const r = await fetch('/api/giveaway?action=' + action, action === 'review' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const data = await r.json(); if (!r.ok) throw data; return data; }
function describe(parent, object) { const dl = el('dl'); for (const [key, value] of Object.entries(object)) { dl.append(el('dt', key.replaceAll('_', ' ')), el('dd', typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? 'Not submitted'))); } parent.append(dl); }
async function load() {
  try {
    const data = await request('review'); document.getElementById('desk').hidden = false; document.getElementById('login').hidden = true;
    const emails = document.getElementById('emails'); emails.replaceChildren();
    data.emails.forEach(email => { const card = el('article', '', 'card review'); card.append(el('p', 'To: ' + email.recipient, 'small'), el('h3', 'You’ve been nominated to win free driving lessons!'), el('p', 'Someone has put you forward to win one free automatic driving lesson every week until you pass your practical driving test.'), el('p', 'Click the link below to find out who nominated you and finish your application before Sunday 11 October 2026 at 10pm UK time.')); const a = el('a', 'See my nomination and apply ↗', 'primary'); a.href = '/apply#' + email.token; card.append(a); emails.append(card); });
    if (!data.emails.length) emails.append(el('p', 'No captured invitations yet.'));
    const records = document.getElementById('records'); records.replaceChildren();
    data.records.forEach(row => { const card = el('details', '', 'card review'); const summary = el('summary', row.nominee.name + ' · nominated by ' + row.nominator.name); summary.append(el('span', row.application ? 'Applied' : 'Awaiting application', 'tag')); card.append(summary); if (row.application) {
      if (Object.hasOwn(row.application, 'barriers')) {
        card.append(el('h3', '1. Difference driving would make to everyday life'), el('p', row.application.meaning), el('h3', '2. Barriers free lessons would help overcome'), el('p', row.application.barriers));
      } else {
        card.append(el('h3', 'Earlier combined story answer'), el('p', row.application.meaning));
      }
    } describe(card, { nominee: row.nominee, nominator: row.nominator, relationship: row.relationship || 'Not provided', private_nomination: row.reason, invitation: row.invitation, permission: row.permission, application: row.application, marketing_consent: row.consents }); records.append(card); });
    document.getElementById('status').textContent = data.records.length + ' nomination(s). Review refreshed.';
  } catch (error) { document.getElementById('status').textContent = error.message || 'Please open the fictional review session.'; }
}
document.getElementById('login').addEventListener('click', async () => { await request('preview-login'); await load(); });
document.getElementById('refresh').addEventListener('click', load);
load();
