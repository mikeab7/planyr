/* buildingOutline — ONE ring through a building and its corner bump-outs (NEW-1, 2026-10-19). The editable PDF's
 * Building Polygon reads its vertices from here, so a dragged building takes its bump-outs with it. */
import { describe, it, expect } from "vitest";
import { buildingOutlineRing, bumpOutsOf, rectCorners } from "../src/workspaces/site-planner/lib/buildingOutline.js";
import { dogEarGeom, DOGEAR_W, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";
import { elCorners } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const host = { id: "b", type: "building", cx: 600, cy: 450, w: 500, h: 300, rot: 0 };
const bump = (h, id, side, sign, extra = {}) => { const de = { side, sign, along: DOGEAR_W, proj: DOGEAR_D }; return { id, type: "building", attachedTo: h.id, noFit: true, noLabel: true, dock: "none", dogEar: de, rot: h.rot || 0, ...dogEarGeom(h, de), ...extra }; };
const xs = (r) => r.map((p) => p.x), ys = (r) => r.map((p) => p.y);
const key = (r) => r.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).sort().join(" ");

describe("bumpOutsOf — the grading layer's pad-member rule, read at the point of use", () => {
  it("returns the bump-outs bonded to the host and nothing else", () => {
    const els = [host, bump(host, "l", "bottom", -1), bump(host, "r", "bottom", 1), { id: "court", type: "paving", attachedTo: "b", cx: 0, cy: 0, w: 1, h: 1 }, bump({ id: "other" }, "x", "top", 1)];
    expect(bumpOutsOf(els, host).map((b) => b.id)).toEqual(["l", "r"]);
  });
  it("a bump-out is never a host; a polygon building has none; a malformed side or box is ignored", () => {
    const b = bump(host, "l", "bottom", -1);
    expect(bumpOutsOf([host, b], b)).toEqual([]);
    expect(bumpOutsOf([{ id: "p", type: "building", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, { ...b, attachedTo: "p" }], { id: "p", type: "building", points: [] })).toEqual([]);
    expect(bumpOutsOf([host, { ...b, dogEar: { side: "diagonal", sign: 1 } }], host)).toEqual([]);
    expect(bumpOutsOf([host, { ...b, w: NaN }], host)).toEqual([]);
  });
});

describe("buildingOutlineRing", () => {
  it("no bump-outs → the host's own four corners (same derivation as siteGeometry.elCorners)", () => {
    const r = buildingOutlineRing(host, []);
    expect(key(r.ring)).toBe(key(elCorners(host)));
    expect(key(rectCorners({ ...host, rot: 37 }))).toBe(key(elCorners({ ...host, rot: 37 })));
    expect(r.members).toEqual([]); expect(r.detached).toEqual([]);
  });
  it("a polygon building keeps its own ring", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 40, y: 50 }, { x: 0, y: 90 }];
    expect(buildingOutlineRing({ id: "p", type: "building", points: ring }, []).ring).toEqual(ring);
  });
  it("two corner bump-outs on the dock wall → ONE eight-vertex outline whose extent spans the bump-outs", () => {
    const l = bump(host, "l", "bottom", -1), r = bump(host, "r", "bottom", 1);
    const o = buildingOutlineRing(host, [l, r]);
    expect(o.ring).toHaveLength(8);
    expect(o.members).toEqual(["l", "r"]); expect(o.detached).toEqual([]);
    expect(Math.min(...ys(o.ring))).toBeCloseTo(300, 6);          // host top
    expect(Math.max(...ys(o.ring))).toBeCloseTo(600 + DOGEAR_D, 6); // bump-out bottom, 60 ft past the dock face
    expect(Math.min(...xs(o.ring))).toBeCloseTo(350, 6); expect(Math.max(...xs(o.ring))).toBeCloseTo(850, 6);
    // the notch between the two bump-outs is the dock face itself
    expect(o.ring.filter((p) => Math.abs(p.y - 600) < 1e-6).map((p) => p.x).sort((a, b) => a - b)).toEqual([350 + DOGEAR_W, 850 - DOGEAR_W]);
  });
  it("one bump-out → six vertices; diagonal corners → eight; three corners → ten", () => {
    expect(buildingOutlineRing(host, [bump(host, "l", "bottom", -1)]).ring).toHaveLength(6);
    expect(buildingOutlineRing(host, [bump(host, "l", "bottom", -1), bump(host, "t", "top", 1)]).ring).toHaveLength(8);
    expect(buildingOutlineRing(host, [bump(host, "l", "bottom", -1), bump(host, "r", "bottom", 1), bump(host, "t", "top", 1)]).ring).toHaveLength(10);
  });
  it("a rotated building: the outline rotates with it and still has eight vertices", () => {
    const hr = { ...host, rot: 33 };
    const o = buildingOutlineRing(hr, [bump(hr, "l", "bottom", -1), bump(hr, "r", "bottom", 1)]);
    expect(o.ring).toHaveLength(8);
    // every bump-out corner is on the outline (the far corners of a bump-out are outline vertices)
    const far = (b) => rectCorners(b).filter((c) => (c.x - hr.cx) * Math.sin((33 * Math.PI) / 180) * -1 + (c.y - hr.cy) * Math.cos((33 * Math.PI) / 180) > hr.h / 2 + 1);
    for (const b of [bump(hr, "l", "bottom", -1), bump(hr, "r", "bottom", 1)]) for (const c of far(b)) expect(o.ring.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 0.02)).toBe(true);
  });
  it("a resized bump-out (its stored along/proj) is honoured, not the default", () => {
    const de = { side: "bottom", sign: 1, along: 80, proj: 25 };
    const b = { id: "r", type: "building", attachedTo: "b", dogEar: de, rot: 0, ...dogEarGeom(host, de) };
    const o = buildingOutlineRing(host, [b]);
    expect(Math.max(...ys(o.ring))).toBeCloseTo(625, 6);
    expect(o.ring.filter((p) => Math.abs(p.y - 600) < 1e-6).map((p) => p.x).sort((a, b) => a - b)).toEqual([350, 770]);
  });
  it("LOUD: a bump-out that does not touch the host is named in `detached` and kept out of the ring", () => {
    const far = { id: "x", type: "building", attachedTo: "b", dogEar: { side: "bottom", sign: 1 }, cx: 2000, cy: 2000, w: 55, h: 60, rot: 0 };
    const o = buildingOutlineRing(host, [bump(host, "l", "bottom", -1), far]);
    expect(o.ring).toHaveLength(6); expect(o.members).toEqual(["l"]); expect(o.detached).toEqual(["x"]);
    expect(Math.max(...xs(o.ring))).toBeCloseTo(850, 6);
  });
});
