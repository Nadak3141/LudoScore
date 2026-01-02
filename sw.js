const CACHE = "scorepad-cache-v1";

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./site.config.json",
  "./games.config.json",
  "./manifest.json",
  "./assets/logo-site.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(res => {
        // cache only GET same-origin assets
        try {
          const url = new URL(req.url);
          if (req.method === "GET" && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
          }
        } catch {}
        return res;
      }).catch(() => cached);
    })
  );
});
