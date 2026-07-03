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
