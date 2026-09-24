/* /gis-proxy/<host>/<rest of path> — same-origin pass-through for a county/regional GIS server
 * that sends NO Access-Control-Allow-Origin header at all (NEW-1, 2026-09-24).
 *
 * Distinct from the B445 `/api/gis-cache/*` proxy (a Drive-backed RASTER IMAGERY cache, keyed by a
 * base64url-encoded full URL): this is a plain host+path relay, GET and POST, for ArcGIS REST
 * vector/JSON endpoints on a hard-coded allow-list of hosts — never cached beyond a short
 * same-response Cache-Control, never Drive-backed. First host: www.sgrcmaps.com (Southern Georgia
 * Regional Commission), which publishes Tift County's parcel layer and answers with no CORS
 * headers at all — measured 2026-09-24 from Michael's Chrome at the planyr.io origin: the layer
 * opens fine when fetched directly, but the identical fetch from planyr.io fails with no ACAO
 * header. A server has no cross-origin restriction, so relaying it here is what makes the county
 * reachable from the app at all.
 *
 * Cloudflare Pages Function — deploys automatically with the site build; no wrangler.toml, no env
 * var. Route: /gis-proxy/<host>/<rest of path>?<query>.
 */

// Exact hostnames only — never a pattern. Extend here as a new CORS-blocked regional/county host
// is wired (see docs/STATEWIDE-PARCELS.md's "GIS pass-through" section).
export const ALLOWED_HOSTS = new Set([
  "www.sgrcmaps.com", // Southern Georgia Regional Commission — Tift + 10 sibling GA counties
  "mgrcmaps.org", // Middle Georgia Regional Commission
  "maps.crc.ga.gov", // Coastal Regional Commission (not yet wired to a county)
]);

const UPSTREAM_TIMEOUT_MS = 20000;
const USER_AGENT = "planyr-gis-proxy";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/* Validate + build the upstream URL from the catch-all path segments (first segment is the
 * target host) and the incoming query string. Returns { url, host } or { error: Response }.
 * Pure — no network, no globals — so it unit-tests standalone. */
export function resolveUpstream(segs, search) {
  const [host, ...rest] = segs;
  if (!host || !ALLOWED_HOSTS.has(host)) return { error: jsonResponse({ error: "host not allowed" }, 403) };
  if (rest.some((s) => s === ".." || s.includes(".."))) return { error: jsonResponse({ error: "invalid path" }, 400) };
  const qs = search && search !== "?" ? search : "";
  const url = `https://${host}${rest.length ? "/" + rest.join("/") : ""}${qs}`;
  return { url, host };
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const reqUrl = new URL(request.url);
  const p = context.params && context.params.path;
  const segs = (Array.isArray(p) ? p : String(p || "").split("/")).filter(Boolean);
  const resolved = resolveUpstream(segs, reqUrl.search);
  if (resolved.error) return resolved.error;

  const headers = { "user-agent": USER_AGENT };
  // Never forward the client's own cookies or Authorization — this relays a PUBLIC GIS endpoint,
  // not an authenticated one, and neither header belongs to the upstream host anyway.
  let body;
  if (method === "POST") {
    body = await request.arrayBuffer();
    headers["content-type"] = request.headers.get("content-type") || "application/x-www-form-urlencoded";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(resolved.url, { method, headers, body, signal: ctrl.signal });
  } catch (_e) {
    return jsonResponse({ error: `Upstream GIS request to ${resolved.host} failed or timed out.`, host: resolved.host }, 502);
  } finally {
    clearTimeout(timer);
  }

  // Pass through the body + Content-Type; deliberately copy NOTHING else from the upstream
  // response headers — that is what strips Set-Cookie (never present) and any other upstream
  // header this relay has no reason to forward. Cache only a genuine 200; an error is never cached.
  const outHeaders = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) outHeaders.set("content-type", ct);
  outHeaders.set("cache-control", res.status === 200 ? "public, max-age=300" : "no-store");
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
