/* CookMyFridge service worker: offline-first app shell, data caching and a
   virtual /calendar.ics subscription endpoint served from Cache Storage. */
const CACHE_NAME = "cmf-cache-20261107094025";
const CALENDAR_CACHE = "cmf-calendar-v1";
const CALENDAR_PATH = "calendar.ics";
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
  "js/goals.js",
  "js/balance.js",
  "js/qrcode.js",
  "js/diets.js",
  "js/seasonal.js",
  "js/prices.js",
  "js/journal.js",
  "js/inventory.js",
  "js/inventory-ui.js",
  "js/weather.js",
  "js/voice.js",
  "js/foodfacts.js",
  "js/tools.js",
  "js/share.js",
  "js/nlparse.js",
  "js/cleanout.js",
  "js/planner.js",
  "js/stats.js",
  "js/pairings.js",
  "js/sync.js",
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

function emptyCalendar() {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CookMyFridge//Meal Plan//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CookMyFridge 菜单（尚未生成）",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

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
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== CALENDAR_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Subscription URL: no file is deployed, the page publishes the current
  // menu's ICS into CALENDAR_CACHE and this endpoint serves it. Returning an
  // empty (but valid) calendar keeps calendar clients subscribed instead of
  // treating a 404 as a broken feed.
  if (new URL(request.url).pathname.endsWith("/" + CALENDAR_PATH)) {
    event.respondWith(
      caches
        .open(CALENDAR_CACHE)
        .then((cache) => cache.match(request))
        .then((cached) => cached || new Response(emptyCalendar(), {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        }))
    );
    return;
  }

  const isPageShell = CORE_ASSETS.some((asset) => asset.endsWith(".html") &&
    new URL(asset, self.location.href).pathname === new URL(request.url).pathname);
  event.respondWith(
    caches.match(request, { ignoreSearch: isPageShell }).then((cached) => {
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
