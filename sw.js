// Trem Forge — Service Worker
// Cache-first para estáticos (imagens, css, js, fontes), network-first para
// navegação (HTML), com fallback offline. Não intercepta chamadas para
// /.netlify/functions/* (API/login/pagamentos sempre precisam de rede real).

const VERSION = "tf-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/images/icon-192.png",
  "/images/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("tf-") && key !== STATIC_CACHE && key !== PAGES_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Nunca cachear chamadas de API/backend (auth, pagamentos, chat, etc.)
  if (url.pathname.startsWith("/.netlify/functions/")) return;
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir uma página) -> tenta rede, cai pro cache, cai pro shell offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGES_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // Estáticos (imagens, css, js, fontes locais) -> cache-first
  if (["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
