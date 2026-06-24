/* Planyr GIS imagery service worker — RETIRED (B439 supersedes B438).
 *
 * The browser-side imagery cache was replaced by a server-side, cross-device cache (the durable
 * copy lives in Google Drive, served via /api/gis-cache/*), because a per-browser cache doesn't
 * follow you between computers and isn't the professional home for "don't depend on a down
 * government server."
 *
 * This file is now a TOMBSTONE: any browser that previously installed the old worker fetches
 * this updated copy, which deletes the old caches and unregisters itself, leaving no service
 * worker behind. It intercepts nothing (no fetch handler), so it can never serve a stale asset.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.indexOf("planyr-gis-") === 0).map((n) => caches.delete(n)));
    } catch (_) { /* best-effort cleanup */ }
    try { await self.registration.unregister(); } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
  })());
});
