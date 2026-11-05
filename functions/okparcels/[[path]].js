/* /okparcels/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for the State of Oklahoma's statewide parcel mosaic (B2497472).
 * The state publishes it as the WMS layer `ogi_wms:Statewide_Parcels` on okmaps.org; its GetFeatureInfo answers "what is at this point"
 * with the lot's polygon and attributes. Every Planyr consumer speaks ArcGIS REST, so this route answers `?f=json` layer metadata and
 * `/query` in the ArcGIS shape and a county is wired with a plain `layerUrl` + `scopeWhere` (county='Mayes').
 * All translation is the pure `src/shared/gis/okParcelsAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the one upstream call is the public WMS GetFeatureInfo on the one public layer, with NO key,
 * session, cookie or token — what an anonymous visitor's map client sends. A 401/403 is reported as an error; nothing here fabricates,
 * replays or bypasses a credential, and the `ogi_secure` workspaces on the same server are never named. Host, layer and operation are
 * constants in the adapter, so this is not an open relay.
 *
 * RELIABILITY (measured 2026-10-29): the server answered 502/522/525 for ~40 minutes, and again for minutes at a time later, and
 * returns an occasional 502 under a heavy window. One retry after a short pause covers the blips; a longer outage is reported as a 502
 * with a plain message — LOUD-FAILURE: never an empty list that would read as "no such parcel". */
import { parseOkPath, arcQueryToOk, okUpstreamUrl, okToArcQuery, layerMetadata, arcError } from "../../src/shared/gis/okParcelsAdapter.js";

const UPSTREAM_TIMEOUT_MS = 22000;
const RETRY_PAUSE_MS = 700;
const USER_AGENT = "planyr-gis-proxy";

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

async function once(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try { return await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
/* Two attempts: a 5xx or a timeout earns one more try; a 4xx is an answer. */
async function upstream(url) {
  let last = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await once(url);
      if (res.status < 500) return res;
      last = res;
    } catch (_e) { last = null; }
    if (i === 0) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
  }
  return last;
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return json(arcError(405, "method not allowed"), 405);

  const p = context.params && context.params.path;
  const segs = (Array.isArray(p) ? p : String(p || "").split("/")).filter(Boolean);
  const parsed = parseOkPath(segs);
  if (parsed.error) return json(arcError(404, parsed.error), 404);

  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (method === "POST") {
    try { for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v; } catch (_) { return json(arcError(400, "unreadable request body"), 400); }
  }

  try {
    if (parsed.op === "meta") return json(layerMetadata(), 200, "public, max-age=3600"); // static — see OK_FIELDS

    let q;
    try { q = arcQueryToOk(params); } catch (e) {
      if (e && e.mgBadRequest) return json(arcError(400, e.message), 200); // ArcGIS reports a bad query as HTTP 200 + {error}
      throw e;
    }
    const res = await upstream(okUpstreamUrl(q));
    if (!res || !res.ok) return json(arcError(502, `The Oklahoma statewide parcel server answered ${res ? res.status : "no response"}.`), 502);
    const text = await res.text();
    let gj;
    try { gj = JSON.parse(text); } catch (_) { return json(arcError(502, "The Oklahoma statewide parcel server returned an unreadable answer."), 502); }
    if (!gj || !Array.isArray(gj.features)) return json(arcError(502, "The Oklahoma statewide parcel server returned an unexpected answer."), 502);
    return json(okToArcQuery(gj, q), 200, "public, max-age=300");
  } catch (_e) {
    return json(arcError(502, "The request to the Oklahoma statewide parcel server failed or timed out."), 502);
  }
}
