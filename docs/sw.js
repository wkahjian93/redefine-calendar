// Network first and always revalidated, so phones get updates as soon as they are online; falls back to the cache offline.
// Also shows the phone pop-ups that arrive from the server (Firebase Cloud Messaging) - by itself, without the Firebase
// library, so it works the same on Android and iPhone and even when the app is closed.
const CACHE = 'rcal-v21';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/team-mark.png'];
const IOS = /iphone|ipad|ipod|macintosh/i.test(self.navigator.userAgent) && /safari/i.test(self.navigator.userAgent) && !/chrome|crios|android/i.test(self.navigator.userAgent);
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

/* A pop-up from the server. FCM wraps it as {notification:{title,body}, data:{title,body,url,tag}}.
   App open and on screen -> the app shows its own WhatsApp-style banner (no double pop-up).
   App closed / in the background / phone locked -> a normal phone notification. iPhone always gets the phone
   notification (Apple requires every push to show one). */
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = {data: {body: e.data ? e.data.text() : ''}}; }
  const n = p.notification || {}, d = p.data || {};
  const msg = {title: n.title || d.title || 'REDEFINE Calendar', body: n.body || d.body || '', url: d.url || '#/', tag: n.tag || d.tag || ''};
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const visible = list.filter(c => c.visibilityState === 'visible');
    visible.forEach(c => c.postMessage({rcalPush: msg}));
    if (visible.length && !IOS) return;
    return self.registration.showNotification(msg.title, {
      body: msg.body, icon: 'icons/icon-192.png', badge: 'icons/badge-72.png',
      tag: msg.tag || undefined, renotify: !!msg.tag, data: {rcal: 1, url: msg.url}, vibrate: [120, 60, 120]
    });
  }));
});

// Tapping a pop-up opens the app at the right screen.
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  const url = new URL('./' + (d.url || ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
