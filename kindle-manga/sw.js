const CACHE = 'mangakindle-offline-v1';
const API_PATHS = ['/md/', '/jk/', '/tr?', '/img?'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('./index.html')));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !API_PATHS.some(path => path.endsWith('?') ? url.pathname === path.slice(0, -1) : url.pathname.startsWith(path))) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)))
  );
});
