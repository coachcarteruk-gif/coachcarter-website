/* CoachCarter Instructor Auth Utilities
 *
 * Session state mirrors learner-auth.js - JWT in httpOnly cc_instructor
 * cookie, CSRF token in non-httpOnly cc_csrf cookie read via JS and
 * echoed in X-CSRF-Token. A display-only blob is kept in localStorage
 * for sidebar rendering. See learner-auth.js for the full rationale.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_instructor';
  var LOGIN_URL   = '/instructor/login.html';
  var LOGOUT_URL  = '/api/instructor?action=logout';
  var supportExitPromise = null;

  /** Parse the stored instructor session, or return null */
  function getAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function isImpersonating(auth) {
    auth = auth || getAuth();
    return !!(auth && auth.impersonation && auth.impersonation.active);
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
    var supportRequest = isImpersonating();
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
      // Read failures during support trigger explicit restoration on every
      // instructor page, including Dashboard. Do not replay the request under
      // the restored identity, or let a page's 401 handler log that identity out.
      if (res.status === 401 && method === 'GET' && supportRequest) {
        var recovery = isImpersonating() ? logout() : Promise.resolve();
        return Promise.resolve(recovery).then(function () {
          throw new Error('Support session ended. Return to your account to continue.');
        });
      }
      return res;
    });
  }

  /** Redirect to login if not authenticated. Returns the auth object if valid. */
  function requireAuth() {
    var auth = getAuth();
    if (!auth) {
      window.location.href = LOGIN_URL;
      return null;
    }
    return auth;
  }

  /** After login, fetch school branding if available. Reads school_id
   *  from the display blob returned by the login endpoint - no JWT
   *  decode needed. */
  function onLogin(authData) {
    if (window.ccBranding && authData && authData.instructor && authData.instructor.school_id) {
      window.ccBranding.fetchAndCacheBranding(authData.instructor.school_id);
    }
  }

  /** Log out: clear server cookies, clear localStorage blob, redirect to login. */
  function logout() {
    if (isImpersonating()) {
      if (supportExitPromise) return supportExitPromise;
      supportExitPromise = fetchAuthed('/api/admin?action=stop-instructor-access', { method: 'POST' })
        .then(function (res) {
          if (res.status === 401) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.href = LOGIN_URL;
            return;
          }
          if (!res.ok) throw new Error('Session recovery unavailable');
          return res.json().then(function (data) {
            if (data.instructor) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ instructor: data.instructor }));
            } else {
              localStorage.removeItem(STORAGE_KEY);
            }
            window.location.href = '/admin/portal.html';
          });
        })
        .catch(function () {
          window.alert('Could not return to your account. Check your connection and try Back to Admin again.');
        })
        .finally(function () { supportExitPromise = null; });
      return supportExitPromise;
    }

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
    isImpersonating: isImpersonating,
    getCsrfToken: getCsrfToken,
    fetchAuthed: fetchAuthed,
    requireAuth: requireAuth,
    logout: logout,
    onLogin: onLogin,
    STORAGE_KEY: STORAGE_KEY
  };
})();
