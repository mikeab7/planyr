/* Building panel v2 — the per-wall rows, the trailer-row arithmetic and the bump-outs drawn on the wall picker.
 * Pure rules only (lib/wallRows.js, lib/loadingWalls.js, lib/siteGeometry.js trailerStalls). The panel and the
 * canvas are driven for real by e2e/building-panel-v2.spec.js. */
import { describe, it, expect } from "vitest";
import {
  wallRowPlan, dockLinked, chipLabel, bumpChipLabel, addOptions, removalCount, trailerTotalDepth, trailerRowDepth, trailerSpec, trailerCfg,
  zdAfterRowChange, zdAfterRowDepth, zdAfterAisle, clampTrailerRows, bumpEndLabel, bumpEnds, areaWithBumps, TRAILER_MAX_ROWS,
} from "../src/workspaces/site-planner/lib/wallRows.js";
import { wallPickerLayout } from "../src/workspaces/site-planner/lib/loadingWalls.js";
import { trailerStalls } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const bldg = (o = {}) => ({ type: "building", cx: 0, cy: 0, w: 400, h: 150, rot: 0, dock: "single", dockAxis: "x", dockSide: "bottom", ...o });

describe("wall rows — which rows exist, in what order", () => {
  it("single-load: dock · rear · ends · ends — the rear is NEVER grouped with an end", () => {
    const rows = wallRowPlan(bldg());
    expect(rows.map((r) => r.role)).toEqual(["dock", "rear", "ends", "ends"]);
    expect(rows[0].sides).toEqual(["bottom"]);
    expect(rows[1].sides).toEqual(["top"]);
    expect(rows.slice(2).map((r) => r.sides.length)).toEqual([1, 1]);
    expect(new Set(rows.flatMap((r) => r.sides)).size).toBe(4);
  });
  it("cross-dock is ONE linked row by default (absent flag = linked) and two rows once split; the ends are never linkable", () => {
    const linked = wallRowPlan(bldg({ dock: "cross" }));
    expect(linked.map((r) => r.role)).toEqual(["dock", "ends", "ends"]);
    expect(linked[0]).toMatchObject({ pair: true, linked: true, sides: ["top", "bottom"] });
    expect(linked[0].badge).toContain("·");
    expect(dockLinked(bldg({ dock: "cross" }))).toBe(true);
    const split = wallRowPlan(bldg({ dock: "cross", dockStacksLinked: false }));
    expect(split.map((r) => r.role)).toEqual(["dock", "dock", "ends", "ends"]);
    expect(split.slice(0, 2).every((r) => r.pair && !r.linked && r.sides.length === 1)).toBe(true);
    expect(split.slice(2).every((r) => !r.pair)).toBe(true);
  });
  it("no docks: four separate `sides` rows (the two long walls are never linked either)", () => {
    const rows = wallRowPlan(bldg({ dock: "none" }));
    expect(rows.map((r) => r.role)).toEqual(["sides", "sides", "sides", "sides"]);
    expect(rows.every((r) => r.sides.length === 1 && !r.pair)).toBe(true);
  });
  it("badges are the compass letter(s) of the wall at the building's rotation (315° → dock walls read NW / SE)", () => {
    const rows = wallRowPlan(bldg({ dock: "cross", rot: 315 }));
    expect(rows[0].badge.split("·").sort()).toEqual(["NW", "SE"]);
    const single = wallRowPlan(bldg({ rot: 315 }));
    expect(single[0].badge).toBe("SE");        // dock bottom wall faces 180° + 315° = 135°
    expect(single[1].badge).toBe("NW");        // the rear is the opposite wall
  });
});

describe("chips and the + catalog", () => {
  it("chip text", () => {
    expect(chipLabel({ kind: "court", depth: 135 })).toBe("Court 135′");
    expect(chipLabel({ kind: "trailer", depth: 50, rows: 1 })).toBe("Trailer 50′");
    expect(chipLabel({ kind: "trailer", depth: 160, rows: 2 })).toBe("Trailer ×2");
    expect(chipLabel({ kind: "buffer", depth: 15 })).toBe("Buffer 15′");
    expect(chipLabel({ kind: "sidewalk", depth: 5 })).toBe("Walk 5′");
    expect(chipLabel({ kind: "parking", rows: 8 })).toBe("Parking 8 rows");
    expect(chipLabel({ kind: "parking", rows: 1 })).toBe("Parking 1 row");
    expect(chipLabel({ kind: "road", depth: 24 })).toBe("Road 24′");
    expect(bumpChipLabel(0)).toBe("Bump-outs none");
    expect(bumpChipLabel(3)).toBe("Bump-outs 3");
  });
  const keys = (isDock, kinds) => addOptions(isDock, kinds.map((kind) => ({ kind }))).map((o) => o.key);
  it("a dock wall offers a court only when it has none, a trailer only when none, and nothing after a road", () => {
    expect(keys(true, [])).toEqual(["court"]);
    expect(keys(true, ["court"])).toEqual(["trailer", "buffer", "sidewalk", "road"]);
    expect(keys(true, ["court", "trailer"])).toEqual(["buffer", "sidewalk", "road"]);
    expect(keys(true, ["court", "trailer", "road"])).toEqual([]);
  });
  it("any other wall offers sidewalk / car parking only when it has none, plus buffer and road; nothing after a road", () => {
    expect(keys(false, [])).toEqual(["sidewalk", "parking", "buffer", "road"]);
    expect(keys(false, ["sidewalk"])).toEqual(["parking", "buffer", "road"]);
    expect(keys(false, ["sidewalk", "parking"])).toEqual(["buffer", "road"]);
    expect(keys(false, ["buffer"])).toEqual(["sidewalk", "buffer", "road"]);          // parking sits beyond the sidewalk: not behind a buffer
    expect(keys(false, ["sidewalk", "road"])).toEqual([]);
  });
  it("Remove takes the layer AND everything outside it on a dock wall; just the layer elsewhere", () => {
    const stack = [{ kind: "court" }, { kind: "trailer" }, { kind: "buffer" }];
    expect(removalCount(true, stack, 0)).toBe(3);
    expect(removalCount(true, stack, 1)).toBe(2);
    expect(removalCount(true, stack, 2)).toBe(1);
    expect(removalCount(false, stack, 0)).toBe(1);
  });
});

describe("trailer parking rows — depth = rows × row + ⌊rows / 2⌋ × aisle, exactly what trailerStalls draws", () => {
  it("the depth math, both directions", () => {
    expect(trailerTotalDepth(1, 50, 60)).toBe(50);
    expect(trailerTotalDepth(2, 50, 60)).toBe(160);
    expect(trailerTotalDepth(3, 50, 60)).toBe(210);
    expect(trailerTotalDepth(4, 50, 60)).toBe(320);
    for (const rows of [1, 2, 3, 4]) expect(trailerRowDepth(trailerTotalDepth(rows, 53, 45), rows, 45)).toBeCloseTo(53, 9);
    expect(clampTrailerRows(0)).toBe(1);
    expect(clampTrailerRows(9)).toBe(TRAILER_MAX_ROWS);
  });
  it("one row is the old flush strip, byte for byte (cfg single, no aisle, trailerL = the zone depth)", () => {
    const sp = trailerSpec({ zd: 50 }, 60);
    expect(sp).toMatchObject({ rows: 1, rowDepth: 50, total: 50 });
    expect(trailerCfg({ trailerW: 12 }, sp, 12)).toEqual({ trailerW: 12, trailerL: 50, trailerAisle: 0, single: true });
    expect(trailerSpec({ zd: 7 }, 60).rowDepth).toBe(7);          // a typed shallow depth is never second-guessed
  });
  it("editing rows / row depth / aisle keeps the others and stores the total", () => {
    const z = { zd: 50 };
    expect(zdAfterRowChange(z, 2, 60)).toBe(160);                      // holds ONE row's depth, adds a row + the aisle
    const z2 = { zd: 160, trailerRows: 2, trailerAisleFt: 60 };
    expect(zdAfterRowChange(z2, 1, 60)).toBe(50);
    expect(zdAfterRowDepth(z2, 53, 60)).toBe(166);
    expect(zdAfterAisle(z2, 50, 60)).toBe(150);
    expect(trailerSpec(z2, 60)).toMatchObject({ rows: 2, aisle: 60, rowDepth: 50, total: 160 });
    expect(trailerSpec({ zd: 160, trailerRows: 2 }, 45).aisle).toBe(45);   // the plan's trailer aisle is the default
  });
  it("a 2-row zone renders two stall bands with the aisle between them, filling the zone flush end to end", () => {
    const sp = trailerSpec({ zd: 160, trailerRows: 2, trailerAisleFt: 60 }, 60);
    const cfg = trailerCfg(null, sp, 12);
    const out = trailerStalls(600, sp.total, cfg);
    expect(out.bands.length).toBe(2);
    expect(out.aisles.length).toBe(1);
    expect(out.bands[0].y).toBe(0);                                         // flush against the zone's inner edge
    expect(out.bands[0].depth).toBe(50);
    expect(out.aisles[0]).toEqual({ y0: 50, y1: 110 });                     // the aisle sits between the rows
    expect(out.bands[1].y).toBe(110);
    expect(out.bands[1].y + out.bands[1].depth).toBe(sp.total);            // …and the second band ends exactly at the zone's far edge
    expect(out.count).toBe(2 * Math.floor(600 / 12));
  });
  it("3 and 4 rows follow the same band/aisle pattern", () => {
    for (const rows of [3, 4]) {
      const sp = trailerSpec({ zd: trailerTotalDepth(rows, 50, 60), trailerRows: rows, trailerAisleFt: 60 }, 60);
      const out = trailerStalls(480, sp.total, trailerCfg(null, sp, 12));
      expect(out.bands.length).toBe(rows);
      expect(out.count).toBe(rows * 40);
      expect(out.bands[rows - 1].y + out.bands[rows - 1].depth).toBe(sp.total);
    }
  });
});

describe("bump-outs — corner names and area", () => {
  it("each end of a dock wall is named by its compass letter at the building's rotation", () => {
    expect(bumpEnds("bottom", 0).map((e) => e.label)).toEqual(["W", "E"]);
    expect(bumpEnds("top", 0).map((e) => e.label)).toEqual(["W", "E"]);
    expect(bumpEnds("left", 0).map((e) => e.label)).toEqual(["N", "S"]);
    expect(bumpEndLabel("bottom", 1, 315)).toBe("NE");
    expect(bumpEndLabel("bottom", -1, 315)).toBe("SW");
  });
  it("the header SF is the footprint plus every bump-out box", () => {
    expect(areaWithBumps(60000, [{ w: 55, h: 60 }, { w: 70, h: 60 }])).toEqual({ footprint: 60000, extra: 55 * 60 + 70 * 60, total: 60000 + 55 * 60 + 70 * 60 });
    expect(areaWithBumps(60000, [])).toEqual({ footprint: 60000, extra: 0, total: 60000 });
  });
});

describe("the wall picker draws the building to scale with its bump-outs from the real geometry", () => {
  const sq = (poly) => { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  it("the rectangle keeps the Length × Depth aspect", () => {
    const L = wallPickerLayout(bldg({ w: 400, h: 200, dock: "none" }));
    const r = sq(L.corners);
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });
  it("a bump-out sits at the END of its dock wall, projecting OUT past the dock face, at the stored along × proj", () => {
    const b = bldg({ w: 400, h: 200 });
    const L = wallPickerLayout(b, { bumps: [{ id: "d1", side: "bottom", sign: 1, along: 70, proj: 60 }] });
    const d = L.bumps.find((x) => x.existing && x.side === "bottom" && x.sign === 1);
    const box = sq(d.poly);
    expect(box.w / box.h).toBeCloseTo(70 / 60, 4);                           // along : out, at the picker's own scale
    expect(box.w).toBeCloseTo(70 * L.k, 4);
    const rectMaxY = Math.max(...L.corners.map((p) => p[1])), rectMaxX = Math.max(...L.corners.map((p) => p[0]));
    expect(Math.max(...d.poly.map((p) => p[1]))).toBeCloseTo(rectMaxY + 60 * L.k, 4);   // out past the bottom (dock) face
    expect(Math.max(...d.poly.map((p) => p[0]))).toBeCloseTo(rectMaxX, 4);              // flush with the +x end of the wall
    expect(Math.min(...d.poly.map((p) => p[1]))).toBeCloseTo(rectMaxY, 4);              // starting at the face, not inside the building
  });
  it("each LOADED wall's empty corners get a dashed footprint; an existing bump-out replaces its dashed square", () => {
    const b = bldg({ dock: "cross" });
    expect(wallPickerLayout(b).bumps.filter((x) => !x.existing).length).toBe(4);
    const L = wallPickerLayout(b, { bumps: [{ id: "d1", side: "bottom", sign: -1 }] });
    expect(L.bumps.filter((x) => !x.existing).length).toBe(3);
    expect(L.bumps.find((x) => x.existing).id).toBe("d1");
    expect(wallPickerLayout(bldg({ dock: "none" })).bumps.length).toBe(0);              // nothing loaded, nothing to add a bump-out to
  });
  it("the dock line runs only along the CLEAR face: it ends exactly at a bump-out's edge, never inside it", () => {
    const b = bldg({ w: 400, h: 200 });
    const bare = wallPickerLayout(b).walls.find((w) => w.side === "bottom");
    const L = wallPickerLayout(b, { bumps: [{ id: "d1", side: "bottom", sign: 1, along: 100, proj: 60 }] });
    const w = L.walls.find((x) => x.side === "bottom");
    const len = (a) => Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    expect(len(w.clear)).toBeCloseTo(len({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }) - 100 * L.k, 4);
    expect(len(bare.clear)).toBeCloseTo(len(bare), 4);                                    // no bump-out: the whole wall
    const d = L.bumps.find((x) => x.existing);
    const edgeX = Math.min(...d.poly.map((p) => p[0]));                                   // the bump-out's inner edge along the wall
    expect(Math.max(w.clear.x1, w.clear.x2)).toBeCloseTo(edgeX, 4);
  });
  it("everything — rectangle, bump-outs, labels — stays inside the box at every rotation", () => {
    for (let rot = 0; rot < 360; rot += 15) {
      const b = bldg({ rot, dock: "cross" });
      const L = wallPickerLayout(b, { bumps: [{ id: "a", side: "top", sign: -1, along: 55, proj: 60 }, { id: "b", side: "bottom", sign: 1, along: 55, proj: 60 }] });
      for (const [x, y] of [...L.corners, ...L.bumps.flatMap((d) => d.poly)]) {
        expect(x).toBeGreaterThanOrEqual(1.99); expect(x).toBeLessThanOrEqual(L.width - 1.99);
        expect(y).toBeGreaterThanOrEqual(1.99); expect(y).toBeLessThanOrEqual(L.height - 1.99);
      }
    }
  });
  it("a label is moved clear of a bump-out that leaves too little bare wall (rot 0: the label sits past the bump-out's outer edge)", () => {
    const b = bldg({ w: 90, h: 90, dock: "single" });
    const tight = wallPickerLayout(b, { bumps: [{ id: "a", side: "bottom", sign: -1, along: 45, proj: 60 }, { id: "b", side: "bottom", sign: 1, along: 45, proj: 60 }] });
    const outerY = Math.max(...tight.bumps.filter((x) => x.side === "bottom").flatMap((x) => x.poly.map((p) => p[1])));
    expect(tight.walls.find((w) => w.side === "bottom").ly).toBeGreaterThan(outerY);
    const roomy = wallPickerLayout(bldg({ w: 400, h: 150 }), { bumps: [{ id: "a", side: "bottom", sign: -1, along: 55, proj: 60 }] });
    const roomyOuter = Math.max(...roomy.bumps.filter((x) => x.side === "bottom").flatMap((x) => x.poly.map((p) => p[1])));
    expect(roomy.walls.find((w) => w.side === "bottom").ly).toBeLessThan(roomyOuter);   // bare wall in the middle: the label stays beside the wall
  });
});
