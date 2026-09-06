/* lib/commandRegistry.js — the command palette's action registry (NEW-1, owner chat block:
 * "Command palette for the Spreadsheet, and get the audit tools out of the overflow").
 *
 * ⛔ THE POINT OF THIS SUITE, per the brief itself: "a test that only checks the palette opens
 * passes on a palette that does nothing." So this asserts, for EVERY entry in COMMANDS, both
 * halves at once — (1) it is reachable by searching the palette for (a substring of) its own
 * name, and (2) invoking it calls the exact ctx handler + arguments a toolbar control for that
 * action would call — never a second, parallel implementation that could drift from the real one.
 */
import { describe, it, expect, vi } from "vitest";
import {
  COMMANDS, COMMAND_GROUPS, searchCommands, fuzzyScore, resolveLabel, isCommandDisabled,
  toggleBoldPatch, toggleItalicPatch, toggleUnderlinePatch, toggleStrikePatch,
  toggleWrapPatch, increaseIndentPatch, decreaseIndentPatch,
} from "../src/workspaces/model/lib/commandRegistry.js";
import { NUMBER_FORMATS } from "../src/workspaces/model/lib/numberFormats.js";
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, zoomStepButton } from "../src/workspaces/model/lib/sheetZoom.js";

function makeCtx(overrides = {}) {
  return {
    activeFormat: null, activeStyle: {}, mergedHere: false, freezeRows: 0, freezeCols: 0,
    painterArmed: false, filterOn: false, autoColor: true,
    canUndo: true, canRedo: true, canDeleteColumn: true, sheetCount: 2,
    traceMode: "precedents", traceLevel: 1, traceTruncated: false, traceNoFurther: false, traceCellCount: 1,
    inconsistencyCount: 0, inconsistencyPanelOpen: false, nameManagerOpen: false, zoom: 1,
    onUndo: vi.fn(), onRedo: vi.fn(), onFormatPainterToggle: vi.fn(), onClearFormatting: vi.fn(),
    onSetCellStyle: vi.fn(), onAutoColorToggle: vi.fn(), onMergeToggle: vi.fn(),
    onApplyFormat: vi.fn(), onNumberFormatOp: vi.fn(), onApplyBorder: vi.fn(),
    onInsertRow: vi.fn(), onInsertColumn: vi.fn(), onDeleteRow: vi.fn(), onDeleteColumn: vi.fn(),
    onSetFreezeTopRow: vi.fn(), onSetFreezeFirstColumn: vi.fn(), onSetFreezeAtSelection: vi.fn(), onUnfreeze: vi.fn(),
    onToggleNameManager: vi.fn(),
    onTracePrecedents: vi.fn(), onTraceDependents: vi.fn(), onClearTrace: vi.fn(), onToggleInconsistencyPanel: vi.fn(),
    onSort: vi.fn(), onFilterToggle: vi.fn(),
    onOpenFind: vi.fn(), onOpenReplace: vi.fn(),
    onAddSheetTab: vi.fn(), onDuplicateSheetCurrent: vi.fn(), onRenameSheetCurrent: vi.fn(), onDeleteSheetCurrent: vi.fn(),
    onExportXlsx: vi.fn(), onExportCsv: vi.fn(), onOpenImportXlsx: vi.fn(), onOpenImportCsv: vi.fn(),
    onZoomChange: vi.fn(),
    ...overrides,
  };
}

// One expectation per non-generated command: which ctx handler a REAL toolbar/context-menu
// control for this action calls, and with what arguments. Mirrors Ribbon.jsx's/SheetView.jsx's
// own call sites exactly — this table is what makes "invokes the same handler the toolbar uses"
// a checkable claim rather than an assertion in prose.
const EXPECT = {
  undo: (ctx) => expect(ctx.onUndo).toHaveBeenCalledTimes(1),
  redo: (ctx) => expect(ctx.onRedo).toHaveBeenCalledTimes(1),
  "format-painter": (ctx) => expect(ctx.onFormatPainterToggle).toHaveBeenCalledTimes(1),
  "clear-formatting": (ctx) => expect(ctx.onClearFormatting).toHaveBeenCalledTimes(1),
  bold: (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(toggleBoldPatch(ctx.activeStyle)),
  italic: (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(toggleItalicPatch(ctx.activeStyle)),
  underline: (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(toggleUnderlinePatch(ctx.activeStyle)),
  strikethrough: (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(toggleStrikePatch(ctx.activeStyle)),
  "autocolor-toggle": (ctx) => expect(ctx.onAutoColorToggle).toHaveBeenCalledTimes(1),
  "align-left": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ align: "left" }),
  "align-center": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ align: "center" }),
  "align-right": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ align: "right" }),
  "valign-top": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ valign: "top" }),
  "valign-middle": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ valign: null }),
  "valign-bottom": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith({ valign: "bottom" }),
  "wrap-text": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(toggleWrapPatch(ctx.activeStyle)),
  "indent-increase": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(increaseIndentPatch(ctx.activeStyle)),
  "indent-decrease": (ctx) => expect(ctx.onSetCellStyle).toHaveBeenCalledWith(decreaseIndentPatch(ctx.activeStyle)),
  "merge-toggle": (ctx) => expect(ctx.onMergeToggle).toHaveBeenCalledTimes(1),
  "percent-style": (ctx) => expect(ctx.onApplyFormat).toHaveBeenCalledWith("0.0%"),
  "currency-style": (ctx) => expect(ctx.onApplyFormat).toHaveBeenCalledWith("$#,##0.00"),
  "thousands-toggle": (ctx) => expect(ctx.onNumberFormatOp).toHaveBeenCalledWith("toggleThousands"),
  "decimal-increase": (ctx) => expect(ctx.onNumberFormatOp).toHaveBeenCalledWith("increaseDecimals"),
  "decimal-decrease": (ctx) => expect(ctx.onNumberFormatOp).toHaveBeenCalledWith("decreaseDecimals"),
  "border-top": (ctx) => expect(ctx.onApplyBorder).toHaveBeenCalledWith({ edges: ["top"], style: "thin", mode: "outline" }),
  "border-bottom-double": (ctx) => expect(ctx.onApplyBorder).toHaveBeenCalledWith({ edges: ["bottom"], style: "double", mode: "outline" }),
  "border-outline": (ctx) => expect(ctx.onApplyBorder).toHaveBeenCalledWith({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "outline" }),
  "border-all": (ctx) => expect(ctx.onApplyBorder).toHaveBeenCalledWith({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "all" }),
  "border-none": (ctx) => expect(ctx.onApplyBorder).toHaveBeenCalledWith({ edges: ["top", "right", "bottom", "left"], style: null, mode: "all" }),
  "insert-row": (ctx) => expect(ctx.onInsertRow).toHaveBeenCalledTimes(1),
  "insert-column": (ctx) => expect(ctx.onInsertColumn).toHaveBeenCalledTimes(1),
  "delete-row": (ctx) => expect(ctx.onDeleteRow).toHaveBeenCalledTimes(1),
  "delete-column": (ctx) => expect(ctx.onDeleteColumn).toHaveBeenCalledTimes(1),
  "freeze-top-row": (ctx) => expect(ctx.onSetFreezeTopRow).toHaveBeenCalledTimes(1),
  "freeze-first-column": (ctx) => expect(ctx.onSetFreezeFirstColumn).toHaveBeenCalledTimes(1),
  "freeze-at-selection": (ctx) => expect(ctx.onSetFreezeAtSelection).toHaveBeenCalledTimes(1),
  unfreeze: (ctx) => expect(ctx.onUnfreeze).toHaveBeenCalledTimes(1),
  "name-manager": (ctx) => expect(ctx.onToggleNameManager).toHaveBeenCalledTimes(1),
  "trace-precedents": (ctx) => expect(ctx.onTracePrecedents).toHaveBeenCalledTimes(1),
  "trace-dependents": (ctx) => expect(ctx.onTraceDependents).toHaveBeenCalledTimes(1),
  "trace-remove-arrows": (ctx) => expect(ctx.onClearTrace).toHaveBeenCalledTimes(1),
  "show-inconsistencies": (ctx) => expect(ctx.onToggleInconsistencyPanel).toHaveBeenCalledTimes(1),
  "sort-asc": (ctx) => expect(ctx.onSort).toHaveBeenCalledWith("asc"),
  "sort-desc": (ctx) => expect(ctx.onSort).toHaveBeenCalledWith("desc"),
  "filter-toggle": (ctx) => expect(ctx.onFilterToggle).toHaveBeenCalledTimes(1),
  find: (ctx) => expect(ctx.onOpenFind).toHaveBeenCalledTimes(1),
  replace: (ctx) => expect(ctx.onOpenReplace).toHaveBeenCalledTimes(1),
  "sheet-add": (ctx) => expect(ctx.onAddSheetTab).toHaveBeenCalledTimes(1),
  "sheet-duplicate": (ctx) => expect(ctx.onDuplicateSheetCurrent).toHaveBeenCalledTimes(1),
  "sheet-rename": (ctx) => expect(ctx.onRenameSheetCurrent).toHaveBeenCalledTimes(1),
  "sheet-delete": (ctx) => expect(ctx.onDeleteSheetCurrent).toHaveBeenCalledTimes(1),
  "export-xlsx": (ctx) => expect(ctx.onExportXlsx).toHaveBeenCalledTimes(1),
  "export-csv": (ctx) => expect(ctx.onExportCsv).toHaveBeenCalledTimes(1),
  "import-xlsx": (ctx) => expect(ctx.onOpenImportXlsx).toHaveBeenCalledTimes(1),
  "import-csv": (ctx) => expect(ctx.onOpenImportCsv).toHaveBeenCalledTimes(1),
  "zoom-in": (ctx) => expect(ctx.onZoomChange).toHaveBeenCalledWith(zoomStepButton(ctx.zoom, 1)),
  "zoom-out": (ctx) => expect(ctx.onZoomChange).toHaveBeenCalledWith(zoomStepButton(ctx.zoom, -1)),
  "zoom-reset": (ctx) => expect(ctx.onZoomChange).toHaveBeenCalledWith(DEFAULT_ZOOM),
};

const isGeneratedNumberFormatId = (id) => NUMBER_FORMATS.some((f) => `numfmt-${f.id}` === id);

describe("COMMANDS — every entry invokes the SAME handler a toolbar/context-menu control uses", () => {
  it("every command id is unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every command belongs to a group COMMAND_GROUPS actually names", () => {
    for (const cmd of COMMANDS) expect(COMMAND_GROUPS[cmd.group]).toBeTruthy();
  });

  it("every non-generated command has an explicit expectation in this suite's own table — an id added to the registry with no row here fails loudly instead of going untested", () => {
    const uncovered = COMMANDS.map((c) => c.id).filter((id) => !isGeneratedNumberFormatId(id) && !EXPECT[id]);
    expect(uncovered).toEqual([]);
  });

  for (const cmd of COMMANDS.filter((c) => !isGeneratedNumberFormatId(c.id))) {
    it(`'${cmd.id}' (${resolveLabel(cmd, makeCtx())}) calls its real handler with the real arguments`, () => {
      const ctx = makeCtx();
      cmd.run(ctx);
      EXPECT[cmd.id](ctx);
    });
  }

  it("every generated Number Format command calls onApplyFormat with its OWN token — the same call NumberGroup's dropdown makes for that preset", () => {
    for (const f of NUMBER_FORMATS) {
      const cmd = COMMANDS.find((c) => c.id === `numfmt-${f.id}`);
      expect(cmd).toBeTruthy();
      const ctx = makeCtx();
      cmd.run(ctx);
      expect(ctx.onApplyFormat).toHaveBeenCalledWith(f.token);
    }
  });
});

describe("searchCommands — every command is reachable from the palette", () => {
  it("an empty query returns every command in the registry", () => {
    const ctx = makeCtx();
    const results = searchCommands(COMMANDS, "", ctx);
    expect(results.map((r) => r.id).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });

  it("searching a lowercase, punctuation-stripped copy of each command's own label finds that command — proves reachability for EVERY entry, not a hand-picked sample", () => {
    const ctx = makeCtx();
    let checked = 0;
    for (const cmd of COMMANDS) {
      const resolved = resolveLabel(cmd, ctx);
      const query = resolved.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!query) continue;
      checked += 1;
      const results = searchCommands(COMMANDS, query, ctx);
      expect(results.map((r) => r.id)).toContain(cmd.id);
    }
    expect(checked).toBe(COMMANDS.length); // every command has a non-empty label to search by
  });

  it("searching a command's own keywords also reaches it (e.g. 'audit' finds the Formula Auditing commands)", () => {
    const ctx = makeCtx();
    const results = searchCommands(COMMANDS, "audit", ctx);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(["trace-precedents", "trace-dependents", "show-inconsistencies"]));
  });

  it("a disabled command is still found (visible, just inert) — Undo when there is nothing to undo", () => {
    const ctx = makeCtx({ canUndo: false });
    const results = searchCommands(COMMANDS, "undo", ctx);
    const undo = results.find((r) => r.id === "undo");
    expect(undo).toBeTruthy();
    expect(undo.disabled).toBe(true);
  });

  it("a query matching nothing returns an empty list, never a zero-scored row", () => {
    expect(searchCommands(COMMANDS, "zzzqnonexistentquery", makeCtx())).toEqual([]);
  });

  it("results carry a `run` that is the SAME function as the source command's own — no cloning that could drift", () => {
    const ctx = makeCtx();
    const results = searchCommands(COMMANDS, "", ctx);
    for (const r of results) {
      const source = COMMANDS.find((c) => c.id === r.id);
      expect(r.run).toBe(source.run);
    }
  });
});

describe("fuzzyScore — subsequence matching", () => {
  it("matches a subsequence in order", () => {
    expect(fuzzyScore("Trace Precedents", "tp")).not.toBeNull();
  });
  it("returns null when a query character never appears at all", () => {
    expect(fuzzyScore("Bold", "z")).toBeNull();
  });
  it("returns null out of order (the letters must appear IN ORDER)", () => {
    expect(fuzzyScore("Bold", "ldbo")).toBeNull();
  });
  it("scores a word-start hit higher than the identical letter occurring mid-word", () => {
    const wordStart = fuzzyScore("Percent Style", "p");
    const midWord = fuzzyScore("Percent Style", "e"); // first 'e' is Per[c]ent's 2nd letter — mid-word
    expect(wordStart).toBeGreaterThan(midWord);
  });
  it("an empty query matches everything at score 0", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("style toggle-patch helpers — the SAME computation Ribbon.jsx's own buttons use, not a re-derived copy", () => {
  it("toggleBoldPatch: on from unset, off (null) from set", () => {
    expect(toggleBoldPatch({})).toEqual({ bold: true });
    expect(toggleBoldPatch({ bold: true })).toEqual({ bold: null });
  });
  it("toggleItalicPatch / toggleUnderlinePatch / toggleStrikePatch follow the same on/null shape", () => {
    expect(toggleItalicPatch({})).toEqual({ italic: true });
    expect(toggleUnderlinePatch({ underline: true })).toEqual({ underline: null });
    expect(toggleStrikePatch({})).toEqual({ strike: true });
  });
  it("toggleWrapPatch toggles on/null", () => {
    expect(toggleWrapPatch({})).toEqual({ wrap: true });
    expect(toggleWrapPatch({ wrap: true })).toEqual({ wrap: null });
  });
  it("increaseIndentPatch increments from unset", () => {
    expect(increaseIndentPatch({})).toEqual({ indent: 1 });
    expect(increaseIndentPatch({ indent: 2 })).toEqual({ indent: 3 });
  });
  it("decreaseIndentPatch floors at 0 and stores null rather than 0 (matches setCellStyle's own null-means-unset convention)", () => {
    expect(decreaseIndentPatch({ indent: 1 })).toEqual({ indent: null });
    expect(decreaseIndentPatch({})).toEqual({ indent: null });
    expect(decreaseIndentPatch({ indent: 2 })).toEqual({ indent: 1 });
  });
});

describe("disabled state — computed from the SAME condition a ribbon control greys out on", () => {
  it("Undo/Redo follow canUndo/canRedo", () => {
    expect(isCommandDisabled(COMMANDS.find((c) => c.id === "undo"), makeCtx({ canUndo: false }))).toBe(true);
    expect(isCommandDisabled(COMMANDS.find((c) => c.id === "redo"), makeCtx({ canRedo: false }))).toBe(true);
  });
  it("Delete Column is disabled when there is only one column left", () => {
    const cmd = COMMANDS.find((c) => c.id === "delete-column");
    expect(isCommandDisabled(cmd, makeCtx({ canDeleteColumn: false }))).toBe(true);
    expect(isCommandDisabled(cmd, makeCtx({ canDeleteColumn: true }))).toBe(false);
  });
  it("Delete Sheet is disabled when there is only one sheet", () => {
    const cmd = COMMANDS.find((c) => c.id === "sheet-delete");
    expect(isCommandDisabled(cmd, makeCtx({ sheetCount: 1 }))).toBe(true);
    expect(isCommandDisabled(cmd, makeCtx({ sheetCount: 2 }))).toBe(false);
  });
  it("Unfreeze is disabled only when nothing is frozen", () => {
    const cmd = COMMANDS.find((c) => c.id === "unfreeze");
    expect(isCommandDisabled(cmd, makeCtx({ freezeRows: 0, freezeCols: 0 }))).toBe(true);
    expect(isCommandDisabled(cmd, makeCtx({ freezeRows: 1, freezeCols: 0 }))).toBe(false);
  });
  it("Remove Arrows is disabled when no trace is active", () => {
    const cmd = COMMANDS.find((c) => c.id === "trace-remove-arrows");
    expect(isCommandDisabled(cmd, makeCtx({ traceMode: null }))).toBe(true);
    expect(isCommandDisabled(cmd, makeCtx({ traceMode: "precedents" }))).toBe(false);
  });
  it("Zoom In/Out respect the real MIN_ZOOM/MAX_ZOOM clamp", () => {
    expect(isCommandDisabled(COMMANDS.find((c) => c.id === "zoom-in"), makeCtx({ zoom: MAX_ZOOM }))).toBe(true);
    expect(isCommandDisabled(COMMANDS.find((c) => c.id === "zoom-out"), makeCtx({ zoom: MIN_ZOOM }))).toBe(true);
    expect(isCommandDisabled(COMMANDS.find((c) => c.id === "zoom-in"), makeCtx({ zoom: 1 }))).toBe(false);
  });
});
