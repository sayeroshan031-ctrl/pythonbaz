/* PythonBaz service worker v4 — makes the app and the Python engine work offline.
   © 2026 Mohammadreza Hosseinzadeh (محمدرضا حسین‌زاده). All rights reserved.

   - App shell (page, worker, manifest, icon): precached at install, served
     stale-while-revalidate so the page opens with no network at all.
   - Python engine (Pyodide): cache-first, from ./vendor/pyodide/ (own site)
     or from the pinned CDN paths. Cached the first time it is downloaded. */
const PYODIDE_CACHE = "pythonbaz-pyodide-0.29.5";
const SHELL_CACHE = "pythonbaz-shell-v4";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./pyodide-worker.js?v=3",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* One missing file must not block installation of the whole worker. */
    await Promise.allSettled(SHELL_FILES.map((file) => cache.add(file)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PYODIDE_CACHE, SHELL_CACHE]);
    for (const name of await caches.keys()) {
      if (name.startsWith("pythonbaz-") && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function isPyodideAsset(url) {
  if (url.hostname === "cdn.jsdelivr.net") {
    return url.pathname.startsWith("/pyodide/v0.29.5/full/") ||
      url.pathname.startsWith("/npm/pyodide@0.29.5/");
  }
  if (url.hostname === "unpkg.com") return url.pathname.startsWith("/pyodide@0.29.5/");
  if (url.origin === self.location.origin) return url.pathname.includes("/vendor/pyodide/");
  return false;
}

function isShellRequest(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return true;
  const scopePath = new URL(self.registration.scope).pathname;
  return SHELL_FILES.some((file) => {
    const target = new URL(file, self.registration.scope);
    return target.pathname === url.pathname;
  }) && url.pathname.startsWith(scopePath);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: request.mode !== "navigate" ? false : true });
  const network = fetch(request).then(async (response) => {
    if (response.ok) { try { await cache.put(request, response.clone()); } catch (_) {} }
    return response;
  });
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  try {
    return await network;
  } catch (error) {
    /* Offline navigation to a path we never cached: fall back to the app page. */
    const fallback = await cache.match("./index.html") || await cache.match("./");
    if (fallback) return fallback;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isPyodideAsset(url)) {
    event.respondWith(cacheFirst(request, PYODIDE_CACHE));
    return;
  }
  if (isShellRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
