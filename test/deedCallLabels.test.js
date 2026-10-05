import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { deedCallsShown } from "../src/workspaces/site-planner/lib/easements.js";

/* NEW-1 — metes-and-bounds call labels default OFF. RED on main: `deedCallsShown` does not exist and the
   canvas draws the labels unconditionally. */
describe("deedCallsShown — the one gate for per-course call labels", () => {
  it("is OFF for a missing setting (every plan saved before the feature — no migration)", () => {
    expect(deedCallsShown({ kind: "encumbrance", calls: [{ label: "N 1° E 10'" }] })).toBe(false);
    expect(deedCallsShown(null)).toBe(false);
    expect(deedCallsShown({ showCalls: null })).toBe(false);
    expect(deedCallsShown({ showCalls: false })).toBe(false);
  });
  it("is ON only for an explicit true", () => {
    expect(deedCallsShown({ showCalls: true })).toBe(true);
  });
  it("survives duplicate/move spreads (the markup is copied whole)", () => {
    const m = { id: "a", showCalls: true };
    expect(deedCallsShown({ ...m, id: "b" })).toBe(true);
  });
});

describe("render wiring (source guard)", () => {
  const src = fs.readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
  it("the per-call label map sits behind deedCallsShown, and no other site draws c.label", () => {
    expect(src).toMatch(/deedCallsShown\(m\) && labelPpf > 0\.12 && \(m\.calls \|\| \[\]\)\.map/);
    expect((src.match(/\(m\.calls \|\| \[\]\)\.map/g) || []).length).toBe(1);
  });
  it("the toggle writes through setSelMarkupGeom (never the shared mkStyle)", () => {
    expect(src).toMatch(/data-testid="deed-show-calls"[^\n]*setSelMarkupGeom\(\{ showCalls/);
  });
});
