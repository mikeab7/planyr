// v3 PR-H — PR-G shipped the buildable-envelope module but the gate never fired on the LIVE path.
// Root cause: designPond AND the status-card verdict keyed "in the floodway (no fill)" off
// ringInFloodway (a distinct cls==="floodway" polygon), while the pond's "In floodway: no fill"
// chip fires off split.inTrigger (ANY trigger flood zone). On the live Tsakiris pond — an AE/1%
// zone with no separate floodway polygon — ringInFloodway returned false, so the gate stayed
// silent, Optimize bermed +9.3, and the verdict read a false green "OK". Fix: key BOTH gates off
// the SAME split.inTrigger signal the chip uses (the precise ringInFloodway is OR'd in as a subset).
//
// The DEFINITIVE regression test is the REAL-BUTTON harness `ui-audit/verify-optimize-applies.mjs`,
// which drives the actual ⚡ Optimize button and asserts the rim is NOT bermed + the verdict is
// amber; it FAILS on pre-PR-H main (rim 94→99.4, green) and passes only with this fix. This file
// guards the wiring by source scan so the signal can't silently revert.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => { const i = src.indexOf(needle); if (i < 0) throw new Error(`marker not found: ${needle}`); return i; };
const dp = src.slice(at("const designPond = () => {"), at("// (B789: drainChannelRelevant now computed up"));

describe("H1/H4 — the SOLVER floodway gate keys off the chip's signal (split.inTrigger), not a floodway polygon", () => {
  it("pondInFloodway derives from splitProbe.inTrigger (OR the precise floodway polygon)", () => {
    expect(dp).toContain("const pondInFloodway = !!splitProbe.inTrigger || ringInFloodway(ringOf(baseEl), fmZones);");
    // and it hard-zeroes the rim raise
    expect(dp).toContain("const maxRaiseFt = pondInFloodway ? 0");
    // the pre-PR-H polygon-only gate is gone
    expect(dp.includes("const pondInFloodway = ringInFloodway(ringOf(baseEl), fmZones);")).toBe(false);
  });
  it("the floodway-blocked branch reports the amber reason instead of a phantom berm", () => {
    expect(dp).toContain("} else if (pondInFloodway) {");
    expect(dp).toContain('detMsg = "This pond can\'t be bermed to add detention in the floodway (no fill is allowed).";');
  });
});

describe("H2/H4 — the VERDICT floodway gate keys off the same split.inTrigger signal", () => {
  it("assessPondBuildable's inFloodway derives from pondSplitFor(el).inTrigger (OR the polygon)", () => {
    expect(src).toContain("const inFloodway = !!pondSplitFor(el).inTrigger || ringInFloodway(ring, fmZones);");
    expect(src.includes("const inFloodway = ringInFloodway(ring, fmZones);")).toBe(false);
  });
  it("a SHORT pond in the floodplain reads AMBER 'not buildable to reach', never a bare red SHORT", () => {
    expect(src).toContain("const inFw = !!split.inTrigger;");
    expect(src).toContain("const envelopeBlocked = short && inFw;");
    expect(src).toContain("const unbuildable = !bld.buildable || envelopeBlocked;");
    // PR-I (I5) split the achieved-vs-required off the headline into its own sub-line (no dangling paren).
    expect(src).toContain("`Not buildable to reach ${f1(detReqAcFt)} ac-ft`");
    expect(src).toContain("`${f1(provAcFt)} of ${f1(detReqAcFt)} ac-ft achievable`");
  });
});

describe("H3 — the real-button regression harness exists and asserts the fix (repro on pre-PR-H main)", () => {
  const harness = readFileSync(fileURLToPath(new URL("../ui-audit/verify-optimize-applies.mjs", import.meta.url)), "utf8");
  it("it seeds an in-floodplain (inTrigger) pond and drives the ACTUAL Optimize button", () => {
    expect(harness).toContain("inTrigger: true");
    expect(harness).toContain('page.getByRole("button", { name: /Optimize pond/ })');
  });
  it("it asserts the rim is NOT bermed and no green OK renders (the PR-H fix)", () => {
    expect(harness).toContain("the rim was NOT bermed");
    expect(harness).toContain("no green detention");
  });
});
