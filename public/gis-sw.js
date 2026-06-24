/* Planyr GIS imagery service worker (B438).
 *
 * Caches the county/agency map IMAGERY (FEMA flood, wetlands, utilities, basemap tiles) so a
 * saved site's layers paint INSTANTLY from a stored copy and SURVIVE a server outage. Those
 * hosts don't send CORS headers, so their export images come back as OPAQUE responses — only a
 * service worker, via the Cache API, can store and replay them (a normal fetch can't read them).
 *
 * SAFETY: this SW touches ONLY cross-origin ArcGIS image/tile requests. Every same-origin
 * request — the app's HTML, JS, CSS, /api/* calls — is passed straight through (no respondWith),
 * so it can NEVER serve a stale app bundle. The matcher below is an inlined copy of
 * src/workspaces/site-planner/lib/gisSwRules.js (a public/ file can't import bundled modules) —
 * keep the two in sync; test/gisSwRules.test.js locks the behaviour down.
 *
 * Screening-only: SWR always revalidates in the background, so a shown copy is at most one
 * view-load stale; a precise "as of Xm ago" age badge for these layers is a tracked follow-up.
 */

const GIS_CACHE = "planyr-gis-v1";
const MAX_ENTRIES = 120; // opaque responses pad storage quota heavily — keep the cap modest

// --- inlined copy of gisSwRules.isCacheableGisRequest (keep in sync) ---
function isCacheableGisRequest(urlStr, selfOrigin) {
  let u;
  try { u = new URL(urlStr); } catch (_) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.origin === selfOrigin) return false; // never the app's own origin
  const p = u.pathname;
  return (
    /\/(MapServer|ImageServer)\/(export|exportImage)\b/i.test(p) ||
    /\/(MapServer|ImageServer)\/tile\/\d+\/\d+\/\d+/i.test(p) ||
    /\/tile\/\d+\/\d+\/\d+(?:$|[.?])/i.test(p)
  );
}

self.addEventListener("install", () => {
  // Take over as soon as installed — the old SW (if any) is dropped on activate.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop superseded cache versions so a rules bump can't strand stale entries.
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.indexOf("planyr-gis-") === 0 && n !== GIS_CACHE).map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Anything that isn't cross-origin GIS imagery is left entirely alone (app assets, API, …).
  if (!isCacheableGisRequest(req.url, self.location.origin)) return;
  event.respondWith(staleWhileRevalidate(req, event));
});

async function staleWhileRevalidate(req, event) {
  let cache;
  try { cache = await caches.open(GIS_CACHE); } catch (_) { return fetch(req); }
  const cached = await cache.match(req).catch(() => null);

  const network = fetch(req)
    .then(async (res) => {
      // Cache an OK response, or an OPAQUE one (status 0 / type "opaque") — expected for the
      // non-CORS gov hosts. A network error rejects and is swallowed below.
      if (res && (res.ok || res.type === "opaque")) {
        try { await cache.put(req, res.clone()); await trim(cache); } catch (_) {}
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network); // refresh in the background; keep the SW alive for it
    return cached;            // instant paint
  }
  const fresh = await network;
  return fresh || cached || Response.error();
}

async function trim(cache) {
  let keys;
  try { keys = await cache.keys(); } catch (_) { return; }
  if (keys.length <= MAX_ENTRIES) return;
  const drop = keys.slice(0, keys.length - MAX_ENTRIES); // oldest first (insertion order)
  await Promise.all(drop.map((k) => cache.delete(k).catch(() => {})));
}
