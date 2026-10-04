import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

/* NEW-1 (statewide-covered "no parcel data wired" note) — a county whose ONLY parcel source is a
 * statewide layer (California, Nevada, Rhode Island, Maine, DC, …) resolved to `no-source` because
 * its key is not a per-county entry, so an empty-spot click (a street) printed the coverage-gap
 * sentence for a county that IS covered. The identity's STATUS is deliberately unchanged (candidate
 * routing and `countyForView` read it); it now also carries `statewideKey`, and the sentence is
 * withheld for it. Real committed county polygons, no fixture. */
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

describe("a statewide-covered county never reads as a coverage gap", () => {
  it.each([
    ["San Francisco (a street, V1435953 step 3)", 37.750733, -122.400883, "ca_statewide"],
    ["Ontario, CA (San Bernardino Co.)", 34.0633, -117.6509, "ca_statewide"],
    ["Las Vegas (Clark Co., NV)", 36.1699, -115.1398, "nv_statewide"],
    ["Reno (Washoe Co., NV)", 39.5296, -119.8138, "nv_statewide"],
    ["Providence, RI", 41.824, -71.4128, "ri_statewide"],
    ["Portland, ME", 43.6591, -70.2568, "me_statewide"],
    ["Washington, DC", 38.9072, -77.0369, "dc_statewide"],
  ])("%s → no gap note", (_l, lat, lng, key) => {
    const id = countyIdentity(lat, lng);
    expect(id.status).toBe("no-source"); // routing contract unchanged
    expect(id.statewideKey).toBe(key);
    expect(noParcelSourceNote(id)).toBeNull();
  });

  it("genuine gaps keep their sentence: Wayne County MI, Lafayette Parish LA", () => {
    expect(noParcelSourceNote(countyIdentity(42.224770, -83.263421))).toBe("Wayne County — no parcel data wired here yet.");
    expect(noParcelSourceNote(countyIdentity(30.2241, -92.0198))).toBe("Lafayette Parish — no parcel data wired here yet.");
  });

  it("Texas keeps its behaviour: an unwired Texas county still gets the gap sentence", () => {
    // Every Texas county currently derives a row, so the unwired case is expressed on the identity.
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Walker", state: "TX" }))
      .toBe("Walker County — no parcel data wired here yet.");
    expect(noParcelSourceNote({ status: "no-source", key: null, name: "Mesa", state: "CO", statewideKey: undefined }))
      .toBe("Mesa — no parcel data wired here yet.");
  });

  it("a wired county is untouched", () => {
    const id = countyIdentity(29.76, -95.37);
    expect(id.status).toBe("ok");
    expect(id.statewideKey).toBeUndefined();
    expect(noParcelSourceNote(id)).toBeNull();
  });
});
