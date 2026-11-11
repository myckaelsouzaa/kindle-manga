// Páginas e capas só entram neste cache quando o usuário BAIXA um capítulo ou salva um mangá (feito pelo Model).
// Ler não grava nada: imagens lidas ficam apenas no cache HTTP do navegador, que o próprio navegador limpa.
const CACHE = 'mangakindle-offline-v2';
const API_CACHE = 'mangakindle-api-v1';
const API_LIMIT = 120, API_TIMEOUT_MS = 6000;

const isApi = ({ pathname }) => pathname === '/tr' || ['/md/', '/jk/'].some(prefix => pathname.startsWith(prefix));
const isAsset = ({ pathname }) => pathname === '/img' || pathname.startsWith('/downloads/');
const isVolatile = ({ pathname }) => pathname.startsWith('/md/at-home/'); // endereços de página expiram

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('./index.html')));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== API_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Dados da API: rede primeiro (sempre atualizado) e, sem rede ou lenta, a última resposta guardada.
async function networkFirst(request, url) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), API_TIMEOUT_MS))
    ]);
    if (response.ok && !isVolatile(url)) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      if (keys.length > API_LIMIT) await Promise.all(keys.slice(0, keys.length - API_LIMIT).map(key => cache.delete(key)));
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (isAsset(url)) { // usa o que foi baixado de propósito; o resto vem da rede e NÃO é guardado
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  } else if (isApi(url)) {
    event.respondWith(networkFirst(request, url));
  }
});

// Avisa as abas abertas para reenviar a fila de downloads pendentes ao servidor.
self.addEventListener('sync', event => {
  if (event.tag !== 'mangakindle-downloads') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => clients.forEach(client => client.postMessage({ type: 'sync-downloads' })))
  );
});