// v3 PR-I — COMPUTE, don't interrogate. The pond panel must never show an empty input box that
// demands an expert value; every engineering criterion is pre-filled with a computed screening
// ESTIMATE (EST tag) inside a collapsed "Engineering assumptions" section, a permanent pool only
// renders for a wet pond, the flag chips wrap inside the panel, and the verdict is a headline + a
// separate sub-line (no dangling parenthesis). Behavior lives in pondScreeningDefaults.js
// (unit-tested); this guards the SitePlanner + Chip wiring by source scan, plus the live-panel
// harness ui-audit/verify-pond-panel-defaults.mjs (chip overflow + verdict typography measured
// in a real browser).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const chip = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/components/Chip.jsx", import.meta.url)), "utf8");

describe("I1 — every engineering criterion is pre-filled with a computed estimate (never a blank)", () => {
  it("the screening-defaults are computed for the panel", () => {
    expect(src).toContain('import { estDepthToWaterFt, estMaxExcavDepthFt, poolRelevantForRole } from "./lib/pondScreeningDefaults.js";');
    // PR-N/O5 — the receiving-water tailwater now comes from the never-grade channel ladder helper.
    expect(src).toContain("const g_twEst = pondTailwaterResult(selEl, g_gradeFt);");
    expect(src).toContain("const g_maxExcavEst = estMaxExcavDepthFt({ depthToWaterFt: g_dtwEst.valueFt });");
  });
  it("the Receiving-water field VALUE falls back to the estimate (not an empty string)", () => {
    expect(src).toContain("value={det.receivingFlowlineElev ?? (Number.isFinite(g_twEst.valueFt) ? Math.round(g_twEst.valueFt * 10) / 10 : \"\")}");
  });
  it("the Max-excavation field VALUE falls back to the estimate", () => {
    expect(src).toContain("value={det.maxExcavDepthFt ?? (Number.isFinite(g_maxExcavEst.valueFt) ? Math.round(g_maxExcavEst.valueFt * 10) / 10 : \"\")}");
  });
  it("the Depth-to-water field VALUE falls back to the regional estimate", () => {
    expect(src).toContain("value={dtw ?? (Number.isFinite(dtwEstField.valueFt) ? dtwEstField.valueFt : \"\")}");
  });
  it("each estimated field carries an EST tag when it's the estimate (not an override)", () => {
    // the EST pill style + at least three usages (tailwater, max-excav, depth-to-water)
    expect(src).toContain("const estPillStyle = {");
    expect((src.match(/style=\{estPillStyle\}/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it("the estimates FEED the buildable envelope (I6 — an unentered value can't loosen the gate)", () => {
    // PR-N/O5 — tailwater into the envelope is the never-grade channel ladder (override, else a real
    // below-grade source, else UNKNOWN → the gate can't fire on a grade placeholder).
    expect(src).toContain("const tailwaterFt = pondTailwaterResult(el, gradeFt).valueFt;");
    expect(src).toContain("estMaxExcavDepthFt({ depthToWaterFt: dtwEst }).valueFt");
  });
});

describe("I2 — progressive disclosure: the criteria live in a collapsed 'Engineering assumptions' section", () => {
  it("the section is titled 'Engineering assumptions' and stays closed by default", () => {
    expect(src).toContain('<Collapse sectionId="pond-sizing" title="Engineering assumptions" defaultOpen={false}');
  });
  it("the header copy explains it (plain English, NO em dash)", () => {
    expect(src).toContain("The app estimated these from the site data. Open only if you want to override a value.");
    const header = "The app estimated these from the site data. Open only if you want to override a value.";
    expect(header.includes("—")).toBe(false);
  });
});

describe("I3 — a permanent pool renders ONLY for a wet pond (absent on a dry Detention pond)", () => {
  it("the pool field is gated on poolRelevantForRole via g_poolRelevant", () => {
    expect(src).toContain("const g_poolRelevant = poolRelevantForRole(g_roleInfo.role);");
    expect(src).toContain("{g_poolRelevant && (() => {");
    // it is no longer rendered unconditionally
    expect(src.includes('<Field label="Permanent pool elev. (ft)">\n                      <span')).toBe(false);
  });
});

describe("I4 — chips WRAP within the panel, never run off the right edge", () => {
  it("the Chip pill is no longer whiteSpace:nowrap and is capped at the container width", () => {
    expect(chip).toContain('whiteSpace: "normal"');
    expect(chip).toContain('maxWidth: "100%"');
    expect(chip.includes('whiteSpace: "nowrap"')).toBe(false);
  });
});

describe("I5 — the verdict is a HEADLINE + a separate achieved/required sub-line (no dangling paren)", () => {
  it("the card carries a subline distinct from the heading", () => {
    expect(src).toContain('heading: hardBlocked\n                        ? (short ? `Not buildable to reach ${f1(detReqAcFt)} ac-ft` : unbuildableHeading({ requiredAcFt: detReqAcFt }))');
    expect(src).toContain("subline: hardBlocked && short");
    expect(src).toContain("`${f1(provAcFt)} of ${f1(detReqAcFt)} ac-ft achievable`");
    // the green case is a plain "Buildable" headline
    expect(src).toContain('  : "Buildable",');
  });
  it("the render draws heading and sub-line as SEPARATE elements, wrap-safe", () => {
    expect(src).toContain("{c.subline ? <div style={{ fontSize: 11, color: PAL.muted");
    expect(src).toContain('overflowWrap: "anywhere" }}>{c.heading}</div>');
    // the old wrapped parenthetical form is gone
    expect(src.includes("ac-ft (${f1(provAcFt)} of ${f1(detReqAcFt)})`")).toBe(false);
  });
});
