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

  it("B522: the Mapillary proxy clamps a no-body upstream status instead of forwarding it", () => {
    const src = read("../functions/api/mapillary/[[path]].js");
    expect(src).toMatch(/resp\.status !== 204 && resp\.status !== 304/);
  });

  it("B523: the /api/file proxy clamps a no-body upstream status", () => {
    const src = read("../functions/api/file.js");
    expect(src).toMatch(/resp\.status !== 204 && resp\.status !== 304/);
  });

  it("B525: the ProjectBreadcrumb cloud-warn row uses theme tokens, not hardcoded amber hex", () => {
    const src = read("../src/shared/ui/ProjectBreadcrumb.jsx");
    expect(src).not.toMatch(/#fef3c7|#92400e/);
    expect(src).toMatch(/color: "var\(--warn-text\)"/);
  });

  it("B526: ToolRail uses theme tokens, not a permanently-dark hardcoded chrome", () => {
    const src = read("../src/shared/ui/ToolRail.jsx");
    expect(src).not.toMatch(/#191613|#ece7db|#9b9482|#2e2a23/);
    expect(src).toMatch(/CHROME = "var\(--surface-raised\)"/);
  });

  it("B527: the Project Files drawer themes its panel + controls (no white slab / invisible text in dark mode)", () => {
    const src = read("../src/workspaces/doc-review/components/ProjectFilesDrawer.jsx");
    expect(src).not.toMatch(/background: "#fff"/);                              // panel/control backgrounds were hardcoded white
    expect(src).not.toMatch(/#92400e|#2c2a26|#4b5563|#6b7280|#b45309|#fffbeb/); // hardcoded light text / cream-box hexes
    expect(src).toMatch(/paper: "var\(--surface-raised\)"/);                    // PAL is token-backed
    expect(src).toMatch(/color: "var\(--warn-text\)"/);                         // amber labels themed
  });

  it("B517: the TxRRC well/pipeline overlay no longer points at the retired Harris-clipped host", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    expect(src).not.toMatch(/gis\.hctx\.net\/arcgishcpid\/rest\/services\/TXRRC/); // retired, ~99.8% incomplete outside Harris
    expect(src).toMatch(/gis\.rrc\.texas\.gov\/server\/rest\/services\/rrc_public/); // authoritative statewide RRC service
  });

  it("B533: 3DEP elevation converts metres with the US survey foot, not the international foot", () => {
    const src = read("../src/workspaces/site-planner/lib/elevation.js");
    expect(src).not.toMatch(/M_TO_FT = 3\.280839895/);   // the international-foot constant
    expect(src).toMatch(/M_TO_FT = 3937 \/ 1200/);        // US survey foot, matching the EPSG:2278 spine
  });

  it("B534/B535: the Doc Review boot-resume IIFEs handle their own rejection (no unhandled promise)", () => {
    const stitch = read("../src/workspaces/doc-review/Stitcher.jsx");
    const dr = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(stitch).toMatch(/\}\)\(\)\.catch\(\(\) => \{\}\); \/\/ B534/);
    expect(dr).toMatch(/\}\)\(\)\.catch\(\(\) => \{\}\); \/\/ B535/);
  });

  it("B536: addGroup skips a failed page render and reports it (no silent group-drop abort)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/renderFailed/);
    expect(src).toMatch(/catch \(_\) \{ renderFailed\.push/);
  });

  it("B538: fracToNum guards a zero denominator (no Infinity/NaN leak)", () => {
    const src = read("../src/shared/files/sheetScale.js");
    expect(src).toMatch(/d === 0 \? 0 :/);
  });

  it("B539: currentAccessToken parses each auth-token entry inside its own try (a corrupt one doesn't abort the scan)", () => {
    const src = read("../src/workspaces/site-planner/lib/supabase.js");
    // the JSON.parse now lives inside a nested try whose catch continues the loop
    expect(src).toMatch(/corrupt entry — skip and keep scanning/);
  });

  it("B530: AuthPanel modals close on Escape and announce as a dialog", () => {
    const src = read("../src/workspaces/site-planner/components/AuthPanel.jsx");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/e\.key === "Escape"/);
  });

  it("B531: the ReviewsBar row and the SitePlanner Section header are keyboard-reachable", () => {
    const rb = read("../src/workspaces/doc-review/components/ReviewsBar.jsx");
    expect(rb).toMatch(/role="button" tabIndex=\{0\}/);
    expect(rb).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/className="sec-head"[\s\S]{0,200}role="button" tabIndex=\{0\} aria-expanded=\{open\}/);
  });

  it("B532: the Site review modal closes on Escape and announces as a dialog", () => {
    const src = read("../src/workspaces/site-planner/components/SiteReviewModal.jsx");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/e\.key === "Escape"/);
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
