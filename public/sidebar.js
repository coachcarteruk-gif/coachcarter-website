(function() {
  'use strict';

  // ── Context detection ──────────────────────────────────────────
  var path = window.location.pathname;
  // Skip admin pages — they have their own sidebar
  if (path.startsWith('/admin/') || path === '/admin') return;

  var context = 'public';
  if (path.startsWith('/learner/') || path === '/learner') context = 'learner';
  else if (path.startsWith('/instructor/') || path === '/instructor') context = 'instructor';

  // ── Marketing nav config + renderer ────────────────────────────
  // Marketing pages (index.html, lessons.html, learner-journey.html,
  // instructor/login.html) keep their own .site-nav + .mobile-tab-bar
  // styling. To remove duplicated <nav> markup across those files,
  // they call window.ccNav.renderMarketing(topSelector, mobileSelector)
  // and we render the same config into both placeholders.
  //
  // Single source of truth: change a marketing nav link here, not in
  // four HTML files. Per-page CSS is preserved so visual variation
  // remains possible per page if ever needed.
  // Desktop top bar: Home / Free Trial / Book / Login (CTA)
  // Mobile bottom bar: Home / Free Trial / Log in / Book (CTA, last)
  // "Pricing" → /learner-journey.html replaced with "Free Trial" 2026-04-28
  // when the 3-tier journey was hidden from public marketing. To restore the
  // Pricing link, swap label/href back to 'Pricing' / '/learner-journey.html'.
  var marketingNavConfig = {
    desktopLinks: [
      { label: 'Home', href: '/' },
      { label: 'Free Trial', href: '/free-trial.html' },
      { label: 'Book', href: '/learner/book.html' }
    ],
    desktopCta: { label: 'Login', href: '/learner/login.html' },
    mobileTabs: [
      { label: 'Home', href: '/', icon: '🏠' },
      { label: 'Free Trial', href: '/free-trial.html', icon: '🎁' },
      { label: 'Log in', href: '/learner/login.html', icon: '👤' },
      { label: 'Book', href: '/learner/book.html', icon: '📅', cta: true }
    ]
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function getStoredSession(storageKey) {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); }
    catch(e) { return null; }
  }

  function getSessionUser(session, role) {
    if (!session) return null;
    if (role === 'learner') return session.learner || session;
    if (role === 'instructor') return session.instructor || session;
    return session;
  }

  function isInstructorImpersonation(session) {
    return !!(session && session.impersonation && session.impersonation.active);
  }

  function isMarketingActive(href) {
    var hrefPath = href.split('?')[0].replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    var current = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (current === hrefPath) return true;
    if (path === '/' && href === '/') return true;
    return false;
  }

  function renderMarketingTopBar(target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    var html = '<a class="site-nav-logo" href="/">' +
      '<img src="/Logo.png" alt="CoachCarter" data-brand-logo>' +
      '<span data-brand-name>Coach<em>Carter</em></span>' +
      '</a>' +
      '<div class="site-nav-links">';
    for (var i = 0; i < marketingNavConfig.desktopLinks.length; i++) {
      var l = marketingNavConfig.desktopLinks[i];
      var active = isMarketingActive(l.href) ? ' active' : '';
      html += '<a class="site-nav-link' + active + '" href="' + escapeHtml(l.href) + '">' +
        escapeHtml(l.label) + '</a>';
    }
    html += '</div><div class="site-nav-cta">' +
      '<a class="site-nav-link primary" href="' + escapeHtml(marketingNavConfig.desktopCta.href) + '">' +
      escapeHtml(marketingNavConfig.desktopCta.label) + '</a></div>';
    el.innerHTML = html;
    el.setAttribute('role', 'navigation');
    el.setAttribute('aria-label', 'Main navigation');

    // Apply cached school branding if available
    if (window.ccBranding) {
      var cached = window.ccBranding.loadCachedBranding();
      if (cached && cached.name) {
        el.querySelectorAll('[data-brand-name]').forEach(function(n) { n.innerHTML = escapeHtml(cached.name); });
      }
      if (cached && cached.logo_url) {
        el.querySelectorAll('[data-brand-logo]').forEach(function(n) { n.src = cached.logo_url; });
      }
    }
  }

  function renderMarketingMobileBar(target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    var html = '';
    for (var i = 0; i < marketingNavConfig.mobileTabs.length; i++) {
      var t = marketingNavConfig.mobileTabs[i];
      var classes = [];
      if (isMarketingActive(t.href)) classes.push('active');
      if (t.cta) classes.push('cta');
      var clsAttr = classes.length ? ' class="' + classes.join(' ') + '"' : '';
      html += '<a href="' + escapeHtml(t.href) + '"' + clsAttr + '>' +
        '<span class="mobile-tab-icon">' + escapeHtml(t.icon || '') + '</span>' +
        escapeHtml(t.label) + '</a>';
    }
    el.innerHTML = html;
    el.setAttribute('aria-label', 'Mobile navigation');
  }

  window.ccNav = {
    marketingConfig: marketingNavConfig,
    renderMarketing: function(topSelector, mobileSelector) {
      function go() {
        if (topSelector) renderMarketingTopBar(topSelector);
        if (mobileSelector) renderMarketingMobileBar(mobileSelector);
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', go);
      } else {
        go();
      }
    }
  };

  // Auto-render marketing nav placeholders. Pages just include
  // <nav class="site-nav" id="cc-site-nav"></nav> and/or
  // <nav class="mobile-tab-bar" id="cc-mobile-tab-bar"></nav> —
  // sidebar.js fills them on load. No inline <script> needed (CSP-safe).
  function autoRenderMarketing() {
    if (document.getElementById('cc-site-nav')) {
      renderMarketingTopBar('#cc-site-nav');
    }
    if (document.getElementById('cc-mobile-tab-bar')) {
      renderMarketingMobileBar('#cc-mobile-tab-bar');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRenderMarketing);
  } else {
    autoRenderMarketing();
  }

  // Skip marketing/public pages — they keep their own .site-nav and
  // .mobile-tab-bar styling, but render contents via window.ccNav above.
  // Marketing and hub remain intentionally separate shells (see CLAUDE.md).
  if (context === 'public') return;

  // ── SVG icons (24x24 viewBox, stroke-based) ────────────────────
  var icons = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    calendarPlus: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>',
    list: '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
    message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    creditCard: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    logIn: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    fileText: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    logOut: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
    hamburger: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    close: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  // ── Nav config per context ─────────────────────────────────────
  var navItems = {
    public: [
      { icon: 'home', label: 'Home', href: '/' },
      'divider',
      { icon: 'calendar', label: 'Book a Lesson', href: '/learner/book.html' },
      { icon: 'logIn', label: 'Login', href: '/learner/login.html' }
    ],
    learner: [
      { icon: 'dashboard', label: 'Dashboard', href: '/learner/' },
      { icon: 'calendar', label: 'Lessons', href: '/learner/book.html', children: [
        { icon: 'calendarPlus', label: 'Book', href: '/learner/book.html' },
        { icon: 'list', label: 'Upcoming', href: '/learner/lessons.html', authOnly: true },
        { icon: 'shuffle', label: 'Test Swaps', href: '/learner/test-swaps.html', authOnly: true, badgeId: 'cc-test-swaps-badge' }
      ]},
      { icon: 'clipboard', label: 'Practice', href: '/learner/practice.html', children: [
        { icon: 'home', label: 'Overview', href: '/learner/practice.html' },
        { icon: 'clipboard', label: 'Log a drive', href: '/learner/log-session.html' },
        { icon: 'shield', label: 'Mock Test', href: '/learner/mock-test.html' },
        { icon: 'play', label: 'Practice Drive', href: '/learner/focused-practice.html' },
        { icon: 'dashboard', label: 'My driving plan', href: '/learner/progress.html' }
      ]},
      { icon: 'play', label: 'Learn', href: '/learner/ask-examiner.html', children: [
        { icon: 'message', label: 'Examiner AI', href: '/learner/ask-examiner.html' },
        { icon: 'clipboard', label: 'Quiz', href: '/learner/examiner-quiz.html' }
      ]},
      { icon: 'gift', label: 'Refer a friend', href: '/learner/refer.html', authOnly: true },
      { icon: 'message', label: 'Feedback', href: '#feedback', action: 'feedback', authOnly: true },
      'divider',
      { icon: 'user', label: 'My Profile', href: '/learner/profile.html', authOnly: true }
    ],
    instructor: [
      { icon: 'dashboard', label: 'Dashboard', href: '/instructor/dashboard.html' },
      { icon: 'calendar', label: 'Calendar', href: '/instructor/' },
      { icon: 'clock', label: 'Availability', href: '/instructor/availability.html' },
      { icon: 'list', label: 'My Learners', href: '/instructor/learners.html' },
      { icon: 'tag', label: 'Earnings', href: '/instructor/earnings.html' },
      'divider',
      { icon: 'user', label: 'Profile', href: '/instructor/profile.html' }
    ]
  };

  // ── Fixed bottom tab bar (mobile only) ────────────────────────
  var bottomSections = {
    learner: {
      tabs: [
        { icon: 'home', label: 'Dashboard', href: '/learner/',
          activeOn: [] },
        { icon: 'calendar', label: 'Lessons', href: '/learner/book.html',
          activeOn: ['/learner/lessons-hub', '/learner/lessons', '/learner/test-swaps'] },
        { icon: 'clipboard', label: 'Practice', href: '/learner/practice.html',
          activeOn: ['/learner/log-session', '/learner/mock-test', '/learner/focused-practice', '/learner/progress'] },
        { icon: 'play', label: 'Learn', href: '/learner/ask-examiner.html',
          activeOn: ['/learner/learn', '/learner/examiner-quiz'] },
        { icon: 'user', label: 'Profile', href: '/learner/profile.html',
          activeOn: [], authOnly: true }
      ]
    },
    instructor: {
      tabs: [
        { icon: 'dashboard', label: 'Dashboard', href: '/instructor/dashboard.html',
          activeOn: [] },
        { icon: 'calendar', label: 'Calendar', href: '/instructor/',
          activeOn: ['/instructor/availability'] },
        { icon: 'list', label: 'Learners', href: '/instructor/learners.html',
          activeOn: [] },
        { icon: 'tag', label: 'Earnings', href: '/instructor/earnings.html',
          activeOn: [] },
        { icon: 'user', label: 'Profile', href: '/instructor/profile.html',
          activeOn: [] }
      ]
    }
  };

  function getBottomTabs() {
    var config = bottomSections[context];
    return config ? config.tabs : null;
  }

  // ── Determine active link ──────────────────────────────────────
  // Normalize path: strip trailing .html for comparison
  function normPath(p) {
    return p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  }
  var normCurrent = normPath(path);

  function isActive(href, activeOn) {
    var hrefPath = href.split('?')[0];
    if (normCurrent === normPath(hrefPath)) return true;
    if (path === '/' && href === '/') return true;
    if (activeOn) {
      for (var k = 0; k < activeOn.length; k++) {
        if (normCurrent === normPath(activeOn[k])) return true;
      }
    }
    return false;
  }

  // ── Build nav HTML ─────────────────────────────────────────────
  function buildNavHTML() {
    var items = navItems[context] || navItems.public;
    var html = '';
    var _s; try { _s = JSON.parse(localStorage.getItem('cc_learner') || 'null'); } catch(e) {}
    var isLoggedIn = !!_s;
    for (var i = 0; i < items.length; i++) {
      if (items[i] === 'divider') {
        html += '<div class="cc-sb-divider"></div>';
      } else {
        var item = items[i];
        if (item.authOnly && !isLoggedIn) continue;

        // Section with children — flattened (no accordion, all visible)
        if (item.children) {
          html += '<div class="cc-sb-section">' +
            '<div class="cc-sb-section-header">' +
              '<span class="cc-sb-icon">' + icons[item.icon] + '</span>' +
              '<span>' + item.label + '</span>' +
            '</div>';
          for (var j = 0; j < item.children.length; j++) {
            var child = item.children[j];
            if (child.authOnly && !isLoggedIn) continue;
            var cActive = isActive(child.href) ? ' active' : '';
            var cBadge = child.badgeId ? '<span class="cc-sb-badge" id="' + escapeHtml(child.badgeId) + '" style="display:none"></span>' : '';
            html += '<a href="' + child.href + '" class="cc-sb-link cc-sb-child' + cActive + '">' +
              '<span class="cc-sb-icon">' + icons[child.icon] + '</span>' +
              '<span>' + child.label + '</span>' + cBadge + '</a>';
          }
          html += '</div>';
        } else {
          var active = isActive(item.href, item.activeOn) ? ' active' : '';
          var actionAttr = item.action ? ' data-cc-action="' + escapeHtml(item.action) + '"' : '';
          html += '<a href="' + item.href + '" class="cc-sb-link' + active + '"' + actionAttr + '>' +
            '<span class="cc-sb-icon">' + icons[item.icon] + '</span>' +
            '<span>' + item.label + '</span></a>';
        }
      }
    }
    return html;
  }

  // ── Build footer HTML (portal pages only) ──────────────────────
  function buildFooterHTML() {
    if (context === 'public') return '';

    // Check if user is logged in
    var storageKey = context === 'learner' ? 'cc_learner' : 'cc_instructor';
    var session = getStoredSession(storageKey);
    var isLoggedIn = !!session;
    var isSupportAccess = context === 'instructor' && isInstructorImpersonation(session);

    // Themed footer styles for the inline theme-select dropdown — defined here
    // so they pick up CSS-variable fallbacks consistently in both modes.
    var themeBlock = function(current) {
      return '<div class="cc-sb-theme">' +
        '<span class="cc-sb-theme-label">Theme</span>' +
        '<select id="cc-sb-theme-select" class="cc-sb-theme-select" aria-label="Theme">' +
          '<option value="auto"' + (current === 'auto' ? ' selected' : '') + '>Auto</option>' +
          '<option value="light"' + (current === 'light' ? ' selected' : '') + '>Light</option>' +
          '<option value="dark"' + (current === 'dark' ? ' selected' : '') + '>Dark</option>' +
        '</select>' +
      '</div>';
    };

    if (isLoggedIn) {
      var currentTheme = (window.ccDarkMode ? ccDarkMode.get() : 'auto');
      return '<div class="cc-sb-footer" id="cc-sb-footer">' +
        '<div class="cc-sb-user" id="cc-sb-user"></div>' +
        '<div class="cc-sb-credits" id="cc-sb-credits"></div>' +
        themeBlock(currentTheme) +
        '<button class="cc-sb-logout" id="cc-sb-logout">' +
          '<span class="cc-sb-icon">' + icons.logOut + '</span>' +
          '<span>' + (isSupportAccess ? 'Back to Admin' : 'Sign Out') + '</span>' +
        '</button>' +
        '<button class="cc-sb-cookie-settings" id="cc-sb-cookie-settings">' +
          '<span>Cookie Settings</span>' +
        '</button>' +
        '<a href="/" class="cc-sb-back-site">' +
          '<span>← Back to website</span>' +
        '</a></div>';
    } else {
      var currentTheme2 = (window.ccDarkMode ? ccDarkMode.get() : 'auto');
      return '<div class="cc-sb-footer" id="cc-sb-footer">' +
        themeBlock(currentTheme2) +
        '<a href="/learner/login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search) + '" class="cc-sb-login">' +
          '<span class="cc-sb-icon">' + icons.logIn + '</span>' +
          '<span>Login</span>' +
        '</a></div>';
    }
  }

  // ── Build bottom tab bar HTML (mobile) ──────────────────────────
  function buildBottomBarHTML() {
    var tabs = getBottomTabs();
    if (!tabs) return '';
    var _s; try { _s = JSON.parse(localStorage.getItem('cc_learner') || 'null'); } catch(e) {}
    var isLoggedIn = !!_s;
    var html = '<nav class="cc-bottom-bar" aria-label="Quick navigation">';
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (tab.authOnly && !isLoggedIn) continue;
      var active = isActive(tab.href, tab.activeOn) ? ' active' : '';
      html += '<a href="' + tab.href + '" class="cc-bottom-tab' + active + '">' +
        '<span class="cc-bottom-icon">' + icons[tab.icon] + '</span>' +
        '<span>' + tab.label + '</span></a>';
    }
    html += '</nav>';
    return html;
  }

  // ── Build sub-tab bar HTML (mobile, section children) ──────────
  function buildSubTabsHTML() {
    if (context !== 'learner' && context !== 'instructor') return '';
    var items = navItems[context];
    if (!items) return '';
    var _s2; try { _s2 = JSON.parse(localStorage.getItem('cc_learner') || 'null'); } catch(e) {}
    var isLoggedIn2 = !!_s2;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || !item.children) continue;
      var isInGroup = false;
      for (var j = 0; j < item.children.length; j++) {
        if (isActive(item.children[j].href, [])) { isInGroup = true; break; }
      }
      if (!isInGroup) continue;
      var html = '<div class="cc-sub-tabs">';
      for (var j = 0; j < item.children.length; j++) {
        var child = item.children[j];
        if (child.authOnly && !isLoggedIn2) continue;
        var active = isActive(child.href, []) ? ' active' : '';
        html += '<a href="' + child.href + '" class="cc-sub-tab' + active + '">' + child.label + '</a>';
      }
      html += '</div>';
      return html;
    }
    return '';
  }

  // ── Ensure viewport-fit=cover for iOS safe area ────────────────
  var vpMeta = document.querySelector('meta[name="viewport"]');
  if (vpMeta) {
    var vpContent = vpMeta.getAttribute('content') || '';
    if (vpContent.indexOf('viewport-fit') === -1) {
      vpMeta.setAttribute('content', vpContent + ', viewport-fit=cover');
    }
  }

  // ── Inject CSS ─────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    /* Hide old nav elements */
    'body.cc-has-sidebar .site-nav,',
    'body.cc-has-sidebar .nav,',
    'body.cc-has-sidebar .portal-header,',
    'body.cc-has-sidebar .bottom-nav,',
    'body.cc-has-sidebar .mobile-tab-bar,',
    'body.cc-has-sidebar .nav-dropdown,',
    'body.cc-has-sidebar .mobile-header { display: none !important; }',

    /* Sidebar */
    '.cc-sb { width: 240px; background: var(--white, #fff); color: var(--primary, #1a1a1a); display: flex; flex-direction: column;',
    '  position: fixed; top: 0; left: 0; bottom: 0; z-index: 1000; transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);',
    '  border-right: 1px solid var(--border, #e5e5e5); }',

    /* Brand */
    '.cc-sb-brand { display: flex; align-items: center; gap: 10px; padding: 20px 20px 16px;',
    '  text-decoration: none; border-bottom: 1px solid var(--border, #e5e5e5); }',
    '.cc-sb-brand img { height: 44px; }',
    '.cc-sb-brand-text { font-family: "Bricolage Grotesque", sans-serif; font-size: 1rem;',
    '  font-weight: 700; color: var(--primary, #1a1a1a); }',
    '.cc-sb-brand-text em { font-style: normal; color: var(--brand-primary, #f58321); }',
    '.cc-sb-brand-sub { font-size: 0.7rem; color: var(--brand-primary, #f58321); font-weight: 600; letter-spacing: 0.02em; }',

    /* Nav links */
    '.cc-sb-nav { flex: 1; padding: 12px 0; overflow-y: auto; }',
    '.cc-sb-link { display: flex; align-items: center; gap: 12px; padding: 10px 20px;',
    '  color: var(--muted, #6b7280); text-decoration: none; font-size: 0.88rem; font-weight: 500;',
    '  transition: all 0.15s; border-left: 3px solid transparent; font-family: "Lato", sans-serif; }',
    '.cc-sb-link:hover { color: var(--primary, #1a1a1a); background: var(--surface, #f5f5f5); }',
    '.cc-sb-link.active { color: var(--brand-primary, var(--accent, #f58321)); background: var(--accent-mid, rgba(245,131,33,0.12)); border-left-color: var(--brand-primary, var(--accent, #f58321)); }',
    '.cc-sb-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',
    '.cc-sb-icon svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;',
    '  stroke-linecap: round; stroke-linejoin: round; }',
    '.cc-sb-divider { height: 1px; background: var(--border, #e5e5e5); margin: 8px 20px; }',

    /* Flattened section (no accordion) — DL25 dossier-style section labels */
    '.cc-sb-section { margin: 4px 0 8px; }',
    '.cc-sb-section-header { display: flex; align-items: center; gap: 10px; padding: 10px 20px 6px;',
    '  font-family: "JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;',
    '  font-size: 0.62rem; font-weight: 700;',
    '  letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted, #9ca3af); }',
    '.cc-sb-section-header::before { content: ""; width: 4px; height: 4px; border-radius: 50%;',
    '  background: var(--brand-primary, var(--accent, #f58321)); flex-shrink: 0; }',
    '.cc-sb-section-header .cc-sb-icon { display: none; }',
    '.cc-sb-child { padding-left: 32px !important; font-size: 0.85rem !important; }',
    '.cc-sb-child .cc-sb-icon { width: 16px; height: 16px; }',
    '.cc-sb-child .cc-sb-icon svg { width: 14px; height: 14px; }',

    /* Footer */
    '.cc-sb-footer { padding: 16px 20px; border-top: 1px solid var(--border, #e5e5e5); }',
    '.cc-sb-user { font-size: 0.85rem; color: var(--primary, #1a1a1a); font-weight: 600; margin-bottom: 2px; }',
    '.cc-sb-credits { font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;',
    '  font-size: 0.7rem; font-weight: 700; color: var(--accent, #f58321);',
    '  letter-spacing: 0.06em; margin-bottom: 10px; font-variant-numeric: tabular-nums; }',
    '.cc-sb-credits:empty { display: none; }',
    '.cc-sb-logout { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px;',
    '  background: var(--surface, #f5f5f5); border: 1px solid var(--border, #e5e5e5);',
    '  border-radius: 6px; color: var(--muted, #6b7280); font-size: 0.8rem; cursor: pointer;',
    '  font-family: "Lato", sans-serif; transition: all 0.15s; }',
    '.cc-sb-logout:hover { background: color-mix(in srgb, var(--red, #ef4444) 10%, transparent);',
    '  color: var(--red, #ef4444); border-color: var(--red, #ef4444); }',
    '.cc-sb-logout .cc-sb-icon { width: 16px; height: 16px; }',
    '.cc-sb-logout .cc-sb-icon svg { width: 14px; height: 14px; }',

    /* Login button (shown when signed out) */
    '.cc-sb-login { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 10px;',
    '  background: var(--accent, #f58321); border: none; border-radius: 8px; color: #fff; font-size: 0.9rem;',
    '  font-weight: 700; font-family: "Bricolage Grotesque", "Lato", sans-serif; cursor: pointer;',
    '  text-decoration: none; transition: background 0.15s, transform 0.15s, box-shadow 0.2s;',
    '  letter-spacing: -0.01em;',
    '  box-shadow: 0 4px 16px rgba(245,131,33,0.25); }',
    '.cc-sb-login:hover { background: var(--accent-dk, #e07518); transform: translateY(-1px);',
    '  box-shadow: 0 6px 20px rgba(245,131,33,0.4); }',
    '.cc-sb-login .cc-sb-icon { width: 18px; height: 18px; }',
    '.cc-sb-login .cc-sb-icon svg { width: 18px; height: 18px; stroke: #fff; }',

    /* Theme picker block in footer */
    '.cc-sb-theme { display: flex; align-items: center; justify-content: space-between;',
    '  padding: 8px 10px; margin-bottom: 8px; border-radius: 8px;',
    '  background: var(--surface, #f5f5f5); border: 1px solid var(--border, #e5e5e5); }',
    '.cc-sb-theme-label { font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;',
    '  font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;',
    '  color: var(--muted, #6b7280); }',
    '.cc-sb-theme-select { background: var(--white, #fff); border: 1px solid var(--border, #e5e5e5);',
    '  border-radius: 5px; color: var(--primary, #1a1a1a); font-family: inherit;',
    '  font-size: 0.78rem; padding: 4px 8px; outline: none; cursor: pointer; }',

    /* Cookie + back-to-site links — secondary muted utility links */
    '.cc-sb-cookie-settings, .cc-sb-back-site {',
    '  display: flex; align-items: center; gap: 8px; width: 100%;',
    '  padding: 8px 12px; margin-top: 2px;',
    '  border: none; background: transparent;',
    '  color: var(--muted, #797879);',
    '  font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;',
    '  font-size: 0.62rem; font-weight: 700;',
    '  letter-spacing: 0.1em; text-transform: uppercase;',
    '  cursor: pointer; text-decoration: none;',
    '  transition: color 0.15s; }',
    '.cc-sb-cookie-settings:hover, .cc-sb-back-site:hover { color: var(--primary, #1a1a1a); }',

    /* Overlay */
    '.cc-sb-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999; }',
    '.cc-sb-overlay.open { display: block; }',

    /* Learner feedback modal */
    '.cc-feedback-overlay { display: none; position: fixed; inset: 0; z-index: 10020;',
    '  background: rgba(15,23,42,0.48); align-items: center; justify-content: center;',
    '  padding: 18px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }',
    '.cc-feedback-overlay.open { display: flex; }',
    '.cc-feedback-modal { width: min(520px, 100%); max-height: min(720px, 92dvh); overflow-y: auto;',
    '  background: var(--white, #fff); color: var(--primary, #262626); border-radius: 14px;',
    '  box-shadow: 0 24px 70px rgba(0,0,0,0.22); padding: 24px;',
    '  border: 1px solid var(--border, #e5e5e5); font-family: "Lato", sans-serif; }',
    '.cc-feedback-head { display: flex; align-items: start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }',
    '.cc-feedback-title { font-family: "Bricolage Grotesque", sans-serif; font-size: 1.18rem; font-weight: 800; margin: 0 0 4px; }',
    '.cc-feedback-sub { color: var(--muted, #797879); font-size: 0.86rem; line-height: 1.45; }',
    '.cc-feedback-close { border: 1px solid var(--border, #e5e5e5); background: var(--surface, #f7f7f7);',
    '  color: var(--muted, #797879); width: 34px; height: 34px; border-radius: 8px;',
    '  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; }',
    '.cc-feedback-close:hover { color: var(--primary, #262626); border-color: var(--brand-primary, var(--accent, #f58321)); }',
    '.cc-feedback-field { margin-bottom: 14px; }',
    '.cc-feedback-label { display: block; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.09em;',
    '  text-transform: uppercase; color: var(--muted, #797879); margin-bottom: 6px; }',
    '.cc-feedback-input, .cc-feedback-textarea { width: 100%; border: 1px solid var(--border, #e5e5e5);',
    '  background: var(--surface, #fafafa); border-radius: 8px; padding: 11px 12px;',
    '  color: var(--primary, #262626); font: inherit; font-size: 0.92rem; outline: none; }',
    '.cc-feedback-input:focus, .cc-feedback-textarea:focus { border-color: var(--brand-primary, var(--accent, #f58321)); background: var(--white, #fff); }',
    '.cc-feedback-textarea { min-height: 132px; resize: vertical; line-height: 1.45; }',
    '.cc-feedback-type { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }',
    '.cc-feedback-type label { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border, #e5e5e5);',
    '  border-radius: 8px; padding: 10px 12px; cursor: pointer; font-size: 0.9rem; font-weight: 700;',
    '  background: var(--white, #fff); }',
    '.cc-feedback-type input { accent-color: var(--brand-primary, var(--accent, #f58321)); }',
    '.cc-feedback-actions { display: flex; justify-content: flex-end; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }',
    '.cc-feedback-status { flex: 1; min-width: 180px; color: var(--muted, #797879); font-size: 0.84rem; }',
    '.cc-feedback-status.error { color: var(--red, #ef4444); }',
    '.cc-feedback-status.success { color: var(--green, #22c55e); }',
    '.cc-feedback-btn { border: 1px solid var(--border, #e5e5e5); background: var(--white, #fff);',
    '  color: var(--primary, #262626); border-radius: 8px; padding: 10px 14px; font: inherit;',
    '  font-size: 0.88rem; font-weight: 800; cursor: pointer; }',
    '.cc-feedback-btn:hover { border-color: var(--brand-primary, var(--accent, #f58321)); color: var(--brand-primary, var(--accent, #f58321)); }',
    '.cc-feedback-btn.primary { background: var(--brand-primary, var(--accent, #f58321)); color: #fff; border-color: var(--brand-primary, var(--accent, #f58321)); }',
    '.cc-feedback-btn.primary:hover { background: var(--accent-dk, #e07518); border-color: var(--accent-dk, #e07518); color: #fff; }',
    '.cc-feedback-btn:disabled { opacity: 0.65; cursor: wait; }',

    /* Mobile header */
    '.cc-mob-header { display: none; position: fixed; top: 0; left: 0; right: 0;',
    '  background: var(--white, #fff); color: var(--primary, #1a1a1a); padding: 0 16px; height: 56px;',
    '  z-index: 998; align-items: center; gap: 12px; border-bottom: 1px solid var(--border, #e5e5e5);',
    '  box-shadow: 0 4px 14px rgba(0,0,0,0.07); }',
    '.cc-mob-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; flex: 1; }',
    '.cc-mob-brand img { height: 36px; }',
    '.cc-mob-brand span { font-family: "Bricolage Grotesque", sans-serif; font-size: 0.95rem;',
    '  font-weight: 700; color: var(--primary, #1a1a1a); }',
    '.cc-mob-brand em { font-style: normal; color: var(--brand-primary, #f58321); }',
    '.cc-hamburger { background: none; border: none; color: var(--primary, #1a1a1a); padding: 8px; cursor: pointer;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.cc-hamburger svg { width: 22px; height: 22px; stroke: currentColor; fill: none;',
    '  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',

    /* Close button inside sidebar (mobile) */
    '.cc-sb-close { display: none; position: absolute; top: 16px; right: 12px;',
    '  background: none; border: none; color: #9ca3af; padding: 4px; cursor: pointer; }',
    '.cc-sb-close svg { width: 20px; height: 20px; stroke: currentColor; fill: none;',
    '  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',
    '.cc-sb-close:hover { color: var(--primary, #1a1a1a); }',

    /* Main content background */
    'body.cc-has-sidebar { background: var(--bg, #f5f5f5); }',

    /* Admin support access banner */
    '.cc-impersonation-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px;',
    '  position: sticky; top: 0; z-index: 996; padding: 10px 18px;',
    '  background: #111827; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.12);',
    '  font-family: "Lato", sans-serif; font-size: 0.86rem; box-sizing: border-box; }',
    '.cc-impersonation-banner strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 0.95rem; }',
    '.cc-impersonation-banner span { color: rgba(255,255,255,0.78); }',
    '.cc-impersonation-banner button { border: 1px solid rgba(255,255,255,0.26); border-radius: 6px;',
    '  background: rgba(255,255,255,0.1); color: #fff; padding: 7px 10px; cursor: pointer;',
    '  font: inherit; font-size: 0.78rem; font-weight: 700; white-space: nowrap; }',
    '.cc-impersonation-banner button:hover { background: rgba(255,255,255,0.18); }',

    /* Desktop layout */
    '@media (min-width: 960px) {',
    '  body.cc-has-sidebar { margin-left: 240px; }',
    '}',

    /* Mobile layout */
    '@media (max-width: 959px) {',
    '  .cc-sb { transform: translateX(-100%); width: 280px; padding-top: env(safe-area-inset-top, 0px); }',
    '  .cc-sb.open { transform: translateX(0); }',
    '  .cc-sb-close { display: block; }',
    '  .cc-impersonation-banner { flex-wrap: wrap; top: calc(56px + env(safe-area-inset-top, 0px)); }',
    /* Mobile header — always show on mobile */
    '  body.cc-has-sidebar .cc-mob-header { display: flex; padding-top: env(safe-area-inset-top, 0px); height: calc(56px + env(safe-area-inset-top, 0px)); }',
    '  body.cc-has-sidebar:not(.cc-has-bottom-bar) { padding-top: calc(56px + env(safe-area-inset-top, 0px)); }',
    '  body.cc-has-sidebar.cc-has-bottom-bar { padding-top: calc(56px + env(safe-area-inset-top, 0px)); }',
    /* Contained app-like layout: main fills viewport, scrolls internally */
    '  body.cc-has-sidebar.cc-has-bottom-bar {',
    '    overflow: hidden;',
    '    height: 100dvh;',
    '  }',
    '  body.cc-has-sidebar.cc-has-bottom-bar main,',
    '  body.cc-has-sidebar.cc-has-bottom-bar #main,',
    '  body.cc-has-sidebar.cc-has-bottom-bar > .page,',
    '  body.cc-has-sidebar.cc-has-bottom-bar > .chat-container {',
    '    height: calc(100dvh - 56px - 80px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));',
    '    overflow-y: auto;',
    '    -webkit-overflow-scrolling: touch;',
    '    margin-top: 0 !important;',
    /* Breathing room below the fixed mobile header — pages set their own
       horizontal/bottom padding but the shell owns the top edge. */
    '    padding-top: 20px !important;',
    '    box-sizing: border-box;',
    '  }',
    '}',

    /* Reset old nav margins */
    'body.cc-has-sidebar #main,',
    'body.cc-has-sidebar main,',
    'body.cc-has-sidebar > .page,',
    'body.cc-has-sidebar > .chat-container { margin-top: 0 !important; padding-top: 0 !important; }',

    /* Bottom tab bar (mobile only) — floating pill style */
    '.cc-bottom-bar { display: none; }',

    '@media (max-width: 959px) {',
    '  .cc-bottom-bar {',
    '    display: flex;',
    '    position: fixed;',
    '    bottom: max(12px, env(safe-area-inset-bottom));',
    '    left: 10px; right: 10px;',
    '    z-index: 997;',
    /* Translucent glass — works in both light and dark mode via color-mix */
    '    background: color-mix(in srgb, var(--white, #fff) 88%, transparent);',
    '    backdrop-filter: blur(24px) saturate(160%);',
    '    -webkit-backdrop-filter: blur(24px) saturate(160%);',
    '    border-radius: 26px;',
    '    padding: 5px;',
    '    box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);',
    '    border: 1px solid var(--border, rgba(0,0,0,0.06));',
    '    -webkit-touch-callout: none;',
    '    user-select: none;',
    '  }',
    '  .cc-bottom-tab {',
    '    flex: 1;',
    '    display: flex;',
    '    flex-direction: column;',
    '    align-items: center;',
    '    text-decoration: none;',
    '    color: var(--muted, #a0a0a0);',
    '    font-size: 0.875rem;',
    '    font-weight: 600;',
    '    gap: 3px;',
    '    padding: 8px 2px;',
    '    min-height: 50px;',
    '    justify-content: center;',
    '    transition: color 0.18s, background 0.18s, transform 0.15s;',
    '    font-family: "Lato", sans-serif;',
    '    border-radius: 20px;',
    '  }',
    '  .cc-bottom-tab:hover { color: var(--primary, #333); }',
    '  .cc-bottom-tab.active { color: var(--brand-primary, var(--accent, #f58321));',
    '    background: var(--accent-mid, rgba(245,131,33,0.14)); }',
    '  .cc-bottom-icon { display: flex; align-items: center; justify-content: center; }',
    '  .cc-bottom-icon svg {',
    '    width: 22px; height: 22px;',
    '    stroke: currentColor; fill: none;',
    '    stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round;',
    '    transition: transform 0.18s, stroke-width 0.18s;',
    '  }',
    '  .cc-bottom-tab.active .cc-bottom-icon svg {',
    '    stroke-width: 2.5;',
    '    transform: scale(1.1);',
    '  }',
    '  body.cc-has-sidebar.cc-has-bottom-bar { padding-bottom: 0; }',
    '  .cc-bottom-menu { background: none; border: none; cursor: pointer; }',
    '}',

    /* ── Card styling refresh: borders → shadows ──────────── */
    'body.cc-has-sidebar .quick-action-card,',
    'body.cc-has-sidebar .stat-pill,',
    'body.cc-has-sidebar .progress-card,',
    'body.cc-has-sidebar .profile-card,',
    'body.cc-has-sidebar .cal-sync-banner {',
    '  border: none;',
    '  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);',
    '}',

    'body.cc-has-sidebar .upcoming-card {',
    '  border: none;',
    '  border-left: 4px solid var(--accent);',
    '  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);',
    '}',
    'body.cc-has-sidebar .upcoming-card.is-today {',
    '  border-left-color: var(--green);',
    '}',

    'body.cc-has-sidebar .quick-action-card:hover,',
    'body.cc-has-sidebar .stat-pill:hover,',
    'body.cc-has-sidebar .progress-card:hover {',
    '  border: none;',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06);',
    '  transform: translateY(-2px);',
    '}',
    'body.cc-has-sidebar .upcoming-card:hover {',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06);',
    '  transform: translateY(-1px);',
    '}',

    'body.cc-has-sidebar .quick-action-card {',
    '  padding: 22px 14px;',
    '}',

    'body.cc-has-sidebar .section-title {',
    '  font-size: 0.7rem;',
    '  font-weight: 600;',
    '  letter-spacing: 0.05em;',
    '  color: #999;',
    '}',

    /* Sub-tab bar for section navigation (mobile only) — DL25 ledger style */
    '.cc-sub-tabs { display: none; }',
    '@media (max-width: 959px) {',
    '  .cc-sub-tabs {',
    '    display: flex;',
    '    gap: 22px;',
    '    padding: 4px 18px 0;',
    '    overflow-x: auto;',
    '    -webkit-overflow-scrolling: touch;',
    '    scrollbar-width: none;',
    '    background: var(--white, #fff);',
    '    border-bottom: 1px dashed var(--border, #e5e5e5);',
    '    position: sticky;',
    '    top: 56px;',
    '    z-index: 90;',
    '  }',
    '  .cc-sub-tabs::-webkit-scrollbar { display: none; }',
    '  .cc-sub-tab {',
    '    flex-shrink: 0;',
    '    position: relative;',
    '    padding: 12px 0;',
    '    background: transparent;',
    '    border: none;',
    '    border-radius: 0;',
    '    font-family: "JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;',
    '    font-size: 0.7rem;',
    '    font-weight: 700;',
    '    letter-spacing: 0.1em;',
    '    text-transform: uppercase;',
    '    text-decoration: none;',
    '    color: var(--muted, #6b7280);',
    '    white-space: nowrap;',
    '    transition: color 0.15s;',
    '  }',
    '  .cc-sub-tab::after {',
    '    content: "";',
    '    position: absolute;',
    '    left: 0; right: 0; bottom: -1px;',
    '    height: 2px;',
    '    background: transparent;',
    '    transition: background 0.2s;',
    '  }',
    '  .cc-sub-tab:hover { color: var(--primary, #1a1a1a); }',
    '  .cc-sub-tab.active {',
    '    color: var(--brand-primary, var(--accent, #f58321));',
    '  }',
    '  .cc-sub-tab.active::after {',
    '    background: var(--brand-primary, var(--accent, #f58321));',
    '  }',
    '}',

    '.cc-sb-badge {',
    '  margin-left: auto;',
    '  min-width: 20px;',
    '  height: 20px;',
    '  padding: 0 6px;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  border-radius: 999px;',
    '  background: var(--brand-primary, var(--accent, #f58321));',
    '  color: #fff;',
    '  font-size: 0.68rem;',
    '  font-weight: 800;',
    '  line-height: 1;',
    '}'
  ].join('\n');
  document.head.appendChild(css);

  function buildFeedbackModalHTML() {
    if (context !== 'learner') return '';
    return '<div class="cc-feedback-overlay" id="cc-feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="cc-feedback-title">' +
      '<div class="cc-feedback-modal">' +
        '<div class="cc-feedback-head">' +
          '<div>' +
            '<h2 class="cc-feedback-title" id="cc-feedback-title">Feedback</h2>' +
            '<div class="cc-feedback-sub">Report a problem or send an idea for the learner portal.</div>' +
          '</div>' +
          '<button type="button" class="cc-feedback-close" id="cc-feedback-close" aria-label="Close feedback">' + icons.close + '</button>' +
        '</div>' +
        '<form id="cc-feedback-form">' +
          '<div class="cc-feedback-field">' +
            '<span class="cc-feedback-label">Type</span>' +
            '<div class="cc-feedback-type">' +
              '<label><input type="radio" name="cc-feedback-type" value="issue" checked> Issue</label>' +
              '<label><input type="radio" name="cc-feedback-type" value="suggestion"> Suggestion</label>' +
            '</div>' +
          '</div>' +
          '<div class="cc-feedback-field">' +
            '<label class="cc-feedback-label" for="cc-feedback-summary">Title</label>' +
            '<input class="cc-feedback-input" id="cc-feedback-summary" maxlength="120" autocomplete="off" required placeholder="Short summary">' +
          '</div>' +
          '<div class="cc-feedback-field">' +
            '<label class="cc-feedback-label" for="cc-feedback-message">Details</label>' +
            '<textarea class="cc-feedback-textarea" id="cc-feedback-message" maxlength="2000" required placeholder="What happened, or what would make this better?"></textarea>' +
          '</div>' +
          '<div class="cc-feedback-actions">' +
            '<div class="cc-feedback-status" id="cc-feedback-status" aria-live="polite"></div>' +
            '<button type="button" class="cc-feedback-btn" id="cc-feedback-cancel">Cancel</button>' +
            '<button type="submit" class="cc-feedback-btn primary" id="cc-feedback-submit">Send</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
  }

  function setFeedbackStatus(message, type) {
    var status = document.getElementById('cc-feedback-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'cc-feedback-status' + (type ? ' ' + type : '');
  }

  // ── Inject HTML on DOMContentLoaded ────────────────────────────
  function updateTestSwapsBadge() {
    if (context !== 'learner') return;
    var badge = document.getElementById('cc-test-swaps-badge');
    if (!badge) return;
    var session = getStoredSession('cc_learner');
    if (!session) return;
    fetch('/api/test-swaps?action=notification-count', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var count = data && Number(data.count || 0);
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = 'inline-flex';
        } else {
          badge.textContent = '';
          badge.style.display = 'none';
        }
      })
      .catch(function () {});
  }

  function init() {
    document.body.classList.add('cc-has-sidebar');

    // Context label
    var contextLabel = { public: '', learner: 'Learner Hub', instructor: 'Instructor' };
    var brandHref = context === 'learner' ? '/learner/' : context === 'instructor' ? '/instructor/' : '/';

    // Build sidebar
    var sidebarHTML =
      '<div class="cc-sb-overlay" id="cc-sb-overlay"></div>' +
      '<aside class="cc-sb" id="cc-sb" role="navigation" aria-label="Main navigation">' +
        '<button class="cc-sb-close" id="cc-sb-close" aria-label="Close menu">' + icons.close + '</button>' +
        '<a href="' + brandHref + '" class="cc-sb-brand">' +
          '<img src="/Logo.png" alt="CoachCarter" data-brand-logo>' +
          '<div><div class="cc-sb-brand-text" data-brand-name>Coach<em>Carter</em></div>' +
          (contextLabel[context] ? '<div class="cc-sb-brand-sub">' + contextLabel[context] + '</div>' : '') +
          '</div></a>' +
        '<nav class="cc-sb-nav">' + buildNavHTML() + '</nav>' +
        buildFooterHTML() +
      '</aside>' +
      '<div class="cc-mob-header" id="cc-mob-header">' +
        '<button class="cc-hamburger" id="cc-hamburger" aria-label="Open menu">' + icons.hamburger + '</button>' +
        '<a href="' + brandHref + '" class="cc-mob-brand">' +
          '<img src="/Logo.png" alt="CoachCarter" data-brand-logo>' +
          '<span data-brand-name>Coach<em>Carter</em></span></a>' +
      '</div>';

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
    var feedbackModalHTML = buildFeedbackModalHTML();
    if (feedbackModalHTML) document.body.insertAdjacentHTML('beforeend', feedbackModalHTML);
    updateTestSwapsBadge();

    if (context === 'instructor') {
      var supportSession = getStoredSession('cc_instructor');
      var supportInstructor = getSessionUser(supportSession, 'instructor') || {};
      var supportMeta = supportSession && supportSession.impersonation ? supportSession.impersonation : {};
      if (isInstructorImpersonation(supportSession)) {
        var adminLabel = supportMeta.admin_email ? ' by ' + escapeHtml(supportMeta.admin_email) : '';
        var instructorLabel = supportInstructor.name || supportInstructor.email || 'this instructor';
        var banner =
          '<div class="cc-impersonation-banner" id="cc-impersonation-banner">' +
            '<div><strong>Viewing as admin</strong> <span>' + escapeHtml(instructorLabel) + adminLabel + '</span></div>' +
            '<button type="button" id="cc-impersonation-exit">Back to Admin</button>' +
          '</div>';
        var mobHeaderForBanner = document.getElementById('cc-mob-header');
        if (mobHeaderForBanner) mobHeaderForBanner.insertAdjacentHTML('afterend', banner);
      }
    }

    // ── Apply cached school branding to sidebar elements ──────────
    if (window.ccBranding) {
      var cached = window.ccBranding.loadCachedBranding();
      if (cached && cached.name) {
        document.querySelectorAll('[data-brand-name]').forEach(function(el) {
          el.textContent = cached.name;
        });
      }
      if (cached && cached.logo_url) {
        document.querySelectorAll('[data-brand-logo]').forEach(function(el) {
          el.src = cached.logo_url;
        });
      }
    }

    // ── Sub-tab bar (mobile, section children navigation) ──────────
    var subTabsHTML = buildSubTabsHTML();
    if (subTabsHTML) {
      var mobHeader = document.getElementById('cc-mob-header');
      if (mobHeader) {
        mobHeader.insertAdjacentHTML('afterend', subTabsHTML);
      }
    }

    // ── Bottom tab bar (mobile, learner/instructor context) ────────
    var bottomBarHTML = buildBottomBarHTML();
    if (bottomBarHTML) {
      document.body.insertAdjacentHTML('beforeend', bottomBarHTML);
      document.body.classList.add('cc-has-bottom-bar');
      // Prevent "Open in New Tab" context menu on bottom nav (native-app feel)
      var bottomBar = document.querySelector('.cc-bottom-bar');
      if (bottomBar) {
        bottomBar.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      }
    }

    // ── Mobile toggle behavior ─────────────────────────────────
    var sidebar = document.getElementById('cc-sb');
    var overlay = document.getElementById('cc-sb-overlay');
    var hamburger = document.getElementById('cc-hamburger');
    var closeBtn = document.getElementById('cc-sb-close');

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    function resetFeedbackForm() {
      var form = document.getElementById('cc-feedback-form');
      if (form) form.reset();
      setFeedbackStatus('', '');
      var submitBtn = document.getElementById('cc-feedback-submit');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send';
      }
    }

    function openFeedbackModal() {
      var modal = document.getElementById('cc-feedback-overlay');
      if (!modal) return;
      closeSidebar();
      resetFeedbackForm();
      modal.classList.add('open');
      setTimeout(function () {
        var input = document.getElementById('cc-feedback-summary');
        if (input) input.focus();
      }, 30);
    }

    function closeFeedbackModal() {
      var modal = document.getElementById('cc-feedback-overlay');
      if (modal) modal.classList.remove('open');
    }

    if (hamburger) hamburger.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);
    closeBtn.addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-cc-action="feedback"]').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        openFeedbackModal();
      });
    });

    var feedbackOverlay = document.getElementById('cc-feedback-overlay');
    var feedbackClose = document.getElementById('cc-feedback-close');
    var feedbackCancel = document.getElementById('cc-feedback-cancel');
    var feedbackForm = document.getElementById('cc-feedback-form');
    if (feedbackOverlay) {
      feedbackOverlay.addEventListener('click', function(e) {
        if (e.target === feedbackOverlay) closeFeedbackModal();
      });
    }
    if (feedbackClose) feedbackClose.addEventListener('click', closeFeedbackModal);
    if (feedbackCancel) feedbackCancel.addEventListener('click', closeFeedbackModal);
    if (feedbackForm) {
      feedbackForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var typeEl = document.querySelector('input[name="cc-feedback-type"]:checked');
        var titleEl = document.getElementById('cc-feedback-summary');
        var messageEl = document.getElementById('cc-feedback-message');
        var submitBtn = document.getElementById('cc-feedback-submit');
        var payload = {
          type: typeEl ? typeEl.value : 'issue',
          title: titleEl ? titleEl.value.trim() : '',
          message: messageEl ? messageEl.value.trim() : '',
          page_url: window.location.href
        };
        if (!payload.title || !payload.message) {
          setFeedbackStatus('Add a title and details before sending.', 'error');
          return;
        }
        if (!window.ccAuth || typeof window.ccAuth.fetchAuthed !== 'function') {
          setFeedbackStatus('Sign in again before sending feedback.', 'error');
          return;
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending...';
        }
        setFeedbackStatus('Sending...', '');
        window.ccAuth.fetchAuthed('/api/learner?action=submit-feedback', {
          method: 'POST',
          body: JSON.stringify(payload)
        }).then(function(res) {
          return res.json().then(function(data) {
            if (!res.ok || !data.ok) throw new Error(data.error || data.message || 'Could not send feedback.');
            setFeedbackStatus('Thanks - sent.', 'success');
            setTimeout(closeFeedbackModal, 850);
          });
        }).catch(function(err) {
          setFeedbackStatus(err.message || 'Could not send feedback.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send';
          }
        });
      });
    }

    // Theme select (previously inline onchange)
    var themeSelect = document.getElementById('cc-sb-theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        if (window.ccDarkMode) window.ccDarkMode.set(themeSelect.value);
      });
    }

    // Cookie settings button (previously inline onclick)
    var cookieBtn = document.getElementById('cc-sb-cookie-settings');
    if (cookieBtn) {
      cookieBtn.addEventListener('click', function () {
        if (window.ccCookieConsent) window.ccCookieConsent.show();
      });
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeSidebar();
    });

    // Close sidebar on resize to desktop
    window.addEventListener('resize', function() {
      if (window.innerWidth >= 960) closeSidebar();
    });

    // ── Auth-aware footer ──────────────────────────────────────
    if (context === 'learner') {
      try {
        var learner = JSON.parse(localStorage.getItem('cc_learner') || '{}');
        var userEl = document.getElementById('cc-sb-user');
        var creditsEl = document.getElementById('cc-sb-credits');
        if (userEl && learner.name) userEl.textContent = learner.name;
        if (creditsEl) {
          if (typeof learner.balance_minutes !== 'undefined') {
            var hrs = (learner.balance_minutes / 60);
            var hrsStr = hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
            creditsEl.textContent = hrsStr + ' hr' + (hrs !== 1 ? 's' : '') + ' total credit';
          } else if (typeof learner.credits !== 'undefined') {
            var fallbackHrs = (learner.credits * 1.5);
            creditsEl.textContent = fallbackHrs + ' hrs total credit';
          }
        }
      } catch(e) {}

      var logoutBtn = document.getElementById('cc-sb-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', function() {
        // Prefer window.ccAuth.logout (learner-auth.js) — it clears the
        // httpOnly session cookie on the server before redirecting.
        // Fall back to local-only clear if learner-auth.js wasn't loaded.
        if (window.ccAuth && typeof window.ccAuth.logout === 'function') {
          window.ccAuth.logout();
          return;
        }
        localStorage.removeItem('cc_learner');
        window.location.href = '/';
      });
    }

    if (context === 'instructor') {
      try {
        var instructorSession = getStoredSession('cc_instructor') || {};
        var instructor = getSessionUser(instructorSession, 'instructor') || {};
        var impersonatingInstructor = isInstructorImpersonation(instructorSession);
        var userEl2 = document.getElementById('cc-sb-user');
        if (userEl2 && instructor.name) userEl2.textContent = instructor.name;

        // Show admin link if instructor is admin
        if (instructor.is_admin && !impersonatingInstructor) {
          var nav = document.querySelector('.cc-sb-nav');
          if (nav) {
            nav.insertAdjacentHTML('beforeend',
              '<div class="cc-sb-divider"></div>' +
              '<a href="/admin/portal.html" class="cc-sb-link">' +
                '<span class="cc-sb-icon">' + icons.settings + '</span>' +
                '<span>Admin</span></a>');
          }
        }
      } catch(e) {}

      var exitSupportBtn = document.getElementById('cc-impersonation-exit');
      if (exitSupportBtn) exitSupportBtn.addEventListener('click', function() {
        if (window.ccAuth && typeof window.ccAuth.logout === 'function') {
          window.ccAuth.logout();
          return;
        }
        localStorage.removeItem('cc_instructor');
        window.location.href = '/admin/portal.html';
      });

      var logoutBtn2 = document.getElementById('cc-sb-logout');
      if (logoutBtn2) logoutBtn2.addEventListener('click', function() {
        if (window.ccAuth && typeof window.ccAuth.logout === 'function') {
          window.ccAuth.logout();
          return;
        }
        localStorage.removeItem('cc_instructor');
        window.location.href = '/';
      });
    }
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
