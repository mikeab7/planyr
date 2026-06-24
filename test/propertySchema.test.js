import { describe, it, expect } from "vitest";
import { schemaForMarkup, readProp, writeProp, toolIdForMarkup } from "../src/shared/markup/propertySchema.js";
import { propsForTool } from "../src/shared/markup/tools.matrix.js";

/* B423 / NEW-2 — the panel schema is DERIVED from the matrix and reconciles the engine's
 * neutral keys with the Site Planner's legacy field names. The matrix-consistency assertion
 * here is the seed of the NEW-9 loop: the panel exposes exactly the row's columns. */

describe("toolIdForMarkup — maps a stored markup to its matrix row", () => {
  it("a shape kind is its own id", () => {
    expect(toolIdForMarkup({ kind: "rect" })).toBe("rect");
    expect(toolIdForMarkup({ kind: "polygon" })).toBe("polygon");
  });
  it("a Site Planner measure record (mode) maps to the canonical measure id", () => {
    expect(toolIdForMarkup({ mode: "line", pts: [] })).toBe("distance");
    expect(toolIdForMarkup({ mode: "polyline", pts: [] })).toBe("polylength");
    expect(toolIdForMarkup({ mode: "area", pts: [] })).toBe("area");
  });
  it("an unknown markup resolves to null (empty schema, never a crash)", () => {
    expect(toolIdForMarkup({ kind: "mystery" })).toBe(null);
    expect(schemaForMarkup({ kind: "mystery" })).toEqual([]);
  });
});

describe("readProp / writeProp — canonical key ⇄ host field", () => {
  it("reads the Site Planner's legacy field names through the canonical key", () => {
    const siteRect = { kind: "rect", weight: 4, dash: "dashed", fill: "#fff", fillOpacity: 0.3 };
    expect(readProp(siteRect, "strokeWidth")).toBe(4);   // weight
    expect(readProp(siteRect, "strokeStyle")).toBe("dashed"); // dash
    expect(readProp(siteRect, "fillOpacity")).toBe(0.3);
  });
  it("reads Document Review's neutral field names directly", () => {
    const docRect = { kind: "rect", strokeWidth: 2, strokeStyle: "solid" };
    expect(readProp(docRect, "strokeWidth")).toBe(2);
  });
  it("falls back to the column default when unset", () => {
    expect(readProp({ kind: "rect" }, "strokeWidth")).toBe(2); // PROPERTY_COLUMNS default
  });
  it("writeProp targets the EXISTING field name so no data migration is forced", () => {
    expect(writeProp({ kind: "rect", weight: 2 }, "strokeWidth", 6)).toEqual({ weight: 6 });
    expect(writeProp({ kind: "rect", strokeWidth: 2 }, "strokeWidth", 6)).toEqual({ strokeWidth: 6 });
    expect(writeProp({ kind: "rect" }, "strokeWidth", 6)).toEqual({ strokeWidth: 6 }); // canonical when absent
  });
});

describe("schemaForMarkup — matrix-driven control list", () => {
  it("returns exactly the matrix row's columns, in order, with current values", () => {
    const m = { kind: "rect", weight: 3 };
    const keys = schemaForMarkup(m).map((c) => c.key);
    expect(keys).toEqual(propsForTool("rect"));
  });
  it("each entry carries column metadata (type/label) and the live value", () => {
    const entry = schemaForMarkup({ kind: "line", weight: 5 }).find((c) => c.key === "strokeWidth");
    expect(entry.type).toBe("number");
    expect(entry.label).toBe("Line weight");
    expect(entry.value).toBe(5);
  });
  it("a Line exposes arrowhead toggles (Arrow = Line option)", () => {
    const keys = schemaForMarkup({ kind: "line" }).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["arrowStart", "arrowEnd"]));
  });
});
