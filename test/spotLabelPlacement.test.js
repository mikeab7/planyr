// NEW-1 (owner 2026-11-04, Georgia Test Site › Concept A, building zoom): the grading's court / lot labels — "dock 784.5", the far-edge "784.5", "1.5% fall",
// the cut / fill corner tags, the setback flag pill — were drawn UNDER the building's red − / orange + buttons and the blue wall handle, and one was cut off by the
// map's top edge. The rule now: no label is ever under a button, a grip, the rotate stem or another label, and none is cut by the map's edge; controls stay put,
// labels move (a short leader ties a moved one back to the point it measures).
//
// The controls here are re-derived from the planner's OWN layout (lib/buildingButtons.js) and the grips' drawn sizes — not from the placer's obstacle list — so
// the placer cannot pass by agreeing with itself. The teeth proof drives the same matrix with labels left at their natural spots (what main drew).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { layoutLabelSet, placeLabels, buildingControlObstacles, boxHitsDisc, boxHitsRect, boxHitsBox, segHitsBox } from "../src/workspaces/site-planner/lib/spotLabelPlacement.js";
import { layoutBuildingButtons, layoutDiscs, buildingButtonWalls, ROTATE_GRIP_OFFSET_PX, ROTATE_GRIP_R_PX, BUTTON_WALL_MIN_PX } from "../src/workspaces/site-planner/lib/buildingButtons.js";
import { dockSidesFor } from "../src/workspaces/site-planner/lib/dockZones.js";
import { pillWidth, CORNER_TAG_PILL_H } from "../src/workspaces/site-planner/lib/padCornerTag.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const rot2 = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
const VIEW = { w: 1400, h: 1000 };

/** A building element and the label set GradingController would build for it: a truck court on each dock wall, the four corner tags. */
function sceneOf({ w, h, rot, dock }) {
  const el = { id: "b1", type: "building", cx: 0, cy: 0, w, h, rot, dock, dockAxis: "x", dockSide: "bottom" };
  const cs = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => rot2(x, y, rot));
  const spots = [];
  for (const side of dockSidesFor(el).dockSides) {
    const sg = side === "bottom" ? 1 : -1, wallLen = side === "top" || side === "bottom" ? w : h;
    const nL = side === "top" || side === "bottom" ? { x: 0, y: sg } : { x: sg, y: 0 };
    const tL = side === "top" || side === "bottom" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const n = rot2(nL.x, nL.y, rot), t = rot2(tL.x, tL.y, rot);
    const A = rot2(nL.x * (side === "top" || side === "bottom" ? h : w) / 2, nL.y * (side === "top" || side === "bottom" ? h : w) / 2, rot);
    const D = 135, m = wallLen > 400 ? 3 : 2;
    const stations = Array.from({ length: m }, (_, i) => { const b = -wallLen / 2 + ((i + 0.5) / m) * wallLen; return { b, far: { a: D, label: "784.5" }, from: 0.3 * D, to: 0.7 * D }; });
    const mid = stations[Math.floor(m / 2)];
    spots.push({
      elId: `c-${side}`, kind: "court", depthFt: D, widthFt: wallLen, face: { a: 0, b: 0, label: "dock 784.5" }, stations,
      tag: { a: D / 2, b: mid.b, text: "1.5% fall" }, world: (a, b) => ({ x: A.x + n.x * a + t.x * b, y: A.y + n.y * a + t.y * b }),
    });
  }
  return { el, L: { id: "b1", centre: { x: 0, y: 0 }, minSideFt: Math.min(w, h), spots, quad: cs, ctrl: el, corners: cs.map((pt, idx) => ({ pt, idx, kind: "cut", text: ["cut 7.8", "fill 10.5", "cut 2.0", "cut 1.7"][idx] })), flagDot: null } };
}
const f2pAt = (ppf, ox, oy) => (p) => ({ x: ox + p.x * ppf, y: oy + p.y * ppf });

/** Every control, re-derived: the planner's own button layout + the drawn grips (9 / 10 px squares, the rotate circle and its stem). */
function controlsOf(el, f2p, ppf) {
  const q = [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([x, y]) => { const o = rot2(x, y, el.rot); return f2p({ x: el.cx + o.x, y: el.cy + o.y }); });
  const discs = layoutDiscs(layoutBuildingButtons(buildingButtonWalls(q, dockSidesFor(el).dockSides, { wpx: el.w * ppf, hpx: el.h * ppf })));
  const rects = [];
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; rects.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, hw: 4.5, hh: 4.5 }, { x: a.x, y: a.y, hw: 5, hh: 5 }); }
  const tm = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 }, cc = { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 }, ul = Math.hypot(tm.x - cc.x, tm.y - cc.y) || 1;
  const rp = { x: tm.x + ((tm.x - cc.x) / ul) * ROTATE_GRIP_OFFSET_PX, y: tm.y + ((tm.y - cc.y) / ul) * ROTATE_GRIP_OFFSET_PX };
  discs.push({ x: rp.x, y: rp.y, r: 6 });
  const stem = []; for (let d = 1; d < ROTATE_GRIP_OFFSET_PX; d += 2) stem.push({ x: tm.x + ((rp.x - tm.x) * d) / ROTATE_GRIP_OFFSET_PX, y: tm.y + ((rp.y - tm.y) * d) / ROTATE_GRIP_OFFSET_PX, r: 0.7 });
  return { discs: [...discs, ...stem], rects };
}

const BUILDINGS = [[1429, 650], [1000, 400], [600, 300], [520, 300], [300, 200]];
const ROTS = [0, 259, 90, 33];
const DOCKS = ["cross", "single", "none"];
const PPFS = [0.55, 0.7, 1.0, 1.7, 3.3];
// where the building's centre lands on the 1400 × 1000 map: middle, and tucked against each edge so labels have to be pulled in
const SPOTS = [[700, 500], [700, 90], [90, 500], [1310, 500], [700, 930], [200, 120]];

function runMatrix(layoutFn) {
  const cases = [];
  for (const [w, h] of BUILDINGS) for (const rot of ROTS) for (const dock of DOCKS) for (const ppf of PPFS) for (const [ox, oy] of SPOTS) {
    const { el, L } = sceneOf({ w, h, rot, dock });
    const f2p = f2pAt(ppf, ox, oy);
    if (Math.min(w, h) * ppf < 90) continue;                                       // below the working zoom the canvas draws no spot labels (LABELS_MIN_PX)
    const lay = layoutFn(L, f2p, ppf);
    cases.push({ name: `${w}x${h}@${rot}° ${dock} ${ppf}px/ft @(${ox},${oy})`, el, L, f2p, ppf, lay, ctl: controlsOf(el, f2p, ppf) });
  }
  return cases;
}
const drawn = (lay) => [...lay.spots.entries()].filter(([, v]) => !v.hidden && !v.skip).map(([k, v]) => ({ key: k, ...v }));
const cornersOf = (lay) => [...lay.corners.values()];
const collisions = (c) => {
  const out = [];
  const boxes = [...drawn(c.lay), ...cornersOf(c.lay).filter((t) => !t.hidden).map((t, i) => ({ key: `corner${i}`, ...t }))];
  for (const b of boxes) {
    for (const d of c.ctl.discs) if (boxHitsDisc(b, d, 0)) out.push(`${b.key} ✕ disc`);
    for (const r of c.ctl.rects) if (boxHitsRect(b, r, 0)) out.push(`${b.key} ✕ grip`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxHitsBox(boxes[i], boxes[j], 0)) out.push(`${boxes[i].key} ✕ ${boxes[j].key}`);
  return out;
};
const segHits = (g, b) => { for (let i = 0; i <= 80; i++) { const t = i / 80, x = g.x1 + (g.x2 - g.x1) * t, y = g.y1 + (g.y2 - g.y1) * t; if (x > b.x - b.w / 2 + 0.5 && x < b.x + b.w / 2 - 0.5 && y > b.y - b.h / 2 + 0.5 && y < b.y + b.h / 2 - 0.5) return true; } return false; };
const leaderCrossings = (c) => { const bx = drawn(c.lay); const out = []; for (const a of bx) if (a.leader) for (const o of [...bx, ...cornersOf(c.lay).filter((t) => !t.hidden)]) if (o !== a && o.key !== a.key && segHits(a.leader, o)) out.push(`${a.key} leader ✕ ${o.key || "corner"}`); return out; };
const cutByEdge = (c) => drawn(c.lay).filter((b) => b.x - b.w / 2 < 0 || b.y - b.h / 2 < 0 || b.x + b.w / 2 > VIEW.w || b.y + b.h / 2 > VIEW.h).map((b) => b.key);
describe("grading labels clear every control, every other label and the map's edge", () => {
  const cases = runMatrix((L, f2p, ppf) => layoutLabelSet(L, f2p, ppf, VIEW));
  it("the matrix is large and draws labels", () => {
    expect(cases.length).toBeGreaterThan(800);
    expect(cases.filter((c) => drawn(c.lay).length > 0).length).toBeGreaterThan(500);
  });
  it("ZERO label boxes touch a button disc, a grip square, the rotate grip / stem, or another label", () => {
    const bad = cases.map((c) => [c.name, collisions(c)]).filter(([, x]) => x.length);
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it("NO leader line runs through another label (the owner's second finding, 2026-11-04) — in all but the rare map-edge squeeze", () => {
    const bad = cases.map((c) => [c.name, leaderCrossings(c)]).filter(([, x]) => x.length);
    expect(bad.length).toBeLessThan(cases.length * 0.003);
    expect(bad.filter(([n]) => /@\(700,500\)/.test(n))).toEqual([]);           // with the building in the middle of the map there is always a clean place
  });
  it("no drawn label is cut by the map's edge", () => {
    const bad = cases.map((c) => [c.name, cutByEdge(c)]).filter(([, x]) => x.length);
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it("no label whose subject is on the map is dropped for lack of room (a dropped label would be a silent loss)", () => {
    const bad = cases.filter((c) => c.lay.hiddenCount > 0).map((c) => c.name);
    expect(bad.slice(0, 8)).toEqual([]);
  });
  it("a label moved off its natural spot is tied back to the point it measures; one left in place has no leader", () => {
    for (const c of cases) for (const v of c.lay.spots.values()) { if (v.hidden || v.skip) continue; if (!v.moved) expect(v.leader).toBeNull(); }
    const moved = cases.flatMap((c) => drawn(c.lay).filter((v) => v.moved));
    expect(moved.length).toBeGreaterThan(300);
    expect(moved.filter((v) => !v.leader && v.gap > 4).length).toBe(0);      // a moved label with no leader sits right against its subject
    expect(moved.filter((v) => v.leader).length).toBeGreaterThan(moved.length * 0.5);
  });
  it("selection is irrelevant: the layout is a pure function of the scene (same input, same boxes)", () => {
    const c = cases[Math.floor(cases.length / 2)], again = layoutLabelSet(c.L, c.f2p, c.ppf, VIEW);
    expect([...again.spots]).toEqual([...c.lay.spots]);
  });
  it("a label whose subject is off the map is not drawn and not dragged in", () => {
    const { L } = sceneOf({ w: 1000, h: 400, rot: 0, dock: "cross" });
    const lay = layoutLabelSet(L, f2pAt(1, 700, -5000), 1, VIEW);   // the whole building is far above the map
    expect(drawn(lay).length).toBe(0);
    expect(lay.hiddenCount).toBe(0);
  });
  it("a label never covers the point ANOTHER label measures, and no leader starts under a label (V2102896 finding, 2026-11-04)", () => {
    // B's measured point sits where A's natural box would land: A must move off it, and B's leader must cross nothing
    const items = [{ key: "A", text: "784.5", x: 300, y: 300, anchor: { x: 300, y: 330 } }, { key: "B", text: "dock 786.5", x: 300, y: 360, anchor: { x: 300, y: 300 } }];
    const r = placeLabels(items, { discs: [], rects: [] }, VIEW);
    const a = r.get("A"), b = r.get("B");
    expect(boxHitsBox(a, b, 0)).toBe(false);
    for (const [it, p] of [[items[0], a], [items[1], b]]) { const other = it.key === "A" ? b : a; expect(Math.abs(it.anchor.x - other.x) < other.w / 2 && Math.abs(it.anchor.y - other.y) < other.h / 2).toBe(false); }
    for (const p of [a, b]) if (p.leader) for (const q of [a, b]) if (q !== p) expect(segHitsBox(p.leader, q, 0)).toBe(false);
  });
  it("segHitsBox is exact: a segment through a box hits, one grazing past it does not", () => {
    const box = { x: 100, y: 100, w: 40, h: 20 };
    expect(segHitsBox({ x1: 0, y1: 100, x2: 200, y2: 100 }, box)).toBe(true);
    expect(segHitsBox({ x1: 0, y1: 80, x2: 200, y2: 80 }, box)).toBe(false);
    expect(segHitsBox({ x1: 100, y1: 0, x2: 100, y2: 89 }, box)).toBe(false);
    expect(segHitsBox({ x1: 100, y1: 0, x2: 100, y2: 95 }, box)).toBe(true);
  });
  it("a label with no clear place within reach is hidden, never drawn under a control", () => {
    const wall = { discs: [], rects: [{ x: 700, y: 500, hw: 400, hh: 400 }] };            // a control the size of the whole neighbourhood
    const r = placeLabels([{ key: "k", text: "dock 784.5", x: 700, y: 500 }], wall, VIEW);
    expect(r.get("k").hidden).toBe(true);
  });
});

describe("TEETH: with the labels left where main drew them, the same matrix collides", () => {
  it("natural placement collides with a control in a large share of the cases (the owner's report), and is cut by the edge in others", () => {
    const cs = runMatrix((L, f2p, ppf) => {
      // main: every label at its natural spot, nothing avoided, no edge
      const lay = layoutLabelSet({ ...L, ctrl: null }, f2p, ppf, null);   // no controls known, no view → natural spots
      return lay;
    });
    const hits = cs.filter((c) => collisions(c).length > 0).length;
    expect(hits).toBeGreaterThan(cs.length * 0.25);
    expect(cs.filter((c) => cutByEdge(c).length > 0).length).toBeGreaterThan(20);
  });
});

describe("the obstacle set is the planner's own", () => {
  it("buildingControlObstacles = the planner's button discs + 8 grip squares + the rotate grip and stem (none for a locked or polygon building)", () => {
    const { el } = sceneOf({ w: 600, h: 300, rot: 20, dock: "cross" });
    const f2p = f2pAt(1.2, 500, 400), o = buildingControlObstacles(el, f2p, 1.2), ref = controlsOf(el, f2p, 1.2);
    expect(o.rects.length).toBe(8);
    for (const d of ref.discs.filter((x) => x.r > 2)) expect(o.discs.some((x) => Math.hypot(x.x - d.x, x.y - d.y) < 1.2 && x.r >= d.r - 1.5)).toBe(true);
    expect(buildingControlObstacles({ ...el, locked: true }, f2p, 1.2)).toEqual({ discs: [], rects: [] });
    expect(buildingControlObstacles({ ...el, points: [{ x: 0, y: 0 }] }, f2p, 1.2)).toEqual({ discs: [], rects: [] });
  });
  it("the wall filter is ONE function: SitePlanner's sideAddNodes and the label placer both call buildingButtonWalls", () => {
    expect(BUTTON_WALL_MIN_PX).toBe(72);
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx"), lib = read("../src/workspaces/site-planner/lib/spotLabelPlacement.js");
    expect(sp).toMatch(/buildingButtonWalls\(quad, dockSides, \{ wpx, hpx, footEdit: !!el\.footEdit \}\)/);
    expect(lib).toMatch(/buildingButtonWalls\(quad,/);
    expect(sp).not.toMatch(/wallsFromQuad\(/);
  });
});

describe("wiring", () => {
  const panels = read("../src/workspaces/site-planner/components/GradingPanels.jsx");
  it("GradingCanvas places every court / lot label through layoutLabelSet and draws the pills where it says (no inline offset left)", () => {
    expect(panels).toMatch(/layoutLabelSet\(L, f2p, rppf, viewPx\)/);
    expect(panels).not.toMatch(/placeCornerTag\(/);
    expect(panels).not.toMatch(/<Pill2 x=\{fp\.x\}/);
    expect(panels).toMatch(/data-spot-label=\{kind\}/);
  });
  it("the planner hands the canvas its box, the controller hands the placer the real building element", () => {
    expect(read("../src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/viewPx=\{canvasBoxPx\}/);
    expect(read("../src/workspaces/site-planner/components/GradingController.jsx")).toMatch(/ctrl: \(inRef\.current\.rawBuildings/);
  });
  it("pill size is the one the canvas draws (so the placer's boxes are the painted boxes)", () => {
    const r = placeLabels([{ key: "k", text: "dock 784.5", x: 100, y: 100 }], { discs: [], rects: [] }, VIEW).get("k");
    expect(r.w).toBe(pillWidth("dock 784.5"));
    expect(r.h).toBe(CORNER_TAG_PILL_H);
  });
});
