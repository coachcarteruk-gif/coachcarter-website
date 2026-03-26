// ── CoachCarter Service Worker ────────────────────────────────────────────────
// Strategy: Cache app shell for instant loads, network-first for API/dynamic content

const CACHE_NAME = 'cc-v2';
const SHELL_ASSETS = [
  '/',
  '/learner/',
  '/sidebar.js',
  '/competency-config.js',
  '/Logo.png',
  '/logo-dark.png',
  '/icons/icon-192.png',
  '/offline.html'
];

// ── Install: cache app shell ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, stale-while-revalidate for pages ───────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls, auth endpoints, and Stripe — always go to network
  if (url.pathname.startsWith('/api/') || url.hostname.includes('stripe') || url.hostname.includes('posthog')) {
    return;
  }

  // For HTML pages: network first, fall back to cache, then offline page
  if (event.request.headers.get('accept')?.includes('text/html')) {
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

  // For static assets (JS, CSS, images): cache first, network fallback
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
