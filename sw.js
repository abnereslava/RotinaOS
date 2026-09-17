const CACHE_NAME = 'todo-os-cache-v36';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',

  './css/style.css',
  './css/mobile-fixes.css',
  './css/calendar-view.css',
  './css/calendar-history.css',
  './css/calendar-v3.css',
  './css/theme-polish.css',
  './css/pink-ball.css',
  './css/pollyana.css',
  './css/pollyana-hud.css',
  './css/pollyana-v28.css',
  './css/ui-polish-v24.css',
  './css/optional-date-fix.css',
  './css/category-rename.css',
  './css/activity-tracking.css',

  './js/app.js',
  './js/app-core.js',
  './js/core-loader.js',
  './js/firebase-init.js',
  './js/bootstrap.js',
  './js/theme-enhancements.js',
  './js/filter-persistence.js',
  './js/ui-fixes.js',
  './js/main-swipe.js',
  './js/mobile-back-nav.js',
  './js/optional-date-fix.js',
  './js/category-rename.js',
  './js/activity-tracking.js',
  './js/calendar-view-v3.js',
  './js/demo-calendar-bridge.js',
  './js/occurrence-history.js'
];

// Dependências críticas para abrir o app já visitado quando não houver internet.
// São armazenadas de forma best-effort para não impedir a instalação do SW caso
// algum CDN esteja temporariamente indisponível.
const REMOTE_CRITICAL = [
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js'
];

const NETWORK_FIRST_PATHS = new Set(
  LOCAL_ASSETS
    .filter(path => path.startsWith('./css/') || path.startsWith('./js/'))
    .map(path => new URL(path, self.registration.scope).pathname)
);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    await Promise.allSettled(
      REMOTE_CRITICAL.map(url => cache.add(url))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallback = null) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
      return response;
    }
  } catch (_) {
    // Offline: tenta cache abaixo.
  }

  return (await caches.match(request)) || (fallback ? await caches.match(fallback) : null);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request, './index.html')
        .then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isLocalCodeAsset =
    requestUrl.origin === self.location.origin &&
    NETWORK_FIRST_PATHS.has(requestUrl.pathname);

  if (isLocalCodeAsset) {
    event.respondWith(
      networkFirst(event.request)
        .then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      return new Response('Offline', { status: 503 });
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('./');
    })
  );
});