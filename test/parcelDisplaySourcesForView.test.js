import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, displaySourcesForView, trimLayerUrl } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

/* B1976336 (NEW-1) — the Select-parcels DISPLAY layer must draw only sources that can reach the
 * view. Before, select mode added a layer for every wired source in the country (measured: 408
 * /query requests, 65 services, for one zoom step near Cartersville GA). Real polygon asset, not a
 * fixture, so the statewide-composite half (which needs the state in view) is exercised for real. */
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const view = (south, west, north, east) => ({ south, west, north, east });
const stateOf = (k) => COUNTIES_MAP[k].state;

describe("displaySourcesForView", () => {
  it("Bartow County GA view → ga_bartow only; no Texas/Colorado/Alaska/California/… source", () => {
    const got = displaySourcesForView(view(34.18, -84.86, 34.22, -84.79));
    expect(got).toEqual(["ga_bartow"]); // ONE source per area — Fulton's padded bbox must not draw over Bartow
    for (const bad of ["txgio_statewide", "harris", "fortbend", "co_statewide", "ak_statewide", "ca_statewide", "ct_statewide"]) {
      expect(got).not.toContain(bad);
    }
  });

  it("a zoom step out from Bartow still stays inside Georgia", () => {
    const got = displaySourcesForView(view(34.0, -85.1, 34.4, -84.5));
    expect(got).toContain("ga_bartow");
    expect(got.every((k) => stateOf(k) === "GA")).toBe(true);
  });

  it("Texas view (Harris) → Texas sources only, incl. the statewide composite", () => {
    const got = displaySourcesForView(view(29.72, -95.42, 29.78, -95.34));
    expect(got).toContain("harris");
    expect(got.every((k) => stateOf(k) === "TX")).toBe(true);
  });

  it("Colorado view → Colorado sources only", () => {
    const got = displaySourcesForView(view(39.70, -105.02, 39.78, -104.94));
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((k) => stateOf(k) === "CO")).toBe(true);
  });

  it("state-line view (Augusta GA / North Augusta SC) → only GA and SC sources", () => {
    const got = displaySourcesForView(view(33.44, -82.05, 33.52, -81.93));
    expect(got).toContain("ga_richmond");
    expect(got.every((k) => ["GA", "SC"].includes(stateOf(k)))).toBe(true);
  });

  it("a view over a wired-nothing area (open ocean) → no sources, never everything", () => {
    expect(displaySourcesForView(view(25.0, -60.0, 25.1, -59.9))).toEqual([]);
  });

  it("a wide view over a wired county still returns its own source, not a rival's", () => {
    const got = displaySourcesForView(view(34.0, -85.1, 34.4, -84.5));
    expect(got).toContain("ga_bartow");
    expect(got).not.toContain("ga_fulton"); // Fulton's true boundary is well south of 34.0 at this longitude
  });

  it("missing bounds → no sources", () => {
    expect(displaySourcesForView(null)).toEqual([]);
  });

  it("measured before/after: distinct services queried for the Bartow view", () => {
    const services = (keys) => new Set(keys.map((k) => trimLayerUrl(COUNTIES_MAP[k].layerUrl || COUNTIES_MAP[k].mapServer)));
    const before = services(Object.keys(COUNTIES_MAP)).size; // old behaviour: every wired source
    const after = services(displaySourcesForView(view(34.18, -84.86, 34.22, -84.79))).size;
    const TILES = 6; // display tiles per service, as measured live
    console.log(`B1976336 /query requests per zoom step (Bartow GA): before ≈ ${before * TILES}, after ≈ ${after * TILES}`);
    expect(after * TILES).toBeLessThanOrEqual(6); // one service, 6 tiles
    expect(after).toBeLessThan(before);
  });
});
