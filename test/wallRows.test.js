/* Building panel v2 — the per-wall rows, the trailer-row arithmetic and the bump-outs drawn on the wall picker.
 * Pure rules only (lib/wallRows.js, lib/loadingWalls.js, lib/siteGeometry.js trailerStalls). The panel and the
 * canvas are driven for real by e2e/building-panel-v2.spec.js. */
import { describe, it, expect } from "vitest";
import {
  wallRowPlan, chipLabel, bumpSummary, addOptions, removalCount, trailerTotalDepth, trailerRowDepth, trailerSpec, trailerCfg,
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
  it("cross-dock: each dock wall is its OWN row (no linked pair), whatever a legacy dockStacksLinked says", () => {
    for (const flag of [undefined, true, false]) {
      const rows = wallRowPlan(bldg({ dock: "cross", ...(flag === undefined ? {} : { dockStacksLinked: flag }) }));
      expect(rows.map((r) => r.role)).toEqual(["dock", "dock", "ends", "ends"]);
      expect(rows.every((r) => r.sides.length === 1)).toBe(true);
      expect(new Set(rows.flatMap((r) => r.sides)).size).toBe(4);
      expect(rows.slice(0, 2).map((r) => r.sides[0]).sort()).toEqual(["bottom", "top"]);
      expect(rows[0].badge).not.toContain("·");
      expect(rows.some((r) => "pair" in r || "linked" in r)).toBe(false);
    }
  });
  it("no docks: four separate `sides` rows (the two long walls are never linked either)", () => {
    const rows = wallRowPlan(bldg({ dock: "none" }));
    expect(rows.map((r) => r.role)).toEqual(["sides", "sides", "sides", "sides"]);
    expect(rows.every((r) => r.sides.length === 1)).toBe(true);
  });
  it("badges are the compass letter(s) of the wall at the building's rotation (315° → dock walls read NW / SE)", () => {
    const rows = wallRowPlan(bldg({ dock: "cross", rot: 315 }));
    expect(rows.slice(0, 2).map((r) => r.badge).sort()).toEqual(["NW", "SE"]);
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
    expect(bumpSummary(0, 55, 60)).toBe("Bump-outs none");
    expect(bumpSummary(3, 55.4, 30)).toBe("Bump-outs 3 · 55 × 30 ft");
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
  it("v3: Remove takes ONLY the piece, on a dock wall as on any other (the court's trailer is planDockPieceRemoval's)", () => {
    expect(removalCount(true, [{ kind: "court" }, { kind: "trailer" }, { kind: "buffer" }], 0)).toBe(1);
    expect(removalCount(false, [], 0)).toBe(1);
  });
  it("a dock wall whose court was binned still offers the court back (at the head) plus buffer / walk / road — never a trailer", () => {
    expect(keys(true, ["buffer", "sidewalk"])).toEqual(["court", "buffer", "sidewalk", "road"]);
    expect(keys(true, ["buffer", "road"])).toEqual(["court"]);                        // a Road is terminal, but the court goes inboard of it
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

/* ------------------------------------------------------------------ Building panel v3 */
import {
  trailerTotalDepthOf, storedRowDepths, trailerPatchRows, trailerPatchRowDepth, trailerPatchAisle, applyZonePatch,
  pieceLabel, pieceTooltip, pieceShowsIcon, stripPlan, legendKinds, STRIP, wallTotalDepth,
  planDockPieceRemoval, applyDockPieceRemoval,
} from "../src/workspaces/site-planner/lib/wallRows.js";

describe("v3 · trailer parking — each row can have its own depth", () => {
  it("total = Σ row depths + ⌊rows / 2⌋ × aisle, with mixed depths at 2, 3 and 4 rows", () => {
    expect(trailerTotalDepthOf([60, 55], 60)).toBe(175);
    expect(trailerTotalDepthOf([60, 55, 50], 60)).toBe(225);              // one aisle for the first facing pair
    expect(trailerTotalDepthOf([60, 55, 50, 45], 60)).toBe(330);          // two aisles
    expect(trailerTotalDepthOf([60], 60)).toBe(60);
    // uniform depths agree with today's formula
    for (const r of [1, 2, 3, 4]) expect(trailerTotalDepthOf(Array(r).fill(53), 45)).toBe(trailerTotalDepth(r, 53, 45));
  });
  it("a zone with no trailerRowDepths is exactly today's single-depth zone (old plans load unchanged)", () => {
    const z = { zd: 160, trailerRows: 2, trailerAisleFt: 60 };
    expect(storedRowDepths(z, 2)).toBeNull();
    expect(trailerSpec(z, 60)).toMatchObject({ rows: 2, rowDepth: 50, rowDepths: [50, 50], total: 160, custom: false });
    expect(trailerCfg({ trailerW: 12 }, trailerSpec(z, 60), 12)).toEqual({ trailerW: 12, trailerL: 50, trailerAisle: 60, single: false });
  });
  it("trailerRowDepths drives the spec: row 1 nearest the court, total from the depths (zd is not consulted)", () => {
    const z = { zd: 999, trailerRows: 2, trailerAisleFt: 60, trailerRowDepths: [60, 55] };
    expect(trailerSpec(z, 60)).toMatchObject({ rows: 2, rowDepth: 60, rowDepths: [60, 55], total: 175, custom: true });
    expect(trailerCfg(null, trailerSpec(z, 60), 12, "bottom")).toMatchObject({ trailerL: 60, trailerAisle: 60, single: false, trailerRowDepths: [60, 55] });
    expect(storedRowDepths({ trailerRowDepths: [60] }, 3)).toEqual([60, 60, 60]);    // padded with the last
    expect(storedRowDepths({ trailerRowDepths: [60, 55, 50] }, 2)).toEqual([60, 55]); // truncated
    expect(storedRowDepths({ trailerRowDepths: [60, "x"] }, 2)).toBeNull();
    expect(storedRowDepths({ trailerRowDepths: [60, 3] }, 2)).toEqual([60, 8]);       // never below the stall minimum
  });
  it("typing one row's depth stores the array and the new total; typing them all alike returns to the single-depth form", () => {
    const base = { zd: 160, trailerRows: 2, trailerAisleFt: 60 };
    const p = trailerPatchRowDepth(base, 1, 55, 60);
    expect(p).toEqual({ trailerRows: 2, trailerAisleFt: 60, trailerRowDepths: [50, 55], zd: 165 });
    const z = applyZonePatch(base, trailerPatchRowDepth(base, 0, 60, 60));
    expect(z.trailerRowDepths).toEqual([60, 50]);
    expect(z.zd).toBe(170);
    const back = trailerPatchRowDepth(z, 1, 60, 60);
    expect(back.trailerRowDepths).toBeUndefined();
    expect(applyZonePatch(z, back)).not.toHaveProperty("trailerRowDepths");
    expect(back.zd).toBe(180);                                             // 2 × 60 + 60
  });
  it("adding a row copies the last row's depth; removing drops the last; the aisle edit keeps the depths", () => {
    const z = { zd: 175, trailerRows: 2, trailerAisleFt: 60, trailerRowDepths: [60, 55] };
    expect(trailerPatchRows(z, 3, 60)).toEqual({ trailerRows: 3, trailerAisleFt: 60, trailerRowDepths: [60, 55, 55], zd: 230 });
    expect(trailerPatchRows(z, 1, 60)).toMatchObject({ trailerRows: 1, trailerRowDepths: [60], zd: 60 });
    expect(trailerPatchAisle(z, 40, 60)).toEqual({ trailerAisleFt: 40, zd: 155 });
    const four = { trailerRows: 4, trailerAisleFt: 60, trailerRowDepths: [60, 55, 50, 45] };
    expect(trailerPatchAisle(four, 50, 60).zd).toBe(210 + 100);
    // uniform zones keep today's behaviour
    expect(trailerPatchRows({ zd: 50 }, 2, 60)).toEqual({ trailerRows: 2, trailerAisleFt: 60, trailerRowDepths: undefined, zd: 160 });
    expect(zdAfterRowChange({ zd: 160, trailerRows: 2, trailerAisleFt: 60 }, 3, 60)).toBe(210);
  });
  it("a 2-row zone of 60 / 55 draws two bands of those depths with the aisle between, flush against the court — on every wall", () => {
    const z = { zd: 175, trailerRows: 2, trailerAisleFt: 60, trailerRowDepths: [60, 55] };
    for (const side of ["bottom", "left", "top", "right"]) {
      const sp = trailerSpec(z, 60);
      const out = trailerStalls(600, sp.total, trailerCfg(null, sp, 12, side));
      expect(out.bands.map((b) => b.depth).sort((a, b) => b - a)).toEqual([60, 55]);
      expect(out.aisles.length).toBe(1);
      expect(out.count).toBe(2 * Math.floor(600 / 12));                    // stall count per band is independent of depth
      // the court is at local y = 0 on bottom / left walls and at y = total on top / right walls
      const nearCourt = (side === "top" || side === "right") ? out.bands.reduce((m, b) => (b.y > m.y ? b : m)) : out.bands[0];
      expect(nearCourt.depth).toBe(60);
      expect(side === "top" || side === "right" ? nearCourt.y + nearCourt.depth : nearCourt.y).toBe(side === "top" || side === "right" ? sp.total : 0);
      const all = [...out.bands.map((b) => [b.y, b.y + b.depth]), ...out.aisles.map((a) => [a.y0, a.y1])].sort((a, b) => a[0] - b[0]);
      expect(all[0][0]).toBe(0);                                          // no gap, no overlap: end to end
      for (let i = 1; i < all.length; i++) expect(all[i][0]).toBeCloseTo(all[i - 1][1], 9);
      expect(all[all.length - 1][1]).toBe(sp.total);
    }
  });
  it("3 and 4 rows of mixed depth: bands in order, an aisle after each facing pair only", () => {
    for (const depths of [[60, 55, 50], [60, 55, 50, 45]]) {
      const z = { trailerRows: depths.length, trailerAisleFt: 40, trailerRowDepths: depths };
      const sp = trailerSpec(z, 60);
      const out = trailerStalls(480, sp.total, trailerCfg(null, sp, 12, "bottom"));
      expect(out.bands.map((b) => b.depth)).toEqual(depths);
      expect(out.aisles.length).toBe(Math.floor(depths.length / 2));
      expect(out.count).toBe(depths.length * 40);
      const last = out.bands[out.bands.length - 1];
      expect(last.y + last.depth).toBeCloseTo(sp.total, 9);
      expect(out.bands[1].y).toBeCloseTo(60 + 40, 9);                     // row 2 starts after row 1 and the first aisle
    }
  });
  it("a zone too shallow for the last row simply draws fewer bands (never overruns)", () => {
    const out = trailerStalls(480, 120, { trailerW: 12, trailerL: 60, trailerAisle: 60, trailerRowDepths: [60, 55] });
    expect(out.bands.length).toBe(1);
    expect(out.aisles.length).toBe(0);
  });
});

describe("v3 · the strip — labels, scale, legend", () => {
  const L = (kind, depth, rows) => ({ kind, depth, rows });
  it("piece labels and tooltips", () => {
    expect(pieceLabel(L("court", 135))).toBe("135′");
    expect(pieceLabel(L("trailer", 175, 2))).toBe("×2");
    expect(pieceLabel(L("trailer", 50, 1))).toBe("50′");
    expect(pieceLabel(L("parking", 192, 8))).toBe("×8");
    expect(pieceTooltip(L("court", 135), 339)).toBe("Truck court 135′ · wall total 339′");
    expect(pieceTooltip(L("trailer", 175, 2), 339)).toBe("Trailer parking ×2 (175′) · wall total 339′");
    expect(pieceTooltip(L("sidewalk", 5), 339)).toBe("Sidewalk 5′ · wall total 339′");
  });
  it("an icon appears when the piece is at least 16 + 6 × label length wide", () => {
    expect(pieceShowsIcon(16 + 6 * 4, "135′")).toBe(true);
    expect(pieceShowsIcon(16 + 6 * 4 - 0.1, "135′")).toBe(false);
    expect(pieceShowsIcon(40, "×2")).toBe(true);
  });
  it("one scale for the whole building: the deepest wall is full width, a shallow one never under the floor, pieces never under the minimum", () => {
    const rows = [
      { key: "dock", layers: [L("court", 135), L("trailer", 123, 2), L("buffer", 15), L("sidewalk", 5), L("road", 24)] },   // 302
      { key: "rear", layers: [L("sidewalk", 5), L("parking", 100, 4)] },                                                   // 105
      { key: "endA", layers: [L("buffer", 15)] },                                                                            // 15
      { key: "endB", layers: [] },
    ];
    const plan = stripPlan(rows);
    expect(plan.maxTotal).toBe(302);
    expect(plan.rows.dock.barW).toBe(STRIP.FULL);
    expect(plan.rows.rear.barW).toBeCloseTo(STRIP.FULL * 105 / 302, 1);
    expect(plan.rows.endA.barW).toBe(STRIP.FLOOR);                       // shallow, but still clickable
    expect(plan.rows.endB).toEqual({ total: 0, barW: 0, pieces: [] });  // empty wall: just the +
    for (const key of ["dock", "rear", "endA"]) {
      const r = plan.rows[key];
      r.pieces.forEach((p) => expect(p.w).toBeGreaterThanOrEqual(STRIP.MIN_PIECE - 1e-9));
      // pieces + the 1-px gaps fill the bar exactly
      const used = r.pieces.reduce((t, p) => t + p.w, 0) + (r.pieces.length - 1) * STRIP.GAP;
      expect(used).toBeCloseTo(r.barW, 1);
    }
    // wider layer ⇒ wider piece when nothing is clamped
    const dock = plan.rows.dock.pieces;
    expect(dock[0].w).toBeGreaterThan(dock[1].w);
    expect(dock[1].w).toBeGreaterThan(dock[2].w);
  });
  it("a wall with many thin layers grows its bar rather than squeezing a piece under the minimum", () => {
    const r = stripPlan([{ key: "w", layers: [L("court", 400), L("trailer", 5, 1), L("buffer", 5), L("sidewalk", 5), L("road", 5)] }]).rows.w;
    r.pieces.forEach((p) => expect(p.w).toBeGreaterThanOrEqual(STRIP.MIN_PIECE - 1e-9));
    expect(r.barW).toBeLessThanOrEqual(STRIP.FULL);
  });
  it("the legend lists only the kinds present, in Court · Trailer · Buffer · Walk · Parking · Road order", () => {
    const rows = [{ layers: [L("road", 24), L("court", 135)] }, { layers: [L("sidewalk", 5), L("parking", 20, 1)] }];
    expect(legendKinds(rows)).toEqual([
      { kind: "court", name: "Court" }, { kind: "sidewalk", name: "Walk" }, { kind: "parking", name: "Parking" }, { kind: "road", name: "Road" },
    ]);
    expect(legendKinds([{ layers: [] }])).toEqual([]);
    expect(wallTotalDepth([L("court", 135), L("buffer", 15)])).toBe(150);
  });
});

describe("v3 · removing ONE piece — everything outside keeps its depth and moves in", () => {
  const court = { id: "c", truckCourt: { side: "bottom" }, type: "paving", zd: 135 };
  const trailer = { id: "t", type: "trailer", forCourt: "c", prevZone: "c", noFit: true, zd: 123 };
  const buffer = { id: "b", type: "landscape", buffer: true, forTrailer: "t", prevZone: "t", noFit: true, zd: 15 };
  const walk = { id: "w", type: "sidewalk", prevZone: "b", stackSide: "bottom", noFit: true, zd: 5 };
  const road = { id: "r", type: "road", prevZone: "w", stackSide: "bottom", noFit: true, zd: 28, travelW: 24 };
  const chain = [court, trailer, buffer, walk, road];
  const els = [{ id: "bldg", type: "building" }, ...chain];

  it("binning the trailer takes only the trailer; the buffer re-bonds to the court and keeps 15′, walk and road follow", () => {
    const plan = planDockPieceRemoval(chain, 1, "bottom");
    expect(plan.removeIds).toEqual(["t"]);
    expect(plan.patches).toEqual([{ id: "b", set: { prevZone: "c" }, drop: ["forTrailer"] }]);
    const next = applyDockPieceRemoval(els, plan);
    expect(next.map((x) => x.id)).toEqual(["bldg", "c", "b", "w", "r"]);
    const b = next.find((x) => x.id === "b");
    expect(b).toMatchObject({ prevZone: "c", zd: 15 });
    expect(b).not.toHaveProperty("forTrailer");
    expect(next.find((x) => x.id === "w").zd).toBe(5);                    // depths untouched: the relayout closes the gap
    expect(next.find((x) => x.id === "r").zd).toBe(28);
  });
  it("binning a buffer in the middle re-bonds the next layer to what is inboard of it", () => {
    const plan = planDockPieceRemoval(chain, 2, "bottom");
    expect(plan.removeIds).toEqual(["b"]);
    expect(plan.patches).toEqual([{ id: "w", set: { prevZone: "t" }, drop: [] }]);
  });
  it("binning the outermost piece re-bonds nothing", () => {
    expect(planDockPieceRemoval(chain, 4, "bottom")).toEqual({ removeIds: ["r"], patches: [], court: false });
  });
  it("binning the court takes its trailer parking (the bond forces it) and nothing else; the buffer becomes the head, stamped with its wall", () => {
    const plan = planDockPieceRemoval(chain, 0, "bottom");
    expect(plan.court).toBe(true);
    expect([...plan.removeIds].sort()).toEqual(["c", "t"]);
    expect(plan.patches).toEqual([{ id: "b", set: { prevZone: null, stackSide: "bottom" }, drop: ["forTrailer"] }]);
    const next = applyDockPieceRemoval(els, plan);
    expect(next.map((x) => x.id)).toEqual(["bldg", "b", "w", "r"]);
    expect(next.find((x) => x.id === "b")).toMatchObject({ prevZone: null, stackSide: "bottom", zd: 15 });
    // nothing is left bonded to a removed element (no dangling bond for the load-time heal to report)
    const ids = new Set(next.map((x) => x.id));
    next.forEach((x) => ["forCourt", "forTrailer", "prevZone"].forEach((k) => { if (x[k]) expect(ids.has(x[k])).toBe(true); }));
  });
  it("a legacy chain (forCourt / forTrailer bonds, no prevZone) is re-bonded the same way", () => {
    const lt = { id: "t", type: "trailer", forCourt: "c", noFit: true, zd: 50 };
    const lb = { id: "b", type: "landscape", forTrailer: "t", noFit: true, zd: 15 };
    const plan = planDockPieceRemoval([court, lt, lb], 1, "bottom");
    expect(plan.removeIds).toEqual(["t"]);
    expect(plan.patches).toEqual([{ id: "b", set: { prevZone: "c" }, drop: ["forTrailer"] }]);
  });
  it("an index outside the chain is a no-op plan", () => {
    expect(planDockPieceRemoval(chain, 9, "bottom")).toBeNull();
    expect(applyDockPieceRemoval(els, null)).toBe(els);
  });
});
