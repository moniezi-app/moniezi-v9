/* Moniezi PWA Service Worker
   - Pre-caches minimal "app shell"
   - Dynamically caches other requests after first load
   - Offline navigation fallback to cached index.html
*/
// IMPORTANT: bump this when you deploy a new version, otherwise old cached index.html
// can reference old hashed JS assets and the app will look "broken" (blank/old UI).
// IMPORTANT: bump this whenever you deploy a new build to avoid stale cached assets.
// Bump on every deploy (prevents stale cached index.html referencing old hashed JS)
const CACHE_VERSION = "moniezi-pwa-v9-2026-01-24";
const CACHE_NAME = `moniezi-cache-${CACHE_VERSION}`;

// Resolve an asset relative to the service worker scope (works on GitHub Pages subpaths)
const toScopeUrl = (path) => new URL(path, self.registration.scope).toString();

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
].map(toScopeUrl);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(CORE_ASSETS);
      } catch (e) {
        // If some core assets fail (e.g., index.html during first install),
        // continue—dynamic caching will still make offline work after first load.
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key.startsWith("moniezi-cache-") && key !== CACHE_NAME ? caches.delete(key) : null))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests (avoid caching third-party CDN assets)
  if (url.origin !== self.location.origin) return;

  // SPA navigation: network-first, then fallback to cached index.html
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_NAME);
          // Try cached navigation request first
          const cachedNav = await cache.match(req);
          if (cachedNav) return cachedNav;

          // Fallback to cached index.html (app shell)
          const cachedIndex = await cache.match(toScopeUrl("./index.html"));
          if (cachedIndex) return cachedIndex;

          // Last resort: cached root
          const cachedRoot = await cache.match(toScopeUrl("./"));
          return cachedRoot || Response.error();
        }
      })()
    );
    return;
  }

  // Other assets: cache-first, then network + cache
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        // Cache successful, basic responses only
        if (res && res.ok && res.type === "basic") {
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })()
  );
});
