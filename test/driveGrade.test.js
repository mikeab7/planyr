// NEW-1 (2026-11-11, owner, Georgia Test Site › Concept A, Unincorporated Spalding County GA): A DRIVE TIES INTO THE ROAD'S GRADE AT THE
// PROPERTY LINE. The 30-ft entrance drive off Chehaw Rd was graded at about the truck-court elevation (high 780s) all the way to the property
// line while the road and the ground at the line sit near 805: the drive's side slopes cut a deep channel and the flag read "54 ft past the
// property line". The rule (lib/driveGrade.js): the drive starts at the EXISTING ground at the line, a near-flat landing (50 ft at ≤ 2 %), then
// ONE constant grade to the court / lot edge it serves (≤ 8 %), then the court's own plane. Too short for the climb → ONE plain flag, never a cut
// past the line. Every number is a Standards value.
//
// RED-PROOF: on main a road that reaches the property line is only a ring in the grading limit — no plane — so "tie-in at the road's elevation",
// "profile", and "no grading past the line" all fail there (the drive type does not exist). The Chehaw arm replays the owner's bug on the real ground.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { driveTieOf, driveProfile, driveZAt, driveRingOnSite, propertyLineRings, driveDiagnose, driveZNear, roadLimitRings, driveFenceFor, DRIVE_SERVE_REACH_FT, GRADING_DRIVE_DEFAULTS } from "../src/workspaces/site-planner/lib/driveGrade.js";
import { buildProposedSurface, buildPlanes, __setDrainGeometryCache, __clearDrainGeometry } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradingCfg, gradingPack, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { driveFlags } from "../src/workspaces/site-planner/lib/gradingPanelModel.js";
import { layoutLabelSet } from "../src/workspaces/site-planner/lib/spotLabelPlacement.js";
import { chehawInputs } from "../ui-audit/lib/chehawSurfaceNode.mjs";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/* A flat-ground synthetic site: the property is x 0…1000, y 0…600; the road (Chehaw Rd) runs north–south outside the west line; ground is
 * ROAD_Z everywhere (so any cut/fill is the drive's own doing); the building at x 500…900 (FFE 790) has a truck court on its west wall at 786 at the
 * dock face (FFE − the 4-ft dock drop), falling 1.5 % away from the wall, so the court's far (west) edge — where the drive meets it — is 783.45. */
const COURT_EDGE = 786 - 0.015 * 170;
const ROAD_Z = 805, PARCEL = rect(0, 0, 1000, 600);
function site({ roadZ = ROAD_Z, driveFromX = -60, driveToX = 330, y = 300, width = 30, groundAt = null, grading = {}, drive = true } = {}) {
  const cfg = gradingCfg({ enabled: true, ...grading });
  const setback = { parcelRings: [PARCEL], holes: [], rings: [PARCEL] };
  const pack = gradingPack(cfg, setback);
  const existAt = groundAt || (() => roadZ);
  const building = { id: "b", type: "building", ring: rect(500, 150, 400, 300), padElevFt: 790, dockStack: null, accessible: false, slopeOverridePct: null };
  const court = { id: "c", type: "paving", ring: rect(330, 150, 170, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", truckCourt: true };
  const els = [building, court];
  let tie = null;
  if (drive) {
    const centre = [{ x: driveFromX, y }, { x: driveToX, y }];
    tie = driveTieOf(centre, [PARCEL]);
    if (!tie) throw new Error("the test drive found no tie");
    els.push({ id: "d", type: "drive", ring: driveRingOnSite(rect(driveFromX, y - width / 2, driveToX - driveFromX, width), pack.setbackRings, centre[1]), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, drive: { tie: tie.tie, path: tie.path } });
  }
  const s = buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "dg" + JSON.stringify(grading) + roadZ + driveToX }, grading: pack });
  return { s, tie, pack, els, existAt };
}
const pastLine = (g) => (g.outside ? Math.max(0, ...Object.values(g.outside.perEl || {}).map((p) => p.maxPastFt)) : 0);

describe("driveTieOf — where a centerline meets the property line", () => {
  it("a road that starts outside the line and ends inside ties at the crossing, path = tie → far end", () => {
    const t = driveTieOf([{ x: -60, y: 300 }, { x: 330, y: 300 }], [PARCEL]);
    expect(t.tie.x).toBeCloseTo(0, 3); expect(t.tie.y).toBeCloseTo(300, 3);
    expect(t.path[0]).toEqual(t.tie); expect(t.path[t.path.length - 1]).toEqual({ x: 330, y: 300 }); expect(t.tieEnd).toBe(0);
  });
  it("the same road drawn the other way round is the same drive (tie end = the last point)", () => {
    const t = driveTieOf([{ x: 330, y: 300 }, { x: -60, y: 300 }], [PARCEL]);
    expect(t.tieEnd).toBe(1); expect(t.tie.x).toBeCloseTo(0, 3); expect(t.path[t.path.length - 1]).toEqual({ x: 330, y: 300 });
  });
  it("a road that ENDS at / just inside the line ties at the nearest point of the line", () => {
    const t = driveTieOf([{ x: 3, y: 300 }, { x: 330, y: 300 }], [PARCEL]);
    expect(t.tie.x).toBeCloseTo(0, 3);
    const onLine = driveTieOf([{ x: 0, y: 300 }, { x: 330, y: 300 }], [PARCEL]);
    expect(onLine.tie.x).toBeCloseTo(0, 3); expect(onLine.path.length).toBe(2);
  });
  it("NOT a drive: a road wholly inside, one across the whole site, one far outside, one tied at both ends", () => {
    expect(driveTieOf([{ x: 100, y: 300 }, { x: 330, y: 300 }], [PARCEL])).toBeNull();
    expect(driveTieOf([{ x: -50, y: 300 }, { x: 1050, y: 300 }], [PARCEL])).toBeNull();
    expect(driveTieOf([{ x: -200, y: 300 }, { x: -50, y: 300 }], [PARCEL])).toBeNull();
    expect(driveTieOf([{ x: -50, y: 100 }, { x: 200, y: 200 }, { x: -50, y: 400 }], [PARCEL])).toBeNull();
  });
  it("walks a bent centerline: the path keeps the bend", () => {
    const t = driveTieOf([{ x: -50, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }], [PARCEL]);
    expect(t.tie.x).toBeCloseTo(0, 3); expect(t.path.length).toBe(3);
  });
});

describe("driveProfile — landing, then one constant grade", () => {
  it("road 805 → court 786 over 330 ft: a 50-ft landing at 2 %, then one constant grade; the max is not exceeded", () => {
    const p = driveProfile({ lengthFt: 330, zTie: 805, zEnd: 786 });
    expect(p.landingFt).toBe(50); expect(p.landingGrade).toBeCloseTo(-0.02, 6);
    expect(p.z(0)).toBeCloseTo(805, 6); expect(p.z(50)).toBeCloseTo(804, 6); expect(p.z(330)).toBeCloseTo(786, 6);
    expect(p.gradePct).toBeCloseTo(-(18 / 280) * 100, 4);
    expect(p.tooSteep).toBe(false);
    // one constant grade: equal rise per foot at every station past the landing
    const d1 = p.z(100) - p.z(101), d2 = p.z(250) - p.z(251);
    expect(d1).toBeCloseTo(d2, 9);
  });
  it("a gentle change (within the landing grade over the whole length) is ONE constant grade — no break invented", () => {
    const p = driveProfile({ lengthFt: 300, zTie: 805, zEnd: 802 });          // 1 %
    expect(p.landingGrade).toBeCloseTo(p.grade, 9);
    expect(p.z(150)).toBeCloseTo(803.5, 6);
  });
  it("flat ground and a court at the road's elevation: no grade at all", () => {
    const p = driveProfile({ lengthFt: 300, zTie: 805, zEnd: 805 });
    expect(p.gradePct).toBe(0); expect(p.z(0)).toBe(805); expect(p.z(300)).toBe(805); expect(p.tooSteep).toBe(false);
  });
  it("a road LOWER than the court climbs: the landing rises away from the road, then one constant climb", () => {
    const p = driveProfile({ lengthFt: 330, zTie: 780, zEnd: 799 });
    expect(p.landingGrade).toBeCloseTo(0.02, 9); expect(p.gradePct).toBeGreaterThan(0); expect(p.z(330)).toBeCloseTo(799, 9); expect(p.tooSteep).toBe(false);
  });
  it("too short for the change within the max grade: still meets both ends, and says it is too steep (it never reaches for more room)", () => {
    const p = driveProfile({ lengthFt: 120, zTie: 805, zEnd: 786 });          // ~13 %
    expect(p.tooSteep).toBe(true); expect(p.z(0)).toBe(805); expect(p.z(120)).toBeCloseTo(786, 9);
    const short = driveProfile({ lengthFt: 30, zTie: 805, zEnd: 800 });       // shorter than the landing: one grade over the whole drive
    expect(short.landingFt).toBe(30); expect(short.gradePct).toBeCloseTo((-5 / 30) * 100, 6); expect(short.tooSteep).toBe(true);
  });
  it("every number is a Standards value: the max grade, the landing length and the landing grade move the profile", () => {
    const base = driveProfile({ lengthFt: 330, zTie: 805, zEnd: 786 });
    const loose = driveProfile({ lengthFt: 330, zTie: 805, zEnd: 786, maxGradePct: 5 });
    expect(base.tooSteep).toBe(false); expect(loose.tooSteep).toBe(true);
    const long = driveProfile({ lengthFt: 330, zTie: 805, zEnd: 786, landingFt: 100, landingPct: 1 });
    expect(long.landingFt).toBe(100); expect(long.z(100)).toBeCloseTo(804, 6);
    expect(GRADING_DRIVE_DEFAULTS).toMatchObject({ driveMaxGradePct: 8, driveLandingFt: 50, driveLandingPct: 2 });
    expect(gradingCfg({ driveMaxGradePct: 6, driveLandingFt: 80, driveLandingPct: 1 })).toMatchObject({ driveMaxGradePct: 6, driveLandingFt: 80, driveLandingPct: 1 });
    expect(gradingCfg({})).toMatchObject({ driveMaxGradePct: GRADING_DEFAULTS.driveMaxGradePct });
    expect(gradingPack(gradingCfg({ driveMaxGradePct: 6 }), { parcelRings: [PARCEL], holes: [], rings: [PARCEL] }).driveMaxGradePct).toBe(6);
  });
  it("driveZAt: before the tie holds the road's elevation, past the far end the court's, a bend follows the centerline", () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const p = driveProfile({ lengthFt: 200, zTie: 10, zEnd: 0, landingFt: 0 });
    const z = driveZAt(path, p);
    expect(z({ x: -40, y: 0 })).toBeCloseTo(10, 6); expect(z({ x: 100, y: 100 })).toBeCloseTo(0, 6);
    expect(z({ x: 100, y: 50 })).toBeCloseTo(10 - 150 * 0.05, 6); expect(z({ x: 112, y: 50 })).toBeCloseTo(10 - 150 * 0.05, 6);
  });
});

describe("the engine — the drive is a plane from the road to the court", () => {
  const A = site();
  const D = A.s.planes.get("d");
  it("synthetic road-at-805 / court (786 at its dock face): the plane starts at 805 at the line, lands at 2 %, then one grade to the court's edge elevation", () => {
    expect(D).toBeTruthy(); expect(D.classId).toBe("driveRoad"); expect(D.drive.zTie).toBeCloseTo(805, 6);
    const court = A.s.planes.get("c");
    expect(court.zAt({ x: 500, y: 300 })).toBeCloseTo(786, 6);              // FFE 790 − the 4-ft dock drop, at the dock face
    expect(court.zAt({ x: 330, y: 300 })).toBeCloseTo(COURT_EDGE, 6);       // …falling 1.5 % away from the wall to the court's west edge
    expect(D.drive.zEnd).toBeCloseTo(COURT_EDGE, 6);
    expect(D.zAt({ x: 0, y: 300 })).toBeCloseTo(805, 3);                    // the tie-in IS the road's elevation
    expect(D.zAt({ x: 50, y: 300 })).toBeCloseTo(804, 3);                   // end of the 50-ft landing, 2 %
    expect(D.zAt({ x: 330, y: 300 })).toBeCloseTo(COURT_EDGE, 6);           // meets the court exactly
    expect(D.drive.landingFt).toBe(50); expect(D.drive.tooSteep).toBe(false);
    expect(Math.abs(D.drive.gradePct)).toBeLessThanOrEqual(8);
  });
  it("NO GRADING PAST THE LINE: nothing flagged outside the fence, no cell past the line, the drive's footprint stays on the site", () => {
    expect(A.s.grid.outside ? A.s.grid.outside.count : 0).toBe(0);
    expect(pastLine(A.s.grid)).toBe(0);
    const xs = A.els.find((e) => e.id === "d").ring.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(A.pack.setbackRings[0].reduce((m, p) => Math.min(m, p.x), Infinity) - 1e-6);
    for (const c of A.s.grid.cells) expect(c.x - c.wFt / 2).toBeGreaterThanOrEqual(-A.pack.limit.shoulderFt - 1e-6 - 0);   // nothing is graded west of the line
  });
  it("at the tie-in the proposed surface equals the existing ground: no cut or fill at the road", () => {
    const cells = A.s.grid.cells.filter((c) => c.dzFt != null && c.x < 25 && Math.abs(c.y - 300) < 12);
    expect(cells.length).toBeGreaterThan(0);
    expect(Math.max(...cells.map((c) => Math.abs(c.dzFt)))).toBeLessThan(1.2);   // the 2 % landing has fallen at most ~0.5 ft by here, plus half a cell
  });
  it("RED PROOF (the owner's bug): with the drive only a ring in the limit (no plane) the surface at the line is the court's, a deep cut — and the drive plane removes it", () => {
    const cfg = gradingCfg({ enabled: true });
    const setback = { parcelRings: [PARCEL], holes: [], rings: [PARCEL] };
    const pack = gradingPack(cfg, setback, { extraRings: [rect(-60, 285, 390, 30)] });
    const els = [A.els[0], A.els[1]];
    const old = buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt: () => ROAD_Z, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "old" }, grading: pack });
    const near = (g) => Math.max(...g.cells.filter((c) => c.dzFt != null && c.x < 40 && Math.abs(c.y - 300) < 12).map((c) => Math.abs(c.dzFt)));
    expect(near(old.grid)).toBeGreaterThan(8);                              // ~19 ft of cut at the line on main
    expect(near(A.s.grid)).toBeLessThan(near(old.grid) / 5);
  });
  it("earthwork, contours' surface and the spot sampler all follow the drive surface (one answer: grid.zOf)", () => {
    const owner = A.s.grid.owners.find((o) => o.el.id === "d");
    expect(owner).toBeTruthy();
    expect(A.s.grid.zOf(owner, { x: 200, y: 300 })).toBeCloseTo(D.zAt({ x: 200, y: 300 }), 6);
  });
  it("planes: the drive is exempt from seam bending (it meets the court by construction) and carries the court as its target", () => {
    expect(D.drive.targetId).toBe("c");
    expect((A.s.grid.seams || []).filter((q) => q.elId === "d" || q.nId === "d").length).toBe(0);
  });
});

describe("adjacent cases", () => {
  it("a road LOWER than the court (ground 780, court edge 783.45): the drive climbs to the court — no flag, nothing past the line", () => {
    const { s } = site({ roadZ: 780 });
    const D = s.planes.get("d");
    expect(D.drive.zTie).toBe(780); expect(D.drive.gradePct).toBeGreaterThan(0); expect(D.drive.tooSteep).toBe(false);
    expect(D.zAt({ x: 330, y: 300 })).toBeCloseTo(COURT_EDGE, 6);
    expect(pastLine(s.grid)).toBe(0);
    expect(driveFlags(s.planes)).toEqual([]);
  });
  it("a drive on FLAT ground with the court at the road's elevation (ground = the court's edge): no grade, no cut or fill on the drive", () => {
    const { s } = site({ roadZ: COURT_EDGE });
    const D = s.planes.get("d");
    expect(Math.abs(D.drive.gradePct)).toBeLessThan(0.05);
    const onDrive = s.grid.cells.filter((c) => c.elId === "d" && c.dzFt != null);
    expect(onDrive.length).toBeGreaterThan(0);
    expect(Math.max(...onDrive.map((c) => Math.abs(c.dzFt)))).toBeLessThan(0.25);
  });
  it("a drive TOO SHORT for the climb fires ONE plain flag (and one violation) and still grades nothing past the line", () => {
    // (a drive ending far from any court is NOT too steep for that — it runs to the ground, see "ROUND 3" below; here the court edge is moved in so the climb cannot fit)
    const short = (() => {
      const cfg = gradingCfg({ enabled: true });
      const setback = { parcelRings: [PARCEL], holes: [], rings: [PARCEL] };
      const pack = gradingPack(cfg, setback);
      const building = { id: "b", type: "building", ring: rect(200, 150, 400, 300), padElevFt: 790, dockStack: null, accessible: false, slopeOverridePct: null };
      const court = { id: "c", type: "paving", ring: rect(60, 150, 140, 300), dockStack: { x: 400, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", truckCourt: true };
      const centre = [{ x: -60, y: 300 }, { x: 60, y: 300 }];
      const t = driveTieOf(centre, [PARCEL]);
      const drv = { id: "d", type: "drive", ring: driveRingOnSite(rect(-60, 285, 120, 30), pack.setbackRings, centre[1]), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, drive: { tie: t.tie, path: t.path } };
      return buildProposedSurface({ els: [building, court, drv], ffeFt: null, dockDropFt: 4, existAt: () => ROAD_Z, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "short" }, grading: pack });
    })();
    const D = short.planes.get("d");
    expect(D.drive.tooSteep).toBe(true);
    expect(D.drive.lengthFt).toBeLessThan(80);
    const flags = driveFlags(short.planes);
    expect(flags.length).toBe(1);
    expect(flags[0].text.startsWith("Drive too steep to reach the road")).toBe(true);
    expect(short.violations.some((v) => v.kind === "drive-steep")).toBe(true);
    expect(short.grid.outside ? short.grid.outside.count : 0).toBe(0);       // …and it did NOT cut past the line to hide it
    expect(pastLine(short.grid)).toBe(0);
  });
  it("without a ground sampler the drive is simply not a plane (the old behaviour) — never a guess", () => {
    const { planes, skipped } = buildPlanes({ els: site().els, ffeFt: null, dockDropFt: 4, grading: gradingPack(gradingCfg({ enabled: true }), { parcelRings: [PARCEL], holes: [], rings: [PARCEL] }) });
    expect(planes.has("d")).toBe(false); expect(skipped).toContain("d");
  });
  it("the surface identity changes when a Standards value does (no stale memo)", () => {
    const a = site().s.surfaceKey, b = site({ grading: { driveMaxGradePct: 5 } }).s.surfaceKey, c = site({ grading: { driveLandingFt: 80 } }).s.surfaceKey;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("labels — the tie-in spot and the fall tag", () => {
  it("layoutLabelSet places 'road 805.2' at the tie and the grade tag beside the arrow, both on the map", () => {
    const f2p = (p) => ({ x: 400 + p.x, y: 300 + p.y });
    const L = {
      id: "b", centre: { x: 700, y: 300 }, minSideFt: 300, spots: [], corners: [], quad: null, ctrl: null,
      drives: [{ id: "d", tooSteep: false, tie: { pt: { x: 0, y: 300 }, inward: { x: 330, y: 300 }, text: "road 805.2" }, tag: { pt: { x: 190, y: 300 }, text: "6.4% fall" }, arrow: { from: { x: 120, y: 300 }, to: { x: 260, y: 300 } } }],
    };
    const lay = layoutLabelSet(L, f2p, 1, { w: 1400, h: 900 });
    const tie = lay.spots.get("d:tie"), tag = lay.spots.get("d:fall");
    expect(tie && !tie.hidden).toBe(true); expect(tag && !tag.hidden).toBe(true);
    expect(Math.abs(tie.x - 400)).toBeLessThan(120);
  });
  it("wiring: the planner builds drive elements only while grading is on; the controller labels and flags them; the gear edits the three values", () => {
    const sp = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(sp).toMatch(/if \(grOn && grDriveTies\.size\)/);
    expect(sp).toMatch(/type: "drive", ring, dockStack: null/);
    const gc = readFileSync("src/workspaces/site-planner/components/GradingController.jsx", "utf8");
    expect(gc).toMatch(/driveLabelPoints/); expect(gc).toMatch(/driveFlags\(/);
    const gp = readFileSync("src/workspaces/site-planner/components/GradingPanels.jsx", "utf8");
    for (const k of ["driveMaxGradePct", "driveLandingFt", "driveLandingPct"]) expect(gp).toContain(k);
  });
});

describe("the owner's ground — Chehaw Concept A with an entrance drive off the west line (the real DEM)", () => {
  const C = chehawInputs({ owner: 2 });
  const ringLib = (b, target) => b.els.find((e) => e.id === target).ring;
  function run(mode) {
    const b = C.inputs(793, "layout", `dg${mode}`);
    const tr = ringLib(b, "e340olvzwe");
    // a straight 30-ft drive from well outside the west line to the trailer row's nearest edge point
    const probe = { x: -700, y: -1000 };
    let best = null, bd = Infinity;
    for (let i = 0; i < tr.length; i++) { const a = tr[i], c = tr[(i + 1) % tr.length]; for (let t = 0; t <= 1; t += 0.01) { const q = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }; const d = Math.hypot(q.x - probe.x, q.y - probe.y); if (d < bd) { bd = d; best = q; } } }
    const dx = best.x - probe.x, dy = best.y - probe.y, L = Math.hypot(dx, dy), start = { x: best.x - (dx / L) * (L + 150), y: best.y - (dy / L) * (L + 150) };
    const nx = -(dy / L) * 15, ny = (dx / L) * 15;
    const full = [{ x: start.x + nx, y: start.y + ny }, { x: best.x + nx, y: best.y + ny }, { x: best.x - nx, y: best.y - ny }, { x: start.x - nx, y: start.y - ny }];
    const t = driveTieOf([start, best], b.parcelRings);
    if (mode === "ring-only") b.grading = { ...b.grading, limit: { ...b.grading.limit, extraRings: [full] } };
    else b.els = [...b.els, { id: "drv", type: "drive", ring: driveRingOnSite(full, b.grading.setbackRings, best), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, drive: { tie: t.tie, path: t.path } }];
    const s = buildProposedSurface(b);
    let atLine = 0;
    for (const c of s.grid.cells) if (c.dzFt != null && Math.hypot(c.x - t.tie.x, c.y - t.tie.y) < 40) atLine = Math.max(atLine, Math.abs(c.dzFt));
    return { s, atLine, past: pastLine(s.grid), tie: t.tie, zTie: C.existAt(t.tie) };
  }
  const before = run("ring-only"), after = run("drive");
  it("BEFORE: the drive is only a ring — a deep channel at the line and grading past it (the owner's screenshot, reproduced on the real ground)", () => {
    expect(before.atLine).toBeGreaterThan(10);
    expect(before.past).toBeGreaterThan(10);
  });
  it("AFTER: the drive starts at the existing ground at the line, cuts at most a couple of feet near it and grades nothing past the line", () => {
    const D = after.s.planes.get("drv");
    expect(D).toBeTruthy();
    expect(D.drive.zTie).toBeCloseTo(after.zTie, 6);
    expect(after.atLine).toBeLessThan(3);
    expect(after.past).toBe(0);
    expect(after.s.grid.outside ? after.s.grid.outside.count : 0).toBe(0);
    expect(D.drive.tooSteep).toBe(false);
  });
});

describe("the FFE search rebuilds the surface many times — a drive's profile follows the floor and the drain-geometry cache changes no number", () => {
  it("the same drive at two floors: the tie stays the road's elevation, the court end moves with the floor, and cache on == cache off cell for cell", () => {
    const build = (ffe) => {
      const cfg = gradingCfg({ enabled: true });
      const setback = { parcelRings: [PARCEL], holes: [], rings: [PARCEL] };
      const pack = gradingPack(cfg, setback);
      const centre = [{ x: -60, y: 300 }, { x: 330, y: 300 }];
      const t = driveTieOf(centre, [PARCEL]);
      const els = [
        { id: "b", type: "building", ring: rect(500, 150, 400, 300), padElevFt: ffe, dockStack: null, accessible: false, slopeOverridePct: null },
        { id: "c", type: "paving", ring: rect(330, 150, 170, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b" },
        { id: "d", type: "drive", ring: driveRingOnSite(rect(-60, 285, 390, 30), pack.setbackRings, centre[1]), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, drive: { tie: t.tie, path: t.path } },
      ];
      return buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt: () => ROAD_Z, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "ffe" }, grading: pack });
    };
    __clearDrainGeometry(); __setDrainGeometryCache(true);
    const on790 = build(790), on796 = build(796);
    __setDrainGeometryCache(false);
    const off796 = build(796);
    __setDrainGeometryCache(true);
    expect(on790.planes.get("d").drive.zTie).toBe(805); expect(on796.planes.get("d").drive.zTie).toBe(805);
    expect(on796.planes.get("d").drive.zEnd - on790.planes.get("d").drive.zEnd).toBeCloseTo(6, 6);
    expect(on796.grid.cells.length).toBe(off796.grid.cells.length);
    for (let i = 0; i < on796.grid.cells.length; i++) expect(on796.grid.cells[i].dzFt).toBe(off796.grid.cells[i].dzFt);
    expect(on796.surfaceKey).not.toBe(on790.surfaceKey);
  });
});

/* ---- V2115881 re-opened (2026-11-12): the owner's live check on a plain Road drawn from just outside the west line to a trailer row ---- */
describe("the property line is the OUTER edge of the whole site, not a lot line inside it", () => {
  const WEST = rect(-400, 0, 400, 600), EAST = rect(0, 0, 1000, 600);          // two active lots sharing the line x = 0; the road starts in the WEST lot
  it("propertyLineRings dissolves adjoining lots into one outline", () => {
    const u = propertyLineRings([WEST, EAST]);
    expect(u.length).toBe(1);
    const xs = u[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-400, 6); expect(Math.max(...xs)).toBeCloseTo(1000, 6);
    expect(propertyLineRings([EAST]).length).toBe(1);
  });
  it("a road that starts OUTSIDE the west lot ties at the site's real edge; judged against the raw lots (the shared line) it would not", () => {
    const pts = [{ x: -460, y: 300 }, { x: 330, y: 300 }];
    const t = driveTieOf(pts, propertyLineRings([WEST, EAST]));
    expect(t.tie.x).toBeCloseTo(-400, 3);
  });
  it("a road that starts INSIDE the neighbouring lot, 3 ft off the shared line, is NOT a drive (that line is not the property line)", () => {
    expect(driveTieOf([{ x: -3, y: 300 }, { x: 330, y: 300 }], propertyLineRings([WEST, EAST]))).toBeNull();
  });
});

describe("driveDiagnose — says WHY a centerline is or is not a drive (the live diagnostic prints it)", () => {
  it("a tied road: drive, with the tie and the end that is out on the road side", () => {
    const d = driveDiagnose([{ x: -60, y: 300 }, { x: 330, y: 300 }], [PARCEL]);
    expect(d.drive).toBe(true); expect(d.tie.x).toBeCloseTo(0, 1); expect(d.tieEnd).toBe(0);
  });
  it("names each way it can fail", () => {
    expect(driveDiagnose([{ x: 100, y: 300 }, { x: 330, y: 300 }], [PARCEL]).reason).toMatch(/both ends are inside/);
    expect(driveDiagnose([{ x: -200, y: 300 }, { x: -50, y: 300 }], [PARCEL]).reason).toMatch(/neither end is on the property/);
    expect(driveDiagnose([{ x: 100, y: 300 }, { x: 330, y: 300 }], []).reason).toMatch(/no active parcel/);
  });
});

describe("the drive finds the court it serves, and says why it could not", () => {
  const cfg = () => gradingCfg({ enabled: true });
  const pack = () => gradingPack(cfg(), { parcelRings: [PARCEL], holes: [], rings: [PARCEL] });
  const els0 = () => ([
    { id: "b", type: "building", ring: rect(500, 150, 400, 300), padElevFt: 790, dockStack: null, accessible: false, slopeOverridePct: null },
    { id: "c", type: "paving", ring: rect(330, 150, 170, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", truckCourt: true },
  ]);
  const drive = (toX, width = 30) => {
    const centre = [{ x: -60, y: 300 }, { x: toX, y: 300 }], t = driveTieOf(centre, [PARCEL]);
    return { id: "d", type: "drive", ring: driveRingOnSite(rect(-60, 300 - width / 2, toX + 60, width), pack().setbackRings, centre[1]), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, drive: { tie: t.tie, path: t.path } };
  };
  it("a drive that ends 10 ft short of the court still meets it (within the reach)", () => {
    const { planes } = buildPlanes({ els: [...els0(), drive(320)], ffeFt: null, dockDropFt: 4, existAt: () => 805, grading: pack() });
    expect(planes.get("d").drive.targetId).toBe("c");
  });
  it("a drive whose END is short but whose own footprint runs over the court's edge meets it too", () => {
    const d = drive(322, 30);                                                   // the strip is clipped at the fence but its far end overlaps nothing: widen it over the edge
    d.ring = driveRingOnSite(rect(-60, 285, 410, 30), pack().setbackRings, { x: 322, y: 300 });
    const { planes } = buildPlanes({ els: [...els0(), d], ffeFt: null, dockDropFt: 4, existAt: () => 805, grading: pack() });
    expect(planes.has("d")).toBe(true);
  });
  it("ROUND 3: a drive that ends in open ground, far from any court, is STILL a plane — it ties in at the line and runs to the existing ground, nothing past the line", () => {
    const s = buildProposedSurface({ els: [...els0(), drive(150)], ffeFt: null, dockDropFt: 4, existAt: () => 805, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "why" }, grading: pack() });
    const D = s.planes.get("d");
    expect(D).toBeTruthy();
    expect(D.drive.servedBy).toBe("ground"); expect(D.drive.targetId).toBe(null);
    expect(D.drive.zTie).toBe(805); expect(D.drive.zEnd).toBe(805); expect(D.drive.tooSteep).toBe(false);
    expect(s.driveWhy.has("d")).toBe(false);
    expect(pastLine(s.grid)).toBe(0);
  });
  it("ROUND 3 (the owner's measured case): a drive whose far end is ~41 ft from the nearest graded trailer row is served by THAT row's edge elevation", () => {
    // trailer row on the court's west side at x 250…330 (a dock-stack member, one plane with the court); the drive stops 41 ft short of it
    const trailer = { id: "t", type: "trailer", ring: rect(250, 150, 80, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", forCourt: true };
    const s = buildProposedSurface({ els: [...els0(), trailer, drive(209)], ffeFt: null, dockDropFt: 4, existAt: () => 805, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "t41" }, grading: pack() });
    const D = s.planes.get("d");
    expect(D).toBeTruthy();
    expect(D.drive.servedBy).toBe("element"); expect(D.drive.targetId).toBe("t");
    expect(D.drive.nearestFt).toBeGreaterThan(35); expect(D.drive.nearestFt).toBeLessThan(DRIVE_SERVE_REACH_FT);
    expect(D.drive.zEnd).toBeCloseTo(s.planes.get("t").zAt({ x: 250, y: 300 }), 3);   // the row's own edge elevation, not the ground
    expect(pastLine(s.grid)).toBe(0);
  });
  it("ROUND 3: a drive ENDING ON a trailer row (inside it) counts that row as the thing it serves", () => {
    const trailer = { id: "t", type: "trailer", ring: rect(250, 150, 80, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", forCourt: true };
    const s = buildProposedSurface({ els: [...els0(), trailer, drive(290)], ffeFt: null, dockDropFt: 4, existAt: () => 805, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "ton" }, grading: pack() });
    const D = s.planes.get("d");
    expect(D.drive.targetId).toBe("t"); expect(D.drive.nearestFt).toBe(0);
    expect(pastLine(s.grid)).toBe(0);
  });
  it("ROUND 3: a car lot counts too (any paved graded element is a target)", () => {
    const lot = { id: "p", type: "parking", ring: rect(200, 250, 120, 100), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b" };
    const s = buildProposedSurface({ els: [...els0(), lot, drive(190)], ffeFt: null, dockDropFt: 4, existAt: () => 805, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "lot" }, grading: pack() });
    const D = s.planes.get("d");
    expect(D).toBeTruthy(); expect(D.drive.nearestFt).toBeLessThan(DRIVE_SERVE_REACH_FT);
    expect(pastLine(s.grid)).toBe(0);
  });
  it("ROUND 3: with nothing at all to serve and NO GROUND at the far end the drive is not a plane — it says so, and (it is not an element of the limit) nothing is graded past the line", () => {
    const tie = driveTieOf([{ x: -60, y: 300 }, { x: 150, y: 300 }], [PARCEL]).tie;
    const groundOnlyAtLine = (pt) => (Math.hypot(pt.x - tie.x, pt.y - tie.y) < 40 ? 805 : null);
    const s = buildProposedSurface({ els: [...els0(), drive(150)], ffeFt: null, dockDropFt: 4, existAt: groundOnlyAtLine, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "noend" }, grading: pack() });
    expect(s.planes.has("d")).toBe(false);
    expect(s.driveWhy.get("d")).toMatch(/no ground elevation at its far end/);
    expect(pastLine(s.grid)).toBe(0);
  });
  it("a hole in the ground data exactly at the line: the first value a few feet along the drive stands in; no ground at all → not a plane, said so", () => {
    const tie = driveTieOf([{ x: -60, y: 300 }, { x: 330, y: 300 }], [PARCEL]).tie;
    const hole = (pt) => (Math.hypot(pt.x - tie.x, pt.y - tie.y) < 1 ? null : 805);
    const a = buildPlanes({ els: [...els0(), drive(330)], ffeFt: null, dockDropFt: 4, existAt: hole, grading: pack() });
    expect(a.planes.get("d").drive.zTie).toBe(805);
    const b = buildPlanes({ els: [...els0(), drive(330)], ffeFt: null, dockDropFt: 4, existAt: () => null, grading: pack() });
    expect(b.planes.has("d")).toBe(false); expect(b.driveWhy.get("d")).toMatch(/no ground elevation/);
    expect(driveZNear([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4)).toEqual({ x: 4, y: 0 });
  });
});

describe("ROUND 3 — a road never carries the grading limit past the property line, drive or not", () => {
  const pack0 = () => gradingPack(gradingCfg({ enabled: true }), { parcelRings: [PARCEL], holes: [], rings: [PARCEL] });
  it("roadLimitRings keeps only the pieces inside the fence (and the ring as given with no fence known)", () => {
    const fence = driveFenceFor([PARCEL], 10, 0);
    const road = rect(-60, 285, 400, 30);                                          // crosses the west line
    const pieces = roadLimitRings(road, fence);
    expect(pieces.length).toBe(1);
    expect(Math.min(...pieces[0].map((p) => p.x))).toBeGreaterThanOrEqual(9.9);    // nothing past the fence (10 ft inside the line)
    expect(roadLimitRings(road, [])).toEqual([road]);
    expect(roadLimitRings(rect(-300, 285, 100, 30), fence)).toEqual([]);          // wholly outside: contributes nothing
  });
  it("the fence helper is exactly the ring gradingPack hands the engine", () => {
    const f = driveFenceFor([PARCEL], 10, 0), pk = pack0().setbackRings;
    const bb = (rs) => rs.flat().reduce((a, p) => ({ x0: Math.min(a.x0, p.x), x1: Math.max(a.x1, p.x), y0: Math.min(a.y0, p.y), y1: Math.max(a.y1, p.y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
    expect(bb(f)).toEqual(bb(pk));
  });
  it("RED PROOF (the owner's 28 ft): a road ring that crosses the line, joined to the limit unclipped, throws its slope past the line; clipped to the fence it does not", () => {
    // a long road stub across the west line with NO plane (no drive) and a higher ground west of the line than inside: the old extra ring reached the fence edge
    const ground = (pt) => (pt.x < 0 ? 830 : 805);
    const mk = (extra) => {
      const cfg = gradingCfg({ enabled: true });
      const pk = gradingPack(cfg, { parcelRings: [PARCEL], holes: [], rings: [PARCEL] }, { extraRings: extra });
      const building = { id: "b", type: "building", ring: rect(500, 150, 400, 300), padElevFt: 790, dockStack: null, accessible: false, slopeOverridePct: null };
      const court = { id: "c", type: "paving", ring: rect(330, 150, 170, 300), dockStack: { x: 700, y: 300 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b", truckCourt: true };
      return buildProposedSurface({ els: [building, court], ffeFt: null, dockDropFt: 4, existAt: ground, parcelRings: [PARCEL], pondRings: [], easementRings: [], opts: { existKey: "r3-" + extra.length + (extra[0] ? extra[0].length : "") }, grading: pk });
    };
    const road = rect(-200, 285, 560, 30);
    const raw = mk([road]);
    const clipped = mk(roadLimitRings(road, driveFenceFor([PARCEL], GRADING_DEFAULTS.gradingMarginFt, 0)));
    const pastRaw = pastLine(raw.grid), pastClip = pastLine(clipped.grid);
    expect(pastRaw).toBeGreaterThan(0);                                            // the owner's symptom, reproduced on the unclipped ring
    expect(pastClip).toBeLessThanOrEqual(pastRaw);
  });
  it("source scan — the planner drops a tie road from the extra rings, clips every other road to the fence, and labels ground-served drives", () => {
    const sp = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(sp).toMatch(/if \(grDriveTies\.has\(e\.id\)\) return \[\];/);
    expect(sp).toMatch(/roadLimitRings\(r, grFence\)/);
    expect(sp.indexOf("const grDriveTies = useMemo")).toBeLessThan(sp.indexOf("const grLimitExtraRings"));
    const gc = readFileSync("src/workspaces/site-planner/components/GradingController.jsx", "utf8");
    expect(gc).toMatch(/targetId != null \? F\.aIds\.has\(D\.targetId\) : id === labelIds\[0\]/);
  });
});
