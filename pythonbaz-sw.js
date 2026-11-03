/* Cache the fixed-version Pyodide distribution after a successful download. */
const CACHE_NAME = "pythonbaz-pyodide-0.29.5";
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function isPyodideAsset(url) {
  if (url.hostname === "cdn.jsdelivr.net") {
    return url.pathname.startsWith("/pyodide/v0.29.5/full/") ||
      url.pathname.startsWith("/npm/pyodide@0.29.5/");
  }
  if (url.hostname === "unpkg.com") return url.pathname.startsWith("/pyodide@0.29.5/");
  return false;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !isPyodideAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === "opaque") {
        try { await cache.put(event.request, response.clone()); } catch (_) {}
      }
      return response;
    } catch (error) {
      const fallback = await cache.match(event.request);
      if (fallback) return fallback;
      throw error;
    }
  })());
});
