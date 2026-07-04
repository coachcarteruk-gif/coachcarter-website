(function () {
  'use strict';

/* ── State ── */
var AUTH;
var mode = null;              // 'free' | 'guided'
var focusArea = null;         // guided mode: single supervisor category key
var suggestedAreas = [];      // weakest categories, for the "Suggested" badge + payload
var competencyData = null;
var skillScores = {};
var timerStart = null;        // Date.now() at drive start — survives backgrounded tabs
var timerInterval = null;
var elapsedSeconds = 0;
var moments = [];             // free mode parked-break notes: { catKey, rating, note }
var breakSelection = { catKey: null, rating: null };
var reflections = {};         // { catKey: { rating, what, where, instructor, note, faultsSeen, dl25Skills } }
var currentDriveOptions = [];
var selectedDrive = { kind: 'normal' }; // auto-linked to a booking when one is near now

var SUP_CATS = CC_COMPETENCY.SUPERVISOR_CATEGORIES;
var PRACTICE_RATINGS = [
  { key: 'nailed', label: 'Went well' },
  { key: 'ok', label: 'Needs practice' },
  { key: 'struggled', label: 'Ask instructor' }
];

/* ── Helpers ── */
function showScreen(id) {
  ['screen-setup', 'screen-focus', 'screen-drive', 'screen-break', 'screen-reflect', 'screen-results'].forEach(function(sid) {
    document.getElementById(sid).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatTime(seconds) {
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function apiCall(method, action, body) {
  var opts = {
    method: method,
    headers: { 'Content-Type': 'application/json'}
  };
  if (body) opts.body = JSON.stringify(body);
  return ccAuth.fetchAuthed('/api/learner?action=' + action, opts);
}

function slotsCall(action) {
  return ccAuth.fetchAuthed('/api/slots?action=' + action);
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPracticeNote(parts) {
  var noteParts = [];
  if (parts.what) noteParts.push('What happened: ' + parts.what);
  if (parts.where) noteParts.push('Where: ' + parts.where);
  if (parts.faultsSeen && parts.faultsSeen.length > 0) noteParts.push('Faults spotted: ' + parts.faultsSeen.join('; '));
  if (parts.instructor) noteParts.push('For instructor: ' + parts.instructor);
  return noteParts.join('\n');
}

function parseBookingDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  var time = String(timeValue).slice(0, 8);
  var dt = new Date(String(dateValue).slice(0, 10) + 'T' + time);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function bookingWindowEnd(booking, start) {
  var end = parseBookingDateTime(booking.scheduled_date, booking.end_time);
  if (end && start && end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  if (!end && start && booking.duration_minutes) {
    end = new Date(start.getTime() + Number(booking.duration_minutes) * 60 * 1000);
  }
  return end;
}

function isRelevantDriveBooking(booking) {
  var start = parseBookingDateTime(booking.scheduled_date, booking.start_time);
  if (!start) return false;
  var end = bookingWindowEnd(booking, start) || start;
  var now = new Date();
  var open = new Date(start.getTime() - 2 * 60 * 60 * 1000);
  var close = new Date(end.getTime() + 2 * 60 * 60 * 1000);
  return now >= open && now <= close;
}

function formatBookingTime(booking) {
  var start = parseBookingDateTime(booking.scheduled_date, booking.start_time);
  var end = parseBookingDateTime(booking.scheduled_date, booking.end_time);
  if (!start) return 'Booked lesson';
  var dateLabel = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  var startLabel = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  var endLabel = end ? end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  return dateLabel + ', ' + startLabel + (endLabel ? '-' + endLabel : '');
}

function selectedDriveNotes() {
  if (!selectedDrive || selectedDrive.kind !== 'booking') return null;
  var booking = selectedDrive.booking;
  var parts = ['Started from learner Start a drive flow.'];
  if (booking.instructor_name) parts.push('Instructor: ' + booking.instructor_name + '.');
  if (booking.lesson_type_name) parts.push('Lesson type: ' + booking.lesson_type_name + '.');
  return parts.join(' ');
}

/* ── Init ── */
window.addEventListener('DOMContentLoaded', async function() {
  AUTH = ccAuth.getAuth();
  if (!AUTH) {
    window.location.href = '/learner/login.html?redirect=/learner/focused-practice.html';
    return;
  }
  await Promise.all([loadCompetencyData(), loadCurrentDriveOptions()]);
});

async function loadCurrentDriveOptions() {
  try {
    var res = await slotsCall('my-bookings');
    if (!res.ok) throw new Error('API error');
    var data = await res.json();
    currentDriveOptions = (data.upcoming || []).filter(isRelevantDriveBooking);
  } catch (e) {
    console.warn('Failed to load current bookings:', e);
    currentDriveOptions = [];
  }
  // Auto-link the drive to a booking happening near now — the learner
  // shouldn't have to make this decision, just be able to undo it.
  if (currentDriveOptions.length > 0) {
    selectedDrive = { kind: 'booking', booking: currentDriveOptions[0] };
  } else {
    selectedDrive = { kind: 'normal' };
  }
  renderBookingNote();
}

async function loadCompetencyData() {
  try {
    var res = await apiCall('GET', 'competency');
    if (!res.ok) throw new Error('API error');
    competencyData = await res.json();
    buildSkillScores();
  } catch (e) {
    console.warn('Failed to load competency data:', e);
  }
  var weakAreas = CC_COMPETENCY.getWeakAreas(skillScores, 3);
  suggestedAreas = weakAreas
    .filter(function(w) { return w.score > 0; })
    .map(function(w) { return w.category.key; });
}

function buildSkillScores() {
  if (!competencyData) return;
  var lr = competencyData.lesson_ratings || [];
  var qa = competencyData.quiz_accuracy || [];
  var mf = competencyData.mock_faults || [];

  // Build per-skill suggestions from existing learner signals.
  var SKILLS = CC_COMPETENCY.SKILLS;
  for (var i = 0; i < SKILLS.length; i++) {
    var sk = SKILLS[i];
    var lessonRatings = lr.filter(function(r) { return CC_COMPETENCY.mapLegacySkill(r.skill_key) === sk.key; })
      .map(function(r) { return { score: r.rating === 'nailed' ? 3 : r.rating === 'ok' ? 2 : 1, date: r.created_at }; });
    var quizResults = qa.filter(function(q) { return q.skill_key === sk.key; })
      .map(function(q) { return { correct: q.correct_count > 0, date: null }; });
    var mockFaults = mf.filter(function(f) { return CC_COMPETENCY.mapLegacySkill(f.skill_key) === sk.key; });

    var lastDates = lessonRatings.map(function(r) { return r.date; }).filter(Boolean);
    var lastPractised = lastDates.length > 0 ? lastDates.sort().reverse()[0] : null;

    skillScores[sk.key] = CC_COMPETENCY.readinessScore({
      lessonRatings: lessonRatings,
      quizResults: quizResults,
      mockFaults: mockFaults,
      lastPractised: lastPractised
    });
  }
}

/* ── Screen 1: Mode choice ── */
function renderBookingNote() {
  var el = document.getElementById('booking-note');
  if (!el) return;
  if (selectedDrive.kind === 'booking') {
    var booking = selectedDrive.booking;
    var label = booking.lesson_type_name || 'Booked lesson';
    var meta = formatBookingTime(booking);
    if (booking.instructor_name) meta += ' with ' + booking.instructor_name;
    el.innerHTML = '<span class="booking-note-text">Linking to your lesson: <strong>' + escHtml(label) + '</strong> — ' + escHtml(meta) + '</span>' +
      '<button type="button" class="booking-note-link" data-action="unlink-booking">Not this lesson?</button>';
    el.classList.remove('hidden');
  } else if (currentDriveOptions.length > 0) {
    var b = currentDriveOptions[0];
    el.innerHTML = '<span class="booking-note-text">This drive won’t be linked to a lesson.</span>' +
      '<button type="button" class="booking-note-link" data-action="relink-booking">Link to ' + escHtml(formatBookingTime(b)) + '</button>';
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function chooseMode(m) {
  mode = m;
  if (mode === 'free') {
    startDrive();
  } else {
    renderFocusList();
    showScreen('screen-focus');
  }
}

/* ── Screen 1b: Guided focus pick + briefing ── */
function renderFocusList() {
  var listContainer = document.getElementById('focus-area-list');
  var chosenContainer = document.getElementById('focus-area-chosen');
  var introEl = document.getElementById('focus-intro');

  if (focusArea) {
    // Once a focus is picked, hide the full list and the intro copy so the
    // briefing is the only thing left to read before setting off — no
    // scrolling needed to get from pick to briefing.
    var cat = CC_COMPETENCY.getSupervisorCategory(focusArea);
    listContainer.innerHTML = '';
    listContainer.classList.add('hidden');
    if (introEl) introEl.classList.add('hidden');
    if (cat) {
      chosenContainer.innerHTML =
        '<div class="area-pick selected chosen-only" data-action="pick-focus" data-cat="' + cat.key + '">' +
          '<span class="area-pick-icon">' + cat.icon + '</span>' +
          '<div class="area-pick-text">' +
            '<div class="area-pick-name">' + cat.label + '</div>' +
          '</div>' +
          '<span class="area-pick-change">Change</span>' +
        '</div>';
    }
    chosenContainer.classList.remove('hidden');
  } else {
    chosenContainer.innerHTML = '';
    chosenContainer.classList.add('hidden');
    if (introEl) introEl.classList.remove('hidden');
    listContainer.classList.remove('hidden');
    listContainer.innerHTML = SUP_CATS.map(function(cat) {
      var isSuggested = suggestedAreas.indexOf(cat.key) >= 0;
      return '<div class="area-pick" data-action="pick-focus" data-cat="' + cat.key + '">' +
        '<span class="area-pick-icon">' + cat.icon + '</span>' +
        '<div class="area-pick-text">' +
          '<div class="area-pick-name">' + cat.label + '</div>' +
          '<div class="area-pick-desc">' + cat.description + '</div>' +
        '</div>' +
        (isSuggested ? '<span class="area-pick-score" style="color:var(--accent);">Suggested</span>' : '<span></span>') +
        '<span class="area-pick-check"></span>' +
      '</div>';
    }).join('');
  }
  renderBriefing();
}

function pickFocus(catKey) {
  focusArea = focusArea === catKey ? null : catKey;
  renderFocusList();
  document.getElementById('btn-start-guided').disabled = !focusArea;
}

function renderBriefing() {
  var container = document.getElementById('briefing');
  if (!focusArea) { container.innerHTML = ''; container.classList.add('hidden'); return; }
  var cat = CC_COMPETENCY.getSupervisorCategory(focusArea);
  if (!cat || !cat.guided) { container.innerHTML = ''; container.classList.add('hidden'); return; }

  var g = cat.guided;
  var sections = [
    { key: 'why', title: 'Why it matters', items: g.why },
    { key: 'exercises', title: 'Try these', items: g.exercises },
    { key: 'good', title: 'What good looks like', items: g.good },
    { key: 'faults', title: 'Common faults', items: g.faults }
  ];
  // Collapsed by default so "Start drive" is reachable right after picking
  // a focus — reading the briefing is optional, not a gate to setting off.
  var html = '<p class="briefing-intro">Optional reading before you set off. Tap a heading to expand it.</p>';
  sections.forEach(function(sec) {
    if (!sec.items || sec.items.length === 0) return;
    html += '<div class="focus-guide collapsed" data-section="' + sec.key + '">' +
      '<button type="button" class="focus-guide-toggle" data-action="toggle-briefing-section" data-section="' + sec.key + '">' +
        '<h3>' + sec.title + '</h3>' +
        '<span class="focus-guide-chevron">&#8250;</span>' +
      '</button>' +
      '<ul>';
    sec.items.forEach(function(item) { html += '<li>' + escHtml(item) + '</li>'; });
    html += '</ul></div>';
  });
  container.innerHTML = html;
  container.classList.remove('hidden');
}

function toggleBriefingSection(key) {
  var el = document.querySelector('.focus-guide[data-section="' + key + '"]');
  if (el) el.classList.toggle('collapsed');
}

/* ── Screen 2: Driving ── */
function startDrive() {
  var pillsEl = document.getElementById('focus-pills');
  if (mode === 'guided' && focusArea) {
    var cat = CC_COMPETENCY.getSupervisorCategory(focusArea);
    pillsEl.innerHTML = cat ? '<span class="focus-pill">' + cat.icon + ' ' + cat.label + '</span>' : '';
  } else {
    pillsEl.innerHTML = '';
  }

  // Timestamp-based timer: mobile browsers throttle intervals when the
  // phone is pocketed, so elapsed time is always recomputed from the start.
  if (!timerStart) timerStart = Date.now();
  renderTimer();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(renderTimer, 1000);

  if (typeof posthog !== 'undefined') {
    posthog.capture('focused_practice_started', { mode: mode, areas: mode === 'guided' ? [focusArea] : [] });
  }

  showScreen('screen-drive');
}

function renderTimer() {
  if (timerStart) elapsedSeconds = Math.floor((Date.now() - timerStart) / 1000);
  var el = document.getElementById('timer-display');
  if (el) el.textContent = formatTime(elapsedSeconds);
}

/* ── Screen 2b: Parked break ── */
function goToBreak() {
  breakSelection = { catKey: mode === 'guided' ? focusArea : null, rating: null };
  var noteEl = document.getElementById('break-note');
  if (noteEl) noteEl.value = '';
  renderBreakForm();
  renderMomentList();
  showScreen('screen-break');
}

function renderBreakForm() {
  var chipsEl = document.getElementById('break-area-chips');
  chipsEl.innerHTML = SUP_CATS.map(function(cat) {
    var sel = breakSelection.catKey === cat.key;
    return '<button type="button" class="break-chip' + (sel ? ' selected' : '') + '" data-action="break-pick-area" data-cat="' + cat.key + '">' +
      cat.icon + ' ' + cat.label + '</button>';
  }).join('');

  var ratingEl = document.getElementById('break-rating');
  ratingEl.innerHTML = PRACTICE_RATINGS.map(function(r) {
    var sel = breakSelection.rating === r.key;
    return '<button type="button" class="reflect-btn' + (sel ? ' sel-' + r.key : '') + '" data-action="break-pick-rating" data-rating="' + r.key + '">' + r.label + '</button>';
  }).join('');

  document.getElementById('btn-add-moment').disabled = !(breakSelection.catKey && breakSelection.rating);
}

function breakPickArea(catKey) {
  breakSelection.catKey = breakSelection.catKey === catKey ? null : catKey;
  renderBreakForm();
}

function breakPickRating(rating) {
  breakSelection.rating = breakSelection.rating === rating ? null : rating;
  renderBreakForm();
}

function addMoment() {
  if (!breakSelection.catKey || !breakSelection.rating) return;
  var noteEl = document.getElementById('break-note');
  moments.push({
    catKey: breakSelection.catKey,
    rating: breakSelection.rating,
    note: noteEl ? noteEl.value.trim() : ''
  });
  breakSelection = { catKey: mode === 'guided' ? focusArea : null, rating: null };
  if (noteEl) noteEl.value = '';
  renderBreakForm();
  renderMomentList();
}

function renderMomentList() {
  var el = document.getElementById('moment-list');
  if (moments.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="suggested-label">Noted this drive</div>' + moments.map(function(m) {
    var cat = CC_COMPETENCY.getSupervisorCategory(m.catKey);
    var ratingObj = PRACTICE_RATINGS.find(function(r) { return r.key === m.rating; });
    return '<div class="moment-item">' +
      '<span class="moment-item-area">' + (cat ? cat.icon + ' ' + escHtml(cat.label) : escHtml(m.catKey)) + '</span>' +
      '<span class="result-area-badge ' + m.rating + '">' + (ratingObj ? ratingObj.label : m.rating) + '</span>' +
      (m.note ? '<span class="moment-item-note">' + escHtml(m.note) + '</span>' : '') +
    '</div>';
  }).join('');
}

/* ── Screen 3: Reflection ── */
function reflectionAreas() {
  if (mode === 'guided' && focusArea) return [focusArea];
  var seen = [];
  moments.forEach(function(m) {
    if (seen.indexOf(m.catKey) < 0) seen.push(m.catKey);
  });
  return seen;
}

function goToReflection() {
  renderTimer();
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  var areas = reflectionAreas();
  var container = document.getElementById('reflect-areas');
  var overallWrap = document.getElementById('reflect-overall');
  var html = '';
  reflections = {};

  areas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    if (!cat) return;
    var areaMoments = moments.filter(function(m) { return m.catKey === catKey; });
    var prefillRating = areaMoments.length > 0 ? areaMoments[areaMoments.length - 1].rating : null;
    var prefillWhat = areaMoments.map(function(m) { return m.note; }).filter(Boolean).join('; ');

    reflections[catKey] = {
      rating: prefillRating, what: prefillWhat, where: '', instructor: '',
      note: '', faultsSeen: [], dl25Skills: cat.dl25Skills
    };
    reflections[catKey].note = buildPracticeNote(reflections[catKey]);

    html += '<div class="reflect-area" data-cat="' + catKey + '">';
    html += '<div class="reflect-area-header">';
    html += '<span class="reflect-area-icon">' + cat.icon + '</span>';
    html += '<span class="reflect-area-q">' + cat.reflectionQ + '</span>';
    html += '</div>';
    html += '<div class="reflect-btns">';
    PRACTICE_RATINGS.forEach(function(r) {
      var sel = prefillRating === r.key ? ' sel-' + r.key : '';
      html += '<button class="reflect-btn' + sel + '" data-action="set-reflection" data-cat="' + catKey + '" data-rating="' + r.key + '">' + r.label + '</button>';
    });
    html += '</div>';
    // Guided drives get the fault checklist from the briefing — a more
    // detailed debrief for the one area they were working on.
    if (mode === 'guided' && cat.guided && cat.guided.faults && cat.guided.faults.length > 0) {
      html += '<div class="fault-checklist"><div class="fault-checklist-title">Did any of these come up?</div>';
      cat.guided.faults.forEach(function(fault, idx) {
        html += '<label class="fault-check"><input type="checkbox" data-action="toggle-fault" data-cat="' + catKey + '" data-fault="' + escHtml(fault) + '"> <span>' + escHtml(fault) + '</span></label>';
      });
      html += '</div>';
    }
    html += '<div class="reflect-note-grid">';
    html += '<input class="reflect-note" data-action="set-reflection-note" data-note-field="what" data-cat="' + catKey + '" placeholder="What happened? (optional)" maxlength="160" value="' + escHtml(prefillWhat) + '">';
    html += '<input class="reflect-note" data-action="set-reflection-note" data-note-field="where" data-cat="' + catKey + '" placeholder="Where? (optional)" maxlength="120">';
    html += '<textarea class="reflect-note reflect-note-wide" data-action="set-reflection-note" data-note-field="instructor" data-cat="' + catKey + '" placeholder="What should your instructor know? (optional)" maxlength="260"></textarea>';
    html += '</div>';
    html += '</div>';
  });

  container.innerHTML = html;

  // Free drive with nothing tagged: just an optional overall note.
  if (areas.length === 0) {
    overallWrap.classList.remove('hidden');
    document.getElementById('reflect-subtitle').textContent =
      'Nothing was noted during this drive. Add an overall note if you like, then save.';
  } else {
    overallWrap.classList.add('hidden');
    document.getElementById('reflect-subtitle').textContent =
      'Choose how each area felt and add anything useful for the next lesson.';
  }

  checkReflectionComplete();
  showScreen('screen-reflect');
}

function setReflection(catKey, rating) {
  reflections[catKey].rating = rating;
  // Update button styles
  document.querySelectorAll('.reflect-btn[data-cat="' + catKey + '"]').forEach(function(btn) {
    btn.className = 'reflect-btn';
    if (btn.getAttribute('data-rating') === rating) {
      btn.classList.add('sel-' + rating);
    }
  });
  checkReflectionComplete();
}

function setReflectionNote(catKey, field, value) {
  if (!reflections[catKey]) return;
  if (field !== 'what' && field !== 'where' && field !== 'instructor') return;
  reflections[catKey][field] = value.trim();
  reflections[catKey].note = buildPracticeNote(reflections[catKey]);
}

function toggleFault(catKey, fault, checked) {
  var r = reflections[catKey];
  if (!r) return;
  var idx = r.faultsSeen.indexOf(fault);
  if (checked && idx < 0) r.faultsSeen.push(fault);
  if (!checked && idx >= 0) r.faultsSeen.splice(idx, 1);
  r.note = buildPracticeNote(r);
}

function checkReflectionComplete() {
  var allRated = true;
  for (var key in reflections) {
    if (!reflections[key].rating) { allRated = false; break; }
  }
  document.getElementById('btn-save-reflect').disabled = !allRated;
}

/* ── Save & Results ── */
async function saveReflection() {
  var btn = document.getElementById('btn-save-reflect');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  // Build API payload keyed by the skill_key expected by the existing endpoint.
  var apiReflections = {};
  for (var catKey in reflections) {
    var r = reflections[catKey];
    if (!r.rating) continue;
    for (var i = 0; i < r.dl25Skills.length; i++) {
      apiReflections[r.dl25Skills[i]] = { rating: r.rating, note: r.note };
    }
  }

  var focusAreas = reflectionAreas();

  try {
    renderTimer();
    var durationMinutes = Math.ceil(elapsedSeconds / 60);
    var payload = {
      focus_areas: focusAreas,
      suggested_areas: suggestedAreas,
      duration_minutes: durationMinutes,
      reflections: apiReflections,
      session_date: new Date().toISOString().slice(0, 10),
      session_type: 'focused_practice'
    };
    var noteParts = [];
    var overallEl = document.getElementById('overall-note');
    if (focusAreas.length === 0 && overallEl && overallEl.value.trim()) {
      noteParts.push(overallEl.value.trim());
    }
    if (selectedDrive && selectedDrive.kind === 'booking') {
      payload.booking_id = selectedDrive.booking.id;
      payload.session_date = selectedDrive.booking.scheduled_date;
      payload.session_type = 'instructor';
      payload.duration_minutes = selectedDrive.booking.duration_minutes || durationMinutes;
      noteParts.push(selectedDriveNotes());
    }
    if (noteParts.length > 0) payload.notes = noteParts.join('\n');
    await apiCall('POST', 'focused-practice', payload);
  } catch (e) {
    console.warn('Failed to save practice session:', e);
  }

  if (typeof posthog !== 'undefined') {
    posthog.capture('focused_practice_completed', {
      mode: mode,
      areas: focusAreas,
      duration_minutes: Math.ceil(elapsedSeconds / 60)
    });
  }

  showResultsScreen();
}

function showResultsScreen() {
  var durationMin = selectedDrive && selectedDrive.kind === 'booking' && selectedDrive.booking.duration_minutes
    ? selectedDrive.booking.duration_minutes
    : Math.ceil(elapsedSeconds / 60);
  var driveLabel = selectedDrive && selectedDrive.kind === 'booking'
    ? 'booked lesson'
    : (mode === 'guided' ? 'guided drive' : 'drive');
  document.getElementById('results-subtitle').textContent =
    durationMin + ' minute' + (durationMin !== 1 ? 's' : '') + ' ' + driveLabel + ' completed. Saved to your driving plan.';

  var cardsHtml = '';
  var needsWork = [];
  var tellInstructor = [];

  reflectionAreas().forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    var r = reflections[catKey];
    if (!cat || !r || !r.rating) return;

    var ratingObj = PRACTICE_RATINGS.find(function(rt) { return rt.key === r.rating; });
    var ratingLabel = ratingObj ? ratingObj.label : r.rating;
    var badgeClass = r.rating;

    cardsHtml += '<div class="result-area-card">';
    cardsHtml += '<div class="result-area-header">';
    cardsHtml += '<span style="font-size:1.1rem;">' + cat.icon + '</span>';
    cardsHtml += '<span class="result-area-name">' + escHtml(cat.label) + '</span>';
    cardsHtml += '<span class="result-area-badge ' + badgeClass + '">' + escHtml(ratingLabel) + '</span>';
    cardsHtml += '</div>';
    if (r.note) {
      cardsHtml += '<div class="result-area-note">' + escHtml(r.note).replace(/\n/g, '<br>') + '</div>';
    }
    cardsHtml += '</div>';

    if (r.rating === 'ok') needsWork.push(cat.label);
    if (r.rating === 'struggled') tellInstructor.push(cat.label);
  });

  document.getElementById('result-cards').innerHTML = cardsHtml;

  // Next steps suggestion
  var nextHtml = '<div class="result-next">';
  nextHtml += '<h3>What next?</h3>';
  if (tellInstructor.length > 0) {
    nextHtml += '<p>Ask your instructor about <strong>' + escHtml(tellInstructor.join(', ')) + '</strong> next lesson so they can help with it.</p>';
  } else if (needsWork.length > 0) {
    nextHtml += '<p>Keep practising <strong>' + escHtml(needsWork.join(', ')) + '</strong> on another drive, or ask your instructor for tips next lesson.</p>';
  } else if (mode === 'guided') {
    nextHtml += '<p>Great drive. Pick a new focus next time, or open your driving plan to see what else is worth practising.</p>';
  } else {
    nextHtml += '<p>Drive logged. Next time, try a guided drive to work on one specific area.</p>';
  }
  nextHtml += '</div>';
  document.getElementById('result-next').innerHTML = nextHtml;

  showScreen('screen-results');
}

// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'pick-focus') pickFocus(target.dataset.cat);
  else if (action === 'toggle-briefing-section') toggleBriefingSection(target.dataset.section);
  else if (action === 'set-reflection') setReflection(target.dataset.cat, target.dataset.rating);
  else if (action === 'break-pick-area') breakPickArea(target.dataset.cat);
  else if (action === 'break-pick-rating') breakPickRating(target.dataset.rating);
  else if (action === 'unlink-booking') { selectedDrive = { kind: 'normal' }; renderBookingNote(); }
  else if (action === 'relink-booking') {
    if (currentDriveOptions.length > 0) selectedDrive = { kind: 'booking', booking: currentDriveOptions[0] };
    renderBookingNote();
  }
});
document.addEventListener('change', function (e) {
  var target = e.target.closest('[data-action="toggle-fault"]');
  if (target) toggleFault(target.dataset.cat, target.dataset.fault, target.checked);
});
document.addEventListener('input', function (e) {
  var target = e.target.closest('[data-action="set-reflection-note"]');
  if (target) setReflectionNote(target.dataset.cat, target.dataset.noteField, target.value);
});
// ── Static handlers previously inline in HTML ──
(function wire() {
  function on(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }
  on('btn-mode-free', function () { chooseMode('free'); });
  on('btn-mode-guided', function () { chooseMode('guided'); });
  on('btn-back-setup', function () { showScreen('screen-setup'); });
  on('btn-start-guided', startDrive);
  on('btn-break', goToBreak);
  on('btn-keep-driving', function () { showScreen('screen-drive'); });
  on('btn-add-moment', addMoment);
  on('btn-finish', goToReflection);
  on('btn-finish-from-break', goToReflection);
  on('btn-save-reflect', saveReflection);
  on('btn-start-another', function () { location.reload(); });
})();
})();
