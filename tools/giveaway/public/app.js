'use strict';
let submissionKey = crypto.randomUUID();
const $ = id => document.getElementById(id);
async function api(action, body) {
  const response = await fetch('/api/giveaway?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await response.json();
  if (!response.ok) throw data;
  return data;
}
function showResult(title, message, completed = false) {
  const target = $('result'); target.replaceChildren(); target.hidden = false;
  const icon = document.createElement('div'); icon.className = 'tick'; icon.textContent = completed ? '✓' : '→'; icon.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('h2'); heading.textContent = title;
  const copy = document.createElement('p'); copy.textContent = message;
  target.append(icon, heading, copy); target.focus();
}
function completed() {
  showResult('You’re all done.', 'Your application has been received. Thank you for sharing your story, and good luck! You don’t need to submit again.', true);
  const line = document.createElement('p'); line.className = 'small'; line.textContent = 'Changed your mind about future updates? You can withdraw both marketing permissions below without withdrawing your application.';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet'; button.textContent = 'Withdraw marketing permissions';
  button.addEventListener('click', async () => { button.disabled = true; try { await api('withdraw'); line.textContent = 'Your marketing permissions have been withdrawn.'; button.remove(); } catch { line.textContent = 'We couldn’t save that change. Please try again.'; button.disabled = false; } });
  $('result').append(line, button);
}
function values(form) {
  const data = Object.fromEntries(new FormData(form));
  form.querySelectorAll('[type=checkbox]').forEach(input => { data[input.name] = input.checked; });
  return { ...data, submission_key: submissionKey };
}
function errors(form, data) {
  form.querySelectorAll('.error').forEach(el => el.remove());
  form.querySelectorAll('[aria-invalid]').forEach(el => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
  $('errors').textContent = data.message || 'We couldn’t save this right now. Your answers are still here. Please try again.';
  for (const [key, message] of Object.entries(data.fields || {})) {
    const element = $(key); if (!element) continue;
    const note = document.createElement('span'); note.className = 'error'; note.id = key + '-error'; note.textContent = message;
    const container = element.closest('.field') || element.closest('.check'); container.append(note);
    element.setAttribute('aria-invalid', 'true'); element.setAttribute('aria-describedby', note.id);
  }
  $('errors').focus();
}
function connect(form, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const invalid = {};
    form.querySelectorAll('input,textarea,select').forEach(input => { if (!input.checkValidity()) invalid[input.name] = input.validationMessage; });
    form.querySelectorAll('input[type=tel]').forEach(input => { if (!/^07\d{9}$/.test(input.value.replace(/[\s()-]/g, '').replace(/^\+44/, '0'))) invalid[input.name] = 'Enter a valid UK mobile number.'; });
    if (Object.keys(invalid).length) { errors(form, { message: 'Please check the highlighted answers.', fields: invalid }); return; }
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      await api(action, values(form)); form.hidden = true;
      if (action === 'apply') completed();
      else showResult('A lovely thing to do.', 'Your nomination has been received. We’ll invite the person you nominated by email. They’ll need to complete their application before the deadline. There’s no need to nominate them again.', true);
    } catch (error) { errors(form, error); }
    finally { button.disabled = false; }
  });
}
async function start() {
  const config = await api('config');
  const closes = new Date(config.deadline);
  const midnight = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(closes) === '00:00:00';
  const deadline = midnight
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full' }).format(new Date(closes.getTime() - 1)) + ' at midnight (end of Sunday)'
    : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }).format(closes);
  document.querySelectorAll('[data-deadline]').forEach(el => { el.textContent = deadline; });
  if ($('nomination')) {
    if (!config.open) { $('nomination').hidden = true; showResult('Applications have closed.', 'Thank you for your interest in our first giveaway.'); }
    else connect($('nomination'), 'nominate');
  }
  if ($('application')) {
    // Fragments never reach access logs or referrer headers. Remove before any other action.
    const token = location.hash.slice(1); history.replaceState(null, '', location.pathname);
    try {
      const data = await api('invitation', { token });
      if (data.completed) return completed();
      $('result').hidden = true; $('application').hidden = false;
      $('nominated-by').textContent = data.nominator_name + ' has nominated you for our first driving lesson giveaway.';
      $('name').value = data.nominee.name;
      const phone = document.createElement('div'), email = document.createElement('div'); phone.textContent = data.nominee.phone; email.textContent = data.nominee.email; $('contact-details').append(phone, email);
      document.querySelectorAll('[name=test_booked]').forEach(input => input.addEventListener('change', () => {
        const show = document.querySelector('[name=test_booked]:checked').value === 'yes'; $('test-details').hidden = !show;
        $('test-details').querySelectorAll('input').forEach(el => { el.required = show; el.disabled = !show; });
      }));
      connect($('application'), 'apply');
    } catch (error) { showResult('We can’t open this invitation.', error.message || 'Please check the complete link in your email and try again.'); }
  }
}
start().catch(() => { if ($('result')) { document.querySelector('form').hidden = true; showResult('Please try again shortly.', 'We couldn’t load the giveaway. Refresh this page to try again.'); } });
