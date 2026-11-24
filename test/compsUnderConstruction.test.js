// Under-construction records (competing supply) — a fourth comp type in the SAME comps table.
// Owner ask 2026-11-24: "buildings under construction … under the same umbrella as the transaction record".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMP_TYPES, rowToComp, compToRow, emptyDraft, draftToComp, compToDraft, validateComp, compFieldRows,
  compHeadline, compBadgeLabel, compRecordSections, partyLabels, convertDeliveredComp, summarizeLeaseComps, summarizeSaleComps,
} from "../src/shared/comps/lib/comps.js";
import { SELECT_COLS } from "../src/shared/comps/lib/compsStore.js";
import { SHEET_COLUMNS, TYPE_OPTIONS } from "../src/shared/comps/lib/compSheetColumns.js";
import { parsePasteBlock } from "../src/shared/comps/lib/compParse.js";
import { mobileSections } from "../src/shared/comps/lib/compMobileLayout.js";
import { applyFilters, activeFilterChips, normalizeFilters, TYPE_FILTER_LABEL } from "../src/shared/comps/lib/compsQuery.js";
import { compMarkerColor, compMarkerSvg } from "../src/shared/comps/lib/compMarkerIcon.js";

const ANCHOR = { kind: "pin", lat: 29.76, lon: -95.37, county: "harris" };
const row = {
  id: "u1", user_id: "me", comp_type: "under_construction", comp_date: null, title: "Katy Spec 3", anchor_kind: "pin", lat: 29.76, lon: -95.37,
  bldg_size_sf: "250000", clear_height_ft: "36", dock_doors: 48, comp_party_provider: "Acme Dev", comp_party_acquirer: null,
  lease_rate: "0.62", lease_rate_period: "monthly", lease_rate_expense: "nnn",
  uc_status: "under_construction", uc_delivery_kind: "spec", uc_start_date: "2026-06-01", uc_delivery_date: "2027-03-01", uc_preleased_pct: "40",
  created_at: "2026-11-01T00:00:00Z",
};

describe("under-construction comp type", () => {
  it("is a registered type, in the type menus and the filter labels", () => {
    expect(COMP_TYPES).toContain("under_construction");
    expect(TYPE_OPTIONS.some((o) => o.value === "under_construction")).toBe(true);
    expect(TYPE_FILTER_LABEL.under_construction).toBe("Under construction");
  });
  it("round-trips row -> comp -> draft -> comp -> row without losing a field", () => {
    const comp = rowToComp(row);
    expect(comp).toMatchObject({ ucStatus: "under_construction", ucDeliveryKind: "spec", ucStartDate: "2026-06-01", ucDeliveryDate: "2027-03-01", ucPreleasedPct: 40, bldgSizeSf: 250000 });
    const back = compToRow(draftToComp(compToDraft(comp)));
    expect(back).toMatchObject({ comp_type: "under_construction", comp_date: null, uc_status: "under_construction", uc_delivery_kind: "spec", uc_start_date: "2026-06-01", uc_delivery_date: "2027-03-01", uc_preleased_pct: 40, bldg_size_sf: 250000 });
  });
  it("a blank draft writes NULL (never '') into the constrained uc_* columns", () => {
    const r = compToRow(draftToComp({ ...emptyDraft(ANCHOR), compType: "under_construction" }));
    for (const k of ["uc_status", "uc_delivery_kind", "uc_start_date", "uc_delivery_date", "uc_preleased_pct"]) expect(r[k]).toBeNull();
  });
  it("every uc column compToRow writes is also read back by the store select", () => {
    for (const col of Object.keys(compToRow(draftToComp(emptyDraft(ANCHOR)))).filter((k) => k.startsWith("uc_"))) expect(SELECT_COLS).toContain(col);
  });
  it("validates pre-leased range, delivery-before-start, and an asking rate needs a period", () => {
    const base = { ...emptyDraft(ANCHOR), compType: "under_construction" };
    expect(validateComp(draftToComp(base))).toEqual([]);
    expect(validateComp(draftToComp({ ...base, ucPreleasedPct: "140" })).join()).toMatch(/Pre-leased/);
    expect(validateComp(draftToComp({ ...base, ucStartDate: "2026-06-01", ucDeliveryDate: "2026-01-01" })).join()).toMatch(/Delivery/);
    expect(validateComp(draftToComp({ ...base, leaseRate: "0.62" })).join()).toMatch(/rent period/);
  });
  it("shows the record fields in plain words and hides what is empty", () => {
    const rows = compFieldRows(rowToComp(row));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.ucStatus.value).toBe("Under construction");
    expect(by.ucKind.value).toBe("Spec");
    expect(by.ucPreleased.value).toBe("40%");
    expect(by.ucDelivery.label).toBe("Expected delivery");
    expect(by.rate.label).toBe("Asking rate");
    expect(by.partyProvider.label).toBe("Developer");
    expect(by.date).toBeUndefined(); // no executed date
    expect(by.psf).toBeUndefined(); // never a $/SF headline
    const delivered = compFieldRows({ ...rowToComp(row), ucStatus: "delivered" }).find((r) => r.key === "ucDelivery");
    expect(delivered.label).toBe("Delivered");
    const secs = compRecordSections(rowToComp(row));
    expect(secs.map((s) => s.id)).toEqual(["deal", "building", "parties"]);
    expect(compBadgeLabel("under_construction")).toBe("UNDER CONSTRUCTION");
    expect(compHeadline(rowToComp(row))).toBe("Under construction · 250,000 SF");
    expect(partyLabels("under_construction")).toEqual({ provider: "Developer", acquirer: "Tenant" });
  });
  it("never enters a transaction average", () => {
    const uc = rowToComp(row);
    const lease = rowToComp({ ...row, id: "l1", comp_type: "lease", comp_date: "2026-10-01", lease_size_sf: "10000" });
    const onlyLease = JSON.stringify(summarizeLeaseComps([lease]));
    expect(JSON.stringify(summarizeLeaseComps([lease, uc]))).toBe(onlyLease);
    expect(JSON.stringify(summarizeSaleComps([uc], "building_sale"))).toBe(JSON.stringify(summarizeSaleComps([], "building_sale")));
  });
  it("converts a delivered building to a lease or sale record in place, executed date blank", () => {
    const comp = { ...rowToComp(row), ucStatus: "delivered" };
    const lease = convertDeliveredComp(comp, "lease");
    expect(lease).toMatchObject({ id: "u1", compType: "lease", compDate: "", leaseSizeSf: "250000", bldgSizeSf: "", leaseRate: "0.62", leaseRatePeriod: "monthly", partyProvider: "Acme Dev", ucStatus: "", ucDeliveryDate: "" });
    expect(validateComp(draftToComp(lease))).toEqual([]);
    const sale = convertDeliveredComp(comp, "building_sale");
    expect(sale).toMatchObject({ compType: "building_sale", bldgSizeSf: "250000", leaseRate: "", leaseRatePeriod: "", ucStatus: "" });
    expect(validateComp(draftToComp(sale))).toEqual([]);
  });
});

describe("under-construction in the sheet, filters and map", () => {
  it("only the right columns apply, and the executed date does not", () => {
    const applies = (k) => SHEET_COLUMNS.find((c) => c.key === k).appliesTo("under_construction");
    for (const k of ["ucStatus", "ucDeliveryKind", "ucStartDate", "ucDeliveryDate", "ucPreleasedPct", "size", "clearHeightFt", "dockDoors", "leaseRate", "leaseRatePeriod", "leaseRateExpense"]) expect(applies(k), k).toBe(true);
    for (const k of ["compDate", "price", "bldgNoi", "bldgCapRate", "leaseTerm", "leaseTi", "yearBuilt"]) expect(applies(k), k).toBe(false);
    // and the new columns apply to nothing else
    for (const t of ["land", "building_sale", "lease"]) for (const k of ["ucStatus", "ucDeliveryDate", "ucPreleasedPct"]) expect(SHEET_COLUMNS.find((c) => c.key === k).appliesTo(t)).toBe(false);
  });
  it("the phone sheet's Size field reads the building SF for this type", () => {
    const size = SHEET_COLUMNS.find((c) => c.key === "size");
    const d = { ...emptyDraft(ANCHOR), compType: "under_construction" };
    expect(size.setValue(d, "180000").bldgSizeSf).toBe("180000");
    expect(size.getValue({ ...d, bldgSizeSf: "180000" })).toBe("180000");
    expect(mobileSections("under_construction").some((s) => s.title === "Rent")).toBe(true);
  });
  it("is filterable on its own, separately from transactions", () => {
    const uc = rowToComp(row);
    const lease = rowToComp({ ...row, id: "l1", comp_type: "lease", comp_date: "2026-10-01" });
    const only = (types) => applyFilters([uc, lease], normalizeFilters({ types })).map((c) => c.id);
    expect(only(["under_construction"])).toEqual(["u1"]);
    expect(only(["lease"])).toEqual(["l1"]);
    expect(activeFilterChips({ types: ["under_construction"] }).map((c) => c.label)).toContain("Under construction");
    // search finds it by its status words
    expect(applyFilters([uc, lease], normalizeFilters({ q: "under construction" })).map((c) => c.id)).toContain("u1");
  });
  it("has its own orange, dashed marker so it reads apart from every deal", () => {
    expect(compMarkerColor("under_construction")).not.toBe(compMarkerColor("lease"));
    expect(compMarkerSvg("under_construction")).toContain("stroke-dasharray");
    expect(compMarkerSvg("lease")).not.toContain("stroke-dasharray");
  });
  it("the migration allows the type and adds the five columns, with RLS left to comps.sql", () => {
    // source-scan: pins the shipped migration text (the SQL is the artefact under test)
    const sql = readFileSync("src/shared/comps/db/comps_under_construction.sql", "utf8");
    expect(sql).toMatch(/'under_construction'/);
    for (const c of ["uc_status", "uc_delivery_kind", "uc_start_date", "uc_delivery_date", "uc_preleased_pct"]) expect(sql).toContain(c);
    expect(sql).not.toMatch(/create policy/i); // same row-level security as every other comp
  });
  it("a pasted sheet with the grid's own under-construction headers fills the same fields", () => {
    const header = ["Type", "Title / Address", "Size", "Clear Ht (ft)", "Docks", "Status", "Spec/BTS", "Start", "Delivery", "Pre-lsd (%)", "Rate", "Per", "Basis", "Developer", "Notes"];
    const r = ["Under construction", "Katy Spec 3", "250000", "36", "48", "Building", "Spec", "2026-06-01", "2027-03-01", "40", "0.62", "monthly", "NNN", "Acme Dev", "per CoStar"];
    const [{ draft, cellFlags }] = parsePasteBlock(`${header.join("\t")}\n${r.join("\t")}`);
    expect(draft).toMatchObject({
      compType: "under_construction", bldgSizeSf: "250000", clearHeightFt: "36", dockDoors: "48", ucStatus: "under_construction", ucDeliveryKind: "spec",
      ucStartDate: "2026-06-01", ucDeliveryDate: "2027-03-01", ucPreleasedPct: "40", leaseRate: "0.62", leaseRatePeriod: "monthly", partyProvider: "Acme Dev",
    });
    expect(cellFlags.leaseRatePeriod).toBeUndefined();
    // a rate with no period still blocks, same 12x rule as a lease
    const bad = parsePasteBlock(`${header.join("\t")}\n${r.map((v, i) => (i === 11 ? "" : v)).join("\t")}`)[0];
    expect(bad.cellFlags.leaseRatePeriod?.level).toBe("blocking");
  });
});
