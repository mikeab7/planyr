/* NEW-4 — the Building panel's Loading wall picker (lib/loadingWalls.js).
 *
 * Red-proof notes: the compass table is asserted against the owner's own adversarial cases
 * (rot 0 / 45 / 90 / 135 / 315, single and cross), the click table covers every state × every
 * wall (and asserts no click can ever leave an L), and the layout test sweeps every rotation and
 * several aspect ratios to prove no label can sit on the rectangle or off the little plan. */
import { describe, it, expect } from "vitest";
import {
  WALLS, OPPOSITE_WALL, loadingTypeLabel, loadedWallsLabel, loadedWallCompass, loadingSummary,
  wallClickPatch, withLoadingPatch, wallClickTitle, strandedBumpIds, bumpOutCap, wallPickerLayout,
} from "../src/workspaces/site-planner/lib/loadingWalls.js";
import { dockSidesFor, dockSideCompassLabel } from "../src/workspaces/site-planner/lib/dockZones.js";

const bldg = (o = {}) => ({ id: "b1", type: "building", w: 520, h: 210, rot: 0, dock: "cross", dockAxis: "x", ...o });
const sides = (b) => dockSidesFor(b).dockSides;

describe("compass labels follow the rotation", () => {
  const topBottom = (rot) => WALLS.filter((s) => s === "top" || s === "bottom").map((s) => dockSideCompassLabel(s, rot));
  const leftRight = (rot) => ["left", "right"].map((s) => dockSideCompassLabel(s, rot));
  it("rot 0 → N/S", () => expect(topBottom(0)).toEqual(["N", "S"]));
  it("rot 45 → NE/SW", () => expect(topBottom(45)).toEqual(["NE", "SW"]));
  it("rot 90 → E/W, and the end walls read N/S", () => {
    expect(topBottom(90)).toEqual(["E", "W"]);
    expect(leftRight(90)).toEqual(["N", "S"]);
  });
  it("rot 315 → NW/SE", () => expect(topBottom(315)).toEqual(["NW", "SE"]));
  it("rot 135 → SE/NW", () => expect(topBottom(135)).toEqual(["SE", "NW"]));

  it("single-load on the bottom wall at rot 315 → 'SE wall'", () => {
    const b = bldg({ dock: "single", dockSide: "bottom", rot: 315 });
    expect(loadedWallsLabel(b)).toBe("SE wall");
    expect(loadingTypeLabel(b)).toBe("Single-load");
    expect(loadingSummary(b)).toBe("Single-load SE");
  });
  it("cross on left/right at rot 90 → 'N & S walls'", () => {
    const b = bldg({ dockAxis: "y", rot: 90 });
    expect(sides(b)).toEqual(["left", "right"]);
    expect(loadedWallsLabel(b)).toBe("N & S walls");
    expect(loadingSummary(b)).toBe("Cross-dock N/S");
  });
  it("no docks → no walls text", () => {
    const b = bldg({ dock: "none" });
    expect(loadedWallsLabel(b)).toBe("");
    expect(loadedWallCompass(b)).toEqual([]);
    expect(loadingSummary(b)).toBe("No docks");
  });
});

describe("clicking a wall", () => {
  const after = (b, side) => withLoadingPatch(b, wallClickPatch(b, side));
  const isOpposite = (s) => s.length === 2 && OPPOSITE_WALL[s[0]] === s[1];

  it("cross: clicking a loaded wall unloads it → single on the OTHER wall", () => {
    const b = bldg();
    const a = after(b, "top");
    expect(a.dock).toBe("single");
    expect(sides(a)).toEqual(["bottom"]);
    expect(sides(after(b, "bottom"))).toEqual(["top"]);
  });
  it("single: clicking the loaded wall unloads it → none", () => {
    const b = bldg({ dock: "single", dockSide: "bottom" });
    expect(sides(after(b, "bottom"))).toEqual([]);
    expect(after(b, "bottom").dock).toBe("none");
  });
  it("single: clicking the unloaded OPPOSITE wall makes it cross", () => {
    const b = bldg({ dock: "single", dockSide: "bottom" });
    const a = after(b, "top");
    expect(a.dock).toBe("cross");
    expect(sides(a)).toEqual(["top", "bottom"]);
  });
  it("single: clicking a wall on the OTHER axis moves the loading there as a single", () => {
    const b = bldg({ dock: "single", dockSide: "bottom" });
    const a = after(b, "left");
    expect(a.dock).toBe("single");
    expect(sides(a)).toEqual(["left"]);
  });
  it("cross: clicking a wall on the OTHER axis moves the whole pair, still cross", () => {
    const b = bldg();
    const a = after(b, "left");
    expect(a.dock).toBe("cross");
    expect(sides(a)).toEqual(["left", "right"]);
    expect(sides(after(b, "right"))).toEqual(["left", "right"]);
  });
  it("none: clicking any wall loads just that wall", () => {
    const b = bldg({ dock: "none" });
    WALLS.forEach((w) => { const a = after(b, w); expect(a.dock).toBe("single"); expect(sides(a)).toEqual([w]); });
  });
  it("NEVER leaves an L or more than an opposite pair — every state × every wall", () => {
    const states = [
      bldg({ dock: "none" }),
      ...WALLS.map((w) => bldg({ dock: "single", dockAxis: w === "top" || w === "bottom" ? "x" : "y", dockSide: w })),
      bldg(), bldg({ dockAxis: "y" }),
    ];
    states.forEach((b) => WALLS.forEach((w) => {
      const s = sides(after(b, w));
      expect(s.length).toBeLessThanOrEqual(2);
      if (s.length === 2) expect(isOpposite(s)).toBe(true);
    }));
  });
  it("a nonsense side changes nothing", () => expect(wallClickPatch(bldg(), "diagonal")).toBeNull());
  it("tooltips say what the click will do", () => {
    expect(wallClickTitle(bldg(), "top")).toBe("Unload the N wall");
    expect(wallClickTitle(bldg({ dock: "single", dockSide: "bottom" }), "top")).toBe("Load the N wall too");
    expect(wallClickTitle(bldg({ dock: "none" }), "left")).toBe("Load the W wall");
    expect(wallClickTitle(bldg(), "left")).toMatch(/^Move the loading to the W walls?$/);
  });
});

describe("bump-outs follow the loaded walls", () => {
  const bumps = [
    { id: "d1", dogEar: { side: "top", sign: -1 } }, { id: "d2", dogEar: { side: "top", sign: 1 } },
    { id: "d3", dogEar: { side: "bottom", sign: -1 } }, { id: "d4", dogEar: { side: "bottom", sign: 1 } },
  ];
  it("keeps the bumps on a wall that stays loaded, drops the rest", () => {
    expect(strandedBumpIds(bumps, ["bottom"])).toEqual(["d1", "d2"]);
    expect(strandedBumpIds(bumps, ["top", "bottom"])).toEqual([]);
    expect(strandedBumpIds(bumps, [])).toEqual(["d1", "d2", "d3", "d4"]);
    expect(strandedBumpIds(bumps, ["left", "right"])).toEqual(["d1", "d2", "d3", "d4"]);
  });
  it("caps at two per loaded wall", () => {
    expect(bumpOutCap(bldg())).toBe(4);
    expect(bumpOutCap(bldg({ dock: "single", dockSide: "bottom" }))).toBe(2);
    expect(bumpOutCap(bldg({ dock: "none" }))).toBe(0);
  });
});

/* separating-axis test: does the axis-aligned label box overlap the rotated rectangle? */
function boxHitsPoly(box, poly) {
  const bc = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < 4; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % 4]; axes.push([-(by - ay), bx - ax]); }
  return axes.every(([nx, ny]) => {
    const pa = poly.map(([x, y]) => x * nx + y * ny), pb = bc.map(([x, y]) => x * nx + y * ny);
    return !(Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)); // true = overlap on this axis
  });
}

describe("the little plan never collides, at any rotation", () => {
  const shapes = [{ w: 520, h: 210 }, { w: 210, h: 520 }, { w: 300, h: 300 }, { w: 1200, h: 150 }, { w: 80, h: 900 }];
  it("labels clear the rectangle, stay inside the plan and avoid the north arrow — every 5° × several shapes", () => {
    for (const sh of shapes) for (let rot = 0; rot < 360; rot += 5) {
      const L = wallPickerLayout({ ...sh, rot });
      expect(L.scale).toBeGreaterThan(14); // never collapses to a speck
      L.corners.forEach(([x, y]) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(L.width); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(L.height); });
      L.walls.forEach((w) => {
        const box = { x0: w.lx - 7, x1: w.lx + 7, y0: w.ly - 5, y1: w.ly + 5 };
        expect(boxHitsPoly(box, L.corners), `${sh.w}x${sh.h} rot ${rot} ${w.side}`).toBe(false);
        expect(box.x0).toBeGreaterThanOrEqual(0); expect(box.x1).toBeLessThanOrEqual(L.width);
        expect(box.y0).toBeGreaterThanOrEqual(0); expect(box.y1).toBeLessThanOrEqual(L.height);
        const a = L.arrow.box;
        expect(box.x1 < a.x0 || box.x0 > a.x1 || box.y1 < a.y0 || box.y0 > a.y1).toBe(true);
      });
    }
  });
  it("label centre sits at least half-dimension + 6 from the centre, along the wall's outward normal", () => {
    const sh = { w: 520, h: 210 };
    for (let rot = 0; rot < 360; rot += 15) {
      const L = wallPickerLayout({ ...sh, rot });
      const R = L.scale, hw = (sh.w / 520) * R, hh = (sh.h / 520) * R;
      L.walls.forEach((w) => {
        const dist = Math.hypot(w.lx - L.cx, w.ly - L.cy);
        const half = w.side === "top" || w.side === "bottom" ? hh : hw;
        expect(dist).toBeGreaterThanOrEqual(half + 6 - 1e-9);
      });
    }
  });
  it("each wall's label is the compass point of THAT wall at THAT rotation", () => {
    const L = wallPickerLayout(bldg({ rot: 45 }));
    const by = Object.fromEntries(L.walls.map((w) => [w.side, w.label]));
    expect(by).toEqual({ top: "NE", right: "SE", bottom: "SW", left: "NW" });
    const L90 = wallPickerLayout(bldg({ rot: 90 }));
    expect(Object.fromEntries(L90.walls.map((w) => [w.side, w.label]))).toEqual({ top: "E", right: "S", bottom: "W", left: "N" });
  });
  it("the plan turns with Rotation: the top wall's label moves to where the compass says", () => {
    const L = wallPickerLayout(bldg({ rot: 90 }));
    const top = L.walls.find((w) => w.side === "top");
    expect(top.lx).toBeGreaterThan(L.cx + 5);          // east of centre
    expect(Math.abs(top.ly - L.cy)).toBeLessThan(1e-6);
  });
});
