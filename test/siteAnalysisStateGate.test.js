/* Part A (Georgia screening) — a Site Analysis screen with no data source for the site's state reads NOT SCREENED,
 * never "none found". The failure this guards: the Texas RRC / TCEQ / TxDOT / PUC services answered an honest zero on
 * a Georgia site and a `verified` source read that zero as "none found" — a fabricated all-clear.
 *
 * ONE mechanism (PR #1902's): the registry declares where a source can answer (`SOURCE_STATE_SCOPE` / a row's own
 * `states`), `runSiteAnalysis` asks `sourceCoversState` before it queries, and `outOfStateFinding` words the gap. This
 * file adds only what Georgia needed on top: the `extraFor` cards, the road-authority + school-district seams. */
import { describe, it, expect } from "vitest";
import { GIS_SOURCES, sourceCoversState, SOURCE_OUT_OF_STATE, outOfStateDisposition, statesFor } from "../src/shared/gis/sources.js";
import {
  ANALYSIS_SOURCES, cardExistsIn, runSiteAnalysis, buildJurisdictionFinding, stateName,
} from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { outOfStateFinding } from "../src/workspaces/site-planner/lib/eiaPipelineScreenCopy.js";

// pipelines is Texas-only too, but on a Georgia site it runs the EIA approximate screen instead (PR #1902)
const TEXAS_ONLY = ["oilgas", "lpst", "growthFaults", "aadt", "ccnWater", "ccnSewer"];
const GA_CARDS = ["streamsGa", "hsiGa", "ustGa", "critHabitatGa", "gopherGa", "nrhpGa", "cemeteriesGa"];
// NEW-1 (B2095744): on a Georgia site a Texas-institution card does not render AT ALL; a generic check reads "Not screened" under a neutral name.
const GA_HIDDEN = ["oilgas", "lpst", "growthFaults", "ccnWater", "ccnSewer"];
const TEXAS_AGENCY = /\b(TCEQ|TxDOT|RRC|Railroad Commission|CCN|LPST|TWDB|PUC|Houston-area|HCFCD|BKDD)\b/i;
const ring = (lng, lat, d = 0.0012) => [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]];
const GWINNETT = ring(-83.95, 34.02);
const KATY = ring(-95.795, 29.785);
const emptyCache = { swr: (k, fn) => ({ fresh: fn().then((data) => ({ data, error: null, ts: 1, ageMs: 0 })).catch((error) => ({ data: null, error })) }) };

// A fetch that records every URL and answers "nothing here" — so a screen that RUNS reads "absent", and one that
// does not run is visible as the absence of a request.
function spyFetch() {
  const urls = [];
  const fn = async (url) => { urls.push(url); return { features: [], count: 0 }; };
  fn.urls = urls;
  return fn;
}
const jur = async () => ({ county: ["X"], city: [], etj: [], unincorporated: true, straddle: false, ages: {}, sources: [], isd: [] });
const road = async () => ({ roads: [], ageMs: 0, note: "none" });

describe("the gate (registry-driven)", () => {
  it("every Texas institution's registry row is Texas-only; the national screens are not state-scoped", () => {
    for (const id of [...TEXAS_ONLY, "pipelines", "road"]) expect(sourceCoversState(GIS_SOURCES[id], "GA"), id).toBe(false);
    for (const id of [...TEXAS_ONLY, "pipelines", "road"]) expect(sourceCoversState(GIS_SOURCES[id], "TX"), id).toBe(true);
    for (const id of ["flood", "wetlands", "epaCleanups", "transmission", "substations", "rail", "airports"]) expect(sourceCoversState(GIS_SOURCES[id], "GA"), id).toBe(true);
  });
  it("`extraFor` cards exist only in their state — absent, not 'not screened', elsewhere", () => {
    expect(cardExistsIn({ extraFor: ["GA"] }, "GA")).toBe(true);
    expect(cardExistsIn({ extraFor: ["GA"] }, "TX")).toBe(false);
    expect(cardExistsIn({ extraFor: ["GA"] }, null)).toBe(false);
    expect(cardExistsIn({}, "TX")).toBe(true);
  });
  it("the gap finding says 'Not screened in Georgia', is never green, and names the gap", () => {
    const f = outOfStateFinding({ id: "oilgas", category: "Oil & gas wells", label: "x" }, "GA");
    expect(f.status).toBe("unconfirmed");
    expect(f.summary).toMatch(/Not screened in Georgia/);
    expect(f.summary).toMatch(/not a finding about the site/);
    expect(f.outOfState).toBe(true);
    expect(f.verified).toBe(false);
    expect(stateName(null)).toBe("this state");
  });
});

describe("the registry: every Georgia card is Georgia-only", () => {
  const by = Object.fromEntries(ANALYSIS_SOURCES.map((s) => [s.id, s]));
  it("every Georgia card is extraFor GA and none leaks a Texas endpoint", () => {
    for (const id of GA_CARDS) {
      expect(by[id].extraFor, id).toEqual(["GA"]);
      expect(String(by[id].url), id).not.toMatch(/texas|rrc\.|tceq|txdot|twdb|puc/i);
    }
  });
});

describe("runSiteAnalysis on real-shaped rings", () => {
  it("⛔ GEORGIA: no Texas service is asked, Texas-institution cards do NOT render, a generic check reads NOT SCREENED under a neutral name", async () => {
    const fetchJson = spyFetch();
    const { findings } = await runSiteAnalysis([GWINNETT], { cache: emptyCache, fetchJson, identifyJurisdiction: jur, identifyRoadAuthority: road });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    for (const id of GA_HIDDEN) expect(byId[id], `${id} must not render on a Georgia site`).toBeUndefined();
    expect(byId.aadt.status).toBe("unconfirmed");
    expect(byId.aadt.outOfState).toBe(true);
    expect(byId.aadt.category).toBe("Traffic counts"); // neutral — not "Traffic (AADT)" / "TxDOT traffic counts"
    expect(byId.aadt.summary).toMatch(/Not screened in Georgia/);
    expect(byId.road.status).toBe("unconfirmed");
    expect(byId.road.outOfState).toBe(true);
    expect(byId.pipelines.approximate).toBe(true); // PR #1902: the EIA approximate screen, never "none found"
    expect(byId.pipelines.status).not.toBe("absent");
    expect(fetchJson.urls.some((u) => /gis\.rrc\.texas\.gov|tceq|txdot|twdb|Fault_Houston/i.test(u))).toBe(false);
    // no Texas agency / concept name anywhere in a Georgia report
    for (const f of findings) {
      expect(`${f.category} | ${f.label} | ${f.summary || ""} | ${f.sourceName || ""}`, f.id).not.toMatch(TEXAS_AGENCY);
    }
    // …and the Georgia cards are there, ran, and carry real answers
    for (const id of GA_CARDS) expect(byId[id], id).toBeTruthy();
    expect(byId.hsiGa.status).toBe("absent");
    expect(byId.ustGa.status).toBe("absent");
    // the national screens still ran
    expect(byId.flood.outOfState).toBeUndefined();
    expect(byId.wetlands.outOfState).toBeUndefined();
  });
  it("TEXAS: unchanged — every Texas screen runs, and no Georgia card appears (a Houston plan gains no Georgia rows)", async () => {
    const fetchJson = spyFetch();
    const { findings } = await runSiteAnalysis([KATY], { cache: emptyCache, fetchJson, identifyJurisdiction: jur, identifyRoadAuthority: road });
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(["jurisdiction", "road", "flood", "wetlands", "pipelines", "oilgas", "lpst", "epaCleanups", "growthFaults", "transmission", "substations", "aadt", "rail", "airports", "zoning", "ccnWater", "ccnSewer"]);
    expect(findings.some((f) => f.outOfState)).toBe(false);
    for (const id of GA_CARDS) expect(ids).not.toContain(id);
  });
});

describe("the jurisdiction card on Georgia ground", () => {
  const j = { county: ["Gwinnett"], city: [], etj: [], unincorporated: true, ages: {}, sources: [], isd: [] };
  it("says Georgia has no ETJ and does not print a Texas school-district blank or Texas provenance", () => {
    const f = buildJurisdictionFinding(j, "GA");
    const row = (k) => f.rows.find((r) => r[0] === k)[1];
    expect(row("ETJ")).toMatch(/None in Georgia/);
    expect(row("School district")).toBe("Not screened in Georgia");
    expect(f.sourceName).toMatch(/Georgia DCA/);
    expect(f.sourceName).not.toMatch(/TxDOT|TxGIO|H-GAC/);
  });
  it("Texas output is unchanged", () => {
    const f = buildJurisdictionFinding({ ...j, isd: ["Katy ISD"] }, "TX");
    expect(f.rows.find((r) => r[0] === "School district")[1]).toBe("Katy ISD");
    expect(f.sourceName).toBe("TxDOT / TxGIO / H-GAC");
    expect(buildJurisdictionFinding(j).sourceName).toBe("TxDOT / TxGIO / H-GAC"); // legacy caller, no state
  });
});

describe("the out-of-state policy lives in the registry (NEW-1, B2095744)", () => {
  it("every policy key is a real, state-scoped registry row", () => {
    for (const k of Object.keys(SOURCE_OUT_OF_STATE)) {
      expect(GIS_SOURCES[k], k).toBeTruthy();
      expect(Array.isArray(statesFor(GIS_SOURCES[k])), `${k} must be state-scoped for a policy to mean anything`).toBe(true);
    }
  });
  it("a Texas-institution concept is hidden everywhere it is uncovered; a generic check is never hidden except where a state replaces it", () => {
    for (const k of ["growthFaults", "ccnWater", "ccnSewer"]) for (const st of ["GA", "CO", "FL"]) expect(outOfStateDisposition(k, st).hide, `${k}/${st}`).toBe(true);
    expect(outOfStateDisposition("oilgas", "GA").hide).toBe(true);
    expect(outOfStateDisposition("oilgas", "CO")).toEqual({ hide: false, name: "Oil & gas wells" }); // a Colorado developer does expect the check
    expect(outOfStateDisposition("lpst", "GA").hide).toBe(true);   // the Georgia EPD UST card replaces it
    expect(outOfStateDisposition("lpst", "CO")).toEqual({ hide: false, name: "Leaking petroleum tanks" });
    expect(outOfStateDisposition("aadt", "GA")).toEqual({ hide: false, name: "Traffic counts" });
    expect(outOfStateDisposition("road", "GA")).toEqual({ hide: false, name: "Road authority" });
  });
  it("every neutral name is free of Texas agency names", () => {
    for (const [k, p] of Object.entries(SOURCE_OUT_OF_STATE)) if (p.name) expect(p.name, k).not.toMatch(TEXAS_AGENCY);
  });
  it("a Colorado site keeps its honest 'Not screened in Colorado' cards under neutral names and loses the Texas-only ones", async () => {
    const DEN = ring(-104.99, 39.74);
    const { findings } = await runSiteAnalysis([DEN], { cache: emptyCache, fetchJson: spyFetch(), identifyJurisdiction: jur, identifyRoadAuthority: road });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    for (const id of ["growthFaults", "ccnWater", "ccnSewer"]) expect(byId[id], id).toBeUndefined();
    expect(byId.oilgas.summary).toMatch(/Not screened in Colorado/);
    expect(byId.lpst.category).toBe("Leaking petroleum tanks");
    for (const f of findings) expect(`${f.category} | ${f.summary || ""}`, f.id).not.toMatch(TEXAS_AGENCY);
  });
});
