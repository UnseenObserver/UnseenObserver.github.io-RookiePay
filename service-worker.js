const STATIC_CACHE = 'budget-tracker-static-v3';

const STATIC_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './login.html',
  './styles.css',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/auth.js',
  './assets/js/dashboard.js',
  './assets/js/cache-registration.js',
  './assets/js/firebase-config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  const isStaticRequest = ['document', 'script', 'style'].includes(request.destination);

  if (!isStaticRequest) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});