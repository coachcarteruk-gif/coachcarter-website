'use strict';
let submissionKey = crypto.randomUUID();
const invitationToken = location.hash.slice(1);
if (location.hash) history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
async function api(action, body) {
  const response = await fetch('/api/giveaway?action=' + action, action === 'config' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(document.cookie.split('; ').find(value => value.startsWith('cc_csrf='))?.slice(8) || '') }, body: JSON.stringify(body || {}) });
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
function shareApplicationLink(url) {
  const link = new URL(url);
  if (link.origin !== location.origin || link.pathname !== '/giveaway/apply.html' || !/^#[A-Za-z0-9_-]{43}$/.test(link.hash)) return;
  const label = document.createElement('label'); label.textContent = 'Send their private application link';
  const input = document.createElement('input'); input.type = 'text'; input.readOnly = true;
  input.id = 'nominee-share-link'; input.value = link.href; label.htmlFor = input.id;
  input.addEventListener('click', () => input.select());
  const button = document.createElement('button'); button.type = 'button'; button.className = 'primary'; button.textContent = 'Copy link';
  const status = document.createElement('p'); status.className = 'small'; status.setAttribute('role','status');
  status.textContent = 'You can also copy this link and send it to your nominee to ensure they definitely receive the link so they can submit before the deadline. This personal link gives access to their application; don’t post it publicly.';
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link.href); button.textContent = 'Link copied'; }
    catch { input.focus(); input.select(); status.textContent = 'Select and copy the link above, then send it privately to your nominee.'; }
  });
  const field = document.createElement('div'); field.className = 'field'; field.append(label,input);
  $('result').append(field,button,status);
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
      const response = await api(action, values(form)); form.hidden = true;
      if (action === 'apply') completed();
      else showResult('A lovely thing to do.', 'Your nomination has been received. Their private application link is sent automatically by email. Ask them to check their inbox and spam folder. If it hasn’t arrived, contact fraser@coachcarter.uk. They must apply before the deadline; there’s no need to nominate them again.', true);
      if (action === 'nominate' && response.application_url) shareApplicationLink(response.application_url);
    } catch (error) { errors(form, error); }
    finally { button.disabled = false; }
  });
}
function connectApplicationHeading() {
  const heading = $('application-heading');
  const button = $('start-application');
  const bar = button.closest('.application-cta');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let docked = null;
  let scheduled = false;
  function update() {
    scheduled = false;
    if ($('application').hidden) return;
    const target = heading.getBoundingClientRect();
    // Hand over where the matching fixed button meets its in-flow position.
    bar.style.paddingLeft = `${target.left}px`;
    bar.style.paddingRight = '0';
    button.style.width = `${target.width}px`;
    button.style.margin = '0';
    const source = button.getBoundingClientRect();
    const next = target.top <= source.top;
    if (next === docked) return;
    docked = next;
    document.body.classList.toggle('application-started', docked);
    bar.inert = docked;
    bar.setAttribute('aria-hidden', String(docked));
    if (docked && document.activeElement === button) heading.focus({ preventScroll: true });

  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(document.querySelector('.pass-intro'));
  document.fonts.ready.then(schedule);
  button.addEventListener('click', () => {
    heading.focus({ preventScroll: true });
    $('form').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  });
  update();
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
    else { connect($('nomination'), 'nominate'); $('nomination').hidden = false; }
  }
  if ($('application')) {
    // Fragments never reach access logs or referrer headers. Remove before any other action.
    const token = invitationToken;
    try {
      const data = await api('invitation', { token });
      if (data.completed) return completed();
      $('result').hidden = true; $('application').hidden = false;
      $('nominated-by').textContent = data.nominator_name + ' has nominated you for our first Lifelong Learner Pass.';
      $('name').value = data.nominee.name;
      const phone = document.createElement('div'), email = document.createElement('div'); phone.textContent = data.nominee.phone; email.textContent = data.nominee.email; $('contact-details').append(phone, email);
      document.querySelectorAll('[name=test_booked]').forEach(input => input.addEventListener('change', () => {
        const show = document.querySelector('[name=test_booked]:checked').value === 'yes'; $('test-details').hidden = !show;
        $('test-details').querySelectorAll('input').forEach(el => { el.required = show; el.disabled = !show; });
      }));
      connectApplicationHeading();
      connect($('application'), 'apply');
    } catch (error) { showResult('We can’t open this invitation.', error.message || 'Please check the complete link in your email and try again.'); }
  }
}
start().catch(() => { if ($('result')) { document.querySelector('form').hidden = true; showResult('Please try again shortly.', 'We couldn’t load the giveaway. Refresh this page to try again.'); } });
