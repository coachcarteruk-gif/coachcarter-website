(function () {
  'use strict';

  // Free Trial lesson type id (school 1, slug='trial'). Hardcoded because
  // the page is single-purpose; if/when other schools join we'll fetch this.
  var FREE_TRIAL_LESSON_TYPE_ID = 37;
  var DAYS_AHEAD = 14;

  // ── State ────────────────────────────────────────────────────────────────
  // Slot objects from the API include instructor_name, so no separate fetch needed.
  var slotsByDate = {}; // { 'YYYY-MM-DD': [ {start_time, end_time, instructor_id, instructor_name}, ... ] }
  var selectedSlot = null;  // { date, start_time, end_time, instructor_id, instructor_name }
  var referralCode = null;
  var prefInstructorId = null; // ?instructor_id= hint (filters slot feed)
  var prefDate = null;         // ?date= hint (scrolls into view)

  // ── Init ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Capture ?ref=XXX for forward-compat referrer flow
    var qs = new URLSearchParams(window.location.search);
    referralCode = qs.get('ref') || qs.get('referral_code') || null;
    // Hints carried over from book.html "claim as free trial" CTA
    var rawInstructor = qs.get('instructor_id');
    if (rawInstructor && /^\d+$/.test(rawInstructor)) prefInstructorId = rawInstructor;
    var rawDate = qs.get('date');
    if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) prefDate = rawDate;

    posthogCapture('free_trial_page_viewed', {
      has_referral: !!referralCode,
      from_book: !!(prefInstructorId || prefDate)
    });

    document.getElementById('trialForm').addEventListener('submit', handleSubmit);

    loadSlots();
  });

  // ── PostHog helper (no-op if posthog not loaded yet) ────────────────────
  function posthogCapture(event, props) {
    try {
      if (window.posthog && typeof posthog.capture === 'function') {
        posthog.capture(event, props || {});
      }
    } catch (e) { /* swallow */ }
  }

  // ── Slot loading ─────────────────────────────────────────────────────────
  function loadSlots() {
    var today = new Date();
    var fromStr = ymd(today);
    var to = new Date(today);
    to.setDate(to.getDate() + DAYS_AHEAD);
    var toStr = ymd(to);

    var url = '/api/slots?action=available&from=' + fromStr + '&to=' + toStr + '&lesson_type_id=' + FREE_TRIAL_LESSON_TYPE_ID;
    if (prefInstructorId) url += '&instructor_id=' + encodeURIComponent(prefInstructorId);
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (slotsResp) {
        if (slotsResp && slotsResp.slots) {
          slotsByDate = slotsResp.slots;
          renderSlots();
        } else {
          renderSlotsError(slotsResp && slotsResp.error ? slotsResp.error : 'Could not load slots.');
        }
      })
      .catch(function (err) {
        console.error('Slot load failed:', err);
        renderSlotsError('Could not load slots. Please refresh and try again.');
      });
  }

  function renderSlots() {
    var picker = document.getElementById('slotPicker');
    var dates = Object.keys(slotsByDate).sort();

    var hasAny = dates.some(function (d) { return slotsByDate[d] && slotsByDate[d].length; });
    if (!hasAny) {
      picker.innerHTML = '<div class="slot-empty">No free trial slots available in the next ' + DAYS_AHEAD + ' days. Please check back soon.</div>';
      return;
    }

    var html = '';
    dates.forEach(function (date) {
      var slots = slotsByDate[date] || [];
      if (!slots.length) return;

      var label = formatDateLabel(date);
      var preselected = (prefDate && date === prefDate) ? ' day-group--preselected' : '';
      html += '<div class="day-group' + preselected + '" data-date="' + escapeAttr(date) + '">';
      html += '<div class="day-label">' + escapeHtml(label) + '</div>';
      html += '<div class="slot-row">';
      slots.forEach(function (s) {
        var instructorName = s.instructor_name || 'Instructor';
        var firstName = instructorName.split(' ')[0];
        var startShort = (s.start_time || '').slice(0, 5);
        html += '<button type="button" class="slot-btn" '
          + 'data-date="' + escapeAttr(date) + '" '
          + 'data-start="' + escapeAttr(s.start_time) + '" '
          + 'data-end="' + escapeAttr(s.end_time) + '" '
          + 'data-instructor-id="' + escapeAttr(String(s.instructor_id)) + '" '
          + 'data-instructor-name="' + escapeAttr(instructorName) + '">'
          + escapeHtml(startShort)
          + '<span class="slot-instructor">with ' + escapeHtml(firstName) + '</span>'
          + '</button>';
      });
      html += '</div></div>';
    });
    picker.innerHTML = html;

    // Wire up clicks
    picker.querySelectorAll('.slot-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { selectSlot(btn); });
    });

    // If we arrived with a ?date= hint, scroll the matching day group into view.
    if (prefDate) {
      var target = picker.querySelector('.day-group--preselected');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function renderSlotsError(msg) {
    var picker = document.getElementById('slotPicker');
    picker.innerHTML = '<div class="slot-error">' + escapeHtml(msg) + '</div>';
  }

  function selectSlot(btn) {
    document.querySelectorAll('.slot-btn.selected').forEach(function (el) { el.classList.remove('selected'); });
    btn.classList.add('selected');

    selectedSlot = {
      date: btn.dataset.date,
      start_time: btn.dataset.start,
      end_time: btn.dataset.end,
      instructor_id: parseInt(btn.dataset.instructorId, 10),
      instructor_name: btn.dataset.instructorName
    };

    posthogCapture('free_trial_slot_selected', {
      date: selectedSlot.date,
      instructor_id: selectedSlot.instructor_id
    });

    updateSummary();

    var submit = document.getElementById('submitBtn');
    submit.disabled = false;
    submit.textContent = 'Book my free trial';
  }

  function updateSummary() {
    var bar = document.getElementById('summaryBar');
    if (!selectedSlot) { bar.style.display = 'none'; return; }
    var label = formatDateLabel(selectedSlot.date);
    bar.innerHTML = 'Booking <strong>' + escapeHtml(selectedSlot.start_time.slice(0, 5))
      + '</strong> on <strong>' + escapeHtml(label) + '</strong> with <strong>'
      + escapeHtml(selectedSlot.instructor_name) + '</strong>.';
    bar.style.display = 'block';
  }

  // ── Form submit ──────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    var errEl = document.getElementById('formError');
    errEl.classList.remove('visible');
    errEl.textContent = '';

    if (!selectedSlot) {
      showError('Please pick a slot first.');
      return;
    }

    var payload = {
      instructor_id: selectedSlot.instructor_id,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
      guest_name: val('guest_name'),
      guest_email: val('guest_email'),
      guest_phone: val('guest_phone'),
      guest_pickup_address: val('guest_pickup_address')
    };
    if (referralCode) payload.referral_code = referralCode;

    // Client-side validation (server does authoritative checks)
    if (!payload.guest_name) { showError('Please enter your name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.guest_email)) { showError('Please enter a valid email.'); return; }
    if (!/^(?:07\d{9}|\+447\d{9})$/.test(payload.guest_phone.replace(/\s+/g, ''))) {
      showError('Please enter a valid UK mobile (07xxx xxx xxx).');
      return;
    }
    if (!payload.guest_pickup_address) { showError('Please enter a pickup address.'); return; }

    var submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking…';

    posthogCapture('free_trial_submitted', { instructor_id: payload.instructor_id });

    fetch('/api/slots?action=book-free-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        posthogCapture('free_trial_confirmed', {
          booking_id: r.body.booking_id,
          instructor_id: payload.instructor_id
        });
        window.location.href = r.body.redirect_url || '/free-trial-success.html';
        return;
      }

      if (r.status === 409 && r.body.error === 'already_used') {
        posthogCapture('free_trial_blocked_existing');
        showError(r.body.message || "You've already booked a free trial. Check your email or log in.");
      } else if (r.status === 409) {
        // slot just taken
        showError(r.body.error || 'Sorry, that slot was just taken. Please pick another.');
        loadSlots(); // refresh the picker
        selectedSlot = null;
      } else if (r.status === 429) {
        showError(r.body.error || 'Too many attempts. Please try again in an hour.');
      } else {
        showError(r.body.error || r.body.message || 'Could not book — please try again.');
      }

      submitBtn.disabled = false;
      submitBtn.textContent = selectedSlot ? 'Book my free trial' : 'Pick a time first';
    }).catch(function (err) {
      console.error('Submit failed:', err);
      showError('Connection failed. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Book my free trial';
    });
  }

  function showError(msg) {
    var errEl = document.getElementById('formError');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function ymd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDateLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }
})();
