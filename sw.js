const CACHE_NAME = 'todo-os-cache-v37';

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

// Dependências necessárias para restaurar uma sessão já usada sem rede.
const REMOTE_CRITICAL = [
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js'
];

// Recursos visuais externos são opcionais. São aquecidos quando possível, mas
// uma falha neles nunca impede a instalação do PWA.
const REMOTE_OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Rajdhani:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

const LOCAL_RUNTIME_PATHS = new Set(
  LOCAL_ASSETS
    .filter(path => path.startsWith('./css/') || path.startsWith('./js/'))
    .map(path => new URL(path, self.registration.scope).pathname)
);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);

    await Promise.allSettled(
      [...REMOTE_CRITICAL, ...REMOTE_OPTIONAL].map(url => cache.add(url))
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

async function fetchAndCache(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return null;
  }
}

async function cacheFirst(event, request, fallback = null) {
  const cached = (await caches.match(request)) || (fallback ? await caches.match(fallback) : null);

  if (cached) {
    // Mostra imediatamente a cópia local e atualiza silenciosamente para a próxima abertura.
    event.waitUntil(fetchAndCache(request));
    return cached;
  }

  const network = await fetchAndCache(request);
  if (network) return network;
  return fallback ? await caches.match(fallback) : null;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      cacheFirst(event, event.request, './index.html')
        .then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isLocalRuntimeAsset =
    requestUrl.origin === self.location.origin &&
    LOCAL_RUNTIME_PATHS.has(requestUrl.pathname);

  if (isLocalRuntimeAsset) {
    event.respondWith(
      cacheFirst(event, event.request)
        .then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  // Firebase CDN, fontes e demais sub-recursos: cache-first. Isso é essencial
  // para que módulos já usados continuem disponíveis sem conexão.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    const response = await fetchAndCache(event.request);
    return response || new Response('Offline', { status: 503 });
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