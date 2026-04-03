/* ─── Cookie Consent Banner (GDPR) ────────────────────────────────────────── */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_cookie_consent';
  var CONSENT_VERSION = 1;

  /* ── State ── */
  function getConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (c && c.version === CONSENT_VERSION) return c;
    } catch (e) { /* corrupt data */ }
    return null;
  }

  function saveConsent(analytics) {
    var consent = {
      analytics: !!analytics,
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    document.dispatchEvent(new CustomEvent('cookie-consent-updated', { detail: consent }));
    recordConsentToServer(consent);
    return consent;
  }

  function recordConsentToServer(consent) {
    try {
      var visitorId = localStorage.getItem('cc_consent_visitor');
      if (!visitorId) {
        visitorId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('cc_consent_visitor', visitorId);
      }
      var learnerId = null;
      try {
        var tok = localStorage.getItem('cc_learner');
        if (tok) {
          var payload = JSON.parse(atob(tok.split('.')[1]));
          learnerId = payload.id || null;
        }
      } catch (e) { /* not logged in */ }

      fetch('/api/config?action=record-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId,
          analytics: consent.analytics,
          learner_id: learnerId
        })
      }).catch(function () { /* fire and forget */ });
    } catch (e) { /* non-critical */ }
  }

  /* ── Banner HTML ── */
  function createBanner() {
    var overlay = document.createElement('div');
    overlay.id = 'cc-consent-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Cookie preferences');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div id="cc-consent-banner">' +
        '<div class="cc-consent-header">' +
          '<h3>Cookie Preferences</h3>' +
          '<p>We use cookies to improve your experience. Select your preferences below.</p>' +
        '</div>' +
        '<div class="cc-consent-categories">' +
          '<label class="cc-consent-row">' +
            '<span class="cc-consent-info">' +
              '<strong>Necessary</strong>' +
              '<span>Required for login and core features. Cannot be disabled.</span>' +
            '</span>' +
            '<input type="checkbox" checked disabled>' +
          '</label>' +
          '<label class="cc-consent-row">' +
            '<span class="cc-consent-info">' +
              '<strong>Analytics</strong>' +
              '<span>Help us understand how you use our site (PostHog, EU-hosted).</span>' +
            '</span>' +
            '<input type="checkbox" id="cc-analytics-toggle">' +
          '</label>' +
        '</div>' +
        '<div class="cc-consent-actions">' +
          '<button id="cc-reject-all" class="cc-btn cc-btn-secondary">Reject All</button>' +
          '<button id="cc-save-prefs" class="cc-btn cc-btn-secondary">Save Preferences</button>' +
          '<button id="cc-accept-all" class="cc-btn cc-btn-primary">Accept All</button>' +
        '</div>' +
        '<div class="cc-consent-links">' +
          '<a href="/privacy.html">Privacy Policy</a>' +
        '</div>' +
      '</div>';

    /* ── Inline styles ── */
    var style = document.createElement('style');
    style.textContent =
      '#cc-consent-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:0 12px 12px}' +
      '#cc-consent-banner{background:#fff;border-radius:16px;max-width:520px;width:100%;padding:24px;font-family:"Lato",sans-serif;color:#262626;box-shadow:0 8px 32px rgba(0,0,0,.18)}' +
      '.cc-consent-header h3{font-family:"Bricolage Grotesque",sans-serif;font-size:18px;margin-bottom:6px}' +
      '.cc-consent-header p{font-size:13px;color:#797879;margin-bottom:16px;line-height:1.4}' +
      '.cc-consent-categories{display:flex;flex-direction:column;gap:12px;margin-bottom:20px}' +
      '.cc-consent-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f9f9f9;border-radius:10px;cursor:pointer;gap:12px}' +
      '.cc-consent-info{display:flex;flex-direction:column;gap:2px}' +
      '.cc-consent-info strong{font-size:14px}' +
      '.cc-consent-info span{font-size:12px;color:#797879}' +
      '.cc-consent-row input[type="checkbox"]{width:20px;height:20px;accent-color:#f58321;cursor:pointer;flex-shrink:0}' +
      '.cc-consent-actions{display:flex;gap:8px;flex-wrap:wrap}' +
      '.cc-btn{flex:1;min-width:100px;padding:10px 16px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:"Lato",sans-serif;transition:opacity .15s}' +
      '.cc-btn:hover{opacity:.85}' +
      '.cc-btn-primary{background:#f58321;color:#fff}' +
      '.cc-btn-secondary{background:#f0f0f0;color:#262626}' +
      '.cc-consent-links{margin-top:12px;text-align:center}' +
      '.cc-consent-links a{font-size:12px;color:#797879;text-decoration:underline}' +
      '@media(max-width:480px){.cc-consent-actions{flex-direction:column}.cc-btn{min-width:auto}}';

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    /* ── Event handlers ── */
    var analyticsToggle = overlay.querySelector('#cc-analytics-toggle');
    var existing = getConsent();
    if (existing) analyticsToggle.checked = existing.analytics;

    overlay.querySelector('#cc-accept-all').addEventListener('click', function () {
      saveConsent(true);
      closeBanner(overlay);
    });

    overlay.querySelector('#cc-reject-all').addEventListener('click', function () {
      saveConsent(false);
      closeBanner(overlay);
    });

    overlay.querySelector('#cc-save-prefs').addEventListener('click', function () {
      saveConsent(analyticsToggle.checked);
      closeBanner(overlay);
    });

    /* Focus trap */
    var focusable = overlay.querySelectorAll('button, input:not([disabled]), a');
    if (focusable.length) focusable[0].focus();

    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        /* Escape = reject all (must make a choice) */
        saveConsent(false);
        closeBanner(overlay);
        return;
      }
      if (e.key !== 'Tab') return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  function closeBanner(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ── Public API ── */
  window.ccCookieConsent = {
    hasConsented: function () { return getConsent() !== null; },
    analyticsAllowed: function () { var c = getConsent(); return c ? c.analytics : false; },
    show: function () {
      var existing = document.getElementById('cc-consent-overlay');
      if (existing) existing.parentNode.removeChild(existing);
      createBanner();
    }
  };

  /* ── Auto-show if no consent recorded ── */
  if (!getConsent()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createBanner);
    } else {
      createBanner();
    }
  }
})();
