/* Drive-in ramps on dock walls (NEW-1…NEW-3, 2026-10-30). Pure rules in lib/driveInRamp.js; this file also drives the REAL renderer (ElNode) into the REAL
 * editable-PDF walker, the REAL grading plane builder, and the REAL model read path, so a ramp that "works in the lib" but not on the page cannot pass. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RAMP_DEFAULTS, RAMP_FLAG, newRampRecord, rampLengthFt, rampRiseFt, rampSpan, rampBox, rampRing, rampParts, rampLabel, moduleStops, snapToModule, displacedDoors,
  doorsAfterRamps, rampFlags, refitRamps, rampGeometry, rampPlane, rampZAt, fitAlongTheWall, dockHeightInOf, wallFrame, rampBeltSpans,
} from "../src/workspaces/site-planner/lib/driveInRamp.js";
import { ElNode, dockDoorRun, rampSpansOnSide, resolveElNeighbors } from "../src/workspaces/site-planner/components/elementRender.jsx";
import { dockSidesFor } from "../src/workspaces/site-planner/lib/dockZones.js";
import { resolveGridSettings, computeBuildingGrid } from "../src/workspaces/site-planner/lib/buildingGrid.js";
import { footprintDepth, footprintLength } from "../src/workspaces/site-planner/lib/dockZones.js";
import { buildPlanes, classifyGradeElement } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { hostBuildingIdOf, assemblyIds, isDriveInRamp } from "../src/workspaces/site-planner/lib/gradingMembership.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { extractMarkupAnnotations, elementSubject } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { elHidden } from "../src/workspaces/site-planner/lib/contentVisibility.js";
import { TYPE } from "../src/workspaces/site-planner/lib/planStyle.js";
import { svgToFake } from "./fixtures/svgToFake.js";
import { M0, frame } from "./fixtures/pdfAnnotationsFixture.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// a 500 × 250 dock-high building at the origin, docks on both long sides (top = north wall, bottom = south wall)
const HOST = { id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 250, rot: 0, dock: "cross" };
const DOCK_IN = 48;
// distance of a world point from the host wall (positive = outward) and its position along the wall from the wall's start, for a rot-0 host
const outward = (host, side, p) => ({ top: -(p.y - host.cy) - host.h / 2, bottom: (p.y - host.cy) - host.h / 2, left: -(p.x - host.cx) - host.w / 2, right: (p.x - host.cx) - host.w / 2 }[side]);
const along = (host, side, p) => (side === "top" || side === "bottom" ? p.x - host.cx + host.w / 2 : p.y - host.cy + host.h / 2);

describe("length math", () => {
  it("a 4 ft rise at 8 % is 50 ft; 6 % is 66.7 ft; 10 % is 40 ft", () => {
    expect(rampLengthFt({ gradePct: 8 }, DOCK_IN)).toBe(50);
    expect(rampLengthFt({ gradePct: 6 }, DOCK_IN)).toBeCloseTo(66.67, 2);
    expect(rampLengthFt({ gradePct: 10 }, DOCK_IN)).toBe(40);
  });
  it("rise = the ramp's own override, else the plan's dock height, else 48 in", () => {
    expect(rampRiseFt({}, 52)).toBeCloseTo(52 / 12, 9);
    expect(rampRiseFt({ riseIn: 44 }, 52)).toBeCloseTo(44 / 12, 9);
    expect(rampRiseFt({}, undefined)).toBe(4);
    expect(rampLengthFt({ gradePct: 8, riseIn: 44 }, 52)).toBeCloseTo((44 / 12) / 0.08, 2);
  });
  it("the plan's dock height is the dock drop (ft) × 12, 48 in when unset", () => {
    expect(dockHeightInOf({ floodMitigation: { dockDropFt: 4.5 } })).toBe(54);
    expect(dockHeightInOf({})).toBe(48);
    expect(dockHeightInOf(null)).toBe(48);
  });
  it("a runaway grade is clamped, never infinite", () => {
    expect(Number.isFinite(rampLengthFt({ gradePct: 0.01 }, DOCK_IN))).toBe(true);
    expect(rampLengthFt({ gradePct: -5 }, DOCK_IN)).toBe(50); // a bad value falls back to the default 8 %
  });
  it("defaults: 16 ft wide, 8 %, straight-in, 12×14 door, wing walls and bollards on", () => {
    const r = newRampRecord("bottom", 120);
    expect(r).toMatchObject({ side: "bottom", at: 120, width: 16, gradePct: 8, layout: "straight", door: "12x14", wings: true, bollards: true });
    expect(r.riseIn).toBeUndefined(); // absent = follow the plan's dock height
    expect(RAMP_DEFAULTS.widthFt).toBe(16);
  });
});

describe("geometry — straight-in", () => {
  for (const side of ["top", "bottom", "left", "right"]) {
    it(`${side} wall: 16 ft wide × 50 ft long, starting at the wall face, centred on the door`, () => {
      const rec = newRampRecord(side, 200);
      const ring = rampRing(HOST, rec, { dockHeightIn: DOCK_IN });
      const v = ring.map((p) => outward(HOST, side, p)), u = ring.map((p) => along(HOST, side, p));
      expect(Math.min(...v)).toBeCloseTo(0, 6);
      expect(Math.max(...v)).toBeCloseTo(50, 6);
      expect(Math.min(...u)).toBeCloseTo(192, 6);
      expect(Math.max(...u)).toBeCloseTo(208, 6);
      const box = rampBox(HOST, rec, { dockHeightIn: DOCK_IN });
      const horiz = side === "top" || side === "bottom";
      expect(near(box.w, horiz ? 16 : 50) && near(box.h, horiz ? 50 : 16)).toBe(true);
    });
  }
  it("a rotated host carries the ramp with it: the ring is the same shape rotated about the host centre", () => {
    const host = { ...HOST, cx: 1000, cy: -400, rot: 30 };
    const ring = rampRing(host, newRampRecord("bottom", 200), { dockHeightIn: DOCK_IN });
    const base = rampRing(HOST, newRampRecord("bottom", 200), { dockHeightIn: DOCK_IN });
    const c = Math.cos((30 * Math.PI) / 180), s = Math.sin((30 * Math.PI) / 180);
    ring.forEach((p, i) => {
      expect(p.x).toBeCloseTo(host.cx + base[i].x * c - base[i].y * s, 6);
      expect(p.y).toBeCloseTo(host.cy + base[i].x * s + base[i].y * c, 6);
    });
    expect(rampBox(host, newRampRecord("bottom", 200), { dockHeightIn: DOCK_IN }).rot).toBe(30);
  });
  it("the door is a DOUBLED line on the wall, bollards two dots, wing walls two heavy lines on the long sides, the arrow points toward the door", () => {
    const rec = newRampRecord("bottom", 200), parts = rampParts(HOST, rec, { dockHeightIn: DOCK_IN });
    expect(parts.door).toHaveLength(2);
    parts.door.forEach(([a, b]) => { expect(Math.abs(b.x - a.x)).toBeCloseTo(12, 6); });
    expect(parts.bollards).toHaveLength(2);
    expect(parts.wings).toHaveLength(2);
    parts.wings.forEach(([a, b]) => { expect(Math.abs(along(HOST, "bottom", a) - along(HOST, "bottom", b))).toBeLessThan(1e-6); expect(Math.abs(outward(HOST, "bottom", a) - outward(HOST, "bottom", b))).toBeCloseTo(50, 6); });
    expect(outward(HOST, "bottom", parts.arrow.to)).toBeLessThan(outward(HOST, "bottom", parts.arrow.from)); // toward the wall = UP the ramp
    const off = rampParts(HOST, { ...rec, wings: false, bollards: false }, { dockHeightIn: DOCK_IN });
    expect(off.wings).toHaveLength(0);
    expect(off.bollards).toHaveLength(0);
    expect(off.door).toHaveLength(2); // the door is not optional
  });
});

describe("geometry — along the wall", () => {
  it("hugs the face: 50 ft along × 16 ft out, with the door at the HIGH end (dir +1 runs toward the wall's end)", () => {
    const rec = newRampRecord("bottom", 100, { layout: "along", dir: 1 });
    const ring = rampRing(HOST, rec, { dockHeightIn: DOCK_IN });
    const v = ring.map((p) => outward(HOST, "bottom", p)), u = ring.map((p) => along(HOST, "bottom", p));
    expect(Math.min(...v)).toBeCloseTo(0, 6); expect(Math.max(...v)).toBeCloseTo(16, 6);
    expect(Math.min(...u)).toBeCloseTo(92, 6); expect(Math.max(...u)).toBeCloseTo(142, 6);
    const g = rampGeometry(HOST, rec, { dockHeightIn: DOCK_IN });
    expect(along(HOST, "bottom", g.highPt)).toBeCloseTo(92, 6);   // the door end
    expect(along(HOST, "bottom", g.lowPt)).toBeCloseTo(142, 6);   // the apron end
    expect(g.axis.x).toBeCloseTo(-1, 6);                          // up the ramp = toward the door = toward the wall's start
  });
  it("dir -1 mirrors it: the ramp runs toward the wall's start and the door end is its u1 edge", () => {
    const rec = newRampRecord("bottom", 300, { layout: "along", dir: -1 });
    const u = rampRing(HOST, rec, { dockHeightIn: DOCK_IN }).map((p) => along(HOST, "bottom", p));
    expect(Math.min(...u)).toBeCloseTo(258, 6); expect(Math.max(...u)).toBeCloseTo(308, 6);
    expect(rampGeometry(HOST, rec, { dockHeightIn: DOCK_IN }).axis.x).toBeCloseTo(1, 6);
  });
  it("wing walls are the two long sides (the outer edge and the wall line)", () => {
    const parts = rampParts(HOST, newRampRecord("bottom", 100, { layout: "along" }), { dockHeightIn: DOCK_IN });
    expect(parts.wings).toHaveLength(2);
    const vs = parts.wings.map(([a]) => Math.round(outward(HOST, "bottom", a) * 1000) / 1000).sort((a, b) => a - b);
    expect(vs).toEqual([0, 16]);
  });
});

describe("turning a ramp along the wall keeps it ON the wall", () => {
  const stops = moduleStops([10, 22, 34, 46, 58, 70, 82, 94]);
  const within = (rec) => { const sp = rampSpan(rec, { dockHeightIn: DOCK_IN }); return sp.u0 >= -1e-6 && sp.u1 <= 500 + 1e-6; };
  it("a door near the start corner runs toward that (nearer) corner, with the door slid in so the whole ramp fits", () => {
    const rec = newRampRecord("bottom", 11, { layout: "along", dir: -1 });
    expect(within(rec)).toBe(false);                                      // as placed by the corner "+" and then pointed at that corner: it would overrun the wall
    const fit = fitAlongTheWall(rec, { L: 500, stops, dockHeightIn: DOCK_IN, keepDir: -1 });
    expect(fit.dir).toBe(-1);
    expect(fitAlongTheWall(newRampRecord("bottom", 11, { layout: "along" }), { L: 500, stops, dockHeightIn: DOCK_IN }).dir).toBe(-1); // no direction named: toward the nearer end
    expect(fit.at).toBeGreaterThanOrEqual(42);                            // len − W/2 = 50 − 8
    expect(within({ ...rec, ...fit })).toBe(true);
    expect(stops.some((v) => Math.abs(v - fit.at) < 1e-6)).toBe(true);    // snapped to a door module
  });
  it("mirrors at the far end, honours a named direction, and only clamps when the wall is too short", () => {
    const rec = newRampRecord("bottom", 489, { layout: "along" });
    const fit = fitAlongTheWall(rec, { L: 500, stops: moduleStops([490, 478, 466]), dockHeightIn: DOCK_IN });
    expect(fit.dir).toBe(1);
    expect(within({ ...rec, ...fit })).toBe(true);
    const keep = fitAlongTheWall(newRampRecord("bottom", 11, { layout: "along" }), { L: 500, stops, dockHeightIn: DOCK_IN, keepDir: 1 });
    expect(keep.dir).toBe(1); expect(within({ ...newRampRecord("bottom", 11, { layout: "along" }), ...keep })).toBe(true);
    const tiny = fitAlongTheWall(newRampRecord("bottom", 5, { layout: "along" }), { L: 30, stops: [], dockHeightIn: DOCK_IN });
    expect(Number.isFinite(tiny.at)).toBe(true);
  });
});

describe("a non-dock wall is a door marker only", () => {
  it("rampBox is the short stub, no wings/bollards/arrow, the label says door, and the flag says why", () => {
    const rec = newRampRecord("left", 100);
    const parts = rampParts(HOST, rec, { marker: true });
    expect(parts.wings).toHaveLength(0); expect(parts.bollards).toHaveLength(0); expect(parts.arrow).toBeNull();
    expect(rampLabel(rec, { marker: true })).toBe("DRIVE-IN DOOR");
    const b = rampBox(HOST, rec, { marker: true });
    expect(b.w).toBeLessThan(3);
    const flags = rampFlags(HOST, rec, { dockSides: ["top", "bottom"] });
    expect(flags.map((f) => f.code)).toEqual([RAMP_FLAG.NON_DOCK]);
    expect(rampPlane(HOST, rec, { ffeFt: 100, dockHeightIn: DOCK_IN, marker: true })).toBeNull();
  });
});

describe("labels", () => {
  it("long and short forms", () => {
    expect(rampLabel(newRampRecord("top", 0))).toBe("DRIVE-IN RAMP · 8% · 16' W");
    expect(rampLabel(newRampRecord("top", 0), { short: true })).toBe("RAMP 8%");
    expect(rampLabel(newRampRecord("top", 0, { gradePct: 7.5, width: 18 }))).toBe("DRIVE-IN RAMP · 7.5% · 18' W");
  });
});

describe("door modules and dock-door displacement", () => {
  const doors = [10, 22, 34, 46, 58, 70]; // 12 ft o.c., 9 ft leaves
  it("snaps to a door centre or the midpoint between two", () => {
    expect(moduleStops(doors).slice(0, 4)).toEqual([10, 16, 22, 28]);
    expect(snapToModule(doors, 23)).toBe(22);
    expect(snapToModule(doors, 26)).toBe(28);
    expect(snapToModule([], 33)).toBe(33);
  });
  it("a 16 ft ramp centred on a door takes that door; centred between two it takes TWO (the jamb touch of 0.5 ft is not a conflict)", () => {
    expect(displacedDoors(doors, 9, { u0: 22 - 8, u1: 22 + 8 })).toEqual([22]);
    expect(displacedDoors(doors, 9, { u0: 28 - 8, u1: 28 + 8 })).toEqual([22, 34]);
  });
  it("a 20 ft ramp centred on a door takes three; a 14 ft one takes one", () => {
    expect(displacedDoors(doors, 9, { u0: 34 - 10, u1: 34 + 10 })).toEqual([22, 34, 46]);
    expect(displacedDoors(doors, 9, { u0: 34 - 7, u1: 34 + 7 })).toEqual([34]);
  });
  it("doorsAfterRamps is identity-stable when no ramp touches the wall", () => {
    expect(doorsAfterRamps(doors, 9, null)).toBe(doors);
    expect(doorsAfterRamps(doors, 9, [])).toBe(doors);
    expect(doorsAfterRamps(doors, 9, [{ u0: 200, u1: 220 }])).toBe(doors);
    expect(doorsAfterRamps(doors, 9, [{ u0: 20, u1: 36 }])).toEqual([10, 46, 58, 70]);
  });
  it("only a ramp on a DOCK wall takes doors (a marker has no belt)", () => {
    const ramps = [{ ramp: newRampRecord("top", 100) }, { ramp: newRampRecord("left", 50) }];
    const by = rampBeltSpans(ramps, ["top", "bottom"], DOCK_IN);
    expect(Object.keys(by)).toEqual(["top"]);
  });
  it("the real dockDoorRun drops exactly the doors under the ramp, on the canvas AND in the count", () => {
    const g = resolveGridSettings(HOST, {});
    const gg = computeBuildingGrid({ length: footprintLength(HOST), depth: footprintDepth(HOST), dock: "cross", grid: g });
    const lens = gg.lengthLines.map((l) => l.at);
    const free = dockDoorRun(HOST, "bottom", [], lens, g);
    expect(free.displaced).toBe(0);
    const centre = free.doors[Math.floor(free.doors.length / 2)]; // a ramp centred ON a door takes that door only
    const ramps = [{ type: "driveInRamp", attachedTo: "b1", ramp: newRampRecord("bottom", centre) }];
    const spans = rampSpansOnSide(ramps, "bottom", ["top", "bottom"], {});
    const taken = dockDoorRun(HOST, "bottom", [], lens, g, spans);
    expect(taken.displaced).toBe(1);
    expect(taken.doors).toHaveLength(free.doors.length - 1);
    expect(taken.doors).not.toContain(centre);
    expect(dockDoorRun(HOST, "top", [], lens, g, rampSpansOnSide(ramps, "top", ["top", "bottom"], {})).displaced).toBe(0); // the other wall is untouched
    // delete the ramp → the doors come back
    expect(dockDoorRun(HOST, "bottom", [], lens, g, rampSpansOnSide([], "bottom", ["top", "bottom"], {})).doors).toEqual(free.doors);
  });
});

describe("flags", () => {
  const sides = ["top", "bottom"];
  const codes = (rec, ctx) => rampFlags(HOST, rec, { dockSides: sides, dockHeightIn: DOCK_IN, ...ctx }).map((f) => f.code);
  it("a clean default ramp has none", () => { expect(codes(newRampRecord("bottom", 250), { courtDepthFt: 130 })).toEqual([]); });
  it("grade over 10 % → the grade flag; exactly 10 % is fine", () => {
    expect(codes(newRampRecord("bottom", 250, { gradePct: 12 }), {})).toContain(RAMP_FLAG.GRADE);
    expect(codes(newRampRecord("bottom", 250, { gradePct: 10 }), {})).not.toContain(RAMP_FLAG.GRADE);
  });
  it("straight-in longer than the court in front → court-depth; the along-the-wall layout is exempt", () => {
    expect(codes(newRampRecord("bottom", 250), { courtDepthFt: 40 })).toContain(RAMP_FLAG.COURT);
    expect(codes(newRampRecord("bottom", 250, { layout: "along" }), { courtDepthFt: 40 })).not.toContain(RAMP_FLAG.COURT);
    expect(codes(newRampRecord("bottom", 250), { courtDepthFt: null })).not.toContain(RAMP_FLAG.COURT);
  });
  it("a footprint crossing another element → crosses (touching along an edge does not)", () => {
    const pond = { id: "p", name: "the detention pond", ring: [{ x: 240, y: 135 }, { x: 260, y: 135 }, { x: 260, y: 160 }, { x: 240, y: 160 }] };
    const edge = { id: "e", name: "the parking", ring: [{ x: 240, y: 175 + 0 }, { x: 260, y: 175 }, { x: 260, y: 200 }, { x: 240, y: 200 }] }; // starts exactly at the ramp's far end (y = 125 + 50)
    const rec = newRampRecord("bottom", 250); // bottom wall at y = 125 → ramp y ∈ [125, 175], u ∈ [242, 258] (x = u − 250)
    const f = rampFlags(HOST, rec, { dockSides: sides, dockHeightIn: DOCK_IN, others: [{ ...pond, ring: pond.ring.map((p) => ({ x: p.x - 250 + 250 - 250 + 250 - 250, y: p.y })) }] });
    // (the pond above is in plan coords where the building is centred on the origin: x ∈ [-250, 250] — shift into place)
    const inside = rampFlags(HOST, rec, { dockSides: sides, dockHeightIn: DOCK_IN, others: [{ id: "p", name: "the detention pond", ring: [{ x: -10, y: 140 }, { x: 10, y: 140 }, { x: 10, y: 160 }, { x: -10, y: 160 }] }] });
    expect(inside.map((x) => x.code)).toContain(RAMP_FLAG.CROSSES);
    expect(inside.find((x) => x.code === RAMP_FLAG.CROSSES).text).toContain("the detention pond");
    const touching = rampFlags(HOST, rec, { dockSides: sides, dockHeightIn: DOCK_IN, others: [{ id: "e", name: "the parking", ring: [{ x: -10, y: 175 }, { x: 10, y: 175 }, { x: 10, y: 200 }, { x: -10, y: 200 }] }] });
    expect(touching.map((x) => x.code)).not.toContain(RAMP_FLAG.CROSSES);
    expect(f).toBeDefined(); expect(edge).toBeDefined();
  });
  it("a footprint outside the setback → setback; fully inside → none", () => {
    const allowed = (yMax) => [[{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: yMax }, { x: -400, y: yMax }]];
    expect(codes(newRampRecord("bottom", 250), { allowedRings: allowed(160) })).toContain(RAMP_FLAG.SETBACK);   // the ramp reaches y = 175
    expect(codes(newRampRecord("bottom", 250), { allowedRings: allowed(200) })).not.toContain(RAMP_FLAG.SETBACK);
    expect(codes(newRampRecord("bottom", 250), { allowedRings: [] })).not.toContain(RAMP_FLAG.SETBACK);        // unknown setback: no claim
  });
  it("past the end of the wall → off-wall", () => {
    expect(codes(newRampRecord("bottom", 495), {})).toContain(RAMP_FLAG.OFF_WALL);
    expect(codes(newRampRecord("bottom", 250, { layout: "along", dir: 1 }), {})).not.toContain(RAMP_FLAG.OFF_WALL);
    expect(codes(newRampRecord("bottom", 480, { layout: "along", dir: 1 }), {})).toContain(RAMP_FLAG.OFF_WALL);
  });
  it("a non-dock wall says it is only a door marker and raises nothing else", () => {
    expect(codes(newRampRecord("left", 100, { gradePct: 20 }), {})).toEqual([RAMP_FLAG.NON_DOCK]);
  });
});

describe("grading — a pad member whose surface is the plane apron → FFE", () => {
  const FFE = 100;
  const plane = rampPlane(HOST, newRampRecord("bottom", 250), { ffeFt: FFE, dockHeightIn: DOCK_IN });
  it("FFE − rise at the low end, FFE at the door, linear between (contours are interval / grade apart)", () => {
    expect(plane.lowElevFt).toBe(96); expect(plane.highElevFt).toBe(100);
    expect(plane.zAt(plane.lowPt)).toBeCloseTo(96, 9);
    expect(plane.zAt(plane.highPt)).toBeCloseTo(100, 9);
    // 8 % grade: every 12.5 ft of run is one foot
    const at = (d) => ({ x: plane.lowPt.x + plane.axis.x * d, y: plane.lowPt.y + plane.axis.y * d });
    [0, 12.5, 25, 37.5, 50].forEach((d, i) => expect(plane.zAt(at(d))).toBeCloseTo(96 + i, 9));
    expect(plane.zAt(at(-10))).toBeCloseTo(96, 9); expect(plane.zAt(at(80))).toBeCloseTo(100, 9); // clamped beyond the ends
  });
  it("buildPlanes gives the prepared ramp ITS OWN plane off the host's finish elevation (typed pad elevation wins over the plan FFE)", () => {
    const g = rampGeometry(HOST, newRampRecord("bottom", 250), { dockHeightIn: DOCK_IN });
    const ring = rampRing(HOST, newRampRecord("bottom", 250), { dockHeightIn: DOCK_IN });
    const bRing = [{ x: -250, y: -125 }, { x: 250, y: -125 }, { x: 250, y: 125 }, { x: -250, y: 125 }];
    const els = [{ id: "b1", type: "building", ring: bRing, padElevFt: 120 }, { id: "r1", type: "driveInRamp", ring, ramp: g, hostId: "b1" }];
    expect(classifyGradeElement(els[1])).toBe("driveInRamp");
    const { planes, skipped } = buildPlanes({ els, ffeFt: 100, dockDropFt: 4, grading: { pavementSlopePct: 1.5, lotDropFt: 0.5 } });
    expect(skipped).toEqual([]);
    const p = planes.get("r1");
    expect(p.classId).toBe("driveInRamp");
    expect(p.zAt(g.lowPt)).toBeCloseTo(116, 9);
    expect(p.zAt(g.highPt)).toBeCloseTo(120, 9);
    expect(p.zAt({ x: (g.lowPt.x + g.highPt.x) / 2, y: (g.lowPt.y + g.highPt.y) / 2 })).toBeCloseTo(118, 9);
    // no finish elevation anywhere → skipped (honest unknown), never a made-up number
    expect(buildPlanes({ els: [{ ...els[0], padElevFt: null }, els[1]], ffeFt: null, grading: { pavementSlopePct: 1.5 } }).skipped).toContain("r1");
  });
  it("membership: a ramp resolves to its host building and joins its assembly; it is not a building and not a bump-out pad member", () => {
    const els = [{ id: "b1", type: "building" }, { id: "r1", type: "driveInRamp", attachedTo: "b1", hostId: "b1" }];
    const byId = new Map(els.map((e) => [e.id, e]));
    expect(hostBuildingIdOf(els[1], byId)).toBe("b1");
    expect([...assemblyIds(els, "b1")].sort()).toEqual(["b1", "r1"]);
    expect(isDriveInRamp(els[1])).toBe(true); expect(isDriveInRamp(els[0])).toBe(false);
  });
});

describe("keeping the box in step with the host (refitRamps)", () => {
  const sidesOf = (h) => dockSidesFor(h).dockSides;
  const ramp = (host, rec) => ({ id: "r1", type: "driveInRamp", attachedTo: host.id, noLabel: true, ramp: rec, ...rampBox(host, rec, { dockHeightIn: DOCK_IN }) });
  it("is identity-stable when nothing moved (it runs at every element write)", () => {
    const els = [HOST, ramp(HOST, newRampRecord("bottom", 250))];
    expect(refitRamps(els, sidesOf, DOCK_IN)).toBe(els);
    const none = [HOST];
    expect(refitRamps(none, sidesOf, DOCK_IN)).toBe(none);
  });
  it("a moved / rotated / resized host carries its ramp: the box is re-derived", () => {
    const els = [HOST, ramp(HOST, newRampRecord("bottom", 250))];
    const moved = refitRamps([{ ...HOST, cx: 300, cy: 40, rot: 90 }, els[1]], sidesOf, DOCK_IN);
    expect(moved).not.toBe(els);
    const want = rampBox({ ...HOST, cx: 300, cy: 40, rot: 90 }, newRampRecord("bottom", 250), { dockHeightIn: DOCK_IN });
    expect(moved[1]).toMatchObject({ cx: want.cx, cy: want.cy, w: want.w, h: want.h, rot: 90 });
    const wider = refitRamps([{ ...HOST, h: 400 }, els[1]], sidesOf, DOCK_IN);
    expect(wider[1].cy).toBeCloseTo(rampBox({ ...HOST, h: 400 }, newRampRecord("bottom", 250), { dockHeightIn: DOCK_IN }).cy, 9);
  });
  it("a new dock height re-derives a ramp that follows it, and leaves one with its own rise alone", () => {
    const a = ramp(HOST, newRampRecord("bottom", 250)), b = { ...ramp(HOST, newRampRecord("bottom", 100, { riseIn: 48 })), id: "r2" };
    const out = refitRamps([HOST, a, b], sidesOf, 54);
    expect(out[1].h).toBeCloseTo(4.5 / 0.08, 6);
    expect(out[2]).toBe(b);
  });
  it("a wall that stops being a dock wall turns the ramp into a door marker", () => {
    const els = [{ ...HOST, dock: "single", dockSide: "top" }, ramp(HOST, newRampRecord("bottom", 250))];
    const out = refitRamps(els, sidesOf, DOCK_IN);
    expect(out[1].h).toBeLessThan(3);
  });
  it("an orphan (host gone) or a ramp on a polygon host is left exactly as stored", () => {
    const orphan = ramp(HOST, newRampRecord("bottom", 250));
    const els = [orphan];
    expect(refitRamps(els, sidesOf, DOCK_IN)).toBe(els);
    const poly = { ...HOST, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
    const e2 = [poly, orphan];
    expect(refitRamps(e2, sidesOf, DOCK_IN)).toBe(e2);
  });
  it("undo round-trip: restoring a snapshot (exact geometry, setElsRaw) then re-fitting changes nothing, and add → snapshot → redo is the same list", () => {
    const before = [HOST];
    const added = refitRamps([HOST, ramp(HOST, newRampRecord("bottom", 250))], sidesOf, DOCK_IN);
    const snapshotUndo = JSON.parse(JSON.stringify(before)), snapshotRedo = JSON.parse(JSON.stringify(added));
    expect(refitRamps(snapshotUndo, sidesOf, DOCK_IN)).toBe(snapshotUndo);     // undo: ramp gone, nothing re-invented
    expect(refitRamps(snapshotRedo, sidesOf, DOCK_IN)).toBe(snapshotRedo);     // redo: the ramp comes back byte-identical
    expect(snapshotRedo).toEqual(added);
  });
});

describe("the model read path keeps a ramp", () => {
  it("createSiteModel round-trips a ramp untouched (the bonded-child heal does not rotate or re-seat it)", () => {
    const rampEl = { id: "r1", type: "driveInRamp", attachedTo: "b1", noLabel: true, ramp: newRampRecord("bottom", 250), ...rampBox(HOST, newRampRecord("bottom", 250), { dockHeightIn: DOCK_IN }) };
    const m = createSiteModel({ id: "s1", els: [HOST, rampEl] });
    const back = m.els.find((e) => e.id === "r1");
    expect(back).toMatchObject(rampEl); // (the read path stamps a paint-order `z`; nothing else is added or moved)
    const rotated = createSiteModel({ id: "s1", els: [{ ...HOST, rot: 90 }, rampEl] }); // a host re-angled behind the ramp's back: the heal must not move it either
    expect(rotated.els.find((e) => e.id === "r1")).toMatchObject(rampEl);
  });
  it("it hides with Buildings (no row of its own), is named for the Bluebeam Subject column, and has a style", () => {
    expect(elHidden({ "el:building": true }, { type: "driveInRamp" })).toBe(true);
    expect(elHidden({}, { type: "driveInRamp" })).toBe(false);
    expect(elementSubject({ type: "driveInRamp" })).toBe("Drive-in ramp");
    expect(TYPE.driveInRamp.label).toBe("Drive-in Ramp");
  });
});

describe("the real renderer → the real editable-PDF walker", () => {
  const settings = { showDocks: true, showGrid: true, showDims: true, floodMitigation: { dockDropFt: 4 } };
  const f2p = (p) => ({ x: p.x * 2 + 600, y: p.y * 2 + 400 }); // 2 px per ft
  const gridDoors = (() => { const g = resolveGridSettings(HOST, settings); const gg = computeBuildingGrid({ length: footprintLength(HOST), depth: footprintDepth(HOST), dock: "cross", grid: g }); return dockDoorRun(HOST, "bottom", [], gg.lengthLines.map((l) => l.at), g).doors; })();
  const rec = newRampRecord("bottom", gridDoors[Math.floor(gridDoors.length / 2)]);
  const rampEl = { id: "r1", type: "driveInRamp", attachedTo: "b1", noLabel: true, ramp: rec, ...rampBox(HOST, rec, { dockHeightIn: DOCK_IN }) };
  const els = [HOST, rampEl];
  const nb = resolveElNeighbors(els, settings);
  const H = { startMoveEl() {}, onElDouble() {}, startDimMove() {}, onDimNumberDown() {}, onElContext() {} };
  const svg = (el, over = {}) => renderToStaticMarkup(createElement("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 1200 800" },
    createElement(ElNode, { el, f2p: over.f2p || f2p, isSel: false, tool: "select", settings, H, nb: nb.get(el.id), dimHidden: false, roadNet: null, lf: null, editingCorners: false, ...over })));
  it("draws ONE el: group — footprint first, then wings, a doubled door line, two bollards, the arrow and the label", () => {
    const x = svg(rampEl, { f2p: (p) => ({ x: p.x * 5 + 600, y: p.y * 5 - 400 }) });
    expect(x).toContain('data-feature="el:r1"');
    expect((x.match(/data-feature=/g) || []).length).toBe(1);
    expect(x.indexOf("<polygon")).toBeLessThan(x.indexOf("<line"));
    expect((x.match(/<circle/g) || []).length).toBe(2);
    expect(x).toContain("DRIVE-IN RAMP · 8% · 16&#x27; W");
  });
  it("the label drops to the short form on a short footprint and to nothing when neither fits", () => {
    const tiny = (k) => renderToStaticMarkup(createElement("svg", null, createElement(ElNode, { el: rampEl, f2p: (p) => ({ x: p.x * k, y: p.y * k }), isSel: false, tool: "select", settings, H, nb: nb.get("r1"), dimHidden: false, roadNet: null, lf: null, editingCorners: false })));
    expect(tiny(1.2)).toContain("RAMP 8%");
    expect(tiny(1.2)).not.toContain("DRIVE-IN RAMP");
    expect(tiny(0.05)).not.toContain("data-ramp-label");
    expect(tiny(0.45)).not.toContain("data-ramp-label");
  });
  it("the building's door belt loses the doors under the ramp on the canvas", () => {
    const withRamp = renderToStaticMarkup(createElement("svg", null, createElement(ElNode, { el: HOST, f2p, isSel: false, tool: "select", settings, H, nb: nb.get("b1"), dimHidden: false, roadNet: null, lf: null, editingCorners: false })));
    const without = resolveElNeighbors([HOST], settings);
    const bare = renderToStaticMarkup(createElement("svg", null, createElement(ElNode, { el: HOST, f2p, isSel: false, tool: "select", settings, H, nb: without.get("b1"), dimHidden: false, roadNet: null, lf: null, editingCorners: false })));
    const count = (s) => (s.match(/fill="#c2c9d2"/g) || []).length;
    expect(count(bare) - count(withRamp)).toBe(1);
  });
  it("it becomes ONE Bluebeam annotation with the Subject 'Drive-in ramp', footprint + label inside it", () => {
    const clone = svgToFake(svg(rampEl));
    const r = extractMarkupAnnotations(clone, { markups: [], els, f2p: (p) => p });
    expect(r.descriptors.map((d) => `${d.family}:${d.id}`)).toEqual(["element:r1"]);
    expect(r.descriptors[0].meta.subject).toBe("Drive-in ramp");
    const ann = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns });
    const list = ann.annots || ann.annotations || ann;
    expect(JSON.stringify(list)).toContain("Drive-in ramp");
    expect(JSON.stringify(list)).not.toContain("(unmapped)");
    expect(r.flattened).toEqual([]);
  });
});
