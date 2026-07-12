/* Testable core of the GIS imagery cache proxy (B445).
 *
 * All the request logic lives here so it unit-tests in plain Node (test/gisCacheHandler.test.js)
 * with an injected in-memory Drive client + fake fetch + clock — no Cloudflare runtime, no
 * network, no real Drive. The route ([[path]].js) is a thin wrapper that supplies the live
 * Drive client, `fetch`, and `context.waitUntil` as `defer`.
 *
 * Contract (mirrors the route): serve a durable Drive copy instantly when present; refresh it in
 * the background once past the TTL; on cache-miss fetch the agency once, serve, store in the
 * background; FAIL OPEN (302 to the real upstream) on missing creds / agency error / any
 * unexpected failure, so a layer never breaks.
 */
import { parseUpstream, cacheKey, freshness } from "../../../src/shared/gis/gisProxyCore.js";

const ALLOWED_HOST_RE = /(^|\.)planyr\.io$|(^|\.)planyr\.pages\.dev$/i;

// Some government ArcGIS hosts reject a request with no / a datacenter User-Agent. Send a
// browser-like UA on every server-side upstream fetch so they serve us like a normal client.
const UPSTREAM_HEADERS = { "user-agent": "Mozilla/5.0 (compatible; PlanyrGISCache/1.0; +https://planyr.io)" };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
// Manual 302 (not Response.redirect) so the shape is identical across Node/Workers and testable.
const redirectTo = (url) => new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
const bytesResponse = (bytes, contentType) =>
  new Response(bytes, { status: 200, headers: {
    "content-type": contentType || "application/octet-stream",
    "cache-control": "public, max-age=300",
  } });

// Same-origin (no Origin header) or our own hosts only — don't be an open image relay. Pure.
export function originOk(origin, selfHost) {
  if (!origin) return true;
  let host; try { host = new URL(origin).host; } catch (_) { return false; }
  return host === selfHost || ALLOWED_HOST_RE.test(host);
}

export async function handleGisCache({
  client, segs, search = "", origin = null, selfHost = "",
  fetchImpl = fetch, now = () => Date.now(), folderIdFor, defer = () => {},
}) {
  if (!originOk(origin, selfHost)) return json({ error: "forbidden" }, 403);

  // Pull the meta flag out before reconstructing upstream so meta + real requests share a key.
  const sp = new URLSearchParams(search);
  const metaMode = sp.get("meta") === "1";
  sp.delete("meta");

  const upstream = parseUpstream(segs, sp.toString());
  if (!upstream) return json({ error: "Unsupported GIS request." }, 400);
  const key = `${cacheKey(upstream.url)}.bin`;

  try {
    if (!client) return metaMode ? json({ cached: false }) : redirectTo(upstream.url); // no creds → live-only
    const folderId = await folderIdFor();
    const existing = await client.findFile(key, folderId).catch(() => null);

    if (metaMode) {
      if (!existing) return json({ cached: false });
      const ts = Date.parse(existing.modifiedTime) || null;
      const f = freshness(ts, now());
      return json({ cached: true, ts, ageMs: f.ageMs, stale: f.stale });
    }

    if (existing) {
      const ts = Date.parse(existing.modifiedTime) || 0;
      if (freshness(ts, now()).stale) defer(refresh(client, folderId, upstream.url, key, existing.id, fetchImpl));
      const media = await client.media(existing.id);
      return bytesResponse(media.bytes, media.contentType);
    }

    // Cache miss → fetch the agency once, serve it now, store it in the background.
    let res;
    try { res = await fetchImpl(upstream.url, { headers: UPSTREAM_HEADERS }); } catch (_) { return redirectTo(upstream.url); }
    if (!res || !res.ok) return redirectTo(upstream.url);
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    defer(store(client, folderId, key, buf, ct));
    return bytesResponse(buf, ct);
  } catch (_) {
    return metaMode ? json({ cached: false }) : redirectTo(upstream.url);
  }
}

// Create a fresh copy then drop older same-name copies (no gap for concurrent readers).
// Hard client.del is DELIBERATE here (NEW-F2): this is a regenerable public GIS cache, not
// user data — trashing stale copies would just hold Drive quota for 30 days of junk.
export async function store(client, folderId, name, bytes, contentType) {
  try {
    const created = await client.create({ bytes, contentType, name, parentFolderId: folderId });
    const dupes = (await client.list({ parentFolderId: folderId }).catch(() => [])) || [];
    for (const f of dupes) if (f.name === name && f.id !== (created && created.id)) await client.del(f.id).catch(() => {});
  } catch (_) { /* best-effort — a failed store just means the next view re-fetches */ }
}

export async function refresh(client, folderId, upstreamUrl, name, oldId, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(upstreamUrl, { headers: UPSTREAM_HEADERS });
    if (!res || !res.ok) return; // agency still down → keep the copy we already serve
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    const created = await client.create({ bytes: buf, contentType: ct, name, parentFolderId: folderId });
    if (oldId && created && created.id !== oldId) await client.del(oldId).catch(() => {});
  } catch (_) { /* best-effort background refresh */ }
}
