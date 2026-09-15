/* Pure transforms for building a county PARCEL snapshot (B629).
 *
 * Shrinks a raw county parcel FeatureCollection (FBCAD/TxGIO/StratMap) into the compact GeoJSON the
 * browser loads: keep ONLY the fields the UI reads, and quantize coordinates to a few decimals
 * (a parcel corner doesn't need 12-decimal precision). This is what turns Fort Bend's ~531 MB raw
 * into a snapshot that gzips small. No DOM / no IO — unit-tested in plain Node
 * (test/parcelSnapshotBuild.test.js); the builder script (scripts/build-parcel-snapshot.mjs) does
 * the fetch + gzip + Drive upload around these.
 */

// The attribute keys the map actually reads (MapFinder/appraisal.js). Everything else is dropped.
// Lower/upper variants are matched case-insensitively so both a per-county CAD schema (HCAD_NUM,
// SITUS) and the TxGIO/StratMap schema (prop_id, situs_addr) survive.
export const KEEP_FIELDS = [
  "prop_id", "geo_id", "hcad_num", "acct", "quickrefid", "objectid",
  "owner_name", "ownername", "situs_addr", "situs", "locaddr",
  "legal_area", "gis_area", "land_value", "imp_value", "mkt_value",
  "stat_land_use", "land_use", "year_built", "county",
];

/* Keep only the wanted properties (case-insensitive on the key). Always preserves `county`
 * (verbatim, whatever case) because the map badges + relabels off it. Pure. */
export function leanProps(props, keep = KEEP_FIELDS) {
  const want = new Set(keep.map((k) => k.toLowerCase()));
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === "") continue;
    if (want.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

// Round one [lng,lat] to `decimals` places (6 ≈ ~0.1 m — plenty for a parcel corner). Pure.
const roundTo = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };

/* Quantize every coordinate of a Polygon/MultiPolygon geometry to `decimals` places, returning a
 * NEW geometry (input untouched). Non-polygon geometry returns null (parcels are polygons). Pure. */
export function quantizeGeometry(geometry, decimals = 6) {
  if (!geometry) return null;
  const q = (ring) => ring.map(([x, y]) => [roundTo(x, decimals), roundTo(y, decimals)]);
  if (geometry.type === "Polygon") return { type: "Polygon", coordinates: geometry.coordinates.map(q) };
  if (geometry.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map(q)) };
  return null;
}

/* One raw GeoJSON parcel Feature → a lean snapshot Feature (stripped props + quantized geometry),
 * or null if it has no polygon geometry. Pure. */
export function leanFeature(feature, { keep = KEEP_FIELDS, decimals = 6 } = {}) {
  const geometry = quantizeGeometry(feature && feature.geometry, decimals);
  if (!geometry) return null;
  return { type: "Feature", properties: leanProps(feature.properties, keep), geometry };
}

/* B1657600 — Esri JSON polygon rings ([[[x,y],…],…], each an OUTER (clockwise, negative shoelace
 * area) or HOLE (counter-clockwise, positive) ring per the ArcGIS convention) → a GeoJSON
 * Polygon/MultiPolygon geometry. Needed because /identify (unlike /query with f=geojson) always
 * answers in Esri JSON — this is the one place a per-tile identify pull is turned into the same
 * GeoJSON shape /query already produces, so buildSnapshotFC never has to care which op fetched a
 * feature. A hole is assigned to whichever outer ring contains its first vertex (parcels are
 * essentially always a single ring or a small multipart tract with at most a stray donut — this
 * matches the nesting every ArcGIS→GeoJSON converter uses, without a new dependency for a
 * Node-only build script). Returns null for a feature with no outer ring at all (malformed). */
const shoelaceArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a / 2;
};
const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export function esriRingsToGeoJsonGeometry(rings) {
  if (!rings || !rings.length) return null;
  const outers = [], holes = [];
  for (const ring of rings) (shoelaceArea(ring) < 0 ? outers : holes).push(ring);
  if (!outers.length) return null;
  const polys = outers.map((outer) => ({ outer, holes: [] }));
  for (const hole of holes) (polys.find((p) => pointInRing(hole[0], p.outer)) || polys[0]).holes.push(hole);
  // GeoJSON's right-hand rule is the opposite of Esri's: exterior CCW (positive area), holes CW.
  const gjRing = (ring, wantCCW) => (shoelaceArea(ring) > 0) === wantCCW ? ring : [...ring].reverse();
  const gjPoly = ({ outer, holes: hs }) => [gjRing(outer, true), ...hs.map((h) => gjRing(h, false))];
  return polys.length === 1
    ? { type: "Polygon", coordinates: gjPoly(polys[0]) }
    : { type: "MultiPolygon", coordinates: polys.map(gjPoly) };
}

/* A raw feature list → a compact snapshot FeatureCollection + its [w,s,e,n] extent. Drops features
 * with no polygon geometry. Pure. */
export function buildSnapshotFC(features, opts = {}) {
  const out = [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of features || []) {
    const lean = leanFeature(f, opts);
    if (!lean) continue;
    out.push(lean);
    const rings = lean.geometry.type === "Polygon" ? lean.geometry.coordinates : lean.geometry.coordinates.flat();
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    }
  }
  const bbox = isFinite(w) ? [w, s, e, n] : null;
  return { type: "FeatureCollection", features: out, bbox };
}
