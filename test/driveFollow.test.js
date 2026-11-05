/* B2498961 — a drive connected to a parking field (or truck court) FOLLOWS it on a small move and LETS GO on a big one (owner 2026-10-29: "if I move the
 * building 200 feet, then you can forget the road. But if I move the building and the parking 50 feet, then, yeah, keep it attached").
 * Pure rule: lib/driveFollow.js `followDrives(base, prev, next)`. The seam in the planner (SitePlanner.jsx `setEls`) is source-guarded at the bottom. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { followDrives, DRIVE_FOLLOW_MAX_FT } from "../src/workspaces/site-planner/lib/driveFollow.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { SETTINGS } from "./helpers/driveMatrix.js";
import { plannerSource } from "./helpers/plannerSource.js";

const FIELD = { id: "f", type: "parking", cx: 0, cy: 0, w: 200, h: 42, rot: 0 };
// a long road coming from the east and ending ON the field's east face (x = 100), 24 ft wide
const ROAD = { id: "r", type: "road", pts: [{ x: 900, y: 5 }, { x: 500, y: 5 }, { x: 100, y: 5 }], vtx: [], travelW: 24, cx: 500, cy: 5, w: 800, h: 25, rot: 0,
  driveTee: { targetId: "f", kind: "parking", returnR: 15, flare: 0 } };
const plan = (over = {}) => [{ ...FIELD, ...(over.field || {}) }, { ...ROAD, ...(over.road || {}) }];
const moveField = (els, dx, dy = 0, extra = {}) => els.map((e) => (e.id === "f" ? { ...e, cx: e.cx + dx, cy: e.cy + dy, ...extra } : e));
const road = (els) => els.find((e) => e.id === "r");
const last = (r) => r.pts[r.pts.length - 1];
const step = (s, mutate) => followDrives(s, s, mutate(s));            // a one-shot edit: base === prev

describe("followDrives — the threshold (owner: 50 ft keeps it, 200 ft forgets it)", () => {
  it("the threshold is ONE named constant, 100 ft", () => expect(DRIVE_FOLLOW_MAX_FT).toBe(100));
  it("a 10 ft move: the road's last point goes with the field, nothing else moves, the connection stays", () => {
    const s0 = plan(), s1 = step(s0, (a) => moveField(a, 10));
    expect(last(road(s1))).toMatchObject({ x: 110, y: 5 });
    expect(road(s1).pts.slice(0, -1)).toEqual(ROAD.pts.slice(0, -1));
    expect(road(s1).driveTee).toEqual(ROAD.driveTee);
  });
  it("99 ft follows; 101 ft lets go (the road stays exactly where it was drawn and its record is cleared)", () => {
    const s99 = step(plan(), (a) => moveField(a, -99, 0));
    expect(last(road(s99))).toMatchObject({ x: 1, y: 5 });
    expect(road(s99).driveTee).toBeTruthy();
    const s101 = step(plan(), (a) => moveField(a, 101, 0));
    expect(road(s101).pts).toEqual(ROAD.pts);
    expect(road(s101).driveTee).toBeUndefined();
    expect(road(s101).driveTee2).toBeUndefined();
  });
  it("a 200 ft move lets go too, whichever way the field goes", () => {
    for (const [dx, dy] of [[0, 200], [0, -200], [-200, 0], [141, 141]]) {
      const s = step(plan(), (a) => moveField(a, dx, dy));
      expect(road(s).pts).toEqual(ROAD.pts);
      expect(road(s).driveTee).toBeUndefined();
    }
  });
  it("a sideways 30 ft slide keeps the same spot on the edge (same face, same position along it)", () => {
    const s = step(plan(), (a) => moveField(a, 0, 30));
    expect(last(road(s))).toMatchObject({ x: 100, y: 35 });
  });
});

describe("followDrives — rotate / resize re-project the same spot on the same edge", () => {
  it("rotating the field 10° keeps the end on the east face at the same fraction along it", () => {
    const s = step(plan(), (a) => a.map((e) => (e.id === "f" ? { ...e, rot: 10 } : e)));
    const p = last(road(s)), c = Math.cos(Math.PI / 18), sn = Math.sin(Math.PI / 18);
    const lx = c * p.x + sn * p.y, ly = -sn * p.x + c * p.y;       // back into the field's new frame
    expect(lx).toBeCloseTo(100, 6);                                  // still on the east face
    expect(ly / 42).toBeCloseTo(5 / 42, 6);                          // same position along it
    expect(road(s).driveTee).toBeTruthy();
  });
  it("a 90° turn is a big move (the end swings far): it lets go", () => {
    const s = step(plan(), (a) => a.map((e) => (e.id === "f" ? { ...e, rot: 90 } : e)));
    expect(road(s).driveTee).toBeUndefined();
    expect(road(s).pts).toEqual(ROAD.pts);
  });
  it("lengthening the field 20 ft (its west end fixed) carries the east-face end with the face", () => {
    const s = step(plan(), (a) => a.map((e) => (e.id === "f" ? { ...e, w: 220, cx: 10 } : e)));
    expect(last(road(s))).toMatchObject({ x: 120, y: 5 });
  });
  it("a deeper field keeps the end at the same RELATIVE spot along the face", () => {
    const s = step(plan({ road: { pts: [{ x: 900, y: -13 }, { x: 500, y: -13 }, { x: 100, y: -13 }] } }), (a) => a.map((e) => (e.id === "f" ? { ...e, h: 84 } : e)));
    expect(last(road(s)).y).toBeCloseTo(-26, 6);                     // -13 / 42 of the old depth = -26 / 84 of the new
  });
});

describe("followDrives — when following is off even though the move is small", () => {
  it("it would fold the last leg back on itself: let go (the drawing is left intact)", () => {
    // the field moves 80 ft toward the road's own anchor and past it: the last leg would reverse direction
    const els = plan({ road: { pts: [{ x: 900, y: 5 }, { x: 160, y: 5 }, { x: 100, y: 5 }] } });
    const s = step(els, (a) => moveField(a, 99, 0));
    expect(road(s).pts).toEqual(els[1].pts);
    expect(road(s).driveTee).toBeUndefined();
  });
  it("a two-point road whose only leg would point the other way: let go", () => {
    const els = plan({ road: { pts: [{ x: 130, y: 5 }, { x: 100, y: 5 }] } });
    const s = step(els, (a) => moveField(a, 60, 0));
    expect(road(s).driveTee).toBeUndefined();
  });
  it("the new last leg would be shorter than the road is wide (24 ft): let go", () => {
    const els = plan({ road: { pts: [{ x: 500, y: 5 }, { x: 140, y: 5 }, { x: 100, y: 5 }] } });
    const s = step(els, (a) => moveField(a, 30, 0));             // leg 140 → 130 = 10 ft < 24
    expect(road(s).pts).toEqual(els[1].pts);
    expect(road(s).driveTee).toBeUndefined();
  });
});

describe("followDrives — adjacent cases", () => {
  it("a road welded to two different fields follows each end with its own field", () => {
    const g = { id: "g", type: "parking", cx: 1400, cy: 0, w: 200, h: 42, rot: 0 };
    const two = [FIELD, g, { ...ROAD, pts: [{ x: 100, y: 5 }, { x: 500, y: 5 }, { x: 1300, y: 5 }], driveTee: { targetId: "f", kind: "parking" }, driveTee2: { targetId: "g", kind: "parking" } }];
    const only = step(two, (a) => moveField(a, 10));              // only f moves: only its end follows
    expect(road(only).pts.map((p) => p.x)).toEqual([110, 500, 1300]);
    expect(road(only).driveTee2).toBeTruthy();
    const both = step(two, (a) => a.map((e) => (e.id === "f" || e.id === "g" ? { ...e, cx: e.cx + 10 } : e)));   // the building carries both
    expect(road(both).pts.map((p) => p.x)).toEqual([110, 500, 1310]);
    const split = step(two, (a) => a.map((e) => (e.id === "g" ? { ...e, cx: e.cx + 250 } : e)));   // g far away: only ITS record goes
    expect(road(split).pts.map((p) => p.x)).toEqual([100, 500, 1300]);
    expect(road(split).driveTee).toBeTruthy();
    expect(road(split).driveTee2).toBeUndefined();
  });
  it("moving the ROAD never moves the field", () => {
    const s0 = plan();
    const s1 = step(s0, (a) => a.map((e) => (e.id === "r" ? { ...e, pts: e.pts.map((p) => ({ x: p.x, y: p.y + 20 })) } : e)));
    expect(s1.find((e) => e.id === "f")).toBe(s0[0]);
    expect(road(s1).pts[2]).toMatchObject({ x: 100, y: 25 });       // exactly what the gesture wrote
  });
  it("a LOCKED road does not follow: within the threshold it stays connected and untouched, past it it lets go", () => {
    const els = plan({ road: { locked: true } });
    const near = step(els, (a) => moveField(a, 40));
    expect(road(near).pts).toEqual(ROAD.pts);
    expect(road(near).driveTee).toBeTruthy();
    const far = step(els, (a) => moveField(a, 250));
    expect(road(far).pts).toEqual(ROAD.pts);
    expect(road(far).driveTee).toBeUndefined();
  });
  it("a multi-select that moves the road AND the field: the road travels with the selection and does not follow twice", () => {
    const s = step(plan(), (a) => a.map((e) => ({ ...e, ...(e.id === "f" ? { cx: e.cx + 40 } : { pts: e.pts.map((p) => ({ x: p.x + 40, y: p.y })) }) })));
    expect(road(s).pts.map((p) => p.x)).toEqual([940, 540, 140]);
    expect(road(s).driveTee).toBeTruthy();
  });
  it("a road that is not actually touching its field (a stale record) is never dragged anywhere", () => {
    const els = plan({ road: { pts: [{ x: 900, y: 5 }, { x: 500, y: 5 }, { x: 300, y: 5 }] } });
    const s = step(els, (a) => moveField(a, 20));
    expect(road(s).pts).toEqual(els[1].pts);
    expect(road(s).driveTee).toBeTruthy();
  });
  it("a road with NO record is not 'connected' by this rule (the geometric fallback is the junction's business, not a promise to follow)", () => {
    const els = plan({ road: { driveTee: undefined } });
    const s = step(els, (a) => moveField(a, 20));
    expect(road(s).pts).toEqual(els[1].pts);
  });
  it("a truck court (paving) target follows by the same rule — it is the same connection record", () => {
    const court = { id: "f", type: "paving", cx: 0, cy: 0, w: 200, h: 130, rot: 0 };
    const els = [court, { ...ROAD, driveTee: { targetId: "f", kind: "truckcourt", returnR: 24, flare: 0 }, pts: [{ x: 900, y: 5 }, { x: 500, y: 5 }, { x: 100, y: 5 }] }];
    const s = step(els, (a) => moveField(a, 12));
    expect(last(road(s))).toMatchObject({ x: 112, y: 5 });
    const gone = step(els, (a) => moveField(a, 180));
    expect(road(gone).driveTee).toBeUndefined();
  });
  it("a free-drawn (polygon) field carries the end with its edge", () => {
    const poly = { id: "f", type: "parking", points: [{ x: -100, y: -21 }, { x: 100, y: -21 }, { x: 100, y: 21 }, { x: -100, y: 21 }] };
    const els = [poly, ROAD];
    const s = step(els, (a) => a.map((e) => (e.id === "f" ? { ...e, points: e.points.map((p) => ({ x: p.x + 15, y: p.y - 5 })) } : e)));
    expect(last(road(s))).toMatchObject({ x: 115, y: 0 });
  });
});

describe("followDrives — a DRAG: measured from where the gesture began, reversible, one undo step", () => {
  // each frame builds the next state from the drag's START (as the move handler does), and the road is recomputed against the BASE
  const base = plan();
  const frame = (prev, dx) => followDrives(base, prev, moveField(base, dx).map((e) => (e.id === "r" ? prev.find((x) => x.id === "r") : e)));
  it("the road follows live frame by frame and the preview shows it let go the moment the drag crosses the threshold", () => {
    let s = base;
    s = frame(s, 40); expect(last(road(s)).x).toBe(140);
    s = frame(s, 99); expect(last(road(s)).x).toBe(199);
    s = frame(s, 101); expect(road(s).pts).toEqual(ROAD.pts); expect(road(s).driveTee).toBeUndefined();
  });
  it("dragging back inside the threshold re-connects it (follow AND record come back)", () => {
    let s = frame(base, 150);
    expect(road(s).driveTee).toBeUndefined();
    s = frame(s, 60);
    expect(last(road(s)).x).toBe(160);
    expect(road(s).driveTee).toEqual(ROAD.driveTee);
  });
  it("many small frames add up: a 3 ft step 40 times is a 120 ft drag and lets go (per-frame distance is never the measure)", () => {
    let s = base;
    for (let i = 1; i <= 40; i++) s = frame(s, 3 * i);
    expect(road(s).driveTee).toBeUndefined();
    expect(road(s).pts).toEqual(ROAD.pts);
  });
  it("ONE undo step reverses the move and the follow together; redo replays both (history holds whole states)", () => {
    const history = [base];                                            // pushHistory before the gesture
    let s = base;
    for (const dx of [20, 40, 60]) s = frame(s, dx);
    const committed = s;
    const undone = history[0], redone = committed;                    // undo/redo restore snapshots verbatim (SitePlanner.jsx setElsRaw)
    expect(road(undone).pts).toEqual(ROAD.pts);
    expect(undone.find((e) => e.id === "f").cx).toBe(0);
    expect(last(road(redone)).x).toBe(160);
    expect(redone.find((e) => e.id === "f").cx).toBe(60);
    expect(followDrives(redone, redone, redone)).toBe(redone);          // re-applying it is a no-op (a fixed point)
  });
});

describe("followDrives — a bonded field rides its building", () => {
  const BUILDING = { id: "b", type: "building", cx: 0, cy: 100, w: 200, h: 100, rot: 0 };
  const bonded = { ...FIELD, attachedTo: "b", cy: 0 };
  const els = [BUILDING, bonded, ROAD];
  const dragBuilding = (a, dx) => a.map((e) => (e.id === "b" || e.id === "f" ? { ...e, cx: e.cx + dx } : e));
  it("dragging the building 50 ft: the road keeps its attachment to the field that rode along", () => {
    const s = step(els, (a) => dragBuilding(a, 50));
    expect(last(road(s)).x).toBe(150);
    expect(road(s).driveTee).toBeTruthy();
  });
  it("dragging the building 200 ft: forget the road", () => {
    const s = step(els, (a) => dragBuilding(a, 200));
    expect(road(s).pts).toEqual(ROAD.pts);
    expect(road(s).driveTee).toBeUndefined();
  });
});

describe("the load-time heal carries a road along with a re-seated bonded field", () => {
  // a building with an employee field bonded to its wall, stored 5 ft off where the heal wants it (the Tsakiris shape)
  const raw = () => {
    const els = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-2026-10-29.json", import.meta.url), "utf8")).els;
    return els;
  };
  it("Tsakiris / Concept A: the drive e1454682splyoj follows e52duuwgj's 5 ft re-seat, only its last point moves, and the junction is a real one (no skim)", () => {
    const rows = raw();
    const opened = createSiteModel({ id: "x", els: rows, settings: {} }).els;
    const f0 = rows.find((e) => e.id === "e52duuwgj"), f1 = opened.find((e) => e.id === "e52duuwgj");
    const r0 = rows.find((e) => e.id === "e1454682splyoj"), r1 = opened.find((e) => e.id === "e1454682splyoj");
    const dx = f1.cx - f0.cx, dy = f1.cy - f0.cy;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(4); expect(Math.hypot(dx, dy)).toBeLessThan(6);
    expect(r1.pts.slice(0, -1)).toEqual(r0.pts.slice(0, -1));
    expect(r1.pts[r1.pts.length - 1].x - r0.pts[r0.pts.length - 1].x).toBeCloseTo(dx, 6);
    expect(r1.pts[r1.pts.length - 1].y - r0.pts[r0.pts.length - 1].y).toBeCloseTo(dy, 6);
    const j = driveJunctionsOf(opened, SETTINGS).find((x) => x.sideId === r1.id && x.targetId === f1.id);
    expect(j.geom.skim).toBeFalsy();
  });
  it("the heal is a fixed point: opening the already-opened plan again moves nothing (no double follow)", () => {
    const once = createSiteModel({ id: "x", els: raw(), settings: {} }).els;
    const twice = createSiteModel({ id: "x", els: once, settings: {} }).els;
    expect(twice).toEqual(once);
  });
});

describe("the planner seam (source guard)", () => {
  const src = plannerSource();
  it("every element write goes through followDrives; whole-canvas replacements (undo/redo, remote, load, restore, adopt) use the raw setter", () => {
    expect(src).toMatch(/const setEls = \(u\) => \{[\s\S]{0,400}followDrives\(gestureBase \|\| prev/);
    expect(src).toMatch(/const \[els, setElsRaw\] = useState/);
    for (const needle of ["setElsRaw(s.els)", "setElsRaw(n.els || [])", "setElsRaw(merged.els)", "setElsRaw(v.els)", "setElsRaw(beforeEls)", "{ el: setElsRaw,"]) {
      expect(src.includes(needle)).toBe(true);
    }
  });
  it("every geometry drag carries the gesture's base through startGate", () => {
    expect(src).toMatch(/followBase: stateRef\.current\.els/);
  });
});
