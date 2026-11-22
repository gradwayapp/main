// Offline support for the app shell. The campus list is fetched fresh when
// online (like the iPhone app) and falls back to the last copy offline.
// Map tiles and searches are never cached here.

const VERSION = "gradway-web-v13";
const SHELL = [
  "./",
  "index.html",
  "config.js",
  "css/app.css",
  "js/app.js",
  "js/data.js",
  "js/search.js",
  "js/map.js",
  "js/route.js",
  "js/weather.js",
  "js/hours.js",
  "js/analytics.js",
  "privacy.html",
  "terms.html",
  "css/legal.css",
  "js/store.js",
  "js/icons.js",
  "js/states.js",
  "data/us-states.json",
  "vendor/maplibre-gl.js",
  "vendor/maplibre-gl.css",
  "data/campus.sample.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Campus list: network first, cached copy when offline.
  if (url.pathname.endsWith("campus.json")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App files: the newest version from the network, the saved copy when offline.
  // (Network first, so a new deploy shows up on the next load, not the one after.)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("index.html")))
    );
  }
});
