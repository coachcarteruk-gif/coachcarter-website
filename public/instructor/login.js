/* CoachCarter instructor login
 *
 * Default sign-in is email + 6-digit code. Password login remains available
 * as a secondary path for instructors who still need it.
 */
(function () {
  'use strict';

  var existing = null;
  try { existing = JSON.parse(localStorage.getItem('cc_instructor') || 'null'); } catch (_) {}
  if (existing && existing.instructor) {
    window.location.href = '/instructor/';
  }

  var lastPassword = null;
  var pendingEmail = null;
  var requestedSchoolId = parseInt(new URLSearchParams(window.location.search).get('school_id'), 10);
  var schoolId = Number.isSafeInteger(requestedSchoolId) && requestedSchoolId > 0
    ? requestedSchoolId
    : 1;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.classList.remove('active');
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

  function finishLogin(data) {
    localStorage.setItem('cc_instructor', JSON.stringify({ instructor: data.instructor }));
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setError('loginError', '');
    var email = document.getElementById('loginEmail').value.trim();
    if (!email) {
      setError('loginError', 'Please enter your email address.');
      return;
    }

    var btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Sending code...';

    try {
      var res = await fetch('/api/magic-link?action=send-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email, purpose: 'login', role: 'instructor', school_id: schoolId }),
      });
      var data = await res.json();
      if (!res.ok) {
        setError('loginError', data.message || data.error || 'Could not send code. Please try again.');
        return;
      }

      pendingEmail = email;
      document.getElementById('codeEmail').textContent = email;
      clearCodeInputs('code-inputs');
      showScreen('code');
      focusFirstCodeInput('code-inputs');
    } catch (ex) {
      setError('loginError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send sign-in code';
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('passwordError', '');
    var email = document.getElementById('passwordEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!email || !password) {
      setError('passwordError', 'Please enter your email and password.');
      return;
    }

    var btn = document.getElementById('passwordBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      var res = await fetch('/api/instructor-auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email, password: password }),
      });
      var data = await res.json();
      if (!res.ok) {
        setError('passwordError', data.error === 'locked'
          ? data.message
          : data.message || 'Email or password is incorrect.');
        return;
      }

      finishLogin(data);
      if (data.must_change_password) {
        lastPassword = password;
        showScreen('change-password');
        setTimeout(function () {
          var field = document.getElementById('changeNewPassword');
          if (field) field.focus();
        }, 100);
        return;
      }

      window.location.href = '/instructor/';
    } catch (ex) {
      setError('passwordError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in with password';
    }
  }

  async function handleCodeVerify() {
    var code = collectCode('code-inputs');
    if (code.length !== 6 || !pendingEmail) return;
    var btn = document.getElementById('verifyCodeBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    setError('codeError', '');

    try {
      var res = await fetch('/api/magic-link?action=verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: pendingEmail, code: code, purpose: 'login', role: 'instructor', school_id: schoolId }),
      });
      var data = await res.json();
      if (!res.ok) {
        setError('codeError', data.message || 'Invalid code. Please try again.');
        clearCodeInputs('code-inputs');
        focusFirstCodeInput('code-inputs');
        return;
      }

      finishLogin(data);
      window.location.href = '/instructor/';
    } catch (ex) {
      setError('codeError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  async function handleCodeResend() {
    if (!pendingEmail) return;
    var btn = document.getElementById('resendCodeBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      await fetch('/api/magic-link?action=send-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: pendingEmail, purpose: 'login', role: 'instructor', school_id: schoolId }),
      });
      btn.textContent = 'Sent! Check again';
    } finally {
      setTimeout(function () {
        btn.textContent = "Didn't get it? Send again";
        btn.disabled = false;
      }, 5000);
    }
  }

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
      setTimeout(function () { showScreen('password'); }, 1500);
      return;
    }

    var btn = document.getElementById('changePwBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
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
        setError('changePwError', data.message || data.error || 'Could not save password.');
        return;
      }

      lastPassword = null;
      window.location.href = '/instructor/';
    } catch (ex) {
      setError('changePwError', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save and continue';
    }
  }

  async function handleJoinSubmit(e) {
    e.preventDefault();
    var name = document.getElementById('joinName').value.trim();
    var email = document.getElementById('joinEmail').value.trim();
    var phone = document.getElementById('joinPhone').value.trim();
    var message = document.getElementById('joinMessage').value.trim();
    var website = (document.getElementById('joinWebsite') || {}).value || '';

    if (!name || !email || !phone) {
      setError('joinError', 'Please fill in your name, email, and phone number.');
      return;
    }

    var btn = document.getElementById('joinBtn');
    setError('joinError', '');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      var res = await fetch('/api/enquiries?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
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
      btn.disabled = false;
      btn.textContent = 'Send enquiry';
    }
  }

  function setupCodeInputs(containerId, onComplete, btnId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var inputs = container.querySelectorAll('input');
    var btn = btnId ? document.getElementById(btnId) : null;

    function update() {
      var code = collectCode(containerId);
      if (btn) btn.disabled = code.length < 6;
      inputs.forEach(function (input) {
        input.classList.toggle('filled', input.value.length > 0);
      });
    }

    inputs.forEach(function (input, idx) {
      input.addEventListener('input', function (event) {
        var val = event.target.value.replace(/\D/g, '').slice(0, 1);
        event.target.value = val;
        update();
        if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (collectCode(containerId).length === 6 && onComplete) onComplete();
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
          update();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (collectCode(containerId).length === 6 && onComplete) onComplete();
        }
      });
      input.addEventListener('paste', function (event) {
        event.preventDefault();
        var pasted = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        pasted.split('').forEach(function (digit, i) {
          if (inputs[i]) inputs[i].value = digit;
        });
        update();
        if (pasted.length === 6 && onComplete) onComplete();
      });
    });
  }

  function collectCode(containerId) {
    var inputs = document.querySelectorAll('#' + containerId + ' input');
    return Array.from(inputs).map(function (input) { return input.value; }).join('');
  }

  function clearCodeInputs(containerId) {
    document.querySelectorAll('#' + containerId + ' input').forEach(function (input) {
      input.value = '';
      input.classList.remove('filled');
    });
  }

  function focusFirstCodeInput(containerId) {
    setTimeout(function () {
      var first = document.querySelector('#' + containerId + ' input[data-idx="0"]');
      if (first) first.focus();
    }, 100);
  }

  document.querySelectorAll('[data-screen]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      showScreen(el.dataset.screen);
    });
  });

  var loginForm = document.getElementById('instr-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  var passwordForm = document.getElementById('instr-password-form');
  if (passwordForm) passwordForm.addEventListener('submit', handlePasswordSubmit);

  var passwordLink = document.getElementById('usePasswordBtn');
  if (passwordLink) passwordLink.addEventListener('click', function () {
    var email = document.getElementById('loginEmail').value.trim();
    if (email) document.getElementById('passwordEmail').value = email;
    showScreen('password');
    document.getElementById('passwordEmail').focus();
  });

  var verifyCodeBtn = document.getElementById('verifyCodeBtn');
  if (verifyCodeBtn) verifyCodeBtn.addEventListener('click', handleCodeVerify);

  var resendCodeBtn = document.getElementById('resendCodeBtn');
  if (resendCodeBtn) resendCodeBtn.addEventListener('click', handleCodeResend);

  var changePwForm = document.getElementById('instr-change-pw-form');
  if (changePwForm) changePwForm.addEventListener('submit', handleChangePwSubmit);

  var joinForm = document.getElementById('instr-join-form');
  if (joinForm) joinForm.addEventListener('submit', handleJoinSubmit);

  setupCodeInputs('code-inputs', handleCodeVerify, 'verifyCodeBtn');
})();
