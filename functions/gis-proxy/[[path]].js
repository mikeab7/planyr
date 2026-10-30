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

// Exact hostnames only — never a pattern. A host is listed ONLY while a registry row reads it through this relay, and test/gisProxyRelay.test.js fails the build in both directions: a listed host no
// row reads (delete it) and a row that reads a host that is not listed (it would be refused at runtime). To measure a NEW host before wiring it, add it in the PR that wires its first row
// (docs/STATEWIDE-PARCELS.md "GIS pass-through"); every entry is attack surface, and a host nothing reads is attack surface for nothing (NEW-1 security review, B2555776, 2026-10-30).
export const ALLOWED_HOSTS = new Set([
  /* NEW-1 (South Carolina, 2026-10-19) — the three county hosts a South Carolina county is wired to (each MEASURED through this relay on the PR preview). The statewide base layer is on
   * *.arcgis.com and needs no relay. */
  "www.laurenscountygis.org", // Laurens County
  "gis.sumter-sc.com", // City / County of Sumter
  "maps.spartanburgcounty.org", // Spartanburg County
  "www.sgrcmaps.com", // Southern Georgia Regional Commission — Tift + 10 sibling GA counties
  /* NEW-1 (Memphis 100-mile radius) — Tennessee hosts this build sandbox's egress blocks; relayed server-side so the app never depends on their ACAO header. */
  "scgis.shelbycountytn.gov", // Shelby County TN GIS server — the Assessor of Property's CERTParcel service (NEW-1, Memphis radius ×2)
  "gis.capturecama.com", // CaptureCAMA (TN Comptroller's assessment system) — Chester County TN Assessor's parcel MapServer (NEW-1, Memphis radius ×3)
  /* NEW-1 (Tennessee pass 2, B2408834, 2026-10-22) — Hamilton County TN's own ArcGIS Server (Live_Parcels, the Assessor's tax-map parcels), MEASURED through this relay before tn_hamilton was wired. The two other
   * probe hosts (pwgis.chattanooga.gov, gis.mcgtn.org) were measured the same way and are NOT listed: nothing uses them. */
  "mapsdev.hamiltontn.gov", // Hamilton County TN GIS
  "gis.mississippi.edu", // MARIS (Mississippi Automated Resource Information System) statewide cadastral
  /* NEW-1 (Mississippi due-diligence layers) — MDEQ's own two ArcGIS servers (Land & Water / Geology, and Pollution Control); the build sandbox reaches neither, so every layer on them was
   * MEASURED through this relay on the PR preview. (MARIS, gis.mississippi.edu, is listed above.) */
  "gis.deq.ms.gov", // MDEQ Office of Land and Water Resources + Office of Geology
  "opcgis.deq.state.ms.us", // MDEQ Office of Pollution Control (MUSTER tanks, GARD sites, 303(d) list)
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
  /* NEW-1 (Missouri second pass, 2026-10-29) — the one new host a newly wired Missouri county rides: the Mid-America Regional Council's ArcGIS Server, whose regional parcel compilation
   * is Cass County's only readable source (a labelled COPY — the county's own CAMAvision viewer is a format Planyr cannot read yet). MEASURED through this relay on the PR preview.
   * The ~35 hosts read only to look for sources (assessor portals, county sites, the CAMAvision / Breeze / GIS Cloud vendors) were pruned: nothing wired uses them. */
  "gis2.marc2.org", // Mid-America Regional Council — Cass County
  /* NEW-1 (Oklahoma screening, 2026-10-29) — the three Oklahoma AGENCY servers the Oklahoma layer rows read. The build sandbox's egress blocks all three (403 on CONNECT), so their field
   * lists, record counts and CORS could not be read from here; each is relayed server-side and MEASURED through this relay on the PR preview before a row was wired to it. */
  "gis.occ.ok.gov", // Oklahoma Corporation Commission — RBDMS wells, orphan wells, PST tanks
  "gis.deq.ok.gov", // Oklahoma Department of Environmental Quality — LandWeb cleanup programs, WaterWeb (wellhead protection, impaired waters, special-protection waters)
  "owrb.csa.ou.edu", // Oklahoma Water Resources Board — water-system service areas, NFIP participation
  /* NEW-1 (Idaho, 2026-10-19) — the county hosts the wired Idaho counties sit on (idParcels.js), each MEASURED through this relay before its county was wired. */
  "gis.latah.id.us", // Latah County
  "maps.canyonco.org", // Canyon County
  "gisportal.co.jefferson.id.us", // Jefferson County
  "madison.rexburg.org", // Madison County / City of Rexburg
  "web.binghamid.gov", // Bingham County
  "maps.blainecountyid.gov",
  "map.kcgov.us",
  /* NEW-1 (New Mexico, 2026-10-19) — the Office of the State Engineer's County_Parcels layers (nmParcels.js), MEASURED through this relay before the counties were wired. */
  "gis.ose.nm.gov",
  /* NEW-1 (Alabama, 2026-10-16) — the county / vendor hosts the wired Alabama counties sit on (alabamaParcels.js); the sandbox cannot reach them, so each was relayed and MEASURED through this relay before its county was wired. */
  "web3.kcsgis.com", "web4.kcsgis.com", "web5.kcsgis.com", "web6.kcsgis.com",
  "al52portal.kcsgis.com", // KCS GIS — Morgan County
  "maps.capturecama.com", // CaptureCAMA — Cleburne, Coosa, Russell, Monroe, Bullock, Henry, Hale, Wilcox, Sumter…
  "map.stclairco.com", // St. Clair County
  "maps.shelbyal.com", // Shelby County AL (Property Tax Office)
  "jccgis.jccal.org",
  "gis.limestonecounty-al.gov", // Limestone County
  "maps.madisonal.gov", // City of Madison (Madison County layer)
  "gis.calhouncounty.org", // Calhoun County
  "explore.opelika-al.gov", // City of Opelika (Lee County layer)
  "al20portal.kcsgis.com", // KCS GIS — Colbert County (named in the county viewer's own public config.js: al20server/…/Internal/Colbert_Public_ISV, B2312352)
  /* NEW-1 (Georgia due-diligence gaps, 2026-10-29) — the two Georgia hosts the Georgia due-diligence rows read (the build sandbox cannot reach either, 403 at its egress; each was MEASURED through planyr.io): the UGA ITOS
   * host that serves GDOT's functional-class / DNR / USGS map services, and Bartow County's own GIS server (BartowZoning). GDOT's egis.dot.ga.gov was pruned 2026-10-30: no row reads it. */
  "maps.itos.uga.edu", // UGA ITOS — GDOT functional class / routes / bridges map services
  "www.bartowgis.org", // Bartow County GIS — AGOServices/BartowZoning (the row reads the www form; the bare host is not allowed)
  /* NEW-1 (Georgia, 2026-10-19) — county / regional hosts the wired Georgia counties read through this relay (gaParcels.js, counties.js), each MEASURED before its county was wired. */
  "maps.douglascountyga.gov", // Douglas County GA
  "www.thomascountymaps.org", // Thomas County GA
  /* NEW-1 (Michigan, 2026-10-20) — the six county-hosted services a wired Michigan county rides (each MEASURED through this relay on the PR preview before it was wired);
   * the other 46 Michigan rows read *.arcgis.com directly. */
  "gis.kentcountymi.gov", "gis.miottawa.org", "gis.mijackson.org", "gis.gtcountymi.gov", "maps.stclaircounty.org", "gis.mocogeo.org",
  /* NEW-1 (Pennsylvania, 2026-10-19) — the hosts the wired Pennsylvania counties sit on, each MEASURED through this relay (on the PR preview) before its county was wired: PASDA (Penn State's state data
   * clearinghouse — one MapServer per county for ~36 counties), the PA DEP partial statewide layer (last-resort source for four counties), and the county-run ArcGIS servers. */
  "arcgis.lancastercountypa.gov", "fcgis.franklincountypa.gov", "gis.beavercountypa.gov", "gis.carboncounty.com", "gis.delcopa.gov",
  "gis.dep.pa.gov", "gis.leoc.net:6443", "gis.mckeancountypa.gov", "gis.pikepa.org", "maps.clintoncountypa.gov", "maps.pottercountypa.net",
  "mapservices.pasda.psu.edu", "services.co.schuylkill.pa.us", "tiogagis.tiogacountypa.us",
  /* NEW-1 (Washington, 2026-10-19, B2349360) — the county-run ArcGIS Server hosts the wired Washington counties sit on (each MEASURED through this relay on the PR preview before it was wired). */
  "atlas.co.chelan.wa.us", // Chelan County
  "gis.cowlitzwa.gov", // Cowlitz County Assessor
  "gisweb.jeffcowa.us", // Jefferson County
  "gis.co.kittitas.wa.us", // Kittitas County
  "gis.sanjuancountywa.gov", // San Juan County
  "gis.skagitcountywa.gov", // Skagit County Assessor
  "tconline.co.thurston.wa.us", // Thurston County
  "wcgis.whatcomcounty.us", // Whatcom County
  /* NEW-1 (Oregon, 2026-10-19, B2347696) — the county / state hosts the wired Oregon counties sit on (found through the state's "Publicly Accessible
   * Oregon County Parcel Data" page, each county viewer's web-map config and a REST-directory search). The build sandbox reaches none of them, so each was
   * MEASURED through this relay on the PR preview before a county was wired to it. Hosts that were probed and NOT used (Polk's server answers a web-adaptor
   * error, Jefferson's times out, ODF's TaxlotsDisplay has no Query) are deliberately not listed. */
  "gis.co.benton.or.us", // Benton County
  "gis.columbiacountymaps.com", // Columbia County
  "gis.crookcountyor.gov", // Crook County
  "gis.co.douglas.or.us", // Douglas County
  "jcportal.jacksoncountyor.gov", // Jackson County
  "lcmaps.lanecounty.org", // Lane County
  "gis.co.linn.or.us", // Linn County
  "gispub.co.washington.or.us", // Washington County
  "public.co.wasco.or.us", // Wasco County
  "gis.wrd.state.or.us", // Oregon Water Resources Department public tax-lot query (Curry, Jefferson, Lincoln)
  /* NEW-1 (Oklahoma second pass, B2497472, 2026-10-29) — INCOG's newer ArcGIS Server, which carries the Osage / Creek / Rogers / Tulsa / Wagoner parcel services okParcels.js reads (map8 / map9 refuse the relay and were pruned). */
  "map11.incog.org",
  /* NEW-1 (Arizona, 2026-10-19) — Mohave County's own GIS server (Mohave is the one Arizona county neither the ADWR compile nor an ArcGIS Online layer covers).
   * The build sandbox cannot reach it, so it is relayed and MEASURED through here (on the PR preview) before the county is wired to it. */
  "mcgis.mohave.gov", // Mohave County GIS — PARCELS MapServer
  /* NEW-1 (South Dakota, 2026-10-19) — the planning-district hosts that carry the wired South Dakota counties' parcel layers (sdParcels.js), each MEASURED through this relay before its counties were wired. */
  "gis.districtiii.org",
  "www.1stdistrict.org",
  /* NEW-1 (Iowa, 2026-10-19) — hosts behind the wired Iowa counties; each was MEASURED through this relay before its counties were wired. */
  "wfs.schneidercorp.com", // Schneider Geospatial's public county map servers (the feed behind the Beacon viewers) — 23 Iowa counties
  "gis.pottcounty-ia.gov", // Pottawattamie County (Council Bluffs) GIS
  "gis.dallascountyiowa.gov", // Dallas County (Adel) GIS
  "magic-gis.com", // MAGIC — Muscatine Area GIS consortium (Muscatine County parcels)
  /* NEW-1 (Illinois, 2026-10-20, B2372624) — exactly the county / university hosts the 62 wired Illinois rows use (ilParcels.js), each MEASURED through this relay before its row existed.
   * The probe hosts that could not be used were pruned: the ISGS statewide service answers Token Required; the Bhamaps hosts (ags/services2.bhamaps.com) and Lee/Tazewell's older hosts answer
   * Cloudflare 526/522 from a Worker (B2379936 re-measures them from a browser). */
  "maps.boonecountyil.org", "www.colesco.illinois.gov", "maps.grundyco.org", "maps.co.kendall.il.us", "gis.knoxcountyil.gov", "gis.lasallecounty.org", "maps.lakecountyil.gov", "gisportal.co.madison.il.us",
  "www.mcgisweb.org", "sangis.co.sangamon.il.us", "arcgispublicmap.co.st-clair.il.us", "gis.tazewell-il.gov", "rockgis.rockfordil.gov", // Winnebago County's ownership layer (City of Rockford GIS)
  "gis.wiu.edu", // Western Illinois University GIS Center — Henderson and McDonough counties
  /* NEW-1 (Kansas, 2026-10-19, B2348000) — the non-arcgis.com hosts the wired Kansas counties sit on; each was MEASURED through this relay on the PR preview before its county was wired. */
  "ww1.bucoks.com", // Butler County GIS
  "geodataportal.net", // Eagleview's MultiPlatformParcels host — Ellis County appraiser
  "gis.aumentumtech.com", // Tyler / Aumentum LGIS — Scott, Lane and Meade county viewers
  "doniphangis.integritygis.com", // Integrity GIS Geocortex pool — Doniphan and Cherokee county public sites
  "services.kansasgis.org", // Kansas DASC statewide ORKA parcel layer (Cheyenne, Rawlins, Sherman, Thomas)
  /* NEW-1 (New York, 2026-10-20) — county / city parcel hosts this build sandbox's egress blocks (CONNECT 403), so their layers could only be
   * measured through this relay on the PR preview; relayed server-side so the app never depends on their ACAO header. */
  "maps2.cattco.org", // Cattaraugus County GIS (ArcGIS Enterprise web adaptor)
  "spatialags.vhb.com", // VHB ArcGIS Server behind those viewers
  "maps.dancgis.org", // Development Authority of the North Country — Franklin County parcel model
  "gis.niagaracounty.gov", // Niagara County GIS — the county's CURRENT server (its 2026 viewer's web map points parcels here, /server/…/PublicViewer/Public_Viewer layer 4)
  "gisportal.yatescounty.org", // Yates County GIS portal
  "maps.monroecounty.gov", // Monroe County DES GIS (current parcel roll)
  "gis.washingtoncountyny.gov", // Washington County GIS
  /* NEW-1 (Kentucky, 2026-10-19) — county hosts the Kentucky parcel sources sit on. The sandbox cannot reach any of them, so each is
   * relayed and was MEASURED through this relay before a county was wired to it (docs/STATEWIDE-PARCELS.md "Kentucky counties"). */
  "gis.lojic.org", // LOJIC — Jefferson County (Louisville) PVA parcels
  "maps.linkgis.org", // LINK-GIS — Campbell / Kenton / Pendleton parcels
  "arcserver.madisoncountyky.us", // Madison County KY GIS
  "gis.gscplanning.com", // Georgetown-Scott County Planning Commission
  "webgis.bgky.org", // Warren County City-County Planning Commission (CCPC parcels)
  /* NEW-2 (Kentucky remaining counties, 2026-10-20) — the one non-arcgis.com host the newly wired counties sit on. MEASURED through this relay before
   * Hopkins was wired. (Retest hosts that stayed unreachable — maps2.bgadd.org 523, gis.ccgisonline.com:6443 522, gis.daviesskypva.org 1016 — and the
   * token-gated kygisportalservices.ky.gov are NOT listed: an allow-list entry for a host nothing uses is attack surface.) */
  "www.hopkinscountygis.com:6443", // Hopkins County KY GIS — Parcel MapServer
  /* Second pass (Georgia, 2026-10-29) — the Coastal Regional Commission's newer server, which carries Long County's parcel layer (gaParcels.js; docs/STATEWIDE-PARCELS.md "Georgia counties"). */
  "portal.segrass.org", // Coastal Regional Commission's newer server — Long County Property_Data / Long_Parcels (crcarcgis)
  /* NEW-1 (DeSoto County MS, B2507056, 2026-10-29) — the county's own ArcGIS Server (BaseLayers parcels + municipalities, CountyWebMap zoning / utilities / planning). The build sandbox cannot reach it
   * (CONNECT 403), so it is relayed and MEASURED through planyr.io before any DeSoto layer is wired to it; the Olive Branch AGOL org (services9.arcgis.com) needs no relay. */
  "gis.desotocountyms.gov", // DeSoto County MS GIS
  /* NEW-1 (Florida, B2452976, 2026-10-29) — the Florida state / district agency hosts the due-diligence layers read (FDEP OpenData contamination / karst / ERP; SFWMD canals and rights of way; FWC eagle nests;
   * Broward's FLL noise contours). The build sandbox cannot reach any of them (CONNECT 403): each was MEASURED through planyr.io before its layer was wired. */
  "ca.dep.state.fl.us", // Florida DEP — OpenData MapServers (CLEANUP_SP, DWM_STCM, FGS_*, ERP, OFW, BROWNFIELD_AREAS …)
  "geoweb.sfwmd.gov", // South Florida Water Management District — canals (AHED), rights of way, conservation easements
  "gis.myfwc.com", // Florida Fish & Wildlife Conservation Commission — habitat / species models
  "bcgishub.broward.org", // Broward County — Aviation Department (FLL) noise contours; the county GIS hub
  /* NEW-1 (Tennessee industrial due-diligence layers, 2026-10-29) — the State of Tennessee's own ArcGIS Servers the Tennessee rows read (the build sandbox cannot reach any *.tn.gov host; each was MEASURED through planyr.io):
   * TDEC's hosting server and the state's TNMap clearinghouse. (tdeconline.tn.gov was pruned 2026-10-30: it answers 403 and no row reads it.) */
  "maps.tdec.tn.gov", // TDEC — hosting server (Permitted_Tennessee_Landfills)
  "tnmap.tn.gov", // State of Tennessee Office of Information Resources — TNMap (state GIS clearinghouse)
  /* NEW-1 (Colorado due-diligence layers, B2528688, 2026-10-29) — the two hosts the wired Colorado rows read through this relay. The build sandbox's egress refuses every state.co.us / colorado.gov / city host
   * (CONNECT 403), so each was MEASURED through planyr.io (on the branch preview) before a layer was wired to it. Probe hosts that were measured and NOT used were pruned: dnrweb.state.co.us (no ArcGIS REST
   * service — the DWR structure data is on gisdnr's Hosted folder as points of diversion only) and gis.denvergov.org (answers Cloudflare error 1016, origin unreachable). */
  "gisdnr.state.co.us", // Colorado DNR GIS — ECMC_Public: wells, flowlines, oil and gas locations, facilities
  "ags.auroragov.org", // City of Aurora open data — airport noise contours, Buckley accident potential zones, zoning
]);

const UPSTREAM_TIMEOUT_MS = 20000;

/* The upstream statuses worth exactly one more try: gateway errors and Cloudflare's own origin-failure family (520 unknown, 521 down, 522 connect timeout,
 * 523 unreachable, 524 timeout, 525 SSL handshake failed, 526 invalid cert, 527 railgun). Pure — unit-tested. */
export function isTransientStatus(status) {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
}
const USER_AGENT = "planyr-gis-proxy";

export const MAX_REDIRECTS = 3;
export const isRedirectStatus = (status) => status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
/* Where an upstream redirect may be followed to. Pure — unit-tested. Returns { url, method } or { error: string }.
 * · the target must be https and its HOST (with any port) on ALLOWED_HOSTS — an allow-listed host that redirects elsewhere is NOT a licence to relay "elsewhere";
 * · no Location header, or one that does not parse, is refused (the caller would otherwise get a body-less 3xx it cannot use);
 * · 301/302/303 turn a POST into a GET (the standard), 307/308 keep the method and the body. */
export function redirectTarget(res, fromUrl, method, hop = 0) {
  const loc = res.headers && res.headers.get && res.headers.get("location");
  if (!loc) return { error: "Upstream redirected without a Location." };
  if (hop >= MAX_REDIRECTS) return { error: "Upstream redirected too many times." };
  let to;
  try { to = new URL(loc, fromUrl); } catch (_e) { return { error: "Upstream redirected to an unreadable address." }; }
  if (to.protocol !== "https:") return { error: `Upstream redirected to a non-https address (${to.protocol}//${to.host}).` };
  if (!ALLOWED_HOSTS.has(to.host)) return { error: `Upstream redirected to ${to.host}, which is not on the relay's allow-list.` };
  const s = res.status;
  const nextMethod = method === "POST" && (s === 301 || s === 302 || s === 303) ? "GET" : method;
  // The next hop is held to the SAME rules as the first: an allow-listed host that answers a redirect to its admin or write endpoint (or replays a POST body at one) is not a licence to relay it.
  const cleaned = cleanSegments(to.pathname.split("/").filter(Boolean));
  if (cleaned.error) return { error: "Upstream redirected to an unreadable path." };
  const verdict = classifyPath(cleaned.segs, nextMethod);
  if (!verdict.ok) return { error: `Upstream redirected to a path the relay does not carry (${verdict.error})` };
  to.search = forceJsonFormat(to.search, { isQuery: true }).text;
  return { url: to.toString(), method: nextMethod };
}

/* ───────────────────────── WHAT THE RELAY WILL CARRY (NEW-1 security review, B2555776, 2026-10-30) ─────────────────────────
 * The relay serves upstream bytes from the planyr.io ORIGIN, where a signed-in Supabase session lives. Before this section it copied any Content-Type through and relayed any
 * path with GET or POST, which meant (measured on production, 2026-10-30): `/gis-proxy/<host>/arcgis/rest/services` came back `200 text/html` (an ArcGIS directory page — script
 * served as planyr.io), `?callback=x` came back `application/javascript`, and `/arcgis/admin` and `…/0/applyEdits` were forwarded to the upstream. Four independent limits now close that;
 * each is pure, exported and unit-tested, and none of them is a licence for the next:
 *   1. PATHS — `classifyPath`: only the ArcGIS REST read shapes the app uses (query / identify / export / exportImage / tile, plus metadata GETs); no write or admin operation anywhere in the path;
 *      POST only on query / identify / export / exportImage. Dot segments (also %-encoded), encoded slashes and control characters are refused before a URL is built.
 *   2. FORMAT — `forceJsonFormat`: an ArcGIS `f` that is not one the app consumes (html, jsapi, kmz, pdf …, or no `f` at all, which ArcGIS answers with an HTML page) is rewritten to `json`; `callback`
 *      (JSONP → JavaScript) is dropped. Applied to the query string and to a urlencoded POST body.
 *   3. RESPONSE TYPE — `classifyResponseType`: JSON / geojson / protobuf / png / jpeg / gif / webp / tiff only. text/plain and a missing type are re-labelled `application/json` ONLY when JSON was asked for;
 *      text/html, svg, xml, javascript and everything else are refused with a JSON error.
 *      MEASURED 2026-10-30 through the production relay, one layer per allow-listed host (140): 135 answered, 132 `application/json`, 3 `text/plain` carrying valid JSON (greenecountyassessor.org,
 *      maps.clintoncountypa.gov, opcgis.deq.state.ms.us) — which is why text/plain is re-labelled rather than refused. The other 5 were upstream outages (526 / 502), passed through with their status.
 *   4. HEADERS — every response (errors too) carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`; a non-image body is `Content-Disposition: attachment`.
 *      (`public/_headers` does not apply to Pages Function responses, so they are set here.) */

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
}

const SERVICE_TYPES = new Set(["mapserver", "featureserver", "imageserver"]);
/* Operation / admin names that may never appear ANYWHERE in a relayed path — the ArcGIS write verbs, the admin and token surfaces. (Only unambiguous names: a service folder called "Edit" or "Start"
 * is legitimate, and those are caught anyway because the path must END in a read shape.) */
const WRITE_OR_ADMIN_SEGMENTS = new Set([
  "applyedits", "addfeatures", "updatefeatures", "deletefeatures", "calculate", "addattachment", "updateattachment", "deleteattachments", "uploads", "upload",
  "admin", "manager", "generatetoken", "tokens", "sharing", "createreplica", "synchronizereplica", "unregisterreplica", "append", "truncate",
  "adddefinition", "updatedefinition", "deletefromdefinition", "overwrite",
]);
/* Operations that take a POST: the four read endpoints the app sends bodies to (esri-leaflet's FeatureLayer / Query / identify / dynamicMapLayer, and `wideTileRequest`). */
const POST_OPS = new Set(["query", "identify", "export", "exportimage"]);
const GET_ONLY_OPS = new Set(["layers", "legend"]);
const isLayerId = (seg) => /^\d{1,5}$/.test(seg);

/* Decode and vet the path segments. Returns { segs } (decoded — they are re-encoded when the URL is built) or { error: Response }.
 * `new URL` normalises `%2e%2e` to a dot segment, so a literal ".." test on the raw segment is not enough. */
export function cleanSegments(segs) {
  const out = [];
  for (const raw of segs) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch (_e) { return { error: jsonResponse({ error: "invalid path" }, 400) }; }
    if (seg === "." || seg === ".." || seg.includes("..") || /[\\/\u0000-\u001f\u007f%;]/.test(seg)) return { error: jsonResponse({ error: "invalid path" }, 400) };
    out.push(seg);
  }
  return { segs: out };
}

/* May this ArcGIS REST path be relayed with this method? `rest` = the decoded segments AFTER the host. Pure. Returns { ok: true } or { error: string, status }. */
export function classifyPath(rest, method) {
  const low = rest.map((s) => s.toLowerCase());
  // Every ArcGIS REST endpoint lives under `…/rest/services` (or is `…/rest/info`); a numeric last segment alone is not enough to be relayed (a `/wp-admin/post.php/delete/5` would be).
  const restIdx = low.findIndex((s, i) => s === "rest" && (low[i + 1] === "services" || (low[i + 1] === "info" && i + 2 === low.length)));
  if (restIdx < 0) return { error: "That path is not under an ArcGIS REST /rest/services endpoint, which is all the relay carries.", status: 403 };
  const blocked = low.find((s) => WRITE_OR_ADMIN_SEGMENTS.has(s));
  if (blocked) return { error: `The relay carries read-only ArcGIS queries; "${blocked}" is not one of them.`, status: 403 };
  const last = low[low.length - 1];
  const parent = low[low.length - 2];
  const svcIdx = restIdx + 1 < low.length && low[restIdx + 1] === "services" ? restIdx + 1 : -1;
  const isOp = POST_OPS.has(last);
  if (method === "POST") {
    if (!isOp) return { error: "POST is only relayed to the ArcGIS query / identify / export / exportImage endpoints.", status: 403 };
  }
  if (isOp) {
    const ok = last === "query" ? isLayerId(parent) || SERVICE_TYPES.has(parent)
      : last === "identify" ? parent === "mapserver" || parent === "imageserver"
      : last === "export" ? parent === "mapserver"
      : parent === "imageserver";
    return ok ? { ok: true } : { error: `"${last}" is not an ArcGIS read endpoint at this path.`, status: 403 };
  }
  // GET only from here: metadata, the services directory, and map tiles.
  if (last !== undefined && (SERVICE_TYPES.has(last) || isLayerId(last) || GET_ONLY_OPS.has(last))) return { ok: true };
  if (last === "info" && parent === "rest") return { ok: true };
  if (svcIdx >= 0 && low.length - svcIdx <= 2) return { ok: true }; // …/rest/services or …/rest/services/<Folder>
  if (low.length >= 4 && low[low.length - 4] === "tile" && isLayerId(low[low.length - 3]) && isLayerId(low[low.length - 2]) && isLayerId(last)) return { ok: true };
  return { error: "That path is not an ArcGIS read endpoint the relay carries.", status: 403 };
}

/* The `f` values the app consumes. Anything else — and no `f` at all, which ArcGIS answers with an HTML directory page — becomes `json`. */
const OK_FORMATS = new Set(["json", "pjson", "geojson", "image", "pbf"]);
const SEP = /[&;]/; // ArcGIS (like several servers) may treat `;` as a pair separator too, so the scan does
const keyOf = (pair) => { const k = pair.split("=")[0].replace(/\+/g, " "); try { return decodeURIComponent(k).trim().toLowerCase(); } catch (_e) { return k.trim().toLowerCase(); } };
const valueOf = (q) => { const v = q.slice(q.indexOf("=") + 1); try { return decodeURIComponent(v.replace(/\+/g, " ")).trim().toLowerCase(); } catch (_e) { return ""; } };
/* Is this pair EXACTLY `f=<a format the app consumes>`, byte for byte? Anything else (f=json%20, F=JSON, f=json%0a) is rewritten, never forwarded for the upstream to interpret. */
const isCanonicalF = (pair) => pair.startsWith("f=") && OK_FORMATS.has(pair.slice(2));
/* Force a safe `f` (and no JSONP `callback`) onto a query string (starting "?") or a urlencoded body (no "?"). A text that is ALREADY safe — exactly one canonical `f`, no `callback` — is returned
 * byte-for-byte, so a clean request is never reordered or re-encoded. `addMissing:false` (a POST body) leaves a body with no `f` alone, since the query string carries one. Returns { text, fmt, changed }
 * where `fmt` is the `f` the upstream will see. Pure. */
export function forceJsonFormat(text, { isQuery = true, addMissing = true } = {}) {
  const raw = isQuery ? String(text || "").replace(/^\?/, "") : String(text || "");
  const pairs = raw ? raw.split(SEP) : [];
  const fs = pairs.filter((q) => keyOf(q) === "f");
  const hasJsonp = pairs.some((q) => keyOf(q) === "callback");
  const single = fs.length === 1 && isCanonicalF(fs[0]);
  const wrap = (t) => (isQuery ? (t ? "?" + t : "") : t);
  if (!hasJsonp && (single || (!fs.length && !addMissing))) return { text: wrap(raw), fmt: single ? fs[0].slice(2) : null, changed: false };
  const kept = pairs.filter((q) => { const k = keyOf(q); return k !== "f" && k !== "callback"; });
  const fmt = fs.length === 1 && OK_FORMATS.has(valueOf(fs[0])) ? valueOf(fs[0]) : "json";
  if (!fs.length && !addMissing) return { text: wrap(kept.join("&")), fmt: null, changed: true };
  kept.push("f=" + fmt);
  return { text: wrap(kept.filter(Boolean).join("&")), fmt, changed: true };
}
const JSON_TYPE = /^(application\/([\w.+-]+\+)?json|text\/json)$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/tiff"]);
const PROTOBUF_TYPES = new Set(["application/x-protobuf", "application/protobuf"]);
/* What to do with an upstream Content-Type. `asked` = the `f` the request carried. Returns { type, image } to serve, or { refuse: media type }. Pure. */
export function classifyResponseType(contentType, asked) {
  const raw = String(contentType || "").trim();
  const media = raw.split(";")[0].trim().toLowerCase();
  // the type is rebuilt from the bare media type: an upstream value with parameters or a comma list ("application/json; x, text/html") is never echoed
  if (JSON_TYPE.test(media)) return { type: media + "; charset=utf-8", image: false };
  if (IMAGE_TYPES.has(media)) return { type: media, image: true };
  if (PROTOBUF_TYPES.has(media)) return { type: media, image: false };
  // ArcGIS behind IIS / a proxy sometimes labels a JSON answer text/plain, or leaves the type off. Re-label it ONLY when JSON was asked for — the body is never served as HTML.
  if ((media === "" || media === "text/plain" || media === "application/octet-stream") && (asked === "json" || asked === "pjson" || asked === "geojson")) return { type: "application/json; charset=utf-8", image: false };
  return { refuse: media || "(none)" };
}

/* Validate + build the upstream URL from the catch-all path segments (first segment is the target host), the incoming query string and the method.
 * Returns { url, host, fmt, rest } or { error: Response }. Pure — no network, no globals — so it unit-tests standalone. */
export function resolveUpstream(segs, search, method = "GET") {
  const [host, ...rawRest] = segs;
  if (!host || !ALLOWED_HOSTS.has(host)) return { error: jsonResponse({ error: "host not allowed" }, 403) };
  const cleaned = cleanSegments(rawRest);
  if (cleaned.error) return cleaned;
  const rest = cleaned.segs;
  const verdict = classifyPath(rest, method);
  if (!verdict.ok) return { error: jsonResponse({ error: verdict.error, host }, verdict.status) };
  const { text: qs, fmt } = forceJsonFormat(search && search !== "?" ? search : "", { isQuery: true });
  const url = `https://${host}${rest.length ? "/" + rest.map(encodeURIComponent).join("/") : ""}${qs}`;
  return { url, host, fmt, rest };
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const reqUrl = new URL(request.url);
  const p = context.params && context.params.path;
  const segs = (Array.isArray(p) ? p : String(p || "").split("/")).filter(Boolean);
  const resolved = resolveUpstream(segs, reqUrl.search, method);
  if (resolved.error) return resolved.error;

  const headers = { "user-agent": USER_AGENT };
  // Never forward the client's own cookies or Authorization — this relays a PUBLIC GIS endpoint,
  // not an authenticated one, and neither header belongs to the upstream host anyway.
  let body;
  let asked = resolved.fmt;
  if (method === "POST") {
    const ctype = request.headers.get("content-type") || "application/x-www-form-urlencoded";
    // The body is parsed so its `f` can be vetted like the query string's; the only POST the app sends is urlencoded (esri-leaflet, `serializeEsriParams`).
    if (!/^application\/x-www-form-urlencoded\b/i.test(ctype)) return jsonResponse({ error: "POST bodies must be application/x-www-form-urlencoded.", host: resolved.host }, 415);
    const forced = forceJsonFormat(await request.text(), { isQuery: false, addMissing: false });
    body = forced.text;
    headers["content-type"] = "application/x-www-form-urlencoded";
    // a body `f` outranks the query string's (ArcGIS reads either); both are now safe, the body's is the one the answer follows.
    if (forced.fmt) asked = forced.fmt;
  }

  /* ONE retry on a transient upstream failure (B2507056, 2026-10-29). Measured through planyr.io: gis.desotocountyms.gov (itself fronted by Cloudflare) answers
   * ~10% of identical, idempotent queries with a 525 ("SSL handshake failed" to ITS origin) and the very next request succeeds (4 of 40). The relay carries only
   * read-only ArcGIS queries, so asking once more is safe, and it turns a 10% outage into ~1% instead of leaving every caller to notice and retry. Only the
   * transient classes retry (502/503/504 and Cloudflare's 520-527); a 4xx, a 500 with a body, or an abort is returned as it came. */
  /* REDIRECTS ARE NEVER FOLLOWED BLINDLY (NEW-1 review, 2026-10-30). `fetch` follows redirects by default, so an allow-listed host that answered 301/302 to somewhere else
   * was relayed on to a host nobody had allow-listed — the allow-list only ever checked the FIRST hop. Now `redirect: "manual"`: a 3xx is resolved by `redirectTarget`
   * (the Location must be https and its host on this same list) and followed up to MAX_REDIRECTS times; anything else is a 502 that names the refused host. */
  const attempt = async (url, m, b) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try { return await fetch(url, { method: m, headers, body: b, signal: ctrl.signal, redirect: "manual" }); } finally { clearTimeout(timer); }
  };
  const attemptFollowing = async () => {
    let url = resolved.url, m = method, b = body;
    for (let hop = 0; ; hop++) {
      const r = await attempt(url, m, b);
      if (!isRedirectStatus(r.status)) return { res: r };
      try { await r.body?.cancel(); } catch (_e) { /* discarding the redirect body */ }
      const next = redirectTarget(r, url, m, hop);
      if (next.error) return { refused: next.error };
      url = next.url; m = next.method; b = next.method === "GET" ? undefined : b;
    }
  };
  let res;
  try {
    let got = await attemptFollowing();
    if (got.res && isTransientStatus(got.res.status)) {
      try { await got.res.body?.cancel(); } catch (_e) { /* discarding the failed body */ }
      got = await attemptFollowing();
    }
    if (got.refused) return jsonResponse({ error: got.refused, host: resolved.host }, 502);
    res = got.res;
  } catch (_e) {
    return jsonResponse({ error: `Upstream GIS request to ${resolved.host} failed or timed out.`, host: resolved.host }, 502);
  }

  /* Pass the body through under a vetted Content-Type and nothing else from upstream (no Set-Cookie, no Location, no Content-Disposition of its own). Cache only a genuine 200. */
  const ok = classifyResponseType(res.headers.get("content-type"), asked);
  if (ok.refuse) {
    try { await res.body?.cancel(); } catch (_e) { /* discarding the refused body */ }
    return jsonResponse({ error: `The relay does not serve ${ok.refuse} responses.`, host: resolved.host, upstreamStatus: res.status }, res.status >= 400 ? res.status : 502);
  }
  const outHeaders = new Headers({ ...SECURITY_HEADERS });
  outHeaders.set("content-type", ok.type);
  if (!ok.image) outHeaders.set("content-disposition", "attachment");
  outHeaders.set("cache-control", res.status === 200 ? "public, max-age=300" : "no-store");
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
