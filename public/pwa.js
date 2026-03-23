// ── PWA: Service Worker Registration + Install Prompt ────────────────────────
(function() {
  'use strict';

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').then(function(reg) {
        // Check for updates periodically
        setInterval(function() { reg.update(); }, 60 * 60 * 1000); // every hour
      }).catch(function(err) {
        console.warn('SW registration failed:', err);
      });
    });
  }

  // ── Install prompt ──────────────────────────────────────────────────────────
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;

    // Don't show if dismissed recently
    var dismissed = localStorage.getItem('cc_pwa_dismissed');
    if (dismissed) {
      var dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return; // 7 days
    }

    // Don't show if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    showInstallBanner();
  });

  function showInstallBanner() {
    // Check if banner already exists
    if (document.getElementById('cc-install-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'cc-install-banner';
    banner.innerHTML =
      '<div class="cc-install-inner">' +
        '<img src="/Logo.png" alt="" class="cc-install-logo">' +
        '<div class="cc-install-text">' +
          '<strong>Add CoachCarter to your home screen</strong>' +
          '<span>Quick access to your lessons and progress</span>' +
        '</div>' +
        '<button class="cc-install-btn" id="cc-install-yes">Install</button>' +
        '<button class="cc-install-close" id="cc-install-no" aria-label="Dismiss">&times;</button>' +
      '</div>';

    // Inject styles
    var style = document.createElement('style');
    style.textContent = [
      '#cc-install-banner {',
      '  position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;',
      '  background: #262626; color: #fff; padding: 12px 16px;',
      '  transform: translateY(100%); animation: cc-slide-up 0.4s 0.5s forwards;',
      '  box-shadow: 0 -4px 20px rgba(0,0,0,0.2);',
      '}',
      '@keyframes cc-slide-up { to { transform: translateY(0); } }',
      '.cc-install-inner {',
      '  max-width: 720px; margin: 0 auto; display: flex;',
      '  align-items: center; gap: 12px;',
      '}',
      '.cc-install-logo { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; }',
      '.cc-install-text { flex: 1; min-width: 0; }',
      '.cc-install-text strong { display: block; font-size: 0.88rem; font-weight: 700; }',
      '.cc-install-text span { display: block; font-size: 0.75rem; color: rgba(255,255,255,0.6); }',
      '.cc-install-btn {',
      '  background: #f58321; color: #fff; border: none; border-radius: 100px;',
      '  padding: 10px 20px; font-weight: 700; font-size: 0.85rem; cursor: pointer;',
      '  white-space: nowrap; transition: background 0.18s; flex-shrink: 0;',
      '}',
      '.cc-install-btn:hover { background: #e07518; }',
      '.cc-install-close {',
      '  background: none; border: none; color: rgba(255,255,255,0.4);',
      '  font-size: 1.4rem; cursor: pointer; padding: 4px 8px; flex-shrink: 0;',
      '}',
      '.cc-install-close:hover { color: #fff; }',
      '@media (min-width: 960px) {',
      '  #cc-install-banner { left: 240px; }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
    document.body.appendChild(banner);

    document.getElementById('cc-install-yes').addEventListener('click', function() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(result) {
          if (result.outcome === 'accepted' && typeof posthog !== 'undefined') {
            posthog.capture('pwa_installed');
          }
          deferredPrompt = null;
          dismissBanner();
        });
      }
    });

    document.getElementById('cc-install-no').addEventListener('click', function() {
      localStorage.setItem('cc_pwa_dismissed', String(Date.now()));
      dismissBanner();
      if (typeof posthog !== 'undefined') {
        posthog.capture('pwa_install_dismissed');
      }
    });
  }

  function dismissBanner() {
    var banner = document.getElementById('cc-install-banner');
    if (banner) {
      banner.style.animation = 'none';
      banner.style.transform = 'translateY(100%)';
      banner.style.transition = 'transform 0.3s ease';
      setTimeout(function() { banner.remove(); }, 300);
    }
  }
})();
