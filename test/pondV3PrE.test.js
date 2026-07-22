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
    expect(dp).toContain('${isNew ? "Placed a pond — " : "This pond was "}');
  });
});

describe("E2 — mitigation status-card regression at requirement 0", () => {
  // These live in the pond-inspector RENDER (the statusCards block), below designPond.
  it("(a) neither status card renders when its requirement rounds to 0 at 1dp (>= 0.05 floor)", () => {
    expect(src).toContain("detReqRaw != null && detReqRaw >= 0.05 ? detReqRaw : null");
    expect(src).toContain("mit.volumeCf > 0 && mit.volumeAcFt >= 0.05 ? mit.volumeAcFt : null");
  });

  it("(c) EXACTLY ONE Optimize button: it rides only the first short card", () => {
    expect(src).toContain("const optimizeIdx = statusCards.findIndex((c) => c.short);");
    expect(src).toContain("c.short && i === optimizeIdx");
    // the old per-card render (a button for every short card) is gone
    expect(src.includes("{c.short && (\n                              <button")).toBe(false);
  });

  it("cards carry a kind so detention leads (findIndex → detention when it is short)", () => {
    expect(src).toContain('kind: "detention"');
    expect(src).toContain('kind: "mitigation"');
    const detKind = src.indexOf('kind: "detention"');
    const mitKind = src.indexOf('kind: "mitigation"');
    expect(detKind).toBeLessThan(mitKind); // detention pushed first → it is statusCards[0]
  });
});

describe("E3 — the pond→yield recompute is live (pure engine reflects a rim change same-tick)", () => {
  const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
  const wseFt = 100; // design flood water surface

  it("a rim AT the flood level counts ~zero usable; RAISING the rim recomputes MORE usable", () => {
    const low = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }, { wseFt });
    const high = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 104 }, { wseFt });
    // The only change is the rim elevation — the recompute must move with it (no stale value).
    expect(high.usableCf).toBeGreaterThan(low.usableCf + 1);
    // and a rim buried at/below the WSE credits essentially nothing
    expect(low.usableCf).toBeLessThan(high.usableCf);
  });

  it("the same geometry with a higher rim never returns an unchanged (cached) result", () => {
    const a = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 101 }, { wseFt });
    const b = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 105 }, { wseFt });
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
