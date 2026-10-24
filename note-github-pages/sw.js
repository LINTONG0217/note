/* 墨记 · 离线缓存（仅在 http/https 下启用；直接双击 index.html 时不会运行） */
const VERSION = 'inkji-v6';
const SHELL = [
  './', 'index.html', 'css/app.css',
  'js/core.js', 'js/db.js', 'js/render.js', 'js/handwrite.js', 'js/scan.js', 'js/formula.js', 'js/io.js', 'js/library.js', 'js/editor.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // 自己的文件：先走网络（改了代码立刻生效），断网时用缓存
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (/^(cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.(com|cn)|fonts\.loli\.net|gstatic\.loli\.net)$/.test(url.hostname)) {
    // pdf.js 和手写字体：用过一次就缓存，之后离线也能用
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })));
  }
});
