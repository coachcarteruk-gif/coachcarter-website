(function () {
  'use strict';

// ── Hamburger menu toggle ──
document.querySelector('.nav-menu-toggle')?.addEventListener('click', function() {
  const dd = document.querySelector('.nav-dropdown');
  const open = dd.classList.toggle('open');
  this.setAttribute('aria-expanded', open);
});
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-menu-toggle') && !e.target.closest('.nav-dropdown')) {
    document.querySelector('.nav-dropdown')?.classList.remove('open');
    document.querySelector('.nav-menu-toggle')?.setAttribute('aria-expanded', 'false');
  }
});
function logout() { ccAuth.logout(); }

// ── Skills from shared competency config ──
const CC = window.CC_COMPETENCY;
const SKILLS = CC.SKILLS;

const TOTAL_STEPS = 3;
let currentStep = 1;
let currentType = 'instructor';
let AUTH;
let bookingId = null;
let bookingData = null;
const ratings = {};
const faults = {}; // { skill_key: { driving: 0, serious: 0, dangerous: 0 } }

// ── Build skill cards grouped by competency area ──
function buildSkillCards() {
  const container = document.getElementById('skills-container');
  container.innerHTML = CC.AREAS.map(area => {
    const areaSkills = CC.getSkillsByArea(area.id);
    return `
      <div class="area-group" id="area-${area.id}">
        <div class="area-header" data-action="toggle-area" data-area-id="${area.id}">
          <span class="area-icon">${area.icon}</span>
          <span class="area-label">${area.label}</span>
          <span class="area-count" id="area-count-${area.id}">0/${areaSkills.length}</span>
          <span class="area-chevron"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></span>
        </div>
        <div class="area-skills">
          ${areaSkills.map(s => `
            <div class="skill-card" id="card-${s.key}">
              <div class="skill-label">${s.label}</div>
              <div class="tl-row">
                <button class="tl-btn" data-val="struggled" data-action="rate" data-skill="${s.key}" data-rating="struggled">
                  <span class="tl-dot"></span>
                  <span class="tl-label">Needs work</span>
                </button>
                <button class="tl-btn" data-val="ok" data-action="rate" data-skill="${s.key}" data-rating="ok">
                  <span class="tl-dot"></span>
                  <span class="tl-label">Getting there</span>
                </button>
                <button class="tl-btn" data-val="nailed" data-action="rate" data-skill="${s.key}" data-rating="nailed">
                  <span class="tl-dot"></span>
                  <span class="tl-label">Confident</span>
                </button>
              </div>
              <div class="fault-row">
                <span class="fault-label">Faults (optional)</span>
                <div class="fault-counter fc-driving" data-action="inc-fault" data-skill="${s.key}" data-fault="driving">
                  <span class="fc-type">D</span><span class="fc-badge" id="fc-${s.key}-driving">·</span>
                </div>
                <div class="fault-counter fc-serious" data-action="inc-fault" data-skill="${s.key}" data-fault="serious">
                  <span class="fc-type">S</span><span class="fc-badge" id="fc-${s.key}-serious">·</span>
                </div>
                <div class="fault-counter fc-dangerous" data-action="inc-fault" data-skill="${s.key}" data-fault="dangerous">
                  <span class="fc-type">✕</span><span class="fc-badge" id="fc-${s.key}-dangerous">·</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');

  // Set up long-press for mobile fault reset
  document.querySelectorAll('.fault-counter').forEach(el => {
    let timer;
    el.addEventListener('touchstart', function(e) {
      const parts = this.querySelector('.fc-badge').id.split('-');
      const sk = parts.slice(1, -1).join('-');
      const ft = parts[parts.length - 1];
      timer = setTimeout(() => { resetFault(sk, ft, this); e.preventDefault(); }, 500);
    }, { passive: false });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchmove', () => clearTimeout(timer));
  });
}

function toggleArea(areaId) {
  document.getElementById('area-' + areaId).classList.toggle('open');
}

function incFault(skillKey, type, el) {
  if (!faults[skillKey]) faults[skillKey] = { driving: 0, serious: 0, dangerous: 0 };
  faults[skillKey][type]++;
  const badge = document.getElementById('fc-' + skillKey + '-' + type);
  badge.textContent = faults[skillKey][type];
  el.classList.add('has-faults');
}

function resetFault(skillKey, type, el) {
  if (!faults[skillKey]) return;
  faults[skillKey][type] = 0;
  const badge = document.getElementById('fc-' + skillKey + '-' + type);
  badge.textContent = '·';
  el.classList.remove('has-faults');
}

// ── Auth + init ──
window.addEventListener('DOMContentLoaded', async () => {
  AUTH = ccAuth.getAuth();

  // Always render the form UI
  buildSkillCards();
  document.getElementById('session-date').value = new Date().toISOString().split('T')[0];
  updateStep2Button();

  if (!AUTH) return; // form visible, submit gated

  loadSessions();

  // Check for booking_id in URL
  const params = new URLSearchParams(window.location.search);
  bookingId = params.get('booking_id');

  if (bookingId) {
    await loadBookingDetails(bookingId);
  }
});

// ── Load booking details for pre-fill ──
async function loadBookingDetails(id) {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=unlogged-bookings');
    if (!res.ok) return fallbackManual();
    const data = await res.json();
    const booking = (data.bookings || []).find(b => String(b.id) === String(id));

    if (!booking) return fallbackManual();

    bookingData = booking;

    // Show pre-filled info
    const dateObj = new Date(booking.scheduled_date + 'T00:00:00Z');
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const start = booking.start_time ? booking.start_time.slice(0, 5) : '';
    const end = booking.end_time ? booking.end_time.slice(0, 5) : '';

    // Calculate duration from start/end time
    if (start && end) {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const durationMins = (eh * 60 + em) - (sh * 60 + sm);
      if (durationMins > 0) {
        document.getElementById('duration').value = durationMins;
      }
    }

    document.getElementById('session-date').value = booking.scheduled_date;

    const prefill = document.getElementById('booking-prefill');
    prefill.style.display = 'block';
    prefill.innerHTML = `
      <div class="booking-info">
        <div class="booking-info-icon">&#x1F4C5;</div>
        <div class="booking-info-text">
          Logging lesson on <strong>${dateStr}</strong> ${start ? `at <strong>${start} – ${end}</strong>` : ''}
          ${booking.instructor_name ? ` with <strong>${booking.instructor_name}</strong>` : ''}
        </div>
      </div>`;

    // Hide manual date/type fields since we have booking data
    currentType = 'instructor';

  } catch {
    fallbackManual();
  }
}

function fallbackManual() {
  bookingId = null;
  bookingData = null;
  document.getElementById('session-date').value = new Date().toISOString().split('T')[0];
}

// ── Navigation ──
function goTo(step) {
  if (currentStep === 1 && step > 1) {
    const date = document.getElementById('session-date').value;
    if (!date) { showError('Please pick a date'); return; }
  }
  hideError();
  document.getElementById(`step-${currentStep}`).classList.remove('active');
  currentStep = step;
  document.getElementById(`step-${currentStep}`).classList.add('active');
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (step === 3) buildSummary();
}

function updateProgress() {
  const pct = (currentStep / TOTAL_STEPS) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
}

// ── Session type ──
function setType(type) {
  currentType = type;
  document.getElementById('btn-instructor').className = 'type-btn' + (type === 'instructor' ? ' selected' : '');
  document.getElementById('btn-private').className = 'type-btn' + (type === 'private' ? ' selected' : '');
}

// ── Rate a skill ──
function rate(key, value, btn) {
  ratings[key] = value;
  const card = document.getElementById(`card-${key}`);
  card.classList.add('rated');
  card.querySelectorAll('.tl-btn').forEach(b => {
    b.className = 'tl-btn';
    b.setAttribute('data-val', b.getAttribute('data-val'));
  });
  btn.classList.add(`sel-${value}`);

  // Update area count
  const skill = CC.getSkill(key);
  if (skill) {
    const areaSkills = CC.getSkillsByArea(skill.area);
    const areaRated = areaSkills.filter(s => ratings[s.key]).length;
    const countEl = document.getElementById('area-count-' + skill.area);
    if (countEl) countEl.textContent = areaRated + '/' + areaSkills.length;
  }

  updateStep2Button();
}

function updateStep2Button() {
  const rated = Object.keys(ratings).length;
  const btn = document.getElementById('btn-step2-next');
  // Require at least 1 rating (not all 17 — learners may not practise every skill)
  btn.disabled = rated < 1;
  btn.textContent = rated < 1
    ? 'Rate at least 1 skill'
    : `Next (${rated} skill${rated !== 1 ? 's' : ''} rated)`;
}

// ── Summary ──
function buildSummary() {
  const date = document.getElementById('session-date').value;
  const duration = document.getElementById('duration').value;
  const dateStr = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  // Count total faults
  let totalD = 0, totalS = 0, totalX = 0;
  Object.values(faults).forEach(f => { totalD += f.driving; totalS += f.serious; totalX += f.dangerous; });
  const hasFaults = totalD + totalS + totalX > 0;

  document.getElementById('summary-meta').innerHTML = `
    <div class="summary-pill"><div class="val">${dateStr}</div><div class="lbl">Date</div></div>
    <div class="summary-pill"><div class="val">${duration ? duration + ' min' : '—'}</div><div class="lbl">Duration</div></div>
    <div class="summary-pill"><div class="val">${currentType === 'instructor' ? 'Instructor' : 'Private'}</div><div class="lbl">Type</div></div>
    <div class="summary-pill"><div class="val">${Object.keys(ratings).length}</div><div class="lbl">Skills rated</div></div>
    ${hasFaults ? `<div class="summary-pill"><div class="val" style="color:var(--red)">${totalD}D · ${totalS}S · ${totalX}✕</div><div class="lbl">Faults logged</div></div>` : ''}
  `;

  // Only show rated skills in summary
  const ratedSkills = SKILLS.filter(s => ratings[s.key]);
  document.getElementById('summary-skills').innerHTML = ratedSkills.map(s => {
    const r = ratings[s.key];
    const f = faults[s.key];
    const faultStr = f && (f.driving + f.serious + f.dangerous > 0)
      ? `<span style="font-size:0.72rem;color:var(--red);margin-left:8px;">${f.driving}D ${f.serious}S ${f.dangerous}✕</span>`
      : '';
    return `<div class="summary-skill-row">
      <span class="summary-skill-name">${s.label}${faultStr}</span>
      ${r ? `<span class="summary-dot dot-${r}"></span>` : ''}
    </div>`;
  }).join('');

  document.getElementById('summary-card').style.display = 'block';
}

// ── Save ──
async function saveSession() {
  if (window.ccAuth && !window.ccAuth.requireAuth()) return;
  const date = document.getElementById('session-date').value;
  if (!date) { showError('Session date is missing'); return; }

  const ratingsList = Object.entries(ratings).map(([skill_key, rating]) => {
    const f = faults[skill_key] || { driving: 0, serious: 0, dangerous: 0 };
    return {
      tier: 0, skill_key, rating, note: null,
      driving_faults: f.driving || 0,
      serious_faults: f.serious || 0,
      dangerous_faults: f.dangerous || 0
    };
  });

  const payload = {
    session_date: date,
    duration_minutes: parseInt(document.getElementById('duration').value) || null,
    session_type: currentType,
    notes: document.getElementById('notes').value.trim() || null,
    ratings: ratingsList
  };

  if (bookingId) {
    payload.booking_id = parseInt(bookingId);
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (res.status === 401) { window.location.href = '/learner/login.html'; return; }
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Failed to save. Please try again.'); btn.disabled = false; btn.textContent = 'Save Session'; return; }

    // Store saved session info for Q&A link
    window._savedSessionId = data.session_id;
    window._savedBookingId = bookingId ? parseInt(bookingId) : null;

    // Show success
    document.getElementById(`step-${currentStep}`).classList.remove('active');
    document.getElementById('step-success').classList.add('active');
    document.querySelector('.progress-wrap').style.display = 'none';
    loadSessions(); // Refresh history list
  } catch {
    showError('Network error. Please check your connection.');
    btn.disabled = false;
    btn.textContent = 'Save Session';
  }
}

// ── Error ──
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hideError() {
  document.getElementById('error-msg').classList.remove('show');
}

// ── Ask Q&A after session ──
function askSessionQuestion() {
  let url = '/learner/qa.html?ask=1';
  if (window._savedSessionId) url += '&session_id=' + window._savedSessionId;
  if (window._savedBookingId) url += '&booking_id=' + window._savedBookingId;
  window.location.href = url;
}

// ── Session History ──
const SKILL_LABELS = {};
SKILLS.forEach(s => { SKILL_LABELS[s.key] = s.label; });
const LEGACY_LABELS = {
  speed_choice: 'Speed choice', lane_choice: 'Lane choice', mirrors: 'Mirrors',
  lane_keeping: 'Lane keeping', stay_or_go: 'Stay or go', roundabouts: 'Roundabouts',
  manoeuvres: 'Manoeuvres',
  q1_speed_react: 'Speed & react', q2_speed_lane: 'Slowing for lanes',
  q3_mirrors_routine: 'Mirror routine', q4_mirrors_unexp: 'Mirrors (unexpected)',
  q5_awareness: 'Awareness', q6_mice_order: 'MICE order',
  q7_lane_choice: 'Lane choice', q8_safe_to_go: 'Stay or go',
  q9_roundabout_space: 'Roundabout spacing', q10_reversing: 'Reversing',
  t1_move: 'Moving off', t1_stop: 'Stopping', t1_steer: 'Steering',
  t1_mirrors: 'Mirror checks', t1_mice: 'MICE routine', t1_eval: 'Overall'
};

async function loadSessions() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=sessions');
    if (res.ok) {
      const data = await res.json();
      renderSessions(data.sessions || []);
    }
  } catch (e) { console.error(e); }
}

function renderSessions(sessions) {
  const el = document.getElementById('sessions-list');
  if (!sessions || sessions.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">📋</div><p>No sessions logged yet.<br>Log your first drive above!</p></div>`;
    return;
  }

  el.innerHTML = sessions.map(s => {
    const date = new Date(s.session_date);
    const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const typeChip = s.session_type === 'private'
      ? `<span class="session-chip chip-private">Private</span>`
      : `<span class="session-chip chip-instructor">Instructor</span>`;
    const durationChip = s.duration_minutes ? `<span class="session-chip chip-duration">${s.duration_minutes} min</span>` : '';

    const ratingsHTML = (s.ratings || []).map(r => {
      const dotClass = r.rating === 'nailed' ? 'dot-nailed' : r.rating === 'ok' ? 'dot-ok' : r.rating === 'struggled' ? 'dot-struggled' : '';
      const label = SKILL_LABELS[r.skill_key] || LEGACY_LABELS[r.skill_key] || r.skill_key.replace(/_/g, ' ');
      return `<div class="session-skill-pill"><span class="tl-dot-sm ${dotClass}"></span> ${label}</div>`;
    }).join('');

    const notesHTML = s.notes ? `<div class="session-notes">"${s.notes}"</div>` : '';
    return `<div class="session-card"><div class="session-meta"><span class="session-date">📅 ${dateStr}</span>${typeChip}${durationChip}</div>${ratingsHTML ? `<div class="session-ratings">${ratingsHTML}</div>` : ''}${notesHTML}</div>`;
  }).join('');
}

// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'toggle-area') {
    toggleArea(target.dataset.areaId);
  } else if (action === 'rate') {
    rate(target.dataset.skill, target.dataset.rating, target);
  } else if (action === 'inc-fault') {
    incFault(target.dataset.skill, target.dataset.fault, target);
  }
});
document.addEventListener('contextmenu', function (e) {
  var target = e.target.closest('[data-action="inc-fault"]');
  if (!target) return;
  e.preventDefault();
  resetFault(target.dataset.skill, target.dataset.fault, target);
});
// ── Static handlers previously inline in HTML ──
(function wire() {
  var back = document.getElementById('btn-back-dashboard');
  if (back) back.addEventListener('click', function () { window.location = '/learner/'; });
  var signOut = document.getElementById('btn-signout-drop');
  if (signOut) signOut.addEventListener('click', function () { if (typeof logout === 'function') logout(); });
  var instrBtn = document.getElementById('btn-instructor');
  if (instrBtn) instrBtn.addEventListener('click', function () { setType('instructor'); });
  var privBtn = document.getElementById('btn-private');
  if (privBtn) privBtn.addEventListener('click', function () { setType('private'); });
  document.querySelectorAll('[data-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () { goTo(parseInt(btn.dataset.goto, 10)); });
  });
  var saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveSession);
  var askBtn = document.getElementById('btn-ask-session-question');
  if (askBtn) askBtn.addEventListener('click', askSessionQuestion);
})();
})();
