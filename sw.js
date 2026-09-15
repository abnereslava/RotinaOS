const CACHE_NAME = 'todo-os-cache-v18';
const ASSET_VERSION = '20260914-sage-japanese';

const versionedAsset = (path) => `${path}?v=${ASSET_VERSION}`;

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  versionedAsset('./css/mobile-fixes.css'),
  versionedAsset('./css/calendar-view.css'),
  versionedAsset('./css/calendar-history.css'),
  versionedAsset('./css/calendar-v3.css'),
  versionedAsset('./css/new-themes.css'),
  versionedAsset('./js/theme-enhancements.js'),
  versionedAsset('./js/bootstrap.js'),
  versionedAsset('./js/ui-fixes.js'),
  versionedAsset('./js/main-swipe.js'),
  versionedAsset('./js/calendar-view-v3.js'),
  versionedAsset('./js/occurrence-history.js'),
  versionedAsset('./js/app.js'),
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

const NETWORK_FIRST_PATHS = new Set([
  '/RotinaOS/css/mobile-fixes.css',
  '/RotinaOS/css/calendar-view.css',
  '/RotinaOS/css/calendar-history.css',
  '/RotinaOS/css/calendar-v3.css',
  '/RotinaOS/css/new-themes.css',
  '/RotinaOS/js/theme-enhancements.js',
  '/RotinaOS/js/bootstrap.js',
  '/RotinaOS/js/ui-fixes.js',
  '/RotinaOS/js/main-swipe.js',
  '/RotinaOS/js/calendar-view-v3.js',
  '/RotinaOS/js/occurrence-history.js',
  '/RotinaOS/js/app.js'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

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

async function getBaseNavigationResponse(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(() => {});
      return networkResponse;
    }
  } catch (error) {
    // Se estiver offline, cai para o cache abaixo.
  }

  return (await caches.match(request)) || (await caches.match('./index.html'));
}

async function serveGoogleAuthEntry(request) {
  const response = await getBaseNavigationResponse(request);
  if (!response) return new Response('Offline', { status: 503 });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  const transformed = html.replace(
    '<script type="module" src="js/app.js"></script>',
    `<link rel="stylesheet" href="css/mobile-fixes.css?v=${ASSET_VERSION}">\n    <link rel="stylesheet" href="css/calendar-view.css?v=${ASSET_VERSION}">\n    <link rel="stylesheet" href="css/calendar-history.css?v=${ASSET_VERSION}">\n    <link rel="stylesheet" href="css/calendar-v3.css?v=${ASSET_VERSION}">\n    <link rel="stylesheet" href="css/new-themes.css?v=${ASSET_VERSION}">\n    <script src="js/theme-enhancements.js?v=${ASSET_VERSION}" defer></script>\n    <script src="js/ui-fixes.js?v=${ASSET_VERSION}" defer></script>\n    <script src="js/main-swipe.js?v=${ASSET_VERSION}" defer></script>\n    <script type="module" src="js/bootstrap.js?v=${ASSET_VERSION}"></script>\n    <script type="module" src="js/calendar-view-v3.js?v=${ASSET_VERSION}"></script>`
  );

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');

  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(() => {});
      return networkResponse;
    }
  } catch (error) {
    // Offline: usa a cópia armazenada abaixo.
  }

  return caches.match(request);
}

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(serveGoogleAuthEntry(event.request));
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isLocalVersionedAsset =
    requestUrl.origin === self.location.origin &&
    NETWORK_FIRST_PATHS.has(requestUrl.pathname);

  if (isLocalVersionedAsset) {
    event.respondWith(
      networkFirst(event.request).then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;

      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || !networkResponse.ok || event.request.method !== 'GET') {
          return networkResponse;
        }

        const copy = networkResponse.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, copy))
          .catch(() => {});

        return networkResponse;
      });
    })
  );
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
