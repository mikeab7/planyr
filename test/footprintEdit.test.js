import { describe, it, expect } from "vitest";
import {
  rectRing, dockLinesFor, convertBuildingToPolygon,
  distToLine, projectOntoLine, dockLineAt, dockEdgeLine,
  frameBBox, translateDockLines, rotateDockLines, dockSegExtent,
  pointInRing, clipSegmentToRing,
} from "../src/workspaces/site-planner/lib/footprintEdit.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ptNear = (p, x, y, eps = 1e-6) => near(p.x, x, eps) && near(p.y, y, eps);

// A canonical cross-dock building: 600′ long (x) × 250′ deep (y), unrotated, centred at origin.
const B = () => ({ id: "b", type: "building", cx: 0, cy: 0, w: 600, h: 250, rot: 0, dock: "cross" });

describe("rectRing — world corners, rotation baked in", () => {
  it("returns TL,TR,BR,BL for an unrotated box (matches elCorners)", () => {
    const r = rectRing(B());
    expect(r).toHaveLength(4);
    expect(ptNear(r[0], -300, -125)).toBe(true);
    expect(ptNear(r[1], 300, -125)).toBe(true);
    expect(ptNear(r[2], 300, 125)).toBe(true);
    expect(ptNear(r[3], -300, 125)).toBe(true);
  });
  it("bakes rotation in (90° swaps the extents)", () => {
    const r = rectRing({ ...B(), rot: 90 });
    // 90°: local (+x)→(+y). TL(-300,-125)→(125,-300)
    expect(ptNear(r[0], 125, -300)).toBe(true);
  });
});

describe("dockLinesFor — pins the loaded walls", () => {
  it("cross-dock → two parallel lines on the long (top/bottom) walls", () => {
    const dl = dockLinesFor(B());
    expect(dl.map((l) => l.side).sort()).toEqual(["bottom", "top"]);
    const top = dl.find((l) => l.side === "top");
    expect(ptNear(top.p, 0, -125)).toBe(true);      // midpoint of the top wall
    expect(Math.abs(top.d.x)).toBeCloseTo(1, 6);     // runs along x
    expect(Math.abs(top.d.y)).toBeCloseTo(0, 6);
  });
  it("single-dock → one line on the chosen dock side", () => {
    const dl = dockLinesFor({ ...B(), dock: "single", dockSide: "bottom" });
    expect(dl).toHaveLength(1);
    expect(dl[0].side).toBe("bottom");
    expect(ptNear(dl[0].p, 0, 125)).toBe(true);
  });
  it("no-dock → no lines (fully free editing)", () => {
    expect(dockLinesFor({ ...B(), dock: "none" })).toHaveLength(0);
  });
});

describe("convertBuildingToPolygon — the promote patch", () => {
  it("adds points + dockLines + footEdit, leaves cx/cy/w/h/rot for the caller", () => {
    const patch = convertBuildingToPolygon(B());
    expect(patch.footEdit).toBe(true);
    expect(patch.points).toHaveLength(4);
    expect(patch.dockLines).toHaveLength(2);
    expect(patch.cx).toBeUndefined(); // caller keeps the existing box fields
  });
});

describe("distToLine / projectOntoLine — the slide constraint", () => {
  const top = { p: { x: 0, y: -125 }, d: { x: 1, y: 0 } };
  it("distance is the perpendicular offset", () => {
    expect(distToLine(top, { x: 50, y: -125 })).toBeCloseTo(0, 6);
    expect(distToLine(top, { x: 50, y: -100 })).toBeCloseTo(25, 6);
  });
  it("projection drops onto the line (slides along it, keeps it straight)", () => {
    const q = projectOntoLine(top, { x: 200, y: -80 });
    expect(ptNear(q, 200, -125)).toBe(true); // x preserved, y snapped to the wall
  });
});

describe("dockLineAt / dockEdgeLine — classify a vertex / edge", () => {
  const el = { ...B(), ...convertBuildingToPolygon(B()) };
  it("a top corner is ON the top dock line", () => {
    const ln = dockLineAt(el.dockLines, { x: -300, y: -125 });
    expect(ln && ln.side).toBe("top");
  });
  it("an interior/rear point is on no line", () => {
    expect(dockLineAt(el.dockLines, { x: 0, y: 0 })).toBe(null);
  });
  it("the top edge (0→1) is a dock edge; an end wall (1→2) is not", () => {
    expect(dockEdgeLine(el.points, el.dockLines, 0)?.side).toBe("top");   // TL→TR = top wall
    expect(dockEdgeLine(el.points, el.dockLines, 1)).toBe(null);           // TR→BR = right end wall
  });
});

describe("frameBBox — recompute the dock-frame box after a reshape", () => {
  it("an unedited ring reproduces the original box", () => {
    const bb = frameBBox(rectRing(B()), 0);
    expect(near(bb.cx, 0) && near(bb.cy, 0)).toBe(true);
    expect(near(bb.w, 600) && near(bb.h, 250)).toBe(true);
  });
  it("clipping a top corner keeps h (dock spacing) and w (bottom wall) unchanged", () => {
    // slide TR from (300,-125) to (200,-125) along the top wall, then insert a corner is not needed
    const pts = rectRing(B());
    pts[1] = { x: 200, y: -125 };
    const bb = frameBBox(pts, 0);
    expect(near(bb.w, 600)).toBe(true);   // bottom wall still 600
    expect(near(bb.h, 250)).toBe(true);   // dock walls unmoved
  });
  it("works in a rotated frame", () => {
    const el = { ...B(), rot: 30 };
    const bb = frameBBox(rectRing(el), 30);
    expect(near(bb.w, 600, 1e-4) && near(bb.h, 250, 1e-4)).toBe(true);
    expect(near(bb.cx, 0, 1e-4) && near(bb.cy, 0, 1e-4)).toBe(true);
  });
});

describe("translateDockLines / rotateDockLines — carry the walls with the building", () => {
  it("translation moves the line point, keeps the direction", () => {
    const dl = translateDockLines(dockLinesFor(B()), 10, 20);
    const top = dl.find((l) => l.side === "top");
    expect(ptNear(top.p, 10, -105)).toBe(true);
    expect(Math.abs(top.d.x)).toBeCloseTo(1, 6);
  });
  it("rotation about the centre rotates point + direction", () => {
    const dl = rotateDockLines(dockLinesFor(B()), { x: 0, y: 0 }, 90);
    const top = dl.find((l) => l.side === "top");
    // top midpoint (0,-125) rotates 90° → (125,0); direction (1,0) → (0,1)
    expect(ptNear(top.p, 125, 0, 1e-6)).toBe(true);
    expect(near(Math.abs(top.d.y), 1)).toBe(true);
  });
});

describe("dockSegExtent — the true dock-wall span for doors + court trim", () => {
  it("unedited wall spans the full length (0..L)", () => {
    const el = { ...B(), ...convertBuildingToPolygon(B()) };
    const seg = dockSegExtent(el, "top");
    expect(near(seg.startF, 0) && near(seg.endF, 600) && near(seg.L, 600)).toBe(true);
  });
  it("clipping the +x top corner shortens the top wall but not the bottom", () => {
    const el = { ...B(), ...convertBuildingToPolygon(B()) };
    el.points[1] = { x: 200, y: -125 };  // TR slid inward along the top wall
    const top = dockSegExtent(el, "top");
    const bot = dockSegExtent(el, "bottom");
    // top now runs x=-300..200 → offset 0..500 in a bbox still 600 wide
    expect(near(top.startF, 0) && near(top.endF, 500)).toBe(true);
    expect(near(bot.startF, 0) && near(bot.endF, 600)).toBe(true);
  });
});

// The full reshape SEQUENCE the SitePlanner handlers run, at the reducer level (no browser): promote
// → constrained corner drag → release recompute → derived dims + dock-wall repoint. Proves the pure
// pieces compose into the "angle an end wall / clip a corner" use case end-to-end.
describe("reshape pipeline — clip a corner end-to-end", () => {
  const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; } return Math.abs(a) / 2; };

  it("promote → slide a top corner inward along its wall → recompute frame + doors", () => {
    // 1. promote a 600×250 cross-dock building
    let el = { ...B() };
    el = { ...el, ...convertBuildingToPolygon(el) };
    expect(el.footEdit).toBe(true);
    const areaBefore = polyArea(el.points); // 150,000 sf
    expect(areaBefore).toBeCloseTo(150000, 3);

    // 2. grab the top-right corner (index 1, ON the top dock line) and drag it toward the middle.
    //    The handler PROJECTS the free pointer onto the dock line → it stays on the wall (y=-125).
    const grabbed = 1;
    const line = dockLineAt(el.dockLines, el.points[grabbed]);
    expect(line.side).toBe("top");                          // a loaded-wall corner → constrained
    const dropped = projectOntoLine(line, { x: 150, y: 40 }); // pointer wandered off the wall
    expect(ptNear(dropped, 150, -125)).toBe(true);           // snapped back onto the wall
    el = { ...el, points: el.points.map((p, i) => (i === grabbed ? dropped : p)) };

    // 3. release: not self-crossing, recompute the dock-frame box, re-read dims
    const bb = frameBBox(el.points, el.rot || 0);
    el = { ...el, cx: bb.cx, cy: bb.cy, w: bb.w, h: bb.h };
    expect(near(el.h, 250)).toBe(true);                      // dock spacing unchanged (walls stayed straight)
    expect(near(el.w, 600)).toBe(true);                      // bottom wall still 600 → bounding length holds
    const areaAfter = polyArea(el.points);
    expect(areaAfter).toBeLessThan(areaBefore);              // clipped a triangle of floor away
    expect(areaAfter).toBeCloseTo(150000 - 0.5 * 150 * 250, 1); // ½·(300-150)·250 removed

    // 4. the top dock wall shortened; the bottom is untouched — doors repoint to the true wall
    const top = dockSegExtent(el, "top"), bot = dockSegExtent(el, "bottom");
    expect(near(top.endF, 450)).toBe(true);                  // top now x=-300..150 → offset 0..450
    expect(near(bot.endF, 600)).toBe(true);
  });

  it("an end/rear vertex is unconstrained (dockLineAt → null), so an end wall angles freely", () => {
    let el = { ...B(), dock: "single", dockSide: "bottom" };
    el = { ...el, ...convertBuildingToPolygon(el) };
    // single dock on the bottom → the top wall is the free rear wall; its corners are NOT on a dock line
    expect(dockLineAt(el.dockLines, el.points[0])).toBe(null); // TL (rear) — free
    expect(dockLineAt(el.dockLines, el.points[3])?.side).toBe("bottom"); // BL — on the dock wall
  });
});

describe("pointInRing / clipSegmentToRing — grid clipping to the outline", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it("point-in-ring basic", () => {
    expect(pointInRing({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInRing({ x: 15, y: 5 }, square)).toBe(false);
  });
  it("a line fully inside returns itself", () => {
    const out = clipSegmentToRing({ x: 5, y: -5 }, { x: 5, y: 15 }, square);
    expect(out).toHaveLength(1);
    expect(near(out[0].a.y, 0) && near(out[0].b.y, 10)).toBe(true);
  });
  it("clips to the interior span of a triangle (angled wall)", () => {
    // right triangle: the vertical line x=5 crosses the hypotenuse
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const out = clipSegmentToRing({ x: 5, y: -1 }, { x: 5, y: 11 }, tri);
    expect(out).toHaveLength(1);
    expect(near(out[0].a.y, 0)).toBe(true);
    expect(near(out[0].b.y, 5)).toBe(true); // hypotenuse y = 10 - x = 5 at x=5
  });
});
