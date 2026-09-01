import { describe, it, expect } from "vitest";
import {
  SHEET_COLUMNS, GROUPS, columnIndex, cellState, cellPlaceholder, applyCellEdit,
  fillDownColumn, spillPaste, formatNumberDisplay, sanitizeNumericInput,
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
    expect(cellState(commCol, draftOf("lease", { leaseCommencementDate: "2027-06-01" })).text).toBe("2027-06-01");
  });
  it("placeholder text uses the comp type's own party role name", () => {
    const providerCol = SHEET_COLUMNS[columnIndex("partyProvider")];
    expect(cellPlaceholder(providerCol, "land")).toBe("Seller");
    expect(cellPlaceholder(providerCol, "lease")).toBe("Owner/Developer");
  });
});

describe("compSheetColumns: THREE derived columns, not one — corrected twice in one session", () => {
  it("$/SF or $/AC applies to land/building sale only, greyed on lease", () => {
    const col = SHEET_COLUMNS[columnIndex("salePricePerArea")];
    expect(cellState(col, draftOf("lease")).state).toBe("na");
    expect(cellState(col, draftOf("building_sale", { bldgPrice: "100000", bldgSizeSf: "10000" })).text).toBe("$10.00/SF");
  });
  it("follows the row's OWN recorded size unit — $/AC for an acre-quoted land comp, never converted to SF first", () => {
    const col = SHEET_COLUMNS[columnIndex("salePricePerArea")];
    expect(cellState(col, draftOf("land", { landPrice: "850000", landSizeValue: "100", landSizeUnit: "ac" })).text).toBe("$8,500.00/AC");
    expect(cellState(col, draftOf("land", { landPrice: "100000", landSizeValue: "10000", landSizeUnit: "sf" })).text).toBe("$10.00/SF");
  });
  it("$/SF/yr applies to lease only, greyed on land/sale — no annual claim on a one-time sale price", () => {
    const col = SHEET_COLUMNS[columnIndex("leaseAnnualRate")];
    expect(cellState(col, draftOf("land")).state).toBe("na");
    expect(cellState(col, draftOf("building_sale")).state).toBe("na");
    expect(cellState(col, draftOf("lease", { leaseRate: "0.65", leaseRatePeriod: "monthly", leaseRateExpense: "nnn" })).text).toBe("$7.80/yr NNN");
  });
  it("$/SF/yr and Net Effective both print their basis inline — never silently comparable across NNN/gross", () => {
    const rateCol = SHEET_COLUMNS[columnIndex("leaseAnnualRate")];
    const netCol = SHEET_COLUMNS[columnIndex("netEffective")];
    const draft = draftOf("lease", { leaseRate: "1", leaseRatePeriod: "annual", leaseRateExpense: "gross", leaseTerm: "5 yrs" });
    expect(cellState(rateCol, draft).text).toBe("$1.00/yr GROSS");
    expect(cellState(netCol, draft).text).toBe("$1.00/yr GROSS");
  });
  it("Net Effective is lease-only and grey (em dash) when it can't be computed", () => {
    const netCol = SHEET_COLUMNS[columnIndex("netEffective")];
    expect(cellState(netCol, draftOf("land")).state).toBe("na");
    expect(cellState(netCol, draftOf("lease")).text).toBe("—"); // no rate/term yet
    // emptyDraft's own default basis is "nnn" (comps.js), so a fresh lease draft with no basis
    // TYPED yet still shows NNN here, honestly reflecting the value that would actually save.
    expect(cellState(netCol, draftOf("lease", { leaseRate: "10", leaseRatePeriod: "annual", leaseTerm: "5 yrs" })).text).toBe("$10.00/yr NNN");
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
    const netCol = SHEET_COLUMNS[columnIndex("netEffective")];
    const locCol = SHEET_COLUMNS[columnIndex("location")];
    const d = draftOf("lease");
    expect(applyCellEdit(netCol, d, "999")).toBe(d);
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
