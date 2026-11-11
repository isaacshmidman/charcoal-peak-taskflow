const CACHE_NAME = 'zephyrly-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/zephyrly-logo.png',
  '/apple-touch-icon.png',
  '/icon.svg',
  // Brand typeface — precached so offline loads keep the DS font.
  '/fonts/hanken-grotesk-latin.woff2',
  '/fonts/hanken-grotesk-latin-ext.woff2',
];

const isLocalhost = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  // Title = task title only (Google Calendar pattern on Apple devices).
  // The OS shows the app name "Zephyrly" above this automatically via the
  // PWA manifest, so duplicating it here would look like "Zephyrly —
  // Zephyrly: <task>".
  const title = payload.title || 'Zephyrly';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/zephyrly-logo.png',
    badge: payload.badge || '/zephyrly-logo.png',
    tag: payload.tag || undefined,
    // renotify lets the OS re-announce a re-issued tag (e.g. snoozed task
    // firing a second time) instead of silently replacing the previous.
    renotify: Boolean(payload.tag),
    // Advanced options from per-user notification settings — silently
    // ignored by browsers/devices that don't support them (e.g. iOS
    // Safari drops `actions` and `vibrate`).
    requireInteraction: payload.requireInteraction === true,
    silent: payload.silent === true,
    vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : undefined,
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
    lang: 'en',
    dir: 'auto',
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Both the "Snooze" and "Mark done" action buttons currently route to
  // the task in the app — the user completes/snoozes there. A future
  // iteration can hit the API directly from the SW (requires the auth
  // cookie + a /api/.../tasks/:id/snooze endpoint), but this gives a
  // working button on every platform that supports actions at all.
  const targetUrl = new URL(data.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin !== self.location.origin) continue;
      if ('navigate' in client) await client.navigate(targetUrl);
      if ('focus' in client) return client.focus();
      return;
    }

    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});

if (isLocalhost) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })());
  });
} else {
  // Find a kept copy by its address alone. The server marks every answer
  // "Vary: Origin, Accept-Encoding", and a plain lookup honours that: a
  // font or script the page asks for carries an Origin header, the copy
  // was fetched without one, and so the copy "didn't match" and the file
  // failed to load with no connection — though it was sitting right here.
  // None of these files actually differs by who asks.
  const kept = (request) => caches.match(request, { ignoreVary: true });

  const cacheResponse = async (request, response) => {
    if (!response || !response.ok || response.type === 'opaque') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  };

  const HASHED_BUILD_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|gif)$/;

  // Keep a copy of every file of the current build (the build writes the
  // list: /asset-list.json). Files are otherwise only kept as the page
  // happens to ask for them, which left two holes offline: the very first
  // visit (the page had loaded before this worker could see its requests)
  // and anything that loads on first use, like the task form's text
  // editor. Each file's name carries a fingerprint of its content, so one
  // that is already here never needs fetching again.
  const keepWholeBuild = async () => {
    const listed = await fetch('/asset-list.json', { cache: 'no-store' });
    if (!listed.ok) return;
    const files = await listed.json();
    if (!Array.isArray(files)) return;
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      files
        .filter((file) => typeof file === 'string' && HASHED_BUILD_ASSET.test(file))
        .map(async (file) => {
          if (await cache.match(file, { ignoreVary: true })) return;
          const response = await fetch(file);
          if (response.ok) await cache.put(file, response);
        })
    );
  };

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(STATIC_ASSETS))
        // Best effort: a failed download here must not stop the worker
        // installing. It is tried again on the next page load.
        .then(() => keepWholeBuild().catch(() => {}))
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

    if (request.method !== 'GET') {
      return;
    }

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
              cacheResponse('/index.html', response).catch(() => {});
              // A page load is when a new build shows up.
              event.waitUntil(keepWholeBuild().catch(() => {}));
            }
            return response;
          } catch {
            const cached = await kept('/index.html');
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
    const isHashedBuildAsset = HASHED_BUILD_ASSET.test(url.pathname);

    if (isHashedBuildAsset) {
      event.respondWith(
        kept(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              cacheResponse(request, response).catch(() => {});
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
            cacheResponse(request, response).catch(() => {});
          }
          return response;
        } catch {
          const cached = await kept(request);
          if (cached) return cached;
          throw new Error('Network unavailable and no cache entry');
        }
      })()
    );
  });
}
