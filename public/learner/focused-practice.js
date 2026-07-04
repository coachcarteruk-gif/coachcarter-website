(function () {
  'use strict';

/* ── State ── */
var AUTH;
var selectedAreas = []; // array of supervisor category keys
var suggestedAreas = [];
var competencyData = null;
var skillScores = {};
var timerInterval = null;
var timerSeconds = 0;
var wakeLock = null;
var reflections = {}; // { catKey: { rating, note, dl25Skills } }
var currentDriveOptions = [];
var selectedDrive = null; // null until learner chooses booking or normal drive

var SUP_CATS = CC_COMPETENCY.SUPERVISOR_CATEGORIES;
var PRACTICE_RATINGS = [
  { key: 'nailed', label: 'Went well' },
  { key: 'ok', label: 'Needs practice' },
  { key: 'struggled', label: 'Ask instructor' }
];

/* ── Helpers ── */
function showScreen(id) {
  ['screen-setup', 'screen-drive', 'screen-reflect', 'screen-results'].forEach(function(sid) {
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
  renderDriveChoices();
}

async function loadCompetencyData() {
  try {
    var res = await apiCall('GET', 'competency');
    if (!res.ok) throw new Error('API error');
    competencyData = await res.json();
    buildSkillScores();
    renderSetup();
  } catch (e) {
    console.warn('Failed to load competency data:', e);
    renderSetup();
  }
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

/* ── Screen 1: Setup ── */
function renderSetup() {
  var weakAreas = CC_COMPETENCY.getWeakAreas(skillScores, 3);
  suggestedAreas = weakAreas.map(function(w) { return w.category.key; });

  // Pre-select suggested areas
  selectedAreas = suggestedAreas.slice();

  // Render suggested
  var sugContainer = document.getElementById('suggested-areas');
  if (weakAreas.length > 0 && weakAreas[0].score > 0) {
    sugContainer.innerHTML = weakAreas.map(function(w) {
      return renderAreaPick(w.category, w.score, selectedAreas.indexOf(w.category.key) >= 0);
    }).join('');
  } else {
    // No data — show all areas instead
    document.getElementById('suggested-section').classList.add('hidden');
    document.getElementById('browse-toggle').classList.add('hidden');
    document.getElementById('all-areas').classList.remove('hidden');
  }

  // Render all areas
  var allContainer = document.getElementById('all-areas');
  allContainer.innerHTML = SUP_CATS.map(function(cat) {
    var catScore = 0;
    var n = 0;
    for (var j = 0; j < cat.dl25Skills.length; j++) {
      var s = skillScores[cat.dl25Skills[j]];
      if (typeof s === 'number') { catScore += s; n++; }
    }
    var avg = n > 0 ? Math.round(catScore / n) : 0;
    return renderAreaPick(cat, avg, selectedAreas.indexOf(cat.key) >= 0);
  }).join('');

  updatePickCount();
  updateFocusGuides();
  renderSelectedDriveSummary();
}

function renderDriveChoices() {
  var container = document.getElementById('drive-choices');
  if (!container) return;

  var html = '';
  if (currentDriveOptions.length > 0) {
    html += currentDriveOptions.map(function(booking) {
      var selected = selectedDrive && selectedDrive.kind === 'booking' && String(selectedDrive.booking.id) === String(booking.id);
      var title = booking.lesson_type_name || 'Booked lesson';
      var meta = formatBookingTime(booking);
      if (booking.instructor_name) meta += ' with ' + booking.instructor_name;
      return '<button type="button" class="drive-choice' + (selected ? ' selected' : '') + '" data-action="select-drive-booking" data-booking-id="' + escHtml(booking.id) + '">' +
        '<span class="drive-choice-icon">BK</span>' +
        '<span><span class="drive-choice-title">' + escHtml(title) + '</span>' +
        '<span class="drive-choice-meta">' + escHtml(meta) + '</span></span>' +
        '<span class="drive-choice-tag">Booked</span>' +
      '</button>';
    }).join('');
  }

  var normalSelected = selectedDrive && selectedDrive.kind === 'normal';
  html += '<button type="button" class="drive-choice' + (normalSelected ? ' selected' : '') + '" data-action="select-drive-normal">' +
    '<span class="drive-choice-icon">DR</span>' +
    '<span><span class="drive-choice-title">Normal drive</span>' +
    '<span class="drive-choice-meta">' + (currentDriveOptions.length ? 'Not one of these booked lessons.' : 'No current booked lessons found near now.') + '</span></span>' +
    '<span class="drive-choice-tag">Normal</span>' +
  '</button>';

  container.innerHTML = html;
}

function selectDriveBooking(bookingId) {
  var found = currentDriveOptions.find(function(booking) {
    return String(booking.id) === String(bookingId);
  });
  if (!found) return;
  selectedDrive = { kind: 'booking', booking: found };
  renderDriveChoices();
  renderSelectedDriveSummary();
  document.getElementById('focus-setup-section').classList.remove('hidden');
}

function selectNormalDrive() {
  selectedDrive = { kind: 'normal' };
  renderDriveChoices();
  renderSelectedDriveSummary();
  document.getElementById('focus-setup-section').classList.remove('hidden');
}

function renderSelectedDriveSummary() {
  var el = document.getElementById('selected-drive-summary');
  if (!el || !selectedDrive) return;
  if (selectedDrive.kind === 'booking') {
    var booking = selectedDrive.booking;
    var label = booking.lesson_type_name || 'Booked lesson';
    var meta = formatBookingTime(booking);
    if (booking.instructor_name) meta += ' with ' + booking.instructor_name;
    el.innerHTML = '<h3>Drive selected</h3><p><strong>' + escHtml(label) + '</strong><br>' + escHtml(meta) + '</p>';
  } else {
    el.innerHTML = '<h3>Drive selected</h3><p><strong>Normal drive</strong><br>This will save without linking to a booking.</p>';
  }
}

function renderAreaPick(cat, score, isSelected) {
  var scoreColor = score > 0 ? 'var(--accent)' : 'var(--muted)';
  var scoreBg = 'transparent';
  var scoreText = score > 0 ? 'Suggested' : 'Pick';
  return '<div class="area-pick' + (isSelected ? ' selected' : '') + '" data-action="toggle-area" data-cat="' + cat.key + '">' +
    '<span class="area-pick-icon">' + cat.icon + '</span>' +
    '<div class="area-pick-text">' +
      '<div class="area-pick-name">' + cat.label + '</div>' +
      '<div class="area-pick-desc">' + cat.description + '</div>' +
    '</div>' +
    '<span class="area-pick-score" style="background:' + scoreBg + ';color:' + scoreColor + ';">' + scoreText + '</span>' +
    '<span class="area-pick-check">' + (isSelected ? '\u2713' : '') + '</span>' +
  '</div>';
}

function toggleArea(catKey) {
  var idx = selectedAreas.indexOf(catKey);
  if (idx >= 0) {
    selectedAreas.splice(idx, 1);
  } else if (selectedAreas.length < 3) {
    selectedAreas.push(catKey);
  }
  // Update all pick elements
  document.querySelectorAll('.area-pick').forEach(function(el) {
    var k = el.getAttribute('data-cat');
    var sel = selectedAreas.indexOf(k) >= 0;
    el.classList.toggle('selected', sel);
    el.querySelector('.area-pick-check').textContent = sel ? '\u2713' : '';
  });
  updatePickCount();
  updateFocusGuides();
}

function updatePickCount() {
  document.getElementById('pick-count').textContent = selectedAreas.length + ' of 3 selected';
  document.getElementById('btn-start-practice').disabled = selectedAreas.length === 0;
}

function updateFocusGuides() {
  var container = document.getElementById('focus-guides');
  if (selectedAreas.length === 0) { container.innerHTML = ''; return; }

  var html = '';
  selectedAreas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    if (!cat) return;
    html += '<div class="focus-guide">';
    html += '<h3>' + cat.icon + ' ' + cat.label + ' \u2014 What to focus on</h3>';
    html += '<ul>';
    cat.faultHints.forEach(function(hint) {
      html += '<li>' + hint + '</li>';
    });
    html += '</ul></div>';
  });
  container.innerHTML = html;
}

function toggleBrowseAll() {
  var allEl = document.getElementById('all-areas');
  var btn = document.getElementById('browse-toggle');
  if (allEl.classList.contains('hidden')) {
    allEl.classList.remove('hidden');
    btn.textContent = 'Hide all areas';
  } else {
    allEl.classList.add('hidden');
    btn.textContent = 'Browse all areas';
  }
}

/* ── Screen 2: Driving ── */
function startPractice() {
  if (!selectedDrive) return;
  // Show focus pills
  var pillsHtml = '';
  selectedAreas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    if (cat) pillsHtml += '<span class="focus-pill">' + cat.icon + ' ' + cat.label + '</span>';
  });
  document.getElementById('focus-pills').innerHTML = pillsHtml;

  // Start timer
  timerSeconds = 0;
  document.getElementById('timer-display').textContent = '00:00';
  timerInterval = setInterval(function() {
    timerSeconds++;
    document.getElementById('timer-display').textContent = formatTime(timerSeconds);
  }, 1000);

  // Wake lock
  requestWakeLock();

  if (typeof posthog !== 'undefined') {
    posthog.capture('focused_practice_started', { areas: selectedAreas });
  }

  showScreen('screen-drive');
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* ignore */ }
}

function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch(e) {} wakeLock = null; }
}

/* ── Screen 3: Reflection ── */
function goToReflection() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  var container = document.getElementById('reflect-areas');
  var html = '';

  selectedAreas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    if (!cat) return;
    reflections[catKey] = { rating: null, what: '', where: '', instructor: '', note: '', dl25Skills: cat.dl25Skills };

    html += '<div class="reflect-area" data-cat="' + catKey + '">';
    html += '<div class="reflect-area-header">';
    html += '<span class="reflect-area-icon">' + cat.icon + '</span>';
    html += '<span class="reflect-area-q">' + cat.reflectionQ + '</span>';
    html += '</div>';
    html += '<div class="reflect-btns">';
    PRACTICE_RATINGS.forEach(function(r) {
      html += '<button class="reflect-btn" data-action="set-reflection" data-cat="' + catKey + '" data-rating="' + r.key + '">' + r.label + '</button>';
    });
    html += '</div>';
    html += '<div class="reflect-note-grid">';
    html += '<input class="reflect-note" data-action="set-reflection-note" data-note-field="what" data-cat="' + catKey + '" placeholder="What happened? (optional)" maxlength="160">';
    html += '<input class="reflect-note" data-action="set-reflection-note" data-note-field="where" data-cat="' + catKey + '" placeholder="Where? (optional)" maxlength="120">';
    html += '<textarea class="reflect-note reflect-note-wide" data-action="set-reflection-note" data-note-field="instructor" data-cat="' + catKey + '" placeholder="What should your instructor know? (optional)" maxlength="260"></textarea>';
    html += '</div>';
    html += '</div>';
  });

  container.innerHTML = html;
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

  releaseWakeLock();

  // Build API payload keyed by the skill_key expected by the existing endpoint.
  var apiReflections = {};
  for (var catKey in reflections) {
    var r = reflections[catKey];
    for (var i = 0; i < r.dl25Skills.length; i++) {
      apiReflections[r.dl25Skills[i]] = { rating: r.rating, note: r.note };
    }
  }

  try {
    var durationMinutes = Math.ceil(timerSeconds / 60);
    var payload = {
      focus_areas: selectedAreas,
      suggested_areas: suggestedAreas,
      duration_minutes: durationMinutes,
      reflections: apiReflections,
      session_date: new Date().toISOString().slice(0, 10),
      session_type: 'focused_practice'
    };
    if (selectedDrive && selectedDrive.kind === 'booking') {
      payload.booking_id = selectedDrive.booking.id;
      payload.session_date = selectedDrive.booking.scheduled_date;
      payload.session_type = 'instructor';
      payload.duration_minutes = selectedDrive.booking.duration_minutes || durationMinutes;
      payload.notes = selectedDriveNotes();
    }
    await apiCall('POST', 'focused-practice', payload);
  } catch (e) {
    console.warn('Failed to save practice session:', e);
  }

  if (typeof posthog !== 'undefined') {
    posthog.capture('focused_practice_completed', {
      areas: selectedAreas,
      duration_minutes: Math.ceil(timerSeconds / 60)
    });
  }

  showResultsScreen();
}

function showResultsScreen() {
  var durationMin = selectedDrive && selectedDrive.kind === 'booking' && selectedDrive.booking.duration_minutes
    ? selectedDrive.booking.duration_minutes
    : Math.ceil(timerSeconds / 60);
  var driveLabel = selectedDrive && selectedDrive.kind === 'booking'
    ? 'booked lesson'
    : 'normal drive';
  document.getElementById('results-subtitle').textContent =
    durationMin + ' minute' + (durationMin !== 1 ? 's' : '') + ' ' + driveLabel + ' completed. Saved to your driving plan.';

  var cardsHtml = '';
  var needsWork = [];
  var tellInstructor = [];

  selectedAreas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    var r = reflections[catKey];
    if (!cat || !r) return;

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
  } else {
    nextHtml += '<p>Great drive. Pick a new focus area next time, or open your driving plan to see what else is worth practising.</p>';
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
  if (action === 'toggle-area') toggleArea(target.dataset.cat);
  else if (action === 'set-reflection') setReflection(target.dataset.cat, target.dataset.rating);
  else if (action === 'select-drive-booking') selectDriveBooking(target.dataset.bookingId);
  else if (action === 'select-drive-normal') selectNormalDrive();
});
document.addEventListener('input', function (e) {
  var target = e.target.closest('[data-action="set-reflection-note"]');
  if (target) setReflectionNote(target.dataset.cat, target.dataset.noteField, target.value);
});
// ── Static handlers previously inline in HTML ──
(function wire() {
  var browseToggle = document.getElementById('browse-toggle');
  if (browseToggle) browseToggle.addEventListener('click', toggleBrowseAll);
  var startBtn = document.getElementById('btn-start-practice');
  if (startBtn) startBtn.addEventListener('click', startPractice);
  var reflectBtn = document.getElementById('btn-reflect');
  if (reflectBtn) reflectBtn.addEventListener('click', goToReflection);
  var endEarlyBtn = document.getElementById('btn-end-early');
  if (endEarlyBtn) endEarlyBtn.addEventListener('click', goToReflection);
  var saveReflectBtn = document.getElementById('btn-save-reflect');
  if (saveReflectBtn) saveReflectBtn.addEventListener('click', saveReflection);
  var startAnotherBtn = document.getElementById('btn-start-another');
  if (startAnotherBtn) startAnotherBtn.addEventListener('click', function () { location.reload(); });
})();
})();
