// Service worker for the RHS Band Attendance PWA.
//
// Strategy:
//   - Navigations (the app shell) are network-first, so reopening the app
//     always gets fresh code and only falls back to the cached shell offline.
//     This avoids the classic "stale white screen" bug when a PWA is reopened.
//   - Hashed build assets under /assets/ are immutable, so they're cache-first.
//   - Everything else (logos, manifest) uses stale-while-revalidate.

const CACHE = "rhs-band-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/",
          "/manifest.webmanifest",
          "/apple-touch-icon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/icon-maskable-192.png",
          "/icon-maskable-512.png",
        ])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App navigations: network first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() =>
          caches
            .match("/")
            .then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // Hashed build assets are immutable: serve from cache when available.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached || network;
      })
    );
    return;
  }

  // Other same-origin requests: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
