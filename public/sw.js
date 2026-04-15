const CACHE_NAME = 'taskflow-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

const isLocalhost = ["localhost", "127.0.0.1"].includes(self.location.hostname);

if (isLocalhost) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      await self.clients.claim();
    })());
  });
} else {

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
    );
    self.clients.claim();
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // NEVER intercept /api requests.
    // For navigation requests (e.g. OAuth login redirects), the browser must
    // handle the 302 natively so it actually navigates to the external domain.
    // For non-navigation API calls, the app handles errors itself.
    // By not calling event.respondWith(), the browser uses its default behavior.
    if (url.pathname.startsWith('/api')) {
      return;
    }

    // Skip cross-origin requests entirely
    if (url.origin !== self.location.origin) {
      return;
    }

    // For navigation requests (HTML pages): network-first, cache as offline fallback.
    // Cache-first for HTML causes stale JS bundle references after deploys — the
    // cached index.html points at bundle hashes that no longer exist, and the app
    // never hydrates. By always trying the network first we pick up fresh deploys
    // immediately; the cached copy is only served when offline.
    if (request.mode === 'navigate') {
      event.respondWith(
        (async () => {
          try {
            const response = await fetch(request);
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
            }
            return response;
          } catch {
            const cached = await caches.match('/index.html');
            return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
          }
        })()
      );
      return;
    }

    // For hashed build assets (e.g. /assets/index-ABCD1234.js) — cache-first since
    // the hash in the filename guarantees the content never changes.
    // For other same-origin assets — network-first with cache fallback, so
    // unhashed resources (like icons or manifest.json) pick up updates.
    const isHashedBuildAsset = /\/assets\/.+-[A-Za-z0-9]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|gif)$/.test(url.pathname);

    if (isHashedBuildAsset) {
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          });
        })
      );
      return;
    }

    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error('Network unavailable and no cache entry');
        }
      })()
    );
  });
}
