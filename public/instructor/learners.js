(function () {
  'use strict';

let instructor;
let allLearners = [];
let currentSort = 'recent';
let currentDetailLearnerId = null;

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

  filtered = sortLearners(filtered);

  document.getElementById('learner-count').textContent =
    filtered.length + (filtered.length === 1 ? ' learner' : ' learners');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state-icon">&#x1F465;</div>
        <h2>${search ? 'No matching learners' : 'No learners yet'}</h2>
        <p>${search ? 'Try a different search term.' : 'Learners who book lessons with you will appear here.'}</p>
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

    // Notes preview
    let notesPreview = '';
    if (l.instructor_notes) {
      const preview = l.instructor_notes.length > 60 ? l.instructor_notes.slice(0, 60) + '…' : l.instructor_notes;
      notesPreview = '<div class="learner-notes-preview">' + esc(preview) + '</div>';
    }

    return `
      <div class="learner-card fade-in" style="cursor:pointer" data-action="open-learner" data-learner-id="${l.id}">
        <div class="learner-card-top">
          <span class="learner-name">${esc(l.name || 'Unnamed')}${l.prefer_contact_before ? '<span class="contact-pref-badge">Contact first</span>' : ''}${testBadge}${rateBadge}</span>
          <span class="tier-badge tier-${tier}">${tierLabels[tier] || 'Tier ' + tier}</span>
        </div>
        <div class="learner-stats">
          ${stats.join(' &middot; ')}
          ${l.last_lesson_date ? ' &middot; Last: ' + formatDate(l.last_lesson_date) : ''}
        </div>
        <div class="learner-contact">
          ${contact.join(' &middot; ')}
        </div>
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
  if (l.email) {
    html += '<div style="margin-top:10px"><button data-action="offer-lesson" data-email="' + esc(l.email) + '" style="padding:8px 16px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);border-radius:8px;font-weight:700;font-size:0.82rem;cursor:pointer;transition:all 0.15s">📧 Offer a lesson</button></div>';
  }
  html += '</div>';

  // Stats cards
  html += '<div class="detail-stats">';
  html += '<div class="detail-stat"><div class="detail-stat-value">' + data.totalLessons + '</div><div class="detail-stat-label">Completed</div></div>';
  html += '<div class="detail-stat"><div class="detail-stat-value">' + data.bookings.length + '</div><div class="detail-stat-label">Total Bookings</div></div>';
  if (firstDate) html += '<div class="detail-stat"><div class="detail-stat-value">' + formatDate(firstDate) + '</div><div class="detail-stat-label">First Lesson</div></div>';
  if (lastDate) html += '<div class="detail-stat"><div class="detail-stat-value">' + formatDate(lastDate) + '</div><div class="detail-stat-label">Last Lesson</div></div>';
  html += '</div>';

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
      if (b.session_notes) {
        card += '<div class="booking-notes">' + esc(b.session_notes) + '</div>';
      }
      if (b.learner_ratings && b.learner_ratings.length > 0) {
        card += '<div class="skill-pills">';
        card += b.learner_ratings.map(r =>
          '<span class="skill-pill skill-' + r.rating + '">' + esc(r.skill_key.replace(/_/g, ' ')) + '</span>'
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
      html += '<div style="font-size:0.85rem;">' + resultHtml + '</div>';
      if (mt.notes) html += '<div style="font-size:0.82rem;color:var(--muted);margin-top:4px;font-style:italic;">' + esc(mt.notes) + '</div>';
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
  const rateInput = document.getElementById('detail-hourly-rate').value;
  const customHourlyRatePence = rateInput !== '' ? Math.round(parseFloat(rateInput) * 100) : null;

  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/instructor?action=update-learner-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learner_id: currentDetailLearnerId, notes: notes || null, test_date: testDate, custom_hourly_rate_pence: customHourlyRatePence })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update the cached learner in allLearners so the list view reflects changes
    const cached = allLearners.find(l => l.id === currentDetailLearnerId);
    if (cached) {
      cached.instructor_notes = notes || null;
      cached.test_date = testDate;
      cached.custom_hourly_rate_pence = customHourlyRatePence;
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

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Offer Lesson (redirect to schedule page with offer modal open) ──
function offerLessonToLearner(email) {
  // Navigate to the schedule page with a query param to open the offer modal
  window.location.href = '/instructor/?offer=' + encodeURIComponent(email);
}

window.addEventListener('DOMContentLoaded', init);

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'load-learners') loadLearners();
  else if (a === 'open-learner') openLearner(parseInt(t.dataset.learnerId, 10));
  else if (a === 'offer-lesson') offerLessonToLearner(t.dataset.email);
});
(function wire() {
  document.querySelectorAll('[data-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () { setSort(btn.dataset.sort); });
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
