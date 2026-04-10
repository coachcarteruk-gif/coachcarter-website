(function () {
  'use strict';

/* ── State ── */
let AUTH;
let mockTestId = null;
let testMode = null; // 'supervisor' or 'instructor'
let currentPart = 0; // 0-indexed internally
let timerInterval = null;
let timerSeconds = 0;
let isDriving = false;
let partTimes = [0]; // elapsed seconds per part (grows dynamically)
let partFaults = [{}]; // per-part: { skill_key: { driving, serious, dangerous } } (instructor) or { catKey: rating } (supervisor)
let supervisorRatings = [{}]; // per-part: { catKey: 'good'|'needs_work'|'concern' }
let longPressTimer = null;

// Route selection
let selectedRoute = null;
let selectedCentre = null;

// GPS tracking
let gpsTrack = [];
let gpsWatchId = null;

// Wake Lock
let wakeLock = null;

// Fault map
let faultMap = null;
let routePolyline = null;
let placedFaultMarkers = [];
let pendingFaultPlacement = null;

const AREAS = CC_COMPETENCY.AREAS;
const SKILLS = CC_COMPETENCY.SKILLS;
const FAULT_TYPES = CC_COMPETENCY.FAULT_TYPES;
const MOCK_TEST = CC_COMPETENCY.MOCK_TEST;

/* ── Auth ── */
window.addEventListener('DOMContentLoaded', () => {
  AUTH = ccAuth.getAuth();
  if (!AUTH || !AUTH.token) {
    window.location.href = '/learner/login.html?redirect=/learner/mock-test.html';
    return;
  }
});

/* ── Helpers ── */
function formatTime(seconds) {
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function showScreen(id) {
  ['screen-mode', 'screen-start', 'screen-route', 'screen-part', 'screen-faults', 'screen-results', 'screen-map'].forEach(function(sid) {
    document.getElementById(sid).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicator(activeStep) {
  var numEl = document.getElementById('step-current');
  var labelEl = document.getElementById('step-label');
  var endItem = document.querySelector('.step-item[data-step="end"]');
  if (numEl) numEl.textContent = activeStep;
  if (labelEl) labelEl.textContent = 'Part ' + activeStep;
  if (endItem) {
    endItem.classList.remove('active');
    if (activeStep === 'done') endItem.classList.add('active');
  }
}

function apiCall(method, action, body) {
  var opts = {
    method: method,
    headers: {
      'Content-Type': 'application/json'}
  };
  if (body) opts.body = JSON.stringify(body);
  return ccAuth.fetchAuthed('/api/learner?action=' + action, opts);
}

/* ── Screen 0: Mode Selection ── */
function selectMode(mode) {
  testMode = mode;

  // Update warning box text based on mode
  var warningBox = document.querySelector('.warning-box');
  if (mode === 'supervisor') {
    warningBox.innerHTML = '<strong>&#9888;&#65039; IMPORTANT</strong>' +
      'Mobile phones must not be used while driving. The supervising driver should observe during the drive, then pull over to record ratings.';
    document.querySelector('.start-desc').textContent =
      'Drive in 10-minute sections. After each section, pull over and your supervising driver will rate how you did across 7 key areas. Simple, clear, and no exam jargon.';
  } else {
    warningBox.innerHTML = '<strong>&#9888;&#65039; IMPORTANT</strong>' +
      'Mobile phones must not be used by the driver or supervising driver during this test. Pull over safely at each 10-minute interval to record faults.';
    document.querySelector('.start-desc').textContent =
      'This mock test mirrors the real DVSA practical test. Drive in 10-minute sections, stopping briefly between each to record any faults. You can end the test at any point or continue for as many sections as you need.';
  }
  showScreen('screen-start');
}

/* ── Screen 1: Begin ── */
async function beginMockTest() {
  var btn = document.getElementById('btn-begin');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    var payload = { mode: testMode };
    if (selectedRoute) payload.route_id = selectedRoute.id;
    var res = await apiCall('POST', 'mock-tests', payload);
    if (!res.ok) throw new Error('API error ' + res.status);
    var data = await res.json();
    mockTestId = data.mock_test_id;
  } catch (e) {
    console.warn('Failed to create mock test via API, continuing offline:', e);
    mockTestId = 'local_' + Date.now();
  }

  if (typeof posthog !== 'undefined') {
    posthog.capture('mock_test_started', { mock_test_id: mockTestId });
  }

  currentPart = 0;
  partTimes = [0];
  partFaults = [{}];
  supervisorRatings = [{}];
  showPartScreen();
}

/* ── Screen 2: Part Start ── */
function showPartScreen() {
  var partDef = MOCK_TEST.parts[currentPart % MOCK_TEST.parts.length];

  updateStepIndicator(currentPart + 1);

  document.getElementById('part-label').textContent = 'PART ' + (currentPart + 1);
  document.getElementById('part-title').textContent = partDef.label;
  document.getElementById('part-desc').textContent = partDef.description;
  document.getElementById('timer-display').textContent = '00:00';
  document.getElementById('timer-label').textContent = 'Tap "Start Driving" to begin';

  var btnStart = document.getElementById('btn-start-drive');
  var btnPull = document.getElementById('btn-pull-over');
  btnStart.classList.remove('hidden');
  btnStart.disabled = false;
  btnPull.classList.add('hidden');
  btnPull.disabled = true;

  isDriving = false;
  timerSeconds = 0;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  showScreen('screen-part');
}

async function startDriving() {
  // Request location permission before starting
  if (navigator.geolocation) {
    try {
      if (navigator.permissions) {
        var perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'prompt') {
          // Trigger the permission dialog by requesting a single position
          await new Promise(function(resolve) {
            navigator.geolocation.getCurrentPosition(resolve, resolve, { timeout: 5000 });
          });
        }
      } else {
        // Fallback: just request a position to trigger the prompt
        await new Promise(function(resolve) {
          navigator.geolocation.getCurrentPosition(resolve, resolve, { timeout: 5000 });
        });
      }
    } catch(e) { /* permission denied or unavailable — continue without GPS */ }
  }

  isDriving = true;
  timerSeconds = 0;

  var btnStart = document.getElementById('btn-start-drive');
  var btnPull = document.getElementById('btn-pull-over');
  btnStart.classList.add('hidden');
  btnPull.classList.remove('hidden');
  btnPull.disabled = false;

  document.getElementById('timer-label').textContent = 'Driving...';

  startGpsTracking();
  requestWakeLock();

  timerInterval = setInterval(function() {
    timerSeconds++;
    document.getElementById('timer-display').textContent = formatTime(timerSeconds);
  }, 1000);
}

function pullOver() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  isDriving = false;
  stopGpsTracking();
  partTimes[currentPart] = timerSeconds;
  showFaultScreen();
}

/* ── Screen 3: Fault Recording ── */
function showFaultScreen() {
  document.getElementById('fault-time').textContent = formatTime(partTimes[currentPart]) + ' driven';

  if (testMode === 'supervisor') {
    document.getElementById('fault-title').textContent = 'Rate Performance \u2014 Part ' + (currentPart + 1);
    document.querySelector('.fault-subtitle').textContent = 'Rate each area based on what you observed. Tap a category to expand it.';
    // Initialize supervisor ratings for this part if empty
    if (!supervisorRatings[currentPart] || Object.keys(supervisorRatings[currentPart]).length === 0) {
      supervisorRatings[currentPart] = {};
    }
    renderSupervisorFaults();
    updateSupervisorTotals();
  } else {
    document.getElementById('fault-title').textContent = 'Record Faults \u2014 Part ' + (currentPart + 1);
    document.querySelector('.fault-subtitle').textContent = 'Tap a counter to add a fault. Long-press to reset to 0.';
    // Initialize fault data for this part if empty
    if (Object.keys(partFaults[currentPart]).length === 0) {
      SKILLS.forEach(function(skill) {
        var entry = { driving: 0, serious: 0, dangerous: 0 };
        if (skill.subs) {
          entry.subs = {};
          skill.subs.forEach(function(sub) {
            entry.subs[sub.key] = { driving: 0, serious: 0, dangerous: 0 };
          });
        }
        partFaults[currentPart][skill.key] = entry;
      });
    }
    renderFaultAreas();
    updateFaultTotals();
  }
  showScreen('screen-faults');
}

function renderFaultAreas() {
  var container = document.getElementById('fault-areas');
  var html = '';

  AREAS.forEach(function(area) {
    var skills = CC_COMPETENCY.getSkillsByArea(area.id);
    var areaFaultCount = 0;
    skills.forEach(function(skill) {
      var f = partFaults[currentPart][skill.key];
      areaFaultCount += f.driving + f.serious + f.dangerous;
    });

    html += '<div class="area-group" data-area="' + area.id + '">';
    html += '<button class="area-header" data-action="toggle-area">';
    html += '<span class="area-icon">' + area.icon + '</span>';
    html += '<span class="area-label">' + area.label + '</span>';
    html += '<span class="area-count' + (areaFaultCount > 0 ? ' has-faults' : '') + '" data-area-count="' + area.id + '">' + areaFaultCount + '</span>';
    html += '<span class="area-chevron">&#9660;</span>';
    html += '</button>';
    html += '<div class="area-body"><div class="area-body-inner">';

    skills.forEach(function(skill) {
      var f = partFaults[currentPart][skill.key];
      var hasSubs = skill.subs && skill.subs.length > 0;

      // Parent skill row
      html += '<div class="skill-row' + (hasSubs ? ' has-subs' : '') + '"' + (hasSubs ? ' data-action="toggle-subs" data-skill="' + skill.key + '"' : '') + '>';
      html += '<div class="skill-name">' + skill.label + '</div>';
      html += '<div class="fault-counters"' + (hasSubs ? ' data-stop-propagation="1"' : '') + '>';

      FAULT_TYPES.forEach(function(ft) {
        // Parent total = direct faults + all sub faults
        var val = f[ft.key];
        if (hasSubs && f.subs) {
          Object.keys(f.subs).forEach(function(sk) { val += f.subs[sk][ft.key]; });
        }
        html += '<div class="fault-counter' + (val > 0 ? ' has-val' : '') + '" data-type="' + ft.key + '" data-skill="' + skill.key + '"';
        html += ' data-action="fault-counter"';
        html += ' role="button" aria-label="' + skill.label + ' ' + ft.label + ': ' + val + '">';
        html += '<span class="fc-type">' + ft.shortLabel + '</span>';
        html += '<span class="fc-val">' + val + '</span>';
        html += '</div>';
      });

      html += '</div>';
      html += '</div>';

      // Subcategory rows (hidden by default)
      if (hasSubs) {
        html += '<div class="subs-container" id="subs-' + skill.key + '">';
        skill.subs.forEach(function(sub) {
          var sf = f.subs ? f.subs[sub.key] : { driving: 0, serious: 0, dangerous: 0 };
          html += '<div class="sub-row">';
          html += '<div class="skill-name">' + sub.label + '</div>';
          html += '<div class="fault-counters">';

          FAULT_TYPES.forEach(function(ft) {
            var sval = sf[ft.key];
            html += '<div class="fault-counter' + (sval > 0 ? ' has-val' : '') + '" data-type="' + ft.key + '" data-skill="' + skill.key + '" data-sub="' + sub.key + '"';
            html += ' data-action="fault-counter"';
            html += ' role="button" aria-label="' + sub.label + ' ' + ft.label + ': ' + sval + '">';
            html += '<span class="fc-type">' + ft.shortLabel + '</span>';
            html += '<span class="fc-val">' + sval + '</span>';
            html += '</div>';
          });

          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
    });

    html += '</div></div></div>';
  });

  container.innerHTML = html;
}

function toggleArea(btn) {
  var group = btn.parentElement;
  group.classList.toggle('open');
}

/* ── Supervisor Fault Recording ── */
var SUP_CATS = CC_COMPETENCY.SUPERVISOR_CATEGORIES;
var SUP_RATINGS = CC_COMPETENCY.SUPERVISOR_RATINGS;

function renderSupervisorFaults() {
  var container = document.getElementById('fault-areas');
  var html = '';
  var ratings = supervisorRatings[currentPart];

  for (var i = 0; i < SUP_CATS.length; i++) {
    var cat = SUP_CATS[i];
    var currentRating = ratings[cat.key] || null;
    var badgeClass = currentRating ? 'rated-' + currentRating : '';
    var badgeText = currentRating ? SUP_RATINGS.find(function(r){ return r.key === currentRating; }).label : 'Not rated';

    html += '<div class="sup-category' + (currentRating ? '' : ' open') + '" data-cat="' + cat.key + '">';
    html += '<div class="sup-category-card">';
    html += '<div class="sup-category-header" data-action="toggle-sup-category">';
    html += '<span class="area-icon">' + cat.icon + '</span>';
    html += '<span class="area-label">' + cat.label + '</span>';
    html += '<span class="sup-category-badge ' + badgeClass + '">' + badgeText + '</span>';
    html += '</div>';

    html += '<div class="sup-category-body"><div class="sup-category-body-inner">';
    html += '<p class="sup-desc">' + cat.description + '</p>';
    html += '<ul class="sup-hints">';
    for (var h = 0; h < cat.faultHints.length; h++) {
      html += '<li>' + cat.faultHints[h] + '</li>';
    }
    html += '</ul>';

    html += '<div class="sup-rating-btns">';
    for (var r = 0; r < SUP_RATINGS.length; r++) {
      var rt = SUP_RATINGS[r];
      var selected = currentRating === rt.key ? ' selected-' + rt.key : '';
      html += '<button class="sup-rating-btn' + selected + '" data-action="rate-sup-cat" data-cat="' + cat.key + '" data-rating="' + rt.key + '">' + rt.label + '</button>';
    }
    html += '</div>';

    html += '</div></div>';
    html += '</div></div>';
  }

  container.innerHTML = html;
}

function toggleSupCategory(header) {
  var cat = header.closest('.sup-category');
  cat.classList.toggle('open');
}

function rateSupervisorCategory(catKey, rating) {
  supervisorRatings[currentPart][catKey] = rating;
  renderSupervisorFaults();
  updateSupervisorTotals();
}

function updateSupervisorTotals() {
  var ratings = supervisorRatings[currentPart];
  var good = 0, needsWork = 0, concern = 0;
  for (var key in ratings) {
    if (ratings[key] === 'good') good++;
    else if (ratings[key] === 'needs_work') needsWork++;
    else if (ratings[key] === 'concern') concern++;
  }
  var total = good + needsWork + concern;
  var html = '<span class="ft-pill" style="background:#dcfce7;color:#166534;">' + good + ' went well</span>';
  html += '<span class="ft-pill" style="background:#fffbeb;color:#b45309;">' + needsWork + ' needs work</span>';
  html += '<span class="ft-pill" style="background:var(--red-lt);color:#dc2626;">' + concern + ' concern</span>';
  document.getElementById('fault-total-pills').innerHTML = html;

  // Enable save button once at least one category is rated
  var btn = document.getElementById('btn-save-faults');
  btn.disabled = total === 0;
  btn.textContent = total < SUP_CATS.length ? 'Save Ratings (' + total + '/' + SUP_CATS.length + ')' : 'Save Ratings';
}

function toggleSubs(skillKey) {
  var container = document.getElementById('subs-' + skillKey);
  if (!container) return;
  container.classList.toggle('expanded');
  // Toggle chevron on parent row
  var row = container.previousElementSibling;
  if (row) row.classList.toggle('subs-open');
}

/* Fault counter touch/click */
function fcDown(el) {
  longPressTimer = setTimeout(function() {
    // Long press: reset to 0
    var skillKey = el.getAttribute('data-skill');
    var type = el.getAttribute('data-type');
    var subKey = el.getAttribute('data-sub');

    if (subKey) {
      partFaults[currentPart][skillKey].subs[subKey][type] = 0;
    } else {
      partFaults[currentPart][skillKey][type] = 0;
    }
    el.querySelector('.fc-val').textContent = '0';
    el.classList.remove('has-val');
    el.setAttribute('aria-label', getAriaLabel(skillKey, type, 0, subKey));
    if (subKey) refreshParentCounters(skillKey);
    updateAreaCount(skillKey);
    updateFaultTotals();
    longPressTimer = null;
  }, 500);
}

function fcUp(el) {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    // Short tap: increment
    var skillKey = el.getAttribute('data-skill');
    var type = el.getAttribute('data-type');
    var subKey = el.getAttribute('data-sub');

    if (subKey) {
      partFaults[currentPart][skillKey].subs[subKey][type]++;
      var val = partFaults[currentPart][skillKey].subs[subKey][type];
      el.querySelector('.fc-val').textContent = val;
      if (val > 0) el.classList.add('has-val');
      el.setAttribute('aria-label', getAriaLabel(skillKey, type, val, subKey));
      refreshParentCounters(skillKey);
    } else {
      partFaults[currentPart][skillKey][type]++;
      var val = partFaults[currentPart][skillKey][type];
      el.querySelector('.fc-val').textContent = val;
      if (val > 0) el.classList.add('has-val');
      el.setAttribute('aria-label', getAriaLabel(skillKey, type, val));
    }
    updateAreaCount(skillKey);
    updateFaultTotals();
  }
}

/** Refresh parent row counters to show totals (direct + sub faults) */
function refreshParentCounters(skillKey) {
  var f = partFaults[currentPart][skillKey];
  var skill = CC_COMPETENCY.getSkill(skillKey);
  if (!skill || !skill.subs) return;

  FAULT_TYPES.forEach(function(ft) {
    var total = f[ft.key];
    if (f.subs) {
      Object.keys(f.subs).forEach(function(sk) { total += f.subs[sk][ft.key]; });
    }
    var parentEl = document.querySelector('.skill-row.has-subs .fault-counter[data-skill="' + skillKey + '"][data-type="' + ft.key + '"]:not([data-sub])');
    if (parentEl) {
      parentEl.querySelector('.fc-val').textContent = total;
      if (total > 0) parentEl.classList.add('has-val');
      else parentEl.classList.remove('has-val');
    }
  });
}

function fcCancel(el) {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function getAriaLabel(skillKey, type, val, subKey) {
  var skill = CC_COMPETENCY.getSkill(skillKey);
  var ft = FAULT_TYPES.find(function(f) { return f.key === type; });
  var label = skill ? skill.label : skillKey;
  if (subKey && skill && skill.subs) {
    var sub = skill.subs.find(function(s) { return s.key === subKey; });
    if (sub) label = skill.label + ' — ' + sub.label;
  }
  return label + ' ' + (ft ? ft.label : type) + ': ' + val;
}

function updateAreaCount(skillKey) {
  var skill = CC_COMPETENCY.getSkill(skillKey);
  if (!skill) return;
  var areaId = skill.area;
  var skills = CC_COMPETENCY.getSkillsByArea(areaId);
  var total = 0;
  skills.forEach(function(s) {
    var f = partFaults[currentPart][s.key];
    total += f.driving + f.serious + f.dangerous;
    // Include sub faults
    if (f.subs) {
      Object.keys(f.subs).forEach(function(sk) {
        var sf = f.subs[sk];
        total += sf.driving + sf.serious + sf.dangerous;
      });
    }
  });
  var badge = document.querySelector('[data-area-count="' + areaId + '"]');
  if (badge) {
    badge.textContent = total;
    if (total > 0) badge.classList.add('has-faults');
    else badge.classList.remove('has-faults');
  }
}

function updateFaultTotals() {
  var totals = { driving: 0, serious: 0, dangerous: 0 };
  var faults = partFaults[currentPart];
  Object.keys(faults).forEach(function(key) {
    totals.driving += faults[key].driving;
    totals.serious += faults[key].serious;
    totals.dangerous += faults[key].dangerous;
    // Include sub faults
    if (faults[key].subs) {
      Object.keys(faults[key].subs).forEach(function(sk) {
        var sf = faults[key].subs[sk];
        totals.driving += sf.driving;
        totals.serious += sf.serious;
        totals.dangerous += sf.dangerous;
      });
    }
  });

  var html = '<span class="ft-pill driving">' + totals.driving + ' driving</span>';
  html += '<span class="ft-pill serious">' + totals.serious + ' serious</span>';
  html += '<span class="ft-pill dangerous">' + totals.dangerous + ' dangerous</span>';
  document.getElementById('fault-total-pills').innerHTML = html;
}

async function saveFaults() {
  var btn = document.getElementById('btn-save-faults');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  var faultArray = [];

  if (testMode === 'supervisor') {
    // Build supervisor fault array — one entry per DL25 skill mapped from each rated category
    var ratings = supervisorRatings[currentPart];
    Object.keys(ratings).forEach(function(catKey) {
      var cat = CC_COMPETENCY.getSupervisorCategory(catKey);
      if (!cat) return;
      for (var i = 0; i < cat.dl25Skills.length; i++) {
        faultArray.push({
          skill_key: cat.dl25Skills[i],
          sub_key: null,
          driving: 0, serious: 0, dangerous: 0,
          supervisor_rating: ratings[catKey]
        });
      }
    });
  } else {
    // Build instructor fault array (only non-zero), including sub_key for subcategory faults
    var faults = partFaults[currentPart];
    Object.keys(faults).forEach(function(key) {
      var f = faults[key];
      if (f.driving > 0 || f.serious > 0 || f.dangerous > 0) {
        faultArray.push({ skill_key: key, sub_key: null, driving: f.driving, serious: f.serious, dangerous: f.dangerous });
      }
      if (f.subs) {
        Object.keys(f.subs).forEach(function(sk) {
          var sf = f.subs[sk];
          if (sf.driving > 0 || sf.serious > 0 || sf.dangerous > 0) {
            faultArray.push({ skill_key: key, sub_key: sk, driving: sf.driving, serious: sf.serious, dangerous: sf.dangerous });
          }
        });
      }
    });
  }

  // POST faults
  try {
    await apiCall('POST', 'mock-test-faults', {
      mock_test_id: mockTestId,
      part: currentPart + 1,
      faults: faultArray
    });
  } catch (e) {
    console.warn('Failed to save faults:', e);
  }

  if (typeof posthog !== 'undefined') {
    posthog.capture('mock_test_part_recorded', {
      mock_test_id: mockTestId,
      part: currentPart + 1,
      fault_count: faultArray.length,
      mode: testMode
    });
  }

  // Show inline choice: continue or end
  btn.textContent = 'Saved';
  btn.classList.add('hidden');
  var choiceDiv = document.getElementById('post-save-choice');
  choiceDiv.classList.remove('hidden');
  choiceDiv.scrollIntoView({ behavior: 'smooth' });
}

function continueToNextPart() {
  // Hide choice, reset save button
  document.getElementById('post-save-choice').classList.add('hidden');
  var btn = document.getElementById('btn-save-faults');
  btn.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Save Faults';

  // Add new part
  currentPart++;
  partFaults.push({});
  supervisorRatings.push({});
  partTimes.push(0);
  showPartScreen();
}

async function endMockTest() {
  // Hide choice
  document.getElementById('post-save-choice').classList.add('hidden');

  try {
    await apiCall('POST', 'mock-tests', { mock_test_id: mockTestId, complete: true });
  } catch (e) {
    console.warn('Failed to complete mock test:', e);
  }

  // Reset save button for next time
  var btn = document.getElementById('btn-save-faults');
  btn.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Save Faults';

  showResults();
}

/* ── Screen 4: Results ── */
function showResults() {
  updateStepIndicator('done');

  if (testMode === 'supervisor') {
    showSupervisorResults();
  } else {
    showInstructorResults();
  }

  // Show map button if GPS data was recorded OR a route was selected
  if (gpsTrack.length > 0 || selectedRoute) {
    document.getElementById('btn-show-map').classList.remove('hidden');
  }

  showScreen('screen-results');
}

function showSupervisorResults() {
  // Aggregate all ratings across parts — take the worst rating per category
  var allRatings = {};
  var ratingPriority = { concern: 0, needs_work: 1, good: 2 };

  for (var p = 0; p < supervisorRatings.length; p++) {
    var ratings = supervisorRatings[p];
    for (var catKey in ratings) {
      if (!allRatings[catKey] || ratingPriority[ratings[catKey]] < ratingPriority[allRatings[catKey]]) {
        allRatings[catKey] = ratings[catKey];
      }
    }
  }

  // Count ratings
  var good = 0, needsWork = 0, concern = 0;
  for (var key in allRatings) {
    if (allRatings[key] === 'good') good++;
    else if (allRatings[key] === 'needs_work') needsWork++;
    else if (allRatings[key] === 'concern') concern++;
  }

  // Generate confidence message (no pass/fail)
  var badge = document.getElementById('result-badge');
  var message, subMessage;
  if (concern === 0 && needsWork <= 1) {
    badge.textContent = '\u2B50';
    badge.className = 'result-badge pass';
    message = 'Looking strong!';
    subMessage = needsWork === 0
      ? 'Great drive \u2014 all areas went well. Keep this up!'
      : 'Nearly there \u2014 just one area to polish before test day.';
  } else if (concern === 0) {
    badge.textContent = '\uD83D\uDCAA';
    badge.className = 'result-badge';
    badge.style.background = '#f59e0b';
    message = 'Good progress, some areas to work on';
    subMessage = needsWork + ' area' + (needsWork !== 1 ? 's' : '') + ' need' + (needsWork === 1 ? 's' : '') + ' more practice. Focus on these in your next session.';
  } else {
    badge.textContent = '\uD83D\uDCDD';
    badge.className = 'result-badge fail';
    message = 'A few areas to work on before test day';
    subMessage = concern + ' area' + (concern !== 1 ? 's' : '') + ' of concern and ' + needsWork + ' needing work. Don\u2019t worry \u2014 this is what practice is for!';
  }

  // Hide the pass/fail criteria text
  document.querySelector('.result-criteria').textContent = '';

  // Build summary instead of fault totals
  var totalsHtml = '<div class="sup-result-summary">';
  totalsHtml += '<div class="sup-result-message">' + message + '</div>';
  totalsHtml += '<div class="sup-result-sub">' + subMessage + '</div>';
  totalsHtml += '</div>';
  document.getElementById('result-totals').innerHTML = totalsHtml;

  // Rating pills
  var pillsHtml = '';
  for (var i = 0; i < SUP_CATS.length; i++) {
    var cat = SUP_CATS[i];
    var rating = allRatings[cat.key];
    if (!rating) continue;
    var rLabel = SUP_RATINGS.find(function(r){ return r.key === rating; }).label;
    pillsHtml += '<span class="sup-result-pill ' + rating + '">' + cat.icon + ' ' + cat.label + ' \u2014 ' + rLabel + '</span>';
  }

  // Show concerns first, then needs_work, then good
  var sSection = document.getElementById('result-serious-section');
  var concerns = [], needsWorkList = [];
  for (var c = 0; c < SUP_CATS.length; c++) {
    var ct = SUP_CATS[c];
    if (allRatings[ct.key] === 'concern') concerns.push(ct);
    else if (allRatings[ct.key] === 'needs_work') needsWorkList.push(ct);
  }

  var sHtml = '';
  if (concerns.length > 0) {
    sHtml += '<div class="result-section"><h3>\uD83D\uDD34 Areas of Concern</h3><ul>';
    concerns.forEach(function(ct) {
      sHtml += '<li><span>' + ct.icon + ' ' + ct.label + '</span><span class="fault-badge serious-badge">Concern</span></li>';
    });
    sHtml += '</ul></div>';
  }
  sSection.innerHTML = sHtml;

  var dSection = document.getElementById('result-driving-section');
  var dHtml = '';
  if (needsWorkList.length > 0) {
    dHtml += '<div class="result-section"><h3>\uD83D\uDFE1 Needs More Practice</h3><ul>';
    needsWorkList.forEach(function(ct) {
      dHtml += '<li><span>' + ct.icon + ' ' + ct.label + '</span><span class="fault-badge driving-badge">Needs work</span></li>';
    });
    dHtml += '</ul></div>';
  }
  dSection.innerHTML = dHtml;

  // Clean areas
  var cleanList = [];
  for (var g = 0; g < SUP_CATS.length; g++) {
    if (allRatings[SUP_CATS[g].key] === 'good') cleanList.push(SUP_CATS[g]);
  }
  var cSection = document.getElementById('result-clean-section');
  if (cleanList.length > 0) {
    var cHtml = '<div class="result-section clean-section"><h3>\uD83D\uDFE2 Went Well</h3><ul>';
    cleanList.forEach(function(ct) {
      cHtml += '<li><span>' + ct.icon + ' ' + ct.label + '</span><span style="color:var(--green);font-weight:700;">\u2713</span></li>';
    });
    cHtml += '</ul></div>';
    cSection.innerHTML = cHtml;
  } else {
    cSection.innerHTML = '';
  }

  // Per-part breakdown (supervisor)
  var pbHtml = '';
  for (var p = 0; p < supervisorRatings.length; p++) {
    var pr = supervisorRatings[p];
    var pg = 0, pn = 0, pc = 0;
    for (var k in pr) {
      if (pr[k] === 'good') pg++;
      else if (pr[k] === 'needs_work') pn++;
      else if (pr[k] === 'concern') pc++;
    }
    pbHtml += '<div class="part-breakdown-row">';
    pbHtml += '<span class="part-breakdown-label">Part ' + (p + 1) + '</span>';
    pbHtml += '<span class="part-breakdown-faults">';
    pbHtml += '<span style="color:#166534;">' + pg + ' \u2713</span>';
    pbHtml += '<span style="color:#b45309;">' + pn + ' \u26A0</span>';
    pbHtml += '<span style="color:#dc2626;">' + pc + ' \u2716</span>';
    pbHtml += '</span></div>';
  }
  document.getElementById('part-breakdown-rows').innerHTML = pbHtml;

  if (typeof posthog !== 'undefined') {
    posthog.capture('mock_test_completed', {
      mock_test_id: mockTestId, mode: 'supervisor',
      good: good, needs_work: needsWork, concern: concern
    });
  }
}

function showInstructorResults() {
  // Aggregate all faults across all parts (including sub-faults)
  var allFaults = {};
  SKILLS.forEach(function(skill) {
    allFaults[skill.key] = { driving: 0, serious: 0, dangerous: 0 };
  });

  for (var p = 0; p < partFaults.length; p++) {
    Object.keys(partFaults[p]).forEach(function(key) {
      var f = partFaults[p][key];
      allFaults[key].driving += f.driving;
      allFaults[key].serious += f.serious;
      allFaults[key].dangerous += f.dangerous;
      if (f.subs) {
        Object.keys(f.subs).forEach(function(sk) {
          var sf = f.subs[sk];
          allFaults[key].driving += sf.driving;
          allFaults[key].serious += sf.serious;
          allFaults[key].dangerous += sf.dangerous;
        });
      }
    });
  }

  var result = CC_COMPETENCY.mockTestResult(allFaults);
  var passed = result.passed;
  var totals = result.totals;

  // Badge
  var badge = document.getElementById('result-badge');
  badge.textContent = passed ? 'PASS' : 'FAIL';
  badge.className = 'result-badge ' + (passed ? 'pass' : 'fail');
  badge.style.background = '';

  // Criteria
  document.querySelector('.result-criteria').textContent = 'Pass requires: 0 serious/dangerous faults and no more than 15 driving faults';

  // Totals
  var totalsHtml = '';
  totalsHtml += '<div class="result-total-item driving"><div class="result-total-num">' + totals.driving + '</div><div class="result-total-label">Driving</div></div>';
  totalsHtml += '<div class="result-total-item serious"><div class="result-total-num">' + totals.serious + '</div><div class="result-total-label">Serious</div></div>';
  totalsHtml += '<div class="result-total-item dangerous"><div class="result-total-num">' + totals.dangerous + '</div><div class="result-total-label">Dangerous</div></div>';
  document.getElementById('result-totals').innerHTML = totalsHtml;

  // Serious & Dangerous section
  var seriousSkills = [];
  SKILLS.forEach(function(skill) {
    var f = allFaults[skill.key];
    if (f.serious > 0 || f.dangerous > 0) {
      seriousSkills.push({ skill: skill, serious: f.serious, dangerous: f.dangerous });
    }
  });

  var sSection = document.getElementById('result-serious-section');
  if (seriousSkills.length > 0) {
    var sHtml = '<div class="result-section"><h3>&#128308; Serious &amp; Dangerous Faults</h3><ul>';
    seriousSkills.forEach(function(item) {
      sHtml += '<li><span>' + item.skill.label + '</span><span>';
      if (item.serious > 0) sHtml += '<span class="fault-badge serious-badge">' + item.serious + 'S</span> ';
      if (item.dangerous > 0) sHtml += '<span class="fault-badge dangerous-badge">' + item.dangerous + '&#10005;</span>';
      sHtml += '</span></li>';
    });
    sHtml += '</ul></div>';
    sSection.innerHTML = sHtml;
  } else {
    sSection.innerHTML = '';
  }

  // Most driving faults section
  var drivingSkills = [];
  SKILLS.forEach(function(skill) {
    var f = allFaults[skill.key];
    if (f.driving > 0) {
      drivingSkills.push({ skill: skill, driving: f.driving });
    }
  });
  drivingSkills.sort(function(a, b) { return b.driving - a.driving; });

  var dSection = document.getElementById('result-driving-section');
  if (drivingSkills.length > 0) {
    var dHtml = '<div class="result-section"><h3>&#128993; Most Driving Faults</h3><ul>';
    drivingSkills.forEach(function(item) {
      dHtml += '<li><span>' + item.skill.label + '</span><span class="fault-badge driving-badge">' + item.driving + 'D</span></li>';
    });
    dHtml += '</ul></div>';
    dSection.innerHTML = dHtml;
  } else {
    dSection.innerHTML = '';
  }

  // Clean areas
  var cleanSkills = [];
  SKILLS.forEach(function(skill) {
    var f = allFaults[skill.key];
    if (f.driving === 0 && f.serious === 0 && f.dangerous === 0) {
      cleanSkills.push(skill);
    }
  });

  var cSection = document.getElementById('result-clean-section');
  if (cleanSkills.length > 0) {
    var cHtml = '<div class="result-section clean-section"><h3>&#128994; Clean Areas</h3><ul>';
    cleanSkills.forEach(function(skill) {
      cHtml += '<li><span>' + skill.label + '</span><span style="color:var(--green);font-weight:700;">&#10003;</span></li>';
    });
    cHtml += '</ul></div>';
    cSection.innerHTML = cHtml;
  } else {
    cSection.innerHTML = '';
  }

  // Per-part breakdown
  var pbHtml = '';
  for (var p = 0; p < partFaults.length; p++) {
    var pt = { driving: 0, serious: 0, dangerous: 0 };
    Object.keys(partFaults[p]).forEach(function(key) {
      var f = partFaults[p][key];
      pt.driving += f.driving;
      pt.serious += f.serious;
      pt.dangerous += f.dangerous;
      if (f.subs) {
        Object.keys(f.subs).forEach(function(sk) {
          var sf = f.subs[sk];
          pt.driving += sf.driving;
          pt.serious += sf.serious;
          pt.dangerous += sf.dangerous;
        });
      }
    });
    var partLabel = 'Part ' + (p + 1);
    pbHtml += '<div class="part-breakdown-row">';
    pbHtml += '<span class="part-breakdown-label">' + partLabel + '</span>';
    pbHtml += '<span class="part-breakdown-faults">';
    pbHtml += '<span class="pbd">' + pt.driving + 'D</span>';
    pbHtml += '<span class="pbs">' + pt.serious + 'S</span>';
    pbHtml += '<span class="pbx">' + pt.dangerous + '&#10005;</span>';
    pbHtml += '</span></div>';
  }
  document.getElementById('part-breakdown-rows').innerHTML = pbHtml;

  if (typeof posthog !== 'undefined') {
    posthog.capture('mock_test_completed', {
      mock_test_id: mockTestId, mode: 'instructor',
      passed: passed,
      driving_faults: totals.driving,
      serious_faults: totals.serious,
      dangerous_faults: totals.dangerous
    });
  }

  // Show map button if GPS data was recorded OR a route was selected
  if (gpsTrack.length > 0 || selectedRoute) {
    document.getElementById('btn-show-map').classList.remove('hidden');
  }

  showScreen('screen-results');
}

/* ── Route Selection ── */
function showRouteSelection() {
  var centres = CC_TEST_ROUTES.CENTRES;
  selectedCentre = centres[0]; // default to first (only one for now)
  renderRouteList();
  showScreen('screen-route');
}

function renderRouteList() {
  var container = document.getElementById('route-list');
  if (!selectedCentre) { container.innerHTML = ''; return; }

  container.innerHTML = selectedCentre.routes.map(function(route) {
    var isSelected = selectedRoute && selectedRoute.id === route.id;
    return '<button class="route-card' + (isSelected ? ' selected' : '') + '" data-action="select-route" data-route-id="' + route.id + '">' + route.name + '</button>';
  }).join('');
}

function selectRoute(routeId) {
  selectedRoute = CC_TEST_ROUTES.getRoute(selectedCentre.id, routeId);
  renderRouteList();
  var actions = document.getElementById('route-actions');
  actions.classList.remove('hidden');
  document.getElementById('btn-open-maps').href = selectedRoute.mapsUrl;
}

function skipRouteSelection() {
  selectedRoute = null;
  beginMockTest();
}

/* ── GPS Tracking ── */
function startGpsTracking() {
  if (!navigator.geolocation) return;
  stopGpsTracking();
  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      gpsTrack.push({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
        part: currentPart
      });
    },
    function(err) {
      console.warn('GPS error:', err.code, err.message);
      if (err.code === 1) {
        // Permission denied — show a subtle note
        var existing = document.getElementById('gps-denied-note');
        if (!existing) {
          var note = document.createElement('div');
          note.id = 'gps-denied-note';
          note.style.cssText = 'background:#fff3e0;color:#e65100;padding:8px 12px;border-radius:8px;font-size:0.82rem;margin:8px 0;text-align:center;';
          note.textContent = 'Location access denied — the fault map will use your selected route instead of GPS tracking.';
          var timer = document.getElementById('timer-display');
          if (timer && timer.parentNode) timer.parentNode.insertAdjacentElement('afterend', note);
        }
      }
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

function stopGpsTracking() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

/* ── Wake Lock ── */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) { console.warn('Wake Lock failed:', err); }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && isDriving && !wakeLock) {
    requestWakeLock();
  }
});

/* ── Fault Map ── */
function showFaultMap() {
  releaseWakeLock();
  showScreen('screen-map');

  if (faultMap) { faultMap.remove(); faultMap = null; }

  faultMap = L.map('map-container');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(faultMap);

  if (gpsTrack.length > 0) {
    var latLngs = gpsTrack
      .filter(function(pt) { return pt.accuracy < 50; })
      .map(function(pt) { return [pt.lat, pt.lng]; });

    if (latLngs.length < 2) {
      latLngs = gpsTrack.map(function(pt) { return [pt.lat, pt.lng]; });
    }

    if (latLngs.length >= 2) {
      routePolyline = L.polyline(latLngs, { color: '#f58321', weight: 5, opacity: 0.8 }).addTo(faultMap);
      faultMap.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
    }

    faultMap.on('click', function(e) {
      if (!pendingFaultPlacement) return;
      var snapped = latLngs.length > 0 ? snapToPolyline(e.latlng, latLngs) : e.latlng;
      placeFaultOnMap(snapped);
    });
  } else if (selectedRoute && selectedCentre) {
    faultMap.setView([selectedCentre.centre.lat, selectedCentre.centre.lng], selectedCentre.zoom || 13);
    faultMap.on('click', function(e) {
      if (!pendingFaultPlacement) return;
      placeFaultOnMap(e.latlng);
    });
  } else {
    faultMap.setView([51.454, -1.005], 13);
  }

  buildFaultPlacementList();
  placedFaultMarkers = [];
  updatePlacedFaultsSummary();
}

function snapToPolyline(clickLatLng, latLngs) {
  var minDist = Infinity, closest = clickLatLng;
  for (var i = 0; i < latLngs.length; i++) {
    var pt = L.latLng(latLngs[i][0], latLngs[i][1]);
    var dist = clickLatLng.distanceTo(pt);
    if (dist < minDist) { minDist = dist; closest = pt; }
  }
  return closest;
}

function buildFaultPlacementList() {
  var allFaults = {};
  SKILLS.forEach(function(skill) {
    allFaults[skill.key] = { driving: 0, serious: 0, dangerous: 0 };
  });
  for (var p = 0; p < partFaults.length; p++) {
    Object.keys(partFaults[p]).forEach(function(key) {
      var f = partFaults[p][key];
      allFaults[key].driving += f.driving;
      allFaults[key].serious += f.serious;
      allFaults[key].dangerous += f.dangerous;
      if (f.subs) {
        Object.keys(f.subs).forEach(function(sk) {
          var sf = f.subs[sk];
          allFaults[key].driving += sf.driving;
          allFaults[key].serious += sf.serious;
          allFaults[key].dangerous += sf.dangerous;
        });
      }
    });
  }

  var container = document.getElementById('fault-placement-list');
  var html = '';
  SKILLS.forEach(function(skill) {
    var f = allFaults[skill.key];
    FAULT_TYPES.forEach(function(ft) {
      var count = f[ft.key];
      for (var i = 0; i < count; i++) {
        html += '<button class="fault-place-btn" data-action="select-fault-to-place" data-skill="' + skill.key + '" data-type="' + ft.key + '" data-skill-label="' + skill.label + '">' + '<span class="fpb-badge ' + ft.key + '">' + ft.shortLabel + '</span> ' + skill.label + '</button>';
      }
    });
  });

  if (!html) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;">No faults to place &mdash; clean sheet!</p>';
    document.getElementById('fault-placement-panel').style.display = 'none';
  } else {
    container.innerHTML = html;
  }
}

function selectFaultToPlace(btnEl, skillKey, faultType, skillLabel) {
  var ft = FAULT_TYPES.find(function(f) { return f.key === faultType; });
  pendingFaultPlacement = { skillKey: skillKey, faultType: faultType, skillLabel: skillLabel, shortLabel: ft ? ft.shortLabel : 'F', btnEl: btnEl };

  // Highlight the selected button
  document.querySelectorAll('.fault-place-btn').forEach(function(b) { b.classList.remove('active-placement'); });
  btnEl.classList.add('active-placement');
}

function placeFaultOnMap(latlng) {
  if (!pendingFaultPlacement) return;

  var colours = { driving: '#f59e0b', serious: '#ef4444', dangerous: '#991b1b' };
  var colour = colours[pendingFaultPlacement.faultType] || '#f59e0b';

  var marker = L.circleMarker(latlng, {
    radius: 14, fillColor: colour, color: '#fff', weight: 2, fillOpacity: 0.9
  }).addTo(faultMap);

  marker.bindTooltip(pendingFaultPlacement.shortLabel + ' — ' + pendingFaultPlacement.skillLabel, {
    permanent: false, direction: 'top', offset: [0, -10]
  });

  var labelMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'fault-map-label',
      html: '<span style="color:#fff;font-weight:800;font-size:12px;">' + pendingFaultPlacement.shortLabel + '</span>',
      iconSize: [28, 28], iconAnchor: [14, 14]
    })
  }).addTo(faultMap);

  placedFaultMarkers.push({
    marker: marker, labelMarker: labelMarker,
    faultType: pendingFaultPlacement.faultType,
    skillKey: pendingFaultPlacement.skillKey,
    skillLabel: pendingFaultPlacement.skillLabel,
    shortLabel: pendingFaultPlacement.shortLabel
  });

  // Remove the button from placement list
  if (pendingFaultPlacement.btnEl) pendingFaultPlacement.btnEl.remove();

  pendingFaultPlacement = null;
  document.querySelectorAll('.fault-place-btn').forEach(function(b) { b.classList.remove('active-placement'); });
  updatePlacedFaultsSummary();
}

function undoLastPlacement() {
  if (placedFaultMarkers.length === 0) return;
  var last = placedFaultMarkers.pop();
  faultMap.removeLayer(last.marker);
  faultMap.removeLayer(last.labelMarker);

  // Re-add the fault button
  var container = document.getElementById('fault-placement-list');
  var ft = FAULT_TYPES.find(function(f) { return f.key === last.faultType; });
  var btn = document.createElement('button');
  btn.className = 'fault-place-btn';
  btn.setAttribute('data-skill', last.skillKey);
  btn.setAttribute('data-type', last.faultType);
  btn.onclick = function() { selectFaultToPlace(btn, last.skillKey, last.faultType, last.skillLabel); };
  btn.innerHTML = '<span class="fpb-badge ' + last.faultType + '">' + last.shortLabel + '</span> ' + last.skillLabel;
  container.appendChild(btn);

  updatePlacedFaultsSummary();
}

function updatePlacedFaultsSummary() {
  var list = document.getElementById('placed-faults-list');
  if (placedFaultMarkers.length === 0) {
    list.innerHTML = '<li style="color:var(--muted);">No faults placed yet. Tap a fault above, then tap the route.</li>';
    return;
  }
  list.innerHTML = placedFaultMarkers.map(function(item) {
    return '<li class="placed-fault-item"><span class="fpb-badge ' + item.faultType + '">' + item.shortLabel + '</span> ' + item.skillLabel + '</li>';
  }).join('');
}

// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  // Honor data-stop-propagation on ancestor elements (replaces inline event.stopPropagation())
  var stopper = e.target.closest('[data-stop-propagation]');
  var target = e.target.closest('[data-action]');
  if (!target) return;
  // If a stopper is between target and its parent toggle-subs, don't propagate up
  var action = target.dataset.action;
  if (action === 'toggle-area') toggleArea(target);
  else if (action === 'toggle-subs') {
    // Only run if the click wasn't inside a stop-propagation descendant
    if (stopper && target.contains(stopper) && stopper !== target) return;
    toggleSubs(target.dataset.skill);
  } else if (action === 'toggle-sup-category') toggleSupCategory(target);
  else if (action === 'rate-sup-cat') rateSupervisorCategory(target.dataset.cat, target.dataset.rating);
  else if (action === 'select-route') selectRoute(target.dataset.routeId);
  else if (action === 'select-fault-to-place') selectFaultToPlace(target, target.dataset.skill, target.dataset.type, target.dataset.skillLabel);
});
// Pointer handlers for fault counters (previously inline onpointerdown/up/leave)
document.addEventListener('pointerdown', function (e) {
  var t = e.target.closest('[data-action="fault-counter"]');
  if (t) fcDown(t);
});
document.addEventListener('pointerup', function (e) {
  var t = e.target.closest('[data-action="fault-counter"]');
  if (t) fcUp(t);
});
document.addEventListener('pointerleave', function (e) {
  var t = e.target.closest && e.target.closest('[data-action="fault-counter"]');
  if (t) fcCancel(t);
}, true);
// ── Static handlers previously inline in HTML ──
(function wire() {
  document.querySelectorAll('.mode-card[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectMode(btn.dataset.mode); });
  });
  var bindClick = function (id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  bindClick('btn-begin', showRouteSelection);
  bindClick('btn-begin-route', beginMockTest);
  bindClick('btn-skip-route', skipRouteSelection);
  bindClick('btn-start-drive', startDriving);
  bindClick('btn-pull-over', pullOver);
  bindClick('btn-save-faults', saveFaults);
  bindClick('btn-continue-next', continueToNextPart);
  bindClick('btn-end-mock', endMockTest);
  bindClick('btn-show-map', showFaultMap);
  bindClick('btn-try-again', function () { location.reload(); });
  bindClick('btn-undo-placement', undoLastPlacement);
  bindClick('link-release-wakelock', releaseWakeLock);
})();
})();
