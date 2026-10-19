/* NEW-1 (site-record panel V1, owner-approved 2026-10-19) — the single-record view: a sectioned
 * spec sheet (Deal / Building / Parties / Documents), no Site dropdown, no "Recently deleted", no
 * "Zoomed out too far" sentence, no empty rows. Pure model + the real CompDetail render + source
 * guards on SitePlansSection (whose Documents block shares the panel). */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { compRecordSections, compBadgeLabel, compFieldRows } from "../src/shared/comps/lib/comps.js";
import { CompDetail } from "../src/shared/comps/components/CompsPanel.jsx";

const LEASE = {
  id: "l1", compType: "lease", title: "Core 5 – West Hardy", compDate: "2026-08-20", createdAt: "2026-09-01T12:00:00Z",
  anchor: { kind: "pin", lat: 29.9, lon: -95.4, county: "harris" },
  leaseRate: 0.67, leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseSizeSf: 52000, leaseTerm: "60 mo",
  leaseTi: 3.5, leaseFreeRentMonths: 2, leaseEscalationPct: 3, leaseCommencementDate: "2026-10-01", leaseOpex: 1.2,
  clearHeightFt: 32, yearBuilt: 2022, partyProvider: "Core5", partyAcquirer: "Acme Logistics", notes: "Broker flyer",
};
const ids = (secs) => secs.map((s) => s.id);
const labels = (sec) => sec.rows.map((r) => r.label);

describe("compRecordSections — the rows, sorted into sections", () => {
  it("a full lease: Deal, Building, Parties in that order, deal rows in the owner's order", () => {
    const secs = compRecordSections(LEASE, "monthly");
    expect(ids(secs)).toEqual(["deal", "building", "parties"]);
    expect(secs[0].rows.map((r) => r.key).slice(0, 7)).toEqual(["rate", "term", "escalation", "freeRent", "ti", "opex", "commencement"]);
    expect(secs[0].rows.find((r) => r.key === "rate").value).toBe("$0.67/SF/mo NNN");
    expect(labels(secs[1])).toEqual(["Leased SF", "Clear height", "Year built"]);
    expect(secs[2].rows.map((r) => r.key)).toEqual(["partyProvider", "partyAcquirer"]);
    expect(secs[0].rows.map((r) => r.key).slice(-2)).toEqual(["dateEntered", "notes"]); // notes sort last
  });

  it("dates are ISO (YYYY-MM-DD) in the record, while the shared list formatter keeps mm/dd/yy", () => {
    const secs = compRecordSections(LEASE, "monthly");
    const flat = secs.flatMap((s) => s.rows);
    expect(flat.find((r) => r.key === "commencement").value).toBe("2026-10-01");
    expect(flat.find((r) => r.key === "date").value).toBe("2026-08-20");
    expect(compFieldRows(LEASE, "monthly").find((r) => r.key === "date").value).toMatch(/^\d\d\/\d\d\/\d\d$/);
  });

  it("nothing is dropped: every row compFieldRows produces appears exactly once", () => {
    const all = compFieldRows(LEASE, "monthly", { isoDates: true }).map((r) => r.key).sort();
    const got = compRecordSections(LEASE, "monthly").flatMap((s) => s.rows.map((r) => r.key)).sort();
    expect(got).toEqual(all);
  });

  it("a sparse comp renders only what it has — no empty rows, no empty sections", () => {
    const secs = compRecordSections({ id: "s", compType: "lease", leaseRate: 1, leaseRatePeriod: "annual" }, "annual");
    expect(ids(secs)).toEqual(["deal"]);
    expect(secs[0].rows.every((r) => r.value != null && r.value !== "" && r.value !== "—")).toBe(true);
  });

  it("a building sale uses the sale rows and calls its date the close date", () => {
    const sale = { id: "b", compType: "building_sale", bldgPrice: 9000000, bldgSizeSf: 100000, compDate: "2026-05-02", bldgNoi: 600000, partyProvider: "A", partyAcquirer: "B", yearBuilt: 2019 };
    const secs = compRecordSections(sale);
    expect(secs[0].rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Price", "$/SF", "NOI", "Close date"]));
    expect(labels(secs[1])).toEqual(["Building size", "Year built"]);
    expect(compBadgeLabel("building_sale")).toBe("SALE");
  });

  it("land: acreage is a Deal fact; the badge says LAND", () => {
    const land = { id: "d", compType: "land", landPrice: 850000, landSizeValue: 3.2, landSizeUnit: "ac", compDate: "2026-03-14" };
    const secs = compRecordSections(land);
    expect(secs[0].rows.map((r) => r.key)).toEqual(["price", "psf", "size", "date"]);
    expect(ids(secs)).toEqual(["deal"]);
    expect(compBadgeLabel("land")).toBe("LAND");
    expect(compBadgeLabel("lease")).toBe("LEASE");
  });

  it("a source line joins Parties", () => {
    const secs = compRecordSections(LEASE, "monthly", { source: "Core5 flyer · 2026-08-01" });
    const parties = secs.find((s) => s.id === "parties");
    expect(parties.rows.find((r) => r.key === "source").value).toBe("Core5 flyer · 2026-08-01");
  });
});

describe("CompDetail — the rendered record", () => {
  const html = renderToStaticMarkup(createElement(CompDetail, {
    comp: LEASE, canEdit: true, onEdit() {}, onDelete() {}, onBack() {}, compsRatePeriod: "monthly",
  }));
  it("has the top row, the name, the kebab and the four-section structure", () => {
    expect(html).toContain("All comps");
    expect(html).toContain(">LEASE<");
    expect(html).toContain("Core 5 – West Hardy");
    expect(html).toContain("2px solid var(--text-primary)");
    for (const h of ["Deal", "Building", "Parties"]) expect(html).toContain(`>${h}<`);
  });
  it("carries no Site dropdown, no Recently deleted and no zoom warning", () => {
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Recently deleted");
    expect(html).not.toContain("Zoomed out");
  });
  it("body text is one size: the only other font size in the record is the 12px section header / badge", () => {
    const sizes = new Set([...html.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
    expect([...sizes].sort()).toEqual(["12", "14"]);
  });
});

describe("SitePlansSection — the Documents block", () => {
  const src = readFileSync("src/shared/sitePlans/components/SitePlansSection.jsx", "utf8");
  it("the record no longer has a Site dropdown, the zoom warning, or its own Recently deleted", () => {
    expect(src).not.toContain("No site (detached)");
    expect(src).not.toContain("Zoomed out too far");
    expect(src.match(/\btrashBlock\b/g).length).toBe(2); // its definition + the one comps-list use
  });
  it("Documents has Add and a Zoom to link, and the plan trash shows on the comps list only", () => {
    expect(src).toContain('title="Documents"');
    expect(src).toContain("comp-record-add-doc");
    expect(src).toContain("comp-record-zoom-to");
    expect(src).toMatch(/!focusedProjectId && !flow && showPlanTrash && trashBlock/);
  });
});
