/* City of Sugar Land zoning (NEW-1, 2026-11-02) — the pure rules, over the REAL values the city's table holds (measured 2026-11-02, all 339 polygons). */
import { describe, it, expect } from "vitest";
import {
  normalizeZone, codeFromDefinition, definitionText, zoneCode, zoneName, zoneWithName, zoneClass, zoneColor, zoningStyle, adoptedDate, pdfHref, zoningCard, zoningLegend, legendItemsOf, SL_ZONE_NAMES,
} from "../src/workspaces/site-planner/lib/sugarLandZoning.js";

describe("code normalisation — the stray 'R- 4' and its kin", () => {
  it.each([["R- 4", "R-4"], ["R-4", "R-4"], [" b-2 ", "B-2"], ["R-1 -I", "R-1-I"], ["R - 1Z", "R-1Z"], ["M-1", "M-1"], ["PD", "PD"], ["", ""], [null, ""], [undefined, ""]])("%j → %j", (raw, out) => expect(normalizeZone(raw)).toBe(out));
  it("the code the city draws is Zone_Label, normalised: R- 4 reads R-4 everywhere it is shown", () => {
    expect(zoneCode({ Zone_Label: "R- 4", ZONE_DEF: "R-4  - MULTI-FAMILY RESIDENTIAL" })).toBe("R-4");
    expect(zoningCard({ Zone_Label: "R- 4", ZONE_DEF: "R-4  - MULTI-FAMILY RESIDENTIAL" }).rows[0]).toEqual({ label: "Zone", text: "R-4 · Multi-Family Residential" });
  });
  it("falls back to the head of ZONE_DEF only when Zone_Label is blank", () => {
    expect(zoneCode({ Zone_Label: " ", ZONE_DEF: "M-2  - GENERAL INDUSTRIAL" })).toBe("M-2");
    expect(zoneCode({})).toBeNull();
  });
});

describe("the code at the head of a ZONE_DEF (real values)", () => {
  it.each([
    ["M-1  - RESTRICTED INDUSTRIAL", "M-1"], ["M-2  - GENERAL INDUSTRIAL", "M-2"], ["B-1  - NEIGHBORHOOD BUSINESS", "B-1"], ["B-O - BUSINESS OFFICE", "B-O"],
    ["B-1-I  NEIGHBORHOOD BUSINESS (INTERIM)", "B-1-I"], ["R-1-I STANDARD SINGLE-FAMILY RESIDENTIAL (INTERIM)", "R-1-I"], ["R-1Z - ZERO LOT LINE SINGLE-FAMILY RESIDENTIAL", "R-1Z"],
    ["R-1R - RESTRICTED SINGLE-FAMILY RESIDENTIAL", "R-1R"], ["BR   - BRAZOS RIVER PARKS AND CONSERVATION", "BR"], ["BR-I  BRAZOS RIVER PARKS AND CONSERVATION (INTERIM", "BR-I"],
    ["PD   - PLANNED DEVELOPMENT", "PD"], ["PD-I   PLANNED DEVELOPMENT (INTERIM)", "PD-I"], ["MUC  - MIXED USE CONSERVATION DISTRICT", "MUC"], ["HR-1 - THE HILL RESIDENTIAL", "HR-1"],
    ["R-4  - MULTI-FAMILY RESIDENTIAL", "R-4"], ["AB-OP", "AB-OP"], ["LPR - LAKE POINTE REDEVELOPMENT DISTRICT", "LPR"],
  ])("%s → %s", (def, code) => expect(codeFromDefinition(def)).toBe(code));
  it("nothing → null", () => { expect(codeFromDefinition(null)).toBeNull(); expect(codeFromDefinition("  ")).toBeNull(); });
  it("the definition text reads as words", () => {
    expect(definitionText("R-1Z - ZERO LOT LINE SINGLE-FAMILY RESIDENTIAL")).toBe("Zero Lot Line Single-Family Residential");
    expect(definitionText("B-1-I  NEIGHBORHOOD BUSINESS (INTERIM)")).toBe("Neighborhood Business (Interim)");
    expect(definitionText("AB-OP")).toBeNull();
  });
});

describe("district names are the city's own legend labels, by code", () => {
  it("every name is written, none is invented for a code the legend lacks (AB-OP shows bare)", () => {
    expect(zoneName("M-1")).toBe("Restricted Industrial");
    expect(zoneName("M-2")).toBe("General Industrial");
    expect(zoneName("B-O")).toBe("Business Office");
    expect(zoneName("AB-OP")).toBeNull();
    expect(zoneWithName("AB-OP")).toBe("AB-OP");
    expect(zoneWithName("r- 4")).toBe("R-4 · Multi-Family Residential");
    expect(Object.keys(SL_ZONE_NAMES)).toHaveLength(21);
  });
});

describe("class and paint", () => {
  it.each([["M-1", "industrial"], ["M-2", "industrial"], ["B-1", "business"], ["B-O", "business"], ["R-1Z", "residential"], ["HR-1", "residential"], ["PD", "pud"], ["PD-I", "pud"], ["BR", "parks"], ["MUC", "mixed"], ["??", "other"], ["", "other"]])("%s → %s", (c, k) => expect(zoneClass(c)).toBe(k));
  it("interim districts are outlined dashed, the rest solid", () => {
    expect(zoningStyle({ Zone_Label: "B-1-I" }, 1).dashArray).toBe("4 3");
    expect(zoningStyle({ Zone_Label: "PD-I" }, 1).dashArray).toBe("4 3");
    expect(zoningStyle({ Zone_Label: "BR-1" }, 1).dashArray).toBe("4 3");
    expect(zoningStyle({ Zone_Label: "M-1" }, 1).dashArray).toBeUndefined();
    expect(zoningStyle({ Zone_Label: "M-1" }, 1).fillColor).toBe(zoneColor("M-1"));
  });
});

describe("the card", () => {
  it("a clean M-1 polygon: zone with the city's name, ordinance, date, no disagreement row", () => {
    const c = zoningCard({ Zone_Label: "M-1", ZONE_DEF: "M-1  - RESTRICTED INDUSTRIAL", ORD_NO: "1571", DATE_: "07-18-06", OLDZN: " ", PDF_Link: null });
    expect(c.title).toBe("Zoning · Sugar Land");
    expect(c.rows).toEqual([{ label: "Zone", text: "M-1 · Restricted Industrial" }, { label: "Ordinance", text: "1571" }, { label: "Adopted", text: "Jul 18, 2006" }]);
  });
  it("where the city's definition names a DIFFERENT district than the one drawn, the card shows both — never resolves it", () => {
    const c = zoningCard({ Zone_Label: "R-1", ZONE_DEF: "R-1R - RESTRICTED SINGLE-FAMILY RESIDENTIAL" });
    expect(c.rows[0]).toEqual({ label: "Zone", text: "R-1 · Standard Single-Family Residential" });
    expect(c.rows[1]).toEqual({ label: "City record also reads", text: "R-1R · Restricted Single-Family Residential" });
    const same = zoningCard({ Zone_Label: "R-1", ZONE_DEF: "R-1  - STANDARD SINGLE-FAMILY RESIDENTIAL" });
    expect(same.rows.some((r) => r.label === "City record also reads")).toBe(false);
  });
  it("the city's BR-I typo for the BR-1 district is not a disagreement", () => {
    expect(zoningCard({ Zone_Label: "BR-1", ZONE_DEF: "BR-I  BRAZOS RIVER PARKS AND CONSERVATION (INTERIM" }).rows.some((r) => r.label === "City record also reads")).toBe(false);
  });
  it("a blank ZONE_DEF raises no disagreement; a previous zoning shows when it differs", () => {
    const c = zoningCard({ Zone_Label: "R-1", ZONE_DEF: null, OLDZN: "ETJ" });
    expect(c.rows.map((r) => r.label)).toEqual(["Zone", "Previously"]);
    expect(zoningCard({ Zone_Label: "R-1", OLDZN: "R-1" }).rows.some((r) => r.label === "Previously")).toBe(false);
  });
  it("blank / 'null' values never become rows", () => {
    const c = zoningCard({ Zone_Label: "PD", ORD_NO: " ", DATE_: " ", OLDZN: " ", PDF_Link: "testformap" });
    expect(c.rows).toEqual([{ label: "Zone", text: "PD · Planned Development" }]);
  });
});

describe("the city types its dates and links by hand", () => {
  it.each([["07-18-06", "Jul 18, 2006"], ["6-06-06", "Jun 6, 2006"], ["12-7-21", "Dec 7, 2021"], ["03-21-23", "Mar 21, 2023"], ["1-5-1999", "Jan 5, 1999"], ["12-1-95", "Dec 1, 1995"], ["5/1/18", "May 1, 2018"], [" 3/18/08", "Mar 18, 2008"], ["1/7/2020", "Jan 7, 2020"]])("%s → %s", (raw, out) => expect(adoptedDate(raw)).toBe(out));
  it.each([[" "], [""], [null], ["not a date"], ["13-40-06"], ["0-1-06"], ["12721"]])("%j → no date", (raw) => expect(adoptedDate(raw)).toBeNull());
  it("only a real Sugar Land .pdf link is offered, https", () => {
    expect(pdfHref("http://InteractiveMaps.sugarlandtx.gov/pd/2296.pdf")).toBe("https://interactivemaps.sugarlandtx.gov/pd/2296.pdf");
    expect(pdfHref("testformap")).toBeNull();
    expect(pdfHref("http://evil.example.com/pd/1.pdf")).toBeNull();
    expect(pdfHref("https://www.sugarlandtx.gov/page")).toBeNull();
    expect(pdfHref(null)).toBeNull();
    expect(zoningCard({ Zone_Label: "PD", PDF_Link: "http://InteractiveMaps.sugarlandtx.gov/pd/1026.pdf" }).rows.at(-1)).toEqual({ label: "Ordinance PDF", text: "Open", href: "https://interactivemaps.sugarlandtx.gov/pd/1026.pdf" });
  });
});

describe("the legend — headed by the jurisdiction, one code per row", () => {
  const feats = ["M-1", "M-2", "R- 4", "R-1Z", "M-1", "AB-OP", "B-O", "R-1Z"].map((z) => ({ properties: { Zone_Label: z } }));
  const lg = zoningLegend(legendItemsOf(feats));
  it("starts with ONE heading naming Sugar Land; no row carries the jurisdiction as a suffix", () => {
    expect(lg[0]).toEqual({ heading: true, label: "Sugar Land" });
    expect(lg.filter((e) => e.heading)).toHaveLength(1);
    for (const e of lg.slice(1)) expect(e.label).not.toMatch(/Sugar Land/);
  });
  it("lists each code once, with the city's name, in the family colour, each on its own row", () => {
    const rows = lg.slice(1);
    expect(rows.map((e) => e.label)).toEqual(["R-1Z · Zero Lot Line Single-Family Residential", "R-4 · Multi-Family Residential", "AB-OP", "B-O · Business Office", "M-1 · Restricted Industrial", "M-2 · General Industrial"]);
    expect(rows.every((e) => e.row === true && e.color)).toBe(true);
    expect(rows.find((e) => e.label.startsWith("M-1")).color).toBe(zoneColor("M-1"));
  });
  it("nothing in view → no legend at all", () => { expect(zoningLegend([])).toEqual([]); expect(zoningLegend(legendItemsOf([{ properties: {} }]))).toEqual([]); });
});
