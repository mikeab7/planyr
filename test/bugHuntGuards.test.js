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

  // B527's guard (Project Files drawer dark-mode theming) was retired with the drawer itself:
  // the redundant 🗂 Files button + ProjectFilesDrawer.jsx were removed once the Library tab
  // replaced them (B497). No component left to theme-guard.

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

  it("B603: the 3DEP elevation overlay uses the exact ArcGIS rasterFunction template name", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    // The USGS press-release PROSE ("Elevation Tinted Hillshade") is NOT a valid
    // rasterFunctionInfos[].name — exportImage errors on it and the overlay renders blank.
    expect(src).not.toMatch(/rendering: "Elevation Tinted Hillshade"/);
    // The real 3DEP template name (verbatim, "Hillshade <modifier>" like its siblings).
    expect(src).toMatch(/rendering: "Hillshade Elevation Tinted"/);
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

  it("B528: Doc Review upsertReview serializes per-id writes (no false self-conflict)", () => {
    const src = read("../src/workspaces/doc-review/lib/reviewStore.js");
    expect(src).toMatch(/makeWriteSerializer/);
    expect(src).toMatch(/serializeReviewWrite\(record\.id, \(\) => upsertReviewCore\(record\)\)/);
  });

  it("B529: Site Planner cloudUpsert serializes per-id writes (no false self-conflict)", () => {
    const src = read("../src/workspaces/site-planner/lib/cloudSync.js");
    expect(src).toMatch(/makeWriteSerializer/);
    expect(src).toMatch(/serializeSiteWrite\(model\.id, \(\) => cloudUpsertCore\(uid, model\)\)/);
  });

  it("B540: geocodeAddress distinguishes 'unreachable' from 'not found' (returns { error } vs null)", () => {
    const src = read("../src/workspaces/site-planner/lib/geocode.js");
    expect(src).toMatch(/reachedAny/);
    expect(src).toMatch(/return reachedAny \? null : \{ error:/);
    // both callers handle the { error } shape
    expect(read("../src/workspaces/site-planner/MapFinder.jsx")).toMatch(/hit && hit\.error/);
    expect(read("../src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/hit && hit\.error/);
  });

  it("B541: CloudSyncBadge boundary resets via resetKey, not a remount key (popover survives state churn)", () => {
    const src = read("../src/shared/ui/CloudSyncBadge.jsx");
    expect(src).not.toMatch(/<CloudBadgeBoundary key=/);     // no longer remounted on every state change
    expect(src).toMatch(/resetKey=\{String\(state/);          // passes a reset signal instead
    expect(src).toMatch(/prevProps\.resetKey !== this\.props\.resetKey/); // and clears a crash on its change
  });

  it("B544: PDF export revokes its blob URL immediately (no 8s leak window)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).not.toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(aEl\.href\), 8000\)/);
    expect(src).toMatch(/URL\.revokeObjectURL\(aEl\.href\); \/\/ B544/);
  });

  it("B545: MapFinder address search is guarded by a request-token (no stale-response clobber)", () => {
    const src = read("../src/workspaces/site-planner/MapFinder.jsx");
    expect(src).toMatch(/addrTokRef = useRef\(0\)/);
    expect(src).toMatch(/const tok = \+\+addrTokRef\.current/);
    expect(src).toMatch(/if \(tok !== addrTokRef\.current\) return/);
  });

  it("B546: Stitcher calibration display guards a non-finite ftPerUnit + commitCalibrate rejects u<1", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/Number\.isFinite\(ftPerUnit\) && ftPerUnit/);
    expect(src).toMatch(/if \(!\(u >= 1\)\)/);
  });

  it("B547: Stitcher takeoff totals guard against a NaN/Infinity rollup", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/Number\.isFinite\(totals\.areaSf\)/);
    expect(src).toMatch(/Number\.isFinite\(totals\.distFt\)/);
  });

  it("B551: Stitcher releases pointer capture on a blur/visibility abort (passes the pointerId)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    expect(src).toMatch(/panY: view\.panY, pointerId: e\.pointerId/);          // pan stores the pointerId
    expect(src).toMatch(/if \(drag\.current\) abortGesture\(drag\.current\.pointerId\)/); // recover passes it
  });

  it("B552: pendingLegacyCount delegates to pendingLegacySites (count == list == import)", () => {
    const src = read("../src/workspaces/site-planner/lib/storage.js");
    expect(src).toMatch(/return pendingLegacySites\(uid\)\.length/);
    expect(src).not.toMatch(/for \(const \[id, rec\] of Object\.entries\(legacy\)\)/); // the old over-counting loop is gone
  });

  it("B557: account email renders are null-guarded (no 'undefined' in the pill/profile)", () => {
    expect(read("../src/app/Shell.jsx")).toMatch(/Signed in as \$\{user\?\.email \|\| "\(no email\)"\}/);
    expect(read("../src/workspaces/site-planner/components/AuthPanel.jsx")).toMatch(/\{user\?\.email \|\| "\(no email\)"\}/);
  });

  it("B557: layers.js clears the feature-retry timer on removal + guards the cache-age fetch", () => {
    const src = read("../src/workspaces/site-planner/lib/layers.js");
    expect(src).toMatch(/lyr\.onRemove = function \(map\) \{ clearTimeout\(timer\)/); // retry timer cleanup
    expect(src).toMatch(/typeof m\.ts === "number" && lyr && lyr\._map/);             // stale-callback guard
  });

  it("B557: LayerPanel group + reveal toggles announce aria-expanded", () => {
    const src = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
    expect(src).toMatch(/aria-expanded=\{!collapsed\[g\]\}/);
    expect(src).toMatch(/aria-expanded=\{!!revealHidden\[groupKey\]\}/);
  });

  it("B557: ProjectBreadcrumb manage menu has role=menu + menuitem", () => {
    const src = read("../src/shared/ui/ProjectBreadcrumb.jsx");
    expect(src).toMatch(/role="menu" aria-label="Project actions"/);
    expect((src.match(/role="menuitem"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("B559: timestamp comparisons coerce via toMs (newer-wins merge + legacy-prune are type-safe)", () => {
    const sm = read("../src/workspaces/site-planner/lib/siteModel.js");
    expect(sm).toMatch(/export const toMs = /);
    expect(sm).toMatch(/toMs\(A\.updatedAt\) >= toMs\(B\.updatedAt\)/);
    const st = read("../src/workspaces/site-planner/lib/storage.js");
    expect(st).toMatch(/toMs\(cloudMap\[id\]\.updatedAt\) >= toMs\(legacy\[id\] && legacy\[id\]\.updatedAt\)/);
  });

  it("B562: importLegacyIntoCloud compares timestamps via toMs (third sibling of B559)", () => {
    const st = read("../src/workspaces/site-planner/lib/storage.js");
    // the legacy-import skip guard must coerce both sides so an ISO-string updatedAt can't NaN the compare
    expect(st).toMatch(/toMs\(existing\.updatedAt\) >= toMs\(local\.updatedAt\)/);
    // and the raw, type-unsafe form must be gone from that path
    expect(st).not.toMatch(/\(existing\.updatedAt \|\| 0\) >= \(local\.updatedAt \|\| 0\)/);
  });

  it("B563: version restore re-applies parcelDrawings (its own persistence path) so it isn't a mixed-version restore", () => {
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // the restore sequence must durably restore the version's parcelDrawings (via persistDrawings,
    // which both sets state AND saves — a bare setParcelDrawings would not persist)
    expect(sp).toMatch(/persistDrawings\(v\.parcelDrawings \|\| \[\]\)/);
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

describe("markup hit-area / callout padding / live color picker (B155 open-path tranche, B566, B567)", () => {
  it("B155: line + polyline markups carry a transparent FAT hit-stroke (not just the 2px visible line)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/const MK_HIT_PX = 12;/);                                  // ~6px each side
    // both open-path branches render the wide pointer-catching companion stroke
    expect((src.match(/strokeWidth=\{MK_HIT_PX\}[^>]*pointerEvents="stroke"/g) || []).length).toBeGreaterThanOrEqual(2);
    // the line branch is no longer a bare stroke-only <line {...common} />
    expect(src).not.toMatch(/if \(m\.kind === "line"\) \{ const a = f2p\(m\.a\), b = f2p\(m\.b\); return <line key=\{m\.id\}[^>]*\{\.\.\.common\} \/>; \}/);
  });

  it("B566: callout/text-box default horizontal padding is more generous than vertical", () => {
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/padX: c\.padX \?\? 14, padY: c\.padY \?\? 8/);             // Site Planner default
    const mr = read("../src/shared/markup/MarkupRenderer.jsx");
    expect(mr).toMatch(/const padX = 8, padY = 4;/);                              // Doc Review parity
    expect(mr).toMatch(/text\.length \* fs \* 0\.58 \+ padX \* 2/);
  });

  it("B567: every Site Planner color input picks live via livePick (onInput), with one-frame undo", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/const livePick = \(apply\) =>/);
    expect(src).toMatch(/onInput:\s+\(e\) => \{ if \(!pickSnapRef\.current\) \{ pushHistory\(\); pickSnapRef\.current = true; \}/);
    // all 12 native color controls now spread livePick instead of a bare onChange
    expect((src.match(/\{\.\.\.livePick\(\(v\) =>/g) || []).length).toBe(12);
    // the per-pixel undo floods are gone: the OLD color-input handlers (inline pushHistory) no
    // longer exist (discrete controls like the "Fill the parcel" checkbox keep their pushHistory)
    expect(src).not.toMatch(/onChange=\{\(e\) => \{ pushHistory\(\); setSelEl\(\{ fill: e\.target\.value/);
    expect(src).not.toMatch(/onChange=\{\(e\) => \{ pushHistory\(\); setSelParcel\(\{ fill: e\.target\.value/);
    // and NO native color input is left on a bare onChange (the actual invariant)
    expect(src).not.toMatch(/type="color"[^>]*onChange=/);
    // WYSIWYG: a SELECTED neutral markup shows its REAL stroke (nStroke), not the accent tint —
    // otherwise a live stroke-color change would be hidden under the selection highlight.
    expect(src).toMatch(/const nStroke = m\.stroke;/);
    expect(src).toMatch(/const nsw = sw \+ \(isSel \? 1 : 0\);/);
    expect(src).toMatch(/const common = \{ stroke: nStroke, strokeWidth: nsw,/);
  });

  it("B567: shared ColorControl fires live on input + Doc Review coalesces it to one undo frame", () => {
    const pp = read("../src/shared/markup/PropertyPanel.jsx");
    expect(pp).toMatch(/onInput=\{\(e\) => onChange\(e\.target\.value, \{ live: true \}\)\}/);
    expect(pp).toMatch(/onChange=\{\(e\) => onChange\(e\.target\.value, \{ live: false \}\)\}/);
    const dr = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(dr).toMatch(/const colorSessionRef = useRef\(null\)/);
    expect(dr).toMatch(/if \(opts\.live\) \{\s*if \(colorSessionRef\.current !== key\) \{ pushHistory\(\); colorSessionRef\.current = key; \}/);
  });

  it("B579: the Stitcher detail popup releases pointer capture on pointercancel (no stuck grab)", () => {
    const src = read("../src/workspaces/doc-review/Stitcher.jsx");
    // onPointerCancel must release capture, matching onPointerUp — not just clear drag state
    expect(src).toMatch(/onPointerCancel=\{\(e\) => \{ detailDrag\.current = null; try \{ e\.currentTarget\.releasePointerCapture\(e\.pointerId\)/);
  });

  it("B579: reviewStore deleteReview clears the local mirror only after a successful cloud delete", () => {
    const src = read("../src/workspaces/doc-review/lib/reviewStore.js");
    // the unconditional pre-delete clearDraft is gone; it now runs only on !error
    expect(src).not.toMatch(/\}\s*catch \(_\) \{\}\s*\n\s*if \(uid\) clearDraft\(uid, id\);/);
    expect(src).toMatch(/if \(!error && uid\) clearDraft\(uid, id\)/);
  });

  it("B579: DocReview warns on a genuine signed-in PDF store failure (not oversize, not logged-out)", () => {
    const src = read("../src/workspaces/doc-review/DocReview.jsx");
    expect(src).toMatch(/if \(!r\.ok && !r\.oversize && \(await cloudReady\(\)\)\)/);
  });
});
