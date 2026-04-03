/* CoachCarter Instructor Auth Utilities */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_instructor';
  var LOGIN_URL   = '/instructor/login.html';

  /** Parse the stored instructor session, or return null */
  function getAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  /** Get the JWT bearer token from the stored session */
  function getToken() {
    var auth = getAuth();
    return auth && auth.token ? auth.token : null;
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

  /** Log out: clear session and redirect to login */
  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    if (window.ccBranding) window.ccBranding.clearBranding();
    window.location.href = LOGIN_URL;
  }

  // Expose globally
  window.ccAuth = {
    getAuth: getAuth,
    getToken: getToken,
    requireAuth: requireAuth,
    logout: logout,
    onLogin: onLogin,
    STORAGE_KEY: STORAGE_KEY
  };
})();
