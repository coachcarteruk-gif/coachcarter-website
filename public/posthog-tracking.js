/* ─── PostHog Custom Event Tracking ─── */
(function () {
  'use strict';

  function ph() { return window.posthog; }

  /* ── 1. Button Click Tracking ── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button, a.btn-lg, a.btn-primary, a.hero-right-cta, .enquiry-submit, .quiz-opt');
    if (!btn) return;

    var text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    ph() && ph().capture('button_clicked', {
      button_text: text,
      button_tag: btn.tagName.toLowerCase(),
      button_classes: btn.className,
      page_url: window.location.pathname
    });
  });

  /* ── 2. Form Submission Tracking ── */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.tagName !== 'FORM') return;

    var formId = form.id || form.getAttribute('name') || 'unnamed_form';
    var fields = [];
    var inputs = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.type !== 'hidden' && inp.type !== 'submit' && inp.name) {
        fields.push(inp.name);
      }
    }

    ph() && ph().capture('form_submitted', {
      form_id: formId,
      form_action: form.action || window.location.pathname,
      form_fields: fields,
      field_count: fields.length,
      page_url: window.location.pathname
    });
  });

  /* ── 3. Scroll Depth Tracking ── */
  var scrollThresholds = { 25: false, 50: false, 75: false, 100: false };

  function getScrollPercent() {
    var docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    var winHeight = window.innerHeight;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (docHeight <= winHeight) return 100;
    return Math.round((scrollTop / (docHeight - winHeight)) * 100);
  }

  function checkScroll() {
    var pct = getScrollPercent();
    var thresholds = [25, 50, 75, 100];
    for (var i = 0; i < thresholds.length; i++) {
      var t = thresholds[i];
      if (pct >= t && !scrollThresholds[t]) {
        scrollThresholds[t] = true;
        ph() && ph().capture('scroll_depth_reached', {
          depth_percent: t,
          page_url: window.location.pathname,
          page_title: document.title
        });
      }
    }
  }

  var scrollTimer;
  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(checkScroll, 150);
  }, { passive: true });

  // Check once on load for short pages
  window.addEventListener('load', function () {
    setTimeout(checkScroll, 500);
  });

  /* ── 4. Time on Page Tracking ── */
  var pageEnteredAt = Date.now();
  var engaged = true;

  // Track when user leaves/hides the tab
  document.addEventListener('visibilitychange', function () {
    engaged = !document.hidden;
  });

  function sendTimeOnPage() {
    var totalSeconds = Math.round((Date.now() - pageEnteredAt) / 1000);
    if (totalSeconds < 2) return; // ignore bounces under 2s
    ph() && ph().capture('page_time_spent', {
      seconds: totalSeconds,
      page_url: window.location.pathname,
      page_title: document.title
    });
  }

  // Fire on page unload (visibilitychange is more reliable than beforeunload)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendTimeOnPage();
  });
  // Fallback for older browsers
  window.addEventListener('beforeunload', sendTimeOnPage);

  /* ── 5. Outbound Link Click Tracking ── */
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;

    var href = link.getAttribute('href') || '';
    var isExternal = /^https?:\/\//i.test(href) &&
      !href.includes(window.location.hostname) &&
      !href.includes('localhost');

    if (!isExternal) return;

    ph() && ph().capture('outbound_link_clicked', {
      link_url: href,
      link_text: (link.textContent || '').replace(/\s+/g, ' ').trim(),
      page_url: window.location.pathname
    });
  });
})();
