(function () {
  'use strict';

let instructor;
let allLearners = [];
let currentSort = 'recent';
let currentCategoryFilter = 'all';
let currentDetailLearnerId = null;

const LEARNER_CATEGORY_META = {
  regular: { label: 'Regular', className: 'category-regular' },
  sporadic: { label: 'Sporadic', className: 'category-sporadic' },
  inactive: { label: 'Inactive', className: 'category-inactive' },
  passed: { label: 'Passed', className: 'category-passed' }
};

const PRACTICE_DRIVE_RATINGS = {
  nailed: 'Went well',
  ok: 'Needs practice',
  struggled: 'Tell instructor'
};

const PRACTICE_DRIVE_CATEGORIES = {
  observation: { label: 'Observation & Awareness', dl25Skills: ['mirrors', 'judgement'] },
  speed_control: { label: 'Speed & Control', dl25Skills: ['control', 'progress'] },
  junctions: { label: 'Junctions & Roundabouts', dl25Skills: ['junctions'] },
  positioning: { label: 'Road Positioning', dl25Skills: ['positioning'] },
  signals: { label: 'Signals & Communication', dl25Skills: ['signals', 'signs_signals'] },
  manoeuvres: { label: 'Manoeuvres', dl25Skills: ['manoeuvres'] },
  moving_off: { label: 'Moving Off', dl25Skills: ['move_off'] }
};

const INSTRUCTOR_SKILL_LABEL_FALLBACKS = {
  control: 'Control',
  move_off: 'Move Off',
  mirrors: 'Use of Mirrors',
  signals: 'Signals',
  junctions: 'Junctions',
  judgement: 'Judgement',
  positioning: 'Positioning',
  progress: 'Progress',
  signs_signals: 'Response to Signs / Signals',
  manoeuvres: 'Manoeuvres',
  speed_choice: 'Positioning',
  lane_choice: 'Positioning',
  lane_keeping: 'Positioning',
  stay_or_go: 'Junctions',
  roundabouts: 'Junctions',
  accelerator_12a: 'Control',
  clutch_12b: 'Control',
  gears_12c: 'Control',
  footbrake_12d: 'Control',
  parking_brake_12e: 'Control',
  steering_12f: 'Control',
  ancillary_27: 'Control',
  move_off_13: 'Move Off',
  mirrors_14: 'Use of Mirrors',
  signals_15: 'Signals',
  junctions_21: 'Junctions',
  judgement_22: 'Judgement',
  positioning_23: 'Positioning',
  clearance_16: 'Positioning',
  following_19: 'Positioning',
  normal_stop_25: 'Positioning',
  speed_18: 'Positioning',
  pedestrians_24: 'Positioning',
  awareness_26: 'Positioning',
  progress_20: 'Progress',
  signs_signals_17: 'Response to Signs / Signals',
  reverse_right_4: 'Manoeuvres',
  reverse_park_5: 'Manoeuvres',
  forward_park_8: 'Manoeuvres',
  controlled_stop_2: 'Manoeuvres',
  precautions_11: 'Positioning'
};

const INSTRUCTOR_RATING_SCORES = { nailed: 3, ok: 2, struggled: 1 };

// ── Init ──
function init() {
  const session = ccAuth.getAuth();
  if (!session) { window.location.href = '/instructor/login.html'; return; }
  instructor = session.instructor || null;
  if (instructor?.is_admin) {
    const adminTab = document.getElementById('admin-tab');
    if (adminTab) adminTab.style.display = '';
  }

  loadLearners();
}

function signOut() {
  ccAuth.logout();
}

// ── Sort ──
function setSort(mode) {
  currentSort = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sort-' + mode).classList.add('active');
  renderLearners();
}

function setCategoryFilter(mode) {
  currentCategoryFilter = mode || 'all';
  document.querySelectorAll('.category-filter-btn').forEach(b => b.classList.remove('active'));
  const active = document.querySelector('[data-category-filter="' + currentCategoryFilter + '"]');
  if (active) active.classList.add('active');
  renderLearners();
}

function sortLearners(list) {
  const sorted = [...list];
  if (currentSort === 'lessons') {
    sorted.sort((a, b) => (b.total_lessons || 0) - (a.total_lessons || 0));
  } else if (currentSort === 'name') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    sorted.sort((a, b) => (b.last_lesson_date || '').localeCompare(a.last_lesson_date || ''));
  }
  return sorted;
}

// ── Load learners ──
async function loadLearners() {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=my-learners');
    const data = await res.json();
    if (res.status === 401) { signOut(); return; }
    if (!res.ok) throw new Error(data.error);
    allLearners = data.learners || [];
    renderLearners();
  } catch (err) {
    document.getElementById('learners-list').innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:24px">Failed to load learners.<br><button data-action="load-learners" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>';
  }
}

function renderLearners() {
  const container = document.getElementById('learners-list');
  const search = (document.getElementById('learner-search')?.value || '').toLowerCase();

  let filtered = allLearners;
  if (search) {
    filtered = filtered.filter(l =>
      (l.name || '').toLowerCase().includes(search) ||
      (l.email || '').toLowerCase().includes(search) ||
      (l.phone || '').toLowerCase().includes(search)
    );
  }
  if (currentCategoryFilter !== 'all') {
    filtered = filtered.filter(l => l.learner_category === currentCategoryFilter);
  }

  filtered = sortLearners(filtered);

  document.getElementById('learner-count').textContent =
    filtered.length + (filtered.length === 1 ? ' learner' : ' learners');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state-icon">&#x1F465;</div>
        <h2>${search ? 'No matching learners' : 'No learners yet'}</h2>
        <p>${search ? 'Try a different search term.' : 'Learners assigned to you or booked with you will appear here.'}</p>
      </div>`;
    return;
  }

  const tierLabels = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };

  container.innerHTML = filtered.map(l => {
    const tier = l.current_tier || 1;
    const stats = [];
    stats.push('<strong>' + l.total_lessons + '</strong> ' + (l.total_lessons === 1 ? 'lesson' : 'lessons'));
    if (l.completed_lessons) stats.push('<strong>' + l.completed_lessons + '</strong> completed');
    if (l.upcoming_lessons) stats.push('<strong>' + l.upcoming_lessons + '</strong> upcoming');

    const contact = [];
    if (l.phone) contact.push('<a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a>');
    if (l.email) contact.push('<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>');
    if (l.pickup_address) contact.push('<span>Pickup: ' + esc(l.pickup_address) + '</span>');

    // Test date badge
    let testBadge = '';
    if (l.test_date) {
      const td = new Date(l.test_date + 'T00:00:00Z');
      const testLabel = td.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      testBadge = '<span class="test-date-badge">Test: ' + testLabel + '</span>';
    }

    // Custom rate badge
    let rateBadge = '';
    if (l.custom_hourly_rate_pence) {
      rateBadge = '<span class="test-date-badge" style="background:var(--accent-lt);color:var(--accent)">£' + (l.custom_hourly_rate_pence / 100).toFixed(0) + '/hr</span>';
    }

    const category = LEARNER_CATEGORY_META[l.learner_category] || null;
    const categoryBadge = category
      ? '<span class="learner-category-badge ' + category.className + '">' + category.label + '</span>'
      : '';

    // Notes preview
    let notesPreview = '';
    if (l.instructor_notes) {
      const preview = l.instructor_notes.length > 60 ? l.instructor_notes.slice(0, 60) + '…' : l.instructor_notes;
      notesPreview = '<div class="learner-notes-preview">' + esc(preview) + '</div>';
    }

    // Free-times chips (weekly availability — empty string if learner hasn't set any)
    const ftChips = renderFreeTimesChips(l.availability);
    const freeTimesRow = ftChips
      ? '<div class="learner-freetimes"><span class="learner-freetimes-label">Free</span>' + ftChips + '</div>'
      : '';

    return `
      <div class="learner-card fade-in" style="cursor:pointer" data-action="open-learner" data-learner-id="${l.id}">
        <div class="learner-card-top">
          <span class="learner-name">${esc(l.name || 'Unnamed')}${l.prefer_contact_before ? '<span class="contact-pref-badge">Contact first</span>' : ''}${categoryBadge}${testBadge}${rateBadge}</span>
          <span class="tier-badge tier-${tier}">${tierLabels[tier] || 'Tier ' + tier}</span>
        </div>
        <div class="learner-stats">
          ${stats.join(' &middot; ')}
          ${l.last_lesson_date ? ' &middot; Last: ' + formatDate(l.last_lesson_date) : ''}
        </div>
        <div class="learner-contact">
          ${contact.join(' &middot; ')}
        </div>
        ${freeTimesRow}
        ${notesPreview}
      </div>`;
  }).join('');
}

// ── Detail view ──
async function openLearner(id) {
  currentDetailLearnerId = id;
  document.getElementById('list-view').style.display = 'none';
  const dv = document.getElementById('detail-view');
  dv.classList.add('show');
  dv.querySelector('#detail-content').innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px">Loading...</div>';
  window.scrollTo(0, 0);

  try {
    // Fetch history, notes, and mock tests in parallel
    const [historyRes, notesRes, mockRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/instructor?action=learner-history&learner_id=' + id),
      ccAuth.fetchAuthed('/api/instructor?action=learner-notes&learner_id=' + id),
      ccAuth.fetchAuthed('/api/instructor?action=learner-mock-tests&learner_id=' + id)
    ]);
    const historyData = await historyRes.json();
    if (historyRes.status === 401) { signOut(); return; }
    if (!historyRes.ok) throw new Error(historyData.error);

    let notesData = { notes: '', test_date: null };
    if (notesRes.ok) notesData = await notesRes.json();

    let mockData = { mock_tests: [] };
    if (mockRes.ok) mockData = await mockRes.json();

    renderDetail(historyData, notesData, mockData);
  } catch (err) {
    dv.querySelector('#detail-content').innerHTML = '<div style="color:var(--red);padding:24px;text-align:center">Failed to load learner details.<br><button data-action="open-learner" data-learner-id="' + id + '" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>';
  }
}

function parseSupervisorNotes(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (e) { return null; }
  }
  return typeof value === 'object' ? value : null;
}

function renderSupervisorNotes(value) {
  var data = parseSupervisorNotes(value);
  var categories = data && data.summary && data.summary.categories ? data.summary.categories : null;
  if (!categories) return '';

  var rows = Object.keys(categories).map(function(key) {
    var item = categories[key] || {};
    var hints = Array.isArray(item.selected_hints) ? item.selected_hints.filter(Boolean) : [];
    var note = item.note || '';
    if (hints.length === 0 && !note) return '';

    var category = getPracticeDriveCategory(key);
    var label = item.label || (category && category.label) || getInstructorSkillLabel(key);
    var rating = item.rating ? item.rating.replace(/_/g, ' ') : '';
    var html = '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.8rem;color:var(--text);">';
    html += '<div style="font-weight:700;">' + esc(label) + (rating ? ' <span style="color:var(--muted);font-weight:600;">(' + esc(rating) + ')</span>' : '') + '</div>';
    if (hints.length) {
      html += '<ul style="margin:4px 0 0 18px;padding:0;color:var(--muted);">';
      hints.forEach(function(hint) { html += '<li>' + esc(hint) + '</li>'; });
      html += '</ul>';
    }
    if (note) html += '<div style="margin-top:4px;color:var(--muted);font-style:italic;">' + esc(note) + '</div>';
    html += '</div>';
    return html;
  }).filter(Boolean);

  if (rows.length === 0) return '';
  return '<div style="margin-top:8px;"><div style="font-size:0.76rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.03em;">Supervisor notes</div>' + rows.join('') + '</div>';
}

function parsePracticeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }
  return value;
}

function formatRawSkillLabel(skillKey) {
  return String(skillKey || '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getInstructorSkillLabel(skillKey) {
  if (!skillKey) return '';

  if (window.CC_COMPETENCY && typeof window.CC_COMPETENCY.getSkill === 'function') {
    const mapped = typeof window.CC_COMPETENCY.mapLegacySkill === 'function'
      ? window.CC_COMPETENCY.mapLegacySkill(skillKey)
      : skillKey;
    if (mapped) {
      const skill = window.CC_COMPETENCY.getSkill(mapped);
      if (skill && skill.label) return skill.label;
      if (INSTRUCTOR_SKILL_LABEL_FALLBACKS[mapped]) return INSTRUCTOR_SKILL_LABEL_FALLBACKS[mapped];
    }
  }

  if (INSTRUCTOR_SKILL_LABEL_FALLBACKS[skillKey]) return INSTRUCTOR_SKILL_LABEL_FALLBACKS[skillKey];
  return formatRawSkillLabel(skillKey);
}

function instructorSourceLabel(sourceKey) {
  const labels = {
    'lesson-log': 'Lesson log',
    'learner-reflection': 'Learner reflection',
    'practice-drive': 'Practice Drive',
    'supervisor-reflection': 'Supervisor reflection',
    'quiz-practice': 'Quiz practice',
    'formal-mock': 'Formal mock',
    'instructor-assessment': 'Instructor assessment',
    'mixed-signals': 'Mixed signals'
  };
  return labels[sourceKey] || 'Progress signal';
}

function renderInstructorSourceBadge(sourceKey) {
  return '<span class="signal-source-badge source-' + esc(sourceKey) + '">' +
    esc(instructorSourceLabel(sourceKey)) +
    '</span>';
}

function getPracticeDriveCategory(key) {
  if (window.CC_COMPETENCY && typeof window.CC_COMPETENCY.getSupervisorCategory === 'function') {
    const shared = window.CC_COMPETENCY.getSupervisorCategory(key);
    if (shared) return shared;
  }
  return PRACTICE_DRIVE_CATEGORIES[key] || null;
}

function getPracticeSkillLabel(skillKey) {
  return getInstructorSkillLabel(skillKey);
}

function practiceDriveRatingLabel(ratingKey) {
  return PRACTICE_DRIVE_RATINGS[ratingKey] || ratingKey || 'Saved';
}

function formatPracticeDriveDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function summarizePracticeDrive(row) {
  let focusAreas = parsePracticeJson(row.focus_areas, []);
  const reflections = parsePracticeJson(row.reflections, {}) || {};
  const areas = [];
  let tellInstructorCount = 0;
  let note = '';

  if (!Array.isArray(focusAreas)) focusAreas = [];

  focusAreas.forEach(key => {
    const cat = getPracticeDriveCategory(key);
    if (!cat) return;
    const skillRefs = (cat.dl25Skills || [])
      .map(skillKey => reflections[skillKey])
      .filter(ref => ref && typeof ref === 'object');

    let ratingKey = null;
    if (skillRefs.some(ref => ref.rating === 'struggled')) ratingKey = 'struggled';
    else if (skillRefs.some(ref => ref.rating === 'ok')) ratingKey = 'ok';
    else if (skillRefs.some(ref => ref.rating === 'nailed')) ratingKey = 'nailed';

    const areaNote = (skillRefs.find(ref => ref.note) || {}).note || '';
    if (areaNote && (!note || ratingKey === 'struggled')) note = areaNote;
    if (ratingKey === 'struggled') tellInstructorCount++;

    areas.push({
      label: cat.label,
      ratingKey,
      ratingLabel: practiceDriveRatingLabel(ratingKey),
      tellInstructor: ratingKey === 'struggled'
    });
  });

  if (areas.length === 0) {
    Object.keys(reflections).slice(0, 3).forEach(skillKey => {
      const ref = reflections[skillKey] || {};
      if (ref.note && !note) note = ref.note;
      if (ref.rating === 'struggled') tellInstructorCount++;
      areas.push({
        label: getPracticeSkillLabel(skillKey),
        ratingKey: ref.rating,
        ratingLabel: practiceDriveRatingLabel(ref.rating),
        tellInstructor: ref.rating === 'struggled'
      });
    });
  }

  return {
    dateLabel: formatPracticeDriveDate(row.completed_at || row.created_at || row.session_date),
    durationMinutes: row.duration_minutes || 0,
    areas,
    note,
    tellInstructorCount
  };
}

function renderPrivatePracticeSummaries(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';

  let html = '<div class="section-title" style="margin-top:24px">Recent Private Practice</div>';
  html += '<div style="display:flex;flex-direction:column;gap:8px;">';
  rows.slice(0, 5).map(summarizePracticeDrive).forEach(item => {
    const meta = [];
    if (item.dateLabel) meta.push(item.dateLabel);
    if (item.durationMinutes) meta.push(item.durationMinutes + ' min');
    if (item.tellInstructorCount > 0) meta.push('Tell instructor ' + item.tellInstructorCount);

    html += '<div style="background:var(--surface);border:1px solid var(--border);' +
      (item.tellInstructorCount > 0 ? 'border-left:3px solid var(--red);' : '') +
      'border-radius:10px;padding:12px 16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;">';
    html += '<div><div style="font-weight:700;font-size:0.9rem;">Practice Drive</div>' +
      renderInstructorSourceBadge('supervisor-reflection') + '</div>';
    html += '<div style="font-size:0.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">' + esc(meta.join(' / ')) + '</div>';
    html += '</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    item.areas.forEach(area => {
      html += '<span style="display:inline-flex;padding:3px 8px;border-radius:4px;border:1px solid ' +
        (area.tellInstructor ? 'var(--red)' : 'var(--border)') + ';color:' +
        (area.tellInstructor ? 'var(--red)' : 'var(--muted)') +
        ';font-size:0.72rem;font-weight:700;">' + esc(area.label + ': ' + area.ratingLabel) + '</span>';
    });
    html += '</div>';
    if (item.note) {
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);font-size:0.82rem;color:var(--muted);line-height:1.45;">' +
        esc(item.note).slice(0, 320).replace(/\n/g, '<br>') +
        '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function mockTestTeachingSummary(mt) {
  if (!mt) return { label: 'No completed mock yet', meta: '' };

  const date = mt.completed_at ? formatPracticeDriveDate(mt.completed_at) : '';
  if (mt.mode === 'supervisor') {
    let good = 0, needs = 0, concern = 0;
    const seen = {};
    (mt.faults || []).forEach(f => {
      const key = f.skill_key + '_' + f.part;
      if (seen[key]) return;
      seen[key] = true;
      if (f.supervisor_rating === 'good') good++;
      else if (f.supervisor_rating === 'needs_work') needs++;
      else if (f.supervisor_rating === 'concern') concern++;
    });
    return {
      label: 'Supervisor mock: ' + good + ' went well, ' + needs + ' needs work, ' + concern + ' concern',
      meta: date
    };
  }

  const result = mt.result ? String(mt.result).toUpperCase() : 'Recorded';
  const faults = mt.total_driving_faults != null
    ? Number(mt.total_driving_faults || 0) + 'D ' + Number(mt.total_serious_faults || 0) + 'S ' + Number(mt.total_dangerous_faults || 0) + 'X'
    : '';
  return { label: result, meta: [date, faults].filter(Boolean).join(' / ') };
}

function addTeachingFocus(scores, skillKey, weight) {
  if (!skillKey || !weight) return;
  const label = getInstructorSkillLabel(skillKey);
  if (!label) return;
  if (!scores[label]) scores[label] = { label, score: 0 };
  scores[label].score += weight;
}

function collectTeachingFocusAreas(historyData, mockData) {
  const scores = {};
  const latestMock = ((mockData && mockData.mock_tests) || [])[0] || null;

  if (latestMock && Array.isArray(latestMock.faults)) {
    latestMock.faults.forEach(f => {
      const formalWeight = Number(f.dangerous_faults || 0) * 6 +
        Number(f.serious_faults || 0) * 4 +
        Number(f.driving_faults || 0);
      if (formalWeight > 0) addTeachingFocus(scores, f.skill_key, formalWeight);
      if (f.supervisor_rating === 'concern') addTeachingFocus(scores, f.skill_key, 4);
      else if (f.supervisor_rating === 'needs_work') addTeachingFocus(scores, f.skill_key, 2);
    });
  }

  ((historyData && historyData.private_practice) || []).slice(0, 3).forEach(row => {
    const reflections = parsePracticeJson(row.reflections, {}) || {};
    Object.keys(reflections).forEach(skillKey => {
      const ref = reflections[skillKey] || {};
      if (ref.rating === 'struggled') addTeachingFocus(scores, skillKey, 4);
      else if (ref.rating === 'ok') addTeachingFocus(scores, skillKey, 1);
    });
  });

  ((historyData && historyData.bookings) || []).slice(0, 5).forEach(booking => {
    (booking.learner_ratings || []).forEach(rating => {
      if (rating.rating === 'struggled') addTeachingFocus(scores, rating.skill_key, 3);
      else if (rating.rating === 'ok') addTeachingFocus(scores, rating.skill_key, 1);
    });
  });

  return Object.keys(scores)
    .map(key => scores[key])
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function summarizePracticeSignal(historyData) {
  const rows = (historyData && historyData.private_practice) || [];
  if (!rows.length) return { label: 'No Practice Drive yet', note: '', flagged: false };

  const latest = summarizePracticeDrive(rows[0]);
  return {
    label: latest.tellInstructorCount > 0
      ? 'Tell instructor flagged'
      : (latest.dateLabel ? 'Latest Practice Drive: ' + latest.dateLabel : 'Latest Practice Drive'),
    note: latest.note || '',
    flagged: latest.tellInstructorCount > 0
  };
}

function summarizeLessonTrend(historyData) {
  const scores = [];
  ((historyData && historyData.bookings) || []).forEach(booking => {
    (booking.learner_ratings || []).forEach(rating => {
      if (INSTRUCTOR_RATING_SCORES[rating.rating]) scores.push(INSTRUCTOR_RATING_SCORES[rating.rating]);
    });
  });

  if (scores.length < 4) return 'More lesson data needed';
  const recent = scores.slice(0, 3);
  const previous = scores.slice(3, 6);
  if (previous.length === 0) return 'More lesson data needed';
  const avg = list => list.reduce((sum, value) => sum + value, 0) / list.length;
  const delta = avg(recent) - avg(previous);
  if (delta >= 0.35) return 'Improving';
  if (delta <= -0.35) return 'Needs attention';
  return 'Steady';
}

function summarizeLearnerTeachingSignals(historyData, notesData, mockData) {
  const mocks = ((mockData && mockData.mock_tests) || []).slice().sort((a, b) => {
    const bd = new Date(b.completed_at || b.started_at || 0).getTime();
    const ad = new Date(a.completed_at || a.started_at || 0).getTime();
    return bd - ad;
  });

  return {
    latestMock: mockTestTeachingSummary(mocks[0] || null),
    focusAreas: collectTeachingFocusAreas(historyData, { mock_tests: mocks }),
    practice: summarizePracticeSignal(historyData),
    testDate: notesData && notesData.test_date ? formatDate(notesData.test_date) : '',
    trend: summarizeLessonTrend(historyData)
  };
}

function renderTeachingSummary(summary) {
  const focus = summary.focusAreas.length
    ? summary.focusAreas.map(item => '<span class="skill-pill skill-ok">' + esc(item.label) + '</span>').join('')
    : '<span style="font-size:0.82rem;color:var(--muted);">No clear focus yet</span>';

  let html = '<div class="section-title" style="margin-top:20px">Teaching summary</div>';
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;">';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">';
  html += '<div>' + renderInstructorSourceBadge('formal-mock') + renderInstructorSourceBadge('instructor-assessment') + '<div style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Latest mock</div><div style="font-size:0.9rem;font-weight:700;">' + esc(summary.latestMock.label) + '</div>';
  if (summary.latestMock.meta) html += '<div style="font-size:0.76rem;color:var(--muted);margin-top:2px;">' + esc(summary.latestMock.meta) + '</div>';
  html += '</div>';
  html += '<div>' + renderInstructorSourceBadge('mixed-signals') + '<div style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Current focus</div><div class="skill-pills" style="margin-top:5px;">' + focus + '</div></div>';
  html += '<div>' + renderInstructorSourceBadge('practice-drive') + renderInstructorSourceBadge('supervisor-reflection') + '<div style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Practice Drive</div><div style="font-size:0.9rem;font-weight:700;color:' + (summary.practice.flagged ? 'var(--red)' : 'var(--primary)') + ';">' + esc(summary.practice.label) + '</div>';
  if (summary.practice.note) html += '<div style="font-size:0.78rem;color:var(--muted);margin-top:2px;line-height:1.35;">' + esc(summary.practice.note).slice(0, 140).replace(/\n/g, '<br>') + '</div>';
  html += '</div>';
  html += '<div><div style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Test / trend</div><div style="font-size:0.9rem;font-weight:700;">' + esc(summary.testDate || 'No test date') + '</div><div style="font-size:0.76rem;color:var(--muted);margin-top:2px;">' + esc(summary.trend) + '</div></div>';
  html += '</div></div>';
  return html;
}

function parseInstructorAlertDate(value) {
  if (!value) return null;
  const text = String(value);
  const d = new Date(text.length === 10 ? text + 'T00:00:00Z' : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetweenDates(fromDate, toDate) {
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
}

function alertDateValue(value) {
  const d = parseInstructorAlertDate(value);
  return d ? d.getTime() : 0;
}

function addAlertFocusSignal(map, skillKey, sourceKey, weight) {
  const label = getInstructorSkillLabel(skillKey);
  if (!label || !sourceKey || !weight) return;
  if (!map[label]) map[label] = { label, score: 0, sources: {} };
  map[label].score += weight;
  map[label].sources[sourceKey] = true;
}

function collectInstructorAlertFocus(historyData, mockData) {
  const map = {};

  ((historyData && historyData.bookings) || []).slice(0, 8).forEach(booking => {
    (booking.learner_ratings || []).forEach(rating => {
      if (rating.rating === 'struggled') addAlertFocusSignal(map, rating.skill_key, 'learner-reflection', 3);
      else if (rating.rating === 'ok') addAlertFocusSignal(map, rating.skill_key, 'learner-reflection', 1);
    });
  });

  ((historyData && historyData.private_practice) || []).slice(0, 5).forEach(row => {
    const reflections = parsePracticeJson(row.reflections, {}) || {};
    Object.keys(reflections).forEach(skillKey => {
      const ref = reflections[skillKey] || {};
      if (ref.rating === 'struggled') addAlertFocusSignal(map, skillKey, 'practice-drive', 4);
      else if (ref.rating === 'ok') addAlertFocusSignal(map, skillKey, 'practice-drive', 1);
    });
  });

  ((mockData && mockData.mock_tests) || []).slice(0, 3).forEach(mt => {
    const sourceKey = mt.mode === 'instructor' ? 'instructor-assessment' : 'formal-mock';
    (mt.faults || []).forEach(f => {
      const weight = Number(f.dangerous_faults || 0) * 6 +
        Number(f.serious_faults || 0) * 4 +
        Number(f.driving_faults || 0);
      if (weight > 0) {
        addAlertFocusSignal(map, f.skill_key, sourceKey, weight);
        if (mt.mode === 'instructor') addAlertFocusSignal(map, f.skill_key, 'formal-mock', 1);
      }
      if (f.supervisor_rating === 'concern') addAlertFocusSignal(map, f.skill_key, 'supervisor-reflection', 4);
      else if (f.supervisor_rating === 'needs_work') addAlertFocusSignal(map, f.skill_key, 'supervisor-reflection', 2);
    });
  });

  return Object.keys(map)
    .map(key => map[key])
    .filter(item => Object.keys(item.sources).length >= 2 || item.score >= 6)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function latestInstructorActivityDate(historyData) {
  const dates = [];
  ((historyData && historyData.bookings) || []).forEach(booking => {
    if (booking.status === 'chargeable' || booking.session_log_id) {
      dates.push(alertDateValue(booking.scheduled_date));
    }
  });
  ((historyData && historyData.private_practice) || []).forEach(row => {
    dates.push(alertDateValue(row.completed_at || row.created_at || row.session_date));
  });
  const latest = Math.max.apply(null, dates.filter(Boolean));
  return latest > 0 ? new Date(latest) : null;
}

function latestFormalInstructorMock(mockData) {
  const mocks = ((mockData && mockData.mock_tests) || [])
    .filter(mt => mt && mt.mode === 'instructor' && mt.completed_at)
    .sort((a, b) => alertDateValue(b.completed_at || b.started_at) - alertDateValue(a.completed_at || a.started_at));
  return mocks[0] || null;
}

function buildInstructorAlerts(historyData, notesData, mockData) {
  const alerts = [];
  const now = new Date();

  const tellCounts = {};
  ((historyData && historyData.private_practice) || []).slice(0, 5).forEach(row => {
    const reflections = parsePracticeJson(row.reflections, {}) || {};
    Object.keys(reflections).forEach(skillKey => {
      const ref = reflections[skillKey] || {};
      if (ref.rating !== 'struggled') return;
      const label = getInstructorSkillLabel(skillKey);
      if (!label) return;
      tellCounts[label] = (tellCounts[label] || 0) + 1;
    });
  });
  const repeatedTell = Object.keys(tellCounts)
    .map(label => ({ label, count: tellCounts[label] }))
    .filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
  if (repeatedTell) {
    alerts.push({
      tone: 'attention',
      title: 'Practice Drive flagged ' + repeatedTell.label,
      copy: 'Worth asking about this next lesson. It has been marked Tell instructor ' + repeatedTell.count + ' times in recent Practice Drive reflections.',
      sources: ['practice-drive', 'supervisor-reflection']
    });
  }

  const testDate = parseInstructorAlertDate(notesData && notesData.test_date);
  if (testDate) {
    const daysToTest = daysBetweenDates(now, testDate);
    const latestMock = latestFormalInstructorMock(mockData);
    const daysSinceMock = latestMock ? daysBetweenDates(parseInstructorAlertDate(latestMock.completed_at), now) : null;
    if (daysToTest >= 0 && daysToTest <= 28 && (!latestMock || daysSinceMock > 42)) {
      alerts.push({
        tone: 'planning',
        title: 'Consider a formal mock',
        copy: 'Test date is soon and there is no recent instructor formal mock recorded.',
        sources: ['formal-mock', 'instructor-assessment']
      });
    }
  }

  const latestActivity = latestInstructorActivityDate(historyData);
  if (!latestActivity || daysBetweenDates(latestActivity, now) >= 14) {
    alerts.push({
      tone: 'quiet',
      title: 'No recent saved practice',
      copy: 'Worth checking whether they have practised recently or need a clearer focus before the next lesson.',
      sources: ['learner-reflection', 'practice-drive']
    });
  }

  const repeatedFocus = collectInstructorAlertFocus(historyData, mockData)[0];
  if (repeatedFocus) {
    const sourceKeys = Object.keys(repeatedFocus.sources);
    alerts.push({
      tone: 'focus',
      title: 'Repeated focus: ' + repeatedFocus.label,
      copy: 'Signals from ' + sourceKeys.map(instructorSourceLabel).join(', ') + ' point to this as a useful next-lesson focus.',
      sources: sourceKeys
    });
  }

  return alerts.slice(0, 4);
}

function renderInstructorAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return '';

  let html = '<div class="section-title" style="margin-top:20px">Instructor alerts</div>';
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;">';
  alerts.forEach(alert => {
    const border = alert.tone === 'attention' ? 'var(--red)' : alert.tone === 'planning' ? 'var(--blue)' : 'var(--border)';
    html += '<div style="border:1px solid var(--border);border-left:3px solid ' + border + ';background:var(--white);border-radius:8px;padding:10px 12px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px;">';
    html += '<div style="font-size:0.9rem;font-weight:800;">' + esc(alert.title) + '</div>';
    html += '</div>';
    html += '<div style="font-size:0.8rem;color:var(--muted);line-height:1.4;margin-bottom:6px;">' + esc(alert.copy) + '</div>';
    html += '<div>' + (alert.sources || ['mixed-signals']).map(renderInstructorSourceBadge).join('') + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderDetail(data, notesData, mockData) {
  const l = data.learner;
  const tierLabels = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };
  const tier = l.current_tier || 1;

  // Contact info
  const info = [];
  if (l.phone) info.push('<a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a>');
  if (l.email) info.push('<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>');
  if (l.pickup_address) info.push('Pickup: ' + esc(l.pickup_address));
  if (l.prefer_contact_before) info.push('<span class="contact-pref-badge">Contact first</span>');

  // Stats
  const firstDate = data.bookings.length ? data.bookings[data.bookings.length - 1].scheduled_date : null;
  const lastDate = data.bookings.length ? data.bookings[0].scheduled_date : null;

  let html = '<div class="fade-in">';

  // Header
  html += '<div class="detail-header">';
  html += '<div class="detail-name">' + esc(l.name || 'Unnamed') + ' <span class="tier-badge tier-' + tier + '">' + (tierLabels[tier] || 'Tier ' + tier) + '</span></div>';
  if (info.length) html += '<div class="detail-info">' + info.join(' &middot; ') + '</div>';
  html += '<div style="margin-top:10px"><button data-action="offer-lesson" data-email="' + esc(l.email || '') + '" data-name="' + esc(l.name || '') + '" style="padding:8px 16px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);border-radius:8px;font-weight:700;font-size:0.82rem;cursor:pointer;transition:all 0.15s">Offer a lesson</button></div>';
  html += '</div>';

  // Stats cards
  html += '<div class="detail-stats">';
  html += '<div class="detail-stat"><div class="detail-stat-value">' + data.totalLessons + '</div><div class="detail-stat-label">Completed</div></div>';
  html += '<div class="detail-stat"><div class="detail-stat-value">' + data.bookings.length + '</div><div class="detail-stat-label">Total Bookings</div></div>';
  if (firstDate) html += '<div class="detail-stat"><div class="detail-stat-value">' + formatDate(firstDate) + '</div><div class="detail-stat-label">First Lesson</div></div>';
  if (lastDate) html += '<div class="detail-stat"><div class="detail-stat-value">' + formatDate(lastDate) + '</div><div class="detail-stat-label">Last Lesson</div></div>';
  html += '</div>';

  html += renderTeachingSummary(summarizeLearnerTeachingSignals(data, notesData, mockData));
  html += renderInstructorAlerts(buildInstructorAlerts(data, notesData, mockData));

  html += renderPrivatePracticeSummaries(data.private_practice || []);

  // Your notes section
  html += `
    <div class="detail-notes-section">
      <div class="detail-notes-title">Your Notes</div>
      <div class="detail-notes-form">
        <div class="detail-form-group">
          <label for="detail-notes-text">Notes about this learner</label>
          <textarea id="detail-notes-text" placeholder="e.g. Nervous driver, needs roundabout practice, prefers quiet routes…">${esc(notesData.notes || '')}</textarea>
        </div>
        <div class="detail-form-row">
          <div class="detail-form-group">
            <label for="detail-learner-category">Learner status</label>
            <select id="detail-learner-category">
              <option value="">Choose status</option>
              <option value="regular"${notesData.learner_category === 'regular' ? ' selected' : ''}>Regular</option>
              <option value="sporadic"${notesData.learner_category === 'sporadic' ? ' selected' : ''}>Sporadic</option>
              <option value="inactive"${notesData.learner_category === 'inactive' ? ' selected' : ''}>Inactive</option>
              <option value="passed"${notesData.learner_category === 'passed' ? ' selected' : ''}>Passed</option>
            </select>
          </div>
          <div class="detail-form-group">
            <label for="detail-test-date">Test date</label>
            <input type="date" id="detail-test-date" value="${notesData.test_date || ''}">
          </div>
          <div class="detail-form-group">
            <label for="detail-hourly-rate">Custom hourly rate</label>
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-weight:700;font-size:0.95rem">&pound;</span>
              <input type="number" id="detail-hourly-rate" min="0" step="0.50" placeholder="Default" value="${notesData.custom_hourly_rate_pence ? (notesData.custom_hourly_rate_pence / 100).toFixed(2) : ''}" style="width:100px">
              <span style="font-size:0.78rem;color:var(--muted)">/hr</span>
            </div>
            <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">Leave blank for standard school rate</div>
          </div>
        </div>
        <button class="btn-save-notes" id="save-notes-btn">Save notes</button>
      </div>
    </div>`;

  // Booking history
  html += '<div class="section-title" style="margin-top:24px">Lesson History</div>';
  if (data.bookings.length === 0) {
    html += '<div class="empty-state"><p>No lessons yet.</p></div>';
  } else {
    html += data.bookings.map(b => {
      let card = '<div class="booking-card">';
      card += '<div class="booking-card-top">';
      card += '<div><span class="booking-date">' + formatDate(b.scheduled_date) + '</span> <span class="booking-time">' + (b.start_time || '').slice(0, 5) + ' \u2013 ' + (b.end_time || '').slice(0, 5) + '</span></div>';
      card += '<span class="status-badge status-' + b.status + '">' + b.status + '</span>';
      card += '</div>';
      card += '<div>' + renderInstructorSourceBadge('lesson-log') + renderInstructorSourceBadge('learner-reflection') + '</div>';
      if (b.session_notes) {
        card += '<div class="booking-notes">' + esc(b.session_notes) + '</div>';
      }
      if (b.learner_ratings && b.learner_ratings.length > 0) {
        card += '<div class="skill-pills">';
        card += b.learner_ratings.map(r =>
          '<span class="skill-pill skill-' + r.rating + '">' + esc(getInstructorSkillLabel(r.skill_key)) + '</span>'
        ).join('');
        card += '</div>';
      }
      card += '</div>';
      return card;
    }).join('');
  }

  html += '</div>';

  // ── Mock Test History ──
  var mocks = (mockData && mockData.mock_tests) || [];
  if (mocks.length > 0) {
    html += '<div class="section-title" style="margin-top:24px">Mock Test History</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    mocks.forEach(function(mt) {
      var date = mt.completed_at ? new Date(mt.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'In progress';
      var modeLabel = mt.mode === 'supervisor' ? 'Supervisor' : mt.mode === 'instructor' ? 'Instructor' : 'Legacy';
      var modeBg = mt.mode === 'supervisor' ? '#ede9fe' : '#dbeafe';
      var modeColor = mt.mode === 'supervisor' ? '#7c3aed' : '#2563eb';

      var resultHtml = '';
      if (mt.mode === 'supervisor') {
        // Count supervisor ratings from faults
        var good = 0, nw = 0, con = 0;
        var seen = {};
        if (mt.faults) {
          mt.faults.forEach(function(f) {
            var k = f.skill_key + '_' + f.part;
            if (seen[k]) return;
            seen[k] = true;
            if (f.supervisor_rating === 'good') good++;
            else if (f.supervisor_rating === 'needs_work') nw++;
            else if (f.supervisor_rating === 'concern') con++;
          });
        }
        resultHtml = '<span style="color:#166534;font-weight:700;">' + good + ' \u2713</span> &nbsp;';
        resultHtml += '<span style="color:#b45309;font-weight:700;">' + nw + ' \u26A0</span> &nbsp;';
        resultHtml += '<span style="color:#dc2626;font-weight:700;">' + con + ' \u2716</span>';
      } else {
        var resultColor = mt.result === 'pass' ? '#166534' : '#dc2626';
        var resultBg = mt.result === 'pass' ? '#dcfce7' : '#fee2e2';
        var resultText = mt.result ? mt.result.toUpperCase() : '\u2014';
        resultHtml = '<span style="background:' + resultBg + ';color:' + resultColor + ';padding:2px 10px;border-radius:100px;font-weight:700;font-size:0.78rem;">' + resultText + '</span>';
        if (mt.total_driving_faults != null) {
          resultHtml += ' <span style="font-size:0.8rem;color:var(--muted);">' + mt.total_driving_faults + 'D ' + mt.total_serious_faults + 'S ' + mt.total_dangerous_faults + '\u2716</span>';
        }
      }

      html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
      html += '<span style="font-weight:600;font-size:0.88rem;">' + date + '</span>';
      html += '<span style="background:' + modeBg + ';color:' + modeColor + ';padding:2px 8px;border-radius:100px;font-size:0.72rem;font-weight:700;">' + modeLabel + '</span>';
      html += '</div>';
      html += '<div>' + renderInstructorSourceBadge('formal-mock') +
        (mt.mode === 'instructor' ? renderInstructorSourceBadge('instructor-assessment') : renderInstructorSourceBadge('supervisor-reflection')) +
        '</div>';
      html += '<div style="font-size:0.85rem;">' + resultHtml + '</div>';
      if (mt.notes) html += '<div style="font-size:0.82rem;color:var(--muted);margin-top:4px;font-style:italic;">' + esc(mt.notes) + '</div>';
      if (mt.mode === 'supervisor') html += renderSupervisorNotes(mt.supervisor_notes);
      html += '</div>';
    });
    html += '</div>';
  }

  document.getElementById('detail-content').innerHTML = html;
}

async function saveLearnerNotes() {
  if (!currentDetailLearnerId) return;
  const btn = document.getElementById('save-notes-btn');
  const notes = document.getElementById('detail-notes-text').value.trim();
  const testDate = document.getElementById('detail-test-date').value || null;
  const learnerCategory = document.getElementById('detail-learner-category').value || null;
  const rateInput = document.getElementById('detail-hourly-rate').value;
  const customHourlyRatePence = rateInput !== '' ? Math.round(parseFloat(rateInput) * 100) : null;

  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=update-learner-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learner_id: currentDetailLearnerId, notes: notes || null, test_date: testDate, custom_hourly_rate_pence: customHourlyRatePence, learner_category: learnerCategory })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update the cached learner in allLearners so the list view reflects changes
    const cached = allLearners.find(l => l.id === currentDetailLearnerId);
    if (cached) {
      cached.instructor_notes = notes || null;
      cached.test_date = testDate;
      cached.custom_hourly_rate_pence = customHourlyRatePence;
      cached.learner_category = learnerCategory;
    }

    showToast('Notes saved');
  } catch (err) {
    showToast(err.message || 'Failed to save notes', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save notes';
  }
}

function showList() {
  document.getElementById('detail-view').classList.remove('show');
  document.getElementById('list-view').style.display = 'block';
  renderLearners(); // re-render to pick up any notes/test date changes
}

// ── Helpers ──
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(str) {
  const d = new Date(str + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── Free-times formatter ──
// `windows` is an array of { day_of_week, start_time, end_time } with HH:MM strings.
// Returns short HTML chips like "Mon 4–6pm · Wed 5–7pm" — empty string if none.
const FT_DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FT_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
function fmtFTTime(t) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? h12 + ampm : h12 + ':' + String(m).padStart(2,'0') + ampm;
}
function renderFreeTimesChips(windows) {
  if (!windows || windows.length === 0) return '';
  // Sort Mon-Sun, then by start time
  const orderIdx = {};
  FT_DAY_ORDER.forEach((d, i) => { orderIdx[d] = i; });
  const sorted = [...windows].sort((a, b) =>
    (orderIdx[a.day_of_week] - orderIdx[b.day_of_week]) ||
    a.start_time.localeCompare(b.start_time)
  );
  return sorted.map(w =>
    '<span class="freetime-chip">' + FT_DAY_NAMES[w.day_of_week] + ' ' +
    fmtFTTime(w.start_time) + '–' + fmtFTTime(w.end_time) + '</span>'
  ).join('');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Offer Lesson (redirect to schedule page with offer modal open) ──
function offerLessonToLearner(email, name) {
  // Navigate to the schedule page with query params to open the offer modal
  let url = '/instructor/?offer=' + encodeURIComponent(email || '');
  if (name) url += '&offer_name=' + encodeURIComponent(name);
  window.location.href = url;
}

window.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'load-learners') loadLearners();
  else if (a === 'open-learner') openLearner(parseInt(t.dataset.learnerId, 10));
  else if (a === 'offer-lesson') offerLessonToLearner(t.dataset.email, t.dataset.name);
});
(function wire() {
  document.querySelectorAll('[data-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () { setSort(btn.dataset.sort); });
  });
  document.querySelectorAll('[data-category-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () { setCategoryFilter(btn.dataset.categoryFilter); });
  });
  var search = document.getElementById('learner-search');
  if (search) search.addEventListener('input', renderLearners);
  var back = document.getElementById('btn-detail-back');
  if (back) back.addEventListener('click', showList);
  document.addEventListener('click', function (e) {
    var saveBtn = e.target.closest('#save-notes-btn');
    if (saveBtn) saveLearnerNotes();
  });
})();
})();
