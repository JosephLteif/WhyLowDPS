const STATIC_CACHE = 'whylowdps-static-v1';
const DATA_CACHE = 'whylowdps-data-v1';
const OFFLINE_URL = '/offline.html';

const SAFE_GET_PREFIXES = ['/api/data/', '/api/game-data/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/manifest.webmanifest', '/icon.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isSafeDataRequest(request) {
  return request.method === 'GET' && SAFE_GET_PREFIXES.some((prefix) => new URL(request.url).pathname.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (isSafeDataRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/') || url.pathname === '/icon.png') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached || network;
      }),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
  if (event.data?.type === 'CLEAR_USER_CACHE') {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});
