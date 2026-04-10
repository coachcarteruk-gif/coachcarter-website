(function () {
  'use strict';

// ── SCROLL ANIMATIONS ──────────────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -40px 0px'
});

document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

// ── QUIZ ─────────────────────────────────────────────────
let quizAnswer1 = null;

const step2Options = {
  learner: [
    { icon: '📊', label: 'Go to the Learner Hub',    action: () => goLearner('/learner/') },
    { icon: '📅', label: 'Book a free trial lesson',  action: () => goLearner('/learner/book.html') },
    { icon: '💰', label: 'Explore our prices',        action: () => go('/learner-journey.html') },
  ],
  instructor: [
    { icon: '🔑', label: 'Log in to my portal',      action: () => go('/instructor/login.html') },
    { icon: '🗓️', label: 'View my schedule',         action: () => go('/instructor/') },
  ],
};

function go(url) { window.location.href = url; }

function goLearner(dest) {
  const session = JSON.parse(localStorage.getItem('cc_learner') || 'null');
  go(session ? dest : '/learner/login.html?redirect=' + encodeURIComponent(dest));
}

function quizNext(answer) {
  quizAnswer1 = answer;
  const opts = step2Options[answer] || [];
  document.getElementById('step2Options').innerHTML = opts.map((o, i) =>
    `<button class="quiz-opt" data-action="quiz-finish" data-idx="${i}">
      <span class="opt-icon">${o.icon}</span>${o.label}
    </button>`
  ).join('');

  document.getElementById('step1').classList.remove('active');
  document.getElementById('step2').classList.add('active');
  document.getElementById('dot1').classList.remove('active');
  document.getElementById('dot2').classList.add('active');
}

function quizBack() {
  document.getElementById('step2').classList.remove('active');
  document.getElementById('step1').classList.add('active');
  document.getElementById('dot2').classList.remove('active');
  document.getElementById('dot1').classList.add('active');
}

function quizFinish(index) {
  const opts = step2Options[quizAnswer1];
  if (opts && opts[index]) opts[index].action();
}

// ── NAV SCROLL EFFECT ──────────────────────────────────────
let lastScroll = 0;
const nav = document.querySelector('.nav');

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY;
  if (scrollY > 100) {
    nav.style.background = 'rgba(38, 38, 38, 0.97)';
  } else {
    nav.style.background = 'rgba(38, 38, 38, 0.92)';
  }
  lastScroll = scrollY;
}, { passive: true });

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action="quiz-finish"]');
  if (t) quizFinish(parseInt(t.dataset.idx, 10));
});
(function wire() {
  document.querySelectorAll('[data-quiz-next]').forEach(function (btn) {
    btn.addEventListener('click', function () { quizNext(btn.dataset.quizNext); });
  });
  var back = document.getElementById('btn-quiz-back');
  if (back) back.addEventListener('click', quizBack);
})();
})();
