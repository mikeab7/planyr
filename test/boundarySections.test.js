/* Boundary SECTIONS — pure grouping of a parcel outline into a few named, editable stretches.
 * Pins: tiling, corners, curve-stays-one-section, border naming, the no-move value invariant
 * (sections never change what the per-edge setback array says), and the sparse split/join store.
 * Frame: planner feet are screen-down, so NORTH is -y (see the module header). */
import { describe, it, expect } from "vitest";
import {
  CORNER_TURN_DEG, MIN_SECTION_FT, boundarySections, sectionLabel, setSectionSetback, sectionOfEdge,
  toggleBreak, shiftBreaksOnInsert, shiftBreaksOnDelete, sectionsSummary,
} from "../src/workspaces/site-planner/lib/boundarySections.js";
import { offsetPolygon, setbackRingArea } from "../src/workspaces/site-planner/lib/parcelOffset.js";
import weld from "./fixtures/weldParcelProduction.json" with { type: "json" };

const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
// screen-down frame: y=0 is the NORTH line of this rect, y=h the SOUTH line.
const rect = (w = 600, h = 300) => P([0, 0], [w, 0], [w, h], [0, h]);
const lShape = () => P([0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]);
// 12 right-angle corners: a plus/cross shape, long edges
const cross = () => P([100, 0], [200, 0], [200, 100], [300, 100], [300, 200], [200, 200], [200, 300], [100, 300], [100, 200], [0, 200], [0, 100], [100, 100]);

/* three straight sides + a frontage that is ONE arc of `seg` segments (a cul-de-sac bulb). */
function curvedLot(seg = 60) {
  const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }];
  const R = 200, cx = 200, cy = 300; // arc bulging south from (400,300) to (0,300)
  for (let i = 1; i < seg; i++) {
    const a = (i / seg) * Math.PI;
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  pts.push({ x: 0, y: 300 });
  return pts;
}

const tiles = (secs, n) => {
  const count = new Array(n).fill(0);
  for (const s of secs) for (const e of s.edges) count[e]++;
  return count.every((c) => c === 1);
};
const perim = (pts) => pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y), 0);

describe("basic shapes", () => {
  it("rectangle -> 4 sections, tiled, labelled by compass (north = -y)", () => {
    const r = rect();
    const s = boundarySections(r);
    expect(s).toHaveLength(4);
    expect(tiles(s, 4)).toBe(true);
    expect(s.map((x) => x.label).sort()).toEqual(["East line", "North line", "South line", "West line"]);
    expect(sectionOfEdge(s, 0).label).toBe("North line");
    expect(sectionOfEdge(s, 2).label).toBe("South line");
    expect(s.every((x) => x.border.kind === "open" && !x.curved)).toBe(true);
  });
  it("direction is winding-independent", () => {
    const rev = rect().slice().reverse();
    const s = boundarySections(rev);
    expect(s.map((x) => x.label).sort()).toEqual(["East line", "North line", "South line", "West line"]);
  });
  it("L-shape -> 6, 12-corner cross -> 12", () => {
    expect(boundarySections(lShape())).toHaveLength(6);
    const c = boundarySections(cross());
    expect(c).toHaveLength(12);
    expect(tiles(c, 12)).toBe(true);
    expect(new Set(c.map((x) => x.label)).size).toBe(12); // disambiguated
  });
  it("collinear extra vertices and tiny jogs do not spawn sections", () => {
    const pts = P([0, 0], [300, 0], [600, 5], [600, 300], [0, 300]);
    expect(boundarySections(pts)).toHaveLength(4);
  });
  it("long edges at 30 degrees are corners, not a curve (dodecagon)", () => {
    const pts = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * 2 * Math.PI;
      return { x: 500 * Math.cos(a), y: 500 * Math.sin(a) };
    });
    expect(boundarySections(pts)).toHaveLength(12);
  });
  it("never uses the role vocabulary", () => {
    for (const pts of [rect(), lShape(), cross(), curvedLot()]) {
      for (const s of boundarySections(pts)) expect(s.label).not.toMatch(/front|rear|street side/i);
    }
  });
});

describe("curves stay one section", () => {
  it("synthetic 60-segment arc lot", () => {
    const pts = curvedLot(60);
    expect(pts.length).toBeGreaterThan(60);
    const s = boundarySections(pts);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(tiles(s, pts.length)).toBe(true);
    const arc = s.filter((x) => x.curved);
    expect(arc).toHaveLength(1);
    expect(arc[0].edges.length).toBeGreaterThanOrEqual(58);
    expect(arc[0].side).toBe("south");
    for (const x of s) expect(x.lengthFt >= MIN_SECTION_FT).toBe(true);
    expect(sectionsSummary(s).curvedCount).toBe(1);
  });
  it("coarse arc with 45-degree vertices and short edges is one curve", () => {
    // small bulb: R=15 -> 8 gon, edges ~11.5 ft turning 45 deg. Section is below the floor so it is
    // judged merged into whatever; assert no internal breaks on a bigger-but-short-edged one.
    const R = 90, n = 12; // edge ~47ft, turn 30 (< long-edge ft)
    const arc = Array.from({ length: n + 1 }, (_, i) => ({ x: 200 + R * Math.cos(Math.PI * i / n), y: 300 + R * Math.sin(Math.PI * i / n) }));
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, ...arc.slice(0, 1).map(() => ({ x: 290, y: 300 })), ...arc.slice(1, -1), { x: 110, y: 300 }, { x: 0, y: 300 }];
    const s = boundarySections(pts);
    expect(s.filter((x) => x.curved)).toHaveLength(1);
  });
  it("real Weld parcel: a handful of sections", () => {
    const s = boundarySections(weld.points, { defaultSetback: weld.defaultSetbackFt });
    expect(tiles(s, weld.points.length)).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(8);
    for (const x of s) expect(x.lengthFt >= MIN_SECTION_FT).toBe(true);
  });
});

describe("borders", () => {
  it("road along the south and a neighbour on the east", () => {
    const r = rect();
    const road = { name: "Main St", pts: P([-200, 340], [800, 340]) };
    const nb = { id: "p14", name: "Lot 14", points: P([600, 0], [900, 0], [900, 300], [600, 300]) };
    const s = boundarySections(r, { streets: [road], neighbours: [nb] });
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.label).sort()).toEqual(["Along Main St", "East line · next to Lot 14", "North line", "West line"]);
    const east = s.find((x) => x.border.kind === "neighbour");
    expect(east.border.id).toBe("p14");
  });
  it("a road on the same parcel changes section at the border even where geometry is straight", () => {
    const pts = P([0, 0], [1000, 0], [1000, 300], [0, 300]);
    const road = { name: "County Rd 5", pts: P([-300, 340], [500, 340]) };
    // south line is one straight edge: only half borders the road -> majority wins, still 4
    expect(boundarySections(pts, { streets: [road] })).toHaveLength(4);
    const split = P([0, 0], [1000, 0], [1000, 300], [500, 300], [0, 300]);
    const s = boundarySections(split, { streets: [{ name: "County Rd 5", pts: P([-300, 340], [520, 340]) }] });
    expect(s).toHaveLength(5);
    expect(s.filter((x) => x.border.kind === "road")).toHaveLength(1);
  });
  it("unnamed road / water / unknown neighbour naming", () => {
    const r = rect();
    const s = boundarySections(r, { streets: [P([-200, 340], [800, 340])], waters: [{ pts: P([-200, -40], [800, -40]) }] });
    expect(s.map((x) => x.label)).toContain("Along the road");
    expect(s.map((x) => x.label)).toContain("Along the water");
    const nb = boundarySections(r, { neighbours: [{ id: "x", points: P([600, 0], [900, 0], [900, 300], [600, 300]) }] });
    expect(nb.map((x) => x.label)).toContain("East line · next to neighbour");
  });
  it("two roads of the same name get distinct rows", () => {
    const r = rect();
    const s = boundarySections(r, { streets: [{ name: "Elm", pts: P([-200, 340], [800, 340]) }, { name: "Elm", pts: P([-200, -40], [800, -40]) }] });
    const labels = s.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("Along Elm (1)");
  });
});

describe("value / no-move invariant", () => {
  const cases = {
    rectUniform: [rect(), [25, 25, 25, 25]],
    rectMixed: [rect(), [50, 25, 10, 25]],
    lShape: [lShape(), [10, 20, 20, 30, 30, 10]],
    cross: [cross(), cross().map((_, i) => (i % 3) * 5)],
    curvedUniform: [curvedLot(60), (() => { const p = curvedLot(60); return p.map(() => 25); })()],
    curvedMixed: [curvedLot(60), (() => { const p = curvedLot(60); return p.map((_, i) => (i > 20 && i < 40 ? 50 : 25)); })()],
    weld: [weld.points, weld.points.map((_, i) => (i % 7 === 0 ? 40 : 25))],
  };
  for (const [name, [pts, sb]] of Object.entries(cases)) {
    describe(name, () => {
      const junk = { roles: ["front", 7, null], roleOverrides: [null, "rear"], setbacks: sb };
      const secs = boundarySections(pts, { setbacks: junk.setbacks });
      it("sections never straddle differing edge values", () => {
        expect(tiles(secs, pts.length)).toBe(true);
        for (const s of secs) {
          expect(s.mixed).toBe(false);
          expect(new Set(s.edges.map((e) => sb[e])).size).toBe(1);
          expect(s.value).toBe(sb[s.edges[0]]);
        }
      });
      it("writing every section's own value back is byte-identical", () => {
        let out = sb.slice();
        for (const s of secs) out = setSectionSetback(out, s, s.value, pts.length);
        expect(JSON.stringify(out)).toBe(JSON.stringify(sb));
      });
      it("setback ring is identical before/after the write-back", () => {
        let out = sb.slice();
        for (const s of secs) out = setSectionSetback(out, s, s.value, pts.length);
        expect(setbackRingArea(pts, out)).toBe(setbackRingArea(pts, sb));
        expect(offsetPolygon(pts, out)).toEqual(offsetPolygon(pts, sb));
      });
      it("editing one section changes only its edges", () => {
        for (const s of secs) {
          const out = setSectionSetback(sb, s, 77, pts.length);
          for (let i = 0; i < pts.length; i++) expect(out[i]).toBe(s.edges.includes(i) ? 77 : sb[i]);
        }
      });
    });
  }
  it("user join keeps a mixed section and flags it; missing values use the default", () => {
    const sb = [50, 25, 25, 25];
    const base = boundarySections(rect(), { setbacks: sb });
    expect(base).toHaveLength(4);
    const joined = boundarySections(rect(), { setbacks: sb, joins: [1] });
    expect(joined).toHaveLength(3);
    const m = joined.find((s) => s.edges.length === 2);
    expect(m.mixed).toBe(true);
    expect(m.value).toBeNull();
    expect(boundarySections(rect(), { defaultSetback: 30 }).every((s) => s.value === 30)).toBe(true);
  });
  it("clamps negatives, pads short arrays, does not mutate input", () => {
    const sb = [10, 10];
    const s = boundarySections(rect())[3];
    const out = setSectionSetback(sb, s, -5, 4);
    expect(out).toEqual([10, 10, 0, 0]);
    expect(sb).toEqual([10, 10]);
  });
});

describe("split / join", () => {
  it("forced break splits a straight side; round-trips", () => {
    const pts = P([0, 0], [300, 0], [600, 0], [600, 300], [0, 300]);
    const o = { points: pts };
    expect(boundarySections(pts)).toHaveLength(4);
    const a = toggleBreak(o, 1);
    expect(a).toEqual({ breaks: [1], joins: [] });
    expect(boundarySections(pts, a)).toHaveLength(5);
    const b = toggleBreak({ ...o, ...a }, 1);
    expect(b).toEqual({ breaks: [], joins: [] });
  });
  it("joining an automatic corner then splitting again restores it", () => {
    const pts = rect();
    const j = toggleBreak({ points: pts }, 1);
    expect(j).toEqual({ breaks: [], joins: [1] });
    expect(boundarySections(pts, j)).toHaveLength(3);
    expect(toggleBreak({ points: pts, ...j }, 1)).toEqual({ breaks: [], joins: [] });
  });
  it("shifts stored vertices on insert/delete", () => {
    expect(shiftBreaksOnInsert([1, 3, 5], 2)).toEqual([1, 4, 6]);
    expect(shiftBreaksOnInsert([1, 3, 5], 0)).toEqual([2, 4, 6]);
    expect(shiftBreaksOnDelete([1, 3, 5], 3)).toEqual([1, 4]);
    expect(shiftBreaksOnDelete([0, 2, 4], 1)).toEqual([0, 1, 3]);
    expect(shiftBreaksOnInsert(undefined, 1)).toBeUndefined();
  });
  it("a forced break is never merged away as tiny", () => {
    const pts = P([0, 0], [300, 0], [600, 0], [600, 300], [0, 300]);
    const s = boundarySections(pts, { breaks: [1] });
    expect(s).toHaveLength(5);
  });
});

describe("wrap-around", () => {
  it("a section spanning vertex 0 is one section", () => {
    // vertex 0 sits mid-way along the north side
    const pts = P([300, 0], [600, 0], [600, 300], [0, 300], [0, 0]);
    const s = boundarySections(pts);
    expect(s).toHaveLength(4);
    const north = s.find((x) => x.side === "north");
    expect(north.startVertex).toBe(4);
    expect(north.endVertex).toBe(1);
    expect(north.edges).toEqual([4, 0]);
    expect(north.lengthFt).toBeCloseTo(600);
    expect(tiles(s, 5)).toBe(true);
  });
  it("tiling holds for random rings and a smooth circle", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 40; t++) {
      const n = 3 + Math.floor(rnd() * 30);
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI, r = 100 + rnd() * 200;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
      const s = boundarySections(pts, { setbacks: pts.map(() => Math.floor(rnd() * 3) * 10) });
      expect(tiles(s, n)).toBe(true);
      expect(s.reduce((a, x) => a + x.lengthFt, 0)).toBeCloseTo(perim(pts), 3);
    }
    const circle = Array.from({ length: 90 }, (_, i) => ({ x: 300 * Math.cos((i / 90) * 2 * Math.PI), y: 300 * Math.sin((i / 90) * 2 * Math.PI) }));
    const c = boundarySections(circle);
    expect(c).toHaveLength(1);
    expect(c[0].edges).toHaveLength(90);
    expect(c[0].curved).toBe(true);
  });
  it("sectionLabel reads the stored label", () => {
    const s = boundarySections(rect())[0];
    expect(sectionLabel(s)).toBe(s.label);
    expect(CORNER_TURN_DEG).toBeGreaterThan(30);
  });
});
