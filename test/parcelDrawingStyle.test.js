import { describe, it, expect } from "vitest";
import {
  PD_PROPS, PD_DEFAULT_STYLE, PD_DEFAULT_COLOR, dashFor, migrateMark, migrateMarks, stampStyle, pdSchema,
} from "../src/workspaces/site-planner/components/parcelDrawingStyle.js";

/* B735 — the parcel-drawing overlay's pure style helpers: the legacy single-`color` model is
 * migrated onto the shared per-object fields, and the overlay's panel is capability-driven off the
 * shared column metadata (fill only for the closed Box). */

describe("migrateMark — legacy color → shared fields (no data loss)", () => {
  it("maps a shape's color onto stroke", () => {
    expect(migrateMark({ id: "a", type: "rect", color: "#16a34a", pts: [] }))
      .toEqual({ id: "a", type: "rect", stroke: "#16a34a", pts: [] });
  });
  it("maps a text mark's color onto fontColor", () => {
    expect(migrateMark({ id: "t", type: "text", color: "#2563eb", text: "hi", pts: [] }))
      .toEqual({ id: "t", type: "text", fontColor: "#2563eb", text: "hi", pts: [] });
  });
  it("is idempotent — a mark already on the new model is returned unchanged", () => {
    const m = { id: "a", type: "rect", stroke: "#111", pts: [] };
    expect(migrateMark(m)).toBe(m);
  });
  it("a legacy mark with no color at all gets the historical default ink", () => {
    expect(migrateMark({ id: "x", type: "line", pts: [] }).stroke).toBe(PD_DEFAULT_COLOR);
  });
  it("migrateMarks maps a list and tolerates junk", () => {
    expect(migrateMarks([{ type: "pen", color: "#000", pts: [] }])).toHaveLength(1);
    expect(migrateMarks([{ type: "pen", color: "#000", pts: [] }])[0].stroke).toBe("#000");
    expect(migrateMarks(null)).toEqual([]);
  });
});

describe("capability model + shared panel schema", () => {
  it("only the closed Box exposes fill; open marks (line/pen) do not", () => {
    expect(PD_PROPS.rect).toEqual(expect.arrayContaining(["fill", "fillOpacity"]));
    expect(PD_PROPS.line).not.toContain("fill");
    expect(PD_PROPS.pen).not.toContain("fill");
  });
  it("text exposes its text color (fontColor), not a stroke", () => {
    expect(PD_PROPS.text).toEqual(["fontColor"]);
  });
  it("pdSchema returns matrix-backed control metadata + the subject's current value", () => {
    const byKey = Object.fromEntries(pdSchema({ type: "rect", stroke: "#123456", fillOpacity: 0.5 }).map((c) => [c.key, c]));
    expect(byKey.stroke.type).toBe("color");
    expect(byKey.stroke.value).toBe("#123456");
    expect(byKey.strokeWidth.type).toBe("number");
    expect(byKey.fillOpacity.value).toBe(0.5);
  });
  it("an unknown/mode subject yields an empty schema (never a crash)", () => {
    expect(pdSchema({ type: "select" })).toEqual([]);
    expect(pdSchema(null)).toEqual([]);
  });
  it("stampStyle picks only the type's capability subset from the sticky style", () => {
    const stamped = stampStyle(PD_DEFAULT_STYLE, "line");
    expect(Object.keys(stamped).sort()).toEqual(["opacity", "stroke", "strokeStyle", "strokeWidth"].sort());
    expect("fill" in stamped).toBe(false);
  });
});

describe("dashFor — dash pattern in the overlay's 0..1 viewBox units", () => {
  it("solid → no dash; dashed/dotted → a pattern", () => {
    expect(dashFor({ type: "line", strokeStyle: "solid" })).toBeUndefined();
    expect(dashFor({ type: "line", strokeStyle: "dashed" })).toBeTruthy();
    expect(dashFor({ type: "line", strokeStyle: "dotted" })).toBeTruthy();
  });
  it("the calibration line keeps its signature dash regardless of strokeStyle", () => {
    expect(dashFor({ type: "calib", strokeStyle: "solid" })).toBe("0.012 0.008");
  });
});
