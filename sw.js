// 離線快取：讓 App 在沒有網路時（例如在國外飛機上）也能打開
// 修改 App 後，把版本號 +1，手機上的 App 就會自動更新
// 抓檔案時一律跳過瀏覽器的 HTTP 快取（GitHub Pages 預設會快取 10 分鐘），才拿得到剛上傳的新版
const CACHE = 'cuticuti-v9';
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
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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
      const network = fetch(req.url, { cache: 'no-cache' }).then((res) => {
        // 不快取帶參數的網址（例如 Google 登入跳回來的 ?code=...）
        if (res.ok && !new URL(req.url).search) cache.put(req, res.clone());
        return res;
      });
      const timeout = new Promise((r) => setTimeout(r, 3000));
      const res = await Promise.race([network, timeout]).catch(() => null);
      return res || (await cache.match(req, { ignoreSearch: true })) || network;
    })
  );
});
