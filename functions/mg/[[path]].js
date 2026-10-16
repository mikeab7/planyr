/* /mg/<server>/<COUNTY>/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for Flagship GIS's Autodesk MapGuide parcel layers
 * (B2302785). Alabama's 26 Flagship counties publish parcels ONLY through MapGuide; every Planyr consumer speaks ArcGIS REST, so this
 * route answers `?f=json` layer metadata and `/query` in the ArcGIS shape and the county is wired with a plain `layerUrl`.
 * All translation is the pure `src/shared/gis/mapguideAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the upstream call is the county's own PUBLIC viewer search endpoint
 * (`…/rest/library/<COUNTY>/3_LAYERS/Parcels.LayerDefinition/features.geojson`) with NO key, session, cookie or token — exactly what an
 * anonymous visitor's browser sends. A 401/403 is reported as an error; nothing here fabricates, replays or bypasses a credential.
 * The server is chosen from a fixed list (MG_SERVERS) and the county is validated to ^[A-Z]{3,20}$, so this is not an open relay. */
import {
  parseMgPath, arcQueryToMg, mgFeaturesUrl, mgToArcQuery, layerMetadata, arcError, MG_SERVERS,
} from "../../src/shared/gis/mapguideAdapter.js";

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
  const parsed = parseMgPath(segs);
  if (parsed.error) return json(arcError(404, parsed.error), 404);

  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (method === "POST") {
    try { for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v; } catch (_) { return json(arcError(400, "unreadable request body"), 400); }
  }

  const base = mgFeaturesUrl(parsed.server, parsed.county);
  try {
    if (parsed.op === "meta") return json(layerMetadata(parsed.county), 200, "public, max-age=3600"); // static — see MG_CORE_FIELDS

    let q;
    try { q = arcQueryToMg(params); } catch (e) {
      if (e && e.mgBadRequest) return json(arcError(400, e.message), 200); // ArcGIS reports a bad query as HTTP 200 + {error}
      throw e;
    }
    const qs = new URLSearchParams(q.params).toString();
    const res = await upstream(`${base}?${qs}`);
    if (!res.ok) return json(arcError(502, `The county MapGuide server answered ${res.status}.`), 502);
    const text = await res.text();
    let gj;
    try { gj = JSON.parse(text); } catch (_) { return json(arcError(502, "The county MapGuide server returned an unreadable answer."), 502); }
    return json(mgToArcQuery(gj, q), 200, "public, max-age=300");
  } catch (_e) {
    return json(arcError(502, `Upstream MapGuide request to ${MG_SERVERS.includes(parsed.server) ? "fgis-map-" + parsed.server : "the county"} failed or timed out.`), 502);
  }
}
