/* B?-corner-setbacks (2026-11-09, owner: "settle it without a headless click") — inserting / deleting a parcel corner must keep EVERY per-edge value on its
 * edge. The corner tool (SitePlanner `insertVtx` / `deleteVtx`, parcel layer) calls lib/parcelReshape.js directly, so this drives the very code path.
 * The building setback `pc.setbacks` is read ONLY while its length equals the ring's (`parcelSetbacks`), so an un-shifted array silently reads as the
 * project default: the owner's per-edge 10 / 20 / 30 / 40 ft became "25 25 25 25" the moment a corner was added. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parcelAfterInsert, parcelAfterDelete } from "../src/workspaces/site-planner/lib/parcelReshape.js";

const sq = () => [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const lot = (extra = {}) => ({ id: "L", active: true, points: sq(), ...extra });
// what the planner's own reader does with the array (SitePlanner `parcelSetbacks`): honoured only at the ring's length, else the default
const readSetbacks = (pc, dflt = 25) => (Array.isArray(pc.setbacks) && pc.setbacks.length === pc.points.length ? pc.setbacks : pc.points.map(() => dflt));

describe("insert a corner on edge i", () => {
  it("both halves keep the parent edge's building setback; every later edge keeps its own", () => {
    const out = parcelAfterInsert(lot({ setbacks: [10, 20, 30, 40] }), 1, { x: 400, y: 150 });
    expect(out.points).toHaveLength(5);
    expect(out.setbacks).toEqual([10, 20, 20, 30, 40]);
    expect(readSetbacks(out)).toEqual([10, 20, 20, 30, 40]); // NOT the default 25s
  });
  it("on the last edge (the one that closes the ring)", () => {
    const out = parcelAfterInsert(lot({ setbacks: [10, 20, 30, 40] }), 3, { x: 0, y: 150 });
    expect(out.setbacks).toEqual([10, 20, 30, 40, 40]);
  });
  it("the new point lands exactly ON the edge it split, and no other point moves", () => {
    const out = parcelAfterInsert(lot({ setbacks: [10, 20, 30, 40] }), 0, { x: 200, y: 17 });
    expect(out.points[1]).toEqual({ x: 200, y: 0 });
    expect([out.points[0], out.points[2], out.points[3], out.points[4]]).toEqual(sq());
  });
  it("a parcel that never set per-edge setbacks gains none (it keeps reading the project default)", () => {
    const out = parcelAfterInsert(lot(), 1, { x: 400, y: 150 });
    expect("setbacks" in out && out.setbacks != null).toBe(false);
  });
  it("paving, role overrides and section vertices follow too (one reshape, every array)", () => {
    const out = parcelAfterInsert(lot({ setbacks: [10, 20, 30, 40], pavingSetbacks: [1, 2, 3, 4], roleOverrides: [null, "front", null, null], sectionBreaks: [2], sectionJoins: [] }), 1, { x: 400, y: 150 });
    expect(out.pavingSetbacks).toEqual([1, 2, 2, 3, 4]);
    expect(out.roleOverrides).toEqual([null, "front", "front", null, null]);
    expect(out.sectionBreaks).toEqual([3]);
  });
});

describe("delete corner i", () => {
  it("the merged edge keeps the first half's building setback, every other edge keeps its own", () => {
    const out = parcelAfterDelete(lot({ setbacks: [10, 20, 30, 40] }), 2);
    expect(out.points).toHaveLength(3);
    expect(out.setbacks).toEqual([10, 20, 40]);
    expect(readSetbacks(out)).toEqual([10, 20, 40]);
  });
  it("deleting corner 0 merges the closing edge with edge 0", () => {
    expect(parcelAfterDelete(lot({ setbacks: [10, 20, 30, 40] }), 0).setbacks).toEqual([20, 30, 40]);
  });
  it("insert then delete of the new corner returns the original values", () => {
    const sb = [10, 20, 30, 40];
    const out = parcelAfterDelete(parcelAfterInsert(lot({ setbacks: sb }), 1, { x: 400, y: 150 }), 2);
    expect(out.setbacks).toEqual(sb);
    expect(out.points).toEqual(sq());
  });
  it("a parcel with no per-edge setbacks gains none", () => {
    const out = parcelAfterDelete(lot(), 2);
    expect("setbacks" in out && out.setbacks != null).toBe(false);
  });
});

describe("the corner tool really calls it", () => {
  const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("insertVtx and deleteVtx hand the parcel layer to the one reshape (no second inline copy)", () => {
    expect(src).toMatch(/layer === "parcel"\) setParcels\(\(a\) => a\.map\(\(pc\) => pc\.id === id \? parcelAfterInsert\(pc, edgeIndex, np\) : pc\)\)/);
    expect(src).toMatch(/layer === "parcel"\) setParcels\(\(a\) => a\.map\(\(pc\) => pc\.id === id \? parcelAfterDelete\(pc, index\) : pc\)\)/);
    expect(src).not.toMatch(/points: ins\(pc\.points\)|points: rm\(pc\.points\)/);
  });
});
