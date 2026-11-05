/* /gc/<key>/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for the public GIS Cloud maps two Missouri counties (Clinton, Hickory) keep their
 * parcels on. All translation is the pure `src/shared/gis/giscloudAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the upstream call is GIS Cloud's own public REST API (`api.giscloud.com/1/layers/<id>/features.json`) with NO key,
 * session, cookie or token — exactly what an anonymous visitor to the county's public map gets. The layer is chosen from a fixed table (GC_MAPS), and only the
 * `where` shapes the adapter validates plus a bounding box ever reach GIS Cloud, so this is not an open relay and not a free-SQL pass-through. */
import {
  parseGcPath, arcQueryToGc, gcFeaturesUrl, gcToArcQuery, layerMetadata, arcError, GC_MAPS,
} from "../../src/shared/gis/giscloudAdapter.js";

const UPSTREAM_TIMEOUT_MS = 20000;
const USER_AGENT = "planyr-gis-proxy";

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

async function upstream(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return json(arcError(405, "method not allowed"), 405);

  const p = context.params && context.params.path;
  const segs = (Array.isArray(p) ? p : String(p || "").split("/")).filter(Boolean);
  const parsed = parseGcPath(segs);
  if (parsed.error) return json(arcError(404, parsed.error), 404);

  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (method === "POST") {
    try { for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v; } catch (_) { return json(arcError(400, "unreadable request body"), 400); }
  }

  try {
    if (parsed.op === "meta") return json(layerMetadata(parsed.key), 200, "public, max-age=3600"); // static — see GC_MAPS.fields

    let q;
    try { q = arcQueryToGc(params, parsed.key); } catch (e) {
      if (e && e.mgBadRequest) return json(arcError(400, e.message), 200); // ArcGIS reports a bad query as HTTP 200 + {error}
      throw e;
    }
    const qs = new URLSearchParams(q.params).toString();
    const res = await upstream(`${gcFeaturesUrl(parsed.key)}?${qs}`);
    if (!res.ok) return json(arcError(502, `The ${GC_MAPS[parsed.key].county} County map server answered ${res.status}.`), 502);
    let gj;
    try { gj = JSON.parse(await res.text()); } catch (_) { return json(arcError(502, "The county map server returned an unreadable answer."), 502); }
    return json(gcToArcQuery(gj, q), 200, "public, max-age=300");
  } catch (_e) {
    return json(arcError(502, `Upstream GIS Cloud request for ${GC_MAPS[parsed.key].county} County failed or timed out.`), 502);
  }
}
