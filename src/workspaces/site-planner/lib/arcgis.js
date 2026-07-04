/* Minimal Esri ArcGIS REST client — just enough to look up a parcel and turn
 * its geometry into a polygon in local feet. All requests run in the browser,
 * so they depend on the target server allowing CORS (Esri's do, by default).
 */
import { FEET_WKID } from "./counties.js";

/* A typed failure from a parcel/ArcGIS request. Lets a caller tell a SERVER problem
 * (timeout / HTTP error / ArcGIS error body / network or CORS block) apart from a
 * healthy "no parcel at this point" — which is NOT an error (the query returns an
 * empty feature list, never a throw). So every ParcelFetchError means the source was
 * UNAVAILABLE; `.unavailable` is the flag the circuit breaker (sourceHealth.js) and
 * the honest "statewide backup" labeling key off (B244/B245). `kind`:
 * 'timeout' | 'http' | 'arcgis' | 'network'. */
export class ParcelFetchError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = "ParcelFetchError";
    this.kind = kind;
    this.status = status;
    this.unavailable = true;
  }
}

/* How long to wait before abandoning a county GIS request. County servers sometimes
 * hang — the TCP connection opens but no response ever comes (FBCAD did exactly this
 * on 2026-06-19, freezing the tab ~45s on a single parcel click). An AbortController
 * cap turns an indefinite hang into a prompt, typed 'timeout' failure so the fallback
 * chain can take over instead of locking the UI (B244). */
export const PARCEL_FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, params) {
  const u = new URL(url);
  u.searchParams.set("f", "json");
  if (params)
    for (const [k, v] of Object.entries(params))
      if (v != null) u.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PARCEL_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(u.toString(), { signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === "AbortError")
      throw new ParcelFetchError("timeout", `The county server didn't respond within ${Math.round(PARCEL_FETCH_TIMEOUT_MS / 1000)}s.`);
    throw new ParcelFetchError("network", "Couldn't reach the county server (network or CORS block).");
  } finally {
    clearTimeout(timer);
  }
  // Validate the RESPONSE BODY, not just the HTTP status: ArcGIS routinely returns
  // HTTP 200 with a JSON `{error:…}` body (e.g. 499 Token Required) for a failed
  // query, which must read as a failure — not a silent success (B245).
  if (!res.ok) throw new ParcelFetchError("http", `The county server returned HTTP ${res.status}.`, res.status);
  let j;
  try {
    j = await res.json();
  } catch (_) {
    throw new ParcelFetchError("arcgis", "The county server returned an unreadable response.");
  }
  if (j && j.error) throw new ParcelFetchError("arcgis", j.error.message || "ArcGIS query error.", j.error.code ?? null);
  return j;
}

const trim = (s) => s.replace(/\/+$/, "");

// Layer metadata: name, geometry type, and field list.
export async function getLayerInfo(layerUrl) {
  const j = await fetchJson(layerUrl);
  return {
    name: j.name,
    type: j.type,
    geometryType: j.geometryType,
    fields: (j.fields || []).map((f) => ({
      name: f.name,
      alias: f.alias,
      type: f.type,
    })),
  };
}

// All layers in a MapServer/FeatureServer root.
export async function listLayers(serviceUrl) {
  const j = await fetchJson(trim(serviceUrl) + "/layers");
  return (j.layers || []).map((l) => ({
    id: l.id,
    name: l.name,
    geometryType: l.geometryType,
    type: l.type,
  }));
}

// If a service-root URL was given, resolve it to the best parcels layer URL.
export async function resolveLayerUrl(url) {
  if (/\/(MapServer|FeatureServer)\/\d+\/?$/i.test(url)) return trim(url);
  if (/\/(MapServer|FeatureServer)\/?$/i.test(url)) {
    const layers = await listLayers(url);
    if (!layers.length) throw new Error("That service has no layers.");
    const polys = layers.filter((l) => /polygon/i.test(l.geometryType || ""));
    const pick =
      polys.find((l) => /parcel/i.test(l.name || "")) ||
      layers.find((l) => /parcel/i.test(l.name || "")) ||
      polys[0] ||
      layers[0];
    return trim(url) + "/" + pick.id;
  }
  return trim(url); // assume it's already a layer URL
}

// Query features, returning geometry in Texas State Plane feet (EPSG:2278).
export async function queryFeatures(
  layerUrl,
  { where = "1=1", outFields = "*", count = 8, outSR = FEET_WKID } = {}
) {
  const j = await fetchJson(trim(layerUrl) + "/query", {
    where,
    outFields,
    returnGeometry: "true",
    outSR,
    resultRecordCount: count,
  });
  return j.features || [];
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a / 2;
}

// The outer-boundary ring of an ArcGIS polygon. Outer rings and holes wind oppositely;
// the largest ring by |area| is always an outer boundary (a hole can't exceed the ring
// that contains it), so picking the max-|area| ring can never select a hole — even on a
// multipart feature whose biggest hole exceeds a small separate part (B36c).
function largestRing(rings) {
  let best = rings[0], bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) { const a = Math.abs(ringArea(r)); if (a > bestA) { best = r; bestA = a; } }
  return best;
}

// Area-weighted centroid of a ring [[x,y],…] — unbiased by vertex density (a plain
// vertex average drifts toward a densely-digitized curved edge). Falls back to the
// vertex mean only for a degenerate (zero-area) ring (B36c).
function ringCentroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    const cross = r[i][0] * r[j][1] - r[j][0] * r[i][1];
    a += cross; cx += (r[i][0] + r[j][0]) * cross; cy += (r[i][1] + r[j][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) { let vx = 0, vy = 0; r.forEach(([x, y]) => { vx += x; vy += y; }); return [vx / r.length, vy / r.length]; }
  a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
}

const ringClosed = (r) => r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

/* Convert an ArcGIS polygon feature (rings in State Plane feet) into the app's
 * local polygon: pick the outer ring, recenter on its area centroid, and flip Y so
 * north points up on screen. Returns [{x,y}] in feet, or null. */
export function featureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  const [cx, cy] = ringCentroid(best);
  const ring = ringClosed(best) ? best.slice(0, -1) : best;
  return ring.map(([x, y]) => ({ x: x - cx, y: -(y - cy) }));
}

/* Does an ArcGIS error mean the layer's QUERY operation itself is unavailable (as
 * opposed to a transient outage)? ArcGIS reports a disabled/unsupported operation as
 * HTTP 400 with "…is not supported by this service." (extendedCode -2147220222). We
 * match on that wording so the identify fallback below fires ONLY for a genuine
 * query-capability gap — never masking a real timeout / network / other error, which
 * must still surface as an outage. */
export function isQueryCapabilityError(e) {
  return (
    e instanceof ParcelFetchError &&
    e.kind === "arcgis" &&
    /not supported by this service|capability is not supported|operation is not supported/i.test(e.message || "")
  );
}

// Even-odd point-in-polygon across every ring of an esri feature (lon/lat). Holes wind
// opposite to their outer ring, so an even-odd test across all rings correctly excludes
// a point that falls in a hole. Pure.
function featureContainsLngLat(feature, lng, lat) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return false;
  let inside = false;
  for (const ring of rings)
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[k][0], yj = ring[k][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/* Identify the parcel under a point via a MapServer's /identify operation — the
 * fallback for a MapServer whose layer /query is disabled upstream (the TxGIO statewide
 * parcels service, which backs Chambers County + every county's outage fallback, does
 * exactly this: /query and /find 400 with "operation not supported", while /identify and
 * /export still serve the data). Builds a small synthetic map frame around the click so
 * identify's pixel tolerance maps to a few feet on the ground, then returns the parcel
 * that actually CONTAINS the point (else the nearest hit) in the SAME
 * { geometry:{rings}, attributes } shape queryAtPoint returns, geometry in lon/lat
 * (4326), or null. Only meaningful for a /MapServer/<id> layer. */
export async function identifyAtPoint(layerUrl, lng, lat) {
  const m = /^(.*\/MapServer)\/(\d+)\/?$/i.exec(trim(layerUrl));
  if (!m) return null; // identify is a MapServer op — not applicable to a FeatureServer layer
  const [, service, id] = m;
  const half = 0.003; // ~1000 ft: tolerance≈a few ft, yet forgiving of a click right on a boundary
  const j = await fetchJson(service + "/identify", {
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    sr: 4326,
    layers: `all:${id}`,
    tolerance: 2,
    mapExtent: `${lng - half},${lat - half},${lng + half},${lat + half}`,
    imageDisplay: "600,600,96",
    returnGeometry: "true",
  });
  const feats = (j.results || [])
    .filter((r) => r && r.geometry && r.geometry.rings)
    .map((r) => ({ geometry: r.geometry, attributes: r.attributes || {} }));
  if (!feats.length) return null;
  return feats.find((f) => featureContainsLngLat(f, lng, lat)) || feats[0];
}

// Find the parcel polygon under a clicked map point. Returns the ArcGIS feature
// with geometry in lon/lat (EPSG:4326), which every service supports, or null.
export async function queryAtPoint(layerUrl, lng, lat) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  try {
    const j = await fetchJson(trim(layerUrl) + "/query", {
      geometry,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "true",
      outSR: 4326,
    });
    return (j.features || [])[0] || null;
  } catch (e) {
    // A MapServer that advertises Query but has the layer /query op disabled returns a
    // capability error, not an outage. Its /identify op still serves the parcel, so fall
    // back to it — ONLY for that specific error and ONLY on a MapServer layer, so a real
    // timeout/network failure still surfaces as unavailable and FeatureServers are
    // untouched. Self-heals: if the agency re-enables query, /query succeeds and this
    // branch never runs.
    if (isQueryCapabilityError(e) && /\/MapServer\/\d+\/?$/i.test(trim(layerUrl)))
      return identifyAtPoint(layerUrl, lng, lat);
    throw e;
  }
}

/* Identify the parcel under a clicked point across several candidate counties at
 * once — so the user never has to pre-pick a county. Each candidate is
 * { county, url } (the county's resolved parcel-layer URL). Queries them in
 * parallel and returns EVERY hit as { county, feature } (a click that straddles a
 * county line can legitimately hit two — the caller merges). A candidate whose
 * service is down/unreachable is skipped (its rejection swallowed) rather than
 * failing the whole identify, so a sibling county can still answer. Returns [] when
 * nothing matched anywhere. */
export async function identifyParcelAcross(candidates, lng, lat) {
  return (await identifyParcelDetailed(candidates, lng, lat)).hits;
}

/* Same identify, but also reports how many candidate services actually RESPONDED,
 * so a caller can tell "couldn't reach any parcel service" (responded === 0) apart
 * from "a service answered, but there's no parcel at this point" (responded > 0,
 * hits empty) — two states that must read differently (B233). Also returns a
 * per-source outcome list so the caller can update each source's circuit-breaker
 * health (B244): `ok` = the server answered (a hit OR an honest empty), false = it
 * failed (timeout / HTTP / ArcGIS error / network). Returns
 * { hits:[{county,feature}], responded, errors, sources:[{county,ok,hit,error}] }. */
export async function identifyParcelDetailed(candidates, lng, lat) {
  const list = candidates || [];
  const results = await Promise.allSettled(
    list.map(async ({ county, url }) => {
      const feature = await queryAtPoint(url, lng, lat);
      return feature ? { county, feature } : null;
    })
  );
  const sources = results.map((r, i) => ({
    county: list[i].county,
    ok: r.status === "fulfilled",
    hit: r.status === "fulfilled" && !!r.value,
    error: r.status === "rejected" ? r.reason : null,
  }));
  const hits = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  const responded = sources.filter((s) => s.ok).length;
  const errors = sources.filter((s) => !s.ok).length;
  return { hits, responded, errors, sources };
}

/* How long to keep waiting for a healthy real-CAD primary to answer AFTER the statewide
 * fallback (TxGIO) has already returned a hit. The statewide layer often races slightly
 * ahead of a county's own server; without this grace a click over a Fort Bend lot would
 * resolve on the TxGIO copy — and get mislabeled "county server unavailable" — even
 * though FBCAD was up and about to answer (B634). Bounded well under
 * PARCEL_FETCH_TIMEOUT_MS so a genuinely hung primary still can't stall the click: we
 * wait ~1.2s for the authoritative source, never the full 8s. */
export const BACKUP_GRACE_MS = 1200;

/* Like identifyParcelDetailed, but resolves AS SOON AS a parcel hit is locked in
 * instead of waiting for every candidate to settle — so a click selects the moment the
 * authoritative source answers rather than stalling on a hung county server's full 8s
 * timeout (B244, recurred 2026-06-22). Candidates are queried in parallel; real CADs are
 * listed before the statewide fallback and each candidate is tagged `statewide`, so the
 * resolver can prefer the authoritative answer:
 *   • a hit from a REAL CAD wins immediately (best case, fast);
 *   • when only the STATEWIDE fallback has hit, we give any still-in-flight real CAD a
 *     bounded grace (BACKUP_GRACE_MS) to answer first — so a healthy-but-slightly-slower
 *     county server wins over the fallback it out-raced (B634) — but never longer, so a
 *     truly hung/dead CAD can't reintroduce the ~8s stall the eager path removed.
 * A real CAD still pending only because it's hung lets the grace elapse; the statewide
 * hit is then taken (and correctly flagged a backup, since that CAD did fail).
 *
 * When NO candidate hits, it waits for all to settle and reports the same honest
 * `responded`/`errors` as identifyParcelDetailed, so "reached a server, no parcel here"
 * (responded > 0) still reads differently from "couldn't reach any server" (responded
 * === 0) (B245).
 *
 * `onSettled(sources)` (optional) fires ONCE after every candidate finishes — even if
 * we already returned early — so the caller can feed the circuit breaker (sourceHealth)
 * the health of the slow/failed sources too. Returns { hits:[{county,feature}],
 * responded, errors, sources:[{county,ok,hit,error}], complete }. */
export function identifyParcelEager(candidates, lng, lat, { onSettled, graceMs = BACKUP_GRACE_MS } = {}) {
  const list = candidates || [];
  const st = list.map((c) => ({ county: c.county, statewide: !!c.statewide, ok: false, hit: false, error: null, feature: null, settled: false }));
  const view = () => st.map((s) => ({ county: s.county, ok: s.ok, hit: s.hit, error: s.error }));
  const result = (complete) => ({
    hits: st.filter((s) => s.hit).map((s) => ({ county: s.county, feature: s.feature })),
    responded: st.filter((s) => s.ok).length,
    errors: st.filter((s) => s.settled && !s.ok).length,
    sources: view(),
    complete,
  });

  let resolveOuter;
  const out = new Promise((r) => { resolveOuter = r; });
  let done = false;
  let settledCount = 0;
  let graceTimer = null;
  const clearGrace = () => { if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; } };
  const finish = (complete) => { if (done) return; done = true; clearGrace(); resolveOuter(result(complete)); };

  // A real-CAD (non-statewide) primary still in flight? Its authoritative answer should
  // beat a statewide fallback that merely raced ahead.
  const realPrimaryPending = () => st.some((s) => !s.statewide && !s.settled);
  const tryResolve = () => {
    if (done) return;
    if (settledCount === list.length) { finish(true); return; }          // everyone settled → honest responded/errors
    if (st.some((s) => s.hit && !s.statewide)) { finish(false); return; } // a real CAD hit → authoritative, take it now
    if (st.some((s) => s.hit && s.statewide)) {                           // only the statewide fallback has hit so far
      if (!realPrimaryPending()) { finish(false); return; }              // no real CAD is coming → accept the fallback
      if (!graceTimer) graceTimer = setTimeout(() => { graceTimer = null; finish(false); }, graceMs); // wait a bounded grace for the CAD
    }
  };

  const settle = (i) => {
    st[i].settled = true; settledCount += 1;
    tryResolve();
    if (settledCount === list.length && onSettled) onSettled(view());
  };
  if (!list.length) { finish(true); if (onSettled) onSettled([]); return out; }
  list.forEach(({ url }, i) => {
    queryAtPoint(url, lng, lat).then(
      (feature) => { st[i].ok = true; st[i].hit = !!feature; st[i].feature = feature || null; },
      (err) => { st[i].error = err; }
    ).finally(() => settle(i));
  });
  return out;
}

/* Convert a lon/lat polygon feature into local feet for the planner, plus the
 * [lat,lng] ring for drawing a highlight on the Leaflet map. Uses a local
 * equirectangular projection about the parcel centroid — exact enough for a
 * single lot (sub-0.3% over a few hundred feet) and avoids depending on the
 * server reprojecting to State Plane. North is flipped up to match the planner. */
export function lngLatFeatureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  const [lon0, lat0] = ringCentroid(best);
  const ring = ringClosed(best) ? best.slice(0, -1) : best;
  const FT_PER_DEG_LAT = 365223; // feet per degree latitude (Web-Mercator sphere base)
  const FT_PER_DEG_LON = 365223 * Math.cos((lat0 * Math.PI) / 180);
  const points = ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_PER_DEG_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
  const latlngs = ring.map(([lon, lat]) => [lat, lon]);
  return { points, latlngs };
}

/* Convert a GeoJSON polygon feature (as esri-leaflet's vector display layer carries
 * them, in lon/lat) into the SAME esri-shaped `{ geometry: { rings }, attributes }`
 * that the identify pipeline and `outerRingsLngLat`/`featureToParcel` consume — so the
 * already-on-screen parcel outlines can feed the exact same highlight/select path as a
 * server identify (the B441 optimistic-highlight pick). A GeoJSON Polygon's
 * `coordinates` is a list of rings; a MultiPolygon's is a list of those — flatten both
 * to one flat ring list (winding-agnostic: `outerRingsLngLat` re-derives outers vs
 * holes from ring area, so GeoJSON's RFC-7946 winding vs esri's doesn't matter).
 * GeoJSON `properties` becomes `attributes`. Returns null if it isn't a polygon. */
export function geoJsonToEsriFeature(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  let rings;
  if (g.type === "Polygon") rings = g.coordinates;
  else if (g.type === "MultiPolygon") rings = g.coordinates.flat();
  else return null;
  if (!Array.isArray(rings) || !rings.length) return null;
  return { geometry: { rings }, attributes: { ...(feature.properties || {}) } };
}

// The outer ring of a feature as an open [[lon,lat], ...] array (4326).
export function largestRingLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  return ringClosed(best) ? best.slice(0, -1) : best;
}

/* EVERY outer-boundary ring of a (possibly MULTIPART) polygon feature, each as an
 * open [[lon,lat], ...] array (4326). A parcel can legitimately be several separate
 * pieces under one account — e.g. "TRS 3 & 5" is two physically separate tracts —
 * and the largest-ring-only pick (B36c) silently dropped the smaller piece: a click
 * in it registered the account but highlighted (and imported) only the biggest
 * tract, so the clicked piece "wouldn't select" and a neighbour appeared to. This
 * returns all outer parts so callers can highlight + plan every tract. Holes (rings
 * wound opposite to the outers) are excluded — the planner parcel model has no
 * donut support and the prior behaviour already ignored them. Returns [] if none. */
export function outerRingsLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return [];
  // Outer rings and holes wind oppositely (ArcGIS: outers clockwise, holes CCW);
  // the largest |area| ring is always an outer boundary, so its winding sign marks
  // the outers. Keep same-sign, non-degenerate rings; drop the opposite-sign holes.
  const areas = rings.map(ringArea);
  let outerSign = 1, bestA = -1;
  areas.forEach((a) => { if (Math.abs(a) > bestA) { bestA = Math.abs(a); outerSign = Math.sign(a) || 1; } });
  return rings
    .filter((_, i) => areas[i] !== 0 && Math.sign(areas[i]) === outerSign)
    .map((r) => (ringClosed(r) ? r.slice(0, -1) : r));
}

// Feet per degree using the Web-Mercator sphere base (2πR/360 ≈ 365223 ft) for
// BOTH axes — so the local equirectangular feet model is a linearization of
// spherical Mercator and overlays a Web-Mercator aerial basemap with no axis
// distortion (the planner/map both render on such a basemap).
const FT_PER_DEG_LAT = 365223;
const ftPerDegLon = (lat) => 365223 * Math.cos((lat * Math.PI) / 180);

// Project a lon/lat ring to local feet about a shared origin (north up).
export function lngLatRingToFeet(ring, lon0, lat0) {
  const FT_LON = ftPerDegLon(lat0);
  return ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
}

// Inverse of the above: a planner-feet point back to [lat, lng] for Leaflet,
// given the site's geographic origin. Lets the map redraw saved-site footprints.
export function feetToLatLng(pt, lat0, lon0) {
  return [lat0 - pt.y / FT_PER_DEG_LAT, lon0 + pt.x / ftPerDegLon(lat0)];
}

// Feet placement for an aerial export covering a lon/lat bbox, in the same local
// frame (origin lon0/lat0) as the parcels. The export is sized to the *degree*
// aspect so the server returns exactly this bbox (no aspect padding); we then
// stretch it (preserveAspectRatio="none") into the true-feet rectangle using the
// same FT_PER_DEG constants the parcels use, so image and boundary align exactly.
// ftPerPx is the horizontal scale, ftPerPxY the vertical (they differ at this
// latitude — that vertical stretch is what was missing before).
export function aerialPlacement(bbox, lon0, lat0, opts = {}) {
  const maxPx = opts.maxPx || 1800;
  const exportBase =
    opts.exportBase ||
    "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";
  const FT_LON = ftPerDegLon(lat0);
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latSpan = bbox.latMax - bbox.latMin;
  let imgW, imgH;
  if (lonSpan >= latSpan) { imgW = maxPx; imgH = Math.max(16, Math.round(maxPx * (latSpan / lonSpan))); }
  else { imgH = maxPx; imgW = Math.max(16, Math.round(maxPx * (lonSpan / latSpan))); }
  const widthFt = lonSpan * FT_LON;
  const heightFt = latSpan * FT_PER_DEG_LAT;
  const src =
    `${exportBase}?bbox=${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}` +
    `&bboxSR=4326&imageSR=4326&size=${imgW},${imgH}&format=jpg&transparent=false&f=image`;
  return {
    src,
    imgW,
    imgH,
    ftPerPx: widthFt / imgW,
    ftPerPxY: heightFt / imgH,
    x: (bbox.lonMin - lon0) * FT_LON,
    y: -(bbox.latMax - lat0) * FT_PER_DEG_LAT,
  };
}

// Turn fetch/CORS failures into something actionable for a non-technical user.
export function humanizeError(e) {
  // Typed parcel-fetch failures (B244/B245) carry a `kind` — give each its own plain
  // wording so "the server is down" reads differently from "no parcel here".
  if (e && e.kind) {
    if (e.kind === "timeout")
      return "The county parcel server isn't responding. Trying the statewide backup where possible — otherwise trace the parcel from the Aerial underlay.";
    if (e.kind === "http")
      return `The county parcel server returned an error (HTTP ${e.status ?? "?"}) — it may be down. Trying the statewide backup where possible, or use the Aerial underlay.`;
    if (e.kind === "network")
      return "Couldn't reach the county server (network or CORS block). The endpoint may have moved, or your network is blocking it — meanwhile use the Aerial underlay to trace the parcel by hand.";
    return e.message; // 'arcgis' — surface the server's own message
  }
  const m = String(e?.message || e);
  if (/failed to fetch|networkerror|load failed|cors/i.test(m))
    return "Couldn't reach the county server (network or CORS block). The endpoint may have moved, or your network is blocking it — meanwhile use the Aerial underlay to trace the parcel by hand.";
  return m;
}
