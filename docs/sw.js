// The app opens straight from the phone's saved copy (instant, works with no signal) and refreshes that copy in the
// background. A new release is downloaded completely before the app switches to it (see checkUpdate in app.js), so the
// screen is never blank while the network is slow and never mixes old and new files.
// Also shows the phone pop-ups that arrive from the server (Firebase Cloud Messaging) - by itself, without the Firebase
// library, so it works the same on Android and iPhone and even when the app is closed.
const CACHE = 'rcal-v71';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'config.js', 'manifest.webmanifest', 'icons/redefine-logo.png', 'icons/icon-192.png', 'icons/team-mark.png'];
const IOS = /iphone|ipad|ipod|macintosh/i.test(self.navigator.userAgent) && /safari/i.test(self.navigator.userAgent) && !/chrome|crios|android/i.test(self.navigator.userAgent);
function fill(cache) {   // fresh copies of every app file, straight from the server (never the browser's own cache)
  return Promise.all(FILES.map(f => fetch(new Request(f, {cache: 'reload'})).then(r => { if (r.ok) return cache.put(f, r); }).catch(() => {})));
}
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(fill)); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => /^rcal-/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || /version\.json$/.test(url.pathname)) return;
  const nav = e.request.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(cache => cache.match(e.request, {ignoreSearch: true}).then(hit => {
    const net = fetch(e.request, {cache: 'no-cache'}).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }               // instant: saved copy now, fresh copy for next time
    return net.catch(() => nav ? cache.match('index.html').then(r => r || cache.match('./')) : Response.error());
  })));
});
// app.js asks for this when version.json shows a new release: download everything, then it reloads once
self.addEventListener('message', e => {
  if (!e.data || !e.data.rcalRefresh) return;
  const port = e.ports && e.ports[0];
  e.waitUntil(caches.open(CACHE).then(fill).then(() => { if (port) port.postMessage({done: true}); }));
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
