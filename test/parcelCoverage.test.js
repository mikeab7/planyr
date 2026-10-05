import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyKeyForName, statewideKeysForState, isStatewideLayerUrl,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import {
  buildCoverage, classifySourceKind, countyDisplayName, provenanceSaysThirdParty, totalLine,
} from "../src/workspaces/admin/lib/parcelCoverage.js";
import { buildCountyPaths } from "../src/workspaces/admin/lib/countyMapGeometry.js";

const payload = JSON.parse(fs.readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
const live = () => ({
  countiesMap: COUNTIES_MAP, counties: COUNTIES, keyForName: countyKeyForName,
  statewideKeysForState, isStatewideUrl: isStatewideLayerUrl, verification: COUNTY_VERIFICATION,
});
const rowFor = (cov, state, name) => cov.rows.find((r) => r.state === state && r.name === name);

let cov;
beforeAll(async () => {
  await setCountyPolygons(payload); // the registry's Texas tier derives from this same roster
  cov = buildCoverage(payload.counties, live());
});

describe("parcel coverage join (NEW-1)", () => {
  it("every literal registry key joins exactly one polygon or is listed as not drawn", () => {
    const literal = Object.keys(COUNTIES_MAP).filter((k) => !COUNTIES_MAP[k].statewide);
    const joined = new Map();
    for (const r of cov.rows) if (r.wired && r.key && literal.includes(r.key)) joined.set(r.key, (joined.get(r.key) || 0) + 1);
    expect(cov.ambiguous).toEqual([]);
    for (const k of literal) {
      const n = joined.get(k) || 0;
      expect(n === 1 || (n === 0 && cov.notDrawn.includes(k)), `${k}: joined ${n}`).toBe(true);
    }
    // the only entries with no county outline are city-scoped ones (a city is not a county)
    for (const k of cov.notDrawn) expect(COUNTIES_MAP[k].cityScoped, k).toBeTruthy();
  });

  it("Louisiana keys join their parish polygons", () => {
    for (const [key, name] of [["la_lafayette", "Lafayette Parish"], ["la_eastbatonrouge", "East Baton Rouge Parish"], ["la_orleans", "Orleans Parish"]]) {
      const r = rowFor(cov, "LA", name);
      expect(r, name).toBeTruthy();
      expect(r.key).toBe(key);
      expect(r.wired).toBe(true);
    }
    expect(rowFor(cov, "LA", "Lafayette Parish").displayName).toBe("Lafayette Parish, LA");
  });

  it("Harris is the county's own server; a TxGIO-only Texas county counts as statewide", () => {
    expect(rowFor(cov, "TX", "Harris")).toMatchObject({ wired: true, kind: "own", displayName: "Harris County, TX" });
    expect(rowFor(cov, "TX", "Anderson")).toMatchObject({ wired: true, kind: "statewide" });
    expect(rowFor(cov, "TX", "Waller").kind).toBe("statewide");
  });

  it("a state with only a statewide composite counts every county in it", () => {
    const fl = cov.rows.filter((r) => r.state === "FL" && r.key && !r.key.startsWith("fl_"));
    expect(fl.every((r) => r.kind === "statewide")).toBe(true);
    expect(cov.rows.filter((r) => r.state === "FL").every((r) => r.wired)).toBe(true);
  });

  it("third-party republications are labelled, and a denial is not read as a label", () => {
    expect(rowFor(cov, "LA", "Lafayette Parish").kind).toBe("third-party");
    expect(provenanceSaysThirdParty({ verifiedNote: "Montgomery County's OWN GIS org, not a republication: 336,769 polygons." })).toBe(false);
    expect(provenanceSaysThirdParty({ verifiedNote: "SOURCE: Westwood/CSRS engineering-firm ArcGIS Online org." })).toBe(true);
  });

  it("never guesses: an ArcGIS Online host with no provenance is unclassified", () => {
    const kind = classifySourceKind({
      entry: { layerUrl: "https://services1.arcgis.com/abc/arcgis/rest/services/P/FeatureServer/0" },
      cfg: {}, prov: undefined, isStatewideUrl: () => false,
    });
    expect(kind).toBe("unclassified");
  });

  it("an unwired county is unfilled", () => {
    const unwired = cov.rows.find((r) => !r.wired);
    expect(unwired).toBeTruthy();
    expect(unwired.kind).toBeNull();
  });

  it("totals add up and the line reports them", () => {
    const t = cov.totals;
    expect(Object.values(t.byKind).reduce((a, b) => a + b, 0)).toBe(t.counties);
    expect(t.counties).toBe(cov.rows.filter((r) => r.wired).length);
    expect(totalLine(t)).toContain(`${t.counties.toLocaleString("en-US")} counties wired`);
    expect(totalLine(t)).toContain(`in ${t.states} states`);
  });

  it("RED-PROOF: deleting one registry entry drops the count", () => {
    const map = new Proxy({}, {});
    const trimmed = Object.fromEntries(Object.keys(COUNTIES_MAP).filter((k) => k !== "harris").map((k) => [k, COUNTIES_MAP[k]]));
    Object.assign(map, trimmed);
    const keyForName = (n, s) => { const k = countyKeyForName(n, s); return k === "harris" ? null : k; };
    const after = buildCoverage(payload.counties, { ...live(), countiesMap: map, keyForName });
    expect(after.totals.counties).toBeLessThan(cov.totals.counties);
    expect(rowFor(after, "TX", "Harris").wired).toBe(false);
  });

  it("names carry the right designation", () => {
    expect(countyDisplayName("Harris", "TX")).toBe("Harris County, TX");
    expect(countyDisplayName("Orleans Parish", "LA")).toBe("Orleans Parish, LA");
    expect(countyDisplayName("Denali Borough", "AK")).toBe("Denali Borough, AK");
    expect(countyDisplayName("Fairfax city", "VA")).toBe("Fairfax city, VA");
    // every bare name in the asset is one of the three states whose source publishes bare names
    const bare = new Set(payload.counties.filter((c) => !/county|parish|borough|census area|municipality|city|planning region|district of columbia/i.test(c.name)).map((c) => c.state));
    expect([...bare].sort()).toEqual(["CO", "FL", "TX"]);
  });
});

describe("county map geometry", () => {
  it("draws a path for every county, inside the box", () => {
    const geo = buildCountyPaths(payload);
    expect(geo.paths).toHaveLength(payload.counties.length);
    expect(geo.paths.filter((p) => !p).length).toBe(0);
    const nums = geo.paths.slice(0, 200).join(" ").match(/-?\d+\.\d/g).map(Number);
    expect(Math.max(...nums)).toBeLessThanOrEqual(geo.width + 1);
  });
});
