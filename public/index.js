(function () {
  'use strict';

  // Auto-redirect logged-in users to their portal.
  try {
    var l = JSON.parse(localStorage.getItem('cc_learner') || 'null');
    if (l && l.token) { window.location.replace('/learner/'); return; }
    var i = JSON.parse(localStorage.getItem('cc_instructor') || 'null');
    if (i && i.token) { window.location.replace('/instructor/'); return; }
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
