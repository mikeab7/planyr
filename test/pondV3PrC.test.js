// v3 post-ship audit — PR-C: the solver-apply fix (C1), the Max berm ceiling input (C2),
// the toast/copy 1dp shape (C5), and the on-plan berm ring + legend (C4). The repo's vitest
// config is DOM-free, so the render-side items are guarded by source scan against the stable
// markers in SitePlanner.jsx; the pure decision layers (C3 guards, C2 gap proposal) have their
// own behavior tests in pondScreeningGuards.test.js / pondChangeSummary.test.js.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};
// The designPond handler body, delimited by its opening and the place() that ships the result.
const dpStart = at("let finalEl = { ...baseEl, det: { ...baseEl.det, role: roleForJob } };");
const dpEnd = at("// (B789: drainChannelRelevant now computed up");
const dp = src.slice(dpStart, dpEnd);

describe("C1 — Optimize pond APPLIES the elevation solution it computes (no more atomic no-apply)", () => {
  it("the detention solve applies its actions and flags detApplied, rather than returning before place()", () => {
    expect(dp).toContain("finalEl = applyPondSizingActions({ ...finalEl, det: effDetProbe }, pass1.actions);");
    expect(dp).toContain("detApplied = true;");
  });

  it("only a genuinely un-appliable existing pond (no elevation remedy) takes the show-what-it-takes path", () => {
    // The atomic bail is now gated on nothing having been applied — an applied solve falls through to place().
    expect(dp).toContain("if (!isNew && !detApplied && !mitApplied) {");
  });

  it("place() ships the applied pond and the persistent card shows what changed (infeasible=false), with any residual gap", () => {
    const place = dp.indexOf("place(finalEl);");
    const finish = dp.indexOf("finishSummary(finalEl, false, gapMsgs || null);");
    expect(place).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(place); // the applied-path finishSummary comes after place()
  });
});

describe("C2 — the Max berm (ft) ceiling: an input the solver honors", () => {
  it("the ceiling defaults to the Standards BERM_MAX_RAISE_FT and reads the pond's own maxBermFt override", () => {
    expect(src).toContain("const maxBermFt = Number.isFinite(baseEl.det?.maxBermFt) && baseEl.det.maxBermFt > 0 ? baseEl.det.maxBermFt : BERM_MAX_RAISE_FT;");
  });
  it("both the flood-affected and upland solvers are threaded the ceiling as maxRaiseFt", () => {
    // sizePondForTargets (flood) + solveTobRaise (upland) both carry maxRaiseFt: maxBermFt.
    const hits = src.split("maxRaiseFt: maxBermFt").length - 1;
    expect(hits).toBeGreaterThanOrEqual(3); // det flood + det upland + mit re-solve
  });
  it("the SIZING & CRITERIA group renders a 'Max berm (ft)' input writing det.maxBermFt, with YOU / Standards provenance", () => {
    expect(src).toContain('<Field label="Max berm (ft)">');
    expect(src).toContain("setDet({ maxBermFt: Number.isFinite(n) && n > 0 ? n : null })");
    expect(src).toContain("How high the rim may rise above existing grade");
    expect(src).toContain("· Standards");
  });
  it("when the solve is cap-bound the gap proposal is built with capBound:true", () => {
    expect(dp).toContain("capBound: true");
  });
});

describe("C5 — every ac-ft the toast / detention message states is 1dp (fmtAcFt), never 2dp", () => {
  it("the detention design messages format required volumes through fmtAcFt", () => {
    expect(dp).toContain("fmtAcFt(detTargetCf / 43560)");
    expect(dp).toContain("fmtAcFt(mitTargetCf / 43560)");
    // no raw 2dp ac-ft on the design-pond volumes
    expect(dp.includes("f2(detTargetCf / 43560)")).toBe(false);
    expect(dp.includes("f2(mitTargetCf / 43560)")).toBe(false);
  });
});

describe("C4 — the pond's earthen berm ring on the plan + the LAND USE legend title", () => {
  it("a warm-earth 45-degree hatch pattern is defined", () => {
    expect(src).toContain('<pattern id="pat-berm"');
    expect(src).toContain('fill="#b08d57" opacity="0.45"'); // ~45% opacity body
    expect(src).toContain('patternTransform="rotate(45)"'); // 45-degree hatch (shared token, present on pat-berm)
  });
  it("a pointer-inert berm-ring layer draws the annulus (toe ring minus water, even-odd) with a 'berm {h} ft' tag", () => {
    expect(src).toContain('data-testid="pond-berm-ring-layer"');
    expect(src).toContain('fillRule="evenodd" fill="url(#pat-berm)"');
    expect(src).toContain("berm {(Math.round(berm.hFt * 10) / 10).toFixed(1)} ft");
  });
  it("the site-wide berm-ring area is summed and the Pond legend title names water + berm ring when a berm exists", () => {
    expect(src).toContain("const pondBermRingSf = pondBerms.reduce((s, b) => s + (b.landTakeSf || 0), 0);");
    expect(src).toContain("ac water + ${f2(pondBermRingSf / SQFT_PER_ACRE)} ac berm ring");
  });
});
