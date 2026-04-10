(function () {
  'use strict';

  // Redirect if already logged in. The session JWT lives in the httpOnly
  // cc_admin cookie — we just hit /verify with credentials included to
  // check validity. localStorage is only used as a quick hint to skip
  // the verify round-trip if there's no display blob at all.
  const existing = JSON.parse(localStorage.getItem('cc_admin') || 'null');
  if (existing) {
    fetch('/api/admin?action=verify', { credentials: 'include' }).then(r => {
      if (r.ok) window.location.href = '/admin/portal.html';
      else localStorage.removeItem('cc_admin');
    }).catch(() => {});
  }

  function showError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg; el.classList.add('show');
  }
  function clearError() {
    document.getElementById('login-error').classList.remove('show');
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearError();
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/admin?action=login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value
        })
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Login failed'); return; }
      localStorage.setItem('cc_admin', JSON.stringify(data));
      window.location.href = '/admin/portal.html';
    } catch {
      showError('Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

(function wire() {
  var form = document.getElementById('admin-login-form');
  if (form) form.addEventListener('submit', handleLogin);
})();
})();
