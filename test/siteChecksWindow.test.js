// Problem report 6cea9895 (2026-10-19): Site Analysis froze the owner's planner for 6 s. FEMA answered the Chehaw Rd parcel
// (Spalding Co., GA) with a 702,524-vertex Zone X "minimal flood hazard" polygon, and measureFlood ran clipper over all of
// it inside the response's continuation — 33,960 ms in Node, 26 s in the sandbox's headless Chromium on planyr.io.
// siteChecks.windowFeatures now cuts every polygon to a window around the site first. This proves, on the REAL answer
// (test/fixtures/chehaw-218-02007.screen.json — cut to 1,500 m around the parcel so it can be committed), that the window
// changes NO number, and that the work after the cut is bounded by the window, not by the county.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { measureFlood, measureWetlands, windowFeatures, WINDOW_PAD_M } from "../src/workspaces/site-planner/lib/siteChecks.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/chehaw-218-02007.screen.json", import.meta.url), "utf8"));
const rings = [fx.ringLngLat];
const flood = fx.flood.map((f) => ({ rings: f.rings, zone: f.attrs.FLD_ZONE, subtype: f.attrs.ZONE_SUBTY }));
const wet = fx.wetlands.map((f) => ({ rings: f.rings, type: f.attrs.WETLAND_TYPE }));
const verts = (fs) => fs.reduce((a, f) => a + f.rings.reduce((b, r) => b + r.length, 0), 0);

describe("the real answer that froze the planner", () => {
  it("is the shape of the report: one county-scale Zone X polygon (702,524 vertices in the full answer) and a Zone A", () => {
    expect(fx.floodFullVertices).toEqual([10012, 702524]);
    expect(fx.flood.map((f) => f.attrs.FLD_ZONE)).toEqual(["A", "X"]);
  });
});

describe("the window changes no number", () => {
  const before = measureFlood(rings, [], flood, undefined, { windowPadM: Infinity }); // the pre-fix rule: whole polygons
  const after = measureFlood(rings, [], flood);
  it("flood: identical to the whole-polygon measurement, field for field", () => {
    expect(after).toEqual(before);
  });
  it("flood: identical to the measurement on the FULL 712,536-vertex answer, recorded when the fixture was made", () => {
    expect(after).toEqual(fx.fullMeasure.flood);
    expect(after.sfhaZones).toEqual(["A"]);
    expect(after.mappedFrac).toBe(1);
  });
  it("wetlands: identical both ways", () => {
    expect(measureWetlands(rings, [], wet)).toEqual(measureWetlands(rings, [], wet, undefined, { windowPadM: Infinity }));
    expect(measureWetlands(rings, [], wet)).toEqual(fx.fullMeasure.wetlands);
  });
});

describe("the work is bounded by the window, not the county", () => {
  it("the cut keeps a small fraction of the vertices clipper sees", () => {
    const cut = windowFeatures(rings, flood);
    expect(cut.length).toBe(2);
    expect(verts(cut)).toBeLessThan(verts(flood) / 4);
    expect(verts(cut)).toBeLessThan(12000);
  });
  it("a feature wholly outside the window is dropped; one that swallows it becomes (at most) the window", () => {
    const [lng, lat] = fx.ringLngLat[0];
    const far = { rings: [[[lng + 1, lat + 1], [lng + 1.01, lat + 1], [lng + 1.01, lat + 1.01], [lng + 1, lat + 1]]] };
    const huge = { rings: [[[lng - 1, lat - 1], [lng + 1, lat - 1], [lng + 1, lat + 1], [lng - 1, lat + 1], [lng - 1, lat - 1]]] };
    const out = windowFeatures(rings, [far, huge]);
    expect(out.length).toBe(1);
    expect(out[0].rings[0].length).toBeLessThanOrEqual(6);
  });
  it("the window is 300 m", () => expect(WINDOW_PAD_M).toBe(300));
});

describe("the measurement never runs in the response's own continuation", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/siteChecksRun.js", import.meta.url), "utf8");
  it("flood and wetlands yield to the main thread, then cut, then yield again, before measuring", () => {
    for (const group of ["flood", "wetlands"]) {
      const body = src.slice(src.indexOf(`  ${group}: async`), src.indexOf("},", src.indexOf(`  ${group}: async`)));
      expect(body).toMatch(/await yieldToMain\(\);[\s\S]*windowFeatures\([\s\S]*await yieldToMain\(\);[\s\S]*measure/);
    }
  });
});
