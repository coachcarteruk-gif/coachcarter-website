(function () {
  'use strict';

  var pendingResetEmail = null;

  // Redirect if already logged in. The session JWT lives in the httpOnly
  // cc_admin cookie - we just hit /verify with credentials included to
  // check validity. localStorage is only used as a quick hint to skip
  // the verify round-trip if there's no display blob at all.
  var existing = null;
  try { existing = JSON.parse(localStorage.getItem('cc_admin') || 'null'); } catch (_) {}
  if (existing) {
    fetch('/api/admin?action=verify', { credentials: 'include' }).then(function (r) {
      if (r.ok) window.location.href = '/admin/portal.html';
      else localStorage.removeItem('cc_admin');
    }).catch(function () {});
  }

  // ── Screen helpers ──────────────────────────────────────────────────────
  function showScreen(id) {
    ['login', 'forgot', 'reset'].forEach(function (s) {
      var el = document.getElementById('screen-' + s);
      if (el) el.style.display = (s === id) ? '' : 'none';
    });
  }
  function setError(elId, msg) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.classList.add('show'); else el.classList.remove('show');
  }

  // ── Sign in ─────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setError('login-error', '');
    var btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in...';

    try {
      var res = await fetch('/api/admin?action=login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value
        })
      });
      var data = await res.json();
      if (!res.ok) { setError('login-error', data.error || 'Login failed'); return; }
      localStorage.setItem('cc_admin', JSON.stringify(data));
      window.location.href = '/admin/portal.html';
    } catch (ex) {
      setError('login-error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  // ── Forgot password: send code ──────────────────────────────────────────
  async function handleForgot(e) {
    e.preventDefault();
    setError('forgot-error', '');
    var email = document.getElementById('forgot-email').value.trim();
    if (!email) { setError('forgot-error', 'Please enter your email.'); return; }

    var btn = document.getElementById('forgot-btn');
    btn.disabled = true; btn.textContent = 'Sending...';

    try {
      var res = await fetch('/api/admin?action=request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = await res.json();
      if (!res.ok) {
        setError('forgot-error', data.error || 'Could not send reset code.');
        btn.disabled = false; btn.textContent = 'Send reset code';
        return;
      }
      // Always claims success (enumeration-safe). Move to reset code entry.
      pendingResetEmail = email;
      document.getElementById('reset-email-display').textContent = email;
      showScreen('reset');
      setTimeout(function () { document.getElementById('reset-code').focus(); }, 100);
    } catch (ex) {
      setError('forgot-error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Send reset code';
    }
  }

  // ── Reset password ──────────────────────────────────────────────────────
  async function handleReset(e) {
    e.preventDefault();
    setError('reset-error', '');
    var code = document.getElementById('reset-code').value.replace(/\D/g, '');
    var pw = document.getElementById('reset-password').value;
    if (code.length !== 6) {
      setError('reset-error', 'Please enter the 6-digit code from your email.');
      return;
    }
    if (pw.length < 8) {
      setError('reset-error', 'Password must be at least 8 characters.');
      return;
    }
    if (!pendingResetEmail) {
      setError('reset-error', 'Session lost. Please start again.');
      setTimeout(function () { showScreen('forgot'); }, 1500);
      return;
    }

    var btn = document.getElementById('reset-btn');
    btn.disabled = true; btn.textContent = 'Resetting...';

    try {
      var res = await fetch('/api/admin?action=reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: pendingResetEmail,
          code: code,
          new_password: pw,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        if (data.error === 'invalid_password') {
          setError('reset-error', data.message);
        } else if (data.error === 'invalid_code') {
          setError('reset-error', data.message || 'Invalid or expired code. Please request a new one.');
        } else {
          setError('reset-error', data.error || 'Could not reset password.');
        }
        btn.disabled = false; btn.textContent = 'Reset password';
        return;
      }
      // Logged in via fresh JWT; persist display blob and redirect
      if (data.admin) {
        localStorage.setItem('cc_admin', JSON.stringify({ admin: data.admin }));
      }
      window.location.href = '/admin/portal.html';
    } catch (ex) {
      setError('reset-error', 'Network error. Please try again.');
      btn.disabled = false; btn.textContent = 'Reset password';
    }
  }

  async function handleResendReset() {
    if (!pendingResetEmail) return;
    var btn = document.getElementById('btn-resend-reset');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      await fetch('/api/admin?action=request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingResetEmail }),
      });
    } catch (_) {}
    btn.textContent = 'Sent! Check again';
    setTimeout(function () {
      btn.textContent = 'Send another code';
      btn.disabled = false;
    }, 5000);
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  var loginForm = document.getElementById('admin-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  var forgotForm = document.getElementById('admin-forgot-form');
  if (forgotForm) forgotForm.addEventListener('submit', handleForgot);

  var resetForm = document.getElementById('admin-reset-form');
  if (resetForm) resetForm.addEventListener('submit', handleReset);

  var btnForgot = document.getElementById('btn-forgot');
  if (btnForgot) btnForgot.addEventListener('click', function () {
    showScreen('forgot');
    var emailInput = document.getElementById('login-email');
    var forgotInput = document.getElementById('forgot-email');
    if (emailInput && emailInput.value && forgotInput) forgotInput.value = emailInput.value;
    setTimeout(function () { if (forgotInput) forgotInput.focus(); }, 50);
  });

  var btnBack = document.getElementById('btn-back-to-login');
  if (btnBack) btnBack.addEventListener('click', function () { showScreen('login'); });

  var btnResend = document.getElementById('btn-resend-reset');
  if (btnResend) btnResend.addEventListener('click', handleResendReset);
})();
