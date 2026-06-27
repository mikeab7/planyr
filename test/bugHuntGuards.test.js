import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Anti-drift guards for the 2026-06-27 bug-hunt fixes (B505–B509). These files are edited
 * by many concurrent sessions; a string-level check fails loudly if a merge silently reverts
 * a fix. Each guard points at the exact defect the bug-hunt confirmed. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("bug-hunt B505–B509: the fixes still exist in source", () => {
  it("B505: Stitcher loadStitch consumes the request on rejection too (.catch)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/loadStitch\(loadReq\)\.then\(/);
    expect(src).toMatch(/\.catch\(\(\) => onConsumeLoad && onConsumeLoad\(\)\)/);
  });

  it("B506/B507: both device-full cloud pushes have a rejection path (.catch)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/\}\)\.catch\(\(\) => \{ setSaveStatus\("unsaved"\); setSavedToCloudOnly\(false\); setCloudSaveFailed\(true\); \}\);/); // B506
    expect(src).toMatch(/\}\)\.catch\(\(\) => \{ setSaveNowMsg\(""\); setLocalSaveFailed\(true\); setSavedToCloudOnly\(false\); \}\);/);     // B507
  });

  it("B508: LayerPanel relevance control uses theme tokens, not hardcoded hex", () => {
    const src = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
    expect(src).not.toMatch(/#3b3a36|#fbfaf6|#b45309/);                       // the old hardcoded warm-dark hexes
    expect(src).toMatch(/active \? "var\(--accent\)" : "transparent"/);       // tokenized active fill
    expect(src).toMatch(/ls\.stale \? "var\(--warn-text\)"/);                 // tokenized stale stamp
  });

  it("B517: the TxRRC well/pipeline overlay no longer points at the retired Harris-clipped host", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    expect(src).not.toMatch(/gis\.hctx\.net\/arcgishcpid\/rest\/services\/TXRRC/); // retired, ~99.8% incomplete outside Harris
    expect(src).toMatch(/gis\.rrc\.texas\.gov\/server\/rest\/services\/rrc_public/); // authoritative statewide RRC service
  });

  it("B509: PropertyPanel threads the caption as aria-label to every control", () => {
    const src = read("../src/shared/markup/PropertyPanel.jsx");
    // each control receives label={label}
    for (const ctl of ["ColorControl", "NumberControl", "RangeControl", "EnumControl"]) {
      expect(src).toMatch(new RegExp(`<${ctl}[^>]*label=\\{label\\}`));
    }
    // and applies it as aria-label on its input/select
    expect((src.match(/aria-label=\{label\}/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
