/* B2671311 (audit batch G2 step 4a) — the drainage check's invalidation signature moved out of SitePlanner.jsx into a pure lib.
 * This pins it against a verbatim copy of the pre-move inline implementation, so the move cannot change when a stored check goes stale. */
import { describe, it, expect } from "vitest";
import { drainCentroidOf, drainElsSignature, drainSignature } from "../src/workspaces/site-planner/lib/drainageSignature.js";
import { FM_FILL_TYPES } from "../src/workspaces/site-planner/lib/floodFootprintMemo.js";
import { ringOf } from "../src/workspaces/site-planner/lib/siteGeometry.js";

// ---- the PRE-MOVE inline code, verbatim ----
function oldSig(parcels, els, siteSqft, origin) {
  const drainActive = parcels.filter((p) => p.active !== false && p.points && p.points.length >= 3);
  const drainCentroid = drainActive.length
    ? drainActive.flatMap((p) => p.points).reduce((s, pt, _i, arr) => [s[0] + pt.x / arr.length, s[1] + pt.y / arr.length], [0, 0])
    : [0, 0];
  const drainElsSig = (() => {
    let n = 0, minX = 0, minY = 0, maxX = 0, maxY = 0, first = true;
    for (const e of els) {
      if (!FM_FILL_TYPES.has(e.type) && e.type !== "pond") continue;
      let r; try { r = ringOf(e); } catch (_) { continue; }
      if (!r || r.length < 3) continue;
      n++;
      for (const pt of r) {
        if (first) { minX = maxX = pt.x; minY = maxY = pt.y; first = false; continue; }
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
      }
    }
    return n + "@" + [minX, minY, maxX, maxY].map((v) => Math.round(v / 50)).join(",");
  })();
  return drainActive.length + ":" + Math.round(siteSqft) + ":" +
    Math.round(drainCentroid[0] / 50) + "," + Math.round(drainCentroid[1] / 50) + ":" +
    (origin ? `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}` : "nogeo") + ":" + drainElsSig;
}
function newSig(parcels, els, siteSqft, origin) {
  const active = parcels.filter((p) => p.active !== false && p.points && p.points.length >= 3);
  return drainSignature({ activeCount: active.length, siteSqft, centroid: drainCentroidOf(active), origin, elsSig: drainElsSignature(els) });
}
const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const FIXTURES = [
  { name: "nothing drawn, no origin", parcels: [], els: [], area: 0, origin: null },
  { name: "one parcel, origin, a pond", parcels: [{ id: "p", points: sq(0, 0, 1000) }], els: [{ id: "a", type: "pond", points: sq(100, 100, 200) }], area: 1e6, origin: { lat: 29.7604, lon: -95.3698 } },
  { name: "inactive + degenerate parcels are ignored", parcels: [{ id: "p", points: sq(0, 0, 500) }, { id: "q", active: false, points: sq(900, 900, 500) }, { id: "r", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], els: [], area: 250000, origin: { lat: 30, lon: -96 } },
  { name: "fill + pond + building (building ignored)", parcels: [{ id: "p", points: sq(-300, 200, 800) }], els: [{ id: "b", type: "building", x: 0, y: 0, w: 100, h: 100, rot: 0 }, { id: "f", type: "pond", points: sq(-50, 20, 90) }, { id: "g", type: "pond", points: sq(400, 400, 120) }], area: 640000, origin: { lat: 29.5, lon: -95.5 } },
  { name: "a pond with a broken ring is skipped", parcels: [{ id: "p", points: sq(0, 0, 100) }], els: [{ id: "x", type: "pond", points: [{ x: 0, y: 0 }] }], area: 10000, origin: null },
];
describe("drainageSignature — identical to the pre-move inline implementation", () => {
  for (const f of FIXTURES) it(f.name, () => expect(newSig(f.parcels, f.els, f.area, f.origin)).toBe(oldSig(f.parcels, f.els, f.area, f.origin)));
  it("a 40-ft nudge of a parcel keeps the signature; a 400-ft move changes it", () => {
    const base = { parcels: [{ id: "p", points: sq(0, 0, 1000) }], els: [], area: 1e6, origin: { lat: 29.7, lon: -95.3 } };
    const nudged = { ...base, parcels: [{ id: "p", points: sq(10, 10, 1000) }] };
    const moved = { ...base, parcels: [{ id: "p", points: sq(400, 0, 1000) }] };
    expect(newSig(nudged.parcels, [], 1e6, base.origin)).toBe(newSig(base.parcels, [], 1e6, base.origin));
    expect(newSig(moved.parcels, [], 1e6, base.origin)).not.toBe(newSig(base.parcels, [], 1e6, base.origin));
  });
  it("re-georeferencing (same shape, new origin) invalidates", () => {
    const p = [{ id: "p", points: sq(0, 0, 1000) }];
    expect(newSig(p, [], 1e6, { lat: 29.7, lon: -95.3 })).not.toBe(newSig(p, [], 1e6, { lat: 29.8, lon: -95.3 }));
  });
});
