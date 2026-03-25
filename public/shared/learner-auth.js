/* CoachCarter Learner Auth Utilities */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc_learner';
  var LOGIN_URL   = '/learner/login.html';

  /** Parse the stored learner session, or return null */
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

  /** Log out: clear session and redirect to login */
  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = LOGIN_URL;
  }

  // Expose globally
  window.ccAuth = {
    getAuth: getAuth,
    getToken: getToken,
    requireAuth: requireAuth,
    logout: logout,
    STORAGE_KEY: STORAGE_KEY
  };
})();
