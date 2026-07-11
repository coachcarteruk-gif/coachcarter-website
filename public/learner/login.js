/* CoachCarter learner login (May 2026 - password auth)
 *
 * State machine:
 *   ┌─ screen-auth (Sign in / Sign up tabs) ─┬─ signin     ─→ screen-success / new-user / terms
 *   │                                        ├─ signup     ─→ screen-success / new-user / terms
 *   │                                        └─ migration  ─→ screen-migration-code → screen-set-password → success
 *   ├─ screen-forgot ─→ screen-reset → screen-set-password → success
 *   ├─ screen-sms-phone ─→ screen-code → success
 *   └─ screen-add-email ─→ screen-migration-code → screen-set-password → success
 *
 * The httpOnly session cookie + cc_csrf cookie are set by the server. The
 * localStorage cc_learner blob is updated client-side with display info.
 */
(function () {
  'use strict';

  // ── URL params ───────────────────────────────────────────────────────────
  var urlParams    = new URLSearchParams(window.location.search);
  var redirectTo   = urlParams.get('redirect') || '/learner/';
  var referralCode = urlParams.get('ref') || '';
  var expired      = urlParams.get('expired') === '1';
  var emailParam    = urlParams.get('email') || '';

  // ── State ────────────────────────────────────────────────────────────────
  var pendingEmail = null;          // email being verified in migration / reset
  var pendingEmailPurpose = 'login';
  var pendingTicket = null;         // ticket from verify-email-code
  var pendingResetEmail = null;     // for resend on reset screen
  var smsPhone = null;
  var skipReferral = false;

  // ── Existing session redirect ────────────────────────────────────────────
  var existing = null;
  try { existing = JSON.parse(localStorage.getItem('cc_learner') || 'null'); } catch (_) {}
  if (existing && !expired) {
    window.location.href = redirectTo;
  }
  if (expired) {
    try { localStorage.removeItem('cc_learner'); } catch (_) {}
    var banner = document.getElementById('expired-banner');
    if (banner) banner.style.display = 'block';
  }

  // ── Screen helpers ───────────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    var el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  function setError(elId, msg) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.classList.add('show'); else el.classList.remove('show');
  }

  function clearError(elId) { setError(elId, ''); }

  // ── Mode tabs (Sign in / Sign up) ────────────────────────────────────────
  function switchAuthMode(mode) {
    document.querySelectorAll('.auth-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    document.querySelectorAll('[data-mode-form]').forEach(function (f) {
      f.style.display = (f.dataset.modeForm === mode) ? '' : 'none';
    });
    clearError('error-msg');
  }

  // ── Sign in ──────────────────────────────────────────────────────────────
  function handleSignIn(e) {
    e.preventDefault();
    clearError('error-msg');
    var email = document.getElementById('signin-email').value.trim();
    if (!email) {
      setError('error-msg', 'Please enter your email address.');
      return;
    }
    var btn = document.getElementById('signin-btn');
    btn.disabled = true; btn.textContent = 'Sending code...';

    startEmailLogin(email)
      .catch(function () {
        setError('error-msg', 'Network error. Please check your connection and try again.');
      })
      .finally(function () {
        btn.disabled = false; btn.textContent = 'Send sign-in code';
      });
  }

  function handlePasswordSignIn(e) {
    e.preventDefault();
    clearError('password-error');
    var email = document.getElementById('password-email').value.trim();
    var password = document.getElementById('signin-password').value;
    if (!email || !password) {
      setError('password-error', 'Please enter your email and password.');
      return;
    }
    var btn = document.getElementById('password-btn');
    btn.disabled = true; btn.textContent = 'Signing in...';
    doLogin(email, password)
      .catch(function () {
        setError('password-error', 'Network error. Please check your connection and try again.');
      })
      .finally(function () {
        btn.disabled = false; btn.textContent = 'Sign in with password';
      });
  }

  function doLogin(email, password) {
    return fetch('/api/learner-auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    }).then(function (out) {
      if (!out.ok) {
        if (out.data && out.data.error === 'locked') {
          setError('password-error', out.data.message);
        } else {
          setError('password-error', (out.data && out.data.message) || 'Email or password is incorrect.');
        }
        return;
      }
      finishLogin(out.data);
    });
  }

  function startEmailLogin(email) {
    pendingEmail = email;
    pendingEmailPurpose = 'login';
    return fetch('/api/magic-link?action=send-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, purpose: 'login', role: 'learner' })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (out) {
      if (!out.ok) {
        setError('error-msg', (out.data && (out.data.message || out.data.error)) || 'Could not send code. Please try again.');
        return;
      }
      document.getElementById('migration-title').textContent = 'Enter your sign-in code';
      document.getElementById('migration-sub').innerHTML =
        'Enter the 6-digit code we sent to <strong id="migration-email-display"></strong>.';
      document.getElementById('migration-email-display').textContent = email;
      document.getElementById('migration-verify-btn').textContent = 'Sign in';
      showScreen('migration-code');
      focusFirstCodeInput('migration-code-inputs');
    });
  }

  function startMigration(email) {
    pendingEmail = email;
    pendingEmailPurpose = 'migration';
    return fetch('/api/magic-link?action=send-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, purpose: 'migration', role: 'learner' })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (out) {
      if (!out.ok) {
        setError('error-msg', (out.data && out.data.error) || 'Could not send code. Please try again.');
        return;
      }
      document.getElementById('migration-title').textContent = 'Set up your password';
      document.getElementById('migration-sub').innerHTML =
        "Welcome back! We sent a 6-digit code to <strong id=\"migration-email-display\"></strong> to verify it's you.";
      document.getElementById('migration-email-display').textContent = email;
      document.getElementById('migration-verify-btn').textContent = 'Continue';
      showScreen('migration-code');
      focusFirstCodeInput('migration-code-inputs');
    });
  }

  // ── Sign up ──────────────────────────────────────────────────────────────
  function handleSignUp(e) {
    e.preventDefault();
    clearError('error-msg');
    var name = document.getElementById('signup-name').value.trim();
    var email = document.getElementById('signup-email').value.trim();
    var password = document.getElementById('signup-password').value;
    var ref = document.getElementById('signup-referral')
      ? document.getElementById('signup-referral').value.trim()
      : '';
    if (!name || !email || !password) {
      setError('error-msg', 'Please fill in your name, email and password.');
      return;
    }
    if (password.length < 8) {
      setError('error-msg', 'Password must be at least 8 characters.');
      return;
    }
    var btn = document.getElementById('signup-btn');
    btn.disabled = true; btn.textContent = 'Creating account…';

    var payload = { email: email, password: password, name: name };
    if (ref || referralCode) payload.referral_code = ref || referralCode;

    fetch('/api/learner-auth?action=signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          if (out.data && out.data.error === 'instructor_account') {
            setError('error-msg', out.data.message);
            setTimeout(function () { window.location.href = out.data.redirect || '/instructor/login.html'; }, 1500);
            return;
          }
          if (out.data && out.data.error === 'account_exists') {
            setError('error-msg', out.data.message);
            switchAuthMode('signin');
            document.getElementById('signin-email').value = email;
            return;
          }
          if (out.data && out.data.error === 'invalid_password') {
            setError('error-msg', out.data.message);
            return;
          }
          setError('error-msg', (out.data && out.data.error) || 'Could not create account. Please try again.');
          return;
        }
        finishLogin(out.data);
      })
      .catch(function () {
        setError('error-msg', 'Network error. Please check your connection and try again.');
      })
      .finally(function () {
        btn.disabled = false; btn.textContent = 'Create account';
      });
  }

  // ── Migration code entry ─────────────────────────────────────────────────
  function handleMigrationVerify() {
    var code = collectCode('migration-code-inputs');
    if (code.length !== 6) return;
    var btn = document.getElementById('migration-verify-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    setError('migration-code-error', '');

    fetch('/api/magic-link?action=verify-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail, code: code, purpose: pendingEmailPurpose, role: 'learner' })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('migration-code-error', (out.data && out.data.message) || 'Invalid code. Please try again.');
          clearCodeInputs('migration-code-inputs');
          focusFirstCodeInput('migration-code-inputs');
          btn.disabled = false; btn.textContent = pendingEmailPurpose === 'login' ? 'Sign in' : 'Continue';
          return;
        }
        if (pendingEmailPurpose === 'login') {
          finishLogin(out.data);
          return;
        }
        pendingTicket = out.data.ticket;
        document.getElementById('set-password-sub').textContent =
          'Choose a password for ' + pendingEmail + '. From now on you\'ll sign in with your email and this password.';
        showScreen('set-password');
        document.getElementById('set-password-input').focus();
      })
      .catch(function () {
        setError('migration-code-error', 'Network error. Please try again.');
        btn.disabled = false; btn.textContent = pendingEmailPurpose === 'login' ? 'Sign in' : 'Continue';
      });
  }

  function handleMigrationResend() {
    if (!pendingEmail) return;
    var btn = document.getElementById('migration-resend-btn');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/magic-link?action=send-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail, purpose: pendingEmailPurpose, role: 'learner' })
    }).finally(function () {
      btn.textContent = 'Sent! Check again';
      setTimeout(function () {
        btn.textContent = "Didn't get it? Send again";
        btn.disabled = false;
      }, 5000);
    });
  }

  // ── Set password (used for migration AND reset) ──────────────────────────
  function handleSetPassword(e) {
    e.preventDefault();
    clearError('set-password-error');
    var pw = document.getElementById('set-password-input').value;
    var pw2 = document.getElementById('set-password-confirm').value;
    if (pw.length < 8) {
      setError('set-password-error', 'Password must be at least 8 characters.');
      return;
    }
    if (pw !== pw2) {
      setError('set-password-error', 'Passwords don\'t match.');
      return;
    }
    if (!pendingTicket) {
      setError('set-password-error', 'Verification expired. Please start again.');
      setTimeout(function () { showScreen('auth'); }, 1500);
      return;
    }
    var btn = document.getElementById('set-password-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    fetch('/api/learner-auth?action=set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: pendingTicket, password: pw })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          if (out.data && out.data.error === 'invalid_password') {
            setError('set-password-error', out.data.message);
          } else if (out.data && out.data.error === 'invalid_ticket') {
            setError('set-password-error', out.data.message || 'Verification expired. Please start again.');
            setTimeout(function () { showScreen('auth'); }, 2000);
          } else {
            setError('set-password-error', (out.data && out.data.error) || 'Could not save password.');
          }
          btn.disabled = false; btn.textContent = 'Save password & continue';
          return;
        }
        pendingTicket = null;
        finishLogin(out.data);
      })
      .catch(function () {
        setError('set-password-error', 'Network error. Please try again.');
        btn.disabled = false; btn.textContent = 'Save password & continue';
      });
  }

  // ── Forgot password ──────────────────────────────────────────────────────
  function handleForgot(e) {
    e.preventDefault();
    clearError('forgot-error');
    var email = document.getElementById('forgot-email').value.trim();
    if (!email) {
      setError('forgot-error', 'Please enter your email address.');
      return;
    }
    var btn = document.getElementById('forgot-btn');
    btn.disabled = true; btn.textContent = 'Sending…';

    fetch('/api/learner-auth?action=request-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('forgot-error', (out.data && out.data.error) || 'Could not send reset email.');
          btn.disabled = false; btn.textContent = 'Send reset code';
          return;
        }
        // Always claims success (enumeration-safe). Move to reset code entry.
        pendingResetEmail = email;
        document.getElementById('reset-email-display').textContent = email;
        showScreen('reset');
        focusFirstCodeInput('reset-code-inputs');
      })
      .catch(function () {
        setError('forgot-error', 'Network error. Please try again.');
        btn.disabled = false; btn.textContent = 'Send reset code';
      });
  }

  function handleResetVerify() {
    var code = collectCode('reset-code-inputs');
    if (code.length !== 6) return;
    var btn = document.getElementById('reset-verify-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    setError('reset-code-error', '');

    fetch('/api/magic-link?action=verify-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingResetEmail, code: code, purpose: 'reset', role: 'learner' })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('reset-code-error', (out.data && out.data.message) || 'Invalid code. Please try again.');
          clearCodeInputs('reset-code-inputs');
          focusFirstCodeInput('reset-code-inputs');
          btn.disabled = false; btn.textContent = 'Continue';
          return;
        }
        pendingTicket = out.data.ticket;
        pendingEmail = pendingResetEmail;
        document.getElementById('set-password-sub').textContent =
          'Choose a new password for ' + pendingEmail + '.';
        showScreen('set-password');
        document.getElementById('set-password-input').focus();
      })
      .catch(function () {
        setError('reset-code-error', 'Network error. Please try again.');
        btn.disabled = false; btn.textContent = 'Continue';
      });
  }

  function handleResetResend() {
    if (!pendingResetEmail) return;
    var btn = document.getElementById('reset-resend-btn');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/learner-auth?action=request-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingResetEmail })
    }).finally(function () {
      btn.textContent = 'Sent! Check again';
      setTimeout(function () {
        btn.textContent = "Didn't get it? Send again";
        btn.disabled = false;
      }, 5000);
    });
  }

  // ── Phone fallback (SMS code login - preserves old behaviour) ────────────
  function handleSmsPhone(e) {
    e.preventDefault();
    clearError('sms-phone-error');
    var phone = document.getElementById('sms-phone-input').value.trim();
    if (!phone) {
      setError('sms-phone-error', 'Please enter your phone number.');
      return;
    }
    var btn = document.getElementById('sms-phone-btn');
    btn.disabled = true; btn.textContent = 'Sending…';

    fetch('/api/magic-link?action=send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sms', phone: phone })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('sms-phone-error', (out.data && out.data.error) || 'Could not send code.');
          btn.disabled = false; btn.textContent = 'Send code';
          return;
        }
        smsPhone = phone;
        document.getElementById('code-destination').textContent = phone;
        showScreen('code');
        focusFirstCodeInput('code-inputs');
      })
      .catch(function () {
        setError('sms-phone-error', 'Network error.');
        btn.disabled = false; btn.textContent = 'Send code';
      });
  }

  function handleSmsCodeVerify() {
    var code = collectCode('code-inputs');
    if (code.length !== 6) return;
    var btn = document.getElementById('verify-code-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    setError('code-error', '');

    fetch('/api/magic-link?action=verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, phone: smsPhone })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('code-error', (out.data && out.data.message) || 'Invalid code.');
          clearCodeInputs('code-inputs');
          focusFirstCodeInput('code-inputs');
          btn.disabled = false; btn.textContent = 'Verify code';
          return;
        }
        // Phone-only learner with no password yet → force migration to add email
        // (out.data.user.email is null in that case).
        if (out.data.user && !out.data.user.email) {
          // Persist the SMS session for now so they can return if they bail
          localStorage.setItem('cc_learner', JSON.stringify({ user: out.data.user }));
          showScreen('add-email');
          return;
        }
        finishLogin(out.data);
      })
      .catch(function () {
        setError('code-error', 'Network error.');
        btn.disabled = false; btn.textContent = 'Verify code';
      });
  }

  function handleSmsResend() {
    if (!smsPhone) return;
    var btn = document.getElementById('code-resend-btn');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/magic-link?action=send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sms', phone: smsPhone })
    }).finally(function () {
      btn.textContent = 'Sent! Check again';
      setTimeout(function () {
        btn.textContent = "Didn't get it? Send again";
        btn.disabled = false;
      }, 5000);
    });
  }

  // ── Add email (phone-only user migrating) ────────────────────────────────
  function handleAddEmail(e) {
    e.preventDefault();
    clearError('add-email-error');
    var email = document.getElementById('add-email-input').value.trim();
    if (!email || !smsPhone) {
      setError('add-email-error', 'Please enter your email address.');
      return;
    }
    var btn = document.getElementById('add-email-btn');
    btn.disabled = true; btn.textContent = 'Sending…';

    fetch('/api/learner-auth?action=add-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: smsPhone, email: email })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (!out.ok) {
          setError('add-email-error', (out.data && out.data.message) || 'Could not send code.');
          btn.disabled = false; btn.textContent = 'Send verification code';
          return;
        }
        pendingEmail = email;
        pendingEmailPurpose = 'migration';
        document.getElementById('migration-title').textContent = 'Set up your password';
        document.getElementById('migration-sub').innerHTML =
          "Welcome back! We sent a 6-digit code to <strong id=\"migration-email-display\"></strong> to verify it's you.";
        document.getElementById('migration-email-display').textContent = email;
        document.getElementById('migration-verify-btn').textContent = 'Continue';
        showScreen('migration-code');
        focusFirstCodeInput('migration-code-inputs');
      })
      .catch(function () {
        setError('add-email-error', 'Network error.');
        btn.disabled = false; btn.textContent = 'Send verification code';
      });
  }

  // ── Final login: handle terms gate / new-user name screen / redirect ────
  function finishLogin(data) {
    localStorage.setItem('cc_learner', JSON.stringify({ user: data.user }));
    if (window.ccAuth && window.ccAuth.onLogin) {
      try { window.ccAuth.onLogin(data); } catch (_) {}
    }
    if (data.is_new_user && data.needs_name) {
      localStorage.setItem('cc_welcome', '1');
      showScreen('new-user');
      return;
    }
    if (!data.terms_accepted) {
      showScreen('terms');
      return;
    }
    showScreen('success');
    try { sessionStorage.setItem('cc_just_logged_in', '1'); } catch (_) {}
    if (data.is_new_user) {
      localStorage.setItem('cc_welcome', '1');
      setTimeout(function () { window.location.href = '/learner/book.html'; }, 800);
    } else {
      setTimeout(function () { window.location.href = redirectTo; }, 800);
    }
  }

  // ── New-user name handler (kept from old flow) ───────────────────────────
  function handleSetName() {
    var name = document.getElementById('input-name').value.trim();
    if (!name) { document.getElementById('input-name').focus(); return; }
    window.ccAuth.fetchAuthed('/api/learner?action=update-name', {
      method: 'POST',
      body: JSON.stringify({ name: name })
    }).then(function () {
      var stored = JSON.parse(localStorage.getItem('cc_learner') || '{}');
      if (stored.user) { stored.user.name = name; }
      localStorage.setItem('cc_learner', JSON.stringify(stored));
      showScreen('terms');
    }).catch(function () { showScreen('terms'); });
  }

  // ── Terms accept (kept) ──────────────────────────────────────────────────
  function syncTermsBtn() {
    var cb = document.getElementById('terms-checkbox');
    document.getElementById('accept-terms-btn').disabled = !(cb && cb.checked);
  }

  function handleAcceptTerms() {
    var btn = document.getElementById('accept-terms-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    window.ccAuth.fetchAuthed('/api/learner?action=accept-terms', { method: 'POST' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showScreen('success');
        try { sessionStorage.setItem('cc_just_logged_in', '1'); } catch (_) {}
        setTimeout(function () { window.location.href = redirectTo; }, 800);
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Continue';
        var errEl = document.getElementById('terms-error');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.id = 'terms-error';
          errEl.style.cssText = 'margin-top:12px;color:#ef4444;font-size:0.85rem;line-height:1.4;';
          btn.parentNode.appendChild(errEl);
        }
        errEl.textContent = "Couldn't save - please try again.";
      });
  }

  // ── Code-input helpers (shared by 3 different code-input groups) ─────────
  function setupCodeInputs(containerId, onComplete, btnId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var inputs = container.querySelectorAll('input');
    var btn = btnId ? document.getElementById(btnId) : null;

    function update() {
      var code = collectCode(containerId);
      if (btn) btn.disabled = code.length < 6;
      inputs.forEach(function (i) { i.classList.toggle('filled', i.value.length > 0); });
    }

    inputs.forEach(function (input, idx) {
      input.addEventListener('input', function (e) {
        var val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(0, 1);
        update();
        if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (collectCode(containerId).length === 6 && onComplete) onComplete();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
          update();
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (collectCode(containerId).length === 6 && onComplete) onComplete();
        }
      });
      input.addEventListener('paste', function (e) {
        e.preventDefault();
        var pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (pasted.length >= 1) {
          pasted.split('').forEach(function (digit, i) { if (inputs[i]) inputs[i].value = digit; });
          inputs[Math.min(pasted.length, inputs.length - 1)].focus();
          update();
          if (pasted.length === 6 && onComplete) onComplete();
        }
      });
    });
  }

  function collectCode(containerId) {
    var inputs = document.querySelectorAll('#' + containerId + ' input');
    return Array.from(inputs).map(function (i) { return i.value; }).join('');
  }

  function clearCodeInputs(containerId) {
    var inputs = document.querySelectorAll('#' + containerId + ' input');
    inputs.forEach(function (i) { i.value = ''; i.classList.remove('filled'); });
  }

  function focusFirstCodeInput(containerId) {
    setTimeout(function () {
      var first = document.querySelector('#' + containerId + ' input[data-idx="0"]');
      if (first) first.focus();
    }, 100);
  }


  // ── Wiring ───────────────────────────────────────────────────────────────
  document.querySelectorAll('.auth-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchAuthMode(tab.dataset.mode); });
  });

  document.getElementById('signin-form').addEventListener('submit', handleSignIn);
  document.getElementById('password-form').addEventListener('submit', handlePasswordSignIn);
  document.getElementById('signup-form').addEventListener('submit', handleSignUp);
  document.getElementById('set-password-form').addEventListener('submit', handleSetPassword);
  document.getElementById('forgot-form').addEventListener('submit', handleForgot);
  document.getElementById('sms-phone-form').addEventListener('submit', handleSmsPhone);
  document.getElementById('add-email-form').addEventListener('submit', handleAddEmail);

  document.getElementById('btn-forgot').addEventListener('click', function () {
    showScreen('forgot');
    document.getElementById('forgot-email').focus();
  });
  document.getElementById('btn-sms-fallback').addEventListener('click', function () {
    showScreen('sms-phone');
    document.getElementById('sms-phone-input').focus();
  });
  document.getElementById('btn-password-login').addEventListener('click', function () {
    var email = document.getElementById('signin-email').value.trim();
    if (email) document.getElementById('password-email').value = email;
    showScreen('password');
    document.getElementById('password-email').focus();
  });
  document.getElementById('btn-back-from-forgot').addEventListener('click', function () {
    showScreen('auth');
  });
  document.getElementById('btn-back-from-password').addEventListener('click', function () {
    showScreen('auth');
  });
  document.getElementById('btn-back-from-sms').addEventListener('click', function () {
    showScreen('auth');
  });
  document.getElementById('btn-back-from-error').addEventListener('click', function () {
    showScreen('auth');
  });

  document.getElementById('migration-verify-btn').addEventListener('click', handleMigrationVerify);
  document.getElementById('migration-resend-btn').addEventListener('click', handleMigrationResend);
  document.getElementById('reset-verify-btn').addEventListener('click', handleResetVerify);
  document.getElementById('reset-resend-btn').addEventListener('click', handleResetResend);
  document.getElementById('verify-code-btn').addEventListener('click', handleSmsCodeVerify);
  document.getElementById('code-resend-btn').addEventListener('click', handleSmsResend);
  document.getElementById('btn-set-name').addEventListener('click', handleSetName);
  document.getElementById('input-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); handleSetName(); }
  });

  var termsCb = document.getElementById('terms-checkbox');
  if (termsCb) {
    termsCb.addEventListener('change', syncTermsBtn);
    termsCb.addEventListener('click', syncTermsBtn);
    document.getElementById('terms-label').addEventListener('click', function () {
      setTimeout(syncTermsBtn, 0);
    });
  }
  document.getElementById('accept-terms-btn').addEventListener('click', handleAcceptTerms);

  setupCodeInputs('migration-code-inputs', handleMigrationVerify, 'migration-verify-btn');
  setupCodeInputs('reset-code-inputs', handleResetVerify, 'reset-verify-btn');
  setupCodeInputs('code-inputs', handleSmsCodeVerify, 'verify-code-btn');

  if (emailParam) {
    document.getElementById('signin-email').value = emailParam;
    document.getElementById('signup-email').value = emailParam;
    document.getElementById('password-email').value = emailParam;
  }

  // Referral banner (URL ?ref=CODE)
  if (referralCode) {
    var rbanner = document.getElementById('referral-banner');
    if (rbanner) rbanner.style.display = 'block';
    var refInput = document.getElementById('signup-referral');
    if (refInput) refInput.value = referralCode;
    // Auto-switch to signup if a referral code is present (referrer is
    // expecting a new account)
    switchAuthMode('signup');
  }

})();
