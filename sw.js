const CACHE_NAME = 'todo-os-cache-v7';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/bootstrap.js',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

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
    const networkResponse = await fetch(request);
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
    '<script type="module" src="js/bootstrap.js"></script>'
  );

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-cache');

  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(serveGoogleAuthEntry(event.request));
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
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('./');
    })
  );
});
