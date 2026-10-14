const CACHE_NAME = 'monit-assets-v2';
const STATIC_ASSETS = [
  '/style.css',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW cache.addAll non-fatal error:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('monit-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip API, WS, and non-GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.mode === 'navigate' || (!STATIC_ASSETS.includes(url.pathname) && !url.pathname.startsWith('/dist/'))) {
    return;
  }

  // Network-first for everything, falling back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const type = response.headers.get('Content-Type') || '';
        if (response.status === 200 && !type.includes('text/html') && !response.headers.get('Cache-Control')?.includes('no-store')) {
          const resClone = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone)).catch(err => console.warn('Asset cache write failed:', err)));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request)) || Response.error())
  );
});
