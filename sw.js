/* 東久留米ごみナビ Service Worker（Phase 2 オフライン対応）
 * アプリシェルとデータJSONをキャッシュ。データは network-first（更新を拾いつつ
 * オフライン時はキャッシュへフォールバック）、静的アセットは cache-first。
 */
const VERSION = "gomi-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/styles.css",
  "./assets/logic.js",
  "./assets/app.js",
  "./assets/icon.svg",
  "./data/items.json",
  "./data/schedule.json",
  "./data/special_days.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isData = url.pathname.includes("/data/");
  if (isData) {
    // network-first
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else {
    // cache-first
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
  }
});
