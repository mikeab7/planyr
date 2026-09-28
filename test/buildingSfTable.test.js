import { describe, it, expect } from "vitest";
import { buildingSfRows } from "../src/workspaces/site-planner/lib/buildingSfTable.js";
import { siteMetrics } from "../src/workspaces/site-planner/lib/siteMetrics.js";

// B1934529 — bringing the buildings-SF table back as a compact exhibit inset. The whole point of
// this module is that its numbers can never disagree with the canvas labels or the Yield panel,
// so these tests cross-check against `siteMetrics().bldg` (the Yield panel's own total) rather
// than trusting a hand-computed expectation alone.

const rectBuilding = (id, w, h, extra = {}) => ({ id, type: "building", w, h, ...extra });

describe("buildingSfRows — one row per numbered building, SF = footprint + its own bump-outs", () => {
  it("an empty plan has no rows and a zero total", () => {
    expect(buildingSfRows([])).toEqual({ rows: [], total: 0 });
    expect(buildingSfRows(null)).toEqual({ rows: [], total: 0 });
  });

  it("a plan with no buildings (other element kinds only) has no rows", () => {
    const els = [{ id: "p1", type: "parking", w: 50, h: 50 }, { id: "r1", type: "road", w: 20, h: 300 }];
    expect(buildingSfRows(els)).toEqual({ rows: [], total: 0 });
  });

  it("names buildings by their derived display number, same convention the canvas uses", () => {
    const els = [rectBuilding("b1", 100, 200), rectBuilding("b2", 300, 400)];
    const { rows, total } = buildingSfRows(els);
    expect(rows.map((r) => r.name)).toEqual(["Building 1", "Building 2"]);
    expect(rows.map((r) => r.sf)).toEqual([20000, 120000]);
    expect(total).toBe(140000);
  });

  it("a building's SF folds in its own bump-outs (dog-ears), matching the canvas label sum", () => {
    const els = [
      rectBuilding("b1", 100, 200),
      { id: "bump1", type: "building", w: 55, h: 60, dogEar: { side: "top" }, attachedTo: "b1" },
    ];
    const { rows, total } = buildingSfRows(els);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Building 1", sf: 100 * 200 + 55 * 60 });
    expect(total).toBe(100 * 200 + 55 * 60);
  });

  it("a bump-out never appears as its own row — only the numbered parent buildings do", () => {
    const els = [
      rectBuilding("b1", 100, 200),
      { id: "bump1", type: "building", w: 55, h: 60, dogEar: { side: "top" }, attachedTo: "b1" },
    ];
    const { rows } = buildingSfRows(els);
    expect(rows.map((r) => r.id)).toEqual(["b1"]);
  });

  it("rows are sorted by display number regardless of array order", () => {
    const els = [rectBuilding("second", 10, 10, { buildingNumber: 2 }), rectBuilding("first", 20, 20, { buildingNumber: 1 })];
    const { rows } = buildingSfRows(els);
    expect(rows.map((r) => r.name)).toEqual(["Building 1", "Building 2"]);
  });

  it("a polygon building's SF is its ring area, not w*h", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const els = [{ id: "b1", type: "building", points: ring }];
    const { rows, total } = buildingSfRows(els);
    expect(rows[0].sf).toBeCloseTo(5000, 6);
    expect(total).toBeCloseTo(5000, 6);
  });

  it("⛔ the total across every row equals siteMetrics().bldg — the Yield panel's own number — for a realistic mixed plan", () => {
    const els = [
      rectBuilding("b1", 220, 577),
      { id: "bump1", type: "building", w: 55, h: 60, dogEar: { side: "top" }, attachedTo: "b1" },
      { id: "bump2", type: "building", w: 55, h: 60, dogEar: { side: "bottom" }, attachedTo: "b1" },
      rectBuilding("b2", 400, 900),
      { id: "park1", type: "parking", w: 200, h: 150 },
      { id: "pond1", type: "pond", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }] },
    ];
    const { total } = buildingSfRows(els);
    const metrics = siteMetrics(els, [], [], {});
    expect(total).toBe(metrics.bldg);
    expect(total).toBeGreaterThan(0);
  });

  it("formats the row SF the same way the canvas labels / Total row read (whole-number SF)", () => {
    const els = [rectBuilding("b1", 1176940 / 1000, 1000)]; // 1,176,940 sf footprint
    const { rows } = buildingSfRows(els);
    expect(Math.round(rows[0].sf)).toBe(1176940);
  });
});
