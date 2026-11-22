/* Offline support: the app shell is cached; weather requests go to the network and fall back to
 * the last successful response, so the app still opens (with the last data) without internet. */
const SHELL = 'rcbw-shell-v5';
const DATA = 'rcbw-data-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icons/app-192.png', './icons/app-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // App files: network first so updates show at once; the cached copy only when offline.
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { cacheName: SHELL })));
  } else if (/api\.met\.no|open-meteo\.com|openweathermap\.org/.test(url.host)) {
    // Weather: network first, last response when offline.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
  }
});
