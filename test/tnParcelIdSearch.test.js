/* NEW-2 (Tennessee non-state counties, 2026-10-21) — type a Rutherford County parcel id (any spacing / dots / dashes) into the Site search and land on that lot,
 * selected; a missing id is a plain "not found", never a silent no-op; an address or place is never mistaken for an id. And NEW-1's snap: a geocoded address that
 * lands in the road is walked to the lot its house number + street name.
 *
 * RED-PROOF: on the commit before this work the search box was address-only (`goAddress` → geocoder), `lookupParcels` stored no normaliser, and `156-027.00-000`
 * reached a geocoder that has no idea what a control map is. The recorded lots are the real answers of the two county layers (test/fixtures/tnNonStateParcels.json). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseControlMapId, digitsOnlyId, tnParcelIdPlan, looksLikeTnParcelId, normalizeIdFor, pickIdMatch } from "../src/workspaces/site-planner/lib/tnParcelId.js";
import { resolveParcelId, parcelIdMessage, interiorPointOf } from "../src/workspaces/site-planner/lib/parcelIdSearch.js";
import { houseAndStreet, pickAddressSnap } from "../src/workspaces/site-planner/lib/addressSnap.js";
import { buildPlaceRows, resolvePlaceEnter } from "../src/workspaces/site-planner/lib/placeSuggestRows.js";
import { situsAddress } from "../src/workspaces/site-planner/lib/appraisal.js";

const REC = JSON.parse(readFileSync(new URL("./fixtures/tnNonStateParcels.json", import.meta.url), "utf8"));
const R27 = REC.rutherford.find((f) => f.attributes.ParcelID === "156-027.00-000");
const R02 = REC.rutherford.find((f) => f.attributes.ParcelID === "156-002.01-000");

/* point in the outer ring (ray cast) */
const inside = ({ lat, lng }, f) => {
  const r = f.geometry.rings[0]; let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

describe("reading a Tennessee control-map id however it is typed", () => {
  it.each([
    "156-027.00-000", "156 027.00 000", "156.027.00.000", "15602700000", "156-027.00 - 000", "  156-027.00-000  ", "parcel id: 156-027.00-000",
    "Parcel ID 156 027.00 000", "APN 156-027.00-000", "tn 156-027.00-000", "#156-027.00-000", "156_027.00_000", "156/027.00/000",
  ])("%j → 156-027.00-000", (t) => { expect(parseControlMapId(t).canonical).toBe("156-027.00-000"); });
  it("the other Rhodes lot: 156 002.01 000 → 156-002.01-000", () => {
    expect(parseControlMapId("156 002.01 000").canonical).toBe("156-002.01-000");
    expect(parseControlMapId("156002.01000").canonical).toBe("156-002.01-000");
  });
  it("a lettered control map with a group keeps both letters (046E-A-001.00-000)", () => {
    expect(parseControlMapId("046E A 001.00 000").canonical).toBe("046E-A-001.00-000");
    expect(parseControlMapId("046EA00100000").canonical).toBe("046E-A-001.00-000");
  });
  it("without the special-interest part it is still found, by prefix (156-027.00)", () => {
    expect(parseControlMapId("156-027.00").canonical).toBe("156-027.00");
  });
  it("a lettered map typed without its group letter becomes a wildcard form that still finds it", () => {
    expect(parseControlMapId("046E 001.00 000").prefix).toBe("046E%001.00-000");
  });
  it.each(["20 Culvert St, Nashville, TN", "1600 Pennsylvania Ave", "Murfreesboro, TN", "Epps Mill Rd", "I-24 exit 89", "37210", "156", "", null, "156-027", "12 34 56", "123-456-789", "1234567890", "123456789012"])(
    "%j is NOT an id — it goes to the geocoder as before", (t) => {
      expect(parseControlMapId(t)).toBeNull();
      expect(looksLikeTnParcelId(t)).toBe(false);
    });
});

describe("Davidson's 11-digit assessor number", () => {
  it("reads digits however spaced", () => {
    expect(digitsOnlyId("10508026600")).toBe("10508026600");
    expect(digitsOnlyId("105 08 0 266.00")).toBe("10508026600");
    expect(digitsOnlyId("105-08-0-266.00")).toBe("10508026600");
  });
  it("an 11-digit number is a valid control-map id AND a valid Davidson number — BOTH counties are asked, never a guess", () => {
    const plan = tnParcelIdPlan("10508026600");
    expect(plan.map((p) => p.county).sort()).toEqual(["tn_davidson", "tn_rutherford"]);
  });
  it("a dotted control-map id with a letter-free form is asked of Rutherford; only digits-only forms reach Davidson", () => {
    expect(tnParcelIdPlan("046E-A-001.00-000").map((p) => p.county)).toEqual(["tn_rutherford"]);
  });
});

describe("the in-planner parcel-ID lookup normalises for the county that declares it", () => {
  it("Rutherford stores ParcelID dashed; a spaced id is rebuilt, an unparseable one is left alone, other counties pass through", () => {
    expect(normalizeIdFor("tn-control", "156 027.00 000")).toBe("156-027.00-000");
    expect(normalizeIdFor("tn-control", "02700")).toBe("02700");
    expect(normalizeIdFor(undefined, "156 027.00 000")).toBe("156 027.00 000");
  });
});

describe("resolveParcelId — typed id → the lot (recorded answers, injected lookup)", () => {
  const lookupFrom = (table) => async ({ county, value }) => {
    if (table[county] instanceof Error) throw table[county];
    const rows = (table[county] || []).filter((f) => !value || String(f.attributes.ParcelID).replace(/\W/g, "").toUpperCase().startsWith(String(value).replace(/\W/g, "").toUpperCase().replace(/%.*/, "")));
    return { feats: rows };
  };
  it("156-027.00-000 → that lot, Rhodes Development, with a point INSIDE its outline", async () => {
    const r = await resolveParcelId("156-027.00-000", { lookup: lookupFrom({ tn_rutherford: REC.rutherford }) });
    expect(r.status).toBe("found");
    expect(r.county).toBe("tn_rutherford");
    expect(r.feature.attributes.Owner1).toMatch(/RHODES DEVELOPMENT/);
    expect(r.label).toMatch(/Parcel 156-027\.00-000 · Rutherford County, TN/);
    expect(inside(r.point, R27)).toBe(true);
    expect(inside(r.point, R02), "and not inside the neighbouring Rhodes lot").toBe(false);
  });
  it("156-002.01-000 → the 37-acre lot, point inside it", async () => {
    const r = await resolveParcelId("156 002.01 000", { lookup: lookupFrom({ tn_rutherford: REC.rutherford }) });
    expect(r.status).toBe("found");
    expect(r.feature.attributes.CALCACRES).toBeCloseTo(37.0, 0);
    expect(inside(r.point, R02)).toBe(true);
  });
  it("both ids resolve independently to two different lots (selecting both is then two searches → one selection set)", async () => {
    const lk = lookupFrom({ tn_rutherford: REC.rutherford });
    const [a, b] = await Promise.all([resolveParcelId("156-027.00-000", { lookup: lk }), resolveParcelId("156-002.01-000", { lookup: lk })]);
    expect(a.feature.attributes.ParcelID).not.toBe(b.feature.attributes.ParcelID);
    expect(a.point).not.toEqual(b.point);
  });
  it("an id that does not exist is `notfound`, names every county it asked, and says what to do — never a silent no-op", async () => {
    const r = await resolveParcelId("156-999.00-000", { lookup: lookupFrom({ tn_rutherford: REC.rutherford }) });
    expect(r.status).toBe("notfound");
    expect(r.tried).toEqual(["Rutherford", "Davidson"]); // an 11-digit dashed id is also a valid Metro number — both are asked
    const msg = parcelIdMessage(r, "156-999.00-000");
    expect(msg).toMatch(/No Tennessee parcel with ID "156-999\.00-000" in Rutherford and Davidson counties/);
    expect(msg).toMatch(/address/);
  });
  it("a county that did not ANSWER is `unavailable` — 'couldn't check', never 'does not exist'", async () => {
    const r = await resolveParcelId("156-999.00-000", { lookup: lookupFrom({ tn_rutherford: new Error("timeout") }) });
    expect(r.status).toBe("unavailable");
    expect(parcelIdMessage(r, "156-999.00-000")).toMatch(/Couldn't reach the Rutherford County parcel server/);
  });
  it("one county down and another empty is still `unavailable` (the id may live in the one that did not answer)", async () => {
    const r = await resolveParcelId("10508026600", { lookup: lookupFrom({ tn_rutherford: new Error("x"), tn_davidson: [] }) });
    expect(r.status).toBe("unavailable");
    expect(r.failed).toEqual(["Rutherford"]);
  });
  it("an 11-digit Metro number finds the Davidson lot (Davidson answers, Rutherford is empty)", async () => {
    const d = REC.davidsonCulvert[0];
    const lk = async ({ county }) => (county === "tn_davidson" ? { feats: [d] } : { feats: [] });
    const r = await resolveParcelId("10508026600", { lookup: lk });
    expect(r.status).toBe("found");
    expect(r.county).toBe("tn_davidson");
    expect(inside(r.point, d)).toBe(true);
  });
  it("text that is not an id is `none` — the caller geocodes it", async () => {
    expect((await resolveParcelId("20 Culvert St, Nashville", { lookup: async () => { throw new Error("must not be called"); } })).status).toBe("none");
  });
  it("a record with no polygon is `notfound` with a reason, never a point at 0,0", async () => {
    const noGeom = { attributes: { ParcelID: "156-027.00-000", Owner1: "X" }, geometry: null };
    const r = await resolveParcelId("156-027.00-000", { lookup: async () => ({ feats: [noGeom] }) });
    expect(r.status).toBe("notfound");
    expect(r.reason).toBe("no-geometry");
  });
});

describe("pickIdMatch", () => {
  const f = (id) => ({ attributes: { ParcelID: id } });
  const attr = (x) => x.attributes.ParcelID;
  it("exact wins over a longer neighbour; several partials are ambiguous (null)", () => {
    expect(pickIdMatch([f("156-027.00-000"), f("156-027.00-001")], "156-027.00-000", attr).attributes.ParcelID).toBe("156-027.00-000");
    expect(pickIdMatch([f("156-027.00-001"), f("156-027.00-002")], "156-027.00", attr)).toBeNull();
    expect(pickIdMatch([f("156-027.00-000")], "156-027.00", attr).attributes.ParcelID).toBe("156-027.00-000");
    expect(pickIdMatch([], "x", attr)).toBeNull();
  });
});

describe("the search box offers the id search itself", () => {
  it("an id leads the list with its own row, and the geocoder's 'No matches' note is not shown over it", () => {
    const a = buildPlaceRows("nomatch", [], "156-027.00-000");
    expect(a.rows[0]).toEqual({ kind: "parcelId", text: "156-027.00-000" });
    expect(a.noMatchNote).toBeNull();
    const b = buildPlaceRows("ready", [{ label: "x", lat: 1, lon: 2 }], "156-027.00-000");
    expect(b.rows[0].kind).toBe("parcelId");
  });
  it("Enter on an id runs the raw search (which goAddress hands to the id lookup first)", () => {
    const { rows } = buildPlaceRows("loading", [], "156-027.00-000");
    expect(resolvePlaceEnter(rows, -1, "156-027.00-000")).toEqual({ type: "raw", text: "156-027.00-000" });
    expect(resolvePlaceEnter(rows, 0, "156-027.00-000")).toEqual({ type: "raw", text: "156-027.00-000" });
  });
  it("an address gets no id row — the existing rows are byte-for-byte what they were", () => {
    expect(buildPlaceRows("nomatch", [], "zzznotaplace").rows.map((r) => r.kind)).toEqual(["searchAnyway", "dropPin"]);
    expect(buildPlaceRows("ready", [], "20 Culvert St").rows.map((r) => r.kind)).toEqual(["raw"]);
  });
});

describe("snapping an address that landed in the road to the lot it names (NEW-1)", () => {
  const culvert = REC.davidsonCulvert[0];
  const other = { attributes: { ...culvert.attributes, PropAddr: "10 CULVERT ST", STANPAR: "10508026700" }, geometry: culvert.geometry };
  const wrongNo = { attributes: { ...culvert.attributes, PropAddr: "120 CULVERT ST", STANPAR: "x" }, geometry: culvert.geometry };
  const wrongSt = { attributes: { ...culvert.attributes, PropAddr: "20 LESTER AVE", STANPAR: "y" }, geometry: culvert.geometry };
  const opts = { addrOf: (f) => situsAddress(f.attributes), centreOf: interiorPointOf };
  const lot = interiorPointOf(culvert);
  const road = { lat: lot.lat + 0.0006, lng: lot.lng }; // ~65 m off, where a geocoder would put the street centreline
  it("reads house + street from a geocoder label and a situs line", () => {
    expect(houseAndStreet("20 Culvert St, Nashville, Tennessee, 37210")).toEqual({ house: "20", street: "CULVERT" });
    expect(houseAndStreet("20 CULVERT ST")).toEqual({ house: "20", street: "CULVERT" });
    expect(houseAndStreet("1204 N Main St")).toEqual({ house: "1204", street: "MAIN" });
    expect(houseAndStreet("Culvert St, Nashville")).toBeNull();
    expect(houseAndStreet("Nashville, TN")).toBeNull();
  });
  it("20 Culvert St (geocoded into the road) → the 20 CULVERT ST lot, among look-alikes", () => {
    const hit = pickAddressSnap([wrongNo, wrongSt, other, culvert], "20 Culvert St, Nashville, Tennessee, 37210", road, opts);
    expect(hit.attributes.STANPAR).toBe("10508026600");
  });
  it("never snaps across a long distance, never chooses between two equal matches, never without a house number", () => {
    expect(pickAddressSnap([culvert], "20 Culvert St, Nashville", { lat: lot.lat + 0.01, lng: lot.lng }, opts)).toBeNull();
    expect(pickAddressSnap([culvert, { ...culvert, attributes: { ...culvert.attributes, STANPAR: "z" } }], "20 Culvert St", road, opts)).toBeNull();
    expect(pickAddressSnap([culvert], "Culvert St, Nashville", road, opts)).toBeNull();
    expect(pickAddressSnap([], "20 Culvert St", road, opts)).toBeNull();
  });
});
