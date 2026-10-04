/* Part A (Georgia screening) — a Site Analysis screen with no data source for the site's state reads NOT SCREENED,
 * never "none found". The failure this guards: the Texas RRC / TCEQ / TxDOT / PUC services answered an honest zero on
 * a Georgia site and a `verified` source read that zero as "none found" — a fabricated all-clear. */
import { describe, it, expect } from "vitest";
import {
  ANALYSIS_SOURCES, screenAppliesIn, cardExistsIn, notScreenedFinding, runSiteAnalysis, buildJurisdictionFinding, stateName,
} from "../src/workspaces/site-planner/lib/siteAnalysis.js";

const TEXAS_ONLY = ["oilgas", "pipelines", "lpst", "growthFaults", "aadt", "ccnWater", "ccnSewer"];
const GA_CARDS = ["streamsGa", "hsiGa", "critHabitatGa", "gopherGa", "nrhpGa", "cemeteriesGa"];
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

describe("the gate predicate", () => {
  it("a source with no `states` is national and always runs; a scoped one runs only in its own state", () => {
    expect(screenAppliesIn({}, "GA")).toBe(true);
    expect(screenAppliesIn({}, null)).toBe(true);
    expect(screenAppliesIn({ states: ["TX"] }, "TX")).toBe(true);
    expect(screenAppliesIn({ states: ["TX"] }, "GA")).toBe(false);
    expect(screenAppliesIn({ states: ["TX"] }, "CO")).toBe(false);
  });
  it("a site whose state can't be named is NOT in Texas, so a Texas-only screen does not run", () => {
    expect(screenAppliesIn({ states: ["TX"] }, null)).toBe(false);
  });
  it("`extraFor` cards exist only in their state — absent, not 'not screened', elsewhere", () => {
    expect(cardExistsIn({ extraFor: ["GA"] }, "GA")).toBe(true);
    expect(cardExistsIn({ extraFor: ["GA"] }, "TX")).toBe(false);
    expect(cardExistsIn({ extraFor: ["GA"] }, null)).toBe(false);
    expect(cardExistsIn({}, "TX")).toBe(true);
  });
  it("the not-screened finding is a distinct status, never clear, and names the state", () => {
    const f = notScreenedFinding({ id: "oilgas", category: "Oil & gas wells", label: "x", states: ["TX"], sourceName: "RRC" }, "GA");
    expect(f.status).toBe("notscreened");
    expect(f.summary).toMatch(/Not screened in Georgia/);
    expect(f.caveat).toMatch(/not a finding about the site/);
    expect(f.verified).toBe(false);
    expect(stateName(null)).toBe("this state");
  });
});

describe("the registry: every Texas institution is tagged, every Georgia card is Georgia-only", () => {
  const by = Object.fromEntries(ANALYSIS_SOURCES.map((s) => [s.id, s]));
  it("the seven Texas-only screens declare states: [TX]", () => {
    for (const id of TEXAS_ONLY) expect(by[id].states, id).toEqual(["TX"]);
  });
  it("the national screens (flood, wetlands, EPA, HIFLD, rail, airports) declare no state scope", () => {
    for (const id of ["flood", "wetlands", "epaCleanups", "transmission", "substations", "rail", "airports"]) expect(by[id].states, id).toBeUndefined();
  });
  it("every Georgia card is extraFor GA and none leaks a Texas endpoint", () => {
    for (const id of GA_CARDS) {
      expect(by[id].extraFor, id).toEqual(["GA"]);
      expect(String(by[id].url), id).not.toMatch(/texas|rrc\.|tceq|txdot|twdb|puc/i);
    }
  });
});

describe("runSiteAnalysis on real-shaped rings", () => {
  it("⛔ GEORGIA: no Texas service is ever asked, and every Texas-only screen reads NOT SCREENED — never 'none found'", async () => {
    const fetchJson = spyFetch();
    const { findings } = await runSiteAnalysis([GWINNETT], { cache: emptyCache, fetchJson, identifyJurisdiction: jur, identifyRoadAuthority: road });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    for (const id of TEXAS_ONLY) {
      expect(byId[id].status, id).toBe("notscreened");
      expect(byId[id].summary, id).toMatch(/Georgia/);
    }
    expect(byId.road.status).toBe("notscreened"); // TxDOT Roadway Inventory
    expect(fetchJson.urls.some((u) => /gis\.rrc\.texas\.gov|tceq|txdot|twdb|Fault_Houston/i.test(u))).toBe(false);
    // …and the Georgia cards are there, ran, and carry real answers
    for (const id of GA_CARDS) expect(byId[id], id).toBeTruthy();
    expect(byId.hsiGa.status).toBe("absent");
    // the national screens still ran
    expect(byId.flood.status).not.toBe("notscreened");
    expect(byId.wetlands.status).not.toBe("notscreened");
  });
  it("TEXAS: unchanged — every Texas screen runs, and no Georgia card appears (a Houston plan gains no Georgia rows)", async () => {
    const fetchJson = spyFetch();
    const { findings } = await runSiteAnalysis([KATY], { cache: emptyCache, fetchJson, identifyJurisdiction: jur, identifyRoadAuthority: road });
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(["jurisdiction", "road", "flood", "wetlands", "pipelines", "oilgas", "lpst", "epaCleanups", "growthFaults", "transmission", "substations", "aadt", "rail", "airports", "zoning", "ccnWater", "ccnSewer"]);
    expect(findings.some((f) => f.status === "notscreened")).toBe(false);
    for (const id of GA_CARDS) expect(ids).not.toContain(id);
  });
  it("a site outside every known state (the Florida panhandle, say) is not screened by Texas-only sources either", async () => {
    const fetchJson = spyFetch();
    const { findings } = await runSiteAnalysis([ring(-87.2, 30.45)], { cache: emptyCache, fetchJson, identifyJurisdiction: jur, identifyRoadAuthority: road });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    expect(byId.oilgas.status).toBe("notscreened");
    expect(byId.oilgas.summary).toMatch(/this state/);
    expect(findings.some((f) => GA_CARDS.includes(f.id))).toBe(false);
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
