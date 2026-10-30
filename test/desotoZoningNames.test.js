/* B2507063 (NEW-8, owner constraint #46) — a zoning code shows its district NAME, sourced per jurisdiction from that jurisdiction's own ordinance; an unsourced code
 * shows the BARE CODE (never a guess, never a class word). The table is empty until the ordinance hosts can be read (see desotoZoningNames.js), so the guards here
 * are about the RULES: no entry without a source, names are per jurisdiction, the bare-code fallback, and the legend. */
import { describe, it, expect } from "vitest";
import { ZONING_NAMES, ZONING_CITATIONS, zoneName, zoneWithName, zoningLegend, displayCode } from "../src/workspaces/site-planner/lib/desotoZoningNames.js";
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
    expect(zoneWithName("M-1", "Southaven")).toBe("M-1"); // a government whose ordinance is not sourced — nothing is guessed
  });
});

describe("the click card's Zone row", () => {
  it("is the code with its sourced ordinance name — in the jurisdiction the SITE falls in", () => {
    expect(zoningRows({ ZONE: "C-3" }, "Olive Branch")[0]).toEqual({ label: "Zone", text: "C-3 · General Commercial" });
    expect(zoningRows({ ZONE: "M-1" }, "Unincorporated DeSoto County")[0]).toEqual({ label: "Zone", text: "M-1 · Light Industrial" });
  });
  it("is the code as written when its jurisdiction's ordinance does not list it (no invented name, no class word)", () => {
    expect(zoningRows({ ZONE: "ER" }, "Olive Branch")[0].text).toBe("ER");
    expect(zoningRows({ ZONE: "M-3" }, "Unincorporated DeSoto County")[0].text).toBe("M-3");
    expect(zoningRows({ ZONE: "R-2" }, "Unincorporated DeSoto County")[0].text).toBe("R-2");
  });
});

describe("the ordinance lists, exactly as the dispatching chat read them (2026-10-29)", () => {
  const OB = { A: "Agricultural", "A-R": "Agricultural-Residential", AR: "Agricultural-Residential", "R-1": "Single-Family Residential", "R-2": "Single-Family Residential", "R-3": "Planned Residential", "R-4": "Multiple-Family Residential", O: "Office", "C-1": "Neighborhood Commercial", "C-2": "Highway Commercial", "C-3": "General Commercial", "C-4": "Planned Commercial", "C-5": "Old Towne District", "M-1": "Light Industrial", "M-2": "Heavy Industrial", "M-3": "Planned Industrial District (PID)", PUD: "Planned Unit Development" };
  it("Olive Branch: the 16 districts (A-R is the data's spelling of the ordinance's AR)", () => {
    for (const [c, n] of Object.entries(OB)) expect(zoneName(c, "Olive Branch"), c).toBe(n);
    expect(Object.keys(ZONING_NAMES["Olive Branch"]).filter((k) => k !== "AR")).toHaveLength(16);
  });
  it("Unincorporated DeSoto County: the Art. III list plus C-4 from Art. IX", () => {
    const low = ["R-40", "R-30", "R-20", "R-15"], med = ["R-12", "R-10", "R-8", "R-6"], high = ["RM-8", "RM-6"];
    for (const c of low) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Residential Single-Family (Low Density)");
    for (const c of med) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Residential Single-Family (Medium Density)");
    for (const c of high) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Multiple-Family Residential (High Density)");
    const rest = { A: "Agricultural", "A-R": "Agricultural-Residential", "C-R": "Rural Commercial", "C-1": "Neighborhood Commercial", "C-2": "Highway Commercial", "C-3": "General Commercial", "C-4": "Planned Commercial", O: "Office", "M-1": "Light Industrial", "M-2": "Heavy Industrial", PO: "Planned Office Park", PB: "Planned Business", RO: "Residential Overlay", PUD: "Planned Unit Development", F: "Flood Control", AHR: "Airport Height Use Regulation" };
    for (const [c, n] of Object.entries(rest)) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe(n);
  });
  it("a code is named only in the jurisdiction that has it: R-1…R-4, C-5 and M-3 are Olive Branch's; R-xx lots, RM, C-R, PO, PB, RO, F, AHR are the county's", () => {
    for (const c of ["R-1", "R-2", "R-3", "R-4", "C-5", "M-3"]) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBeNull();
    for (const c of ["R-40", "R-30", "R-20", "R-15", "R-12", "R-10", "R-8", "R-6", "RM-8", "RM-6", "C-R", "PO", "PB", "RO", "F", "AHR"]) expect(zoneName(c, "Olive Branch"), c).toBeNull();
  });
  it("codes in the data that appear in neither list show as written; values that are already words are title-cased", () => {
    for (const c of ["ER", "PBP", "CM OVERLAY", "R-15 OVERLAY", "R-8 OVERLAY"]) for (const j of ["Olive Branch", "Unincorporated DeSoto County"]) expect(zoneWithName(c, j), `${c} in ${j}`).toBe(c);
    expect(zoneWithName("MAIN STREET DISTRICT", "Olive Branch")).toBe("Main Street District");
    expect(zoneWithName("HISTORIC DISTRICT OVERLAY", "Olive Branch")).toBe("Historic District Overlay");
    expect(displayCode("A-R")).toBe("A-R");
  });
  it("the other governments are not sourced: their codes are never named", () => {
    for (const j of ["Hernando", "Southaven", "Horn Lake", "Walls"]) expect(Object.keys(ZONING_NAMES[j])).toEqual([]);
  });
  it("every sourced jurisdiction has the ordinance it cites for the (i)", () => {
    for (const j of ["Olive Branch", "Unincorporated DeSoto County"]) expect(ZONING_CITATIONS[j]).toMatch(/ordinance/i);
    expect(ZONING_CITATIONS["Olive Branch"]).toMatch(/Appendix A.*Art\. III/);
    expect(ZONING_CITATIONS["Unincorporated DeSoto County"]).toMatch(/3-8-2024/);
  });
});

describe("zoningLegend (B2573312 NEW-1: grouped by jurisdiction, never a per-row suffix)", () => {
  const items = [
    { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" }, { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" },
    { code: "C-2", jurisdiction: "Olive Branch", color: "#ea580c" }, { code: "C-2", jurisdiction: "Unincorporated DeSoto County", color: "#ea580c" },
    { code: "R-10", jurisdiction: "Olive Branch", color: "#ca8a04" }, { code: "R-2", jurisdiction: "Olive Branch", color: "#ca8a04" },
  ];
  it("lists each code once per jurisdiction, each under its own group, sorted, with sourced names — and NO parenthetical on any row", () => {
    const out = zoningLegend(items, T);
    expect(out.map((e) => [e.group, e.label])).toEqual([
      ["Olive Branch", "C-2 · Highway Commercial"], ["Olive Branch", "M-1 · Light Industrial"], ["Olive Branch", "R-2"], ["Olive Branch", "R-10"],
      ["Unincorporated DeSoto County", "C-2 · General Commercial"],
    ]);
    for (const e of out) expect(e.label).not.toMatch(/\(/);
  });
  it("the same code in two governments is two entries under two headings (never merged), with each government's own name", () => {
    const out = zoningLegend(items, T).filter((e) => e.label.startsWith("C-2"));
    expect(out).toHaveLength(2);
    expect(new Set(out.map((e) => e.group)).size).toBe(2);
  });
  it("one jurisdiction in view → one group; cities come before the unincorporated county; codes whose jurisdiction is unknown come last with no heading", () => {
    expect(new Set(zoningLegend(items.filter((i) => i.jurisdiction === "Olive Branch"), T).map((e) => e.group))).toEqual(new Set(["Olive Branch"]));
    const out = zoningLegend([{ code: "A", jurisdiction: "Unincorporated DeSoto County" }, { code: "PB", jurisdiction: null }, { code: "A-R", jurisdiction: "Olive Branch" }], T);
    expect(out.map((e) => e.group)).toEqual(["Olive Branch", "Unincorporated DeSoto County", null]);
  });
  it("PB inside Olive Branch has no Olive Branch name: it keeps the bare code (never the county's 'Planned Business') but is its own entry", () => {
    const out = zoningLegend([{ code: "PB", jurisdiction: "Olive Branch" }, { code: "PB", jurisdiction: "Unincorporated DeSoto County" }], T);
    expect(out.map((e) => e.label)).toContain("PB");
    expect(out.find((e) => e.group === "Olive Branch").label).toBe("PB");
  });
  it("a code from a jurisdiction not known yet is listed by its code alone; an empty / junk input gives an empty legend", () => {
    expect(zoningLegend([{ code: "M-1", jurisdiction: null, color: "#000" }], T).map((e) => e.label)).toEqual(["M-1"]);
    expect(zoningLegend([], T)).toEqual([]);
    expect(zoningLegend([{ code: "", jurisdiction: "Olive Branch" }, null], T)).toEqual([]);
  });
});

describe("the (i) behind the Zoning layer cites both ordinances", () => {
  it("the zoning vintage line names each ordinance", async () => {
    const { DESOTO_VINTAGE } = await import("../src/workspaces/site-planner/lib/desotoLayers.js");
    const v = DESOTO_VINTAGE.ms_desoto_zoning || "";
    expect(v).toMatch(/Olive Branch Code of Ordinances, Appendix A Zoning Ordinance, Art\. III/);
    expect(v).toMatch(/DeSoto County Zoning Ordinance \(current as of 3-8-2024\)/);
  });
});
