/* NEW-1 (B217540 recurrence ×2) — the dissolve and the stripe clip are asked once per distinct input.
 * `roadNet` is keyed on `els`, so dragging a BUILDING re-ran the whole dissolved road network every frame; the
 * functions are pure, so the answer is cached on the exact ring VALUES. The contract has two halves and BOTH are
 * asserted: a repeat is a hit (the point of it), and any real change is a MISS (never a stale road). */
import { describe, it, expect, beforeEach } from "vitest";
import { dissolveRings, clipPolylineOutside, resetRoadNetworkCaches, roadNetworkStats } from "../src/workspaces/site-planner/lib/roadNetwork.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const area = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + (p.x * q.y - q.x * p.y); }, 0)) / 2;

beforeEach(() => resetRoadNetworkCaches());

describe("dissolveRings", () => {
  const parts = () => [rect(0, 0, 100, 20), rect(80, 0, 20, 100)];       // an L of two strips
  it("a value-equal repeat is a cache HIT and returns the very same answer", () => {
    const a = dissolveRings(parts());
    const b = dissolveRings(parts());                                    // fresh arrays, identical values — what every frame of a building drag hands it
    expect(b).toBe(a);
    expect(roadNetworkStats.dissolveCalls).toBe(2);
    expect(roadNetworkStats.dissolveHits).toBe(1);
  });
  it("the cached answer equals a from-scratch one (the cache changes cost, never geometry)", () => {
    const first = dissolveRings(parts());
    resetRoadNetworkCaches();
    const fresh = dissolveRings(parts());
    expect(fresh).toEqual(first);
    expect(area(fresh[0].outer)).toBeCloseTo(100 * 20 + 20 * 100 - 20 * 20, 3);
  });
  it("a road that REALLY moved is a miss — never a stale road", () => {
    const a = dissolveRings(parts());
    const moved = parts(); moved[1] = rect(80, 0.5, 20, 100);            // half a foot
    const b = dissolveRings(moved);
    expect(b).not.toBe(a);
    expect(roadNetworkStats.dissolveHits).toBe(0);
  });
  it("the pad a road is cut against is part of the key", () => {
    const a = dissolveRings(parts(), { subtract: [rect(90, 90, 30, 30)] });
    const b = dissolveRings(parts(), { subtract: [rect(90, 80, 30, 30)] });
    const c = dissolveRings(parts(), { subtract: [rect(90, 90, 30, 30)] });
    expect(b).not.toBe(a);
    expect(c).toBe(a);
  });
  it("the memo is bounded — it can never grow without limit over a long session", () => {
    for (let i = 0; i < 400; i++) dissolveRings([rect(i, 0, 10, 10), rect(i + 5, 5, 10, 10)]);
    expect(roadNetworkStats.dissolveCalls).toBe(400);                   // and it did not throw or balloon
  });
});

describe("clipPolylineOutside", () => {
  const line = [{ x: -10, y: 5 }, { x: 110, y: 5 }];
  it("a repeat against the same cutters is a hit; a moved cutter is a miss", () => {
    const a = clipPolylineOutside(line, [rect(40, 0, 20, 10)]);
    const b = clipPolylineOutside(line, [rect(40, 0, 20, 10)]);
    expect(b).toBe(a);
    const c = clipPolylineOutside(line, [rect(60, 0, 20, 10)]);
    expect(c).not.toBe(a);
    expect(roadNetworkStats.clipHits).toBe(1);
    // and the answers are genuinely different, so the miss was necessary: the hole in the stripe moved
    const holeOf = (segs) => { const xs = segs.map((sg) => [sg[0].x, sg[sg.length - 1].x].sort((p, q) => p - q)).sort((p, q) => p[0] - q[0]); return [Math.round(xs[0][1]), Math.round(xs[1][0])]; };
    expect(holeOf(a)).toEqual([40, 60]);
    expect(holeOf(c)).toEqual([60, 80]);
  });
  it("a cutter nowhere near the line takes the early exit and is not cached (nothing to save)", () => {
    const out = clipPolylineOutside(line, [rect(500, 500, 10, 10)]);
    expect(out).toHaveLength(1);
    expect(roadNetworkStats.clipHits).toBe(0);
  });
});
