(function () {
  'use strict';

  var HEADERS = { 'Content-Type': 'application/json' };
  var fetchAdmin = window.ccAdminAuth.fetchAuthed;
  var learners = [];
  var instructors = [];
  var currentLearner = null;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAdminDisplay() {
    var adminData = null;
    var instrData = null;
    try { adminData = JSON.parse(localStorage.getItem('cc_admin') || 'null'); } catch (e) {}
    try { instrData = JSON.parse(localStorage.getItem('cc_instructor') || 'null'); } catch (e) {}
    var isInstructorAdmin = !adminData && instrData && instrData.instructor && instrData.instructor.is_admin;
    if (!adminData && !isInstructorAdmin) {
      window.location.href = '/admin/login.html';
      return;
    }
    if (isInstructorAdmin) {
      $('admin-name').textContent = instrData.instructor.name || 'Admin';
      $('admin-email').textContent = instrData.instructor.email || '';
      $('logout-btn').textContent = 'Back to Portal';
      $('logout-btn').addEventListener('click', function () {
        window.location.href = '/instructor/';
      });
    } else {
      $('admin-name').textContent = (adminData.admin && adminData.admin.name) || 'Admin';
      $('admin-email').textContent = (adminData.admin && adminData.admin.email) || '';
      $('logout-btn').addEventListener('click', window.ccAdminAuth.logout);
    }
  }

  function toast(message, type) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast show' + (type ? ' ' + type : '');
    window.setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function formatDate(value) {
    if (!value) return '-';
    var d = new Date(String(value).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function formatShortDate(value) {
    if (!value) return '-';
    var d = new Date(String(value).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function money(pence) {
    if (pence == null || pence === '') return '-';
    return '£' + (Number(pence) / 100).toFixed(2).replace(/\.00$/, '');
  }

  function hours(minutes) {
    var mins = Number(minutes || 0);
    if (!mins) return '0h';
    var h = mins / 60;
    return (Math.round(h * 10) / 10).toString().replace(/\.0$/, '') + 'h';
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var today = new Date();
    var start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    var target = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
    if (Number.isNaN(target)) return null;
    return Math.round((target - start) / 86400000);
  }

  function canHaveFreeTrial(learner) {
    return !!learner.free_trial_allowed;
  }

  function getFlags(learner) {
    var flags = [];
    var testDays = daysUntil(learner.test_date);
    if (testDays != null && testDays >= 0 && testDays <= 30 && !learner.test_instructor_booked) {
      flags.push({ text: 'Test instructor?', tone: 'red' });
    }
    if (learner.test_date && !learner.primary_instructor_id) {
      flags.push({ text: 'No instructor', tone: 'red' });
    }
    if (Number(learner.balance_minutes || 0) > 0 && Number(learner.upcoming_bookings || 0) === 0) {
      flags.push({ text: 'Credit idle', tone: 'amber' });
    }
    if (learner.free_trial_allowed && Number(learner.trial_booking_count || 0) > 0) {
      flags.push({ text: 'Trial override on', tone: 'blue' });
    }
    if (!learner.learner_category) {
      flags.push({ text: 'No status', tone: 'gray' });
    }
    return flags;
  }

  function optionHtml(items, selected, includeBlank) {
    var html = includeBlank ? '<option value="">Not assigned</option>' : '';
    html += items.map(function (i) {
      return '<option value="' + i.id + '"' + (String(i.id) === String(selected || '') ? ' selected' : '') + '>' +
        esc(i.name) + (i.active ? '' : ' (inactive)') +
        '</option>';
    }).join('');
    return html;
  }

  async function loadControls() {
    $('learners-body').innerHTML = '<tr><td colspan="9" class="empty-state">Loading learner controls...</td></tr>';
    try {
      var res = await fetchAdmin('/api/admin?action=learner-controls', { headers: HEADERS });
      if (!res.ok) throw new Error('Failed to load learner controls');
      var data = await res.json();
      learners = data.learners || [];
      instructors = data.instructors || [];
      populateFilters();
      render();
    } catch (err) {
      console.error(err);
      $('learners-body').innerHTML = '<tr><td colspan="9" class="empty-state">Failed to load learner controls</td></tr>';
      toast('Failed to load learner controls', 'error');
    }
  }

  function populateFilters() {
    $('filter-instructor').innerHTML = '<option value="">All instructors</option>' + optionHtml(instructors, '', false);
    $('field-instructor').innerHTML = optionHtml(instructors.filter(function (i) { return i.active; }), '', true);
  }

  function filteredLearners() {
    var q = $('search-input').value.trim().toLowerCase();
    var view = $('filter-view').value;
    var instructorId = $('filter-instructor').value;
    return learners.filter(function (learner) {
      if (instructorId && String(learner.primary_instructor_id || '') !== instructorId) return false;
      if (q) {
        var haystack = [
          learner.name, learner.email, learner.phone, learner.primary_instructor_name,
          learner.test_centre, learner.pickup_address
        ].join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      if (view === 'attention' && getFlags(learner).filter(function (f) { return f.tone !== 'gray'; }).length === 0) return false;
      if (view === 'test') {
        var d = daysUntil(learner.test_date);
        if (d == null || d < 0) return false;
      }
      if (view === 'trial' && !canHaveFreeTrial(learner)) return false;
      if (view === 'credit' && Number(learner.balance_minutes || 0) <= 0) return false;
      return true;
    });
  }

  function updateMetrics() {
    var attention = learners.filter(function (l) {
      return getFlags(l).filter(function (f) { return f.tone !== 'gray'; }).length > 0;
    }).length;
    var tests = learners.filter(function (l) {
      var d = daysUntil(l.test_date);
      return d != null && d >= 0;
    }).length;
    var trials = learners.filter(canHaveFreeTrial).length;
    $('metric-learners').textContent = learners.length;
    $('metric-attention').textContent = attention;
    $('metric-tests').textContent = tests;
    $('metric-trials').textContent = trials;
  }

  function render() {
    updateMetrics();
    var rows = filteredLearners();
    var body = $('learners-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty-state">No learners match this view</td></tr>';
      return;
    }
    body.innerHTML = rows.map(renderRow).join('');
  }

  function renderRow(learner) {
    var flags = getFlags(learner);
    var flagHtml = flags.length
      ? flags.map(function (f) { return '<span class="badge ' + f.tone + '">' + esc(f.text) + '</span>'; }).join('')
      : '<span class="badge green">Clear</span>';
    var trialBadge = canHaveFreeTrial(learner)
      ? '<span class="badge green">Allowed</span>'
      : '<span class="badge amber">Blocked</span>';
    var trialSubtext = Number(learner.trial_booking_count || 0) > 0
      ? 'Used before' + (learner.trial_completed_at ? ' - ' + formatShortDate(learner.trial_completed_at) : '')
      : 'Not used';
    var testExtra = learner.test_date
      ? '<span class="subtle">' + esc(learner.test_time || '') + (learner.test_centre ? ' ' + esc(learner.test_centre) : '') + '</span>'
      : '<span class="subtle">Not set</span>';
    var rateText = learner.custom_hourly_rate_pence != null
      ? money(learner.custom_hourly_rate_pence)
      : (learner.instructor_hourly_rate_pence != null ? money(learner.instructor_hourly_rate_pence) : '-');
    var rateSub = learner.custom_hourly_rate_pence != null ? 'custom' : 'default';

    return '<tr>' +
      '<td><div class="learner-name">' + esc(learner.name || 'Unnamed learner') + '</div>' +
        '<span class="subtle">' + esc(learner.email || '') + '</span>' +
        '<span class="subtle">' + esc(learner.phone || '') + '</span></td>' +
      '<td>' + esc(learner.primary_instructor_name || 'Not assigned') +
        '<span class="subtle">' + esc(learner.learner_category || 'No status') + '</span></td>' +
      '<td><span class="money">' + esc(rateText) + '</span><span class="subtle">' + rateSub + '</span></td>' +
      '<td><span class="money">' + esc(hours(learner.balance_minutes)) + '</span><span class="subtle">' + esc((learner.credit_balances || []).length) + ' balance row(s)</span></td>' +
      '<td>' + trialBadge + '<span class="subtle">' + esc(trialSubtext) + '</span></td>' +
      '<td><span class="money">' + esc(formatDate(learner.test_date)) + '</span>' + testExtra +
        (learner.test_instructor_booked ? '<span class="subtle">Instructor booked</span>' : '') + '</td>' +
      '<td>' + esc(formatShortDate(learner.next_booking_date)) + '<span class="subtle">Last ' + esc(formatShortDate(learner.last_lesson_date || learner.last_booking_date)) + '</span></td>' +
      '<td><div class="flag-list">' + flagHtml + '</div></td>' +
      '<td><button type="button" class="btn" data-edit="' + learner.id + '">Edit</button></td>' +
    '</tr>';
  }

  function openEditor(id) {
    currentLearner = learners.find(function (l) { return String(l.id) === String(id); });
    if (!currentLearner) return;
    $('editor-title').textContent = currentLearner.name || 'Unnamed learner';
    $('editor-subtitle').textContent = [currentLearner.email, currentLearner.phone].filter(Boolean).join(' - ');
    $('field-learner-id').value = currentLearner.id;
    $('field-instructor').innerHTML = optionHtml(instructors.filter(function (i) {
      return i.active || String(i.id) === String(currentLearner.primary_instructor_id || '');
    }), currentLearner.primary_instructor_id, true);
    $('field-category').value = currentLearner.learner_category || '';
    $('field-rate').value = currentLearner.custom_hourly_rate_pence != null
      ? (Number(currentLearner.custom_hourly_rate_pence) / 100).toFixed(2)
      : '';
    $('field-trial-allowed').checked = !!currentLearner.free_trial_allowed;
    $('field-test-date').value = currentLearner.test_date || '';
    $('field-test-time').value = currentLearner.test_time || '';
    $('field-test-centre').value = currentLearner.test_centre || '';
    $('field-test-instructor-booked').checked = !!currentLearner.test_instructor_booked;
    $('field-notes').value = currentLearner.admin_control_notes || '';
    $('editor-panel').classList.add('open');
    $('editor-panel').setAttribute('aria-hidden', 'false');
  }

  function closeEditor() {
    $('editor-panel').classList.remove('open');
    $('editor-panel').setAttribute('aria-hidden', 'true');
    currentLearner = null;
  }

  async function saveControls(event) {
    event.preventDefault();
    var rateValue = $('field-rate').value.trim();
    var ratePence = rateValue ? Math.round(Number(rateValue) * 100) : null;
    if (rateValue && (!Number.isFinite(ratePence) || ratePence < 0)) {
      toast('Enter a valid hourly rate', 'error');
      return;
    }
    $('save-btn').disabled = true;
    try {
      var res = await fetchAdmin('/api/admin?action=update-learner-controls', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          learner_id: $('field-learner-id').value,
          primary_instructor_id: $('field-instructor').value || null,
          learner_category: $('field-category').value || null,
          custom_hourly_rate_pence: ratePence,
          free_trial_allowed: $('field-trial-allowed').checked,
          test_date: $('field-test-date').value || null,
          test_time: $('field-test-time').value || null,
          test_centre: $('field-test-centre').value || null,
          test_instructor_booked: $('field-test-instructor-booked').checked,
          admin_control_notes: $('field-notes').value || null
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || data.message || 'Save failed');
      toast('Learner controls saved');
      closeEditor();
      await loadControls();
    } catch (err) {
      toast(err.message || 'Failed to save learner controls', 'error');
    } finally {
      $('save-btn').disabled = false;
    }
  }

  function bindEvents() {
    $('refresh-btn').addEventListener('click', loadControls);
    $('search-input').addEventListener('input', render);
    $('filter-view').addEventListener('change', render);
    $('filter-instructor').addEventListener('change', render);
    $('learners-body').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-edit]');
      if (btn) openEditor(btn.dataset.edit);
    });
    $('close-editor').addEventListener('click', closeEditor);
    $('cancel-editor').addEventListener('click', closeEditor);
    $('controls-form').addEventListener('submit', saveControls);
    $('mobile-menu-btn').addEventListener('click', function () {
      $('sidebar').classList.add('open');
      $('sidebar-overlay').classList.add('open');
    });
    $('sidebar-overlay').addEventListener('click', function () {
      $('sidebar').classList.remove('open');
      $('sidebar-overlay').classList.remove('open');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    getAdminDisplay();
    bindEvents();
    fetchAdmin('/api/admin?action=verify').then(function (res) {
      if (!res.ok) window.ccAdminAuth.logout();
    }).catch(window.ccAdminAuth.logout);
    loadControls();
  });
})();
