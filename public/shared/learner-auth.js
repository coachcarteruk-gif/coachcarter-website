/* CoachCarter Learner Auth Utilities
 *
 * Session state:
 *   - JWT lives in an httpOnly cookie (cc_learner) set by the login
 *     endpoint. JavaScript cannot read it — only the browser attaches
 *     it to outgoing requests on this origin.
 *   - CSRF token lives in a non-httpOnly cookie (cc_csrf) that this
 *     module reads and echoes in X-CSRF-Token on mutating fetches.
 *   - A lightweight display-only blob (id, name, email, school_id,
 *     tier) is mirrored in localStorage under STORAGE_KEY so sidebar
 *     greetings and gate redirects work without an extra API call.
 *     It contains no auth material.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_learner';
  var LOGIN_URL   = '/learner/login.html';
  var LOGOUT_URL  = '/api/magic-link?action=logout';

  /** Parse the stored learner session, or return null */
  function getAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  /** Read a cookie by name from document.cookie. Returns '' if absent. */
  function readCookie(name) {
    var match = ('; ' + (document.cookie || '')).match(
      new RegExp('; ' + name.replace(/[-.]/g, '\\$&') + '=([^;]*)')
    );
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
  }

  /** Get the CSRF token from the cc_csrf cookie. */
  function getCsrfToken() {
    return readCookie('cc_csrf');
  }

  /**
   * fetch() wrapper that includes credentials (so the httpOnly session
   * cookie rides along) and attaches X-CSRF-Token on mutating methods.
   *
   * Drop-in replacement for fetch() on authed pages. Handles JSON body
   * Content-Type when a string body is passed and no Content-Type is set.
   */
  function fetchAuthed(url, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var headers = new Headers(options.headers || {});
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      headers.set('X-CSRF-Token', getCsrfToken());
    }
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    var merged = {};
    for (var k in options) if (Object.prototype.hasOwnProperty.call(options, k)) merged[k] = options[k];
    merged.credentials = 'include';
    merged.headers = headers;
    return fetch(url, merged).then(function (res) {
      // Session cookie gone but localStorage blob still says we're logged
      // in (common on iOS Safari ITP: 7d cookie eviction, localStorage
      // persists longer). Clear the stale blob and prompt for re-login
      // inline rather than leaving the page silently broken.
      if (res.status === 401 && url.indexOf('/api/magic-link') === -1) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        showSessionExpiredPrompt();
      }
      return res;
    });
  }

  /**
   * Show an inline "session expired" modal once. Subsequent 401s during
   * the same page view are ignored (the modal is already up). Clicking
   * "Sign in" goes to the login page with a redirect-back; "Dismiss"
   * just closes it (the page will keep 401-ing but at least the user
   * isn't yanked away mid-action).
   */
  var sessionExpiredShown = false;
  function showSessionExpiredPrompt() {
    if (sessionExpiredShown) return;
    sessionExpiredShown = true;

    var redirect = encodeURIComponent(window.location.pathname + window.location.search);
    var loginHref = LOGIN_URL + '?redirect=' + redirect + '&expired=1';

    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);' +
      'z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:400px;width:100%;' +
        'padding:32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.15);' +
        'font-family:Lato,sans-serif;">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:#fff4ec;' +
          'display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">' +
          '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f58321" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '</div>' +
        '<div style="font-family:\'Bricolage Grotesque\',sans-serif;font-size:1.25rem;' +
          'font-weight:700;color:#262626;margin-bottom:8px;">Session expired</div>' +
        '<div style="font-size:0.9rem;color:#797879;line-height:1.5;margin-bottom:24px;">' +
          'You\'ve been signed out for security. Sign in again to continue where you left off.' +
        '</div>' +
        '<a href="' + loginHref + '" style="display:block;width:100%;background:#f58321;' +
          'color:#fff;border-radius:10px;font-family:\'Bricolage Grotesque\',sans-serif;' +
          'font-size:0.95rem;font-weight:700;padding:14px;text-decoration:none;' +
          'box-shadow:0 2px 8px rgba(245,131,33,0.2);">Sign in again</a>' +
        '<button type="button" data-cc-dismiss="1" style="margin-top:12px;font-size:0.82rem;' +
          'color:#797879;background:none;border:none;cursor:pointer;">Dismiss</button>' +
      '</div>';

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || (e.target && e.target.getAttribute('data-cc-dismiss'))) {
        overlay.remove();
      }
    });
    document.body.appendChild(overlay);
  }

  /** Redirect to login if not authenticated. Returns the auth object if valid. */
  function requireAuth(redirectBack) {
    var auth = getAuth();
    if (!auth) {
      var url = LOGIN_URL;
      if (redirectBack !== false) {
        url += '?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      }
      window.location.href = url;
      return null;
    }
    return auth;
  }

  /** After login, fetch school branding if available. Reads school_id
   *  from the display blob returned by the login endpoint — no JWT
   *  decode needed. */
  function onLogin(authData) {
    if (window.ccBranding && authData && authData.user && authData.user.school_id) {
      window.ccBranding.fetchAndCacheBranding(authData.user.school_id);
    }
  }

  /** Log out: clear server cookies, clear localStorage blob, redirect to login. */
  function logout() {
    // Fire-and-forget — if the request fails we still clear local state.
    // keepalive lets it survive the page navigation.
    try {
      fetchAuthed(LOGOUT_URL, { method: 'POST', keepalive: true }).catch(function () {});
    } catch (e) { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY);
    if (window.ccBranding) window.ccBranding.clearBranding();
    window.location.href = LOGIN_URL;
  }

  // Expose globally
  window.ccAuth = {
    getAuth: getAuth,
    getCsrfToken: getCsrfToken,
    fetchAuthed: fetchAuthed,
    requireAuth: requireAuth,
    logout: logout,
    onLogin: onLogin,
    STORAGE_KEY: STORAGE_KEY
  };
})();
