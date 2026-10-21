/* Steady service worker: offline app shell. Cache: steady-v16.
   All paths are relative so the app works under a subpath (e.g. GitHub Pages project site). */
var CACHE = "steady-v16";
var SHELL = [
  "./",
  "styles.css",
  "app.js",
  "content.js",
  "plan-data.js",
  "plan-engine.js",
  "calendar.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("./", copy); });
        return res;
      }).catch(function () { return caches.match("./"); })
    );
    return;
  }
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var refresh = fetch(e.request).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || refresh;
    })
  );
});
