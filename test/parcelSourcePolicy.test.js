/* NEW-2 / NEW-3 — ONE URL, ONE POLICY; AND A TRUNCATED DRAW MUST NEVER LOOK COMPLETE.
 *
 * The owner's Colorado report turned out to be two structural defects hiding behind one banner:
 *
 *  NEW-2  `co_larimer.layerUrl` was byte-identical to `co_statewide.layerUrl`. `MapFinder.addDisplay`
 *         keys its display map by COUNTY, so it added two identical Leaflet layers over the same
 *         ground and doubled every request to the slowest host in the app. Worse, the 8s display
 *         hang-guard exempts the statewide composite by testing `STATEWIDE_KEYS` — a property of the
 *         KEY — so the county-keyed copy of the SAME endpoint got the opposite policy: the guard
 *         fired, the breaker opened, and the banner told the owner his county server was slow while
 *         pointing him at that very host.
 *
 *  NEW-3  One view-sized bbox against that composite returned exactly 2000 features with
 *         `exceededTransferLimit = true`, in 1.5 s, and the app drew them and said nothing.
 *
 * These are the pure halves of both fixes. The Leaflet wiring that consumes them lives in
 * MapFinder; what is asserted here is the DECISION each one makes.
 */
import { describe, it, expect } from "vitest";
import {
  COUNTIES, COUNTIES_MAP, STATEWIDE_KEYS, STATEWIDE_LAYER_URLS,
  isStatewideLayerUrl, trimLayerUrl, sharedLayerUrlConflicts,
} from "../src/workspaces/site-planner/lib/counties.js";
import {
  responseWasTruncated, featureCountOf, parcelTruncationNotice,
} from "../src/workspaces/site-planner/lib/parcelTruncation.js";

describe("NEW-2 — the statewide policy follows the URL, not the key", () => {
  it("recognises BOTH states' composites by URL", () => {
    expect(STATEWIDE_LAYER_URLS.length).toBe(2);
    for (const url of STATEWIDE_LAYER_URLS) expect(isStatewideLayerUrl(url)).toBe(true);
    // …and every key flagged `statewide` resolves to one of them, so the two views agree.
    for (const key of STATEWIDE_KEYS) expect(isStatewideLayerUrl(COUNTIES_MAP[key].layerUrl)).toBe(true);
  });

  it("a COUNTY parked on a composite gets the composite's policy — the exact Larimer defect", () => {
    // Waller is the Texas instance of the same shape and is still live today.
    expect(STATEWIDE_KEYS.includes("waller")).toBe(false);          // not flagged statewide…
    expect(isStatewideLayerUrl(COUNTIES.waller.layerUrl)).toBe(true); // …but its URL IS the composite
    // Every Colorado county still on the composite, likewise.
    for (const k of ["co_arapahoe", "co_jefferson", "co_elpaso", "co_boulder"])
      expect(isStatewideLayerUrl(COUNTIES[k].layerUrl), k).toBe(true);
  });

  it("a county with its OWN endpoint is never treated as statewide", () => {
    for (const k of ["harris", "fortbend", "chambers", "co_larimer", "co_weld", "co_denver", "co_adams", "co_broomfield"])
      expect(isStatewideLayerUrl(COUNTIES[k].layerUrl), k).toBe(false);
  });

  it("Larimer is off the composite entirely — the report's root cause", () => {
    expect(COUNTIES.co_larimer.layerUrl).not.toBe(COUNTIES_MAP.co_statewide.layerUrl);
    expect(COUNTIES.co_larimer.layerUrl).toMatch(/maps1\.larimer\.org/);
    expect(COUNTIES.co_larimer.idField).toBe("PARCELNUM");
    expect(COUNTIES.co_larimer.addrField).toBe("LOCADDRESS");
    // The layer is Larimer-only, so a county scope on it would be wrong, not merely redundant.
    expect(COUNTIES.co_larimer.scopeWhere).toBeUndefined();
    // Its bbox must actually contain the site in the report — I-25 at E County Road 30.
    const [s, w, n, e] = COUNTIES_MAP.co_larimer.bbox;
    expect(40.44).toBeGreaterThanOrEqual(s);
    expect(40.44).toBeLessThanOrEqual(n);
    expect(-104.985).toBeGreaterThanOrEqual(w);
    expect(-104.985).toBeLessThanOrEqual(e);
  });

  it("trimLayerUrl makes the comparison robust to a trailing slash", () => {
    const u = COUNTIES_MAP.co_statewide.layerUrl;
    expect(isStatewideLayerUrl(u + "/")).toBe(true);
    expect(isStatewideLayerUrl(" " + u + " ")).toBe(true);
    expect(trimLayerUrl(u + "///")).toBe(u);
    for (const junk of [null, undefined, "", "https://example.com/x/MapServer/0"]) expect(isStatewideLayerUrl(junk)).toBe(false);
  });
});

describe("NEW-2 — the dev-time assertion that stops the next county reintroducing this", () => {
  it("the shipped config is clean: no two entries share a NON-statewide URL", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it("sharing a COMPOSITE url is allowed — that is the sanctioned parking pattern", () => {
    const map = {
      co_statewide: { statewide: true, layerUrl: COUNTIES_MAP.co_statewide.layerUrl },
      co_boulder: { layerUrl: COUNTIES_MAP.co_statewide.layerUrl },
      co_elpaso: { layerUrl: COUNTIES_MAP.co_statewide.layerUrl },
    };
    expect(sharedLayerUrlConflicts(map)).toEqual([]);
  });

  it("two REAL counties sharing one endpoint is reported, with both keys named", () => {
    const url = "https://example.gov/arcgis/rest/services/Parcels/MapServer/0";
    const bad = sharedLayerUrlConflicts({ a: { layerUrl: url }, b: { layerUrl: url + "/" }, c: { layerUrl: url + "9" } });
    expect(bad.length).toBe(1);
    expect(bad[0].keys.sort()).toEqual(["a", "b"]);
    expect(bad[0].url).toBe(url);
  });

  it("ignores entries with no endpoint at all rather than grouping them together", () => {
    expect(sharedLayerUrlConflicts({ a: {}, b: { layerUrl: null }, c: { layerUrl: "" } })).toEqual([]);
  });
});

describe("NEW-3 — a truncated parcel draw must never look like a complete one", () => {
  it("reads the flag in every shape a real ArcGIS service returns it", () => {
    expect(responseWasTruncated({ features: [], exceededTransferLimit: true })).toBe(true);
    // GeoJSON output has carried it under `properties` across versions — the same both-shapes check
    // the nightly snapshot builder already makes (and the Waller undercount that taught us).
    expect(responseWasTruncated({ type: "FeatureCollection", features: [], properties: { exceededTransferLimit: true } })).toBe(true);
    expect(responseWasTruncated({ features: [], transferLimitExceeded: true })).toBe(true);
  });

  it("a COMPLETE answer is never reported as truncated", () => {
    expect(responseWasTruncated({ features: [1, 2, 3] })).toBe(false);
    expect(responseWasTruncated({ features: [], exceededTransferLimit: false })).toBe(false);
    expect(responseWasTruncated({ features: [], properties: {} })).toBe(false);
    for (const junk of [null, undefined, "", 0, []]) expect(responseWasTruncated(junk)).toBe(false);
  });

  it("counts what actually arrived, and degrades rather than throwing", () => {
    expect(featureCountOf({ features: new Array(2000).fill(0) })).toBe(2000);
    expect(featureCountOf({})).toBe(0);
    expect(featureCountOf(null)).toBe(0);
  });

  it("the notice NAMES what happened and what to do — never a silent truncation", () => {
    const msg = parcelTruncationNotice(2000);
    expect(msg).toMatch(/2,000/);
    expect(msg).toMatch(/missing/i);
    expect(msg).toMatch(/zoom in/i);
    // Non-blocking: it still tells the owner that clicking a lot works.
    expect(msg).toMatch(/clicking a lot still adds it/i);
    // An unreadable count still produces an honest sentence rather than "undefined lots".
    expect(parcelTruncationNotice(0)).not.toMatch(/undefined|NaN/);
    expect(parcelTruncationNotice(null)).not.toMatch(/undefined|NaN/);
  });
});
