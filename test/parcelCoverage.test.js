import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyKeyForName, statewideKeysForState, isStatewideLayerUrl,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { CITY_SCOPE_COUNTIES } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import {
  buildCoverage, classifySourceKind, countyDisplayName, totalLine, countyDetail, openRequestsFor, PUBLISHERS,
} from "../src/workspaces/admin/lib/parcelCoverage.js";
import { buildCountyPaths } from "../src/workspaces/admin/lib/countyMapGeometry.js";

const payload = JSON.parse(fs.readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
const live = () => ({
  countiesMap: COUNTIES_MAP, counties: COUNTIES, keyForName: countyKeyForName,
  statewideKeysForState, isStatewideUrl: isStatewideLayerUrl, verification: COUNTY_VERIFICATION,
  cityScopes: CITY_SCOPE_COUNTIES,
});
const rowFor = (cov, state, name) => cov.rows.find((r) => r.state === state && r.name === name);

let cov;
beforeAll(async () => {
  await setCountyPolygons(payload); // the registry's Texas tier derives from this same roster
  cov = buildCoverage(payload.counties, live());
});

describe("parcel coverage join (NEW-1)", () => {
  it("every literal registry key joins exactly one polygon or a city scope places it — nothing is left over", () => {
    const literal = Object.keys(COUNTIES_MAP).filter((k) => !COUNTIES_MAP[k].statewide);
    const joined = new Map();
    for (const r of cov.rows) if (r.wired && r.key && literal.includes(r.key)) joined.set(r.key, (joined.get(r.key) || 0) + 1);
    expect(cov.ambiguous).toEqual([]);
    const placed = new Set(cov.rows.flatMap((r) => r.cityParcels.map((c) => c.key)));
    for (const k of literal) {
      const n = joined.get(k) || 0;
      expect(n === 1 || (n === 0 && placed.has(k)), `${k}: joined ${n}`).toBe(true);
    }
    // NEW-3: the four city-level sources used to be listed under the map as "wired entries not drawn"; they now paint
    expect(cov.unplaced).toEqual([]);
    expect(cov).not.toHaveProperty("notDrawn");
  });

  it("NEW-3: every city-scoped registry entry declares the counties it sits in, and each exists in the roster", () => {
    const cityKeys = Object.keys(COUNTIES_MAP).filter((k) => COUNTIES_MAP[k].cityScoped);
    expect(CITY_SCOPE_COUNTIES.map((c) => c.key).sort()).toEqual(cityKeys.sort());
    for (const sc of CITY_SCOPE_COUNTIES) {
      expect(sc.counties.length, sc.key).toBeGreaterThan(0);
      for (const name of sc.counties) {
        expect(payload.counties.some((c) => c.state === sc.state && c.name.replace(/ County$/, "") === name), `${sc.key}: ${name}`).toBe(true);
      }
    }
  });

  it("NEW-3: Detroit, Sioux Falls, Kansas City and Independence render on their counties", () => {
    const cityKeysOn = (state, name) => rowFor(cov, state, name).cityParcels.map((c) => c.key).sort();
    expect(cityKeysOn("MI", "Wayne County")).toEqual(["mi_detroit"]);
    expect(cityKeysOn("SD", "Minnehaha County")).toEqual(["sd_siouxfalls"]);
    expect(cityKeysOn("MO", "Jackson County")).toEqual(["mo_independence", "mo_kansascity"]);
    expect(cityKeysOn("MO", "Clay County")).toEqual(["mo_kansascity"]);
    expect(cityKeysOn("MO", "Platte County")).toEqual(["mo_kansascity"]);
    // a county with no source of its own but a city one is painted as city-level only — not "wired"
    // (Jackson MO stopped being one on 2026-10-19: Missouri's countywide parcel layer was found — B2317680 — and the two city scopes still win inside their limits.)
    expect(rowFor(cov, "MO", "Jackson County")).toMatchObject({ wired: true, cityOnly: false, kind: "own" });
    for (const [st, nm] of [["MI", "Wayne County"]]) {
      expect(rowFor(cov, st, nm)).toMatchObject({ wired: false, cityOnly: true, kind: null });
      expect(rowFor(cov, st, nm).cityKind).toBeTruthy();
    }
    // a county that already has its own source keeps it (Sioux Falls fills a hole in Minnehaha's)
    expect(rowFor(cov, "SD", "Minnehaha County")).toMatchObject({ wired: true, cityOnly: false, kind: "own" });
  });

  it("NEW-3: the summary still adds up with city-level counties counted apart", () => {
    const t = cov.totals;
    expect(Object.values(t.byKind).reduce((a, b) => a + b, 0)).toBe(t.counties);
    expect(t.cityOnly).toBe(cov.rows.filter((r) => r.cityOnly).length);
    expect(t.cityOnly).toBe(1); // Wayne MI (Jackson MO has a countywide source since B2317680)
    expect(totalLine(t)).toContain("Plus 1 with city-level parcels only");
    // wiring counts are what they were before the city sources were placed
    expect(t.counties).toBe(cov.rows.filter((r) => r.wired).length);
  });

  it("NEW-2: the details card knows everything the registry carries about a county", () => {
    const live = () => ({ countiesMap: COUNTIES_MAP, counties: COUNTIES, verification: COUNTY_VERIFICATION });
    const harris = countyDetail(rowFor(cov, "TX", "Harris"), live());
    expect(harris).toMatchObject({ title: "Harris County, TX", kindWord: "County's own server", wired: true, registryKey: "harris" });
    expect(harris.layerUrl).toMatch(/^https:\/\//);
    expect(harris.host).toBeTruthy();
    expect(harris.fields.map((f) => f[0])).toContain("Parcel ID field");
    const wayne = countyDetail(rowFor(cov, "MI", "Wayne County"), live());
    expect(wayne).toMatchObject({ wired: false, kindWord: "City-level parcels only", registryKey: null });
    expect(wayne.cityParcels[0]).toMatchObject({ cityName: "Detroit", registryKey: "mi_detroit" });
    expect(wayne.cityParcels[0].layerUrl).toMatch(/Detroit_MP_Parcel/);
    const dead = countyDetail(cov.rows.find((r) => !r.wired && !r.cityOnly), live());
    expect(dead).toMatchObject({ wired: false, kindWord: "Not wired", layerUrl: null, cityParcels: [] });
  });

  it("NEW-2: an open County-requests row is matched to its county by state + name, wired ones are not", () => {
    const reqs = [
      { county_key: "tarrant", county_label: "Tarrant County", state: "TX", family: "detention", request_count: 3, wired: false },
      { county_key: "co_larimer", county_label: "Larimer County", state: "CO", family: "easement", request_count: 1, wired: false },
      { county_key: "harris", county_label: "Harris County", state: "TX", family: "detention", request_count: 9, wired: true },
    ];
    expect(openRequestsFor(rowFor(cov, "TX", "Tarrant"), reqs)).toHaveLength(1);
    expect(openRequestsFor(rowFor(cov, "CO", "Larimer"), reqs)).toHaveLength(1);
    expect(openRequestsFor(rowFor(cov, "TX", "Harris"), reqs)).toEqual([]); // wired = not open
    expect(openRequestsFor(rowFor(cov, "TX", "Tarrant"), undefined)).toEqual([]);
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

  it("third-party republications are labelled; a first-party source that names the copy it superseded is NOT", () => {
    expect(rowFor(cov, "LA", "Lafayette Parish").kind).toBe("third-party");
    expect(rowFor(cov, "LA", "Allen Parish")).toMatchObject({ kind: "third-party", publisherName: expect.stringContaining("DesireLine") });
    // The owner-found defect: both notes mention the Westwood copy they REPLACED.
    expect(COUNTY_VERIFICATION.la_calcasieu.verifiedNote).toMatch(/westwood/i);
    expect(COUNTY_VERIFICATION.la_jefferson.verifiedNote).toMatch(/westwood/i);
    expect(rowFor(cov, "LA", "Calcasieu Parish")).toMatchObject({ kind: "own", publisherName: "Calcasieu Parish Police Jury", host: "lak-dc-arcgis2.cppj.net" });
    expect(rowFor(cov, "LA", "Jefferson Parish")).toMatchObject({ kind: "own", host: "jpgis.jeffparish.net" });
    expect(rowFor(cov, "LA", "Jefferson Davis Parish").kind).toBe("own"); // TotaLand-hosted for the parish EDC
    expect(rowFor(cov, "FL", "Orange County")?.kind ?? rowFor(cov, "FL", "Orange").kind).toBe("statewide");
  });

  it("DATA, NOT PROSE: the publisher field alone decides, whatever the note says", () => {
    const base = { entry: { layerUrl: "https://services1.arcgis.com/x/arcgis/rest/services/P/FeatureServer/0" }, cfg: {}, isStatewideUrl: () => false };
    const prose = { verifiedNote: "Westwood copy, superseded; a THIRD-PARTY REPUBLICATION was rejected." };
    expect(classifySourceKind({ ...base, prov: { ...prose, publisher: "own" } })).toBe("own");
    expect(classifySourceKind({ ...base, prov: { ...prose, publisher: "third-party" } })).toBe("third-party");
    expect(classifySourceKind({ ...base, prov: { ...prose, publisher: "unverified" } })).toBe("unclassified");
    // never guessed: no field → unclassified, whatever the prose or host says
    expect(classifySourceKind({ ...base, prov: prose })).toBe("unclassified");
    expect(classifySourceKind({ ...base, entry: { layerUrl: "https://gis.county.gov/x/MapServer/0" }, prov: undefined })).toBe("unclassified");
  });

  it("EVERY wired registry entry carries a valid publisher + publisherName (a wiring session cannot skip it)", () => {
    const bad = [];
    for (const [key, entry] of Object.entries(COUNTIES_MAP)) {
      if (entry.statewide || entry.statewideDerived || isStatewideLayerUrl(entry.layerUrl || entry.mapServer || "")) continue; // registry-structural
      const p = COUNTY_VERIFICATION[key];
      if (!p || !PUBLISHERS.includes(p.publisher) || typeof p.publisherName !== "string" || p.publisherName.trim().length < 3) bad.push(key);
    }
    expect(bad, `entries missing publisher/publisherName in countiesProvenance.js: ${bad.join(", ")}`).toEqual([]);
  });

  it("every 'unverified' record says why in its publisherName, and the set is the known short list", () => {
    const unverified = Object.entries(COUNTY_VERIFICATION).filter(([, v]) => v.publisher === "unverified");
    for (const [k, v] of unverified) expect(v.publisherName, k).toMatch(/not established|affiliation/i);
    expect(cov.totals.byKind.unclassified).toBe(unverified.length);
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
