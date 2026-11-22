/* Offline support: the app shell is cached; weather requests go to the network and fall back to
 * the last successful response, so the app still opens (with the last data) without internet. */
const SHELL = 'rcbw-shell-v2';
const DATA = 'rcbw-data-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icons/app-192.png', './icons/app-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // App files: cache first, refreshed in the background.
    e.respondWith(caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => { caches.open(SHELL).then(c => c.put(e.request, res.clone())); return res; }).catch(() => hit);
      return hit || net;
    }));
  } else if (/api\.met\.no|open-meteo\.com|openweathermap\.org/.test(url.host)) {
    // Weather: network first, last response when offline.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
  }
});
