/* DeSoto County MS — which government a point falls in (B2507058 / B2507059), over the REAL municipal limits (recorded 2026-10-29 from BaseLayers/4 through the relay).
 * Inside one of the five cities → that city; elsewhere in the county → "Unincorporated DeSoto County" (Mississippi has no ETJ); not loaded / not the county → null, never a guess. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  jurisdictionFrom, pointInGeometry, titleCase, ensureMunicipalities, jurisdictionAt, municipalitiesReady, _setMunicipalities, UNINCORPORATED, MUNICIPALITIES_URL,
} from "../src/workspaces/site-planner/lib/desotoJurisdiction.js";
import { zoningRows } from "../src/workspaces/site-planner/lib/desotoZoning.js";

const FC = JSON.parse(readFileSync(new URL("./fixtures/desotoMunicipalities.json", import.meta.url), "utf8"));

describe("jurisdictionFrom — the five cities, then unincorporated", () => {
  it.each([
    ["Olive Branch (downtown)", 34.9618, -89.8295, "Olive Branch"],
    ["Hernando", 34.824, -89.9937, "Hernando"],
    ["Southaven", 34.9889, -90.0126, "Southaven"],
    ["Horn Lake", 34.9553, -90.0348, "Horn Lake"],
    ["Walls", 34.9279, -90.1904, "Walls"],
    ["rural east DeSoto", 34.75, -89.75, UNINCORPORATED],
    ["Hacks Cross Rd area outside the limits", 34.9, -89.78, UNINCORPORATED],
  ])("%s → %s", (_n, lat, lng, want) => expect(jurisdictionFrom(FC, lat, lng)).toBe(want));
  it("a point far from DeSoto County is null, never 'Unincorporated DeSoto County'", () => {
    for (const [lat, lng] of [[29.76, -95.37], [33.75, -84.39], [36.16, -86.78], [35.15, -90.05]]) expect(jurisdictionFrom(FC, lat, lng), `${lat},${lng}`).toBeNull();
  });
  it("no limits in hand (not loaded) is null — unknown, never 'unincorporated'", () => {
    expect(jurisdictionFrom(null, 34.96, -89.83)).toBeNull();
    expect(jurisdictionFrom({ features: [] }, 34.96, -89.83)).toBeNull();
  });
  it("a bad coordinate is null", () => { expect(jurisdictionFrom(FC, NaN, -89.8)).toBeNull(); expect(jurisdictionFrom(FC, 34.9, undefined)).toBeNull(); });
  it("the five names are title-cased", () => {
    expect(FC.features.map((f) => titleCase(f.properties.NAME)).sort()).toEqual(["Hernando", "Horn Lake", "Olive Branch", "Southaven", "Walls"]);
  });
});

describe("pointInGeometry honours holes and multipolygons", () => {
  const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  it("a point in a hole is outside", () => {
    const g = { type: "Polygon", coordinates: [ring(0, 0, 10, 10), ring(4, 4, 6, 6)] };
    expect(pointInGeometry(g, 1, 1)).toBe(true);
    expect(pointInGeometry(g, 5, 5)).toBe(false);
  });
  it("any part of a multipolygon counts", () => {
    const g = { type: "MultiPolygon", coordinates: [[ring(0, 0, 1, 1)], [ring(5, 5, 6, 6)]] };
    expect(pointInGeometry(g, 5.5, 5.5)).toBe(true);
    expect(pointInGeometry(g, 3, 3)).toBe(false);
    expect(pointInGeometry(null, 1, 1)).toBe(false);
  });
});

describe("loading — fetched once, failures never cached as 'no cities'", () => {
  beforeEach(() => _setMunicipalities(null));
  const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));
  it("asks the county's municipalities layer through the relay, once, and then answers from memory", async () => {
    const f = ok(FC);
    expect(await ensureMunicipalities(f)).toBe(FC);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(MUNICIPALITIES_URL);
    expect(MUNICIPALITIES_URL.startsWith("/gis-proxy/gis.desotocountyms.gov/")).toBe(true);
    expect(await ensureMunicipalities(f)).toBe(FC);
    expect(f).toHaveBeenCalledTimes(1);
    expect(municipalitiesReady()).toBe(true);
    expect(jurisdictionAt(34.9618, -89.8295)).toBe("Olive Branch");
  });
  it("before the limits load, jurisdictionAt is null (and the zoning card says so)", () => {
    expect(jurisdictionAt(34.9618, -89.8295)).toBeNull();
    expect(zoningRows({ ZONE: "M-1" }, jurisdictionAt(34.9618, -89.8295))[1].text).toMatch(/Checking/);
  });
  it("a failed fetch is retried once, then reported loudly and NOT cached", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(async () => ({ ok: false }));
    expect(await ensureMunicipalities(bad)).toBeNull();
    expect(bad).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    expect(municipalitiesReady()).toBe(false);
    const good = ok(FC);
    expect(await ensureMunicipalities(good)).toBe(FC);   // the next ask tries again
    err.mockRestore();
  });
  it("an answer with no features is a failure, not an empty county", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureMunicipalities(ok({ features: [] }))).toBeNull();
    expect(municipalitiesReady()).toBe(false);
    err.mockRestore();
  });
});
