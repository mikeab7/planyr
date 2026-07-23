// v3 PR-H → SUPERSEDED BY PR-K. PR-H keyed the pond's "floodway (no fill)" gate off split.inTrigger
// (ANY 1% trigger zone) so a bermed floodplain pond couldn't read a false green. The owner then
// checked FEMA and found NO mapped regulatory floodway under the Tsakiris pond — it's approximate
// Zone A, where fill IS allowed (with compensating storage). So PR-H's block was itself over-strict.
// PR-K reverses it: "in the floodway" is now PRECISE (a mapped ZONE_SUBTY = "FLOODWAY" polygon only),
// a floodway berm is allowed WITH a no-rise certification (not a hard cap), and Zone A / AE fringe
// ponds are governed by the mitigation ledger, not a verdict block. This file now guards THAT
// reversal by source scan so the old inTrigger gate can't silently return.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => { const i = src.indexOf(needle); if (i < 0) throw new Error(`marker not found: ${needle}`); return i; };
const dp = src.slice(at("const designPond = () => {"), at("// (B789: drainChannelRelevant now computed up"));

describe("PR-K — the SOLVER keys the floodway off the PRECISE tier, and no longer caps the rim there", () => {
  it("pondInFloodway derives from pondFloodplainTier (a mapped floodway polygon), not split.inTrigger", () => {
    expect(dp).toContain("const pondTier = pondFloodplainTier(ringOf(baseEl), fmZones);");
    expect(dp).toContain("const pondInFloodway = pondTier.inFloodway;");
    // the PR-H inTrigger gate is gone
    expect(dp.includes("const pondInFloodway = !!splitProbe.inTrigger")).toBe(false);
  });
  it("the floodway no longer forces a zero-raise cap — the solver may berm (only physical caps bind)", () => {
    expect(dp.includes("maxRaiseFt = pondInFloodway ? 0")).toBe(false);
    expect(dp).toContain("const maxRaiseFt = gradeFt == null ? BERM_MAX_RAISE_FT");
  });
  it("the old 'no fill is allowed in the floodway' no-berm branch and copy are removed", () => {
    expect(dp.includes("} else if (pondInFloodway) {")).toBe(false);
    expect(dp.includes("no fill is allowed")).toBe(false);
    expect(dp.includes('code: "floodway-fill"')).toBe(false);
  });
});

describe("PR-K — the VERDICT keys the floodway off the precise tier and treats it as a no-rise REQUIREMENT", () => {
  it("assessPondBuildable's inFloodway derives from pondFloodplainTier, not pondSplitFor(el).inTrigger", () => {
    expect(src).toContain("const inFloodway = pondFloodplainTier(ring, fmZones).inFloodway;");
    expect(src.includes("const inFloodway = !!pondSplitFor(el).inTrigger")).toBe(false);
  });
  it("the status card demotes to amber on a HARD block OR an outstanding no-rise requirement", () => {
    expect(src).toContain("const hardBlocked = !bld.buildable;");
    expect(src).toContain("const needsNoRise = bld.requirements.length > 0;");
    expect(src).toContain("const amber = hardBlocked || needsNoRise;");
    // the PR-H "floodplain forbids the berm" gate is gone
    expect(src.includes("const envelopeBlocked = short && inFw;")).toBe(false);
  });
});

describe("PR-K — the real-button harness asserts the reversal (rim IS bermed, no floodway copy)", () => {
  const harness = readFileSync(fileURLToPath(new URL("../ui-audit/verify-optimize-applies.mjs", import.meta.url)), "utf8");
  it("it seeds an approximate Zone A (non-floodway) pond and drives the ACTUAL Optimize button", () => {
    expect(harness).toContain("inTrigger: true");
    expect(harness).toContain('page.getByRole("button", { name: /Optimize pond/ })');
  });
  it("it asserts the rim WAS bermed and no floodway 'no-fill' prohibition copy renders", () => {
    expect(harness).toContain("the rim WAS bermed");
    expect(harness).toContain("no floodway");
  });
});
