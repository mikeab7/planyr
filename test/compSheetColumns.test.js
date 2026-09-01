import { describe, it, expect } from "vitest";
import {
  SHEET_COLUMNS, GROUPS, columnIndex, cellState, cellPlaceholder, applyCellEdit,
  fillDownColumn, spillPaste, formatNumberDisplay, sanitizeNumericInput, visibleColumnIndices,
} from "../src/shared/comps/lib/compSheetColumns.js";
import { emptyDraft } from "../src/shared/comps/lib/comps.js";

let _seq = 0;
function newId() { return `t${_seq++}`; }
function draftOf(compType, overrides = {}) {
  return { ...emptyDraft(null), compType, ...overrides };
}
function rowOf(compType, overrides = {}) {
  return { _id: newId(), draft: draftOf(compType, overrides), cellFlags: {} };
}

describe("compSheetColumns: column list sanity", () => {
  it("every column belongs to a real group", () => {
    for (const c of SHEET_COLUMNS) expect(GROUPS).toContain(c.group);
  });
  it("Title / Address is the only frozen column — 'freeze through Title / address'", () => {
    const frozen = SHEET_COLUMNS.filter((c) => c.frozen);
    expect(frozen.map((c) => c.key)).toEqual(["title"]);
  });
  it("columnIndex finds a real column and -1 for a bogus key", () => {
    expect(columnIndex("leaseRate")).toBeGreaterThanOrEqual(0);
    expect(columnIndex("nope")).toBe(-1);
  });
});

describe("compSheetColumns: cellState — EVERY column exists on EVERY row (never a different column set)", () => {
  it("a column that doesn't apply to this row's type renders as an em dash, never blank/hidden", () => {
    const land = draftOf("land");
    const rateCol = SHEET_COLUMNS[columnIndex("leaseRate")];
    expect(cellState(rateCol, land)).toEqual({ state: "na", text: "—" });
  });
  it("Price applies to land/building_sale, not lease", () => {
    const priceCol = SHEET_COLUMNS[columnIndex("price")];
    expect(cellState(priceCol, draftOf("lease")).state).toBe("na");
    expect(cellState(priceCol, draftOf("land", { landPrice: "850000" })).text).toBe("850,000");
  });
  it("Size is polymorphic — reads the right field per type", () => {
    const sizeCol = SHEET_COLUMNS[columnIndex("size")];
    expect(cellState(sizeCol, draftOf("land", { landSizeValue: "3.2" })).text).toBe("3.2");
    expect(cellState(sizeCol, draftOf("building_sale", { bldgSizeSf: "25000" })).text).toBe("25,000");
    expect(cellState(sizeCol, draftOf("lease", { leaseSizeSf: "613208" })).text).toBe("613,208");
  });
  it("Unit is editable for land, FIXED (not em-dash — it applies, just not a choice) for others", () => {
    const unitCol = SHEET_COLUMNS[columnIndex("landSizeUnit")];
    expect(cellState(unitCol, draftOf("land", { landSizeUnit: "ac" }))).toEqual({ state: "editable", text: "AC", raw: "ac" });
    expect(cellState(unitCol, draftOf("lease"))).toEqual({ state: "fixed", text: "SF" });
    expect(cellState(unitCol, draftOf("building_sale"))).toEqual({ state: "fixed", text: "SF" });
  });
  it("Commencement and Term apply to lease only", () => {
    const commCol = SHEET_COLUMNS[columnIndex("leaseCommencementDate")];
    const termCol = SHEET_COLUMNS[columnIndex("leaseTerm")];
    expect(cellState(commCol, draftOf("land")).state).toBe("na");
    expect(cellState(termCol, draftOf("building_sale")).state).toBe("na");
    // HARDENING-8 — a date cell shows mm/dd/yy (this app's display convention), never the raw
    // ISO the draft actually stores.
    expect(cellState(commCol, draftOf("lease", { leaseCommencementDate: "2027-06-01" })).text).toBe("06/01/27");
  });
  it("placeholder text uses the comp type's own party role name", () => {
    const providerCol = SHEET_COLUMNS[columnIndex("partyProvider")];
    expect(cellPlaceholder(providerCol, "land")).toBe("Seller");
    expect(cellPlaceholder(providerCol, "lease")).toBe("Owner/Developer");
  });
});

describe("compSheetColumns: TWO derived columns (HARDENING-9 removed Net Effective from the sheet)", () => {
  it("$/SF or $/AC applies to land/building sale only, greyed on lease", () => {
    const col = SHEET_COLUMNS[columnIndex("salePricePerArea")];
    expect(cellState(col, draftOf("lease")).state).toBe("na");
    expect(cellState(col, draftOf("building_sale", { bldgPrice: "100000", bldgSizeSf: "10000" })).text).toBe("10.00/SF");
  });
  it("follows the row's OWN recorded size unit — $/AC for an acre-quoted land comp, never converted to SF first", () => {
    const col = SHEET_COLUMNS[columnIndex("salePricePerArea")];
    expect(cellState(col, draftOf("land", { landPrice: "850000", landSizeValue: "100", landSizeUnit: "ac" })).text).toBe("8,500.00/AC");
    expect(cellState(col, draftOf("land", { landPrice: "100000", landSizeValue: "10000", landSizeUnit: "sf" })).text).toBe("10.00/SF");
  });
  it("$/SF/yr applies to lease only, greyed on land/sale — no annual claim on a one-time sale price", () => {
    const col = SHEET_COLUMNS[columnIndex("leaseAnnualRate")];
    expect(cellState(col, draftOf("land")).state).toBe("na");
    expect(cellState(col, draftOf("building_sale")).state).toBe("na");
    // HARDENING-9 — the header already states "$/SF/yr" (ONE fixed unit), so the cell drops the
    // "$" and "/yr" it used to repeat and shows the number + the basis (new info, not a repeat).
    expect(cellState(col, draftOf("lease", { leaseRate: "0.65", leaseRatePeriod: "monthly", leaseRateExpense: "nnn" })).text).toBe("7.80 NNN");
  });
  it("$/SF/yr prints its basis inline — never silently comparable across NNN/gross", () => {
    const rateCol = SHEET_COLUMNS[columnIndex("leaseAnnualRate")];
    const draft = draftOf("lease", { leaseRate: "1", leaseRatePeriod: "annual", leaseRateExpense: "gross", leaseTerm: "5 yrs" });
    expect(cellState(rateCol, draft).text).toBe("1.00 GROSS");
  });
  it("Net Effective no longer exists as a sheet column — the underlying inputs (term, free rent, escalation, TI) still do", () => {
    expect(columnIndex("netEffective")).toBe(-1);
    expect(columnIndex("leaseTerm")).toBeGreaterThanOrEqual(0);
    expect(columnIndex("leaseFreeRentMonths")).toBeGreaterThanOrEqual(0);
    expect(columnIndex("leaseEscalationPct")).toBeGreaterThanOrEqual(0);
    expect(columnIndex("leaseTi")).toBeGreaterThanOrEqual(0);
  });
});

describe("compSheetColumns: applyCellEdit", () => {
  it("number columns sanitize to digits/one decimal point", () => {
    const priceCol = SHEET_COLUMNS[columnIndex("price")];
    const d = applyCellEdit(priceCol, draftOf("land"), "$1,234.56 ");
    expect(d.landPrice).toBe("1234.56");
  });
  it("select columns loosely match typed text and never guess an unmatched value", () => {
    const perCol = SHEET_COLUMNS[columnIndex("leaseRatePeriod")];
    expect(applyCellEdit(perCol, draftOf("lease"), "y").leaseRatePeriod).toBe("annual");
    expect(applyCellEdit(perCol, draftOf("lease"), "MO").leaseRatePeriod).toBe("monthly");
    const unchanged = draftOf("lease", { leaseRatePeriod: "monthly" });
    expect(applyCellEdit(perCol, unchanged, "xyz")).toBe(unchanged); // nothing matched, draft untouched
  });
  it("derived and action columns are never editable", () => {
    const rateCol = SHEET_COLUMNS[columnIndex("leaseAnnualRate")];
    const locCol = SHEET_COLUMNS[columnIndex("location")];
    const d = draftOf("lease");
    expect(applyCellEdit(rateCol, d, "999")).toBe(d);
    expect(applyCellEdit(locCol, d, "anything")).toBe(d);
  });
});

describe("compSheetColumns: fillDownColumn (Ctrl/Cmd+D)", () => {
  it("copies the top row's value down through the range", () => {
    const rows = [rowOf("land", { partyProvider: "Acme LLC" }), rowOf("land"), rowOf("land")];
    const next = fillDownColumn(rows, columnIndex("partyProvider"), [0, 2]);
    expect(next[1].draft.partyProvider).toBe("Acme LLC");
    expect(next[2].draft.partyProvider).toBe("Acme LLC");
  });
  it("never fills a value onto a row the column doesn't apply to", () => {
    const rows = [rowOf("lease", { leaseRate: "0.65" }), rowOf("land")];
    const next = fillDownColumn(rows, columnIndex("leaseRate"), [0, 1]);
    expect(next[1].draft.landPrice).toBe(""); // untouched — leaseRate isn't a land field
    expect(next[1].draft).not.toHaveProperty("leaseRateFilled");
  });
  it("clears the target cell's flag on fill", () => {
    const rows = [rowOf("land", { landPrice: "850000" }), { ...rowOf("land"), cellFlags: { landPrice: { level: "soft", reason: "x" } } }];
    const next = fillDownColumn(rows, columnIndex("price"), [0, 1]);
    expect(next[1].cellFlags.landPrice).toBeUndefined();
  });
  it("no-op when the range is a single cell", () => {
    const rows = [rowOf("land", { partyProvider: "Acme" })];
    expect(fillDownColumn(rows, columnIndex("partyProvider"), [0, 0])).toBe(rows);
  });
});

describe("compSheetColumns: spillPaste — Excel-style paste into the selected cell", () => {
  it("a single-cell paste (no tabs, one line) writes just that cell", () => {
    const rows = [rowOf("land")];
    const next = spillPaste(rows, 0, columnIndex("partyProvider"), "Acme LLC", () => draftOf("land"), newId);
    expect(next[0].draft.partyProvider).toBe("Acme LLC");
  });
  it("a tab-delimited paste spills right across columns", () => {
    const rows = [rowOf("land")];
    const next = spillPaste(rows, 0, columnIndex("partyProvider"), "Acme LLC\tBeta Corp", () => draftOf("land"), newId);
    expect(next[0].draft.partyProvider).toBe("Acme LLC");
    expect(next[0].draft.partyAcquirer).toBe("Beta Corp");
  });
  it("a newline-delimited paste spills down rows, extending the array if it runs past the end", () => {
    const rows = [rowOf("land")];
    const next = spillPaste(rows, 0, columnIndex("partyProvider"), "Acme\nBeta\nGamma", () => draftOf("land"), newId);
    expect(next).toHaveLength(3);
    expect(next.map((r) => r.draft.partyProvider)).toEqual(["Acme", "Beta", "Gamma"]);
  });
  it("skips a cell whose column doesn't apply to that row's type", () => {
    const rows = [rowOf("land")];
    const next = spillPaste(rows, 0, columnIndex("leaseRate"), "0.65", () => draftOf("land"), newId);
    expect(next[0].draft.landPrice).toBe(""); // leaseRate doesn't apply to a land row — silently skipped, not an error
  });
});

describe("compSheetColumns: number formatting helpers", () => {
  it("formats with commas at rest, preserving the typed decimal precision", () => {
    expect(formatNumberDisplay("613208")).toBe("613,208");
    expect(formatNumberDisplay("0.65")).toBe("0.65");
    expect(formatNumberDisplay("")).toBe("");
  });
  it("sanitizes typed input to digits + one decimal point", () => {
    expect(sanitizeNumericInput("$1,234.56")).toBe("1234.56");
    expect(sanitizeNumericInput("12.3.4")).toBe("12.34");
  });
});

describe("compSheetColumns: PRICE band (B986096-HARDENING-7) — Price/NOI/Cap, own group, sale-scoped triangle", () => {
  it("Price, NOI and Cap are all in the PRICE group, not RENT", () => {
    expect(SHEET_COLUMNS[columnIndex("price")].group).toBe("PRICE");
    expect(SHEET_COLUMNS[columnIndex("bldgNoi")].group).toBe("PRICE");
    expect(SHEET_COLUMNS[columnIndex("bldgCapRate")].group).toBe("PRICE");
  });
  it("RENT is lease-only now that Price moved out — every RENT column applies only to lease", () => {
    const rentCols = SHEET_COLUMNS.filter((c) => c.group === "RENT");
    expect(rentCols.length).toBeGreaterThan(0);
    for (const c of rentCols) {
      expect(c.appliesTo("lease")).toBe(true);
      expect(c.appliesTo("land")).toBe(false);
      expect(c.appliesTo("building_sale")).toBe(false);
    }
  });
  it("NOI and Cap grey out (em dash) on land — Michael scoped cap rate to building sales only", () => {
    const land = draftOf("land", { landPrice: "850000" });
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgNoi")], land)).toEqual({ state: "na", text: "—" });
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], land)).toEqual({ state: "na", text: "—" });
    // Price itself stays PLAIN/editable for land — never triangle-aware there.
    expect(cellState(SHEET_COLUMNS[columnIndex("price")], land)).toEqual({ state: "editable", text: "850,000", raw: "850000" });
  });
  it("enter Price + NOI on a building sale — Cap renders DERIVED (tinted, read-only)", () => {
    const draft = draftOf("building_sale", { bldgPrice: "38000000", bldgNoi: "2185000" });
    const capCell = cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], draft);
    expect(capCell.state).toBe("derived");
    expect(capCell.text).toBe("5.75%");
    // The two GIVEN cells stay editable, showing exactly what was typed.
    expect(cellState(SHEET_COLUMNS[columnIndex("price")], draft)).toEqual({ state: "editable", text: "38,000,000", raw: "38000000" });
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgNoi")], draft)).toEqual({ state: "editable", text: "2,185,000", raw: "2185000" });
  });
  it("enter Price + Cap — NOI renders derived; Cap is typed/shown as a PERCENTAGE, stored as a fraction", () => {
    const draft = draftOf("building_sale", { bldgPrice: "10000000", bldgCapRate: "0.06" });
    const noiCell = cellState(SHEET_COLUMNS[columnIndex("bldgNoi")], draft);
    expect(noiCell.state).toBe("derived");
    expect(noiCell.text).toBe("600,000");
    const capCell = cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], draft);
    expect(capCell.state).toBe("editable");
    expect(capCell.text).toBe("6%"); // formatNumberDisplay("6") — no forced trailing zeros on a typed value
    expect(capCell.raw).toBe("6"); // the EDIT box shows the percentage form, never the raw 0.06 fraction
  });
  it("enter NOI + Cap — Price renders derived", () => {
    const draft = draftOf("building_sale", { bldgNoi: "600000", bldgCapRate: "0.06" });
    const priceCell = cellState(SHEET_COLUMNS[columnIndex("price")], draft);
    expect(priceCell.state).toBe("derived");
    expect(priceCell.text).toBe("10,000,000");
  });
  it("fewer than two given — all three stay plain editable, nothing derived", () => {
    const draft = draftOf("building_sale", { bldgPrice: "10000000" });
    expect(cellState(SHEET_COLUMNS[columnIndex("price")], draft).state).toBe("editable");
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgNoi")], draft)).toEqual({ state: "editable", text: "", raw: "" });
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], draft)).toEqual({ state: "editable", text: "", raw: "" });
  });
  it("all three given and reconciling — none is derived, all stay editable", () => {
    const draft = draftOf("building_sale", { bldgPrice: "38000000", bldgNoi: "2185000", bldgCapRate: "0.0575" });
    expect(cellState(SHEET_COLUMNS[columnIndex("price")], draft).state).toBe("editable");
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgNoi")], draft).state).toBe("editable");
    const capCell = cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], draft);
    expect(capCell.state).toBe("editable");
    expect(capCell.text).toBe("5.75%"); // the TYPED value, unmodified
  });
  it("a derived triangle cell is NOT enterable — beginEdit's own gate reads exactly this state", () => {
    const draft = draftOf("building_sale", { bldgPrice: "38000000", bldgNoi: "2185000" });
    expect(cellState(SHEET_COLUMNS[columnIndex("bldgCapRate")], draft).state).not.toBe("editable");
  });
  it("applyCellEdit on Cap % converts a typed percentage into the stored fraction", () => {
    const draft = draftOf("building_sale");
    const capCol = SHEET_COLUMNS[columnIndex("bldgCapRate")];
    const next = applyCellEdit(capCol, draft, "5.75");
    expect(next.bldgCapRate).toBe("0.0575");
  });
  it("fillDownColumn on Cap % copies the raw (percentage-typed) value, converting on write like any edit", () => {
    const rows = [rowOf("building_sale", { bldgCapRate: "0.0575" }), rowOf("building_sale")];
    const next = fillDownColumn(rows, columnIndex("bldgCapRate"), [0, 1]);
    expect(next[1].draft.bldgCapRate).toBe("0.0575");
  });
});

describe("compSheetColumns: visibleColumnIndices — 'hide unused columns entirely'", () => {
  it("with no rows, every column is visible (nothing to hide against yet)", () => {
    expect(visibleColumnIndices([])).toEqual(SHEET_COLUMNS.map((_, i) => i));
    expect(visibleColumnIndices(null)).toEqual(SHEET_COLUMNS.map((_, i) => i));
  });
  it("a lease-only sheet hides every land/building-sale-only column (Price/NOI/Cap/$-per-area)", () => {
    const idx = visibleColumnIndices([rowOf("lease"), rowOf("lease")]);
    const keys = idx.map((i) => SHEET_COLUMNS[i].key);
    expect(keys).not.toContain("bldgNoi");
    expect(keys).not.toContain("bldgCapRate");
    expect(keys).not.toContain("salePricePerArea");
    // Price still shows — it applies to land AND building_sale, but a LEASE row doesn't use it,
    // so on a lease-only sheet it should be hidden too.
    expect(keys).not.toContain("price");
    expect(keys).toContain("leaseRate");
    expect(keys).toContain("leaseAnnualRate");
  });
  it("a land-only sheet hides every lease-only column", () => {
    const idx = visibleColumnIndices([rowOf("land")]);
    const keys = idx.map((i) => SHEET_COLUMNS[i].key);
    expect(keys).not.toContain("leaseRate");
    expect(keys).not.toContain("leaseCommencementDate");
    expect(keys).not.toContain("leaseAnnualRate");
    expect(keys).not.toContain("bldgNoi"); // building-sale only, not land
    expect(keys).toContain("price"); // land uses Price
    expect(keys).toContain("salePricePerArea");
  });
  it("a mixed sheet shows the union — a column visible if ANY current row uses it", () => {
    const idx = visibleColumnIndices([rowOf("land"), rowOf("lease")]);
    const keys = idx.map((i) => SHEET_COLUMNS[i].key);
    expect(keys).toContain("price"); // land
    expect(keys).toContain("leaseRate"); // lease
    expect(keys).not.toContain("bldgNoi"); // neither row is building_sale
  });
  it("PROPERTY columns (Title/Size/Unit/Location) are always visible — every type uses them", () => {
    for (const type of ["land", "building_sale", "lease"]) {
      const keys = visibleColumnIndices([rowOf(type)]).map((i) => SHEET_COLUMNS[i].key);
      expect(keys).toContain("title");
      expect(keys).toContain("size");
      expect(keys).toContain("landSizeUnit");
      expect(keys).toContain("location");
    }
  });
  it("indices come back in SHEET_COLUMNS order, never reordered", () => {
    const idx = visibleColumnIndices([rowOf("land"), rowOf("lease"), rowOf("building_sale")]);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});
