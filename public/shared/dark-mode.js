(function() {
  'use strict';

  var STORAGE_KEY = 'cc_dark_mode';

  function getPreference() {
    try { return localStorage.getItem(STORAGE_KEY) || 'auto'; }
    catch (e) { return 'auto'; }
  }

  function setPreference(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); }
    catch (e) { /* storage unavailable */ }
  }

  function applyTheme(mode) {
    var root = document.documentElement;
    root.classList.remove('dark-mode', 'light-mode');

    if (mode === 'dark') {
      root.classList.add('dark-mode');
    } else if (mode === 'light') {
      root.classList.add('light-mode');
    }
    // 'auto' uses neither class — CSS @media handles it

    // Update theme-color meta tag
    var isDark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = isDark ? '#1a1a1a' : '#262626';
    }
  }

  // Apply immediately on script load (before DOMContentLoaded) to prevent flash
  var pref = getPreference();
  applyTheme(pref);

  // Listen for system theme changes when in auto mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      if (getPreference() === 'auto') {
        applyTheme('auto');
      }
    });
  }

  // Public API
  window.ccDarkMode = {
    get: getPreference,
    set: function(mode) {
      if (['auto', 'light', 'dark'].indexOf(mode) === -1) return;
      setPreference(mode);
      applyTheme(mode);
    },
    apply: function() { applyTheme(getPreference()); },
    isDark: function() {
      var m = getPreference();
      if (m === 'dark') return true;
      if (m === 'light') return false;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  };
})();
