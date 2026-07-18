/* /api/pfds — same-origin proxy for NOAA Atlas-14 Precipitation Frequency Data Server (B-A/NEW-B).
 *
 * Cloudflare Pages Function. The PFDS text endpoint (hdsc.nws.noaa.gov) has NO CORS, so a browser
 * XHR can't read it directly; this relays it same-origin. No secret involved — the endpoint is
 * public, unauthenticated point rainfall. Parsed client-side by lib/pfds.js parsePfdsText.
 *
 *   GET /api/pfds?lat=29.76&lon=-95.37   → the NOAA PFDS text body (text/plain)
 *
 * The upstream `/cgi-bin/hdsc/new/` path 301-redirects to `/cgi-bin/new/`; we call the resolved
 * path so there's no redirect leg. Screening data — a design reference, never a regulatory value.
 */
const NOAA_BASE = "https://hdsc.nws.noaa.gov/cgi-bin/new/fe_text_mean.csv";

const text = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } });

function sameOriginOk(origin, host) {
  if (!origin) return true; // same-origin GETs omit Origin
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (!sameOriginOk(request.headers.get("Origin"), url.host)) return text("forbidden", 403);

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  // Sanity-bound the coordinates (CONUS-ish) so we never relay an arbitrary upstream request.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 15 || lat > 55 || lon < -130 || lon > -60) {
    return text("bad or out-of-range lat/lon", 400);
  }

  const upstream = `${NOAA_BASE}?lat=${lat}&lon=${lon}&data=depth&units=english&series=pds`;

  // Edge-cache identical points (PFDS values are effectively static). Key omits Origin.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, { redirect: "follow", headers: { "user-agent": "planyr-pfds-proxy" } });
  } catch (e) {
    return text(`PFDS upstream fetch failed: ${e && e.message ? e.message : e}`, 502);
  }
  if (!upstreamRes.ok) return text(`PFDS upstream HTTP ${upstreamRes.status}`, 502);
  const body = await upstreamRes.text();
  const res = text(body, 200, { "cache-control": "public, max-age=86400" });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
