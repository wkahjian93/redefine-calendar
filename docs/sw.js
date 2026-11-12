// Network first and always revalidated, so phones get updates as soon as they are online; falls back to the cache offline.
// When Firebase is set up (config.js), this also receives the phone pop-ups while the app is closed.
const CACHE = 'rcal-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
try { importScripts('config.js'); } catch (e) {}
const CFG = self.RCAL_CONFIG || {};
if (CFG.firebase) {
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
    firebase.initializeApp(CFG.firebase);
    firebase.messaging();   // shows the pop-up itself when the app is closed / in the background
  } catch (e) {}
}
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, {ignoreSearch: true})));
});
// Pop-ups shown by the app itself (data.rcal) open the right screen when tapped. Firebase handles its own.
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  if (!d.rcal) return;
  e.notification.close();
  const url = './' + (d.url || '');
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
