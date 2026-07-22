import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* B828 — undo-reliability sweep. Four confirmed "the undo button doesn't work" gaps, each a
 * mutation of undoable state that recorded no history frame (or read a STALE snapshot). These are
 * string-level anti-drift guards (like bugHuntGuards.test.js): the three edited files are touched by
 * many concurrent sessions, so a silent merge revert of any fix fails loudly here. The pure history
 * stack itself is covered by test/history.test.js; these guard the WIRING at each call site. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("B828: undo records a frame on every editable-state mutation (wiring guards)", () => {
  it("parcel fill 'Translucence' slider coalesces one drag into one undo frame via sliderHistory", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the fillOpacity range spreads {...sliderHistory(apply)} — the house rule for EVERY opacity slider
    expect(src).toMatch(/value=\{selParcel\.fillOpacity \?\? 0\.12\}\s*\n\s*\{\.\.\.sliderHistory\(\(e\) => setSelParcel\(\{ fillOpacity: \+e\.target\.value \}\)\)\}/);
    // and is NOT back on a bare, un-undoable onChange (setSelParcel never pushes on its own)
    expect(src).not.toMatch(/onChange=\{\(e\) => setSelParcel\(\{ fillOpacity: \+e\.target\.value \}\)\}/);
  });

  it("raster overlay 'Width' input pushes one history frame per edit session (onFocus)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // typing a new width (patchOverlay hist=false) is checkpointed by onFocus, mirroring the
    // opacity number input above it; without it the resize was un-undoable though ftPerPx IS snapshotted
    expect(src).toMatch(/value=\{Math\.round\(o\.imgW \* o\.ftPerPx\)\} onFocus=\{\(\) => pushHistory\(\)\} onChange=\{\(e\) => \{ const v = \+e\.target\.value; if \(v > 0\) patchOverlay\(o\.id, \{ ftPerPx:/);
  });

  it("Stitcher auto-calibrate checkpoints BEFORE setting ftPerUnit (undo can't eat an earlier measure)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    // pushHistory() precedes the auto-scale write on the same statement; ftPerUnit is in the snapshot,
    // so without the checkpoint one Undo would skip past it and delete a pre-group measurement
    expect(src).toMatch(/if \(cal\) \{ pushHistory\(\); setFtPerUnit\(cal\.ftPerUnit\); calMsg =/);
  });

  it("Doc Review + Stitcher undo mirrors are assigned DURING RENDER, not a passive effect (B315 class)", () => {
    // A passive-effect mirror lags one paint behind, so an undo fired right after an edit compares its
    // baseline against a stale snapshot and no-ops (the button looks live but does nothing). Both fixed
    // by assigning the ref during render, exactly like SitePlanner's stateRef.
    const dr = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(dr).toMatch(/\n  docStateRef\.current = \{ markups, calByPage, calInfo \};/);
    expect(dr).not.toMatch(/useEffect\(\(\) => \{ docStateRef\.current = /);

    const st = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(st).toMatch(/\n  editRef\.current = \{ measures, ftPerUnit \};/);
    expect(st).not.toMatch(/useEffect\(\(\) => \{ editRef\.current = /);

    // the pattern this mirrors: SitePlanner assigns its undo state ref during render, not in an effect
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/\n  stateRef\.current = \{ parcels, els, measures, callouts, markups, underlay, sheetOverlays, deletedIds, layerOverrides \};/);
  });
});
