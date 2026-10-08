import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompEntryMobileSheet from "../src/shared/comps/components/CompEntryMobileSheet.jsx";
import { saveState, rowBlocker, rowFieldState, hugWidthCh } from "../src/shared/comps/lib/compMobileSheetModel.js";
import { activeCellFlags, cellState, SHEET_COLUMNS, columnIndex } from "../src/shared/comps/lib/compSheetColumns.js";
import { emptyDraft, draftToComp, validateComp } from "../src/shared/comps/lib/comps.js";
import { rowHasBlockingFlags } from "../src/shared/comps/lib/compParse.js";

const PIN = { kind: "pin", lat: 1, lon: 2 };
const row = (compType, o = {}, cellFlags = {}) => ({ _id: "r", draft: { ...emptyDraft(null), compType, ...o }, cellFlags });
const ready = (r) => !rowHasBlockingFlags(activeCellFlags(r.cellFlags, r.draft.compType)) && validateComp(draftToComp(r.draft)).length === 0;
const label = (r) => saveState({ rows: [r], readyCount: ready(r) ? 1 : 0 }).label;
const PERIOD_FLAG = { leaseRatePeriod: { level: "blocking", reason: "12x" } };

describe("NEW-3 — Save copy names the REAL blocker (every type × blocker)", () => {
  for (const t of ["lease", "land", "building_sale"]) {
    it(`${t}: unplaced → the map`, () => expect(label(row(t))).toBe("Place it on the map to save"));
    it(`${t}: placed, size + price empty → saveable (size/price are not required)`, () => {
      expect(label(row(t, { anchor: PIN, ...(t === "lease" ? { leaseRatePeriod: "annual" } : {}) }))).toBe("Save 1 comp");
    });
    it(`${t}: never says "mo or yr" unless it is a lease with the period blocker`, () => {
      for (const r of [row(t), row(t, { anchor: PIN })]) expect(label(r)).not.toMatch(/mo or yr/i);
    });
  }
  it("lease placed with no period → monthly/yearly copy (validate error AND blocking flag)", () => {
    expect(label(row("lease", { anchor: PIN }))).toBe("Pick monthly or yearly to save");
    expect(label(row("lease", { anchor: PIN, leaseRatePeriod: "annual" }, PERIOD_FLAG))).toBe("Pick monthly or yearly to save");
  });
  it("lease unplaced AND no period → the map first", () => expect(label(row("lease"))).toBe("Place it on the map to save"));
  it("a land comp carrying a STALE lease-period flag is saveable and never says mo/yr (the owner's case)", () => {
    const r = row("land", { anchor: PIN }, PERIOD_FLAG);
    expect(activeCellFlags(r.cellFlags, "land")).toEqual({});
    expect(label(r)).toBe("Save 1 comp");
    expect(rowBlocker(r)).toBe(null);
  });
  it("a live non-period blocking flag still blocks, with its own copy", () => {
    const r = row("building_sale", { anchor: PIN }, { bldgPrice: { level: "blocking", reason: "x" } });
    expect(label(r)).toBe("Fix the flagged field to save");
  });
  it("a stale land-price flag does not block a building sale; an unclassifiable key is never hidden", () => {
    expect(activeCellFlags({ landPrice: { level: "blocking" } }, "building_sale")).toEqual({});
    expect(Object.keys(activeCellFlags({ mystery: { level: "blocking" } }, "land"))).toEqual(["mystery"]);
  });
  it("no rows / saving / ready keep their copy", () => {
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
  it("a segmented Lease|Land|Bldg sale control replaces the hidden <select>; the name is a text input", () => {
    for (const t of ["lease", "land", "building_sale"]) {
      const h = html(t);
      expect(h).not.toContain("<select");
      expect(h).toContain('aria-label="Comp type"');
      expect(h.indexOf("Lease")).toBeLessThan(h.indexOf("Land"));
      expect(h.indexOf("Land")).toBeLessThan(h.indexOf("Bldg sale"));
      expect(h).toMatch(/<input[^>]*data-deal-name="1"[^>]*placeholder="Deal name"/);
    }
  });
  it("no Name row in the Deal group, and an empty name never falls back to the tenant/buyer", () => {
    const h = html("lease");
    expect(h).not.toMatch(/aria-label="Name"/);
    expect(h).not.toContain("Untitled");
    expect(h.indexOf("Deal name")).toBeLessThan(h.indexOf("Location"));
  });
  it("the Rate row's two toggles are full-width equal groups", () => {
    const src = readFileSync("src/shared/comps/components/CompEntryMobileSheet.jsx", "utf8");
    expect(src).toMatch(/<Segmented fill label="Rate period"/);
    expect(src).toMatch(/<Segmented fill label="Rate basis"/);
  });
});
