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
  var catalogueViewer = null;
  var cataloguePricing = {};

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

  function formatHours(minutes) {
    return (Number(minutes || 0) / 60).toFixed(1).replace(/\.0$/, '');
  }

  function customerProductCopy(product) {
    var content = product.content || {};
    var entitlement = content.entitlement || {};
    var hours = Number(entitlement.hours || 0);

    if (product.product_type === 'flexible_hours' && hours > 0) {
      var hourlyPence = Math.round(Number(product.price_pence || 0) / hours);
      return {
        name: hours + ' Flexible Hours',
        summary: hours === 10
          ? 'For learners who prefer one payment over 10 separate payments when booking.'
          : hours === 15
            ? 'A smaller block for learners who want to build confidence without committing to 30 hours.'
            : 'A larger block for learners planning regular lessons and looking for the lowest hourly price.',
        highlights: [
          hours + ' lesson hours',
          formatPrice(hourlyPence, product.currency) + ' per hour',
          'Use with any available CoachCarter instructor',
          'No expiry'
        ]
      };
    }

    if (product.product_type === 'full_curriculum') {
      return {
        name: 'Full Curriculum',
        summary: 'For learners with a verified practical test booking who want a structured weekly route to their test.',
        highlights: [
          'One 90-minute lesson in each programme week',
          'Runs until your first test or for up to 24 weeks',
          'Progress checks with a different instructor',
          'Up to 10 extra lesson hours for one eligible retake',
          'DVSA test fees and use of an instructor car are not included'
        ]
      };
    }

    if (product.slug === 'manoeuvres-challenge') {
      return {
        name: 'Manoeuvres Challenge',
        summary: 'The same three specialist sessions, with optional promotional tasks and a possible reward if you meet the published criteria.',
        highlights: [
          'Three one-hour specialist sessions',
          'Promotional tasks are optional',
          'Choose a refund or Full Curriculum credit if you qualify'
        ]
      };
    }

    if (product.product_type === 'manoeuvres') {
      return {
        name: 'Manoeuvres',
        summary: 'Three focused sessions for practising the manoeuvres you want more help with.',
        highlights: [
          'Three one-hour specialist sessions',
          'No promotional tasks',
          'Book each session directly when the package opens'
        ]
      };
    }

    return {
      name: content.name || product.slug,
      summary: content.short_description || '',
      highlights: content.highlights || []
    };
  }

  function customerAvailability(product) {
    var eligibility = product.eligibility || {};
    if (eligibility.checkout_available) {
      return {
        label: 'Available now', tone: 'is-available',
        note: product.product_type === 'flexible_hours'
          ? ''
          : 'Available to eligible learners after the checks shown below.'
      };
    }
    if (eligibility.state === 'authentication_required' && product.product_type === 'flexible_hours') {
      return {
        label: 'Available now', tone: 'is-available',
        note: ''
      };
    }
    if (eligibility.state === 'existing_flexible_balance') {
      return {
        label: 'Hours ready to use', tone: 'is-available',
        note: 'Use your current Flexible Hours before buying another package. This keeps each package price and refund value clear.'
      };
    }
    if (eligibility.state === 'email_verification_required') {
      return {
        label: 'Email verification needed', tone: 'is-unavailable',
        note: eligibility.reason || 'Verify your account email before starting checkout.'
      };
    }
    if (eligibility.state === 'already_enrolled') {
      return {
        label: 'You are enrolled', tone: 'is-enrolled',
        note: 'You already have an active Full Curriculum programme. Your current details are shown above.'
      };
    }
    return {
      label: 'Not currently available', tone: 'is-unavailable',
      note: product.product_type === 'full_curriculum'
        ? 'Full Curriculum is not currently open to new learners.'
        : product.product_type === 'manoeuvres'
          ? 'This package is shown for comparison but cannot be booked yet.'
          : 'This package is not currently available to buy.'
    };
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

  function flexibleApiUrl(action, extra) {
    var query = new URLSearchParams(extra || {});
    query.set('action', action);
    return '/api/flexible-packages?' + query.toString();
  }

  function renderList(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<ul class="product-details">' + items.map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join('') + '</ul>';
  }

  function renderProductPrice(product) {
    var price = '<div class="product-price">' + escapeHtml(formatPrice(product.price_pence, product.currency)) + '</div>';
    if (product.product_type !== 'flexible_hours') return price;

    var entitlement = product.content && product.content.entitlement || {};
    var hours = Number(entitlement.hours || 0);
    var payAsYouGoHourlyPence = Number(cataloguePricing.pay_as_you_go_hourly_pence || 0);
    var payAsYouGoTotalPence = Math.round(hours * payAsYouGoHourlyPence);
    var savingPence = payAsYouGoTotalPence - Number(product.price_pence || 0);
    if (!(hours > 0 && payAsYouGoHourlyPence > 0 && savingPence > 0)) return price;

    return price + '<div class="product-price-comparison">' +
      '<span class="price-was">Pay As You Go <s>' + escapeHtml(formatPrice(payAsYouGoTotalPence, product.currency)) + '</s></span>' +
      '<strong class="price-saving">Save ' + escapeHtml(formatPrice(savingPence, product.currency)) + '</strong>' +
    '</div>';
  }

  function flexibleBookLabel(product) {
    var entitlement = product.content && product.content.entitlement || {};
    var hours = Number(entitlement.hours || 0);
    return hours > 0 ? 'Book ' + formatHours(hours * 60) + 'hrs' : 'Book Flexible Hours';
  }

  function canStartFlexiblePurchase(product) {
    var eligibility = product.eligibility || {};
    return eligibility.checkout_available === true || eligibility.state === 'authentication_required';
  }

  function renderFlexiblePurchaseShortcuts(products) {
    return products.filter(canStartFlexiblePurchase).map(function (product) {
      var label = flexibleBookLabel(product);
      return '<a href="#product-card-' + escapeHtml(product.id) + '" data-flexible-shortcut="' + escapeHtml(product.id) + '" aria-label="' + escapeHtml(label + ' Flexible Hours package') + '">' + escapeHtml(label) + '</a>';
    }).join('');
  }

  function actionButton(product, locked, describedBy) {
    var eligibility = product.eligibility || {};
    if (eligibility.checkout_available) {
      var rights = product.consumer_rights || {};
      if (product.product_type === 'flexible_hours') {
        var entitlement = product.content && product.content.entitlement || {};
        return '<details class="purchase-review" id="flexible-purchase-' + escapeHtml(product.id) + '" data-flexible-purchase-panel="' + escapeHtml(product.id) + '"><summary>' + escapeHtml(flexibleBookLabel(product)) + '</summary>' +
          '<div class="consumer-checkout flexible-checkout" data-flexible-checkout-panel="' + escapeHtml(product.id) + '">' +
            '<p class="checkout-owner"><strong>Buying for:</strong> ' + escapeHtml(catalogueViewer && catalogueViewer.learner_name || 'your signed-in learner account') + '</p>' +
            '<p><strong>' + escapeHtml(entitlement.hours || '') + ' hours for ' + escapeHtml(formatPrice(product.price_pence, product.currency)) + '.</strong> Pay by Bank only. The hours do not expire and cannot be transferred.</p>' +
            '<p>You have 14 days to cancel. Your hours become available as soon as payment is confirmed. We may deduct hours you use or lose through a cancellation with less than 48 hours\' notice. Any unused hours are refunded at the rate paid, and CoachCarter absorbs the original payment fee.</p>' +
            '<p class="checkout-prompt"><strong>Please confirm before paying:</strong></p>' +
            '<label class="consumer-choice consumer-age"><input type="checkbox" name="adult_age_confirmed"> I confirm that I am 18 or over.</label>' +
            '<label class="consumer-choice consumer-terms"><input type="checkbox" name="consumer_terms_accepted"> ' + escapeHtml((rights.checkout_acknowledgement || '') + ' ' + (rights.immediate_access_request || '')) + '</label>' +
            '<button type="button" class="product-action is-purchasable" data-flexible-checkout="' + escapeHtml(product.id) + '" data-disclosure-version="' + escapeHtml(rights.disclosure_version || '') + '" aria-describedby="' + describedBy + '">Pay ' + escapeHtml(formatPrice(product.price_pence, product.currency)) + ' by bank</button>' +
          '</div>' +
        '</details>';
      }
      return '<details class="purchase-review"><summary>Review and enrol</summary>' +
        '<div class="consumer-checkout" data-consumer-checkout="' + escapeHtml(product.id) + '">' +
          '<p><strong>14-day cancellation right.</strong> Choose when matching may begin. Matching and administration have no deductible value, and CoachCarter absorbs payment fees.</p>' +
          '<label class="consumer-choice"><input type="radio" name="programme_start_' + escapeHtml(product.id) + '" value="after" checked> Begin matching after my 14-day cancellation period</label>' +
          '<label class="consumer-choice"><input type="radio" name="programme_start_' + escapeHtml(product.id) + '" value="now"> Begin matching now</label>' +
          '<p class="consumer-choice-detail">' + escapeHtml(rights.early_start_request || '') + '</p>' +
          '<label class="consumer-choice consumer-age"><input type="checkbox" name="adult_age_confirmed"> I confirm that I am 18 or over.</label>' +
          '<label class="consumer-choice consumer-terms"><input type="checkbox" name="consumer_terms_accepted"> ' + escapeHtml(rights.checkout_acknowledgement || '') + '</label>' +
          '<button type="button" class="product-action is-purchasable" data-package-checkout="' + escapeHtml(product.id) + '" data-disclosure-version="' + escapeHtml(rights.disclosure_version || '') + '" aria-describedby="' + describedBy + '">Pay ' + escapeHtml(formatPrice(product.price_pence, product.currency)) + ' and enrol</button>' +
        '</div>' +
      '</details>';
    }
    if (eligibility.state === 'authentication_required') {
      return '<button type="button" class="product-action is-purchasable" data-package-sign-in="1" aria-describedby="' + describedBy + '">' + (product.product_type === 'flexible_hours' ? 'Sign in to buy' : 'Sign in to check eligibility') + '</button>';
    }
    if (eligibility.state === 'email_verification_required') {
      return '<button type="button" class="product-action is-purchasable" data-package-verify-email="1" aria-describedby="' + describedBy + '">Verify email to buy</button>';
    }
    if (eligibility.state === 'existing_flexible_balance') {
      return '<a class="product-action is-purchasable" href="/learner/book.html" aria-describedby="' + describedBy + '">Book with your Flexible Hours</a>';
    }
    if (eligibility.state === 'verification_pending') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Verification pending</button>';
    }
    if (eligibility.state === 'test_booking_required') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Verify test booking first</button>';
    }
    if (eligibility.state === 'already_enrolled') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">You are already enrolled</button>';
    }
    if (eligibility.state === 'controlled_pilot_access_required') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Not available yet</button>';
    }
    if (eligibility.state === 'consumer_terms_not_ready') {
      return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Not available yet</button>';
    }
    return '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">Not available yet</button>';
  }

  function renderProduct(product, options) {
    options = options || {};
    var content = customerProductCopy(product);
    var eligibility = product.eligibility || {};
    var availability = customerAvailability(product);
    var locked = false;
    var descriptionId = 'product-disclosure-' + escapeHtml(product.slug);
    var summaryId = 'product-summary-' + escapeHtml(product.slug);
    var lockId = 'product-lock-' + escapeHtml(product.slug);
    var label = options.label || 'Package option';
    var lockCopy = locked
      ? '<p class="lock-explanation" id="' + lockId + '"><strong>Why this is locked:</strong> ' + escapeHtml(eligibility.reason) + '</p>'
      : '';
    var disclosure = availability.note;
    var summaryCopy = options.hideSummary
      ? ''
      : '<p class="product-summary" id="' + summaryId + '">' + escapeHtml(content.summary || '') + '</p>';
    var describedBy = [options.hideSummary ? '' : summaryId, locked ? lockId : '', disclosure ? descriptionId : ''].filter(Boolean).join(' ');
    var disclosureCopy = disclosure
      ? '<p class="version-note" id="' + descriptionId + '">' + escapeHtml(disclosure) + '</p>'
      : '';

    return '<article class="product-shell' + (locked ? ' locked' : '') + '" id="product-card-' + escapeHtml(product.id) + '">' +
      '<div class="product-main">' +
        '<div class="product-topline"><div>' +
          '<p class="product-label">' + escapeHtml(label) + '</p>' +
          '<h3>' + escapeHtml(content.name || product.slug) + '</h3>' +
          summaryCopy +
        '</div><div class="product-price-group">' + renderProductPrice(product) + '<span class="availability-pill ' + escapeHtml(availability.tone) + '">' + escapeHtml(availability.label) + '</span></div></div>' +
        renderList(content.highlights) + lockCopy +
      '</div>' +
      '<div class="product-footer">' +
        disclosureCopy +
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
    purchaseStatusEl.innerHTML = '<p class="section-kicker">Payment status</p><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p>';
    if (focus) purchaseStatusEl.focus();
  }

  function renderAttempt(attempt, focus, fulfilmentCreated) {
    var status = attempt && attempt.status;
    if (status === 'paid') {
      showPurchaseStatus(
        fulfilmentCreated ? 'Your Full Curriculum is ready' : 'Payment confirmed',
        fulfilmentCreated
          ? 'Your payment is confirmed. We will now begin arranging your programme.'
          : 'Your payment is confirmed. We are finishing the final account checks now.',
        'is-paid', focus
      );
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'failed') {
      showPurchaseStatus('Payment not completed', attempt.message || 'No payment was taken. You can try again when you are ready.', 'is-failed', focus);
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'expired') {
      showPurchaseStatus('Payment window closed', attempt.message || 'No payment was taken. You can start again when you are ready.', 'is-failed', focus);
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else if (status === 'review_required') {
      showPurchaseStatus('We need to check your payment', 'Please do not pay again. Contact us and we will check the payment with your bank.', 'is-review', focus);
      clearPolling();
    } else {
      showPurchaseStatus('Confirming your bank payment', 'We are waiting for confirmation from your bank. This can take up to 24 hours, so please do not pay again.', 'is-pending', focus);
    }
  }

  function renderCatalogue(data) {
    catalogueViewer = data.viewer || null;
    cataloguePricing = data.pricing || {};
    var products = Array.isArray(data.products) ? data.products : [];
    var flexible = products.filter(function (product) { return product.product_type === 'flexible_hours'; }).sort(function (a, b) {
      var aHours = Number(a.content && a.content.entitlement && a.content.entitlement.hours || 0);
      var bHours = Number(b.content && b.content.entitlement && b.content.entitlement.hours || 0);
      return aHours - bHours;
    });
    var curriculum = products.filter(function (product) { return product.product_type === 'full_curriculum'; });
    var manoeuvres = products.filter(function (product) { return product.product_type === 'manoeuvres'; });
    if (!products.length) {
      showMessage('No packages available', 'There are no packages to show at the moment. You can still book Pay As You Go Lessons.', false);
      return;
    }

    var flexibleHours = flexible.map(function (product) {
      return Number(product.content && product.content.entitlement && product.content.entitlement.hours || 0);
    }).filter(function (hours) { return hours > 0; }).sort(function (a, b) { return a - b; });
    var flexibleChoice = flexibleHours.length > 1
      ? flexibleHours.slice(0, -1).join(', ') + ' or ' + flexibleHours[flexibleHours.length - 1]
      : String(flexibleHours[0] || 'Flexible');
    var flexibleLive = data.flexible_live_purchasing_enabled === true;
    var hasActiveCurriculum = data.full_curriculum_eligibility
      && data.full_curriculum_eligibility.has_active_enrolment === true;
    var showFlexible = flexible.length > 0 && !hasActiveCurriculum;

    document.getElementById('packages-hero-intro').textContent = hasActiveCurriculum
      ? 'Your Full Curriculum programme and its current status are shown below.'
      : showFlexible
        ? 'Buy Flexible Hours upfront and use them with any available CoachCarter instructor. You can also see any other learning packages currently in the catalogue.'
        : 'Compare the CoachCarter learning packages currently shown below.';
    document.getElementById('flexible-section-kicker').textContent = flexibleLive ? 'Available now' : 'Not currently available';
    document.getElementById('curriculum-section-kicker').textContent = hasActiveCurriculum
      ? 'Your programme'
      : 'Not currently available';
    document.getElementById('flexible-section-copy').textContent = flexible.length
      ? 'Buy ' + flexibleChoice + ' hours upfront. Use them with any available CoachCarter instructor, book in 30-minute steps and take as long as you need.'
      : '';

    document.getElementById('flexible-section').hidden = !showFlexible;
    document.getElementById('full-curriculum-section').hidden = !curriculum.length;
    document.getElementById('manoeuvres-section').hidden = !manoeuvres.length;
    document.getElementById('flexible-truth-panel').hidden = !showFlexible;
    var flexibleShortcuts = document.getElementById('flexible-purchase-shortcuts');
    flexibleShortcuts.innerHTML = showFlexible ? renderFlexiblePurchaseShortcuts(flexible) : '';
    flexibleShortcuts.hidden = !flexibleShortcuts.innerHTML;

    document.getElementById('flexible-products').innerHTML = flexible.map(function (product) {
      var hours = Number(product.content && product.content.entitlement && product.content.entitlement.hours || 0);
      return renderProduct(product, {
        label: hours === 10 ? 'Payment convenience' : hours === 15 ? 'A smaller upfront block' : 'The lowest hourly price',
        hideSummary: hours !== 10
      });
    }).join('');
    document.getElementById('full-curriculum-product').innerHTML = curriculum.map(function (product) {
      return renderProduct(product, { label: 'For learners with a booked test' });
    }).join('');
    document.getElementById('manoeuvres-products').innerHTML = manoeuvres.map(function (product) {
      var variant = product.content && product.content.variant === 'challenge' ? 'Optional Challenge' : 'No promotional tasks';
      return renderProduct(product, { label: variant });
    }).join('');
    statusEl.hidden = true;
    contentEl.hidden = false;
    var curriculumEligibility = curriculum[0] && curriculum[0].eligibility || {};
    var needsTestBooking = curriculumEligibility.state === 'test_booking_required'
      || curriculumEligibility.state === 'verification_pending';
    testBookingPanelEl.hidden = !curriculum.length
      || !(data.viewer && data.viewer.signed_in_as_learner && needsTestBooking);
    if (!testBookingPanelEl.hidden) {
      var evidence = data.full_curriculum_eligibility && data.full_curriculum_eligibility.test_booking;
      if (evidence) {
        testBookingResultEl.textContent = evidence.verification_status === 'verified'
          ? 'Your future test details are verified.'
          : evidence.verification_status === 'pending'
            ? 'We are reviewing your test details.'
            : 'We could not verify the latest details. Submit your current test information for another review.';
      }
    }
    return showFlexible;
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
      showPurchaseStatus('Please complete the checks', 'Confirm you are 18 or over, accept the cancellation and withdrawal terms, and choose when matching may begin.', 'is-failed', true);
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Opening secure payment…';
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
      if (!response.ok) throw new Error(data.message || 'We could not open the payment page.');
      if (data.attempt && data.attempt.status === 'pending') startPolling(data.attempt.id);
    } catch (error) {
      showPurchaseStatus('Checkout not started', error.message || 'Please try again.', 'is-failed', true);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
    }
  }

  async function startFlexibleCheckout(button) {
    var productId = Number(button.getAttribute('data-flexible-checkout'));
    var panel = button.closest('[data-flexible-checkout-panel]');
    var termsAccepted = Boolean(panel && panel.querySelector('[name="consumer_terms_accepted"]:checked'));
    var adultAgeConfirmed = Boolean(panel && panel.querySelector('[name="adult_age_confirmed"]:checked'));
    if (!termsAccepted || !adultAgeConfirmed) {
      showPurchaseStatus('Please complete the checks', 'Confirm you are 18 or over and accept the Flexible Hours terms before paying.', 'is-failed', true);
      return;
    }
    var original = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Opening Pay by Bank…';
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(flexibleApiUrl('create-checkout'), {
        method: 'POST', credentials: 'include',
        body: JSON.stringify({
          product_id: productId,
          client_request_id: requestIdentity(productId),
          consumer_terms_accepted: true,
          adult_age_confirmed: true,
          immediate_access_requested: true,
          disclosure_version: button.getAttribute('data-disclosure-version')
        })
      });
      var data = await response.json();
      if (response.status === 401) {
        if (window.ccAuth) window.ccAuth.requireAuth();
        return;
      }
      if (data.attempt) renderFlexibleAttempt(data.attempt, true, data.entitlement_created === true);
      if (response.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      if (!response.ok) throw new Error(data.message || 'We could not open Pay by Bank.');
      if (data.attempt && data.attempt.status === 'pending') startFlexiblePolling(data.attempt.id);
    } catch (error) {
      showPurchaseStatus('Checkout not started', error.message || 'Please try again.', 'is-failed', true);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
    }
  }

  function renderFlexibleAttempt(attempt, focus, entitlementCreated) {
    if (attempt.status === 'paid') {
      showPurchaseStatus(
        entitlementCreated ? 'Flexible Hours available' : 'Payment confirmed',
        entitlementCreated
          ? 'Your bank payment is confirmed and your Flexible Hours are ready to use.'
          : 'Your bank payment is confirmed. We are adding the hours to your account now.',
        'is-paid', focus
      );
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
      loadFlexibleBalance();
    } else if (attempt.status === 'review_required') {
      showPurchaseStatus('We need to check your payment', 'Please do not pay again. Contact us and we will check the payment with your bank.', 'is-review', focus);
      clearPolling();
    } else if (attempt.status === 'failed' || attempt.status === 'expired') {
      showPurchaseStatus('Payment not completed', attempt.message || 'No payment was taken and no hours were added.', 'is-failed', focus);
      clearPolling();
      clearAttemptRequest(attempt.product && attempt.product.id);
    } else {
      showPurchaseStatus('Confirming your bank payment', 'We are waiting for confirmation from your bank. This can take up to 24 hours, so please do not pay again.', 'is-pending', focus);
    }
  }

  async function pollFlexibleAttempt(attemptId, focus) {
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(flexibleApiUrl('attempt-status', { attempt_id: attemptId }), { credentials: 'include' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Payment status is unavailable.');
      renderFlexibleAttempt(data.attempt, focus, data.entitlement_created === true);
      return data.attempt;
    } catch (error) {
      showPurchaseStatus('We cannot check the payment yet', 'Please do not pay again. Reopen this page in a few minutes or contact us.', 'is-review', focus);
      clearPolling();
      return null;
    }
  }

  function startFlexiblePolling(attemptId) {
    clearPolling();
    pollStartedAt = Date.now();
    pollTimer = window.setInterval(function () {
      if (Date.now() - pollStartedAt > 10 * 60 * 1000) {
        clearPolling();
        showPurchaseStatus('Still waiting for confirmation', 'Please do not pay again. If 24 hours have passed, contact us and we will check the payment.', 'is-review', false);
        return;
      }
      pollFlexibleAttempt(attemptId, false);
    }, 3000);
  }

  async function loadFlexibleBalance() {
    var target = document.getElementById('flexible-balance-status');
    if (!target || !(catalogueViewer && catalogueViewer.signed_in_as_learner)) return;
    try {
      var fetcher = window.ccAuth && window.ccAuth.fetchAuthed ? window.ccAuth.fetchAuthed : fetch;
      var response = await fetcher(flexibleApiUrl('balance'), { credentials: 'include' });
      if (!response.ok) return;
      var data = await response.json();
      var hours = Number(data.remaining_minutes || 0) / 60;
      if (hours <= 0) {
        target.hidden = true;
        return;
      }
      target.hidden = false;
      target.innerHTML = '<span><strong>Your Flexible Hours:</strong> ' + escapeHtml(hours.toFixed(1).replace(/\.0$/, '')) + ' hours remaining.</span>' +
        '<a href="/learner/book.html">Book with your Flexible Hours</a>';
    } catch (_) {}
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
      showPurchaseStatus('We cannot check the payment yet', 'Please do not pay again. Reopen this page in a few minutes or contact us.', 'is-review', focus);
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
        showPurchaseStatus('Still waiting for confirmation', 'Please do not pay again. If 24 hours have passed, contact us and we will check the payment.', 'is-review', false);
        return;
      }
      pollAttempt(attemptId, false);
    }, 3000);
  }

  function handleReturnState() {
    var params = new URLSearchParams(window.location.search);
    var attemptId = params.get('attempt_id');
    if (!attemptId) return;
    if (params.get('flexible_return') === '1' || params.get('flexible_cancelled') === '1') {
      showPurchaseStatus(
        params.get('flexible_cancelled') === '1' ? 'Checking your payment' : 'Confirming your bank payment',
        'We are checking the same payment with your bank. Please do not start another payment while this check is running.',
        'is-pending', true
      );
      pollFlexibleAttempt(attemptId, false).then(function (attempt) {
        if (attempt && attempt.status === 'pending') startFlexiblePolling(attemptId);
      });
      return;
    }
    showPurchaseStatus(
      params.get('package_cancelled') === '1' ? 'Checking your payment' : 'Confirming your bank payment',
      'We are checking the same payment with your bank. Please do not start another payment while this check is running.',
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
      var showFlexible = renderCatalogue(data);
      if (showFlexible) loadFlexibleBalance();
    } catch (error) {
      showMessage('We could not load Packages', error.message || 'Please try again.', true);
    }
  }

  function formatDate(value) {
    if (!value) return 'Not yet set';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function programmeStatusLabel(status) {
    return {
      cooling_off_hold: 'Waiting for your cancellation period to end',
      paid_matching: 'We are arranging your weekly lessons',
      matching: 'We are arranging your weekly lessons',
      active: 'Your programme is under way',
      completed: 'Your programme is complete',
      withdrawn: 'Your programme has ended'
    }[status] || 'We are updating your programme';
  }

  function refundStatusLabel(status) {
    return {
      requested: 'received',
      calculated: 'being reviewed',
      reviewed: 'awaiting approval',
      approved: 'approved',
      provider_succeeded: 'refunded',
      provider_failed: 'waiting for us to contact you'
    }[status] || 'being reviewed';
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
    var cancellationPeriod = programme.status === 'cooling_off_hold'
      ? 'Ends ' + formatDate(programme.service_may_start_at)
      : contract.early_start_requested === true
        ? 'You asked us to begin early'
        : 'Ended';
    var programmeWindow = hasStarted
      ? escapeHtml(formatDate(programme.programme_start_at)) + ' to ' + escapeHtml(formatDate(programme.approved_entitlement_end_at))
      : 'We will confirm this after your weekly schedule is agreed';
    programmeStatusContentEl.innerHTML =
      '<dl class="programme-facts">' +
        '<div><dt>Payment</dt><dd>Confirmed</dd></div>' +
        '<div><dt>Programme status</dt><dd>' + escapeHtml(programmeStatusLabel(programme.status)) + '</dd></div>' +
        '<div><dt>14-day cancellation period</dt><dd>' + escapeHtml(cancellationPeriod) + '</dd></div>' +
        '<div><dt>Your instructor</dt><dd>' + escapeHtml(matching.instructor_name || 'We are finding the right instructor') + '</dd></div>' +
        '<div><dt>Your usual weekly time</dt><dd>' + escapeHtml(availabilitySummary) + '</dd></div>' +
        '<div><dt>Programme starts</dt><dd>' + escapeHtml(hasStarted ? formatDate(programme.programme_start_at) : 'To be agreed with you') + '</dd></div>' +
        '<div><dt>Programme dates</dt><dd>' + programmeWindow + '</dd></div>' +
        '<div><dt>Weekly lessons</dt><dd>' + escapeHtml((programme.weeks || []).length) + ' weeks planned, with one 90-minute lesson each week</dd></div>' +
        '<div><dt>Extra retake support</dt><dd>' + (retake ? escapeHtml(formatHours(retake.consumed_minutes)) + ' of 10 hours used; available until ' + escapeHtml(formatDate(retake.expires_at)) : 'Not needed') + '</dd></div>' +
      '</dl>' +
      (latestRefund
        ? '<section class="termination-panel"><h3>Your cancellation and refund</h3><p>We received your request on ' + escapeHtml(formatDate(latestRefund.received_at)) + '. Your calculated refund is <strong>' + escapeHtml(formatPrice(latestRefund.refund_due_pence, programme.currency)) + '</strong> and is currently ' + escapeHtml(refundStatusLabel(latestRefund.status)) + '.</p></section>'
        : programme.status === 'completed' || programme.status === 'withdrawn'
          ? ''
          : '<form class="termination-panel" id="programme-termination-form"><h3>Cancel or leave the programme</h3><p>Send your request here and we will record it straight away, stop future programme activity and contact you about any refund due.</p><label>Reason (optional)<textarea name="reason" maxlength="1000"></textarea></label><button type="submit">Send my cancellation request</button></form>');
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
      testBookingResultEl.textContent = 'Saved. We will review your test details before enrolment becomes available.';
      await loadCatalogue();
    } catch (error) {
      testBookingResultEl.textContent = error.message || 'Details could not be saved.';
    } finally { button.disabled = false; }
  });

  contentEl.addEventListener('click', function (event) {
    var flexibleShortcut = event.target.closest('[data-flexible-shortcut]');
    if (flexibleShortcut) {
      event.preventDefault();
      var productId = flexibleShortcut.getAttribute('data-flexible-shortcut');
      var productCard = document.getElementById('product-card-' + productId);
      if (!productCard) return;
      var purchasePanel = productCard.querySelector('[data-flexible-purchase-panel]');
      if (purchasePanel) purchasePanel.open = true;
      productCard.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
      var focusTarget = purchasePanel ? purchasePanel.querySelector('summary') : productCard.querySelector('button, a');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
      return;
    }
    var flexibleCheckout = event.target.closest('[data-flexible-checkout]');
    if (flexibleCheckout) { startFlexibleCheckout(flexibleCheckout); return; }
    var checkout = event.target.closest('[data-package-checkout]');
    if (checkout) { startCheckout(checkout); return; }
    if (event.target.closest('[data-package-verify-email]')) {
      localStorage.removeItem('cc_learner');
      window.location.href = '/learner/login.html?redirect=%2Flearner%2Fpackages.html';
      return;
    }
    if (event.target.closest('[data-package-sign-in]') && window.ccAuth) window.ccAuth.requireAuth();
  });

  handleReturnState();
  loadCatalogue();
  loadProgrammeStatus();
})();
