// Available space (a vacancy) — a fifth comp type, SUPPLY beside under construction. Owner ask
// 2026-11-24: "we should also log vacancies"; approved shape: ONE "Log supply" row in the map's Record
// info menu with Under construction / Available space inside.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMP_TYPES, rowToComp, compToRow, emptyDraft, draftToComp, compToDraft, validateComp, compFieldRows,
  compHeadline, compBadgeLabel, compRecordSections, partyLabels, convertDeliveredComp, convertTargetsFor,
  summarizeLeaseComps, isSupplyType,
} from "../src/shared/comps/lib/comps.js";
import { SELECT_COLS } from "../src/shared/comps/lib/compsStore.js";
import { SHEET_COLUMNS, TYPE_OPTIONS, draftWithType } from "../src/shared/comps/lib/compSheetColumns.js";
import { parsePasteBlock } from "../src/shared/comps/lib/compParse.js";
import { mobileSections } from "../src/shared/comps/lib/compMobileLayout.js";
import { applyFilters, activeFilterChips, normalizeFilters, TYPE_FILTER_LABEL } from "../src/shared/comps/lib/compsQuery.js";
import { compMarkerColor, compMarkerSvg } from "../src/shared/comps/lib/compMarkerIcon.js";
import { verbLabel } from "../src/workspaces/site-planner/lib/decideBar.js";

const ANCHOR = { kind: "pin", lat: 29.76, lon: -95.37, county: "harris" };
const row = {
  id: "a1", user_id: "me", comp_type: "available", comp_date: null, title: "Northwest Crossing Bldg 4", anchor_kind: "pin", lat: 29.76, lon: -95.37,
  lease_size_sf: "120000", bldg_size_sf: "300000", clear_height_ft: "32", dock_doors: 24,
  comp_party_provider: "Owner LP", comp_party_acquirer: "Broker Co",
  lease_rate: "0.58", lease_rate_period: "monthly", lease_rate_expense: "nnn",
  av_kind: "sublease", av_date: "2027-02-01", created_at: "2026-11-01T00:00:00Z",
};

describe("available-space comp type", () => {
  it("is a registered SUPPLY type, in the type menus and the filter labels", () => {
    expect(COMP_TYPES).toContain("available");
    expect(isSupplyType("available")).toBe(true);
    expect(isSupplyType("lease")).toBe(false);
    expect(TYPE_OPTIONS.some((o) => o.value === "available")).toBe(true);
    expect(TYPE_FILTER_LABEL.available).toBe("Available");
  });
  it("round-trips row -> comp -> draft -> comp -> row without losing a field", () => {
    const comp = rowToComp(row);
    expect(comp).toMatchObject({ avKind: "sublease", avDate: "2027-02-01", leaseSizeSf: 120000, bldgSizeSf: 300000 });
    const back = compToRow(draftToComp(compToDraft(comp)));
    expect(back).toMatchObject({ comp_type: "available", comp_date: null, av_kind: "sublease", av_date: "2027-02-01", lease_size_sf: 120000, bldg_size_sf: 300000 });
  });
  it("a blank draft writes NULL into the constrained av_* columns, and the store reads them back", () => {
    const r = compToRow(draftToComp({ ...emptyDraft(ANCHOR), compType: "available" }));
    expect(r.av_kind).toBeNull();
    expect(r.av_date).toBeNull();
    for (const col of ["av_kind", "av_date"]) expect(SELECT_COLS).toContain(col);
  });
  it("labels the parties Landlord / Listing broker and needs a period with an asking rate", () => {
    expect(partyLabels("available")).toEqual({ provider: "Landlord", acquirer: "Listing broker" });
    const base = { ...emptyDraft(ANCHOR), compType: "available" };
    expect(validateComp(draftToComp(base))).toEqual([]);
    expect(validateComp(draftToComp({ ...base, leaseRate: "0.58" })).join()).toMatch(/rent period/);
  });
  it("shows the record in plain words", () => {
    const comp = rowToComp(row);
    const rows = compFieldRows(comp);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.avKind.value).toBe("Sublease");
    expect(byKey.avSize.value).toBe("120,000 SF");
    expect(byKey.rate.label).toBe("Asking rate");
    expect(byKey.date).toBeUndefined();
    expect(compBadgeLabel("available")).toBe("AVAILABLE");
    expect(compHeadline(comp)).toBe("Sublease available · 120,000 SF");
    expect(compRecordSections(comp).map((s) => s.id)).toContain("deal");
  });
  it("never enters a transaction average", () => {
    const av = rowToComp(row);
    const lease = rowToComp({ ...row, id: "l1", comp_type: "lease", comp_date: "2026-10-01", av_kind: null, av_date: null });
    expect(JSON.stringify(summarizeLeaseComps([lease, av]))).toBe(JSON.stringify(summarizeLeaseComps([lease])));
  });
});

describe("a building's life: under construction -> available -> lease / sale", () => {
  const uc = rowToComp({
    id: "u1", comp_type: "under_construction", title: "Katy Spec 3", anchor_kind: "pin", lat: 29.76, lon: -95.37,
    bldg_size_sf: "250000", clear_height_ft: "36", dock_doors: 48, comp_party_provider: "Acme Dev", comp_party_acquirer: "Tenant Co",
    lease_rate: "0.62", lease_rate_period: "monthly", lease_rate_expense: "nnn", uc_status: "delivered", uc_delivery_date: "2027-03-01",
  });
  it("offers the right next steps for each type", () => {
    expect(convertTargetsFor("under_construction")).toEqual(["available", "lease", "building_sale"]);
    expect(convertTargetsFor("available")).toEqual(["lease", "building_sale"]);
    expect(convertTargetsFor("lease")).toEqual([]);
  });
  it("under construction -> available keeps the building, the developer and the asking rate", () => {
    const d = convertDeliveredComp(uc, "available");
    expect(d).toMatchObject({
      id: "u1", compType: "available", title: "Katy Spec 3", partyProvider: "Acme Dev", partyAcquirer: "",
      bldgSizeSf: "250000", leaseSizeSf: "250000", clearHeightFt: "36", dockDoors: "48",
      leaseRate: "0.62", leaseRatePeriod: "monthly", avKind: "direct", avDate: "2027-03-01", compDate: "", ucStatus: "",
    });
    expect(validateComp(draftToComp(d))).toEqual([]);
  });
  it("a partly pre-leased building never guesses the available SF", () => {
    const d = convertDeliveredComp({ ...uc, ucPreleasedPct: 40 }, "available");
    expect(d.leaseSizeSf).toBe("");
    expect(d.bldgSizeSf).toBe("250000");
  });
  it("available -> lease: available SF becomes leased SF, the broker never becomes the tenant", () => {
    const d = convertDeliveredComp(rowToComp(row), "lease");
    expect(d).toMatchObject({ compType: "lease", leaseSizeSf: "120000", bldgSizeSf: "", partyProvider: "Owner LP", partyAcquirer: "", leaseRate: "0.58", avKind: "", avDate: "", compDate: "" });
    expect(validateComp(draftToComp(d))).toEqual([]);
  });
  it("available -> sale keeps the building size and drops the rate", () => {
    const d = convertDeliveredComp(rowToComp(row), "building_sale");
    expect(d).toMatchObject({ compType: "building_sale", bldgSizeSf: "300000", leaseSizeSf: "", leaseRate: "", leaseRatePeriod: "", partyAcquirer: "" });
    const noBldg = convertDeliveredComp(rowToComp({ ...row, bldg_size_sf: null }), "building_sale");
    expect(noBldg.bldgSizeSf).toBe("120000");
  });
});

describe("available space in the sheet, filters, map and the Log supply menu", () => {
  it("only its own columns apply; the executed date does not", () => {
    const applies = (k) => SHEET_COLUMNS.find((c) => c.key === k).appliesTo("available");
    for (const k of ["avKind", "avDate", "leaseRate", "leaseRatePeriod", "leaseRateExpense", "clearHeightFt", "dockDoors"]) expect(applies(k)).toBe(true);
    for (const k of ["compDate", "ucStatus", "leaseCommencementDate"]) expect(applies(k)).toBe(false);
    const size = SHEET_COLUMNS.find((c) => c.key === "size");
    expect(size.setValue({ ...emptyDraft(ANCHOR), compType: "available" }, "50000").leaseSizeSf).toBe("50000");
    expect(mobileSections("available").some((s) => s.title === "Rent")).toBe(true);
  });
  it("choosing the type up front applies the same defaults as picking it in the sheet", () => {
    expect(draftWithType(emptyDraft(ANCHOR), "available")).toMatchObject({ compType: "available", avKind: "direct", leaseRateExpense: "nnn" });
    expect(draftWithType(emptyDraft(ANCHOR), "under_construction")).toMatchObject({ compType: "under_construction", ucStatus: "under_construction" });
  });
  it("is filterable on its own and searchable by its words", () => {
    const av = rowToComp(row);
    const lease = rowToComp({ ...row, id: "l1", comp_type: "lease", comp_date: "2026-10-01" });
    const only = (types) => applyFilters([av, lease], normalizeFilters({ types })).map((c) => c.id);
    expect(only(["available"])).toEqual(["a1"]);
    expect(only(["lease"])).toEqual(["l1"]);
    expect(activeFilterChips({ types: ["available"] }).map((c) => c.label)).toContain("Available");
    expect(applyFilters([av, lease], normalizeFilters({ q: "sublease" })).map((c) => c.id)).toContain("a1");
  });
  it("has its own colour and a hollow-centred marker", () => {
    const cols = ["land", "building_sale", "lease", "under_construction"].map(compMarkerColor);
    expect(cols).not.toContain(compMarkerColor("available"));
    expect(compMarkerSvg("available")).not.toBe(compMarkerSvg("lease").replace(compMarkerColor("lease"), compMarkerColor("available")));
  });
  it("a pasted sheet with the grid's own headers fills the same fields", () => {
    const header = ["Type", "Title / Address", "Size", "Space", "Avail.", "Rate", "Per", "Basis", "Landlord", "Listing broker"];
    const r = ["Available", "NW Crossing 4", "120000", "Sublease", "2027-02-01", "0.58", "monthly", "NNN", "Owner LP", "Broker Co"];
    const [{ draft }] = parsePasteBlock(`${header.join("\t")}\n${r.join("\t")}`);
    expect(draft).toMatchObject({ compType: "available", leaseSizeSf: "120000", avKind: "sublease", avDate: "2027-02-01", leaseRate: "0.58", leaseRatePeriod: "monthly" });
  });
  it("the map menu row reads 'Log supply'", () => {
    expect(verbLabel("supply", 1)).toBe("Log supply");
    // source-scan: the Record info menu holds the choice INSIDE the one row (owner-approved shape)
    const src = readFileSync("src/workspaces/site-planner/MapFinder.jsx", "utf8");
    expect(src).toMatch(/key: "supply"/);
    expect(src).toMatch(/map-decide-supply-\$\{c\.type\}/);
    expect(src).toMatch(/type: "available", label: "Available space"/);
  });
  it("the migration allows the type and adds the two columns, with RLS left to comps.sql", () => {
    // source-scan: pins the shipped migration text (the SQL is the artefact under test)
    const sql = readFileSync("src/shared/comps/db/comps_available_space.sql", "utf8");
    expect(sql).toMatch(/'available'/);
    expect(sql).toMatch(/'under_construction'/);
    for (const c of ["av_kind", "av_date"]) expect(sql).toContain(c);
    expect(sql).not.toMatch(/create policy/i);
  });
});
