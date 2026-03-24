/* ─── Auth Gate ────────────────────────────────────────────────────────────────
   Shared sign-in prompt for learner hub pages.

   Usage:
     <script src="/auth-gate.js"></script>

   API:
     window.ccAuth.isLoggedIn   — boolean
     window.ccAuth.token        — JWT string or null
     window.ccAuth.user         — { id, name, email, tier } or null
     window.ccAuth.requireAuth() — shows sign-in modal if not logged in, returns boolean
     window.ccAuth.onAuth(fn)   — calls fn when user signs in (for deferred actions)
─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var session = null;
  try {
    session = JSON.parse(localStorage.getItem('cc_learner') || 'null');
  } catch (e) {}

  var isLoggedIn = !!(session && session.token);
  var pendingCallbacks = [];

  // ── Public API ──────────────────────────────────────────────────
  window.ccAuth = {
    isLoggedIn: isLoggedIn,
    token: isLoggedIn ? session.token : null,
    user: isLoggedIn ? session.user : null,

    /** Show sign-in modal if not logged in. Returns true if already authed. */
    requireAuth: function () {
      if (isLoggedIn) return true;
      showModal();
      return false;
    },

    /** Register a callback to run after sign-in (e.g. retry the action) */
    onAuth: function (fn) {
      if (isLoggedIn) { fn(); return; }
      pendingCallbacks.push(fn);
    }
  };

  // If already logged in, nothing more to do
  if (isLoggedIn) return;

  // ── Inject modal CSS ────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '.cc-auth-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);',
    '  z-index:10000; align-items:center; justify-content:center; padding:16px;',
    '  backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }',
    '.cc-auth-overlay.open { display:flex; }',
    '.cc-auth-modal { background:#fff; border-radius:16px; max-width:400px; width:100%;',
    '  padding:32px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.15);',
    '  animation:cc-auth-pop 0.3s cubic-bezier(0.34,1.56,0.64,1); }',
    '@keyframes cc-auth-pop { 0%{transform:scale(0.9);opacity:0} 100%{transform:scale(1);opacity:1} }',
    '.cc-auth-icon { width:64px; height:64px; border-radius:50%; background:#fff4ec;',
    '  display:flex; align-items:center; justify-content:center; margin:0 auto 20px;',
    '  box-shadow:0 0 0 8px rgba(245,131,33,0.06); }',
    '.cc-auth-icon svg { width:28px; height:28px; color:#f58321; }',
    '.cc-auth-title { font-family:"Bricolage Grotesque",sans-serif; font-size:1.25rem;',
    '  font-weight:700; color:#262626; margin-bottom:8px; }',
    '.cc-auth-sub { font-size:0.9rem; color:#797879; line-height:1.5; margin-bottom:24px; }',
    '.cc-auth-btn { display:block; width:100%; background:#f58321; color:#fff; border:none;',
    '  border-radius:10px; font-family:"Bricolage Grotesque",sans-serif; font-size:0.95rem;',
    '  font-weight:700; padding:14px; cursor:pointer; text-decoration:none; text-align:center;',
    '  transition:all 0.2s; box-shadow:0 2px 8px rgba(245,131,33,0.2); }',
    '.cc-auth-btn:hover { background:#e07518; transform:translateY(-1px);',
    '  box-shadow:0 4px 16px rgba(245,131,33,0.3); }',
    '.cc-auth-dismiss { display:inline-block; margin-top:12px; font-size:0.82rem;',
    '  color:#797879; background:none; border:none; cursor:pointer;',
    '  font-family:"Lato",sans-serif; transition:color 0.2s; }',
    '.cc-auth-dismiss:hover { color:#262626; }',
    '.cc-auth-free { display:inline-flex; align-items:center; gap:5px; background:#fff4ec;',
    '  color:#e07518; font-size:0.78rem; font-weight:600; padding:5px 12px;',
    '  border-radius:100px; margin-bottom:16px; }',
    '.cc-auth-free svg { width:14px; height:14px; }'
  ].join('\n');
  document.head.appendChild(style);

  // ── Build modal HTML ────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.className = 'cc-auth-overlay';
  overlay.id = 'cc-auth-overlay';
  overlay.innerHTML =
    '<div class="cc-auth-modal">' +
      '<div class="cc-auth-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>' +
          '<polyline points="10 17 15 12 10 7"/>' +
          '<line x1="15" y1="12" x2="3" y2="12"/>' +
        '</svg>' +
      '</div>' +
      '<div class="cc-auth-title">Sign in to continue</div>' +
      '<div class="cc-auth-sub">Create a free account or sign in to access this feature. No password needed — we\'ll send you a magic link.</div>' +
      '<a class="cc-auth-btn" id="cc-auth-signin">Sign in or create account</a>' +
      '<button class="cc-auth-dismiss" id="cc-auth-dismiss">Maybe later</button>' +
    '</div>';

  // Inject when DOM is ready
  function inject() {
    document.body.appendChild(overlay);

    // Set href with redirect back to current page
    var signinBtn = document.getElementById('cc-auth-signin');
    var redirect = encodeURIComponent(window.location.pathname + window.location.search);
    signinBtn.href = '/learner/login.html?redirect=' + redirect;

    // Dismiss
    document.getElementById('cc-auth-dismiss').addEventListener('click', hideModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hideModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  function showModal() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function hideModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
})();
