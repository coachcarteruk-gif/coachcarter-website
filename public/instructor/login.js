/* CoachCarter instructor login (May 2026 — password auth)
 *
 * Flows:
 *   - Choice screen (sign-in vs. join-the-team) — kept as-is
 *   - Sign in: email + password → either dashboard, or force-change-password
 *   - Force change password: required after admin sets/resets a password
 *   - Join the team: enquiry form — kept as-is
 *
 * Forgot-password is intentionally NOT self-serve. Instructors contact the
 * admin (see hint text on the sign-in screen). Admins use the admin portal
 * to issue a new password.
 */
(function () {
  'use strict';

  // If already logged in, redirect
  var existing = null;
  try { existing = JSON.parse(localStorage.getItem('cc_instructor') || 'null'); } catch (_) {}
  if (existing && existing.instructor) {
    window.location.href = '/instructor/';
  }

  var lastEmail = null;
  var lastPassword = null;  // held briefly to satisfy change-password's current_password check

  // ── Screen management ──────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }

  function setError(elId, msg) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    if (msg) el.classList.add('show'); else el.classList.remove('show');
  }

  // ── Sign in ────────────────────────────────────────────────────────────
  async function handleLoginSubmit(e) {
    e.preventDefault();
    setError('loginError', '');
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!email || !password) {
      setError('loginError', 'Please enter your email and password.');
      return;
    }

    var btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in…';

    try {
      var res = await fetch('/api/instructor-auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email, password: password }),
      });
      var data = await res.json();
      if (!res.ok) {
        if (data.error === 'locked') {
          setError('loginError', data.message);
        } else {
          setError('loginError', data.message || 'Email or password is incorrect.');
        }
        return;
      }

      // Persist display blob (auth lives in the cc_instructor httpOnly cookie)
      localStorage.setItem('cc_instructor', JSON.stringify({ instructor: data.instructor }));

      if (data.must_change_password) {
        // Hold the password in memory so change-password can present it as
        // current_password without asking the user to retype.
        lastEmail = email;
        lastPassword = password;
        showScreen('change-password');
        setTimeout(function () {
          var f = document.getElementById('changeNewPassword');
          if (f) f.focus();
        }, 100);
        return;
      }

      window.location.href = '/instructor/';
    } catch (ex) {
      setError('loginError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  }

  // ── Force change password ──────────────────────────────────────────────
  async function handleChangePwSubmit(e) {
    e.preventDefault();
    setError('changePwError', '');
    var pw = document.getElementById('changeNewPassword').value;
    var pw2 = document.getElementById('changeConfirmPassword').value;
    if (pw.length < 8) {
      setError('changePwError', 'Password must be at least 8 characters.');
      return;
    }
    if (pw !== pw2) {
      setError('changePwError', 'Passwords don\'t match.');
      return;
    }
    if (!lastPassword) {
      setError('changePwError', 'Session lost. Please sign in again.');
      setTimeout(function () { showScreen('sign-in'); }, 1500);
      return;
    }

    var btn = document.getElementById('changePwBtn');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      // CSRF token rides via cc_csrf cookie + X-CSRF-Token header.
      // The cookie was set on login, read it now.
      var csrf = '';
      var match = ('; ' + (document.cookie || '')).match(/; cc_csrf=([^;]*)/);
      if (match) { try { csrf = decodeURIComponent(match[1]); } catch (_) { csrf = match[1]; } }

      var res = await fetch('/api/instructor-auth?action=change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({ current_password: lastPassword, new_password: pw }),
      });
      var data = await res.json();
      if (!res.ok) {
        if (data.error === 'invalid_password') {
          setError('changePwError', data.message);
        } else if (data.error === 'same_password') {
          setError('changePwError', data.message);
        } else if (data.error === 'invalid_current_password') {
          // Shouldn't happen (we just used it to log in), but handle gracefully
          setError('changePwError', 'Something went wrong. Please sign in again.');
          setTimeout(function () { showScreen('sign-in'); }, 1500);
        } else {
          setError('changePwError', data.message || data.error || 'Could not save password.');
        }
        return;
      }

      lastPassword = null;
      window.location.href = '/instructor/';
    } catch (ex) {
      setError('changePwError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Save and continue';
    }
  }

  // ── Join the team enquiry (unchanged) ──────────────────────────────────
  async function handleJoinSubmit(e) {
    e.preventDefault();
    var name    = document.getElementById('joinName').value.trim();
    var email   = document.getElementById('joinEmail').value.trim();
    var phone   = document.getElementById('joinPhone').value.trim();
    var message = document.getElementById('joinMessage').value.trim();
    var website = (document.getElementById('joinWebsite') || {}).value || '';

    if (!name || !email || !phone) {
      setError('joinError', 'Please fill in your name, email, and phone number.');
      return;
    }

    var btn = document.getElementById('joinBtn');
    setError('joinError', '');
    btn.disabled = true; btn.textContent = 'Sending…';

    try {
      var res = await fetch('/api/enquiries?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name, email: email, phone: phone,
          enquiryType: 'join-team',
          message: message || null,
          marketing: false,
          website: website,
          submittedAt: new Date().toISOString(),
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send enquiry');
      showScreen('join-sent');
    } catch (ex) {
      setError('joinError', ex.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Send enquiry';
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-screen]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); showScreen(el.dataset.screen); });
  });
  var loginForm = document.getElementById('instr-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
  var changePwForm = document.getElementById('instr-change-pw-form');
  if (changePwForm) changePwForm.addEventListener('submit', handleChangePwSubmit);
  var joinForm = document.getElementById('instr-join-form');
  if (joinForm) joinForm.addEventListener('submit', handleJoinSubmit);
})();
