/* NEW-1 / NEW-2 (Tennessee non-state counties, 2026-10-21) — "20 Culvert St, Nashville" read "No parcel at this point" with no outlines anywhere, and a Rutherford
 * County parcel id could not be found, because Davidson and Rutherford are two of the NINE Tennessee counties the Comptroller's statewide layer does not hold
 * (it holds 86 of 95) yet neither was excluded from the composite — so every Nashville click was routed to a layer that answers zero.
 *
 * RED-PROOF: on the commit before this work `tn_statewide.excludedCounties` was ["Shelby","Chester"], a Davidson point resolved to `statewideKey: "tn_statewide"`
 * with `candidateCountiesForPoint → ["tn_statewide"]`, and there was no `tn_davidson` / `tn_rutherford`. The nine are COMPUTED from a committed copy of the layer's own
 * per-county count (fixture header), never hand-listed. Real recorded answers from both county layers live in test/fixtures/tnNonStateParcels.json. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, candidateCountiesForPoint, lineNeighbourKeysForPoint, statewideExcludesCounty, displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { interiorPointOf } from "../src/workspaces/site-planner/lib/parcelIdSearch.js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const CT = json("./fixtures/tnComptrollerCounties.json");
const REC = json("./fixtures/tnNonStateParcels.json");
beforeAll(async () => { await setCountyPolygons(json("../public/geo/county-polygons.json")); });

/* Tennessee's 95 counties in the state's own alphabetical id order (county id 1..95). */
const TN_BY_ID = ["Anderson", "Bedford", "Benton", "Bledsoe", "Blount", "Bradley", "Campbell", "Cannon", "Carroll", "Carter", "Cheatham", "Chester", "Claiborne", "Clay", "Cocke", "Coffee",
  "Crockett", "Cumberland", "Davidson", "Decatur", "DeKalb", "Dickson", "Dyer", "Fayette", "Fentress", "Franklin", "Gibson", "Giles", "Grainger", "Greene", "Grundy", "Hamblen", "Hamilton",
  "Hancock", "Hardeman", "Hardin", "Hawkins", "Haywood", "Henderson", "Henry", "Hickman", "Houston", "Humphreys", "Jackson", "Jefferson", "Johnson", "Knox", "Lake", "Lauderdale", "Lawrence",
  "Lewis", "Lincoln", "Loudon", "McMinn", "McNairy", "Macon", "Madison", "Marion", "Marshall", "Maury", "Meigs", "Monroe", "Montgomery", "Moore", "Morgan", "Obion", "Overton", "Perry",
  "Pickett", "Polk", "Putnam", "Rhea", "Roane", "Robertson", "Rutherford", "Scott", "Sequatchie", "Sevier", "Shelby", "Smith", "Stewart", "Sullivan", "Sumner", "Tipton", "Trousdale", "Unicoi",
  "Union", "Van Buren", "Warren", "Washington", "Wayne", "Weakley", "White", "Williamson", "Wilson"];
const present = new Set(CT.counties.map((c) => c.id));
const NINE = TN_BY_ID.filter((_, i) => !present.has(i + 1));

const HAVE_SOURCE = ["Chester", "Davidson", "Hamilton", "Hickman", "Montgomery", "Rutherford", "Shelby", "Williamson"];
const NAMED_GAPS = { Knox: [35.96, -83.92] };

describe("the nine counties the Comptroller's layer does not hold", () => {
  it("the fixture is the real per-county count: 86 counties present, the names line up with the layer's own", () => {
    expect(CT.counties).toHaveLength(86);
    for (const c of CT.counties) expect(TN_BY_ID[c.id - 1].toLowerCase(), `id ${c.id}`).toBe(c.name.toLowerCase());
  });
  it("is exactly Chester, Davidson, Hamilton, Hickman, Knox, Montgomery, Rutherford, Shelby, Williamson", () => {
    expect(NINE).toEqual(["Chester", "Davidson", "Hamilton", "Hickman", "Knox", "Montgomery", "Rutherford", "Shelby", "Williamson"]);
  });
  it.each(NINE.map((n) => [n]))("tn_statewide declares %s excluded — a composite is never routed a county it excludes", (n) => {
    expect(statewideExcludesCounty("tn_statewide", `${n} County`)).toBe(true);
  });
  it("excludes nothing else (an 86-county layer is still the answer for the other 86)", () => {
    expect(COUNTIES_MAP.tn_statewide.excludedCounties.length).toBe(9);
    for (const n of ["Wilson", "Sumner", "Cheatham", "Maury", "Madison", "Washington"]) expect(statewideExcludesCounty("tn_statewide", `${n} County`), n).toBe(false);
  });
});

describe("20 Culvert St, Nashville — the reported case", () => {
  const lot = REC.davidsonCulvert[0];
  const pt = interiorPointOf(lot);
  it("the recorded lot is the one Michael searched: 20 CULVERT ST, AKZO NOBEL, 9.52 ac", () => {
    expect(lot.attributes.PropAddr).toBe("20 CULVERT ST");
    expect(lot.attributes.STANPAR).toBe("10508026600");
    expect(lot.attributes.Acres).toBeCloseTo(9.52, 2);
  });
  it("resolves to Davidson County's own source, never the empty statewide composite", () => {
    const id = countyIdentity(pt.lat, pt.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("tn_davidson");
    expect(id.statewideKey).toBeUndefined();
    const c = candidateCountiesForPoint(pt.lat, pt.lng);
    expect(c).toContain("tn_davidson");
    expect(c, "the statewide layer holds zero Davidson rows").not.toContain("tn_statewide");
    expect(noParcelSourceNote(id)).toBeNull(); // the "no parcel data / may sit on a road" card cannot be raised for a wired county's lot
  });
  it("a second Nashville address (downtown) and one in the far south of the county route the same way", () => {
    for (const [lat, lng] of [[36.1627, -86.7816], [36.0300, -86.7400], [36.2000, -86.7000]]) {
      expect(countyIdentity(lat, lng).key, `${lat},${lng}`).toBe("tn_davidson");
    }
  });
  it("is token-free AGOL (no relay needed), pinned to the assessor parcel number and the situs column, with an outline floor under the 2,000-lot cap", () => {
    const c = COUNTIES.tn_davidson;
    expect(c.layerUrl).toMatch(/^https:\/\/services2\.arcgis\.com\/HdTo6HJqh92wn4D8\/.*\/Parcels_view\/FeatureServer\/0$/);
    expect(c.idField).toBe("STANPAR"); expect(c.pinIdField).toBe(true);
    expect(c.addrField).toBe("PropAddr"); expect(c.pinAddrField).toBe(true);
    expect(displayMinZoomOf("tn_davidson")).toBe(17);
  });
  it("the card's record reads from the real attributes: the 11-digit parcel number, the owner, the address, the acres", () => {
    expect(idAttrFor("tn_davidson", lot.attributes)).toBe("10508026600");
    const rec = countyRecord(lot.attributes, { idField: "STANPAR", addrField: "PropAddr" });
    expect(rec.owner).toMatch(/AKZO NOBEL/);
    expect(rec.address).toBe("20 CULVERT ST");
  });
});

describe("Rutherford County — Rhodes Development's two parcels", () => {
  it("both recorded lots are Rhodes Development Company, in Christiana", () => {
    expect(REC.rutherford.map((f) => f.attributes.ParcelID).sort()).toEqual(["156-002.01-000", "156-027.00-000"]);
    for (const f of REC.rutherford) expect(f.attributes.Owner1).toMatch(/RHODES DEVELOPMENT/);
  });
  it.each([["156-027.00-000"], ["156-002.01-000"]])("%s resolves to Rutherford's own source", (pid) => {
    const f = REC.rutherford.find((x) => x.attributes.ParcelID === pid);
    const p = interiorPointOf(f);
    expect(countyIdentity(p.lat, p.lng).key).toBe("tn_rutherford");
    const c = candidateCountiesForPoint(p.lat, p.lng);
    expect(c).toContain("tn_rutherford");
    expect(c).not.toContain("tn_statewide");
    expect(idAttrFor("tn_rutherford", f.attributes)).toBe(pid);
  });
  it("is the county's own org layer, pinned to ParcelID (not GISLINK / CAMAACCT / PropertyID), floor 16", () => {
    const c = COUNTIES.tn_rutherford;
    expect(c.layerUrl).toMatch(/services\.arcgis\.com\/36I6IHIdr660pAyH\/.*\/ParcelsCAMA1\/FeatureServer\/0$/);
    expect(c.idField).toBe("ParcelID"); expect(c.pinIdField).toBe(true);
    expect(c.idNormalizer).toBe("tn-control");
    expect(displayMinZoomOf("tn_rutherford")).toBe(16);
  });
});

describe("the counties with no usable public source say so by name — and never borrow the empty composite", () => {
  it.each(Object.entries(NAMED_GAPS))("%s County", (name, [lat, lng]) => {
    const id = countyIdentity(lat, lng);
    expect(id.name).toBe(`${name} County`);
    expect(id.status).toBe("no-source");
    expect(id.statewideKey, "must not borrow a layer that holds none of it").toBeUndefined();
    expect(noParcelSourceNote(id)).toMatch(new RegExp(`${name} County — no parcel data wired here yet`));
    expect(candidateCountiesForPoint(lat, lng)).not.toContain("tn_statewide");
  });
  it("every one of the nine is either wired to its own source or a named gap — none is left on the composite", () => {
    for (const n of NINE) expect(HAVE_SOURCE.includes(n) || n in NAMED_GAPS, n).toBe(true);
  });
});

describe("what must not move", () => {
  it("the 86 counties the layer holds still ride it (Wilson / Sumner / Cheatham, minutes from Nashville)", () => {
    for (const [lat, lng] of [[36.2000, -86.5200], [36.3100, -86.6100], [36.2600, -87.0900]]) {
      expect(candidateCountiesForPoint(lat, lng), `${lat},${lng}`).toContain("tn_statewide");
    }
  });
  it("Shelby and Chester keep their own sources", () => {
    expect(countyIdentity(35.1495, -90.049).key).toBe("tn_shelby");
    expect(countyIdentity(35.4398, -88.6414).key).toBe("tn_chester");
  });
  it("Texas is untouched: Houston still resolves to Harris, Dallas to its CAD, with no Tennessee source anywhere near", () => {
    expect(countyIdentity(29.7604, -95.3698).key).toBe("harris");
    expect(candidateCountiesForPoint(29.7604, -95.3698)).not.toContain("tn_statewide");
    expect(candidateCountiesForPoint(32.7767, -96.797).join()).not.toMatch(/tn_/);
  });
  it.each([
    ["3974 Couchville Pike — Davidson's east edge, Rutherford/Wilson across the line", 36.090873, -86.518256],
    ["733 Battle Rd — Davidson's south edge, Williamson/Rutherford across the line", 35.975431, -86.630215],
    ["9125 S Harpeth Rd — Davidson's west edge, Williamson/Cheatham across the line", 36.050677, -87.038322],
  ])("a Davidson lot on the county line still reaches Davidson's source (routed, or asked across the line): %s", (_l, lat, lng) => {
    const asked = [...candidateCountiesForPoint(lat, lng), ...lineNeighbourKeysForPoint(lat, lng)];
    expect(asked).toContain("tn_davidson");
  });
});
