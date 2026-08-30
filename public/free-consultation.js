(function () {
  'use strict';

  var EXPERIMENT_KEY = 'free-consultation-v1';
  var form = document.getElementById('consultationForm');
  var submit = document.getElementById('consultSubmit');
  var message = document.getElementById('formMessage');
  var mobileCta = document.querySelector('.mobile-cta');
  var postcodeInput = document.getElementById('consultPostcode');
  var cookieSettingsLink = document.getElementById('cookie-settings-link');
  var query = new URLSearchParams(window.location.search);
  var assignment = window.ccExperiment || {
    key: EXPERIMENT_KEY,
    variant: 'A',
    status: 'fallback',
    eligible: false,
    source: 'fallback'
  };
  var exposed = false;
  var formStarted = false;

  var attribution = {
    utm_source: query.get('utm_source') || 'direct',
    utm_medium: query.get('utm_medium') || '',
    utm_campaign: query.get('utm_campaign') || '',
    utm_content: query.get('utm_content') || ''
  };

  function analyticsAllowed() {
    return !!(
      window.ccCookieConsent
      && typeof window.ccCookieConsent.analyticsAllowed === 'function'
      && window.ccCookieConsent.analyticsAllowed()
    );
  }

  function experimentProperties() {
    var properties = {
      experiment_key: assignment.key || EXPERIMENT_KEY,
      experiment_variant: assignment.variant || 'A',
      experiment_status: assignment.status || 'fallback',
      experiment_eligible: assignment.eligible === true,
      experiment_assignment_source: assignment.source || 'fallback',
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content
    };
    properties['$feature/' + EXPERIMENT_KEY] = assignment.variant === 'B' ? 'B' : 'control';
    return properties;
  }

  function capture(eventName, properties) {
    if (!analyticsAllowed()) return false;
    if (!window.posthog || typeof window.posthog.capture !== 'function') return false;
    window.posthog.capture(eventName, Object.assign(experimentProperties(), properties || {}));
    return true;
  }

  function captureExposure() {
    if (exposed) return;
    exposed = capture('free_consultation_page_viewed');
  }

  function captureFormStarted() {
    if (formStarted) return;
    formStarted = true;
    capture('free_consultation_form_started');
  }

  function consultationPostcode() {
    return String(postcodeInput.value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  captureExposure();

  document.addEventListener('cookie-consent-updated', function (event) {
    if (event.detail && event.detail.analytics) captureExposure();
  });

  if (cookieSettingsLink) {
    cookieSettingsLink.addEventListener('click', function () {
      if (window.ccCookieConsent && typeof window.ccCookieConsent.show === 'function') {
        window.ccCookieConsent.show();
      }
    });
  }

  document.querySelectorAll('a[href="#claim"]').forEach(function (link) {
    link.addEventListener('click', function () {
      capture('free_consultation_cta_clicked', {
        label: link.innerText.trim(),
        location: link.closest('.hero') ? 'hero' : link.closest('.closing') ? 'closing' : link.closest('.mobile-cta') ? 'mobile_sticky' : 'body'
      });
    });
  });

  if (mobileCta && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      mobileCta.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, { threshold: 0.05 }).observe(document.getElementById('claim'));
  }

  postcodeInput.addEventListener('input', function () {
    postcodeInput.value = postcodeInput.value.toUpperCase();
    postcodeInput.setCustomValidity('');
  });

  form.addEventListener('focusin', function (event) {
    if (event.target && event.target.name !== 'website') captureFormStarted();
  }, { once: true });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    message.className = 'form-message';
    message.textContent = '';

    var postcode = consultationPostcode();
    postcodeInput.value = postcode;
    postcodeInput.setCustomValidity(postcode ? '' : 'Enter your pickup postcode.');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    captureFormStarted();

    var data = new FormData(form);
    var name = String(data.get('name') || '').trim();
    var phone = String(data.get('phone') || '').trim();
    var email = String(data.get('email') || '').trim();
    var experience = String(data.get('experience') || '').trim();
    var stuck = String(data.get('stuck') || '').trim();
    var originalHtml = submit.innerHTML;

    submit.disabled = true;
    submit.textContent = 'Sending your request…';

    try {
      var response = await fetch('/api/enquiries?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          phone: phone,
          email: email,
          enquiryType: 'free-consultation',
          message: 'Driving experience: ' + experience
            + '\nPreferred pickup postcode: ' + postcode
            + (stuck ? '\nCurrently stuck on: ' + stuck : ''),
          marketing: false,
          submittedAt: new Date().toISOString(),
          website: String(data.get('website') || ''),
          experiment_key: assignment.key || EXPERIMENT_KEY,
          experiment_variant: assignment.variant || 'A',
          utm_source: attribution.utm_source,
          utm_medium: attribution.utm_medium,
          utm_campaign: attribution.utm_campaign,
          utm_content: attribution.utm_content
        })
      });

      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var requestError = new Error(body.error || 'We could not send your request.');
        requestError.category = 'http_error';
        requestError.httpStatus = response.status;
        throw requestError;
      }
      if (body.dbSaved !== true) {
        var saveError = new Error('We could not confirm your request was saved. Please try again.');
        saveError.category = 'save_unconfirmed';
        throw saveError;
      }

      capture('free_consultation_requested');
      form.innerHTML = '<div class="success-box" role="status"><strong>Your request is in.</strong><p>We’ll get in touch to arrange your free 45-minute consultation. There is nothing to pay and no obligation to continue with CoachCarter.</p></div>';
    } catch (error) {
      capture('free_consultation_submission_error', {
        error_category: error.category || 'network_error',
        http_status: error.httpStatus || 0
      });
      message.textContent = error.message || 'Something went wrong. Please try again.';
      message.className = 'form-message is-error';
      submit.disabled = false;
      submit.innerHTML = originalHtml;
      message.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();
