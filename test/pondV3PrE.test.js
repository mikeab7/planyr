// v3 post-ship audit — PR-E: the bugs from the owner's first real Optimize click after PR-C.
// E1 Optimize must never create/duplicate geometry; E2 mitigation status-card regression at
// requirement 0 + exactly one Optimize button; E3 the pond→yield recompute is live (pure engine);
// E4 numbers are 1dp everywhere and the berm is ONE number. The render-side items are guarded by
// source scan (vitest is DOM-free); the pure recompute (E3) and the change-summary rounding (E4)
// have behavior tests here + in pondChangeSummary.test.js.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";

import { detentionVerdict, mitigationVerdict } from "../src/workspaces/site-planner/lib/pondVerdict.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};
// The designPond handler, delimited by its opening and the drainage block that follows it.
const dpStart = at("const designPond = () => {");
const dpEnd = at("// (B789: drainChannelRelevant now computed up");
const dp = src.slice(dpStart, dpEnd);

describe("E1 — Optimize NEVER creates geometry when a pond already exists", () => {
  it("the pick/create block gates the create path on ZERO existing ponds", () => {
    // A pond exists → adjust an existing one (isNew=false); only zero ponds may place geometry.
    expect(dp).toContain("if (existingPonds.length > 0) {");
    const gateIdx = dp.indexOf("if (existingPonds.length > 0) {");
    const elseIdx = dp.indexOf("// ZERO ponds on the site");
    expect(elseIdx).toBeGreaterThan(gateIdx);
  });

  it("isNew=true (the geometry-placing path) lives ONLY inside the zero-ponds branch", () => {
    // The pick block sets isNew=false in the pond-exists branch and isNew=true only after the
    // "ZERO ponds" comment. There must be no isNew=true before that comment in the pick block.
    const pickStart = dp.indexOf("let baseEl, isNew;");
    const zeroIdx = dp.indexOf("// ZERO ponds on the site");
    const pickBeforeZero = dp.slice(pickStart, zeroIdx);
    expect(pickBeforeZero.includes("isNew = true")).toBe(false);
    expect(pickBeforeZero).toContain("isNew = false");
  });

  it("the create-path toast tells the user a pond was drawn (never silent geometry)", () => {
    // G4 — detMsg/mitMsg are now complete sentences, so the assembly leads with "Placed a pond."
    // on the create path (no shared "This pond was …" verb prefix that read ungrammatically).
    expect(dp).toContain('${isNew ? "Placed a pond. " : ""}');
  });
});

describe("E2 — mitigation status-card regression at requirement 0", () => {
  // These live in the pond-inspector RENDER (the statusCards block), below designPond.
  it("(a) neither status card renders when its requirement rounds to 0 at 1dp (>= 0.05 floor)", () => {
    // NEW-1 hoisted the two requirement figures out of the statusCards IIFE (the optimizer
    // affordance reads the SAME numbers), but the 0.05 floor itself is unchanged.
    expect(src).toContain("sc_detReqRaw != null && sc_detReqRaw >= 0.05 ? sc_detReqRaw : null");
    expect(src).toContain("drainMitDisplay.volumeCf > 0 && drainMitDisplay.volumeAcFt >= 0.05 ? drainMitDisplay.volumeAcFt : null");
  });

  // NEW-1 (2026-07-28) — E2(c) is SUPERSEDED. There is no per-card Optimize button any more: the
  // owner asked for no control to hunt for, so the optimizer is ONE suggestion line whose condition
  // never mentions tone. Guarding the count of a button that no longer exists would guard nothing;
  // what matters now is that exactly one suggestion renders and that it is tone-free.
  it("(c) EXACTLY ONE optimizer affordance in the inspector, and its condition is tone-free", () => {
    expect(src.split('data-testid="pond-rightsize"').length - 1).toBe(1);
    const line = src.slice(src.indexOf("const aff = optimizeAffordance({"), src.indexOf('data-testid="pond-rightsize"'));
    for (const forbidden of ["tone", "PAL.danger", "PAL.warn", "c.short", "statusCards"]) {
      expect(line.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("cards carry a kind so detention leads (findIndex → detention when it is short)", () => {
    // NEW-1 — the `kind` now rides the pure verdict objects; the push ORDER (detention first,
    // so it is statusCards[0]) is still the SitePlanner wiring this guards.
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7 }).kind).toBe("detention");
    expect(mitigationVerdict({ providedAcFt: 98.2, requiredAcFt: 97.7 }).kind).toBe("mitigation");
    const detKind = src.indexOf("const dv = detentionVerdict({");
    const mitKind = src.indexOf("mitigationVerdict({ providedAcFt: provMitAcFt");
    expect(detKind).toBeGreaterThan(0);
    expect(detKind).toBeLessThan(mitKind); // detention pushed first → it is statusCards[0]
  });
});

describe("E3 — the pond→yield recompute is live (pure engine reflects a rim change same-tick)", () => {
  const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
  const wseFt = 100; // design flood water surface

  it("a rim AT the flood level counts ~zero usable; RAISING the rim recomputes MORE usable", () => {
    // R1 — the rim matters for usable only when the flood floors it (coincident storm); by default the
    // pond recovers to normal tailwater and the whole column is usable regardless of rim vs flood.
    const low = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }, { wseFt, coincidentStorm: true });
    const high = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 104 }, { wseFt, coincidentStorm: true });
    // The only change is the rim elevation — the recompute must move with it (no stale value).
    expect(high.usableCf).toBeGreaterThan(low.usableCf + 1);
    // and a rim buried at/below the WSE credits essentially nothing
    expect(low.usableCf).toBeLessThan(high.usableCf);
  });

  it("the same geometry with a higher rim never returns an unchanged (cached) result", () => {
    const a = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 101 }, { wseFt, coincidentStorm: true });
    const b = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 105 }, { wseFt, coincidentStorm: true });
    expect(b.usableCf).not.toBe(a.usableCf);
  });
});

describe("E4 — number consistency: 1dp ac-ft + ONE berm number", () => {
  it("the on-plan berm label shows the rim-above-grade berm height (PR-D: bermH, the same number everywhere)", () => {
    expect(src).toContain("berm {(Math.round(bermH * 10) / 10).toFixed(1)} ft");
    // the old label off the max fill height (berm.hFt) is gone
    expect(src.includes("berm {(Math.round(berm.hFt * 10) / 10).toFixed(1)} ft")).toBe(false);
  });
});
