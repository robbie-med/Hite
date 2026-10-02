/* Hite service worker — precache the app shell + encrypted bank for offline use.
   VERSION is stamped by build.py. A new version installs in the background and
   activates at once; the page reloads into it, or shows a Reload bar mid-quiz.
   localStorage (progress) is untouched by updates. */
const VERSION = 'b1d8499d8045';
const CACHE = 'ite-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './theme.js',
  './symbols.woff2',
  './app.js',
  './exam-meta.js',
  './data.enc',
  './images.enc',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // Fetch exactly this build. "?v=" gives a URL no CDN has cached (Cloudflare holds
    // .js files for hours) and cache:'reload' skips the browser's HTTP cache, so the
    // shell can never mix a new sw.js with an old app.js.
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async u => {
      const r = await fetch(new Request(u + '?v=' + VERSION, { cache: 'reload' }));
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      await c.put(u, r);
    }));
    // Take over right away. The page reloads itself when it is safe (outside a quiz)
    // and otherwise offers a Reload bar. Waiting instead strands older installs whose
    // page has no update bar, and iOS rarely closes a home-screen app fully.
    await self.skipWaiting();
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
