import { describe, it, expect } from "vitest";
import { bandSetter } from "../src/workspaces/site-planner/lib/bandSetter.js";
const opts = (groupKey) => ({ groupKey, zGap: 10, nextZ: (a) => (a.length ? Math.max(...a.map((x) => x.z)) + 10 : 0), sortByZ: (a) => [...a].sort((p, q) => p.z - q.z) });
const L = [{ id: "a", z: 1 }, { id: "b", z: 5, behindEls: true }, { id: "c", z: 9 }];
describe("bandSetter", () => {
  it("returns the same array for an unknown id", () => expect(bandSetter(L, "zz", true, opts(null))).toBe(L));
  it("moves one item behind and stacks it on top of that band", () => {
    const r = bandSetter(L, "a", true, opts(null));
    expect(r[0]).toEqual({ id: "a", z: 15, behindEls: true });
    expect(r[1]).toBe(L[1]); expect(r[2]).toBe(L[2]);
  });
  it("moving back in front clears behindEls", () => {
    const r = bandSetter(L, "b", false, opts(null));
    expect(r[1].behindEls).toBeUndefined(); expect(r[1].z).toBe(19);
  });
  it("a deed group travels together, in its own order", () => {
    const g = [{ id: "a", z: 1, deedGroup: "G" }, { id: "b", z: 2, deedGroup: "G" }, { id: "c", z: 3 }];
    const r = bandSetter(g, "b", true, opts("deedGroup"));
    expect(r[0].behindEls).toBe(true); expect(r[1].behindEls).toBe(true); expect(r[2]).toBe(g[2]);
    expect(r[0].z).toBeLessThan(r[1].z);
  });
});
