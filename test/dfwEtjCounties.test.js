/* NEW-2 — the DFW ETJ county coverage table cannot drift from the registry. See ui-audit/lib/dfwEtjCounties.mjs. */
import { describe, it, expect } from "vitest";
import { DFW_ETJ_COUNTIES, DFW_ETJ_COUNTIES_OUTSIDE_CIRCLE } from "../ui-audit/lib/dfwEtjCounties.mjs";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { ETJ_SOURCES, etjPointCoverage } from "../src/workspaces/site-planner/lib/jurisdiction.js";

const complete = ETJ_SOURCES.flatMap((s) => s.completeCounties || []);

describe("DFW ETJ county table", () => {
  it("lists the 19 counties the 50-mile circle touches, once each, largest share first", () => {
    expect(DFW_ETJ_COUNTIES).toHaveLength(19);
    expect(new Set(DFW_ETJ_COUNTIES.map((c) => c.county)).size).toBe(19);
    const shares = DFW_ETJ_COUNTIES.map((c) => c.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThan(99);     // the counties tile the circle
    for (const c of DFW_ETJ_COUNTIES_OUTSIDE_CIRCLE) expect(DFW_ETJ_COUNTIES.some((x) => x.county === c)).toBe(false);
  });
  it("every source it names is a real registry row that is actually routed", () => {
    for (const c of DFW_ETJ_COUNTIES) for (const id of c.sources) {
      expect(GIS_SOURCES[id], `${c.county}: ${id}`).toBeTruthy();
      expect(ETJ_SOURCES.some((s) => s.id === id), `${c.county}: ${id} routed`).toBe(true);
    }
  });
  it("'complete' means exactly the registry's completeCounties — no more, no fewer", () => {
    expect(DFW_ETJ_COUNTIES.filter((c) => c.status === "complete").map((c) => c.county).sort()).toEqual([...complete].sort());
  });
  it("a 'none' county names no source, a date of null, and TWO mechanisms tried", () => {
    for (const c of DFW_ETJ_COUNTIES.filter((x) => x.status === "none")) {
      expect(c.sources, c.county).toEqual([]);
      expect(c.date, c.county).toBeNull();
      expect((c.tried || []).length, c.county).toBeGreaterThanOrEqual(2);
    }
  });
  it("every covered county states a publisher date", () => {
    for (const c of DFW_ETJ_COUNTIES.filter((x) => x.status !== "none")) expect(c.date, c.county).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("the counties that stay uncovered keep reading unavailable (a point inside each, no city, no ETJ)", () => {
    for (const c of DFW_ETJ_COUNTIES.filter((x) => x.status !== "complete")) {
      expect(etjPointCoverage(32.8, -96.8, [c.county]).status, c.county).toBe("unavailable");
    }
  });
});
