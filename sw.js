/* Hite service worker — precache the app shell + encrypted bank for offline use.
   VERSION is stamped by build.py; a new version installs in the background and
   waits until the user taps "Reload" (or closes the app) so a mid-session update
   never interrupts anyone. localStorage (progress) is untouched by updates. */
const VERSION = 'fa016da643e5';
const CACHE = 'ite-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './exam-meta.js',
  './data.enc',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    // No open windows (first install, or the app is closed): activate right away.
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    if (!clients.length) await self.skipWaiting();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('ite-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch (err) {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
