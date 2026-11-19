/* B2671212 — the JUDGING RULES of the signed-in road-taper harness (ui-audit/lib/taperVerdicts.mjs) must be able to see the defect.
 *
 * The live harness (ui-audit/verify-road-taper-live.mjs) decides "the joint is tapered, with no step, no spike and no wedge gap" with the pure
 * predicates in that module. A predicate that has never been seen failing is not evidence, so this file runs the SAME predicates on:
 *   · the REAL dissolved network (`roadNetSteps`, what the canvas, the print and the PDF paint) — green with the taper, RED on the build before it
 *     (run this file in a worktree of 2f488fe^ — the real-geometry tests below fail there; recorded on the ledger entry);
 *   · SYNTHETIC defects that are always present, whatever the build: the pre-fix notch (two overlapping rectangles), an equal-width pair, an
 *     outline with a spike, an outline missing its outside corner — each must FAIL its verdict, or the verdict is vacuous. */
import { describe, it, expect } from "vitest";
import { roadNetInputs, roadNetSteps, driveSteps } from "../src/workspaces/site-planner/lib/roadNetBuild.js";
import { profile, straightFailures, equalWidthFailures, angledFailures, parseSvgRing, selfIntersects, profilesDisagree, rasterProfile, fitBox, ringMismatch } from "../ui-audit/lib/taperVerdicts.mjs";

const P = (x, y) => ({ x, y });
const road = (id, pts, travelW) => ({ id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "local" });
const WIDE_HALF = 25.5, NARROW_HALF = 12.5, RATIO = NARROW_HALF / WIDE_HALF, SLOPE_AUTO = 0.1;   // 10 ft of length per foot each edge steps in
async function outerOf(els, id) {
  const inp = await roadNetInputs(els, {});
  const n = driveSteps(roadNetSteps(inp));
  return n.regions.find((r) => r.ids.includes(id)).region.outer;
}
const A = (50 * Math.PI) / 180;
const STRAIGHT = () => [road("W", [P(0, 0), P(200, 0)], 50), road("N", [P(200, 0), P(400, 0)], 24)];
const ANGLED = () => [road("BW", [P(0, 0), P(200, 0)], 50), road("BN", [P(200, 0), P(200 + 200 * Math.cos(A), 200 * Math.sin(A))], 24)];
const EQUAL = () => [road("EA", [P(0, 0), P(200, 0)], 30), road("EB", [P(200, 0), P(400, 0)], 30)];
const ANGLED_SPEC = { c1: [P(0, 0), P(200, 0)], c2: [P(200, 0), P(200 + 200 * Math.cos(A), 200 * Math.sin(A))], halfWide: WIDE_HALF, halfNarrow: NARROW_HALF, lenFt: 130 };
/* the pre-fix shape: the two strips just overlap — one step of the whole width difference at x = 200 */
const NOTCH = [P(0, -WIDE_HALF), P(200, -WIDE_HALF), P(200, -NARROW_HALF), P(400, -NARROW_HALF), P(400, NARROW_HALF), P(200, NARROW_HALF), P(200, WIDE_HALF), P(0, WIDE_HALF)];

describe("the verdicts on the REAL geometry (red on the build before the taper)", () => {
  it("a straight 50 ft → 24 ft joint narrows with no step", async () => {
    const ring = await outerOf(STRAIGHT(), "W");
    const p = profile(ring);
    expect(straightFailures(p, { ratio: RATIO, slopeMax: SLOPE_AUTO * 1.3 })).toEqual([]);
    expect(p.first).toBeCloseTo(WIDE_HALF, 1); expect(p.last).toBeCloseTo(NARROW_HALF, 1);
    expect(p.startFrac).toBeCloseTo(70 / 400, 1);   // the automatic length: 10 ft per foot each edge steps in = 130 ft, ending at the joint
    expect(p.endFrac).toBeCloseTo(0.5, 1);
  });
  it("an angled joint is one simple outline with no spike, no gap and a filled outside corner", async () => {
    const ring = await outerOf(ANGLED(), "BW");
    expect(angledFailures(ring, ANGLED_SPEC)).toEqual([]);
  });
  it("an equal-width pair is unchanged: a plain rectangle", async () => {
    const ring = await outerOf(EQUAL(), "EA");
    expect(equalWidthFailures(profile(ring), ring)).toEqual([]);
    expect(ring).toHaveLength(4);
  });
});

describe("the verdicts can FAIL (always on — a verdict that cannot go red is not evidence)", () => {
  it("the pre-fix notch fails the straight verdict, and says why", () => {
    const f = straightFailures(profile(NOTCH), { ratio: RATIO, slopeMax: SLOPE_AUTO * 1.3 });
    expect(f.some((s) => /step/.test(s))).toBe(true);
    expect(f.some((s) => /too steep/.test(s))).toBe(true);
  });
  it("the pre-fix junction's short CHAMFER (about 1:1.5, no vertical step) fails the straight verdict by slope alone", () => {
    const chamfer = [P(0, -25.5), P(200, -25.5), P(219, -12.5), P(400, -12.5), P(400, 12.5), P(219, 12.5), P(200, 25.5), P(0, 25.5)];
    const f = straightFailures(profile(chamfer), { ratio: RATIO, slopeMax: SLOPE_AUTO * 1.3 });
    expect(f.some((s) => /too steep/.test(s))).toBe(true);
  });
  it("an equal-width pair fails the straight verdict (it does not narrow)", () => {
    const ring = [P(0, -15.5), P(400, -15.5), P(400, 15.5), P(0, 15.5)];
    const f = straightFailures(profile(ring), { ratio: RATIO, slopeMax: SLOPE_AUTO * 1.3 });
    expect(f.some((s) => /narrow/.test(s))).toBe(true);
  });
  it("a tapered pair fails the equal-width verdict", () => {
    const ring = [P(0, -25.5), P(70, -25.5), P(200, -12.5), P(400, -12.5), P(400, 12.5), P(200, 12.5), P(70, 25.5), P(0, 25.5)];
    expect(equalWidthFailures(profile(ring), ring).length).toBeGreaterThan(0);
  });
  it("a spiked outline fails the angled verdict", async () => {
    const ring = (await outerOf(ANGLED(), "BW")).map((p) => ({ ...p }));
    const J = P(200, 0);
    let k = 0, best = -1;
    ring.forEach((p, i) => { const d = Math.hypot(p.x - J.x, p.y - J.y); if (d > best && d < 40) { best = d; k = i; } });
    ring.splice(k, 0, P(J.x + (ring[k].x - J.x) * 4, J.y + (ring[k].y - J.y) * 4));
    expect(angledFailures(ring, ANGLED_SPEC).some((s) => /spike|crosses/.test(s))).toBe(true);
  });
  it("an angled joint whose wide road does not narrow (the pre-fix shape) fails the angled verdict", async () => {
    const ring = [P(0, -25.5), P(200, -25.5), P(209.6, -8), P(338, 145), P(319, 161), P(194, 13), P(200, 25.5), P(0, 25.5)];
    expect(angledFailures(ring, ANGLED_SPEC).some((s) => /not tapering/.test(s))).toBe(true);
  });
  it("an outline missing its outside-corner cover fails the angled verdict (the pre-fix wedge)", async () => {
    // the outside of this bend is the -y side: drop every vertex that fills the corner there, so the outline cuts straight across the wedge
    const ring = await outerOf(ANGLED(), "BW");
    const J = P(200, 0);
    const kept = ring.filter((p) => !(Math.hypot(p.x - J.x, p.y - J.y) < 30 && p.y < J.y && p.x > J.x - 1));
    expect(kept.length).toBeLessThan(ring.length);                                  // the cut really removed something (else this arm is vacuous)
    expect(angledFailures(kept, ANGLED_SPEC).length).toBeGreaterThan(0);
  });
  it("a bow-tie is detected", () => { expect(selfIntersects([P(0, 0), P(10, 10), P(10, 0), P(0, 10)])).toBe(true); expect(selfIntersects(NOTCH)).toBe(false); });
});

describe("comparing renderings", () => {
  it("two scale-free views of one taper agree; a notch disagrees with a taper", () => {
    const taper = [P(0, -25.5), P(70, -25.5), P(200, -12.5), P(400, -12.5), P(400, 12.5), P(200, 12.5), P(70, 25.5), P(0, 25.5)];
    const scaled = taper.map((p) => P(p.x * 3.1 + 500, p.y * 3.1 + 40));
    expect(profilesDisagree(profile(taper), profile(scaled))).toEqual([]);
    expect(profilesDisagree(profile(taper), profile(NOTCH)).length).toBeGreaterThan(0);
  });
  it("fitBox + ringMismatch map a flipped, scaled copy back onto the original", () => {
    const ring = [P(0, -25.5), P(70, -25.5), P(200, -12.5), P(400, -12.5), P(400, 12.5), P(200, 12.5), P(70, 25.5), P(0, 25.5)];
    const ctl = [P(0, 450), P(400, 450), P(400, 481), P(0, 481)];
    const toPdf = (p) => P(p.x * 0.02 + 30, 500 - (p.y + 460) * 0.02);                 // y up, scaled
    const map = fitBox(ctl.map(toPdf), ctl, { flipY: true });
    expect(ringMismatch(ring.map((p) => map(toPdf({ x: p.x, y: p.y + 460 }))), ring.map((p) => P(p.x, p.y + 460)))).toBeLessThan(1e-6);
  });
  it("parseSvgRing reads both 'x y' and 'x,y' paths and drops a repeated closing point", () => {
    expect(parseSvgRing("M1 2 L3 4 L5 6 Z")).toEqual([P(1, 2), P(3, 4), P(5, 6)]);
    expect(parseSvgRing("M1,2 L3,4 L5,6 L1,2")).toEqual([P(1, 2), P(3, 4), P(5, 6)]);
  });
  it("rasterProfile reads a tapered strip from pixels and refuses a blank box", () => {
    const W = 200, H = 60, data = Buffer.alloc(W * H * 3, 255);
    for (let x = 10; x < 190; x++) { const h = x < 60 ? 20 : x < 120 ? 20 - ((x - 60) * 10) / 60 : 10; for (let y = Math.round(30 - h); y < Math.round(30 + h); y++) { const o = (y * W + x) * 3; data[o] = 120; data[o + 1] = 120; data[o + 2] = 120; } }
    const p = rasterProfile({ width: W, channels: 3, data }, { x0: 0, y0: 0, x1: W, y1: H });
    expect(p.last / p.first).toBeCloseTo(0.5, 1);
    expect(p.startFrac).toBeGreaterThan(0.2); expect(p.endFrac).toBeLessThan(0.8);
    // a red dimension marker poking past the strip edge (as the printed "50'" tick caps do) must not read as pavement
    for (let y = 2; y < 58; y++) { const o = (y * W + 80) * 3; data[o] = 230; data[o + 1] = 30; data[o + 2] = 30; }
    const q = rasterProfile({ width: W, channels: 3, data }, { x0: 0, y0: 0, x1: W, y1: H });
    expect(q.maxSlope).toBeLessThan(0.3);
    // …including blurred pink tick caps (lossy page): a road-colour predicate ignores what is not blue-grey
    for (let y = 2; y < 10; y++) { const o = (y * W + 90) * 3; data[o] = 154; data[o + 1] = 116; data[o + 2] = 117; }
    const q2 = rasterProfile({ width: W, channels: 3, data }, { x0: 0, y0: 0, x1: W, y1: H }, { isInk: (r, g, b) => !(r > b + 20) });
    expect(q2.maxSlope).toBeLessThan(0.3);
    expect(rasterProfile({ width: W, channels: 3, data: Buffer.alloc(W * H * 3, 255) }, { x0: 0, y0: 0, x1: W, y1: H })).toBeNull();
  });
});
