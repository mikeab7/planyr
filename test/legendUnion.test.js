import { describe, it, expect } from "vitest";
import { unionLegendEntries, legendFromPlaced } from "../src/shared/files/legendUnion.js";

describe("unionLegendEntries — one deduped legend across sheets (B340 tail #3)", () => {
  it("dedupes the same entry repeated on several sheets and records where it appeared", () => {
    const out = unionLegendEntries([
      { sheet: "M0.01", entries: [{ symbol: "sym-cj", text: "CJ = Control Joint" }, { symbol: "sym-ej", text: "EJ = Expansion Joint" }] },
      { sheet: "M0.02", entries: [{ text: "CJ  =  CONTROL JOINT" }] }, // same meaning, different case/spacing, no symbol
    ]);
    expect(out).toHaveLength(2);
    const cj = out.find((e) => /control joint/i.test(e.text));
    expect(cj.symbol).toBe("sym-cj");          // first non-empty symbol kept
    expect(cj.sheets).toEqual(["M0.01", "M0.02"]); // both sheets recorded
  });

  it("never folds two DIFFERENT descriptions together even if a symbol repeats", () => {
    const out = unionLegendEntries([
      { sheet: "A", entries: [{ symbol: "s", text: "HP = High Point" }, { symbol: "s", text: "LP = Low Point" }] },
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps first-seen order and ignores empty text / empty input (fail open)", () => {
    expect(unionLegendEntries([])).toEqual([]);
    expect(unionLegendEntries(undefined)).toEqual([]);
    const out = unionLegendEntries([{ sheet: "A", entries: [{ text: "" }, { text: "Z item" }, { text: "A item" }] }]);
    expect(out.map((e) => e.text)).toEqual(["Z item", "A item"]);
  });

  it("legendFromPlaced pulls entries off placed sheets and is empty until the extractor runs", () => {
    expect(legendFromPlaced([{ sheetNumber: "M1", legendEntries: [{ text: "TYP = Typical" }] }])).toHaveLength(1);
    // Dormant: placed sheets carry no legendEntries today → empty union, Composite key unchanged.
    expect(legendFromPlaced([{ sheetNumber: "M1" }, { sheetNumber: "M2" }])).toEqual([]);
  });
});
