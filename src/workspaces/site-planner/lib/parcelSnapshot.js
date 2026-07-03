/* Client loader for the county PARCEL snapshot cache (B629).
 *
 * Plain-English: a nightly job saves a whole-county copy of the parcel outlines into Google Drive
 * (served by functions/api/parcel-cache). This module downloads that copy once, keeps it in the
 * browser (IndexedDB, uncapped — B474), and answers "draw the parcels in view" + "what lot is under
 * this click" entirely LOCALLY — so a flaky county server (Chambers/Waller ride the State/TxGIO
 * service that keeps going down) no longer blanks the map. It is a FALLBACK layered on top of the
 * live flow, never a replacement: it only supplies geometry the live source can't.
 *
 * The geometry helpers (featuresForView / featureAtPoint / featureBbox) are pure and unit-tested in
 * plain Node (test/parcelSnapshot.test.js). The IO (ensureSnapshot / IndexedDB / fetch) degrades to
 * a no-op when IndexedDB/fetch/DecompressionStream aren't available, so behaviour is never worse
 * than today. Kill switch: VITE_PARCEL_SNAPSHOT=0.
 */
import { geoJsonToEsriFeature, outerRingsLngLat } from "./arcgis.js";
import { SNAPSHOT_COUNTIES } from "./counties.js";
import { idbGet, idbPut } from "./localDb.js";

const IDB_PREFIX = "parcel-snapshot:v1:";
const idbKey = (county) => `${IDB_PREFIX}${county}:full`;

// Default ON; disabled only by an explicit VITE_PARCEL_SNAPSHOT=0/false/off (mirrors VITE_GIS_PROXY).
export function snapshotEnabled() {
  try {
    const v = import.meta && import.meta.env ? import.meta.env.VITE_PARCEL_SNAPSHOT : undefined;
    return v !== "0" && v !== "false" && v !== "off" && v !== false;
  } catch (_) { return true; }
}

// ---------------------------------------------------------------------------
// Pure geometry (no DOM / IO) — the core the map's render + click paths call.
// ---------------------------------------------------------------------------

/* [minLng, minLat, maxLng, maxLat] over a GeoJSON Polygon/MultiPolygon feature's coords, or null.
 * Pure. Memoised on the feature via a non-enumerable field so a viewport filter over ~30k parcels
 * doesn't recompute every pan. */
export function featureBbox(feature) {
  if (!feature || !feature.geometry) return null;
  if (feature.__bbox) return feature.__bbox;
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : null;
  if (!rings || !rings.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const p of ring) {
    const x = p[0], y = p[1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  const b = [minX, minY, maxX, maxY];
  try { Object.defineProperty(feature, "__bbox", { value: b, enumerable: false, configurable: true }); } catch (_) {}
  return b;
}

// Absolute shoelace area (deg²) of an [[lng,lat]…] ring list — only for the smallest-lot tiebreak
// (mirrors optimisticHitAt preferring the tighter parcel when several overlap). Pure.
function ringsAreaAbs(parts) {
  let a = 0;
  for (const r of parts) { let s = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; s += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } a += Math.abs(s / 2); }
  return a;
}

// Even-odd point-in-ring on [[lng,lat]…]. Same test as MapFinder.optimisticHitAt. Pure.
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* The features whose bbox intersects the view (lng/lat `{ w, s, e, n }`). Cheap bbox reject so only
 * a few hundred parcels are ever drawn/hit-tested at site zoom. Pure. */
export function featuresForView(features, bounds) {
  if (!bounds) return features || [];
  const { w, s, e, n } = bounds;
  return (features || []).filter((f) => {
    const b = featureBbox(f);
    return b && !(b[2] < w || b[0] > e || b[3] < s || b[1] > n);
  });
}

/* The parcel under a clicked point, as the SAME esri feature shape the identify pipeline returns
 * (`{ geometry: { rings }, attributes }`, lng/lat), so it feeds `addParcelHit` with no new logic.
 * Prefers the tightest containing lot (parity with optimisticHitAt). Returns null if none. Pure. */
export function featureAtPoint(features, lng, lat) {
  let best = null, bestArea = Infinity;
  for (const f of features || []) {
    const b = featureBbox(f);
    if (!b || lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    const esri = geoJsonToEsriFeature(f);
    if (!esri) continue;
    const parts = outerRingsLngLat(esri);
    if (!parts.length || !parts.some((r) => pointInRing(lng, lat, r))) continue;
    const area = ringsAreaAbs(parts);
    if (area < bestArea) { best = esri; bestArea = area; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// IO — download once, hold in IndexedDB, SWR-refresh when the Drive copy is newer.
// ---------------------------------------------------------------------------

const loaded = new Map();       // county -> { generatedAt, count, features, bbox }
const inflight = new Map();     // county -> Promise (dedupe concurrent ensureSnapshot)
const listeners = new Set();    // repaint hooks

/* The in-memory snapshot for a county (null until loaded). Synchronous — the render/click paths
 * read this after `ensureSnapshot` has warmed it. */
export function getSnapshot(county) { return loaded.get(county) || null; }
export function snapshotVintage(county) { const s = loaded.get(county); return s ? { asOf: s.generatedAt || null, count: s.count ?? (s.features ? s.features.length : 0) } : null; }

/* Subscribe to "a snapshot loaded/refreshed" so the map can repaint. Returns an unsubscribe fn. */
export function onSnapshotChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitChange(county) { for (const fn of listeners) { try { fn(county); } catch (_) {} } }

/* Warm the snapshot for a county: (1) load the IndexedDB copy into memory instantly if present,
 * then (2) background-check the Drive vintage and re-download only when it's newer (SWR). Safe to
 * call repeatedly / on every county-open. Resolves the current in-memory snapshot (possibly null).
 * `fetchImpl` is injectable for tests. */
export async function ensureSnapshot(county, { fetchImpl, base = "/api/parcel-cache" } = {}) {
  if (!snapshotEnabled() || !SNAPSHOT_COUNTIES.has(county)) return null;
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (inflight.has(county)) return inflight.get(county);

  const run = (async () => {
    // 1. Instant: hydrate memory from IndexedDB.
    if (!loaded.has(county)) {
      const stored = await idbGet(idbKey(county)).catch(() => null);
      if (stored && Array.isArray(stored.features)) { loaded.set(county, stored); emitChange(county); }
    }
    // 2. Background: is Drive's copy newer (or do we have nothing)?
    if (doFetch) await refreshFromDrive(county, doFetch, base).catch(() => {});
    return loaded.get(county) || null;
  })();

  inflight.set(county, run);
  try { return await run; } finally { inflight.delete(county); }
}

async function refreshFromDrive(county, doFetch, base) {
  const cur = loaded.get(county);
  let meta = null;
  try { const r = await doFetch(`${base}/svc/${county}?meta=1`); meta = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!meta || !meta.cached) return; // nothing on Drive yet → keep what we have (maybe nothing)
  // Up to date? (same vintage) → nothing to do.
  if (cur && cur.generatedAt && meta.generatedAt && cur.generatedAt === meta.generatedAt) return;

  let fc = null;
  try { const r = await doFetch(`${base}/svc/${county}`); fc = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!fc || !Array.isArray(fc.features)) return;

  const snap = {
    generatedAt: meta.generatedAt || null,
    count: meta.count ?? fc.features.length,
    features: fc.features,
    bbox: meta.bbox || null,
  };
  loaded.set(county, snap);
  idbPut(idbKey(county), snap).catch(() => {});
  emitChange(county);
}

// Test/teardown helper — clear the in-memory registry (IndexedDB untouched).
export function _resetSnapshots() { loaded.clear(); inflight.clear(); }
