// 离线缓存。拍照的地方常常没信号，所以整个 App 要能离线跑。
// 改了文件记得把 VERSION 往上加一位，否则用户拿到的还是旧缓存。

const VERSION = 'haohaopai-v8';
const VENDOR  = 'haohaopai-vendor-v1';   // 识别模型单独一个缓存，改版本时不必重下 17MB

// 自动认人的 WASM 和模型。URL 带版本号、内容不变，所以缓存优先，存下就不再回网。
const VENDOR_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

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
  './js/ai-contract.mjs',
  './js/ai-moment.js',
  './js/instant.js',
  './js/face-worker.mjs',
  './js/guidance.js',
  './js/capture.js',
  './js/content.js',
  './js/styles.js',
  './assets/styles/cinematic-curvy.jpg',
  './assets/styles/golden-curvy.jpg',
  './assets/styles/travel-curvy.jpg',
  './assets/styles/editorial-curvy.jpg',
  './js/review.js',
  './js/claude.js',
  './js/img.js',
  './js/vision.js',
  './js/speak.js',
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
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION && k !== VENDOR).map(k => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('Authorization')) return;

  const url = new URL(req.url);

  // 识别模型的运行时文件：内容不可变，缓存优先且**不做后台重新验证**。
  // 这一条很要紧——默认那套 stale-while-revalidate 会在每次打开页面时
  // 悄悄把 18MB 重新下一遍。
  const isVendor = VENDOR_HOSTS.includes(url.hostname)
                || (url.origin === self.location.origin && url.pathname.includes('/vendor/'));
  if (isVendor) {
    e.respondWith(
      caches.open(VENDOR).then(c => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        // 只存成功且可读的响应；不透明响应存了也读不出内容
        if (res && res.ok && res.type !== 'opaque') c.put(req, res.clone());
        return res;
      }))),
    );
    return;
  }

  // 其余只管自己的静态资源。发往 Anthropic 的请求绝不能碰。
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
