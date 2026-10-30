/* Indent in the Univer grid (lib/univerIndent.js) — the pure rules the render interceptor and the two commands use.
 * The pixel truth (the painted text really moves, one undo step per click, no overflow) is the parity harness's `indent`
 * check (ui-audit/verify-univer-parity.mjs); this file pins the arithmetic so it cannot drift from the old grid's. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  clampIndent, indentOfStyle, storedIndentStyle, stepIndent, indentPadding, styleForRender, indentPatch,
  UNIVER_MAX_INDENT, UNIVER_BASE_PAD_PX, INDENT_COMMAND_IDS,
} from "../src/workspaces/model/lib/univerIndent.js";
import { INDENT_STEP_PX, cellPadding } from "../src/workspaces/model/lib/cellTextLayout.js";
import { MAX_INDENT, adjustIndent, createWorkbook, setRaw, cellKey } from "../src/workspaces/model/lib/sheetModel.js";
import { workbookToUniver, univerToWorkbook } from "../src/workspaces/model/lib/univerBridge.js";

describe("univerIndent — the numbers are the old grid's", () => {
  it("the cap and the step are the old grid's, from the one definition each", () => {
    expect(UNIVER_MAX_INDENT).toBe(MAX_INDENT);
    expect(INDENT_STEP_PX).toBe(14);
  });
  it("clampIndent: whole numbers 0..15 only", () => {
    expect([clampIndent(-3), clampIndent(0), clampIndent(2.4), clampIndent(2.6), clampIndent(99), clampIndent("x"), clampIndent(null), clampIndent(NaN)]).toEqual([0, 0, 2, 3, 15, 0, 0, 0]);
  });
  it("stepIndent steps from the cell's OWN level and never leaves 0..15", () => {
    expect(stepIndent(0, 1)).toBe(1);
    expect(stepIndent(0, -1)).toBe(0);
    expect(stepIndent(15, 1)).toBe(15);
    expect(stepIndent(3, -1)).toBe(2);
  });
  it("the stored form round-trips: pd.l = base + step × N, cleared with pd:null", () => {
    for (let n = 1; n <= 15; n++) expect(indentOfStyle(storedIndentStyle(n))).toBe(n);
    expect(storedIndentStyle(0)).toEqual({ pd: null });
    expect(storedIndentStyle(1)).toEqual({ pd: { l: UNIVER_BASE_PAD_PX + INDENT_STEP_PX } });
    expect(indentOfStyle(null)).toBe(0);
    expect(indentOfStyle({ pd: null })).toBe(0);
    expect(indentOfStyle({ pd: { l: UNIVER_BASE_PAD_PX } })).toBe(0);
    expect(indentOfStyle({ pd: { r: 40 } })).toBe(0);
  });
});

describe("univerIndent — the reading side only, clamped to the column", () => {
  const pad = (o) => indentPadding({ width: 120, ...o });
  it("no indent → null (Univer draws the cell exactly as it would)", () => {
    expect(pad({ indent: 0, align: 1 })).toBeNull();
    expect(styleForRender({ bl: 1 }, 120)).toEqual({ bl: 1 });
  });
  it("left-aligned and general (0 / undefined) inset on the LEFT; right-aligned on the RIGHT; centred not at all", () => {
    expect(pad({ indent: 2, align: 1 })).toEqual({ l: 2 + 28, r: 2 });
    expect(pad({ indent: 2, align: undefined })).toEqual({ l: 2 + 28, r: 2 });
    expect(pad({ indent: 2, align: 0 })).toEqual({ l: 2 + 28, r: 2 });
    expect(pad({ indent: 2, align: 3 })).toEqual({ l: 2, r: 2 + 28 });
    expect(pad({ indent: 2, align: 2 })).toEqual({ l: 2, r: 2 });
  });
  it("the total can never exceed the column (a deep indent in a narrow column leaves the text no room)", () => {
    for (const width of [10, 30, 40, 60, 120, 400]) for (const align of [0, 1, 2, 3]) for (const indent of [1, 8, 15]) {
      const p = indentPadding({ indent, align, width });
      expect(p.l + p.r).toBeLessThanOrEqual(Math.max(width, 2 * UNIVER_BASE_PAD_PX));
    }
    expect(indentPadding({ indent: 15, align: 1, width: 40 }).l).toBeLessThan(40);
    expect(indentPadding({ indent: 15, align: 1, width: 4 })).toEqual({ l: 2, r: 2 });     // a column narrower than its own padding
  });
  it("agrees with the old grid's cellPadding step-for-step (same inset beyond the base)", () => {
    for (const align of ["left", "right", "center"]) for (const indent of [1, 4, 15]) {
      const old = cellPadding({ indent, align, zoom: 1, width: 400 });
      const mine = indentPadding({ indent, align: { left: 1, center: 2, right: 3 }[align], width: 400 });
      expect(mine.l - UNIVER_BASE_PAD_PX).toBe(old.left - 6);
      expect(mine.r - UNIVER_BASE_PAD_PX).toBe(old.right - 6);
    }
  });
  it("styleForRender keeps every other field and the stored indent untouched", () => {
    const stored = { bl: 1, ht: 3, ...storedIndentStyle(2) };
    const drawn = styleForRender(stored, 120);
    expect(drawn.bl).toBe(1);
    expect(drawn.pd.r).toBe(2 + 28);
    expect(stored.pd).toEqual({ l: 2 + 28 });                                              // the stored style was not mutated
  });
});

describe("univerIndent — one click changes a whole selection, each cell from its OWN level", () => {
  const styles = { "1:0": storedIndentStyle(1), "2:0": storedIndentStyle(3), "3:0": { bl: 1 } };
  const styleAt = (r, c) => styles[`${r}:${c}`] || null;
  const rg = (r1, c1, r2, c2) => ({ startRow: r1, startColumn: c1, endRow: r2, endColumn: c2 });
  it("increase", () => {
    const { matrix, changed } = indentPatch([rg(0, 0, 3, 0)], 1, styleAt, { rows: 100, cols: 10 });
    expect(changed).toBe(4);
    expect(indentOfStyle(matrix[0][0].s)).toBe(1);   // 0 → 1
    expect(indentOfStyle(matrix[1][0].s)).toBe(2);   // 1 → 2
    expect(indentOfStyle(matrix[2][0].s)).toBe(4);   // 3 → 4
    expect(indentOfStyle(matrix[3][0].s)).toBe(1);   // bold only → 1
  });
  it("decrease clears at 0 and leaves cells already at 0 alone", () => {
    const { matrix, changed } = indentPatch([rg(0, 0, 1, 0)], -1, styleAt, { rows: 100, cols: 10 });
    expect(changed).toBe(1);                         // r0 was already 0
    expect(matrix[0]).toBeUndefined();
    expect(matrix[1][0].s).toEqual({ pd: null });
  });
  it("a cell at the cap does not change; two overlapping ranges step a cell once; a whole-column range stays in the sheet", () => {
    const capped = () => storedIndentStyle(15);
    expect(indentPatch([rg(0, 0, 0, 0)], 1, capped, { rows: 5, cols: 5 }).changed).toBe(0);
    expect(indentPatch([rg(0, 0, 1, 0), rg(1, 0, 2, 0)], 1, () => null, { rows: 10, cols: 10 }).changed).toBe(3);
    expect(indentPatch([rg(0, 0, 1048575, 0)], 1, () => null, { rows: 50, cols: 10 }).changed).toBe(50);
  });
});

describe("univerIndent — the saved workbook (Planyr's `indent`) ⇄ Univer, both grids agree", () => {
  const withIndents = () => {
    let wb = createWorkbook();
    let sh = wb.sheets[0].sheet;
    sh = setRaw(sh, 12, 0, "General"); sh = setRaw(sh, 13, 0, "Reimbursables"); sh = setRaw(sh, 14, 0, "Traffic Study");
    const key = (r) => cellKey(sh.columns[0].id, r);
    sh = { ...sh, styles: { ...sh.styles, [key(13)]: { indent: 1 }, [key(14)]: { indent: 1 } } };
    return { wb: { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }, key };
  };
  it("the owner's Goose Creek shape (indent 1, nothing else on the cell) comes back exactly, and the Univer cell is styled", () => {
    const { wb, key } = withIndents();
    const { data, sidecar } = workbookToUniver(wb);
    const cd = data.sheets[wb.sheets[0].id].cellData;
    expect(data.styles[cd[13][0].s].pd).toEqual({ l: 16 });
    expect(cd[12][0].s).toBeUndefined();
    const { workbook } = univerToWorkbook(JSON.parse(JSON.stringify(data)), { sidecar, activeSheetId: wb.activeSheetId });
    const sh = workbook.sheets[0].sheet;
    expect(sh.styles[key(13)]).toEqual({ indent: 1 });
    expect(sh.styles[key(14)]).toEqual({ indent: 1 });
    expect(sh.styles[key(12)]).toBeUndefined();
  });
  it("the old grid's Increase Indent and the Univer encoding give the same number at every level", () => {
    for (let n = 1; n <= 15; n++) {
      let wb = createWorkbook(); let sh = setRaw(wb.sheets[0].sheet, 0, 0, "x");
      for (let i = 0; i < n; i++) sh = adjustIndent(sh, 0, 0, 0, 0, 1);
      const w2 = { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };
      const { data, sidecar } = workbookToUniver(w2);
      const { workbook } = univerToWorkbook(JSON.parse(JSON.stringify(data)), { sidecar, activeSheetId: w2.activeSheetId });
      expect(workbook.sheets[0].sheet.styles[cellKey(sh.columns[0].id, 0)].indent).toBe(n);
    }
  });
});

describe("univerIndent — wiring (the keys plugin binds these ids; only UniverSheet.jsx imports Univer)", () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  it("exposes stable command ids", () => {
    expect(INDENT_COMMAND_IDS).toEqual({ increase: "planyr.sheet.command.increase-indent", decrease: "planyr.sheet.command.decrease-indent" });
  });
  it("imports nothing from @univerjs and UniverSheet.jsx installs it", () => {
    expect(read("../src/workspaces/model/lib/univerIndent.js")).not.toMatch(/from\s+["']@univerjs/);
    expect(read("../src/workspaces/model/components/UniverSheet.jsx")).toMatch(/installUniverIndent\(/);
  });
});
