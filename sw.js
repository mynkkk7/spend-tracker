// Service worker: app shell works offline; OCR files are cached the first time they're used.
// Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const OCR = 'ocr-v5.1.1';

const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/util.js', 'js/calc.js', 'js/parse.js', 'js/ui.js', 'js/charts.js', 'js/ocr.js',
  'js/views/home.js', 'js/views/txnForm.js', 'js/views/txns.js', 'js/views/accounts.js', 'js/views/plan.js',
  'js/views/insights.js', 'js/views/settings.js', 'js/views/welcome.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== OCR).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/tesseract/')) {
    e.respondWith(caches.open(OCR).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch {
      return (await c.match('index.html')) || Response.error();
    }
  })());
});
