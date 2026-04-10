(function () {
  'use strict';

  let token = null;
  let currentWeekStart = null; // ISO date string of current week's Monday
  let historyOffset = 0;
  const HISTORY_LIMIT = 12;

  function formatPence(pence) {
    return '\u00A3' + (pence / 100).toFixed(2);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function formatDateShort(dateStr) {
    // Handle both ISO strings "2026-04-01" and full date strings from API
    var s = typeof dateStr === 'string' ? dateStr.slice(0, 10) : new Date(dateStr).toISOString().slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function formatTime(timeStr) {
    // timeStr like "09:00:00" or "09:00"
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]);
    const m = parts[1];
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return h12 + ':' + m + ampm;
  }

  // Get Monday of a given week offset (0 = this week, -1 = last week, etc)
  function getMondayISO(offsetWeeks) {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff + (offsetWeeks * 7));
    return d.toISOString().slice(0, 10);
  }

  function shiftWeek(direction) {
    const d = new Date(currentWeekStart + 'T00:00:00');
    d.setDate(d.getDate() + (direction * 7));
    currentWeekStart = d.toISOString().slice(0, 10);
    loadWeek();
  }

  async function apiFetch(action, params = '') {
    const res = await ccAuth.fetchAuthed(`/api/instructor?action=${action}${params}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // ── Render functions ─────────────────────────────────────────────────────────

  function renderSummary(data) {
    return `
      <div class="summary-cards">
        <div class="summary-card">
          <div class="summary-value accent">${formatPence(data.this_month.earnings_pence)}</div>
          <div class="summary-label">This Month</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${formatPence(data.avg_per_week_pence)}</div>
          <div class="summary-label">Avg / Week</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${data.all_time.lesson_count}</div>
          <div class="summary-label">Total Lessons</div>
        </div>
      </div>
    `;
  }

  function toDateStr(v) {
    return typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
  }

  function renderWeek(data) {
    var ws = toDateStr(data.week_start), we = toDateStr(data.week_end);
    const weekLabel = formatDateShort(ws) + ' \u2013 ' + formatDateShort(we);
    const isCurrentWeek = ws === getMondayISO(0);
    const isFuture = new Date(we + 'T23:59:59') > new Date();

    let lessonsHTML = '';
    if (data.lessons.length === 0) {
      lessonsHTML = '<div class="empty-state">No lessons this week</div>';
    } else {
      lessonsHTML = data.lessons.map(l => `
        <div class="lesson-row">
          <div class="lesson-info">
            <div class="lesson-date">
              ${formatDate(l.date)}
              <span class="status-badge status-${l.status}">${l.status}</span>
            </div>
            <div class="lesson-learner">${l.learner_name} &middot; ${l.lesson_type_name}</div>
            <div class="lesson-time">${formatTime(l.start_time)} \u2013 ${formatTime(l.end_time)} (${l.duration_minutes} min)</div>
          </div>
          <div class="lesson-pay">${formatPence(l.instructor_pay_pence)}</div>
        </div>
      `).join('');
    }

    return `
      <div class="section-card" id="week-section">
        <div class="section-header">
          <div class="section-title">This Week's Pay</div>
          <div class="section-total">${formatPence(data.total_pence)}</div>
        </div>
        <div class="week-nav">
          <button class="week-nav-btn" data-action="shift-week" data-delta="-1">&larr; Prev</button>
          <div class="week-date-range">${weekLabel}</div>
          <button class="week-nav-btn" data-action="shift-week" data-delta="1" ${isCurrentWeek ? 'disabled' : ''}>${isCurrentWeek ? 'This week' : 'Next &rarr;'}</button>
        </div>
        <div>
          ${data.completed_count + data.confirmed_count > 0
            ? `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px;">
                ${data.completed_count} completed &middot; ${data.confirmed_count} upcoming
              </div>`
            : ''}
          ${lessonsHTML}
          ${data.fee_model === 'franchise' && data.gross_pence > 0 ? `
            <div style="border-top:2px solid var(--border);margin-top:12px;padding-top:12px;font-size:0.85rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="color:var(--muted);">Gross earnings</span>
                <span>${formatPence(data.gross_pence)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="color:var(--muted);">Franchise fee</span>
                <span style="color:#991b1b;">&minus;${formatPence(data.franchise_fee_applied_pence)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-weight:700;">
                <span>Your pay</span>
                <span style="color:var(--accent);">${formatPence(data.total_pence)}</span>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderHistory(weeks, append) {
    if (!append) {
      if (weeks.length === 0) {
        return `
          <div class="section-card">
            <div class="section-title" style="margin-bottom:0;">Past Weeks</div>
            <div class="empty-state">No completed lessons yet</div>
          </div>
        `;
      }
      return `
        <div class="section-card" id="history-section">
          <div class="section-title" style="margin-bottom:16px;">Past Weeks</div>
          <table class="history-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Lessons</th>
                <th>Hours</th>
                <th class="col-right">Pay</th>
              </tr>
            </thead>
            <tbody id="history-body">
              ${renderHistoryRows(weeks)}
            </tbody>
          </table>
          <button class="btn-load-more" id="btn-load-more" data-action="load-more-history">Load more weeks</button>
        </div>
      `;
    }
    // Append mode
    const tbody = document.getElementById('history-body');
    if (tbody) tbody.insertAdjacentHTML('beforeend', renderHistoryRows(weeks));
    if (weeks.length < HISTORY_LIMIT) {
      const btn = document.getElementById('btn-load-more');
      if (btn) { btn.textContent = 'No more weeks'; btn.disabled = true; }
    }
    return null;
  }

  function renderHistoryRows(weeks) {
    return weeks.map(w => `
      <tr>
        <td>${formatDateShort(w.week_start)} \u2013 ${formatDateShort(w.week_end)}</td>
        <td>${w.lesson_count}</td>
        <td>${w.total_hours}h</td>
        <td class="col-pay">${formatPence(w.instructor_pay_pence)}</td>
      </tr>
    `).join('');
  }

  // ── Connect & Payout renders ──────────────────────────────────────────────────

  function renderConnectBanner(status) {
    // Dismissed: no account + payouts paused = platform owner, hide banner entirely
    if (!status.has_account && status.payouts_paused) {
      return '';
    }
    if (!status.has_account) {
      return `
        <div class="connect-banner not-started">
          <div class="connect-banner-text">
            <div class="connect-banner-title">Set Up Direct Payouts</div>
            <div class="connect-banner-desc">Get paid automatically every Friday. Connect your bank account to start receiving payouts.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="connect-btn" data-action="start-connect">Set Up Payouts</button>
            <button class="connect-btn secondary" data-action="dismiss-connect" style="font-size:0.78rem;">Not needed</button>
          </div>
        </div>
      `;
    }
    if (!status.onboarding_complete) {
      return `
        <div class="connect-banner pending">
          <div class="connect-banner-text">
            <div class="connect-banner-title">Finish Setting Up Payouts</div>
            <div class="connect-banner-desc">You've started the process — just a few more steps to connect your bank account.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="connect-btn" data-action="continue-connect">Continue Setup</button>
            <button class="connect-btn secondary" data-action="dismiss-connect" style="font-size:0.78rem;">Not needed</button>
          </div>
        </div>
      `;
    }
    if (status.payouts_paused) {
      return `
        <div class="connect-banner pending">
          <div class="connect-banner-text">
            <div class="connect-banner-title">Payouts Paused</div>
            <div class="connect-banner-desc">Your payouts are currently paused by admin. Contact your manager for details.</div>
          </div>
          <button class="connect-btn secondary" data-action="open-stripe">View Stripe Dashboard</button>
        </div>
      `;
    }
    return `
      <div class="connect-banner active">
        <div class="connect-banner-text">
          <div class="connect-banner-title" style="color:#166534;">&#x2705; Payouts Active</div>
          <div class="connect-banner-desc">You're set up to receive automatic payouts every Friday.</div>
        </div>
        <button class="connect-btn secondary" data-action="open-stripe">Stripe Dashboard</button>
      </div>
    `;
  }

  function renderNextPayout(preview) {
    if (!preview.onboarding_complete || preview.eligible_lessons === 0) return '';
    return `
      <div class="next-payout-card">
        <div>
          <div class="next-payout-label">Next Payout &middot; Friday ${formatDateShort(preview.next_payout_date)}</div>
          <div class="next-payout-detail">${preview.eligible_lessons} lesson${preview.eligible_lessons === 1 ? '' : 's'} ready${preview.payouts_paused ? ' (paused)' : ''}</div>
        </div>
        <div class="next-payout-amount">${formatPence(preview.estimated_pence)}</div>
      </div>
    `;
  }

  function renderPayoutHistory(data) {
    if (!data.payouts || data.payouts.length === 0) return '';
    const rows = data.payouts.map(p => `
      <div class="payout-row">
        <div>
          <div style="font-size:0.82rem;font-weight:600;">${formatDateShort(p.period_start)} &ndash; ${formatDateShort(p.period_end)}</div>
          <div style="font-size:0.75rem;color:var(--muted);">${p.lesson_count} lesson${p.lesson_count == 1 ? '' : 's'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="payout-status ${p.status}">${p.status}</span>
          <span style="font-family:var(--font-head);font-weight:700;">${formatPence(p.amount_pence)}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="section-card">
        <div class="section-title" style="margin-bottom:16px;">Payout History</div>
        ${rows}
      </div>
    `;
  }

  async function startConnectOnboarding() {
    try {
      const res = await ccAuth.fetchAuthed('/api/connect?action=create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.ok && data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else {
        showToast(data.message || 'Failed to start setup. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    }
  }

  async function continueConnectOnboarding() {
    try {
      const res = await ccAuth.fetchAuthed('/api/connect?action=onboarding-link');
      const data = await res.json();
      if (data.ok && data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else {
        showToast(data.message || 'Failed to get onboarding link. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    }
  }

  let pendingDismissResolve = null;
  async function dismissConnect() {
    // Show confirmation modal instead of window.confirm()
    const confirmed = await new Promise(resolve => {
      pendingDismissResolve = resolve;
      document.getElementById('dismissConfirmModal').classList.add('open');
    });
    if (!confirmed) return;
    try {
      const res = await ccAuth.fetchAuthed('/api/connect?action=dismiss-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.ok) {
        document.querySelector('.connect-banner')?.remove();
      } else {
        showToast(data.message || 'Failed to dismiss.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    }
  }
  function closeDismissModal(result) {
    document.getElementById('dismissConfirmModal').classList.remove('open');
    if (pendingDismissResolve) { pendingDismissResolve(result); pendingDismissResolve = null; }
  }

  async function openStripeDashboard() {
    try {
      const res = await ccAuth.fetchAuthed('/api/connect?action=dashboard-link');
      const data = await res.json();
      if (data.ok && data.dashboard_url) {
        window.open(data.dashboard_url, '_blank');
      } else {
        showToast(data.message || 'Failed to open dashboard.', 'error');
      }
    } catch (err) {
      showToast('Something went wrong. Please try again.', 'error');
    }
  }

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function loadWeek() {
    try {
      const data = await apiFetch('earnings-week', `&week_start=${currentWeekStart}`);
      const weekSection = document.getElementById('week-section');
      if (weekSection) {
        weekSection.outerHTML = renderWeek(data);
      }
    } catch (err) {
      console.error('Failed to load week:', err);
    }
  }

  async function loadMoreHistory() {
    const btn = document.getElementById('btn-load-more');
    if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }
    try {
      historyOffset += HISTORY_LIMIT;
      const data = await apiFetch('earnings-history', `&limit=${HISTORY_LIMIT}&offset=${historyOffset}`);
      renderHistory(data.weeks, true);
      if (data.weeks.length === HISTORY_LIMIT && btn) {
        btn.textContent = 'Load more weeks';
        btn.disabled = false;
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      if (btn) { btn.textContent = 'Failed to load'; btn.disabled = false; }
    }
  }

  async function init() {
    const auth = ccAuth.requireAuth();
    if (!auth) return;
    token = auth.token;

    currentWeekStart = getMondayISO(0);

    // Handle return from Stripe Connect onboarding
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connect') === 'return') {
      // Clean URL
      window.history.replaceState({}, '', '/instructor/earnings.html');
    }

    try {
      // Fetch all data in parallel
      const [summary, week, history, connectStatus, payoutPreview, payoutHistory] = await Promise.all([
        apiFetch('earnings-summary'),
        apiFetch('earnings-week', `&week_start=${currentWeekStart}`),
        apiFetch('earnings-history', `&limit=${HISTORY_LIMIT}&offset=0`),
        ccAuth.fetchAuthed('/api/connect?action=connect-status').then(r => r.json()).catch(() => ({ has_account: false, onboarding_complete: false })),
        apiFetch('next-payout-preview').catch(() => null),
        apiFetch('payout-history', '&limit=10').catch(() => ({ payouts: [] }))
      ]);

      const container = document.getElementById('earningsContent');
      container.innerHTML =
        renderConnectBanner(connectStatus) +
        renderSummary(summary) +
        (payoutPreview ? renderNextPayout(payoutPreview) : '') +
        renderWeek(week) +
        renderHistory(history.weeks, false) +
        renderPayoutHistory(payoutHistory) +
        (summary.fee_model === 'franchise'
          ? `<p class="commission-note">Franchise fee: ${formatPence(summary.weekly_franchise_fee_pence)}/week. You keep all lesson revenue minus this fee.</p>`
          : `<p class="commission-note">Your commission rate: ${Math.round(summary.commission_rate * 100)}%. Contact admin for queries.</p>`);

      // Hide load more if less than a full page
      if (history.weeks.length < HISTORY_LIMIT) {
        const btn = document.getElementById('btn-load-more');
        if (btn) { btn.textContent = 'No more weeks'; btn.disabled = true; }
      }

    } catch (err) {
      console.error('Failed to load earnings:', err);
      document.getElementById('earningsContent').innerHTML =
        '<div class="empty-state">Failed to load earnings data.<br><button data-action="retry-init" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>';
    }
  }

  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  init();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'shift-week') shiftWeek(parseInt(t.dataset.delta, 10));
  else if (a === 'load-more-history') loadMoreHistory();
  else if (a === 'start-connect') startConnectOnboarding();
  else if (a === 'dismiss-connect') dismissConnect();
  else if (a === 'continue-connect') continueConnectOnboarding();
  else if (a === 'open-stripe') openStripeDashboard();
  else if (a === 'retry-init') init();
});
(function wire() {
  var modal = document.getElementById('dismissConfirmModal');
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeDismissModal(false); });
  var cancel = document.getElementById('btn-dismiss-cancel');
  if (cancel) cancel.addEventListener('click', function () { closeDismissModal(false); });
  var confirm = document.getElementById('btn-dismiss-confirm');
  if (confirm) confirm.addEventListener('click', function () { closeDismissModal(true); });
})();
})();
