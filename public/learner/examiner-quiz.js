(function () {
  'use strict';

let AUTH;
let allScenarios = [];
let quizScenarios = [];
let currentIndex = 0;
let score = 0;
let answers = [];
let isAnswered = false;
let selectedTier = 0;
let startTime;

const ANSWER_LABELS = {
  no_fault: 'No fault',
  driving_fault: 'Driving fault',
  serious: 'Serious fault',
  dangerous: 'Dangerous fault'
};

// ── Auth ──
window.addEventListener('DOMContentLoaded', () => {
  AUTH = ccAuth.getAuth();
  if (!AUTH?.token) {
    window.location.href = '/learner/login.html?redirect=/learner/examiner-quiz.html';
    return;
  }
  loadScenarios();
});

// ── Load scenarios ──
async function loadScenarios() {
  try {
    const res = await fetch('/learner/scenarios.json');
    allScenarios = await res.json();
  } catch (e) {
    console.error('Failed to load scenarios:', e);
  }
}

// ── Tier selection ──
function selectTier(tier, btn) {
  selectedTier = tier;
  document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── Shuffle ──
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Start quiz ──
function startQuiz() {
  quizScenarios = selectedTier === 0
    ? [...allScenarios]
    : allScenarios.filter(s => s.tier === selectedTier);

  if (quizScenarios.length === 0) {
    alert('No scenarios found for this tier.');
    return;
  }

  if (document.getElementById('shuffle-check').checked) {
    quizScenarios = shuffle(quizScenarios);
  }

  currentIndex = 0;
  score = 0;
  answers = [];
  isAnswered = false;
  startTime = Date.now();

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('quiz-screen').style.display = 'block';
  document.getElementById('results-screen').style.display = 'none';

  if (typeof posthog !== 'undefined') {
    posthog.capture('examiner_quiz_started', { tier: selectedTier, total_questions: quizScenarios.length });
  }

  renderQuestion();
}

// ── Render question ──
function renderQuestion() {
  const s = quizScenarios[currentIndex];
  const total = quizScenarios.length;

  document.getElementById('progress-fill').style.width = ((currentIndex / total) * 100) + '%';
  document.getElementById('quiz-counter').textContent = `Question ${currentIndex + 1} of ${total}`;
  document.getElementById('quiz-score').textContent = `Score: ${score}`;
  document.getElementById('quiz-category').textContent = s.category;
  document.getElementById('quiz-dl25').textContent = `DL25: ${s.dl25_ref}`;
  document.getElementById('quiz-scenario').textContent = s.scenario;

  // Reset answer buttons
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach(btn => {
    btn.disabled = false;
    btn.className = 'answer-btn';
  });

  // Hide feedback and next button
  document.getElementById('feedback-panel').classList.remove('show');
  document.getElementById('feedback-panel').className = 'feedback-panel';
  document.getElementById('btn-next').classList.add('hidden');
  isAnswered = false;
}

// ── Select answer ──
function selectAnswer(answer) {
  if (isAnswered) return;
  isAnswered = true;

  const s = quizScenarios[currentIndex];
  const correct = s.correct_answer === answer;
  if (correct) score++;

  answers.push({ id: s.id, category: s.category, selected: answer, correct_answer: s.correct_answer, is_correct: correct });

  // Highlight buttons
  const answerKeys = ['no_fault', 'driving_fault', 'serious', 'dangerous'];
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    const key = answerKeys[i];
    if (key === s.correct_answer) {
      btn.classList.add(correct && key === answer ? 'correct' : 'correct-highlight');
    } else if (key === answer && !correct) {
      btn.classList.add('incorrect');
    }
  });

  // Show feedback
  const panel = document.getElementById('feedback-panel');
  panel.classList.add('show');
  panel.classList.add(correct ? 'is-correct' : 'is-wrong');

  document.getElementById('feedback-result').innerHTML = correct
    ? '<span class="icon">&#10003;</span> Correct!'
    : `<span class="icon">&#10007;</span> The answer is: ${ANSWER_LABELS[s.correct_answer]}`;

  document.getElementById('feedback-explanation').textContent = s.explanation;
  document.getElementById('feedback-examiner').innerHTML = `<strong>Examiner insight:</strong> ${s.examiner_note}`;

  // Show next button
  const nextBtn = document.getElementById('btn-next');
  nextBtn.classList.remove('hidden');
  nextBtn.textContent = currentIndex < quizScenarios.length - 1 ? 'Next Question' : 'See Results';

  // Scroll to feedback
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (typeof posthog !== 'undefined') {
    posthog.capture('examiner_quiz_answered', { question_id: s.id, correct, category: s.category });
  }
}

// ── Next question ──
function nextQuestion() {
  currentIndex++;
  if (currentIndex >= quizScenarios.length) {
    showResults();
  } else {
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ── Show results ──
function showResults() {
  const total = quizScenarios.length;
  const pct = Math.round((score / total) * 100);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('results-screen').style.display = 'block';
  document.getElementById('progress-fill').style.width = '100%';

  document.getElementById('results-num').textContent = `${score}/${total}`;
  document.getElementById('results-pct').textContent = `${pct}%`;

  let msg, submsg;
  if (pct >= 90) {
    msg = 'You think like an examiner.';
    submsg = "You've got a solid grasp of the marking scheme. You're ready.";
  } else if (pct >= 70) {
    msg = 'Solid understanding.';
    submsg = 'A few gaps to work on. Review the categories you missed and try again.';
  } else if (pct >= 50) {
    msg = 'Getting there.';
    submsg = 'Book a mock test with Coach Carter to sharpen up your understanding of how faults are assessed.';
  } else {
    msg = 'Time to study the marking scheme.';
    submsg = "Let's work on this together. Understanding how examiners mark is half the battle.";
  }
  document.getElementById('results-msg').textContent = msg;
  document.getElementById('results-submsg').textContent = submsg;

  // Category breakdown
  const cats = {};
  answers.forEach(a => {
    if (!cats[a.category]) cats[a.category] = { correct: 0, total: 0 };
    cats[a.category].total++;
    if (a.is_correct) cats[a.category].correct++;
  });

  const rowsHtml = Object.entries(cats)
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
    .map(([cat, data]) => {
      const catPct = Math.round((data.correct / data.total) * 100);
      const cls = catPct === 100 ? 'perfect' : catPct >= 50 ? 'partial' : 'poor';
      return `<div class="breakdown-row"><span class="breakdown-cat">${cat}</span><span class="breakdown-score ${cls}">${data.correct}/${data.total}</span></div>`;
    }).join('');

  document.getElementById('breakdown-rows').innerHTML = rowsHtml;

  if (typeof posthog !== 'undefined') {
    posthog.capture('examiner_quiz_completed', { score, total, percentage: pct, time_taken_seconds: elapsed, tier: selectedTier });
  }

  // Persist quiz results to competency record
  if (AUTH?.token && typeof CC_COMPETENCY !== 'undefined') {
    try {
      const quizResults = answers.map(a => {
        const scenario = quizScenarios.find(s => s.id === a.id);
        const skillKey = scenario ? CC_COMPETENCY.quizRefToSkill(scenario.dl25_ref) : null;
        return {
          question_id: a.id,
          skill_key: skillKey || 'positioning',
          correct: a.is_correct,
          learner_answer: a.selected,
          correct_answer: a.correct_answer
        };
      });
      ccAuth.fetchAuthed('/api/learner?action=quiz-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify({ results: quizResults })
      }).catch(e => console.warn('Failed to persist quiz results:', e));
    } catch (e) { console.warn('Quiz persistence error:', e); }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Share ──
async function shareResult() {
  const total = quizScenarios.length;
  const pct = Math.round((score / total) * 100);
  const text = `I scored ${score}/${total} (${pct}%) on the Coach Carter Examiner Quiz! Think you can beat me? Try it yourself.`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'What Would the Examiner Mark?', text, url: window.location.href });
    } catch {}
  } else {
    try {
      await navigator.clipboard.writeText(text + '\n' + window.location.href);
      alert('Result copied to clipboard!');
    } catch {
      alert(text);
    }
  }

  if (typeof posthog !== 'undefined') {
    posthog.capture('examiner_quiz_shared', { score, total: quizScenarios.length, percentage: pct });
  }
}

// ── Restart ──
function restartQuiz() {
  document.getElementById('results-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Static handlers previously inline in HTML ──
(function wire() {
  document.querySelectorAll('[data-tier]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectTier(parseInt(btn.dataset.tier, 10), btn); });
  });
  document.querySelectorAll('[data-answer]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectAnswer(btn.dataset.answer); });
  });
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-start-quiz', startQuiz);
  bind('btn-next', nextQuestion);
  bind('btn-share-result', shareResult);
  bind('btn-restart-quiz', restartQuiz);
})();
})();
