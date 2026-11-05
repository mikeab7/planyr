/* NEW-1 (road → parking) / B1756546 — THE STOPPING RULE, as a sweep: no junction anywhere in the 0–89° approach × road width × return radius × drive length
 * sweep builds a curb return further from the junction than the drive's own run plus the return's own radius. The 2026-07 measurement: a 48 ft drive meeting a pad
 * edge 86° off perpendicular put the fillet's corner 351 ft along the edge — 50 ft past the drive's far end — and built a full R = 40 return out there (9,127 sq ft of
 * wedge against a 14,700 sq ft road). Product call recorded on B1756546: a drive within 10° of the face (or whose corner lies past its own far end) is a SKIM — it lies
 * against the field, builds no return, and the outline is open exactly where it touches. */
import { describe, it, expect } from "vitest";
import { driveJunctionsOf, SKIM_MAX_PHI_DEG } from "../src/workspaces/site-planner/lib/roadJunctions.js";

const PAD = { id: "pad", type: "paving", cx: 0, cy: 0, w: 800, h: 300, rot: 0 };
const OFFS = [0, 10, 20, 30, 40, 45, 50, 55, 60, 65, 70, 75, 78, 80, 82, 85, 86, 88, 89];
function build(w, R, off, run, kind = "truckcourt") {
  const a = (off * Math.PI) / 180, P = { x: 0, y: -150 }, dir = { x: Math.sin(a), y: -Math.cos(a) };
  const road = { id: "r", type: "road", pts: [{ x: P.x + dir.x * run, y: P.y + dir.y * run }, P], vtx: [{}, {}], travelW: w, curb: 0.5, roadClass: "aisle", driveTee: { targetId: "pad", kind, returnR: R, flare: 0 } };
  return driveJunctionsOf([PAD, road], {})[0];
}
const reach = (j) => Math.max(0, ...j.geom.wedges.flat().map((p) => Math.hypot(p.x - j.junctionPt.x, p.y - j.junctionPt.y)));

describe("B1756546 — nothing a junction builds runs away from it", () => {
  const rows = [];
  for (const w of [16, 24, 32, 40, 48]) for (const R of [24, 40]) for (const off of OFFS) for (const run of [60, 140]) rows.push({ w, R, off, run, j: build(w, R, off, run) });
  it(`all ${rows.length} cases connect, and no wedge vertex lies beyond (the drive's run + its return radius) from the junction`, () => {
    expect(rows.every((r) => r.j)).toBe(true);
    const bad = rows.filter((r) => reach(r.j) > r.run + r.R + 1).map((r) => `${r.w}ft R${r.R} ${r.off}° run ${r.run}: ${reach(r.j).toFixed(0)}`);
    expect(bad).toEqual([]);
  });
  it("the sweep is NOT vacuous: it contains skims AND ordinary junctions with real returns (a guard that can only pass is not a guard)", () => {
    expect(rows.filter((r) => r.j.geom.skim).length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.j.geom.skim && r.j.geom.wedges.length === 2).length).toBeGreaterThan(100);
  });
  it("the product call: every approach flatter than 10° to the face is a skim with no wedge, and the mouth is the stretch it lies against (on the face, never past the field)", () => {
    for (const r of rows.filter((x) => x.off > 90 - SKIM_MAX_PHI_DEG)) {
      expect(r.j.geom.skim, `${r.w} ${r.off}°`).toBe(true);
      expect(r.j.geom.wedges.length).toBe(0);
      const [a, b] = r.j.geom.throughTangents;
      expect(Math.abs(a.y + 150) < 1e-6 && Math.abs(b.y + 150) < 1e-6).toBe(true);
      expect(Math.max(Math.abs(a.x), Math.abs(b.x))).toBeLessThanOrEqual(400 + 1e-6);
    }
  });
  it("ordinary approaches are untouched: perpendicular and 45° into a pad keep two returns at the requested radius scale", () => {
    for (const off of [0, 45]) { const j = build(24, 24, off, 140); expect(j.geom.skim).toBeFalsy(); expect(j.geom.wedges.length).toBe(2); }
  });
});
