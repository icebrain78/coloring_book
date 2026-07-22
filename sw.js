/*
 * 서비스워커: 네트워크 우선 + 오프라인 캐시 대체.
 * 온라인이면 항상 서버의 최신 파일을 쓰고 캐시를 갱신하며,
 * 오프라인일 때만 캐시로 동작한다. (캐시 우선 방식은 업데이트가
 * 폰에 전달되지 않는 문제가 있어 v3부터 네트워크 우선으로 변경)
 */
const CACHE = "coloring-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./css/style.css",
  "./js/artworks.js",
  "./js/photo.js",
  "./js/cloud-config.js",
  "./js/cloud.js",
  "./js/engine.js",
  "./js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
