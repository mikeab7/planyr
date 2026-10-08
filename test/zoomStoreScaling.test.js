// NEW-1 (Silvestri zoom freeze) — three leaves that scaled with the size of the on-device plan store inside a
// planner zoom step. Each is now cached/gated; these pin that the cache is correct (never stale) and effective.
import { describe, it, expect } from "vitest";
import { skipWhileHidden } from "../src/workspaces/site-planner/lib/hiddenRenderGate.js";
import { siteAcres } from "../src/workspaces/site-planner/lib/siteBoundary.js";
import * as polyClip from "../src/workspaces/site-planner/lib/polyClip.js";

const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

describe("hiddenRenderGate.skipWhileHidden", () => {
  it("skips only when hidden before AND now, isActive unchanged", () => {
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: false, isActive: true, other: 1 })).toBe(true);
  });
  it("renders when it becomes visible, is visible, or isActive flips", () => {
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: true, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: true, isActive: true }, { visible: false, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: true, isActive: true }, { visible: true, isActive: true })).toBe(false);
    expect(skipWhileHidden({ visible: false, isActive: true }, { visible: false, isActive: false })).toBe(false);
  });
});

describe("siteAcres cache", () => {
  const site = (parcels) => ({ parcels });
  it("equals the uncached dissolved area on first and repeat calls (effectiveness is measured by the harness)", () => {
    const parcels = [{ id: "a", points: sq(0, 0, 208.71) }, { id: "b", points: sq(100, 0, 208.71) }]; // overlapping
    const want = polyClip.dissolvedParcelSqft(parcels) / 43560;
    expect(siteAcres(site(parcels))).toBeCloseTo(want, 10);
    expect(siteAcres(site(parcels.map((p) => ({ ...p })))))   .toBeCloseTo(want, 10); // new objects, same geometry
  });
  it("is a MISS for every input the area reads — never a stale acreage", () => {
    const base = [{ id: "a", points: sq(0, 0, 300) }];
    const a0 = siteAcres(site(base));
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 301) }]))).not.toBeCloseTo(a0, 6);                 // vertex moved
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 300), active: false }]))).toBe(0);                 // inactive
    expect(siteAcres(site([{ id: "a", points: sq(0, 0, 300), exceptions: [{ pts: sq(10, 10, 50) }] }]))).toBeLessThan(a0); // save-and-except
    expect(siteAcres(site([]))).toBe(0);
  });
});
