// source-scan: pins that the planner draws switched-off lots through the helper
import { describe, it, expect } from "vitest";
import { plannerSource } from "./helpers/plannerSource.js";
import { inactiveParcelStroke, INACTIVE_PARCEL_MAX_W } from "../src/workspaces/site-planner/lib/inactiveParcelLine.js";

describe("inactiveParcelStroke — a switched-off lot is a fine dashed line, never chunky blocks", () => {
  it("caps a heavy boundary override (the Goose Creek 5.75 px lot) at the thin weight", () => {
    expect(inactiveParcelStroke(5.75)).toEqual({ width: 1.5, dash: "4 3" });
    expect(inactiveParcelStroke(3)).toEqual({ width: 1.5, dash: "4 3" });
  });
  it("keeps a thinner boundary thinner, with a dash proportional to it", () => {
    expect(inactiveParcelStroke(1)).toEqual({ width: 1, dash: "2.67 2" });
  });
  it("falls back to the thin weight on a missing / bad weight", () => {
    for (const w of [undefined, null, NaN, 0, -2]) expect(inactiveParcelStroke(w).width).toBe(INACTIVE_PARCEL_MAX_W);
  });
  it("the dash is never shorter than the line is wide (it must read as a dash, not a dot row)", () => {
    for (const w of [0.5, 1, 1.5, 4, 8]) {
      const { width, dash } = inactiveParcelStroke(w);
      const [on, off] = dash.split(" ").map(Number);
      expect(on).toBeGreaterThan(width);
      expect(off).toBeGreaterThanOrEqual(width);
    }
  });
  it("is not zoom-scaled: the answer depends on the weight only (constraint #23)", () => {
    expect(inactiveParcelStroke.length).toBe(1);
  });
  it("the planner draws switched-off parcels through it, not the old fixed 8 6 dash", () => {
    const src = plannerSource();
    expect(src).toContain("inactiveParcelStroke(");
    expect(src).not.toContain('strokeDasharray={inactive ? "8 6"');
  });
});
