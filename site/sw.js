/* CookMyFridge service worker: offline-first app shell, data caching and a
   virtual /calendar.ics subscription endpoint served from Cache Storage. */
const CACHE_NAME = "cmf-cache-20261108023300";
const CALENDAR_CACHE = "cmf-calendar-v1";
const CALENDAR_PATH = "calendar.ics";
const CORE_ASSETS = [
  "index.html",
  "result.html",
  "recipe.html",
  "wildcard.html",
  "fridge.html",
  "about.html",
  "browse.html",
  "planner.html",
  "stats.html",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "css/style.css",
  "js/bundle-boot.js",
  "js/bundle-features.js",
  "js/page-home.js",
  "js/page-result.js",
  "js/page-recipe.js",
  "js/page-wildcard.js",
  "js/page-fridge.js",
  "js/page-browse.js",
  "js/page-planner.js",
  "js/page-stats.js",
  "data/core.json",
  "data/recipes.json",
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
      .then((cache) =>
        // Manual precache instead of cache.addAll: every request carries a
        // version query + no-store so a still-active OLD worker's cache-first
        // handler (and the HTTP cache) cannot feed us its stale bytes — that
        // would make every update ship old content forever. Entries are stored
        // under the plain asset URL so runtime matching is unchanged.
        Promise.all(
          CORE_ASSETS.map(async (asset) => {
            const resp = await fetch(asset + "?__cmf=" + CACHE_NAME, {
              cache: "no-store",
            });
            if (!resp.ok) throw new Error("precache failed: " + asset);
            await cache.put(asset, resp);
          })
        )
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

  const url = new URL(request.url);
  // Precache-refresh requests carry __cmf and must always hit the network,
  // or an outgoing worker's cache-first handler would poison the next cache.
  // The worker script itself is never intercepted either: caching sw.js would
  // freeze all future update checks.
  if (url.searchParams.has("__cmf") || url.pathname.endsWith("/sw.js")) {
    return;
  }

  // Subscription URL: no file is deployed, the page publishes the current
  // menu's ICS into CALENDAR_CACHE and this endpoint serves it. Returning an
  // empty (but valid) calendar keeps calendar clients subscribed instead of
  // treating a 404 as a broken feed.
  if (url.pathname.endsWith("/" + CALENDAR_PATH)) {
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

  // Page shells are network-first: they change on every deploy and a stale
  // shell would reference whatever content it shipped with. Offline (or any
  // network failure) falls back to the cached shell, matched by pathname so
  // deep links like recipe.html?id=r001 still open (see 踩坑 #58).
  if (isPageShell) {
    const pageKey = url.origin + url.pathname;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(pageKey, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
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
