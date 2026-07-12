(function () {
  'use strict';

  var progress;

  window.addEventListener('DOMContentLoaded', load);

  async function load() {
    if (!window.ccAuth || !ccAuth.getAuth()) return;
    try {
      var res = await ccAuth.fetchAuthed('/api/learner?action=progress');
      if (res.status === 401) { ccAuth.logout(); return; }
      if (!res.ok) throw new Error('Could not load your test details.');
      progress = await res.json();
      document.getElementById('testDate').value = progress.test_date || '';
      document.getElementById('testTime').value = progress.test_time || '';
      document.getElementById('testCentre').value = progress.test_centre || '';
      updateCountdown();
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  function updateCountdown() {
    var date = document.getElementById('testDate').value;
    var time = document.getElementById('testTime').value || '09:00';
    var el = document.getElementById('testCountdown');
    if (!date) { el.textContent = 'Haven\'t booked yet? Add the date when you are ready.'; return; }
    var days = Math.ceil((new Date(date + 'T' + time).getTime() - Date.now()) / 86400000);
    if (days < 0) el.textContent = 'Your test date has passed. Update it if you have rebooked.';
    else if (days === 0) el.textContent = 'Your test is today. Good luck!';
    else if (days === 1) el.textContent = '1 day until your test.';
    else el.textContent = days + ' days until your test.';
  }

  async function save() {
    if (!ccAuth.requireAuth()) return;
    var btn = document.getElementById('btnSaveTest');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    setStatus('', false);
    try {
      var payload = {
        test_date: document.getElementById('testDate').value,
        test_time: document.getElementById('testTime').value,
        test_centre: document.getElementById('testCentre').value.trim()
      };
      var res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your test details.');
      updateCountdown();
      setStatus('Details saved.', false);
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save details';
    }
  }

  function setStatus(message, isError) {
    var el = document.getElementById('saveStatus');
    el.textContent = message || '';
    el.style.color = isError ? 'var(--red, #dc2626)' : 'var(--green, #15803d)';
  }

  document.getElementById('testDate').addEventListener('change', updateCountdown);
  document.getElementById('testTime').addEventListener('change', updateCountdown);
  document.getElementById('btnSaveTest').addEventListener('click', save);
}());
