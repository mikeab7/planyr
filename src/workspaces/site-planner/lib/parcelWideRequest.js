/* lib/parcelWideRequest.js — NEW-1 (Select parcels: outlines from further out, without hammering county servers).
 *
 * The pure half of the WIDE-VIEW parcel outlines: which zoom is which stage, which fixed map tiles a view needs, and the EXACT
 * request one tile sends. No Leaflet, no DOM, no network — unit-tested in plain Node (test/parcelWideRequest.test.js).
 *
 * THE STAGES (owner design, mockup reviewed 2026-10-22). Today's cutoff `floor` (a source's `layer.options.minZoom`: Davidson 17,
 * Rutherford 16, Harris 16, Dougherty 14) is where EVERY lot draws. Further out:
 *   close  zoom ≥ floor                every lot, full detail, all labels — exactly as before (the esri-leaflet layer, untouched)
 *   mid    floor-1 ≤ zoom < floor      lots ≥ MID_MIN_ACRES, parcel-ID labels on the lots ≥ LABEL_MIN_ACRES
 *   wide   floor-2 ≤ zoom < floor-1    lots ≥ WIDE_MIN_ACRES (the "house-size" cutoff), simplified lines, no labels
 *   far    below that                  nothing (the unchanged "zoom in a little" hint)
 * A source with no VERIFIED size column has no mid/wide stage at all — it keeps today's cutoff (parcelAreaFields.js, written by
 * scripts/probe-parcel-area-fields.mjs; docs/parcel-area-fields-report.json lists every source it could not verify and why).
 *
 * WHY THE FILTER GOES IN THE REQUEST. The point is county-server load. Hiding house lots after they arrive saves the county nothing,
 * so the size test is a `where` on the source's GEOMETRIC area column and the county never sends the lots; the geometry comes back
 * generalised (`maxAllowableOffset`, `geometryPrecision`), so each answer is small; and the request is for a FIXED map tile keyed to
 * a zoom bucket, so a pan re-uses tiles and the same tile URL is the same relay cache key for every user (/api/gis-cache/svc/…).
 *
 * ⛔ MEASURED TRAP — never filter on an APPRAISAL acreage column. Harris County (HCAD): `acreage_1` and `land_sqft` are 0 on a real
 * 6.46-acre reserve lot, so a filter on them hides big lots. Only a column computed from the geometry (`Shape__Area`,
 * `Shape.STArea()`) is used, and only after the probe proved its unit against the lot's own outline. */
import { areaFieldsNow } from "./parcelAreaFieldsLazy.js";
import { proxyServiceUrl, ALLOWED_GIS_HOST_RE } from "../../../shared/gis/gisProxyCore.js";
import { serializeEsriParams } from "./parcelQueryWire.js";

export const WIDE_MIN_ACRES = 0.5; // owner: "hide only house-size lots… roughly half an acre"
export const MID_MIN_ACRES = 0.2; // one step in: mid-size lots too (a typical Katy / Nashville house lot is 0.12–0.2 ac)
export const LABEL_MIN_ACRES = 0.5; // parcel-ID labels ride only the larger lots until the close stage
export const STAGE_MIN_ACRES = { wide: WIDE_MIN_ACRES, mid: MID_MIN_ACRES };
export const WIDE_ABS_MIN_ZOOM = 12; // never wider than this, whatever a source's cutoff is (a rural county's floor of 14 would otherwise reach 12)
export const TILE_PX = 512; // css px per tile at its bucket zoom
export const MAX_TILES_PER_VIEW = 36;
export const MAX_TIER = 2; // a tile that still overflows the server's record cap asks again with the size cutoff × 4, at most twice
const M2_PER_ACRE = 4046.8564224;

/* How a column's value relates to square metres of the lot's true (geodesic) area. `perM2(lat)` = field value per m². */
export const AREA_UNITS = {
  m2: { perM2: () => 1 },
  ft2: { perM2: () => 10.7639104 },
  ac: { perM2: () => 1 / M2_PER_ACRE },
  // a Web-Mercator (3857) layer's Shape__Area is inflated by 1/cos²(lat)
  m2wm: { perM2: (lat) => 1 / Math.cos((lat * Math.PI) / 180) ** 2 },
  ft2wm: { perM2: (lat) => 10.7639104 / Math.cos((lat * Math.PI) / 180) ** 2 },
};

/** A column name interpolated into a where-clause must be a plain identifier (B47), `Shape.STArea()` included. */
export const okAreaField = (f) => /^[A-Za-z0-9_.]+(\(\))?$/.test(f || "");
const okFieldName = (f) => /^[A-Za-z0-9_.]+$/.test(f || "");
const trim = (u) => String(u || "").replace(/\/+$/, "");

/** Geodesic area (m²) of an Esri `rings` array in lon/lat — holes (opposite winding) subtract. Local equirectangular, ±0.3% at lot scale. Pure. */
export function geodesicAreaM2(rings) {
  if (!Array.isArray(rings) || !rings.length) return 0;
  const lat0 = rings[0][0] ? rings[0][0][1] : 0;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  let sum = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
    sum += a / 2;
  }
  return Math.abs(sum);
}
/** Geodesic area in acres of a GeoJSON Polygon / MultiPolygon (lon/lat). Pure. */
export function geoJsonAcres(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let m2 = 0;
  for (const rings of polys) m2 += geodesicAreaM2(rings);
  return m2 / M2_PER_ACRE;
}

/* ── the verified size column per source ─────────────────────────────────────────────────────────── */
/** `{ field, unit }` for a source's layer URL, or null (no VERIFIED geometric area column → no wide stage; also null until the table has loaded). */
export function areaFieldForUrl(url) {
  const t = areaFieldsNow();
  const e = t && t[trim(url)];
  if (typeof e !== "string") return null;
  const [field, unit] = e.split("|");
  return okAreaField(field) && AREA_UNITS[unit] ? { field, unit } : null;
}
export const wideSupportedForUrl = (url) => !!areaFieldForUrl(url);

/* ── stages ──────────────────────────────────────────────────────────────────────────────────────── */
/** The lowest zoom the wide stage draws at for a source whose full-detail cutoff is `floor`. */
export const wideFloorFor = (floor) => Math.max(WIDE_ABS_MIN_ZOOM, Math.floor(floor) - 2);

/** "close" | "mid" | "wide" | "far" for a map zoom and a source's cutoff. `wideOk` false → only close/far (today's behaviour). Pure;
 * a null / NaN zoom reads as "far" like parcelDisplayRegimeForZoom. */
export function wideStageForZoom(zoom, floor, wideOk = true) {
  if (zoom == null || !Number.isFinite(zoom) || !Number.isFinite(floor)) return "far";
  if (zoom >= floor) return "close";
  if (!wideOk) return "far";
  if (zoom >= floor - 1) return "mid";
  if (zoom >= wideFloorFor(floor)) return "wide";
  return "far";
}
/** The integer zoom a stage's tiles are keyed to (one bucket per stage, so a pan within a stage re-uses its tiles). */
export const bucketForStage = (stage, floor) => (stage === "mid" ? Math.floor(floor) - 1 : stage === "wide" ? Math.max(WIDE_ABS_MIN_ZOOM, Math.floor(floor) - 2) : null);

/* ── tiles ───────────────────────────────────────────────────────────────────────────────────────── */
const tilesAcross = (b) => 2 ** (b - 1); // 512-px tiles: a 256-px slippy grid one zoom up
const lngToX = (lng, n) => ((lng + 180) / 360) * n;
const latToY = (lat, n) => { const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const xToLng = (x, n) => (x / n) * 360 - 180;
const yToLat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
const r6 = (v) => Number(v.toFixed(6));

/** [w, s, e, n] of tile (x, y) at bucket zoom `b`. Pure, deterministic (6 decimals): the same tile is the same URL for every user. */
export function tileEnvelope({ x, y, b }) {
  const n = tilesAcross(b);
  return [r6(xToLng(x, n)), r6(yToLat(y + 1, n)), r6(xToLng(x + 1, n)), r6(yToLat(y, n))];
}
/** The tiles covering `bounds` ({south,west,north,east}) at bucket `b`, nearest the view's centre first, capped at MAX_TILES_PER_VIEW. */
export function tilesForBounds(bounds, b) {
  if (!bounds || !Number.isFinite(b)) return [];
  const n = tilesAcross(b);
  const x0 = Math.max(0, Math.floor(lngToX(bounds.west, n))), x1 = Math.min(n - 1, Math.floor(lngToX(bounds.east, n)));
  const y0 = Math.max(0, Math.floor(latToY(bounds.north, n))), y1 = Math.min(n - 1, Math.floor(latToY(bounds.south, n)));
  const cx = lngToX((bounds.west + bounds.east) / 2, n), cy = latToY((bounds.south + bounds.north) / 2, n);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y, b, key: `${b}/${x}/${y}`, d: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 });
  out.sort((a, c) => a.d - c.d);
  return out.slice(0, MAX_TILES_PER_VIEW).map(({ d, ...t }) => t);
}

/* ── the request ─────────────────────────────────────────────────────────────────────────────────── */
/** The size cutoff a stage sends, in the column's own unit, rounded so the URL is stable. `tier` multiplies the acreage by 4^tier. */
export function areaCutoff({ stage, tier = 0, unit, lat }) {
  const acres = STAGE_MIN_ACRES[stage] * 4 ** Math.max(0, tier);
  const v = acres * M2_PER_ACRE * AREA_UNITS[unit].perM2(lat);
  return unit === "ac" ? Number(v.toFixed(4)) : Math.round(v);
}
/** maxAllowableOffset (degrees) that keeps the generalised outline within half a pixel of the true one at the tile's bucket zoom — and so
 * within one pixel anywhere in the bucket's zoom range. Rounded for a stable URL. */
export function offsetDegrees(b, lat) {
  const degPerPx = (360 / (256 * 2 ** b)) * Math.cos((lat * Math.PI) / 180);
  return Number((0.5 * degPerPx).toFixed(7));
}

/** The query parameters ONE tile sends, in a fixed (alphabetical) order so the same tile is the same relay-cache key everywhere.
 *   stage "wide" | "mid" — the size cutoff in `where` + generalised geometry (the load-shedding request);
 *   stage "close"        — the same tile, full detail, no size filter (what the old cell query asks for; used by the measurement harness).
 * `area` = { field, unit } from areaFieldForUrl; `fields` = the attribute columns to return (id + lot number). Pure. */
export function buildWideTileQuery({ tile, stage, area, fields, tier = 0 }) {
  if (!tile || !(stage === "wide" || stage === "mid" || stage === "close")) throw new Error("buildWideTileQuery: a tile and a stage are required");
  const outFields = [...new Set((fields || []).filter(okFieldName))];
  if (!outFields.length) throw new Error("buildWideTileQuery: no return fields");
  const env = tileEnvelope(tile);
  const lat = (env[1] + env[3]) / 2;
  const p = {};
  p.f = "json";
  p.geometry = env.join(",");
  p.geometryType = "esriGeometryEnvelope";
  p.inSR = 4326;
  p.outFields = outFields.join(",");
  p.outSR = 4326;
  p.returnGeometry = true;
  p.spatialRel = "esriSpatialRelIntersects";
  if (stage === "close") {
    p.geometryPrecision = 6;
    p.where = "1=1";
  } else {
    if (!area || !okAreaField(area.field) || !AREA_UNITS[area.unit]) throw new Error("buildWideTileQuery: a wide tile needs a verified size column");
    p.geometryPrecision = 5;
    p.maxAllowableOffset = offsetDegrees(tile.b, lat);
    p.where = `${area.field} >= ${areaCutoff({ stage, tier, unit: area.unit, lat })}`;
  }
  return { params: Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1))), env, lat };
}

/** True when `host` can be fetched through Planyr's own gis-cache relay (its allow-list). */
export function relayAllows(layerUrl) {
  try { return ALLOWED_GIS_HOST_RE.test(new URL(layerUrl).host); } catch (_) { return false; }
}
/** The URL one tile is fetched from. A county on the relay's allow-list goes through /api/gis-cache/svc/… so the tile is fetched from the
 * county ONCE and served to every user from our cache; a source already behind the same-origin /gis-proxy relay goes through that; anything
 * else is fetched direct (still tiled, filtered, generalised and debounced). Returns { url, body, via }. Pure. */
export function wideTileRequest(layerUrl, params, { relay = true } = {}) {
  const body = serializeEsriParams({ ...params });
  const base = trim(layerUrl);
  if (base.startsWith("/")) return { url: `${base}/query`, body, via: "gis-proxy" };
  if (relay && relayAllows(base)) return { url: `${proxyServiceUrl(base)}/query`, body, via: "gis-cache" };
  return { url: `${base}/query`, body, via: "direct" };
}

/** Should a tile that failed THROUGH the relay be re-asked of the county directly (and the relay written off for this session)? Yes when the
 * relay is not there or refuses us (404/400/403/405), or answers 200 with something that is not an ArcGIS answer (an SPA fallback page on a dev
 * server). NO for a busy county — a 429/503/5xx whose body happens to be plain text or HTML is the COUNTY refusing, and going round the relay
 * to ask it again would defeat the point (no cache, no back-off). Pure. */
export function relayFallbackWanted(via, res) {
  if (via !== "gis-cache" || !res || res.ok) return false;
  if (res.unparsable && res.status === 200) return true;
  return !res.transient && [400, 403, 404, 405].includes(res.status);
}

/** Which per-view hint applies, given each drawing source's cutoff. `sources` = [{ floor, wide }]. Pure.
 *   "none"  no source, or every source draws everything here
 *   "held"  at least one source is drawing only its larger lots (the bottom hint says what is held back)
 *   "far"   at least one source draws nothing yet (the old "zoom in a little" hint) */
export function outlineHoldForView(zoom, sources) {
  let held = false;
  for (const s of sources || []) {
    const st = wideStageForZoom(zoom, s.floor, !!s.wide);
    if (st === "far") return "far";
    if (st === "mid" || st === "wide") held = true;
  }
  return held ? "held" : "none";
}
