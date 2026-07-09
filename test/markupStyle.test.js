import { describe, it, expect } from "vitest";
import { resolveMarkupStyle, kindDefaults, MEAS_STROKE, ANNOT_STROKE } from "../src/shared/markup/markupStyle.js";
import { schemaForMarkup } from "../src/shared/markup/propertySchema.js";
import { propsForTool } from "../src/shared/markup/tools.matrix.js";

/* B734 — the shared per-object style resolver. A markup owns concrete style fields once
 * committed; an unset stroke/fill falls back to the KIND's historical ink (teal for measures,
 * burnt-orange for annotations) — never the generic column default, which used to paint every
 * committed measure orange. Both the renderer and the draft preview resolve through this. */

describe("kindDefaults — historical per-kind ink", () => {
  it("measures default teal; the closed measures (area/perimeter) also seed a teal fill", () => {
    expect(kindDefaults("distance")).toEqual({ stroke: MEAS_STROKE });
    expect(kindDefaults("count")).toEqual({ stroke: MEAS_STROKE });
    expect(kindDefaults("area")).toEqual({ stroke: MEAS_STROKE, fill: MEAS_STROKE });
    expect(kindDefaults("perimeter")).toEqual({ stroke: MEAS_STROKE, fill: MEAS_STROKE });
  });
  it("annotations default burnt-orange with no fill seed (even the closed ones)", () => {
    expect(kindDefaults("rect")).toEqual({ stroke: ANNOT_STROKE });
    expect(kindDefaults("polygon")).toEqual({ stroke: ANNOT_STROKE });
    expect(kindDefaults("line")).toEqual({ stroke: ANNOT_STROKE });
  });
});

describe("resolveMarkupStyle — per-object field with kind fallback", () => {
  it("an unset measure resolves to teal (not the generic column default)", () => {
    expect(resolveMarkupStyle({ kind: "distance", pts: [] }).stroke).toBe(MEAS_STROKE);
    const area = resolveMarkupStyle({ kind: "area" });
    expect(area.stroke).toBe(MEAS_STROKE);
    expect(area.fill).toBe(MEAS_STROKE);
  });
  it("an unset annotation resolves burnt-orange, fill none", () => {
    const r = resolveMarkupStyle({ kind: "rect" });
    expect(r.stroke).toBe(ANNOT_STROKE);
    expect(r.fill).toBe("none");
  });
  it("a per-object stroke/fill/width/dash/opacity wins over the kind default", () => {
    const s = resolveMarkupStyle({ kind: "area", stroke: "#123456", fill: "#abcdef", strokeWidth: 5, strokeStyle: "dashed", fillOpacity: 0.4, opacity: 0.5 });
    expect(s).toMatchObject({ stroke: "#123456", fill: "#abcdef", strokeWidth: 5, strokeStyle: "dashed", fillOpacity: 0.4, opacity: 0.5 });
  });
  it("reads the Site Planner's legacy weight/dash field names via readProp", () => {
    const s = resolveMarkupStyle({ kind: "rect", weight: 6, dash: "dotted" });
    expect(s.strokeWidth).toBe(6);
    expect(s.strokeStyle).toBe("dotted");
  });
  it("width/opacity/fillOpacity fall back to sane defaults when unset", () => {
    const s = resolveMarkupStyle({ kind: "line" });
    expect(s.strokeWidth).toBe(2);
    expect(s.opacity).toBe(1);
    expect(s.fillOpacity).toBe(0);
  });
});

describe("perimeter now exposes fill (B734 — deliberate matrix spec change)", () => {
  it("the perimeter tool lists fill + fillOpacity", () => {
    expect(propsForTool("perimeter")).toEqual(expect.arrayContaining(["fill", "fillOpacity"]));
  });
  it("schemaForMarkup surfaces the fill controls for a perimeter measurement", () => {
    const keys = schemaForMarkup({ kind: "perimeter" }).map((c) => c.key);
    expect(keys).toContain("fill");
    expect(keys).toContain("fillOpacity");
  });
});
