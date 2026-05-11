(function () {
  'use strict';

let AUTH;
let DATA = null;

// Computed maps: skillKey -> aggregated data
let lessonMap = {};   // skillKey -> [{score, date}] sorted newest first
let quizMap = {};     // skillKey -> {attempts, correct}
let mockFaultMap = {}; // skillKey -> {driving, serious, dangerous}
let skillScores = {}; // skillKey -> readiness 0-100
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

  // Build sub-skill faults map — only from most recent mock test. Used to
  // surface "attention dots" on sub-skill rows in the breakdown.
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

  // Calculate readiness scores for every skill
  skillScores = {};
  for (var s = 0; s < CC.SKILLS.length; s++) {
    var sk = CC.SKILLS[s];
    var lessonRatings = lessonMap[sk.key] || [];
    var quiz = quizMap[sk.key];
    var quizResults = [];
    if (quiz && quiz.attempts > 0) {
      // Expand into individual results for the readiness function
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
         (DATA.quiz_accuracy && DATA.quiz_accuracy.length > 0) ||
         (ms.total_tests > 0);
}

// ── Compute average readiness score for an area ──
function areaAvg(areaId) {
  var CC = window.CC_COMPETENCY;
  var skills = CC.getSkillsByArea(areaId);
  if (skills.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < skills.length; i++) sum += (skillScores[skills[i].key] || 0);
  return Math.round(sum / skills.length);
}

// ── Overall readiness: average of all skill scores ──
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

// ── Main render ──
function render() {
  document.getElementById('loading').classList.add('hidden');

  if (!hasAnyData()) {
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  document.getElementById('main-content').classList.remove('hidden');
  renderStats();
  renderRadar();
  renderSkillBreakdown();
  renderMockHistory();
  renderImprovement();

  if (typeof posthog !== 'undefined') {
    posthog.capture('progress_page_viewed', { overall_readiness: overallReadiness() });
  }
}

// ── Section 1: Stats ──
function renderStats() {
  var ss = DATA.session_stats || {};
  var ms = DATA.mock_summary || {};
  var hours = ss.total_minutes ? (ss.total_minutes / 60).toFixed(1) : '0';
  var mockText = (ms.passes || 0) + ' / ' + (ms.total_tests || 0);
  var readiness = overallReadiness();

  document.getElementById('stats-grid').innerHTML =
    '<div class="stat-card"><div class="stat-value">' + (ss.total_sessions || 0) + '</div><div class="stat-label">Sessions</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + hours + '</div><div class="stat-label">Hours</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + mockText + '</div><div class="stat-label">Mock Tests Passed</div></div>' +
    '<div class="stat-card"><div class="stat-value accent">' + readiness + '%</div><div class="stat-label">Practice level</div></div>';
}

// ── Section 2: Radar Chart ──
function renderRadar() {
  var CC = window.CC_COMPETENCY;
  var canvas = document.getElementById('radar-canvas');
  var wrap = canvas.parentElement;
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

  // Build short labels for the radar — full names like "Response to Signs /
  // Signals" don't fit on a 400px-wide canvas at 3/9 o'clock. The full label
  // remains used everywhere else (skill breakdown, examiner quiz, etc.).
  // Map full labels to compact forms for the radar only. Area IDs from
  // competency-config.js AREAS list. The longer the label, the more padding
  // it forces, shrinking the chart — so shorten the two longest.
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
  // cx ± (maxR + 32) with text aligned away from centre — so the full label
  // width must fit between the anchor and the canvas edge.
  ctx.font = '600 12px Lato, sans-serif';
  var widestLabel = 0;
  for (var w = 0; w < n; w++) {
    var tw = ctx.measureText(radarLabels[w]).width;
    if (tw > widestLabel) widestLabel = tw;
  }
  // pad needs to cover the worst case: a horizontal label at 3/9 o'clock,
  // which sits at cx ± (maxR + 32) — text extending widestLabel away from
  // anchor. Required: cx - (maxR + 32) ≥ widestLabel → maxR ≤ cx - 32 - W.
  // We use widestLabel + 20 as a soft pad — 20px for the labelR offset and a
  // bit of breathing room — relying on the fact that the widest labels are
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

// ── Section 3: Skill Breakdown ──
//
// Progressive disclosure: the closed card shows category + score. Opening
// reveals the three data sources that built that score (Mock / Lesson / Quiz)
// followed by the DL25 sub-skill list with mock-test attention dots.
//
// The header used to carry an inline summary (dot + quiz + bar + trend), but
// that was redundant with the source-row inside. Now the header is clean —
// all data lives in the open view.
function renderSkillBreakdown() {
  var CC = window.CC_COMPETENCY;
  var container = document.getElementById('skill-breakdown');
  var html = '';

  for (var a = 0; a < CC.AREAS.length; a++) {
    var area = CC.AREAS[a];
    var skills = CC.getSkillsByArea(area.id);
    var avg = areaAvg(area.id);
    var bgColour = scoreColour(avg);
    var parentSkill = skills[0];
    var pLessons = parentSkill ? (lessonMap[parentSkill.key] || []) : [];
    var pQuiz = parentSkill ? quizMap[parentSkill.key] : null;
    var pMock = parentSkill ? mockFaultMap[parentSkill.key] : null;

    // ── Header (clean — no inline summary) ──
    html += '<div class="area-card">';
    html += '<div class="area-header" data-action="toggle-area">';
    html += '<span class="area-icon">' + area.icon + '</span>';
    html += '<span class="area-name">' + area.label + '</span>';
    html += '<span class="area-badge" style="background:' + bgColour + '">' + avg + '%</span>';
    html += '<span class="area-toggle">&#9660;</span>';
    html += '</div>';
    html += '<div class="area-body">';

    // ── Source row: Mock / Lesson / Quiz ──
    html += '<div class="source-row">';

    // Mock cell — parent-level fault totals from all mock tests (instructor mode)
    html += '<div class="source-cell">';
    html += '<div class="source-label">Mock</div>';
    if (pMock && (pMock.driving > 0 || pMock.serious > 0 || pMock.dangerous > 0)) {
      var parts = [];
      if (pMock.driving > 0)   parts.push('<span class="source-fault source-fault-d">D' + pMock.driving + '</span>');
      if (pMock.serious > 0)   parts.push('<span class="source-fault source-fault-s">S' + pMock.serious + '</span>');
      if (pMock.dangerous > 0) parts.push('<span class="source-fault source-fault-x">×' + pMock.dangerous + '</span>');
      html += '<div class="source-value" title="Driving / Serious / Dangerous faults across all mock tests">' + parts.join(' ') + '</div>';
    } else if (pMock) {
      html += '<div class="source-value source-clean" title="No faults logged in mock tests">Clean</div>';
    } else {
      html += '<div class="source-value source-empty" title="No mock test recorded for this area yet">—</div>';
    }
    html += '</div>';

    // Lesson cell — latest lesson rating
    html += '<div class="source-cell">';
    html += '<div class="source-label">Lesson</div>';
    if (pLessons.length > 0) {
      var latestRating = pLessons[0].rating;
      var ratingLabel = 'Getting there';
      var ratingColour = 'var(--amber)';
      if (latestRating === 'nailed')    { ratingLabel = 'Confident';   ratingColour = 'var(--green)'; }
      if (latestRating === 'struggled') { ratingLabel = 'Needs work';  ratingColour = 'var(--red)'; }
      var titleAttr = 'Latest rating across ' + pLessons.length + ' session' + (pLessons.length === 1 ? '' : 's');
      html += '<div class="source-value" title="' + titleAttr + '">';
      html += '<span class="source-dot" style="background:' + ratingColour + '"></span>';
      html += '<span style="color:' + ratingColour + '">' + ratingLabel + '</span>';
      html += '</div>';
    } else {
      html += '<div class="source-value source-empty" title="Not rated in any logged session yet">—</div>';
    }
    html += '</div>';

    // Quiz cell — lifetime correct/attempts
    html += '<div class="source-cell">';
    html += '<div class="source-label">Quiz</div>';
    if (pQuiz && pQuiz.attempts > 0) {
      var pct = Math.round((pQuiz.correct / pQuiz.attempts) * 100);
      var pctColour = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
      html += '<div class="source-value" title="Examiner Quiz: ' + pQuiz.correct + ' correct out of ' + pQuiz.attempts + '">';
      html += '<span>' + pQuiz.correct + '/' + pQuiz.attempts + '</span>';
      html += '<span class="source-quiz-pct" style="color:' + pctColour + '">' + pct + '%</span>';
      html += '</div>';
    } else {
      html += '<div class="source-value source-empty" title="No examiner quiz attempts mapped to this area yet">—</div>';
    }
    html += '</div>';

    html += '</div>';

    // ── Sub-skill rows with mock-test attention dots ──
    if (parentSkill && parentSkill.subs && parentSkill.subs.length > 0) {
      for (var ss = 0; ss < parentSkill.subs.length; ss++) {
        var sub = parentSkill.subs[ss];
        var subFault = subFaultMap[parentSkill.key] && subFaultMap[parentSkill.key][sub.key];
        var attentionDot;
        var rowClass = 'sub-skill-row';
        if (subFault) {
          var attentionColour = (subFault.serious > 0 || subFault.dangerous > 0)
            ? 'var(--red)'
            : 'var(--amber)';
          attentionDot = '<span class="sub-skill-dot" style="background:' + attentionColour + '" title="Fault noted on most recent mock test"></span>';
          rowClass += ' has-attention';
        } else {
          attentionDot = '<span class="sub-skill-dot sub-skill-dot-quiet"></span>';
        }
        html += '<div class="' + rowClass + '">';
        html += '<span class="sub-skill-name">' + sub.label + '</span>';
        html += attentionDot;
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

// ── Section 4: Mock Test History ──
function renderMockHistory() {
  var CC = window.CC_COMPETENCY;
  var ms = DATA.mock_summary || {};
  var container = document.getElementById('mock-section');

  if (!ms.total_tests || ms.total_tests === 0) {
    container.innerHTML =
      '<h2 class="section-title">Mock Tests</h2>' +
      '<div class="mock-card" style="text-align:center;">' +
      '<p style="color:var(--muted);margin-bottom:16px;">You haven\'t taken a mock test yet.</p>' +
      '<a href="/learner/mock-test.html" class="btn-primary">Take a Mock Test</a>' +
      '</div>';
    return;
  }

  var passRate = Math.round(((ms.passes || 0) / ms.total_tests) * 100);
  var html = '<h2 class="section-title">Mock Tests</h2>';
  html += '<div class="mock-card">';
  html += '<div class="mock-pass-rate">' + (ms.passes || 0) + '/' + ms.total_tests + ' passed <span style="color:var(--muted);font-size:0.85rem;font-weight:400;">(' + passRate + '%)</span></div>';

  // Top 3 most-faulted skills
  if (DATA.mock_faults && DATA.mock_faults.length > 0) {
    var sorted = DATA.mock_faults.slice().sort(function(a, b) {
      var ta = (a.total_driving || 0) + (a.total_serious || 0) + (a.total_dangerous || 0);
      var tb = (b.total_driving || 0) + (b.total_serious || 0) + (b.total_dangerous || 0);
      return tb - ta;
    });
    var top3 = sorted.slice(0, 3);
    html += '<p style="font-size:0.85rem;color:var(--muted);margin-bottom:10px;font-weight:600;">Most-faulted skills</p>';
    html += '<ul class="mock-faults-list">';
    for (var i = 0; i < top3.length; i++) {
      var f = top3[i];
      var total = (f.total_driving || 0) + (f.total_serious || 0) + (f.total_dangerous || 0);
      if (total === 0) continue;
      var skillObj = CC.getSkill(f.skill_key);
      var name = skillObj ? skillObj.label : f.skill_key;
      html += '<li><span class="mock-fault-name">' + name + '</span><span class="mock-fault-count">' + total + ' fault' + (total !== 1 ? 's' : '') + '</span></li>';
    }
    html += '</ul>';
  }

  html += '<a href="/learner/mock-test.html" class="link-arrow">Take another mock test &rarr;</a>';
  html += '</div>';
  container.innerHTML = html;
}

// ── Section 5: Areas for Improvement ──
function renderImprovement() {
  var CC = window.CC_COMPETENCY;
  var container = document.getElementById('improve-section');

  // Find skills with some data, sorted by lowest readiness
  var withData = [];
  for (var i = 0; i < CC.SKILLS.length; i++) {
    var sk = CC.SKILLS[i];
    var hasLesson = lessonMap[sk.key] && lessonMap[sk.key].length > 0;
    var hasQuiz = quizMap[sk.key] && quizMap[sk.key].attempts > 0;
    if (hasLesson || hasQuiz) {
      withData.push({ skill: sk, score: skillScores[sk.key] || 0 });
    }
  }

  if (withData.length === 0) {
    container.innerHTML = '';
    return;
  }

  withData.sort(function(a, b) { return a.score - b.score; });
  var weak = withData.slice(0, 3);

  var html = '<h2 class="section-title">Areas for Improvement</h2>';

  for (var w = 0; w < weak.length; w++) {
    var item = weak[w];
    var sk = item.skill;
    var score = item.score;
    var reasons = [];
    var lessons = lessonMap[sk.key] || [];
    var quiz = quizMap[sk.key];

    if (lessons.length > 0) {
      var latestRating = lessons[0].rating;
      var ratingLabel = '';
      for (var r = 0; r < CC.RATINGS.length; r++) {
        if (CC.RATINGS[r].key === latestRating) { ratingLabel = CC.RATINGS[r].label; break; }
      }
      reasons.push('Last rated: ' + ratingLabel);
    }
    if (quiz && quiz.attempts > 0) {
      var qPct = Math.round((quiz.correct / quiz.attempts) * 100);
      reasons.push('Quiz accuracy: ' + qPct + '%');
    }

    var suggestion = '';
    if (!quiz || quiz.attempts === 0) {
      suggestion = '<a href="/learner/examiner-quiz.html">Try the Examiner Quiz</a> to practice this skill';
    } else if (lessons.length === 0) {
      suggestion = 'Focus on this in your <a href="/learner/log-session.html">next lesson</a>';
    } else {
      suggestion = 'Keep practising &mdash; try the <a href="/learner/examiner-quiz.html">Examiner Quiz</a> or focus in your <a href="/learner/log-session.html">next lesson</a>';
    }

    html += '<div class="improve-card">';
    html += '<div class="improve-header">';
    html += '<span class="improve-skill">' + sk.label + '</span>';
    html += '<span class="improve-score" style="background:' + scoreColour(score) + '">' + score + '%</span>';
    html += '</div>';
    if (reasons.length > 0) {
      html += '<ul class="improve-reasons">';
      for (var ri = 0; ri < reasons.length; ri++) {
        html += '<li>' + reasons[ri] + '</li>';
      }
      html += '</ul>';
    }
    html += '<div class="improve-suggestion">' + suggestion + '</div>';
    html += '</div>';
  }

  container.innerHTML = html;
}

// ── Redraw radar on resize ──
var resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    if (DATA && hasAnyData()) renderRadar();
  }, 200);
});

// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'toggle-area') toggleArea(target);
});
})();
