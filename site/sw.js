/* CookMyFridge service worker: offline-first app shell and data caching. */
const CACHE_NAME = "cmf-cache-20261107042206";
const CORE_ASSETS = [
  "index.html",
  "result.html",
  "recipe.html",
  "wildcard.html",
  "fridge.html",
  "about.html",
  "manifest.webmanifest",
  "icon.svg",
  "css/style.css",
  "js/store.js",
  "js/catalog.js",
  "js/search.js",
  "js/nutrition.js",
  "js/nlparse.js",
  "js/cleanout.js",
  "js/planner.js",
  "js/stats.js",
  "js/pairings.js",
  "js/ui.js",
  "js/page-home.js",
  "js/page-result.js",
  "js/page-recipe.js",
  "js/page-wildcard.js",
  "js/page-fridge.js",
  "js/page-browse.js",
  "js/page-planner.js",
  "js/page-stats.js",
  "data/catalog.json",
  "data/recipes.json",
  "data/vocab.json",
  "data/ai/wildcards.json",
  "data/ai/blindboxes.json",
  "data/ai/variants.json",
  "data/ai/ideas.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("index.html"));
    })
  );
});
