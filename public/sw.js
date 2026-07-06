// ── CoachCarter Service Worker ────────────────────────────────────────────────
// Strategy: Cache app shell for instant loads, network-first for API/dynamic content
//
// Auth-route exclusion (PR-O, audit #20):
// Never precache or cache HTML responses for /learner/*, /instructor/*, /admin/*.
// If a stale SW served a cached /learner/index.html after the user switched
// accounts, any inline-rendered user data on the shell would leak across
// sessions. The dynamic data already flows through /api/* (excluded below),
// but defence-in-depth: keep auth-gated HTML out of the cache entirely.

const CACHE_NAME = 'cc-v6';
const MAX_CACHE_ITEMS = 100;
const AUTH_PATH_PREFIXES = ['/learner/', '/instructor/', '/admin/'];
const SHELL_ASSETS = [
  '/',
  '/sidebar.js',
  '/competency-config.js',
  '/Logo.png',
  '/logo-dark.png',
  '/icons/icon-192.png',
  '/offline.html'
];

function isAuthPath(pathname) {
  return AUTH_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// ── Install: cache app shell ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches + trim size ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
    .then(() => trimCache(CACHE_NAME, MAX_CACHE_ITEMS))
    .then(() => self.clients.claim())
  );
});

// ── Message: controlled skipWaiting on user request ─────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch: network-first for API, stale-while-revalidate for pages ───────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls, auth endpoints, and Stripe - always go to network
  if (url.pathname.startsWith('/api/') || url.hostname.includes('stripe') || url.hostname.includes('posthog')) {
    return;
  }

  // For HTML pages: network first, fall back to cache, then offline page.
  // Auth-gated paths (/learner/*, /instructor/*, /admin/*) are network-only - // never cached, never served from cache. Prevents stale per-user shells from
  // leaking across sessions when a different account signs in.
  if (event.request.headers.get('accept')?.includes('text/html')) {
    if (isAuthPath(url.pathname)) {
      event.respondWith(
        fetch(event.request).catch(() => caches.match('/offline.html'))
      );
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful page loads for offline fallback
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Static assets under auth-gated paths (e.g. /learner/foo.js) bypass the
  // cache entirely. Same defence-in-depth as the HTML branch above - a
  // per-user JS file shouldn't survive an account switch.
  if (isAuthPath(url.pathname)) return;

  // JS/CSS carries product copy and app behaviour; fetch it fresh first so
  // learners do not stay pinned to old navigation after a deploy.
  if (/\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static media/assets: cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Revalidate in background
        fetch(event.request).then(response => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

// ── Cache size management ────────────────────────────────────────────────────
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}
