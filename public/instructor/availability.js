(function () {
  'use strict';

  const DAYS = [
    { label: 'Monday',    value: 1 },
    { label: 'Tuesday',   value: 2 },
    { label: 'Wednesday', value: 3 },
    { label: 'Thursday',  value: 4 },
    { label: 'Friday',    value: 5 },
    { label: 'Saturday',  value: 6 },
    { label: 'Sunday',    value: 0 },
  ];

  let windows       = []; // [{ day_of_week, start_time, end_time }]
  let isDirty       = false;
  let blackoutRanges = []; // [{ start_date, end_date, reason }]
  let savedBlackoutRanges = []; // last known-good server state
  let blackoutsDirty = false;

  function init() {
    if (!ccAuth.getAuth()) { window.location.href = '/instructor/login.html'; return; }
    // Set min date on blackout date inputs to today
    const today = new Date().toISOString().slice(0, 10);
    const startInput = document.getElementById('blackoutStartInput');
    const endInput = document.getElementById('blackoutEndInput');
    startInput.min = today;
    startInput.value = today;
    endInput.min = today;
    endInput.value = today;
    startInput.addEventListener('change', () => {
      endInput.min = startInput.value;
      if (endInput.value < startInput.value) endInput.value = startInput.value;
    });
    loadAvailability();
    loadBlackoutDates();
  }

  async function loadAvailability() {
    try {
      const res  = await ccAuth.fetchAuthed('/api/instructor?action=availability');
      if (res.status === 401) { signOut(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      windows  = (data.windows || []).map(w => ({
        day_of_week: w.day_of_week,
        start_time:  w.start_time.slice(0, 5),
        end_time:    w.end_time.slice(0, 5)
      }));
      isDirty  = false;
      render();
    } catch (err) {
      document.getElementById('availContent').innerHTML = `<p style="color:var(--red);padding:20px;text-align:center">${err.message}<br><button data-action="load-availability" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></p>`;
    }
  }

  function render() {
    let html = '';
    for (const day of DAYS) {
      const dayWindows = windows.filter(w => w.day_of_week === day.value);
      html += `
        <div class="day-card">
          <div class="day-header">
            <span class="day-name">${day.label}</span>
            <button class="btn-add-window" data-action="add-window" data-day="${day.value}">+ Add</button>
          </div>
          <div class="windows-list" id="day-${day.value}">
            ${dayWindows.length === 0
              ? '<p class="no-windows">No availability set</p>'
              : dayWindows.map((w, i) => renderWindow(day.value, w, windows.indexOf(w))).join('')
            }
          </div>
        </div>`;
    }
    document.getElementById('availContent').innerHTML = html;
    updateSaveBar();
  }

  function renderWindow(dayValue, w, idx) {
    return `
      <div class="window-row" id="window-row-${idx}">
        <div class="window-time-inputs">
          <input type="time" value="${w.start_time}" data-action="update-window" data-idx="${idx}" data-field="start_time">
          <span class="time-sep">to</span>
          <input type="time" value="${w.end_time}" data-action="update-window" data-idx="${idx}" data-field="end_time">
        </div>
        <button class="btn-remove-window" data-action="remove-window" data-idx="${idx}" title="Remove">✕</button>
      </div>`;
  }

  function addWindow(dayValue) {
    windows.push({ day_of_week: dayValue, start_time: '09:00', end_time: '17:00' });
    isDirty = true;
    render();
  }

  function removeWindow(idx) {
    windows.splice(idx, 1);
    isDirty = true;
    render();
  }

  function updateWindow(idx, field, value) {
    windows[idx][field] = value;
    isDirty = true;
    updateSaveBar();
  }

  function updateSaveBar() {
    document.getElementById('saveBar').classList.toggle('visible', isDirty || blackoutsDirty);
  }

  async function saveAvailability() {
    // Validate — start < end for each window
    for (const w of windows) {
      if (w.start_time >= w.end_time) {
        showToast('Start time must be before end time for all windows', 'error');
        return;
      }
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      // Save availability windows if changed
      if (isDirty) {
        const res  = await ccAuth.fetchAuthed('/api/instructor?action=set-availability', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ windows })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        windows = (data.windows || []).map(w => ({
          day_of_week: w.day_of_week,
          start_time:  w.start_time.slice(0, 5),
          end_time:    w.end_time.slice(0, 5)
        }));
        isDirty = false;
        render();
      }

      // Save blackout dates if changed
      if (blackoutsDirty) {
        await saveBlackoutDates();
      } else if (!blackoutsDirty) {
        showToast('Changes saved', 'success');
      }
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  }

  function signOut() {
    ccAuth.logout();
  }

  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = 'toast' + (type ? ' ' + type : '');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  // ─── Blackout date ranges ──────────────────────────────────────────────────
  async function loadBlackoutDates() {
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=blackout-dates');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      blackoutRanges = (data.blackout_dates || []).map(d => ({
        start_date: d.start_date,
        end_date: d.end_date,
        reason: d.reason || ''
      }));
      savedBlackoutRanges = JSON.parse(JSON.stringify(blackoutRanges));
      blackoutsDirty = false;
      renderBlackouts();
      document.getElementById('blackoutSection').style.display = '';
    } catch (err) {
      console.error('Failed to load blackout dates:', err);
      document.getElementById('blackoutSection').style.display = '';
    }
  }

  function formatDateUK(dateStr) {
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
  }

  function dayCount(start, end) {
    return Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  }

  function renderBlackouts() {
    const list = document.getElementById('blackoutList');
    if (blackoutRanges.length === 0) {
      list.innerHTML = '<p class="no-blackouts">No blackout dates set</p>';
      return;
    }
    list.innerHTML = blackoutRanges.map((r, i) => {
      const isSingle = r.start_date === r.end_date;
      const label = isSingle
        ? formatDateUK(r.start_date)
        : `${formatDateUK(r.start_date)} – ${formatDateUK(r.end_date)}`;
      const badge = isSingle ? '' : `<span class="blackout-days-badge">${dayCount(r.start_date, r.end_date)} days</span>`;
      return `
        <div class="blackout-row">
          <span class="blackout-date-label">${label}</span>
          ${badge}
          <span class="blackout-reason">${r.reason ? esc(r.reason) : ''}</span>
          <button class="btn-remove-blackout" data-action="remove-blackout" data-idx="${i}" title="Remove">✕</button>
        </div>`;
    }).join('');
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function addBlackoutDate() {
    const startInput  = document.getElementById('blackoutStartInput');
    const endInput    = document.getElementById('blackoutEndInput');
    const reasonInput = document.getElementById('blackoutReasonInput');
    const start_date  = startInput.value;
    const end_date    = endInput.value || start_date;
    const reason      = reasonInput.value.trim();

    if (!start_date) { showToast('Please select a start date', 'error'); return; }
    if (end_date < start_date) { showToast('End date must be on or after start date', 'error'); return; }

    // Check for overlap with existing ranges
    const overlaps = blackoutRanges.some(r =>
      start_date <= r.end_date && end_date >= r.start_date
    );
    if (overlaps) {
      showToast('This range overlaps with an existing blackout', 'error');
      return;
    }

    blackoutRanges.push({ start_date, end_date, reason });
    blackoutRanges.sort((a, b) => a.start_date.localeCompare(b.start_date));
    renderBlackouts();
    reasonInput.value = '';
    blackoutsDirty = true;
    updateSaveBar();
  }

  function removeBlackout(idx) {
    blackoutRanges.splice(idx, 1);
    renderBlackouts();
    blackoutsDirty = true;
    updateSaveBar();
  }

  async function saveBlackoutDates() {
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=set-blackout-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranges: blackoutRanges })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      blackoutRanges = (data.blackout_dates || []).map(d => ({
        start_date: d.start_date,
        end_date: d.end_date,
        reason: d.reason || ''
      }));
      savedBlackoutRanges = JSON.parse(JSON.stringify(blackoutRanges));
      blackoutsDirty = false;
      renderBlackouts();
      updateSaveBar();
      showToast('Changes saved', 'success');
    } catch (err) {
      // Rollback to last known-good state on failure
      blackoutRanges = JSON.parse(JSON.stringify(savedBlackoutRanges));
      blackoutsDirty = false;
      renderBlackouts();
      updateSaveBar();
      showToast(err.message || 'Failed to save blackout dates', 'error');
    }
  }

  init();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'load-availability') loadAvailability();
  else if (a === 'add-window') addWindow(parseInt(t.dataset.day, 10));
  else if (a === 'remove-window') removeWindow(parseInt(t.dataset.idx, 10));
  else if (a === 'remove-blackout') removeBlackout(parseInt(t.dataset.idx, 10));
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action="update-window"]');
  if (t) updateWindow(parseInt(t.dataset.idx, 10), t.dataset.field, t.value);
});
(function wire() {
  var addBlackoutBtn = document.getElementById('btn-add-blackout');
  if (addBlackoutBtn) addBlackoutBtn.addEventListener('click', addBlackoutDate);
  var saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveAvailability);
})();
})();
