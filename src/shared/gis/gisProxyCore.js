/* Pure helpers for the same-origin GIS imagery cache proxy (B445).
 *
 * Plain-English: the county/agency map layers (FEMA flood, wetlands, city utilities) are drawn
 * on THEIR servers and streamed back as pictures. Those servers go down, and they don't send
 * the headers a browser needs to copy their pictures. So instead of the map asking the county
 * directly, it asks OUR server (`/api/gis-cache/…`), which fetches the picture once, keeps a
 * durable copy in Google Drive, refreshes it quietly in the background, and keeps serving the
 * saved copy when the county is down. A server has no cross-origin restriction, so it CAN copy
 * the picture — which is exactly why this moves off the browser.
 *
 * This module is the SHARED, dependency-free core used on BOTH sides of that seam:
 *   - the client (layerRequest.js) calls `proxyServiceUrl()` to point a layer at the proxy;
 *   - the Cloudflare Function (functions/api/gis-cache/[[path]].js) calls `parseUpstream()` to
 *     turn the incoming proxy path back into the real upstream URL, `cacheKey()` to name the
 *     Drive copy, and `freshness()` to decide when to refresh.
 * No DOM, no Cloudflare, no network — it unit-tests in plain Node (test/gisProxyCore.test.js),
 * which is the single source of truth keeping the two sides in lockstep.
 */

// How long a stored copy is served before a background refresh is kicked off. The copy is ALWAYS
// served instantly (even when far older) — this only governs when we bother re-asking the county.
// A day is plenty for screening overlays that change rarely; the copy still refreshes on any view
// once it crosses this, and survives an outage indefinitely in the meantime.
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Open-proxy guard: ONLY these upstream hosts may be fetched, so this can't be turned into a
// general-purpose image relay. Covers the agencies the layers actually use (Esri basemaps/world
// services, FEMA, USFWS wetlands, USGS, EPA, Texas state + TNRIS, Houston + the Gulf-coast
// counties). Matched against the decoded upstream host. Extend alongside counties.js layer hosts.
// B518: hctx.net (HCFCD ROW raster), nationalmap.gov (USGS 3DEP elevation), harcresearch.org
// (HARC MUD boundaries) were missing, so those raster overlays 400'd at the proxy and never got
// B445 outage caching (they fell back to a direct uncached fetch every paint). Added here.
export const ALLOWED_GIS_HOST_RE =
  /(?:^|\.)(?:arcgis\.com|arcgisonline\.com|fema\.gov|fws\.gov|usgs\.gov|epa\.gov|texas\.gov|tnris\.org|tx\.gov|houstontx\.gov|harriscountytx\.gov|hcfcd\.org|fortbendcountytx\.gov|fbcad\.org|chambers-county\.com|h-gac\.com|hctx\.net|nationalmap\.gov|harcresearch\.org)$/i;

/* URL-safe base64 (no +,/,= so it survives a URL path segment untouched). The values encoded
 * here are plain ASCII https URLs, so btoa/atob (present in browsers, Cloudflare Workers, and
 * Node ≥16) are sufficient — no Node Buffer needed. */
export function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/* The proxy base path a layer points at. esri-leaflet appends `/export?…` (or `?f=json`) to
 * this, producing `/api/gis-cache/svc/<b64>/export?…`. The service URL is base64url-encoded into
 * ONE path segment so esri's trailing-slash/clean-url handling can't mangle it. */
export function proxyServiceUrl(serviceUrl, base = "/api/gis-cache") {
  return `${base}/svc/${b64urlEncode(String(serviceUrl))}`;
}

/* Server side: turn the incoming proxy path segments + (already meta-stripped) query string back
 * into the real upstream URL. `segs` is the catch-all path split on "/" (e.g.
 * ["svc","<b64>","export"]). Returns { url, host } or null when the shape/host isn't allowed —
 * the caller then refuses (never an open relay). Pure. */
export function parseUpstream(segs, search = "") {
  if (!Array.isArray(segs) || segs[0] !== "svc" || segs.length < 2) return null;
  let base;
  try { base = b64urlDecode(segs[1]); } catch (_) { return null; }
  let u;
  try { u = new URL(base); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (!ALLOWED_GIS_HOST_RE.test(u.host)) return null;
  const tail = segs.slice(2).filter(Boolean).join("/");          // e.g. "export"
  const qs = search ? (search[0] === "?" ? search : `?${search}`) : "";
  const url = base.replace(/\/+$/, "") + (tail ? `/${tail}` : "") + qs;
  return { url, host: u.host };
}

/* A short, stable, Drive-filename-safe name for the upstream URL (the cache key). Same URL —
 * same bbox/size/layers — always maps to the same key, so reopening a saved site's view is a
 * cache hit. A 32-bit FNV-1a hash in hex is collision-safe enough for a per-user imagery cache
 * and keeps names tiny. Pure. */
export function cacheKey(upstreamUrl) {
  let h = 0x811c9dc5;
  const s = String(upstreamUrl);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `gis_${h.toString(16).padStart(8, "0")}`;
}

/* Decide whether a stored copy is due for a background refresh, and its age. `tsMs` is the
 * copy's stored time (ms epoch); a non-number means "no copy". Pure. */
export function freshness(tsMs, nowMs, ttlMs = DEFAULT_TTL_MS) {
  if (typeof tsMs !== "number" || !isFinite(tsMs)) return { stale: true, ageMs: null };
  const ageMs = Math.max(0, nowMs - tsMs);
  return { stale: ageMs > ttlMs, ageMs };
}
