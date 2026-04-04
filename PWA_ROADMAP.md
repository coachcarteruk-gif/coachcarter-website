# PWA Enhancement Roadmap

> Generated: 2026-04-04
> Framework: Vanilla HTML/JS (static site on Vercel with serverless API routes)
> Deployed URL: https://coachcarter.uk
> Lighthouse Scores (Mobile): Performance 90 | Accessibility 96 | Best Practices 96 | SEO 100
> Lighthouse Scores (Desktop): Performance ~99 | (same accessibility/BP/SEO)
> Note: Lighthouse v12+ removed the dedicated PWA category. PWA audits checked via code analysis.

## How to Use This File

This roadmap is both a report and an instruction set. Each item includes:
- **What's wrong** and **why it matters** (so you understand the impact)
- **How to fix it** with specific, framework-aware code (so you or a Claude session can execute it directly)
- A checkbox to track completion

Work through items top-to-bottom within each priority tier. Check off items as you complete them.

---

## Critical Issues

These problems significantly hurt the user experience, prevent installation, or break core PWA functionality. Fix these first.

- [x] **Render-blocking Google Fonts request delays FCP by ~2 seconds on mobile**
  - **What's wrong:** The page loads Google Fonts via a render-blocking `<link>` tag in the `<head>`. On mobile (simulated 4G), this adds an estimated 1,950ms to First Contentful Paint. The font CSS file (`fonts.googleapis.com/css2?...`) blocks rendering until it downloads, parses, and all referenced font files begin loading.
  - **Why it matters:** FCP is 2.9s on mobile — well above the 1.8s "good" threshold. Google Fonts is the single biggest contributor. Users on slower connections see a blank or FOUT screen for nearly 3 seconds. This directly affects perceived performance and bounce rates.
  - **How to fix:**
    1. Change the Google Fonts `<link>` from render-blocking to non-blocking by using `media="print"` with an `onload` swap:
    ```html
    <!-- Replace this in ALL HTML files (42+ files): -->
    <!-- OLD: -->
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=Lato:ital,wght@0,300;0,400;0,700;1,300&display=swap" rel="stylesheet">

    <!-- NEW: -->
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=Lato:ital,wght@0,300;0,400;0,700;1,300&display=swap">
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=Lato:ital,wght@0,300;0,400;0,700;1,300&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
    <noscript><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700;12..96,800&family=Lato:ital,wght@0,300;0,400;0,700;1,300&display=swap" rel="stylesheet"></noscript>
    ```
    2. Keep the existing `<link rel="preconnect">` tags — they're already correct.
    3. Add a system font fallback stack in CSS so text is visible immediately:
    ```css
    /* In every CSS file that sets font-family for body or headings, add fallbacks: */
    body { font-family: 'Lato', system-ui, -apple-system, sans-serif; }
    h1, h2, h3 { font-family: 'Bricolage Grotesque', system-ui, -apple-system, sans-serif; }
    ```
    4. Optionally, add `font-display: swap` is already handled by the `&display=swap` URL parameter — verify it's present in all font URLs.
  - **Files to modify:** All HTML files in `public/` that contain the Google Fonts link (42+ files). Search for `fonts.googleapis.com/css2` to find them all.

- [x] **Manifest missing `id` field — risks losing installed app identity**
  - **What's wrong:** The `manifest.json` does not include an `id` field. Without it, browsers use `start_url` as the app identifier. If `start_url` ever changes (e.g., adding query params for tracking, or a path restructure), the browser will treat it as a different app — users lose their installed PWA and have to reinstall.
  - **Why it matters:** The `id` field is the stable, permanent identifier for your PWA. It decouples the app's identity from its URL structure. Chrome, Edge, and Samsung Internet all use this field. Without it, any future `start_url` change silently breaks existing installations.
  - **How to fix:** Add `"id": "/"` to `manifest.json`. This should match your current `start_url` value so existing installations are recognized:
    ```json
    {
      "id": "/",
      "name": "CoachCarter Driving School",
      "short_name": "CoachCarter",
      ...
    }
    ```
    Place it as the first field for readability.
  - **Files to modify:** `public/manifest.json`

## Important Improvements

These will meaningfully improve the PWA experience but aren't blocking core functionality.

- [x] **Manifest missing `screenshots` — degrades install experience**
  - **What's wrong:** The manifest has no `screenshots` array. On Android (Chrome 90+), providing screenshots triggers the "richer install UI" — an app-store-style bottom sheet with screenshots, description, and ratings instead of the small info bar.
  - **Why it matters:** The richer install UI has significantly higher conversion rates. Without screenshots, users see a minimal install prompt that doesn't convey the app's value. This is a missed opportunity given you already have a well-implemented custom install banner.
  - **How to fix:**
    1. Take 2-3 screenshots of the app (dashboard, booking page, progress page) at these sizes:
       - Mobile: 1080x1920 (portrait, 9:16 ratio)
       - Desktop: 1920x1080 (landscape, 16:9 ratio)
    2. Save them as PNGs in `public/icons/` (e.g., `screenshot-mobile-1.png`, `screenshot-desktop-1.png`)
    3. Add to `manifest.json`:
    ```json
    "screenshots": [
      {
        "src": "/icons/screenshot-mobile-1.png",
        "sizes": "1080x1920",
        "type": "image/png",
        "form_factor": "narrow",
        "label": "Track your driving progress and book lessons"
      },
      {
        "src": "/icons/screenshot-mobile-2.png",
        "sizes": "1080x1920",
        "type": "image/png",
        "form_factor": "narrow",
        "label": "Book available lesson slots instantly"
      },
      {
        "src": "/icons/screenshot-desktop-1.png",
        "sizes": "1920x1080",
        "type": "image/png",
        "form_factor": "wide",
        "label": "Full dashboard view with lesson history"
      }
    ]
    ```
  - **Files to modify:** `public/manifest.json`, create new screenshot images in `public/icons/`

- [x] **Manifest missing `shortcuts` — no quick actions from home screen**
  - **What's wrong:** The manifest has no `shortcuts` array. Users who long-press the app icon see no quick actions.
  - **Why it matters:** Shortcuts let learners jump directly to high-value actions (book a lesson, view upcoming lessons) without navigating through the app. This is a native-app pattern that PWAs support but this app doesn't use.
  - **How to fix:** Add shortcuts to `manifest.json`:
    ```json
    "shortcuts": [
      {
        "name": "Book a Lesson",
        "short_name": "Book",
        "url": "/learner/book.html",
        "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }]
      },
      {
        "name": "My Progress",
        "short_name": "Progress",
        "url": "/learner/progress.html",
        "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }]
      },
      {
        "name": "Practice Log",
        "short_name": "Practice",
        "url": "/learner/log-session.html",
        "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }]
      }
    ]
    ```
    Ideally, create distinct 192x192 icons for each shortcut (e.g., a calendar icon for "Book", a chart icon for "Progress"). But using the main app icon works as a starting point.
  - **Files to modify:** `public/manifest.json`

- [x] **No `overscroll-behavior` — rubber-banding and pull-to-refresh break app feel**
  - **What's wrong:** No CSS files set `overscroll-behavior`. In standalone mode on iOS/Android, this means:
    - Scrolling past the top/bottom of the page causes rubber-banding (bounce effect)
    - Pull-to-refresh gesture is active, which reloads the whole app — jarring in an app context
    - Scroll chaining: scrolling inside a modal or sidebar can inadvertently scroll the body behind it
  - **Why it matters:** These are telltale signs that distinguish a "website" from an "app." Native apps don't rubber-band or pull-to-refresh. Fixing this is a single CSS property with outsized UX impact.
  - **How to fix:** Add to the shared CSS files that set body styles:
    ```css
    /* In public/shared/learner.css and public/shared/instructor.css, add to the body rule: */
    body {
      overscroll-behavior: none;
    }
    ```
    If there are scroll containers (modals, sidebars) that need independent scroll behavior, use `overscroll-behavior: contain` on those containers instead.
  - **Files to modify:** `public/shared/learner.css`, `public/shared/instructor.css`, and any other shared CSS files that style `body`

- [x] **No Content Security Policy header — XSS protection gap**
  - **What's wrong:** The `middleware.js` sets HSTS, X-Frame-Options, and other security headers, but does not set a `Content-Security-Policy` header. This means the browser has no restrictions on what scripts, styles, or connections the page can load.
  - **Why it matters:** CSP is the strongest browser-side defense against XSS attacks. Without it, if an attacker finds an injection point, they can load arbitrary scripts from any domain. The existing headers (X-Content-Type-Options, X-Frame-Options) protect against other attack vectors but don't address inline script injection.
  - **How to fix:** Add a CSP header to the `addSecurityHeaders()` function in `middleware.js`. Start with a report-only policy to catch issues, then enforce:
    ```javascript
    // In middleware.js, inside addSecurityHeaders():
    response.headers.set('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://js.stripe.com https://us.i.posthog.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https: blob:; " +
      "connect-src 'self' https://api.stripe.com https://us.i.posthog.com https://*.posthog.com https://api.postcodes.io https://api.openrouteservice.org; " +
      "frame-src https://js.stripe.com https://hooks.stripe.com; " +
      "object-src 'none'; " +
      "base-uri 'self'"
    );
    ```
    **Important:** Start with `Content-Security-Policy-Report-Only` instead of `Content-Security-Policy` to test without breaking anything. Monitor browser console for violations for a week, then switch to enforcing mode.
    **Note:** `'unsafe-inline'` for scripts is needed because the site uses inline `onclick` handlers and `<script>` blocks. A future improvement would be to move to external scripts and use nonces, but that's a larger refactor.
  - **Files to modify:** `middleware.js`

- [x] **Service worker uses `skipWaiting()` in install — can cause runtime inconsistencies**
  - **What's wrong:** In `sw.js`, the install handler calls `self.skipWaiting()` unconditionally. This means when a new service worker version is deployed, it immediately takes over from the old one — even if the user has open tabs running code that expects the old cached assets.
  - **Why it matters:** If you deploy a new version that changes HTML structure or JS API contracts, the new service worker's cache may serve assets that conflict with the still-loaded old page. This can cause subtle bugs: broken event handlers, mismatched CSS, or JS errors. The risk increases as the app grows more complex.
  - **How to fix:** Instead of auto-skipping, implement a navigation-triggered update pattern:
    ```javascript
    // sw.js — remove skipWaiting from install:
    self.addEventListener('install', (event) => {
      event.waitUntil(
        caches.open(CACHE_NAME)
          .then(cache => cache.addAll(SHELL_ASSETS))
        // Removed: .then(() => self.skipWaiting())
      );
    });

    // sw.js — add message listener for controlled skipWaiting:
    self.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
      }
    });
    ```

    ```javascript
    // pwa.js — add update detection and prompt:
    navigator.serviceWorker.register('/sw.js').then(function(reg) {
      // Check for updates periodically
      setInterval(function() { reg.update(); }, 60 * 60 * 1000);

      // Detect when a new SW is waiting
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available — show update prompt
            showUpdateBanner(reg);
          }
        });
      });
    });

    // Reload when new SW takes over
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    function showUpdateBanner(reg) {
      var banner = document.createElement('div');
      banner.id = 'cc-update-banner';
      banner.innerHTML =
        '<div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#262626;color:#fff;padding:12px 16px;text-align:center;">' +
          'A new version is available. ' +
          '<button onclick="this.parentElement.parentElement.remove();navigator.serviceWorker.controller && reg.waiting.postMessage({type:\'SKIP_WAITING\'})" ' +
          'style="background:#f58321;color:#fff;border:none;border-radius:100px;padding:8px 16px;font-weight:700;cursor:pointer;margin-left:8px;">Update</button>' +
        '</div>';
      document.body.appendChild(banner);
    }
    ```
    **Note:** This is a medium-complexity change. If you prefer simplicity and accept the small risk of version mismatches, the current `skipWaiting()` approach is functional — just be aware of it during deployments that change cached asset structures.
  - **Files to modify:** `public/sw.js`, `public/pwa.js`

- [x] **No cache size limits or expiration — unbounded cache growth**
  - **What's wrong:** The service worker caches every static asset and HTML page that's fetched, with no maximum size limit or expiration policy. The stale-while-revalidate strategy for static assets keeps adding to the cache indefinitely.
  - **Why it matters:** On devices with limited storage (older phones, tablets), the cache will grow without bound as users navigate through the app. Eventually this can trigger browser storage pressure, which may evict important cached data (including the app shell). Without `navigator.storage.persist()`, the browser can silently clear the entire cache.
  - **How to fix:** Add cache size management to `sw.js`:
    ```javascript
    // Add after the SHELL_ASSETS array:
    const MAX_CACHE_ITEMS = 100; // Limit runtime-cached items

    // Add this helper function:
    async function trimCache(cacheName, maxItems) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      if (keys.length > maxItems) {
        // Delete oldest entries (first in = first out)
        await cache.delete(keys[0]);
        return trimCache(cacheName, maxItems); // Recurse until under limit
      }
    }

    // In the activate event, after cleaning old caches:
    self.addEventListener('activate', (event) => {
      event.waitUntil(
        caches.keys().then(keys =>
          Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
        .then(() => trimCache(CACHE_NAME, MAX_CACHE_ITEMS))
        .then(() => self.clients.claim())
      );
    });
    ```
    Also request persistent storage in `pwa.js`:
    ```javascript
    // In pwa.js, after SW registration:
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function(granted) {
        if (granted) console.log('Storage will not be evicted');
      });
    }
    ```
  - **Files to modify:** `public/sw.js`, `public/pwa.js`

## Nice-to-Have Enhancements

Polish items that take the app from good to great. Address these after critical and important items are done.

- [ ] **No dark mode support — ignores user system preference**
  - **What's wrong:** No CSS uses the `prefers-color-scheme` media query. The app is always light-themed regardless of system settings.
  - **Why it matters:** Many mobile users use dark mode, especially in the evening. A PWA that ignores this preference feels less integrated with the device. It also causes eye strain for dark-mode users. However, implementing dark mode across 40+ HTML files with inline styles is a significant effort — this is correctly categorized as nice-to-have.
  - **How to fix:** This is a larger project. The recommended approach:
    1. Define CSS custom properties for all colours in the shared CSS files
    2. Add a `@media (prefers-color-scheme: dark)` block that overrides those variables
    3. Add a manual toggle in the user profile that sets a class on `<html>`
    4. Update the `<meta name="theme-color">` dynamically for dark mode
    This should be done as a standalone feature, not mixed with other changes.
  - **Files to modify:** `public/shared/learner.css`, `public/shared/instructor.css`, all HTML files with inline `<style>` blocks (significant effort)

- [x] **No `system-ui` font fallback — flash of unstyled text on slow connections**
  - **What's wrong:** The CSS uses `'Lato', sans-serif` and `'Bricolage Grotesque', sans-serif` without `system-ui` in the fallback chain. On slow connections, before Google Fonts load, users see the generic `sans-serif` fallback which varies by browser and doesn't match the platform's native look.
  - **Why it matters:** Adding `system-ui` to the fallback chain means the initial text render (before fonts load) matches the device's native font — San Francisco on iOS, Roboto on Android, Segoe UI on Windows. This makes the flash of fallback text feel intentional rather than broken.
  - **How to fix:** Update font stacks across all CSS:
    ```css
    body { font-family: 'Lato', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    h1, h2, h3 { font-family: 'Bricolage Grotesque', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    ```
  - **Files to modify:** All CSS files and inline `<style>` blocks that set `font-family`

- [x] **No skeleton/shimmer loading states — pages show blank then content**
  - **What's wrong:** Most pages show a blank area or a simple "Loading..." text while fetching data from APIs. There are no skeleton screens that match the layout of the content that will appear.
  - **Why it matters:** Skeleton screens reduce perceived load time by showing the shape of content before data arrives. Users feel the app is faster even if the actual load time is the same. Native apps universally use this pattern.
  - **How to fix:** Add a reusable skeleton CSS class and use it in the key data-loading pages:
    ```css
    /* Add to shared CSS: */
    .skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s ease-in-out infinite;
      border-radius: 8px;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .skeleton-text { height: 1em; margin-bottom: 0.5em; }
    .skeleton-card { height: 80px; margin-bottom: 12px; }
    ```
    Then in pages like `learner/index.html` (dashboard), render skeleton cards in the container before the API fetch completes, and replace them with real content on success.
  - **Files to modify:** `public/shared/learner.css`, `public/learner/index.html`, `public/learner/book.html`, `public/learner/progress.html`

- [ ] **Accessibility: insufficient colour contrast on some elements**
  - **What's wrong:** Lighthouse flags that some background/foreground colour combinations don't meet WCAG 2.1 AA contrast requirements (4.5:1 for normal text, 3:1 for large text).
  - **Why it matters:** Users with low vision or in bright sunlight may struggle to read low-contrast text. Accessibility is both a legal requirement in many jurisdictions and essential for inclusive design.
  - **How to fix:** Run the Lighthouse accessibility audit to identify the specific elements. Common culprits are light grey text on white backgrounds, or orange text (#f58321) on light backgrounds. Darken the text or increase the background contrast. Use a contrast checker tool to verify ratios.
  - **Files to modify:** Varies — check Lighthouse report for specific elements

- [ ] **Image aspect ratio issues flagged by Lighthouse**
  - **What's wrong:** Lighthouse reports images displayed with incorrect aspect ratios — the rendered dimensions don't match the image's natural dimensions, causing visual distortion.
  - **Why it matters:** Stretched or squished images look unprofessional and can break layout on different screen sizes.
  - **How to fix:** Add `object-fit: cover` or `object-fit: contain` to image containers, and ensure `width`/`height` attributes are set on `<img>` tags to reserve layout space and prevent CLS.
  - **Files to modify:** Check Lighthouse report for specific images

- [ ] **No Background Sync for offline form submissions**
  - **What's wrong:** When offline, form submissions (booking, practice log entries) simply fail. There's no queueing mechanism to retry when connectivity returns.
  - **Why it matters:** For a driving school app, learners may want to log practice sessions in areas with poor signal (rural roads). Background Sync would queue the request and send it when connectivity returns, even if the app is closed.
  - **How to fix:** This is a medium-effort feature:
    1. In the page JS, when a POST fails due to network error, store the request in IndexedDB
    2. Register a Background Sync event: `navigator.serviceWorker.ready.then(reg => reg.sync.register('sync-practice-log'))`
    3. In `sw.js`, handle the sync event: read queued requests from IndexedDB and replay them
    This requires careful handling of auth tokens (they may expire while queued).
  - **Files to modify:** `public/sw.js`, `public/learner/log-session.html`, potentially `public/learner/book.html`

- [ ] **No Share Target in manifest — app can't receive shared content**
  - **What's wrong:** The manifest doesn't define a `share_target`. The app can share content (via Web Share API on the examiner quiz page) but can't receive shared content from other apps.
  - **Why it matters:** For a driving school app, this is low priority. But if you wanted learners to share a location or address to the app for pickup address, Share Target could enable that. Low effort to add, low impact for this specific app.
  - **How to fix:** Add to `manifest.json` if desired:
    ```json
    "share_target": {
      "action": "/learner/book.html",
      "method": "GET",
      "params": {
        "text": "pickup"
      }
    }
    ```
  - **Files to modify:** `public/manifest.json`

- [x] **Install banner doesn't account for safe-area-inset-bottom**
  - **What's wrong:** The install banner in `pwa.js` is fixed to `bottom: 0` but doesn't add `padding-bottom: env(safe-area-inset-bottom)`. On devices with gesture bars (iPhone X+), the dismiss button may be partially hidden behind the system UI.
  - **Why it matters:** The install banner is a key conversion point. If the button is hard to tap on notched devices, users may dismiss it or ignore it.
  - **How to fix:** In `pwa.js`, update the banner styles:
    ```javascript
    // In the style.textContent array, update the #cc-install-banner rule:
    '#cc-install-banner {',
    '  position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;',
    '  background: #262626; color: #fff;',
    '  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));',
    '  transform: translateY(100%); animation: cc-slide-up 0.4s 0.5s forwards;',
    '  box-shadow: 0 -4px 20px rgba(0,0,0,0.2);',
    '}',
    ```
  - **Files to modify:** `public/pwa.js`

- [x] **Context menu not prevented on bottom navigation — breaks app illusion on iOS**
  - **What's wrong:** Long-pressing nav links in the bottom tab bar on Safari shows the browser's "Open in New Tab / Copy Link" context menu. Only `log-session.html` prevents context menus (on fault counters specifically). The global bottom navigation has no such protection.
  - **Why it matters:** In standalone mode, the context menu is a dead giveaway that the app is a web page. Native apps never show "Open in New Tab" on their tab bars. This is especially noticeable on iOS where the long-press is a common gesture.
  - **How to fix:** Add to the shared sidebar/nav JS (likely `public/sidebar.js` or the bottom nav code):
    ```javascript
    // Prevent context menu on bottom navigation
    document.querySelectorAll('.bottom-nav a, .bottom-nav-item').forEach(function(el) {
      el.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      el.style.webkitTouchCallout = 'none';
    });
    ```
    Or via CSS on the bottom nav container:
    ```css
    .bottom-nav {
      -webkit-touch-callout: none;
      user-select: none;
    }
    ```
  - **Files to modify:** `public/sidebar.js` or bottom nav CSS

- [ ] **Improve image delivery — serve modern formats (WebP/AVIF)**
  - **What's wrong:** Lighthouse suggests image delivery improvements with ~40 KiB savings. Images are served as PNG/JPEG without modern format alternatives.
  - **Why it matters:** WebP images are 25-35% smaller than JPEG at equivalent quality. AVIF is even smaller. For a PWA where offline caching matters, smaller images mean faster cache population and less storage used.
  - **How to fix:** For the key static images (logo, icons), generate WebP versions and use `<picture>` elements:
    ```html
    <picture>
      <source srcset="/Logo.webp" type="image/webp">
      <img src="/Logo.png" alt="CoachCarter" width="120" height="120">
    </picture>
    ```
    Vercel also supports automatic image optimization via its Image Optimization API if configured.
  - **Files to modify:** HTML files with `<img>` tags, generate WebP versions of key images

---

## Lighthouse Details

### Performance Metrics (Mobile)
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| First Contentful Paint | 2.9s | <1.8s | Needs work |
| Largest Contentful Paint | 2.9s | <2.5s | Needs work |
| Total Blocking Time | 0ms | <200ms | Excellent |
| Cumulative Layout Shift | 0 | <0.1 | Excellent |
| Speed Index | 3.2s | <3.4s | Acceptable |

### Performance Metrics (Desktop)
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| First Contentful Paint | 0.7s | <1.8s | Excellent |
| Largest Contentful Paint | 0.7s | <2.5s | Excellent |
| Total Blocking Time | 0ms | <200ms | Excellent |
| Cumulative Layout Shift | 0 | <0.1 | Excellent |
| Speed Index | 1.2s | <3.4s | Excellent |

### Failed Audits
| Audit | Category | Est. Savings |
|-------|----------|-------------|
| Render-blocking requests | Performance | 1,950ms (mobile) / 450ms (desktop) |
| Network dependency tree | Performance | — |
| Insufficient colour contrast | Accessibility | — |
| Images with incorrect aspect ratio | Best Practices | — |
| Improve image delivery | Performance | ~40 KiB |
| Forced reflow | Performance | — |

### What's Already Working Well
- Service worker with proper caching strategies (app shell + network-first for HTML + stale-while-revalidate for assets)
- Offline fallback page
- Complete manifest with maskable icons, orientation, categories, lang
- Custom install prompt with smart dismissal logic (7-day cooldown)
- Apple PWA meta tags (apple-mobile-web-app-capable, status-bar-style, touch icon)
- Safe area insets used extensively (22 files)
- viewport-fit=cover on all pages
- `:focus-visible` for keyboard accessibility
- Web Share API on quiz results
- `user-select: none` on interactive elements
- Touch feedback via scale transforms on `:active`
- Hourly SW update checks
- HTTPS with HSTS
- Image lazy loading with Intersection Observer

---

## Reference

For deep background on any recommendation in this roadmap, see the PWA best practices reference at:
`C:\Users\frase\Desktop\pwa-enhance\references\pwa-best-practices.md`
