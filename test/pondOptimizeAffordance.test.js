/* NEW-1 (2026-07-28) — THE REGRESSION GUARD.
 *
 * The bug: the pond inspector's ⚡ Optimize pond button was mounted by
 *   statusCards.findIndex((c) => tone !== "ok")
 * i.e. it rode the first NON-GREEN verdict row. B1031 then deliberately kept an over-dug ledger
 * GREEN, and B1032/B1036 demoted the remaining amber states — so on a plan where every row read
 * green there was no row for the button to attach to and the optimizer SILENTLY DISAPPEARED from
 * the panel. The owner lost a tool he used, with no error and nothing to click.
 *
 * The coupling to tone is what made this fragile, so that is what these tests forbid. The
 * all-green / covered case and the over-dug case are both asserted explicitly, because those are
 * the two states that produced the disappearance.
 *
 * Owner amendment, same day: the affordance is NOT a button — it is ONE suggestion line, shown
 * only when a materially better basin exists, silent otherwise. So the second half of this file
 * guards that silence is real (null, not a "nothing to suggest" line) and that Apply is a
 * proposal the owner clicks, never an auto-edit. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  optimizeAffordance,
  materialAlternative,
  MATERIAL_LAND_AC,
  OPTIMIZE_BLOCKED,
} from "../src/workspaces/site-planner/lib/pondOptimizeAffordance.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

// A pond whose ledgers all read green — the exact state that made the optimizer vanish.
const ALL_GREEN = { hasRing: true, detRequiredAcFt: 76.7, mitRequiredAcFt: null, splitKnown: true, detShort: false, mitShort: false };

describe("the optimizer is available in the ALL-GREEN / covered state (the regression)", () => {
  it("a covered pond still gets the optimizer", () => {
    const aff = optimizeAffordance(ALL_GREEN);
    expect(aff.available).toBe(true);
    expect(aff.mode).toBe("rightsize");
  });

  it("an OVER-DUG pond gets it too — that is the case that most wants a smaller basin", () => {
    // 150.9 provided against 76.7 required is the owner's real Tsakiris-class over-provision.
    // It is not even an input here: over-provision cannot reach this decision, by construction.
    const aff = optimizeAffordance({ ...ALL_GREEN, detRequiredAcFt: 76.7 });
    expect(aff.available).toBe(true);
    expect(aff.mode).toBe("rightsize");
  });

  it("a mitigation-only site that is fully covered still gets it", () => {
    const aff = optimizeAffordance({ hasRing: true, detRequiredAcFt: null, mitRequiredAcFt: 0.2, splitKnown: true });
    expect(aff.available).toBe(true);
    expect(aff.mode).toBe("rightsize");
  });

  it("a SHORT ledger picks the solve job — the verdict chooses the JOB, never the availability", () => {
    expect(optimizeAffordance({ ...ALL_GREEN, detShort: true }).mode).toBe("solve");
    expect(optimizeAffordance({ ...ALL_GREEN, mitRequiredAcFt: 0.2, mitShort: true }).mode).toBe("solve");
    // …and availability is identical across every one of those verdict states.
    for (const s of [{}, { detShort: true }, { mitShort: true }, { detShort: true, mitShort: true }]) {
      expect(optimizeAffordance({ ...ALL_GREEN, mitRequiredAcFt: 0.2, ...s }).available).toBe(true);
    }
  });
});

describe("availability is POSSIBILITY, never tone", () => {
  it("no requirement to size against → blocked, with a reason that names the next action", () => {
    const aff = optimizeAffordance({ hasRing: true, detRequiredAcFt: null, mitRequiredAcFt: null });
    expect(aff.available).toBe(false);
    expect(aff.reason).toBe(OPTIMIZE_BLOCKED["no-requirement"]);
    expect(aff.reason).toMatch(/Re-check/);
  });

  it("an unresolved usable/dead split → blocked rather than sizing against fabricated numbers", () => {
    const aff = optimizeAffordance({ ...ALL_GREEN, splitKnown: false });
    expect(aff.available).toBe(false);
    expect(aff.code).toBe("split-unknown");
  });

  it("no pond drawn at all → the draw-a-right-sized-one job", () => {
    expect(optimizeAffordance({ hasRing: false }).mode).toBe("draw");
  });

  it("the decision takes NO tone/over-provision input — the coupling cannot be re-added silently", () => {
    // Passing every tone-shaped key we can think of must change nothing.
    const base = optimizeAffordance(ALL_GREEN);
    const noisy = optimizeAffordance({ ...ALL_GREEN, tone: "ok", over: true, overdugAcFt: 74.2, statusCards: [] });
    expect(noisy).toEqual(base);
  });
});

describe("silence is information — materialAlternative", () => {
  const opt = (baseAc, altAc) => ({ ok: true, base: { landTakeAc: baseAc }, best: { landTakeAc: altAc, depthFt: 10 } });

  it("returns null when nothing is materially smaller, so the panel renders NOTHING", () => {
    expect(materialAlternative(opt(3.0, 2.99))).toBe(null);
    expect(materialAlternative(opt(3.0, 3.4))).toBe(null); // bigger is not an optimization
  });

  it("returns the alternative, with the land it frees, once it clears the material floor", () => {
    const a = materialAlternative(opt(3.4, 2.1));
    expect(a.landSavedAc).toBeCloseTo(1.3, 3);
    expect(a.baseLandTakeAc).toBe(3.4);
  });

  it("respects the material floor, and honours an override", () => {
    // Straddle the floor rather than sitting exactly on it: 3 - 0.05 is 2.9499999999999997 in
    // binary floating point, so an exact-boundary assertion would test IEEE 754, not the rule.
    expect(materialAlternative(opt(3, 3 - MATERIAL_LAND_AC * 1.01))).not.toBe(null);
    expect(materialAlternative(opt(3, 3 - MATERIAL_LAND_AC * 0.99))).toBe(null);
    expect(materialAlternative(opt(3, 2.5), { minLandAc: 1 })).toBe(null);
  });

  it("a failed / empty search is null, never a fabricated basin", () => {
    expect(materialAlternative(null)).toBe(null);
    expect(materialAlternative({ ok: false, reason: "no pond footprint" })).toBe(null);
    expect(materialAlternative({ ok: true, base: { landTakeAc: null }, best: { landTakeAc: 1 } })).toBe(null);
  });
});

describe("the SitePlanner wiring keeps the decoupling (source scan — the repo's vitest is DOM-free)", () => {
  it("the old tone-keyed mount is gone and cannot come back unnoticed", () => {
    // Match the executable forms only — the comments above the suggestion line deliberately
    // quote the old code so the next reader knows exactly what not to reintroduce.
    expect(src.includes("statusCards.findIndex((c)")).toBe(false);
    expect(src.includes("const optimizeIdx")).toBe(false);
    expect(src.includes("i === optimizeIdx")).toBe(false);
  });

  it("the suggestion line renders from the affordance + a material delta, and nothing else", () => {
    expect(src).toContain("const alt = materialAlternative(rightSizeResultFor(selEl));");
    expect(src).toContain("if (!alt) return null;");
  });

  it("designPond's covered case is LOUD, not the old silent `return`", () => {
    expect(src.includes("if (!needsDet && !needsMit) return;")).toBe(false);
    expect(src).toContain("if (!needsDet && !needsMit) { rightSizePond(); return; }");
  });

  it("the suggestion is APPLY-gated — drawing is authorship, the tool never auto-edits geometry", () => {
    const block = src.slice(src.indexOf("const alt = materialAlternative"), src.indexOf('data-testid="pond-rightsize"') + 4000);
    expect(block).toContain("const apply = () => {");
    expect(block).toContain("pushHistory();"); // one atomic undo
    // the resize happens INSIDE the click handler, never at render time
    expect(block.indexOf("const apply = () => {")).toBeLessThan(block.indexOf("setSelEl({ points: scaleRing"));
  });
});
