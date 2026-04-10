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

var SUP_CATS = CC_COMPETENCY.SUPERVISOR_CATEGORIES;
var RATINGS = CC_COMPETENCY.RATINGS;

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

/* ── Init ── */
window.addEventListener('DOMContentLoaded', async function() {
  AUTH = ccAuth.getAuth();
  if (!AUTH) {
    window.location.href = '/learner/login.html?redirect=/learner/focused-practice.html';
    return;
  }
  await loadCompetencyData();
});

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

  // Build per-skill readiness
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
}

function renderAreaPick(cat, score, isSelected) {
  var scoreColor = score >= 70 ? '#166534' : score >= 40 ? '#b45309' : '#dc2626';
  var scoreBg = score >= 70 ? '#dcfce7' : score >= 40 ? '#fffbeb' : 'var(--red-lt)';
  var scoreText = score > 0 ? score + '%' : 'New';
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
    reflections[catKey] = { rating: null, note: '', dl25Skills: cat.dl25Skills };

    html += '<div class="reflect-area" data-cat="' + catKey + '">';
    html += '<div class="reflect-area-header">';
    html += '<span class="reflect-area-icon">' + cat.icon + '</span>';
    html += '<span class="reflect-area-q">' + cat.reflectionQ + '</span>';
    html += '</div>';
    html += '<div class="reflect-btns">';
    RATINGS.forEach(function(r) {
      html += '<button class="reflect-btn" data-action="set-reflection" data-cat="' + catKey + '" data-rating="' + r.key + '">' + r.label + '</button>';
    });
    html += '</div>';
    html += '<textarea class="reflect-note" data-action="set-reflection-note" data-cat="' + catKey + '" placeholder="Optional notes..."></textarea>';
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

function setReflectionNote(catKey, note) {
  if (reflections[catKey]) reflections[catKey].note = note;
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

  // Build API payload — reflections keyed by DL25 skill_key
  var apiReflections = {};
  for (var catKey in reflections) {
    var r = reflections[catKey];
    for (var i = 0; i < r.dl25Skills.length; i++) {
      apiReflections[r.dl25Skills[i]] = { rating: r.rating, note: r.note };
    }
  }

  try {
    await apiCall('POST', 'focused-practice', {
      focus_areas: selectedAreas,
      suggested_areas: suggestedAreas,
      duration_minutes: Math.ceil(timerSeconds / 60),
      reflections: apiReflections
    });
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
  var durationMin = Math.ceil(timerSeconds / 60);
  document.getElementById('results-subtitle').textContent =
    durationMin + ' minute' + (durationMin !== 1 ? 's' : '') + ' of focused practice completed.';

  var cardsHtml = '';
  var needsWork = [];

  selectedAreas.forEach(function(catKey) {
    var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
    var r = reflections[catKey];
    if (!cat || !r) return;

    var ratingObj = RATINGS.find(function(rt) { return rt.key === r.rating; });
    var ratingLabel = ratingObj ? ratingObj.label : r.rating;
    var badgeClass = r.rating;

    cardsHtml += '<div class="result-area-card">';
    cardsHtml += '<div class="result-area-header">';
    cardsHtml += '<span style="font-size:1.1rem;">' + cat.icon + '</span>';
    cardsHtml += '<span class="result-area-name">' + cat.label + '</span>';
    cardsHtml += '<span class="result-area-badge ' + badgeClass + '">' + ratingLabel + '</span>';
    cardsHtml += '</div>';
    if (r.note) {
      cardsHtml += '<div class="result-area-note">"' + r.note + '"</div>';
    }
    cardsHtml += '</div>';

    if (r.rating === 'struggled') needsWork.push(cat.label);
  });

  document.getElementById('result-cards').innerHTML = cardsHtml;

  // Next steps suggestion
  var nextHtml = '<div class="result-next">';
  nextHtml += '<h3>What next?</h3>';
  if (needsWork.length > 0) {
    nextHtml += '<p>Keep practising <strong>' + needsWork.join(', ') + '</strong> \u2014 try another focused session on ' + (needsWork.length === 1 ? 'this area' : 'these areas') + ', or take a mock test to see how you\'d do overall.</p>';
  } else {
    nextHtml += '<p>Great session! Consider trying a mock test to see how you perform across all areas, or pick some new areas to focus on.</p>';
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
});
document.addEventListener('input', function (e) {
  var target = e.target.closest('[data-action="set-reflection-note"]');
  if (target) setReflectionNote(target.dataset.cat, target.value);
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
