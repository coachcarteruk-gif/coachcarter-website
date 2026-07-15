(function () {
  'use strict';

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
    setupFieldValidation();

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

    var url = '/api/slots?action=available&from=' + fromStr + '&to=' + toStr + '&lesson_type_slug=trial';
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
          + 'data-transmission-type="' + escapeAttr(s.transmission_type || 'both') + '" '
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
        scrollToElement(target, 'center');
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
      transmission_type: btn.dataset.transmissionType,
      instructor_id: parseInt(btn.dataset.instructorId, 10),
      instructor_name: btn.dataset.instructorName
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
      guest_pickup_address: val('guest_pickup_address')
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
