const CACHE_NAME = 'writers-studio-v2';

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate Event - Clear all old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          console.log('[Service Worker] Removing old cache', key);
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Network-only pass-through (ensures no white screens due to stale build hashes)
self.addEventListener('fetch', (event) => {
  // Let the browser handle everything over the network.
  // This is required for PWA installability, but prevents stale cached index.html from pointing to non-existent JS hashes.
  return;
});
