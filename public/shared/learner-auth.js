/* CoachCarter Learner Auth Utilities
 *
 * Session state:
 *   - JWT lives in an httpOnly cookie (cc_learner) set by the login
 *     endpoint. JavaScript cannot read it — only the browser attaches
 *     it to outgoing requests on this origin.
 *   - CSRF token lives in a non-httpOnly cookie (cc_csrf) that this
 *     module reads and echoes in X-CSRF-Token on mutating fetches.
 *   - A lightweight display-only blob (id, name, email, school_id) is
 *     still mirrored in localStorage under STORAGE_KEY so sidebar
 *     greetings and gate redirects work without an extra API call.
 *     It contains no auth material. The token field is kept here for
 *     the Bearer-fallback grace window and is removed in a later
 *     commit once the cookie rollout is complete.
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

  /** Get the JWT bearer token from the stored session (legacy — kept
   *  for grace window. New code should use fetchAuthed()). */
  function getToken() {
    var auth = getAuth();
    return auth && auth.token ? auth.token : null;
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
    return fetch(url, merged);
  }

  /** Redirect to login if not authenticated. Returns the auth object if valid. */
  function requireAuth(redirectBack) {
    var auth = getAuth();
    if (!auth || !auth.token) {
      var url = LOGIN_URL;
      if (redirectBack !== false) {
        url += '?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      }
      window.location.href = url;
      return null;
    }
    return auth;
  }

  /** After login, fetch school branding if available */
  function onLogin(authData) {
    if (window.ccBranding && authData && authData.token) {
      try {
        var payload = JSON.parse(atob(authData.token.split('.')[1]));
        if (payload.school_id) {
          window.ccBranding.fetchAndCacheBranding(payload.school_id);
        }
      } catch (e) { /* ignore decode errors */ }
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
    getToken: getToken,
    getCsrfToken: getCsrfToken,
    fetchAuthed: fetchAuthed,
    requireAuth: requireAuth,
    logout: logout,
    onLogin: onLogin,
    STORAGE_KEY: STORAGE_KEY
  };
})();
