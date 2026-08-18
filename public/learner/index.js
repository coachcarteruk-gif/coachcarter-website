(function () {
  'use strict';

let AUTH, BOOKINGS_DATA, UNLOGGED_DATA, BALANCE_DATA, FLEXIBLE_BALANCE_DATA;

window.addEventListener('DOMContentLoaded', async () => {
  AUTH = ccAuth.getAuth();

  if (!AUTH) {
    renderGuestGate();
    removeSkeleton();
    return;
  }

  await Promise.all([loadBookings(), loadUnlogged(), loadReadiness(), loadBalance(), loadFlexibleBalance()]);
  render();
  loadProfileCompleteness();
  loadReferralCard();
});

function removeSkeleton() {
  var skel = document.getElementById('dashboard-skeleton');
  if (skel) skel.remove();
}

function renderGuestGate() {
  var title = document.getElementById('welcome-msg');
  if (title) title.textContent = 'Learner hub';
  var gate = document.getElementById('guest-dashboard-gate');
  if (gate) gate.classList.add('show');
  var statRow = document.querySelector('.stat-row');
  if (statRow) statRow.style.display = 'none';
  var empty = document.getElementById('next-lesson-empty');
  if (empty) empty.classList.remove('show');
  var shortcuts = document.getElementById('shortcuts-label');
  if (shortcuts) shortcuts.style.display = 'none';
  var actionStrip = document.querySelector('.action-strip');
  if (actionStrip) actionStrip.style.display = 'none';
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

async function loadBalance() {
  try {
    const res = await ccAuth.fetchAuthed('/api/credits?action=balance');
    if (res.ok) BALANCE_DATA = await res.json();
  } catch (e) { console.warn('Credit balance load failed:', e); }
}

async function loadFlexibleBalance() {
  try {
    const res = await ccAuth.fetchAuthed('/api/flexible-packages?action=balance');
    if (res.ok) FLEXIBLE_BALANCE_DATA = await res.json();
  } catch (e) { console.warn('Flexible Hours balance load failed:', e); }
}

function formatHours(minutes) {
  const hrs = (Number(minutes) || 0) / 60;
  return hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
}

function lessonCreditMinutes() {
  if (BALANCE_DATA?.balance_minutes != null) return Number(BALANCE_DATA.balance_minutes) || 0;
  if (AUTH?.user?.balance_minutes != null) return Number(AUTH.user.balance_minutes) || 0;
  if (AUTH?.user?.credits != null) return (Number(AUTH.user.credits) || 0) * 90;
  return 0;
}

function flexibleHoursMinutes() {
  return Number(FLEXIBLE_BALANCE_DATA?.remaining_minutes || 0);
}

function hoursLabel(minutes, label) {
  const hours = formatHours(minutes);
  return hours + ' hr' + (hours !== '1' ? 's' : '') + ' ' + label;
}

const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function render() {
  removeSkeleton();

  // Greeting - use name from bookings response or fallback
  const upcoming = (BOOKINGS_DATA && BOOKINGS_DATA.upcoming) ? BOOKINGS_DATA.upcoming : [];
  const nameEl = document.getElementById('welcome-msg');

  // Try to get name from auth
  if (AUTH?.user?.name) {
    nameEl.textContent = 'Hi, ' + AUTH.user.name.split(' ')[0] + '.';
  } else {
    nameEl.textContent = 'Welcome!';
  }

  // Keep the school-wide Flexible Hours entitlement visibly distinct from
  // per-instructor Lesson Credit even though the stat can total both balances.
  const greetingSub = document.getElementById('greeting-sub');
  const creditLine = document.getElementById('credit-balance-line');
  if (greetingSub && creditLine) {
    const lessonMinutes = lessonCreditMinutes();
    const flexibleMinutes = flexibleHoursMinutes();
    const balances = [];
    if (flexibleMinutes > 0) balances.push(hoursLabel(flexibleMinutes, 'Flexible Hours'));
    if (lessonMinutes > 0) balances.push(hoursLabel(lessonMinutes, 'Lesson Credit'));
    creditLine.textContent = balances.length ? balances.join(' · ') : 'No available hours';
    greetingSub.style.display = 'flex';
  }

  renderBalanceStat();

  renderNextLesson();
  renderUnlogged();
  maybeShowArrivalToast();
}

function renderBalanceStat() {
  const val = document.getElementById('stat-balance-value');
  const sub = document.getElementById('stat-balance-sub');
  if (!val || !sub) return;
  const lessonMinutes = lessonCreditMinutes();
  const flexibleMinutes = flexibleHoursMinutes();
  val.textContent = formatHours(lessonMinutes + flexibleMinutes);
  if (flexibleMinutes > 0 && lessonMinutes > 0) sub.textContent = 'Flexible Hours + Lesson Credit';
  else if (flexibleMinutes > 0) sub.textContent = 'Flexible Hours, school-wide';
  else if (lessonMinutes > 0) sub.textContent = 'Lesson Credit across instructors';
  else sub.textContent = 'No available hours';
}

// One-time toast confirming the learner has arrived in their dashboard
// after login. Reuses the .credit-toast styles already in the page.
function maybeShowArrivalToast() {
  let flag;
  try { flag = sessionStorage.getItem('cc_just_logged_in'); } catch (e) { return; }
  if (flag !== '1') return;
  try { sessionStorage.removeItem('cc_just_logged_in'); } catch (e) {}

  const toast = document.getElementById('credit-toast');
  if (!toast) return;
  const firstName = AUTH?.user?.name ? AUTH.user.name.split(' ')[0] : null;
  toast.textContent = firstName
    ? `Welcome back, ${firstName}. You're in your dashboard.`
    : "You're in your dashboard.";
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

function renderNextLesson() {
  const upcoming = (BOOKINGS_DATA && BOOKINGS_DATA.upcoming) ? BOOKINGS_DATA.upcoming : [];
  const card = document.getElementById('next-lesson-card');
  const empty = document.getElementById('next-lesson-empty');
  const filming = document.getElementById('nl-filming');

  if (upcoming.length === 0) {
    card.classList.remove('show');
    empty.classList.add('show');
    if (filming) filming.style.display = 'none';
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
  if (filming) {
    filming.style.display = b.social_video_consent === true ? 'block' : 'none';
  }
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

// ── Referral teaser - links through to /learner/refer.html for the full page ──
async function loadReferralCard() {
  if (!AUTH) return;
  try {
    // We only need stats here. The dedicated page handles code generation and sharing.
    const [codeRes, statsRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/learner?action=referral-code'),
      ccAuth.fetchAuthed('/api/learner?action=referral-stats')
    ]);
    if (!codeRes.ok || !statsRes.ok) return;
    const codeData = await codeRes.json();
    const statsData = await statsRes.json();
    if (!codeData.enabled) return;

    document.getElementById('ref-count').textContent = statsData.total_referred;
    var mins = statsData.total_reward_minutes || 0;
    var earnedEl = document.getElementById('ref-earned');
    if (mins >= 60) {
      var hrs = mins / 60;
      earnedEl.textContent = (hrs % 1 === 0 ? hrs.toFixed(0) : hrs.toFixed(1)) + ' hr';
    } else {
      earnedEl.textContent = mins + ' min';
    }
    document.getElementById('referral-card').classList.add('show');
  } catch (e) { console.warn('Referral teaser load failed:', e); }
}

(function wire() {
  var btn = document.getElementById('btn-dismiss-profile');
  if (btn) btn.addEventListener('click', dismissProfile);
})();
})();
