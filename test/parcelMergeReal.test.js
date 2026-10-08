import { describe, it, expect } from "vitest";
import { mergeParcelRings, ringContactFt, polyIntersectArea } from "../src/workspaces/site-planner/lib/polyClip.js";
import { polyArea } from "../src/workspaces/site-planner/lib/polygonSplit.js";
import fx from "./fixtures/realParcelPairs.json";

// B2090352 amendment (NEW-1) — merge must fuse REAL county lots that share an edge. The first cut grew every ring,
// unioned and shrank back, so the outline came from an offset round trip: on the owner's Brittmoore pair it handed back
// 734 sq ft LESS ground than the lots contain and the safety net refused ("too far off to fuse"). The outline now comes
// from the untouched input rings; offsetting only ever ADDS bridging slivers.
const pts = (r) => r.map(([x, y]) => ({ x, y }));
// ---- the owner's exact rings, verbatim from the live repro (HCAD 0210690010025 / 0210690010007, 5800 Brittmoore Rd) ----
const BRITT_A = [[-125.932,178.349],[-136.264,178.423],[-127.355,133.821],[-120.149,88.813],[-114.66,43.483],[-110.899,-2.08],[-108.873,-47.79],[-108.586,-93.558],[-110.037,-139.297],[-110.009,-232.353],[496.278,-236.517],[498.875,173.883]];
const BRITT_B = [[892.997,-236.68],[899.414,171.025],[887.17,171.113],[498.875,173.883],[496.278,-236.517]];

const dissolved = (A, B) => polyArea(A) + polyArea(B) - polyIntersectArea(A, B);
// every input vertex that is NOT on the other ring's boundary (i.e. not on the shared edge) must survive in the output
function missingVertices(out, rings) {
  const onBoundary = (p, r) => r.some((a, i) => { const b = r[(i + 1) % r.length]; const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 0.02; });
  const miss = [];
  rings.forEach((r, k) => r.forEach((p) => {
    if (onBoundary(p, rings[1 - k])) return;
    if (!out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.001)) miss.push(p);
  }));
  return miss;
}

describe("mergeParcelRings — the owner's Brittmoore pair", () => {
  const A = pts(BRITT_A), B = pts(BRITT_B);
  it("the repro really is a touching pair (contact 413 ft)", () => {
    expect(ringContactFt(A, B)).toBeGreaterThan(400);
  });
  it("merges to one ring that loses no ground and keeps every vertex off the shared edge", () => {
    const r = mergeParcelRings([A, B]);
    expect(r.ok, JSON.stringify({ ...r, ring: undefined })).toBe(true);
    expect(r.ring.length).toBeGreaterThanOrEqual(3);
    // 414436.76 is what the old centi-foot grid reported; the exact dissolved area of these rings is 414438.02 (both A's and
    // B's own vertices summed, no overlap) — hold the new answer to the exact figure and to the old one within grid noise.
    expect(Math.abs(r.areaSqft - (polyArea(A) + polyArea(B)))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.areaSqft - 414436.76)).toBeLessThanOrEqual(1.5);
    expect(r.areaSqft).toBeGreaterThanOrEqual(r.dissolvedSqft - 0.5); // never gives back less than the lots contain
    expect(missingVertices(r.ring, [A, B])).toEqual([]);
    // the thin acute spike at A's north-west corner and the faceted west curve are the input vertices, bit for bit
    for (const p of A.slice(0, 9)) expect(r.ring.some((q) => q.x === p.x && q.y === p.y)).toBe(true);
  });
  it("reads as 9.51 acres", () => {
    expect(mergeParcelRings([A, B]).areaSqft / 43560).toBeCloseTo(9.514, 2);
  });
});

describe("mergeParcelRings — real Harris County pairs (fixtures, not rectangles)", () => {
  for (const f of fx.pairs) {
    it(`fuses ${f.name} — ${f.note}`, () => {
      const A = pts(f.a), B = pts(f.b);
      const r = mergeParcelRings([A, B]);
      expect(r.ok, JSON.stringify({ ...r, ring: undefined })).toBe(true);
      expect(Math.abs(r.areaSqft - dissolved(A, B))).toBeLessThanOrEqual(1);
      expect(r.areaSqft).toBeGreaterThanOrEqual(dissolved(A, B) - 1);
      expect(missingVertices(r.ring, [A, B])).toEqual([]);
      // order and winding do not matter
      const r2 = mergeParcelRings([B.slice().reverse(), A]);
      expect(r2.ok).toBe(true);
      expect(Math.abs(r2.areaSqft - r.areaSqft)).toBeLessThanOrEqual(1);
    });
  }
});

describe("mergeParcelRings — refusals on real geometry stay refusals", () => {
  const A = pts(BRITT_A);
  const shift = (r, dx, dy) => r.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  it("lots across a 40 ft street are still apart, and a corner touch is still apart", () => {
    const B = pts(BRITT_B);
    expect(mergeParcelRings([A, shift(B, 40, 0)]).code).toBe("apart");
    const sq = [{ x: 498.875, y: 173.883 }, { x: 700, y: 173.883 }, { x: 700, y: 400 }, { x: 498.875, y: 400 }];
    expect(ringContactFt(A, sq)).toBeLessThan(5);
    expect(mergeParcelRings([A, sq]).code).toBe("apart");
  });
  it("state-plane magnitude coordinates (1.4e7 ft) still fuse — the clip runs in a re-centred frame", () => {
    const f = fx.pairs[0];
    const big = (r) => pts(r).map((p) => ({ x: p.x + 2993400, y: p.y + 13844100 }));
    const r = mergeParcelRings([big(f.a), big(f.b)]);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.areaSqft - dissolved(pts(f.a), pts(f.b)))).toBeLessThanOrEqual(1);
  });
});
