'use strict';
let before = '', loaded = 0;
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function answer(parent, label, value) {
  parent.append(element('h3', label), element('p', value == null || value === '' ? 'Not provided' : String(value)));
}
function render(row) {
  const card = element('details', null, 'card review');
  card.id = 'nomination-' + row.id;
  card.append(element('summary', (row.application?.name || row.nominee.name) + ' · ' + (row.application ? 'Application received' : 'Awaiting application')));
  answer(card, 'Nomination from ' + row.nominator.name, row.reason);
  if (row.application && !Object.hasOwn(row.application, 'barriers')) {
    answer(card, 'Earlier combined story answer', row.application.meaning);
    card.append(element('p', 'This application used the earlier form with one story question.'));
  } else {
    answer(card, '1. Difference driving would make to everyday life', row.application?.meaning);
    answer(card, '2. Barriers free lessons would help overcome', row.application?.barriers);
  }
  const details = element('details');
  details.append(element('summary', 'Contact details and other answers'));
  const data = element('pre', JSON.stringify(row, null, 2));
  data.style.whiteSpace = 'pre-wrap';
  details.append(data); card.append(details);
  return card;
}
async function load() {
  const button = document.getElementById('more'); button.disabled = true;
  try {
    const response = await fetch('/api/giveaway?action=review' + (before ? '&before=' + encodeURIComponent(before) : ''), {cache:'no-store'});
    const data = await response.json(); if (!response.ok) throw new Error('Unavailable');
    for (const row of data.records) document.getElementById('records').append(render(row));
    loaded += data.records.length; before = data.next; button.hidden = !before;
    document.getElementById('status').textContent = loaded + ' nomination records loaded. ' + (before ? 'More records remain; load all before reviewing the full campaign.' : 'All available records loaded.') + ' Multiple nominations may refer to the same person.';
  } catch { document.getElementById('status').textContent = 'Unable to load nominations. Sign in as a school administrator, or try again.'; button.hidden = false; }
  finally { button.disabled = false; }
}
async function loadIntegrationStatus() {
  const target = document.getElementById('integration-status');
  const kinds = {invitation:'Invitations',crm:'CRM updates',suppression:'Opt-out updates'};
  const states = {pending:'queued',claimed:'claimed',dispatching:'in progress',succeeded:'completed',uncertain:'uncertain — needs investigation',cancelled:'cancelled'};
  try {
    const response = await fetch('/api/giveaway?action=integration-status', {cache:'no-store'});
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json(); target.replaceChildren();
    if (!data.jobs.length) target.append(element('p','No integration jobs recorded.'));
    const list = element('ul');
    for (const job of data.jobs) list.append(element('li',(kinds[job.kind] || job.kind) + ': ' + job.count + ' ' + (states[job.state] || job.state)));
    target.append(list);
  } catch { target.textContent = 'Integration status unavailable. Sign in as a school administrator, or try again.'; }
}
document.getElementById('more').addEventListener('click',load);
document.getElementById('refresh-integrations').addEventListener('click',loadIntegrationStatus);
load(); loadIntegrationStatus();
