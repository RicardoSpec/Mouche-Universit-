/* Coach Muscu — service worker.
   Stratégie RÉSEAU D'ABORD : en ligne, on sert toujours la version fraîche (et on met le cache à jour) ;
   hors-ligne, on sert la dernière version vue. ignoreSearch permet au cache de matcher malgré les ?v=N. */
var CACHE = "coachmuscu-runtime-v69";

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; /* on ne gère que nos propres fichiers */
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) {
        if (m) return m;
        if (req.mode === "navigate") return caches.match("index.html", { ignoreSearch: true });
      });
    })
  );
});
