(function () {
  'use strict';

  let AUTH = null;
  let AVAIL_WINDOWS = [];

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  window.addEventListener('DOMContentLoaded', async () => {
    openAvailabilityFromHash();
    AUTH = ccAuth.getAuth();
    if (!AUTH) {
      const guestHint = document.getElementById('guestHint');
      if (guestHint) guestHint.style.display = 'block';
      drawAvailDays();
      return;
    }
    await loadAvailability();
  });

  async function loadAvailability() {
    try {
      const res = await ccAuth.fetchAuthed('/api/learner?action=my-availability');
      if (!res.ok) return;
      const data = await res.json();
      AVAIL_WINDOWS = (data.availability || []).map(w => ({
        day_of_week: parseInt(w.day_of_week, 10),
        start_time: String(w.start_time || '').slice(0, 5),
        end_time: String(w.end_time || '').slice(0, 5)
      })).filter(w =>
        Number.isInteger(w.day_of_week) &&
        w.day_of_week >= 0 &&
        w.day_of_week <= 6 &&
        w.start_time &&
        w.end_time
      );
    } catch (err) {
      console.error('load-availability error:', err);
    }
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
        html += '<span class="avail-empty">No times set</span>';
      } else {
        for (let i = 0; i < windows.length; i++) {
          const w = windows[i];
          html += `<span class="avail-chip">${fmtTime(w.start_time)} to ${fmtTime(w.end_time)}<span class="avail-chip-x" data-action="remove-avail-window" data-day="${day}" data-idx="${i}">&times;</span></span>`;
        }
      }
      html += `<button type="button" class="avail-add-btn" data-action="show-add-row" data-day="${day}">+</button>`;
      html += '</div></div>';
    }
    container.innerHTML = html;
    updateAvailBadge();
  }

  function fmtTime(time) {
    const [h, m] = String(time || '00:00').split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  }

  function updateAvailBadge() {
    const badge = document.getElementById('availBadge');
    if (!badge) return;
    if (AVAIL_WINDOWS.length === 0) {
      badge.textContent = 'Not set';
      badge.className = 'acc-status is-warn';
    } else {
      badge.textContent = AVAIL_WINDOWS.length + ' slot' + (AVAIL_WINDOWS.length !== 1 ? 's' : '') + ' set';
      badge.className = 'acc-status is-ok';
    }
  }

  function openAvailabilityFromHash() {
    if (window.location.hash !== '#availability') return;
    const section = document.getElementById('availability');
    if (!section) return;
    section.open = true;
    window.requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));
  }

  function showAddRow(btn, day) {
    document.querySelectorAll('.avail-add-row').forEach(el => el.remove());

    const row = document.createElement('div');
    row.className = 'avail-add-row';

    let opts = '';
    for (let h = 7; h <= 21; h++) {
      for (const m of ['00', '30']) {
        if (h === 21 && m === '30') continue;
        const val = String(h).padStart(2, '0') + ':' + m;
        opts += `<option value="${val}">${fmtTime(val)}</option>`;
      }
    }

    row.innerHTML = `
      <select class="avail-sel-start" aria-label="Start time">${opts}</select>
      <span style="color:var(--muted);font-size:0.8rem">to</span>
      <select class="avail-sel-end" aria-label="End time">${opts}</select>
      <button type="button" class="avail-add-confirm" data-action="confirm-add-window" data-day="${day}">Add</button>
      <button type="button" class="avail-add-cancel" data-action="remove-parent" aria-label="Cancel">&times;</button>
    `;

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
    if (!btn || !note) return;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    note.textContent = '';
    note.style.color = '';

    try {
      const res = await ccAuth.fetchAuthed('/api/learner?action=set-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows: AVAIL_WINDOWS })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save availability');
      btn.textContent = 'Saved';
      note.textContent = 'Booking filters will use these times straight away.';
      setTimeout(() => {
        btn.textContent = 'Save';
        btn.disabled = false;
      }, 1800);
    } catch (err) {
      btn.textContent = 'Save';
      btn.disabled = false;
      note.textContent = err.message || 'Failed to save. Please try again.';
      note.style.color = '#e74c3c';
      console.error('save-availability error:', err);
    }
  }

  document.addEventListener('click', function (e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'remove-avail-window') removeAvailWindow(parseInt(target.dataset.day, 10), parseInt(target.dataset.idx, 10));
    else if (action === 'show-add-row') showAddRow(target, parseInt(target.dataset.day, 10));
    else if (action === 'confirm-add-window') confirmAddWindow(target, parseInt(target.dataset.day, 10));
    else if (action === 'remove-parent' && target.parentElement) target.parentElement.remove();
  });

  const saveBtn = document.getElementById('btnSaveAvail');
  if (saveBtn) saveBtn.addEventListener('click', saveAvailability);
  window.addEventListener('hashchange', openAvailabilityFromHash);
})();
