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
async function integrationAction(action,body) {
  const config=await fetch('/api/giveaway?action=config',{cache:'no-store'});
  if(!config.ok)throw Error('Campaign unavailable.');
  const csrf=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('cc_csrf='))?.slice(8)||'');
  const response=await fetch('/api/giveaway?action='+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(data.message||'Integration unavailable.');return data;
}
function integrationControls(row) {
  const section=element('details');section.append(element('summary','Invitation and CRM controls'));
  const status=element('p','Run once processes at most one invitation and one CRM update. Uncertain outcomes require investigation.','small');status.setAttribute('role','status');
  if(!row.application) {
    const label=element('label',null,'check'),check=document.createElement('input');check.type='checkbox';
    label.append(check,element('span','The nominee specifically requested an invitation email; I have verified this separately from the nomination.'));
    const refLabel=element('label','Evidence reference (case ID, no personal story)'),reference=document.createElement('input');reference.maxLength=100;reference.placeholder='Request evidence reference';refLabel.append(reference);
    const save=element('button','Record invitation request','quiet');save.type='button';
    save.addEventListener('click',async()=>{save.disabled=true;try{
      const data=await integrationAction('record-invitation-request',{nomination_id:row.id,nominee_requested:check.checked,verification_reference:reference.value.trim()});
      status.textContent=data.ok?'Request evidence recorded. No email has been sent.':'This nomination can no longer accept request evidence.';
    }catch(e){status.textContent=e.message;}finally{save.disabled=false;}});
    section.append(label,refLabel,save);
  }
  const run=element('button','Run invitation / CRM once','quiet');run.type='button';
  run.addEventListener('click',async()=>{run.disabled=true;try{
    const data=await integrationAction('run-integration',{nomination_id:row.id});
    status.textContent='Result: '+data.result.status+(data.result.invitation?' · Invitation: '+data.result.invitation.status:'')+(data.result.crm?' · CRM: '+data.result.crm.status:'');
    await loadIntegrationStatus();
  }catch(e){status.textContent=e.message;}finally{run.disabled=false;}});
  section.append(run,status);return section;
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
  details.append(data); card.append(details,integrationControls(row));
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
document.getElementById('marketing-withdrawal').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('withdraw-status');
  button.disabled=true;
  try {
    await integrationAction('withdraw-marketing',{verified_email:document.getElementById('withdraw-email').value.trim(),verification_reference:document.getElementById('withdraw-reference').value.trim()});
    status.textContent='Marketing opt-out recorded. Nomination and application kept. Any external marketing lists must also honour this opt-out before further sends.';
    form.reset();await loadIntegrationStatus();
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
document.getElementById('refresh-integrations').addEventListener('click',loadIntegrationStatus);
load(); loadIntegrationStatus();
