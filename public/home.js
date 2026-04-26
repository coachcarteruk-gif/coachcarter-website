(function () {
  'use strict';

  // ── SCROLL ANIMATIONS ────────────────────────────────────
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

  // ── SHORTCUT BAR (warm-traffic fast-path) ────────────────
  const SHORTCUT_DISMISSED_KEY = 'cc_shortcut_dismissed';
  const bar = document.getElementById('shortcutBar');
  const dismiss = document.getElementById('shortcutDismiss');

  if (bar && !localStorage.getItem(SHORTCUT_DISMISSED_KEY)) {
    bar.hidden = false;
    document.body.classList.add('has-shortcut');
  }

  if (dismiss) {
    dismiss.addEventListener('click', () => {
      bar.hidden = true;
      document.body.classList.remove('has-shortcut');
      try { localStorage.setItem(SHORTCUT_DISMISSED_KEY, '1'); } catch (e) {}
    });
  }

  // ── NAV SCROLL EFFECT ────────────────────────────────────
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      nav.style.background = scrollY > 100
        ? 'rgba(38, 38, 38, 0.97)'
        : 'rgba(38, 38, 38, 0.92)';
    }, { passive: true });
  }
})();
