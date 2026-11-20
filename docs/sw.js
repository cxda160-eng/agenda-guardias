// Service worker: guarda la app para abrirla sin conexión.
// Los datos los maneja Firebase, que también guarda una copia sin conexión.
const CACHE = "agenda-guardias-v11";
const BASE = self.registration.scope;
const SHELL = ["", "index.html", "app.js?v=11", "firebase-config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"].map((p) => BASE + p);
const FIREBASE_SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const propia = url.origin === location.origin ;
  const sdk = FIREBASE_SDK.test(e.request.url);
  if (!propia && !sdk) return;
  // Red primero; si no hay señal, lo guardado
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (propia ? caches.match(BASE + "index.html") : undefined)))
  );
});
