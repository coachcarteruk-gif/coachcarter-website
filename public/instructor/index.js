(function () {
  'use strict';

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DAY_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_INDEX  = [1,2,3,4,5,6,0]; // Mon–Sun display order

function formatBalanceMins(mins) {
  const m = Number(mins || 0);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function normaliseTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['manual', 'automatic', 'both'].includes(text) ? text : null;
}

function transmissionLabel(value) {
  switch (normaliseTransmissionType(value)) {
    case 'automatic': return 'Automatic';
    case 'both': return 'Manual/auto';
    default: return 'Manual';
  }
}

function configureAvailabilityTransmissionSelect() {
  const select = document.getElementById('modalTransmission');
  if (!select) return;
  const allowed = instructorTransmissionType === 'both'
    ? ['both', 'manual', 'automatic']
    : [instructorTransmissionType];
  for (const option of select.options) {
    option.disabled = !allowed.includes(option.value);
    option.hidden = !allowed.includes(option.value);
  }
  select.value = allowed[0] || 'manual';
}

function availabilityTransmissionBadge(slot) {
  const type = normaliseTransmissionType(slot && slot.transmission_type) || 'both';
  return `<span class="lesson-type-badge availability-badge transmission-badge">${transmissionLabel(type)}</span>`;
}

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let instructor = null;
let currentView = 'agenda'; // 'monthly' | 'weekly' | 'agenda'
let cursor     = new Date(); // current date driving the view
cursor.setHours(0,0,0,0);
let bookingCache = {}; // dateStr -> [booking, ...]
let pendingOfferCache = {}; // dateStr -> [pending offer, ...]
let availabilityOverrideCache = {}; // dateStr -> [date-specific availability, ...]
let availCache   = []; // availability windows [{day_of_week, start_time, end_time}]
let calendarStartHour = 7; // from instructor profile
let instructorSlug = null; // from profile, used for shareable booking links
let instructorTransmissionType = 'manual'; // from profile, used for one-off slot defaults
let loadedRanges = []; // [{from, to}] already fetched
let selectedBooking = null;

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function init() {
  const session = ccAuth.getAuth();
  if (!session) { window.location.href = '/instructor/login.html'; return; }
  instructor = session.instructor || null;

  // Default to today
  cursor = new Date(); cursor.setHours(0,0,0,0);

  // Load calendar start hour before first render to prevent layout jump
  await loadCalendarPrefs();

  setView('agenda'); // start in agenda view on today
  loadAvailability();
}

async function loadCalendarPrefs() {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=profile');
    const data = await res.json();
    if (res.ok && data.instructor) {
      calendarStartHour = data.instructor.calendar_start_hour || 7;
      instructorSlug = data.instructor.slug || null;
      instructorTransmissionType = normaliseTransmissionType(data.instructor.transmission_type) || 'manual';
    }
  } catch {}
}

// ─── View switching ──────────────────────────────────────────────────────────
function setView(view) {
  currentView = view;
  document.getElementById('btnMonthly').classList.toggle('active', view === 'monthly');
  document.getElementById('btnWeekly').classList.toggle('active',  view === 'weekly');
  document.getElementById('btnAgenda').classList.toggle('active',  view === 'agenda');
  renderCurrentView();
}

function toggleToolbarOverflow() {
  const menu = document.getElementById('toolbarOverflow');
  menu.classList.toggle('open');
}
// Close overflow menu when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.toolbar-overflow-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('toolbarOverflow')?.classList.remove('open');
  }
});

function navPrev() {
  if (currentView === 'monthly') { cursor.setMonth(cursor.getMonth() - 1); }
  else if (currentView === 'weekly') { cursor.setDate(cursor.getDate() - 7); }
  else { cursor.setDate(cursor.getDate() - 14); } // agenda
  renderCurrentView();
}
function navNext() {
  if (currentView === 'monthly') { cursor.setMonth(cursor.getMonth() + 1); }
  else if (currentView === 'weekly') { cursor.setDate(cursor.getDate() + 7); }
  else { cursor.setDate(cursor.getDate() + 14); } // agenda
  renderCurrentView();
}
// â”€â”€â”€ Swipe navigation for daily/weekly views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(function() {
  let touchStartX = 0, touchStartY = 0;
  const calEl = document.getElementById('calContent');
  if (!calEl) return;
  calEl.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  calEl.addEventListener('touchend', function(e) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only trigger on horizontal swipe (not vertical scroll), min 60px
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (currentView === 'weekly') {
        if (dx > 0) navPrev(); else navNext();
      }
    }
  }, { passive: true });
})();

function goToday() {
  cursor = new Date(); cursor.setHours(0,0,0,0);
  renderCurrentView();
}

// â”€â”€â”€ Render dispatcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function renderCurrentView() {
  updateToolbarLabel();
  await fetchNeededData();
  if (currentView === 'monthly') renderMonthly();
  else if (currentView === 'weekly') renderWeekly();
  else renderAgenda();
  // Async — populate travel time indicators between consecutive bookings
  injectTravelIndicators();
}

function updateToolbarLabel() {
  const label = document.getElementById('calNavLabel');
  const today = new Date(); today.setHours(0,0,0,0);

  if (currentView === 'monthly') {
    label.textContent = `${MON_FULL[cursor.getMonth()]} ${cursor.getFullYear()}`;
  } else if (currentView === 'weekly') {
    const mon = getWeekStart(cursor);
    const sun = addDays(mon, 6);
    label.textContent = `${mon.getDate()} ${MON_SHORT[mon.getMonth()]} – ${sun.getDate()} ${MON_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
  } else if (currentView === 'agenda') {
    const endDate = addDays(cursor, 13);
    label.textContent = `${cursor.getDate()} ${MON_SHORT[cursor.getMonth()]} – ${endDate.getDate()} ${MON_SHORT[endDate.getMonth()]}`;
  } else {
    label.textContent = `${DAY_SHORT[cursor.getDay()]} ${cursor.getDate()} ${MON_SHORT[cursor.getMonth()]}`;
  }
}

// â”€â”€â”€ Data fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchNeededData() {
  let from, to;
  if (currentView === 'monthly') {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastOfMonth  = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // Include padding days shown in the grid
    const gridStart = getWeekStart(firstOfMonth);
    const gridEnd   = addDays(getWeekStart(lastOfMonth), 6);
    from = dateStr(gridStart);
    to   = dateStr(gridEnd);
  } else if (currentView === 'weekly') {
    const mon = getWeekStart(cursor);
    from = dateStr(mon);
    to   = dateStr(addDays(mon, 6));
  } else if (currentView === 'agenda') {
    from = dateStr(cursor);
    to   = dateStr(addDays(cursor, 13));
  } else {
    from = dateStr(cursor);
    to   = dateStr(cursor);
  }

  if (isRangeLoaded(from, to)) return;
  showLoading();

  try {
    const res  = await ccAuth.fetchAuthed(`/api/instructor?action=schedule-range&from=${from}&to=${to}`);
    if (res.status === 401) { signOut(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Replace cache entries for this date range with fresh data
    // (clear dates in range first, then populate — prevents stale/duplicate entries)
    const rangeStart = new Date(from + 'T00:00:00');
    const rangeEnd = new Date(to + 'T00:00:00');
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      delete bookingCache[dateStr(d)];
      delete pendingOfferCache[dateStr(d)];
      delete availabilityOverrideCache[dateStr(d)];
    }
    for (const b of (data.bookings || [])) {
      if (!bookingCache[b.scheduled_date]) bookingCache[b.scheduled_date] = [];
      bookingCache[b.scheduled_date].push(b);
    }
    for (const o of (data.pending_offers || [])) {
      if (!pendingOfferCache[o.scheduled_date]) pendingOfferCache[o.scheduled_date] = [];
      pendingOfferCache[o.scheduled_date].push(o);
    }
    for (const a of (data.availability_overrides || [])) {
      const ds = a.override_date;
      if (!availabilityOverrideCache[ds]) availabilityOverrideCache[ds] = [];
      availabilityOverrideCache[ds].push(a);
    }
    loadedRanges.push({ from, to });
  } catch (err) {
    showError(err.message || 'Failed to load schedule');
  }
}

function isRangeLoaded(from, to) {
  return loadedRanges.some(r => r.from <= from && r.to >= to);
}

function showLoading() {
  document.getElementById('calContent').innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading…</p></div>`;
}
function showError(msg) {
  document.getElementById('calContent').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${msg}</p><button data-action="retry-current-view" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>`;
}

// ─── Outside-availability check (shared by Add Lesson + Send Offer) ─────────
// Returns true iff [startHHMM, startHHMM+durationMins] fits fully inside at
// least one of the instructor's weekly availability windows for that date's
// day-of-week. If availCache hasn't been populated yet, returns true (no
// warning) — fail-open so we never block a legit booking on a load race.
function _slotInsideAvailability(dateStr, startHHMM, durationMins) {
  if (!availCache || availCache.length === 0) return true;
  if (!dateStr || !startHHMM || !durationMins) return true;
  // JS getDay(): Sun=0..Sat=6. Our schema uses Mon=1..Sun=7 (Postgres convention).
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return true;
  const jsDow = d.getDay();
  const dow = jsDow === 0 ? 7 : jsDow;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = startMins + durationMins;
  return availCache.some(w => {
    if (w.day_of_week !== dow) return false;
    const [wsh, wsm] = w.start_time.split(':').map(Number);
    const [weh, wem] = w.end_time.split(':').map(Number);
    const wStart = wsh * 60 + wsm;
    const wEnd = weh * 60 + wem;
    return startMins >= wStart && endMins <= wEnd;
  });
}

// Look up a lesson type's duration from the cached list. Returns null if the
// cache is empty (caller should fall back to a sensible default).
function _lessonTypeMinutes(lessonTypeId) {
  const types = window._offerLessonTypes || [];
  if (!lessonTypeId || types.length === 0) return null;
  const lt = types.find(t => Number(t.id) === Number(lessonTypeId));
  return lt ? lt.duration_minutes : null;
}

// â”€â”€â”€ Availability fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAvailability() {
  try {
    const res  = await ccAuth.fetchAuthed('/api/instructor?action=availability');
    if (!res.ok) return;
    const data = await res.json();
    availCache = (data.windows || []).map(w => ({
      day_of_week: w.day_of_week,
      start_time:  w.start_time.slice(0,5),
      end_time:    w.end_time.slice(0,5)
    }));
    // Re-render current view to reflect updated availability
    renderCurrentView();
  } catch {}
}

// â”€â”€â”€ MONTHLY RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderMonthly() {
  const today      = new Date(); today.setHours(0,0,0,0);
  const firstOfMon = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastOfMon  = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart  = getWeekStart(firstOfMon);

  // 6 weeks = 42 cells
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));

  const dowLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const filteredCells = cells;

  let html = `<div class="month-grid" style="--month-cols:${dowLabels.length}">`;
  // Day-of-week headers
  html += `<div class="month-dow-row">`;
  for (const d of dowLabels) {
    html += `<div class="month-dow">${d}</div>`;
  }
  html += `</div><div class="month-days">`;

  for (const day of filteredCells) {
    const ds        = dateStr(day);
    const allBookings = bookingCache[ds] || [];
    const bookings  = allBookings.filter(b => b.status !== 'refunded');
    const overrides = availabilityOverrideCache[ds] || [];
    const inMonth   = day.getMonth() === cursor.getMonth();
    const isToday   = ds === dateStr(today);
    const hasBook   = bookings.length > 0 || overrides.length > 0;

    let cls = 'month-cell clickable';
    if (!inMonth) cls += ' other-month';
    if (isToday)  cls += ' is-today';
    if (hasBook)  cls += ' has-bookings';

    const dayNumInner = day.getDate();

    html += `<div class="${cls}" data-action="drill-to-day" data-day="${ds}">`;
    html += `<div class="month-day-num">${dayNumInner}</div>`;

    // Show up to 2 bookings as pills
    const visible = bookings.slice(0, 2);
    for (const b of visible) {
      const pillCls = b.status === 'chargeable' ? 'month-booking-pill completed' : b.status === 'refunded' ? 'month-booking-pill cancelled' : 'month-booking-pill';
      const pillColour = b.lesson_type_colour || 'var(--accent)';
      const pillStyle = b.status === 'refunded' ? '' : `style="background:${pillColour}"`;
      html += `<div class="${pillCls}" ${pillStyle}>${b.start_time.slice(0,5)} ${esc(b.learner_name.split(' ')[0])}</div>`;
    }
    const visibleOverrides = overrides.slice(0, Math.max(0, 2 - visible.length));
    for (const a of visibleOverrides) {
      html += `<div class="month-booking-pill month-availability-pill">${a.start_time.slice(0,5)} free</div>`;
    }
    const hiddenCount = bookings.length + overrides.length - visible.length - visibleOverrides.length;
    if (hiddenCount > 0) {
      html += `<div class="month-more">+${hiddenCount} more</div>`;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  document.getElementById('calContent').innerHTML = html;
}

// â”€â”€â”€ WEEKLY RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderWeekly() {
  const today     = new Date(); today.setHours(0,0,0,0);
  const weekStart = getWeekStart(cursor);
  const allDays   = Array.from({length:7}, (_,i) => addDays(weekStart, i));
  const days      = allDays;

  let html = '<div class="tp-week">';

  for (const day of days) {
    const ds        = dateStr(day);
    const allBk     = bookingCache[ds] || [];
    const bookings  = allBk.filter(b => b.status !== 'refunded');
    const overrides = availabilityOverrideCache[ds] || [];
    const isToday   = ds === dateStr(today);

    html += `<div class="tp-day${isToday ? ' is-today' : ''}">`;

    // Day label (left column) — click to jump to agenda for that day
    html += `<div class="tp-day-label" data-action="cursor-to-agenda" data-day="${ds}">
      <div class="tp-day-dow">${DAY_SHORT[day.getDay()]}</div>
      <div class="tp-day-num">${day.getDate()}</div>
    </div>`;

    // Lessons column (right)
    html += '<div class="tp-day-lessons">';
    if (bookings.length === 0 && overrides.length === 0) {
      html += '<div class="tp-empty-day">No lessons</div>';
    } else {
      for (const b of bookings) {
        const ltColour    = b.lesson_type_colour || 'var(--accent)';
        const ltName      = b.lesson_type_name || 'Standard Lesson';
        const isCancelled = b.status === 'refunded';
        const isCompleted = b.status === 'chargeable';
        const cls         = isCancelled ? 'tp-lesson cancelled' : isCompleted ? 'tp-lesson completed' : 'tp-lesson';
        const borderCol   = isCancelled ? 'var(--muted)' : ltColour;
        const address     = b.booking_pickup_address || b.learner_pickup_address || '';

        html += `
          <div class="${cls}" style="border-left-color:${borderCol}" data-action="open-booking-detail" data-id="${b.id}">
            <div class="tp-lesson-info">
              <div class="tp-lesson-name">${esc(b.learner_name)}${b.prefer_contact_before ? ' <span class="contact-badge">📞</span>' : ''}</div>
              <div class="tp-lesson-time">${b.start_time.slice(0,5)} → ${b.end_time.slice(0,5)}</div>
              ${address ? `<div class="tp-lesson-address">📍 ${esc(address)}</div>` : ''}
            </div>
            <span class="tp-lesson-type" style="background:${ltColour}18;color:${ltColour}">${esc(ltName)}</span>
          </div>`;
      }
      for (const a of overrides) {
        html += `
          <div class="tp-lesson tp-availability" data-availability-id="${a.id}">
            <div class="tp-lesson-info">
              <div class="tp-lesson-name">Available slot</div>
              <div class="tp-lesson-time">${a.start_time.slice(0,5)} â†’ ${a.end_time.slice(0,5)}</div>
            </div>
            ${availabilityTransmissionBadge(a)}
            <button class="offer-cancel-btn" data-action="delete-availability-override" data-id="${a.id}">Remove</button>
          </div>`;
      }
    }
    html += '</div></div>';
  }

  html += '</div>';
  document.getElementById('calContent').innerHTML = html;
}

// â”€â”€â”€ DAILY RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderDaily() {
  const today    = new Date(); today.setHours(0,0,0,0);
  const ds       = dateStr(cursor);
  const allBookings = bookingCache[ds] || [];
  const bookings = allBookings.filter(b => b.status !== 'refunded');
  const isToday  = ds === dateStr(today);

  // Get availability windows for this day of week
  const dow      = cursor.getDay(); // 0=Sun
  const availWins = availCache.filter(w => w.day_of_week === dow);

  // Sort bookings by start time (soonest first)
  bookings.sort((a, b) => a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0);

  const todayBadge = isToday ? `<span style="background:var(--accent);color:white;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:4px;margin-left:8px;">Today</span>` : '';

  let html = `
    <div class="daily-header">
      <div>
        <div class="daily-date-label">${cursor.getDate()} ${MON_FULL[cursor.getMonth()]} ${cursor.getFullYear()}${todayBadge}</div>
        <div class="daily-date-sub">${DAY_FULL[cursor.getDay()]} · ${bookings.length} lesson${bookings.length !== 1 ? 's' : ''}${availWins.length > 0 ? ' · Available ' + availWins.map(w => w.start_time + '–' + w.end_time).join(', ') : ''}</div>
      </div>
      <button class="btn-add-avail" data-action="open-avail-modal">+ Add availability</button>
    </div>
    <div class="daily-timeline" style="display:flex;flex-direction:column;gap:12px;padding:12px 0;">`;

  if (bookings.length > 0) {
    for (let i = 0; i < bookings.length; i++) {
      const b = bookings[i];
      const isCompleted = b.status === 'chargeable';
      const waUrl = whatsappUrl(b.learner_phone);
      const ltColour = b.lesson_type_colour || 'var(--accent)';
      const ltName   = b.lesson_type_name || 'Standard Lesson';
      const thisAddr = b.booking_pickup_address || b.learner_pickup_address || '';

      // Travel indicator between consecutive bookings
      if (i > 0 && b.status !== 'refunded') {
        const prev = bookings[i - 1];
        const prevAddr = prev.booking_pickup_address || prev.learner_pickup_address || '';
        if (prevAddr && thisAddr && prev.status !== 'refunded') {
          html += `<div class="travel-indicator" data-travel-from="${esc(prevAddr)}" data-travel-to="${esc(thisAddr)}" style="text-align:center;padding:2px 0"></div>`;
        }
      }

      const cardStyle = b.status === 'refunded' ? '' :
        `style="border-left-color:${ltColour};${isCompleted ? `background:${ltColour}08;border-color:${ltColour}40;` : `background:${ltColour}12;border-color:${ltColour}50;`}"`;
      html += `
        <div class="daily-booking-card ${isCompleted ? 'completed' : b.status === 'refunded' ? 'cancelled' : ''}" ${cardStyle}>
          <div class="daily-booking-time">${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)} <span class="lesson-type-badge" style="background:${ltColour}20;color:${ltColour};border:1px solid ${ltColour}40">${esc(ltName)}</span></div>
          <div>
            <div class="daily-booking-name">${esc(b.learner_name)}${b.prefer_contact_before ? '<span class="contact-badge" title="Learner would like you to contact them before their first lesson">📞 Contact first</span>' : ''}</div>
            <div class="daily-booking-email">${esc(b.learner_email)}</div>
            ${b.learner_phone ? `<div class="daily-booking-contact"><a href="tel:${esc(b.learner_phone)}">📞 ${esc(b.learner_phone)}</a>${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>` : ''}
            ${(b.booking_pickup_address || b.learner_pickup_address) ? `<div class="daily-booking-email">📍 ${esc(b.booking_pickup_address || b.learner_pickup_address)}</div>` : ''}
            ${b.booking_dropoff_address ? `<div class="daily-booking-email">📍 ${esc(b.booking_dropoff_address)}</div>` : ''}
          </div>
          <span class="daily-booking-status status-${b.status}">${statusLabel(b.status)}</span>
          ${isCompleted ? renderInlineNotes(b) : ''}
          ${isCompleted ? renderFeedbackHTML(b) : ''}
        </div>`;
    }
  } else if (availWins.length > 0) {
    html += `<div style="padding:28px 20px;text-align:center;color:var(--muted);font-size:0.875rem;">No lessons booked for this day.<br>You're available ${availWins.map(w => w.start_time + '–' + w.end_time).join(', ')}.</div>`;
  } else {
    html += `<div style="padding:28px 20px;text-align:center;color:var(--muted);font-size:0.875rem;">No lessons or availability set for this day. Tap <b>+ Add availability</b> to make yourself bookable.</div>`;
  }

  html += `</div>`;
  document.getElementById('calContent').innerHTML = html;
}

// â”€â”€â”€ AGENDA RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderAgenda() {
  const today = new Date(); today.setHours(0,0,0,0);
  const rangeStart = new Date(cursor);
  const rangeEnd   = addDays(cursor, 13);

  // Collect bookings + pending offers in the range. Pending offers carry
  // _kind:'offer' so the renderer can give them a distinct card style and
  // a cancel button.
  const allBookings = [];
  let d = new Date(rangeStart);
  while (d <= rangeEnd) {
    const ds = dateStr(d);
    for (const b of (bookingCache[ds] || [])) {
      if (b.status === 'refunded') continue;
      allBookings.push({ ...b, _kind: 'booking' });
    }
    for (const o of (pendingOfferCache[ds] || [])) {
      allBookings.push({ ...o, _kind: 'offer' });
    }
    for (const a of (availabilityOverrideCache[ds] || [])) {
      allBookings.push({ ...a, scheduled_date: a.override_date, _kind: 'availability' });
    }
    d = addDays(d, 1);
  }

  allBookings.sort((a, b) =>
    a.scheduled_date.localeCompare(b.scheduled_date) ||
    a.start_time.localeCompare(b.start_time)
  );

  if (allBookings.length === 0) {
    document.getElementById('calContent').innerHTML = `
      <div class="agenda-empty">
        <div class="empty-icon">📋</div>
        <p>No upcoming lessons in this period.</p>
        <p style="font-size:0.8rem;color:var(--muted)">Navigate forward or share your booking link to get started.</p>
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  for (const b of allBookings) {
    if (!groups[b.scheduled_date]) groups[b.scheduled_date] = [];
    groups[b.scheduled_date].push(b);
  }

  let html = '<div class="agenda-view">';
  for (const ds of Object.keys(groups).sort()) {
    const dayDate = new Date(ds + 'T00:00:00');
    const isToday = ds === dateStr(today);
    const dayLabel = `${DAY_FULL[dayDate.getDay()]}, ${dayDate.getDate()} ${MON_FULL[dayDate.getMonth()]}`;

    const dayLessonCount = groups[ds].filter(x => x._kind === 'booking').length;
    const dayOfferCount = groups[ds].filter(x => x._kind === 'offer').length;
    const dayAvailabilityCount = groups[ds].filter(x => x._kind === 'availability').length;
    const countParts = [`${dayLessonCount} lesson${dayLessonCount !== 1 ? 's' : ''}`];
    if (dayOfferCount > 0) countParts.push(`${dayOfferCount} pending`);
    if (dayAvailabilityCount > 0) countParts.push(`${dayAvailabilityCount} free`);
    const countLabel = countParts.join(', ');

    html += `<div class="agenda-date-header${isToday ? ' today' : ''}">
      <span>${dayLabel}</span>
      <span class="agenda-date-count">${countLabel}</span>
    </div>`;

    const daySlots = groups[ds];
    for (let i = 0; i < daySlots.length; i++) {
      const b = daySlots[i];

      // Pending offer card — "pencilled in", cancellable, distinct styling.
      if (b._kind === 'offer') {
        const ltColour = b.lesson_type_colour || 'var(--accent)';
        const ltName   = b.lesson_type_name || 'Standard Lesson';
        const learnerLabel = b.learner_name || b.offer_learner_name || b.learner_email || 'Learner';
        const priceP = b.offer_price_pence != null
          ? b.offer_price_pence
          : Math.round((b.lesson_type_price_pence || 8250) * (100 - (b.discount_pct || 0)) / 100);
        const priceStr = priceP === 0 ? 'Free' : `£${(priceP / 100).toFixed(2)}`;
        const expiresAt = new Date(b.expires_at);
        const minsLeft = Math.max(0, Math.round((expiresAt - new Date()) / 60000));
        const expiresStr = minsLeft >= 60
          ? `expires in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
          : `expires in ${minsLeft}m`;

        html += `
          <div class="agenda-card agenda-card-offer" style="border-left-color:${ltColour}" data-offer-id="${b.id}">
            <div class="agenda-card-left">
              <div class="agenda-time">${b.start_time.slice(0,5)} – ${b.end_time.slice(0,5)}</div>
              <span class="lesson-type-badge" style="background:${ltColour}20;color:${ltColour};border:1px solid ${ltColour}40">${esc(ltName)}</span>
            </div>
            <div class="agenda-card-mid">
              <div class="agenda-learner">${esc(learnerLabel)} <span class="offer-pending-badge">Pending offer</span></div>
              <div class="agenda-address" style="color:var(--muted)">${priceStr} · ${esc(expiresStr)}</div>
            </div>
            <div class="agenda-card-right">
              <button class="offer-cancel-btn" data-action="cancel-pending-offer" data-id="${b.id}" title="Cancel this pending offer and free up the slot">Cancel</button>
            </div>
          </div>`;
        continue;
      }

      if (b._kind === 'availability') {
        html += `
          <div class="agenda-card agenda-card-availability" data-availability-id="${b.id}">
            <div class="agenda-card-left">
              <div class="agenda-time">${b.start_time.slice(0,5)} â€“ ${b.end_time.slice(0,5)}</div>
              <span class="lesson-type-badge availability-badge">Available</span>
              ${availabilityTransmissionBadge(b)}
            </div>
            <div class="agenda-card-mid">
              <div class="agenda-learner">Extra availability</div>
              <div class="agenda-address" style="color:var(--muted)">Learners can book this slot without changing your weekly hours.</div>
            </div>
            <div class="agenda-card-right">
              <button class="offer-cancel-btn" data-action="delete-availability-override" data-id="${b.id}">Remove</button>
            </div>
          </div>`;
        continue;
      }

      const ltColour = b.lesson_type_colour || 'var(--accent)';
      const ltName   = b.lesson_type_name || 'Standard Lesson';
      const isCancelled = b.status === 'refunded';
      const isCompleted = b.status === 'chargeable';
      const cardCls = isCancelled ? 'agenda-card cancelled' : isCompleted ? 'agenda-card completed' : 'agenda-card';
      const waUrl = whatsappUrl(b.learner_phone);
      const thisAddr = b.booking_pickup_address || b.learner_pickup_address || '';

      // Travel indicator between consecutive bookings (skip offers)
      if (i > 0 && !isCancelled) {
        const prev = daySlots[i - 1];
        if (prev._kind === 'booking') {
          const prevAddr = prev.booking_pickup_address || prev.learner_pickup_address || '';
          if (prevAddr && thisAddr && prev.status !== 'refunded') {
            html += `<div class="travel-indicator" data-travel-from="${esc(prevAddr)}" data-travel-to="${esc(thisAddr)}" style="text-align:center;padding:2px 0"></div>`;
          }
        }
      }

      html += `
        <div class="${cardCls}" style="border-left-color:${isCancelled ? 'var(--muted)' : ltColour}" data-action="open-booking-detail" data-id="${b.id}">
          <div class="agenda-card-left">
            <div class="agenda-time">${b.start_time.slice(0,5)} – ${b.end_time.slice(0,5)}</div>
            <span class="lesson-type-badge" style="background:${ltColour}20;color:${ltColour};border:1px solid ${ltColour}40">${esc(ltName)}</span>
          </div>
          <div class="agenda-card-mid">
            <div class="agenda-learner">${esc(b.learner_name)}${b.prefer_contact_before ? ' <span class="contact-badge">📞</span>' : ''}</div>
            ${thisAddr ? `<div class="agenda-address">📍 ${esc(thisAddr)}</div>` : ''}
          </div>
          <div class="agenda-card-right">
            <span class="agenda-status status-${b.status}">${isCompleted ? '✓' : isCancelled ? '✕' : '●'}</span>
          </div>
        </div>`;
    }
  }
  html += '</div>';
  document.getElementById('calContent').innerHTML = html;
  // Scroll today's header into view so it acts as a natural anchor
  const todayHeader = document.querySelector('.agenda-date-header.today');
  if (todayHeader) todayHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// â”€â”€â”€ Drill-down from monthly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function drillToDay(ds) {
  cursor = new Date(ds + 'T00:00:00');
  setView('agenda');
}

// â”€â”€â”€ Status helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function statusLabel(status) {
  switch (status) {
    case 'chargeable': return '✓ Completed';
    case 'refunded':   return '✕ Cancelled';
    default:           return 'Scheduled';
  }
}


function closeBookingModal() {
  document.getElementById('bookingModal').classList.remove('open');
}
function handleBookingModalOverlayClick(e) {
  if (e.target === document.getElementById('bookingModal')) closeBookingModal();
}

// â”€â”€â”€ Add Availability Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let modalTargetDate = null; // the date we're adding date-specific availability for

function openAvailModal(targetDateStr) {
  modalTargetDate = targetDateStr ? new Date(targetDateStr + 'T00:00:00') : new Date(cursor);
  modalTargetDate.setHours(0,0,0,0);
  const dateLabel = `${modalTargetDate.getDate()} ${MON_FULL[modalTargetDate.getMonth()]} ${modalTargetDate.getFullYear()}`;

  document.getElementById('modalTitle').textContent = `Add available slot`;
  document.getElementById('modalSubtitle').textContent = `For ${dateLabel} only`;

  const dateInput = document.getElementById('modalDate');
  if (dateInput) {
    dateInput.min = dateStr(new Date());
    dateInput.value = dateStr(modalTargetDate);
  }

  // Default times for the new window
  document.getElementById('modalStart').value = '09:00';
  document.getElementById('modalEnd').value   = '10:30';
  configureAvailabilityTransmissionSelect();
  document.getElementById('modalSaveBtn').textContent = 'Add slot';

  document.getElementById('availModal').classList.add('open');
}

function closeAvailModal() {
  document.getElementById('availModal').classList.remove('open');
}
function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('availModal')) closeAvailModal();
}

async function saveNewAvailability() {
  const selectedDate = document.getElementById('modalDate')?.value || dateStr(modalTargetDate);
  const start = document.getElementById('modalStart').value;
  const end   = document.getElementById('modalEnd').value;
  const transmission = normaliseTransmissionType(document.getElementById('modalTransmission')?.value) || instructorTransmissionType;

  if (!selectedDate) { showToast('Please choose a date', 'error'); return; }
  if (!start || !end) { showToast('Please set both start and end times', 'error'); return; }
  if (start >= end)   { showToast('Start time must be before end time', 'error'); return; }

  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res  = await ccAuth.fetchAuthed('/api/instructor?action=create-availability-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override_date: selectedDate, start_time: start, end_time: end, transmission_type: transmission })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeAvailModal();
    showToast('Available slot added', 'success');
    loadedRanges = [];
    renderCurrentView();
  } catch (err) {
    showToast(err.message || 'Failed to save', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add slot';
  }
}

async function deleteAvailabilityOverride(id, btnEl) {
  if (!id) return;
  if (!confirm('Remove this available slot? Learners will no longer see it in the booking feed.')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Removing...'; }

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=delete-availability-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    loadedRanges = [];
    showToast('Available slot removed', 'success');
    renderCurrentView();
  } catch (err) {
    showToast(err.message || 'Failed to remove slot', 'error');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Remove'; }
  }
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getWeekStart(d) {
  // Returns Monday of d's week
  const r = new Date(d);
  const dow = r.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow; // shift so Monday=0
  r.setDate(r.getDate() + diff);
  r.setHours(0,0,0,0);
  return r;
}

const SKILL_LABELS = {
  speed_choice: 'Speed choice', lane_choice: 'Lane choice', mirrors: 'Mirrors',
  lane_keeping: 'Lane keeping', stay_or_go: 'Stay or go',
  roundabouts: 'Roundabouts', manoeuvres: 'Manoeuvres'
};

function renderFeedbackHTML(b) {
  if (!b.learner_ratings || b.learner_ratings.length === 0) return '';
  const uid = 'fb-' + b.id;
  const pills = b.learner_ratings.map(r => {
    const label = SKILL_LABELS[r.skill_key] || r.skill_key.replace(/_/g, ' ');
    const dc = r.rating === 'nailed' ? 'fd-nailed' : r.rating === 'ok' ? 'fd-ok' : 'fd-struggled';
    return `<div class="feedback-pill"><span class="feedback-dot ${dc}"></span> ${label}</div>`;
  }).join('');
  const notes = b.session_notes ? `<div class="feedback-notes">"${esc(b.session_notes)}"</div>` : '';
  return `<div class="learner-feedback">
    <button class="feedback-toggle" data-action="toggle-feedback" data-target="${uid}">
      <span class="chevron" style="font-size:0.65rem;">&#x25BC;</span> Learner self-assessment
    </button>
    <div class="feedback-body" id="${uid}">
      <div class="feedback-skills">${pills}</div>
      ${notes}
    </div>
  </div>`;
}

// â”€â”€â”€ WhatsApp URL helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function whatsappUrl(phone) {
  if (!phone) return null;
  let num = phone.replace(/\s+/g, '');
  if (num.startsWith('0')) num = '44' + num.slice(1);
  else if (num.startsWith('+')) num = num.slice(1);
  return 'https://wa.me/' + num;
}

// â”€â”€â”€ Inline notes on completed lessons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderInlineNotes(b) {
  const hasNotes = b.instructor_notes && b.instructor_notes.trim();
  return `
    <div class="inline-notes" id="notes-wrap-${b.id}">
      ${hasNotes ? `<div class="inline-notes-display">${esc(b.instructor_notes)}</div>` : ''}
      <button class="inline-notes-link" data-action="show-notes-editor" data-id="${b.id}">${hasNotes ? 'Edit notes' : '+ Add notes'}</button>
      <div class="inline-notes-edit" id="notes-edit-${b.id}" style="display:none">
        <textarea id="notes-text-${b.id}" placeholder="e.g. Worked on roundabouts, needs more mirror checks…">${esc(b.instructor_notes || '')}</textarea>
        <div class="inline-notes-actions">
          <button class="btn-notes-cancel" data-action="hide-notes-editor" data-id="${b.id}">Cancel</button>
          <button class="btn-notes-save" id="notes-save-${b.id}" data-action="save-inline-notes" data-id="${b.id}">Save</button>
        </div>
      </div>
    </div>`;
}

function showNotesEditor(bookingId) {
  document.getElementById('notes-edit-' + bookingId).style.display = '';
}

function hideNotesEditor(bookingId) {
  document.getElementById('notes-edit-' + bookingId).style.display = 'none';
}

async function saveInlineNotes(bookingId) {
  const textarea = document.getElementById('notes-text-' + bookingId);
  const btn = document.getElementById('notes-save-' + bookingId);
  const notes = textarea.value.trim();
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=update-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, instructor_notes: notes || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update cache
    for (const ds in bookingCache) {
      const bk = bookingCache[ds].find(b => b.id === bookingId);
      if (bk) { bk.instructor_notes = notes || null; break; }
    }
    showToast('Notes saved', 'success');
    renderCurrentView();
  } catch (err) {
    showToast(err.message || 'Failed to save notes', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

// â”€â”€â”€ Travel time between consecutive bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const UK_PC_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;
function clientExtractPostcode(addr) {
  if (!addr) return null;
  const m = addr.match(UK_PC_RE);
  return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function clientEstimateDrive(lat1, lon1, lat2, lon2) {
  return Math.round(haversineKm(lat1, lon1, lat2, lon2) * 1.3 / 48 * 60);
}

async function injectTravelIndicators() {
  const indicators = document.querySelectorAll('[data-travel-from][data-travel-to]');
  if (indicators.length === 0) return;

  // Collect unique postcodes
  const postcodes = new Set();
  indicators.forEach(el => {
    const from = clientExtractPostcode(el.dataset.travelFrom);
    const to = clientExtractPostcode(el.dataset.travelTo);
    if (from) postcodes.add(from);
    if (to) postcodes.add(to);
  });
  if (postcodes.size === 0) return;

  // Bulk geocode via postcodes.io
  let coordMap = {};
  try {
    const resp = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes: [...postcodes] })
    });
    if (resp.ok) {
      const data = await resp.json();
      for (const item of (data.result || [])) {
        if (item.result) {
          coordMap[item.query.toUpperCase().replace(/\s+/g, ' ')] = { lat: item.result.latitude, lon: item.result.longitude };
        }
      }
    }
  } catch { return; }

  // Inject travel time into each indicator
  indicators.forEach(el => {
    const from = clientExtractPostcode(el.dataset.travelFrom);
    const to = clientExtractPostcode(el.dataset.travelTo);
    if (!from || !to || !coordMap[from] || !coordMap[to]) return;
    if (from.replace(/\s/g,'') === to.replace(/\s/g,'')) {
      el.innerHTML = '<span style="font-size:0.75rem;color:var(--muted)">🚗 Same area</span>';
      return;
    }
    const mins = clientEstimateDrive(coordMap[from].lat, coordMap[from].lon, coordMap[to].lat, coordMap[to].lon);
    const colour = mins <= 15 ? 'var(--green,#16a34a)' : mins <= 30 ? 'var(--accent)' : 'var(--red,#e00)';
    el.innerHTML = `<span style="font-size:0.75rem;color:${colour}">🚗 ~${mins} min travel</span>`;
  });
}

// ─── Cancel a pending offer ──────────────────────────────────────────────────
async function cancelPendingOffer(offerId, btnEl) {
  if (!offerId) return;
  if (!confirm('Cancel this pending offer? The slot will be freed up immediately.')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Cancelling…'; }
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=cancel-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer_id: offerId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to cancel offer');

    // Remove the offer from cache locally for a snappy update, then re-render.
    for (const ds in pendingOfferCache) {
      pendingOfferCache[ds] = pendingOfferCache[ds].filter(o => o.id !== offerId);
    }
    renderCurrentView();
    showToast('Offer cancelled — slot is free again', 'success');
  } catch (err) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Cancel'; }
    showToast(err.message || 'Failed to cancel offer', 'error');
  }
}

// ─── Refresh schedule ────────────────────────────────────────────────────────
async function refreshSchedule(silent) {
  const btn = document.getElementById('refreshBtn');
  if (btn && !silent) btn.textContent = 'âŸ³';
  // Full refresh: clear everything and re-fetch + re-render in one step.
  // renderCurrentView calls fetchNeededData (which awaits) before rendering,
  // so the calendar shows fresh data directly without flashing empty.
  bookingCache = {};
  pendingOfferCache = {};
  loadedRanges = [];
  await renderCurrentView();
  if (btn) btn.textContent = '↻';
  if (!silent) showToast('Schedule refreshed', 'success');
}

// Auto-refresh every 60s when page is visible (skip if user is typing)
setInterval(() => {
  if (document.visibilityState === 'visible' && ccAuth.getAuth()) {
    const active = document.activeElement;
    const calEl = document.getElementById('calContent');
    if (active && calEl && calEl.contains(active) && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName)) return;
    refreshSchedule(true);
  }
}, 60000);

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// â”€â”€â”€ Calendar Sync Banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function shouldShowInstructorCalSync() {
  const val = localStorage.getItem('cc_instructor_cal_synced');
  if (!val) return true;
  if (val === '1') return false; // legacy permanent dismiss
  const ts = parseInt(val, 10);
  if (isNaN(ts)) return true;
  return Date.now() - ts > 30 * 24 * 60 * 60 * 1000; // 30 days
}

// Calendar sync banner removed — accessible via profile page

// Stats + next lesson moved to /instructor/dashboard.html

// â”€â”€â”€ Instructor Notes in Complete Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openBookingDetail(bookingId) {
  let b = null;
  for (const ds in bookingCache) {
    b = bookingCache[ds].find(x => x.id === bookingId);
    if (b) break;
  }
  if (!b) return;

  selectedBooking = b;
  const dateObj = new Date(b.scheduled_date + 'T00:00:00');
  const dateLabel = `${DAY_FULL[dateObj.getDay()]}, ${dateObj.getDate()} ${MON_FULL[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

  document.getElementById('bookingDetailContent').innerHTML = `
    <div class="booking-detail-row"><span class="booking-detail-label">Date</span><span class="booking-detail-val">${dateLabel}</span></div>
    <div class="booking-detail-row"><span class="booking-detail-label">Time</span><span class="booking-detail-val">${b.start_time.slice(0,5)} – ${b.end_time.slice(0,5)}</span></div>
    <div class="booking-detail-row"><span class="booking-detail-label">Type</span><span class="booking-detail-val"><span class="lesson-type-badge" style="background:${b.lesson_type_colour || 'var(--accent)'}20;color:${b.lesson_type_colour || 'var(--accent)'};border:1px solid ${b.lesson_type_colour || 'var(--accent)'}40">${esc(b.lesson_type_name || 'Standard Lesson')}</span> ${b.duration_minutes ? `(${b.duration_minutes >= 60 ? (b.duration_minutes % 60 === 0 ? b.duration_minutes/60 + ' hr' + (b.duration_minutes/60 !== 1 ? 's' : '') : (b.duration_minutes/60).toFixed(1) + ' hrs') : b.duration_minutes + ' min'})` : ''}</span></div>
    <div class="booking-detail-row"><span class="booking-detail-label">Learner</span><span class="booking-detail-val"><a href="#" data-action="open-learner-history" data-id="${b.learner_id}" style="color:var(--accent);text-decoration:underline">${esc(b.learner_name)}</a></span></div>
    <div class="booking-detail-row"><span class="booking-detail-label">Email</span><span class="booking-detail-val">${esc(b.learner_email)}</span></div>
    ${b.learner_phone ? `<div class="booking-detail-row"><span class="booking-detail-label">Phone</span><span class="booking-detail-val"><a href="tel:${esc(b.learner_phone)}" style="color:var(--accent)">${esc(b.learner_phone)}</a></span></div>` : ''}
    ${(b.booking_pickup_address || b.learner_pickup_address) ? `<div class="booking-detail-row"><span class="booking-detail-label">Pickup</span><span class="booking-detail-val">📍 ${esc(b.booking_pickup_address || b.learner_pickup_address)}</span></div>` : ''}
    ${b.booking_dropoff_address ? `<div class="booking-detail-row"><span class="booking-detail-label">Drop-off</span><span class="booking-detail-val">📍 ${esc(b.booking_dropoff_address)}</span></div>` : ''}
    <div class="booking-detail-row"><span class="booking-detail-label">Status</span><span class="booking-detail-val"><span class="daily-booking-status status-${b.status}">${statusLabel(b.status)}</span></span></div>
    ${b.prefer_contact_before ? `<div class="booking-detail-row"><span class="booking-detail-label">Note</span><span class="booking-detail-val" style="color:var(--accent);">📞 Learner would like a call or message before their first lesson</span></div>` : ''}
    ${b.instructor_notes ? `<div class="booking-detail-row"><span class="booking-detail-label">Your notes</span><span class="booking-detail-val" style="font-style:italic">${esc(b.instructor_notes)}</span></div>` : ''}
    ${b.status !== 'chargeable' ? `
      <div class="notes-label">Lesson notes (saved when you mark complete)</div>
      <textarea class="notes-field" id="detailNotes" placeholder="e.g. Worked on roundabouts, needs more mirror checks…"></textarea>
    ` : ''}
    ${b.status === 'chargeable' && b.learner_ratings && b.learner_ratings.length > 0 ? `
      <div style="margin-top:12px; border-top:1px solid var(--border); padding-top:12px;">
        <div style="font-size:0.78rem; font-weight:700; color:var(--muted); margin-bottom:8px;">Learner Self-Assessment</div>
        <div class="feedback-skills">${b.learner_ratings.map(r => {
          const label = SKILL_LABELS[r.skill_key] || r.skill_key.replace(/_/g, ' ');
          const dc = r.rating === 'nailed' ? 'fd-nailed' : r.rating === 'ok' ? 'fd-ok' : 'fd-struggled';
          return '<div class="feedback-pill"><span class="feedback-dot ' + dc + '"></span> ' + label + '</div>';
        }).join('')}</div>
        ${b.session_notes ? '<div class="feedback-notes">"' + esc(b.session_notes) + '"</div>' : ''}
      </div>` : ''}
  `;

  const actions = document.getElementById('bookingModalActions');
  if (b.status === 'scheduled') {
    actions.innerHTML = `
      <button class="btn-modal-cancel" style="color:var(--red)" data-action="open-cancel-modal" data-id="${b.id}">Cancel lesson</button>
      <button class="btn-modal-cancel" style="color:var(--accent)" data-action="open-reschedule-modal" data-id="${b.id}" data-date="${b.scheduled_date}" data-start="${b.start_time.slice(0,5)}" data-end="${b.end_time.slice(0,5)}" data-name="${esc(b.learner_name)}">Reschedule</button>
      <button class="btn-modal-cancel" data-action="open-edit-booking-modal" data-id="${b.id}">Edit</button>
      <button class="btn-modal-cancel" data-action="close-booking-modal">Close</button>`;
  } else {
    actions.innerHTML = `<button class="btn-modal-cancel" data-action="close-booking-modal">Close</button>`;
  }

  document.getElementById('bookingModal').classList.add('open');
}

// â”€â”€â”€ Learner History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function openLearnerHistory(learnerId) {
  document.getElementById('historyModal').classList.add('open');
  document.getElementById('historyContent').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading…</p></div>';

  try {
    const res = await ccAuth.fetchAuthed(`/api/instructor?action=learner-history&learner_id=${learnerId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const l = data.learner;
    const initials = l.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();

    // Format phone for WhatsApp (07xxx → 447xxx)
    const waPhone = l.phone ? l.phone.replace(/\s+/g, '').replace(/^0/, '44') : '';

    let html = `
      <div class="history-header">
        <div class="history-avatar">${initials}</div>
        <div>
          <div class="history-name">${esc(l.name)}</div>
          <div class="history-meta">${esc(l.email)}${l.phone ? ' · ' + esc(l.phone) : ''}</div>
          <div class="history-meta">${data.totalLessons} completed lesson${data.totalLessons !== 1 ? 's' : ''} with you${l.tier ? ' · ' + esc(l.tier) : ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">
        ${l.phone ? `<a href="tel:${esc(l.phone)}" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);font-size:0.82rem;font-weight:600;text-decoration:none;color:var(--primary);background:var(--white);cursor:pointer">Call</a>` : ''}
        ${waPhone ? `<a href="https://wa.me/${waPhone}" target="_blank" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);font-size:0.82rem;font-weight:600;text-decoration:none;color:var(--primary);background:var(--white);cursor:pointer">WhatsApp</a>` : ''}
        <button data-action="history-book-lesson" style="padding:6px 14px;border-radius:8px;border:1px solid var(--accent);font-size:0.82rem;font-weight:600;color:var(--accent);background:var(--white);cursor:pointer">Book Lesson</button>
      </div>
      <div class="history-list">`;

    if (data.bookings.length === 0) {
      html += '<div style="text-align:center;color:var(--muted);padding:20px">No lesson history yet.</div>';
    }

    for (const b of data.bookings) {
      const d = new Date(b.scheduled_date + 'T00:00:00');
      const dateLabel = `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
      const statusBadge = b.status === 'chargeable' ? '<span style="color:var(--green);font-size:0.75rem">✓</span>'
        : b.status === 'refunded' ? '<span style="color:var(--red);font-size:0.75rem">✕ cancelled</span>'
        : '<span style="color:var(--blue);font-size:0.75rem">upcoming</span>';

      html += `<div class="history-item">
        <div class="history-item-date">${dateLabel} · ${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)} ${statusBadge}</div>`;

      if (b.instructor_notes) html += `<div class="history-item-notes">📍 ${esc(b.instructor_notes)}</div>`;
      if (b.session_notes) html += `<div class="history-item-notes">💬 "${esc(b.session_notes)}"</div>`;

      if (b.learner_ratings && b.learner_ratings.length > 0) {
        html += '<div class="feedback-pills">';
        for (const r of b.learner_ratings) {
          const label = SKILL_LABELS[r.skill_key] || r.skill_key.replace(/_/g, ' ');
          const dc = r.rating === 'nailed' ? 'fd-nailed' : r.rating === 'ok' ? 'fd-ok' : 'fd-struggled';
          html += `<div class="feedback-pill" style="font-size:0.72rem"><span class="feedback-dot ${dc}"></span> ${label}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    document.getElementById('historyContent').innerHTML = html;
  } catch (err) {
    document.getElementById('historyContent').innerHTML = '<div style="color:var(--red);padding:20px;text-align:center">' + (err.message || 'Failed to load') + '<br><button data-action="retry-booking-history" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>';
  }
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('open');
}

// â”€â”€â”€ Cancel Booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let cancelBookingId = null;

function openCancelModal(bookingId) {
  cancelBookingId = bookingId;
  closeBookingModal();
  document.getElementById('cancelReason').value = '';
  document.getElementById('cancelModal').classList.add('open');
}

function closeCancelModal() {
  document.getElementById('cancelModal').classList.remove('open');
  cancelBookingId = null;
}

async function confirmCancel() {
  if (!cancelBookingId) return;
  const btn = document.getElementById('cancelConfirmBtn');
  btn.disabled = true; btn.textContent = 'Cancelling…';
  const reason = document.getElementById('cancelReason').value.trim();

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: cancelBookingId, reason: reason || null, notify: !!document.getElementById('cancelNotify').checked })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeCancelModal();
    showToast('Lesson cancelled — learner notified and credit returned', 'success');
    await refreshSchedule(true);
  } catch (err) {
    showToast(err.message || 'Failed to cancel', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Cancel this lesson';
  }
}

// â”€â”€â”€ Reschedule Booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let rescheduleBookingId = null;

function openRescheduleModal(bookingId, date, start, end, learnerName) {
  rescheduleBookingId = bookingId;
  closeBookingModal();
  const dateDisplay = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', timeZone:'UTC' });
  document.getElementById('instrReschLearner').textContent = learnerName;
  document.getElementById('instrReschCurrent').textContent = `${dateDisplay} at ${start}`;
  // Pre-fill with tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('instrReschDate').value = tomorrow.toISOString().slice(0, 10);
  document.getElementById('instrReschDate').min = new Date().toISOString().slice(0, 10);
  document.getElementById('instrReschTime').value = start;
  document.getElementById('instrRescheduleBtn').disabled = false;
  document.getElementById('instrRescheduleBtn').textContent = 'Move lesson';
  document.getElementById('instrRescheduleModal').classList.add('open');
}

function closeInstrRescheduleModal() {
  document.getElementById('instrRescheduleModal').classList.remove('open');
  rescheduleBookingId = null;
}

async function confirmInstrReschedule() {
  if (!rescheduleBookingId) return;
  const newDate = document.getElementById('instrReschDate').value;
  const newTime = document.getElementById('instrReschTime').value;
  if (!newDate || !newTime) { showToast('Please select a date and time', 'error'); return; }

  const btn = document.getElementById('instrRescheduleBtn');
  btn.disabled = true; btn.textContent = 'Moving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=reschedule-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: rescheduleBookingId,
        new_date: newDate,
        new_start_time: newTime.slice(0, 5)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeInstrRescheduleModal();
    showToast('Lesson rescheduled — learner notified', 'success');
    await refreshSchedule(true);
  } catch (err) {
    showToast(err.message || 'Failed to reschedule', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Move lesson';
  }
}

// â”€â”€â”€ Edit Booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let editBookingId = null;
let editBookingLessonTypes = [];
let editBookingOrigMinutes = 0;

async function openEditBookingModal(bookingId) {
  let b = null;
  for (const ds in bookingCache) {
    b = bookingCache[ds].find(x => x.id === bookingId);
    if (b) break;
  }
  if (!b) return;

  editBookingId = bookingId;
  editBookingOrigMinutes = parseInt(b.minutes_deducted) || 0;
  closeBookingModal();

  document.getElementById('editBookingLearner').textContent = b.learner_name;
  document.getElementById('editBookingDate').value = b.scheduled_date;
  document.getElementById('editBookingDate').min = new Date().toISOString().slice(0, 10);
  document.getElementById('editBookingTime').value = b.start_time.slice(0, 5);

  // Load lesson types for dropdown (include inactive for legacy corrections)
  try {
    const res = await ccAuth.fetchAuthed('/api/lesson-types?action=list&include_inactive=true');
    const data = await res.json();
    editBookingLessonTypes = data.lesson_types || [];
  } catch { editBookingLessonTypes = []; }

  const sel = document.getElementById('editBookingType');
  sel.innerHTML = editBookingLessonTypes.map(lt =>
    '<option value="' + lt.id + '" data-duration="' + lt.duration_minutes + '"' +
    (lt.id === b.lesson_type_id ? ' selected' : '') + '>' +
    esc(lt.name) + ' (' + (lt.duration_minutes >= 60 ? (lt.duration_minutes/60) + 'hr' : lt.duration_minutes + 'min') + ')' +
    (lt.active === false ? ' [hidden]' : '') +
    '</option>'
  ).join('');

  updateEditEndTime();
  document.getElementById('editBookingSaveBtn').disabled = false;
  document.getElementById('editBookingSaveBtn').textContent = 'Save changes';
  document.getElementById('editBookingModal').classList.add('open');
}

function updateEditEndTime() {
  const startVal = document.getElementById('editBookingTime').value;
  const sel = document.getElementById('editBookingType');
  const opt = sel.options[sel.selectedIndex];
  const duration = parseInt(opt?.dataset?.duration) || 90;

  if (startVal) {
    const parts = startVal.split(':').map(Number);
    const endMins = parts[0] * 60 + parts[1] + duration;
    const endStr = String(Math.floor(endMins / 60)).padStart(2, '0') + ':' + String(endMins % 60).padStart(2, '0');
    document.getElementById('editBookingEndTime').textContent = endStr;
  }

  // Show balance adjustment info
  const infoEl = document.getElementById('editBookingBalanceInfo');
  if (editBookingOrigMinutes > 0) {
    const delta = duration - editBookingOrigMinutes;
    if (delta > 0) {
      infoEl.textContent = 'Learner will be charged ' + delta + ' extra minutes from their balance.';
      infoEl.style.color = 'var(--red)';
      infoEl.style.display = 'block';
    } else if (delta < 0) {
      infoEl.textContent = Math.abs(delta) + ' minutes will be returned to the learner\'s balance.';
      infoEl.style.color = 'var(--green, #16a34a)';
      infoEl.style.display = 'block';
    } else {
      infoEl.style.display = 'none';
    }
  } else {
    infoEl.style.display = 'none';
  }
}

function closeEditBookingModal() {
  document.getElementById('editBookingModal').classList.remove('open');
  editBookingId = null;
}

async function confirmEditBooking(forceOverride) {
  if (!editBookingId) return;
  const newDate = document.getElementById('editBookingDate').value;
  const newTime = document.getElementById('editBookingTime').value;
  const newTypeId = parseInt(document.getElementById('editBookingType').value);
  if (!newDate || !newTime) { showToast('Please select a date and time', 'error'); return; }

  const btn = document.getElementById('editBookingSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=edit-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: editBookingId,
        scheduled_date: newDate,
        start_time: newTime.slice(0, 5),
        lesson_type_id: newTypeId,
        force: !!forceOverride,
        notify: !!document.getElementById('editBookingNotify').checked
      })
    });
    const data = await res.json();

    // Handle conflict warning — show details and ask for confirmation
    if (res.status === 409 && data.can_force && data.conflicts) {
      let msg = 'This time overlaps with:\n\n';
      for (const c of data.conflicts) {
        msg += '"¢ ' + c.learner_name + ' (' + c.time + ')';
        if (c.travel_minutes != null) {
          msg += ' — ~' + c.travel_minutes + ' min travel between pickups';
        }
        msg += '\n';
      }
      msg += '\nSave anyway?';
      btn.disabled = false; btn.textContent = 'Save changes';
      if (confirm(msg)) {
        return confirmEditBooking(true);
      }
      return;
    }

    if (!res.ok) throw new Error(data.error || data.message);

    closeEditBookingModal();
    showToast('Lesson updated' + (data.balanceAdjusted ? ' — balance adjusted' : ''), 'success');
    // Full refresh from server — renderCurrentView awaits fetch before rendering
    await refreshSchedule(true);
  } catch (err) {
    showToast(err.message || 'Failed to edit booking', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

// Wire up time input change to recalculate end time
document.getElementById('editBookingTime')?.addEventListener('input', updateEditEndTime);

// â”€â”€â”€ Add Lesson (Instructor-Initiated Booking) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let addLessonLearners = [];
let selectedLearnerId = null;

async function openAddLessonModal() {
  selectedLearnerId = null;
  document.getElementById('addLessonSearch').value = '';
  document.getElementById('addLessonSelected').style.display = 'none';
  document.getElementById('addLessonNotes').value = '';
  document.getElementById('addLessonDropoff').value = '';
  document.getElementById('addLessonCreditNote').style.display = 'none';
  document.getElementById('addLessonPaymentLinkNote').style.display = 'none';
  clearPaymentLinkSuccess();
  document.getElementById('addLessonBtn').disabled = false;
  document.getElementById('addLessonBtn').textContent = 'Book lesson';

  // Default date to current calendar date
  const d = cursor || new Date();
  const dateVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('addLessonDate').value = dateVal;
  document.getElementById('addLessonDate').min = new Date().toISOString().slice(0, 10);
  // Default to next half-hour
  const now = new Date();
  const mins = now.getMinutes();
  now.setMinutes(mins < 30 ? 30 : 0);
  if (mins >= 30) now.setHours(now.getHours() + 1);
  document.getElementById('addLessonTime').value = now.toTimeString().slice(0, 5);

  // Reset payment to cash
  document.querySelector('input[name="addLessonPay"][value="cash"]').checked = true;
  updateAddLessonPaymentUi();

  // Fetch learners + lesson types in parallel
  try {
    const [learnersRes, typesRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/instructor?action=school-learners'),
      ccAuth.fetchAuthed('/api/lesson-types?action=list')
    ]);
    const learnersData = await learnersRes.json();
    addLessonLearners = Array.isArray(learnersData) ? learnersData : (learnersData.learners || []);
    const typesData = await typesRes.json();
    const types = typesData.lesson_types || [];
    window._offerLessonTypes = types; // shared with offer modal + availability check
    const sel = document.getElementById('addLessonType');
    sel.innerHTML = types.map(lt => {
      const hrs = lt.duration_minutes / 60;
      const hrsStr = hrs % 1 === 0 ? `${hrs}hr` : `${hrs.toFixed(1)}hrs`;
      return `<option value="${lt.id}">${lt.name} (${hrsStr})</option>`;
    }).join('');
  } catch { addLessonLearners = []; }

  document.getElementById('addLessonModal').classList.add('open');
  filterAddLessonLearners();
}

function closeAddLessonModal() {
  clearPaymentLinkSuccess();
  document.getElementById('addLessonModal').classList.remove('open');
  document.getElementById('addLessonDropdown').classList.remove('open');
}

function filterAddLessonLearners() {
  const search = (document.getElementById('addLessonSearch').value || '').toLowerCase();
  const dropdown = document.getElementById('addLessonDropdown');
  const filtered = addLessonLearners.filter(l =>
    (l.name || '').toLowerCase().includes(search) ||
    (l.email || '').toLowerCase().includes(search) ||
    (l.phone || '').toLowerCase().includes(search)
  );
  // "Your learner" first, then alphabetical within each group
  filtered.sort((a, b) => {
    if (!!a.is_your_learner !== !!b.is_your_learner) return a.is_your_learner ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  const shown = filtered.slice(0, 20);

  if (shown.length === 0) {
    dropdown.innerHTML = '<div class="learner-option" style="color:var(--muted)">No learners found</div>';
  } else {
    dropdown.innerHTML = shown.map(l => {
      const tag = l.is_your_learner
        ? '<span style="font-size:0.7rem;font-weight:600;color:var(--green,#1f8a4c);background:rgba(31,138,76,0.1);padding:1px 6px;border-radius:4px;margin-left:6px">Your learner</span>'
        : '<span style="font-size:0.7rem;font-weight:600;color:var(--muted);background:var(--surface);padding:1px 6px;border-radius:4px;margin-left:6px">New to you</span>';
      return `
      <div class="learner-option" data-action="select-learner" data-id="${l.id}" data-name="${esc(l.name)}" data-phone="${esc(l.phone || l.email)}" data-balance-minutes="${l.balance_minutes || 0}">
        <div class="learner-opt-name">${esc(l.name)}${tag}</div>
        <div class="learner-opt-detail">${esc(l.phone || '')} ${l.phone && l.email ? '·' : ''} ${esc(l.email || '')} · ${formatBalanceMins(l.balance_minutes || 0)} with you</div>
      </div>
    `;
    }).join('');
  }
  dropdown.classList.add('open');
}

function selectLearner(id, name, detail, balanceMinutes) {
  clearPaymentLinkSuccess();
  selectedLearnerId = id;
  document.getElementById('addLessonSearch').value = '';
  document.getElementById('addLessonDropdown').classList.remove('open');
  document.getElementById('addLessonSelected').style.display = 'block';
  document.getElementById('addLessonSelectedName').textContent = name;
  document.getElementById('addLessonSelectedDetail').textContent = detail;

  // Update credit note
  updateCreditNote(balanceMinutes);
}

function clearSelectedLearner() {
  clearPaymentLinkSuccess();
  selectedLearnerId = null;
  document.getElementById('addLessonSelected').style.display = 'none';
  document.getElementById('addLessonCreditNote').style.display = 'none';
  document.getElementById('addLessonSearch').focus();
}

function updateCreditNote(balanceMinutes) {
  const noteEl = document.getElementById('addLessonCreditNote');
  const payMethod = document.querySelector('input[name="addLessonPay"]:checked')?.value;
  if (payMethod === 'credit') {
    noteEl.style.display = 'block';
    noteEl.textContent = balanceMinutes > 0
      ? `Learner has ${formatBalanceMins(balanceMinutes)} with you.`
      : 'Learner has no hours with you. Choose Cash or Free instead.';
    noteEl.style.color = balanceMinutes > 0 ? 'var(--muted)' : 'var(--red)';
  } else {
    noteEl.style.display = 'none';
  }
}

function updateAddLessonPaymentUi() {
  const payMethod = document.querySelector('input[name="addLessonPay"]:checked')?.value || 'cash';
  const linkNote = document.getElementById('addLessonPaymentLinkNote');
  const btn = document.getElementById('addLessonBtn');
  if (linkNote) linkNote.style.display = payMethod === 'payment_link' ? 'block' : 'none';
  if (btn && !btn.disabled) btn.textContent = payMethod === 'payment_link' ? 'Send payment link' : 'Book lesson';
  if (payMethod === 'credit' && selectedLearnerId) {
    const learner = addLessonLearners.find(l => l.id === selectedLearnerId);
    if (learner) updateCreditNote(learner.balance_minutes || 0);
  } else {
    const creditNote = document.getElementById('addLessonCreditNote');
    if (creditNote) creditNote.style.display = 'none';
  }
}

function clearPaymentLinkSuccess() {
  const successEl = document.getElementById('addLessonOfferSuccess');
  if (!successEl) return;
  successEl.style.display = 'none';
  successEl.innerHTML = '';
}

function renderAddLessonOfferSuccess(data) {
  const successEl = document.getElementById('addLessonOfferSuccess');
  if (!successEl) return;
  const shareUrl = data.accept_url || '';
  const selectedName = document.getElementById('addLessonSelectedName').textContent || data.learner_name || 'learner';
  const safeName = esc(selectedName);
  const emailAvailable = data.email_available === true;
  const messageAvailable = data.message_available === true;
  const emailSent = data.email_sent === true;
  const messageSent = data.message_sent === true;
  const deliveryParts = [];
  if (emailSent) deliveryParts.push('email');
  if (messageSent) deliveryParts.push('text message');
  const failedParts = [];
  if (emailAvailable && !emailSent) failedParts.push('email');
  if (messageAvailable && !messageSent) failedParts.push('text message');
  const missingParts = [];
  if (!emailAvailable) missingParts.push('no email saved');
  if (!messageAvailable) missingParts.push('no phone saved');

  let statusLine;
  if (deliveryParts.length > 0) {
    const deliveryText = deliveryParts.length === 2 ? `${deliveryParts[0]} and ${deliveryParts[1]}` : deliveryParts[0];
    const failedText = failedParts.length
      ? ` ${failedParts.length === 2 ? `${failedParts[0]} and ${failedParts[1]}` : failedParts[0]} delivery did not complete.`
      : '';
    const missingText = missingParts.length ? ` (${missingParts.join(', ')})` : '';
    statusLine = `Payment link sent to ${safeName} by ${deliveryText}. The slot is held as a pending offer for 24 hours and will only be booked after they accept and pay.${missingText}${failedText}`;
  } else if (failedParts.length > 0) {
    const failedText = failedParts.length === 2 ? `${failedParts[0]} and ${failedParts[1]}` : failedParts[0];
    statusLine = `Payment link created for ${safeName}, but ${failedText} delivery did not complete. The slot is held as a pending offer for 24 hours.`;
  } else if (missingParts.length > 0) {
    statusLine = `Payment link created for ${safeName}; the selected learner has ${missingParts.join(' and ')}. The slot is held as a pending offer for 24 hours.`;
  } else {
    statusLine = `Payment link created for ${safeName}. The slot is held as a pending offer for 24 hours.`;
  }

  successEl.innerHTML = `
    <div>${statusLine}</div>
    <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <input type="text" id="addLessonOfferShareUrl" readonly
        style="flex:1;min-width:0;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.78rem;background:var(--white);color:var(--primary)">
      <button id="addLessonOfferCopyBtn"
        style="padding:6px 14px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap">Copy link</button>
    </div>
  `;
  document.getElementById('addLessonOfferShareUrl').value = shareUrl;
  document.getElementById('addLessonOfferCopyBtn').addEventListener('click', function () {
    var copyBtn = this;
    var urlInput = document.getElementById('addLessonOfferShareUrl');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(function () {
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      }).catch(function () {
        urlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      });
    } else {
      urlInput.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
    }
  });
  successEl.style.display = 'block';
}

// Update credit note when payment method changes
document.addEventListener('change', e => {
  if (e.target.name === 'addLessonPay') {
    clearPaymentLinkSuccess();
    updateAddLessonPaymentUi();
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.learner-search-wrap')) {
    document.getElementById('addLessonDropdown').classList.remove('open');
  }
});

async function confirmCreateBooking() {
  if (!selectedLearnerId) { showToast('Please select a learner', 'error'); return; }

  const newDate = document.getElementById('addLessonDate').value;
  const newTime = document.getElementById('addLessonTime').value;
  if (!newDate || !newTime) { showToast('Please select a date and time', 'error'); return; }

  const payMethod = document.querySelector('input[name="addLessonPay"]:checked')?.value || 'cash';
  const notes = document.getElementById('addLessonNotes').value.trim();
  const isPaymentLink = payMethod === 'payment_link';

  // Outside-availability second-confirm (catches the Beatriz-style mistake:
  // booking a slot the learner can't pay for without seeing it on the calendar).
  const lessonTypeId = parseInt(document.getElementById('addLessonType').value) || null;
  const lessonTypeMins = _lessonTypeMinutes(lessonTypeId) || 90;
  if (!_slotInsideAvailability(newDate, newTime.slice(0, 5), lessonTypeMins)) {
    const proceed = confirm(
      "Heads up — this slot is outside your weekly availability for that day.\n\n" +
      (isPaymentLink
        ? "Sending the payment link will still hold the slot as a pending offer, but it won't appear in your normal availability and the learner won't see it in their slot feed.\n\n"
        : "Booking it will still work, but it won't appear on your normal availability and the learner won't see it in their slot feed.\n\n") +
      "Continue?"
    );
    if (!proceed) return;
  }

  const btn = document.getElementById('addLessonBtn');
  btn.disabled = true; btn.textContent = isPaymentLink ? 'Sending...' : 'Booking…';
  clearPaymentLinkSuccess();

  try {
    if (isPaymentLink) {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=create-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id: selectedLearnerId,
          scheduled_date: newDate,
          start_time: newTime.slice(0, 5),
          lesson_type_id: parseInt(document.getElementById('addLessonType').value) || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send payment link');

      renderAddLessonOfferSuccess(data);
      showToast('Payment link created. The slot is held for 24 hours.', 'success');
      await refreshSchedule(true);
      return;
    }

    const res = await ccAuth.fetchAuthed('/api/instructor?action=create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learner_id: selectedLearnerId,
        scheduled_date: newDate,
        start_time: newTime.slice(0, 5),
        lesson_type_id: parseInt(document.getElementById('addLessonType').value) || null,
        payment_method: payMethod,
        notes: notes || null,
        dropoff_address: document.getElementById('addLessonDropoff').value.trim() || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeAddLessonModal();
    showToast(`Lesson booked for ${data.learner_name || 'learner'} — they've been notified`, 'success');
    await refreshSchedule(true);
  } catch (err) {
    showToast(err.message || (isPaymentLink ? 'Failed to send payment link' : 'Failed to create booking'), 'error');
  } finally {
    btn.disabled = false; btn.textContent = isPaymentLink ? 'Send payment link' : 'Book lesson';
  }
}

// â”€â”€ Offer Lesson Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let offerLearners = [];
let selectedOfferLearnerId = null;

async function openOfferModal(prefillEmail, prefillName) {
  selectedOfferLearnerId = null;
  document.getElementById('offerName').value = prefillName || '';
  document.getElementById('offerEmail').value = prefillEmail || '';
  document.getElementById('offerLearnerSearch').value = '';
  document.getElementById('offerLearnerDropdown').classList.remove('open');
  document.getElementById('offerLearnerSelected').style.display = 'none';
  document.getElementById('offerError').style.display = 'none';
  document.getElementById('offerSuccess').style.display = 'none';
  document.getElementById('offerSendBtn').disabled = false;

  // Reset send-by-email toggle
  const emailCb = document.getElementById('offerSendEmail');
  const emailRow = document.getElementById('offerEmailRow');
  const sendBtn = document.getElementById('offerSendBtn');
  if (prefillEmail) {
    emailCb.checked = true;
    emailRow.style.display = '';
    sendBtn.textContent = 'Send offer';
  } else {
    emailCb.checked = false;
    emailRow.style.display = 'none';
    sendBtn.textContent = 'Create link';
  }
  emailCb.onchange = () => {
    emailRow.style.display = emailCb.checked ? '' : 'none';
    sendBtn.textContent = emailCb.checked ? 'Send offer' : 'Create link';
  };

  const modeExisting = document.getElementById('offerModeExisting');
  const modeNew = document.getElementById('offerModeNew');
  const existingFields = document.getElementById('offerExistingLearnerFields');
  const newFields = document.getElementById('offerNewLearnerFields');
  modeExisting.checked = false;
  modeNew.checked = true;
  existingFields.style.display = 'none';
  newFields.style.display = '';
  const switchLearnerMode = () => {
    const existing = modeExisting.checked;
    existingFields.style.display = existing ? '' : 'none';
    newFields.style.display = existing ? 'none' : '';
    if (existing) {
      emailCb.checked = true;
      emailRow.style.display = 'none';
      sendBtn.textContent = 'Send offer';
      filterOfferLearners();
    } else {
      selectedOfferLearnerId = null;
      document.getElementById('offerLearnerSelected').style.display = 'none';
      emailRow.style.display = emailCb.checked ? '' : 'none';
      sendBtn.textContent = emailCb.checked ? 'Send offer' : 'Create link';
    }
  };
  modeExisting.onchange = switchLearnerMode;
  modeNew.onchange = switchLearnerMode;

  // Default date to current calendar date
  const d = cursor || new Date();
  const dateVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('offerDate').value = dateVal;
  document.getElementById('offerDate').min = new Date().toISOString().slice(0, 10);
  document.getElementById('offerTime').value = '09:00';

  // Reset flexible toggle
  const flexCb = document.getElementById('offerFlexible');
  flexCb.checked = false;
  document.getElementById('offerSlotFields').style.display = '';
  flexCb.onchange = () => {
    document.getElementById('offerSlotFields').style.display = flexCb.checked ? 'none' : '';
  };

  // Reset weekly-repeats selector to "no repeat"
  const repeatSel = document.getElementById('offerMaxRepeatWeeks');
  if (repeatSel) repeatSel.value = '1';

  // Reset audience radio (default: one specific learner — preserves existing UX)
  const audOne = document.getElementById('offerAudienceOne');
  const audBcast = document.getElementById('offerAudienceBroadcast');
  const onePane = document.getElementById('offerOneLearnerPane');
  const bcastPane = document.getElementById('offerBroadcastPane');
  audOne.checked = true;
  audBcast.checked = false;
  onePane.style.display = '';
  bcastPane.style.display = 'none';
  // If a learner email was prefilled (came in via ?offer=…) keep one-learner mode.
  // Otherwise let the instructor switch to broadcast.
  const switchAudience = () => {
    const isBroadcast = audBcast.checked;
    onePane.style.display = isBroadcast ? 'none' : '';
    bcastPane.style.display = isBroadcast ? '' : 'none';
    // Broadcasts must be slot-pinned (we need a date+time to find matches),
    // so the "Flexible — learner picks their own time" option doesn't apply.
    // Hide it entirely in broadcast mode rather than disabling it (less confusing).
    const flexRow = document.getElementById('offerFlexibleRow');
    if (flexRow) flexRow.style.display = isBroadcast ? 'none' : '';
    if (isBroadcast) {
      flexCb.checked = false;
      document.getElementById('offerSlotFields').style.display = '';
    }
    // Update CTA copy
    const sendBtn = document.getElementById('offerSendBtn');
    if (isBroadcast) {
      sendBtn.textContent = 'Send broadcast';
      loadBroadcastAudience();
    } else {
      const emailCb = document.getElementById('offerSendEmail');
      sendBtn.textContent = emailCb.checked ? 'Send offer' : 'Create link';
    }
  };
  audOne.onchange = switchAudience;
  audBcast.onchange = switchAudience;

  // Reload audience whenever slot fields change (broadcast mode only)
  const slotChange = () => { if (audBcast.checked) loadBroadcastAudience(); };
  document.getElementById('offerDate').onchange = slotChange;
  document.getElementById('offerTime').onchange = slotChange;
  // Lesson type change matters for end_time (which decides who's free for the full window)
  // — wired below where we already attach updateOfferPrice.

  // Fetch lesson types and existing learners for the picker
  try {
    const [typesRes, learnersRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/lesson-types?action=list'),
      ccAuth.fetchAuthed('/api/instructor?action=school-learners')
    ]);
    const typesData = await typesRes.json();
    const learnersData = await learnersRes.json();
    offerLearners = learnersData.learners || [];
    const types = typesData.lesson_types || [];
    window._offerLessonTypes = types; // used by loadBroadcastAudience() to compute end_time
    const sel = document.getElementById('offerLessonType');
    sel.innerHTML = types.map(lt => {
      const hrs = lt.duration_minutes / 60;
      const hrsStr = hrs % 1 === 0 ? `${hrs}hr` : `${hrs.toFixed(1)}hrs`;
      const price = (lt.price_pence / 100).toFixed(2);
      return `<option value="${lt.id}" data-price="${lt.price_pence}">${lt.name} (${hrsStr}) — £${price}</option>`;
    }).join('');
  } catch { offerLearners = []; /* fallback — select will be empty */ }

  document.getElementById('offerLessonModal').classList.add('open');
  // Reset custom price
  document.getElementById('offerCustomPrice').value = '';
  updateOfferPrice();
}

function updateOfferPrice() {
  const sel = document.getElementById('offerLessonType');
  const opt = sel.options[sel.selectedIndex];
  const noteEl = document.getElementById('offerPriceNote');
  const customInput = document.getElementById('offerCustomPrice');

  if (!opt) { noteEl.textContent = ''; return; }

  const defaultPence = parseInt(opt.dataset.price) || 0;
  const defaultPrice = (defaultPence / 100).toFixed(2);

  // If custom price is empty, show lesson type default as placeholder
  if (!customInput.value) {
    customInput.placeholder = defaultPrice;
    noteEl.innerHTML = `Learner will pay <strong>£${defaultPrice}</strong> (lesson type default)`;
    return;
  }

  const customPrice = parseFloat(customInput.value);
  if (isNaN(customPrice) || customPrice < 0) {
    noteEl.innerHTML = '<span style="color:var(--red)">Enter a valid price</span>';
    return;
  }

  if (customPrice === 0) {
    noteEl.innerHTML = 'Learner will receive a <strong style="color:var(--green)">free lesson</strong> — no payment required';
  } else if (customPrice < parseFloat(defaultPrice)) {
    const saving = (parseFloat(defaultPrice) - customPrice).toFixed(2);
    noteEl.innerHTML = `Learner will pay <strong>£${customPrice.toFixed(2)}</strong> <span style="text-decoration:line-through;color:#999">£${defaultPrice}</span> (£${saving} off)`;
  } else {
    noteEl.innerHTML = `Learner will pay <strong>£${customPrice.toFixed(2)}</strong>`;
  }
}

function closeOfferModal() {
  document.getElementById('offerLessonModal').classList.remove('open');
  document.getElementById('offerLearnerDropdown').classList.remove('open');
}

function filterOfferLearners() {
  const search = (document.getElementById('offerLearnerSearch').value || '').toLowerCase();
  const dropdown = document.getElementById('offerLearnerDropdown');
  const filtered = offerLearners.filter(l =>
    (l.name || '').toLowerCase().includes(search) ||
    (l.email || '').toLowerCase().includes(search) ||
    (l.phone || '').toLowerCase().includes(search)
  );
  filtered.sort((a, b) => {
    if (!!a.is_your_learner !== !!b.is_your_learner) return a.is_your_learner ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  const shown = filtered.slice(0, 20);

  if (shown.length === 0) {
    dropdown.innerHTML = '<div class="learner-option" style="color:var(--muted)">No learners found</div>';
  } else {
    dropdown.innerHTML = shown.map(l => {
      const tag = l.is_your_learner
        ? '<span style="font-size:0.7rem;font-weight:600;color:var(--green,#1f8a4c);background:rgba(31,138,76,0.1);padding:1px 6px;border-radius:4px;margin-left:6px">Your learner</span>'
        : '<span style="font-size:0.7rem;font-weight:600;color:var(--muted);background:var(--surface);padding:1px 6px;border-radius:4px;margin-left:6px">New to you</span>';
      return `
      <div class="learner-option" data-action="offer-select-learner" data-id="${l.id}" data-name="${esc(l.name)}" data-detail="${esc(l.phone || l.email || '')}">
        <div class="learner-opt-name">${esc(l.name)}${tag}</div>
        <div class="learner-opt-detail">${esc(l.phone || '')} ${l.phone && l.email ? 'Â·' : ''} ${esc(l.email || '')}</div>
      </div>
    `;
    }).join('');
  }
  dropdown.classList.add('open');
}

function selectOfferLearner(id, name, detail) {
  selectedOfferLearnerId = id;
  document.getElementById('offerLearnerSearch').value = '';
  document.getElementById('offerLearnerDropdown').classList.remove('open');
  document.getElementById('offerLearnerSelected').style.display = 'block';
  document.getElementById('offerLearnerSelectedName').textContent = name;
  document.getElementById('offerLearnerSelectedDetail').textContent = detail;
}

function clearOfferLearner() {
  selectedOfferLearnerId = null;
  document.getElementById('offerLearnerSelected').style.display = 'none';
  document.getElementById('offerLearnerSearch').focus();
  filterOfferLearners();
}

// ── Broadcast audience picker ──
// Fetches learners with active weekly availability covering the slot the
// instructor has currently selected in the modal. Renders one row per learner
// with a checkbox (all checked by default) and a short summary of their other
// availability windows.
async function loadBroadcastAudience() {
  const listEl = document.getElementById('offerAudienceList');
  const summaryEl = document.getElementById('offerAudienceSummary');
  const warnEl = document.getElementById('offerBroadcastWarn');

  const date = document.getElementById('offerDate').value;
  const time = document.getElementById('offerTime').value;
  const sel = document.getElementById('offerLessonType');
  const opt = sel.options[sel.selectedIndex];
  if (!date || !time || !opt) {
    listEl.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:6px 0">Pick a date, time and lesson type to see who\'s free.</div>';
    summaryEl.textContent = '';
    warnEl.style.display = 'none';
    return;
  }

  // Find duration so we can compute end_time
  const types = window._offerLessonTypes || [];
  const lt = types.find(t => String(t.id) === sel.value);
  const durationMins = lt ? lt.duration_minutes : 90;
  const [sh, sm] = time.split(':').map(Number);
  const endMins = sh * 60 + sm + durationMins;
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

  listEl.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:6px 0">Loading…</div>';
  summaryEl.textContent = '';
  warnEl.style.display = 'none';

  try {
    const url = '/api/instructor?action=preview-broadcast-audience' +
      '&scheduled_date=' + encodeURIComponent(date) +
      '&start_time=' + encodeURIComponent(time) +
      '&end_time=' + encodeURIComponent(endTime);
    const res = await ccAuth.fetchAuthed(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const learners = data.learners || [];
    if (learners.length === 0) {
      listEl.innerHTML = '<div style="color:var(--muted);font-style:italic;padding:6px 0">No learners are free at that time.</div>';
      summaryEl.textContent = '';
      return;
    }

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    function fmtTime(t) {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return m === 0 ? h12 + ampm : h12 + ':' + String(m).padStart(2,'0') + ampm;
    }
    function summariseWindows(windows) {
      if (!windows || windows.length === 0) return '';
      // De-dup days and show like "Mon · Wed · Fri eves"
      return windows.slice(0, 4).map(w =>
        dayNames[w.day_of_week] + ' ' + fmtTime(w.start_time.slice(0,5)) + '–' + fmtTime(w.end_time.slice(0,5))
      ).join(' · ') + (windows.length > 4 ? ' · …' : '');
    }

    listEl.innerHTML = learners.map(l =>
      '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border)">' +
        '<input type="checkbox" class="offer-aud-chk" data-learner-id="' + l.id + '" checked ' +
          'style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);cursor:pointer">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;color:var(--primary)">' + escapeHtml(l.name || 'Unnamed') + '</div>' +
          '<div style="font-size:0.75rem;color:var(--muted)">' + escapeHtml(summariseWindows(l.availability)) + '</div>' +
        '</div>' +
      '</label>'
    ).join('');

    // Re-bind checkbox change handler to update summary
    [...listEl.querySelectorAll('.offer-aud-chk')].forEach(cb => {
      cb.addEventListener('change', updateAudienceSummary);
    });
    updateAudienceSummary();
  } catch (err) {
    listEl.innerHTML = '<div style="color:var(--red);padding:6px 0">Failed to load audience: ' + escapeHtml(err.message || 'unknown error') + '</div>';
  }
}

function updateAudienceSummary() {
  const listEl = document.getElementById('offerAudienceList');
  const summaryEl = document.getElementById('offerAudienceSummary');
  const warnEl = document.getElementById('offerBroadcastWarn');
  if (!listEl || !summaryEl) return;
  const all = [...listEl.querySelectorAll('.offer-aud-chk')];
  const checked = all.filter(cb => cb.checked).length;
  const total = all.length;
  summaryEl.textContent = checked + ' of ' + total + ' learners selected';
  if (checked > 10) {
    warnEl.textContent = 'Sending to ' + checked + ' learners — Twilio cost approx £' + (checked * 0.05).toFixed(2) + '.';
    warnEl.style.display = '';
  } else {
    warnEl.style.display = 'none';
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Broadcast offer submission ──
// POSTs to ?action=create-broadcast-offer with the learner_ids the instructor
// has ticked. Discount is derived from the custom-price field by comparing it
// against the lesson type default (so the existing UX stays consistent).
async function sendBroadcastOffer() {
  const errorEl = document.getElementById('offerError');
  const successEl = document.getElementById('offerSuccess');
  const btn = document.getElementById('offerSendBtn');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  const date = document.getElementById('offerDate').value;
  const time = document.getElementById('offerTime').value;
  const lessonTypeId = document.getElementById('offerLessonType').value;
  if (!date) { errorEl.textContent = 'Please select a date.'; errorEl.style.display = 'block'; return; }
  if (!time) { errorEl.textContent = 'Please select a start time.'; errorEl.style.display = 'block'; return; }
  if (!lessonTypeId) { errorEl.textContent = 'Please select a lesson type.'; errorEl.style.display = 'block'; return; }

  const checked = [...document.querySelectorAll('#offerAudienceList .offer-aud-chk:checked')]
    .map(cb => parseInt(cb.dataset.learnerId, 10))
    .filter(n => Number.isInteger(n) && n > 0);
  if (checked.length === 0) {
    errorEl.textContent = 'Please tick at least one learner.';
    errorEl.style.display = 'block';
    return;
  }

  // Map the custom price to a discount_pct the create endpoint accepts.
  // The create endpoint's CHECK constraint only allows {0, 25, 50, 75, 100} so
  // we snap to the nearest valid bucket. Empty custom price = 0 (full price).
  const customPriceStr = document.getElementById('offerCustomPrice').value.trim();
  const sel = document.getElementById('offerLessonType');
  const opt = sel.options[sel.selectedIndex];
  const defaultPence = parseInt(opt && opt.dataset.price) || 0;
  let discount_pct = 0;
  if (customPriceStr !== '' && defaultPence > 0) {
    const parsed = parseFloat(customPriceStr);
    if (isNaN(parsed) || parsed < 0) { errorEl.textContent = 'Please enter a valid price.'; errorEl.style.display = 'block'; return; }
    const customPence = Math.round(parsed * 100);
    const pct = Math.round(100 - (customPence / defaultPence) * 100);
    // Snap to allowed buckets {0, 25, 50, 75, 100}
    const allowed = [0, 25, 50, 75, 100];
    discount_pct = allowed.reduce((best, v) => Math.abs(v - pct) < Math.abs(best - pct) ? v : best, 0);
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=create-broadcast-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduled_date: date,
        start_time: time,
        lesson_type_id: parseInt(lessonTypeId, 10),
        discount_pct: discount_pct,
        learner_ids: checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send broadcast');

    const skipMsg = data.skipped > 0 ? ` (${data.skipped} skipped — no longer free at that time)` : '';
    successEl.innerHTML = `<div>Broadcast sent to <strong>${data.notified}</strong> learner${data.notified === 1 ? '' : 's'}${skipMsg}. First to book wins.</div>`;
    successEl.style.display = 'block';
    btn.textContent = 'Sent ✓';

    // Refresh schedule so the broadcast batch appears in the dashboard card / calendar.
    if (typeof renderCurrentView === 'function') renderCurrentView();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Send broadcast';
  }
}

async function sendOffer() {
  const isBroadcast = document.getElementById('offerAudienceBroadcast').checked;
  if (isBroadcast) {
    return sendBroadcastOffer();
  }
  const existingMode = document.getElementById('offerModeExisting').checked;
  const offerName = document.getElementById('offerName').value.trim();
  const sendEmail = document.getElementById('offerSendEmail').checked;
  const email = document.getElementById('offerEmail').value.trim();
  const flexible = document.getElementById('offerFlexible').checked;
  const date = document.getElementById('offerDate').value;
  const time = document.getElementById('offerTime').value;
  const lessonTypeId = document.getElementById('offerLessonType').value;
  const customPriceStr = document.getElementById('offerCustomPrice').value.trim();
  const errorEl = document.getElementById('offerError');
  const successEl = document.getElementById('offerSuccess');
  const btn = document.getElementById('offerSendBtn');

  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  if (existingMode && !selectedOfferLearnerId) { errorEl.textContent = 'Please select an existing learner.'; errorEl.style.display = 'block'; return; }
  if (!existingMode && !offerName) { errorEl.textContent = 'Please enter the learner\'s name.'; errorEl.style.display = 'block'; return; }
  if (!existingMode && sendEmail && !email) { errorEl.textContent = 'Please enter the learner\'s email address.'; errorEl.style.display = 'block'; return; }
  if (!flexible && !date) { errorEl.textContent = 'Please select a date, or tick "Flexible".'; errorEl.style.display = 'block'; return; }
  if (!flexible && !time) { errorEl.textContent = 'Please select a start time, or tick "Flexible".'; errorEl.style.display = 'block'; return; }

  // Build price: custom input → pence, or omit to use lesson type default
  let offerPricePence;
  if (customPriceStr !== '') {
    const parsed = parseFloat(customPriceStr);
    if (isNaN(parsed) || parsed < 0) { errorEl.textContent = 'Please enter a valid price.'; errorEl.style.display = 'block'; return; }
    offerPricePence = Math.round(parsed * 100);
  }

  // Outside-availability second-confirm — only for slot-pinned offers
  // (flexible offers don't have a fixed time to check). Catches the case
  // where the instructor sends a paid link for a time they're not normally
  // free, e.g. Beatriz / Simon 2026-05-19.
  if (!flexible) {
    const offerMins = _lessonTypeMinutes(lessonTypeId ? parseInt(lessonTypeId) : null) || 90;
    if (!_slotInsideAvailability(date, time.slice(0, 5), offerMins)) {
      const proceed = confirm(
        "Heads up — this slot is outside your weekly availability for that day.\n\n" +
        "You can still send the offer, but the learner won't see this slot in their normal feed and your other learners may not realise it's now blocked.\n\n" +
        "Send the offer anyway?"
      );
      if (!proceed) return;
    }
  }

  btn.disabled = true;
  btn.textContent = (sendEmail || existingMode) ? 'Sending…' : 'Creating…';

  // Weekly-repeats cap (1 = single lesson, 2..18 = learner picks count on accept page).
  // Only valid for slot-pinned offers; the API rejects flexible+repeat anyway.
  const repeatSel = document.getElementById('offerMaxRepeatWeeks');
  const maxRepeatWeeks = (!flexible && repeatSel) ? parseInt(repeatSel.value, 10) : 1;

  try {
    const payload = {
      lesson_type_id: lessonTypeId ? parseInt(lessonTypeId) : undefined
    };
    if (existingMode) {
      payload.learner_id = selectedOfferLearnerId;
    } else {
      payload.learner_name = offerName;
      if (sendEmail) payload.learner_email = email;
    }
    if (!flexible) {
      payload.scheduled_date = date;
      payload.start_time = time;
      if (maxRepeatWeeks > 1) payload.max_repeat_weeks = maxRepeatWeeks;
    }
    if (offerPricePence !== undefined) {
      payload.offer_price_pence = offerPricePence;
    }

    const res = await ccAuth.fetchAuthed('/api/instructor?action=create-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send offer');

    const priceMsg = offerPricePence === 0 ? ' (free lesson)' : offerPricePence != null ? ` (£${(offerPricePence / 100).toFixed(2)})` : '';
    const flexMsg = flexible ? ' (flexible time)' : '';

    // Use the accept URL (token-based) — carries the offer price
    const shareUrl = data.accept_url;
    const selectedOfferName = existingMode ? document.getElementById('offerLearnerSelectedName').textContent : offerName;
    const safeName = selectedOfferName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const emailAvailable = data.email_available === true;
    const messageAvailable = data.message_available === true;
    const emailSent = data.email_sent === true;
    const messageSent = data.message_sent === true;
    const deliveryParts = [];
    if (emailSent) deliveryParts.push('email');
    if (messageSent) deliveryParts.push('text message');
    const failedParts = [];
    if (emailAvailable && !emailSent) failedParts.push('email');
    if (messageAvailable && !messageSent) failedParts.push('text message');
    const missingParts = [];
    if (existingMode && !emailAvailable) missingParts.push('no email saved');
    if (existingMode && !messageAvailable) missingParts.push('no phone saved');

    let statusLine;
    if (deliveryParts.length > 0) {
      const deliveryText = deliveryParts.length === 2 ? `${deliveryParts[0]} and ${deliveryParts[1]}` : deliveryParts[0];
      const missingText = missingParts.length ? ` (${missingParts.join(', ')})` : '';
      const failedText = failedParts.length
        ? ` ${failedParts.length === 2 ? `${failedParts[0]} and ${failedParts[1]}` : failedParts[0]} delivery did not complete.`
        : '';
      statusLine = `Offer sent to ${safeName} by ${deliveryText}${priceMsg}${flexMsg}! They have 24 hours to accept.${missingText}${failedText} Copy link is still available below.`;
    } else if (failedParts.length > 0) {
      const failedText = failedParts.length === 2 ? `${failedParts[0]} and ${failedParts[1]}` : failedParts[0];
      statusLine = `Offer created for ${safeName}${priceMsg}${flexMsg}, but ${failedText} delivery did not complete. Use Copy link below.`;
    } else if (missingParts.length > 0) {
      statusLine = `Offer created for ${safeName}${priceMsg}${flexMsg}; the selected learner has ${missingParts.join(' and ')}. Use Copy link below.`;
    } else {
      statusLine = `Offer created for ${safeName}${priceMsg}${flexMsg} — share the link below.`;
    }

    successEl.innerHTML = `
      <div>${statusLine}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="text" id="offerShareUrl" readonly
          style="flex:1;min-width:0;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.78rem;background:var(--white);color:var(--primary)">
        <button id="offerCopyBtn"
          style="padding:6px 14px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap">Copy link</button>
      </div>
    `;
    // Set URL value via DOM (avoids escaping issues in template literals)
    document.getElementById('offerShareUrl').value = shareUrl;
    document.getElementById('offerCopyBtn').addEventListener('click', function () {
      var copyBtn = this;
      var urlInput = document.getElementById('offerShareUrl');
      // Try modern clipboard API, fall back to select+copy
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
        }).catch(function () {
          urlInput.select();
          document.execCommand('copy');
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
        });
      } else {
        urlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      }
    });
    successEl.style.display = 'block';
    btn.textContent = (sendEmail || existingMode) ? 'Sent ✓' : 'Created ✓';

    // Refresh schedule to show blocked slot (if slot-pinned)
    if (!flexible) renderCurrentView();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = (sendEmail || existingMode) ? 'Send offer' : 'Create link';
  }
}

// â”€â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
init();

// Auto-open offer modal if ?offer=email param is present (from learners page)
(function() {
  const p = new URLSearchParams(location.search);
  const offerEmail = p.get('offer');
  const offerName = p.get('offer_name');
  if (offerEmail || offerName) {
    // Wait for DOM to be ready then open the modal
    setTimeout(() => openOfferModal(offerEmail || '', offerName || ''), 500);
    // Clean URL
    history.replaceState(null, '', location.pathname);
  }
})();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'drill-to-day') drillToDay(t.dataset.day);
  else if (a === 'cursor-to-agenda') { cursor = new Date(t.dataset.day + 'T00:00:00'); setView('agenda'); }
  else if (a === 'open-booking-detail') openBookingDetail(parseInt(t.dataset.id, 10));
  else if (a === 'open-avail-modal') openAvailModal(t.dataset.day);
  else if (a === 'toggle-feedback') {
    var target = document.getElementById(t.dataset.target);
    if (target) target.classList.toggle('open');
    var chevron = t.querySelector('.chevron');
    if (chevron) chevron.classList.toggle('open');
  }
  else if (a === 'show-notes-editor') showNotesEditor(parseInt(t.dataset.id, 10));
  else if (a === 'hide-notes-editor') hideNotesEditor(parseInt(t.dataset.id, 10));
  else if (a === 'save-inline-notes') saveInlineNotes(parseInt(t.dataset.id, 10));
  else if (a === 'open-learner-history') { e.preventDefault(); openLearnerHistory(parseInt(t.dataset.id, 10)); }
  else if (a === 'open-cancel-modal') openCancelModal(parseInt(t.dataset.id, 10));
  else if (a === 'open-reschedule-modal') openRescheduleModal(parseInt(t.dataset.id, 10), t.dataset.date, t.dataset.start, t.dataset.end, t.dataset.name);
  else if (a === 'open-edit-booking-modal') openEditBookingModal(parseInt(t.dataset.id, 10));
  else if (a === 'close-booking-modal') closeBookingModal();
  else if (a === 'history-book-lesson') { closeHistoryModal(); openAddLessonModal(); }
  else if (a === 'retry-booking-history') renderBookingHistory();
  else if (a === 'retry-current-view') renderCurrentView();
  else if (a === 'select-learner') selectLearner(parseInt(t.dataset.id, 10), t.dataset.name, t.dataset.phone, parseInt(t.dataset.balanceMinutes, 10));
  else if (a === 'offer-select-learner') selectOfferLearner(parseInt(t.dataset.id, 10), t.dataset.name, t.dataset.detail);
  else if (a === 'cancel-pending-offer') cancelPendingOffer(parseInt(t.dataset.id, 10), t);
  else if (a === 'delete-availability-override') deleteAvailabilityOverride(parseInt(t.dataset.id, 10), t);
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'cf-late-change') {
    var row = document.getElementById('cf-mins-row-' + t.dataset.bookingId);
    if (row) row.style.display = t.value ? 'block' : 'none';
  }
});
// â”€â”€ Toolbar overflow buttons (combo actions) â”€â”€
document.querySelectorAll('[data-toolbar-of]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var op = btn.dataset.toolbarOf;
    if (op === 'offer') { openOfferModal(); toggleToolbarOverflow(); }
  });
});
// â”€â”€ Offer modal price/type changes â”€â”€
(function () {
  var cp = document.getElementById('offerCustomPrice');
  if (cp) cp.addEventListener('input', updateOfferPrice);
})();
// â”€â”€ Static wires â”€â”€
(function wire() {
  var bind = function (id, fn, ev) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev || 'click', fn);
  };
  bind('btn-nav-prev', navPrev);
  bind('btn-nav-next', navNext);
  bind('btn-today', goToday);
  document.querySelectorAll('.view-btn[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { setView(btn.dataset.view); });
  });
  bind('btn-open-add-lesson', openAddLessonModal);
  bind('btn-open-avail', function () { openAvailModal(); });
  bind('btn-open-offer', function () { openOfferModal(); });
  bind('btn-toolbar-overflow', toggleToolbarOverflow);
  var availModal = document.getElementById('availModal');
  if (availModal) availModal.addEventListener('click', handleModalOverlayClick);
  bind('btn-close-avail', closeAvailModal);
  bind('modalSaveBtn', saveNewAvailability);
  var bookingModal = document.getElementById('bookingModal');
  if (bookingModal) bookingModal.addEventListener('click', handleBookingModalOverlayClick);
  bind('btn-close-booking-top', closeBookingModal);
  var historyModal = document.getElementById('historyModal');
  if (historyModal) historyModal.addEventListener('click', function (e) { if (e.target === historyModal) closeHistoryModal(); });
  bind('btn-close-history', closeHistoryModal);
  var cancelModal = document.getElementById('cancelModal');
  if (cancelModal) cancelModal.addEventListener('click', function (e) { if (e.target === cancelModal) closeCancelModal(); });
  bind('btn-cancel-goback', closeCancelModal);
  bind('cancelConfirmBtn', confirmCancel);
  var reschedModal = document.getElementById('instrRescheduleModal');
  if (reschedModal) reschedModal.addEventListener('click', function (e) { if (e.target === reschedModal) closeInstrRescheduleModal(); });
  bind('btn-close-instr-reschedule', closeInstrRescheduleModal);
  bind('instrRescheduleBtn', confirmInstrReschedule);
  var editBookModal = document.getElementById('editBookingModal');
  if (editBookModal) editBookModal.addEventListener('click', function (e) { if (e.target === editBookModal) closeEditBookingModal(); });
  var editType = document.getElementById('editBookingType');
  if (editType) editType.addEventListener('change', updateEditEndTime);
  bind('btn-close-edit-booking', closeEditBookingModal);
  bind('editBookingSaveBtn', confirmEditBooking);
  var addLessonModal = document.getElementById('addLessonModal');
  if (addLessonModal) addLessonModal.addEventListener('click', function (e) { if (e.target === addLessonModal) closeAddLessonModal(); });
  var addSearch = document.getElementById('addLessonSearch');
  if (addSearch) {
    addSearch.addEventListener('input', filterAddLessonLearners);
    addSearch.addEventListener('focus', function () { document.getElementById('addLessonDropdown').classList.add('open'); });
  }
  bind('btn-clear-selected-learner', clearSelectedLearner);
  bind('btn-close-add-lesson', closeAddLessonModal);
  bind('addLessonBtn', confirmCreateBooking);
  ['addLessonDate', 'addLessonTime', 'addLessonType'].forEach(function (id) {
    var field = document.getElementById(id);
    if (field) field.addEventListener('change', clearPaymentLinkSuccess);
  });
  var offerModal = document.getElementById('offerLessonModal');
  var offerMouseDownTarget = null;
  if (offerModal) {
    offerModal.addEventListener('mousedown', function (e) { offerMouseDownTarget = e.target; });
    offerModal.addEventListener('click', function (e) { if (e.target === offerModal && offerMouseDownTarget === offerModal) closeOfferModal(); });
  }
  var offerType = document.getElementById('offerLessonType');
  if (offerType) offerType.addEventListener('change', function () {
    updateOfferPrice();
    // If broadcast mode is active, the audience depends on duration → end_time → reload.
    var bcastRadio = document.getElementById('offerAudienceBroadcast');
    if (bcastRadio && bcastRadio.checked) loadBroadcastAudience();
  });
  var offerLearnerSearch = document.getElementById('offerLearnerSearch');
  if (offerLearnerSearch) {
    offerLearnerSearch.addEventListener('input', filterOfferLearners);
    offerLearnerSearch.addEventListener('focus', function () { filterOfferLearners(); });
  }
  bind('btn-clear-offer-learner', clearOfferLearner);
  bind('btn-close-offer', closeOfferModal);
  bind('offerSendBtn', sendOffer);
})();
})();
