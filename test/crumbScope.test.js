/* NEW-1/NEW-2 (2026-10-29) — the two pure header-breadcrumb rules in shared/ui/crumbScope.js, and the
 * wiring that makes them the ONLY place those decisions are taken. The measured, real-render proof
 * is the e2e spec header-crumb-scope. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trailingCrumbAllowed, trailingCrumbFor, crumbFloor, MODULES_WITH_TRAILING_CRUMB } from "../src/shared/ui/crumbScope.js";
import { plannerSource } from "./helpers/plannerSource.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("which tabs may show a trailing crumb", () => {
  it("only Site (the plan) and Schedule (its own schedule switcher, not a plan) do", () => {
    expect([...MODULES_WITH_TRAILING_CRUMB].sort()).toEqual(["scheduler", "site-planner"]);
  });
  it("Spreadsheet, Review, Library and Notes never get one — whatever slot they hand in", () => {
    for (const m of ["model", "doc-review", "library", "notes", "food", undefined]) {
      expect(trailingCrumbAllowed(m), String(m)).toBe(false);
      expect(trailingCrumbFor(m, "SLOT")).toBeNull();
    }
  });
  it("Site passes its plan crumb through untouched, and no slot stays no slot", () => {
    const slot = { type: "plan" };
    expect(trailingCrumbFor("site-planner", slot)).toBe(slot);
    expect(trailingCrumbFor("site-planner", null)).toBeNull();
  });
});

describe("crumbFloor — a floor that never pads a short name", () => {
  const chars = (css) => Number(/calc\(([\d.]+)ch/.exec(css)[1]);
  it("is capped at the shared floor for any long name", () => {
    expect(crumbFloor("x".repeat(80), 92)).toBe("min(92px, calc(32.0ch + 36px))");
  });
  it("grows with the name (so a one-letter crumb is floored far below 92)", () => {
    expect(crumbFloor("A", 92)).toBe("min(92px, calc(0.4ch + 36px))");
    expect(chars(crumbFloor("GC", 92))).toBeLessThan(chars(crumbFloor("Academy", 92)));
  });
  it("counts characters, not UTF-16 units, and tolerates an empty / missing name", () => {
    expect(crumbFloor("😀", 92)).toBe(crumbFloor("A", 92));
    expect(crumbFloor(undefined, 92)).toBe("min(92px, calc(0.0ch + 36px))");
  });
});

describe("the wiring, read off the real source", () => {
  it("AppHeader decides the slot from the active module — one place", () => {
    expect(read("src/shared/ui/AppHeader.jsx")).toContain("planSlot={trailingCrumbFor(module, planSlot)}");
  });
  it("the Spreadsheet no longer builds a plan/concept crumb of its own", () => {
    const model = read("src/workspaces/model/ModelApp.jsx");
    expect(model).not.toContain("model-concept-crumb");
    expect(model).not.toContain("planSlot=");
  });
  it("no crumb carries a flat min-width floor any more", () => {
    expect(read("src/shared/ui/ProjectBreadcrumb.jsx")).not.toMatch(/minWidth: CRUMB_MIN_W/);
    expect(plannerSource()).not.toMatch(/minWidth: CRUMB_MIN_W/);
  });
});
