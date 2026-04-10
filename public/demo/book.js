(function () {
  'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEMO_INSTRUCTOR_ID = '5';

// ─── State ───────────────────────────────────────────────────────────────────
let currentView   = 'weekly';
let cursor        = new Date(); cursor.setHours(0,0,0,0);
let slotCache     = {}; // dateStr -> [slot, ...]
let loadedRanges  = [];
let pendingSlot   = null;
let pendingCancel = null;
let lastBookingId = null;

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  if (!ccAuth.getAuth()) { window.location.href = '/learner/login.html?redirect=/demo/book.html'; return; }

  Promise.all([loadUpcoming()])
    .then(() => {
      cursor = new Date(); cursor.setHours(0,0,0,0);
      setView('weekly');
    });

  // Wire up modal buttons
  document.getElementById('bookModalClose').onclick = closeBookModal;
  document.getElementById('btnConfirmBook').onclick = confirmBookWithCredit;
  document.getElementById('btnSuccessDone').onclick = closeBookModal;
  document.getElementById('btnAddToCalendar').onclick = handleCalendarDownload;
  document.getElementById('btnSubscribeCalendar').onclick = handleCalendarSubscribe;
  document.getElementById('cancelModalClose').onclick = () => document.getElementById('cancelModal').classList.remove('open');
  document.getElementById('btnConfirmCancel').onclick = confirmCancel;

  // Close modals on overlay click
  document.getElementById('bookModal').addEventListener('click', e => { if (e.target === document.getElementById('bookModal')) closeBookModal(); });
  document.getElementById('cancelModal').addEventListener('click', e => { if (e.target === document.getElementById('cancelModal')) document.getElementById('cancelModal').classList.remove('open'); });
}

// ─── Upcoming bookings ───────────────────────────────────────────────────────
async function loadUpcoming() {
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Filter to only demo instructor bookings
    const upcoming = (data.upcoming || []).filter(b => String(b.instructor_id) === DEMO_INSTRUCTOR_ID);
    const strip = document.getElementById('upcomingStrip');
    const list  = document.getElementById('upcomingList');
    if (upcoming.length === 0) { strip.style.display = 'none'; return; }

    strip.style.display = 'block';
    list.innerHTML = upcoming.map(b => {
      const dateStr = new Date(b.scheduled_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
      const start = b.start_time.slice(0,5);
      const end = b.end_time.slice(0,5);
      const lessonMs = new Date(b.scheduled_date + 'T' + b.start_time + 'Z').getTime();
      const hoursUntil = (lessonMs - Date.now()) / 3600000;
      const canCancel = hoursUntil > 0;
      return `
        <div class="upcoming-item">
          <div class="upcoming-date">${dateStr}</div>
          <div class="upcoming-time">${start} – ${end}</div>
          <div class="upcoming-instructor">${b.instructor_name}</div>
          ${canCancel ? `<button class="upcoming-cal-btn" data-action="download-calendar" data-id="${b.id}" title="Add to calendar">&#128197;</button>` : ''}
          ${canCancel ? `<button class="upcoming-cancel" data-action="open-cancel-modal" data-id="${b.id}" data-date="${b.scheduled_date}" data-start="${start}" data-end="${end}" data-name="${esc(b.instructor_name)}" data-hours="${hoursUntil}">Cancel</button>` : '<span style="font-size:0.8rem;color:var(--muted)">Past</span>'}
        </div>`;
    }).join('');
  } catch {}
}

// ─── View switching ──────────────────────────────────────────────────────────
function setView(view) {
  currentView = view;
  document.getElementById('btnMonthly').classList.toggle('active', view === 'monthly');
  document.getElementById('btnWeekly').classList.toggle('active',  view === 'weekly');
  document.getElementById('btnDaily').classList.toggle('active',   view === 'daily');
  renderCurrentView();
}
function navPrev() {
  if (currentView === 'monthly') cursor.setMonth(cursor.getMonth() - 1);
  else if (currentView === 'weekly') cursor.setDate(cursor.getDate() - 7);
  else cursor.setDate(cursor.getDate() - 1);
  renderCurrentView();
}
function navNext() {
  if (currentView === 'monthly') cursor.setMonth(cursor.getMonth() + 1);
  else if (currentView === 'weekly') cursor.setDate(cursor.getDate() + 7);
  else cursor.setDate(cursor.getDate() + 1);
  renderCurrentView();
}
function goToday() { cursor = new Date(); cursor.setHours(0,0,0,0); renderCurrentView(); }

async function renderCurrentView() {
  updateToolbarLabel();
  const ok = await fetchNeededSlots();
  if (ok === false) return;
  if (currentView === 'monthly') renderMonthly();
  else if (currentView === 'weekly') renderWeekly();
  else renderDaily();
}

function updateToolbarLabel() {
  const label = document.getElementById('calNavLabel');
  const sub   = document.getElementById('calSubtitle');
  const today = new Date(); today.setHours(0,0,0,0);

  if (currentView === 'monthly') {
    label.textContent = `${MON_FULL[cursor.getMonth()]} ${cursor.getFullYear()}`;
    sub.textContent = 'Click a day to view and book available slots';
  } else if (currentView === 'weekly') {
    const mon = getWeekStart(cursor);
    const sun = addDaysLocal(mon, 6);
    label.textContent = `${mon.getDate()} ${MON_SHORT[mon.getMonth()]} \u2013 ${sun.getDate()} ${MON_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
    sub.textContent = 'Click a slot to book';
  } else {
    const isToday = fmtDate(cursor) === fmtDate(today);
    label.textContent = `${DAY_SHORT[cursor.getDay()]} ${cursor.getDate()} ${MON_SHORT[cursor.getMonth()]}`;
    sub.textContent = isToday ? 'Today \u2014 pick any slot to book' : `${DAY_FULL[cursor.getDay()]} \u2014 pick any slot to book`;
  }
}

// ─── Slot fetching ───────────────────────────────────────────────────────────
async function fetchNeededSlots() {
  let from, to;
  const today = new Date(); today.setHours(0,0,0,0);

  if (currentView === 'monthly') {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastOfMonth  = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const gridStart = getWeekStart(firstOfMonth);
    const gridEnd   = addDaysLocal(getWeekStart(lastOfMonth), 6);
    from = fmtDate(gridStart < today ? today : gridStart);
    to   = fmtDate(gridEnd);
  } else if (currentView === 'weekly') {
    const mon = getWeekStart(cursor);
    from = fmtDate(mon < today ? today : mon);
    to   = fmtDate(addDaysLocal(mon, 6));
  } else {
    if (cursor < today) { from = fmtDate(cursor); to = from; }
    else { from = fmtDate(cursor); to = from; }
  }

  if (to < fmtDate(today)) return true;
  if (from < fmtDate(today)) from = fmtDate(today);

  const maxDate = fmtDate(addDaysLocal(today, 90));
  if (from > maxDate) return true;
  if (to > maxDate) to = maxDate;

  const cacheKey = `${from}|${to}|demo`;
  if (loadedRanges.includes(cacheKey)) return true;

  showLoading();

  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to + 'T00:00:00');
  const chunks = [];
  let chunkStart = new Date(fromD);
  while (chunkStart <= toD) {
    let chunkEnd = addDaysLocal(chunkStart, 30);
    if (chunkEnd > toD) chunkEnd = new Date(toD);
    chunks.push({ from: fmtDate(chunkStart), to: fmtDate(chunkEnd) });
    chunkStart = addDaysLocal(chunkEnd, 1);
  }

  try {
    for (const chunk of chunks) {
      let url = `/api/slots?action=available&from=${chunk.from}&to=${chunk.to}&instructor_id=${DEMO_INSTRUCTOR_ID}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const slots = data.slots || {};
      for (const ds in slots) {
        if (!slotCache[ds]) slotCache[ds] = [];
        for (const s of slots[ds]) {
          if (!slotCache[ds].find(x => x.date === s.date && x.start_time === s.start_time && x.instructor_id === s.instructor_id)) {
            slotCache[ds].push(s);
          }
        }
      }
    }
    loadedRanges.push(cacheKey);
    return true;
  } catch (err) {
    console.error('fetchNeededSlots error:', err);
    showError(err.message || 'Failed to load available slots');
    return false;
  }
}

function showLoading() { document.getElementById('calContent').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading available slots\u2026</p></div>'; }
function showError(msg) { document.getElementById('calContent').innerHTML = `<div class="empty-state"><div class="empty-icon">\u26A0\uFE0F</div><p>${msg}</p></div>`; }

// ─── MONTHLY RENDER ──────────────────────────────────────────────────────────
function renderMonthly() {
  const today = new Date(); today.setHours(0,0,0,0);
  const firstOfMon = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart  = getWeekStart(firstOfMon);

  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDaysLocal(gridStart, i));

  let html = '<div class="month-grid"><div class="month-dow-row">';
  for (const d of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) {
    html += `<div class="month-dow">${d}</div>`;
  }
  html += '</div><div class="month-days">';

  for (const day of cells) {
    const ds = fmtDate(day);
    const slots = slotCache[ds] || [];
    const inMonth = day.getMonth() === cursor.getMonth();
    const isToday = ds === fmtDate(today);
    const hasSlots = slots.length > 0;

    let cls = 'month-cell';
    if (!inMonth) cls += ' other-month';
    if (isToday) cls += ' is-today';
    if (hasSlots) cls += ' has-slots';

    html += `<div class="${cls}" data-action="drill-to-day" data-day="${ds}">`;
    html += `<div class="month-day-num">${day.getDate()}</div>`;
    if (hasSlots) {
      html += `<div class="month-slot-badge">${slots.length} slot${slots.length !== 1 ? 's' : ''}</div>`;
    }
    html += '</div>';
  }

  html += '</div></div>';
  document.getElementById('calContent').innerHTML = html;
}

// ─── WEEKLY RENDER ───────────────────────────────────────────────────────────
function renderWeekly() {
  const today = new Date(); today.setHours(0,0,0,0);
  const weekStart = getWeekStart(cursor);
  const days = Array.from({length:7}, (_,i) => addDaysLocal(weekStart, i));
  const HOURS = Array.from({length:16}, (_,i) => i + 6);

  let html = '<div class="week-grid"><div class="week-header"><div class="week-header-gutter"></div>';
  for (const day of days) {
    const isToday = fmtDate(day) === fmtDate(today);
    html += `<div class="week-header-day ${isToday ? 'is-today' : ''}">
      <div class="week-hd-dow">${DAY_SHORT[day.getDay()]}</div>
      <div class="week-hd-num">${day.getDate()}</div>
    </div>`;
  }
  html += '</div><div class="week-body"><div class="week-time-col">';
  for (const h of HOURS) html += `<div class="week-time-label">${String(h).padStart(2,'0')}:00</div>`;
  html += '</div>';

  for (const day of days) {
    const ds = fmtDate(day);
    const slots = slotCache[ds] || [];
    const isToday = ds === fmtDate(today);

    html += `<div class="week-day-col ${isToday ? 'is-today' : ''}">`;
    for (const h of HOURS) html += '<div class="week-hour-slot"></div>';

    for (const s of slots) {
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      const topPx = ((sh - 6) * 48) + (sm / 60 * 48);
      const heightPx = ((eh - sh) * 48) + ((em - sm) / 60 * 48);
      const dataAttrs = `data-instructor-id="${s.instructor_id}" data-date="${s.date}" data-start="${s.start_time}" data-end="${s.end_time}" data-instructor-name="${esc(s.instructor_name)}"`;
      html += `<div class="week-slot" style="top:${topPx}px;height:${Math.max(heightPx,22)}px;" data-action="open-book-modal" ${dataAttrs}>
        <div class="week-slot-time">${s.start_time}\u2013${s.end_time}</div>
        <div class="week-slot-name">${esc(s.instructor_name)}</div>
      </div>`;
    }
    html += '</div>';
  }
  html += '</div></div>';
  document.getElementById('calContent').innerHTML = html;
}

// ─── DAILY RENDER ────────────────────────────────────────────────────────────
function renderDaily() {
  const today = new Date(); today.setHours(0,0,0,0);
  const ds = fmtDate(cursor);
  const slots = slotCache[ds] || [];
  const isToday = ds === fmtDate(today);
  const isPast = cursor < today;

  const todayBadge = isToday ? '<span style="background:var(--accent);color:white;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:4px;margin-left:8px;">Today</span>' : '';

  let html = `
    <div class="daily-header">
      <div>
        <div class="daily-date-label">${cursor.getDate()} ${MON_FULL[cursor.getMonth()]} ${cursor.getFullYear()}${todayBadge}</div>
        <div class="daily-date-sub">${DAY_FULL[cursor.getDay()]} \u00B7 ${slots.length} slot${slots.length !== 1 ? 's' : ''} available</div>
      </div>
    </div>`;

  if (isPast) {
    html += '<div class="empty-state"><div class="empty-icon">\uD83D\uDCC5</div><h3>This date is in the past</h3><p>Navigate forward to find available slots.</p></div>';
    document.getElementById('calContent').innerHTML = html;
    return;
  }

  if (slots.length === 0) {
    html += '<div class="empty-state"><div class="empty-icon">\uD83D\uDCC5</div><h3>No slots available</h3><p>Try a different day.</p></div>';
    document.getElementById('calContent').innerHTML = html;
    return;
  }

  const byHour = {};
  for (const s of slots) {
    const h = parseInt(s.start_time.split(':')[0]);
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(s);
  }

  let minH = 24, maxH = 0;
  for (const s of slots) {
    minH = Math.min(minH, parseInt(s.start_time));
    maxH = Math.max(maxH, parseInt(s.end_time) + 1);
  }
  minH = Math.max(0, minH - 1);
  maxH = Math.min(24, maxH);

  html += '<div class="daily-timeline">';
  for (let h = minH; h < maxH; h++) {
    const hLabel = String(h).padStart(2,'0') + ':00';
    const hSlots = byHour[h] || [];

    html += `<div class="daily-hour-row">
      <div class="daily-time-label">${hLabel}</div>
      <div class="daily-slot-area">`;

    if (hSlots.length > 0) {
      for (const s of hSlots) {
        const initials = s.instructor_name.split(' ').map(n => n[0]).join('').slice(0,2);
        const avatar = s.instructor_photo
          ? `<img src="${s.instructor_photo}" alt="${esc(s.instructor_name)}">`
          : initials;
        const dataAttrs = `data-instructor-id="${s.instructor_id}" data-date="${s.date}" data-start="${s.start_time}" data-end="${s.end_time}" data-instructor-name="${esc(s.instructor_name)}"`;
        html += `
          <div class="daily-slot-card" data-action="open-book-modal" ${dataAttrs}>
            <div class="daily-slot-time">${s.start_time} \u2013 ${s.end_time}</div>
            <div class="daily-slot-name">
              <span class="slot-avatar" style="display:inline-flex;width:20px;height:20px;font-size:0.65rem;vertical-align:middle;margin-right:4px">${avatar}</span>
              ${esc(s.instructor_name)}
            </div>
          </div>`;
      }
    } else {
      html += '<div class="daily-empty-hour"></div>';
    }

    html += '</div></div>';
  }
  html += '</div>';
  document.getElementById('calContent').innerHTML = html;
}

// ─── Drill-down ──────────────────────────────────────────────────────────────
function drillToDay(ds) {
  cursor = new Date(ds + 'T00:00:00');
  setView('daily');
}

// ─── Book modal ──────────────────────────────────────────────────────────────
function openBookModal(el) {
  pendingSlot = {
    instructor_id:   el.dataset.instructorId,
    date:            el.dataset.date,
    start_time:      el.dataset.start,
    end_time:        el.dataset.end,
    instructor_name: el.dataset.instructorName
  };
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('mdDate').textContent = dateDisplay;
  document.getElementById('mdTime').textContent = `${pendingSlot.start_time} \u2013 ${pendingSlot.end_time}`;
  document.getElementById('mdInstructor').textContent = pendingSlot.instructor_name;

  document.getElementById('bookBtnLabel').textContent = 'Confirm booking';
  document.getElementById('bookSpinner').style.display = 'none';
  document.getElementById('btnConfirmBook').disabled = false;

  document.getElementById('bookConfirmStep').style.display = 'block';
  document.getElementById('bookSuccessStep').style.display = 'none';
  document.getElementById('bookModal').classList.add('open');
}

function closeBookModal() {
  document.getElementById('bookModal').classList.remove('open');
  setTimeout(() => {
    document.getElementById('bookConfirmStep').style.display = 'block';
    document.getElementById('bookSuccessStep').style.display = 'none';
  }, 300);
}

// ─── Confirm booking (real API call — free for demo instructor) ──────────────
async function confirmBookWithCredit() {
  if (!pendingSlot) return;
  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  const spinner = document.getElementById('bookSpinner');
  btn.disabled = true; label.textContent = 'Booking\u2026'; spinner.style.display = 'block';

  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingSlot)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    lastBookingId = data.booking_id;
    showBookSuccess();
    refreshAfterBooking();
  } catch (err) {
    showToast(err.message || 'Booking failed. Please try again.', 'error');
    btn.disabled = false; label.textContent = 'Confirm booking'; spinner.style.display = 'none';
  }
}

function showBookSuccess() {
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', timeZone:'UTC' });
  document.getElementById('successDate').textContent = dateDisplay;
  document.getElementById('successTime').textContent = pendingSlot.start_time;
  document.getElementById('successInstructor').textContent = pendingSlot.instructor_name;
  document.getElementById('btnAddToCalendar').href = `/api/calendar?action=download&booking_id=${lastBookingId}`;
  document.getElementById('btnAddToCalendar').setAttribute('download', `coachcarter-lesson-${pendingSlot.date}.ics`);
  document.getElementById('bookConfirmStep').style.display = 'none';
  document.getElementById('bookSuccessStep').style.display = 'block';
}

function refreshAfterBooking() {
  loadedRanges = []; slotCache = {};
  Promise.all([loadUpcoming(), renderCurrentView()]);
}

// ─── Calendar download & subscribe ───────────────────────────────────────────
async function handleCalendarDownload(e) {
  e.preventDefault();
  if (!lastBookingId) return;
  try {
    const res = await ccAuth.fetchAuthed(`/api/calendar?action=download&booking_id=${lastBookingId}`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'coachcarter-lesson.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendar file downloaded \u2014 open it to add to your calendar', 'success');
  } catch { showToast('Could not download calendar file', 'error'); }
}

async function handleCalendarSubscribe() {
  try {
    const res = await ccAuth.fetchAuthed('/api/calendar?action=feed-url');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    window.location.href = data.webcal_url;
  } catch { showToast('Could not set up calendar subscription', 'error'); }
}

async function downloadCalendar(bookingId) {
  try {
    const res = await ccAuth.fetchAuthed(`/api/calendar?action=download&booking_id=${bookingId}`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'coachcarter-lesson.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendar file downloaded', 'success');
  } catch { showToast('Could not download calendar file', 'error'); }
}
window.downloadCalendar = downloadCalendar;

// ─── Cancel modal ────────────────────────────────────────────────────────────
function openCancelModal(bookingId, date, start, end, instructorName, hoursUntil) {
  pendingCancel = { bookingId, date, start, end, instructorName, hoursUntil };
  const dateDisplay = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('cmDate').textContent = dateDisplay;
  document.getElementById('cmTime').textContent = `${start} \u2013 ${end}`;
  document.getElementById('cmInstructor').textContent = instructorName;

  document.getElementById('cancelBtnLabel').textContent = 'Cancel lesson';
  document.getElementById('btnConfirmCancel').disabled = false;
  document.getElementById('cancelModal').classList.add('open');
}
window.openCancelModal = openCancelModal;

async function confirmCancel() {
  if (!pendingCancel) return;
  const btn = document.getElementById('btnConfirmCancel');
  btn.disabled = true;
  document.getElementById('cancelBtnLabel').textContent = 'Cancelling\u2026';

  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: pendingCancel.bookingId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('cancelModal').classList.remove('open');
    showToast('Demo booking cancelled.', 'success');
    loadedRanges = []; slotCache = {};
    await Promise.all([loadUpcoming(), renderCurrentView()]);
  } catch (err) {
    showToast(err.message || 'Cancellation failed.', 'error');
    btn.disabled = false;
    document.getElementById('cancelBtnLabel').textContent = 'Cancel lesson';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDaysLocal(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function getWeekStart(d) {
  const r = new Date(d);
  const dow = r.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + diff);
  r.setHours(0,0,0,0);
  return r;
}
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'download-calendar') downloadCalendar(parseInt(t.dataset.id, 10));
  else if (a === 'open-cancel-modal') openCancelModal(parseInt(t.dataset.id, 10), t.dataset.date, t.dataset.start, t.dataset.end, t.dataset.name, parseFloat(t.dataset.hours));
  else if (a === 'drill-to-day') drillToDay(t.dataset.day);
  else if (a === 'open-book-modal') openBookModal(t);
});
(function wire() {
  document.querySelectorAll('[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { setView(btn.dataset.view); });
  });
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-nav-prev', navPrev);
  bind('btn-nav-next', navNext);
  bind('btn-today', goToday);
})();
})();
