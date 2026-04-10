(function () {
  'use strict';

let AUTH, BOOKINGS_DATA, UNLOGGED_DATA;

window.addEventListener('DOMContentLoaded', async () => {
  AUTH = ccAuth.getAuth();

  if (!AUTH) {
    document.getElementById('welcome-msg').textContent = 'Welcome!';
    document.getElementById('next-lesson-empty').classList.add('show');
    removeSkeleton();
    return;
  }

  await Promise.all([loadBookings(), loadUnlogged(), loadReadiness()]);
  render();
  loadProfileCompleteness();
});

function removeSkeleton() {
  var skel = document.getElementById('dashboard-skeleton');
  if (skel) skel.remove();
}

// ── Profile Completion Card ──
async function loadProfileCompleteness() {
  if (!AUTH) return;
  if (localStorage.getItem('cc_profile_dismissed') === 'true') return;
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=profile-completeness');
    if (!res.ok) return;
    const data = await res.json();

    const stepLabels = {
      prior_experience: 'Prior experience',
      initial_assessment: 'Initial skill assessment'
    };
    const profileSteps = ['prior_experience', 'initial_assessment'];
    const stepsEl = document.getElementById('profile-steps');
    stepsEl.innerHTML = profileSteps.map(function(key) {
      var done = data.steps[key];
      return '<div class="profile-step ' + (done ? 'done' : '') + '">' +
        '<span class="profile-step-icon">' + (done ? '\u2705' : '\u2B1C') + '</span>' +
        '<span>' + (stepLabels[key] || key) + '</span></div>';
    }).join('');

    var profileDone = profileSteps.filter(function(k) { return data.steps[k]; }).length;
    if (profileDone >= 2) return;
    document.getElementById('profile-card').classList.add('show');
    var profilePct = Math.round((profileDone / 2) * 100);
    document.getElementById('profile-bar-fill').style.width = profilePct + '%';
    document.getElementById('profile-pct').textContent = profilePct + '% complete';
    document.getElementById('profile-cta').href = '/learner/onboarding.html';
    document.getElementById('profile-cta').textContent = !data.steps.prior_experience
      ? 'Add Your Experience \u2192'
      : 'Complete Skill Assessment \u2192';
  } catch (e) { console.warn('Profile completeness check failed:', e); }
}

function dismissProfile() {
  localStorage.setItem('cc_profile_dismissed', 'true');
  document.getElementById('profile-card').classList.remove('show');
}

function logout() { ccAuth.logout(); }

async function loadBookings() {
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings');
    if (res.ok) BOOKINGS_DATA = await res.json();
  } catch (e) { console.error(e); }
}

async function loadUnlogged() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=unlogged-bookings');
    if (res.ok) UNLOGGED_DATA = await res.json();
  } catch (e) { console.error(e); }
}

async function loadReadiness() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=competency');
    if (!res.ok) return;
    const data = await res.json();
    const CC = window.CC_COMPETENCY;
    if (!CC) return;

    const lessonMap = {};
    (data.lesson_ratings || []).forEach(lr => {
      const key = CC.mapLegacySkill(lr.skill_key);
      const rObj = CC.RATINGS.find(r => r.key === lr.rating);
      if (!rObj) return;
      if (!lessonMap[key]) lessonMap[key] = [];
      lessonMap[key].push({ score: rObj.score, date: lr.created_at, rating: lr.rating });
    });
    Object.keys(lessonMap).forEach(k => {
      lessonMap[k].sort((a, b) => new Date(b.date) - new Date(a.date));
    });

    const quizMap = {};
    (data.quiz_accuracy || []).forEach(qa => {
      quizMap[qa.skill_key] = { attempts: qa.attempts, correct: qa.correct_count };
    });

    let sum = 0;
    CC.SKILLS.forEach(sk => {
      const lessonRatings = lessonMap[sk.key] || [];
      const quiz = quizMap[sk.key];
      const quizResults = [];
      if (quiz && quiz.attempts > 0) {
        for (let i = 0; i < quiz.attempts; i++) quizResults.push({ correct: i < quiz.correct });
      }
      const lastPractised = lessonRatings.length > 0 ? lessonRatings[0].date : null;
      sum += CC.readinessScore({ lessonRatings, quizResults, lastPractised });
    });
    const pct = Math.round(sum / CC.SKILLS.length);

    const ring = document.getElementById('readiness-ring');
    const fill = document.getElementById('ring-fill');
    const val = document.getElementById('readiness-value');
    if (!ring || !fill || !val) return;

    ring.style.display = '';
    val.textContent = pct + '%';
    const circumference = 2 * Math.PI * 21;
    const offset = circumference * (1 - pct / 100);
    fill.style.strokeDashoffset = offset;
    fill.style.stroke = '#fff';
  } catch (e) { console.error('Readiness load failed:', e); }
}

const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function render() {
  removeSkeleton();

  // Greeting — use name from bookings response or fallback
  const upcoming = (BOOKINGS_DATA && BOOKINGS_DATA.upcoming) ? BOOKINGS_DATA.upcoming : [];
  const nameEl = document.getElementById('welcome-msg');

  // Try to get name from auth
  if (AUTH?.user?.name) {
    nameEl.textContent = 'Hi, ' + AUTH.user.name;
  } else {
    nameEl.textContent = 'Welcome!';
  }

  renderNextLesson();
  renderUnlogged();
}

function renderNextLesson() {
  const upcoming = (BOOKINGS_DATA && BOOKINGS_DATA.upcoming) ? BOOKINGS_DATA.upcoming : [];
  const card = document.getElementById('next-lesson-card');
  const empty = document.getElementById('next-lesson-empty');

  if (upcoming.length === 0) {
    card.classList.remove('show');
    empty.classList.add('show');
    return;
  }

  empty.classList.remove('show');
  card.classList.add('show');

  const b = upcoming[0];
  const date = new Date(b.scheduled_date + 'T00:00:00Z');
  const dayNum = date.getUTCDate();
  const month = MON_ABBR[date.getUTCMonth()];
  const dow = DOW_ABBR[date.getUTCDay()];
  const start = b.start_time ? b.start_time.slice(0, 5) : '';
  const end = b.end_time ? b.end_time.slice(0, 5) : '';

  const now = Date.now();
  const lessonMs = new Date(b.scheduled_date + 'T' + b.start_time + 'Z').getTime();
  const diffMs = lessonMs - now;
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);
  let countdown = '';
  if (diffMs < 0) {
    countdown = 'In progress';
  } else if (diffDays === 0 && diffHours < 24) {
    countdown = diffHours <= 1 ? 'Starting very soon' : 'In ' + diffHours + ' hours';
  } else if (diffDays === 1) {
    countdown = 'Tomorrow';
  } else {
    countdown = 'In ' + diffDays + ' days';
  }

  document.getElementById('nl-when').textContent = countdown;
  document.getElementById('nl-time').textContent = `${dow} ${dayNum} ${month} \u00B7 ${start} \u2013 ${end}`;
  document.getElementById('nl-instructor').textContent = `with ${b.instructor_name}`;
}

function renderUnlogged() {
  const bookings = (UNLOGGED_DATA && UNLOGGED_DATA.bookings) ? UNLOGGED_DATA.bookings : [];
  const banner = document.getElementById('unlogged-banner');
  if (bookings.length === 0) { banner.classList.remove('show'); return; }

  const count = bookings.length;
  document.getElementById('unlogged-title').textContent =
    count === 1 ? 'You have a lesson to log' : `You have ${count} lessons to log`;
  document.getElementById('unlogged-btn').href =
    '/learner/log-session.html?booking_id=' + bookings[0].id;
  banner.classList.add('show');
}

(function wire() {
  var btn = document.getElementById('btn-dismiss-profile');
  if (btn) btn.addEventListener('click', dismissProfile);
})();
})();
