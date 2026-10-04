import { describe, it, expect } from "vitest";
import { callsToPath, pathCloses } from "../src/workspaces/site-planner/lib/deedParse.js";
import { deedTrace, deedGapText, DEED_GAP_NOISE_FT } from "../src/workspaces/site-planner/lib/deedGap.js";
import { rotatePointsAbout } from "../src/workspaces/site-planner/lib/deedAlign.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Real calls, Grand Port (smqfy2r7pdec) — "Tract 1 – 94.53 Acres" (e79375qioqog), as stored.
const TRACT1 = [[87.07111111111111, 1773.49], [87.2625, 763.87], [180, 445.02], [270, 825.06], [290.05944444444447, 17.15], [290.0761111111111, 41.13], [180.26, 60], [90, 39.94], [180.04777777777778, 1023.21], [173.37583333333333, 233.99], [168.3925, 307.5], [251.4011111111111, 1790.01], [357.3377777777778, 2477.79]].map(([az, distFt]) => ({ az, distFt }));
// Save-and-except hole e1454611zupcbv — misses by ~0.01 ft.
const HOLE = [[116.72083333333333, 572.04], [180.27444444444444, 1212.6], [164.90055555555554, 295.46], [254.14555555555557, 425.88], [3.963611111111111, 1414.11], [296.7208333333333, 285.18], [357.33722222222224, 332.82]].map(([az, distFt]) => ({ az, distFt }));
const POB = { x: -5411.866145162672, y: -894.8682879882338 };
// exactly closing square
const SQUARE = [{ az: 90, distFt: 100 }, { az: 180, distFt: 100 }, { az: 270, distFt: 100 }, { az: 0, distFt: 100 }];

// What the pre-fix code drew: the final endpoint dropped whenever pathCloses() said "closed".
const oldRing = (path) => (pathCloses(path) ? path.slice(0, -1) : path);

describe("deedGap — draw the description exactly as written, show the misclosure", () => {
  const path = callsToPath(TRACT1, POB);
  it("RED PROOF: the old rule hid the 31 ft miss (and treats the tract as closed)", () => {
    expect(pathCloses(path)).toBe(true);
    expect(oldRing(path).length).toBe(path.length - 1); // last as-written vertex dropped
  });
  it("Tract 1: last as-written vertex is NOT the POB, and a ~31.4 ft gap segment exists", () => {
    const t = deedTrace({ centerline: path, pts: oldRing(path) });
    const last = t.ring[t.ring.length - 1];
    expect(dist(last, POB)).toBeGreaterThan(30);
    expect(t.ring.length).toBe(path.length);
    expect(t.gap).not.toBeNull();
    expect(t.gap.ft).toBeGreaterThan(31.3); expect(t.gap.ft).toBeLessThan(31.5);
    expect(dist(t.gap.from, last)).toBe(0); expect(dist(t.gap.to, POB)).toBe(0);
    expect(t.gap.ratio).toBeGreaterThan(300);
    expect(t.perimFt).toBeGreaterThan(9000);
  });
  it("closing course ends where its bearing and distance put it", () => {
    const t = deedTrace({ centerline: path, pts: [] });
    const prev = t.ring[t.ring.length - 2], last = t.ring[t.ring.length - 1];
    expect(dist(prev, last)).toBeCloseTo(2477.79, 2);
  });
  it("panel wording names the miss, the red dashed line and the precision", () => {
    const g = deedGapText(deedTrace({ centerline: path, pts: [] }));
    expect(g.closes).toBe(false);
    expect(g.text).toMatch(/does not close — it misses by 31\.\d ft\. The red dashed line is the gap\./);
    expect(g.precision).toMatch(/^Precision 1:/);
  });
  it("an exactly-closing deed draws no gap segment and keeps the 'closes' wording", () => {
    const sp = callsToPath(SQUARE, { x: 0, y: 0 });
    const t = deedTrace({ centerline: sp, pts: sp.slice(0, -1) });
    expect(t.gap).toBeNull(); expect(t.ring.length).toBe(4);
    expect(deedGapText(t).closes).toBe(true);
  });
  it("a save-and-except hole missing by ~0.01 ft draws NO gap line", () => {
    const hp = callsToPath(HOLE, { x: 0, y: 0 });
    const miss = dist(hp[0], hp[hp.length - 1]);
    expect(miss).toBeLessThan(DEED_GAP_NOISE_FT);
    expect(deedTrace({ centerline: hp, pts: hp.slice(0, -1) }).gap).toBeNull();
  });
  it("a deed rotated/moved by Align carries its gap with it (same length)", () => {
    const pivot = { x: -4000, y: -1500 };
    const rot = rotatePointsAbout(path, 1.9, pivot).map((p) => ({ x: p.x + 40, y: p.y - 25 }));
    const t = deedTrace({ centerline: rot, pts: rot.slice(0, -1) });
    expect(t.gap.ft).toBeCloseTo(deedTrace({ centerline: path, pts: [] }).gap.ft, 4);
  });
  it("a curve as the last course ends at its chord endpoint — gap measured to the POB", () => {
    const calls = [...SQUARE.slice(0, 3), { az: 10, distFt: 140, curve: true, curveMeta: { radiusFt: 300, turn: "R" } }];
    const cp = callsToPath(calls, { x: 0, y: 0 });
    const t = deedTrace({ centerline: cp, pts: cp.slice(0, -1) });
    expect(t.gap).not.toBeNull();
    expect(dist(t.ring[t.ring.length - 1], cp[cp.length - 1])).toBe(0);
  });
  it("an open traverse beyond tolerance keeps every vertex and shows a gap (promotability rule untouched)", () => {
    const op = callsToPath(SQUARE.slice(0, 3), { x: 0, y: 0 });
    expect(pathCloses(op)).toBe(false);
    expect(deedTrace({ centerline: op, pts: op }).ring.length).toBe(op.length);
  });
  it("a deed with no stored centerline falls back to its ring, no gap", () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(deedTrace({ pts: ring }).gap).toBeNull();
  });
});

// ── NEW-1 (2026-10-04): one closure rule for every user-facing surface ───────────────────────────────
import { deedClosure, deedReaderSummary, deedQueueClosure, deedPlotWarning } from "../src/workspaces/site-planner/lib/deedGap.js";
describe("deed closure wording — one rule (deedTrace.gap), never pathCloses", () => {
  const p1 = callsToPath(TRACT1, POB);
  it("RED PROOF: pathCloses calls Tract 1 closed, yet the user-facing wording must not", () => {
    expect(pathCloses(p1)).toBe(true);
    const cl = deedClosure(p1);
    expect(cl.closes).toBe(false);
    const rd = deedReaderSummary(TRACT1.length, cl).text;
    expect(rd).not.toMatch(/\bcloses\b/);
    expect(rd).toContain("⚠ does NOT close");
    expect(rd).toMatch(/misses by 31\.\d ft/);
    expect(deedQueueClosure(cl)).not.toMatch(/\bcloses\b/);
    const toast = deedPlotWarning(cl);
    expect(toast).toContain("⚠ This description does not close");
    expect(toast).not.toMatch(/\bcloses\b/);
  });
  it("exact-closing deed: silent everywhere", () => {
    const cl = deedClosure(callsToPath(SQUARE, POB));
    expect(cl.closes).toBe(true);
    expect(deedReaderSummary(4, cl).text).toBe("4 calls parsed · closes");
    expect(deedPlotWarning(cl)).toBe("");
  });
  it("a miss between the noise floor and 1 ft warns (no gap > 1 cutoff)", () => {
    const sq = [{ az: 90, distFt: 100 }, { az: 180, distFt: 100 }, { az: 270, distFt: 100 }, { az: 0, distFt: 99.5 }];
    const cl = deedClosure(callsToPath(sq, POB));
    expect(cl.gapFt).toBeCloseTo(0.5, 2);
    expect(deedPlotWarning(cl)).toContain("misses by 0.50 ft");
  });
  it("a hole missing ~0.01 ft is silent; a real hole miss names its tract", () => {
    expect(deedClosure(callsToPath(HOLE, POB)).closes).toBe(true);
    const cl = deedClosure(callsToPath(SQUARE, POB));
    expect(deedPlotWarning(cl, [{ name: "Tract 2", gapFt: 3.2 }])).toContain("Tract 2 (save-and-except) does not close — it misses by 3.20 ft");
  });
  it("open traverse beyond 50 ft still reads as not closing, same wording", () => {
    const open = [{ az: 90, distFt: 100 }, { az: 180, distFt: 100 }, { az: 270, distFt: 100 }, { az: 0, distFt: 20 }];
    const cl = deedClosure(callsToPath(open, POB));
    expect(cl.closes).toBe(false);
    expect(deedReaderSummary(4, cl).text).toContain("⚠ does NOT close — misses by 80.0 ft");
  });
});
