/* Chiron Library SW. Caches the app SHELL (installable PWA) and serves
 * DOWNLOADED lessons (lessons/dl-<slug>/…, written by library.js via fflate) for
 * offline. The hub catalog (lessons/*.chiron, lessons/lessons.json) and not-yet-
 * downloaded lessons go to the network. Removing a download clears only the cache. */
const SHELL = 'chiron-lib-shell-v5';   // bump busts the old cached shell (library.js) so browsers fetch the new UI
const LESSON = 'chiron-lib-lessons-v1';   // written by library.js on Download
const ASSETS = [
  './', 'index.html', 'library.js', 'vendor/fflate.min.js',
  'library.config.json', 'library.index.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== LESSON).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.includes('/chiron-library/')) return;            // out of scope (e.g. ../lesson dirs streamed from hub)
  if (url.pathname.includes('/lessons/dl-')) {                       // a DOWNLOADED (offline) lesson asset
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request)));
    return;
  }
  // shell + catalog: network-first (fresh), fall back to cache offline
  e.respondWith(
    fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((s) => s.put(e.request, c).catch(() => {})); return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
