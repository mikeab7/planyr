/* etjNet — B2472945. The DRAWN ETJ layer, netted against city limits: the same rule the header applies (B2472944), applied to the
 * same two layers, so the map never shades an ETJ over ground a city's limits hold.
 *
 * An ETJ is the ground OUTSIDE every city's limits (Local Gov't Code ch. 42). Where a published ETJ polygon lies under a city's
 * limits the two layers disagree, and the limits win — on the header (`jurisdiction.js`, `fetchCityClipOut`) and here. This module
 * is the pure half: ESRI-shaped ETJ features in, ESRI-shaped ETJ features out, each with the city limits cut away.
 *
 *   • a feature wholly inside a city's limits disappears (its label with it); a feature straddling the line keeps only the outside;
 *   • a release-area feature (SB 2038, `_release`) is left alone — it is a statement about ground the CITY's own layer marks, not an
 *     ETJ claim, and it is drawn dotted;
 *   • the removal is REPORTED (`removed`), never silent: how many features were dropped or cut, so a caller can say so.
 * Pure — no network, no DOM. The caller supplies the city polygons (the city layer's own cached features: one source of truth). */
import { esriPolygons, netPolysToEsriRings } from "./jurisdictionShare.js";

/** `cityFeatures`: GeoJSON-style features whose Polygon geometry coordinates are an ESRI flat ring list (what `featuresToGeoJson` stores). */
export function cityPolysFromGeoJson(cityFeatures) {
  const polys = [];
  for (const f of cityFeatures || []) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") polys.push(...esriPolygons({ rings: g.coordinates }));
    else if (g.type === "MultiPolygon") for (const part of g.coordinates) polys.push(...esriPolygons({ rings: part }));
  }
  return polys;
}

const bboxOf = (rings) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
};
const meets = (p, q) => !(p[2] < q[0] || q[2] < p[0] || p[3] < q[1] || q[3] < p[1]);

/** Net ESRI ETJ features against city polygons. Returns `{ features, touched, dropped }`: `touched` = features whose ground a city's
 * limits reach (cut or removed), `dropped` = features that disappeared entirely. A feature no city's box meets is returned UNTOUCHED
 * (same object) — it is not re-wound or re-snapped, so plain ETJ ground is exactly what the publisher drew. */
export function netEtjFeatures(etjFeatures, cityPolys, { ref, minWidthM = 0 } = {}) {
  if (!cityPolys || !cityPolys.length) return { features: etjFeatures.slice(), touched: 0, dropped: 0 };
  const cityBoxes = cityPolys.map((p) => bboxOf([p.outer]));
  const out = [];
  let touched = 0, dropped = 0;
  for (const f of etjFeatures) {
    if (!f || !f.geometry || !(f.geometry.rings || []).length) { out.push(f); continue; }
    if (f.attributes && f.attributes._release) { out.push(f); continue; }
    const fb = bboxOf(f.geometry.rings);
    const near = cityPolys.filter((_, i) => meets(fb, cityBoxes[i]));
    if (!near.length) { out.push(f); continue; }
    const rings = netPolysToEsriRings(esriPolygons(f.geometry), near, ref, { minWidthM });
    touched++;
    if (!rings.length) { dropped++; continue; }
    out.push({ ...f, geometry: { ...f.geometry, rings } });
  }
  return { features: out, touched, dropped };
}
