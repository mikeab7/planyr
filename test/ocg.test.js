import { describe, it, expect } from "vitest";
import { ocgLayerList, deriveLayerVisibility } from "../src/workspaces/doc-review/lib/ocg.js";

/* A stand-in for pdf.js's OptionalContentConfig (B490): an iterable of [id, group] pairs plus
 * getGroup(id) + setVisibility(id, v). ocg.js touches only this shape, so no pdfjs is needed. */
function mockConfig(groups) {
  const map = new Map(groups.map((g) => [g.id, { name: g.name, visible: g.visible }]));
  return {
    *[Symbol.iterator]() { yield* map.entries(); },
    getGroup: (id) => map.get(id) || null,
    setVisibility: (id, v) => { const g = map.get(id); if (g) g.visible = v; },
  };
}

describe("ocgLayerList — flatten a PDF's optional-content groups for the Layers panel (B490)", () => {
  it("maps [id, group] pairs to {id, name, visible} rows in iterator order", () => {
    const cfg = mockConfig([
      { id: "5R0", name: "Electrical", visible: true },
      { id: "6R0", name: "Plumbing", visible: false },
    ]);
    expect(ocgLayerList(cfg)).toEqual([
      { id: "5R0", name: "Electrical", visible: true },
      { id: "6R0", name: "Plumbing", visible: false },
    ]);
  });

  it("falls back to 'Layer N' for a null/blank name and coerces visible to a boolean", () => {
    const cfg = mockConfig([
      { id: "a", name: null, visible: 1 },
      { id: "b", name: "  ", visible: 0 }, // whitespace-only → also falls back
      { id: "c", name: "Grading", visible: true },
    ]);
    expect(ocgLayerList(cfg)).toEqual([
      { id: "a", name: "Layer 1", visible: true },
      { id: "b", name: "Layer 2", visible: false },
      { id: "c", name: "Grading", visible: true },
    ]);
  });

  it("returns [] for a doc with no optional content (null / non-iterable / empty)", () => {
    expect(ocgLayerList(null)).toEqual([]);
    expect(ocgLayerList(undefined)).toEqual([]);
    expect(ocgLayerList({})).toEqual([]); // no Symbol.iterator
    expect(ocgLayerList(mockConfig([]))).toEqual([]);
  });
});

describe("deriveLayerVisibility — re-read all rows after a toggle (radio-button siblings, B490)", () => {
  it("refreshes visible from the live config for every row, preserving id/name", () => {
    const cfg = mockConfig([
      { id: "a", name: "A", visible: true },
      { id: "b", name: "B", visible: true },
    ]);
    const rows = ocgLayerList(cfg);
    // a radio-button-style flip: turning B on turned its sibling A off in the config
    cfg.setVisibility("a", false);
    cfg.setVisibility("b", true);
    expect(deriveLayerVisibility(cfg, rows)).toEqual([
      { id: "a", name: "A", visible: false }, // sibling flipped off → surfaced in the panel
      { id: "b", name: "B", visible: true },
    ]);
  });

  it("is safe on a null config or non-array rows", () => {
    const rows = [{ id: "a", name: "A", visible: true }];
    expect(deriveLayerVisibility(null, rows)).toEqual(rows);
    expect(deriveLayerVisibility(mockConfig([]), null)).toEqual([]);
  });
});
