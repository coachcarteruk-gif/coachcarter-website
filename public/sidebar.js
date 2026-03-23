(function() {
  'use strict';

  // ── Context detection ──────────────────────────────────────────
  var path = window.location.pathname;
  // Skip admin pages — they have their own sidebar
  if (path.startsWith('/admin/') || path === '/admin') return;

  var context = 'public';
  if (path.startsWith('/learner/') || path === '/learner') context = 'learner';
  else if (path.startsWith('/instructor/') || path === '/instructor') context = 'instructor';

  // ── SVG icons (24x24 viewBox, stroke-based) ────────────────────
  var icons = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    calendarPlus: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>',
    list: '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
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
    chevron: '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
    hamburger: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    close: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  // ── Nav config per context ─────────────────────────────────────
  var navItems = {
    public: [
      { icon: 'home', label: 'Home', href: '/' },
      { icon: 'tag', label: 'Pricing', href: '/learner-journey.html' },
      { icon: 'play', label: 'Free Videos', href: '/classroom.html' },
      'divider',
      { icon: 'calendar', label: 'Book a Lesson', href: '/learner/login.html?redirect=/learner/book.html' },
      { icon: 'logIn', label: 'Login', href: '/learner/login.html' },
      'divider',
      { icon: 'shield', label: 'Privacy Policy', href: '/privacy.html' },
      { icon: 'fileText', label: 'Terms', href: '/terms.html' }
    ],
    learner: [
      { icon: 'dashboard', label: 'Dashboard', href: '/learner/' },
      { icon: 'calendar', label: 'Lessons', children: [
        { icon: 'calendarPlus', label: 'Book Lessons', href: '/learner/book.html' },
        { icon: 'creditCard', label: 'Purchase Lessons', href: '/learner/buy-credits.html' },
        { icon: 'list', label: 'Upcoming Lessons', href: '/learner/lessons.html' }
      ]},
      { icon: 'clipboard', label: 'Log Session', href: '/learner/log-session.html' },
      { icon: 'shield', label: 'Mock Test', href: '/learner/mock-test.html' },
      { icon: 'dashboard', label: 'My Progress', href: '/learner/progress.html' },
      'divider',
      { icon: 'play', label: 'Videos', href: '/learner/videos.html' },
      { icon: 'message', label: 'Q&A', href: '/learner/qa.html' },
      { icon: 'clipboard', label: 'Examiner Quiz', href: '/learner/examiner-quiz.html' },
      { icon: 'message', label: 'Ask the Examiner', href: '/learner/ask-examiner.html' },
      'divider',
      { icon: 'user', label: 'My Profile', href: '/learner/profile.html', authOnly: true }
    ],
    instructor: [
      { icon: 'calendar', label: 'My Calendar', href: '/instructor/' },
      { icon: 'clock', label: 'Availability', href: '/instructor/availability.html' },
      'divider',
      { icon: 'message', label: 'Q&A', href: '/instructor/qa.html' },
      { icon: 'user', label: 'Profile', href: '/instructor/profile.html' }
    ]
  };

  // ── Determine active link ──────────────────────────────────────
  // Normalize path: strip trailing .html for comparison
  function normPath(p) {
    return p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  }
  var normCurrent = normPath(path);

  function isActive(href) {
    var hrefPath = href.split('?')[0];
    if (normCurrent === normPath(hrefPath)) return true;
    if (path === '/' && href === '/') return true;
    return false;
  }

  // ── Build nav HTML ─────────────────────────────────────────────
  function buildNavHTML() {
    var items = navItems[context] || navItems.public;
    var html = '';
    var _s; try { _s = JSON.parse(localStorage.getItem('cc_learner') || 'null'); } catch(e) {}
    var isLoggedIn = !!(_s && _s.token);
    for (var i = 0; i < items.length; i++) {
      if (items[i] === 'divider') {
        html += '<div class="cc-sb-divider"></div>';
      } else {
        var item = items[i];
        if (item.authOnly && !isLoggedIn) continue;

        // Collapsible group with children
        if (item.children) {
          var childActive = false;
          for (var c = 0; c < item.children.length; c++) {
            if (isActive(item.children[c].href)) { childActive = true; break; }
          }
          var openClass = childActive ? ' open' : '';
          html += '<div class="cc-sb-group' + openClass + '">' +
            '<button class="cc-sb-link cc-sb-group-toggle" type="button">' +
              '<span class="cc-sb-icon">' + icons[item.icon] + '</span>' +
              '<span>' + item.label + '</span>' +
              '<span class="cc-sb-chevron">' + icons.chevron + '</span>' +
            '</button>' +
            '<div class="cc-sb-group-children">';
          for (var j = 0; j < item.children.length; j++) {
            var child = item.children[j];
            if (child.authOnly && !isLoggedIn) continue;
            var cActive = isActive(child.href) ? ' active' : '';
            html += '<a href="' + child.href + '" class="cc-sb-link cc-sb-child' + cActive + '">' +
              '<span class="cc-sb-icon">' + icons[child.icon] + '</span>' +
              '<span>' + child.label + '</span></a>';
          }
          html += '</div></div>';
        } else {
          var active = isActive(item.href) ? ' active' : '';
          html += '<a href="' + item.href + '" class="cc-sb-link' + active + '">' +
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
    return '<div class="cc-sb-footer" id="cc-sb-footer">' +
      '<div class="cc-sb-user" id="cc-sb-user"></div>' +
      '<div class="cc-sb-credits" id="cc-sb-credits"></div>' +
      '<button class="cc-sb-logout" id="cc-sb-logout">' +
        '<span class="cc-sb-icon">' + icons.logOut + '</span>' +
        '<span>Sign Out</span>' +
      '</button></div>';
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
    '.cc-sb { width: 240px; background: #262626; color: #fff; display: flex; flex-direction: column;',
    '  position: fixed; top: 0; left: 0; bottom: 0; z-index: 1000; transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); }',

    /* Brand */
    '.cc-sb-brand { display: flex; align-items: center; gap: 10px; padding: 20px 20px 16px;',
    '  text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.08); }',
    '.cc-sb-brand img { height: 32px; }',
    '.cc-sb-brand-text { font-family: "Bricolage Grotesque", sans-serif; font-size: 1rem;',
    '  font-weight: 700; color: #fff; }',
    '.cc-sb-brand-text em { font-style: normal; color: #f58321; }',
    '.cc-sb-brand-sub { font-size: 0.7rem; color: #f58321; font-weight: 600; letter-spacing: 0.02em; }',

    /* Nav links */
    '.cc-sb-nav { flex: 1; padding: 12px 0; overflow-y: auto; }',
    '.cc-sb-link { display: flex; align-items: center; gap: 12px; padding: 10px 20px;',
    '  color: rgba(255,255,255,0.6); text-decoration: none; font-size: 0.88rem; font-weight: 500;',
    '  transition: all 0.15s; border-left: 3px solid transparent; font-family: "Lato", sans-serif; }',
    '.cc-sb-link:hover { color: #fff; background: #2e2e2e; }',
    '.cc-sb-link.active { color: #f58321; background: #2e2e2e; border-left-color: #f58321; }',
    '.cc-sb-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',
    '.cc-sb-icon svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;',
    '  stroke-linecap: round; stroke-linejoin: round; }',
    '.cc-sb-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 8px 20px; }',

    /* Collapsible group */
    '.cc-sb-group-toggle { width: 100%; background: none; border: none; cursor: pointer; position: relative; }',
    '.cc-sb-chevron { margin-left: auto; width: 16px; height: 16px; display: flex; align-items: center;',
    '  justify-content: center; transition: transform 0.25s ease; }',
    '.cc-sb-chevron svg { width: 14px; height: 14px; stroke: currentColor; fill: none;',
    '  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',
    '.cc-sb-group.open .cc-sb-chevron { transform: rotate(90deg); }',
    '.cc-sb-group-children { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }',
    '.cc-sb-group.open .cc-sb-group-children { max-height: 200px; }',
    '.cc-sb-child { padding-left: 36px !important; font-size: 0.82rem !important; }',
    '.cc-sb-child .cc-sb-icon { width: 16px; height: 16px; }',
    '.cc-sb-child .cc-sb-icon svg { width: 14px; height: 14px; }',
    '.cc-sb-group-toggle.cc-sb-link { color: rgba(255,255,255,0.6); }',
    '.cc-sb-group.open .cc-sb-group-toggle { color: #fff; }',

    /* Footer */
    '.cc-sb-footer { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.08); }',
    '.cc-sb-user { font-size: 0.85rem; color: rgba(255,255,255,0.8); font-weight: 600; margin-bottom: 2px; }',
    '.cc-sb-credits { font-size: 0.75rem; color: #f58321; font-weight: 600; margin-bottom: 10px; }',
    '.cc-sb-credits:empty { display: none; }',
    '.cc-sb-logout { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px;',
    '  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);',
    '  border-radius: 6px; color: rgba(255,255,255,0.6); font-size: 0.8rem; cursor: pointer;',
    '  font-family: "Lato", sans-serif; transition: all 0.15s; }',
    '.cc-sb-logout:hover { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.3); }',
    '.cc-sb-logout .cc-sb-icon { width: 16px; height: 16px; }',
    '.cc-sb-logout .cc-sb-icon svg { width: 14px; height: 14px; }',

    /* Overlay */
    '.cc-sb-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999; }',
    '.cc-sb-overlay.open { display: block; }',

    /* Mobile header */
    '.cc-mob-header { display: none; position: fixed; top: 0; left: 0; right: 0;',
    '  background: #262626; color: #fff; padding: 0 16px; height: 56px;',
    '  z-index: 998; align-items: center; gap: 12px; }',
    '.cc-mob-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; flex: 1; }',
    '.cc-mob-brand img { height: 28px; }',
    '.cc-mob-brand span { font-family: "Bricolage Grotesque", sans-serif; font-size: 0.95rem;',
    '  font-weight: 700; color: #fff; }',
    '.cc-mob-brand em { font-style: normal; color: #f58321; }',
    '.cc-hamburger { background: none; border: none; color: #fff; padding: 8px; cursor: pointer;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.cc-hamburger svg { width: 22px; height: 22px; stroke: currentColor; fill: none;',
    '  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',

    /* Close button inside sidebar (mobile) */
    '.cc-sb-close { display: none; position: absolute; top: 16px; right: 12px;',
    '  background: none; border: none; color: rgba(255,255,255,0.5); padding: 4px; cursor: pointer; }',
    '.cc-sb-close svg { width: 20px; height: 20px; stroke: currentColor; fill: none;',
    '  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',
    '.cc-sb-close:hover { color: #fff; }',

    /* Desktop layout */
    '@media (min-width: 960px) {',
    '  body.cc-has-sidebar { margin-left: 240px; }',
    '}',

    /* Mobile layout */
    '@media (max-width: 959px) {',
    '  .cc-sb { transform: translateX(-100%); width: 280px; }',
    '  .cc-sb.open { transform: translateX(0); }',
    '  .cc-sb-close { display: block; }',
    '  .cc-mob-header { display: flex; }',
    '  body.cc-has-sidebar { padding-top: 56px; }',
    '}',

    /* Reset old nav margins */
    'body.cc-has-sidebar #main,',
    'body.cc-has-sidebar main { margin-top: 0 !important; padding-top: 0 !important; }'
  ].join('\n');
  document.head.appendChild(css);

  // ── Inject HTML on DOMContentLoaded ────────────────────────────
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
          '<img src="/Logo.png" alt="CoachCarter">' +
          '<div><div class="cc-sb-brand-text">Coach<em>Carter</em></div>' +
          (contextLabel[context] ? '<div class="cc-sb-brand-sub">' + contextLabel[context] + '</div>' : '') +
          '</div></a>' +
        '<nav class="cc-sb-nav">' + buildNavHTML() + '</nav>' +
        buildFooterHTML() +
      '</aside>' +
      '<div class="cc-mob-header" id="cc-mob-header">' +
        '<button class="cc-hamburger" id="cc-hamburger" aria-label="Open menu">' + icons.hamburger + '</button>' +
        '<a href="' + brandHref + '" class="cc-mob-brand">' +
          '<img src="/Logo.png" alt="CoachCarter">' +
          '<span>Coach<em>Carter</em></span></a>' +
      '</div>';

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

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

    hamburger.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);
    closeBtn.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeSidebar();
    });

    // Close sidebar on resize to desktop
    window.addEventListener('resize', function() {
      if (window.innerWidth >= 960) closeSidebar();
    });

    // ── Collapsible group toggles ────────────────────────────────
    var toggles = document.querySelectorAll('.cc-sb-group-toggle');
    for (var t = 0; t < toggles.length; t++) {
      toggles[t].addEventListener('click', function() {
        this.parentElement.classList.toggle('open');
      });
    }

    // ── Auth-aware footer ──────────────────────────────────────
    if (context === 'learner') {
      try {
        var learner = JSON.parse(localStorage.getItem('cc_learner') || '{}');
        var userEl = document.getElementById('cc-sb-user');
        var creditsEl = document.getElementById('cc-sb-credits');
        if (userEl && learner.name) userEl.textContent = learner.name;
        if (creditsEl && typeof learner.credits !== 'undefined') {
          creditsEl.textContent = learner.credits + ' credit' + (learner.credits === 1 ? '' : 's') + ' remaining';
        }
      } catch(e) {}

      var logoutBtn = document.getElementById('cc-sb-logout');
      if (logoutBtn) logoutBtn.addEventListener('click', function() {
        localStorage.removeItem('cc_learner');
        window.location.href = '/learner/login.html';
      });
    }

    if (context === 'instructor') {
      try {
        var instructor = JSON.parse(localStorage.getItem('cc_instructor') || '{}');
        var userEl2 = document.getElementById('cc-sb-user');
        if (userEl2 && instructor.name) userEl2.textContent = instructor.name;

        // Show admin link if instructor is admin
        if (instructor.is_admin) {
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

      var logoutBtn2 = document.getElementById('cc-sb-logout');
      if (logoutBtn2) logoutBtn2.addEventListener('click', function() {
        localStorage.removeItem('cc_instructor');
        window.location.href = '/instructor/login.html';
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
