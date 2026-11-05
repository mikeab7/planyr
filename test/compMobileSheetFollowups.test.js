import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompEntryMobileSheet from "../src/shared/comps/components/CompEntryMobileSheet.jsx";
import { saveState, saveTapPlan, rowBlocker, rowBlockerInfo, rowFieldState, hugWidthCh } from "../src/shared/comps/lib/compMobileSheetModel.js";
import { activeCellFlags, cellState, SHEET_COLUMNS, columnIndex } from "../src/shared/comps/lib/compSheetColumns.js";
import { emptyDraft, draftToComp, validateComp } from "../src/shared/comps/lib/comps.js";
import { rowHasBlockingFlags } from "../src/shared/comps/lib/compParse.js";

const PIN = { kind: "pin", lat: 1, lon: 2 };
const row = (compType, o = {}, cellFlags = {}) => ({ _id: "r", draft: { ...emptyDraft(null), compType, ...o }, cellFlags });
const ready = (r) => !rowHasBlockingFlags(activeCellFlags(r.cellFlags, r.draft.compType)) && validateComp(draftToComp(r.draft)).length === 0;
const label = (r) => saveState({ rows: [r], readyCount: ready(r) ? 1 : 0 }).label;
const PERIOD_FLAG = { leaseRatePeriod: { level: "blocking", reason: "12x" } };

describe("NEW-3 (round 1) / NEW-9 (round 3) — the REAL blocker, reported by saveTapPlan not by the Save label", () => {
  const info = (r) => rowBlockerInfo(r);
  for (const t of ["lease", "land", "building_sale"]) {
    it(`${t}: unplaced → location`, () => expect(info(row(t))?.kind).toBe("location"));
    it(`${t}: placed, size + price + rate empty → saveable (size/price/rate are not required)`, () => {
      expect(info(row(t, { anchor: PIN }))).toBe(null);
      expect(ready(row(t, { anchor: PIN }))).toBe(true);
    });
  }
  it("NEW-1: a BLANK lease with a pin saves — a missing period only blocks when a rate is present", () => {
    const r = row("lease", { anchor: PIN });
    expect(ready(r)).toBe(true);
    const plan = saveTapPlan({ rows: [r], isReady: ready });
    expect(plan.toSave).toHaveLength(1);
    expect(plan.target).toBe(null);
  });
  it("lease with a rate, no period and no guess → period blocker, routed to the Rate row", () => {
    const r = row("lease", { anchor: PIN, leaseRate: "2.5" });
    expect(info(r)).toMatchObject({ kind: "period", key: "leaseRate" });
    const plan = saveTapPlan({ rows: [r], isReady: ready });
    expect(plan.toSave).toHaveLength(0);
    expect(plan.target).toMatchObject({ rowId: "r", kind: "period" });
    expect(row("lease", { anchor: PIN, leaseRate: "2.5", leaseRatePeriod: "annual" })).toBeTruthy();
    expect(ready(row("lease", { anchor: PIN, leaseRate: "2.5", leaseRatePeriod: "annual" }))).toBe(true);
  });
  it("a blocking period flag (paste ambiguity) with a rate and no period routes to the Rate row", () => {
    expect(info(row("lease", { anchor: PIN, leaseRate: "6.25" }, PERIOD_FLAG))).toMatchObject({ kind: "period" });
  });
  it("lease unplaced AND rate without period → the map first", () => expect(info(row("lease", { leaseRate: "2.5" }))?.kind).toBe("location"));
  it("a land comp carrying a STALE lease-period flag is saveable (the owner's case)", () => {
    const r = row("land", { anchor: PIN }, PERIOD_FLAG);
    expect(activeCellFlags(r.cellFlags, "land")).toEqual({});
    expect(info(r)).toBe(null);
    expect(rowBlocker(r)).toBe(null);
  });
  it("a live non-period blocking flag still blocks, routed to the flagged field", () => {
    const r = row("building_sale", { anchor: PIN }, { bldgPrice: { level: "blocking", reason: "x" } });
    expect(info(r)).toMatchObject({ kind: "flag", key: "bldgPrice" });
  });
  it("a stale land-price flag does not block a building sale; an unclassifiable key is never hidden", () => {
    expect(activeCellFlags({ landPrice: { level: "blocking" } }, "building_sale")).toEqual({});
    expect(Object.keys(activeCellFlags({ mystery: { level: "blocking" } }, "land"))).toEqual(["mystery"]);
  });
  it("batch: ready rows save, and the walk starts at the FIRST not-ready row", () => {
    const rows = [{ ...row("land", { anchor: PIN }), _id: "a" }, { ...row("lease"), _id: "b" }, { ...row("land"), _id: "c" }];
    const plan = saveTapPlan({ rows, isReady: ready });
    expect(plan.toSave.map((r) => r._id)).toEqual(["a"]);
    expect(plan.target).toMatchObject({ rowId: "b", kind: "location" });
  });
  it("no rows / saving keep their copy", () => {
    expect(saveState({ rows: [], readyCount: 0 }).label).toBe("Nothing to save yet");
    expect(saveState({ rows: [row("land")], readyCount: 0, saving: true }).label).toBe("Saving…");
  });
});

describe("NEW-4 — a Price row is an input unless it holds a real derived number", () => {
  const priceCol = SHEET_COLUMNS[columnIndex("price")];
  it("land Price, empty → editable (the Add placeholder), never derived/na", () => {
    expect(rowFieldState(cellState(priceCol, row("land").draft)).state).toBe("editable");
  });
  it("building sale with only one of price/NOI/cap → editable; with two → derived with the real number", () => {
    expect(rowFieldState(cellState(priceCol, row("building_sale", { bldgNoi: "500000" }).draft)).state).toBe("editable");
    const st = rowFieldState(cellState(priceCol, row("building_sale", { bldgNoi: "500000", bldgCapRate: "0.05" }).draft));
    expect(st.state).toBe("derived");
    expect(st.text).toMatch(/10,000,000/);
  });
  it("a bare dash — na state or a derived cell with no number — becomes an empty editable input", () => {
    expect(rowFieldState({ state: "na", text: "—" })).toEqual({ state: "editable", text: "", raw: "" });
    expect(rowFieldState({ state: "derived", text: "—" }).state).toBe("editable");
    expect(rowFieldState({ state: "derived", text: "" }).state).toBe("editable");
  });
});

describe("NEW-2 — a value hugs its prefix/suffix", () => {
  it("input width follows its own text (empty = the Add placeholder)", () => {
    expect(hugWidthCh("")).toBe(3);
    expect(hugWidthCh("0.62")).toBeLessThan(hugWidthCh("9,250,000"));
    expect(hugWidthCh("9,250,000")).toBeGreaterThan(7);
  });
});

describe("NEW-1/2 — header + layout (rendered markup)", () => {
  const html = (compType) => renderToStaticMarkup(createElement(CompEntryMobileSheet, {
    rows: [row(compType, { title: "" })], overlaysById: {}, locationCellText: () => "", onCommitField: () => {}, onSetToday: () => {},
    onResolvePeriod: () => {}, armedRowId: null, onArm: () => {}, onFocusAnchor: () => {}, onSave: () => {},
    onCancel: () => {}, saving: false, saveError: null, readyRows: [], rowIsReady: () => false, pasteBox: null,
  }));
  it("a segmented Lease|Land|Bldg Sale control replaces the hidden <select>; the name is a text input", () => {
    for (const t of ["lease", "land", "building_sale"]) {
      const h = html(t);
      expect(h).not.toContain("<select");
      expect(h).toContain('aria-label="Comp type"');
      expect(h.indexOf("Lease")).toBeLessThan(h.indexOf("Land"));
      expect(h.indexOf("Land")).toBeLessThan(h.indexOf("Bldg Sale"));
      expect(h).toMatch(/<input[^>]*data-deal-name="1"[^>]*placeholder="Add a deal name"/);
    }
  });
  it("no Name row in the Deal group; the header input sits above Location", () => {
    const h = html("lease");
    expect(h).not.toMatch(/aria-label="Name"/);
    expect(h).not.toContain("Untitled");
    expect(h.indexOf("Add a deal name")).toBeLessThan(h.indexOf("Location"));
  });
  it("the Rate row's period and basis are pills, not a toggle row (NEW-3)", () => {
    const src = readFileSync("src/shared/comps/components/CompEntryMobileSheet.jsx", "utf8");
    expect(src).not.toMatch(/<Segmented[^>]*label="Rate period"/);
    expect(src).not.toMatch(/<Segmented[^>]*label="Rate basis"/);
    expect(src).toMatch(/dataPill="period"/);
    expect(src).toMatch(/dataPill="basis"/);
  });
});
