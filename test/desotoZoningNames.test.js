/* B2507063 (NEW-8, owner constraint #46) — a zoning code shows its district NAME, sourced per jurisdiction from that jurisdiction's own ordinance; an unsourced code
 * shows the BARE CODE (never a guess, never a class word). The table is empty until the ordinance hosts can be read (see desotoZoningNames.js), so the guards here
 * are about the RULES: no entry without a source, names are per jurisdiction, the bare-code fallback, and the legend. */
import { describe, it, expect } from "vitest";
import { ZONING_NAMES, zoneName, zoneWithName, zoningLegend } from "../src/workspaces/site-planner/lib/desotoZoningNames.js";
import { zoningRows } from "../src/workspaces/site-planner/lib/desotoZoning.js";

const T = {
  "Olive Branch": { "M-1": { name: "Light Industrial", source: "https://library.municode.com/ms/olive_branch/codes/x#M1" }, "C-2": { name: "Highway Commercial", source: "https://library.municode.com/ms/olive_branch/codes/x#C2" } },
  "Unincorporated DeSoto County": { "C-2": { name: "General Commercial", source: "https://www.desotocountyms.gov/DocumentCenter/View/10775#C2" } },
};

describe("the shipped table", () => {
  it("has an entry for no code without a name AND an http(s) source — nothing is ever named from memory", () => {
    for (const [j, codes] of Object.entries(ZONING_NAMES)) {
      for (const [code, e] of Object.entries(codes)) {
        expect(e && e.name, `${j} ${code}: name`).toBeTruthy();
        expect(e && e.source, `${j} ${code}: source`).toMatch(/^https?:\/\//);
      }
    }
  });
  it("is keyed by the jurisdiction labels desotoJurisdiction produces", () => {
    for (const j of ["Olive Branch", "Unincorporated DeSoto County", "Hernando", "Southaven", "Horn Lake", "Walls"]) expect(ZONING_NAMES).toHaveProperty([j]);
  });
});

describe("zoneName / zoneWithName", () => {
  it("names a code per jurisdiction — the same code can differ between governments", () => {
    expect(zoneName("c-2", "Olive Branch", T)).toBe("Highway Commercial");
    expect(zoneName("C-2", "Unincorporated DeSoto County", T)).toBe("General Commercial");
    expect(zoneWithName("M-1", "Olive Branch", T)).toBe("M-1 · Light Industrial");
  });
  it("shows the BARE code when it cannot be sourced (unknown code, unknown / unloaded jurisdiction, empty table) — never a guess", () => {
    expect(zoneWithName("M-3", "Olive Branch", T)).toBe("M-3");
    expect(zoneWithName("M-1", "Southaven", T)).toBe("M-1");
    expect(zoneWithName("M-1", null, T)).toBe("M-1");
    expect(zoneWithName("M-1", "Olive Branch")).toBe("M-1"); // the shipped (empty) table
    expect(zoneWithName("M-1", "Olive Branch")).not.toMatch(/industrial|commercial|residential/i);
  });
});

describe("the click card's Zone row", () => {
  it("is the bare code today (no class word in parentheses — that was a guess)", () => {
    const row = zoningRows({ ZONE: "C-3" }, "Olive Branch")[0];
    expect(row).toEqual({ label: "Zone", text: "C-3" });
  });
});

describe("zoningLegend", () => {
  it("lists each code once per jurisdiction, grouped and sorted, with sourced names", () => {
    const items = [
      { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" }, { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" },
      { code: "C-2", jurisdiction: "Olive Branch", color: "#ea580c" }, { code: "C-2", jurisdiction: "Unincorporated DeSoto County", color: "#ea580c" },
      { code: "R-10", jurisdiction: "Olive Branch", color: "#ca8a04" }, { code: "R-2", jurisdiction: "Olive Branch", color: "#ca8a04" },
    ];
    const out = zoningLegend(items, T);
    expect(out.map((e) => e.label)).toEqual(["C-2 · Highway Commercial (Olive Branch)", "M-1 · Light Industrial", "R-2", "R-10", "C-2 · General Commercial (Unincorporated DeSoto County)"]);
  });
  it("a code from a jurisdiction not known yet is listed by its code alone; an empty / junk input gives an empty legend", () => {
    expect(zoningLegend([{ code: "M-1", jurisdiction: null, color: "#000" }], T).map((e) => e.label)).toEqual(["M-1"]);
    expect(zoningLegend([], T)).toEqual([]);
    expect(zoningLegend([{ code: "", jurisdiction: "Olive Branch" }, null], T)).toEqual([]);
  });
});
