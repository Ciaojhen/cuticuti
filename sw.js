// 離線快取：讓 App 在沒有網路時（例如在國外飛機上）也能打開
// 修改下面清單裡的檔案後，把版本號 +1
const CACHE = 'cuticuti-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './vendor/supabase.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // 同網域還有 FooooooD 等其他 App，只清掉 CutiCuti 自己的舊快取
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cuticuti-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 登入、資料同步（Supabase）等其他網站的請求不經過快取
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
