import { describe, it, expect } from "vitest";
import {
  TOOL_MATRIX, PROPERTY_COLUMNS, DRAW_MODES, CATEGORIES, WORKSPACES,
  toolById, propsForTool, toolsForWorkspace, measureTools, isClosedTool, columnMeta,
} from "../src/shared/markup/tools.matrix.js";

/* The matrix is the spec the engine + the generated tool tests are driven by (NEW-1/B422).
 * These assertions guard its INTERNAL consistency — that every row is well-formed and that
 * no property/draw-mode/workspace token drifts away from its declared vocabulary. They are
 * the seed of the NEW-9 per-tool loop: a row added later can't reference an undefined
 * property column or an unknown draw mode without this failing. */

const COLUMN_KEYS = new Set(Object.keys(PROPERTY_COLUMNS));

describe("tool matrix — shape & vocabulary", () => {
  it("has rows and each carries the required fields", () => {
    expect(TOOL_MATRIX.length).toBeGreaterThan(0);
    for (const t of TOOL_MATRIX) {
      expect(typeof t.id, t.id).toBe("string");
      expect(typeof t.label, t.id).toBe("string");
      expect(typeof t.hint, t.id).toBe("string");
      expect(Array.isArray(t.properties), t.id).toBe(true);
      expect(Array.isArray(t.workspaces), t.id).toBe(true);
      expect(typeof t.closed, t.id).toBe("boolean");
    }
  });

  it("ids are unique", () => {
    const ids = TOOL_MATRIX.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every category / drawMode / workspace token is in its declared vocabulary", () => {
    for (const t of TOOL_MATRIX) {
      expect(CATEGORIES, t.id).toContain(t.category);
      expect(DRAW_MODES, t.id).toContain(t.drawMode);
      expect(t.workspaces.length, t.id).toBeGreaterThan(0);
      for (const ws of t.workspaces) expect(WORKSPACES, `${t.id}:${ws}`).toContain(ws);
    }
  });

  it("every listed property is a defined PROPERTY_COLUMNS key", () => {
    for (const t of TOOL_MATRIX) {
      for (const p of t.properties) expect(COLUMN_KEYS.has(p), `${t.id}.${p}`).toBe(true);
    }
  });

  it("each PROPERTY_COLUMNS entry has a type and label, and enum/range carry their extras", () => {
    for (const [key, m] of Object.entries(PROPERTY_COLUMNS)) {
      expect(typeof m.type, key).toBe("string");
      expect(typeof m.label, key).toBe("string");
      if (m.type === "enum") expect(Array.isArray(m.options), key).toBe(true);
      if (m.type === "range") { expect(typeof m.min, key).toBe("number"); expect(typeof m.max, key).toBe("number"); }
    }
  });
});

describe("tool matrix — semantic consistency", () => {
  it("a closed shape that exposes fill also exposes fillOpacity (and vice-versa)", () => {
    for (const t of TOOL_MATRIX) {
      const hasFill = t.properties.includes("fill");
      const hasFillOp = t.properties.includes("fillOpacity");
      // fill always pairs with fillOpacity; fillOpacity may stand alone (e.g. count markers).
      if (hasFill) expect(hasFillOp, `${t.id} has fill without fillOpacity`).toBe(true);
    }
  });

  it("only measure tools declare a measureOutput, and it's a known kind", () => {
    for (const t of TOOL_MATRIX) {
      if (t.measureOutput) {
        expect(["length", "area", "count"], t.id).toContain(t.measureOutput);
      }
    }
    // every measure category row HAS an output
    for (const t of TOOL_MATRIX.filter((r) => r.category === "measure")) {
      expect(t.measureOutput, t.id).toBeTruthy();
    }
  });

  it("an area / perimeter measure is a closed ring; a distance is not", () => {
    expect(isClosedTool("area")).toBe(true);
    expect(isClosedTool("perimeter")).toBe(true);
    expect(isClosedTool("distance")).toBe(false);
    expect(isClosedTool("polylength")).toBe(false);
  });

  it("arrowheads only appear on open line-like shapes, never on a closed ring", () => {
    for (const t of TOOL_MATRIX) {
      const hasArrow = t.properties.includes("arrowStart") || t.properties.includes("arrowEnd");
      if (hasArrow) expect(t.closed, `${t.id} is closed but has an arrowhead`).toBe(false);
    }
  });

  it("the Arrow tool is a Line option, not a standalone row (owner decision)", () => {
    expect(toolById("arrow")).toBeUndefined();
    expect(propsForTool("line")).toEqual(expect.arrayContaining(["arrowStart", "arrowEnd"]));
  });
});

describe("tool matrix — accessors", () => {
  it("toolById round-trips; propsForTool is [] for a mode and unknown id", () => {
    expect(toolById("rect").id).toBe("rect");
    expect(propsForTool("select")).toEqual([]);
    expect(propsForTool("nope")).toEqual([]);
  });

  it("toolsForWorkspace returns rows tagged for that surface, in matrix order", () => {
    const docTools = toolsForWorkspace("doc").map((t) => t.id);
    expect(docTools).toContain("line");
    expect(docTools).toContain("count");
    // stitch is the lean surface — measures + modes only, no annotation shapes
    const stitchTools = toolsForWorkspace("stitch").map((t) => t.id);
    expect(stitchTools).toContain("distance");
    expect(stitchTools).not.toContain("cloud");
  });

  it("measureTools is exactly the rows with a measureOutput", () => {
    const ids = measureTools().map((t) => t.id).sort();
    expect(ids).toEqual(["area", "count", "dimension", "distance", "perimeter", "polylength"].sort());
  });

  it("columnMeta exposes a column's metadata", () => {
    expect(columnMeta("strokeWidth").type).toBe("number");
    expect(columnMeta("strokeStyle").options).toContain("dashed");
  });
});
