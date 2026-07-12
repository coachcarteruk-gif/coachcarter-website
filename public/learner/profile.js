(function () {
  'use strict';

// ── Auth ──
let AUTH, PROGRESS, BALANCE_DATA;

window.addEventListener('DOMContentLoaded', async () => {
  AUTH = ccAuth.getAuth();
  if (!AUTH) {
    // Spectator mode: form visible, saves gated by requireAuth() at submit time.
    var guestHint = document.getElementById('guestHint');
    if (guestHint) guestHint.style.display = 'block';
    return;
  }
  await Promise.all([loadProgress(), loadCreditBalances()]);
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

async function loadCreditBalances() {
  try {
    const res = await ccAuth.fetchAuthed('/api/credits?action=balance');
    if (res.status === 401) { logout(); return; }
    if (res.ok) BALANCE_DATA = await res.json();
  } catch (e) { console.error('load-credit-balances error:', e); }
}

function formatHours(minutes) {
  const hrs = (Number(minutes) || 0) / 60;
  return hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtClock(timeStr) {
  return timeStr ? String(timeStr).slice(0, 5) : '';
}

function renderOfficialTestSummary() {
  const body = document.getElementById('officialTestSummaryBody');
  if (!body || !PROGRESS) return;
  const date = PROGRESS.test_date || '';
  const time = PROGRESS.test_time || '';
  const centre = PROGRESS.test_centre || '';
  if (!date || !time || !centre) {
    body.innerHTML = '<div class="official-test-empty">Add your official test date, time and centre to keep your lesson plan accurate.</div>';
    return;
  }
  body.innerHTML =
    '<div class="official-test-grid">' +
      '<div class="official-test-item"><div class="official-test-label">Date</div><div class="official-test-value">' + escapeHtml(fmtDate(date)) + '</div></div>' +
      '<div class="official-test-item"><div class="official-test-label">Time</div><div class="official-test-value">' + escapeHtml(fmtClock(time)) + '</div></div>' +
      '<div class="official-test-item"><div class="official-test-label">Centre</div><div class="official-test-value">' + escapeHtml(centre) + '</div></div>' +
    '</div>';
}

function render() {
  if (!PROGRESS) return;

  // Page title with name
  document.getElementById('page-title').textContent = PROGRESS.name ? `${PROGRESS.name}'s Profile` : 'My Profile';

  // Profile card
  renderProfile();

  renderOfficialTestSummary();

  // Driving test
  renderTestDate();

  // Stats
  const s = PROGRESS.stats;
  if (s) {
    document.getElementById('stat-sessions').textContent = s.total_sessions;
    document.getElementById('stat-hours').textContent = (s.total_minutes / 60).toFixed(1);
    document.getElementById('stat-instructor').textContent = s.instructor_sessions;
    document.getElementById('stat-private').textContent = s.private_sessions;
  }

  renderCreditBalances();
}

function renderCreditBalances() {
  const totalEl = document.getElementById('creditBalanceTotal');
  const rowsEl = document.getElementById('creditBalanceRows');
  const badge = document.getElementById('creditBalanceBadge');
  if (!totalEl || !rowsEl || !badge) return;

  if (!BALANCE_DATA) {
    totalEl.textContent = '0 hrs';
    rowsEl.innerHTML = '<div class="credit-balance-empty">No lesson credits yet</div>';
    badge.textContent = '0 hrs';
    return;
  }

  const totalMinutes = BALANCE_DATA.balance_minutes || 0;
  const totalHours = formatHours(totalMinutes);
  totalEl.textContent = totalHours + ' hr' + (totalHours !== '1' ? 's' : '');
  badge.textContent = totalHours + ' hr' + (totalHours !== '1' ? 's' : '') + ' total';

  const rows = (BALANCE_DATA.balances || []).filter(function(row) {
    return (row.balance_minutes || 0) > 0;
  });

  if (rows.length === 0) {
    rowsEl.innerHTML = '<div class="credit-balance-empty">No lesson credits yet</div>';
    return;
  }

  rowsEl.innerHTML = rows.map(function(row) {
    var hours = formatHours(row.balance_minutes);
    return '<div class="credit-balance-row">' +
      '<span class="credit-balance-name">' + escapeHtml(row.instructor_name || 'Instructor') + '</span>' +
      '<span class="credit-balance-hours">' + hours + ' hr' + (hours !== '1' ? 's' : '') + '</span>' +
      '</div>';
  }).join('');
}

// ── Postcode address lookup ──
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

// ── Profile (phone + pickup address) ──
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

// ── Driving Test Date ──
function renderTestDate() {
  const dateInput = document.getElementById('testDate');
  const timeInput = document.getElementById('testTime');
  const centreInput = document.getElementById('testCentre');
  if (!dateInput || !timeInput) return;

  if (PROGRESS.test_date) {
    dateInput.value = PROGRESS.test_date;
  }
  if (PROGRESS.test_time) {
    timeInput.value = PROGRESS.test_time;
  }
  if (PROGRESS.test_centre && centreInput) {
    centreInput.value = PROGRESS.test_centre;
  }

  updateTestCountdown();
}

function updateTestCountdown() {
  const countdownEl = document.getElementById('testCountdown');
  const testDateInput = document.getElementById('testDate');
  if (!countdownEl || !testDateInput) return;
  const testDate = testDateInput.value;

  if (!testDate) {
    countdownEl.innerHTML = '<div class="test-encouragement">Haven\'t booked your test yet? We\'ll help you get test-ready.</div>';
    return;
  }

  const testTimeEl = document.getElementById('testTime');
  const testTime = (testTimeEl && testTimeEl.value) || '09:00';
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
  const testCentre = (document.getElementById('testCentre').value || '').trim();
  const btn = document.getElementById('btnSaveTest');
  btn.disabled = true; btn.textContent = 'Saving\u2026';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test_date: testDate, test_time: testTime, test_centre: testCentre })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    PROGRESS.test_date = testDate;
    PROGRESS.test_time = testTime;
    PROGRESS.test_centre = testCentre;
    renderOfficialTestSummary();
    updateTestCountdown();
    hideTestEditForm();
    btn.textContent = 'Saved \u2713';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = 'Save'; btn.disabled = false;
    console.error('save-test error:', err);
  }
}

function showTestEditForm() {
  var form = document.getElementById('officialTestEditForm');
  if (!form) return;
  form.style.display = 'block';
  renderTestDate();
  setTimeout(function () {
    var el = document.getElementById('testDate');
    if (el) el.focus();
  }, 0);
}

function hideTestEditForm() {
  var form = document.getElementById('officialTestEditForm');
  if (form) form.style.display = 'none';
}

// ── GDPR: Request Account Deletion ──
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

(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btnLookup', lookupPostcode);
  bind('btnSaveProfile', saveProfile);
  bind('btnSaveTest', saveTest);
  bind('btnEditPhone', function () { showProfileEditForm('phone'); });
  bind('btnEditAddress', function () { showProfileEditForm('address'); });
  bind('btnEditOfficialTest', showTestEditForm);
  bind('btnCancelTestEdit', hideTestEditForm);
  var addressLine = document.getElementById('addressLine');
  if (addressLine) addressLine.addEventListener('input', buildFullAddress);
  var cookieLink = document.getElementById('link-cookie-prefs');
  if (cookieLink) cookieLink.addEventListener('click', function (e) { e.preventDefault(); if (window.ccCookieConsent) window.ccCookieConsent.show(); });
  var delBtn = document.getElementById('btn-request-deletion');
  if (delBtn) delBtn.addEventListener('click', function () { requestDeletion(delBtn); });

  // Calendar sync token rotation (PR-L, audit #17). Fetches the current token
  // status on load and binds the rotate button. The card stays hidden if the
  // user has never set up calendar sync - no calendar_token = nothing to rotate.
  var calCard = document.getElementById('calendar-token-card');
  var calStatus = document.getElementById('cal-token-status');
  var rotateBtn = document.getElementById('btn-rotate-calendar');
  if (calCard && calStatus && rotateBtn && window.ccAuth && ccAuth.getAuth()) {
    (async function loadCalendarTokenStatus() {
      try {
        var res = await ccAuth.fetchAuthed('/api/calendar?action=feed-url');
        if (!res.ok) return;
        var data = await res.json();
        if (!data || !data.feed_url) return;
        calCard.style.display = 'block';
        if (data.rotated_at) {
          var ts = new Date(data.rotated_at);
          calStatus.textContent = 'Subscription link issued ' + ts.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) + '.';
        } else {
          calStatus.textContent = 'Active subscription link on file (pre-rotation).';
        }
      } catch (e) { console.warn('calendar-token status load failed:', e); }
    })();

    rotateBtn.addEventListener('click', async function () {
      if (!confirm('Rotate your calendar subscription link?\n\nThe old subscription will stop working. You\'ll need to re-subscribe in your calendar app with the new link.')) return;
      rotateBtn.disabled = true;
      try {
        var res = await ccAuth.fetchAuthed('/api/calendar?action=rotate-token', { method: 'POST' });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          alert('Failed to rotate: ' + (data.error || res.status));
          return;
        }
        if (data.rotated_at) {
          var ts = new Date(data.rotated_at);
          calStatus.textContent = 'Subscription link rotated ' + ts.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) + '. Old link is now invalid.';
        }
        alert('Done. The old subscription will stop syncing.\n\nNew subscription link:\n' + data.webcal_url);
      } catch (e) {
        console.error('rotate-calendar failed:', e);
        alert('Failed to rotate calendar link. Please try again.');
      } finally {
        rotateBtn.disabled = false;
      }
    });
  }
})();
})();
