import { describe, it, expect } from "vitest";
import {
  mergeParcelRings, ringContactFt, MERGE_GAP_FT, MERGE_MIN_CONTACT_FT,
} from "../src/workspaces/site-planner/lib/polyClip.js";
import { polyArea, splitPolygonByLine } from "../src/workspaces/site-planner/lib/polygonSplit.js";

// B2090352 — merge parcels must fuse neighbouring lots whose common line is not vertex-for-vertex
// identical. LEGACY below is mergeRings copied VERBATIM from main at 93f7114 (SitePlanner.jsx), kept as
// the red-proof: it is asserted to REFUSE the six realistic adjacencies the owner hit, so this suite
// fails on the old behaviour by construction and the new union is held to the same cases.
// ---- legacy (pre-fix) ----
function mergeRings(ringA, ringB, tol = 0.75) {
  const eq = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  const edges = [];
  const add = (ring) => { for (let i = 0; i < ring.length; i++) edges.push({ a: ring[i], b: ring[(i + 1) % ring.length], dead: false }); };
  add(ringA); add(ringB);
  let shared = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].dead) continue;
    for (let j = 0; j < edges.length; j++) {
      if (j === i || edges[j].dead) continue;
      if (eq(edges[i].a, edges[j].b) && eq(edges[i].b, edges[j].a)) { edges[i].dead = edges[j].dead = true; shared++; break; }
    }
  }
  if (!shared) return null; // no common boundary → nothing to fuse
  const live = edges.filter((e) => !e.dead);
  if (live.length < 3) return null;
  const used = new Array(live.length).fill(false);
  const ring = [live[0].a, live[0].b]; used[0] = true;
  for (let guard = 0; guard < live.length + 2; guard++) {
    const end = ring[ring.length - 1];
    let f = -1;
    for (let k = 0; k < live.length; k++) { if (!used[k] && eq(live[k].a, end)) { f = k; break; } }
    if (f < 0) break;
    used[f] = true;
    ring.push(live[f].b);
  }
  if (ring.length > 1 && eq(ring[0], ring[ring.length - 1])) ring.pop();
  // drop coincident / collinear vertices left over from the cancelled edges
  const dedup = [];
  for (const p of ring) if (!dedup.length || !eq(dedup[dedup.length - 1], p)) dedup.push(p);
  if (dedup.length > 1 && eq(dedup[0], dedup[dedup.length - 1])) dedup.pop();
  const out = [];
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i - 1 + dedup.length) % dedup.length], b = dedup[i], c = dedup[(i + 1) % dedup.length];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const baseLen = Math.hypot(c.x - a.x, c.y - a.y) || 1; // |cross|/base = perpendicular deviation in ft — scale-independent (B28)
    if (Math.abs(cross) / baseLen > 0.1) out.push(b); // keep a vertex only if it bends > ~0.1 ft off the a→c chord
  }
  const final = out.length >= 3 ? out : dedup;
  return final.length >= 3 ? final : null;
}
// ---- end legacy ----

const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const A = R(0, 0, 200, 100);
const ADJ = {
  "identical twin edge": R(200, 0, 400, 100),
  "B shorter (corner lands mid-edge of A)": R(200, 0, 400, 60),
  "B carries one extra vertex on the line": [{ x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 50 }],
  "B wound the same direction as A": R(200, 0, 400, 100).reverse(),
  "1.0 ft gap": R(201, 0, 401, 100),
  "1.0 ft overlap": R(199, 0, 399, 100),
  "B slid 1 ft along the line": R(200, 1, 400, 101),
};
const sumAreas = (...rs) => rs.reduce((s, r) => s + polyArea(r), 0);

describe("mergeParcelRings — the seven adjacency shapes (B2090352)", () => {
  for (const [name, B] of Object.entries(ADJ)) {
    it(`fuses: ${name}; area stays within the stated sliver allowance`, () => {
      const r = mergeParcelRings([A, B]);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      // True union of the inputs (hand-computed per case below) within the closing allowance: gap × contact.
      const expected = { "1.0 ft gap": 40000, "1.0 ft overlap": 39900 }[name] ?? (name.startsWith("B shorter") ? 32000 : 40000);
      expect(Math.abs(r.areaSqft - expected)).toBeLessThanOrEqual(name === "1.0 ft gap" ? 100 + 1 : 1);
      expect(r.areaSqft - r.dissolvedSqft).toBeLessThanOrEqual(MERGE_GAP_FT * 100 + 1); // never grows past gap × contact
      expect(r.ring.length).toBeGreaterThanOrEqual(4);
    });
  }
  it("the LEGACY rule refuses six of the seven (red-proof against main)", () => {
    const refused = Object.entries(ADJ).filter(([, B]) => mergeRings(A, B) === null).map(([k]) => k);
    expect(refused).toHaveLength(6);
    expect(refused).not.toContain("identical twin edge");
  });
  it("conserves area exactly for a clean shared edge and keeps four corners", () => {
    const r = mergeParcelRings([A, ADJ["identical twin edge"]]);
    expect(r.areaSqft).toBeCloseTo(40000, 1);
    expect(r.ring).toHaveLength(4);
  });
  it("is order- and winding-independent", () => {
    const a = mergeParcelRings([ADJ["B shorter (corner lands mid-edge of A)"], A.slice().reverse()]);
    expect(a.ok).toBe(true);
    expect(a.areaSqft).toBeCloseTo(32000, 1);
  });
});

describe("mergeParcelRings — refusals stay refusals", () => {
  it("lots that only meet at a single corner are refused (apart)", () => {
    const r = mergeParcelRings([A, R(200, 100, 400, 200)]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("apart");
    expect(ringContactFt(A, R(200, 100, 400, 200))).toBeLessThan(MERGE_MIN_CONTACT_FT);
  });
  it("lots with real distance between them are refused, at 5 ft and across a 40 ft street", () => {
    expect(mergeParcelRings([A, R(205, 0, 405, 100)]).code).toBe("apart");
    expect(mergeParcelRings([A, R(240, 0, 440, 100)]).code).toBe("apart");
  });
  it("names the odd one out: three picked, two touch, one far away", () => {
    const far = R(1000, 0, 1100, 100);
    const r = mergeParcelRings([A, far, ADJ["identical twin edge"]]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("apart");
    expect(r.groups[0].sort()).toEqual([0, 2]);
    expect(r.groups[1]).toEqual([1]);
  });
  it("lots that ring an unpicked out-parcel are refused with the hole reason, not silently filled", () => {
    // 300×300 block with a 100×100 middle lot left out: eight picked lots around it.
    const lots = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!(i === 1 && j === 1)) lots.push(R(i * 100, j * 100, i * 100 + 100, j * 100 + 100));
    const r = mergeParcelRings(lots);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("hole");
    expect(r.holeSqft).toBeCloseTo(10000, 0);
    // …and picking the middle lot too merges cleanly into the full block.
    const all = mergeParcelRings([...lots, R(100, 100, 200, 200)]);
    expect(all.ok).toBe(true);
    expect(all.areaSqft).toBeCloseTo(90000, 0);
  });
  it("rejects fewer than two rings / bad rings", () => {
    expect(mergeParcelRings([A]).ok).toBe(false);
    expect(mergeParcelRings([A, [{ x: 0, y: 0 }, { x: 1, y: 1 }]]).code).toBe("invalid");
  });
});

describe("mergeParcelRings — greedy groups and splits", () => {
  it("three lots in an L collapse to one parcel with the L's area", () => {
    const a = R(0, 0, 200, 100), b = R(200, 0, 400, 100), c = R(0, 100, 150, 250); // c sits on top of a, shorter
    const r = mergeParcelRings([a, b, c]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.areaSqft).toBeCloseTo(40000 + 150 * 150, 0);
    expect(r.ring).toHaveLength(6);
  });
  it("a chain where the middle lot is listed last still fuses (no pick-order dependence)", () => {
    const l = R(0, 0, 100, 100), m = R(100, 0, 200, 100), rr = R(200, 0, 300, 100);
    const r = mergeParcelRings([l, rr, m]);
    expect(r.ok).toBe(true);
    expect(r.areaSqft).toBeCloseTo(30000, 0);
    expect(r.ring).toHaveLength(4);
  });
  it("split-then-merge round-trips to the original outline (polygonSplit relies on exact twin edges)", () => {
    const original = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 340, y: 120 }, { x: 150, y: 210 }, { x: -20, y: 130 }];
    const pieces = splitPolygonByLine(original, { x: 120, y: -50 }, { x: 160, y: 300 });
    expect(pieces).toHaveLength(2);
    const r = mergeParcelRings(pieces);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(Math.abs(r.areaSqft - polyArea(original))).toBeLessThan(0.1); // clipper centi-foot grid
    expect(r.ring).toHaveLength(original.length);
    for (const p of original) expect(Math.min(...r.ring.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))).toBeLessThan(0.02);
    expect(Math.abs(sumAreas(...pieces) - r.areaSqft)).toBeLessThan(0.1);
  });
});
