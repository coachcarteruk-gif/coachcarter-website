(function () {
  'use strict';

let AUTH;
let DATA = null;

const PRACTICE_DRIVE_RATINGS = {
  nailed: 'Went well',
  ok: 'Needs practice',
  struggled: 'Ask instructor'
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Computed maps: skillKey -> aggregated data
let lessonMap = {};   // skillKey -> [{score, date}] sorted newest first
let quizMap = {};     // skillKey -> {attempts, correct}
let mockFaultMap = {}; // skillKey -> {driving, serious, dangerous} from formal mock tests
let skillScores = {}; // skillKey -> internal practice signal, 0-100
let recentMockMeta = null; // { id, completed_at, result } | null
let recentSkillFaultMap = {}; // skillKey -> {driving, serious, dangerous} from most recent mock
let subFaultMap = {}; // skillKey -> { subKey -> {driving, serious, dangerous} } from most recent mock

// ── Auth ──
window.addEventListener('DOMContentLoaded', function() {
  AUTH = ccAuth.getAuth();
  if (!AUTH) {
    window.location.href = '/learner/login.html?redirect=/learner/progress.html';
    return;
  }
  loadData();
});

// ── Load competency data ──
async function loadData() {
  try {
    var res = await ccAuth.fetchAuthed('/api/learner?action=competency');
    if (!res.ok) throw new Error('API error: ' + res.status);
    DATA = await res.json();
    processData();
    render();
  } catch (e) {
    console.error('Failed to load competency data:', e);
    document.getElementById('loading').innerHTML =
      '<p style="color:var(--red);">Failed to load data. Please try refreshing the page.</p>';
  }
}

// ── Process raw API data into lookup maps ──
function processData() {
  var CC = window.CC_COMPETENCY;

  // Build lesson ratings map
  lessonMap = {};
  if (DATA.lesson_ratings) {
    for (var i = 0; i < DATA.lesson_ratings.length; i++) {
      var lr = DATA.lesson_ratings[i];
      var key = CC.mapLegacySkill(lr.skill_key);
      var ratingObj = null;
      for (var r = 0; r < CC.RATINGS.length; r++) {
        if (CC.RATINGS[r].key === lr.rating) { ratingObj = CC.RATINGS[r]; break; }
      }
      if (!ratingObj) continue;
      if (!lessonMap[key]) lessonMap[key] = [];
      lessonMap[key].push({ score: ratingObj.score, date: lr.created_at, rating: lr.rating });
    }
  }
  // Sort each by date newest first
  var lkeys = Object.keys(lessonMap);
  for (var li = 0; li < lkeys.length; li++) {
    lessonMap[lkeys[li]].sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  }

  // Build quiz accuracy map (with legacy key mapping)
  quizMap = {};
  if (DATA.quiz_accuracy) {
    for (var q = 0; q < DATA.quiz_accuracy.length; q++) {
      var qa = DATA.quiz_accuracy[q];
      var qaKey = CC.mapLegacySkill(qa.skill_key);
      if (!qaKey) continue; // removed skill
      if (!quizMap[qaKey]) {
        quizMap[qaKey] = { attempts: 0, correct: 0 };
      }
      quizMap[qaKey].attempts += (qa.attempts || 0);
      quizMap[qaKey].correct += (qa.correct_count || 0);
    }
  }

  // Build mock faults map (with legacy key mapping)
  mockFaultMap = {};
  if (DATA.mock_faults) {
    for (var m = 0; m < DATA.mock_faults.length; m++) {
      var mf = DATA.mock_faults[m];
      var mfKey = CC.mapLegacySkill(mf.skill_key);
      if (!mfKey) continue; // removed skill
      if (!mockFaultMap[mfKey]) {
        mockFaultMap[mfKey] = { driving: 0, serious: 0, dangerous: 0 };
      }
      mockFaultMap[mfKey].driving += (mf.total_driving || 0);
      mockFaultMap[mfKey].serious += (mf.total_serious || 0);
      mockFaultMap[mfKey].dangerous += (mf.total_dangerous || 0);
    }
  }

  // Most recent mock test metadata (date + pass/fail) - used as the source of
  // truth for the "Most recent mock test" breakdown section.
  recentMockMeta = DATA.recent_mock || null;

  // Per-skill parent-level faults from the most recent mock test
  recentSkillFaultMap = {};
  if (DATA.recent_skill_faults) {
    for (var rk = 0; rk < DATA.recent_skill_faults.length; rk++) {
      var rkf = DATA.recent_skill_faults[rk];
      var rkKey = CC.mapLegacySkill(rkf.skill_key);
      if (!rkKey) continue;
      if (!recentSkillFaultMap[rkKey]) {
        recentSkillFaultMap[rkKey] = { driving: 0, serious: 0, dangerous: 0 };
      }
      recentSkillFaultMap[rkKey].driving += (rkf.driving || 0);
      recentSkillFaultMap[rkKey].serious += (rkf.serious || 0);
      recentSkillFaultMap[rkKey].dangerous += (rkf.dangerous || 0);
    }
  }

  // Build sub-skill faults map - only from most recent mock test.
  subFaultMap = {};
  if (DATA.recent_sub_faults) {
    for (var sf = 0; sf < DATA.recent_sub_faults.length; sf++) {
      var rsf = DATA.recent_sub_faults[sf];
      var sfKey = CC.mapLegacySkill(rsf.skill_key);
      if (!sfKey || !rsf.sub_key) continue;
      if (!subFaultMap[sfKey]) subFaultMap[sfKey] = {};
      subFaultMap[sfKey][rsf.sub_key] = {
        driving: rsf.driving || 0,
        serious: rsf.serious || 0,
        dangerous: rsf.dangerous || 0
      };
    }
  }

  // Calculate internal practice signals for every skill
  skillScores = {};
  for (var s = 0; s < CC.SKILLS.length; s++) {
    var sk = CC.SKILLS[s];
    var lessonRatings = lessonMap[sk.key] || [];
    var quiz = quizMap[sk.key];
    var quizResults = [];
    if (quiz && quiz.attempts > 0) {
      // Expand into individual results for the shared scoring function
      for (var qr = 0; qr < quiz.attempts; qr++) {
        quizResults.push({ correct: qr < quiz.correct });
      }
    }
    var lastPractised = null;
    if (lessonRatings.length > 0) lastPractised = lessonRatings[0].date;

    var mockFaults = mockFaultMap[sk.key] ? [mockFaultMap[sk.key]] : [];

    skillScores[sk.key] = CC.readinessScore({
      lessonRatings: lessonRatings,
      quizResults: quizResults,
      mockFaults: mockFaults,
      lastPractised: lastPractised
    });
  }
}

// ── Check if there's any data at all ──
function hasAnyData() {
  var ss = DATA.session_stats || {};
  var ms = DATA.mock_summary || {};
  return (ss.total_sessions > 0) ||
         ((DATA.focused_practice_count || 0) > 0) ||
         (DATA.quiz_accuracy && DATA.quiz_accuracy.length > 0) ||
         (ms.total_tests > 0);
}

// ── Compute average practice signal for an area ──
function areaAvg(areaId) {
  var CC = window.CC_COMPETENCY;
  var skills = CC.getSkillsByArea(areaId);
  if (skills.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < skills.length; i++) sum += (skillScores[skills[i].key] || 0);
  return Math.round(sum / skills.length);
}

// ── Overall practice signal: average of all skill scores ──
function overallReadiness() {
  var CC = window.CC_COMPETENCY;
  var sum = 0;
  for (var i = 0; i < CC.SKILLS.length; i++) sum += (skillScores[CC.SKILLS[i].key] || 0);
  return Math.round(sum / CC.SKILLS.length);
}

// ── Colour for a score ──
function scoreColour(score) {
  if (score >= 70) return 'var(--green)';
  if (score >= 40) return 'var(--amber)';
  return 'var(--red)';
}

function getRatingLabel(ratingKey) {
  var CC = window.CC_COMPETENCY;
  for (var r = 0; r < CC.RATINGS.length; r++) {
    if (CC.RATINGS[r].key === ratingKey) return CC.RATINGS[r].label;
  }
  return '';
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }
  return value;
}

function practiceRatingLabel(ratingKey) {
  return PRACTICE_DRIVE_RATINGS[ratingKey] || ratingKey || 'Saved';
}

function formatPracticeDate(value) {
  if (!value) return '';
  var d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function summarizeFocusedPracticeSession(row) {
  var CC = window.CC_COMPETENCY;
  var focusAreas = parseJsonValue(row.focus_areas, []);
  var reflections = parseJsonValue(row.reflections, {}) || {};
  var areas = [];
  var tellInstructorCount = 0;
  var note = '';

  if (!Array.isArray(focusAreas)) focusAreas = [];

  for (var i = 0; i < focusAreas.length; i++) {
    var cat = CC.getSupervisorCategory(focusAreas[i]);
    if (!cat) continue;
    var skillReflections = [];
    for (var s = 0; s < cat.dl25Skills.length; s++) {
      var ref = reflections[cat.dl25Skills[s]];
      if (ref && typeof ref === 'object') skillReflections.push(ref);
    }

    var ratingKey = null;
    if (skillReflections.some(function(ref) { return ref.rating === 'struggled'; })) ratingKey = 'struggled';
    else if (skillReflections.some(function(ref) { return ref.rating === 'ok'; })) ratingKey = 'ok';
    else if (skillReflections.some(function(ref) { return ref.rating === 'nailed'; })) ratingKey = 'nailed';

    var areaNote = '';
    for (var n = 0; n < skillReflections.length; n++) {
      if (skillReflections[n].note) { areaNote = skillReflections[n].note; break; }
    }
    if (areaNote && (!note || ratingKey === 'struggled')) note = areaNote;
    if (ratingKey === 'struggled') tellInstructorCount++;

    areas.push({
      label: cat.label,
      ratingKey: ratingKey,
      ratingLabel: practiceRatingLabel(ratingKey),
      tellInstructor: ratingKey === 'struggled'
    });
  }

  if (areas.length === 0) {
    Object.keys(reflections).slice(0, 3).forEach(function(skillKey) {
      var ref = reflections[skillKey] || {};
      var skill = CC.getSkill(CC.mapLegacySkill(skillKey));
      if (!skill) return;
      if (ref.note && !note) note = ref.note;
      if (ref.rating === 'struggled') tellInstructorCount++;
      areas.push({
        label: skill.label,
        ratingKey: ref.rating,
        ratingLabel: practiceRatingLabel(ref.rating),
        tellInstructor: ref.rating === 'struggled'
      });
    });
  }

  return {
    id: row.id,
    dateLabel: formatPracticeDate(row.completed_at || row.created_at || row.session_date),
    durationMinutes: row.duration_minutes || 0,
    areas: areas,
    note: note,
    tellInstructorCount: tellInstructorCount
  };
}

function skillsWithPracticeSignals() {
  var CC = window.CC_COMPETENCY;
  var items = [];
  for (var i = 0; i < CC.SKILLS.length; i++) {
    var sk = CC.SKILLS[i];
    var hasLesson = lessonMap[sk.key] && lessonMap[sk.key].length > 0;
    var hasQuiz = quizMap[sk.key] && quizMap[sk.key].attempts > 0;
    if (hasLesson || hasQuiz) {
      items.push({ skill: sk, score: skillScores[sk.key] || 0 });
    }
  }
  return items;
}

function latestReflectionCopy(skillKey) {
  var CC = window.CC_COMPETENCY;
  var skill = CC.getSkill(CC.mapLegacySkill(skillKey));
  var skillLabel = skill ? skill.label : 'this skill';
  var lessons = lessonMap[skillKey] || [];
  if (lessons.length > 0) {
    var label = getRatingLabel(lessons[0].rating);
    if (label) return 'Your latest note for ' + skillLabel + ' was "' + label + '".';
  }

  var quiz = quizMap[skillKey];
  if (quiz && quiz.attempts > 0) {
    return 'Your quiz practice suggests this is worth another look.';
  }

  return 'This is a useful focus for your next practice drive.';
}

function progressSourceLabel(sourceKey) {
  var labels = {
    'lesson-log': 'From your drive notes',
    'learner-reflection': 'From your drive notes',
    'practice-drive': 'From practice',
    'supervisor-reflection': 'From practice notes',
    'quiz-practice': 'From your quiz',
    'formal-mock': 'From your mock test',
    'instructor-assessment': 'From your instructor',
    'mixed-signal': 'Based on recent activity'
  };
  return labels[sourceKey] || 'Suggested next step';
}

function renderSignalSourceBadge(sourceKey) {
  return '<span class="source-badge source-' + escHtml(sourceKey) + '">' +
    escHtml(progressSourceLabel(sourceKey)) +
    '</span>';
}

function latestReflectionSource(skillKey) {
  var lessons = lessonMap[skillKey] || [];
  if (lessons.length > 0) return 'learner-reflection';

  var quiz = quizMap[skillKey];
  if (quiz && quiz.attempts > 0) return 'quiz-practice';

  return 'lesson-log';
}

function parseDate(value) {
  if (!value) return null;
  var d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isWithinLastWeek(value) {
  var d = parseDate(value);
  return !!d && (Date.now() - d.getTime()) <= WEEK_MS && (Date.now() - d.getTime()) >= 0;
}

function sessionDateValue(row) {
  return row && (row.session_date || row.completed_at || row.created_at);
}

function recentSessionsThisWeek() {
  var rows = Array.isArray(DATA.recent_sessions) ? DATA.recent_sessions : [];
  return rows.filter(function(row) {
    return row && row.session_type !== 'onboarding' && isWithinLastWeek(sessionDateValue(row));
  });
}

function addWeeklySignal(map, skillKey, parts) {
  var CC = window.CC_COMPETENCY;
  var mappedKey = CC.mapLegacySkill(skillKey);
  if (!mappedKey) return;
  var skill = CC.getSkill(mappedKey);
  if (!skill) return;

  if (!map[mappedKey]) {
    map[mappedKey] = {
      skill: skill,
      positive: 0,
      attention: 0,
      ask: 0,
      recent: false,
      sources: {}
    };
  }

  var item = map[mappedKey];
  item.positive += parts.positive || 0;
  item.attention += parts.attention || 0;
  item.ask += parts.ask || 0;
  item.recent = item.recent || !!parts.recent;
  if (parts.source) item.sources[parts.source] = true;
}

function buildWeeklySkillSignals() {
  var signalMap = {};
  var lkeys = Object.keys(lessonMap);
  for (var li = 0; li < lkeys.length; li++) {
    var lessonRows = lessonMap[lkeys[li]] || [];
    for (var lr = 0; lr < lessonRows.length; lr++) {
      var lesson = lessonRows[lr];
      if (!isWithinLastWeek(lesson.date)) continue;
      addWeeklySignal(signalMap, lkeys[li], {
        positive: lesson.rating === 'nailed' ? 3 : lesson.rating === 'ok' ? 1 : 0,
        attention: lesson.rating === 'struggled' ? 3 : lesson.rating === 'ok' ? 1 : 0,
        source: 'learner-reflection',
        recent: true
      });
    }
  }

  var practiceRows = Array.isArray(DATA.recent_focused_practice) ? DATA.recent_focused_practice : [];
  for (var p = 0; p < practiceRows.length; p++) {
    var row = practiceRows[p];
    if (!isWithinLastWeek(row.completed_at || row.created_at || row.session_date)) continue;
    var reflections = parseJsonValue(row.reflections, {}) || {};
    Object.keys(reflections).forEach(function(skillKey) {
      var ref = reflections[skillKey] || {};
      addWeeklySignal(signalMap, skillKey, {
        positive: ref.rating === 'nailed' ? 3 : ref.rating === 'ok' ? 1 : 0,
        attention: ref.rating === 'struggled' ? 3 : ref.rating === 'ok' ? 1 : 0,
        ask: ref.rating === 'struggled' ? 3 : 0,
        source: 'practice-drive',
        recent: true
      });
    });
  }

  Object.keys(quizMap).forEach(function(skillKey) {
    var quiz = quizMap[skillKey];
    if (!quiz || quiz.attempts < 3) return;
    var accuracy = quiz.correct / quiz.attempts;
    addWeeklySignal(signalMap, skillKey, {
      positive: accuracy >= 0.8 ? 1 : 0,
      attention: accuracy < 0.65 ? 1 : 0,
      source: 'quiz-practice',
      recent: false
    });
  });

  if (recentMockMeta) {
    var mockRecent = isWithinLastWeek(recentMockMeta.completed_at);
    Object.keys(recentSkillFaultMap).forEach(function(skillKey) {
      var row = recentSkillFaultMap[skillKey] || {};
      var total = (row.driving || 0) + (row.serious || 0) + (row.dangerous || 0);
      if (total <= 0) return;
      addWeeklySignal(signalMap, skillKey, {
        attention: Math.min(4, total),
        ask: (row.serious || row.dangerous) ? 2 : 0,
        source: 'formal-mock',
        recent: mockRecent
      });
      if (recentMockMeta.mode === 'instructor') {
        addWeeklySignal(signalMap, skillKey, {
          source: 'instructor-assessment',
          recent: mockRecent
        });
      }
    });
  }

  return Object.keys(signalMap).map(function(key) { return signalMap[key]; });
}

function sourceKeys(item, fallback) {
  var keys = item && item.sources ? Object.keys(item.sources) : [];
  return keys.length ? keys : [fallback || 'mixed-signal'];
}

function pickWeeklyStrongest(signals) {
  var candidates = signals.filter(function(item) { return item.positive > 0; });
  candidates.sort(function(a, b) {
    if (b.recent !== a.recent) return b.recent ? 1 : -1;
    return b.positive - a.positive || (skillScores[b.skill.key] || 0) - (skillScores[a.skill.key] || 0);
  });
  return candidates[0] || null;
}

function pickWeeklyFocus(signals) {
  var candidates = signals.filter(function(item) { return item.attention > 0; });
  candidates.sort(function(a, b) {
    if (b.recent !== a.recent) return b.recent ? 1 : -1;
    return b.attention - a.attention || (skillScores[a.skill.key] || 0) - (skillScores[b.skill.key] || 0);
  });
  if (candidates[0]) return candidates[0];

  var withData = skillsWithPracticeSignals();
  withData.sort(function(a, b) { return a.score - b.score; });
  return withData[0] ? { skill: withData[0].skill, sources: { 'mixed-signal': true }, recent: false } : null;
}

function pickWeeklyInstructorAsk(signals, focus) {
  var candidates = signals.filter(function(item) { return item.ask > 0; });
  candidates.sort(function(a, b) {
    if (b.recent !== a.recent) return b.recent ? 1 : -1;
    return b.ask - a.ask || b.attention - a.attention;
  });
  return candidates[0] || focus || null;
}

function renderWeeklyCardItem(label, value, copy, sources) {
  var badges = (sources || ['mixed-signal']).map(renderSignalSourceBadge).join('');
  return '<div class="weekly-summary-item">' +
    '<div class="weekly-summary-label">' + escHtml(label) + '</div>' +
    '<div class="weekly-summary-value">' + escHtml(value) + '</div>' +
    '<div class="weekly-summary-copy">' + escHtml(copy) + '</div>' +
    '<div class="weekly-summary-sources">' + badges + '</div>' +
  '</div>';
}

function renderWeeklySummary() {
  var container = document.getElementById('weekly-summary-section');
  if (!container) return;

  var sessions = recentSessionsThisWeek();
  var signals = buildWeeklySkillSignals();
  var strongest = pickWeeklyStrongest(signals);
  var focus = pickWeeklyFocus(signals);
  var ask = pickWeeklyInstructorAsk(signals, focus);

  var sessionSources = {};
  sessions.forEach(function(row) {
    if (row.session_type === 'focused_practice') sessionSources['practice-drive'] = true;
    else sessionSources['learner-reflection'] = true;
  });
  var sessionSourceKeys = Object.keys(sessionSources);
  if (sessionSourceKeys.length === 0) sessionSourceKeys = ['learner-reflection'];

  var practiceValue = sessions.length > 0
    ? 'This week you practised ' + sessions.length + ' time' + (sessions.length === 1 ? '.' : 's.')
    : 'No saved practice this week yet.';
  var practiceCopy = sessions.length > 0
    ? 'Based on the drives and practice you saved.'
    : 'Start a drive to give next week a clearer starting point.';

  var strongestValue = strongest
    ? 'Your strongest area looks like ' + strongest.skill.label + '.'
    : 'Not enough saved practice yet.';
  var strongestCopy = strongest
    ? 'This is based on what you saved.'
    : 'One or two saved drive notes will make this more useful.';

  var focusValue = focus
    ? 'Next week, focus on ' + focus.skill.label + '.'
    : 'Next week, choose one simple focus.';
  var focusCopy = focus
    ? 'Keep it practical: pick a short route or lesson moment where this skill comes up.'
    : 'Start with a drive and one simple focus area.';

  var askValue = ask
    ? 'Ask your instructor about ' + ask.skill.label + '.'
    : 'Ask your instructor what would help most next.';
  var askCopy = ask
    ? 'Bring this up as a coaching question, especially if it came from Practice Drive notes.'
    : 'They can help turn the next practice session into a focused plan.';

  var html = '<h2 class="section-title">Weekly progress summary</h2>';
  html += '<div class="weekly-summary-card"><div class="weekly-summary-grid">';
  html += renderWeeklyCardItem('Practice this week', practiceValue, practiceCopy, sessionSourceKeys);
  html += renderWeeklyCardItem('Strongest area', strongestValue, strongestCopy, strongest ? sourceKeys(strongest) : ['learner-reflection', 'quiz-practice']);
  html += renderWeeklyCardItem('Next week', focusValue, focusCopy, focus ? sourceKeys(focus) : ['practice-drive']);
  html += renderWeeklyCardItem('Ask about', askValue, askCopy, ask ? sourceKeys(ask) : ['instructor-assessment']);
  html += '</div></div>';

  container.innerHTML = html;
}

function totalMockMarks(row) {
  return (row.total_driving || 0) + (row.total_serious || 0) + (row.total_dangerous || 0);
}

// ── Main render ──
function render() {
  document.getElementById('loading').classList.add('hidden');

  if (!hasAnyData()) {
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  document.getElementById('main-content').classList.remove('hidden');
  renderNextActions();
  renderWeeklySummary();
  renderStats();
  renderRecentPractice();
  renderGoingWell();
  renderMockHistory();
  renderSkillBreakdown();
  var advanced = document.getElementById('advanced-breakdown');
  if (advanced && advanced.open) renderRadar();

  if (typeof posthog !== 'undefined') {
    posthog.capture('progress_page_viewed', { overall_readiness: overallReadiness() });
  }
}

// ── Section 2: Recent activity stats ──
function renderStats() {
  var CC = window.CC_COMPETENCY;
  var ss = DATA.session_stats || {};
  var ms = DATA.mock_summary || {};
  var hours = ss.total_minutes ? (ss.total_minutes / 60).toFixed(1) : '0';
  var skillCount = skillsWithPracticeSignals().length;
  var skillText = skillCount + ' / ' + CC.SKILLS.length;

  document.getElementById('stats-grid').innerHTML =
    '<div class="stat-card"><div class="stat-value">' + (ss.total_sessions || 0) + '</div><div class="stat-label">Drives logged</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + hours + '</div><div class="stat-label">Hours practised</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (ms.total_tests || 0) + '</div><div class="stat-label">Mock tests</div></div>' +
    '<div class="stat-card"><div class="stat-value accent">' + skillText + '</div><div class="stat-label">Skills practised</div></div>';
}

// ── Section 2: Radar Chart ──
function renderRecentPractice() {
  var container = document.getElementById('recent-practice-section');
  if (!container) return;
  var rows = Array.isArray(DATA.recent_focused_practice) ? DATA.recent_focused_practice : [];
  if (rows.length === 0) {
    container.innerHTML = '';
    return;
  }

  var summaries = rows.slice(0, 3).map(summarizeFocusedPracticeSession);
  var html = '<div class="practice-summary-list">';
  summaries.forEach(function(item) {
    var meta = [];
    if (item.dateLabel) meta.push(item.dateLabel);
    if (item.durationMinutes) meta.push(item.durationMinutes + ' min');
    if (item.tellInstructorCount > 0) meta.push('Ask instructor ' + item.tellInstructorCount);

    html += '<div class="practice-summary-card' + (item.tellInstructorCount > 0 ? ' has-alert' : '') + '">';
    html += '<div class="practice-summary-top">';
    html += '<div><div class="practice-summary-title">Practice Drive summary</div>' +
      renderSignalSourceBadge('supervisor-reflection') + '</div>';
    html += '<div class="practice-summary-meta">' + escHtml(meta.join(' / ')) + '</div>';
    html += '</div>';
    html += '<div class="practice-summary-areas">';
    item.areas.forEach(function(area) {
      html += '<span class="practice-summary-pill' + (area.tellInstructor ? ' tell' : '') + '">' +
        escHtml(area.label + ': ' + area.ratingLabel) +
        '</span>';
    });
    html += '</div>';
    if (item.note) {
      html += '<div class="practice-summary-note">' + escHtml(item.note).slice(0, 260).replace(/\n/g, '<br>') + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderRadar() {
  var CC = window.CC_COMPETENCY;
  var canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  var wrap = canvas.parentElement;
  if (!wrap || wrap.clientWidth <= 32) return;
  var size = Math.min(wrap.clientWidth - 32, 440);
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  var cx = size / 2;
  var cy = size / 2;
  var areas = CC.AREAS;
  var n = areas.length;
  var scores = [];
  for (var i = 0; i < n; i++) scores.push(areaAvg(areas[i].id));

  // Build short labels for the radar - full names like "Response to Signs /
  // Signals" don't fit on a 400px-wide canvas at 3/9 o'clock. The full label
  // remains used everywhere else (skill breakdown, examiner quiz, etc.).
  // Map full labels to compact forms for the radar only. Area IDs from
  // competency-config.js AREAS list. The longer the label, the more padding
  // it forces, shrinking the chart - so shorten the two longest.
  var SHORT_LABEL = {
    'signs_signals': 'Signs',
    'mirrors': 'Mirrors'
  };
  function shortLabelFor(area) {
    if (SHORT_LABEL[area.id]) return SHORT_LABEL[area.id];
    if (area.label.length > 14) {
      // Auto-shorten any label still too long
      return area.label.split(' ').slice(0, 2).join(' ');
    }
    return area.label;
  }
  var radarLabels = areas.map(shortLabelFor);

  // Compute the widest *radar* label so we can pad maxR enough to keep
  // horizontal labels fully visible. At 3/9 o'clock the label is anchored at
  // cx ± (maxR + 32) with text aligned away from centre - so the full label
  // width must fit between the anchor and the canvas edge.
  ctx.font = '600 12px Lato, sans-serif';
  var widestLabel = 0;
  for (var w = 0; w < n; w++) {
    var tw = ctx.measureText(radarLabels[w]).width;
    if (tw > widestLabel) widestLabel = tw;
  }
  // pad needs to cover the worst case: a horizontal label at 3/9 o'clock,
  // which sits at cx ± (maxR + 32) - text extending widestLabel away from
  // anchor. Required: cx - (maxR + 32) ≥ widestLabel → maxR ≤ cx - 32 - W.
  // We use widestLabel + 20 as a soft pad - 20px for the labelR offset and a
  // bit of breathing room - relying on the fact that the widest labels are
  // diagonal (not at 3/9 exactly) so they have a bit more room than worst case.
  var pad = Math.min(Math.max(50, widestLabel + 20), size / 2 * 0.5);
  var maxR = size / 2 - pad;

  // Angle for each vertex (start from top)
  function angle(idx) { return (Math.PI * 2 * idx / n) - Math.PI / 2; }
  function point(idx, radius) {
    var a = angle(idx);
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  }

  ctx.clearRect(0, 0, size, size);

  // Read CSS tokens so the radar adapts to light/dark mode automatically.
  var rootStyle = getComputedStyle(document.body);
  var gridColour = rootStyle.getPropertyValue('--border').trim() || '#e0e0e0';
  var labelColour = rootStyle.getPropertyValue('--primary').trim() || '#262626';
  var bgColour = rootStyle.getPropertyValue('--bg').trim() || '#fff';

  // Draw grid lines at 25, 50, 75, 100
  var levels = [25, 50, 75, 100];
  for (var li = 0; li < levels.length; li++) {
    var r = (levels[li] / 100) * maxR;
    ctx.beginPath();
    for (var vi = 0; vi < n; vi++) {
      var pt = point(vi, r);
      if (vi === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = gridColour;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw axis lines
  for (var ai = 0; ai < n; ai++) {
    var ep = point(ai, maxR);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ep.x, ep.y);
    ctx.strokeStyle = gridColour;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw data polygon
  ctx.beginPath();
  for (var di = 0; di < n; di++) {
    var dr = (scores[di] / 100) * maxR;
    var dp = point(di, dr);
    if (di === 0) ctx.moveTo(dp.x, dp.y);
    else ctx.lineTo(dp.x, dp.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(245,131,33,0.2)';
  ctx.fill();
  ctx.strokeStyle = '#f58321';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw data points
  for (var pi = 0; pi < n; pi++) {
    var pr = (scores[pi] / 100) * maxR;
    var pp = point(pi, pr);
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f58321';
    ctx.fill();
    // Point outline matches page bg so it reads in both light + dark
    ctx.strokeStyle = bgColour;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var ti = 0; ti < n; ti++) {
    var labelR = maxR + 32;
    var lp = point(ti, labelR);
    // Adjust alignment based on position
    var a = angle(ti);
    if (Math.cos(a) > 0.3) ctx.textAlign = 'left';
    else if (Math.cos(a) < -0.3) ctx.textAlign = 'right';
    else ctx.textAlign = 'center';

    ctx.font = '600 12px Lato, sans-serif';
    ctx.fillStyle = labelColour;
    ctx.fillText(radarLabels[ti], lp.x, lp.y - 8);
    ctx.font = '700 13px "Bricolage Grotesque", sans-serif';
    ctx.fillStyle = scoreColour(scores[ti]);
    ctx.fillText(scores[ti] + '%', lp.x, lp.y + 8);
    ctx.textAlign = 'center'; // reset
  }
}

// ── Section 3: Most Recent Mock Test ──
//
// This optional section is scoped to a single formal mock test: the most
// recent one. Lesson and quiz data stay in the learner-facing plan above.
//
// When no mock test has been completed yet, we show a single empty-state
// prompt with a link to the mock-test page.
function renderSkillBreakdown() {
  var CC = window.CC_COMPETENCY;
  var container = document.getElementById('skill-breakdown');
  var metaEl = document.getElementById('recent-mock-meta');

  // Empty state - no mock test yet
  if (!recentMockMeta) {
    if (metaEl) metaEl.textContent = '';
    container.innerHTML =
      '<div class="mock-empty">' +
        '<p class="mock-empty-msg">You have not completed a formal mock test yet.</p>' +
        '<p class="mock-empty-sub">Take one when you want test-style detail alongside your practice plan.</p>' +
        '<a href="/learner/mock-test.html" class="btn-primary">Take a mock test</a>' +
      '</div>';
    return;
  }

  // Date stamp in the section heading
  if (metaEl) {
    var d = new Date(recentMockMeta.completed_at);
    var now = new Date();
    var diffMs = now - d;
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    var dateLabel;
    if (diffDays === 0) dateLabel = 'Today';
    else if (diffDays === 1) dateLabel = 'Yesterday';
    else if (diffDays < 7) dateLabel = diffDays + ' days ago';
    else if (diffDays < 14) dateLabel = 'Last week';
    else dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
    var resultLabel = recentMockMeta.result === 'pass' ? 'Passed' : recentMockMeta.result === 'fail' ? 'Failed' : '';
    metaEl.textContent = dateLabel + (resultLabel ? ' · ' + resultLabel : '');
  }

  var html = '';
  for (var a = 0; a < CC.AREAS.length; a++) {
    var area = CC.AREAS[a];
    var skills = CC.getSkillsByArea(area.id);
    var parentSkill = skills[0];

    // Total faults for this area on the most recent mock = parent-level totals
    // PLUS the sum of any per-sub-skill faults attached under it.
    var headlineFaults = { driving: 0, serious: 0, dangerous: 0 };
    if (parentSkill && recentSkillFaultMap[parentSkill.key]) {
      var rsf = recentSkillFaultMap[parentSkill.key];
      headlineFaults.driving   += rsf.driving;
      headlineFaults.serious   += rsf.serious;
      headlineFaults.dangerous += rsf.dangerous;
    }
    if (parentSkill && subFaultMap[parentSkill.key]) {
      var subKeys = Object.keys(subFaultMap[parentSkill.key]);
      for (var sk = 0; sk < subKeys.length; sk++) {
        var sfd = subFaultMap[parentSkill.key][subKeys[sk]];
        headlineFaults.driving   += sfd.driving;
        headlineFaults.serious   += sfd.serious;
        headlineFaults.dangerous += sfd.dangerous;
      }
    }
    var totalFaults = headlineFaults.driving + headlineFaults.serious + headlineFaults.dangerous;
    var areaStatus;  // 'clean' | 'fail-light' | 'fail-heavy'
    if (totalFaults === 0) {
      areaStatus = 'clean';
    } else if (headlineFaults.serious > 0 || headlineFaults.dangerous > 0) {
      areaStatus = 'fail-heavy';
    } else {
      areaStatus = 'fail-light';
    }

    // ── Header ──
    html += '<div class="area-card mock-area-' + areaStatus + '">';
    html += '<div class="area-header" data-action="toggle-area">';
    html += '<span class="area-icon">' + area.icon + '</span>';
    html += '<span class="area-name">' + area.label + '</span>';
    // Headline summary on the right - fault breakdown or "Clean"
    if (totalFaults > 0) {
      var parts = [];
      if (headlineFaults.driving > 0)   parts.push('<span class="area-fault area-fault-d">D' + headlineFaults.driving + '</span>');
      if (headlineFaults.serious > 0)   parts.push('<span class="area-fault area-fault-s">S' + headlineFaults.serious + '</span>');
      if (headlineFaults.dangerous > 0) parts.push('<span class="area-fault area-fault-x">�-' + headlineFaults.dangerous + '</span>');
      html += '<span class="area-headline">' + parts.join(' ') + '</span>';
    } else {
      html += '<span class="area-headline area-headline-clean">Clean</span>';
    }
    html += '<span class="area-toggle">&#9660;</span>';
    html += '</div>';
    html += '<div class="area-body">';

    // ── Sub-skill rows ──
    if (parentSkill && parentSkill.subs && parentSkill.subs.length > 0) {
      for (var ss = 0; ss < parentSkill.subs.length; ss++) {
        var sub = parentSkill.subs[ss];
        var subFault = subFaultMap[parentSkill.key] && subFaultMap[parentSkill.key][sub.key];
        var rowClass = 'sub-skill-row';
        var mockCellHtml;
        if (subFault && (subFault.driving > 0 || subFault.serious > 0 || subFault.dangerous > 0)) {
          var subParts = [];
          if (subFault.driving > 0)   subParts.push('<span class="sub-skill-fault sub-skill-fault-d">D' + subFault.driving + '</span>');
          if (subFault.serious > 0)   subParts.push('<span class="sub-skill-fault sub-skill-fault-s">S' + subFault.serious + '</span>');
          if (subFault.dangerous > 0) subParts.push('<span class="sub-skill-fault sub-skill-fault-x">�-' + subFault.dangerous + '</span>');
          mockCellHtml = '<div class="sub-skill-mock" title="Faults on this mock test (Driving / Serious / Dangerous)">' + subParts.join(' ') + '</div>';
          rowClass += ' has-attention';
        } else {
          mockCellHtml = '<div class="sub-skill-mock sub-skill-mock-empty" title="No fault on this sub-skill"> - </div>';
        }
        html += '<div class="' + rowClass + '">';
        html += '<span class="sub-skill-name">' + sub.label + '</span>';
        html += mockCellHtml;
        html += '</div>';
      }
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}

// ── Toggle area card ──
function toggleArea(headerEl) {
  var body = headerEl.nextElementSibling;
  var toggle = headerEl.querySelector('.area-toggle');
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

// ── Section 4: Mock Test Results ──
function renderMockHistory() {
  var CC = window.CC_COMPETENCY;
  var ms = DATA.mock_summary || {};
  var container = document.getElementById('mock-section');

  if (!ms.total_tests || ms.total_tests === 0) {
    container.innerHTML =
      '<h2 class="section-title">Mock test results</h2>' +
      '<div class="mock-card" style="text-align:center;">' +
      '<p style="color:var(--muted);margin-bottom:16px;">When you take a formal mock test, the result will appear here.</p>' +
      '<a href="/learner/mock-test.html" class="btn-primary">Take a mock test</a>' +
      '</div>';
    return;
  }

  var html = '<h2 class="section-title">Mock test results</h2>';
  html += '<div class="mock-card">';
  html += renderSignalSourceBadge('formal-mock') + renderSignalSourceBadge('instructor-assessment');
  html += '<div class="mock-pass-rate">' + (ms.passes || 0) + ' of ' + ms.total_tests + ' passed</div>';

  // Top 3 formal mock-test areas to revisit
  if (DATA.mock_faults && DATA.mock_faults.length > 0) {
    var sorted = DATA.mock_faults.slice().sort(function(a, b) {
      return totalMockMarks(b) - totalMockMarks(a);
    });
    var top3 = sorted.slice(0, 3);
    html += '<p style="font-size:0.85rem;color:var(--muted);margin-bottom:10px;font-weight:600;">Most useful areas to revisit</p>';
    html += '<ul class="mock-faults-list">';
    for (var i = 0; i < top3.length; i++) {
      var f = top3[i];
      var total = totalMockMarks(f);
      if (total === 0) continue;
      var skillObj = CC.getSkill(CC.mapLegacySkill(f.skill_key));
      var name = skillObj ? skillObj.label : f.skill_key;
      html += '<li><span class="mock-fault-name">' + name + '</span><span class="mock-fault-count">' + total + ' test mark' + (total !== 1 ? 's' : '') + '</span></li>';
    }
    html += '</ul>';
  }

  html += '<a href="/learner/mock-test.html" class="link-arrow">Take another mock test &rarr;</a>';
  html += '</div>';
  container.innerHTML = html;
}

// ── Section 1: Practise next ──
function renderNextActions() {
  var CC = window.CC_COMPETENCY;
  var container = document.getElementById('next-actions-section');
  var actions = [];
  var used = {};

  var withData = skillsWithPracticeSignals();
  withData.sort(function(a, b) { return a.score - b.score; });

  for (var i = 0; i < withData.length && actions.length < 2; i++) {
    var item = withData[i];
    used[item.skill.key] = true;
    actions.push({
      title: 'Practise ' + item.skill.label,
      copy: latestReflectionCopy(item.skill.key),
      source: latestReflectionSource(item.skill.key),
      href: '/learner/focused-practice.html',
      cta: 'Start a drive with this focus'
    });
  }

  if (DATA.mock_faults && actions.length < 3) {
    var mockRows = DATA.mock_faults.slice().sort(function(a, b) {
      return totalMockMarks(b) - totalMockMarks(a);
    });

    for (var m = 0; m < mockRows.length && actions.length < 3; m++) {
      var row = mockRows[m];
      var total = totalMockMarks(row);
      if (total === 0) continue;
      var mappedKey = CC.mapLegacySkill(row.skill_key);
      if (!mappedKey || used[mappedKey]) continue;
      var skillObj = CC.getSkill(mappedKey);
      if (!skillObj) continue;
      used[mappedKey] = true;
      actions.push({
        title: 'Revisit ' + skillObj.label,
        copy: 'Your mock test showed this is worth practising.',
        source: 'formal-mock',
        href: '/learner/focused-practice.html',
        cta: 'Start a drive on this skill'
      });
    }
  }

  if (actions.length === 0) {
    actions = [
      {
        title: 'Start your next drive',
        copy: 'Add a quick note after practice so your plan can suggest sharper next steps.',
        source: 'learner-reflection',
        href: '/learner/focused-practice.html',
        cta: 'Start a drive'
      },
      {
        title: 'Try the Examiner Quiz',
        copy: 'Use a short quiz to spot rules or routines worth asking about in your next lesson.',
        source: 'quiz-practice',
        href: '/learner/examiner-quiz.html',
        cta: 'Start quiz'
      },
      {
        title: 'Take a formal mock test',
        copy: 'When you are ready, a mock test can show what test-day practice should focus on.',
        source: 'formal-mock',
        href: '/learner/mock-test.html',
        cta: 'Take a mock test'
      }
    ];
  }

  var html = '<h2 class="section-title">Practise next</h2>';
  html += '<div class="plan-actions">';
  for (var a = 0; a < actions.length && a < 3; a++) {
    html += '<div class="plan-action-card">';
    html += renderSignalSourceBadge(actions[a].source || 'mixed-signal');
    html += '<div class="plan-action-title">' + actions[a].title + '</div>';
    html += '<div class="plan-action-copy">' + actions[a].copy + '</div>';
    html += '<a class="plan-action-link" href="' + actions[a].href + '">' + actions[a].cta + ' &rarr;</a>';
    html += '</div>';
  }
  html += '</div>';

  container.innerHTML = html;
}

// ── Section 3: Going well ──
function renderGoingWell() {
  var container = document.getElementById('going-well-section');
  var withData = skillsWithPracticeSignals();

  if (withData.length === 0) {
    container.innerHTML = '';
    return;
  }

  withData.sort(function(a, b) { return b.score - a.score; });
  var strong = withData.slice(0, 3);

  var html = '<h2 class="section-title">Going well</h2>';
  for (var w = 0; w < strong.length; w++) {
    var sk = strong[w].skill;
    var lessons = lessonMap[sk.key] || [];
    var quiz = quizMap[sk.key];
    var reason = 'Recent practice is building here.';
    if (lessons.length > 0) {
      var ratingLabel = getRatingLabel(lessons[0].rating);
      if (ratingLabel) reason = 'Latest note: ' + ratingLabel + '.';
    } else if (quiz && quiz.attempts > 0) {
      reason = 'Your quiz practice is helping here.';
    }

    html += '<div class="improve-card">';
    html += '<div class="improve-header">';
    html += '<span class="improve-skill">' + sk.label + '</span>';
    html += renderSignalSourceBadge(latestReflectionSource(sk.key));
    html += '</div>';
    html += '<div class="improve-suggestion">' + reason + '</div>';
    html += '</div>';
  }

  container.innerHTML = html;
}

// ── Redraw radar on resize ──
var resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    var advanced = document.getElementById('advanced-breakdown');
    if (DATA && hasAnyData() && advanced && advanced.open) renderRadar();
  }, 200);
});

var advancedBreakdown = document.getElementById('advanced-breakdown');
if (advancedBreakdown) {
  advancedBreakdown.addEventListener('toggle', function () {
    if (advancedBreakdown.open && DATA && hasAnyData()) renderRadar();
  });
}

// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'toggle-area') toggleArea(target);
});
})();
