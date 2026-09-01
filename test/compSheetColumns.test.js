import { describe, it, expect } from "vitest";
import {
  SHEET_COLUMNS, GROUPS, columnIndex, cellState, cellPlaceholder, applyCellEdit,
  fillDownColumn, spillPaste, formatNumberDisplay, sanitizeNumericInput, visibleColumnIndices,
  computeFlexWidths, widthFor, frozenLeftOffsets,
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
  it("HARDENING-10 — Type and Title / Address are the two frozen columns, Type first", () => {
    const frozen = SHEET_COLUMNS.filter((c) => c.frozen);
    expect(frozen.map((c) => c.key)).toEqual(["compType", "title"]);
    expect(SHEET_COLUMNS[0].key).toBe("compType"); // "choose deal first because it will inform the rest"
  });
  it("HARDENING-10 — one alignment rule: numeric/date columns are right, everything else is left, never a third value", () => {
    const NUMERIC_OR_DATE_KINDS = new Set(["number", "date", "derived"]);
    for (const c of SHEET_COLUMNS) {
      expect(["left", "right"]).toContain(c.align);
      if (NUMERIC_OR_DATE_KINDS.has(c.kind)) expect(c.align).toBe("right");
      else expect(c.align).toBe("left");
    }
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
  it("HARDENING-10 NEW-4 — cellPlaceholder always returns empty; 'empty means empty', no placeholder words anywhere", () => {
    const providerCol = SHEET_COLUMNS[columnIndex("partyProvider")];
    const acquirerCol = SHEET_COLUMNS[columnIndex("partyAcquirer")];
    expect(cellPlaceholder(providerCol, "land")).toBe("");
    expect(cellPlaceholder(providerCol, "lease")).toBe("");
    expect(cellPlaceholder(acquirerCol, "building_sale")).toBe("");
    expect(cellPlaceholder()).toBe("");
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

describe("compSheetColumns: HARDENING-10 — leaseTerm's cell boundary is bare months, stored value stays free text", () => {
  const termCol = SHEET_COLUMNS[columnIndex("leaseTerm")];
  it("a plain '126 mo' stored value reads as the bare number 126 in the cell", () => {
    expect(cellState(termCol, draftOf("lease", { leaseTerm: "126 mo" })).text).toBe("126");
  });
  it("a 'N yr' stored value converts to months in the cell", () => {
    expect(cellState(termCol, draftOf("lease", { leaseTerm: "10 yr" })).text).toBe("120");
  });
  it("a base term with trailing renewal options still reduces to the BASE term's months", () => {
    // "10 yr + 2x5 options" — the initial term is 10 years; the options describe renewals beyond
    // it, not part of the initial term, so 120 is the correct reduction, not a guess.
    expect(cellState(termCol, draftOf("lease", { leaseTerm: "10 yr + 2x5 options" })).text).toBe("120");
  });
  it("a stored term with no parseable number/unit at all shows empty, never a wrong guess", () => {
    expect(cellState(termCol, draftOf("lease", { leaseTerm: "See Section 4.2" })).text).toBe("");
  });
  it("typing a bare number into the cell stores it as 'N mo' free text", () => {
    const next = applyCellEdit(termCol, draftOf("lease"), "126");
    expect(next.leaseTerm).toBe("126 mo");
    // Round-trips back through the same cell boundary.
    expect(cellState(termCol, next).text).toBe("126");
  });
  it("Term is right-aligned like every other numeric column (HARDENING-10 message B smoking gun)", () => {
    expect(termCol.align).toBe("right");
  });
});

describe("compSheetColumns: HARDENING-10 NEW-1 — Type drives the sheet", () => {
  const typeCol = SHEET_COLUMNS[columnIndex("compType")];
  it("switching a row TO land defaults Unit to AC when it wasn't already set", () => {
    const draft = { ...emptyDraft(null), compType: "lease", landSizeUnit: "" };
    const next = typeCol.setValue(draft, "land");
    expect(next.compType).toBe("land");
    expect(next.landSizeUnit).toBe("ac");
  });
  it("never clobbers a Unit the user already chose", () => {
    const draft = { ...emptyDraft(null), compType: "building_sale", landSizeUnit: "sf" };
    const next = typeCol.setValue(draft, "land");
    expect(next.landSizeUnit).toBe("sf");
  });
  it("switching away from land doesn't touch landSizeUnit at all — Building sale / Lease size is always fixed SF regardless", () => {
    const draft = { ...emptyDraft(null), compType: "land", landSizeUnit: "ac" };
    const next = typeCol.setValue(draft, "lease");
    expect(next.landSizeUnit).toBe("ac"); // untouched (irrelevant for lease — Unit column shows fixed SF)
  });
});

describe("compSheetColumns: HARDENING-10 NEW-5 — computeFlexWidths / widthFor / frozenLeftOffsets", () => {
  it("plenty of room: the three growers share the surplus beyond everyone's nominal, Title getting the largest share; Notes never grows past its own nominal", () => {
    const w = computeFlexWidths(10000);
    expect(w.title).toBeGreaterThan(w.partyProvider);
    expect(w.title).toBeGreaterThan(w.partyAcquirer);
    expect(w.notes).toBe(90);
  });
  it("moderate squeeze: Notes alone absorbs it first, growers stay at nominal", () => {
    const w = computeFlexWidths(500); // full nominal total is 510; 10px short
    expect(w.notes).toBe(80);
    expect(w.title).toBe(170);
    expect(w.partyProvider).toBe(125);
    expect(w.partyAcquirer).toBe(125);
  });
  it("severe squeeze: Notes is pinned at its own floor, the three growers then shrink together, never below their own floor", () => {
    const w = computeFlexWidths(0);
    expect(w.notes).toBe(55);
    expect(w.title).toBe(90);
    expect(w.partyProvider).toBe(65);
    expect(w.partyAcquirer).toBe(65);
  });
  it("every regime keeps every column at or above its own floor, and never returns a negative width", () => {
    for (const avail of [-50, 0, 100, 275, 320, 510, 900, 5000]) {
      const w = computeFlexWidths(avail);
      expect(w.title).toBeGreaterThanOrEqual(90);
      expect(w.partyProvider).toBeGreaterThanOrEqual(65);
      expect(w.partyAcquirer).toBeGreaterThanOrEqual(65);
      expect(w.notes).toBeGreaterThanOrEqual(55);
    }
  });
  it("widthFor returns the column's static width when there's no flexKey, or an unmeasured flex column falls back to its own static width", () => {
    const sizeCol = SHEET_COLUMNS[columnIndex("size")];
    expect(widthFor(sizeCol, {})).toBe(sizeCol.width);
    const titleCol = SHEET_COLUMNS[columnIndex("title")];
    expect(widthFor(titleCol, {})).toBe(titleCol.width); // {} — no measurement yet
    expect(widthFor(titleCol, { title: 200 })).toBe(200);
  });
  it("frozenLeftOffsets puts Type at 0 and Title right after Type's own (possibly flexed) width", () => {
    const idx = SHEET_COLUMNS.map((_, i) => i); // every column visible
    const flexWidths = { title: 150, partyProvider: 100, partyAcquirer: 100, notes: 70 };
    const offsets = frozenLeftOffsets(idx, flexWidths);
    expect(offsets.compType).toBe(0);
    expect(offsets.title).toBe(SHEET_COLUMNS[columnIndex("compType")].width);
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
  it("HARDENING-10 NEW-1 — a new blank row created by an overrun paste defaults Type to the row above's", () => {
    const rows = [rowOf("building_sale")];
    // emptyDraftFn mirrors the real caller: () => emptyDraft(null), always compType 'land'.
    const next = spillPaste(rows, 0, columnIndex("partyProvider"), "Acme\nBeta\nGamma", () => emptyDraft(null), newId);
    expect(next).toHaveLength(3);
    expect(next[1].draft.compType).toBe("building_sale");
    expect(next[2].draft.compType).toBe("building_sale");
  });
  it("the paste's own Type cell still wins over the inherited default when the pasted block carries one", () => {
    const rows = [rowOf("lease")];
    const typeIdx = columnIndex("compType");
    // A one-column paste (Type only) spilling down two rows — row 2's own "Land" cell must win
    // over whatever it would otherwise have inherited from row 1 ("lease").
    const next = spillPaste(rows, 0, typeIdx, "Lease\nLand", () => emptyDraft(null), newId);
    expect(next).toHaveLength(2);
    expect(next[1].draft.compType).toBe("land");
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
    // HARDENING-10 — bare digits only; the header ("Cap (%)") states the unit now, not the cell.
    expect(capCell.text).toBe("5.75");
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
    expect(capCell.text).toBe("6"); // formatNumberDisplay("6") — bare digits, header states "(%)"
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
    expect(capCell.text).toBe("5.75"); // the TYPED value, unmodified, bare digits
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
