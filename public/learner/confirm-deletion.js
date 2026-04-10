(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');
  var msgEl = document.getElementById('msg');
  var statusEl = document.getElementById('status');
  var homeLink = document.getElementById('home-link');

  if (!token) {
    msgEl.textContent = 'No deletion token found.';
    statusEl.textContent = 'Invalid link';
    statusEl.className = 'status status-error';
    homeLink.style.display = 'inline-block';
    return;
  }

  fetch('/api/learner?action=confirm-deletion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token })
  })
    .then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    })
    .then(function (result) {
      if (result.ok && result.data.ok) {
        msgEl.textContent = 'Your account and all personal data have been permanently deleted.';
        statusEl.textContent = 'Account deleted successfully';
        statusEl.className = 'status status-success';
        // Clear auth tokens
        try {
          localStorage.removeItem('cc_learner');
          localStorage.removeItem('cc_cookie_consent');
          localStorage.removeItem('cc_consent_visitor');
        } catch (e) { /* ignore */ }
      } else {
        msgEl.textContent = result.data.error || 'Something went wrong.';
        statusEl.textContent = 'Deletion failed';
        statusEl.className = 'status status-error';
      }
      homeLink.style.display = 'inline-block';
    })
    .catch(function () {
      msgEl.textContent = 'Network error. Please try again.';
      statusEl.textContent = 'Connection failed';
      statusEl.className = 'status status-error';
      homeLink.style.display = 'inline-block';
    });
})();
