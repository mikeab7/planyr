import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { adjustIndent, MAX_INDENT } from "../src/workspaces/model/lib/sheetModel.js";
import { cellPadding, canSpill, spillSpanWidth, CELL_PAD_PX, INDENT_STEP_PX } from "../src/workspaces/model/lib/cellTextLayout.js";

// NEW-1 — clearing a cell must not move the text of the cell beside it. The label's start point
// comes from ONE inset (`cellPadX`) on both the in-cell path and the spill path.
describe("cellPadding — the one text padding; an indent only insets the text", () => {
  const W = 120;
  it("no indent: the plain cell padding on both sides", () => {
    expect(cellPadding({ zoom: 1, width: W })).toEqual({ left: CELL_PAD_PX, right: CELL_PAD_PX });
  });
  it("left-aligned: the indent goes on the LEFT only, one step each", () => {
    expect(cellPadding({ indent: 2, align: "left", zoom: 1, width: W })).toEqual({ left: CELL_PAD_PX + 2 * INDENT_STEP_PX, right: CELL_PAD_PX });
    expect(cellPadding({ indent: 1, zoom: 1.5, width: W * 1.5 }).left).toBe((CELL_PAD_PX + INDENT_STEP_PX) * 1.5);
  });
  it("right-aligned: the indent goes on the RIGHT only; centred: none", () => {
    expect(cellPadding({ indent: 2, align: "right", zoom: 1, width: W })).toEqual({ left: CELL_PAD_PX, right: CELL_PAD_PX + 2 * INDENT_STEP_PX });
    expect(cellPadding({ indent: 2, align: "center", zoom: 1, width: W })).toEqual({ left: CELL_PAD_PX, right: CELL_PAD_PX });
  });
  it("NEVER exceeds the column: padding + borders always fit inside the width, at any indent", () => {
    for (const width of [20, 60, 120, 400]) for (const indent of [0, 1, 5, 15, 250]) for (const align of ["left", "right", "center", undefined]) for (const zoom of [0.5, 1, 2]) {
      const p = cellPadding({ indent, align, zoom, width: width * zoom });
      // a column too narrow for even the base padding is the only case padding may exceed it
      if (width * zoom >= 2 * CELL_PAD_PX * zoom + 6 * zoom) expect(p.left + p.right).toBeLessThanOrEqual(width * zoom - 6 * zoom + 1e-9);
    }
  });
  it("an unmeasured width applies the whole indent (callers that have no column yet)", () => {
    expect(cellPadding({ indent: 3, zoom: 1 }).left).toBe(CELL_PAD_PX + 3 * INDENT_STEP_PX);
  });
});

describe("canSpill — only text that would START in the same place may spill", () => {
  const base = { kind: "text", empty: false, merged: false, editing: false, align: "left", wrap: false };
  it("lets plain left-aligned text spill", () => expect(canSpill(base)).toBe(true));
  it("treats an unset alignment as left", () => expect(canSpill({ ...base, align: undefined })).toBe(true));
  it.each([
    ["a centred label", { align: "center" }],
    ["a right-aligned label", { align: "right" }],
    ["wrapped text", { wrap: true }],
    ["a merged anchor", { merged: true }],
    ["a cell being edited", { editing: true }],
    ["an empty cell", { empty: true }],
    ["a number", { kind: "number", align: "right" }],
    ["an error", { kind: "error" }],
  ])("refuses %s", (_n, patch) => expect(canSpill({ ...base, ...patch })).toBe(false));
});

describe("spillSpanWidth", () => {
  it("keeps the inset on both ends and never goes negative", () => {
    expect(spillSpanWidth(240, 6, 6)).toBe(240 - 12 - 1);
    expect(spillSpanWidth(240, 34, 6)).toBe(240 - 40 - 1);
    expect(spillSpanWidth(4, 6, 6)).toBe(0);
  });
});

describe("SheetView paints both text paths from the shared inset (red-proof of the 2px jump)", () => {
  const src = readFileSync(new URL("../src/workspaces/model/components/SheetView.jsx", import.meta.url), "utf8");
  it("the spill span starts at padX, not a private constant", () => {
    const span = src.split("\n").find((l) => l.includes('position: "absolute"') && l.includes("spillSpanWidth("));
    expect(span, "spill span line").toBeTruthy();
    expect(span).toContain("left: pad.left");
    expect(span).not.toMatch(/left:\s*\d/);
    expect(span).toContain("alignItems: vAlign");
  });
  it("the in-cell padding and the spill gate use the same helpers", () => {
    expect(src).toContain("padding: isEditing ? 0 : `0 ${pad.right}px 0 ${pad.left}px`");
    expect(src).toContain("canSpill({");
    expect(src).toContain("const pad = cellPadding({");
  });
});

describe("adjustIndent — each cell steps from its OWN level (NEW-2)", () => {
  const sheet = () => ({
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }], rowCount: 5, cells: { "b:0": "x", "b:1": "y", "b:2": "z" },
    formats: {}, merges: [], styles: { "b:1": { indent: 3, bold: true }, "b:2": { indent: 15 } },
  });
  it("steps every selected cell from its own level, keeping their differences", () => {
    const next = adjustIndent(sheet(), 0, 2, 1, 1, 1);
    expect([0, 1, 2].map((r) => next.styles[`b:${r}`]?.indent)).toEqual([1, 4, 15]);
    expect(next.styles["b:1"].bold).toBe(true);
  });
  it("caps at MAX_INDENT; a range that cannot move is the SAME object (no history entry)", () => {
    expect(MAX_INDENT).toBe(15);
    const s = sheet();
    expect(adjustIndent(s, 2, 2, 1, 1, 1)).toBe(s);
  });
  it("decrease floors at 0 and stores nothing (unset), dropping an emptied style entry", () => {
    const s = sheet();
    const down = adjustIndent(s, 0, 2, 1, 1, -1);
    expect(down.styles["b:0"]).toBeUndefined();
    expect(down.styles["b:1"]).toEqual({ indent: 2, bold: true });
    expect(adjustIndent(s, 0, 0, 1, 1, -1)).toBe(s);
    const gone = adjustIndent({ ...s, styles: { "b:0": { indent: 1 } } }, 0, 0, 1, 1, -1);
    expect(gone.styles["b:0"]).toBeUndefined();
  });
});
