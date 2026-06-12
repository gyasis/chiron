/* Chiron Player — service worker.
 *
 * Two jobs:
 *  1. Cache the app shell so the installed PWA works fully offline.
 *  2. Act as a LOCAL SERVER for imported lessons: any request under
 *     <scope>/lessons/<id>/... is served from the `chiron-lessons` cache,
 *     where app.js stored each file of an unzipped .chiron bundle. This makes
 *     a lesson run exactly as if hosted over HTTP — relative styles.css,
 *     main.js, audio/*.mp3, and audio/manifest.json all resolve, so none of
 *     the file:// fetch limits apply.
 */

const SHELL_CACHE = 'chiron-shell-v1';
const LESSON_CACHE = 'chiron-lessons-v1';   // written by app.js on import

const SHELL_ASSETS = [
  './',
  'index.html',
  'app.js',
  'vendor/fflate.min.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS).catch(() => {/* tolerate a missing icon */}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== LESSON_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Lesson content → serve from the lessons cache (the "local server").
  if (url.pathname.includes('/lessons/')) {
    event.respondWith(
      caches.open(LESSON_CACHE)
        .then((cache) => cache.match(event.request, { ignoreSearch: true }))
        .then((hit) => hit || new Response('Lesson asset not found', { status: 404 })),
    );
    return;
  }

  // App shell → cache-first, fall back to network (offline-capable).
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
