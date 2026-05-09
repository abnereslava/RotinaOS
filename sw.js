const CACHE_NAME = 'todo-os-cache-v4';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico'
];

// Instala e cacheia os arquivos; skipWaiting força ativação imediata
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Apaga caches antigos e assume controle de todos os clientes abertos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});

// ── LÓGICA DE NOTIFICAÇÕES (PWA) ──────────────────────────

// Listener para clique na notificação: abre ou foca no app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Se já houver uma aba aberta, foca nela
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      // Caso contrário, abre o app
      return clients.openWindow('./');
    })
  );
});
