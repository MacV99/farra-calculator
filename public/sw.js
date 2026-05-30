// Service worker mínimo para Farra Calculator (PWA).
// Estrategia: precache del shell + cache-first para estáticos same-origin,
// network-first para navegaciones (con fallback a la app cacheada offline).
// Sube CACHE_VERSION para invalidar el caché tras un deploy.
const CACHE_VERSION = "farra-v1";
const PRECACHE = [
  "/",
  "/favicon.png",
  "/img/icon-192.png",
  "/img/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navegaciones: red primero, cae a la app cacheada (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/", { ignoreSearch: true })),
    );
    return;
  }

  // Guarda en caché solo respuestas exitosas (evita fijar 404/500).
  const cachePut = (resp) => {
    if (resp.ok) {
      const copy = resp.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
    }
    return resp;
  };

  // Estáticos same-origin (incluye /_astro/* con hash): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then(cachePut)),
    );
    return;
  }

  // CDN (iconos/fuentes): red con fallback a caché.
  event.respondWith(
    fetch(request)
      .then(cachePut)
      .catch(() => caches.match(request)),
  );
});
