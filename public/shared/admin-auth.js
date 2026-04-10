/* CoachCarter Admin Auth Utilities
 *
 * Mirror of learner-auth.js / instructor-auth.js for the admin + superadmin
 * pages. Session JWT lives in the httpOnly cc_admin cookie. Admin pages
 * that support instructor-admins (e.g. portal.html) may also authenticate
 * via cc_instructor when that token has isAdmin=true — the backend
 * requireAuth({ roles: ['admin'] }) accepts both.
 *
 * The display blob in localStorage under STORAGE_KEY is used for sidebar
 * greetings and the in-page redirect check. It contains no auth material.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_admin';
  var LOGIN_URL   = '/admin/login.html';
  var LOGOUT_URL  = '/api/admin?action=logout';

  function getAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function readCookie(name) {
    var match = ('; ' + (document.cookie || '')).match(
      new RegExp('; ' + name.replace(/[-.]/g, '\\$&') + '=([^;]*)')
    );
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
  }

  function getCsrfToken() {
    return readCookie('cc_csrf');
  }

  /**
   * fetch() wrapper that includes credentials (httpOnly cc_admin cookie)
   * and attaches X-CSRF-Token on mutating methods. Drop-in replacement
   * for fetch() on admin pages.
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

  function logout() {
    try {
      fetchAuthed(LOGOUT_URL, { method: 'POST', keepalive: true }).catch(function () {});
    } catch (e) { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = LOGIN_URL;
  }

  window.ccAdminAuth = {
    getAuth: getAuth,
    getCsrfToken: getCsrfToken,
    fetchAuthed: fetchAuthed,
    logout: logout,
    STORAGE_KEY: STORAGE_KEY
  };
})();
