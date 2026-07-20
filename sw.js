/* 東久留米ごみナビ Service Worker（オフライン対応）
 *
 * 方針: 同一オリジンの GET はすべて network-first。
 *   オンライン時は必ず最新を取得してキャッシュを更新し、オフライン時のみ
 *   キャッシュへフォールバックする。これにより、プログラム（HTML/JS/CSS）と
 *   データ（JSON）のバージョンがズレて壊れる問題を防ぐ。
 *
 * 注意: VERSION を変えると新しい Service Worker として認識され、install→
 *   activate で古いキャッシュが破棄される。配信内容を更新したら必ず上げること。
 */
const VERSION = "gomi-v3";
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
    caches.open(VERSION)
      // 事前キャッシュ（失敗しても install は継続）
      .then((cache) => Promise.allSettled(APP_SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
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

  // network-first: オンラインなら最新を返しつつキャッシュ更新、失敗時はキャッシュ
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
