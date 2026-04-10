(function () {
  'use strict';

  // Auto-redirect logged-in users to their portal.
  try {
    if (JSON.parse(localStorage.getItem('cc_learner') || 'null')) {
      window.location.replace('/learner/'); return;
    }
    if (JSON.parse(localStorage.getItem('cc_instructor') || 'null')) {
      window.location.replace('/instructor/'); return;
    }
  } catch (e) { /* ignore */ }

  // Cookie Settings link
  document.addEventListener('DOMContentLoaded', function () {
    var link = document.getElementById('cookie-settings-link');
    if (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.ccCookieConsent) window.ccCookieConsent.show();
      });
    }
  });
})();
