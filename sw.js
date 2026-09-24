// 離線快取：讓 App 在沒有網路時（例如在國外飛機上）也能打開
const CACHE = 'cuticuti-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // 有網路就拿最新版（最多等 3 秒），沒網路或太慢就用快取
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      const timeout = new Promise((r) => setTimeout(r, 3000));
      const res = await Promise.race([network, timeout]).catch(() => null);
      return res || (await cache.match(req, { ignoreSearch: true })) || network;
    })
  );
});
