(function() {
  'use strict';

  var CACHE_KEY = 'cc_school_branding';

  /** Apply branding to DOM */
  function applyBranding(branding) {
    if (!branding) return;

    var root = document.documentElement;
    if (branding.primary_colour) root.style.setProperty('--brand-primary', branding.primary_colour);
    if (branding.secondary_colour) root.style.setProperty('--brand-secondary', branding.secondary_colour);
    if (branding.accent_colour) root.style.setProperty('--brand-accent', branding.accent_colour);

    // Update elements with data-brand attributes
    document.querySelectorAll('[data-brand-name]').forEach(function(el) {
      if (branding.name) el.textContent = branding.name;
    });
    document.querySelectorAll('[data-brand-logo]').forEach(function(el) {
      if (branding.logo_url) el.src = branding.logo_url;
    });
  }

  /** Fetch branding from API and cache */
  async function fetchAndCacheBranding(schoolId) {
    if (!schoolId) return null;
    try {
      var res = await fetch('/api/schools?action=branding&school_id=' + schoolId);
      var data = await res.json();
      if (data.ok && data.school) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data.school));
        applyBranding(data.school);
        return data.school;
      }
    } catch (err) {
      console.warn('Failed to fetch school branding:', err);
    }
    return null;
  }

  /** Load cached branding on page load */
  function loadCachedBranding() {
    try {
      var cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        var branding = JSON.parse(cached);
        applyBranding(branding);
        return branding;
      }
    } catch (e) { /* ignore parse errors */ }
    return null;
  }

  /** Clear branding from DOM and cache */
  function clearBranding() {
    localStorage.removeItem(CACHE_KEY);
    var root = document.documentElement;
    root.style.removeProperty('--brand-primary');
    root.style.removeProperty('--brand-secondary');
    root.style.removeProperty('--brand-accent');
  }

  // Auto-apply on load
  loadCachedBranding();

  // Export
  window.ccBranding = {
    applyBranding: applyBranding,
    fetchAndCacheBranding: fetchAndCacheBranding,
    loadCachedBranding: loadCachedBranding,
    clearBranding: clearBranding
  };
})();
