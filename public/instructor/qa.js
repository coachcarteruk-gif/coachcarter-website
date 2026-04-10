(function () {
  'use strict';

let token, instructor;
let allQuestions = [];
let currentFilter = 'all';

// ── Init ──
function init() {
  const session = ccAuth.getAuth();
  token = session?.token || null;
  instructor = session?.instructor || null;
  if (!token) { window.location.href = '/instructor/login.html'; return; }
  if (instructor?.is_admin) {
    const adminTab = document.getElementById('admin-tab');
    if (adminTab) adminTab.style.display = '';
  }

  loadQuestions();
}

function signOut() {
  ccAuth.logout();
}

// ── Load questions ──
async function loadQuestions() {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=qa-list');
    const data = await res.json();
    if (res.status === 401) { signOut(); return; }
    if (!res.ok) throw new Error(data.error);
    allQuestions = data.questions || [];
    updateOpenCount();
    renderQuestions();
  } catch (err) {
    document.getElementById('questions-list').innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:24px">Failed to load questions.</div>';
  }
}

function updateOpenCount() {
  const openCount = allQuestions.filter(q => q.status === 'open').length;
  const badge = document.getElementById('open-count');
  if (openCount > 0) {
    badge.textContent = openCount;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function filterQuestions(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderQuestions();
}

function renderQuestions() {
  const container = document.getElementById('questions-list');
  let filtered = allQuestions;
  if (currentFilter !== 'all') {
    filtered = allQuestions.filter(q => q.status === currentFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state-icon">&#x1F4AC;</div>
        <h2>${currentFilter === 'all' ? 'No questions yet' : 'No ' + currentFilter + ' questions'}</h2>
        <p>When learners ask questions, they'll appear here for you to answer.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(q => `
    <div class="q-card fade-in ${q.status === 'open' ? 'needs-answer' : ''}" data-action="open-question" data-q-id="${q.id}">
      <div class="q-card-top">
        <div class="q-card-title">${esc(q.title)}</div>
        <span class="q-card-status status-${q.status}">${q.status}</span>
      </div>
      <div class="q-card-meta">
        <span>From ${esc(q.learner_name || 'Learner')}</span>
        <span>${timeAgo(q.created_at)}</span>
        <span>${q.answer_count} ${q.answer_count === 1 ? 'reply' : 'replies'}</span>
      </div>
    </div>
  `).join('');
}

// ── Question detail ──
async function openQuestion(id) {
  document.getElementById('list-view').style.display = 'none';
  const dv = document.getElementById('detail-view');
  dv.classList.add('show');
  dv.querySelector('#detail-content').innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px">Loading...</div>';

  try {
    const res = await ccAuth.fetchAuthed(`/api/instructor?action=qa-detail&question_id=${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderDetail(data.question, data.answers);
  } catch (err) {
    dv.querySelector('#detail-content').innerHTML = '<div style="color:var(--red);padding:24px">Failed to load question.</div>';
  }
}

function renderDetail(q, answers) {
  document.getElementById('detail-content').innerHTML = `
    <div class="fade-in">
      <div class="detail-title">${esc(q.title)}</div>
      <div class="detail-meta">
        <span>Asked by ${esc(q.learner_name || 'Learner')}</span>
        <span>${timeAgo(q.created_at)}</span>
        <span class="q-card-status status-${q.status}">${q.status}</span>
      </div>
      ${q.body ? `<div class="detail-body">${esc(q.body)}</div>` : ''}

      <div class="answers-title">${answers.length} ${answers.length === 1 ? 'Reply' : 'Replies'}</div>
      ${answers.length === 0 ? '<div style="color:var(--muted);font-size:0.85rem;margin-bottom:20px">No replies yet. Be the first to answer!</div>' : ''}
      ${answers.map(a => `
        <div class="answer-card ${a.author_type === 'instructor' ? 'instructor' : ''}">
          <div class="answer-author">
            ${esc(a.author_name)}
            <span class="badge ${a.author_type === 'instructor' ? 'badge-instructor' : 'badge-learner'}">${a.author_type}</span>
          </div>
          <div class="answer-body">${esc(a.body)}</div>
          <div class="answer-time">${timeAgo(a.created_at)}</div>
        </div>
      `).join('')}

      <div class="reply-box">
        <textarea id="reply-body" placeholder="Write your answer..."></textarea>
        <button class="btn-answer" data-action="submit-reply" data-q-id="${q.id}">Post Answer</button>
      </div>
    </div>
  `;
}

function showList() {
  document.getElementById('detail-view').classList.remove('show');
  document.getElementById('list-view').style.display = 'block';
  loadQuestions();
}

async function submitReply(questionId) {
  const textarea = document.getElementById('reply-body');
  const body = textarea.value.trim();
  if (!body) { showToast('Please enter your answer', 'error'); return; }

  const btn = textarea.nextElementSibling;
  btn.disabled = true;
  btn.textContent = 'Posting...';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=qa-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId, body })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Answer posted!');
    openQuestion(questionId);
  } catch (err) {
    showToast(err.message || 'Failed to post answer', 'error');
    btn.disabled = false;
    btn.textContent = 'Post Answer';
  }
}

// ── Helpers ──
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

window.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'open-question') openQuestion(parseInt(t.dataset.qId, 10));
  else if (t.dataset.action === 'submit-reply') submitReply(parseInt(t.dataset.qId, 10));
});
(function wire() {
  document.querySelectorAll('[data-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () { filterQuestions(btn.dataset.filter, btn); });
  });
  var back = document.getElementById('btn-detail-back');
  if (back) back.addEventListener('click', showList);
})();
})();
