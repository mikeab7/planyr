/* NEW-2 — ONE URL, ONE POLICY.
 *
 * The owner's Colorado report's root cause: `co_larimer.layerUrl` was byte-identical to
 * `co_statewide.layerUrl`. `MapFinder.addDisplay` keys its display map by COUNTY, so it added
 * two identical Leaflet layers over the same ground and doubled every request to the slowest
 * host in the app. Worse, the 8s display hang-guard exempts the statewide composite by testing
 * `STATEWIDE_KEYS` — a property of the KEY — so the county-keyed copy of the SAME endpoint got
 * the opposite policy: the guard fired, the breaker opened, and the banner told the owner his
 * county server was slow while pointing him at that very host.
 *
 * This is the pure half of the fix. The Leaflet wiring that consumes it lives in MapFinder;
 * what is asserted here is the DECISION it makes.
 *
 * (The sibling "a truncated draw must never look like a complete one" defect this file used to
 * cover here — `parcelTruncation.js`'s NEW-3 — was retired 2026-09-24, NEW-1: the vector display
 * that could be cut short by a real CAD's own record cap now steps aside for a server-rendered
 * image layer with no such cap before that ever happens. See `parcelDisplayZoom.test.js` and
 * `parcelDisplay.js`.)
 */
import { describe, it, expect } from "vitest";
import {
  COUNTIES, COUNTIES_MAP, STATEWIDE_KEYS, STATEWIDE_LAYER_URLS,
  isStatewideLayerUrl, trimLayerUrl, sharedLayerUrlConflicts,
} from "../src/workspaces/site-planner/lib/counties.js";

describe("NEW-2 — the statewide policy follows the URL, not the key", () => {
  it("recognises every state's composite by URL (NEW-1 raised this from 2 to 21 — the derivation, not the count, is what's asserted)", () => {
    expect(STATEWIDE_LAYER_URLS.length).toBe(STATEWIDE_KEYS.length);
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
