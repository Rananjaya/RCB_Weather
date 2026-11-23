/* Offline support: the app shell is cached; weather requests go to the network and fall back to
 * the last successful response, so the app still opens (with the last data) without internet. */
const SHELL = 'rcbw-shell-v15';
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

// Tapping an alert opens (or focuses) the app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list =>
    list.length ? list[0].focus() : self.clients.openWindow('./')));
});

// Push alerts from the alerts server (push-worker/). Pushes are empty; the message is fetched here.
const PUSH_API = 'https://rcb-weather-alerts.rananjayabandara.workers.dev';
self.addEventListener('push', e => e.waitUntil((async () => {
  let msgs = [];
  // New server: the alert text is inside the push. Older server: fetch it.
  try { if (e.data) msgs = e.data.json(); } catch { msgs = []; }
  if (!Array.isArray(msgs) || !msgs.length) try {
    const sub = await self.registration.pushManager.getSubscription();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint)));
    const id = [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
    msgs = await (await fetch(`${PUSH_API}/messages?id=${id}`, { cache: 'no-store' })).json();
  } catch { /* show the fallback below */ }
  if (!Array.isArray(msgs) || !msgs.length) msgs = [{ title: 'RCB Weather', body: 'New weather alert. Open RCB Weather to see it.', tag: 'rcbw-alert' }];
  await Promise.all(msgs.map(m => self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: 'icons/app-192.png', badge: 'icons/app-192.png' })));
})()));
