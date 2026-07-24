// B983 / NEW-18 — button honesty on a MITIGATION shortfall. The one-click ⚡ Optimize pond reliably
// closes DETENTION (raise the rim above the flood), but MITIGATION usually needs a bigger FOOTPRINT the
// tool won't redraw — so a ⚡ click on a mitigation-only shortfall deepens what it can and still reports
// a gap, reading as a near-no-op. The Yield MITIGATION card must therefore offer "See mitigation options"
// (opens the pond's Sizing assistant, where deepen vs. enlarge are laid out with Apply chips) instead of
// the ⚡ button. Detention keeps its ⚡. AUDIT-FIRST note: designPond DOES already carry a mitigation
// objective (its pass2 deepens the below-WSE cut) and never fires a success-toned toast — it only ever
// uses flashWarn — so this is the button-routing half of NEW-18, not a "teach it mitigation" rebuild.
//
// vitest is DOM-free, so this guards the SitePlanner wiring by source scan. Fixture-free (no live values).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-18 — the mitigation shortfall routes to 'See mitigation options', never a no-op ⚡", () => {
  it("the drainage object exposes onSeeMitigationOptions, opening the pond's Sizing assistant", () => {
    expect(src).toContain("onSeeMitigationOptions: () => {");
    expect(src).toContain('const firstPond = els.find((e) => e.type === "pond");');
    expect(src).toContain('if (firstPond) revealPondInspector(firstPond.id, "assistant");');
    // with NO pond drawn there is nothing to open, so it falls back to designPond (draw a right-sized one)
    expect(src).toContain("else designPond();");
  });

  it("the mitigation card action is the options link (with a pond), else the ⚡ draw-one fallback", () => {
    expect(src).toContain("const mitigationAction = mitShort");
    expect(src).toContain("hasPond && d.onSeeMitigationOptions");
    expect(src).toContain("<ActionLink onClick={d.onSeeMitigationOptions}");
    expect(src).toContain("See mitigation options →");
    // no pond yet → the ⚡ designAction (draw a right-sized pond) stays honest
    expect(src).toContain(": designAction)");
  });

  it("the Mitigation-detail group uses mitigationAction (not the raw ⚡ designAction)", () => {
    expect(src).toContain('out.push(groupFold("mit", "Mitigation detail", mitVerdict, mitTone, mitR, mitSub, { chip: mitChip, action: mitigationAction }));');
    // the OLD wiring (the ⚡ button hung directly on the mitigation shortfall) is gone
    expect(src.includes('action: mitShort ? designAction : null }))')).toBe(false);
  });

  it("the DETENTION card still hangs the one-click ⚡ Optimize (unchanged — the rim raise is reliable)", () => {
    expect(src).toContain('action: detShort ? designAction : null');
    expect(src).toContain("⚡ Optimize pond");
  });
});
