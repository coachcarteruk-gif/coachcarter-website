(function () {
  'use strict';

  var DAYS_AHEAD = 28;
  var META_LEAD_PENDING_KEY = 'cc_meta_lead_pending';

  // ── State ────────────────────────────────────────────────────────────────
  var slotsByDate = {}; // { 'YYYY-MM-DD': [ {start_time, end_time, instructor_id, ...}, ... ] }
  var selectedDate = null;
  var loadedFromDate = null;
  var loadedToDate = null;
  var selectedSlot = null;  // { date, start_time, end_time, instructor_id }
  var referralCode = null;
  var prefInstructorId = null; // ?instructor_id= hint (filters slot feed)
  var prefDate = null;         // ?date= hint (scrolls into view)
  var displayedDaysAhead = DAYS_AHEAD;

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
    setupFieldValidation();
    setupCoursePreferences();

    loadSlots();
  });

  function setupCoursePreferences() {
    var interest = document.getElementById('intensive_interest');
    var months = document.getElementById('intensiveMonths');
    var container = document.getElementById('monthOptions');
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    var year = Number(parts.find(function (p) { return p.type === 'year'; }).value);
    var month = Number(parts.find(function (p) { return p.type === 'month'; }).value) - 1;
    for (var i = 0; i < 12; i++) {
      var date = new Date(Date.UTC(year, month + i, 1));
      var label = document.createElement('label');
      label.className = 'preference-option';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'intensive_months';
      input.value = date.toISOString().slice(0, 7);
      label.appendChild(input);
      label.appendChild(document.createTextNode(date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })));
      container.appendChild(label);
    }
    function sync() {
      months.hidden = !interest.checked;
      months.disabled = !interest.checked;
      interest.setAttribute('aria-expanded', String(interest.checked));
      if (!interest.checked) container.querySelectorAll('input').forEach(function (input) { input.checked = false; });
    }
    interest.addEventListener('change', sync);
    sync();
  }

  // ── PostHog helper (no-op if posthog not loaded yet) ────────────────────
  function posthogCapture(event, props) {
    try {
      if (window.posthog && typeof posthog.capture === 'function') {
        posthog.capture(event, props || {});
      }
    } catch (e) { /* swallow */ }
  }

  function queueMetaLeadForSuccessPage() {
    if (!window.ccCookieConsent || !window.ccCookieConsent.marketingAllowed()) return;

    try {
      sessionStorage.setItem(META_LEAD_PENDING_KEY, '1');
    } catch (e) {
      // If sessionStorage is unavailable, fire before redirecting as a fallback.
      if (window.ccMetaPixel) window.ccMetaPixel.trackLead();
    }
  }

  // ── Slot loading ─────────────────────────────────────────────────────────
  function loadSlots() {
    getTrialWindowContext().then(function (context) {
      displayedDaysAhead = context.days_ahead;
      loadedFromDate = context.from;
      loadedToDate = context.to;
      var url = '/api/slots?action=available&from=' + encodeURIComponent(context.from)
        + '&to=' + encodeURIComponent(context.to) + '&lesson_type_slug=trial';
      if (prefInstructorId) url += '&instructor_id=' + encodeURIComponent(prefInstructorId);
      return fetch(url);
    })
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

  function getTrialWindowContext() {
    var url = '/api/slots?action=trial-window-context';
    if (prefInstructorId) url += '&instructor_id=' + encodeURIComponent(prefInstructorId);
    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('Trial window request failed');
        return response.json();
      })
      .then(function (context) {
        if (!context || !/^\d{4}-\d{2}-\d{2}$/.test(context.from)
            || !/^\d{4}-\d{2}-\d{2}$/.test(context.to)) {
          throw new Error('Invalid trial window response');
        }
        return {
          from: context.from,
          to: context.to,
          days_ahead: Number.isInteger(context.days_ahead) ? context.days_ahead : DAYS_AHEAD
        };
      });
  }

  function renderSlots() {
    var picker = document.getElementById('slotPicker');
    var dates = Object.keys(slotsByDate).sort();

    var hasAny = dates.some(function (d) { return slotsByDate[d] && slotsByDate[d].length; });
    if (!hasAny) {
      picker.innerHTML = '<div class="slot-empty">No free trial slots available in the next ' + displayedDaysAhead + ' days. Please check back soon.</div>';
      return;
    }

    if (!selectedDate || !slotsByDate[selectedDate] || !slotsByDate[selectedDate].length) {
      selectedDate = prefDate && slotsByDate[prefDate] && slotsByDate[prefDate].length
        ? prefDate
        : dates.find(function (date) { return slotsByDate[date] && slotsByDate[date].length; });
    }

    picker.innerHTML = renderDateGrid() + renderTimesForSelectedDate();

    picker.querySelectorAll('.date-cell-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedDate = btn.dataset.date;
        selectedSlot = null;
        updateSummary();
        clearSlotSelectionError();
        setSubmitState();
        renderSlots();
        var times = document.getElementById('selectedDayTimes');
        if (times) scrollToElement(times, 'nearest');
      });
    });

    picker.querySelectorAll('.slot-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { selectSlot(btn); });
    });

    // If we arrived with a ?date= hint, scroll the matching day group into view.
    if (prefDate) {
      var target = picker.querySelector('.date-cell-open[aria-current="date"]');
      if (target && typeof target.scrollIntoView === 'function') {
        scrollToElement(target, 'center');
      }
    }
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderDateGrid() {
    var start = new Date((loadedFromDate || ymd(new Date())) + 'T00:00:00');
    var end = new Date((loadedToDate || loadedFromDate || ymd(new Date())) + 'T00:00:00');
    var availableDates = Object.keys(slotsByDate).filter(function (date) {
      return slotsByDate[date] && slotsByDate[date].length;
    }).sort();

    // Keeps mocked/static feeds useful without changing the production range.
    if (availableDates.length && (availableDates[0] < ymd(start) || availableDates[0] > ymd(end))) {
      start = new Date(availableDates[0] + 'T00:00:00');
      end = new Date(start);
      end.setDate(end.getDate() + DAYS_AHEAD);
    }

    var cells = [];
    var cursor = new Date(start);
    while (cursor <= end) {
      var date = ymd(cursor);
      var count = (slotsByDate[date] || []).length;
      var selected = date === selectedDate;
      var dayNumber = cursor.getDate();
      var todayClass = date === ymd(new Date()) ? ' date-cell-today' : '';
      if (count) {
        cells.push('<button type="button" class="date-cell date-cell-open' + todayClass + '" '
          + 'data-date="' + escapeAttr(date) + '" aria-pressed="' + String(selected) + '" '
          + (selected ? 'aria-current="date" ' : '')
          + 'aria-label="' + escapeAttr(formatDateLabel(date) + ', ' + count + ' time' + (count === 1 ? '' : 's') + ' available') + '">'
          + '<span class="date-cell-num">' + dayNumber + '</span>'
          + '<span class="date-cell-dot" aria-hidden="true"></span></button>');
      } else {
        cells.push('<span class="date-cell date-cell-off' + todayClass + '" aria-hidden="true">'
          + '<span class="date-cell-num">' + dayNumber + '</span></span>');
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    var firstDayOffset = (start.getDay() + 6) % 7;
    var blanks = '';
    for (var i = 0; i < firstDayOffset; i++) {
      blanks += '<span class="date-cell date-cell-blank" aria-hidden="true"></span>';
    }
    var header = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (day) {
      return '<span class="date-grid-head">' + day + '</span>';
    }).join('');
    var firstMonth = start.toLocaleDateString('en-GB', { month: 'long' });
    var lastMonth = end.toLocaleDateString('en-GB', { month: 'long' });
    var monthLabel = firstMonth === lastMonth ? firstMonth : firstMonth + ' – ' + lastMonth;
    monthLabel += ' ' + end.getFullYear();
    return '<div class="trial-calendar">'
      + '<div class="date-grid-month">' + escapeHtml(monthLabel) + '</div>'
      + '<div class="date-grid" role="group" aria-label="Choose a date">'
      + header + blanks + cells.join('') + '</div></div>';
  }

  function renderTimesForSelectedDate() {
    var slots = (slotsByDate[selectedDate] || []).slice().sort(function (a, b) {
      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });
    if (!slots.length) return '';

    var groups = [
      { label: 'Morning', slots: [] },
      { label: 'Afternoon', slots: [] },
      { label: 'Evening', slots: [] }
    ];
    slots.forEach(function (slot) {
      var hour = parseInt(String(slot.start_time || '00:00').slice(0, 2), 10);
      groups[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(slot);
    });

    var html = '<div class="selected-date-heading" id="selectedDayTimes"><strong>'
      + escapeHtml(formatDateLabel(selectedDate)) + '</strong><span>' + slots.length + ' time'
      + (slots.length === 1 ? '' : 's') + ' available</span></div><div class="time-groups">';
    groups.forEach(function (group) {
      if (!group.slots.length) return;
      html += '<section class="time-group"><h3 class="time-group-title">' + group.label + '</h3><div class="slot-row">';
      group.slots.forEach(function (s) {
        var startShort = String(s.start_time || '').slice(0, 5);
        var transmission = formatTransmission(s.transmission_type);
        html += '<button type="button" class="slot-btn" '
          + 'data-date="' + escapeAttr(selectedDate) + '" '
          + 'data-start="' + escapeAttr(s.start_time) + '" '
          + 'data-end="' + escapeAttr(s.end_time) + '" '
          + 'data-transmission-type="' + escapeAttr(s.transmission_type || 'both') + '" '
          + 'data-instructor-id="' + escapeAttr(String(s.instructor_id)) + '" '
          + 'aria-pressed="false" aria-label="Select ' + escapeAttr(startShort + (transmission ? ', ' + transmission : '')) + '">'
          + '<span class="slot-time">' + escapeHtml(startShort) + '</span>'
          + (transmission ? '<span class="slot-meta">' + escapeHtml(transmission) + '</span>' : '')
          + '</button>';
      });
      html += '</div></section>';
    });
    return html + '</div>';
  }

  function formatTransmission(value) {
    if (value === 'manual') return 'Manual';
    if (value === 'automatic') return 'Automatic';
    return '';
  }

  function renderSlotsError(msg) {
    var picker = document.getElementById('slotPicker');
    picker.innerHTML = '<div class="slot-error">' + escapeHtml(msg) + '</div>';
  }

  function selectSlot(btn) {
    document.querySelectorAll('.slot-btn.selected').forEach(function (el) {
      el.classList.remove('selected');
      el.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('selected');
    btn.setAttribute('aria-pressed', 'true');

    selectedSlot = {
      date: btn.dataset.date,
      start_time: btn.dataset.start,
      end_time: btn.dataset.end,
      transmission_type: btn.dataset.transmissionType,
      instructor_id: parseInt(btn.dataset.instructorId, 10)
    };

    posthogCapture('free_trial_slot_selected', {
      date: selectedSlot.date,
      instructor_id: selectedSlot.instructor_id
    });

    updateSummary();

    clearSlotSelectionError();
    setSubmitState();

    // QoL: auto-scroll to the details form so the learner can immediately
    // see what to do next. Without this, the slot just changes colour and
    // the form stays out of view - common cause of drop-off.
    var formAnchor = document.getElementById('step-2-heading');
    if (formAnchor && typeof formAnchor.scrollIntoView === 'function') {
      scrollToElement(formAnchor, 'start');
    }
  }

  function updateSummary() {
    var bar = document.getElementById('summaryBar');
    if (!selectedSlot) { bar.style.display = 'none'; return; }
    var label = formatDateLabel(selectedSlot.date);
    bar.innerHTML = 'Booking <strong>' + escapeHtml(selectedSlot.start_time.slice(0, 5))
      + '</strong> on <strong>' + escapeHtml(label) + '</strong>.';
    bar.style.display = 'block';
  }

  // ── Form submit ──────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();
    var errEl = document.getElementById('formError');
    errEl.classList.remove('visible');
    errEl.textContent = '';

    if (!selectedSlot) {
      promptForSlot();
      return;
    }

    var payload = {
      instructor_id: selectedSlot.instructor_id,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
      transmission_type: selectedSlot.transmission_type,
      guest_name: val('guest_name'),
      guest_email: val('guest_email'),
      guest_phone: val('guest_phone'),
      guest_pickup_address: val('guest_pickup_address'),
      email_course_opt_in: document.getElementById('email_course_opt_in').checked,
      intensive_interest: document.getElementById('intensive_interest').checked,
      intensive_months: document.getElementById('intensive_interest').checked
        ? Array.from(document.querySelectorAll('#monthOptions input:checked')).map(function (input) { return input.value; }) : []
    };
    if (referralCode) payload.referral_code = referralCode;

    // Client-side validation (server does authoritative checks).
    if (!validateForm()) return;

    setSubmitState(true);

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
        queueMetaLeadForSuccessPage();
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
        updateSummary();
      } else if (r.status === 429) {
        showError(r.body.error || 'Too many attempts. Please try again in an hour.');
      } else {
        showError(r.body.error || r.body.message || 'Could not book - please try again.');
      }

      setSubmitState();
    }).catch(function (err) {
      console.error('Submit failed:', err);
      showError('Connection failed. Please try again.');
      setSubmitState();
    });
  }

  function setSubmitState(isBooking) {
    var submitBtn = document.getElementById('submitBtn');
    if (!submitBtn) return;

    if (isBooking) {
      submitBtn.disabled = true;
      submitBtn.classList.remove('needs-slot');
      submitBtn.textContent = 'Booking…';
      return;
    }

    submitBtn.disabled = false;
    if (selectedSlot) {
      submitBtn.classList.remove('needs-slot');
      submitBtn.textContent = 'Book my free trial';
    } else {
      submitBtn.classList.add('needs-slot');
      submitBtn.textContent = 'Choose a time above';
    }
  }

  function promptForSlot() {
    var slotError = document.getElementById('slotSelectionError');
    if (slotError) slotError.textContent = 'Choose an available time before continuing.';

    var stepHeading = document.getElementById('step-1-heading');
    if (stepHeading) {
      stepHeading.setAttribute('tabindex', '-1');
      scrollToElement(stepHeading, 'start');
      try { stepHeading.focus({ preventScroll: true }); } catch (e) { stepHeading.focus(); }
    }
  }

  function clearSlotSelectionError() {
    var slotError = document.getElementById('slotSelectionError');
    if (slotError) slotError.textContent = '';
  }

  function setupFieldValidation() {
    ['guest_name', 'guest_email', 'guest_phone', 'guest_pickup_address'].forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;

      input.addEventListener('blur', function () {
        validateField(id);
      });
      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true' && !getFieldError(id)) {
          clearFieldError(id);
        }
      });
    });
  }

  function validateForm() {
    var firstInvalid = null;
    ['guest_name', 'guest_email', 'guest_phone', 'guest_pickup_address'].forEach(function (id) {
      if (!validateField(id) && !firstInvalid) firstInvalid = document.getElementById(id);
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  function validateField(id) {
    var error = getFieldError(id);
    if (error) {
      setFieldError(id, error);
      return false;
    }
    clearFieldError(id);
    return true;
  }

  function getFieldError(id) {
    var value = val(id);
    if (id === 'guest_name') return value ? '' : 'Enter your full name.';
    if (id === 'guest_email') {
      if (!value) return 'Enter your email address.';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Enter a valid email address.';
    }
    if (id === 'guest_phone') {
      if (!value) return 'Enter your UK mobile number.';
      return /^(?:07\d{9}|\+447\d{9})$/.test(value.replace(/\s+/g, ''))
        ? ''
        : 'Enter a valid UK mobile number, such as 07123 456 789.';
    }
    if (id === 'guest_pickup_address') return value ? '' : 'Enter your pickup address.';
    return '';
  }

  function setFieldError(id, message) {
    var input = document.getElementById(id);
    var error = document.getElementById(id + '_error');
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
  }

  function clearFieldError(id) {
    var input = document.getElementById(id);
    var error = document.getElementById(id + '_error');
    if (input) input.removeAttribute('aria-invalid');
    if (error) error.textContent = '';
  }

  function showError(msg) {
    var errEl = document.getElementById('formError');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    scrollToElement(errEl, 'center');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function scrollToElement(element, block) {
    if (!element || typeof element.scrollIntoView !== 'function') return;
    var reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: block || 'start' });
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
