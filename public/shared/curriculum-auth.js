/* Auth bridge for Curriculum, which accepts either a school admin session
 * or an instructor session. Authentication remains cookie-first; localStorage
 * is used only to choose the correct display/login experience.
 */
(function () {
  'use strict';

  function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }

  function getSessionKind() {
    if (readStored('cc_admin')) return 'admin';
    if (readStored('cc_instructor')) return 'instructor';
    return null;
  }

  function fetchAuthed(url, options) {
    var kind = getSessionKind();
    if (kind === 'admin' && window.ccAdminAuth) {
      return window.ccAdminAuth.fetchAuthed(url, options);
    }
    if (window.ccAuth) return window.ccAuth.fetchAuthed(url, options);
    return fetch(url, Object.assign({ credentials: 'include' }, options || {}));
  }

  function loginUrl() {
    return getSessionKind() === 'admin' ? '/admin/login.html' : '/instructor/login.html';
  }

  window.ccCurriculumAuth = {
    fetchAuthed: fetchAuthed,
    getSessionKind: getSessionKind,
    loginUrl: loginUrl
  };
})();
