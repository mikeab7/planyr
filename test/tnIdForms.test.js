/* NEW-2 (Tennessee 95-county sweep, 2026-10-22) — the id every Tennessee card SHOWS must be findable from the Site search box. Until now only Rutherford's dashed id and Davidson's 11 digits were
 * read; the 85 statewide counties, Williamson, Hamilton, Montgomery, Hickman, Chester and Shelby all fell through to the geocoder ("Site search does not read … as a parcel id").
 * The forms below are the REAL strings the sweep read off each source (test/fixtures/tnSweepPoints.json carries one per county; tnIdRoundTrip replays all 95). */
import { describe, it, expect } from "vitest";
import { tnParcelIdPlan, looksLikeTnParcelId, linkForms, parseStoredLink, linkMatch, countyHintOf, davidsonLetteredId, shelbyPaid, normalizeIdFor, parseControlMapId, linkWhere, TN_ID_SOURCES, TN_COUNTY_BY_ID } from "../src/workspaces/site-planner/lib/tnParcelId.js";

const sources = (t) => tnParcelIdPlan(t).map((p) => p.county);
describe("every shown id form is read as an id", () => {
  it.each([
    ["001 073    17102 000 2026", "tn_statewide"],   // the Comptroller's PARCELID (county · map · parcel · SI · year)
    ["006 050B A 01400 000 2027", "tn_statewide"],
    ["104    01308 00005104", "tn_williamson"],     // CaptureCAMA tail
    ["063J D 00100C00109063J", "tn_williamson"],    // …with a condo letter and a lettered map
    ["096    01301 00001096", "tn_hickman"],
    ["012045    05501", "tn_chester"],               // county-prefixed link
    ["066  018", "tn_hamilton"],                      // Hamilton's tax-map number
    ["128P D 012", "tn_hamilton"],
    ["090 00203 000", "tn_montgomery"],
    ["066F K 00100 000", "tn_montgomery"],
    ["091NB-C-008.00-000", "tn_rutherford"],         // two map letters + a group
    ["156-027.00-000", "tn_rutherford"],
    ["10508026600", "tn_davidson"],
    ["082140A11800CO", "tn_davidson"],                // Metro's lettered condo number
    ["072124 A00048", "tn_shelby"],
    ["G0231   00121C", "tn_shelby"],
    ["C0244W H00045", "tn_shelby"],
  ])("%j is asked of %s", (id, src) => {
    expect(looksLikeTnParcelId(id)).toBe(true);
    expect(sources(id)).toContain(src);
  });
  it("the state's own form carries the county id, so it is asked of that county's source alone", () => {
    expect(tnParcelIdPlan("001 073    17102 000 2026").map((p) => p.county)).toEqual(["tn_statewide"]);
    expect(tnParcelIdPlan("001 073    17102 000 2026")[0].where).toMatch(/COUNTY_ID=1\b/);
    expect(tnParcelIdPlan("012045    05501").map((p) => p.county)).toContain("tn_chester");
  });
  it("the CaptureCAMA tail form is only ever asked of the three counties that publish it", () => {
    expect(new Set(sources("104    01308 00005104"))).toEqual(new Set(["tn_williamson", "tn_hickman", "tn_chester"]));
  });
});

describe("naming the county narrows the search", () => {
  it("a county word before or after the id restricts the plan to that county", () => {
    expect(countyHintOf("Anderson 073 171.02").county).toEqual({ name: "Anderson", id: 1 });
    expect(countyHintOf("073-171.02 Van Buren County").county).toEqual({ name: "Van Buren", id: 88 });
    expect(sources("Anderson 073 171.02")).toEqual(["tn_statewide"]);
    expect(tnParcelIdPlan("Anderson 073 171.02")[0].where).toMatch(/COUNTY_ID=1\b/);
    expect(sources("Hamilton 057F B 003")).toEqual(["tn_hamilton"]);
    expect(sources("Rutherford 156-027.00-000")).toEqual(["tn_rutherford"]);
  });
  it("the county list is the state's id order, 95 long", () => {
    expect(TN_COUNTY_BY_ID).toHaveLength(95);
    expect(TN_COUNTY_BY_ID[18]).toBe("Davidson");
    expect(TN_COUNTY_BY_ID[88 - 1]).toBe("Van Buren");
  });
  it("a street address that merely contains a county name is not an id", () => {
    expect(looksLikeTnParcelId("1200 Anderson Ave, Knoxville")).toBe(false);
    expect(looksLikeTnParcelId("Davidson County courthouse")).toBe(false);
  });
});

describe("text that is not an id still goes to the geocoder", () => {
  it.each(["20 Culvert St, Nashville, TN", "Murfreesboro, TN", "37210", "12 34 56", "123456", "123-456-789", "1234567890", "1600 Pennsylvania Ave", "Epps Mill Rd", "I-24 exit 89", ""])("%j", (t) => {
    expect(looksLikeTnParcelId(t)).toBe(false);
  });
});

describe("stored links and typed readings agree on {map, letters, parcel}", () => {
  it.each([
    ["006050B A 01400", { map: "050", tag: "BA", parcel5: "01400" }],
    ["104    01308", { map: "104", tag: "", parcel5: "01308" }],
    ["091NB C 00800", { map: "091", tag: "NBC", parcel5: "00800" }],
    ["033066    01800", { map: "066", tag: "", parcel5: "01800" }],
    ["012045    05501", { map: "045", tag: "", parcel5: "05501" }],
    ["075D F 00500", { map: "075", tag: "DF", parcel5: "00500" }],
    ["073  A 01400", { map: "073", tag: "A", parcel5: "01400" }],
  ])("%j", (s, want) => { expect(parseStoredLink(s)).toEqual(want); });
  it("spacing never matters; a letter the person left out is a partial match, a different letter is none", () => {
    const stored = parseStoredLink("006050B A 01400");
    expect(linkMatch(stored, linkForms("050B A 014.00")[0])).toBe(2);
    expect(linkMatch(stored, linkForms("050BA014.00")[0])).toBe(2);
    expect(linkMatch(stored, linkForms("050 014.00")[0])).toBe(1);
    expect(linkMatch(stored, linkForms("050C A 014.00")[0])).toBe(0);
    expect(linkMatch(stored, linkForms("051B A 014.00")[0])).toBe(0);
  });
  it("the server clause is anchored at the map (a county-prefixed link has three characters before it)", () => {
    const f = linkForms("128P D 012")[0];
    const ham = TN_ID_SOURCES.find((s) => s.county === "tn_hamilton"), wil = TN_ID_SOURCES.find((s) => s.county === "tn_williamson");
    expect(linkWhere(ham, f)).toBe("UPPER(GISLINK) LIKE '___128%P%D%01200'");
    expect(linkWhere(wil, f)).toBe("UPPER(GISLINK) LIKE '128%P%D%01200'");
  });
  it("values reaching SQL are alphanumeric only", () => {
    for (const t of ["073 171.02", "050B A 014.00", "091NB-C-008.00-000"]) for (const p of tnParcelIdPlan(t)) expect(p.where || "").toMatch(/^[A-Z0-9_ ='%().<>]*$/i);
  });
});

describe("Davidson's lettered numbers, Shelby's assessor numbers", () => {
  it("Metro condo numbers and lettered blocks", () => {
    expect(davidsonLetteredId("082140A11800CO")).toBe("082140A11800CO");
    expect(davidsonLetteredId("082 140A 11800 CO")).toBe("082140A11800CO");
    expect(davidsonLetteredId("053030C90000CO")).toBe("053030C90000CO");
    expect(davidsonLetteredId("10508026600")).toBeNull(); // all digits is digitsOnlyId's
  });
  it("Shelby: spaces and case ignored, strict shape", () => {
    expect(shelbyPaid("072124 a00048")).toBe("072124A00048");
    expect(shelbyPaid("G0231   00121C")).toBe("G023100121C");
    expect(shelbyPaid("C0244W H00045")).toBe("C0244WH00045");
    expect(shelbyPaid("Main Street")).toBeNull();
    expect(tnParcelIdPlan("072124 A00048").find((p) => p.county === "tn_shelby").where).toBe("UPPER(PAID)='072124A00048'");
  });
});

describe("the in-planner ID box normalises for the county that declares it", () => {
  it("link counties rebuild a wildcard over their padded storage; Hamilton drops a zero decimal; Shelby splits before the parcel", () => {
    expect(normalizeIdFor("tn-link", "104 013.08")).toBe("104%01308");
    expect(normalizeIdFor("tn-hamilton", "066 018.00")).toBe("066%018");
    expect(normalizeIdFor("tn-hamilton", "130 001.18")).toBe("130%001.18");
    expect(normalizeIdFor("tn-shelby", "072124A00048")).toBe("072124%A00048");
    expect(normalizeIdFor("tn-link", "not an id")).toBe("not an id");
  });
  it("Rutherford still rebuilds its dashed form, now including two map letters", () => {
    expect(parseControlMapId("091NB C 008.00 000").canonical).toBe("091NB-C-008.00-000");
    expect(normalizeIdFor("tn-control", "156 027.00 000")).toBe("156-027.00-000");
  });
});
