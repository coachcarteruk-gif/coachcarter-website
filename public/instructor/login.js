(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const token     = urlParams.get('token'); // magic-link token from URL

  // If already logged in, redirect
  const existing = JSON.parse(localStorage.getItem('cc_instructor') || 'null');
  if (existing && !token) window.location.href = '/instructor/';

  let lastLoginEmail = null;

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

  // ── Sign in: request magic link ────────────────────────────────
  async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) return;

    const btn = document.getElementById('loginBtn');
    const err = document.getElementById('loginError');
    err.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/instructor?action=request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send link');

      lastLoginEmail = email;
      document.getElementById('sentEmail').textContent = email;
      showScreen('sign-in-sent');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send sign-in link';
    }
  }

  // ── Resend sign-in link ────────────────────────────────────────
  async function handleResend() {
    if (!lastLoginEmail) return;
    const btn = document.getElementById('resendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/instructor?action=request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lastLoginEmail })
      });
      if (res.ok) {
        btn.textContent = 'Sent! Check again';
        setTimeout(() => { btn.textContent = "Didn't get it? Send again"; btn.disabled = false; }, 5000);
      } else {
        btn.textContent = 'Failed — try again';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }

  // ── Verify magic link token (two-step: validate then verify) ───
  async function verifyToken(token) {
    try {
      // Step 1: Validate (GET — does NOT consume the token)
      const valRes = await fetch('/api/instructor?action=validate-token&token=' + encodeURIComponent(token));
      const valData = await valRes.json();

      if (!valRes.ok) {
        showScreen('verify-error');
        document.getElementById('verifyErrorTitle').textContent = 'Invalid link';
        document.getElementById('verifyErrorSub').textContent = (valData.error || 'Invalid link') + ' Please request a new sign-in link.';
        return;
      }

      // Step 2: Consume (POST — marks token as used, returns JWT)
      const res = await fetch('/api/instructor?action=verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();

      if (!res.ok) {
        showScreen('verify-error');
        document.getElementById('verifyErrorTitle').textContent = 'Verification failed';
        document.getElementById('verifyErrorSub').textContent = (data.error || 'Invalid link') + ' Please request a new sign-in link.';
        return;
      }

      // Store session and redirect
      localStorage.setItem('cc_instructor', JSON.stringify(data));
      window.location.href = '/instructor/';
    } catch {
      showScreen('verify-error');
      document.getElementById('verifyErrorTitle').textContent = 'Connection error';
      document.getElementById('verifyErrorSub').textContent = 'Could not reach the server. Please check your connection and try again.';
    }
  }

  // ── Join the team: submit enquiry ──────────────────────────────
  async function handleJoinSubmit(e) {
    e.preventDefault();
    const name    = document.getElementById('joinName').value.trim();
    const email   = document.getElementById('joinEmail').value.trim();
    const phone   = document.getElementById('joinPhone').value.trim();
    const message = document.getElementById('joinMessage').value.trim();
    const website = document.getElementById('joinWebsite')?.value || '';

    if (!name || !email || !phone) {
      const err = document.getElementById('joinError');
      err.textContent = 'Please fill in your name, email, and phone number.';
      err.classList.add('show');
      return;
    }

    const btn = document.getElementById('joinBtn');
    const err = document.getElementById('joinError');
    err.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/enquiries?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          enquiryType: 'join-team',
          message: message || null,
          marketing: false,
          website,
          submittedAt: new Date().toISOString()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send enquiry');

      showScreen('join-sent');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send enquiry';
    }
  }

  // Allow enter key to submit login
  document.getElementById('loginEmail')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleLoginSubmit(e); }
  });

(function wire() {
  document.querySelectorAll('[data-screen]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); showScreen(el.dataset.screen); });
  });
  var loginForm = document.getElementById('instr-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
  var joinForm = document.getElementById('instr-join-form');
  if (joinForm) joinForm.addEventListener('submit', handleJoinSubmit);
  var resend = document.getElementById('resendBtn');
  if (resend) resend.addEventListener('click', handleResend);
})();
})();
