/* /api/mapillary/* — same-origin Mapillary Graph proxy (B308).
 *
 * Cloudflare Pages Function. Holds the Mapillary access token as an encrypted Pages
 * Secret (env.MAPILLARY_TOKEN, Production) so the "Poles & hydrants from street imagery"
 * layer works for EVERY visitor without a per-browser token — and the token never reaches
 * the public JS bundle or any client request URL (the KEY DECISION "Mapillary token is a
 * secret"; resolves the audit's token-in-bundle + token-in-URL findings).
 *
 *   GET /api/mapillary/map_features?fields=id,object_value,geometry&bbox=w,s,e,n&limit=500
 *     → the Mapillary Graph JSON (token injected server-side)
 *
 * Dormant-graceful: if MAPILLARY_TOKEN is unset (e.g. a Preview deploy, which doesn't have
 * the secret today), this returns a clear 503 with an empty `data` array — the client
 * degrades to "street imagery isn't available here", never a hard error. The token is read
 * from the Functions runtime binding `context.env`, NEVER `import.meta.env`/a VITE_* var.
 */
import { buildUpstreamUrl, isAllowedOrigin } from "./_proxy.js";

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const url = new URL(request.url);

  // Don't be an open gateway: reject a foreign Origin (same-origin GETs omit Origin → ok).
  if (!isAllowedOrigin(request.headers.get("Origin"), url.host)) return json({ error: "forbidden", data: [] }, 403);

  // Server-side token only. Absent → dormant, graceful (the client shows "not available here").
  const token = env && env.MAPILLARY_TOKEN;
  if (!token) return json({ data: [], error: "Street imagery isn't configured in this environment." }, 503);

  // [[path]] catch-all → the Graph path (e.g. "map_features"); allow-listed in buildUpstreamUrl.
  const path = Array.isArray(params && params.path) ? params.path.join("/") : String((params && params.path) || "");
  const upstream = buildUpstreamUrl(path, url.searchParams, token);
  if (!upstream) return json({ error: "Unsupported Mapillary request.", data: [] }, 400);

  // Briefly edge-cache identical bbox requests to cut quota (token is NOT part of the key).
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let resp;
  try { resp = await fetch(upstream); }
  catch (e) { return json({ error: `Mapillary unreachable: ${(e && e.message) || e}`, data: [] }, 502); }

  let body = {};
  try { body = await resp.json(); } catch (_) { /* non-JSON upstream */ }
  if (!resp.ok) return json({ error: `Mapillary HTTP ${resp.status}`, data: [] }, resp.status);

  // Never reflect the token; return only Mapillary's JSON, with a short cache window.
  const out = json(body, 200, { "cache-control": "public, max-age=300" });
  try { context.waitUntil(cache.put(cacheKey, out.clone())); } catch (_) { /* cache optional */ }
  return out;
}
