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
  /* NEW-1 (South Carolina, 2026-10-19) — the SCDOT GIS server that publishes a parcel layer for each of the 46 counties, plus county hosts a county is wired to; each MEASURED through this relay on the PR preview before use. */
  "smpesri.scdot.org", // SCDOT ArcGIS Server — GISMapping/SC_Parcels MapServer, one layer per county
  "gis1.georgetowncountysc.org", // Georgetown County
  "www.laurenscountygis.org", // Laurens County
  "gis.sumter-sc.com", // City/County of Sumter
  "www.horrycounty.org", "maps.spartanburgcounty.org", "arcserver2.oconeesc.com", "propertyviewer.andersoncountysc.org", // PROBE-TEMP
  "gis.state.sc.us", // PROBE-TEMP
  "www.sgrcmaps.com", // Southern Georgia Regional Commission — Tift + 10 sibling GA counties
  "mgrcmaps.org", // Middle Georgia Regional Commission
  "maps.crc.ga.gov", // Coastal Regional Commission (not yet wired to a county)
  /* NEW-1 (Memphis 100-mile radius) — hosts this build sandbox's egress blocks, so their CORS could not be
   * read from here; relayed server-side so the app never depends on their ACAO header. */
  "maps.memphistn.gov", // City of Memphis GIS — hosts the Shelby County Assessor parcel basemap
  "gis.shelbycountytn.gov", // Shelby County TN government GIS (Assessor_Parcel)
  "scgis.shelbycountytn.gov", // Shelby County TN GIS server — the Assessor of Property's CERTParcel service (NEW-1, Memphis radius ×2)
  "gis.capturecama.com", // CaptureCAMA (TN Comptroller's assessment system) — Chester County TN Assessor's parcel MapServer (NEW-1, Memphis radius ×3)
  "gis.mississippi.edu", // MARIS (Mississippi Automated Resource Information System) statewide cadastral
  "gis.arkansas.gov", // Arkansas GIS Office statewide parcel layer
  /* NEW-1 (Missouri, 2026-10-19, B2317680) — the county/regional hosts the wired Missouri counties sit on (each MEASURED through this relay on the PR preview before it was wired).
   * Integrity GIS runs five Geocortex pools; a county's public site lives on exactly one of them. */
  "adairgis.integritygis.com", "audraingis.integritygis.com", "barrygis.integritygis.com", "bartongis.integritygis.com", "bentongis.integritygis.com",
  "maps.semogis.com", // SEMO Regional Planning Commission — Cape Girardeau, Iron, Madison, Perry, Scott, St. Francois, Washington
  "www.midmogis.org", // Mid-Missouri RPC — Cole County
  "greenecountyassessor.org", // Greene County Assessor
  "maps.stlouisco.com", // St. Louis County GIS Service Center
  "maps6.stlouis-mo.gov", // City of St. Louis
  "gis.boonemo.gov", // Boone County GIS
  /* NEW-1 (Idaho, 2026-10-19) — county / multi-county hosts the Idaho candidates sit on (found in the State Tax Commission's "County Parcel Maps"
   * links page and each county's own viewer config). The build sandbox reaches none of them, so each is relayed and MEASURED through here before a
   * county is wired to it. */
  "maps.idahoparcels.us", // Idaho State Tax Commission's GeoMoose/MapServer parcel host (Bear Lake, Gem, Gooding, Lemhi, Owyhee, Payette, Washington viewers)
  "maps.terragis.net", // Terra GIS public viewers (Clark, Custer, Fremont)
  "gis.latah.id.us", // Latah County
  "cloudgisapps.bonnercountyid.gov", // Bonner County
  "gis.kcgov.us", // Kootenai County
  "maps.canyonco.org", // Canyon County
  "gisportal.co.jefferson.id.us", // Jefferson County
  "madison.rexburg.org", // Madison County / City of Rexburg
  "web.binghamid.gov", // Bingham County
  "server.boundarycountyid.org", // Boundary County
  "maps.blainecountyid.gov", "maps.co.blaine.id.us", // Blaine County
  "maps.bannockcounty.us", // Bannock County
  "gis.co.nezperce.id.us", // Nez Perce County
  "insideidaho.org", // INSIDE Idaho (University of Idaho / Idaho Geospatial Office)
  "gis.idaho.gov", // State of Idaho GIS portal
  "giscenter.rdc.isu.edu", "gisu.rdc.isu.edu", // Idaho State University GIS Training & Research Center
  "portal.kcgov.us", "map.kcgov.us", // Kootenai County ArcGIS portal + map server (KC_Parcel_Polygon)
  /* NEW-1 (Alabama, 2026-10-16) — county/vendor hosts the Alabama candidates sit on. The sandbox cannot reach any of
   * them, so each is relayed (CORS unread) and MEASURED through this relay before a county is wired to it. */
  "web1.kcsgis.com", "web2.kcsgis.com", "web3.kcsgis.com", "web4.kcsgis.com", "web5.kcsgis.com", "web6.kcsgis.com", // KCS GIS — Revenue Commissioner viewers (Etowah, Talladega, Cullman, Colbert, Baldwin…)
  "al52portal.kcsgis.com", // KCS GIS — Morgan County
  "maps.capturecama.com", // CaptureCAMA — Cleburne, Coosa, Russell, Monroe, Bullock, Henry, Hale, Wilcox, Sumter…
  "map.stclairco.com", // St. Clair County
  "maps.shelbyal.com", // Shelby County AL (Property Tax Office)
  "jccgis.jccal.org", "gis.jccal.org", // Jefferson County AL
  "gis.limestonecounty-al.gov", // Limestone County
  "maps.madisonal.gov", // City of Madison (Madison County layer)
  "gis.calhouncounty.org", // Calhoun County
  "explore.opelika-al.gov", // City of Opelika (Lee County layer)
  "autaugagis.autauga.com", // Autauga County
  "arcweb.houstoncountyal.gov", // Houston County AL — the county's own parcel viewer server (NEW-1, Alabama round 2)
  "www.alabamagis.com", // Flagship GIS public viewers (~21 AL counties) — probed for an open REST/OGC endpoint (NEW-1, Alabama round 2)
  "isv.kcsgis.com", // KCS GIS ISV3 viewer host (e.g. isv.kcsgis.com/al.colbert_revenue) — read to find the ArcGIS service behind a county viewer (B2312352)
  "al20portal.kcsgis.com", // KCS GIS — Colbert County (named in the county viewer's own public config.js: al20server/…/Internal/Colbert_Public_ISV, B2312352)
  /* NEW-1 (B2302785) — Flagship GIS's Autodesk MapGuide servers behind the www.alabamagis.com county viewers. Exact hostnames, one per
   * server number the viewers name (cloudURL in each county's page); read-only anonymous queries only — never a key the viewer injects. */
  /* NEW-1 (Georgia, 2026-10-19) — county / regional hosts named by the Georgia parcel sweep; each is MEASURED through this relay before any county is wired to it. */
  "maps.douglascountyga.gov", // Douglas County GA
  "arcgis5.roktech.net", // ROK Technologies — Habersham, Paulding (wired by other route) and other GA county viewers
  "www.thomascountymaps.org", // Thomas County GA
  "www.mgrcmaps.org", // Middle Georgia Regional Commission (www form)
  "www.valorgis.com", // VALOR — Lowndes and sibling South Georgia counties
  /* NEW-1 (Georgia re-measure, 2026-10-19) — the county hosts the 2026-09 Georgia passes wired from Michael's browser only. Added so they can be
   * re-measured from a sandbox through this relay (B2316720); the app still reads them directly (they send CORS headers). */
  "www.bartowgis.org", "bryangis.bryan-county.org", "gis.cherokeecountyga.gov", "weba.co.clayton.ga.us:5443", "gis.cobbcounty.gov",
  "coweta-gis-web.coweta.ga.us", "geo.forsythco.com", "gis-web.glynncounty-ga.gov", "hallgis.hallcounty.org", "arcgis.co.henry.ga.us",
  "gismap.augustaga.gov", "gis.whitfieldcountyga.com",
  "gis11.cama.io", // CAMA.io — Walton County GA's MapServer (a 2017 copy) was found here; MEASURED before any county is wired to it
  "fgis-map-100.flagshipcloud.com", "fgis-map-101.flagshipcloud.com", "fgis-map-102.flagshipcloud.com", "fgis-map-104.flagshipcloud.com",
  "fgis-map-105.flagshipcloud.com", "fgis-map-106.flagshipcloud.com", "fgis-map-107.flagshipcloud.com", "fgis-map-110.flagshipcloud.com",
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
