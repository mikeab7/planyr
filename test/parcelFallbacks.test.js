/* NEW-2 (2026-10-28) — COUNTY FIRST, THE STATE'S LAYER WHEN THE COUNTY DOES NOT ANSWER.
 *
 * lib/parcelFallbacks.js decides what stands in for a failed county; lib/identifyWithFallback.js asks it. This file pins (1) WHICH counties gain a
 * fallback, so a registry edit that adds or loses one is a deliberate act, (2) that the rule agrees with the older text-search fallback
 * (`statewideFallbackFor`) everywhere that one speaks, (3) the refusals — a state layer that lacks the county, a county parked on the state's
 * own URL — and (4) the click orchestration with a county FORCED to fail (injected `identify`, no network): it falls through to the state's row at
 * a point inside both, never second-guesses a county that answered "no lot", and never lets a fallback's answer clear the county's silence. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, statewideFallbackFor, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import {
  COUNTY_EXTRA_FALLBACKS, stateLayerKeysFor, stateLayerCoversCounty, fallbackSpecsFor, fallbackCandidates, fallbackNoticeText, countiesWithFallback, stateLayerPhrase,
} from "../src/workspaces/site-planner/lib/parcelFallbacks.js";
import { identifyWithLineFallback } from "../src/workspaces/site-planner/lib/identifyWithFallback.js";
import { outlineKeysForView } from "../src/workspaces/site-planner/lib/parcelOutlineSet.js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

describe("which counties gain a state fallback — the pinned list", () => {
  const list = countiesWithFallback();
  const by = (st) => list.filter((r) => r.state === st).map((r) => r.county).sort();

  it("Texas: every county with its own CAD that is not parked on TxGIO (waller IS the state layer)", () => {
    expect(by("TX")).toEqual(["austintx", "brazoria", "chambers", "fortbend", "galveston", "harris", "liberty", "montgomery"]);
  });
  it("Colorado: the county rows that are not parked on the OIT composite", () => {
    expect(by("CO")).toEqual(["co_adams", "co_broomfield", "co_denver", "co_larimer", "co_weld"]);
  });
  it("Florida, Tennessee: none — every FL county row is PARKED on the state layer; every TN county row is a county the state layer lacks", () => {
    expect(by("FL")).toEqual([]);
    expect(by("TN")).toEqual([]);
  });
  it("New York: no state fallback anywhere (the 24 county rows are exactly the counties the state layer lacks); Niagara alone has a town-level one", () => {
    expect(list.filter((r) => r.state === "NY").map((r) => [r.county, r.fallbacks])).toEqual([["ny_niagara", ["Town of Cambria’s layer"]]]);
  });
  it("no other state has a county row AND a statewide layer, so no other state gains one (statewide-only states have no county row to fall back from)", () => {
    expect([...new Set(list.map((r) => r.state))].sort()).toEqual(["CO", "NY", "TX"]);
  });
});

describe("the new rule agrees with the text-search fallback wherever that one speaks", () => {
  it("Texas and Colorado: a state layer exists for a county ⇔ statewideFallbackFor is non-null", () => {
    for (const [k, c] of Object.entries(COUNTIES_MAP)) {
      if (c.statewide || !["TX", "CO"].includes(c.state)) continue;
      expect(stateLayerKeysFor(k).length > 0, k).toBe(statewideFallbackFor(k) !== null);
    }
  });
  it("and it names the same layer", () => {
    expect(COUNTIES_MAP[stateLayerKeysFor("chambers")[0]].layerUrl).toBe(statewideFallbackFor("chambers").layerUrl);
    expect(COUNTIES_MAP[stateLayerKeysFor("co_weld")[0]].layerUrl).toBe(statewideFallbackFor("co_weld").layerUrl);
  });
});

describe("the refusals", () => {
  it("a state layer that declares the county missing is never its fallback (NY and TN county rows)", () => {
    expect(stateLayerKeysFor("ny_niagara")).toEqual([]);
    expect(stateLayerKeysFor("ny_monroe")).toEqual([]);
    expect(stateLayerKeysFor("tn_shelby")).toEqual([]);
    expect(stateLayerCoversCounty("ny_statewide", "ny_niagara")).toBe(false);
    expect(stateLayerCoversCounty("txgio_statewide", "harris")).toBe(true);
  });
  it("a county parked on the state layer has no separate fallback — same URL, same outage", () => {
    expect(stateLayerKeysFor("fl_duval")).toEqual([]);
    expect(stateLayerKeysFor("waller")).toEqual([]);
  });
  it("a statewide key or an unknown key has none", () => {
    expect(stateLayerKeysFor("txgio_statewide")).toEqual([]);
    expect(stateLayerKeysFor("nowhere")).toEqual([]);
  });
  it("outline drawing: a failed county pulls in only a state layer that covers it", () => {
    const sw = (st) => Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide && c.state === st).map(([k]) => k);
    const args = (down, key) => ({ bounds: {}, down: new Set(down), sourcesForView: () => [key], statewideKeysForState: sw, stateOf: (k) => COUNTIES_MAP[k].state });
    expect([...outlineKeysForView({ ...args(["chambers"], "chambers"), coversCounty: stateLayerCoversCounty })].sort()).toEqual(["chambers", "txgio_statewide"]);
    expect([...outlineKeysForView({ ...args(["ny_niagara"], "ny_niagara"), coversCounty: stateLayerCoversCounty })]).toEqual(["ny_niagara"]);
    // the default (no predicate) is the old behaviour, byte for byte
    expect([...outlineKeysForView(args(["ny_niagara"], "ny_niagara"))].sort()).toEqual(["ny_niagara", "ny_statewide"]);
  });
});

describe("specs and candidates", () => {
  it("a failed Chambers click asks TxGIO", () => {
    const specs = fallbackSpecsFor({ failed: ["chambers"], lat: 29.78, lng: -94.67 });
    expect(specs.map((s) => [s.key, s.kind, s.label])).toEqual([["txgio_statewide", "state", "all-Texas TxGIO layer"]]);
  });
  it("a failed Niagara click in Cambria asks the town layer; in Lockport it asks NOTHING (no state polygon layer holds Niagara)", () => {
    expect(fallbackSpecsFor({ failed: ["ny_niagara"], lat: 43.1325, lng: -78.8822 }).map((s) => [s.key, s.asCounty, s.kind])).toEqual([["ny_niagara_cambria", "ny_niagara", "town"]]);
    expect(fallbackSpecsFor({ failed: ["ny_niagara"], lat: 43.1706, lng: -78.6903 })).toEqual([]);
    expect(fallbackSpecsFor({ failed: ["ny_niagara"], lat: 43.0959, lng: -79.0562 })).toEqual([]); // Niagara Falls NY
  });
  it("the Cambria cover box sits inside Niagara County and its layer is the public town copy", () => {
    const x = COUNTY_EXTRA_FALLBACKS.ny_niagara[0];
    expect(x.layerUrl).toMatch(/^https:\/\/services3\.arcgis\.com\/BPQWtme4xLWlUYsj\//);
    expect(x.cover[0] > 42.99 && x.cover[2] < 43.4 && x.cover[1] > -79.1 && x.cover[3] < -78.43).toBe(true);
  });
  it("only a county that actually failed is expanded; statewide / unknown keys and a missing point give nothing", () => {
    expect(fallbackSpecsFor({ failed: ["txgio_statewide"], lat: 29.78, lng: -94.67 })).toEqual([]);
    expect(fallbackSpecsFor({ failed: ["chambers"] })).toEqual([]);
    expect(fallbackSpecsFor({})).toEqual([]);
  });
  it("candidates carry the identify shape, keep the failed county out of the bookkeeping, and drop a spec with no URL", async () => {
    const specs = fallbackSpecsFor({ failed: ["chambers"], lat: 29.78, lng: -94.67 });
    const some = await fallbackCandidates(specs, (k) => `https://example.test/${k}`);
    expect(some).toEqual([{ county: "txgio_statewide", url: "https://example.test/txgio_statewide", statewide: true, fallback: true, asCounty: "txgio_statewide", kind: "state", label: "all-Texas TxGIO layer", failedKey: "chambers" }]);
    expect(await fallbackCandidates(specs, () => null)).toEqual([]);
    const town = await fallbackCandidates(fallbackSpecsFor({ failed: ["ny_niagara"], lat: 43.1325, lng: -78.8822 }), () => null);
    expect(town[0]).toMatchObject({ county: "ny_niagara_cambria", asCounty: "ny_niagara", statewide: false, kind: "town" });
  });
  it("the notice names the county whose server did not answer and the layer the lot came from", () => {
    expect(fallbackNoticeText({ failedKey: "fortbend", label: stateLayerPhrase("TX") })).toMatch(/^Fort Bend County’s own parcel server didn’t answer, so this lot came from the all-Texas TxGIO layer/);
    expect(fallbackNoticeText({ failedKey: "ny_niagara", label: "Town of Cambria’s layer" })).toMatch(/^Niagara County’s own parcel server didn’t answer, so this lot came from the Town of Cambria’s layer/);
    expect(fallbackNoticeText({ failedKey: "tn_davidson", label: "x" })).toMatch(/^Davidson County’s/);
  });
});

describe("Niagara County is wired to its CURRENT server and routes there", () => {
  it("the row points at the .gov server through the relay, not the dead .com host", () => {
    const url = COUNTIES_MAP.ny_niagara.layerUrl;
    expect(url).toBe("/gis-proxy/gis.niagaracounty.gov/server/rest/services/PublicViewer/Public_Viewer/FeatureServer/4");
    expect(url).not.toMatch(/niagaracounty\.com/);
  });
  it("a click in Lockport, Niagara Falls and Cambria is routed to the county row and never to the state layer", () => {
    for (const [lat, lng] of [[43.1706, -78.6903], [43.0959, -79.0562], [43.1325, -78.8822]]) {
      const c = candidateCountiesForPoint(lat, lng);
      expect(c, `${lat},${lng}`).toContain("ny_niagara");
      expect(c, `${lat},${lng}`).not.toContain("ny_statewide");
    }
  });
});

/* The click, with a county FORCED to fail. `identify` is injected: it answers per candidate from `world` ("hit" | "empty" | "fail"). */
const world = (plan) => async (list) => {
  const sources = list.map((c) => {
    const what = plan[c.county] ?? "empty";
    return { county: c.county, ok: what !== "fail", hit: what === "hit", error: what === "fail" ? new Error("down") : null, ms: 1 };
  });
  const hits = list.filter((c, i) => sources[i].hit).map((c) => ({ county: c.county, feature: { attributes: { who: c.county } } }));
  return { hits, responded: sources.filter((s) => s.ok).length, errors: sources.filter((s) => !s.ok).length, sources, complete: true };
};
const CH = { county: "chambers", url: "u/chambers", statewide: false };
const FB = (county = "txgio_statewide") => ({ county, url: `u/${county}`, statewide: true, fallback: true, asCounty: county, kind: "state", label: "all-Texas TxGIO layer", failedKey: "chambers" });

describe("the click with a county forced to fail", () => {
  it("falls through to the state's row at a point inside both, says so on the hit, and leaves the county SILENT", async () => {
    const asked = [];
    const identify = world({ chambers: "fail", txgio_statewide: "hit" });
    const res = await identifyWithLineFallback({ primary: [CH], fallbacks: async ({ silent }) => { asked.push(silent); return [FB()]; }, lng: -94.67, lat: 29.78, identify });
    expect(asked).toEqual([["chambers"]]);
    expect(res.via).toBe("fallback");
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({ county: "txgio_statewide", fallback: { kind: "state", label: "all-Texas TxGIO layer", failed: "chambers" } });
    expect(res.silent).toEqual(["chambers"]);
    expect(res.errors).toBe(1);
    expect(res.queried.map((c) => c.county)).toEqual(["chambers", "txgio_statewide"]);
  });
  it("a town fallback's hit is relabelled to the county it stands in for", async () => {
    const town = { county: "ny_niagara_cambria", url: "u/cambria", statewide: false, fallback: true, asCounty: "ny_niagara", kind: "town", label: "Town of Cambria’s layer", failedKey: "ny_niagara" };
    const res = await identifyWithLineFallback({ primary: [{ county: "ny_niagara", url: "u/n", statewide: false }], fallbacks: async () => [town], lng: -78.88, lat: 43.13, identify: world({ ny_niagara: "fail", ny_niagara_cambria: "hit" }) });
    expect(res.hits[0].county).toBe("ny_niagara");
    expect(res.hits[0].fallback.kind).toBe("town");
    expect(res.silent).toEqual(["ny_niagara"]);
  });
  it("a county that ANSWERED 'no lot here' is never second-guessed: the fallback is not even asked", async () => {
    let asked = 0;
    const res = await identifyWithLineFallback({ primary: [CH], fallbacks: async () => { asked++; return [FB()]; }, lng: 0, lat: 0, identify: world({ chambers: "empty", txgio_statewide: "hit" }) });
    expect(asked).toBe(0);
    expect(res.hits).toEqual([]);
    expect(res.errors).toBe(0);
  });
  it("a county that answers with a lot never reaches the fallback", async () => {
    let asked = 0;
    const res = await identifyWithLineFallback({ primary: [CH], fallbacks: async () => { asked++; return [FB()]; }, lng: 0, lat: 0, identify: world({ chambers: "hit" }) });
    expect(asked).toBe(0);
    expect(res.via).toBe("primary");
  });
  it("county down AND the fallback empty or down: no lot is returned and the county is STILL silent — the surface says 'couldn't reach', never 'no lot here'", async () => {
    for (const fbState of ["empty", "fail"]) {
      const res = await identifyWithLineFallback({ primary: [CH], fallbacks: async () => [FB()], lng: 0, lat: 0, identify: world({ chambers: "fail", txgio_statewide: fbState }) });
      expect(res.hits, fbState).toEqual([]);
      expect(res.errors, fbState).toBeGreaterThan(0);
      expect(res.silent, fbState).toContain("chambers");
    }
  });
  it("the county's slow retry still runs after an empty fallback", async () => {
    const calls = [];
    const identify = async (list, ...rest) => { calls.push(list.map((c) => c.county)); return world({ chambers: calls.length >= 3 ? "hit" : "fail", txgio_statewide: "empty" })(list, ...rest); };
    const res = await identifyWithLineFallback({ primary: [CH], fallbacks: async () => [FB()], lng: 0, lat: 0, identify });
    expect(calls).toEqual([["chambers"], ["txgio_statewide"], ["chambers"]]);
    expect(res.via).toBe("retry");
  });
  it("a source the primary round already asked is not asked again; a throwing or absent fallback changes nothing", async () => {
    const both = [CH, { county: "txgio_statewide", url: "u/t", statewide: true }];
    const calls = [];
    const identify = async (list, ...rest) => { calls.push(list.map((c) => c.county)); return world({ chambers: "fail", txgio_statewide: "empty" })(list, ...rest); };
    await identifyWithLineFallback({ primary: both, fallbacks: async () => [FB()], lng: 0, lat: 0, identify, retryErrored: false });
    expect(calls).toEqual([["chambers", "txgio_statewide"]]);
    const thrown = await identifyWithLineFallback({ primary: [CH], fallbacks: async () => { throw new Error("boom"); }, lng: 0, lat: 0, identify: world({ chambers: "fail" }), retryErrored: false });
    expect(thrown.hits).toEqual([]);
    expect(thrown.errors).toBe(1);
    const none = await identifyWithLineFallback({ primary: [CH], lng: 0, lat: 0, identify: world({ chambers: "fail" }), retryErrored: false });
    expect(none.hits).toEqual([]);
  });
  it("end to end through the real specs: a Lockport click with Niagara down gets no stand-in (honest 'didn't answer'); a Cambria click gets the town's lot", async () => {
    const run = async (lat, lng, plan) => {
      const res = await identifyWithLineFallback({
        primary: [{ county: "ny_niagara", url: "u/n", statewide: false }], lng, lat, retryErrored: false,
        fallbacks: async ({ silent }) => fallbackCandidates(fallbackSpecsFor({ failed: silent, lat, lng }), (k) => `u/${k}`),
        identify: world(plan),
      });
      return res;
    };
    const lockport = await run(43.1706, -78.6903, { ny_niagara: "fail" });
    expect(lockport.hits).toEqual([]);
    expect(lockport.errors).toBe(1);
    expect(lockport.queried.map((c) => c.county)).toEqual(["ny_niagara"]);
    const cambria = await run(43.1325, -78.8822, { ny_niagara: "fail", ny_niagara_cambria: "hit" });
    expect(cambria.via).toBe("fallback");
    expect(cambria.hits[0].county).toBe("ny_niagara");
  });
});

describe("wiring: every lot-click flow hands the identify its fallbacks", () => {
  it("each identifyWithLineFallback({ … }) call in the Map and the planner carries `fallbacks:` (a dead adapter would ship this green — B1120's lesson)", () => {
    for (const f of ["MapFinder.jsx", "SitePlanner.jsx"]) {
      const src = readFileSync(new URL(`../src/workspaces/site-planner/${f}`, import.meta.url), "utf8");
      const calls = [...src.matchAll(/identifyWithLineFallback\(\{([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const body of calls) expect(body, f).toMatch(/fallbacks:/);
    }
  });
  it("the planner and the Map both show the fallback's words rather than a hardcoded layer name", () => {
    const map = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    const planner = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(map).toMatch(/fallbackNoticeText\(/);
    expect(planner).toMatch(/fromFallback: fallbackNoticeText\(/);
  });
});
