(function () {
  'use strict';

let AUTH;
let allQuestions = [];
let currentFilter = 'all';
let askSessionId = null;
let askBookingId = null;

// ── Auth (optional — browsing is allowed without login) ──
window.addEventListener('DOMContentLoaded', () => {
  AUTH = ccAuth.getAuth();
  if (AUTH?.user?.name) document.getElementById('header-name').textContent = AUTH.user.name;

  // Check URL params
  const params = new URLSearchParams(window.location.search);
  askSessionId = params.get('session_id');
  askBookingId = params.get('booking_id');
  if (params.get('ask') === '1') {
    setTimeout(() => openAskForm(), 300);
  }

  loadQuestions();
});

function logout() { ccAuth.logout(); }

// ── Load questions ──
async function loadQuestions() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=qa-list');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    allQuestions = data.questions || [];
    renderQuestions();
  } catch (err) {
    document.getElementById('questions-list').innerHTML =
      '<div style="text-align:center;color:var(--muted);padding:24px">Failed to load questions.</div>';
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
        <p>${currentFilter === 'all' ? 'Be the first to ask! Your instructor will answer here.' : 'Check the other tabs or ask a new question.'}</p>
        ${currentFilter === 'all' ? '<button class="btn-ask" data-action="open-ask-form">+ Ask a Question</button>' : ''}
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(q => `
    <div class="q-card fade-in" data-action="open-question" data-q-id="${q.id}">
      <div class="q-card-top">
        <div class="q-card-title">${esc(q.title)}</div>
        <span class="q-card-status status-${q.status}">${q.status}</span>
      </div>
      <div class="q-card-meta">
        <span>Asked by ${esc(q.learner_name || 'Learner')}</span>
        <span>${timeAgo(q.created_at)}</span>
        <span>${q.answer_count} ${q.answer_count === 1 ? 'reply' : 'replies'}</span>
      </div>
    </div>
  `).join('');
}

// ── Open question detail ──
async function openQuestion(id) {
  document.getElementById('list-view').style.display = 'none';
  const dv = document.getElementById('detail-view');
  dv.classList.add('show');
  dv.querySelector('#detail-content').innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px">Loading...</div>';

  try {
    const res = await ccAuth.fetchAuthed(`/api/learner?action=qa-detail&question_id=${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderDetail(data.question, data.answers);
  } catch (err) {
    dv.querySelector('#detail-content').innerHTML = '<div style="color:var(--red);padding:24px">Failed to load question.</div>';
  }
}

function renderDetail(q, answers) {
  const isOwner = q.learner_id === AUTH.user?.id;
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
      ${answers.length === 0 ? '<div style="color:var(--muted);font-size:0.85rem;margin-bottom:20px">No replies yet. Your instructor will respond soon!</div>' : ''}
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
        <textarea id="reply-body" placeholder="Add a follow-up..."></textarea>
        <button class="btn-submit-q" data-action="submit-reply" data-q-id="${q.id}">Reply</button>
      </div>
    </div>
  `;
}

function showList() {
  document.getElementById('detail-view').classList.remove('show');
  document.getElementById('list-view').style.display = 'block';
  loadQuestions();
}

// ── Ask form ──
function openAskForm() {
  if (window.ccAuth && !window.ccAuth.requireAuth()) return;
  document.getElementById('ask-overlay').classList.add('show');
  document.getElementById('ask-title').focus();
}

function closeAskForm() {
  document.getElementById('ask-overlay').classList.remove('show');
  document.getElementById('ask-title').value = '';
  document.getElementById('ask-body').value = '';
}

async function submitQuestion() {
  const title = document.getElementById('ask-title').value.trim();
  const body = document.getElementById('ask-body').value.trim();
  if (!title) { showToast('Please enter your question', 'error'); return; }

  const btn = document.getElementById('btn-submit-q');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const payload = { title, body: body || null };
    if (askSessionId) payload.session_id = parseInt(askSessionId);
    if (askBookingId) payload.booking_id = parseInt(askBookingId);

    const res = await ccAuth.fetchAuthed('/api/learner?action=qa-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeAskForm();
    showToast('Question submitted!');
    askSessionId = null;
    askBookingId = null;
    loadQuestions();
  } catch (err) {
    showToast(err.message || 'Failed to submit', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Question';
  }
}

async function submitReply(questionId) {
  const textarea = document.getElementById('reply-body');
  const body = textarea.value.trim();
  if (!body) { showToast('Please enter a reply', 'error'); return; }

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=qa-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId, body })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Reply posted!');
    openQuestion(questionId);
  } catch (err) {
    showToast(err.message || 'Failed to post reply', 'error');
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

document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'open-ask-form') openAskForm();
  else if (action === 'open-question') openQuestion(parseInt(target.dataset.qId, 10));
  else if (action === 'submit-reply') submitReply(parseInt(target.dataset.qId, 10));
});
(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-signout-nav', function () { if (typeof logout === 'function') logout(); });
  document.querySelectorAll('[data-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () { filterQuestions(btn.dataset.filter, btn); });
  });
  bind('btn-detail-back', showList);
  var overlay = document.getElementById('ask-overlay');
  if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAskForm(); });
  bind('btn-ask-cancel', closeAskForm);
  bind('btn-submit-q', submitQuestion);
})();
})();
