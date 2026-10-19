/* featureWindow — cut GIS polygon features to a window around the site (problem report 6cea9895). A LEAF beside
 * jurisdictionShare's cut, shared by siteChecks (main thread) and siteChecksWorker (the polygon query worker), so the
 * worker can window an answer without loading the measurement code.
 *
 * Why: FEMA answers much of Georgia with ONE county-scale Zone X polygon (702,524 vertices at the Chehaw Rd parcel).
 * Every Site Analysis number is an area or a side INTERSECTED WITH THE SITE, so nothing outside a window that holds
 * the site with WINDOW_PAD_M to spare can change one; the cut's artificial edges lie on the window border. Rings are cut
 * independently (outer and holes) with Sutherland–Hodgman in lon/lat, which is exact for the even-odd region a feature
 * forms. `features` = [{ rings: [[ [lng,lat]… ]…], …anything }] — every other key rides through. */
import { siteWindow, clipRingToWindow } from "./jurisdictionShare.js";

// 50 m: the window only has to hold the site (nothing measured reaches past it); measured on the Chehaw answer, 300 m → 50 m
// took the measurement from ~54 ms to ~20 ms in Node with every field identical (test/siteChecksWindow).
export const WINDOW_PAD_M = 50;

/* `padM` Infinity (or a non-finite value) = no cut — the pre-fix whole-polygon reading, kept for the tests' replay. */
export function windowFeatures(siteRings, features, padM = WINDOW_PAD_M) {
  const w = Number.isFinite(padM) ? siteWindow(siteRings, padM) : null;
  if (!w) return features || [];
  const inside = (r) => { for (const p of r) if (p[0] < w.minx || p[0] > w.maxx || p[1] < w.miny || p[1] > w.maxy) return false; return true; };
  const out = [];
  for (const f of features || []) {
    const rings = [];
    for (const r of f.rings || []) {
      if (!r || r.length < 3) continue;
      const c = inside(r) ? r : clipRingToWindow(r, w);
      if (c) rings.push(c);
    }
    if (rings.length) out.push({ ...f, rings });
  }
  return out;
}

/* The same cut over an ArcGIS /query JSON answer ({ features: [{ attributes, geometry: { rings } }] }), as the worker
 * applies it before posting back. A feature the cut would leave with NO ring keeps its original geometry — a polygon
 * the server matched to the site always reaches the window, so this never happens; if it ever did, the measurement
 * must see the real feature rather than a geometry-less one (which siteChecksRun refuses, loudly). */
export function windowArcgisAnswer(j, siteRings, padM = WINDOW_PAD_M) {
  if (!j || !Array.isArray(j.features)) return j;
  const feats = j.features.map((f) => {
    const g = f && f.geometry;
    if (!g || !Array.isArray(g.rings) || !g.rings.length) return f;
    const [cut] = windowFeatures(siteRings, [{ rings: g.rings }], padM);
    return cut ? { ...f, geometry: { ...g, rings: cut.rings } } : f;
  });
  return { ...j, features: feats };
}
