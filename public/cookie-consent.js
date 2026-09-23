/* ─── Cookie Consent Banner (GDPR) ────────────────────────────────────────── */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_cookie_consent';
  var CONSENT_VERSION = 2;

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

  function saveConsent(analytics, marketing) {
    var consent = {
      analytics: !!analytics,
      marketing: !!marketing,
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
      // Read learner id from the display blob mirrored in localStorage
      // at login time. (The previous version tried atob(tok.split('.')[1])
      // against the JSON blob, which silently failed - this is also a
      // drive-by fix.)
      var learnerId = null;
      try {
        var blob = JSON.parse(localStorage.getItem('cc_learner') || 'null');
        if (blob && blob.user && blob.user.id) learnerId = blob.user.id;
      } catch (e) { /* not logged in */ }

      fetch('/api/config?action=record-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId,
          analytics: consent.analytics,
          marketing: consent.marketing,
          learner_id: learnerId
        })
      }).catch(function () { /* fire and forget */ });
    } catch (e) { /* non-critical */ }
  }

  /* ── Banner HTML ── */
  function createBanner(showDetails) {
    var compact = window.location.pathname.indexOf('/learner/') === 0
      || !!document.querySelector('script[src="/learner/book.js"]');
    var previousFocus = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = 'cc-consent-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Cookie preferences');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div id="cc-consent-banner">' +
        '<div class="cc-consent-header">' +
          '<h3>Cookie Preferences</h3>' +
          '<p>' + (compact ? 'Necessary cookies keep you signed in. Optional analytics and marketing cookies help us understand visits and advertising.' : 'We use cookies to improve your experience. Select your preferences below.') + '</p>' +
        '</div>' +
        (compact ? '<button type="button" id="cc-customise" class="cc-customise" aria-controls="cc-consent-categories" aria-expanded="false">Choose preferences</button>' : '') +
        '<div class="cc-consent-categories" id="cc-consent-categories">' +
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
          '<label class="cc-consent-row">' +
            '<span class="cc-consent-info">' +
              '<strong>Marketing</strong>' +
              '<span>Measure visits and successful free-trial bookings from Meta ads.</span>' +
            '</span>' +
            '<input type="checkbox" id="cc-marketing-toggle">' +
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
      '#cc-consent-banner{max-height:calc(100dvh - 24px);overflow-y:auto}' +
      '#cc-consent-banner [hidden]{display:none!important}' +
      '.cc-customise{display:block;background:none;border:0;padding:10px 0;margin-bottom:10px;color:#262626;text-decoration:underline;font:600 14px "Lato",sans-serif;cursor:pointer;min-height:44px}' +
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
    var marketingToggle = overlay.querySelector('#cc-marketing-toggle');
    var categories = overlay.querySelector('#cc-consent-categories');
    var saveButton = overlay.querySelector('#cc-save-prefs');
    var customise = overlay.querySelector('#cc-customise');
    if (compact) {
      var expanded = showDetails === true;
      categories.hidden = !expanded;
      saveButton.hidden = !expanded;
      customise.setAttribute('aria-expanded', String(expanded));
      customise.addEventListener('click', function() {
        var open = categories.hidden;
        categories.hidden = !open;
        saveButton.hidden = !open;
        customise.setAttribute('aria-expanded', String(open));
      });
    }
    var existing = getConsent();
    if (existing) {
      analyticsToggle.checked = existing.analytics;
      marketingToggle.checked = existing.marketing;
    }

    overlay.querySelector('#cc-accept-all').addEventListener('click', function () {
      saveConsent(true, true);
      closeBanner(overlay);
    });

    overlay.querySelector('#cc-reject-all').addEventListener('click', function () {
      saveConsent(false, false);
      closeBanner(overlay);
    });

    overlay.querySelector('#cc-save-prefs').addEventListener('click', function () {
      saveConsent(analyticsToggle.checked, marketingToggle.checked);
      closeBanner(overlay);
    });

    /* Focus trap */
    function visibleControls() {
      return Array.from(overlay.querySelectorAll('button, input:not([disabled]), a')).filter(function(el) {
        return el.getClientRects().length > 0;
      });
    }
    var focusable = visibleControls();
    if (focusable.length) focusable[0].focus();
    overlay._previousFocus = previousFocus;

    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        /* Escape = reject all (must make a choice) */
        saveConsent(false, false);
        closeBanner(overlay);
        return;
      }
      if (e.key !== 'Tab') return;
      focusable = visibleControls();
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
    if (overlay && overlay._previousFocus && overlay._previousFocus.isConnected) overlay._previousFocus.focus();
  }

  /* ── Public API ── */
  window.ccCookieConsent = {
    hasConsented: function () { return getConsent() !== null; },
    analyticsAllowed: function () { var c = getConsent(); return c ? c.analytics : false; },
    marketingAllowed: function () { var c = getConsent(); return c ? c.marketing : false; },
    show: function () {
      var existing = document.getElementById('cc-consent-overlay');
      if (existing) existing.parentNode.removeChild(existing);
      createBanner(true);
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
