(function () {
  'use strict';

  var progress;
  var latestIntake;

  window.addEventListener('DOMContentLoaded', load);

  async function load() {
    if (!window.ccAuth) return;
    if (!ccAuth.getAuth()) {
      document.getElementById('testCountdown').textContent = 'Sign in with your booking email to manage your current test details.';
      window.location.href = '/learner/login.html?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    try {
      var res = await ccAuth.fetchAuthed('/api/learner?action=profile');
      if (res.status === 401) { ccAuth.logout(); return; }
      if (!res.ok) throw new Error('Could not load your test details.');
      var data = await res.json();
      progress = data.profile;
      latestIntake = data.trial_intake;
      document.getElementById('useTrialAnswer').hidden = !latestIntake;
      document.getElementById('trialAnswerContext').textContent = latestIntake ? 'Your booking answer is historical. Review it and save explicitly to update your current details.' : '';

      document.getElementById('testBooked').value = progress.test_booked === false ? 'no' : progress.test_booked === true || progress.test_date ? 'yes' : 'unknown';
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
    if (!progress) { await load(); setStatus('Review the loaded details before saving.', false); return; }
    var btn = document.getElementById('btnSaveTest');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    setStatus('', false);
    try {
      var payload = {
        test_details_updated_at: progress.test_details_updated_at || null,
        test_details: { booked: document.getElementById('testBooked').value === 'yes' ? true : document.getElementById('testBooked').value === 'no' ? false : null,
          date: document.getElementById('testDate').value, time: document.getElementById('testTime').value, centre: document.getElementById('testCentre').value.trim() }
      };
      var res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (res.status === 409) { await load(); throw new Error('Your details changed elsewhere. The latest details are shown; review them before saving again.'); }
      if (!res.ok) throw new Error(data.error || 'Could not save your test details.');
      updateCountdown();
      progress = data.profile;
      setStatus('Details saved. Your lesson and test-day arrangements have not changed. Review the centre and any arrangements with your instructor.', false);
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

  document.getElementById('useTrialAnswer').addEventListener('click', function () {
    if (!latestIntake) return;
    document.getElementById('testBooked').value = latestIntake.test_booked === true ? 'yes' : latestIntake.test_booked === false ? 'no' : 'unknown';
    document.getElementById('testDate').value = latestIntake.test_date_snapshot || '';
    document.getElementById('testCentre').value = latestIntake.test_centre_snapshot || '';
    document.getElementById('testTime').value = '';
    updateCountdown(); setStatus('Review this booking answer, then Save details to apply it.', false);
  });
  document.getElementById('testBooked').addEventListener('change', function () {
    if (this.value !== 'yes') ['testDate', 'testTime', 'testCentre'].forEach(function (id) { document.getElementById(id).value = ''; });
    updateCountdown();
  });
  document.getElementById('testDate').addEventListener('change', function () { document.getElementById('testTime').value = ''; if (this.value) document.getElementById('testBooked').value = 'yes'; updateCountdown(); setStatus('Check the centre and add the time again if known.', false); });
  document.getElementById('testTime').addEventListener('change', updateCountdown);
  document.getElementById('btnSaveTest').addEventListener('click', save);
}());
