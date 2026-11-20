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
    expect(zoneWithName("M-1", "Walls")).toBe("M-1"); // a government whose ordinance is not sourced — nothing is guessed
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
    const low = ["R-30", "R-20", "R-15"], med = ["R-12", "R-10", "R-8", "R-6"], high = ["RM-8", "RM-6"];
    for (const c of low) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Residential Single-Family (Low Density)");
    expect(zoneName("R-40", "Unincorporated DeSoto County")).toBe("Residential Single-Family (Low Density or Transition Density)");   // the 2026 heading (NEW-3, B2589345)
    for (const c of med) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Residential Single-Family (Medium Density)");
    for (const c of high) expect(zoneName(c, "Unincorporated DeSoto County"), c).toBe("Multiple-Family Residential (High Density)");
    const rest = { A: "Agricultural", "A-R": "Agricultural-Residential", "C-R": "Rural Commercial", "C-1": "Neighborhood Commercial", "C-2": "Highway Commercial", "C-3": "General Commercial", "C-4": "Planned Commercial", O: "Office", "M-1": "Light Industrial", "M-2": "Heavy Industrial", PO: "Planned Office", PB: "Planned Business Park", RO: "Residential Overlay", PUD: "Planned Unit Development", F: "Flood Control", AHR: "Airport Height Use Regulation" };
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
  it("Walls has no primary source online (the town's page is empty, Municode has no Walls code): its codes are never named", () => {
    expect(Object.keys(ZONING_NAMES.Walls)).toEqual([]);
  });
  it("Southaven (B2589344): the names from Title XIII Ch. 12, exactly as read 2026-11-03 — and nothing borrowed from another government", () => {
    const S = (c) => zoneName(c, "Southaven");
    expect(S("A")).toBe("Agricultural");
    expect(S("A/ER")).toBe("Agricultural/Estate Residential");
    for (const c of ["R-30", "R-20", "R-15", "R-12", "R-10", "R-9", "R-8", "R-6"]) expect(S(c), c).toBe("Single-Family Residential");
    expect(S("RM-8")).toBe("Multi-Family Residential");
    expect(S("O")).toBe("Office");
    expect(S("R-O")).toBe("Residential Office");
    expect(S("RO")).toBe("Residential Office");     // the chart writes both; the DATA writes RO
    expect(S("C-1")).toBe("Neighborhood Commercial");
    expect(S("C-3")).toBe("General Commercial");
    expect(S("C-4")).toBe("Planned Commercial");
    expect(S("PBP")).toBe("Planned Business Park");
    expect(S("M-1")).toBe("Light Industrial");
    expect(S("M-2")).toBe("Heavy Industrial");
    expect(S("PUD")).toBe("Planned Unit Development");
    expect(Object.keys(ZONING_NAMES.Southaven).sort()).toEqual(["A", "A/ER", "C-1", "C-3", "C-4", "M-1", "M-2", "O", "PBP", "PUD", "R-10", "R-12", "R-15", "R-20", "R-30", "R-6", "R-8", "R-9", "R-O", "RM-8", "RO"].sort());
  });
  it("Southaven's traps: C-2 has no Ch. 12 definition and stays bare; RO is 'Residential Office' only in Southaven (the county's RO is 'Residential Overlay'); codes the chart does not list stay bare", () => {
    expect(zoneName("C-2", "Southaven")).toBeNull();
    expect(zoneName("RO", "Southaven")).toBe("Residential Office");
    expect(zoneName("RO", "Unincorporated DeSoto County")).toBe("Residential Overlay");
    for (const c of ["ER", "PO", "RM-6", "CM OVERLAY", "R-6 OVERLAY", "R-15 OVERLAY"]) expect(zoneName(c, "Southaven"), c).toBeNull();
    // Olive Branch's R-3 / C-5 / M-3 and the county's C-R / PO are not Southaven's — nothing is borrowed across governments
    for (const c of ["R-1", "R-2", "R-3", "R-4", "C-5", "M-3", "C-R", "F", "AHR"]) expect(zoneName(c, "Southaven"), c).toBeNull();
  });
  it("Southaven's ordinance is cited behind the (i)", () => {
    expect(ZONING_CITATIONS.Southaven).toMatch(/Title XIII.*Ch\. 12/);
  });
  it("every sourced jurisdiction has the ordinance it cites for the (i)", () => {
    for (const j of ["Olive Branch", "Unincorporated DeSoto County"]) expect(ZONING_CITATIONS[j]).toMatch(/ordinance/i);
    expect(ZONING_CITATIONS["Olive Branch"]).toMatch(/Appendix A.*Art\. III/);
    expect(ZONING_CITATIONS["Unincorporated DeSoto County"]).toMatch(/3-8-2024/);
  });
});

describe("Horn Lake (B2589345, 20 districts from Appendix A Art. III Sec. A) and Hernando (24 districts from Appendix B Art. III), read on Municode 2026-11-03", () => {
  const H = (c) => zoneName(c, "Horn Lake"), E = (c) => zoneName(c, "Hernando");
  it("Horn Lake: all twenty districts, with their exact names", () => {
    const want = { AR: "Agricultural-Residential", "R-30": "Residential (Low Density)", "R-20": "Residential (Low Density)", "R-15": "Residential (Low Density)", "R-12": "Residential (Medium Density)", "R-10": "Residential (Medium Density)", "R-9": "Residential (Medium Density)", "R-8": "Residential (Medium Density)", "R-6": "Residential (High Density)", "RM-6": "Multi-Family Residential", O: "Office", C1: "Neighborhood Commercial", C3: "General Commercial", C4: "Planned Commercial", M1: "Light Industrial", M2: "Heavy Industrial", PUD: "Planned Unit Development", PBP: "Planned Business Park", F: "Flood Control Overlay District", OTC: "Old Town Center District" };
    expect(Object.keys(want)).toHaveLength(20);
    for (const [c, n] of Object.entries(want)) expect(H(c), c).toBe(n);
  });
  it("Horn Lake writes C1 / C3 / C4 / M1 / M2 / AR with no hyphen but the layer's data hyphenates — BOTH spellings name the same district", () => {
    for (const [plain, hyphen] of [["C1", "C-1"], ["C3", "C-3"], ["C4", "C-4"], ["M1", "M-1"], ["M2", "M-2"], ["AR", "A-R"]]) { expect(H(hyphen), hyphen).toBeTruthy(); expect(H(hyphen), hyphen).toBe(H(plain)); }
    expect(zoneWithName("C-3", "Horn Lake")).toBe("C-3 · General Commercial");
    expect(zoneWithName("C3", "Horn Lake")).toBe("C3 · General Commercial");
  });
  it("Horn Lake's R-6 is HIGH density where the county's and Hernando's R-6 are MEDIUM — nothing is borrowed across governments", () => {
    expect(H("R-6")).toBe("Residential (High Density)");
    expect(E("R-6")).toBe("Residential Single-Family (Medium Density)");
    expect(zoneName("R-6", "Unincorporated DeSoto County")).toBe("Residential Single-Family (Medium Density)");
    expect(zoneName("R-6", "Southaven")).toBe("Single-Family Residential");
    expect(H("R-6")).not.toBe(E("R-6"));
  });
  it("Horn Lake has NO C-2 (and no C2): a C-2 stays bare, as do the other codes its list does not carry", () => {
    expect(H("C-2")).toBeNull(); expect(H("C2")).toBeNull();
    for (const c of ["R-40", "RM-8", "PB", "PO", "H-1", "HISTORIC DISTRICT OVERLAY", "R-15 OVERLAY"]) expect(H(c), c).toBeNull();
  });
  it("Hernando: all twenty-four districts, with their exact names", () => {
    const low = ["R-40", "R-30", "R-20", "R-15"], med = ["R-12", "R-10", "R-8", "R-6"];
    for (const c of low) expect(E(c), c).toBe("Residential Single-Family (Low Density)");
    for (const c of med) expect(E(c), c).toBe("Residential Single-Family (Medium Density)");
    for (const c of ["RM-8", "RM-6"]) expect(E(c), c).toBe("Multiple-Family Residential (High Density)");
    const rest = { A: "Agricultural", "A-R": "Agricultural-Residential", "C-1": "Neighborhood Commercial", "C-2": "Highway Commercial", "C-3": "General Commercial", O: "Office", "M-1": "Light Industrial", "M-2": "Heavy Industrial", PO: "Planned Corporate Office Park", PB: "Planned Business", PUD: "Planned Unit Development", EO: "Environmental Overlay", "H-1": "Historic Overlay", TND: "Traditional Neighborhood Development" };
    for (const [c, n] of Object.entries(rest)) expect(E(c), c).toBe(n);
    expect(Object.keys(ZONING_NAMES.Hernando)).toHaveLength(24);
  });
  it("Hernando's C-4 and the two wordy values in its data are NOT among the twenty-four: they stay as written", () => {
    expect(E("C-4")).toBeNull();
    expect(zoneWithName("MAIN STREET DISTRICT", "Hernando")).toBe("Main Street District");
    expect(zoneWithName("HISTORIC DISTRICT OVERLAY", "Hernando")).toBe("Historic District Overlay");
  });
});

describe("the 2026 county ordinance (NEW-3, signed 3/17/2026)", () => {
  const C = (c) => zoneName(c, "Unincorporated DeSoto County");
  it("PO becomes Planned Office; PB and P-B become Planned Business Park; CO and C4 are added; R-40 gets its 2026 heading", () => {
    expect(C("PO")).toBe("Planned Office");
    expect(C("PB")).toBe("Planned Business Park");
    expect(C("P-B")).toBe("Planned Business Park");
    expect(C("CO")).toBe("Office");
    expect(C("C4")).toBe("Planned Commercial");
    expect(C("R-40")).toBe("Residential Single-Family (Low Density or Transition Density)");
    expect(ZONING_NAMES["Unincorporated DeSoto County"]["R-40"].source).toMatch(/10775/);
  });
  it("R-30 keeps its 2024 name (its 2026 heading is not confirmed); C-R and RO keep their 2024 names, sourced to the 2024 ordinance (older polygons still carry them)", () => {
    expect(C("R-30")).toBe("Residential Single-Family (Low Density)");
    expect(ZONING_NAMES["Unincorporated DeSoto County"]["R-30"].source).toMatch(/8541/);
    expect(C("C-R")).toBe("Rural Commercial");
    expect(C("RO")).toBe("Residential Overlay");
    expect(ZONING_NAMES["Unincorporated DeSoto County"].RO.source).toMatch(/8541/);
  });
  it("both ordinances are cited behind the (i)", () => {
    expect(ZONING_CITATIONS["Unincorporated DeSoto County"]).toMatch(/3\/17\/2026/);
    expect(ZONING_CITATIONS["Unincorporated DeSoto County"]).toMatch(/3-8-2024/);
    expect(ZONING_CITATIONS["Horn Lake"]).toMatch(/Appendix A Zoning/);
    expect(ZONING_CITATIONS.Hernando).toMatch(/Appendix B Zoning/);
  });
});

describe("NOT-IN-ORDINANCE record (B2589345's stopping rule): these stay bare", () => {
  it.each([
    ["Olive Branch", ["PB", "R-8", "R-15 OVERLAY", "R-20", "R-30"]],
    ["Southaven", ["C-2", "ER", "PO", "RM-6", "CM OVERLAY", "R-6 OVERLAY", "R-15 OVERLAY"]],
    ["Unincorporated DeSoto County", ["R-20 OVERLAY", "R-30 OVERLAY", "A-R OVERLAY", "PUD OVERLAY"]],
    ["Hernando", ["C-4", "R-6 OVERLAY", "R-8 OVERLAY", "R-12 OVERLAY", "R-30 OVERLAY"]],
    ["Horn Lake", ["C-2", "R-15 OVERLAY", "HISTORIC DISTRICT OVERLAY"]],
    ["Walls", ["A", "A-R", "C-2", "C-4", "M-1", "PUD", "R-10", "RM-6"]],
  ])("%s", (j, codes) => { for (const c of codes) expect(zoneName(c, j), `${j} ${c}`).toBeNull(); });
});

describe("zoningLegend — HEADED by the government, one code per row, never a suffix (owner constraint #50)", () => {
  const rowsOf = (out) => out.filter((e) => !e.heading).map((e) => e.label);
  it("a heading per government in view (cities first, the county last), then its codes — one per row, sorted", () => {
    const items = [
      { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" }, { code: "M-1", jurisdiction: "Olive Branch", color: "#7c3aed" },
      { code: "C-2", jurisdiction: "Olive Branch", color: "#ea580c" }, { code: "C-2", jurisdiction: "Unincorporated DeSoto County", color: "#ea580c" },
      { code: "R-10", jurisdiction: "Olive Branch", color: "#ca8a04" }, { code: "R-2", jurisdiction: "Olive Branch", color: "#ca8a04" },
    ];
    const out = zoningLegend(items, T);
    expect(out.map((e) => (e.heading ? `# ${e.label}` : e.label))).toEqual([
      "# Olive Branch", "C-2 · Highway Commercial", "M-1 · Light Industrial", "R-2", "R-10",
      "# Unincorporated DeSoto County", "C-2 · General Commercial",
    ]);
    expect(out.filter((e) => !e.heading).every((e) => e.row === true && !!e.color)).toBe(true);
  });
  it("NO row carries the government as a suffix, even when the same code is in several places", () => {
    const items = ["Olive Branch", "Southaven", "Horn Lake", "Hernando", "Walls", "Unincorporated DeSoto County"].map((j) => ({ code: "R-20", jurisdiction: j, color: "#ca8a04" }));
    const out = zoningLegend(items);
    expect(out.filter((e) => e.heading).map((e) => e.label)).toEqual(["Olive Branch", "Southaven", "Horn Lake", "Hernando", "Walls", "Unincorporated DeSoto County"]);
    for (const l of rowsOf(out)) expect(l, l).not.toMatch(/\((Olive Branch|Southaven|Horn Lake|Hernando|Walls|Unincorporated)/);
    expect(rowsOf(out)).toHaveLength(6);
  });
  it("the Southaven rows read their own names, the county's the county's, Olive Branch's Olive Branch's — for the same code", () => {
    const items = [
      { code: "R-20", jurisdiction: "Southaven", color: "#1" }, { code: "R-20", jurisdiction: "Unincorporated DeSoto County", color: "#1" }, { code: "R-20", jurisdiction: "Olive Branch", color: "#1" },
      { code: "C-2", jurisdiction: "Southaven", color: "#2" },
    ];
    const out = zoningLegend(items);
    expect(out.map((e) => (e.heading ? `# ${e.label}` : e.label))).toEqual([
      "# Olive Branch", "R-20", "# Southaven", "C-2", "R-20 · Single-Family Residential", "# Unincorporated DeSoto County", "R-20 · Residential Single-Family (Low Density)",
    ]);
  });
  it("a code from a government not known yet is listed by its code alone, with no heading; an empty / junk input gives an empty legend", () => {
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
    expect(v).toMatch(/signed 3\/17\/2026/);
    expect(v).toMatch(/current as of 3-8-2024/);
    expect(v).toMatch(/Horn Lake Code of Ordinances, Appendix A Zoning/);
    expect(v).toMatch(/Hernando Code of Ordinances, Appendix B Zoning/);
  });
});
