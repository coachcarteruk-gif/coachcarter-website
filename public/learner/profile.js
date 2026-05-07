(function () {
  'use strict';

// â”€â”€ Auth â”€â”€
let AUTH, PROGRESS;

window.addEventListener('DOMContentLoaded', async () => {
  AUTH = ccAuth.getAuth();
  if (!AUTH) {
    // Spectator mode: form visible, saves gated by requireAuth() at submit time.
    var guestHint = document.getElementById('guestHint');
    if (guestHint) guestHint.style.display = 'block';
    return;
  }
  await loadProgress();
  render();
});

function logout() { ccAuth.logout(); }

async function loadProgress() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=progress');
    if (res.status === 401) { logout(); return; }
    PROGRESS = await res.json();
  } catch (e) { console.error(e); }
}

function render() {
  if (!PROGRESS) return;

  // Page title with name
  document.getElementById('page-title').textContent = PROGRESS.name ? `${PROGRESS.name}'s Profile` : 'My Profile';

  // Profile card
  renderProfile();

  // Driving test
  renderTestDate();

  // Contact preference
  if (PROGRESS.prefer_contact_before !== undefined) {
    document.getElementById('contactToggle').checked = PROGRESS.prefer_contact_before;
    updatePrefSub(PROGRESS.prefer_contact_before);
  }

  // Availability (async, non-blocking)
  loadAvailability();

  // Stats
  const s = PROGRESS.stats;
  if (s) {
    document.getElementById('stat-sessions').textContent = s.total_sessions;
    document.getElementById('stat-hours').textContent = (s.total_minutes / 60).toFixed(1);
    document.getElementById('stat-instructor').textContent = s.instructor_sessions;
    document.getElementById('stat-private').textContent = s.private_sessions;
  }
}

// â”€â”€ Postcode address lookup â”€â”€
let confirmedPostcodeData = null;

async function lookupPostcode() {
  const input = document.getElementById('postcodeInput');
  const btn = document.getElementById('btnLookup');
  const error = document.getElementById('postcodeError');
  const confirmed = document.getElementById('postcodeConfirmed');
  const addressLine = document.getElementById('addressLine');
  const postcode = input.value.trim().replace(/\s+/g, '');

  error.style.display = 'none';
  confirmed.style.display = 'none';

  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(postcode)) {
    error.textContent = 'Please enter a valid UK postcode';
    error.style.display = 'block';
    return;
  }

  btn.disabled = true; btn.textContent = 'Looking up\u2026';
  try {
    const res = await ccAuth.fetchAuthed('/api/address-lookup?postcode=' + encodeURIComponent(postcode));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    confirmedPostcodeData = data;
    confirmed.textContent = '\u2713 ' + data.area + ', ' + data.postcode;
    confirmed.style.display = 'block';
    addressLine.style.display = 'block';
    addressLine.focus();
    buildFullAddress();
  } catch (err) {
    error.textContent = err.message || 'Lookup unavailable';
    error.style.display = 'block';
    addressLine.style.display = 'none';
    confirmedPostcodeData = null;
  }
  btn.disabled = false; btn.textContent = 'Find address';
}

function buildFullAddress() {
  const line = (document.getElementById('addressLine').value || '').trim();
  if (confirmedPostcodeData) {
    const parts = [line, confirmedPostcodeData.area, confirmedPostcodeData.postcode].filter(Boolean);
    document.getElementById('profileAddress').value = parts.join(', ');
  } else {
    document.getElementById('profileAddress').value = line;
  }
  updateProfileBadge();
}

// â”€â”€ Profile (phone + pickup address) â”€â”€
function renderProfile() {
  if (!PROGRESS) return;
  const phone = PROGRESS.phone || '';
  const saved = PROGRESS.pickup_address || '';

  // Always populate the form fields so they're ready when editing
  document.getElementById('profilePhone').value = phone;
  document.getElementById('profileAddress').value = saved;
  if (saved) {
    document.getElementById('addressLine').value = saved;
    document.getElementById('addressLine').style.display = 'block';
    document.getElementById('postcodeConfirmed').textContent = '\u2713 Saved address (enter postcode to update)';
    document.getElementById('postcodeConfirmed').style.display = 'block';
    confirmedPostcodeData = null;
  }

  // Show read-only view when both fields are filled, otherwise the edit form
  if (phone && saved) {
    showProfileSavedView();
  } else {
    showProfileEditForm();
  }
  updateProfileBadge();
}

function showProfileSavedView() {
  const view = document.getElementById('profileSavedView');
  const form = document.getElementById('profileEditForm');
  if (!view || !form) return;
  document.getElementById('savedPhone').textContent = PROGRESS.phone || '';
  document.getElementById('savedAddress').textContent = PROGRESS.pickup_address || '';
  view.style.display = 'flex';
  form.style.display = 'none';
}

function showProfileEditForm(focusField) {
  const view = document.getElementById('profileSavedView');
  const form = document.getElementById('profileEditForm');
  if (!view || !form) return;
  view.style.display = 'none';
  form.style.display = 'block';
  if (focusField === 'phone') {
    setTimeout(function () { var el = document.getElementById('profilePhone'); if (el) el.focus(); }, 0);
  } else if (focusField === 'address') {
    setTimeout(function () { var el = document.getElementById('postcodeInput'); if (el) el.focus(); }, 0);
  }
}

function updateProfileBadge() {
  const phone = (document.getElementById('profilePhone').value || '').trim();
  const address = (document.getElementById('profileAddress').value || '').trim();
  const badge = document.getElementById('profileBadge');
  const note = document.getElementById('profileSaveNote');
  if (phone && address) {
    badge.textContent = 'Complete';
    badge.className = 'acc-status is-ok';
    note.textContent = 'Your instructor will see these details when you book.';
  } else {
    badge.textContent = 'Required for booking';
    badge.className = 'acc-status is-warn';
    note.textContent = 'Required before you can book a lesson.';
  }
}

async function saveProfile() {
  if (window.ccAuth && !window.ccAuth.requireAuth()) return;
  const phone = document.getElementById('profilePhone').value.trim();
  const address = document.getElementById('profileAddress').value.trim();
  const btn = document.getElementById('btnSaveProfile');
  btn.disabled = true; btn.textContent = 'Saving\u2026';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, pickup_address: address })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    PROGRESS.phone = phone;
    PROGRESS.pickup_address = address;
    updateProfileBadge();
    btn.textContent = 'Saved \u2713';
    setTimeout(() => {
      btn.textContent = 'Save'; btn.disabled = false;
      if (phone && address) showProfileSavedView();
    }, 800);
  } catch (err) {
    btn.textContent = 'Save'; btn.disabled = false;
    const note = document.getElementById('profileSaveNote');
    if (note) {
      note.textContent = err.message || 'Failed to save. Please try again.';
      note.style.color = '#e74c3c';
    }
    console.error('save-profile error:', err);
  }
}

// â”€â”€ Driving Test Date â”€â”€
function renderTestDate() {
  const dateInput = document.getElementById('testDate');
  const timeInput = document.getElementById('testTime');
  const countdownEl = document.getElementById('testCountdown');

  if (PROGRESS.test_date) {
    dateInput.value = PROGRESS.test_date;
  }
  if (PROGRESS.test_time) {
    timeInput.value = PROGRESS.test_time;
  }

  updateTestCountdown();
}

function updateTestCountdown() {
  const countdownEl = document.getElementById('testCountdown');
  const testDate = document.getElementById('testDate').value;

  if (!testDate) {
    countdownEl.innerHTML = '<div class="test-encouragement">Haven\'t booked your test yet? We\'ll help you get test-ready.</div>';
    return;
  }

  const testTime = document.getElementById('testTime').value || '09:00';
  const testDateTime = new Date(testDate + 'T' + testTime);
  const now = new Date();
  const diffMs = testDateTime.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    countdownEl.innerHTML = '<div class="test-countdown">Your test date has passed. Update it if you\'ve rebooked.</div>';
  } else if (diffDays === 0) {
    countdownEl.innerHTML = '<div class="test-countdown">Your test is today! Good luck!</div>';
  } else if (diffDays === 1) {
    countdownEl.innerHTML = '<div class="test-countdown">1 day until your test!</div>';
  } else {
    countdownEl.innerHTML = '<div class="test-countdown">' + diffDays + ' days until your test</div>';
  }
}

async function saveTest() {
  if (window.ccAuth && !window.ccAuth.requireAuth()) return;
  const testDate = document.getElementById('testDate').value;
  const testTime = document.getElementById('testTime').value;
  const btn = document.getElementById('btnSaveTest');
  btn.disabled = true; btn.textContent = 'Saving\u2026';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test_date: testDate, test_time: testTime })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    PROGRESS.test_date = testDate;
    PROGRESS.test_time = testTime;
    updateTestCountdown();
    btn.textContent = 'Saved \u2713';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = 'Save'; btn.disabled = false;
    console.error('save-test error:', err);
  }
}

// â”€â”€ Contact preference toggle â”€â”€
function updatePrefSub(isOn) {
  const sub = document.getElementById('pref-sub');
  sub.textContent = isOn
    ? 'Your instructor will be notified to contact you before your first session.'
    : 'Let your instructor know you\'d like a call or message before your first session.';
}

async function toggleContactPref() {
  const toggle = document.getElementById('contactToggle');
  const val = toggle.checked;
  updatePrefSub(val);

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=set-contact-pref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefer_contact_before: val })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    toggle.checked = !val;
    updatePrefSub(!val);
    console.error('contact-pref error:', err);
  }
}

// â”€â”€ Availability â”€â”€
let AVAIL_WINDOWS = [];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Display order: Mon-Sun
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

async function loadAvailability() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=my-availability');
    if (!res.ok) return;
    const data = await res.json();
    AVAIL_WINDOWS = (data.availability || []).map(w => ({
      day_of_week: w.day_of_week,
      start_time: w.start_time.slice(0, 5),
      end_time: w.end_time.slice(0, 5)
    }));
  } catch (e) { console.error('load-availability error:', e); }
  drawAvailDays();
}

function drawAvailDays() {
  const container = document.getElementById('availDays');
  if (!container) return;
  let html = '';
  for (const day of DAY_ORDER) {
    const windows = AVAIL_WINDOWS.filter(w => w.day_of_week === day);
    html += `<div class="avail-day-row" data-day="${day}">
      <div class="avail-day-label">${DAY_NAMES[day]}</div>
      <div class="avail-chips">`;
    if (windows.length === 0) {
      html += `<span class="avail-empty">No times set</span>`;
    } else {
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        html += `<span class="avail-chip">${fmtTime(w.start_time)} "“ ${fmtTime(w.end_time)}<span class="avail-chip-x" data-action="remove-avail-window" data-day="${day}" data-idx="${i}">&times;</span></span>`;
      }
    }
    html += `<button type="button" class="avail-add-btn" data-action="show-add-row" data-day="${day}">+</button>`;
    html += `</div></div>`;
  }
  container.innerHTML = html;
  updateAvailBadge();
}

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}

function updateAvailBadge() {
  const badge = document.getElementById('availBadge');
  if (AVAIL_WINDOWS.length === 0) {
    badge.textContent = 'Not set';
    badge.className = 'acc-status is-warn';
  } else {
    badge.textContent = AVAIL_WINDOWS.length + ' slot' + (AVAIL_WINDOWS.length !== 1 ? 's' : '') + ' set';
    badge.className = 'acc-status is-ok';
  }
}

function showAddRow(btn, day) {
  // Remove any existing add row
  document.querySelectorAll('.avail-add-row').forEach(el => el.remove());

  const row = document.createElement('div');
  row.className = 'avail-add-row';

  // Build time options (07:00 to 21:00 in 30-min steps)
  let opts = '';
  for (let h = 7; h <= 21; h++) {
    for (const m of ['00', '30']) {
      if (h === 21 && m === '30') continue;
      const val = String(h).padStart(2, '0') + ':' + m;
      opts += `<option value="${val}">${fmtTime(val)}</option>`;
    }
  }

  row.innerHTML = `
    <select class="avail-sel-start">${opts}</select>
    <span style="color:var(--muted);font-size:0.8rem">to</span>
    <select class="avail-sel-end">${opts}</select>
    <button type="button" class="avail-add-confirm" data-action="confirm-add-window" data-day="${day}">Add</button>
    <button type="button" class="avail-add-cancel" data-action="remove-parent">&times;</button>
  `;

  // Default: start 09:00, end 17:00
  btn.parentElement.appendChild(row);
  row.querySelector('.avail-sel-start').value = '09:00';
  row.querySelector('.avail-sel-end').value = '17:00';
}

function confirmAddWindow(btn, day) {
  const row = btn.parentElement;
  const start = row.querySelector('.avail-sel-start').value;
  const end = row.querySelector('.avail-sel-end').value;
  if (start >= end) {
    alert('End time must be after start time');
    return;
  }
  // Check overlap with existing windows for this day
  const existing = AVAIL_WINDOWS.filter(w => w.day_of_week === day);
  for (const w of existing) {
    if (start < w.end_time && end > w.start_time) {
      alert('This overlaps with an existing time slot');
      return;
    }
  }
  AVAIL_WINDOWS.push({ day_of_week: day, start_time: start, end_time: end });
  drawAvailDays();
}

function removeAvailWindow(day, idx) {
  const dayWindows = AVAIL_WINDOWS.filter(w => w.day_of_week === day);
  const toRemove = dayWindows[idx];
  if (!toRemove) return;
  const globalIdx = AVAIL_WINDOWS.findIndex(w =>
    w.day_of_week === toRemove.day_of_week &&
    w.start_time === toRemove.start_time &&
    w.end_time === toRemove.end_time
  );
  if (globalIdx !== -1) AVAIL_WINDOWS.splice(globalIdx, 1);
  drawAvailDays();
}

async function saveAvailability() {
  if (window.ccAuth && !window.ccAuth.requireAuth()) return;
  const btn = document.getElementById('btnSaveAvail');
  const note = document.getElementById('availSaveNote');
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  note.style.color = '';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=set-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: AVAIL_WINDOWS })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    btn.textContent = 'Saved \u2713';
    note.textContent = '';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = 'Save'; btn.disabled = false;
    note.textContent = err.message || 'Failed to save. Please try again.';
    note.style.color = '#e74c3c';
    console.error('save-availability error:', err);
  }
}

// â”€â”€ GDPR: Request Account Deletion â”€â”€
async function requestDeletion(btn) {
  if (!confirm('Are you sure you want to delete your account? This action CANNOT be undone. All your bookings, progress, and personal data will be permanently removed.')) return;
  if (!confirm('This is your final confirmation. Proceed with account deletion?')) return;
  btn.disabled = true; btn.style.opacity = '.6';
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=request-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    alert('Check your email for a confirmation link to complete the deletion.');
  } catch (err) {
    alert(err.message || 'Failed to request deletion');
  }
  btn.disabled = false; btn.style.opacity = '1';
}

document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'remove-avail-window') removeAvailWindow(parseInt(target.dataset.day, 10), parseInt(target.dataset.idx, 10));
  else if (action === 'show-add-row') showAddRow(target, parseInt(target.dataset.day, 10));
  else if (action === 'confirm-add-window') confirmAddWindow(target, parseInt(target.dataset.day, 10));
  else if (action === 'remove-parent') { if (target.parentElement) target.parentElement.remove(); }
});
(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btnLookup', lookupPostcode);
  bind('btnSaveProfile', saveProfile);
  bind('btnSaveTest', saveTest);
  bind('btnSaveAvail', saveAvailability);
  bind('btnEditPhone', function () { showProfileEditForm('phone'); });
  bind('btnEditAddress', function () { showProfileEditForm('address'); });
  var addressLine = document.getElementById('addressLine');
  if (addressLine) addressLine.addEventListener('input', buildFullAddress);
  var contactToggle = document.getElementById('contactToggle');
  if (contactToggle) contactToggle.addEventListener('change', toggleContactPref);
  var cookieLink = document.getElementById('link-cookie-prefs');
  if (cookieLink) cookieLink.addEventListener('click', function (e) { e.preventDefault(); if (window.ccCookieConsent) window.ccCookieConsent.show(); });
  var delBtn = document.getElementById('btn-request-deletion');
  if (delBtn) delBtn.addEventListener('click', function () { requestDeletion(delBtn); });
})();
})();
