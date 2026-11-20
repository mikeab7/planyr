/* NEW-1 (Bartow sweep, 2026-11-12) — Bartow County zoning district NAMES (bartowZoningNames.js; owner constraints #45 / #46 / #50).
 *
 * What this pins, each a way the work could be wrong in front of a developer:
 *   · a Sec. 4.1 district shown under the wrong name, or a name from memory for a code the ordinance does not list (it must stay BARE);
 *   · the county's spellings (A1CU, I2 (wC), R-8 w/c, BPD) not resolving to the district they mean — and a conditioned parcel read as the plain district;
 *   · BPD (the county's GIS code) and BP (the ordinance's) not being the same Business Park row;
 *   · the legend repeating a government as a suffix, or listing one district on several rows;
 *   · the card losing its Ordinance link, or an "Incorporated" parcel getting a district name.
 * The names are Sec. 4.1 of the Bartow County Zoning Ordinance (see the file header for what could and could not be re-read). */
import { describe, it, expect } from "vitest";
import {
  BARTOW_ZONING_NAMES, BARTOW_ORDINANCE_URL, BARTOW_ORDINANCE_CITATION, parseBartowCode, bartowZoneName, bartowZoneTitle, bartowModifierWords, bartowLegend,
} from "../src/workspaces/site-planner/lib/bartowZoningNames.js";
import { GEORGIA_LAYERS, bartowZoneClass, BARTOW_COLORS, BARTOW_CLASS_LABEL, bartowStyle } from "../src/workspaces/site-planner/lib/georgiaLayers.js";

/* Sec. 4.1, exactly as the dispatching chat read it (2026-11-01) — the pin. */
const SEC_4_1 = {
  "A-1": "Agricultural District",
  "RE-1": "Rural Estate District", "RE-2": "Rural Estate District",
  "R-1": "Residential District", "R-2": "Residential District (duplex to quadraplex)", "R-3": "Residential District (multi-family)", "R-4": "Residential District (including manufactured housing)",
  "R-6": "Manufactured Housing Park District", "R-7": "Residential High-Density Multi-Family District", "R-8": "Residential High-Density Single-Family District",
  "O/I": "Office and Institutional District", "C-N": "Neighborhood Business District", "C-1": "General Business District",
  "I-1": "General Industrial District", "I-2": "Heavy Industrial District", "M-1": "Mining District",
  PUD: "Planned Unit Development District", BP: "Business Park District",
};

describe("Bartow zoning names — Sec. 4.1", () => {
  it("pins every Sec. 4.1 district name, and nothing else is in the table", () => {
    expect(Object.fromEntries(Object.entries(BARTOW_ZONING_NAMES).map(([k, v]) => [k, v.name]))).toEqual(SEC_4_1);
  });
  it("the county's own spellings resolve to the right district", () => {
    for (const [raw, base] of [["A-1", "A-1"], ["A1 (wC)", "A-1"], ["A1CU", "A-1"], ["RE1 (wC)", "RE-1"], ["RE2CU", "RE-2"], ["R-8 w/c", "R-8"], ["R1CU", "R-1"], ["R3 (wC)", "R-3"], ["R7 (wC)", "R-7"],
      ["O/I", "O/I"], ["CN", "C-N"], ["CN (wC)", "C-N"], ["C1CU", "C-1"], ["C1 (wC)", "C-1"], ["I-1", "I-1"], ["I1 (wC)", "I-1"], ["I1CU", "I-1"], ["I-2", "I-2"], ["I2CU", "I-2"], ["I2 (wC)", "I-2"],
      ["M-1", "M-1"], ["M1 (wC)", "M-1"], ["PUD", "PUD"], ["PUDCU", "PUD"], ["PUD (wC)", "PUD"]]) {
      expect(parseBartowCode(raw).base, raw).toBe(base);
      expect(bartowZoneName(raw), raw).toBe(SEC_4_1[base]);
    }
  });
  it("every code the live layer carried on 2026-11-12 parses or stays bare — none gets a guessed name", () => {
    const LIVE = ["A-1", "A1 (wC)", "A1CU", "BPD", "BPD (wC)", "C-1", "C1 (wC)", "C1CU", "CN", "CN (wC)", "I-1", "I-2", "I1 (wC)", "I1CU", "I2 (wC)", "I2CU", "Incorporated", "M-1", "M1 (wC)", "O/I", "PUD", "PUD (wC)", "PUDCU",
      "R-1", "R-2", "R-3", "R-4", "R-7", "R-8", "R-8 w/c", "R1 (wC)", "R1CU", "R2 (wC)", "R3 (wC)", "R3CU", "R4 (wC)", "R7 (wC)", "RE-1", "RE-2", "RE1 (wC)", "RE2 (wC)", "RE2CU"];
    for (const c of LIVE) {
      const p = parseBartowCode(c);
      if (p.city) { expect(c).toBe("Incorporated"); expect(p.name).toBeNull(); continue; }
      expect(p.base, c).toBeTruthy();
      expect(p.name, c).toBe(SEC_4_1[p.base]);
    }
  });
  it("BPD (the county's GIS code) and BP (the ordinance's) are the SAME Business Park district, in its own colour class", () => {
    expect(parseBartowCode("BPD").base).toBe("BP"); expect(parseBartowCode("BP").base).toBe("BP"); expect(parseBartowCode("BPD (wC)").base).toBe("BP");
    expect(bartowZoneName("BPD")).toBe("Business Park District");
    expect(bartowZoneClass("BPD")).toBe("businessPark"); expect(bartowZoneClass("BPD (wC)")).toBe("businessPark");
    expect(BARTOW_COLORS.businessPark).toBeTruthy(); expect(BARTOW_CLASS_LABEL.businessPark).toBe("Business park");
    expect(new Set(Object.values(BARTOW_COLORS)).size).toBe(Object.keys(BARTOW_COLORS).length); // no two classes share a colour
    expect(bartowStyle({ STZONECODE: "BPD" }, 1).fillColor).toBe(BARTOW_COLORS.businessPark);
  });
  it("a code that is not in Sec. 4.1 stays BARE — no name, neutral class (R-5, junk, empty, null)", () => {
    for (const c of ["R-5", "ZZ9", "", null, undefined, "   ", "Overlay"]) { const p = parseBartowCode(c); expect(p.name, String(c)).toBeNull(); expect(p.base, String(c)).toBeNull(); expect(bartowZoneTitle(c), String(c)).toBeNull(); expect(bartowZoneClass(c), String(c)).toBe("other"); }
    expect(parseBartowCode("Incorporated").city).toBe(true); expect(bartowZoneClass("Incorporated")).toBe("city"); expect(bartowZoneName("Incorporated")).toBeNull();
  });
  it("the suffix is said, not dropped: (wC) / w/c = with conditions, CU = conditional use", () => {
    expect(bartowModifierWords("I2 (wC)")).toMatch(/^with conditions/); expect(bartowModifierWords("R-8 w/c")).toMatch(/^with conditions/);
    expect(bartowModifierWords("A1CU")).toMatch(/^conditional use/); expect(bartowModifierWords("PUDCU")).toMatch(/^conditional use/);
    expect(bartowModifierWords("I-2")).toBe(""); expect(bartowModifierWords("BPD")).toBe("");
  });
  it("the title reads 'I-2 — Heavy Industrial District'", () => {
    expect(bartowZoneTitle("I-2")).toBe("I-2 — Heavy Industrial District"); expect(bartowZoneTitle("I1 (wC)")).toBe("I-1 — General Industrial District"); expect(bartowZoneTitle("BPD")).toBe("BP — Business Park District");
  });
});

describe("Bartow zoning — legend (owner constraint #50)", () => {
  const items = [["I-2", "#1"], ["I2 (wC)", "#1"], ["I2CU", "#1"], ["A1CU", "#2"], ["BPD", "#3"], ["Incorporated", "#4"], ["R-5", "#5"], ["C1 (wC)", "#6"], ["I-1", "#7"]].map(([code, color]) => ({ code, color }));
  const lg = bartowLegend(items);
  it("one heading naming the government, then one row per district — the county's spellings fold", () => {
    expect(lg[0]).toEqual({ heading: true, label: "Bartow County" });
    expect(lg.filter((r) => r.heading).length).toBe(1);
    const rows = lg.filter((r) => r.row).map((r) => r.label);
    expect(rows).toEqual(["A-1 · Agricultural District", "C-1 · General Business District", "I-1 · General Industrial District", "I-2 · Heavy Industrial District", "BP · Business Park District", "R-5", "Incorporated · the city zones it"]);
    expect(rows.filter((l) => /^I-2/.test(l)).length).toBe(1);
  });
  it("no row carries the government as a suffix; a row has its colour; empty input gives no legend", () => {
    for (const r of lg.filter((x) => x.row)) { expect(r.label).not.toMatch(/Bartow/); expect(r.color).toBeTruthy(); }
    expect(bartowLegend([])).toEqual([]); expect(bartowLegend(null)).toEqual([]); expect(bartowLegend([{ code: "", color: "#0" }])).toEqual([]);
  });
  it("the layer row publishes it through viewLegend (the dropdown reads what is in view)", () => {
    const out = GEORGIA_LAYERS.ga_bartow_zoning.viewLegend([{ properties: { STZONECODE: "I-2" } }, { properties: { STZONECODE: "I2CU" } }, { properties: {} }, null]);
    expect(out.map((r) => r.label)).toEqual(["Bartow County", "I-2 · Heavy Industrial District"]);
    expect(out[1].color).toBe(BARTOW_COLORS.industrial);
  });
});

describe("Bartow zoning — click card", () => {
  const card = (p) => GEORGIA_LAYERS.ga_bartow_zoning.identifyCard(p);
  it("Gerdau-style I-2: title names the district, an Ordinance link to the county ordinance, no raw field names", () => {
    const c = card({ STZONECODE: "I-2", REZONING: "RZ-342-89", ZONINGTEXT: " " });
    expect(c.title).toBe("I-2 — Heavy Industrial District");
    const o = c.rows.find((r) => r.label === "Ordinance");
    expect(o.href).toBe(BARTOW_ORDINANCE_URL); expect(o.href).toMatch(/^https:\/\/cms2\.revize\.com\/revize\/bartowga\//); expect(o.text).not.toMatch(/https?:/);
    expect(c.rows.find((r) => r.label === "Rezoning / case").text).toBe("RZ-342-89");
    expect(c.rows.some((r) => r.label === "County map code")).toBe(false); // I-2 is written the ordinance's way
    expect(JSON.stringify(c)).not.toMatch(/STZONECODE|null|undefined/);
  });
  it("Allatoona Business Center I1 (wC): the district, and 'with conditions' said on the card with the case", () => {
    const c = card({ STZONECODE: "I1 (wC)", REZONING: "ARZ-2450-21", ZONINGTEXT: " " });
    expect(c.title).toBe("I-1 — General Industrial District");
    expect(c.rows.find((r) => r.label === "County map code").text).toMatch(/^I1 \(wC\) — with conditions/);
    expect(c.rows.find((r) => r.label === "Rezoning / case").text).toBe("ARZ-2450-21");
  });
  it("BPD names Business Park and says the ordinance writes it BP; a CU code says conditional use", () => {
    expect(card({ STZONECODE: "BPD" }).title).toBe("BP — Business Park District");
    expect(card({ STZONECODE: "BPD" }).rows.find((r) => r.label === "County map code").text).toMatch(/BPD.*BP, Business Park/);
    expect(card({ STZONECODE: "A1CU" }).rows.find((r) => r.label === "County map code").text).toMatch(/conditional use/);
  });
  it("an unmapped code keeps the bare 'Zone <code>' title; an Incorporated parcel gets no district, no ordinance link, and says the city zones it", () => {
    expect(card({ STZONECODE: "ZZ9" }).title).toBe("Zone ZZ9");
    const c = card({ STZONECODE: "Incorporated" });
    expect(c.title).toBe("Inside a city"); expect(c.rows.some((r) => r.label === "Ordinance")).toBe(false); expect(c.rows[0].text).toMatch(/city zones this ground/);
  });
  it("the ordinance edition is cited honestly (amended through 2020-11-04; confirm against the current ordinance)", () => {
    expect(BARTOW_ORDINANCE_CITATION).toMatch(/November 4, 2020/); expect(BARTOW_ORDINANCE_CITATION).toMatch(/confirm/i);
    expect(GEORGIA_LAYERS.ga_bartow_zoning.infoCaveat).toContain(BARTOW_ORDINANCE_CITATION);
  });
});
