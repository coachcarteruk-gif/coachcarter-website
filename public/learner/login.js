(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const token     = urlParams.get('token');
  const redirectTo = urlParams.get('redirect') || '/learner/';

  // Redirect if already logged in (and not verifying a new token)
  const existing = JSON.parse(localStorage.getItem('cc_learner') || 'null');
  if (existing?.token && !token) { window.location.href = redirectTo; }

  let currentMethod = 'email';
  let lastPayload = null;
  let sessionData = null;
  let smsPhone = null;

  // ── Screen management ──────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
  }

  // ── If magic link token is in URL, verify immediately ──────────
  if (token) {
    showScreen('verifying');
    verifyToken(token);
  }

  // ── Method toggle (email / SMS) ────────────────────────────────
  function switchMethod(method) {
    currentMethod = method;
    document.getElementById('method-email').classList.toggle('active', method === 'email');
    document.getElementById('method-sms').classList.toggle('active', method === 'sms');
    document.getElementById('email-group').style.display = method === 'email' ? 'block' : 'none';
    document.getElementById('phone-group').style.display = method === 'sms' ? 'block' : 'none';
    document.getElementById('send-btn').textContent = method === 'sms' ? 'Send code' : 'Send login link';
    const hint = document.getElementById('method-hint');
    hint.innerHTML = method === 'sms'
      ? "We'll text you a 6-digit code that expires in 15 minutes."
      : "We'll send a one-time link that expires in 15 minutes.<br>Click it to sign in — no password to remember.";
    clearError();
  }

  function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.add('show');
  }
  function clearError() {
    document.getElementById('error-msg').classList.remove('show');
  }

  // ── Send magic link ────────────────────────────────────────────
  async function handleSendLink(e) {
    e.preventDefault();
    clearError();

    const email = document.getElementById('input-email').value.trim();
    const phone = document.getElementById('input-phone').value.trim();

    if (currentMethod === 'email' && !email) {
      showError('Please enter your email address.');
      return;
    }
    if (currentMethod === 'sms' && !phone) {
      showError('Please enter your phone number.');
      return;
    }

    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const payload = {
      method: currentMethod,
      email: currentMethod === 'email' ? email : undefined,
      phone: currentMethod === 'sms' ? phone : undefined
    };
    lastPayload = payload;

    try {
      const res = await fetch('/api/magic-link?action=send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'instructor_account') {
          showError('This email is linked to an instructor account.');
          setTimeout(() => { window.location.href = data.redirect || '/instructor/login.html'; }, 2000);
          return;
        }
        showError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      if (currentMethod === 'sms') {
        smsPhone = phone;
        document.getElementById('code-destination').textContent = phone;
        showScreen('code');
        setTimeout(() => {
          const first = document.querySelector('#code-inputs input[data-idx="0"]');
          if (first) first.focus();
        }, 100);
      } else {
        document.getElementById('sent-destination').textContent = email;
        document.getElementById('sent-method-label').textContent = 'email';
        showScreen('sent');
      }

    } catch {
      showError('Network error. Please check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = currentMethod === 'sms' ? 'Send code' : 'Send login link';
    }
  }

  // ── Resend magic link / code ──────────────────────────────────
  async function handleResend() {
    if (!lastPayload) return;
    const btn = document.getElementById('screen-code')?.classList.contains('active')
      ? document.getElementById('code-resend-btn')
      : document.getElementById('resend-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/magic-link?action=send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastPayload)
      });
      if (res.ok) {
        btn.textContent = 'Sent! Check again';
        // Clear code inputs on resend
        document.querySelectorAll('#code-inputs input').forEach(i => {
          i.value = '';
          i.classList.remove('filled');
        });
        const codeError = document.getElementById('code-error');
        if (codeError) codeError.textContent = '';
        const verifyBtn = document.getElementById('verify-code-btn');
        if (verifyBtn) verifyBtn.disabled = true;
        setTimeout(() => {
          btn.textContent = "Didn't get it? Send again";
          btn.disabled = false;
        }, 5000);
      } else {
        btn.textContent = 'Failed — try again';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }

  // ── SMS code input handling ─────────────────────────────────────
  (function setupCodeInputs() {
    const container = document.getElementById('code-inputs');
    if (!container) return;
    const inputs = container.querySelectorAll('input');
    const verifyBtn = document.getElementById('verify-code-btn');

    function getCode() {
      return Array.from(inputs).map(i => i.value).join('');
    }

    function updateVerifyBtn() {
      verifyBtn.disabled = getCode().length < 6;
      inputs.forEach(i => i.classList.toggle('filled', i.value.length > 0));
    }

    inputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(0, 1);
        updateVerifyBtn();
        if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (getCode().length === 6) handleVerifyCode();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].value = '';
          updateVerifyBtn();
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (getCode().length === 6) handleVerifyCode();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (pasted.length >= 1) {
          pasted.split('').forEach((digit, i) => { if (inputs[i]) inputs[i].value = digit; });
          inputs[Math.min(pasted.length, inputs.length - 1)].focus();
          updateVerifyBtn();
          if (pasted.length === 6) handleVerifyCode();
        }
      });
    });
  })();

  // ── Verify SMS code ─────────────────────────────────────────────
  async function handleVerifyCode() {
    const inputs = document.querySelectorAll('#code-inputs input');
    const code = Array.from(inputs).map(i => i.value).join('');
    if (code.length < 6) return;

    const btn = document.getElementById('verify-code-btn');
    const errorEl = document.getElementById('code-error');
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    errorEl.textContent = '';

    try {
      const res = await fetch('/api/magic-link?action=verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, phone: smsPhone })
      });
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.message || 'Invalid code. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Verify code';
        inputs.forEach(i => { i.value = ''; i.classList.remove('filled'); });
        inputs[0].focus();
        return;
      }

      // Store the session
      localStorage.setItem('cc_learner', JSON.stringify({
        token: data.token,
        user: data.user
      }));

      // New user? Collect name
      if (data.is_new_user && data.needs_name) {
        localStorage.setItem('cc_welcome', '1');
        showScreen('new-user');
        return;
      }

      // Existing user — check terms then redirect
      btn.textContent = 'Signed in!';
      proceedOrShowTerms(data);
    } catch {
      errorEl.textContent = 'Network error. Please check your connection.';
      btn.disabled = false;
      btn.textContent = 'Verify code';
    }
  }

  // ── Verify magic link token (two-step: validate then verify) ───
  async function verifyToken(token) {
    try {
      // Step 1: Validate (GET — does NOT consume the token)
      const valRes = await fetch('/api/magic-link?action=validate&token=' + encodeURIComponent(token));
      const valData = await valRes.json();

      if (!valRes.ok) {
        showScreen('error');
        if (valData.error === 'expired') {
          document.getElementById('error-title').textContent = 'Link expired';
          document.getElementById('error-sub').textContent = valData.message;
        } else {
          document.getElementById('error-title').textContent = 'Verification failed';
          document.getElementById('error-sub').textContent = valData.message || 'Something went wrong. Please try again.';
        }
        return;
      }

      // Step 2: Consume (POST — marks token as used, returns JWT)
      const res = await fetch('/api/magic-link?action=verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'instructor_account') {
          window.location.href = data.redirect || '/instructor/login.html';
          return;
        }
        showScreen('error');
        if (data.error === 'expired') {
          document.getElementById('error-title').textContent = 'Link expired';
          document.getElementById('error-sub').textContent = data.message;
        } else {
          document.getElementById('error-title').textContent = 'Verification failed';
          document.getElementById('error-sub').textContent = data.message || 'Something went wrong. Please try again.';
        }
        return;
      }

      // Store the session
      sessionData = data;
      localStorage.setItem('cc_learner', JSON.stringify({
        token: data.token,
        user: data.user
      }));

      // New user without a name? Collect it
      if (data.is_new_user && data.needs_name) {
        localStorage.setItem('cc_welcome', '1');
        showScreen('new-user');
        return;
      }

      // Existing user — check terms then redirect
      proceedOrShowTerms(data);
    } catch {
      showScreen('error');
      document.getElementById('error-title').textContent = 'Connection error';
      document.getElementById('error-sub').textContent = 'Could not reach the server. Please check your connection and try again.';
    }
  }

  // ── Set name for new users ─────────────────────────────────────
  async function handleSetName() {
    const name = document.getElementById('input-name').value.trim();
    if (!name) {
      document.getElementById('input-name').focus();
      return;
    }

    try {
      // Session cookie was set by /api/magic-link?action=verify above,
      // so ccAuth.fetchAuthed can hit the authed endpoint immediately.
      const stored = JSON.parse(localStorage.getItem('cc_learner') || '{}');
      await ccAuth.fetchAuthed('/api/learner?action=update-name', {
        method: 'POST',
        body: JSON.stringify({ name })
      });

      stored.user.name = name;
      localStorage.setItem('cc_learner', JSON.stringify(stored));

      // New users always need to accept terms
      showScreen('terms');
    } catch {
      // Even if name update fails, still show terms
      showScreen('terms');
    }
  }

  // ── Terms checkbox toggle ───────────────────────────────────────
  document.getElementById('terms-checkbox')?.addEventListener('change', function() {
    document.getElementById('accept-terms-btn').disabled = !this.checked;
  });

  // ── Accept terms & continue ────────────────────────────────────
  async function handleAcceptTerms() {
    const btn = document.getElementById('accept-terms-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const res = await ccAuth.fetchAuthed('/api/learner?action=accept-terms', {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed');

      showScreen('success');
      setTimeout(() => { window.location.href = redirectTo; }, 800);
    } catch {
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  }

  // ── Helper: proceed after auth or show terms gate ──────────────
  function proceedOrShowTerms(data) {
    if (!data.terms_accepted) {
      showScreen('terms');
      return;
    }
    showScreen('success');
    if (data.is_new_user) {
      localStorage.setItem('cc_welcome', '1');
      setTimeout(() => { window.location.href = '/learner/book.html'; }, 800);
    } else {
      setTimeout(() => { window.location.href = redirectTo; }, 800);
    }
  }

  // Handle Enter key in name input
  document.getElementById('input-name')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleSetName(); }
  });

(function wire() {
  document.querySelectorAll('[data-method]').forEach(function (btn) {
    btn.addEventListener('click', function () { switchMethod(btn.dataset.method); });
  });
  var form = document.getElementById('send-link-form');
  if (form) form.addEventListener('submit', handleSendLink);
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('resend-btn', handleResend);
  bind('verify-code-btn', handleVerifyCode);
  bind('code-resend-btn', handleResend);
  bind('btn-set-name', handleSetName);
  bind('accept-terms-btn', handleAcceptTerms);
  bind('btn-request-new-link', function () { showScreen('form'); });
})();
})();
