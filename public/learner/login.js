(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const token     = urlParams.get('token'); // magic-link token from URL
  const redirectTo = urlParams.get('redirect') || '/learner/';
  const referralCode = urlParams.get('ref') || '';

  // Redirect if already logged in (and not verifying a new token)
  const existing = JSON.parse(localStorage.getItem('cc_learner') || 'null');
  if (existing && !token) { window.location.href = redirectTo; }

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

  // ── Referral validation state ──────────────────────────────────
  let skipReferral = false;  // user chose to continue without referral

  // ── Send magic link ────────────────────────────────────────────
  async function handleSendLink(e) {
    e.preventDefault();
    clearError();
    hideReferralError();

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
    btn.textContent = 'Checking…';

    // Include referral code from URL param or manual input
    const refCode = referralCode || (document.getElementById('input-referral')?.value.trim() || '');
    const effectiveRef = skipReferral ? '' : refCode;

    // Validate referral code before sending magic link (unless skipped)
    if (effectiveRef) {
      try {
        const valRes = await fetch('/api/learner?action=validate-referral&code=' + encodeURIComponent(effectiveRef) + '&school_id=1');
        const valData = await valRes.json();
        if (!valData.valid) {
          btn.disabled = false;
          btn.textContent = currentMethod === 'sms' ? 'Send code' : 'Send login link';
          showReferralError(effectiveRef);
          return;
        }
      } catch {
        // Validation endpoint failed — proceed anyway (don't block signup)
      }
    }

    btn.textContent = 'Sending…';

    const payload = {
      method: currentMethod,
      email: currentMethod === 'email' ? email : undefined,
      phone: currentMethod === 'sms' ? phone : undefined,
      referral_code: effectiveRef || undefined
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

      // Store the session (display-only blob — JWT is in the httpOnly cookie)
      localStorage.setItem('cc_learner', JSON.stringify({
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

      // Store the session (display-only blob — JWT is in the httpOnly cookie)
      sessionData = data;
      localStorage.setItem('cc_learner', JSON.stringify({
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
  // Use both 'change' and 'click' because mobile browsers don't always fire
  // 'change' when the tap lands on the label rather than the checkbox itself.
  function syncTermsBtn() {
    const cb = document.getElementById('terms-checkbox');
    document.getElementById('accept-terms-btn').disabled = !(cb && cb.checked);
  }
  const termsCheckbox = document.getElementById('terms-checkbox');
  if (termsCheckbox) {
    termsCheckbox.addEventListener('change', syncTermsBtn);
    termsCheckbox.addEventListener('click', syncTermsBtn);
    // Re-check after any click on the label (covers taps near the links)
    document.getElementById('terms-label')?.addEventListener('click', function() {
      setTimeout(syncTermsBtn, 0);
    });
  }

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
      try { sessionStorage.setItem('cc_just_logged_in', '1'); } catch (e) {}
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
    // Arrival flag: signals the dashboard to show a one-time "you're in"
    // toast on this session. Cleared after display. Distinct from
    // cc_welcome (first-time signup, persistent).
    try { sessionStorage.setItem('cc_just_logged_in', '1'); } catch (e) {}
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

// ── Referral validation error UI ──────────────────────────────────
function showReferralError(badCode) {
  var el = document.getElementById('referral-error');
  if (!el) return;
  el.querySelector('.ref-error-code').textContent = badCode;
  el.style.display = 'block';
  // Focus the referral input so they can fix the typo
  var input = document.getElementById('input-referral');
  var group = document.getElementById('referral-group');
  if (group) group.style.display = 'block';
  if (input) { input.value = badCode; input.focus(); input.select(); }
}
function hideReferralError() {
  var el = document.getElementById('referral-error');
  if (el) el.style.display = 'none';
}
function handleSkipReferral() {
  skipReferral = true;
  hideReferralError();
  // Hide the referral input and banner since they're skipping
  var group = document.getElementById('referral-group');
  var banner = document.getElementById('referral-banner');
  if (group) group.style.display = 'none';
  if (banner) banner.style.display = 'none';
  // Re-submit the form
  var form = document.getElementById('send-link-form');
  if (form) form.requestSubmit();
}

// ── Referral code UI ──────────────────────────────────────────────
(function setupReferral() {
  var banner = document.getElementById('referral-banner');
  var group = document.getElementById('referral-group');
  var input = document.getElementById('input-referral');
  if (referralCode) {
    // URL has ?ref=CODE — show banner, auto-fill the hidden input
    if (banner) banner.style.display = 'block';
    if (input) input.value = referralCode;
    // Keep the input hidden — code already captured from URL
  } else {
    // No URL param — show optional manual input field
    if (group) group.style.display = 'block';
  }
})();

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
  bind('btn-skip-referral', handleSkipReferral);
})();
})();
