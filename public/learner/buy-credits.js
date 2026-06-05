(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var currentInstructorId = parseInt(params.get('instructor_id'), 10);
  if (!Number.isInteger(currentInstructorId) || currentInstructorId <= 0) currentInstructorId = null;

  var auth = null;
  var instructors = [];

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function formatHours(minutes) {
    var mins = Number(minutes || 0);
    var hrs = mins / 60;
    return hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
  }

  function selectedInstructorName() {
    var inst = instructors.find(function (item) {
      return Number(item.id) === Number(currentInstructorId);
    });
    return inst ? inst.name : '';
  }

  function renderRetiredPageShell() {
    var headerMeta = document.querySelector('.doc-header-left span:last-child');
    if (headerMeta) headerMeta.innerHTML = 'Lesson credit<span class="doc-meta-dot">·</span>Existing balance';
    var headerRight = document.querySelector('.doc-header > span:last-child');
    if (headerRight) headerRight.textContent = 'Read-only';
    var eyebrow = document.querySelector('.hero-eyebrow');
    if (eyebrow) eyebrow.textContent = 'Lesson Credit';
    var selectorLabel = document.getElementById('instructorSelectorLabel');
    if (selectorLabel) selectorLabel.textContent = 'View balance for';
    var help = document.getElementById('instructorHelp');
    if (help) help.textContent = 'Lesson Credit is scoped to the instructor it was issued against.';
    var pricingContext = document.querySelector('#pricingContext span:first-child');
    if (pricingContext) pricingContext.textContent = 'Selected balance';
  }

  function renderGuestState() {
    setText('creditsTitle', 'Lesson Credit');
    var subtitle = document.getElementById('creditsSubtitle');
    if (subtitle) {
      subtitle.innerHTML = 'Self-serve top-ups are no longer available. '
        + '<a href="/learner/login.html?redirect=/learner/buy-credits.html">Sign in</a> to view existing Lesson Credit, or book a lesson and pay directly.';
    }
    setText('balanceLabel', 'Sign in required');
    setText('balanceValue', '-');
    setText('balanceUnit', 'existing Lesson Credit');
    setText('packagesLabel', 'Existing credit only');
    setText('packagesNote', 'Learners without enough Lesson Credit can still pay for a lesson at booking.');
  }

  function renderBalance(data) {
    var selectedName = selectedInstructorName();
    var selectedMinutes = data.selected_instructor_balance_minutes;
    var totalMinutes = data.balance_minutes || 0;
    var displayMinutes = selectedMinutes != null ? selectedMinutes : totalMinutes;

    setText('creditsTitle', selectedName ? 'Lesson Credit with ' + selectedName : 'Lesson Credit');
    setText('creditsSubtitle', 'Existing Lesson Credit is still available for booking eligible lessons. New self-serve top-ups are retired.');
    setText('balanceLabel', selectedName ? 'Hours with ' + selectedName : 'Total hours');
    setText('balanceValue', formatHours(displayMinutes));
    setText('balanceUnit', selectedName ? 'hours with this instructor' : 'hours across instructors');
    setText('pricingRateValue', selectedName ? formatHours(displayMinutes) + ' hrs' : formatHours(totalMinutes) + ' hrs');
    setText('packagesLabel', 'No self-serve top-ups');
    setText('packagesNote', 'To book without enough Lesson Credit, choose a slot and use the pay-and-book option.');

    var rowsEl = document.getElementById('creditBalanceRows') || document.getElementById('packages');
    if (!rowsEl) return;

    var rows = (data.balances || []).filter(function (row) {
      return (row.balance_minutes || 0) > 0;
    });

    if (!rows.length) {
      rowsEl.innerHTML = '<div class="pkg-card" aria-disabled="true"><div class="pkg-left"><div class="pkg-title">No Lesson Credit yet</div><div class="pkg-detail">You can still book and pay for individual lessons.</div></div></div>';
      return;
    }

    rowsEl.innerHTML = rows.map(function (row) {
      return '<div class="pkg-card" aria-disabled="true">'
        + '<div class="pkg-left">'
        + '<div class="pkg-title">' + escapeHtml(row.instructor_name || 'Instructor') + '</div>'
        + '<div class="pkg-detail">' + (row.instructor_active === false ? 'Inactive instructor' : 'Available for eligible bookings') + '</div>'
        + '</div>'
        + '<div class="pkg-right">'
        + '<div class="pkg-price">' + formatHours(row.balance_minutes) + '</div>'
        + '<div class="pkg-detail">hrs</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function loadInstructors() {
    var select = document.getElementById('instructorSelect');
    try {
      var res = await fetch('/api/instructors?action=list');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load instructors');
      instructors = Array.isArray(data.instructors) ? data.instructors : [];

      if (currentInstructorId && !instructors.some(function (inst) { return Number(inst.id) === Number(currentInstructorId); })) {
        currentInstructorId = null;
      }

      if (select) {
        select.innerHTML = '<option value="">All instructors</option>';
        instructors.forEach(function (inst) {
          var opt = document.createElement('option');
          opt.value = String(inst.id);
          opt.textContent = inst.name;
          opt.selected = Number(inst.id) === Number(currentInstructorId);
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('Failed to load instructors:', err);
      instructors = [];
      currentInstructorId = null;
      if (select) select.innerHTML = '<option value="">All instructors</option>';
    }
  }

  async function loadBalance() {
    if (!auth) {
      renderGuestState();
      return;
    }

    try {
      var url = '/api/credits?action=balance';
      if (currentInstructorId) url += '&instructor_id=' + encodeURIComponent(currentInstructorId);
      var res = await ccAuth.fetchAuthed(url);
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load balance');
      renderBalance(data);
    } catch (err) {
      console.warn('Failed to load Lesson Credit balance:', err);
      setText('balanceValue', '?');
      setText('packagesNote', 'Could not load your Lesson Credit balance. Please refresh or try again shortly.');
    }
  }

  var instructorSelect = document.getElementById('instructorSelect');
  if (instructorSelect) {
    instructorSelect.addEventListener('change', function () {
      var parsed = parseInt(instructorSelect.value, 10);
      currentInstructorId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      loadBalance();
    });
  }

  if (params.get('cancelled') === 'true') {
    window.history.replaceState({}, '', '/learner/buy-credits.html');
  }

  renderRetiredPageShell();
  auth = ccAuth.getAuth();
  loadInstructors().then(loadBalance);
})();
