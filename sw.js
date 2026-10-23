// Service worker: makes the app installable and fast/reliable on slow internet.
// App files + Firebase/jsPDF library files are cached; live data comes from Firestore's own offline cache.
const CACHE = 'gym-manager-v9';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/util.js', '/js/invoice.js', '/vendor/jspdf.umd.min.js', '/firebase-config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cdn = ['www.gstatic.com', 'cdnjs.cloudflare.com'].includes(url.hostname);
  if (url.origin !== location.origin && !cdn) return; // Firestore/Auth calls go straight to network
  // stale-while-revalidate: show cached copy instantly, refresh in background
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
