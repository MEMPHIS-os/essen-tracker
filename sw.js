const CACHE_NAME = 'essentracker-v31';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/onboarding.css',
  './css/photo.css',
  './css/light.css',
  './js/db.js',
  './js/app.js',
  './js/scanner.js',
  './js/ui.js',
  './js/score.js',
  './js/onboarding.js',
  './js/caffeine.js',
  './js/photo.js',
  './js/charts.js',
  './js/notifications.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

self.addEventListener('install', e => {
  // KEIN skipWaiting() hier - die App entscheidet per Message,
  // wann der neue SW uebernehmen darf (sauberer Update-Flow).
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App sagt: "bitte jetzt uebernehmen" -> SW aktiviert sich, die App
// bekommt dann ein 'controllerchange' Event und lädt neu.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Network-first for API calls
  if (url.includes('openfoodfacts.org') || url.includes('api.edamam.com') || url.includes('generativelanguage.googleapis.com')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache CDN resources (Tesseract, jsPDF) with stale-while-revalidate
  if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com/tesseract') || url.includes('cdnjs.cloudflare.com/ajax/libs/jspdf')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Cache-first for app assets
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Notification click handler
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
