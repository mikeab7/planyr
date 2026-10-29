/* DeSoto County MS zoning (B2507058) — the pure rules: class, paint, date, ordinance link, and the jurisdiction-labelled card.
 * The layer is ONE table holding several DeSoto governments' zoning with no jurisdiction field, so nothing here may label a zone as "the county's"
 * or "Olive Branch's" from the layer alone — only from the jurisdiction the site falls in (owner correction 2026-10-29). */
import { describe, it, expect } from "vitest";
import { zoneClass, zoningStyle, zoningRows, zoningTitle, approvalDate, ordinanceRef, ZONE_COLORS } from "../src/workspaces/site-planner/lib/desotoZoning.js";
import { hoverDetails } from "../src/workspaces/site-planner/lib/featureHover.js";

describe("zoneClass", () => {
  it.each([
    ["M-1", "industrial"], ["M-2", "industrial"], ["M-3", "industrial"], ["m-1", "industrial"], ["M1", "industrial"],
    ["O", "commercial"], ["PO", "commercial"], ["RO", "commercial"], ["PB", "commercial"], ["PBP", "commercial"], ["ER", "residential"], ["RM-6", "residential"], ["RM-8", "residential"],
    ["R-15 OVERLAY", "overlay"], ["A-R OVERLAY", "overlay"], ["HISTORIC DISTRICT OVERLAY", "overlay"], ["PUD OVERLAY", "overlay"],
    ["C-1", "commercial"], ["C-5", "commercial"], ["C2", "commercial"],
    ["R-1", "residential"], ["R-10", "residential"], ["R-M", "residential"],
    ["A", "agricultural"], ["A-R", "agricultural"],
    ["PUD", "pud"], ["OB PUD", "pud"],
    ["MU", "other"], ["PUD", "pud"], ["", "other"], [null, "other"], ["???", "other"],
  ])("%j → %s", (z, c) => expect(zoneClass(z)).toBe(c));
});

describe("zoningStyle", () => {
  it("paints the class colour, quiet by default and scaled by the row opacity", () => {
    const s = zoningStyle({ ZONE: "M-1" }, 0.5);
    expect(s).toMatchObject({ color: ZONE_COLORS.industrial, fillColor: ZONE_COLORS.industrial, opacity: 0.5, fill: true });
    expect(s.fillOpacity).toBeLessThanOrEqual(0.45);
    expect(zoningStyle({ ZONE: "M-1" }, 1).fillOpacity).toBe(0.45);
  });
  it("an unknown or missing zone is neutral, never a guessed class", () => {
    expect(zoningStyle({}, 0.5).color).toBe(ZONE_COLORS.other);
    expect(zoningStyle(undefined, 0.5).color).toBe(ZONE_COLORS.other);
  });
});

describe("approvalDate", () => {
  it("formats an Esri epoch-ms date, an ISO string and a Date", () => {
    expect(approvalDate(Date.UTC(2026, 7, 18, 12))).toBe("Aug 18, 2026");
    expect(approvalDate("2026-05-19T00:00:00Z")).toBe("May 19, 2026");
    expect(approvalDate(String(Date.UTC(2025, 11, 3, 12)))).toBe("Dec 3, 2025");
    expect(approvalDate(new Date(Date.UTC(2024, 0, 2, 12)))).toBe("Jan 2, 2024");
  });
  it("is null for anything that is not a believable date (never 'Invalid Date', never 1970)", () => {
    for (const v of [null, undefined, "", "n/a", "garbage", 0, -1]) expect(approvalDate(v), String(v)).toBeNull();
  });
});

describe("ordinanceRef — a link only when it is a real http(s) URL", () => {
  it("the Municode link becomes a labelled link", () => {
    expect(ordinanceRef("https://library.municode.com/ms/olive_branch/codes/code_of_ordinances?nodeId=COOR_APXAZOOR")).toEqual({ href: "https://library.municode.com/ms/olive_branch/codes/code_of_ordinances?nodeId=COOR_APXAZOOR", text: "Zoning ordinance (Municode)" });
  });
  it("an anchor tag in the field is unwrapped to its href and text", () => {
    expect(ordinanceRef('<a href="https://example.gov/ord/12.pdf">Ordinance 12</a>')).toEqual({ href: "https://example.gov/ord/12.pdf", text: "Ordinance 12" });
  });
  it("an ordinance number typed as text stays text, never a link", () => {
    expect(ordinanceRef("Ord. 2019-14")).toEqual({ href: null, text: "Ord. 2019-14" });
  });
  it("javascript:, data: and other schemes are never a link", () => {
    for (const v of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.gov/a"]) expect(ordinanceRef(v).href, v).toBeNull();
  });
  it("empty and placeholder values say nothing", () => {
    for (const v of [null, undefined, "", " ", "null", "None", "N/A", "0"]) expect(ordinanceRef(v), String(v)).toBeNull();
  });
});

describe("zoningRows — labelled by the jurisdiction the SITE falls in, never by the layer", () => {
  const props = { ZONE: "M-1", PREV_ZONE: "A-R", CASE_NO: "RZN-26-0003", DATE_APPROVED: Date.UTC(2026, 7, 18, 12), ORDINANCE: "https://library.municode.com/ms/olive_branch/codes/code_of_ordinances?nodeId=COOR_APXAZOOR", NAME: "Hacks Cross Logistics" };
  it("shows zone, jurisdiction, previous zone, case, approval date, ordinance link and name", () => {
    expect(zoningRows(props, "Olive Branch")).toEqual([
      { label: "Zone", text: "M-1" },
      { label: "Jurisdiction", text: "Olive Branch" },
      { label: "Previously", text: "A-R" },
      { label: "Case", text: "RZN-26-0003" },
      { label: "Approved", text: "Aug 18, 2026" },
      { label: "Ordinance", text: "Zoning ordinance (Municode)", href: "https://library.municode.com/ms/olive_branch/codes/code_of_ordinances?nodeId=COOR_APXAZOOR" },
      { label: "Name", text: "Hacks Cross Logistics" },
    ]);
  });
  it("the same polygon outside every city reads Unincorporated DeSoto County — the label comes from the site, not the layer", () => {
    expect(zoningRows({ ZONE: "A-R" }, "Unincorporated DeSoto County")[1]).toEqual({ label: "Jurisdiction", text: "Unincorporated DeSoto County" });
  });
  it("while the city limits are still loading it says so rather than guessing", () => {
    expect(zoningRows({ ZONE: "C-2" }, null)[1].text).toMatch(/Checking/);
  });
  it("omits what is empty — no Case, Approved or Ordinance rows for a bare record", () => {
    const labels = zoningRows({ ZONE: "R-1", CASE_NO: null, DATE_APPROVED: null, ORDINANCE: "" }, "Southaven").map((r) => r.label);
    expect(labels).toEqual(["Zone", "Jurisdiction"]);
  });
  it("the card title names the jurisdiction, not the layer", () => {
    expect(zoningTitle("Olive Branch")).toBe("Zoning · Olive Branch");
    expect(zoningTitle(null)).toBe("Zoning");
  });
});

describe("the hover line reads a date field", () => {
  it("a `date` hoverField formats epoch ms", () => {
    const cfg = { hoverFields: [{ names: ["ZONE"], label: "Zone" }, { names: ["DATE_APPROVED"], label: "Approved", date: true }] };
    expect(hoverDetails(cfg, { ZONE: "M-1", DATE_APPROVED: Date.UTC(2026, 7, 18, 12) })).toEqual(["Zone M-1", "Approved Aug 18, 2026"]);
    expect(hoverDetails(cfg, { ZONE: "M-1", DATE_APPROVED: null })).toEqual(["Zone M-1"]);
  });
});
