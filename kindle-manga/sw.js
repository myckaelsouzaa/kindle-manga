const CACHE = 'mangakindle-offline-v2';

// Respostas de API e imagens do proxy local ficam disponíveis offline (cache primeiro).
const isCacheable = ({ pathname }) =>
  pathname === '/tr' || pathname === '/img' || ['/md/', '/jk/', '/downloads/'].some(prefix => pathname.startsWith(prefix));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('./index.html')));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !isCacheable(new URL(request.url))) return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => undefined));
      }
      return response;
    })).catch(() => caches.match(request).then(cached => cached || Response.error()))
  );
});

// Avisa as abas abertas para reenviar a fila de downloads pendentes ao servidor.
self.addEventListener('sync', event => {
  if (event.tag !== 'mangakindle-downloads') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => clients.forEach(client => client.postMessage({ type: 'sync-downloads' })))
  );
});
