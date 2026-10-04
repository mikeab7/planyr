/* pinCluster.js — B2013744: pins that sit on the SAME ground must not hide each other.
 *
 * A parcel-anchored comp, a map note on that parcel and the site's own pin all resolve to the
 * parcel's centre, so their markers land on one point and the biggest/last-added one swallows every
 * press meant for the others (owner-measured 2026-10-02: a note's 34x46 hit box fully covered a
 * comp's 14x14 marker — `elementFromPoint` never returned the comp, so it could not be clicked or
 * right-clicked). Pure + Leaflet-free so it is unit-testable.
 *
 * `pinClusterOffsets(points)` takes the pins in PRIORITY order (the first pin of a cluster keeps its
 * true spot; the rest are nudged sideways in SCREEN pixels, so the gap is the same at every zoom)
 * and returns Map id -> [dx, dy]. Only pins that genuinely coincide (within `epsM` metres) move;
 * a lone pin is never touched. The caller applies the offset by shifting the marker's iconAnchor,
 * so the true lat/lon is untouched. */

/** Pixel slots around the cluster's true point: the hit boxes are 34 px wide, so 38 clears them. */
const STEP_X = 38;
const STEP_Y = 50;
const SLOTS = [[0, 0], [STEP_X, 0], [-STEP_X, 0], [0, -STEP_Y], [0, STEP_Y], [STEP_X, -STEP_Y], [-STEP_X, -STEP_Y], [STEP_X, STEP_Y], [-STEP_X, STEP_Y]];

export const slotOffset = (k) => {
  if (k < SLOTS.length) return SLOTS[k];
  // Past the nine hand-placed slots: an ever-wider ring, deterministic in k.
  const ring = Math.ceil((k - SLOTS.length + 1) / 8) + 1;
  const a = (((k - SLOTS.length) % 8) / 8) * 2 * Math.PI;
  return [Math.round(Math.cos(a) * STEP_X * ring), Math.round(Math.sin(a) * STEP_Y * ring)];
};

const metres = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320;
  const dLon = (a.lon - b.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
};

/** @param {{id:string, lat:number, lon:number}[]} points  priority order
 *  @returns {Map<string,[number,number]>} offsets for ONLY the pins that move (never a [0,0] entry) */
export function pinClusterOffsets(points, { epsM = 4 } = {}) {
  const out = new Map();
  const clusters = []; // each: { at:{lat,lon}, n }
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    let c = clusters.find((cl) => metres(cl.at, p) <= epsM);
    if (!c) { c = { at: p, n: 0 }; clusters.push(c); }
    const k = c.n++;
    if (k > 0) out.set(p.id, slotOffset(k));
  }
  return out;
}

/** Stable signature, so a caller can keep the same object identity while nothing moved. */
export const pinOffsetsSig = (m) => [...m.entries()].map(([id, [x, y]]) => `${id}:${x},${y}`).sort().join("|");
