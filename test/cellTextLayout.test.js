import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cellPadX, canSpill, spillSpanWidth, CELL_PAD_PX, INDENT_STEP_PX } from "../src/workspaces/model/lib/cellTextLayout.js";

// NEW-1 — clearing a cell must not move the text of the cell beside it. The label's start point
// comes from ONE inset (`cellPadX`) on both the in-cell path and the spill path.
describe("cellPadX — the one text inset", () => {
  it("is the cell padding plus one step per indent level, scaled by zoom", () => {
    expect(cellPadX(0, 1)).toBe(CELL_PAD_PX);
    expect(cellPadX(undefined, 1)).toBe(CELL_PAD_PX);
    expect(cellPadX(2, 1)).toBe(CELL_PAD_PX + 2 * INDENT_STEP_PX);
    expect(cellPadX(2, 1.5)).toBe((CELL_PAD_PX + 2 * INDENT_STEP_PX) * 1.5);
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
    expect(spillSpanWidth(240, 6)).toBe(240 - 12 - 1);
    expect(spillSpanWidth(4, 6)).toBe(0);
  });
});

describe("SheetView paints both text paths from the shared inset (red-proof of the 2px jump)", () => {
  const src = readFileSync(new URL("../src/workspaces/model/components/SheetView.jsx", import.meta.url), "utf8");
  it("the spill span starts at padX, not a private constant", () => {
    const span = src.split("\n").find((l) => l.includes('position: "absolute"') && l.includes("spillSpanWidth("));
    expect(span, "spill span line").toBeTruthy();
    expect(span).toContain("left: padX");
    expect(span).not.toMatch(/left:\s*\d/);
    expect(span).toContain("alignItems: vAlign");
  });
  it("the in-cell padding and the spill gate use the same helpers", () => {
    expect(src).toContain("padding: isEditing ? 0 : `0 ${padX}px`");
    expect(src).toContain("canSpill({");
    expect(src).toContain("const padX = cellPadX(");
  });
});
