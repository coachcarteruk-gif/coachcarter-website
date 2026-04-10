/* CoachCarter Instructor Auth Utilities
 *
 * Session state mirrors learner-auth.js — JWT in httpOnly cc_instructor
 * cookie, CSRF token in non-httpOnly cc_csrf cookie read via JS and
 * echoed in X-CSRF-Token. A display-only blob is kept in localStorage
 * for sidebar rendering. See learner-auth.js for the full rationale.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_instructor';
  var LOGIN_URL   = '/instructor/login.html';
  var LOGOUT_URL  = '/api/instructor?action=logout';

  /** Parse the stored instructor session, or return null */
  function getAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  /** Get the JWT bearer token from the stored session (legacy — kept
   *  for grace window). */
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
   * fetch() wrapper that includes credentials (httpOnly session cookie)
   * and attaches X-CSRF-Token on mutating methods.
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
  function requireAuth() {
    var auth = getAuth();
    if (!auth || !auth.token) {
      window.location.href = LOGIN_URL;
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
