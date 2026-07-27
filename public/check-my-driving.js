(function () {
  'use strict';

  var LESSON_TYPE_SLUG = 'check';
  var DAYS_AHEAD = 14;
  var lessonType = null;
  var slotsByDate = {};
  var selectedSlot = null;
  var selectedPricePence = null;
  var prefInstructorId = null;
  var prefDate = null;
  var pricingRequestId = 0;

  document.addEventListener('DOMContentLoaded', function () {
    var qs = new URLSearchParams(window.location.search);
    var rawInstructor = qs.get('instructor_id');
    var rawDate = qs.get('date');
    if (rawInstructor && /^\d+$/.test(rawInstructor)) prefInstructorId = rawInstructor;
    if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) prefDate = rawDate;

    capture('driving_ability_check_page_viewed', {
      from_booking_link: !!(prefInstructorId || prefDate)
    });

    document.getElementById('assessmentForm').addEventListener('submit', handleSubmit);
    setupFieldValidation();
    loadLessonType();
    loadSlots();
  });

  function capture(event, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(event, props || {});
      }
    } catch (_) {}
  }

  function loadLessonType(instructorId) {
    var requestId = ++pricingRequestId;
    var url = '/api/lesson-types?action=list';
    if (instructorId) url += '&instructor_id=' + encodeURIComponent(instructorId);

    return fetch(url)
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (result) {
        if (requestId !== pricingRequestId) return null;
        if (!result.ok) throw new Error(result.body.message || result.body.error || 'Could not load the assessment.');
        var types = result.body.lesson_types || [];
        var found = types.find(function (type) { return type && type.slug === LESSON_TYPE_SLUG; });
        if (!found) throw new Error('The Driving Ability Check is not currently available.');
        if (Number(found.duration_minutes) !== 90) {
          throw new Error('The Driving Ability Check duration is not configured correctly.');
        }

        lessonType = found;
        selectedPricePence = Number(found.price_pence);
        renderPrice();
        setSubmitState();
        return found;
      })
      .catch(function (err) {
        if (requestId !== pricingRequestId) return null;
        lessonType = null;
        selectedPricePence = null;
        document.getElementById('heroPrice').textContent = 'Unavailable';
        showError(err.message || 'Could not load the assessment.');
        setSubmitState();
        throw err;
      });
  }

  function loadSlots() {
    var today = new Date();
    var to = new Date(today);
    to.setDate(to.getDate() + DAYS_AHEAD);

    var url = '/api/slots?action=available&from=' + ymd(today)
      + '&to=' + ymd(to)
      + '&lesson_type_slug=' + encodeURIComponent(LESSON_TYPE_SLUG);
    if (prefInstructorId) url += '&instructor_id=' + encodeURIComponent(prefInstructorId);

    fetch(url)
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.message || result.body.error || 'Could not load slots.');
        slotsByDate = result.body.slots || {};
        renderSlots();
      })
      .catch(function (err) {
        console.error('Driving ability check slot load failed:', err);
        renderSlotsError(err.message || 'Could not load slots. Please refresh and try again.');
      });
  }

  function renderSlots() {
    var picker = document.getElementById('slotPicker');
    var dates = Object.keys(slotsByDate).sort();
    var hasAny = dates.some(function (date) {
      return slotsByDate[date] && slotsByDate[date].length;
    });

    if (!hasAny) {
      picker.innerHTML = '<div class="slot-empty">No assessment slots are available in the next '
        + DAYS_AHEAD + ' days. Please check back soon.</div>';
      return;
    }

    var html = '';
    dates.forEach(function (date) {
      var slots = slotsByDate[date] || [];
      if (!slots.length) return;

      var preselected = prefDate && date === prefDate ? ' day-group--preselected' : '';
      html += '<div class="day-group' + preselected + '" data-date="' + escapeAttr(date) + '">';
      html += '<div class="day-label">' + escapeHtml(formatDateLabel(date)) + '</div>';
      html += '<div class="slot-row">';
      slots.forEach(function (slot) {
        var instructorName = slot.instructor_name || 'Instructor';
        html += '<button type="button" class="slot-btn"'
          + ' data-date="' + escapeAttr(date) + '"'
          + ' data-start="' + escapeAttr(slot.start_time) + '"'
          + ' data-end="' + escapeAttr(slot.end_time) + '"'
          + ' data-transmission-type="' + escapeAttr(slot.transmission_type || 'both') + '"'
          + ' data-instructor-id="' + escapeAttr(String(slot.instructor_id)) + '"'
          + ' data-instructor-name="' + escapeAttr(instructorName) + '"'
          + ' data-request-to-book="' + (slot.request_to_book ? 'true' : 'false') + '">'
          + escapeHtml(String(slot.start_time || '').slice(0, 5))
          + '<span class="slot-instructor">with ' + escapeHtml(instructorName.split(' ')[0]) + '</span>'
          + '</button>';
      });
      html += '</div></div>';
    });

    picker.innerHTML = html;
    picker.querySelectorAll('.slot-btn').forEach(function (button) {
      button.addEventListener('click', function () { selectSlot(button); });
    });

    if (prefDate) {
      var target = picker.querySelector('.day-group--preselected');
      if (target) scrollToElement(target, 'center');
    }
  }

  function renderSlotsError(message) {
    document.getElementById('slotPicker').innerHTML =
      '<div class="slot-error">' + escapeHtml(message) + '</div>';
  }

  function selectSlot(button) {
    document.querySelectorAll('.slot-btn.selected').forEach(function (item) {
      item.classList.remove('selected');
    });
    button.classList.add('selected');

    selectedSlot = {
      date: button.dataset.date,
      start_time: button.dataset.start,
      end_time: button.dataset.end,
      transmission_type: button.dataset.transmissionType,
      instructor_id: parseInt(button.dataset.instructorId, 10),
      instructor_name: button.dataset.instructorName,
      request_to_book: button.dataset.requestToBook === 'true'
    };
    selectedPricePence = null;
    clearSlotSelectionError();
    updateSummary();
    setSubmitState(true);

    capture('driving_ability_check_slot_selected', {
      date: selectedSlot.date,
      instructor_id: selectedSlot.instructor_id,
      request_to_book: selectedSlot.request_to_book
    });

    loadLessonType(selectedSlot.instructor_id)
      .then(function (found) {
        if (!found) return;
        updateSummary();
        setSubmitState();
      })
      .catch(function () {
        setSubmitState();
      });

    var formAnchor = document.getElementById('step-2-heading');
    if (formAnchor) scrollToElement(formAnchor, 'start');
  }

  function renderPrice() {
    var heroPrice = document.getElementById('heroPrice');
    if (heroPrice) {
      heroPrice.textContent = Number.isFinite(selectedPricePence) && selectedPricePence > 0
        ? formatMoney(selectedPricePence)
        : 'Price at checkout';
    }
  }

  function updateSummary() {
    var bar = document.getElementById('summaryBar');
    if (!selectedSlot) {
      bar.style.display = 'none';
      bar.textContent = '';
      return;
    }

    var price = Number.isFinite(selectedPricePence) && selectedPricePence > 0
      ? ' for <strong>' + escapeHtml(formatMoney(selectedPricePence)) + '</strong>'
      : '';
    var requestNote = selectedSlot.request_to_book
      ? '<br>Your card will only be charged if the instructor accepts your request.'
      : '';
    bar.innerHTML = '<strong>' + escapeHtml(selectedSlot.start_time.slice(0, 5))
      + '</strong> on <strong>' + escapeHtml(formatDateLabel(selectedSlot.date))
      + '</strong> with <strong>' + escapeHtml(selectedSlot.instructor_name)
      + '</strong>' + price + '.' + requestNote;
    bar.style.display = 'block';
  }

  function handleSubmit(event) {
    event.preventDefault();
    hideError();

    if (!selectedSlot) {
      promptForSlot();
      return;
    }
    if (!lessonType || !lessonType.id || !Number.isFinite(selectedPricePence) || selectedPricePence <= 0) {
      showError('We could not confirm the assessment price. Please choose the time again.');
      return;
    }
    if (!validateForm()) return;

    var common = {
      instructor_id: selectedSlot.instructor_id,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
      transmission_type: selectedSlot.transmission_type,
      lesson_type_id: lessonType.id,
      guest_name: val('guest_name'),
      guest_email: val('guest_email'),
      guest_phone: val('guest_phone')
    };
    var address = val('guest_pickup_address');
    var payload = Object.assign({}, common);
    var action;
    if (selectedSlot.request_to_book) {
      action = 'checkout-request';
      payload.pickup_address = address;
    } else {
      action = 'checkout-slot-guest';
      payload.guest_pickup_address = address;
    }

    setSubmitState(true);
    capture('driving_ability_check_checkout_started', {
      instructor_id: selectedSlot.instructor_id,
      price_pence: selectedPricePence,
      request_to_book: selectedSlot.request_to_book
    });

    fetch('/api/slots?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (result) {
        if (result.ok && result.body.url) {
          window.location.href = result.body.url;
          return;
        }

        if (result.status === 409) {
          showError(result.body.message || result.body.error || 'That slot was just taken. Please choose another.');
          selectedSlot = null;
          selectedPricePence = null;
          updateSummary();
          loadSlots();
        } else if (result.status === 429) {
          showError(result.body.message || result.body.error || 'Too many attempts. Please try again later.');
        } else {
          showError(result.body.message || result.body.error || 'Could not start payment. Please try again.');
        }
        setSubmitState();
      })
      .catch(function (err) {
        console.error('Driving ability check checkout failed:', err);
        showError('Connection failed. Please try again.');
        setSubmitState();
      });
  }

  function setSubmitState(isBusy) {
    var button = document.getElementById('submitBtn');
    if (!button) return;

    if (isBusy) {
      button.disabled = true;
      button.classList.remove('needs-slot');
      button.textContent = selectedSlot && selectedPricePence === null
        ? 'Checking price…'
        : 'Taking you to Stripe…';
      return;
    }

    button.disabled = false;
    if (!selectedSlot) {
      button.classList.add('needs-slot');
      button.textContent = 'Choose a time above';
    } else if (!lessonType || !Number.isFinite(selectedPricePence) || selectedPricePence <= 0) {
      button.disabled = true;
      button.classList.add('needs-slot');
      button.textContent = 'Price unavailable';
    } else {
      button.classList.remove('needs-slot');
      button.textContent = selectedSlot.request_to_book
        ? 'Secure my request • ' + formatMoney(selectedPricePence)
        : 'Continue to secure payment • ' + formatMoney(selectedPricePence);
    }
  }

  function promptForSlot() {
    document.getElementById('slotSelectionError').textContent =
      'Choose an available time before continuing.';
    var heading = document.getElementById('step-1-heading');
    heading.setAttribute('tabindex', '-1');
    scrollToElement(heading, 'start');
    try { heading.focus({ preventScroll: true }); } catch (_) { heading.focus(); }
  }

  function clearSlotSelectionError() {
    document.getElementById('slotSelectionError').textContent = '';
  }

  function setupFieldValidation() {
    ['guest_name', 'guest_email', 'guest_phone', 'guest_pickup_address', 'guest_terms']
      .forEach(function (id) {
        var input = document.getElementById(id);
        input.addEventListener('blur', function () { validateField(id); });
        input.addEventListener(id === 'guest_terms' ? 'change' : 'input', function () {
          if (input.getAttribute('aria-invalid') === 'true' && !getFieldError(id)) {
            clearFieldError(id);
          }
        });
      });
  }

  function validateForm() {
    var firstInvalid = null;
    ['guest_name', 'guest_email', 'guest_phone', 'guest_pickup_address', 'guest_terms']
      .forEach(function (id) {
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
    if (id === 'guest_terms') return document.getElementById(id).checked ? '' : 'Agree to the terms to continue.';
    return '';
  }

  function setFieldError(id, message) {
    var input = document.getElementById(id);
    var error = document.getElementById(id + '_error');
    input.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
  }

  function clearFieldError(id) {
    var input = document.getElementById(id);
    var error = document.getElementById(id + '_error');
    input.removeAttribute('aria-invalid');
    if (error) error.textContent = '';
  }

  function showError(message) {
    var error = document.getElementById('formError');
    error.textContent = message;
    error.classList.add('visible');
    scrollToElement(error, 'center');
  }

  function hideError() {
    var error = document.getElementById('formError');
    error.textContent = '';
    error.classList.remove('visible');
  }

  function val(id) {
    var input = document.getElementById(id);
    return input && typeof input.value === 'string' ? input.value.trim() : '';
  }

  function scrollToElement(element, block) {
    if (!element || typeof element.scrollIntoView !== 'function') return;
    var reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: block || 'start' });
  }

  function ymd(date) {
    return date.getFullYear() + '-'
      + String(date.getMonth() + 1).padStart(2, '0') + '-'
      + String(date.getDate()).padStart(2, '0');
  }

  function formatDateLabel(dateString) {
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  function formatMoney(pence) {
    return '£' + (Number(pence) / 100).toFixed(2);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }
})();
