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
/* NEW-1 (STATE-PLANE-AUDIT) — THE RECORDED "FULL ANSWER" NUMBERS WERE MEASURED ON THE TEXAS CONE. This parcel is in Spalding Co.,
 * GEORGIA, and until the all-states work every Site Analysis area was projected through Texas South Central: the site read
 * 3,239,565.5 sqft where Georgia West (its own zone) gives 3,224,597.5 — the screen over-reported every Georgia flood / wetland
 * area by 0.46%. `fx.fullMeasure` is the independent record of the 702,524-vertex answer and cannot be re-measured here (the
 * committed fixture is cut to 1,500 m), so it is carried onto the correct grid by the one thing that changed — the area scale of
 * the projection at this site: every AREA field × (correct site area ÷ recorded site area); fractions, counts, zones and sides
 * are projection-independent and still compared exactly. */
const AREA_KEYS = new Set(["siteSqft", "sfhaSqft", "shadedSqft", "undeterminedSqft", "sqft", "acres"]);
const onTheSitesOwnGrid = (rec, measured) => {
  const k = measured.siteSqft / rec.siteSqft;
  const out = {};
  for (const [key, v] of Object.entries(rec)) out[key] = AREA_KEYS.has(key) ? v * k : v;
  return out;
};
const expectSameMeasure = (got, rec) => {
  const want = onTheSitesOwnGrid(rec, got);
  for (const key of Object.keys(want)) {
    // The projection's area scale varies by ~2 parts in a million across a site, so a sub-region (the flood part) is carried by the
    // site-wide ratio to ~1e-4 relative, and a fraction to 5 places.
    if (AREA_KEYS.has(key)) expect(Math.abs(got[key] - want[key]) / (want[key] || 1), key).toBeLessThan(2e-4);
    else if (typeof want[key] === "number") expect(got[key], key).toBeCloseTo(want[key], 5);
    else expect(got[key], key).toEqual(want[key]);
  }
  expect(Math.abs(got.siteSqft / rec.siteSqft - 0.99538)).toBeLessThan(0.0005);       // the Georgia grid, not the Texas cone
};
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
    expectSameMeasure(after, fx.fullMeasure.flood);
    expect(after.sfhaZones).toEqual(["A"]);
    expect(after.mappedFrac).toBe(1);
  });
  it("wetlands: identical both ways", () => {
    expect(measureWetlands(rings, [], wet)).toEqual(measureWetlands(rings, [], wet, undefined, { windowPadM: Infinity }));
    expectSameMeasure(measureWetlands(rings, [], wet), fx.fullMeasure.wetlands);
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
  it("the window is 50 m", () => expect(WINDOW_PAD_M).toBe(50));
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

describe("the worker transport's answer-level cut (featureWindow.windowArcgisAnswer)", async () => {
  const { windowArcgisAnswer } = await import("../src/workspaces/site-planner/lib/featureWindow.js");
  const { windowedFetchImpl, workerAvailable } = await import("../src/workspaces/site-planner/lib/siteChecksTransport.js");
  const answer = { objectIdFieldName: "OBJECTID", exceededTransferLimit: false,
    features: fx.flood.map((f) => ({ attributes: f.attrs, geometry: { rings: f.rings, spatialReference: { wkid: 4326 } } })) };
  it("cuts the geometry and keeps everything else (attributes, paging fields, spatial reference)", () => {
    const w = windowArcgisAnswer(answer, rings);
    expect(w.objectIdFieldName).toBe("OBJECTID");
    expect(w.exceededTransferLimit).toBe(false);
    expect(w.features.map((f) => f.attributes)).toEqual(answer.features.map((f) => f.attributes));
    expect(w.features[1].geometry.spatialReference).toEqual({ wkid: 4326 });
    expect(verts(w.features.map((f) => ({ rings: f.geometry.rings })))).toBeLessThan(12000);
  });
  it("measuring the windowed answer gives the same numbers as the full one", () => {
    const w = windowArcgisAnswer(answer, rings);
    expectSameMeasure(measureFlood(rings, [], w.features.map((f) => ({ rings: f.geometry.rings, zone: f.attributes.FLD_ZONE, subtype: f.attributes.ZONE_SUBTY }))), fx.fullMeasure.flood);
  });
  it("a feature the cut would empty keeps its real geometry (never a geometry-less feature)", () => {
    const [lng, lat] = fx.ringLngLat[0];
    const far = { attributes: { FLD_ZONE: "X" }, geometry: { rings: [[[lng + 1, lat + 1], [lng + 1.01, lat + 1], [lng + 1.01, lat + 1.01], [lng + 1, lat + 1]]] } };
    expect(windowArcgisAnswer({ features: [far] }, rings).features[0].geometry.rings).toEqual(far.geometry.rings);
  });
  it("with no Worker (Node) the transport falls back to a main-thread fetch that still windows", async () => {
    expect(workerAvailable()).toBe(false);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => answer });
    try {
      const res = await windowedFetchImpl(rings)("https://example.test/q", { method: "GET" });
      const j = await res.json();
      expect(res.ok).toBe(true);
      expect(verts(j.features.map((f) => ({ rings: f.geometry.rings })))).toBeLessThan(12000);
    } finally { globalThis.fetch = realFetch; }
  });
});
