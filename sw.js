// 离线缓存。拍照的地方常常没信号，所以整个 App 要能离线跑。
// 改了文件记得把 VERSION 往上加一位，否则用户拿到的还是旧缓存。

const VERSION = 'haohaopai-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/sensors.js',
  './js/frame.js',
  './js/coach.js',
  './js/content.js',
  './js/survey.js',
  './js/review.js',
  './js/claude.js',
  './js/img.js',
  './data/recipes.json',
  './data/cues.json',
  './data/duo.json',
  './data/survey.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 单个文件失败不该让整次安装失败
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 只管自己的静态资源。发往 Anthropic 的请求绝不能碰。
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 先给缓存保证秒开和离线，同时在后台更新，下次打开就是新的。
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
