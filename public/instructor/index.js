(function () {
  'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_INDEX  = [1,2,3,4,5,6,0]; // Mon–Sun display order

// ─── State ───────────────────────────────────────────────────────────────────
let instructor = null;
let currentView = 'agenda'; // 'monthly' | 'weekly' | 'agenda'
let cursor     = new Date(); // current date driving the view
cursor.setHours(0,0,0,0);
let bookingCache = {}; // dateStr -> [booking, ...]
let availCache   = []; // availability windows [{day_of_week, start_time, end_time}]
let calendarStartHour = 7; // from instructor profile
let instructorSlug = null; // from profile, used for shareable booking links
let hideWeekends = false;
let showCancelled = false;
let loadedRanges = []; // [{from, to}] already fetched
let selectedBooking = null;

// ─── Init ────────────────────────────────────────────────────────────────────
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
    }
  } catch {}
}

// ─── View switching ──────────────────────────────────���───────────────────────
function setView(view) {
  currentView = view;
  document.getElementById('btnMonthly').classList.toggle('active', view === 'monthly');
  document.getElementById('btnWeekly').classList.toggle('active',  view === 'weekly');
  document.getElementById('btnAgenda').classList.toggle('active',  view === 'agenda');
  renderCurrentView();
}

function toggleHideWeekends() {
  hideWeekends = !hideWeekends;
  document.getElementById('btnHideWeekends').classList.toggle('active', hideWeekends);
  const ofBtn = document.getElementById('btnHideWeekendsOF');
  if (ofBtn) ofBtn.textContent = hideWeekends ? 'Show weekends' : 'Weekdays only';
  renderCurrentView();
}

function toggleShowCancelled() {
  showCancelled = !showCancelled;
  document.getElementById('btnShowCancelled').classList.toggle('active', showCancelled);
  const ofBtn = document.getElementById('btnShowCancelledOF');
  if (ofBtn) ofBtn.textContent = showCancelled ? 'Hide cancelled' : 'Show cancelled';
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
// ─── Swipe navigation for daily/weekly views ─────────────────────────────────
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

// ─── Render dispatcher ───────────────────────────────────────────────────────
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

// ─── Data fetching ───────────────────────────────────────────────────────────
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
    }
    for (const b of (data.bookings || [])) {
      if (!bookingCache[b.scheduled_date]) bookingCache[b.scheduled_date] = [];
      bookingCache[b.scheduled_date].push(b);
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

// ─── Availability fetching ───────────────────────────────────────────────────
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

// ─── MONTHLY RENDER ──────────────────────────────────────────────────────────
function renderMonthly() {
  const today      = new Date(); today.setHours(0,0,0,0);
  const firstOfMon = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastOfMon  = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart  = getWeekStart(firstOfMon);

  // 6 weeks = 42 cells
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));

  const dowLabels = hideWeekends ? ['Mon','Tue','Wed','Thu','Fri'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const filteredCells = hideWeekends ? cells.filter(d => d.getDay() !== 0 && d.getDay() !== 6) : cells;

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
    const bookings  = allBookings.filter(b => showCancelled || b.status !== 'cancelled');
    const inMonth   = day.getMonth() === cursor.getMonth();
    const isToday   = ds === dateStr(today);
    const hasBook   = bookings.length > 0;

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
      const pillCls = b.status === 'completed' ? 'month-booking-pill completed' : b.status === 'cancelled' ? 'month-booking-pill cancelled' : 'month-booking-pill';
      const pillColour = b.lesson_type_colour || 'var(--accent)';
      const pillStyle = b.status === 'cancelled' ? '' : `style="background:${pillColour}"`;
      html += `<div class="${pillCls}" ${pillStyle}>${b.start_time.slice(0,5)} ${esc(b.learner_name.split(' ')[0])}</div>`;
    }
    if (bookings.length > 2) {
      html += `<div class="month-more">+${bookings.length - 2} more</div>`;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  document.getElementById('calContent').innerHTML = html;
}

// ─── WEEKLY RENDER ───────────────────────────────────────────────────────────
function renderWeekly() {
  const today     = new Date(); today.setHours(0,0,0,0);
  const weekStart = getWeekStart(cursor);
  const allDays   = Array.from({length:7}, (_,i) => addDays(weekStart, i));
  const days      = hideWeekends ? allDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6) : allDays;

  let html = '<div class="tp-week">';

  for (const day of days) {
    const ds        = dateStr(day);
    const allBk     = bookingCache[ds] || [];
    const bookings  = allBk.filter(b => showCancelled || (b.status !== 'cancelled' && b.status !== 'rescheduled'));
    const isToday   = ds === dateStr(today);

    html += `<div class="tp-day${isToday ? ' is-today' : ''}">`;

    // Day label (left column) — click to jump to agenda for that day
    html += `<div class="tp-day-label" data-action="cursor-to-agenda" data-day="${ds}">
      <div class="tp-day-dow">${DAY_SHORT[day.getDay()]}</div>
      <div class="tp-day-num">${day.getDate()}</div>
    </div>`;

    // Lessons column (right)
    html += '<div class="tp-day-lessons">';
    if (bookings.length === 0) {
      html += '<div class="tp-empty-day">No lessons</div>';
    } else {
      for (const b of bookings) {
        const ltColour    = b.lesson_type_colour || 'var(--accent)';
        const ltName      = b.lesson_type_name || 'Standard Lesson';
        const isCancelled = b.status === 'cancelled' || b.status === 'rescheduled';
        const isCompleted = b.status === 'completed';
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
    }
    html += '</div></div>';
  }

  html += '</div>';
  document.getElementById('calContent').innerHTML = html;
}

// ─── DAILY RENDER ────────────────────────────────────────────────────────────
function renderDaily() {
  const today    = new Date(); today.setHours(0,0,0,0);
  const ds       = dateStr(cursor);
  const allBookings = bookingCache[ds] || [];
  const bookings = allBookings.filter(b => showCancelled || b.status !== 'cancelled');
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
      const isCompleted = b.status === 'completed';
      const waUrl = whatsappUrl(b.learner_phone);
      const ltColour = b.lesson_type_colour || 'var(--accent)';
      const ltName   = b.lesson_type_name || 'Standard Lesson';
      const thisAddr = b.booking_pickup_address || b.learner_pickup_address || '';

      // Travel indicator between consecutive bookings
      if (i > 0 && b.status !== 'cancelled' && b.status !== 'rescheduled') {
        const prev = bookings[i - 1];
        const prevAddr = prev.booking_pickup_address || prev.learner_pickup_address || '';
        if (prevAddr && thisAddr && prev.status !== 'cancelled' && prev.status !== 'rescheduled') {
          html += `<div class="travel-indicator" data-travel-from="${esc(prevAddr)}" data-travel-to="${esc(thisAddr)}" style="text-align:center;padding:2px 0"></div>`;
        }
      }

      const cardStyle = b.status === 'cancelled' ? '' :
        `style="border-left-color:${ltColour};${isCompleted ? `background:${ltColour}08;border-color:${ltColour}40;` : `background:${ltColour}12;border-color:${ltColour}50;`}"`;
      html += `
        <div class="daily-booking-card ${isCompleted ? 'completed' : b.status === 'cancelled' ? 'cancelled' : ''}" ${cardStyle}>
          <div class="daily-booking-time">${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)} <span class="lesson-type-badge" style="background:${ltColour}20;color:${ltColour};border:1px solid ${ltColour}40">${esc(ltName)}</span></div>
          <div>
            <div class="daily-booking-name">${esc(b.learner_name)}${b.prefer_contact_before ? '<span class="contact-badge" title="Learner would like you to contact them before their first lesson">📞 Contact first</span>' : ''}</div>
            <div class="daily-booking-email">${esc(b.learner_email)}</div>
            ${b.learner_phone ? `<div class="daily-booking-contact"><a href="tel:${esc(b.learner_phone)}">📞 ${esc(b.learner_phone)}</a>${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>` : ''}
            ${(b.booking_pickup_address || b.learner_pickup_address) ? `<div class="daily-booking-email">📍 ${esc(b.booking_pickup_address || b.learner_pickup_address)}</div>` : ''}
            ${b.booking_dropoff_address ? `<div class="daily-booking-email">🏁 ${esc(b.booking_dropoff_address)}</div>` : ''}
          </div>
          <span class="daily-booking-status status-${b.status}">${statusLabel(b.status)}</span>
          ${b.status === 'awaiting_confirmation' ? `<button class="btn-confirm-sm" data-action="toggle-confirm-form" data-id="${b.id}">Confirm lesson</button><div id="confirm-form-${b.id}" style="display:none">${renderConfirmForm(b.id)}</div>` : ''}
          ${b.status === 'confirmed' && !isCompleted ? `<button class="btn-complete-sm" id="complete-${b.id}" data-action="mark-complete" data-id="${b.id}">Mark complete</button>` : ''}
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

// ─── AGENDA RENDER ──────────────────────────────────────────────────────────
function renderAgenda() {
  const today = new Date(); today.setHours(0,0,0,0);
  const rangeStart = new Date(cursor);
  const rangeEnd   = addDays(cursor, 13);

  // Collect all bookings in date range, sorted chronologically
  const allBookings = [];
  let d = new Date(rangeStart);
  while (d <= rangeEnd) {
    const ds = dateStr(d);
    const dayBookings = bookingCache[ds] || [];
    for (const b of dayBookings) {
      if (!showCancelled && (b.status === 'cancelled' || b.status === 'rescheduled')) continue;
      allBookings.push(b);
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

    html += `<div class="agenda-date-header${isToday ? ' today' : ''}">
      <span>${dayLabel}</span>
      <span class="agenda-date-count">${groups[ds].length} lesson${groups[ds].length !== 1 ? 's' : ''}</span>
    </div>`;

    const daySlots = groups[ds];
    for (let i = 0; i < daySlots.length; i++) {
      const b = daySlots[i];
      const ltColour = b.lesson_type_colour || 'var(--accent)';
      const ltName   = b.lesson_type_name || 'Standard Lesson';
      const isCancelled = b.status === 'cancelled' || b.status === 'rescheduled';
      const isCompleted = b.status === 'completed';
      const isAwaiting = b.status === 'awaiting_confirmation';
      const cardCls = isCancelled ? 'agenda-card cancelled' : isCompleted ? 'agenda-card completed' : isAwaiting ? 'agenda-card' : 'agenda-card';
      const waUrl = whatsappUrl(b.learner_phone);
      const thisAddr = b.booking_pickup_address || b.learner_pickup_address || '';

      // Travel indicator between consecutive bookings
      if (i > 0 && !isCancelled) {
        const prev = daySlots[i - 1];
        const prevAddr = prev.booking_pickup_address || prev.learner_pickup_address || '';
        if (prevAddr && thisAddr && prev.status !== 'cancelled' && prev.status !== 'rescheduled') {
          html += `<div class="travel-indicator" data-travel-from="${esc(prevAddr)}" data-travel-to="${esc(thisAddr)}" style="text-align:center;padding:2px 0"></div>`;
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

// ─── Drill-down from monthly ─────────────────────────────────────────────────
function drillToDay(ds) {
  cursor = new Date(ds + 'T00:00:00');
  setView('agenda');
}

// ─── Status helpers ──────────────────────────────────────────────────────────
function statusLabel(status) {
  switch (status) {
    case 'completed': return '✓ Completed';
    case 'cancelled': return '✕ Cancelled';
    case 'rescheduled': return '↻ Rescheduled';
    case 'awaiting_confirmation': return '⏳ Awaiting confirmation';
    case 'disputed': return '⚠ Disputed';
    case 'no_show': return '✕ No show';
    default: return 'Confirmed';
  }
}

function renderConfirmForm(bookingId) {
  return `
    <div class="confirm-form">
      <label>Did this lesson take place?</label>
      <select id="cf-happened-${bookingId}">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
      <label>Was anyone late?</label>
      <select id="cf-late-${bookingId}" data-action="cf-late-change" data-booking-id="${bookingId}">
        <option value="">No one was late</option>
        <option value="instructor">I was late</option>
        <option value="learner">Learner was late</option>
      </select>
      <div id="cf-mins-row-${bookingId}" style="display:none">
        <label>How many minutes late?</label>
        <select id="cf-mins-${bookingId}">
          <option value="5">5 minutes</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="20">20 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
        </select>
      </div>
      <label>Notes (optional)</label>
      <textarea id="cf-notes-${bookingId}" placeholder="Any notes about this lesson..."></textarea>
      <button class="btn-submit-confirm" data-action="submit-confirmation" data-booking-id="${bookingId}">Submit confirmation</button>
    </div>`;
}

function toggleConfirmForm(bookingId) {
  const el = document.getElementById('confirm-form-' + bookingId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function submitConfirmation(bookingId) {
  const happened = document.getElementById('cf-happened-' + bookingId).value === 'true';
  const lateParty = document.getElementById('cf-late-' + bookingId).value || null;
  const lateMinutes = lateParty ? parseInt(document.getElementById('cf-mins-' + bookingId).value) : null;
  const notes = document.getElementById('cf-notes-' + bookingId).value.trim() || null;

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=confirm-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, lesson_happened: happened, late_party: lateParty, late_minutes: lateMinutes, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    // Refresh the calendar view
    loadView();
  } catch (err) {
    showToast('Failed to submit confirmation: ' + err.message, 'error');
  }
}

// ─── Mark complete ───────────────────────────────────────────────────────────
async function markComplete(bookingId) {
  const btn = document.getElementById(`complete-${bookingId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await markCompleteWithNotes(bookingId, null);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Mark complete'; }
  }
}

function closeBookingModal() {
  document.getElementById('bookingModal').classList.remove('open');
}
function handleBookingModalOverlayClick(e) {
  if (e.target === document.getElementById('bookingModal')) closeBookingModal();
}

// ─── Add Availability Modal ──────────────────────────────────────────────────
let modalTargetDate = null; // the date we're adding availability for

function openAvailModal() {
  modalTargetDate = cursor;
  const dow = cursor.getDay();
  const dayName = DAY_FULL[dow];
  const dateLabel = `${cursor.getDate()} ${MON_FULL[cursor.getMonth()]} ${cursor.getFullYear()}`;

  document.getElementById('modalTitle').textContent = `Add Availability`;
  const existingCount = availCache.filter(w => w.day_of_week === dow).length;
  const addNote = existingCount > 0 ? ` (${existingCount} existing window${existingCount > 1 ? 's' : ''})` : '';
  document.getElementById('modalSubtitle').textContent = `For ${dayName}s (recurring weekly)${addNote}`;

  // Default times for the new window
  document.getElementById('modalStart').value = '09:00';
  document.getElementById('modalEnd').value   = '17:00';

  document.getElementById('availModal').classList.add('open');
}

function closeAvailModal() {
  document.getElementById('availModal').classList.remove('open');
}
function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('availModal')) closeAvailModal();
}

async function saveNewAvailability() {
  const start = document.getElementById('modalStart').value;
  const end   = document.getElementById('modalEnd').value;

  if (!start || !end) { showToast('Please set both start and end times', 'error'); return; }
  if (start >= end)   { showToast('Start time must be before end time', 'error'); return; }

  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const dow = modalTargetDate.getDay();

  // Add the new window alongside any existing windows (including same day)
  const updated = [...availCache];
  updated.push({ day_of_week: dow, start_time: start, end_time: end });

  try {
    const res  = await ccAuth.fetchAuthed('/api/instructor?action=set-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: updated })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    availCache = (data.windows || []).map(w => ({
      day_of_week: w.day_of_week,
      start_time:  w.start_time.slice(0,5),
      end_time:    w.end_time.slice(0,5)
    }));

    closeAvailModal();
    showToast('Availability saved ✓', 'success');
    renderCurrentView();
  } catch (err) {
    showToast(err.message || 'Failed to save', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save availability';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── WhatsApp URL helper ──────────────────────────────────────────────────────
function whatsappUrl(phone) {
  if (!phone) return null;
  let num = phone.replace(/\s+/g, '');
  if (num.startsWith('0')) num = '44' + num.slice(1);
  else if (num.startsWith('+')) num = num.slice(1);
  return 'https://wa.me/' + num;
}

// ─── Inline notes on completed lessons ────────────────────────────────────────
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

// ─── Travel time between consecutive bookings ──────────────────────────────
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

// ─── Refresh schedule ─────────────────────────────────────────────────────────
async function refreshSchedule(silent) {
  const btn = document.getElementById('refreshBtn');
  if (btn && !silent) btn.textContent = '⟳';
  // Full refresh: clear everything and re-fetch + re-render in one step.
  // renderCurrentView calls fetchNeededData (which awaits) before rendering,
  // so the calendar shows fresh data directly without flashing empty.
  bookingCache = {};
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

// ─── Calendar Sync Banner ──────────────────────────────────────────────────
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

// ─── Instructor Notes in Complete Flow ───────────────────────────────────────
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
    ${b.booking_dropoff_address ? `<div class="booking-detail-row"><span class="booking-detail-label">Drop-off</span><span class="booking-detail-val">🏁 ${esc(b.booking_dropoff_address)}</span></div>` : ''}
    <div class="booking-detail-row"><span class="booking-detail-label">Status</span><span class="booking-detail-val"><span class="daily-booking-status status-${b.status}">${statusLabel(b.status)}</span></span></div>
    ${b.prefer_contact_before ? `<div class="booking-detail-row"><span class="booking-detail-label">Note</span><span class="booking-detail-val" style="color:var(--accent);">📞 Learner would like a call or message before their first lesson</span></div>` : ''}
    ${b.instructor_notes ? `<div class="booking-detail-row"><span class="booking-detail-label">Your notes</span><span class="booking-detail-val" style="font-style:italic">${esc(b.instructor_notes)}</span></div>` : ''}
    ${b.status !== 'completed' ? `
      <div class="notes-label">Lesson notes (saved when you mark complete)</div>
      <textarea class="notes-field" id="detailNotes" placeholder="e.g. Worked on roundabouts, needs more mirror checks…"></textarea>
    ` : ''}
    ${b.status === 'completed' && b.learner_ratings && b.learner_ratings.length > 0 ? `
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
  if (b.status === 'confirmed') {
    actions.innerHTML = `
      <button class="btn-modal-cancel" style="color:var(--red)" data-action="open-cancel-modal" data-id="${b.id}">Cancel lesson</button>
      <button class="btn-modal-cancel" style="color:var(--accent)" data-action="open-reschedule-modal" data-id="${b.id}" data-date="${b.scheduled_date}" data-start="${b.start_time.slice(0,5)}" data-end="${b.end_time.slice(0,5)}" data-name="${esc(b.learner_name)}">Reschedule</button>
      <button class="btn-modal-cancel" data-action="open-edit-booking-modal" data-id="${b.id}">Edit</button>
      <button class="btn-modal-cancel" data-action="close-booking-modal">Close</button>
      <button class="btn-modal-save" id="detailCompleteBtn" data-action="mark-complete-from-modal" data-id="${b.id}">Mark complete</button>`;
  } else {
    actions.innerHTML = `<button class="btn-modal-cancel" data-action="close-booking-modal">Close</button>`;
  }

  document.getElementById('bookingModal').classList.add('open');
}

async function markCompleteFromModal(bookingId) {
  const btn = document.getElementById('detailCompleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const notesEl = document.getElementById('detailNotes');
  const notes = notesEl ? notesEl.value.trim() : '';
  await markCompleteWithNotes(bookingId, notes);
  closeBookingModal();
}

async function markCompleteWithNotes(bookingId, instructorNotes) {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, instructor_notes: instructorNotes || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    for (const ds in bookingCache) {
      const bk = bookingCache[ds].find(b => b.id === bookingId);
      if (bk) { bk.status = 'completed'; bk.instructor_notes = instructorNotes; break; }
    }
    showToast('Lesson marked as complete ✓', 'success');
    renderCurrentView();
  } catch (err) {
    showToast(err.message || 'Failed to mark as complete', 'error');
  }
}

// ─── Learner History ──────────────────────────────────────────────────────────
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
      const statusBadge = b.status === 'completed' ? '<span style="color:var(--green);font-size:0.75rem">✓</span>'
        : b.status === 'cancelled' ? '<span style="color:var(--red);font-size:0.75rem">✕ cancelled</span>'
        : '<span style="color:var(--blue);font-size:0.75rem">upcoming</span>';

      html += `<div class="history-item">
        <div class="history-item-date">${dateLabel} · ${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)} ${statusBadge}</div>`;

      if (b.instructor_notes) html += `<div class="history-item-notes">📝 ${esc(b.instructor_notes)}</div>`;
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

// ─── Cancel Booking ───────────────────────────────────────────────────────────
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
    showToast('Lesson cancelled — learner notified and credit refunded', 'success');
    await refreshSchedule(true);
  } catch (err) {
    showToast(err.message || 'Failed to cancel', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Cancel this lesson';
  }
}

// ─── Reschedule Booking ──────────────────────────────────────────────────────
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

// ─── Edit Booking ─────────────────────────────────────────────────────────
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
      infoEl.textContent = Math.abs(delta) + ' minutes will be refunded to the learner\'s balance.';
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
        msg += '• ' + c.learner_name + ' (' + c.time + ')';
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

// ─── Add Lesson (Instructor-Initiated Booking) ──────────────────────────────
let addLessonLearners = [];
let selectedLearnerId = null;

async function openAddLessonModal() {
  selectedLearnerId = null;
  document.getElementById('addLessonSearch').value = '';
  document.getElementById('addLessonSelected').style.display = 'none';
  document.getElementById('addLessonNotes').value = '';
  document.getElementById('addLessonDropoff').value = '';
  document.getElementById('addLessonCreditNote').style.display = 'none';
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

  // Fetch learners + lesson types in parallel
  try {
    const [learnersRes, typesRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/instructor?action=my-learners'),
      ccAuth.fetchAuthed('/api/lesson-types?action=list')
    ]);
    const learnersData = await learnersRes.json();
    addLessonLearners = Array.isArray(learnersData) ? learnersData : (learnersData.learners || []);
    const typesData = await typesRes.json();
    const types = typesData.lesson_types || [];
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
  ).slice(0, 20);

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="learner-option" style="color:var(--muted)">No learners found</div>';
  } else {
    dropdown.innerHTML = filtered.map(l => `
      <div class="learner-option" data-action="select-learner" data-id="${l.id}" data-name="${esc(l.name)}" data-phone="${esc(l.phone || l.email)}" data-balance="${l.credit_balance || 0}">
        <div class="learner-opt-name">${esc(l.name)}</div>
        <div class="learner-opt-detail">${esc(l.phone || '')} ${l.phone && l.email ? '·' : ''} ${esc(l.email || '')} · ${l.credit_balance || 0} credit${(l.credit_balance || 0) !== 1 ? 's' : ''}</div>
      </div>
    `).join('');
  }
  dropdown.classList.add('open');
}

function selectLearner(id, name, detail, credits) {
  selectedLearnerId = id;
  document.getElementById('addLessonSearch').value = '';
  document.getElementById('addLessonDropdown').classList.remove('open');
  document.getElementById('addLessonSelected').style.display = 'block';
  document.getElementById('addLessonSelectedName').textContent = name;
  document.getElementById('addLessonSelectedDetail').textContent = detail;

  // Update credit note
  updateCreditNote(credits);
}

function clearSelectedLearner() {
  selectedLearnerId = null;
  document.getElementById('addLessonSelected').style.display = 'none';
  document.getElementById('addLessonCreditNote').style.display = 'none';
  document.getElementById('addLessonSearch').focus();
}

function updateCreditNote(credits) {
  const noteEl = document.getElementById('addLessonCreditNote');
  const payMethod = document.querySelector('input[name="addLessonPay"]:checked')?.value;
  if (payMethod === 'credit') {
    noteEl.style.display = 'block';
    noteEl.textContent = credits > 0
      ? `Learner has ${credits} lesson${credits !== 1 ? 's' : ''} remaining. 1 will be deducted.`
      : 'Learner has no credits! Choose Cash or Free instead.';
    noteEl.style.color = credits > 0 ? 'var(--muted)' : 'var(--red)';
  } else {
    noteEl.style.display = 'none';
  }
}

// Update credit note when payment method changes
document.addEventListener('change', e => {
  if (e.target.name === 'addLessonPay' && selectedLearnerId) {
    const learner = addLessonLearners.find(l => l.id === selectedLearnerId);
    if (learner) updateCreditNote(learner.credit_balance || 0);
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

  const btn = document.getElementById('addLessonBtn');
  btn.disabled = true; btn.textContent = 'Booking…';

  try {
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
    showToast(err.message || 'Failed to create booking', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Book lesson';
  }
}

// ── Offer Lesson Modal ────────────────────────────────────────────────────────
async function openOfferModal(prefillEmail, prefillName) {
  document.getElementById('offerName').value = prefillName || '';
  document.getElementById('offerEmail').value = prefillEmail || '';
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

  // Fetch lesson types
  try {
    const typesRes = await ccAuth.fetchAuthed('/api/lesson-types?action=list');
    const typesData = await typesRes.json();
    const types = typesData.lesson_types || [];
    const sel = document.getElementById('offerLessonType');
    sel.innerHTML = types.map(lt => {
      const hrs = lt.duration_minutes / 60;
      const hrsStr = hrs % 1 === 0 ? `${hrs}hr` : `${hrs.toFixed(1)}hrs`;
      const price = (lt.price_pence / 100).toFixed(2);
      return `<option value="${lt.id}" data-price="${lt.price_pence}">${lt.name} (${hrsStr}) — £${price}</option>`;
    }).join('');
  } catch { /* fallback — select will be empty */ }

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
}

async function sendOffer() {
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

  if (!offerName) { errorEl.textContent = 'Please enter the learner\'s name.'; errorEl.style.display = 'block'; return; }
  if (sendEmail && !email) { errorEl.textContent = 'Please enter the learner\'s email address.'; errorEl.style.display = 'block'; return; }
  if (!flexible && !date) { errorEl.textContent = 'Please select a date, or tick "Flexible".'; errorEl.style.display = 'block'; return; }
  if (!flexible && !time) { errorEl.textContent = 'Please select a start time, or tick "Flexible".'; errorEl.style.display = 'block'; return; }

  // Build price: custom input → pence, or omit to use lesson type default
  let offerPricePence;
  if (customPriceStr !== '') {
    const parsed = parseFloat(customPriceStr);
    if (isNaN(parsed) || parsed < 0) { errorEl.textContent = 'Please enter a valid price.'; errorEl.style.display = 'block'; return; }
    offerPricePence = Math.round(parsed * 100);
  }

  btn.disabled = true;
  btn.textContent = sendEmail ? 'Sending…' : 'Creating…';

  try {
    const payload = {
      learner_name: offerName,
      lesson_type_id: lessonTypeId ? parseInt(lessonTypeId) : undefined
    };
    if (sendEmail) payload.learner_email = email;
    if (!flexible) {
      payload.scheduled_date = date;
      payload.start_time = time;
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
    const safeName = offerName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let statusLine;
    if (sendEmail) {
      const safeEmail = email.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      statusLine = `Offer sent to ${safeEmail}${priceMsg}${flexMsg}! They have 24 hours to accept.`;
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
    btn.textContent = sendEmail ? 'Sent ✓' : 'Created ✓';

    // Refresh schedule to show blocked slot (if slot-pinned)
    if (!flexible) renderCurrentView();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = sendEmail ? 'Send offer' : 'Create link';
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
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
  else if (a === 'open-avail-modal') openAvailModal();
  else if (a === 'toggle-confirm-form') toggleConfirmForm(parseInt(t.dataset.id, 10));
  else if (a === 'mark-complete') markComplete(parseInt(t.dataset.id, 10));
  else if (a === 'submit-confirmation') submitConfirmation(parseInt(t.dataset.bookingId, 10));
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
  else if (a === 'mark-complete-from-modal') markCompleteFromModal(parseInt(t.dataset.id, 10));
  else if (a === 'history-book-lesson') { closeHistoryModal(); openAddLessonModal(); }
  else if (a === 'retry-booking-history') renderBookingHistory();
  else if (a === 'retry-current-view') renderCurrentView();
  else if (a === 'select-learner') selectLearner(parseInt(t.dataset.id, 10), t.dataset.name, t.dataset.phone, parseInt(t.dataset.balance, 10));
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'cf-late-change') {
    var row = document.getElementById('cf-mins-row-' + t.dataset.bookingId);
    if (row) row.style.display = t.value ? 'block' : 'none';
  }
});
// ── Toolbar overflow buttons (combo actions) ──
document.querySelectorAll('[data-toolbar-of]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var op = btn.dataset.toolbarOf;
    if (op === 'offer') { openOfferModal(); toggleToolbarOverflow(); }
    else if (op === 'hide-weekends') { toggleHideWeekends(); toggleToolbarOverflow(); }
    else if (op === 'show-cancelled') { toggleShowCancelled(); toggleToolbarOverflow(); }
  });
});
// ── Offer modal price/type changes ──
(function () {
  var cp = document.getElementById('offerCustomPrice');
  if (cp) cp.addEventListener('input', updateOfferPrice);
})();
// ── Static wires ──
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
  bind('btn-open-offer', function () { openOfferModal(); });
  bind('btnHideWeekends', toggleHideWeekends);
  bind('btnShowCancelled', toggleShowCancelled);
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
  var offerModal = document.getElementById('offerLessonModal');
  var offerMouseDownTarget = null;
  if (offerModal) {
    offerModal.addEventListener('mousedown', function (e) { offerMouseDownTarget = e.target; });
    offerModal.addEventListener('click', function (e) { if (e.target === offerModal && offerMouseDownTarget === offerModal) closeOfferModal(); });
  }
  var offerType = document.getElementById('offerLessonType');
  if (offerType) offerType.addEventListener('change', updateOfferPrice);
  bind('btn-close-offer', closeOfferModal);
  bind('offerSendBtn', sendOffer);
})();
})();
