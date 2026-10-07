// Service Worker: מטמון offline + קליטת קבצים משותפים (Web Share Target).
const CACHE = 'calendary-v2';
const ASSETS = [
  './', './index.html', './css/styles.css',
  './js/app.js', './js/db.js', './js/categories.js', './js/conflicts.js',
  './js/parse.js', './js/extract.js', './js/calendar.js',
  './manifest.webmanifest', './icons/icon.svg',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'shared-files').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // קליטת קובץ ששותף מהטלפון
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('file');
        const cache = await caches.open('shared-files');
        for (const f of files) {
          if (f && f.size) {
            const key = new Request('./__shared__/' + encodeURIComponent(f.name || ('shared-' + Date.now())));
            await cache.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }));
          }
        }
      } catch (_) {}
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  const sameOrigin = url.origin === location.origin;

  if (sameOrigin) {
    // קוד האפליקציה: network-first (תמיד עדכני), נפילה למטמון כשאין רשת
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // ספריות CDN (מגורסאות): cache-first
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res && res.status === 200 && url.host.includes('jsdelivr')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }))
    );
  }
});
