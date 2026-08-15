(function () {
  'use strict';

  var statusEl = document.getElementById('catalogue-status');
  var contentEl = document.getElementById('catalogue-content');
  var purchaseStatusEl = document.getElementById('purchase-status');
  var programmeStatusEl = document.getElementById('programme-status');
  var programmeStatusContentEl = document.getElementById('programme-status-content');
  var testBookingPanelEl = document.getElementById('test-booking-panel');
  var testBookingFormEl = document.getElementById('test-booking-form');
  var testBookingResultEl = document.getElementById('test-booking-result');
  var pollTimer = null;
  var pollStartedAt = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function formatPrice(pence, currency) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      minimumFractionDigits: Number(pence) % 100 === 0 ? 0 : 2,
      maximumFractionDigits: Number(pence) % 100 === 0 ? 0 : 2
    }).format(Number(pence || 0) / 100);
  }

  function schoolQuery() {
    var source = new URLSearchParams(window.location.search);
    var target = new URLSearchParams();
    if (source.get('school')) target.set('school', source.get('school'));
    else if (source.get('school_id')) target.set('school_id', source.get('school_id'));
    return target.toString();
  }

  function apiUrl(action, extra) {
    var query = new URLSearchParams(extra || {});
    query.set('action', action);
    var school = new URLSearchParams(schoolQuery());
    school.forEach(function (value, key) { query.set(key, value); });
    return '/api/packages?' + query.toString();
  }

  function renderList(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<ul class="product-details">' + items.map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join('') + '</ul>';
  }

  function actionButton(product, locked, describedBy) {
    var eligibility = product.eligibility || {};
    if (eligibility.checkout_available) {
      var rights = product.consumer_rights || {};
      return '<div class="consumer-checkout" data-consumer-checkout="' + escapeHtml(product.id) + '">' +
        '<p><strong>14-day cancellation right.</strong> Choose when matching may begin. Matching and administration have no deductible value, and CoachCarter absorbs Stripe fees.</p>' +
        '<label class="consumer-choice"><input type="radio" name="programme_start_' + escapeHtml(product.id) + '" value="after" checked> Begin matching after my 14-day cancellation period</label>' +
        '<label class="consumer-choice"><input type="radio" name="programme_start_' + escapeHtml(product.id) + '" value="now"> Begin matching now</label>' +
        '<p class="consumer-choice-detail">' + escapeHtml(rights.early_start_request || '') + '</p>' +
        '<label class="consumer-choice consumer-age"><input type="checkbox" name="adult_age_confirmed"> I confirm that I am 18 or over.</label>' +
        '<label class="consumer-choice consumer-terms"><input type="checkbox" name="consumer_terms_accepted"> ' + escapeHtml(rights.checkout_acknowledgement || '') + '</label>' +
        '<button type="button" class="product-action is-purchasable" data-package-checkout="' + escapeHtml(product.id) + '" data-disclosure-version="' + escapeHtml(rights.disclosure_version || '') + '" aria-describedby="' + describedBy + '">Pay ' + escapeHtml(formatPrice(product.price_pence, product.currency)) + ' and enrol</button>' +
      '</div>';
    }
    if (eligibility.state === 'authentication_required') {
      return '<button type="button" class="product-action is-purchasable" data-package-sign-in="1" aria-describedby="' + describedBy + '">Sign in for test checkout</button>';
    }
    if (eligibility.state === 'verification_pending') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Verification pending</button>';
    }
    if (eligibility.state === 'test_booking_required') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Verify test booking first</button>';
    }
    if (eligibility.state === 'already_enrolled') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Already enrolled</button>';
    }
    if (eligibility.state === 'controlled_pilot_access_required') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Controlled pilot access required</button>';
    }
    if (eligibility.state === 'consumer_terms_not_ready') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Consumer terms not approved</button>';
    }
    return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Fulfilment not in this pass</button>';
  }

  function renderProduct(product, options) {
    options = options || {};
    var content = product.content || {};
    var eligibility = product.eligibility || {};
    var locked = false;
    var descriptionId = 'product-disclosure-' + escapeHtml(product.slug);
    var lockId = 'product-lock-' + escapeHtml(product.slug);
    var label = options.label || (locked ? 'Locked phase' : 'Catalogue version ' + product.version_number);
    var lockCopy = locked
      ? '<p class="lock-explanation" id="' + lockId + '"><strong>Why this is locked:</strong> ' + escapeHtml(eligibility.reason) + '</p>'
      : '';
    var describedBy = locked ? lockId + ' ' + descriptionId : descriptionId;
    var disclosure = content.checkout_disclosure || eligibility.reason || 'Checkout is not available.';
    if (eligibility.checkout_available) {
      disclosure = 'Test mode only. A verified Stripe webhook creates the Full Curriculum enrolment; this return page cannot.';
    }

    return '<article class="product-shell' + (locked ? ' locked' : '') + '">' +
      '<div class="product-main">' +
        '<div class="product-topline"><div>' +
          '<p class="product-label">' + escapeHtml(label) + '</p>' +
          '<h3>' + escapeHtml(content.name || product.slug) + '</h3>' +
          '<p class="product-summary">' + escapeHtml(content.short_description || '') + '</p>' +
        '</div><div class="product-price">' + escapeHtml(formatPrice(product.price_pence, product.currency)) + '<small>version ' + escapeHtml(product.version_number) + '</small></div></div>' +
        renderList(content.highlights) + lockCopy +
      '</div>' +
      '<div class="product-footer">' +
        '<p class="version-note" id="' + descriptionId + '">' + escapeHtml(disclosure) + '</p>' +
        actionButton(product, locked, describedBy) +
      '</div>' +
    '</article>';
  }

  function showMessage(title, message, retry) {
    statusEl.hidden = false;
    statusEl.className = 'catalogue-status is-message';
    statusEl.innerHTML = '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p>' +
      (retry ? '<button type="button" id="retry-catalogue">Try again</button>' : '<a href="/learner/book.html">Browse Pay As You Go Lessons</a>');
    if (retry) document.getElementById('retry-catalogue').addEventListener('click', loadCatalogue);
  }

  function showPurchaseStatus(title, message, tone, focus) {
    purchaseStatusEl.hidden = false;
    purchaseStatusEl.className = 'purchase-status ' + (tone || 'is-pending');
    purchaseStatusEl.innerHTML = '<p class="section-kicker">Test payment status</p><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p>';
    if (focus) purchaseStatusEl.focus();
  }

  function renderAttempt(attempt, focus, fulfilmentCreated) {
    var status = attempt && attempt.status;
    if (status === 'paid') {
      showPurchaseStatus(
        fulfilmentCreated ? 'Full Curriculum created' : 'Test payment confirmed',
        fulfilmentCreated
          ? 'Stripe confirmed the test payment and the webhook created one school-scoped programme enrolment. Matching is now pending.'
          : 'Stripe has confirmed the payment. Fulfilment is still being checked; this browser page cannot create it.',
        'is-paid', focus
      );
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'failed') {
      showPurchaseStatus('Test payment failed', attempt.message || 'No package was activated. You can start a new test attempt.', 'is-failed', focus);
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'expired') {
      showPurchaseStatus('Test checkout expired', attempt.message || 'No package was activated. You can start a new test attempt.', 'is-failed', focus);
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'review_required') {
      showPurchaseStatus('Payment review required', 'The result is ambiguous or has remained unresolved. Do not pay again; support must reconcile the exact test Checkout identity.', 'is-review', focus);
      clearPolling();
    } else {
      showPurchaseStatus('Confirming your bank payment', 'Stripe has not yet proved payment success. This page is only checking the durable attempt; it cannot activate anything.', 'is-pending', focus);
    }
  }

  function renderCatalogue(data) {
    var products = Array.isArray(data.products) ? data.products : [];
    var flexible = products.filter(function (product) { return product.product_type === 'flexible_hours'; });
    var curriculum = products.filter(function (product) { return product.product_type === 'full_curriculum'; });
    var manoeuvres = products.filter(function (product) { return product.product_type === 'manoeuvres'; });
    if (!flexible.length || !curriculum.length || !manoeuvres.length) {
      showMessage('Catalogue not ready', 'This school catalogue is incomplete. No package can be purchased; please use Pay As You Go Lessons for now.', false);
      return;
    }

    document.getElementById('flexible-products').innerHTML = flexible.map(function (product) {
      return renderProduct(product, { label: 'School-wide flexible hours' });
    }).join('');
    document.getElementById('full-curriculum-product').innerHTML = curriculum.map(function (product) {
      return renderProduct(product, { label: 'Whole-path option' });
    }).join('');
    document.getElementById('manoeuvres-products').innerHTML = manoeuvres.map(function (product) {
      var variant = product.content && product.content.variant === 'challenge' ? 'Optional Challenge' : 'No promotional tasks';
      return renderProduct(product, { label: variant });
    }).join('');
    statusEl.hidden = true;
    contentEl.hidden = false;
    if (data.viewer && data.viewer.signed_in_as_learner) {
      testBookingPanelEl.hidden = false;
      var evidence = data.full_curriculum_eligibility && data.full_curriculum_eligibility.test_booking;
      if (evidence) {
        testBookingResultEl.textContent = evidence.verification_status === 'verified'
          ? 'Your future test details are verified.'
          : evidence.verification_status === 'pending'
            ? 'Your details are waiting for manual admin verification.'
            : 'The latest details were not verified. Submit current future test details for review.';
      }
    }
  }

  function requestStorageKey(productId) { return 'cc_package_test_request_' + String(productId); }
  function requestIdentity(productId) {
    var key = requestStorageKey(productId);
    var value = sessionStorage.getItem(key);
    if (!value) {
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
        throw new Error('This browser cannot create a secure checkout identity. Please update it and try again.');
      }
      value = window.crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  }
  function clearAttemptRequest(productId) {
    if (productId) sessionStorage.removeItem(requestStorageKey(productId));
  }

  async function startCheckout(button) {
    var productId = Number(button.getAttribute('data-package-checkout'));
    if (!productId) return;
    var original = button.textContent;
    var consumerCheckout = button.closest('[data-consumer-checkout]');
    var termsAccepted = Boolean(consumerCheckout && consumerCheckout.querySelector('[name="consumer_terms_accepted"]:checked'));
    var adultAgeConfirmed = Boolean(consumerCheckout && consumerCheckout.querySelector('[name="adult_age_confirmed"]:checked'));
    var startChoice = consumerCheckout && consumerCheckout.querySelector('input[type="radio"]:checked');
    if (!termsAccepted || !adultAgeConfirmed || !startChoice) {
      showPurchaseStatus('Confirm your choices', 'Confirm you are 18 or over, read the cancellation and withdrawal terms, then choose when matching may begin.', 'is-failed', true);
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Starting secure test checkout…';
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(apiUrl('create-checkout'), {
        method: 'POST',
        body: JSON.stringify({
          product_id: productId,
          client_request_id: requestIdentity(productId),
          consumer_terms_accepted: true,
          adult_age_confirmed: true,
          early_start_requested: startChoice.value === 'now',
          disclosure_version: button.getAttribute('data-disclosure-version')
        }),
        credentials: 'include'
      });
      var data = await response.json();
      if (response.status === 401) {
        if (window.ccAuth) window.ccAuth.requireAuth();
        return;
      }
      if (data.attempt) renderAttempt(data.attempt, true, data.fulfilment_created === true);
      if (response.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      if (!response.ok) throw new Error(data.message || 'Test checkout could not be started.');
      if (data.attempt && data.attempt.status === 'pending') startPolling(data.attempt.id);
    } catch (error) {
      showPurchaseStatus('Checkout not started', error.message || 'Please try again.', 'is-failed', true);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
    }
  }

  async function pollAttempt(attemptId, focus) {
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(apiUrl('attempt-status', { attempt_id: attemptId }), { credentials: 'include' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Payment status is unavailable.');
      renderAttempt(data.attempt, focus, data.fulfilment_created === true);
      if (data.fulfilment_created) loadProgrammeStatus();
      return data.attempt;
    } catch (error) {
      showPurchaseStatus('Status check unavailable', 'We could not confirm the result. Do not start another payment; try this status check again.', 'is-review', focus);
      clearPolling();
      return null;
    }
  }

  function clearPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPolling(attemptId) {
    clearPolling();
    pollStartedAt = Date.now();
    pollTimer = window.setInterval(function () {
      if (Date.now() - pollStartedAt > 10 * 60 * 1000) {
        clearPolling();
        showPurchaseStatus('Still confirming', 'This is taking longer than expected. Do not pay again; reopen this return link to check the same attempt.', 'is-review', false);
        return;
      }
      pollAttempt(attemptId, false);
    }, 3000);
  }

  function handleReturnState() {
    var params = new URLSearchParams(window.location.search);
    var attemptId = params.get('attempt_id');
    if (!attemptId) return;
    showPurchaseStatus(
      params.get('package_cancelled') === '1' ? 'Checking the closed checkout' : 'Confirming your bank payment',
      'This return page cannot activate a package. It is checking the durable server-side attempt.',
      'is-pending',
      true
    );
    pollAttempt(attemptId, false).then(function (attempt) {
      if (attempt && attempt.status === 'pending') startPolling(attemptId);
    });
  }

  async function loadCatalogue() {
    statusEl.hidden = false;
    statusEl.className = 'catalogue-status';
    statusEl.innerHTML = '<div class="skeleton-line skeleton-line-wide"></div><div class="skeleton-line"></div>';
    contentEl.hidden = true;
    try {
      var response = await fetch(apiUrl('catalogue'), { credentials: 'include' });
      var data = await response.json();
      if (!response.ok) {
        if (data.code === 'LEARNER_PACKAGES_DISABLED') {
          showMessage('Packages are not available here yet', 'This school has not enabled the learner Packages catalogue. Pay As You Go Lessons and existing Lesson Credit remain unchanged.', false);
          return;
        }
        throw new Error(data.message || 'The catalogue could not be loaded.');
      }
      renderCatalogue(data);
    } catch (error) {
      showMessage('We could not load Packages', error.message || 'Please try again.', true);
    }
  }

  function formatDate(value) {
    if (!value) return 'Not yet set';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderProgramme(programme) {
    if (!programme) { programmeStatusEl.hidden = true; return; }
    var retake = programme.retake;
    var matching = programme.matching || {};
    var weekdayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var availability = matching.availability;
    var availabilitySummary = !availability
      ? 'Not yet agreed'
      : (availability.windows || []).length
        ? (availability.windows || []).map(function (window) { return weekdayNames[window.weekday] + ' ' + window.local_start_time + '–' + window.local_end_time; }).join(', ') + ' (' + availability.timezone + ')'
        : 'No recurring weekly window was recorded (' + availability.timezone + ')';
    var hasStarted = Boolean(programme.programme_start_at);
    var latestRefund = programme.refund_cases && programme.refund_cases[0];
    var contract = programme.consumer_contract || {};
    var programmeWindow = hasStarted
      ? escapeHtml(formatDate(programme.programme_start_at)) + ' to ' + escapeHtml(formatDate(programme.approved_entitlement_end_at))
      : 'Awaiting the programme start agreed by your instructor or admin';
    programmeStatusContentEl.innerHTML =
      '<dl class="programme-facts">' +
        '<div><dt>Payment</dt><dd>Confirmed in Stripe test mode</dd></div>' +
        '<div><dt>Cooling-off</dt><dd>' + escapeHtml(programme.status === 'cooling_off_hold' ? 'Matching begins after ' + formatDate(programme.service_may_start_at) : (contract.early_start_requested === true ? 'Early start requested and recorded' : 'Cooling-off hold released')) + '</dd></div>' +
        '<div><dt>Matching</dt><dd>' + escapeHtml(programme.status) + ' · deadline ' + escapeHtml(formatDate(programme.matching_deadline)) + '</dd></div>' +
        '<div><dt>Matching status</dt><dd>' + escapeHtml(matching.status || 'pending') + '</dd></div>' +
        '<div><dt>Matched instructor</dt><dd>' + escapeHtml(matching.instructor_name || 'Not yet assigned') + '</dd></div>' +
        '<div><dt>Agreed availability</dt><dd>' + escapeHtml(availabilitySummary) + '</dd></div>' +
        '<div><dt>Programme start</dt><dd>' + escapeHtml(hasStarted ? formatDate(programme.programme_start_at) : 'Pending agreement') + '</dd></div>' +
        '<div><dt>Internal progress</dt><dd>Phase ' + escapeHtml(programme.current_phase) + ' of 3</dd></div>' +
        '<div><dt>Base programme</dt><dd>' + programmeWindow + '</dd></div>' +
        '<div><dt>Weekly opportunities</dt><dd>' + escapeHtml((programme.weeks || []).length) + ' records · one 90-minute opportunity per programme week</dd></div>' +
        '<div><dt>Retake</dt><dd>' + (retake ? escapeHtml(retake.consumed_minutes) + ' of 600 minutes used; expires ' + escapeHtml(formatDate(retake.expires_at)) : 'Not activated') + '</dd></div>' +
      '</dl>' +
      (latestRefund
        ? '<section class="termination-panel"><h3>Cancellation and refund review</h3><p>Your request was received ' + escapeHtml(formatDate(latestRefund.received_at)) + '. The calculated refund is <strong>' + escapeHtml(formatPrice(latestRefund.refund_due_pence, programme.currency)) + '</strong>. Status: ' + escapeHtml(latestRefund.status) + '. No browser action issues a Stripe refund.</p></section>'
        : programme.status === 'completed' || programme.status === 'withdrawn'
          ? ''
          : '<form class="termination-panel" id="programme-termination-form"><h3>Cancel or withdraw</h3><p>You can send a clear cancellation request here. We record the time immediately, stop further programme activity and prepare an itemised manual refund review.</p><label>Reason (optional)<textarea name="reason" maxlength="1000"></textarea></label><button type="submit">Record my cancellation request</button></form>');
    programmeStatusEl.hidden = false;
  }

  function terminationRequestKey(enrolmentId) { return 'cc_programme_termination_' + String(enrolmentId); }
  function terminationRequestIdentity(enrolmentId) {
    var key = terminationRequestKey(enrolmentId);
    var value = sessionStorage.getItem(key);
    if (!value) {
      value = window.crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  }

  programmeStatusContentEl.addEventListener('submit', async function (event) {
    if (event.target.id !== 'programme-termination-form') return;
    event.preventDefault();
    var form = event.target;
    var button = form.querySelector('button[type="submit"]');
    var programmeResponse;
    try {
      button.disabled = true;
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var statusResponse = await fetcher(apiUrl('programme-status'), { credentials: 'include' });
      programmeResponse = await statusResponse.json();
      if (!statusResponse.ok || !programmeResponse.programme) throw new Error('Programme status is unavailable.');
      var programme = programmeResponse.programme;
      var response = await fetcher(apiUrl('request-programme-termination'), {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({
          enrolment_id: Number(programme.id),
          request_id: terminationRequestIdentity(programme.id),
          reason: form.elements.reason.value
        })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.message || 'The request could not be recorded.');
      showPurchaseStatus('Cancellation recorded', data.message, 'is-review', true);
      await loadProgrammeStatus();
    } catch (error) {
      showPurchaseStatus('Cancellation not recorded', error.message || 'Please contact support by email.', 'is-failed', true);
    } finally { button.disabled = false; }
  });

  async function loadProgrammeStatus() {
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(apiUrl('programme-status'), { credentials: 'include' });
      if (!response.ok) return;
      var data = await response.json();
      renderProgramme(data.programme);
    } catch (error) {}
  }

  testBookingFormEl.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = testBookingFormEl.querySelector('button[type="submit"]');
    var form = new FormData(testBookingFormEl);
    button.disabled = true;
    testBookingResultEl.textContent = 'Saving details…';
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(apiUrl('submit-test-booking'), {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({ test_date: form.get('test_date'), test_time: form.get('test_time'), test_centre: form.get('test_centre'), attempt_number: 1 })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Details could not be saved.');
      testBookingResultEl.textContent = 'Saved. An admin must manually verify the details before checkout becomes available.';
      await loadCatalogue();
    } catch (error) {
      testBookingResultEl.textContent = error.message || 'Details could not be saved.';
    } finally { button.disabled = false; }
  });

  contentEl.addEventListener('click', function (event) {
    var checkout = event.target.closest('[data-package-checkout]');
    if (checkout) { startCheckout(checkout); return; }
    if (event.target.closest('[data-package-sign-in]') && window.ccAuth) window.ccAuth.requireAuth();
  });

  handleReturnState();
  loadCatalogue();
  loadProgrammeStatus();
})();
